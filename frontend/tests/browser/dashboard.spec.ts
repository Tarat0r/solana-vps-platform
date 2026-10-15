// Owner dashboard against the real program on solana-test-validator. Needs
// `npm --prefix programs ci` and `npm --prefix programs run build` first.
import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import bs58 from 'bs58';

declare global {
  interface Window {
    isPhantomInstalled?: boolean;
    signTransactionMessage: (bytes: number[]) => Promise<number[]>;
    rejectSigning?: boolean;
  }
}

const programs = fileURLToPath(new URL('../../../programs/', import.meta.url));
interface ListedServer { name: string; server_id: string }
const settings = JSON.parse(readFileSync(new URL('./dashboard.json', import.meta.url), 'utf8')) as {
  rpc_url: string; program_id: string; provider_pubkey: string; servers: [ListedServer, ListedServer];
};
const rpcUrl = settings.rpc_url;
const PRICE = 100_000_000n;
const gateway = 'http://127.0.0.1:3081';
const run = promisify(execFile);
const finalized = { timeout: 90_000 };

interface Keypair { privateKey: KeyObject; address: string; secret: number[] }

/** A random key, or the fixed localnet provider key named in dashboard.json. */
function keypair(seed?: Buffer): Keypair {
  const privateKey = seed
    ? createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
    : generateKeyPairSync('ed25519').privateKey;
  const publicBytes = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  const seedBytes = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  return { privateKey, address: bs58.encode(publicBytes), secret: [...seedBytes, ...publicBytes] };
}

