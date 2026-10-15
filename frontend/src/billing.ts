// Billing/access program client for the owner dashboard. Layouts, discriminators,
// and account order follow shared/billing-access/billing_access.json.
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  fixDecoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getBase16Decoder,
  getBase16Encoder,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getBooleanDecoder,
  getBytesDecoder,
  getI64Decoder,
  getI64Encoder,
  getProgramDerivedAddress,
  getStructDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getU64Decoder,
  getU8Decoder,
  isAddress,
  isSolanaError,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
  type Address,
  type Base58EncodedBytes,
  type Base64EncodedWireTransaction,
  type Decoder,
  type Instruction,
  type RequestAirdropApi,
  type Rpc,
  type TransactionMessageBytesBase64,
} from '@solana/kit';

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export interface ServerConfig {
  name: string;
  serverId: string;
  unixUser: string;
  sshHost: string;
  sshPort: number;
}

export interface DashboardConfig {
  cluster: string;
  rpcUrl: string;
  programId: Address;
  provider: Address;
  servers: ServerConfig[];
}

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

export const INSTRUCTION_DISCRIMINATORS = {
  purchase_access: [191, 249, 111, 210, 163, 248, 87, 242],
  renew_access: [108, 62, 17, 200, 135, 248, 90, 179],
  grant_delegated_access: [124, 21, 33, 241, 116, 126, 210, 115],
  revoke_delegated_access: [179, 174, 2, 234, 5, 124, 204, 197],
} as const;

export const ACCOUNT_DISCRIMINATORS = {
  ServerRecord: [58, 83, 56, 172, 64, 197, 151, 130],
  Subscription: [64, 7, 26, 135, 102, 132, 98, 33],
  AccessGrant: [167, 55, 184, 237, 74, 242, 0, 109],
  PaymentReceipt: [168, 198, 209, 4, 60, 235, 126, 109],
} as const;

export const PROGRAM_ERRORS: Record<number, string> = {
  6000: 'Price and period must be positive',
  6001: 'Signer is not authorized for this server',
  6002: 'Treasury does not match the server record',
  6003: 'Server is disabled',
  6004: 'Server is owned by another wallet until its subscription expires',
  6005: 'Owner subscription or grant is inactive or expired',
  6006: 'Delegation instructions cannot change the owner grant',
  6007: 'Delegated expiry must be in the future and within the subscription term',
  6008: 'Arithmetic overflow',
};

/** `ownerWallet` of a registered server that no wallet has bought yet. */
export const NO_OWNER = address('11111111111111111111111111111111');

/** Validates the gateway's dashboard settings; mirrors backend/src/dashboard.rs. */
export function parseDashboardConfig(input: unknown): DashboardConfig {
  const invalid = (): never => { throw new Error('The dashboard configuration is invalid.'); };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const object = (item: unknown, fields: string[]) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return invalid();
    if (Object.keys(item).sort().join(',') !== fields.join(',')) return invalid();
    const record = item as Record<string, unknown>;
    const text = (field: string) => {
      const entry = record[field];
      return typeof entry === 'string' ? entry : invalid();
    };
    return { record, text };
  };
  const { text } = object(value, ['cluster', 'program_id', 'provider_pubkey', 'rpc_url', 'servers']);
  const cluster = text('cluster');
  let rpc: URL;
  try { rpc = new URL(text('rpc_url')); } catch { return invalid(); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(rpc.hostname);
  if (!['localnet', 'devnet', 'testnet', 'mainnet-beta'].includes(cluster)
    || !isAddress(text('program_id')) || !isAddress(text('provider_pubkey'))
    || rpc.username || rpc.password
    || !(rpc.protocol === 'https:' || (rpc.protocol === 'http:' && loopback && cluster === 'localnet'))
    || !Array.isArray(value.servers) || value.servers.length < 1 || value.servers.length > 16) return invalid();
  const servers = (value.servers as unknown[]).map(item => {
    const { record, text } = object(item, ['name', 'server_id', 'ssh_host', 'ssh_port', 'unix_user']);
    const name = text('name');
    // eslint-disable-next-line no-control-regex -- rejects control characters in displayed names
    if (name.length < 1 || [...name].length > 64 || name.trim() !== name || /[\u0000-\u001f\u007f]/.test(name)
      || !/^[a-f0-9]{64}$/.test(text('server_id'))
      || !/^[a-zA-Z0-9_-]{1,32}$/.test(text('unix_user')) || record.unix_user === 'root'
      || !/^[A-Za-z0-9.:][A-Za-z0-9.:-]{0,252}$/.test(text('ssh_host'))
      || !Number.isInteger(record.ssh_port) || (record.ssh_port as number) < 1 || (record.ssh_port as number) > 65535) return invalid();
    return { name, serverId: text('server_id'), unixUser: text('unix_user'), sshHost: text('ssh_host'), sshPort: record.ssh_port as number };
  });
  if (new Set(servers.map(server => server.serverId)).size !== servers.length) return invalid();
  return { cluster, rpcUrl: rpc.href, programId: address(text('program_id')), provider: address(text('provider_pubkey')), servers };
}

