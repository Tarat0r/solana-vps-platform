import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import bs58 from 'bs58';
import type { SignedResponse } from '../../src/session.ts';

declare global {
  interface Window {
    isPhantomInstalled?: boolean;
    signChallenge: (bytes: number[]) => Promise<number[]>;
    signSolflareMessage: (bytes: number[]) => Promise<string>;
    emitWalletEvent?: (event: 'disconnect' | 'accountChanged') => void;
  }
}

const origin = 'http://127.0.0.1:4173';
const gateway = 'http://127.0.0.1:3081';
const authorization = 'Bearer browser-test-token-only-not-production-0001';

function publication(ttl = 300) {
  const id = randomBytes(32).toString('hex');
  const issued = Math.floor(Date.now() / 1000) - (300 - ttl);
  const text = `VPS-ACCESS-AUTH/1\ncluster=devnet\nprogram_id=${'1'.repeat(32)}\nprovider=${'1'.repeat(32)}\nserver_id=${'cd'.repeat(32)}\nunix_user=ubuntu\nsession_id=${id}\nnonce=${'ef'.repeat(32)}\nissued_at=${issued}\nexpires_at=${issued + 300}\nauth_origin=${origin}\n`;
  return { id, text, body: { session_id: id, challenge_base64: Buffer.from(text).toString('base64'), expires_at: issued + 300 } };
}

async function wallet(page: Page, name: 'Phantom' | 'Solflare', reject = false) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const address = bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  let signed: Buffer | undefined;
  await page.exposeFunction('signChallenge', (bytes: number[]) => {
    signed = Buffer.from(bytes);
    return Array.from(sign(null, signed, privateKey));
  });
  if (name === 'Solflare') {
    // The SDK posts the raw message bytes and expects a bs58-encoded signature.
    await page.exposeFunction('signSolflareMessage', (bytes: number[]) => {
      signed = Buffer.from(bytes);
      return bs58.encode(sign(null, signed, privateKey));
    });
    // Exercise the actual Solflare SDK's iframe protocol, without a live wallet.
    await page.route('https://connect.solflare.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><script>' +
        'window.addEventListener("message", async event => {' +
        'if (event.data?.channel !== "solflareWalletAdapterToIframe") return;' +
        'const request = event.data.data;' +
        'const reply = data => parent.postMessage({channel:"solflareIframeToWalletAdapter",data:{type:"response",id:request.id,...data}}, "*");' +
        'try { reply({result: request.method === "signMessage" ? await window.signSolflareMessage(Array.from(request.params.data)) : true}); }' +
        'catch (error) { reply({error: String(error)}); }' +
        '});' +
        'parent.postMessage({channel:"solflareIframeToWalletAdapter",data:{type:"event",event:{type:"connect",data:{publicKey:' + JSON.stringify(address) + '}}}}, "*");' +
        '</script>',
    }));
  }
  await page.addInitScript(({ name, address, reject, keyBytes }) => {
    const key = { toBase58: () => address, toString: () => address, toBytes: () => Uint8Array.from(keyBytes) };
    const listeners: Record<string, Set<(value?: unknown) => void>> = {};
    // Lets a test simulate the user disconnecting or switching accounts in the wallet.
    window.emitWalletEvent = event => {
      const value = event === 'accountChanged' ? { toBytes: () => new Uint8Array(32).fill(9) } : undefined;
      for (const listener of [...listeners[event] ?? []]) listener(value);
    };
    const provider = {
      isPhantom: true,
      isSolflare: true,
      isConnected: false,
      on: (event: string, listener: (value?: unknown) => void) => { (listeners[event] ??= new Set()).add(listener); },
      off: (event: string, listener: (value?: unknown) => void) => { listeners[event]?.delete(listener); },
      removeListener: (event: string, listener: (value?: unknown) => void) => { listeners[event]?.delete(listener); },
      publicKey: key,
      connect: async () => { provider.isConnected = true; return { publicKey: key }; },
      disconnect: async () => {},
      signMessage: async (bytes: Uint8Array) => {
        if (reject) throw Object.assign(new Error('User rejected'), { code: 4001 });
        const signer = window.signChallenge;
        const signature = Uint8Array.from(await signer(Array.from(bytes)));
        return name === 'Phantom' ? { signature, publicKey: key } : signature;
      },
    };
    if (name === 'Phantom') { window.isPhantomInstalled = true; window.phantom = { solana: provider }; }
    else window.solflare = provider;
  }, { name, address, reject, keyBytes: Array.from(bs58.decode(address)) });
  return { address, publicKey, message: () => signed };
}

