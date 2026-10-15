import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { gatewayOrigin, gatewayPort, prepareNetwork, vmHost, vmStateName } from './network.ts';
import { stageFrontend } from './frontend.ts';
import { clearPhoneForward, configurePhone, isLanTarget, monitorCommand, parsePhoneOptions, phoneForward, phoneGuestCommand, phoneOrigin, readPhoneProfile } from './phone.ts';

export const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
export const stateDir = path.join(root, vmStateName);
const runtime = `/tmp/solana-ssh-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(root + vmStateName.slice(3)).digest('hex').slice(0, 12)}`;
const serialPath = path.join(runtime, 'serial.sock');
const qmpPath = path.join(runtime, 'qmp.sock');
const image = path.resolve(root, '../tests/debian-13-nocloud-amd64.qcow2');
const overlay = path.join(stateDir, 'debian-overlay.qcow2');
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function secrets(): { rootPassword: string; token: string } {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, 'secrets.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ rootPassword: randomBytes(24).toString('hex'), token: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export class Console {
  socket: Socket;
  buffer = '';
  closed = false;
  logging = false;
  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', chunk => {
      const text = chunk.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replaceAll('\r', '');
      this.buffer = (this.buffer + text).slice(-2_000_000);
      if (this.logging) fs.appendFileSync(path.join(stateDir, 'serial.log'), text);
    });
    socket.on('close', () => { this.closed = true; });
    socket.on('error', () => { this.closed = true; });
  }

  static async open(): Promise<Console> {
    const socket = connect(serialPath);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    return new Console(socket);
  }

  async expect(pattern: RegExp, timeoutMs = 120_000): Promise<RegExpMatchArray> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = this.buffer.match(pattern);
      if (match) { this.buffer = this.buffer.slice(match.index! + match[0].length); return match; }
      if (this.closed) throw new Error(`VM console disconnected; tail: ${this.buffer.slice(-1000)}`);
      await sleep(100);
    }
    throw new Error(`Console timeout waiting for ${pattern}; tail: ${this.buffer.slice(-1500)}`);
  }

  async login() {
    const password = secrets().rootPassword;
    this.socket.write('\r');
    for (let step = 0; step < 24; step++) {
      const match = await this.expect(/Press any key to proceed|Please enter[^\n]*: |(?:^|\n)[^\n]*login: |Password: |root@[^\n]*[#] |SOLANA_VM# /, 180_000);
      const prompt = match[0];
      if (prompt.includes('Press any key')) { this.socket.write('\r'); continue; }
      if (prompt.includes('root@') || prompt.includes('SOLANA_VM#')) {
        this.socket.write("stty -echo; export PS1='SOLANA_VM# '\r");
        await this.expect(/SOLANA_VM# /);
        this.logging = true;
        return;
      }
      if (/Please enter/i.test(prompt)) {
        globalThis.console.log('First boot: answering ' + prompt.replace(/\n/g, ' ').trim());
        if (/root password/i.test(prompt)) this.socket.write('\t' + password + '\r');
        else if (/hostname/i.test(prompt)) this.socket.write('solana-test\r');
        else if (/locale/i.test(prompt)) this.socket.write('C.UTF-8\r');
        else if (/time.?zone/i.test(prompt)) this.socket.write('UTC\r');
        else this.socket.write('\r');
      } else if (prompt.includes('login:')) { globalThis.console.log('Logging into the recovery console'); this.socket.write('root\r'); }
      else this.socket.write(password + '\r');
    }
    throw new Error('Unable to complete VM console login');
  }

  async command(command: string, timeoutMs = 120_000): Promise<string> {
    this.buffer = '';
    const marker = 'DONE_' + randomBytes(12).toString('hex');
    this.socket.write(`${command}; _solana_status=$?; printf '\\n${marker}:%s\\n' "$_solana_status"\r`);
    const match = await this.expect(new RegExp(`([\\s\\S]*?)\\n${marker}:(\\d+)\\n`), timeoutMs);
    const [, output = '', status] = match;
    if (status !== '0') throw new Error(`Guest command failed (${status}): ${output.slice(-4000)}`);
    return output;
  }

  close() { this.socket.destroy(); }
}

async function up() {
  if (!fs.existsSync(image)) throw new Error(`Missing supplied image: ${image}`);
  secrets();
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  if (fs.existsSync(qmpPath)) {
    try { const socket = connect(qmpPath); await new Promise<void>((r, j) => { socket.once('connect', r); socket.once('error', j); }); socket.destroy(); globalThis.console.log('VM already running'); return; }
    catch { /* a previous VM may have exited */ }
  }
  await prepareNetwork();
  globalThis.console.log(`Gateway: ${gatewayOrigin} (saved in .vm/network.json)`);
  for (const file of [serialPath, qmpPath]) { if (fs.existsSync(file)) fs.unlinkSync(file); }
  if (!fs.existsSync(overlay)) {
    execFileSync('qemu-img', ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', image, overlay], { stdio: 'inherit' });
    execFileSync('qemu-img', ['resize', overlay, '16G'], { stdio: 'inherit' });
  }
  const accel = fs.existsSync('/dev/kvm') ? 'kvm' : 'tcg';
  const phone = readPhoneProfile(stateDir);
  const logfile = fs.openSync(path.join(stateDir, 'qemu.log'), 'a', 0o600);
  const vm = spawn('qemu-system-x86_64', [
    '-accel', accel, '-m', '2048', '-smp', '2',
    '-drive', `file=${overlay},format=qcow2,if=virtio`,
    '-display', 'none', '-monitor', 'none',
    '-chardev', `socket,id=serial0,path=${serialPath},server=on,wait=off`, '-serial', 'chardev:serial0',
    '-qmp', `unix:${qmpPath},server=on,wait=off`,
    '-netdev', `user,id=net0,hostfwd=tcp:${vmHost}:2222-:22,hostfwd=tcp:${vmHost}:${gatewayPort}-:8080,hostfwd=tcp:${vmHost}:8899-:8899${phone && isLanTarget(phone) ? ',hostfwd=' + phoneForward(phone) : ''}`,
    '-device', 'virtio-net-pci,netdev=net0',
    '-fsdev', `local,id=source,path=${root},security_model=none,readonly=on`, '-device', 'virtio-9p-pci,fsdev=source,mount_tag=source',
    '-no-reboot',
  ], { detached: true, stdio: ['ignore', logfile, logfile] });
  fs.closeSync(logfile);
  vm.on('error', error => globalThis.console.error(error.message));
  vm.unref();
  fs.writeFileSync(path.join(stateDir, 'qemu.pid'), String(vm.pid));
  for (let attempt = 0; attempt < 100 && !fs.existsSync(serialPath); attempt++) await sleep(100);
  const console = await Console.open();
  try { await console.login(); await console.command('mkdir -p /mnt/source; mountpoint -q /mnt/source || mount -t 9p -o trans=virtio,version=9p2000.L,ro source /mnt/source'); }
  finally { console.close(); }
  globalThis.console.log(`VM ready for provisioning (${accel}); SSH will use ubuntu@${vmHost}:2222`);
}

async function prepare() {
  await clearPhoneForward(stateDir, qmpPath);
  stageFrontend();
  await up();
  const bypassKey = path.join(stateDir, 'bypass_key');
  if (!fs.existsSync(bypassKey)) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', bypassKey]);
  const console = await Console.open();
  try {
    await console.login();
    await console.command('mkdir -p /mnt/source; mountpoint -q /mnt/source || mount -t 9p -o trans=virtio,version=9p2000.L,ro source /mnt/source');
    console.logging = true;
    const token = secrets().token;
    await console.command(`install -d -m 700 /etc/solana-auth; printf '%s\\n' ${quote('SOLANA_TEST_TOKEN=' + token)} ${quote('SOLANA_SSH_GATEWAY_PORT=' + gatewayPort)} > /etc/solana-auth/test.env; chmod 600 /etc/solana-auth/test.env`);
    globalThis.console.log('Provisioning and building inside Debian; progress is in .vm/serial.log');
    const dns = process.env.SOLANA_VM_DNS;
    await console.command(`${dns ? 'SOLANA_VM_DNS=' + quote(dns) + ' ' : ''}bash /mnt/source/tests/provision.sh`, 3_600_000);
    const keyOutput = await console.command('cat /etc/ssh/ssh_host_ed25519_key.pub');
    const hostKey = keyOutput.match(/ssh-ed25519 [A-Za-z0-9+/=]+/)?.[0];
    if (!hostKey) throw new Error('Missing guest host key');
    fs.writeFileSync(path.join(stateDir, 'known_hosts'), `[${vmHost}]:2222 ${hostKey}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(stateDir, 'ready'), new Date().toISOString());
    globalThis.console.log('Guest build, Rust tests, SSH configuration and daemon readiness passed');
  } finally { console.close(); }
}

async function stop() {
  const socket = connect(qmpPath);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.write('{"execute":"qmp_capabilities"}\n');
  await sleep(200);
  socket.write('{"execute":"quit"}\n');
  await new Promise<void>(resolve => socket.once('close', resolve));
  console.log('VM stopped; overlay retained');
}

async function main() {
  switch (process.argv[2]) {
    case 'up': return up();
    case 'prepare': return prepare();
    case 'phone': {
      const args = process.argv.slice(3);
      if (args[0] === '--off' && args.length !== 1) throw new Error('usage: npm run vm -- phone --off');
      const options = args[0] === '--off' ? null : parsePhoneOptions(args, gatewayPort);
      await up();
      const terminal = await Console.open();
      try {
        await terminal.login();
        if (!options) {
          await terminal.command(phoneGuestCommand(null));
          await clearPhoneForward(stateDir, qmpPath);
          console.log('Phone mode disabled; signing URLs use the loopback gateway again. Test keypair retained.');
        } else {
          const profile = await configurePhone(root, stateDir, qmpPath, terminal, options);
          console.log('Phone signing page: ' + phoneOrigin(profile));
          if (!isLanTarget(profile)) console.log('Point the HTTPS tunnel for that origin at ' + gatewayOrigin + '; keep it running while testing.');
          console.log((options.wallet ? 'Granted wallet: ' : 'Test wallet public address: ') + profile.wallet);
          if (!options.wallet) console.log('Import key file: ' + path.join(stateDir, 'phone-wallet.private-key.txt'));
          console.log(!isLanTarget(profile)
            ? 'Start a new SSH login and scan its QR code on the phone.'
            : profile.host === '127.0.0.1'
              ? 'Start a new SSH login and open its link in this computer\'s browser with the wallet extension.'
              : 'Start a new SSH login and scan its LAN QR code on a phone connected to the same Wi-Fi.');
        }
      } finally { terminal.close(); }
      return;
    }
    case 'rpc-forward': {
      // ../run.sh frees host port 8899 for a live validator, whose RPC binds all addresses.
      const state = process.argv[3];
      if (state !== 'on' && state !== 'off') throw new Error('usage: npm run vm -- rpc-forward on|off');
      const removed = await monitorCommand(qmpPath, `hostfwd_remove net0 tcp:${vmHost}:8899`);
      if (!/removed|not found/i.test(removed)) throw new Error('QEMU could not release the RPC forward: ' + removed.trim());
      if (state === 'on') {
        const added = await monitorCommand(qmpPath, `hostfwd_add net0 tcp:${vmHost}:8899-:8899`);
        if (added.trim()) throw new Error('QEMU could not restore the RPC forward (is port 8899 busy?): ' + added.trim());
      }
      console.log(`VM RPC forward on ${vmHost}:8899 ${state === 'on' ? 'restored' : 'released'}`);
      return;
    }
    case 'stop':
      try { await stop(); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!process.argv.includes('--if-running') || (code !== 'ENOENT' && code !== 'ECONNREFUSED')) throw error;
        console.log('Managed VM is already stopped');
      }
      return;
    case 'reset':
      if (fs.existsSync(qmpPath)) { try { await stop(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      for (const file of ['debian-overlay.qcow2', 'ready', 'known_hosts', 'qemu.pid', 'phone.json']) fs.rmSync(path.join(stateDir, file), { force: true });
      console.log('Disposable VM state reset; base image preserved'); return;
    case 'exec': {
      const terminal = await Console.open();
      try { terminal.logging = true; console.log(await terminal.command(process.argv.slice(3).join(' '), 600_000)); }
      finally { terminal.close(); }
      return;
    }
    case 'console': {
      const socket = connect(serialPath);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.pipe(socket); socket.pipe(process.stdout);
      socket.on('close', () => { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.exit(0); });
      console.log('Serial recovery console. Exit with Ctrl-].');
      process.stdin.on('data', data => { if (data.includes(0x1d)) socket.destroy(); });
      socket.write('\r'); return;
    }
    default: throw new Error('usage: npm run vm -- up|prepare|phone (--host LAN_IP|127.0.0.1 [--port PORT] | --origin https://HOST) [--wallet ADDRESS]|phone --off|rpc-forward on|off|exec COMMAND|console|stop|reset');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