/** Returns null when the gateway has no dashboard configured. */
export async function loadDashboardConfig(signal: AbortSignal): Promise<DashboardConfig | null> {
  const response = await fetch('/v1/dashboard', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('The dashboard configuration could not be loaded.');
  return parseDashboardConfig(await response.json());
}

export function sshCommand(server: ServerConfig): string {
  return `ssh ${server.sshPort === 22 ? '' : `-p ${server.sshPort} `}${server.unixUser}@${server.sshHost}`;
}

const bytes = (size: number) => fixDecoderSize(getBytesDecoder(), size);
const decoders = {
  ServerRecord: getStructDecoder([
    ['discriminator', bytes(8)], ['provider', getAddressDecoder()], ['serverId', bytes(32)],
    ['ownerWallet', getAddressDecoder()], ['treasury', getAddressDecoder()], ['priceLamports', getU64Decoder()],
    ['periodSeconds', getI64Decoder()], ['enabled', getBooleanDecoder()], ['bump', getU8Decoder()],
  ]),
  Subscription: getStructDecoder([
    ['discriminator', bytes(8)], ['server', getAddressDecoder()], ['ownerWallet', getAddressDecoder()],
    ['paidUntil', getI64Decoder()], ['bump', getU8Decoder()],
  ]),
  AccessGrant: getStructDecoder([
    ['discriminator', bytes(8)], ['server', getAddressDecoder()], ['wallet', getAddressDecoder()],
    ['grantType', getU8Decoder()], ['active', getBooleanDecoder()], ['validUntil', getI64Decoder()], ['bump', getU8Decoder()],
  ]),
  PaymentReceipt: getStructDecoder([
    ['discriminator', bytes(8)], ['server', getAddressDecoder()], ['payer', getAddressDecoder()], ['paymentId', bytes(32)],
    ['amount', getU64Decoder()], ['paidAt', getI64Decoder()], ['paidUntil', getI64Decoder()], ['bump', getU8Decoder()],
  ]),
};
type Decoded<T> = T extends Decoder<infer U> ? Omit<U, 'discriminator' | 'bump'> : never;
export type ServerRecord = Decoded<typeof decoders.ServerRecord>;
export type Subscription = Decoded<typeof decoders.Subscription>;
export type AccessGrant = Decoded<typeof decoders.AccessGrant>;
export type PaymentReceipt = Decoded<typeof decoders.PaymentReceipt>;
export type AccountKind = keyof typeof decoders;
export const ACCOUNT_SIZES = {
  ServerRecord: decoders.ServerRecord.fixedSize,
  Subscription: decoders.Subscription.fixedSize,
  AccessGrant: decoders.AccessGrant.fixedSize,
  PaymentReceipt: decoders.PaymentReceipt.fixedSize,
};

/** Decodes a program account after checking its owner, discriminator, and exact size. */
export function decodeAccount<K extends keyof typeof decoders>(
  kind: K, owner: string, data: Uint8Array, programId: Address,
): Decoded<(typeof decoders)[K]> {
  const discriminator = ACCOUNT_DISCRIMINATORS[kind];
  if (owner !== programId || data.length !== ACCOUNT_SIZES[kind] || discriminator.some((byte, index) => data[index] !== byte)) {
    throw new Error(`Unexpected ${kind} account data.`);
  }
  const { discriminator: _, bump: __, ...fields } = decoders[kind].decode(data) as Record<string, unknown>;
  return fields as Decoded<(typeof decoders)[K]>;
}

const addressBytes = (value: Address) => getAddressEncoder().encode(value);

export async function serverAddresses(config: DashboardConfig, target: ServerConfig) {
  const [server] = await getProgramDerivedAddress({
    programAddress: config.programId, seeds: ['server', addressBytes(config.provider), getBase16Encoder().encode(target.serverId)],
  });
  const [subscription] = await getProgramDerivedAddress({ programAddress: config.programId, seeds: ['subscription', addressBytes(server)] });
  return { server, subscription };
}

export async function grantAddress(programId: Address, server: Address, wallet: Address): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress: programId, seeds: ['grant', addressBytes(server), addressBytes(wallet)] }))[0];
}