for (const name of ['Phantom', 'Solflare'] as const) {
  test(`${name} completes signing through the real Axum gateway`, async ({ page, request }) => {
    const challenge = publication();
    const provider = await wallet(page, name);
    const published = await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
    expect(published.status()).toBe(201);
    await page.goto(`/v1/sessions/${challenge.id}`);
    await expect(page.getByText('ubuntu', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Connect wallet/ }).click();
    await expect(page.getByText(`${name} connected`)).toBeVisible();
    await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signature submitted' })).toBeVisible();
    await expect(page.getByText('Return to SSH and press Enter.', { exact: true })).toBeVisible();
    const response = await request.get(`${gateway}/v1/sessions/${challenge.id}/response`, { headers: { Authorization: authorization } });
    expect(response.status()).toBe(200);
    const proof = await response.json() as SignedResponse;
    expect(proof.wallet).toBe(provider.address);
    expect(provider.message()).toEqual(Buffer.from(challenge.text));
    expect(verify(null, Buffer.from(challenge.text), provider.publicKey, Buffer.from(proof.signature_base64, 'base64'))).toBe(true);
  });
}

test('phone handoff and narrow layout preserve the session URL', async ({ page, request }) => {
  const challenge = publication();
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/v1/sessions/${challenge.id}`);
  const phantom = page.getByRole('link', { name: 'Open in Phantom' });
  await expect(phantom).toHaveAttribute('href', `https://phantom.com/ul/browse/${encodeURIComponent(`${origin}/v1/sessions/${challenge.id}`)}?ref=${encodeURIComponent(origin)}`);
  await expect(page.getByRole('link', { name: 'Open in Solflare' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Sign login message' })).toBeDisabled();
});

test('one connect button offers a choice when several wallets are detected', async ({ page, request }) => {
  const challenge = publication();
  const provider = await wallet(page, 'Phantom');
  await page.addInitScript(() => { window.solflare = window.phantom!.solana; });
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await page.goto(`/v1/sessions/${challenge.id}`);
  const connect = page.getByRole('button', { name: /^Connect wallet/ });
  await expect(connect).toContainText('Phantom or Solflare detected');
  await expect(page.getByRole('button', { name: /^Phantom/ })).toHaveCount(0);
  await connect.click();
  await expect(connect).toHaveAttribute('aria-expanded', 'true');
  const choices = page.getByRole('group', { name: 'Choose a wallet' });
  await expect(choices.getByRole('button', { name: /^Solflare/ })).toBeEnabled();
  await choices.getByRole('button', { name: /^Phantom/ }).click();
  await expect(page.getByText('Phantom connected')).toBeVisible();
  await expect(choices).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Signature submitted' })).toBeVisible();
  const proof = await (await request.get(`${gateway}/v1/sessions/${challenge.id}/response`, { headers: { Authorization: authorization } })).json() as SignedResponse;
  expect(proof.wallet).toBe(provider.address);
});

test('without a detected wallet the connect button lists every option', async ({ page, request }) => {
  const challenge = publication();
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await page.goto(`/v1/sessions/${challenge.id}`);
  const connect = page.getByRole('button', { name: /^Connect wallet/ });
  await expect(connect).toContainText('Phantom or Solflare');
  await expect(connect).toHaveAttribute('aria-expanded', 'false');
  await connect.click();
  const choices = page.getByRole('group', { name: 'Choose a wallet' });
  await expect(choices.getByRole('button', { name: /^Phantom/ })).toBeDisabled();
  await expect(choices.getByRole('button', { name: /^Phantom/ })).toContainText('Not installed');
  await expect(choices.getByRole('button', { name: /^Solflare/ })).toBeEnabled();
  await expect(choices.getByRole('button', { name: /^Solflare/ })).toContainText('Open wallet');
  await connect.click();
  await expect(connect).toHaveAttribute('aria-expanded', 'false');
  await expect(choices).toHaveCount(0);
});

for (const event of ['disconnect', 'accountChanged'] as const) {
  test(`wallet ${event} requires connecting again before signing`, async ({ page, request }) => {
    const challenge = publication();
    await wallet(page, 'Phantom');
    await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
    await page.goto(`/v1/sessions/${challenge.id}`);
    await page.getByRole('button', { name: /^Connect wallet/ }).click();
    await expect(page.getByText('Phantom connected')).toBeVisible();
    await page.evaluate(name => window.emitWalletEvent!(name), event);
    await expect(page.getByRole('alert')).toContainText('changed or disconnected');
    await expect(page.getByText('Phantom connected')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign login message', exact: true })).toBeDisabled();
    expect((await request.get(`${gateway}/v1/sessions/${challenge.id}/response`, { headers: { Authorization: authorization } })).status()).toBe(204);
    if (event === 'disconnect') {
      await page.getByRole('button', { name: /^Connect wallet/ }).click();
      await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Signature submitted' })).toBeVisible();
    }
  });
}

test('the countdown shows minutes and turns urgent in the last 30 seconds', async ({ page, request }) => {
  const remaining = page.locator('.expiry-detail dd');
  const fresh = publication();
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: fresh.body });
  await page.goto(`/v1/sessions/${fresh.id}`);
  await expect(remaining).toHaveText(/^(5:00|4:5\d)$/);
  await expect(remaining).not.toHaveClass(/urgent/);
  const ending = publication(25);
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: ending.body });
  await page.goto(`/v1/sessions/${ending.id}`);
  await expect(remaining).toHaveText(/^0:[12]\d$/);
  await expect(remaining).toHaveClass(/urgent/);
});