const provider = keypair(Buffer.alloc(32, 0x5d));
const owner = keypair();
const secondBuyer = keypair();
const [first, second] = settings.servers;
const treasury = keypair().address;
let validator: ChildProcess | undefined;
let work: string;
let keypairFile: string;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json() as { result: T; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function balance(address: string): Promise<bigint> {
  return BigInt((await rpc<{ value: number }>('getBalance', [address, { commitment: 'finalized' }])).value);
}

async function settled(signature: string, level: 'confirmed' | 'finalized') {
  await expect.poll(async () => {
    type Status = { err: unknown; confirmationStatus: string | null } | null;
    const [status] = (await rpc<{ value: Status[] }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value;
    if (status?.err) throw new Error(`${signature} failed: ${JSON.stringify(status.err)}`);
    return status?.confirmationStatus === 'finalized' || status?.confirmationStatus === level;
  }, finalized).toBe(true);
}

/** Runs provider.sh for one server and waits until its transaction is finalized. */
async function providerScript(serverId: string, ...args: string[]) {
  const { stdout } = await run(join(programs, 'scripts/provider.sh'), [
    ...args, '--url', rpcUrl, '--keypair', keypairFile, '--server-id', serverId, '--yes',
  ]);
  const { signature } = JSON.parse(stdout.slice(stdout.lastIndexOf('\n{') + 1)) as { signature: string };
  await settled(signature, 'finalized');
}

function assertPortFree(port: number) {
  return new Promise<void>((resolve, reject) => {
    const server = createServer().once('error', () => reject(new Error(`port ${port} is in use`)));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

/** Installs a Phantom double that signs transactions with `key` in the test process. */
async function wallet(page: Page, key: Keypair) {
  const signed: Buffer[] = [];
  await page.exposeFunction('signTransactionMessage', (bytes: number[]) => {
    signed.push(Buffer.from(bytes));
    return Array.from(sign(null, Buffer.from(bytes), key.privateKey));
  });
  await page.addInitScript(({ address, keyBytes }) => {
    const publicKey = { toBase58: () => address, toString: () => address, toBytes: () => Uint8Array.from(keyBytes) };
    const provider = {
      isPhantom: true,
      isConnected: false,
      publicKey,
      on: () => {},
      off: () => {},
      removeListener: () => {},
      connect: async () => { provider.isConnected = true; return { publicKey }; },
      disconnect: async () => {},
      signMessage: async () => { throw new Error('The dashboard signs transactions only.'); },
      signTransaction: async (transaction: { message: { serialize: () => Uint8Array }; signatures: Uint8Array[] }) => {
        if (window.rejectSigning) throw Object.assign(new Error('User rejected'), { code: 4001 });
        transaction.signatures[0] = Uint8Array.from(await window.signTransactionMessage(Array.from(transaction.message.serialize())));
        return transaction;
      },
    };
    window.isPhantomInstalled = true;
    window.phantom = { solana: provider as never };
  }, { address: key.address, keyBytes: Array.from(bs58.decode(key.address)) });
  return signed;
}

async function openDashboard(page: Page, key: Keypair, origin = '') {
  const signed = await wallet(page, key);
  await page.goto(`${origin}/`);
  await expect(page.locator('dl.login-details dd', { hasText: '0.1 SOL per 30 days' })).toBeVisible();
  await page.getByRole('button', { name: /^Connect Phantom/ }).click();
  await expect(page.getByText('Phantom connected')).toBeVisible();
  return signed;
}

// Price, the 5000-lamport fee, and default rent: 0.00178872 SOL for a receipt, 0.00146856 SOL for a grant.
const purchaseTotal = '0.10326228 SOL';
const renewalTotal = '0.10179372 SOL';

/** Opens the confirm step for a payment, checks its total, then pays. */
async function payAfterConfirming(page: Page, start: RegExp, total: string) {
  await page.getByRole('button', { name: start }).click();
  await expect(page.getByRole('group', { name: /^Confirm / })).toContainText(`Total from your wallet${total}`);
  await page.getByRole('button', { name: `Pay ${total}`, exact: true }).click();
}

const sshCommand = 'ssh -p 2222 ubuntu@127.0.0.2';
/** The selected server's status line, and each server's status in the list. */
const status = (page: Page) => page.locator('dl.login-details > div', { hasText: 'Status' }).locator('dd');
const listed = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
/** The copyable SSH command, shown only to a wallet with access. */
const sshCommandOn = (page: Page, command = sshCommand) => page.locator('code.ssh-command', { hasText: command });
const buy = /^Buy access for 0\.1 SOL/;
/** The two menus: every server, and only the connected wallet's own servers. */
const browseMenu = (page: Page) => page.getByRole('navigation', { name: 'Dashboard' }).getByRole('button', { name: 'Browse servers' });
const myServersMenu = (page: Page) => page.getByRole('navigation', { name: 'Dashboard' }).getByRole('button', { name: /^My servers/ });
async function openMyServers(page: Page) {
  await myServersMenu(page).click();
  await expect(myServersMenu(page)).toHaveAttribute('aria-current', 'page');
}
const renew = /^Renew for 0\.1 SOL/;

async function newPage(browser: Browser) {
  return (await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })).newPage();
}

const history = (page: Page) => page.locator('section[aria-labelledby="history-title"] li');
const pendingRecords = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('wallet-ssh:pending-payment')).length);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  expect(provider.address).toBe(settings.provider_pubkey);
  const program = join(programs, 'target/deploy/billing_access.so');
  if (!existsSync(program) || !existsSync(join(programs, 'node_modules/@solana/kit'))) {
    throw new Error('Run `npm --prefix programs ci` and `npm --prefix programs run build` first.');
  }
  for (const port of [38899, 38900, 38001, 39900]) await assertPortFree(port);
  work = mkdtempSync(join(tmpdir(), 'dashboard-browser-'));
  validator = spawn('solana-test-validator', [
    '--ledger', join(work, 'ledger'), '--reset', '--quiet', '--bind-address', '127.0.0.1',
    '--rpc-port', '38899', '--faucet-port', '39900', '--gossip-port', '38001', '--dynamic-port-range', '38100-38200',
    '--upgradeable-program', settings.program_id, program, 'none',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  await expect.poll(async () => {
    expect(validator?.exitCode, 'solana-test-validator exited').toBeNull();
    return rpc<string>('getHealth').catch(() => null);
  }, { timeout: 60_000 }).toBe('ok');
  for (const key of [provider, owner, secondBuyer]) await settled(await rpc<string>('requestAirdrop', [key.address, 10_000_000_000]), 'confirmed');
  keypairFile = join(work, 'provider.json');
  writeFileSync(keypairFile, JSON.stringify(provider.secret));
  // Registered for sale: the first wallet to pay for a server becomes its owner.
  for (const server of [first, second]) {
    await providerScript(server.server_id, 'register', '--treasury', treasury, '--price-lamports', String(PRICE), '--period-seconds', '2592000');
  }
});

test.afterAll(async () => {
  if (validator && validator.exitCode === null) {
    validator.kill('SIGTERM');
    await new Promise<void>(resolve => validator!.once('exit', () => resolve()));
  }
  if (work) rmSync(work, { recursive: true, force: true });
});

test('without dashboard settings the homepage explains SSH signing', async ({ page }) => {
  await page.route('**/v1/dashboard', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Start in your terminal' })).toBeVisible();
});

test('a visitor sees the price and availability, not SSH details', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('dl.login-details dd', { hasText: '0.1 SOL per 30 days' })).toBeVisible();
  await expect(status(page)).toHaveText('Available');
  await expect(listed(page, 'Server 1')).toContainText('Available');
  await expect(listed(page, 'Server 2')).toContainText('Available');
  await expect(page.getByText('Connect a wallet to buy access or see your own access.')).toBeVisible();
  await expect(page.getByText(sshCommand)).toHaveCount(0);
  await expect(page.getByText('ubuntu@127.0.0.2')).toHaveCount(0);
});