export async function receiptAddress(programId: Address, server: Address, paymentId: string): Promise<Address> {
  const seeds = ['payment', addressBytes(server), getBase16Encoder().encode(paymentId)];
  return (await getProgramDerivedAddress({ programAddress: programId, seeds }))[0];
}

function instruction(programId: Address, accounts: [Address, AccountRole][], parts: ArrayLike<number>[]): Instruction {
  const data = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  parts.reduce((offset, part) => { data.set(part, offset); return offset + part.length; }, 0);
  return { programAddress: programId, accounts: accounts.map(([address, role]) => ({ address, role })), data };
}

export interface OwnerAccounts {
  programId: Address;
  owner: Address;
  server: Address;
  subscription: Address;
  ownerGrant: Address;
}

export function paymentInstruction(
  kind: 'purchase' | 'renew', accounts: OwnerAccounts & { receipt: Address; treasury: Address }, paymentId: string,
): Instruction {
  return instruction(accounts.programId, [
    [accounts.owner, AccountRole.WRITABLE_SIGNER],
    // A purchase records its buyer as the server's owner.
    [accounts.server, kind === 'purchase' ? AccountRole.WRITABLE : AccountRole.READONLY],
    [accounts.subscription, AccountRole.WRITABLE],
    [accounts.ownerGrant, AccountRole.WRITABLE],
    [accounts.receipt, AccountRole.WRITABLE],
    [accounts.treasury, AccountRole.WRITABLE],
    [SYSTEM_PROGRAM, AccountRole.READONLY],
  ], [INSTRUCTION_DISCRIMINATORS[kind === 'purchase' ? 'purchase_access' : 'renew_access'], getBase16Encoder().encode(paymentId)]);
}

export function grantInstruction(accounts: OwnerAccounts & { grant: Address }, wallet: Address, validUntil: bigint): Instruction {
  return instruction(accounts.programId, [
    [accounts.owner, AccountRole.WRITABLE_SIGNER],
    [accounts.server, AccountRole.READONLY],
    [accounts.subscription, AccountRole.READONLY],
    [accounts.ownerGrant, AccountRole.READONLY],
    [accounts.grant, AccountRole.WRITABLE],
    [SYSTEM_PROGRAM, AccountRole.READONLY],
  ], [INSTRUCTION_DISCRIMINATORS.grant_delegated_access, addressBytes(wallet), getI64Encoder().encode(validUntil)]);
}

export function revokeInstruction(accounts: OwnerAccounts & { grant: Address }, wallet: Address): Instruction {
  return instruction(accounts.programId, [
    [accounts.owner, AccountRole.READONLY_SIGNER],
    [accounts.server, AccountRole.READONLY],
    [accounts.subscription, AccountRole.READONLY],
    [accounts.ownerGrant, AccountRole.READONLY],
    [accounts.grant, AccountRole.WRITABLE],
  ], [INSTRUCTION_DISCRIMINATORS.revoke_delegated_access, addressBytes(wallet)]);
}

export interface Grant extends AccessGrant { address: Address }
export interface Receipt extends PaymentReceipt { address: Address }

export interface ServerState {
  server: Address;
  subscription: Address;
  record: ServerRecord;
  paidUntil: bigint;
  ownerGrant: Grant | null;
  /** Active, unexpired delegated grants; grants a previous owner made are left out. */
  delegates: Grant[];
}

/** Any wallet may buy a server nobody owns, or one whose subscription has expired. */
export function isForSale(state: ServerState, now: bigint): boolean {
  return state.record.ownerWallet === NO_OWNER || state.paidUntil <= now;
}

