import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import {
  AccountRole, address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage, getBase58Decoder,
  getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Blockhash,
} from '@solana/kit';
import {
  ACCOUNT_DISCRIMINATORS, ACCOUNT_SIZES, decodeAccount, describeError, estimateCost, explorerUrl, formatPeriod, formatSol, grantAddress,
  grantInstruction, INSTRUCTION_DISCRIMINATORS, isForSale, NO_OWNER, paidCost, parseDashboardConfig, paymentInstruction, PROGRAM_ERRORS,
  receiptAddress, revokeInstruction, serverAddresses, sshCommand, transactionSignature,
} from '../src/billing.ts';
import type { Receipt, ServerState, SolanaRpc } from '../src/billing.ts';

type IdlAccount = { name: string; writable?: boolean; signer?: boolean };
const idl = JSON.parse(readFileSync(new URL('../../shared/billing-access/billing_access.json', import.meta.url), 'utf8')) as {
  address: string;
  instructions: { name: string; discriminator: number[]; accounts: IdlAccount[] }[];
  accounts: { name: string; discriminator: number[] }[];
  errors: { code: number; msg: string }[];
};
const program = address(idl.address);
const key = (byte: number) => address(new PublicKey(new Uint8Array(32).fill(byte)).toBase58());
const owner = key(4);
const wallet = key(6);
const paymentId = 'ab'.repeat(32);
const serverSettings = { name: 'Server 1', server_id: 'cd'.repeat(32), unix_user: 'ubuntu', ssh_host: 'vps.example.com', ssh_port: 22 };
const settings = {
  cluster: 'devnet', rpc_url: 'https://api.devnet.solana.com', program_id: idl.address, provider_pubkey: key(2),
  servers: [serverSettings, { ...serverSettings, name: 'Server 2', server_id: 'ef'.repeat(32), ssh_host: 'vps2.example.com' }],
};
const config = parseDashboardConfig(settings);
const [target, secondTarget] = config.servers;
assert.ok(target && secondTarget, 'the settings list two servers');

test('client constants match the published IDL', () => {
  for (const [name, discriminator] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
    assert.deepEqual(discriminator, idl.instructions.find(item => item.name === name)?.discriminator, name);
  }
  for (const [name, discriminator] of Object.entries(ACCOUNT_DISCRIMINATORS)) {
    assert.deepEqual(discriminator, idl.accounts.find(item => item.name === name)?.discriminator, name);
    assert.deepEqual(discriminator, [...createHash('sha256').update(`account:${name}`).digest().subarray(0, 8)], name);
  }
  assert.deepEqual(PROGRAM_ERRORS, Object.fromEntries(idl.errors.map(error => [error.code, error.msg])));
});

