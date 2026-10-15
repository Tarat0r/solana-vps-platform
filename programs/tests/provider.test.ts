// Runs provider.sh against solana-test-validator with the built program loaded.
// Prerequisite: `anchor build` in programs/.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateKeyPairSigner } from '@solana/kit';

const root = fileURLToPath(new URL('../', import.meta.url));
const program = root + 'target/deploy/billing_access.so';
const idl = JSON.parse(readFileSync(root + '../shared/billing-access/billing_access.json', 'utf8'));
const rpcPort = 18899;
const url = `http://127.0.0.1:${rpcPort}`;
const serverId = 'a1'.repeat(32);
const run = promisify(execFile);
const work = mkdtempSync(join(tmpdir(), 'billing-access-'));
const keypair = join(work, 'provider.json');
let validator: ChildProcess;

function assertPortFree(port: number) {
  return new Promise<void>((resolve, reject) => {
    const server = createServer().once('error', () => reject(new Error(`port ${port} is in use`)));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

// Options in `args` follow the defaults, so they override them.
async function provider(command: string, args: string[] = [], input = '') {
  const defaults = ['--url', url, '--keypair', keypair, '--server-id', serverId];
  const child = spawn(root + 'scripts/provider.sh', [command, ...defaults, ...args]);
  child.stdin.end(input);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => (stdout += chunk));
  child.stderr.on('data', chunk => (stderr += chunk));
  const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
  return { code, stdout, stderr };
}

async function show(args: string[] = []) {
  const result = await provider('show', args);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

before(async () => {
  assert.ok(existsSync(program), 'run `anchor build` in programs/ first');
  for (const port of [rpcPort, rpcPort + 1, 19900, 18001]) await assertPortFree(port);
  validator = spawn('solana-test-validator', [
    '--ledger', join(work, 'ledger'), '--reset', '--quiet', '--bind-address', '127.0.0.1',
    '--rpc-port', String(rpcPort), '--faucet-port', '19900', '--gossip-port', '18001',
    '--dynamic-port-range', '18100-18200', '--upgradeable-program', idl.address, program, 'none',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (let attempt = 0; ; attempt++) {
    assert.equal(validator.exitCode, null, 'solana-test-validator exited');
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      if ((await response.json()).result === 'ok') break;
    } catch { /* not listening yet */ }
    if (attempt > 300) throw new Error('validator startup timeout');
    await sleep(100);
  }
  await run('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '-o', keypair]);
  await run('solana', ['airdrop', '10', keypair, '--url', url, '--commitment', 'confirmed']);
});

after(async () => {
  if (validator && validator.exitCode === null) {
    validator.kill('SIGTERM');
    await new Promise<void>(resolve => validator.once('exit', () => resolve()));
  }
  rmSync(work, { recursive: true, force: true });
});

test('published IDL matches the built program', () => {
  assert.deepEqual(idl, JSON.parse(readFileSync(root + 'target/idl/billing_access.json', 'utf8')));
});

test('register for sale, disable, enable, and reject re-registration', async () => {
  const treasury = (await generateKeyPairSigner()).address;
  const terms = ['--treasury', treasury, '--price-lamports', '1000000', '--period-seconds', '2592000'];

  assert.equal((await show()).record, null);
  const cancelled = await provider('register', terms, 'n\n');
  assert.equal(cancelled.code, 1);
  assert.match(cancelled.stdout, /Cancelled/);
  assert.equal((await show()).record, null);

  const registered = await provider('register', [...terms, '--yes']);
  assert.equal(registered.code, 0, registered.stderr);
  const state = await show();
  assert.deepEqual(state.record, { ownerWallet: null, treasury, priceLamports: '1000000', periodSeconds: '2592000', enabled: true });
  assert.equal(state.paidUntil, '0');
  assert.equal(state.programId, idl.address);

  assert.equal((await provider('disable', ['--yes'])).code, 0);
  assert.equal((await show()).record.enabled, false);
  assert.equal((await provider('enable', [], 'y\n')).code, 0);
  assert.equal((await show()).record.enabled, true);

  const again = await provider('register', [...terms, '--yes']);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already in use/);
});

test('another keypair cannot change the registered server', async () => {
  assert.equal((await show()).record?.enabled, true, 'runs after the registration test');
  const other = join(work, 'other.json');
  await run('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '-o', other]);
  await run('solana', ['airdrop', '1', other, '--url', url, '--commitment', 'confirmed']);
  // The server address derives from the signing key, so another key names no server.
  assert.equal((await show(['--keypair', other])).record, null);
  const result = await provider('disable', ['--keypair', other, '--yes']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /AccountNotInitialized/);
  assert.equal((await show()).record.enabled, true);
});

test('rejects malformed input without sending a transaction', async () => {
  const otherServer = ['--server-id', 'b2'.repeat(32)];
  const treasury = (await generateKeyPairSigner()).address;
  const terms = [...otherServer, '--treasury', treasury, '--price-lamports', '1', '--period-seconds', '1', '--yes'];
  const cases: [string, string[], number, RegExp][] = [
    // Checked by provider.sh before any RPC call.
    ['frobnicate', [], 2, /Usage:/],
    ['show', ['--server-id', 'A1'.repeat(32)], 2, /64 lowercase hex/],
    ['show', ['--server-id', 'a1'], 2, /64 lowercase hex/],
    ['show', ['--keypair', join(work, 'missing.json')], 2, /cannot read provider keypair/],
    ['show', ['--bogus'], 2, /unknown option --bogus/],
    ['register', [...otherServer, '--price-lamports', '1', '--period-seconds', '1', '--yes'], 2, /needs --treasury/],
    ['register', [...terms, '--owner', treasury], 2, /unknown option --owner/],
    ['register', [...terms, '--price-lamports', '0'], 2, /positive integer/],
    ['register', [...terms, '--price-lamports', '1.5'], 2, /positive integer/],
    ['register', [...terms, '--period-seconds', '-5'], 2, /positive integer/],
    // Checked by provider-tx.ts before signing.
    ['register', [...terms, '--price-lamports', String(2n ** 64n)], 1, /--price-lamports is out of range/],
    ['register', [...terms, '--period-seconds', String(2n ** 63n)], 1, /--period-seconds is out of range/],
    ['register', [...terms, '--treasury', 'not-a-key'], 1, /base58-encoded address/],
  ];
  for (const [command, args, code, message] of cases) {
    const result = await provider(command, args);
    assert.equal(result.code, code, `${command} ${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, message);
  }
  assert.equal((await show(otherServer)).record, null);
});