const base64Bytes = (data: readonly [string, string]) => new Uint8Array(getBase64Encoder().encode(data[0]));
const memcmp = (offset: number, value: ArrayLike<number>) => ({
  memcmp: { offset: BigInt(offset), bytes: getBase58Decoder().decode(Uint8Array.from(value)) as Base58EncodedBytes, encoding: 'base58' as const },
});

async function programAccounts<K extends 'AccessGrant' | 'PaymentReceipt'>(
  rpc: SolanaRpc, programId: Address, kind: K, filters: ReturnType<typeof memcmp>[],
) {
  const accounts = await rpc.getProgramAccounts(programId, {
    commitment: 'finalized', encoding: 'base64',
    filters: [{ dataSize: BigInt(ACCOUNT_SIZES[kind]) }, memcmp(0, ACCOUNT_DISCRIMINATORS[kind]), ...filters],
  }).send();
  return accounts.map(({ pubkey, account }) => ({
    address: pubkey, ...decodeAccount(kind, account.owner, base64Bytes(account.data), programId),
  }));
}

/** Finalized server, subscription, and grant state; null when the server is not registered. */
export async function loadServerState(
  rpc: SolanaRpc, config: DashboardConfig, target: ServerConfig, now = BigInt(Math.floor(Date.now() / 1000)),
): Promise<ServerState | null> {
  const { server, subscription } = await serverAddresses(config, target);
  const { value } = await rpc.getMultipleAccounts([server, subscription], { commitment: 'finalized', encoding: 'base64' }).send();
  if (!value[0] || !value[1]) return null;
  const record = decodeAccount('ServerRecord', value[0].owner, base64Bytes(value[0].data), config.programId);
  const sub = decodeAccount('Subscription', value[1].owner, base64Bytes(value[1].data), config.programId);
  if (record.provider !== config.provider || getBase16Decoder().decode(record.serverId) !== target.serverId
    || sub.server !== server || sub.ownerWallet !== record.ownerWallet) throw new Error('Server accounts do not match the configuration.');
  const grants = (await programAccounts(rpc, config.programId, 'AccessGrant', [memcmp(8, addressBytes(server))]) as Grant[])
    .filter(grant => grant.server === server);
  const ownerGrant = grants.find(grant => grant.wallet === record.ownerWallet && grant.grantType === 0) ?? null;
  const delegates = grants.filter(grant => grant.grantType === 1 && grant.active && grant.validUntil > now)
    .sort((a, b) => Number(b.validUntil - a.validUntil));
  return { server, subscription, record, paidUntil: sub.paidUntil, ownerGrant, delegates };
}

/** Finalized receipts paid by `payer` for this server, newest first. */
export async function loadReceipts(rpc: SolanaRpc, programId: Address, server: Address, payer: Address): Promise<Receipt[]> {
  const receipts = await programAccounts(rpc, programId, 'PaymentReceipt', [memcmp(8, addressBytes(server)), memcmp(40, addressBytes(payer))]);
  return (receipts as Receipt[]).filter(receipt => receipt.server === server && receipt.payer === payer)
    .sort((a, b) => Number(b.paidAt - a.paidAt));
}

/** A payment's finalized receipt and the subscription term from the same snapshot. */
export async function loadReceiptSnapshot(
  rpc: SolanaRpc, programId: Address, accounts: { server: Address; subscription: Address }, paymentId: string,
): Promise<{ receipt: Receipt | null; paidUntil: bigint }> {
  const receipt = await receiptAddress(programId, accounts.server, paymentId);
  const { value: [receiptAccount = null, subscriptionAccount] } = await rpc.getMultipleAccounts([receipt, accounts.subscription], { commitment: 'finalized', encoding: 'base64' }).send();
  if (!subscriptionAccount) throw new Error('The subscription account is missing.');
  const { paidUntil } = decodeAccount('Subscription', subscriptionAccount.owner, base64Bytes(subscriptionAccount.data), programId);
  return {
    receipt: receiptAccount && { address: receipt, ...decodeAccount('PaymentReceipt', receiptAccount.owner, base64Bytes(receiptAccount.data), programId) },
    paidUntil,
  };
}

