import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { connect } from 'node:net';

/** A private-LAN HTTP forward, or a public HTTPS origin such as a tunnel. */
export type PhoneTarget = { host: string; port: number } | { origin: string };
export type PhoneProfile = PhoneTarget & { wallet: string };
/** An optional existing wallet address replaces the generated test keypair. */
export type PhoneOptions = PhoneTarget & { wallet?: string };
type LanTarget = { host: string; port: number };

export const isLanTarget = (target: PhoneTarget): target is LanTarget => 'host' in target;
const usage = 'usage: npm run vm -- phone (--host PRIVATE_LAN_IP|127.0.0.1 [--port PORT] | --origin https://HOST) [--wallet ADDRESS]';

/** Desktop wallet extensions such as Phantom inject only on HTTPS, localhost, or 127.0.0.1. */
export function phoneHost(value: string): string {
  return value === '127.0.0.1' ? value : privateLanAddress(value);
}

export function privateLanAddress(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) {
    throw new Error('Phone host must be a private IPv4 LAN address, such as 192.168.1.9');
  }
  // Four parts were checked above; a missing one would not be private.
  const [first = 0, second = 0] = parts.map(Number);
  if (!(first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))) {
    throw new Error('Phone host must be a private IPv4 LAN address, such as 192.168.1.9');
  }
  return value;
}

function portNumber(value: string | number): number {
  if (!/^[0-9]+$/.test(String(value))) throw new Error('Phone port must be an integer from 1024 to 65535');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Phone port must be an integer from 1024 to 65535');
  return port;
}

/** Wallet in-app browsers need a trusted HTTPS origin; only its exact origin is accepted. */
export function httpsOrigin(value: string): string {
  let url: URL | undefined;
  try { url = new URL(value); } catch { /* reported below */ }
  if (!url || url.protocol !== 'https:' || url.origin !== value || url.username || url.password || /^[0-9.]+$/.test(url.hostname)
    || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(url.hostname)) {
    throw new Error('Phone origin must be an exact HTTPS origin with a DNS name, such as https://example.trycloudflare.com');
  }
  return value;
}

export function walletAddress(value: string): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('Wallet must be a base58 Solana address');
    number = number * 58n + BigInt(digit);
  }
  const zeros = value.length - value.replace(/^1+/, '').length;
  const bytes = zeros + (number === 0n ? 0 : Math.ceil(number.toString(16).length / 2));
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) || bytes !== 32) throw new Error('Wallet must be a base58 Solana address');
  return value;
}

export function parsePhoneOptions(args: string[], defaultPort: number): PhoneOptions {
  let host: string | undefined;
  let wallet: string | undefined;
  let port = defaultPort;
  let origin: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? '';
    const value = args[index + 1];
    if (!['--host', '--port', '--origin', '--wallet'].includes(flag) || value === undefined || seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (flag === '--host') host = phoneHost(value);
    else if (flag === '--port') port = portNumber(value);
    else if (flag === '--wallet') wallet = walletAddress(value);
    else origin = httpsOrigin(value);
  }
  const extra = wallet ? { wallet } : {};
  if (origin) {
    if (seen.has('--host') || seen.has('--port')) throw new Error(usage);
    return { origin, ...extra };
  }
  if (!host) throw new Error(usage);
  return { host, port: portNumber(port), ...extra };
}

