import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { clearPhoneForward, configurePhone, httpsOrigin, walletAddress, monitorCommand, parsePhoneOptions, phoneHost, phoneForward, phoneGuestCommand, phoneOrigin, privateLanAddress, readPhoneProfile } from './phone.ts';

test('phone mode only accepts explicit private LAN addresses and valid ports', () => {
  for (const host of ['192.168.1.9', '10.1.2.3', '172.16.0.1', '172.31.255.254']) assert.equal(privateLanAddress(host), host);
  for (const host of ['127.0.0.1', '0.0.0.0', '8.8.8.8', '172.32.0.1', '192.168.1.999', '192.168.1.09', 'localhost', '192.168.1.9;id']) {
    assert.throws(() => privateLanAddress(host), /private IPv4/);
  }
  assert.deepEqual(parsePhoneOptions(['--host', '192.168.1.9'], 18080), { host: '192.168.1.9', port: 18080 });
  // Desktop extensions need exactly 127.0.0.1; other loopback addresses stay rejected.
  assert.equal(phoneHost('127.0.0.1'), '127.0.0.1');
  for (const host of ['127.0.0.2', 'localhost', '0.0.0.0']) assert.throws(() => phoneHost(host), /private IPv4/);
  const desktop = { host: '127.0.0.1', port: 18080, wallet: '1'.repeat(32) };
  assert.equal(phoneOrigin(desktop), 'http://127.0.0.1:18080');
  assert.equal(phoneForward(desktop), 'tcp:127.0.0.1:18080-:8080');
  assert.ok(!phoneGuestCommand(desktop).includes('SOLANA_TEST_LAN_HTTP=1'));
  assert.deepEqual(parsePhoneOptions(['--port', '18081', '--host', '192.168.1.9'], 18080), { host: '192.168.1.9', port: 18081 });
  for (const args of [[], ['--host'], ['--host', '192.168.1.9', '--port', '0'], ['--host', '192.168.1.9', '--port', '1023'], ['--host', '192.168.1.9', '--port', '65536'], ['--host', '192.168.1.9', '--host', '192.168.1.8'], ['--unknown', 'value']]) {
    assert.throws(() => parsePhoneOptions(args, 18080));
  }
});

test('saved phone profiles restore the exact origin and forwarding rule', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-phone-profile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(readPhoneProfile(directory), null);
  const profile = { host: '192.168.1.9', port: 18080, wallet: '1'.repeat(32) };
  fs.writeFileSync(path.join(directory, 'phone.json'), JSON.stringify(profile));
  assert.deepEqual(readPhoneProfile(directory), profile);
  assert.equal(phoneOrigin(profile), 'http://192.168.1.9:18080');
  assert.equal(phoneForward(profile), 'tcp:192.168.1.9:18080-:8080');
  const command = phoneGuestCommand(profile);
  assert.ok(command.includes('SOLANA_TEST_LAN_HTTP=1'));
  assert.ok(command.includes('SOLANA_TEST_PHONE_WALLET=' + profile.wallet));
  assert.ok(command.includes('umask 077'));
  assert.ok(command.includes('$SOLANA_TEST_TOKEN'));
  assert.ok(!phoneGuestCommand(null).includes('SOLANA_TEST_LAN_HTTP=1'));
  fs.writeFileSync(path.join(directory, 'phone.json'), JSON.stringify({ ...profile, host: '8.8.8.8' }));
  assert.throws(() => readPhoneProfile(directory), /private IPv4/);
});