/** Builds an unsigned version-0 transaction for a wallet to sign. */
export async function unsignedTransaction(rpc: SolanaRpc, feePayer: Address, ix: Instruction) {
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const transaction = compileTransaction(pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayer(feePayer, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(lifetime, tx),
    tx => appendTransactionMessageInstruction(ix, tx),
  ));
  return {
    wire: new Uint8Array(getTransactionEncoder().encode(transaction)),
    message: getBase64Decoder().decode(transaction.messageBytes) as TransactionMessageBytesBase64,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
  };
}

/** SOL a transaction takes from its fee payer's balance. */
export interface TransactionCost {
  /** Transferred to the provider's treasury. */
  price: bigint;
  /** Network fee for the transaction's signatures. */
  fee: bigint;
  /** Rent-exempt balance moved into the accounts the transaction creates. */
  rent: bigint;
  total: bigint;
}

export interface PaidCost extends TransactionCost { signature: string }

const transactionCost = (price: bigint, fee: bigint, rent: bigint): TransactionCost => ({ price, fee, rent, total: price + fee + rent });

/** Solana's base fee for one signature, used when the RPC cannot price a message. */
const SIGNATURE_FEE_LAMPORTS = 5_000n;

/**
 * What `ix` would take from `feePayer`: `price`, the network fee for its message,
 * and rent for each listed account that does not exist yet. `init_if_needed`
 * leaves an existing program account in place, so it costs no rent.
 */
export async function estimateCost(
  rpc: SolanaRpc, programId: Address, feePayer: Address, ix: Instruction, price: bigint, created: [Address, AccountKind][],
): Promise<TransactionCost> {
  const { message } = await unsignedTransaction(rpc, feePayer, ix);
  const [{ value: fee }, { value: existing }, rents] = await Promise.all([
    rpc.getFeeForMessage(message, { commitment: 'confirmed' }).send(),
    rpc.getMultipleAccounts(created.map(([account]) => account), { commitment: 'confirmed', encoding: 'base64' }).send(),
    Promise.all(created.map(([, kind]) => rpc.getMinimumBalanceForRentExemption(BigInt(ACCOUNT_SIZES[kind]), { commitment: 'confirmed' }).send())),
  ]);
  const rent = rents.reduce((sum, value, index) => sum + (existing[index]?.owner === programId ? 0n : value), 0n);
  return transactionCost(price, fee ?? SIGNATURE_FEE_LAMPORTS, rent);
}

/** What a finalized payment took from its payer, read from the transaction that created its receipt. */
export async function paidCost(rpc: SolanaRpc, programId: Address, receipt: Receipt): Promise<PaidCost> {
  // A receipt is written once, so its oldest transaction is the payment.
  const created = (await rpc.getSignaturesForAddress(receipt.address, { commitment: 'finalized' }).send()).at(-1);
  const transaction = created && !created.err ? await rpc.getTransaction(created.signature, {
    commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0,
  }).send() : null;
  const keys = transaction?.transaction.message.accountKeys ?? [];
  // The fee payer is the first account, so its balances come first.
  const [before] = transaction?.meta?.preBalances ?? [];
  const [after] = transaction?.meta?.postBalances ?? [];
  if (!created || !transaction?.meta || before === undefined || after === undefined || keys[0] !== receipt.payer || !keys.includes(programId)) {
    throw new Error('The payment transaction could not be read.');
  }
  const { fee } = transaction.meta;
  const total = before - after;
  return { ...transactionCost(receipt.amount, fee, total - fee - receipt.amount), signature: created.signature };
}

/** A Solana Explorer link for a transaction on the dashboard's cluster. */
export function explorerUrl(config: Pick<DashboardConfig, 'cluster' | 'rpcUrl'>, signature: string): string {
  const url = new URL(`https://explorer.solana.com/tx/${signature}`);
  if (config.cluster === 'localnet') url.search = new URLSearchParams({ cluster: 'custom', customUrl: config.rpcUrl }).toString();
  else if (config.cluster !== 'mainnet-beta') url.searchParams.set('cluster', config.cluster);
  return url.href;
}

/** The fee payer's signature, which identifies the transaction. */
export function transactionSignature(signed: Uint8Array, feePayer: Address): string {
  const signature = getTransactionDecoder().decode(signed).signatures[feePayer];
  if (!signature || signature.every(byte => byte === 0)) throw new Error('The wallet did not sign this transaction.');
  return getBase58Decoder().decode(signature);
}

