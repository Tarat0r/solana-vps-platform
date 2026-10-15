// Transaction helper for provider.sh: encodes provider instructions from the
// published IDL, sends them with the provider keypair, and prints server state.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  AccountRole,
  address,
  createClient,
  fetchEncodedAccounts,
  fixDecoderSize,
  fixEncoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getBase16Decoder,
  getBase16Encoder,
  getBooleanDecoder,
  getBooleanEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getI64Decoder,
  getI64Encoder,
  getProgramDerivedAddress,
  getStructDecoder,
  getStructEncoder,
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  type Address,
  type Decoder,
  type MaybeEncodedAccount,
  type Instruction,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';

type Idl = {
  address: string;
  instructions: { name: string; discriminator: number[] }[];
  accounts: { name: string; discriminator: number[] }[];
};

const idl: Idl = JSON.parse(
  readFileSync(new URL('../../shared/billing-access/billing_access.json', import.meta.url), 'utf8'),
);
const programAddress = address(idl.address);
const systemProgram = address('11111111111111111111111111111111');

function discriminator(list: { name: string; discriminator: number[] }[], name: string) {
  const entry = list.find((item) => item.name === name);
  if (!entry) throw new Error(`IDL has no ${name}`);
  return Uint8Array.from(entry.discriminator);
}

const disc = fixEncoderSize(getBytesEncoder(), 8);
const bytes32 = fixEncoderSize(getBytesEncoder(), 32);
const registerArgs = getStructEncoder([
  ['discriminator', disc],
  ['serverId', bytes32],
  ['treasury', getAddressEncoder()],
  ['priceLamports', getU64Encoder()],
  ['periodSeconds', getI64Encoder()],
]);
const setEnabledArgs = getStructEncoder([
  ['discriminator', disc],
  ['enabled', getBooleanEncoder()],
]);

const accountDisc = fixDecoderSize(getBytesDecoder(), 8);
const serverRecord = getStructDecoder([
  ['discriminator', accountDisc],
  ['provider', getAddressDecoder()],
  ['serverId', fixDecoderSize(getBytesDecoder(), 32)],
  ['ownerWallet', getAddressDecoder()],
  ['treasury', getAddressDecoder()],
  ['priceLamports', getU64Decoder()],
  ['periodSeconds', getI64Decoder()],
  ['enabled', getBooleanDecoder()],
  ['bump', getU8Decoder()],
]);
const subscription = getStructDecoder([
  ['discriminator', accountDisc],
  ['server', getAddressDecoder()],
  ['ownerWallet', getAddressDecoder()],
  ['paidUntil', getI64Decoder()],
  ['bump', getU8Decoder()],
]);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    keypair: { type: 'string' },
    'server-id': { type: 'string' },
    treasury: { type: 'string' },
    'price-lamports': { type: 'string' },
    'period-seconds': { type: 'string' },
  },
});
const [command] = positionals;
const required = (name: keyof typeof values) => {
  const value = values[name];
  if (!value) throw new Error(`missing --${name}`);
  return value;
};
const positive = (name: 'price-lamports' | 'period-seconds', max: bigint) => {
  const value = BigInt(required(name));
  if (value <= 0n || value > max) throw new Error(`--${name} is out of range`);
  return value;
};