test('instructions encode IDL account order, roles, and arguments', async () => {
  const { server, subscription } = await serverAddresses(config, target);
  const ownerGrant = await grantAddress(program, server, owner);
  const base = { programId: program, owner, server, subscription, ownerGrant };
  const grant = await grantAddress(program, server, wallet);
  const receipt = await receiptAddress(program, server, paymentId);
  const cases = [
    ['purchase_access', paymentInstruction('purchase', { ...base, receipt, treasury: key(5) }, paymentId), [Buffer.from(paymentId, 'hex')]],
    ['renew_access', paymentInstruction('renew', { ...base, receipt, treasury: key(5) }, paymentId), [Buffer.from(paymentId, 'hex')]],
    ['grant_delegated_access', grantInstruction({ ...base, grant }, wallet, 1_800_000_123n), [new PublicKey(wallet).toBytes(), Buffer.from('7bd2496b00000000', 'hex')]],
    ['revoke_delegated_access', revokeInstruction({ ...base, grant }, wallet), [new PublicKey(wallet).toBytes()]],
  ] as const;
  for (const [name, ix, args] of cases) {
    const spec = idl.instructions.find(item => item.name === name)!;
    assert.equal(ix.programAddress, program);
    assert.deepEqual(ix.accounts?.map(meta => meta.role), spec.accounts.map(account =>
      account.signer ? (account.writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
        : account.writable ? AccountRole.WRITABLE : AccountRole.READONLY), name);
    assert.deepEqual(Buffer.from(ix.data!), Buffer.concat([Buffer.from(spec.discriminator), ...args.map(arg => Buffer.from(arg))]), name);
  }
  assert.equal(cases[0][1].accounts?.[4]?.address, receipt);
  assert.equal(cases[2][1].accounts?.[4]?.address, grant);
});

test('PDAs match an independent derivation', async () => {
  const programKey = new PublicKey(program);
  const [server] = PublicKey.findProgramAddressSync([Buffer.from('server'), new PublicKey(config.provider).toBytes(), Buffer.from(target.serverId, 'hex')], programKey);
  const [subscription] = PublicKey.findProgramAddressSync([Buffer.from('subscription'), server.toBytes()], programKey);
  const [grant] = PublicKey.findProgramAddressSync([Buffer.from('grant'), server.toBytes(), new PublicKey(wallet).toBytes()], programKey);
  const [receipt] = PublicKey.findProgramAddressSync([Buffer.from('payment'), server.toBytes(), Buffer.from(paymentId, 'hex')], programKey);
  assert.deepEqual(await serverAddresses(config, target), { server: server.toBase58(), subscription: subscription.toBase58() });
  // Each listed server has its own record.
  assert.notEqual((await serverAddresses(config, secondTarget)).server, server.toBase58());
  assert.equal(await grantAddress(program, address(server.toBase58()), wallet), grant.toBase58());
  assert.equal(await receiptAddress(program, address(server.toBase58()), paymentId), receipt.toBase58());
});

test('accounts decode only with the program owner, discriminator, and exact size', () => {
  // Contract v1 sizes, including the 8-byte discriminator.
  assert.deepEqual(ACCOUNT_SIZES, { ServerRecord: 154, Subscription: 81, AccessGrant: 83, PaymentReceipt: 129 });
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(100_000_000n);
  const period = Buffer.alloc(8); period.writeBigInt64LE(2_592_000n);
  const data = Buffer.concat([
    Buffer.from(ACCOUNT_DISCRIMINATORS.ServerRecord), new PublicKey(config.provider).toBytes(), Buffer.from(target.serverId, 'hex'),
    new PublicKey(owner).toBytes(), new PublicKey(key(5)).toBytes(), amount, period, Buffer.from([1, 254]),
  ]);
  assert.equal(data.length, ACCOUNT_SIZES.ServerRecord);
  const record = decodeAccount('ServerRecord', program, data, program);
  assert.equal(record.ownerWallet, owner);
  assert.equal(record.treasury, key(5));
  assert.equal(record.priceLamports, 100_000_000n);
  assert.equal(record.periodSeconds, 2_592_000n);
  assert.equal(record.enabled, true);
  assert.throws(() => decodeAccount('ServerRecord', owner, data, program), /Unexpected/);
  assert.throws(() => decodeAccount('ServerRecord', program, data.subarray(0, -1), program), /Unexpected/);
  assert.throws(() => decodeAccount('ServerRecord', program, Buffer.concat([data, Buffer.from([0])]), program), /Unexpected/);
  assert.throws(() => decodeAccount('Subscription', program, data, program), /Unexpected/);
});

test('dashboard settings are validated like the gateway', () => {
  assert.equal(config.provider, settings.provider_pubkey);
  assert.deepEqual(config.servers.map(item => item.name), ['Server 1', 'Server 2']);
  assert.equal(sshCommand(target), 'ssh ubuntu@vps.example.com');
  assert.equal(sshCommand({ ...target, sshPort: 2222 }), 'ssh -p 2222 ubuntu@vps.example.com');
  assert.doesNotThrow(() => parseDashboardConfig({ ...settings, cluster: 'localnet', rpc_url: 'http://127.0.0.1:8899' }));
  for (const change of [
    { cluster: 'mainnet' }, { rpc_url: 'http://api.devnet.solana.com' }, { rpc_url: 'http://127.0.0.1:8899' },
    { rpc_url: 'https://user:secret@rpc.example' }, { program_id: 'not-a-key' }, { gateway_token: 'secrets do not belong here' },
    { servers: [] }, { servers: Array(17).fill(serverSettings) }, { servers: [serverSettings, serverSettings] }, { servers: 'Server 1' },
  ]) {
    assert.throws(() => parseDashboardConfig({ ...settings, ...change }), /invalid/, JSON.stringify(change));
  }
  for (const change of [
    { server_id: 'CD'.repeat(32) }, { name: '' }, { name: ' padded' }, { name: 'line\nbreak' }, { name: 'x'.repeat(65) },
    { unix_user: 'root' }, { unix_user: 'two words' }, { ssh_host: '-oProxyCommand=x' }, { ssh_port: 0 }, { ssh_port: '22' },
    { gateway_token: 'nor here' },
  ]) {
    assert.throws(() => parseDashboardConfig({ ...settings, servers: [{ ...serverSettings, ...change }] }), /invalid/, JSON.stringify(change));
  }
  assert.throws(() => parseDashboardConfig([]), /invalid/);
});

test('amounts, periods, and program errors read clearly', () => {
  assert.equal(formatSol(100_000_000n), '0.1 SOL');
  assert.equal(formatSol(2_000_000_000n), '2 SOL');
  assert.equal(formatSol(1n), '0.000000001 SOL');
  assert.equal(formatPeriod(2_592_000n), '30 days');
  assert.equal(formatPeriod(86_400n), '1 day');
  assert.equal(formatPeriod(7_200n), '2 hours');
  assert.equal(formatPeriod(90n), '90 seconds');
  assert.equal(describeError({ InstructionError: [0, { Custom: 6003 }] }), 'Server is disabled.');
  assert.equal(describeError(Object.assign(new Error('wrapped'), { cause: { context: { code: 6008n } } })), `${PROGRAM_ERRORS[6008]}.`);
  assert.match(describeError('InsufficientFundsForRent'), /enough SOL/);
  assert.equal(describeError(new Error('Something else')), 'Something else');
});

test('the fee payer signature identifies a signed transaction', () => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayer(owner, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash({ blockhash: key(9) as string as Blockhash, lastValidBlockHeight: 100n }, tx),
    tx => appendTransactionMessageInstruction(revokeInstruction({ programId: program, owner, server: key(1), subscription: key(2), ownerGrant: key(3), grant: key(7) }, wallet), tx),
  );
  const unsigned = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  assert.throws(() => transactionSignature(unsigned, owner), /did not sign/);
  const signed = Uint8Array.from(unsigned);
  signed.fill(7, 1, 65);
  assert.equal(transactionSignature(signed, owner), getBase58Decoder().decode(new Uint8Array(64).fill(7)));
});

