import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { assertPortFree, resolveGatewayPort, saveGatewayPort, selectGatewayPort } from './network.ts';

async function listen(host: string): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  return server;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('a wildcard listener triggers automatic fallback without stopping the listener', async t => {
  const occupied = await listen('0.0.0.0');
  t.after(() => close(occupied));
  const port = (occupied.address() as AddressInfo).port;
  const selected = await selectGatewayPort(port, false);
  assert.notEqual(selected, port);
  await assertPortFree(selected);
  await assert.rejects(assertPortFree(port), new RegExp(`127\\.0\\.0\\.2:${port} is already in use`));
  assert.ok(occupied.listening);
});

test('explicit gateway ports are honored and occupied overrides fail with an actionable error', async t => {
  const occupied = await listen('127.0.0.2');
  t.after(() => close(occupied));
  const port = (occupied.address() as AddressInfo).port;
  await assert.rejects(selectGatewayPort(port, true), /Unset SOLANA_SSH_GATEWAY_PORT/);
  const free = await selectGatewayPort(port, false);
  assert.equal(await selectGatewayPort(free, true), free);
  assert.equal(await selectGatewayPort(free, false), free);
  assert.ok(occupied.listening);
});

test('saved gateway ports survive new invocations and explicit overrides take precedence', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-network-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'network.json');
  assert.equal(resolveGatewayPort(undefined, file), 8080);
  saveGatewayPort(18080, file);
  assert.equal(resolveGatewayPort(undefined, file), 18080);
  assert.equal(resolveGatewayPort('18081', file), 18081);
  for (const invalid of ['0', '2222', '8899', '65536', 'invalid', '']) {
    assert.throws(() => resolveGatewayPort(invalid, file), /must be an integer/);
  }
  fs.writeFileSync(file, '{"gatewayPort":8899}');
  assert.throws(() => resolveGatewayPort(undefined, file), /must be an integer/);
  assert.equal(resolveGatewayPort('18081', file), 18081);
});
