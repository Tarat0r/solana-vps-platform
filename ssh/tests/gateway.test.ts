import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertPortFree, gatewayOrigin, gatewayPort } from './network.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const token = 'gateway-contract-test-token-00000001';
const base = gatewayOrigin;
let service: ChildProcess;

async function request(path: string, method = 'GET', body?: unknown, authenticated = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  for (const port of [gatewayPort, 8899]) await assertPortFree(port);
  service = spawn(root + 'target/debug/test-services', ['serve'], {
    env: { ...process.env, SOLANA_TEST_BIND: '127.0.0.2', SOLANA_TEST_TOKEN: token, SOLANA_TEST_GATEWAY_PORT: String(gatewayPort) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(service.exitCode, null, `fixture process exited; ports ${gatewayPort}/8899 must be free`);
    try {
      assert.equal((await request('/_test/status', 'GET', undefined, true)).status, 200);
      return;
    } catch { await sleep(50); }
  }
  throw new Error('fixture startup timeout');
});

after(async () => {
  if (service && service.exitCode === null) {
    service.kill('SIGTERM');
    await new Promise<void>(resolve => service.once('exit', () => resolve()));
  }
});

test('publication, exact retrieval, authenticated polling, duplicates and cleanup', async () => {
  const session_id = 'ab'.repeat(32);
  const path = '/v1/sessions/' + session_id;
  const challenge = { session_id, challenge_base64: Buffer.from('exact bytes\n').toString('base64'), expires_at: Math.floor(Date.now() / 1000) + 90 };
  assert.equal((await request('/v1/sessions', 'POST', challenge)).status, 401);
  assert.equal((await request('/v1/sessions', 'POST', challenge, true)).status, 201);
  assert.equal((await request('/v1/sessions', 'POST', challenge, true)).status, 409);
  assert.deepEqual(await request(path), { status: 200, body: challenge });
  assert.equal((await request(path + '/response')).status, 401);
  assert.equal((await request(path + '/response', 'GET', undefined, true)).status, 204);
  const proof = { wallet: '1'.repeat(32), signature_base64: Buffer.alloc(64).toString('base64') };
  assert.equal((await request(path + '/response', 'POST', proof)).status, 202);
  assert.equal((await request(path + '/response', 'POST', proof)).status, 409);
  assert.deepEqual(await request(path + '/response', 'GET', undefined, true), { status: 200, body: proof });
  assert.equal((await request(path, 'DELETE', undefined, true)).status, 204);
  assert.equal((await request(path)).status, 404);
});

test('expired publications and expired session retrieval are rejected', async () => {
  const challenge = { session_id: 'cd'.repeat(32), challenge_base64: 'AA==', expires_at: Math.floor(Date.now() / 1000) - 1 };
  assert.equal((await request('/v1/sessions', 'POST', challenge, true)).status, 400);
  challenge.expires_at = Math.floor(Date.now() / 1000) + 1;
  assert.equal((await request('/v1/sessions', 'POST', challenge, true)).status, 201);
  await sleep(1100);
  assert.equal((await request('/v1/sessions/' + challenge.session_id)).status, 410);
});

test('test controls require authentication and reject unknown scenarios', async () => {
  assert.equal((await request('/_test/scenario', 'POST', { scenario: 'disabled' })).status, 401);
  assert.equal((await request('/_test/scenario', 'POST', { scenario: 'unknown' }, true)).status, 400);
  assert.equal((await request('/_test/status')).status, 401);
});