test('a server is for sale until bought, and again once its term ends', () => {
  // The program's NO_OWNER is the all-zero key.
  assert.deepEqual(new PublicKey(NO_OWNER).toBytes(), new Uint8Array(32));
  const state = (ownerWallet: string, paidUntil: bigint) => ({ record: { ownerWallet }, paidUntil }) as unknown as ServerState;
  assert.equal(isForSale(state(NO_OWNER, 0n), 100n), true);
  assert.equal(isForSale(state(owner, 101n), 100n), false);
  assert.equal(isForSale(state(owner, 100n), 100n), true);
  assert.equal(isForSale(state(owner, 50n), 100n), true);
});

test('preflight rejections explain their cause instead of a bare error code', async () => {
  const kit = await import('@solana/kit');
  const preflight = (cause?: Error) => new kit.SolanaError(kit.SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
    accounts: null, fee: null, innerInstructions: null, loadedAccountsDataSize: 0, loadedAddresses: null, logs: [],
    postBalances: null, postTokenBalances: null, preBalances: null, preTokenBalances: null, replacementBlockhash: null,
    returnData: null, unitsConsumed: 0n, cause,
  });
  // The error from an unfunded wallet: "Attempt to debit an account but found no record of a prior credit".
  assert.match(describeError(preflight(new kit.SolanaError(kit.SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND))), /does not have enough SOL/);
  assert.match(describeError(preflight(new kit.SolanaError(kit.SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE))), /does not have enough SOL/);
  assert.match(describeError(preflight(new kit.SolanaError(kit.SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND))), /expired before it reached Solana/);
  assert.match(describeError(preflight()), /rejected the transaction in simulation/);
  assert.equal(describeError(new kit.SolanaError(kit.SOLANA_ERROR__TRANSACTION_ERROR__SIGNATURE_FAILURE)), 'Solana returned error 7050012.');
});