test('QMP forwarding handles fragmented replies, errors, and cleanup', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-phone-qmp-'));
  const socketPath = path.join(directory, 'qmp.sock');
  const commands: string[] = [];
  const server = createServer(socket => {
    socket.write('{"QMP":{"version":{}}}\n');
    let buffer = '';
    socket.on('data', bytes => {
      buffer += bytes.toString();
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        const command = request.arguments?.['command-line'];
        if (command) commands.push(command);
        const response = JSON.stringify(command === 'fail'
          ? { id: request.id, error: { desc: 'test monitor failure' } }
          : { id: request.id, return: command?.startsWith('hostfwd_remove') ? `host forwarding rule for ${command.split(' ')[2]} removed\r\n` : command ? '' : {} }) + '\n';
        socket.write(response.slice(0, 5));
        socket.write(response.slice(5));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(await monitorCommand(socketPath, 'hostfwd_add net0 tcp:192.168.1.9:18080-:8080'), '');
  await assert.rejects(monitorCommand(socketPath, 'fail'), /test monitor failure/);
  fs.writeFileSync(path.join(directory, 'phone.json'), JSON.stringify({ host: '192.168.1.9', port: 18080, wallet: '1'.repeat(32) }));
  await clearPhoneForward(directory, socketPath);
  assert.equal(readPhoneProfile(directory), null);
  assert.ok(commands.includes('hostfwd_remove net0 tcp:192.168.1.9:18080'));
});

test('HTTPS tunnel origins are exact, need no LAN forward, and disable LAN HTTP', async t => {
  const origin = 'https://quiet-river-1234.trycloudflare.com';
  assert.equal(httpsOrigin(origin), origin);
  for (const value of ['http://quiet.example.com', 'https://quiet.example.com/', 'https://quiet.example.com/path', 'https://user@quiet.example.com',
    'https://quiet.example.com?x=1', 'https://192.168.1.9', 'https://localhost', 'https://quiet.example.com:8443x', "https://a.example.com';id"]) {
    assert.throws(() => httpsOrigin(value), /exact HTTPS origin/);
  }
  assert.deepEqual(parsePhoneOptions(['--origin', origin], 18080), { origin });
  for (const args of [['--origin', origin, '--host', '192.168.1.9'], ['--port', '18081', '--origin', origin], ['--origin', origin, '--origin', origin]]) {
    assert.throws(() => parsePhoneOptions(args, 18080));
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-phone-origin-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const profile = { origin, wallet: '1'.repeat(32) };
  fs.writeFileSync(path.join(directory, 'phone.json'), JSON.stringify(profile));
  assert.deepEqual(readPhoneProfile(directory), profile);
  assert.equal(phoneOrigin(profile), origin);
  const command = phoneGuestCommand(profile);
  assert.ok(command.includes('SOLANA_TEST_AUTH_ORIGIN=' + origin));
  assert.ok(!command.includes('SOLANA_TEST_LAN_HTTP=1'));
  // No QEMU monitor is contacted: the socket path does not exist.
  await clearPhoneForward(directory, path.join(directory, 'missing.sock'));
  assert.equal(readPhoneProfile(directory), null);
});

test('an existing wallet address can replace the generated test keypair', () => {
  const wallet = '4ExbpHoDSDrv4Fg57B3tp64rddh5QM5v7ZCerFXh6CHu';
  assert.equal(walletAddress(wallet), wallet);
  assert.equal(walletAddress('1'.repeat(32)), '1'.repeat(32));
  for (const value of ['', '0'.repeat(32), wallet.slice(0, -1), wallet + '1', 'abc', wallet.replace('E', 'O')]) assert.throws(() => walletAddress(value), /base58 Solana address/);
  assert.deepEqual(parsePhoneOptions(['--host', '127.0.0.1', '--wallet', wallet], 18080), { host: '127.0.0.1', port: 18080, wallet });
  assert.deepEqual(parsePhoneOptions(['--wallet', wallet, '--origin', 'https://a.lhr.life'], 18080), { origin: 'https://a.lhr.life', wallet });
  assert.deepEqual(parsePhoneOptions(['--host', '127.0.0.1'], 18080), { host: '127.0.0.1', port: 18080 });
  for (const args of [['--wallet', wallet], ['--host', '127.0.0.1', '--wallet', 'bad'], ['--host', '127.0.0.1', '--wallet', wallet, '--wallet', wallet]]) {
    assert.throws(() => parsePhoneOptions(args, 18080));
  }
});

/** A QEMU monitor double that answers hostfwd commands as real QEMU does. */
async function fakeQmp(directory: string, failAdd = false) {
  const socketPath = path.join(directory, 'qmp.sock');
  const commands: string[] = [];
  const server = createServer(socket => {
    socket.write('{"QMP":{"version":{}}}\n');
    let buffer = '';
    socket.on('data', bytes => {
      buffer += bytes.toString();
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        const command: string | undefined = request.arguments?.['command-line'];
        if (command) commands.push(command);
        const reply = !command ? {}
          : command.startsWith('hostfwd_remove') ? `host forwarding rule for ${command.split(' ')[2]} removed\r\n`
          : failAdd ? 'Could not set up host forwarding rule\r\n' : '';
        socket.write(JSON.stringify({ id: request.id, return: reply }) + '\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  return { socketPath, commands, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

function fakeGuest(failConfigure = false) {
  const commands: string[] = [];
  return {
    commands,
    command: async (command: string) => {
      commands.push(command);
      if (failConfigure && command.includes('SOLANA_TEST_PHONE_WALLET')) throw new Error('guest restart failed');
      return '';
    },
  };
}

test('phone mode switches forwards, guest origin, and saved profile together', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-phone-switch-'));
  const qmp = await fakeQmp(directory);
  t.after(async () => { await qmp.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const wallet = '1'.repeat(32);
  const configure = (options: Parameters<typeof configurePhone>[4], guest = fakeGuest()) =>
    configurePhone(directory, directory, qmp.socketPath, guest, options).then(profile => ({ profile, guest }));

  const first = await configure({ host: '127.0.0.1', port: 18080, wallet });
  assert.deepEqual(qmp.commands, ['hostfwd_add net0 tcp:127.0.0.1:18080-:8080']);
  const [ready = '', environment = ''] = first.guest.commands;
  assert.match(ready, /phone-ready/);
  assert.match(environment, /SOLANA_TEST_AUTH_ORIGIN=http:\/\/127\.0\.0\.1:18080/);
  assert.ok(!environment.includes('SOLANA_TEST_LAN_HTTP=1'));
  assert.deepEqual(readPhoneProfile(directory), first.profile);

  qmp.commands.length = 0;
  await configure({ host: '127.0.0.1', port: 18080, wallet });
  assert.deepEqual(qmp.commands, [], 'an unchanged forward is reused');

  await configure({ host: '192.168.1.9', port: 18081, wallet });
  assert.deepEqual(qmp.commands, ['hostfwd_add net0 tcp:192.168.1.9:18081-:8080', 'hostfwd_remove net0 tcp:127.0.0.1:18080'],
    'the new forward is added before the old one is removed');

  qmp.commands.length = 0;
  const https = await configure({ origin: 'https://a.lhr.life', wallet });
  assert.deepEqual(qmp.commands, ['hostfwd_remove net0 tcp:192.168.1.9:18081']);
  assert.ok(!(https.guest.commands[1] ?? '').includes('SOLANA_TEST_LAN_HTTP=1'));
  assert.deepEqual(readPhoneProfile(directory), { origin: 'https://a.lhr.life', wallet });
});

test('failed phone changes keep the previous profile and remove partial forwards', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-phone-fail-'));
  const qmp = await fakeQmp(directory);
  t.after(async () => { await qmp.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const wallet = '1'.repeat(32);
  const previous = { host: '127.0.0.1', port: 18080, wallet };
  fs.writeFileSync(path.join(directory, 'phone.json'), JSON.stringify(previous));

  await assert.rejects(configurePhone(directory, directory, qmp.socketPath, fakeGuest(true), { host: '192.168.1.9', port: 18081, wallet }), /guest restart failed/);
  assert.deepEqual(qmp.commands, ['hostfwd_add net0 tcp:192.168.1.9:18081-:8080', 'hostfwd_remove net0 tcp:192.168.1.9:18081'],
    'only the new forward is rolled back');
  assert.deepEqual(readPhoneProfile(directory), previous);

  fs.writeFileSync(path.join(directory, 'pipeline.lock'), '1\n');
  const locked = fakeGuest();
  await assert.rejects(configurePhone(directory, directory, qmp.socketPath, locked, { host: '192.168.1.9', port: 18081, wallet }), /active test pipeline/);
  assert.deepEqual(locked.commands, []);
});

test('an occupied phone port is reported without touching the guest', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-phone-busy-'));
  const qmp = await fakeQmp(directory, true);
  t.after(async () => { await qmp.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const guest = fakeGuest();
  await assert.rejects(configurePhone(directory, directory, qmp.socketPath, guest, { host: '127.0.0.1', port: 18080, wallet: '1'.repeat(32) }), /Choose another --port/);
  assert.equal(guest.commands.length, 1, 'only the readiness check ran');
  assert.equal(readPhoneProfile(directory), null);
});
