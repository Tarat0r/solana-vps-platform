import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Console, root, secrets, stateDir } from './vm.ts';
import { gatewayOrigin } from './network.ts';

const gateway = gatewayOrigin;
const cases: string[] = [];
const children = new Set<ChildProcess>();
const results: { name: string; pass: boolean; durationMs: number }[] = [];
let terminal: Console;

async function api(endpoint: string, body?: unknown) {
  const response = await fetch(gateway + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + secrets().token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok, `test API status ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

async function scenario(mode: string) { await api('/_test/scenario', { scenario: mode }); }

function login(mode = 'owner', user = 'ubuntu', extra: string[] = [], replay?: string) {
  const directory = fs.mkdtempSync(path.join(stateDir, 'case-'));
  cases.push(directory);
  const process = spawn('ssh', [
    '-F', '/dev/null', '-T', '-p', '2222', '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile="${path.join(stateDir, 'known_hosts')}"`,
    ...extra,
    '-o', 'PreferredAuthentications=keyboard-interactive', '-o', 'NumberOfPasswordPrompts=1',
    `${user}@127.0.0.2`, 'id -un',
  ], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...globalThis.process.env, SSH_ASKPASS: path.join(root, 'tests/askpass.sh'), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':solana-test', SSH_TEST_CASE: directory, SSH_TEST_MODE: mode, SSH_TEST_REPLAY: replay },
  });
  children.add(process);
  let stdout = ''; let stderr = '';
  process.stdout!.on('data', data => { stdout += data; });
  process.stderr!.on('data', data => { stderr += data; });
  const timeout = setTimeout(() => { try { globalThis.process.kill(-process.pid!, 'SIGKILL'); } catch { /* exited */ } }, 120_000);
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    process.once('error', reject);
    process.once('close', code => { clearTimeout(timeout); children.delete(process); resolve({ code, stdout, stderr: stderr.replace(/https?:\/\/\S+/g, '[redacted URL]') }); });
  });
  return { process, directory, done };
}

async function waitForChallenge(directory: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (fs.existsSync(path.join(directory, 'url'))) return fs.readFileSync(path.join(directory, 'url'), 'utf8');
    await sleep(100);
  }
  throw new Error('OpenSSH did not display the wallet URL');
}

async function waitForCleanup() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await api('/_test/status')).sessions === 0) return;
    await sleep(100);
  }
  const diagnostics = await terminal.command("ps -eo pid,ppid,args | grep '[s]shd'; ss -xnp | grep solana-authd || true; journalctl -u ssh -n 12 --no-pager");
  throw new Error('gateway session was not cleaned up after disconnect/decision\n' + diagnostics);
}

async function deniedWallet(mode = 'owner') {
  const attempt = login(mode);
  const result = await attempt.done;
  assert.ok(fs.existsSync(path.join(attempt.directory, 'proof.json')), 'denial must follow an actual wallet challenge/signature, not a refused connection');
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
}

function check(name: string, fn: () => Promise<void>, timeout = 140_000) {
  test(name, { timeout }, async () => {
    const start = Date.now();
    try { await fn(); results.push({ name, pass: true, durationMs: Date.now() - start }); }
    catch (error) { results.push({ name, pass: false, durationMs: Date.now() - start }); throw error; }
  });
}

before(async () => {
  assert.ok(fs.existsSync(path.join(stateDir, 'ready')), 'run npm run vm -- prepare first');
  terminal = await Console.open();
  terminal.logging = true;
  assert.match(await terminal.command('id -u'), /(?:^|\n)0\n/);
  await scenario('allow');
});

after(async () => {
  for (const child of children) { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* exited */ } }
  if (terminal) {
    try { await terminal.command('systemctl start solana-test-services solana-authd'); await scenario('allow'); } finally { terminal.close(); }
  }
  fs.writeFileSync(path.join(stateDir, 'report.json'), JSON.stringify({ timestamp: new Date().toISOString(), environment: 'Debian 13 QEMU; synthetic RPC/gateway', endpoint: '127.0.0.2:2222', results }, null, 2));
  for (const directory of cases) fs.rmSync(directory, { recursive: true, force: true });
});

check('paid owner and delegated wallet reach the configured Linux account', async () => {
  for (const mode of ['owner', 'delegate', 'duplicate']) {
    const result = await login(mode).done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'ubuntu');
    await waitForCleanup();
  }
});