/** An RPC double: each method answers with `answers[method]`, called with the request's arguments. */
const fakeRpc = (answers: Record<string, (...args: never[]) => unknown>) => new Proxy({}, {
  get: (_, method: string) => (...args: never[]) => ({
    send: async () => {
      const answer = answers[method];
      if (!answer) throw new Error(`Unexpected RPC call: ${method}`);
      return answer(...args);
    },
  }),
}) as SolanaRpc;
// Rent-exempt minimum under Solana's default rent: (128 + size) bytes for two years.
const rentFor = (size: bigint) => (128n + size) * 6_960n;

test('a payment estimate adds the network fee and rent only for accounts it creates', async () => {
  const ix = revokeInstruction({ programId: program, owner, server: key(1), subscription: key(2), ownerGrant: key(3), grant: key(7) }, wallet);
  const exists = { owner: program };
  const rpc = (fee: bigint | null) => fakeRpc({
    getLatestBlockhash: () => ({ value: { blockhash: key(9), lastValidBlockHeight: 100n } }),
    getFeeForMessage: () => ({ value: fee }),
    getMultipleAccounts: () => ({ value: [null, exists, { owner: key(11) }] }),
    getMinimumBalanceForRentExemption: rentFor,
  });
  const created: [typeof owner, 'PaymentReceipt' | 'AccessGrant'][] = [[key(12), 'PaymentReceipt'], [key(13), 'AccessGrant'], [key(14), 'AccessGrant']];
  // A missing receipt and an account not owned by the program both cost rent; an existing grant does not.
  const rent = rentFor(BigInt(ACCOUNT_SIZES.PaymentReceipt)) + rentFor(BigInt(ACCOUNT_SIZES.AccessGrant));
  assert.deepEqual(await estimateCost(rpc(5_000n), program, owner, ix, 100_000_000n, created),
    { price: 100_000_000n, fee: 5_000n, rent, total: 100_005_000n + rent });
  assert.equal((await estimateCost(rpc(null), program, owner, ix, 0n, created)).fee, 5_000n);
});

test('a paid cost comes from the payer balance change in the transaction that created the receipt', async () => {
  const receipt = { address: key(12), payer: owner, amount: 100_000_000n } as Receipt;
  const rent = rentFor(BigInt(ACCOUNT_SIZES.PaymentReceipt));
  const rpc = (payer: typeof owner) => fakeRpc({
    getSignaturesForAddress: () => [{ signature: 'later', err: null }, { signature: 'created', err: null }],
    getTransaction: (signature: string) => {
      assert.equal(signature, 'created');
      return {
        meta: { fee: 5_000n, preBalances: [2_000_000_000n, 0n], postBalances: [2_000_000_000n - 100_005_000n - rent, 0n] },
        transaction: { message: { accountKeys: [payer, key(12), program] } },
      };
    },
  });
  assert.deepEqual(await paidCost(rpc(owner), program, receipt),
    { price: 100_000_000n, fee: 5_000n, rent, total: 100_005_000n + rent, signature: 'created' });
  await assert.rejects(paidCost(rpc(wallet), program, receipt), /could not be read/);
});

test('explorer links name the dashboard cluster', () => {
  assert.equal(explorerUrl(config, 'abc'), 'https://explorer.solana.com/tx/abc?cluster=devnet');
  assert.equal(explorerUrl({ cluster: 'mainnet-beta', rpcUrl: 'https://rpc.example/' }, 'abc'), 'https://explorer.solana.com/tx/abc');
  assert.equal(explorerUrl({ cluster: 'localnet', rpcUrl: 'http://127.0.0.1:8899/' }, 'abc'),
    'https://explorer.solana.com/tx/abc?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899%2F');
});
