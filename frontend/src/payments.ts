// Pending-payment recovery (Architecture.md, "Payments and recovery"). Browser
// storage only remembers what was attempted; finalized receipts decide the outcome.
import type { Address } from '@solana/kit';
import type { DashboardConfig, Receipt, ServerConfig, SignatureStatus, SolanaRpc } from './billing.ts';
import { describeError, finalizedBlockHeight, loadReceiptSnapshot, signatureStatus } from './billing.ts';

export type PaymentOperation = 'purchase' | 'renew';

export interface PendingPayment {
  operation: PaymentOperation;
  paymentId: string;
  createdAt: number;
  /** Set once the wallet has signed, before the transaction is sent. */
  signature?: string;
  lastValidBlockHeight?: string;
}

export type Reconciliation =
  | { state: 'completed'; receipt: Receipt }
  | { state: 'pending' }
  | { state: 'retry'; reason: 'unsigned' | 'expired' | 'failed'; error?: string }
  | { state: 'invalid' };

export function newPaymentId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function pendingKey(config: DashboardConfig, server: ServerConfig, wallet: Address): string {
  return ['wallet-ssh:pending-payment', config.cluster, config.programId, config.provider, server.serverId, wallet].join(':');
}

function parsePending(text: string | null): PendingPayment | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as PendingPayment;
    const valid = ['purchase', 'renew'].includes(value.operation) && /^[a-f0-9]{64}$/.test(value.paymentId)
      && Number.isSafeInteger(value.createdAt)
      && (value.signature === undefined || (typeof value.signature === 'string' && /^[0-9]+$/.test(value.lastValidBlockHeight ?? '')));
    return valid ? value : null;
  } catch { return null; }
}

/** Per wallet/server storage that tolerates disabled or full browser storage. */
export class PendingStore {
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined) {
    this.storage = storage;
  }

  get(key: string): PendingPayment | null {
    try { return parsePending(this.storage?.getItem(key) ?? null); } catch { return null; }
  }

  /** Throws when the record cannot be kept: never pay without a recovery record. */
  set(key: string, pending: PendingPayment): void {
    if (!this.storage) throw new Error('Browser storage is unavailable, so payments cannot be recovered.');
    this.storage.setItem(key, JSON.stringify(pending));
  }

  clear(key: string): void {
    try { this.storage?.removeItem(key); } catch { /* Nothing to keep. */ }
  }
}

/**
 * Decides what a pending payment's chain state means:
 * a finalized receipt completes it; a transaction that failed, expired unexecuted,
 * or was never signed may be retried with the same payment ID; anything else waits.
 */
export function reconcile(
  pending: PendingPayment,
  receipt: Receipt | null,
  expected: { server: Address; payer: Address; amount: bigint; paidUntil: bigint },
  status: SignatureStatus | null,
  finalizedHeight: bigint,
): Reconciliation {
  if (receipt) {
    const matches = receipt.server === expected.server && receipt.payer === expected.payer
      && receipt.amount === expected.amount && receipt.paidUntil > 0n && receipt.paidUntil <= expected.paidUntil
      && Array.from(receipt.paymentId, byte => byte.toString(16).padStart(2, '0')).join('') === pending.paymentId;
    return matches ? { state: 'completed', receipt } : { state: 'invalid' };
  }
  if (!pending.signature) return { state: 'retry', reason: 'unsigned' };
  if (status?.err) return { state: 'retry', reason: 'failed', error: describeError(status.err) };
  if (status) return { state: 'pending' };
  return finalizedHeight > BigInt(pending.lastValidBlockHeight ?? '0')
    ? { state: 'retry', reason: 'expired' }
    : { state: 'pending' };
}

/**
 * Reads chain state for a pending payment. The block height is read first: a
 * transaction absent after its blockhash expired at that height can never land.
 */
export async function checkPending(
  rpc: SolanaRpc,
  accounts: { programId: Address; server: Address; subscription: Address; payer: Address; amount: bigint },
  pending: PendingPayment,
): Promise<Reconciliation> {
  const height = await finalizedBlockHeight(rpc);
  const status = pending.signature ? await signatureStatus(rpc, pending.signature) : null;
  const { receipt, paidUntil } = await loadReceiptSnapshot(rpc, accounts.programId, accounts, pending.paymentId);
  return reconcile(pending, receipt, { ...accounts, paidUntil }, status, height);
}