test('a submitted signature stays confirmed after the link expires', async ({ page, request }) => {
  const challenge = publication(6);
  await wallet(page, 'Phantom');
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await page.goto(`/v1/sessions/${challenge.id}`);
  await page.getByRole('button', { name: /^Connect wallet/ }).click();
  await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Signature submitted' })).toBeVisible();
  await page.waitForFunction(expiresAt => Date.now() / 1000 > expiresAt + 1, challenge.body.expires_at, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Signature submitted' })).toBeVisible();
  await expect(page.getByText('has expired')).toHaveCount(0);
});

test('rejected wallet signing leaves the gateway proof pending', async ({ page, request }) => {
  const challenge = publication();
  await wallet(page, 'Phantom', true);
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await page.goto(`/v1/sessions/${challenge.id}`);
  await page.getByRole('button', { name: /^Connect wallet/ }).click();
  await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Signing was cancelled');
  expect((await request.get(`${gateway}/v1/sessions/${challenge.id}/response`, { headers: { Authorization: authorization } })).status()).toBe(204);
});

test('a wallet that never answers connect times out with reload advice', async ({ page, request }) => {
  // Phantom on Firefox can lose its extension channel and leave connect() pending.
  const challenge = publication();
  await page.clock.install();
  await wallet(page, 'Phantom');
  await page.addInitScript(() => { window.phantom!.solana!.connect = () => new Promise(() => {}); });
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await page.goto(`/v1/sessions/${challenge.id}`);
  await page.getByRole('button', { name: /^Connect wallet/ }).click();
  await expect(page.getByRole('button', { name: 'Connecting wallet…', exact: true })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('alert')).toContainText('Phantom did not answer. Reload this page and connect again');
  await expect(page.getByRole('button', { name: /^Connect wallet/ })).toBeEnabled();
});

test('missing, invalid, and expired challenges cannot be signed', async ({ page, request }) => {
  await page.goto(`/v1/sessions/${'00'.repeat(32)}`);
  await expect(page.getByRole('alert')).toContainText('no longer available');
  const invalid = publication();
  invalid.body.challenge_base64 = Buffer.from('malformed challenge\n').toString('base64');
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: invalid.body });
  await page.goto(`/v1/sessions/${invalid.id}`);
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  const expiring = publication(2);
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: expiring.body });
  await page.goto(`/v1/sessions/${expiring.id}`);
  await expect(page.getByRole('alert')).toContainText('has expired', { timeout: 5000 });
});

test('duplicate submission explains that SSH must confirm the outcome', async ({ page, request }) => {
  const challenge = publication();
  await wallet(page, 'Solflare');
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  await request.post(`${gateway}/v1/sessions/${challenge.id}/response`, { data: { wallet: '1'.repeat(32), signature_base64: Buffer.alloc(64).toString('base64') } });
  await page.goto(`/v1/sessions/${challenge.id}`);
  await page.getByRole('button', { name: /^Connect wallet/ }).click();
  await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already has a response');
  await expect(page.getByRole('heading', { name: 'Signature submitted' })).toHaveCount(0);
});

test('unconfirmed submission retries the same signature without signing again', async ({ page, request }) => {
  const challenge = publication();
  await wallet(page, 'Phantom');
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  const bodies: string[] = [];
  await page.route(`**/v1/sessions/${challenge.id}/response`, async route => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) await route.abort('connectionfailed');
    else await route.continue();
  });
  await page.goto(`/v1/sessions/${challenge.id}`);
  await page.getByRole('button', { name: /^Connect wallet/ }).click();
  await page.getByRole('button', { name: 'Sign login message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await page.getByRole('button', { name: 'Retry submission' }).click();
  await expect(page.getByRole('heading', { name: 'Signature submitted' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
});

test('gateway retrieval failure offers a safe reload', async ({ page }) => {
  const id = 'fe'.repeat(32);
  await page.route(`**/v1/sessions/${id}`, async route => {
    if (route.request().headers().accept === 'application/json') await route.abort();
    else await route.continue();
  });
  await page.goto(`/v1/sessions/${id}`);
  await expect(page.getByRole('alert')).toContainText('could not be reached');
  await expect(page.getByRole('button', { name: 'Try loading again' })).toBeVisible();
});

test('the production build loads from Axum with its content security policy', async ({ page, request }, info) => {
  const challenge = publication();
  challenge.body.challenge_base64 = Buffer.from(challenge.text.replace(`auth_origin=${origin}`, `auth_origin=${gateway}`)).toString('base64');
  await wallet(page, 'Phantom');
  await request.post(`${gateway}/v1/sessions`, { headers: { Authorization: authorization }, data: challenge.body });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(`${gateway}/v1/sessions/${challenge.id}`);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.getByText('ubuntu', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Connect wallet/ })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('approval-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: info.outputPath('approval-phone.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