test('a wallet without SOL is told so, and can get test SOL on localnet', async ({ page }) => {
  test.setTimeout(120_000);
  await openDashboard(page, keypair());
  await expect(page.getByText('Balance on localnet: 0 SOL')).toBeVisible();
  await expect(page.getByRole('button', { name: buy })).toBeDisabled();
  await expect(page.getByText(/^This wallet has 0 SOL on localnet; paying needs 0\.10326228 SOL, including the network fee and account rent\./)).toBeVisible();
  await page.getByRole('button', { name: 'Add 10 test SOL' }).click();
  await expect(page.getByText('Added 10 test SOL to this wallet.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Balance on localnet: 10 SOL')).toBeVisible();
  await expect(page.getByRole('button', { name: buy })).toBeEnabled();
});

test('a payment needs a confirm step, and cancelling either step charges nothing', async ({ page }) => {
  const signed = await openDashboard(page, owner);
  await expect(status(page)).toHaveText('Available');
  await page.getByRole('button', { name: buy }).click();
  const confirm = page.getByRole('group', { name: 'Confirm purchase' });
  await expect(confirm).toContainText(/Access untilabout /);
  await expect(confirm).toContainText('Server price0.1 SOL');
  await expect(confirm).toContainText('Network fee0.000005 SOL');
  await expect(confirm).toContainText(/Account rent.*0\.00325728 SOL/);
  await expect(confirm.getByRole('button', { name: `Pay ${purchaseTotal}` })).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(signed).toHaveLength(0);

  await page.evaluate(() => { window.rejectSigning = true; });
  await payAfterConfirming(page, buy, purchaseTotal);
  await expect(page.getByText('Payment was cancelled in your wallet. Nothing was charged.')).toBeVisible();
  expect(await pendingRecords(page)).toBe(0);
  expect(await balance(treasury)).toBe(0n);
});