export function readPhoneProfile(stateDir: string): PhoneProfile | null {
  let data: PhoneProfile;
  try { data = JSON.parse(fs.readFileSync(path.join(stateDir, 'phone.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try { walletAddress(String(data.wallet)); }
  catch { throw new Error('Invalid phone wallet profile; run npm run vm -- phone --off'); }
  if (!isLanTarget(data)) return { origin: httpsOrigin(data.origin), wallet: data.wallet };
  return { host: phoneHost(data.host), port: portNumber(data.port), wallet: data.wallet };
}

export function phoneOrigin(profile: PhoneTarget): string {
  if (!isLanTarget(profile)) return httpsOrigin(profile.origin);
  return 'http://' + phoneHost(profile.host) + ':' + portNumber(profile.port);
}

export function phoneForward(profile: LanTarget): string {
  return 'tcp:' + phoneHost(profile.host) + ':' + portNumber(profile.port) + '-:8080';
}

export async function monitorCommand(socketPath: string, command: string): Promise<string> {
  const socket = connect(socketPath);
  let buffer = '';
  let sequence = 0;
  const pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  let greet: () => void = () => {};
  let greetError: (error: Error) => void = () => {};
  const greeting = new Promise<void>((resolve, reject) => { greet = resolve; greetError = reject; });
  const fail = (error: Error) => {
    greetError(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  socket.on('error', fail);
  socket.on('data', bytes => {
    buffer += bytes.toString();
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: { QMP?: unknown; id?: number; return?: unknown; error?: { desc?: string } };
      try { message = JSON.parse(line); } catch { fail(new Error('Invalid QEMU monitor response')); continue; }
      if (message.QMP) { greet(); continue; }
      if (message.id === undefined) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.desc ?? 'QEMU command failed'));
      else request.resolve(message.return);
    }
  });
  socket.on('close', () => fail(new Error('QEMU monitor disconnected')));
  const timeout = setTimeout(() => {
    fail(new Error('QEMU monitor timed out'));
    socket.destroy();
  }, 5000);
  const execute = (name: string, args?: Record<string, string>) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.write(JSON.stringify({ execute: name, arguments: args, id }) + '\n');
  });
  try {
    await greeting;
    await execute('qmp_capabilities');
    const result = await execute('human-monitor-command', { 'command-line': command });
    if (typeof result !== 'string') throw new Error('Unexpected QEMU monitor result');
    return result;
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

async function removeForward(qmpPath: string, profile: LanTarget): Promise<void> {
  const result = await monitorCommand(qmpPath, 'hostfwd_remove net0 tcp:' + profile.host + ':' + profile.port);
  // QEMU reports both success ("... removed") and an absent rule as text.
  if (result.trim() && !/removed|not found/i.test(result)) throw new Error(result.trim());
}

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function phoneGuestCommand(profile: PhoneProfile | null): string {
  const lines = profile ? [
    'SOLANA_TEST_AUTH_ORIGIN=' + phoneOrigin(profile),
    ...(isLanTarget(profile) && profile.host !== '127.0.0.1' ? ['SOLANA_TEST_LAN_HTTP=1'] : []),
    'SOLANA_TEST_PHONE_WALLET=' + profile.wallet,
  ] : [];
  return [
    '(', 'set -eu', 'umask 077',
    'phone_env=$(mktemp /etc/solana-auth/.phone-env-XXXXXX)',
    'phone_config=$(mktemp /etc/solana-auth/.phone-config-XXXXXX)',
    'trap \'rm -f "$phone_env" "$phone_config"\' EXIT',
    "sed '/^SOLANA_TEST_AUTH_ORIGIN=/d; /^SOLANA_TEST_LAN_HTTP=/d; /^SOLANA_TEST_PHONE_WALLET=/d' /etc/solana-auth/test.env > \"$phone_env\"",
    lines.length ? "printf '%s\\n' " + lines.map(quote).join(' ') + ' >> "$phone_env"' : ':',
    'set -a', '. "$phone_env"', 'set +a',
    'solana-test-services config > "$phone_config"',
    'install -m 600 "$phone_env" /etc/solana-auth/test.env',
    'install -m 600 "$phone_config" /etc/solana-auth/server.toml',
    'systemctl restart solana-test-services solana-authd',
    // The restarted gateway needs a moment before it accepts connections.
    'curl --noproxy \'*\' -fsS --retry 30 --retry-delay 1 --retry-connrefused -H "Authorization: Bearer $SOLANA_TEST_TOKEN" http://127.0.0.1:8080/_test/status >/dev/null',
    ')',
  ].join('\n');
}

interface GuestConsole {
  command: (command: string, timeoutMs?: number) => Promise<string>;
}

export async function configurePhone(
  sshRoot: string, stateDir: string, qmpPath: string,
  guest: GuestConsole, options: PhoneOptions,
): Promise<PhoneProfile> {
  if (fs.existsSync(path.join(stateDir, 'pipeline.lock'))) throw new Error('Wait for the active test pipeline before enabling phone mode');
  await guest.command("test -f /etc/solana-auth/phone-ready || (printf 'Run npm run vm -- prepare to install phone support\\n'; false)");
  const walletFile = path.join(stateDir, 'phone-wallet.json');
  const wallet = options.wallet
    ?? walletAddress(execFileSync(path.join(sshRoot, 'target/debug/test-services'), ['keygen', walletFile], { encoding: 'utf8' }).trim());
  const profile: PhoneProfile = { ...options, wallet };
  const previous = readPhoneProfile(stateDir);
  const previousForward = previous && isLanTarget(previous) ? previous : null;
  const sameForward = isLanTarget(profile) && previousForward?.host === profile.host && previousForward.port === profile.port;
  let added = false;
  try {
    if (isLanTarget(profile) && !sameForward) {
      const result = await monitorCommand(qmpPath, 'hostfwd_add net0 ' + phoneForward(profile));
      if (result.trim()) throw new Error('Cannot expose ' + phoneOrigin(profile) + ': ' + result.trim() + '. Choose another --port.');
      added = true;
    }
    await guest.command(phoneGuestCommand(profile));
    if (previousForward && !sameForward) await removeForward(qmpPath, previousForward);
    fs.writeFileSync(path.join(stateDir, 'phone.json'), JSON.stringify(profile) + '\n', { mode: 0o600 });
    return profile;
  } catch (error) {
    if (added && isLanTarget(profile)) { try { await removeForward(qmpPath, profile); } catch { /* retain original error */ } }
    throw error;
  }
}

export async function clearPhoneForward(stateDir: string, qmpPath: string): Promise<void> {
  const profile = readPhoneProfile(stateDir);
  if (!profile) return;
  if (isLanTarget(profile)) {
    try { await removeForward(qmpPath, profile); }
    catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  fs.rmSync(path.join(stateDir, 'phone.json'), { force: true });
}
