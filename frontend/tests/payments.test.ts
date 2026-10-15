import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import { parseDashboardConfig } from '../src/billing.ts';
import type { Receipt } from '../src/billing.ts';
import { newPaymentId, pendingKey, PendingStore, reconcile } from '../src/payments.ts';
import type { PendingPayment } from '../src/payments.ts';

const server = address('11111111111111111111111111111112');
const payer = address('SysvarC1ock11111111111111111111111111111111');
const paymentId = 'ab'.repeat(32);
const expected = { server, payer, amount: 100n, paidUntil: 2_000n };
const signed: PendingPayment = { operation: 'renew', paymentId, createdAt: 1, signature: '5'.repeat(88), lastValidBlockHeight: '500' };
const receipt: Receipt = {
  address: address('SysvarRent111111111111111111111111111111111'), server, payer,
  paymentId: new Uint8Array(32).fill(0xab), amount: 100n, paidAt: 1_000n, paidUntil: 2_000n,
};

test('a matching finalized receipt completes the payment', () => {
  assert.deepEqual(reconcile(signed, receipt, expected, null, 0n), { state: 'completed', receipt });
  // A later renewal may have extended the subscription past this receipt.
  assert.equal(reconcile(signed, receipt, { ...expected, paidUntil: 9_000n }, null, 0n).state, 'completed');
});

test('a receipt that does not match is never shown as paid', () => {
  for (const mismatch of [
    { payer: server }, { server: payer }, { amount: 99n }, { paidUntil: 0n }, { paidUntil: 2_001n },
    { paymentId: new Uint8Array(32).fill(0xcd) },
  ]) {
    assert.equal(reconcile(signed, { ...receipt, ...mismatch }, expected, null, 0n).state, 'invalid', JSON.stringify(Object.keys(mismatch)));
  }
});

test('only provably unexecuted payments may be retried', () => {
  const unsigned = { operation: 'purchase', paymentId, createdAt: 1 } as const;
  assert.deepEqual(reconcile(unsigned, null, expected, null, 900n), { state: 'retry', reason: 'unsigned' });
  assert.deepEqual(
    reconcile(signed, null, expected, { err: { InstructionError: [0, { Custom: 6003 }] }, confirmationStatus: 'finalized' }, 0n),
    { state: 'retry', reason: 'failed', error: 'Server is disabled.' },
  );
  assert.deepEqual(reconcile(signed, null, expected, null, 501n), { state: 'retry', reason: 'expired' });
  // Still valid, or landed but not yet finalized: wait instead of paying again.
  assert.deepEqual(reconcile(signed, null, expected, null, 500n), { state: 'pending' });
  for (const confirmationStatus of ['processed', 'confirmed', 'finalized']) {
    assert.deepEqual(reconcile(signed, null, expected, { err: null, confirmationStatus }, 9_999n), { state: 'pending' });
  }
});

test('pending records are scoped to cluster, program, each server, and wallet', () => {
  const listed = { name: 'Server 1', server_id: 'cd'.repeat(32), unix_user: 'ubuntu', ssh_host: 'vps.example.com', ssh_port: 22 };
  const config = parseDashboardConfig({
    cluster: 'devnet', rpc_url: 'https://api.devnet.solana.com', program_id: server, provider_pubkey: payer,
    servers: [listed, { ...listed, name: 'Server 2', server_id: 'ef'.repeat(32) }],
  });
  const [first, second] = config.servers;
  assert.ok(first && second);
  const key = pendingKey(config, first, payer);
  for (const part of ['devnet', server, payer, 'cd'.repeat(32)]) assert.ok(key.includes(part));
  assert.notEqual(key, pendingKey(config, first, server));
  assert.notEqual(key, pendingKey(config, second, payer));
  assert.notEqual(key, pendingKey({ ...config, cluster: 'localnet' }, first, payer));
  const ids = new Set(Array.from({ length: 20 }, newPaymentId));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, /^[a-f0-9]{64}$/);
});

test('the pending store keeps valid records and fails safely', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const store = new PendingStore(storage);
  assert.equal(store.get('key'), null);
  store.set('key', signed);
  assert.deepEqual(store.get('key'), signed);
  store.clear('key');
  assert.equal(store.get('key'), null);
  for (const text of ['not json', JSON.stringify({ ...signed, paymentId: 'short' }), JSON.stringify({ ...signed, operation: 'refund' }), JSON.stringify({ ...signed, lastValidBlockHeight: undefined })]) {
    data.set('key', text);
    assert.equal(store.get('key'), null, text);
  }
  // Without storage there is no recovery record, so a payment must not start.
  assert.throws(() => new PendingStore(undefined).set('key', signed), /unavailable/);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(new PendingStore(broken).get('key'), null);
  assert.throws(() => new PendingStore(broken).set('key', signed), /quota/);
  assert.doesNotThrow(() => new PendingStore(broken).clear('key'));
});