test('a new wallet buys the server and then renews it', async ({ page }) => {
  test.setTimeout(240_000);
  const signed = await openDashboard(page, owner);
  await openMyServers(page);
  await expect(myServersMenu(page)).toHaveText('My servers 0');
  await expect(page.getByText('This wallet does not own any servers yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Find a server' }).click();
  await expect(browseMenu(page)).toHaveAttribute('aria-current', 'page');
  await payAfterConfirming(page, buy, purchaseTotal);
  // While Solana finalizes the payment, the page shows a spinner.
  await expect(page.getByRole('heading', { name: 'Payment in progress' }).locator('.spinner')).toBeVisible();
  await expect(page.getByText(/^Payment confirmed\. Access is paid until/)).toBeVisible(finalized);
  await expect(page.getByRole('heading', { name: 'Payment in progress' })).toHaveCount(0);
  // A purchase opens the server in My servers, which lists only owned servers.
  await expect(myServersMenu(page)).toHaveAttribute('aria-current', 'page');
  await expect(myServersMenu(page)).toHaveText('My servers 1');
  await expect(status(page)).toHaveText('Owned by you');
  await expect(listed(page, 'Server 1')).toContainText('Owned by you');
  await expect(listed(page, 'Server 2')).toHaveCount(0);
  await browseMenu(page).click();
  await expect(listed(page, 'Server 1')).toContainText('Owned by you');
  await expect(listed(page, 'Server 2')).toContainText('Available');
  await page.getByRole('button', { name: 'Manage in My servers' }).click();
  await expect(myServersMenu(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(/^Until /).first()).toBeVisible();
  await expect(sshCommandOn(page)).toBeVisible();
  await expect(history(page)).toHaveCount(1);
  // Each payment shows what it took from the wallet, read from its finalized transaction.
  await expect(history(page).first()).toContainText(`${purchaseTotal}0.1 SOL price + 0.000005 SOL fee + 0.00325728 SOL rent`);
  await expect(history(page).first().getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', /^https:\/\/explorer\.solana\.com\/tx\/\w+\?cluster=custom&customUrl=/);
  expect(await balance(treasury)).toBe(PRICE);

  await page.getByRole('button', { name: renew }).click();
  const confirm = page.getByRole('group', { name: 'Confirm renewal' });
  await expect(confirm).toContainText(/Current access until/);
  await expect(confirm).toContainText(/New expiryabout /);
  await confirm.getByRole('button', { name: `Pay ${renewalTotal}` }).click();
  await expect(page.getByText(/^Payment confirmed\./)).toBeVisible(finalized);
  await expect(history(page)).toHaveCount(2);
  await expect(history(page).first()).toContainText(`${renewalTotal}0.1 SOL price + 0.000005 SOL fee + 0.00178872 SOL rent`);
  await expect(page.locator('section[aria-labelledby="history-title"]')).toContainText('0.205056 SOL spent');
  expect(await balance(treasury)).toBe(2n * PRICE);
  expect(signed).toHaveLength(2);
  expect(await pendingRecords(page)).toBe(0);
});

test('the built dashboard renews through the gateway within its CSP', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  const response = page.waitForResponse(`${gateway}/`);
  await openDashboard(page, owner, gateway);
  expect((await response).headers()['content-security-policy']).toContain("connect-src 'self' http://127.0.0.1:38899;");
  await openMyServers(page);
  await expect(history(page)).toHaveCount(2);
  await payAfterConfirming(page, renew, renewalTotal);
  await expect(page.getByText(/^Payment confirmed\./)).toBeVisible(finalized);
  await expect(history(page)).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a payment whose response is lost reconciles after reload without a second charge', async ({ page }) => {
  test.setTimeout(240_000);
  await openDashboard(page, owner);
  await openMyServers(page);
  await expect(history(page)).toHaveCount(3);
  const before = await balance(treasury);
  // The transaction reaches the validator, but the page never sees the reply.
  await page.route('http://127.0.0.1:38899/**', async route => {
    if (!route.request().postData()?.includes('"sendTransaction"')) return route.continue();
    await route.fetch();
    await route.abort('connectionfailed');
  });
  await payAfterConfirming(page, renew, renewalTotal);
  await expect(page.getByText(/payment result is not confirmed yet/)).toBeVisible();
  expect(await pendingRecords(page)).toBe(1);
  await page.unroute('http://127.0.0.1:38899/**');

  await page.reload();
  await expect(myServersMenu(page)).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /^Connect Phantom/ }).click();
  await expect(page.getByRole('button', { name: renew })).toHaveCount(0);
  await expect(page.getByText(/^Payment confirmed\./)).toBeVisible(finalized);
  await expect(history(page)).toHaveCount(4);
  expect(await balance(treasury)).toBe(before + PRICE);
  expect(await pendingRecords(page)).toBe(0);
});