export async function sendSignedTransaction(rpc: SolanaRpc, signed: Uint8Array): Promise<void> {
  const wire = getBase64Decoder().decode(signed) as Base64EncodedWireTransaction;
  await rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
}

export interface SignatureStatus { err: unknown; confirmationStatus: string | null }

export async function signatureStatus(rpc: SolanaRpc, signature: string): Promise<SignatureStatus | null> {
  const { value: [status] } = await rpc.getSignatureStatuses([signature as Parameters<SolanaRpc['getSignatureStatuses']>[0][number]], { searchTransactionHistory: true }).send();
  return status ? { err: status.err, confirmationStatus: status.confirmationStatus } : null;
}

export async function finalizedBlockHeight(rpc: SolanaRpc): Promise<bigint> {
  return rpc.getBlockHeight({ commitment: 'finalized' }).send();
}

export async function walletBalance(rpc: SolanaRpc, wallet: Address): Promise<bigint> {
  return (await rpc.getBalance(wallet, { commitment: 'confirmed' }).send()).value;
}

/** Test SOL from the cluster's faucet; local and test clusters only. */
export async function requestTestSol(rpc: SolanaRpc, wallet: Address, sol: bigint): Promise<string> {
  // Only offered for localnet, whose RPC serves airdrops; mainnet RPC types omit them.
  return (rpc as Rpc<RequestAirdropApi>).requestAirdrop(wallet, lamports(sol * 1_000_000_000n)).send();
}

/** Upper bound on what a payment needs beyond the price, until `estimateCost` answers. */
export const PAYMENT_OVERHEAD_LAMPORTS = 10_000_000n;

const NOT_ENOUGH_SOL = 'This wallet does not have enough SOL on this network for the payment and its fees.';

/** A readable reason for a failed program transaction or RPC rejection. */
export function describeError(error: unknown): string {
  const logs = (error as { context?: { logs?: unknown } }).context?.logs;
  for (let cause = error; cause; cause = (cause as { cause?: unknown }).cause) {
    const custom = (cause as { context?: { code?: unknown } }).context?.code
      ?? (cause as { InstructionError?: [number, { Custom?: unknown }] }).InstructionError?.[1]?.Custom;
    const code = typeof custom === 'bigint' ? Number(custom) : custom;
    if (typeof code === 'number' && PROGRAM_ERRORS[code]) return `${PROGRAM_ERRORS[code]}.`;
    // Production builds of Kit omit messages, so match on error codes.
    if (isSolanaError(cause, SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND)
      || isSolanaError(cause, SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE)
      || isSolanaError(cause, SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT)) return NOT_ENOUGH_SOL;
    if (isSolanaError(cause, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND)) {
      return 'The transaction expired before it reached Solana, usually because approving it in the wallet took over a minute. Nothing was charged; try again.';
    }
  }
  if (JSON.stringify(error, (_, value: unknown) => typeof value === 'bigint' ? String(value) : value)?.includes('InsufficientFunds')
    || (Array.isArray(logs) && logs.some(line => String(line).includes('insufficient lamports')))
    || String((error as Error)?.message).toLowerCase().includes('insufficient')) {
    return NOT_ENOUGH_SOL;
  }
  if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
    return 'Solana rejected the transaction in simulation, before running it. Nothing was charged.';
  }
  if (isSolanaError(error)) return `Solana returned error ${error.context.__code}.`;
  return error instanceof Error ? error.message : 'The transaction failed.';
}

export function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
}

export function formatPeriod(seconds: bigint): string {
  const days = seconds / 86_400n;
  if (seconds % 86_400n === 0n) return `${days} day${days === 1n ? '' : 's'}`;
  const hours = seconds / 3_600n;
  return seconds % 3_600n === 0n ? `${hours} hour${hours === 1n ? '' : 's'}` : `${seconds} seconds`;
}

/** Waits until `signature` is finalized; throws if it failed or its blockhash expired unexecuted. */
export async function confirmFinalized(rpc: SolanaRpc, signature: string, lastValidBlockHeight: bigint): Promise<void> {
  for (;;) {
    const height = await finalizedBlockHeight(rpc);
    const status = await signatureStatus(rpc, signature);
    if (status?.err) throw new Error(describeError(status.err));
    if (status?.confirmationStatus === 'finalized') return;
    if (!status && height > lastValidBlockHeight) throw new Error('The transaction expired before it was processed. Try again.');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