// Like the Solana CLI: an explicit RPC port implies its WebSocket on port + 1.
function websocketUrl(rpcUrl: string) {
  const url = new URL(rpcUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (url.port) url.port = String(Number(url.port) + 1);
  return url.toString();
}

const serverIdHex = required('server-id');
if (!/^[0-9a-f]{64}$/.test(serverIdHex)) throw new Error('--server-id must be 64 lowercase hex characters');
const serverId = getBase16Encoder().encode(serverIdHex);
// Version 0: solana-test-validator 4.2.2 cannot deserialize Kit's v1 wire
// format, and these small provider transactions need no v1 features.
const client = await createClient()
  .use(signerFromFile(required('keypair')))
  .use(
    solanaRpc({
      rpcUrl: required('url'),
      rpcSubscriptionsUrl: websocketUrl(required('url')),
      transactionConfig: { version: 0 },
    }),
  );
const provider = client.payer;

const [server] = await getProgramDerivedAddress({
  programAddress,
  seeds: ['server', getAddressEncoder().encode(provider.address), serverId],
});
const [subscriptionAddress] = await getProgramDerivedAddress({
  programAddress,
  seeds: ['subscription', getAddressEncoder().encode(server)],
});

/** Decodes a program account after checking owner, discriminator, and exact size. */
function decode<T extends object>(account: MaybeEncodedAccount, name: string, decoder: Decoder<T>) {
  if (!account.exists) return null;
  const expected = discriminator(idl.accounts, name);
  const [value, size] = decoder.read(account.data, 0);
  const valid =
    account.programAddress === programAddress &&
    size === account.data.length &&
    getBase16Decoder().decode(account.data.subarray(0, 8)) === getBase16Decoder().decode(expected);
  if (!valid) throw new Error(`${account.address} is not a valid ${name} account`);
  return value;
}

async function state() {
  const [record, sub] = await fetchEncodedAccounts(client.rpc, [server, subscriptionAddress], {
    commitment: 'confirmed',
  });
  if (!record || !sub) throw new Error('The RPC returned fewer accounts than requested.');
  const recordValue = decode(record, 'ServerRecord', serverRecord);
  const subscriptionValue = decode(sub, 'Subscription', subscription);
  return {
    rpcUrl: values.url,
    programId: programAddress,
    provider: provider.address,
    serverId: serverIdHex,
    server,
    subscription: subscriptionAddress,
    record: recordValue && {
      // The all-zero address until a wallet buys the server.
      ownerWallet: recordValue.ownerWallet === '11111111111111111111111111111111' ? null : recordValue.ownerWallet,
      treasury: recordValue.treasury,
      priceLamports: recordValue.priceLamports.toString(),
      periodSeconds: recordValue.periodSeconds.toString(),
      enabled: recordValue.enabled,
    },
    paidUntil: subscriptionValue && subscriptionValue.paidUntil.toString(),
  };
}

function instruction(accounts: [Address, AccountRole][], data: ReadonlyUint8Array): Instruction {
  return {
    programAddress,
    accounts: accounts.map(([address, role]) =>
      role === AccountRole.WRITABLE_SIGNER || role === AccountRole.READONLY_SIGNER
        ? { address, role, signer: provider }
        : { address, role },
    ),
    data,
  };
}

function buildInstruction(): Instruction | null {
  switch (command) {
    case 'show':
      return null;
    case 'register':
      return instruction(
        [
          [provider.address, AccountRole.WRITABLE_SIGNER],
          [server, AccountRole.WRITABLE],
          [subscriptionAddress, AccountRole.WRITABLE],
          [systemProgram, AccountRole.READONLY],
        ],
        registerArgs.encode({
          discriminator: discriminator(idl.instructions, 'register_server'),
          serverId,
          treasury: address(required('treasury')),
          priceLamports: positive('price-lamports', 2n ** 64n - 1n),
          periodSeconds: positive('period-seconds', 2n ** 63n - 1n),
        }),
      );
    case 'enable':
    case 'disable':
      return instruction(
        [
          [provider.address, AccountRole.READONLY_SIGNER],
          [server, AccountRole.WRITABLE],
        ],
        setEnabledArgs.encode({
          discriminator: discriminator(idl.instructions, 'set_server_enabled'),
          enabled: command === 'enable',
        }),
      );
    default:
      throw new Error(`unknown command ${command}`);
  }
}

/** Prints nested error messages and program logs from Kit errors. */
function report(error: unknown) {
  for (let cause = error; cause; cause = (cause as { cause?: unknown }).cause) {
    const { message, context } = cause as { message?: string; context?: { logs?: string[] } };
    if (message) console.error(message);
    for (const line of context?.logs ?? []) console.error(`  ${line}`);
  }
}

try {
  const ix = buildInstruction();
  const result = ix && (await client.sendTransaction([ix]));
  const output = { ...(result && { signature: result.context.signature }), ...(await state()) };
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  report(error);
  process.exitCode = 1;
}