test('the owner shares and revokes access, and the delegate sees only its own access', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const delegate = keypair();
  const signed = await openDashboard(page, owner);
  await openMyServers(page);
  await expect(page.getByText(/^Sharing with a new wallet costs 0\.00147356 SOL: the 0\.000005 SOL network fee and 0\.00146856 SOL rent/)).toBeVisible();
  await page.getByLabel('Wallet address').fill('not-an-address');
  await page.getByRole('button', { name: 'Grant access' }).click();
  await expect(page.getByText('Enter another wallet address to share access with.')).toBeVisible();
  expect(signed).toHaveLength(0);

  await page.getByLabel('Wallet address').fill(delegate.address);
  await page.getByRole('button', { name: 'Grant access' }).click();
  await expect(page.getByText(/^Access shared with /)).toBeVisible(finalized);
  const revoke = page.getByRole('button', { name: `Revoke ${delegate.address}` });
  await expect(revoke).toBeVisible();

  const delegatePage = await newPage(browser);
  await openDashboard(delegatePage, delegate);
  await expect(delegatePage.getByRole('heading', { name: 'Shared access' })).toBeVisible();
  await expect(delegatePage.getByText(/^The owner shared this server with you\. Until .*Only the owner can pay or manage access\.$/)).toBeVisible();
  await expect(sshCommandOn(delegatePage)).toBeVisible();
  await expect(delegatePage.getByRole('button', { name: renew })).toHaveCount(0);
  await expect(delegatePage.getByRole('heading', { name: 'Payment history' })).toHaveCount(0);
  // A delegate owns nothing, so My servers points back to the shared server.
  await openMyServers(delegatePage);
  await expect(delegatePage.getByText(/^This wallet does not own any servers yet\. The server shared with you is in Browse servers/)).toBeVisible();
  await delegatePage.context().close();

  await revoke.click();
  await expect(page.getByText(/^Access revoked for /)).toBeVisible(finalized);
  await expect(revoke).toHaveCount(0);
  await expect(page.getByText('No other wallets have access.')).toBeVisible();
});

test('another wallet sees the server as taken, without the owner\'s details', async ({ page }) => {
  await openDashboard(page, keypair());
  await expect(status(page)).toHaveText('Taken');
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
  await expect(page.getByRole('button', { name: buy })).toHaveCount(0);
  for (const hidden of ['Your access', 'Shared access', 'Payment history', 'Grant access']) {
    await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(/^Until /)).toHaveCount(0);
  await expect(page.getByText(sshCommand)).toHaveCount(0);
  await expect(page.getByText(owner.address.slice(0, 8))).toHaveCount(0);
});

test('another wallet buys the second server independently', async ({ page }) => {
  test.setTimeout(240_000);
  await openDashboard(page, secondBuyer);
  await expect(listed(page, 'Server 1')).toContainText('Taken');
  await listed(page, 'Server 2').click();
  await expect(listed(page, 'Server 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toHaveText('Available');
  await payAfterConfirming(page, buy, purchaseTotal);
  await expect(page.getByText(/^Payment confirmed\. Access is paid until/)).toBeVisible(finalized);
  await expect(myServersMenu(page)).toHaveAttribute('aria-current', 'page');
  await expect(status(page)).toHaveText('Owned by you');
  await expect(listed(page, 'Server 2')).toContainText('Owned by you');
  await expect(listed(page, 'Server 1')).toHaveCount(0);
  await expect(sshCommandOn(page, 'ssh -p 2222 ubuntu@127.0.0.3')).toBeVisible();
  await expect(history(page)).toHaveCount(1);

  // The first buyer sees its own server, and the second one as taken.
  const ownerPage = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:4173' }).then(context => context.newPage());
  await openDashboard(ownerPage, owner);
  await expect(listed(ownerPage, 'Server 1')).toContainText('Owned by you');
  await expect(listed(ownerPage, 'Server 2')).toContainText('Taken');
  await ownerPage.context().close();
});

test('a server disabled by the provider blocks payments', async ({ page }) => {
  test.setTimeout(180_000);
  await providerScript(first.server_id, 'disable');
  await openDashboard(page, owner);
  await expect(page.getByText('Disabled by the provider')).toBeVisible();
  await openMyServers(page);
  await expect(page.getByText('Disabled by the provider')).toBeVisible();
  await expect(page.getByRole('button', { name: renew })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Grant access' })).toBeDisabled();
});
