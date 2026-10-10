import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { root } from './vm.ts';
import { gatewayOrigin } from './network.ts';

const prompt = process.argv[2] ?? '';
const url = prompt.match(/http:\/\/127\.0\.0\.2:[0-9]+\/v1\/sessions\/[a-f0-9]{64}/)?.[0];
if (!url) process.exit(1);
assert.equal(new URL(url).origin, gatewayOrigin);
const directory = process.env.SSH_TEST_CASE!;
fs.writeFileSync(path.join(directory, 'url'), url, { mode: 0o600 });
const mode = process.env.SSH_TEST_MODE ?? 'owner';
if (mode === 'hold') { await sleep(120_000); process.exit(1); }
if (mode !== 'unsigned' && !fs.existsSync(path.join(directory, 'proof.json'))) {
  const proof = mode === 'replay'
    ? fs.readFileSync(process.env.SSH_TEST_REPLAY!, 'utf8')
    : execFileSync(path.join(root, 'target/debug/test-services'), ['proof', url, mode], { encoding: 'utf8', timeout: 15_000 });
  fs.writeFileSync(path.join(directory, 'proof.json'), proof, { mode: 0o600 });
  const response = await fetch(url + '/response', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: proof,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 202);
  if (mode === 'duplicate') {
    const duplicate = await fetch(url + '/response', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: proof });
    assert.equal(duplicate.status, 409);
  }
}
process.stdout.write('\n');
