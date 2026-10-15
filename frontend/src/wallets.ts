import { encodeBase64, isPublicKey } from './session.ts';
import type { SignedResponse } from './session.ts';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { VersionedTransaction } from '@solana/web3.js';

export type WalletName = 'Phantom' | 'Solflare';
interface PublicKey { toBase58?: () => string; toBytes?: () => Uint8Array; toString: () => string }
interface WalletProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isConnected?: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey?: PublicKey } | void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, display: 'utf8') => Promise<Uint8Array | { signature: Uint8Array; publicKey?: PublicKey }>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
  on?: (event: string, callback: () => void) => void;
  removeListener?: (event: string, callback: () => void) => void;
  off?: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
  }
}

export interface WalletConnection {
  name: WalletName;
  provider: WalletProvider;
  address: string;
}

let adapters: { Phantom: PhantomWalletAdapter; Solflare: SolflareWalletAdapter } | undefined;

export function walletAdapter(name: WalletName): PhantomWalletAdapter | SolflareWalletAdapter {
  adapters ??= { Phantom: new PhantomWalletAdapter(), Solflare: new SolflareWalletAdapter() };
  return adapters[name];
}

export function walletProvider(name: WalletName): WalletProvider | undefined {
  const adapter = walletAdapter(name);
  return adapter.readyState === WalletReadyState.Installed ? adapter as unknown as WalletProvider : undefined;
}

export function walletCanConnect(name: WalletName): boolean {
  return [WalletReadyState.Installed, WalletReadyState.Loadable].includes(walletAdapter(name).readyState);
}

function addressOf(key: PublicKey | null | undefined): string {
  const address = key?.toBase58?.() ?? key?.toString() ?? '';
  if (!isPublicKey(address)) throw new Error('The wallet did not provide a valid Solana address.');
  return address;
}

/** A wallet that never answered a connection request. */
export class WalletTimeoutError extends Error {}

// Long enough to unlock the wallet and approve. Phantom on Firefox can lose its
// extension channel and never answer; only a page reload recovers the adapter.
const CONNECT_TIMEOUT_MS = 60_000;

export async function connectWallet(name: WalletName): Promise<WalletConnection | null> {
  if (!walletCanConnect(name)) throw new Error('Open this page in your wallet browser, or install the browser extension.');
  const provider = walletAdapter(name) as unknown as WalletProvider;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WalletTimeoutError(
      `${name} did not answer. Reload this page and connect again; if it keeps happening, restart your browser.`)), CONNECT_TIMEOUT_MS);
  });
  let response: Awaited<ReturnType<WalletProvider['connect']>>;
  try { response = await Promise.race([provider.connect(), timeout]); }
  finally { clearTimeout(timer); }
  if (!provider.publicKey && walletAdapter(name).readyState === WalletReadyState.Loadable) return null;
  const address = addressOf(response?.publicKey ?? provider.publicKey);
  return { name, provider, address };
}

export async function signWalletMessage(connection: WalletConnection, bytes: Uint8Array): Promise<SignedResponse> {
  if (addressOf(connection.provider.publicKey) !== connection.address) throw new Error('Your wallet account changed. Connect your wallet again.');
  const signed = await connection.provider.signMessage(Uint8Array.from(bytes), 'utf8');
  const signature = signed instanceof Uint8Array ? signed : signed.signature;
  const signedAddress = addressOf(signed instanceof Uint8Array ? connection.provider.publicKey : signed.publicKey ?? connection.provider.publicKey);
  if (signedAddress !== connection.address || addressOf(connection.provider.publicKey) !== connection.address) {
    throw new Error('Your wallet account changed. Connect your wallet again.');
  }
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error('The wallet returned an invalid signature. Try signing again.');
  return { wallet: signedAddress, signature_base64: encodeBase64(signature) };
}

/** Signs serialized transaction bytes; web3.js types stay inside this module. */
export async function signWalletTransaction(connection: WalletConnection, wire: Uint8Array): Promise<Uint8Array> {
  if (addressOf(connection.provider.publicKey) !== connection.address) throw new Error('Your wallet account changed. Connect your wallet again.');
  if (!connection.provider.signTransaction) throw new Error('This wallet cannot sign transactions.');
  const signed = await connection.provider.signTransaction(VersionedTransaction.deserialize(wire));
  if (signed.message.staticAccountKeys[0]?.toBase58() !== connection.address || addressOf(connection.provider.publicKey) !== connection.address) {
    throw new Error('Your wallet account changed. Connect your wallet again.');
  }
  return signed.serialize();
}

/** Phantom injects its extension only on HTTPS pages, localhost, and 127.0.0.1. */
export function extensionsBlockedHere(location: Pick<Location, 'protocol' | 'hostname'>): boolean {
  return location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname);
}

export function walletBrowseUrl(name: WalletName, sessionUrl: string): string {
  const url = new URL(sessionUrl);
  const base = name === 'Phantom' ? 'https://phantom.com/ul/browse/' : 'https://solflare.com/ul/v1/browse/';
  return `${base}${encodeURIComponent(url.href)}?ref=${encodeURIComponent(url.origin)}`;
}
