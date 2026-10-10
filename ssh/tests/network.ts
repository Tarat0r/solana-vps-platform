import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const networkFile = fileURLToPath(new URL('../.vm/network.json', import.meta.url));

function validatePort(value: unknown): number {
  const port = Number(value);
  if ((typeof value !== 'string' && typeof value !== 'number') || !Number.isInteger(port) || port < 1 || port > 65535 || [2222, 8899].includes(port)) {
    throw new Error('SOLANA_SSH_GATEWAY_PORT or saved gatewayPort must be an integer from 1 to 65535, excluding the SSH/RPC ports 2222 and 8899');
  }
  return port;
}

export function resolveGatewayPort(override: string | undefined, file = networkFile): number {
  if (override !== undefined) return validatePort(override);
  try { return validatePort(JSON.parse(fs.readFileSync(file, 'utf8')).gatewayPort); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 8080;
    throw error;
  }
}

export function saveGatewayPort(port: number, file = networkFile) {
  const value = validatePort(port);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ gatewayPort: value }) + '\n', { mode: 0o600 });
}

export let gatewayPort = resolveGatewayPort(process.env.SOLANA_SSH_GATEWAY_PORT);
export let gatewayOrigin = `http://127.0.0.2:${gatewayPort}`;

async function probePort(port: number): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.2', resolve); });
  const selected = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return selected;
}

function occupiedPort(port: number, cause: unknown): Error {
  const hint = [2222, 8899].includes(port)
    ? 'This SSH/RPC port is fixed; stop its listener before retrying.'
    : 'Unset SOLANA_SSH_GATEWAY_PORT and run npm run test:all to choose a free port, or set it to a free port.';
  return new Error(`127.0.0.2:${port} is already in use. Stop the managed VM if running (npm run vm -- stop --if-running). ${hint}`, { cause });
}

export async function assertPortFree(port: number) {
  try { await probePort(port); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw occupiedPort(port, error);
    throw error;
  }
}

export async function selectGatewayPort(preferred: number, explicit: boolean): Promise<number> {
  validatePort(preferred);
  try { return await probePort(preferred); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    if (explicit) throw occupiedPort(preferred, error);
    return probePort(0);
  }
}

export async function prepareNetwork() {
  for (const port of [2222, 8899]) await assertPortFree(port);
  const selected = await selectGatewayPort(gatewayPort, process.env.SOLANA_SSH_GATEWAY_PORT !== undefined);
  saveGatewayPort(selected);
  gatewayPort = selected;
  gatewayOrigin = `http://127.0.0.2:${selected}`;
  process.env.SOLANA_SSH_GATEWAY_PORT = String(selected);
}