check('wallet signatures are bound to the exact challenge, server and account', async () => {
  for (const mode of ['bad-signature', 'wrong-user', 'wrong-server', 'outsider']) {
    await deniedWallet(mode);
  }
});

check('a consumed signature cannot authenticate a new SSH connection', async () => {
  const first = login();
  assert.equal((await first.done).code, 0);
  const second = login('replay', 'ubuntu', [], path.join(first.directory, 'proof.json'));
  assert.notEqual((await second.done).code, 0);
  assert.ok(fs.existsSync(path.join(second.directory, 'proof.json')));
});

check('concurrent logins have independent challenges and decisions', async () => {
  const first = login('owner');
  const second = login('delegate');
  const outcomes = await Promise.all([first.done, second.done]);
  for (const outcome of outcomes) assert.equal(outcome.code, 0, outcome.stderr);
  assert.notEqual(fs.readFileSync(path.join(first.directory, 'url'), 'utf8'), fs.readFileSync(path.join(second.directory, 'url'), 'utf8'));
  await waitForCleanup();
});

for (const mode of ['subscription_expired', 'owner_expired', 'delegate_expired', 'delegate_revoked', 'owner_revoked', 'disabled', 'stale_rpc', 'future_rpc', 'rpc_unavailable', 'wrong_program', 'wrong_discriminator', 'wrong_bump', 'wrong_server', 'wrong_role', 'missing_account', 'stale_context', 'changed_owner']) {
  check(`fail closed: ${mode}`, async () => {
    await scenario(mode);
    try { await deniedWallet('delegate'); }
    finally { await scenario('allow'); }
  });
}

check('fresh renewed fixture state restores access', async () => {
  await scenario('subscription_expired');
  await deniedWallet();
  await scenario('allow');
  assert.equal((await login().done).code, 0);
});

check('wrong Linux account and password/public-key methods cannot bypass PAM', async () => {
  const effective = await terminal.command('sshd -T -C user=ubuntu,host=localhost,addr=127.0.0.1');
  assert.match(effective, /\npasswordauthentication no\n/);
  assert.match(effective, /\npubkeyauthentication no\n/);
  assert.match(effective, /\nauthenticationmethods keyboard-interactive:pam\n/);
  for (const [user, method] of [['root', 'keyboard-interactive'], ['ubuntu', 'password'], ['ubuntu', 'publickey']]) {
    const result = await login('owner', user, ['-o', `PreferredAuthentications=${method}`, '-o', 'BatchMode=yes', '-i', path.join(stateDir, 'bypass_key')]).done;
    assert.notEqual(result.code, 0);
  }
});

check('unprivileged peers and invalid IPC frames are denied', async () => {
  const text = await terminal.command(`if runuser -u ubuntu -- socat - UNIX-CONNECT:/run/solana-authd.sock </dev/null; then exit 1; fi; printf '%s\\n' '{"op":"start","version":99,"unix_user":"ubuntu"}' | socat -t 5 - UNIX-CONNECT:/run/solana-authd.sock`);
  assert.match(text, /"allow":false/);
});

check('disconnect cancels a pending authentication session', async () => {
  for (const mode of ['hold', 'unsigned']) {
    const attempt = login(mode);
    await waitForChallenge(attempt.directory);
    process.kill(-attempt.process.pid!, 'SIGTERM');
    await attempt.done;
    await waitForCleanup();
  }
});

check('daemon restart invalidates pending challenges', async () => {
  const attempt = login('unsigned');
  await waitForChallenge(attempt.directory);
  await terminal.command('systemctl restart solana-authd');
  assert.notEqual((await attempt.done).code, 0);
  assert.equal((await login().done).code, 0);
});

check('gateway and daemon outages deny login; console recovery remains usable', async () => {
  await scenario('gateway_unavailable');
  try { assert.notEqual((await login().done).code, 0); } finally { await scenario('allow'); }
  await terminal.command('systemctl stop solana-authd');
  try {
    assert.notEqual((await login().done).code, 0);
    assert.match(await terminal.command('id -u'), /(?:^|\n)0\n/);
  } finally { await terminal.command('systemctl start solana-authd'); }
  assert.equal((await login().done).code, 0);
});

check('unsigned login expires at the real 90-second deadline', async () => {
  const start = Date.now();
  const result = await login('unsigned').done;
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - start >= 85_000, 'authentication ended before the challenge lifetime');
  assert.ok(Date.now() - start < 110_000, 'authentication exceeded its bounded deadline');
});
