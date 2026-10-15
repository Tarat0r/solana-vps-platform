import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import bs58 from 'bs58';
import { parseChallenge, SessionError, sessionIdFromPath } from '../src/session.ts';
import { extensionsBlockedHere, signWalletMessage, walletBrowseUrl } from '../src/wallets.ts';

const id = 'ab'.repeat(32);
const now = 1_800_000_000;
const origin = 'https://auth.example';
const text = `VPS-ACCESS-AUTH/1\ncluster=devnet\nprogram_id=${'1'.repeat(32)}\nprovider=${'1'.repeat(32)}\nserver_id=${'cd'.repeat(32)}\nunix_user=ubuntu\nsession_id=${id}\nnonce=${'ef'.repeat(32)}\nissued_at=${now}\nexpires_at=${now + 300}\nauth_origin=${origin}\n`;
const published = (message = text) => ({ session_id: id, challenge_base64: Buffer.from(message).toString('base64'), expires_at: now + 300 });

test('canonical challenge preserves every signed byte and validates its binding', () => {
  const challenge = parseChallenge(published(), id, origin, now);
  assert.deepEqual(Buffer.from(challenge.bytes), Buffer.from(text));
  assert.equal(challenge.unixUser, 'ubuntu');
  assert.equal(sessionIdFromPath(`/v1/sessions/${id}`), id);
  assert.equal(sessionIdFromPath('/'), null);
  for (const message of [text.replaceAll('\n', '\r\n'), text.trimEnd(), text.replace('unix_user=ubuntu', 'unix_user=root'), text.replace('unix_user=ubuntu', 'unix_user=ubuntu\nextra=injected'), text.replace(`session_id=${id}`, `session_id=${'11'.repeat(32)}`), text.replace('VPS-ACCESS-AUTH/1', 'VPS-ACCESS-AUTH/2')]) {
    assert.throws(() => parseChallenge(published(message), id, origin, now), SessionError);
  }
  assert.throws(() => parseChallenge(published(), id, 'https://other.example', now), SessionError);
  assert.throws(() => parseChallenge({ ...published(), expires_at: now + 89 }, id, origin, now), SessionError);
  const legacy = text.replace(`expires_at=${now + 300}`, `expires_at=${now + 90}`);
  assert.throws(() => parseChallenge({ ...published(legacy), expires_at: now + 90 }, id, origin, now), { kind: 'invalid' });
  assert.throws(() => parseChallenge(published(), id, origin, now + 300), { kind: 'expired' });
  assert.throws(() => parseChallenge(published(), id, origin, now - 1), { kind: 'invalid' });
  assert.throws(() => parseChallenge({ ...published(), challenge_base64: 'not base64' }, id, origin, now), SessionError);
});

test('Phantom and Solflare sign the original bytes and return verifiable Ed25519 proofs', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const address = bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  const key = { toBase58: () => address, toString: () => address };
  const bytes = parseChallenge(published(), id, origin, now).bytes;
  for (const name of ['Phantom', 'Solflare'] as const) {
    const provider = {
      publicKey: key,
      connect: async () => ({ publicKey: key }),
      disconnect: async () => {},
      signMessage: async (message: Uint8Array, display: 'utf8') => {
        assert.equal(display, 'utf8');
        assert.deepEqual(message, bytes);
        const signature = Uint8Array.from(sign(null, message, privateKey));
        return name === 'Phantom' ? { publicKey: key, signature } : signature;
      },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { phantom: { solana: provider }, solflare: provider } });
    const connection = { name, provider, address };
    const proof = await signWalletMessage(connection, bytes);
    assert.equal(proof.wallet, address);
    assert.ok(verify(null, bytes, publicKey, Buffer.from(proof.signature_base64, 'base64')));
    provider.publicKey = { toBase58: () => '1'.repeat(32), toString: () => '1'.repeat(32) };
    await assert.rejects(signWalletMessage(connection, bytes), /account changed/);
  }
});

test('mobile handoff encodes the complete session URL and origin', () => {
  const session = `${origin}/v1/sessions/${id}`;
  for (const name of ['Phantom', 'Solflare'] as const) {
    const url = new URL(walletBrowseUrl(name, session));
    assert.equal(decodeURIComponent(url.pathname.split('/browse/')[1] ?? ''), session);
    assert.equal(url.searchParams.get('ref'), origin);
    assert.equal(url.hostname, name === 'Phantom' ? 'phantom.com' : 'solflare.com');
  }
});

test('wallet extensions are expected only on HTTPS, localhost, and 127.0.0.1', () => {
  for (const [protocol, hostname] of [['https:', 'auth.example'], ['http:', 'localhost'], ['http:', '127.0.0.1']] as const) {
    assert.equal(extensionsBlockedHere({ protocol, hostname }), false);
  }
  for (const hostname of ['127.0.0.2', '192.168.1.9', 'auth.example']) assert.equal(extensionsBlockedHere({ protocol: 'http:', hostname }), true);
});
