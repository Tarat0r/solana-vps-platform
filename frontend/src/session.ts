import bs58 from 'bs58';

/** Exact challenge lifetime from authentication contract v1. */
export const CHALLENGE_TTL_SECONDS = 300;

export interface PublishedChallenge {
  session_id: string;
  challenge_base64: string;
  expires_at: number;
}

export interface SignedResponse {
  wallet: string;
  signature_base64: string;
}

export interface LoginChallenge {
  bytes: Uint8Array;
  text: string;
  sessionId: string;
  cluster: string;
  programId: string;
  provider: string;
  serverId: string;
  unixUser: string;
  issuedAt: number;
  expiresAt: number;
  authOrigin: string;
}

export class SessionError extends Error {
  readonly kind: 'missing' | 'expired' | 'invalid' | 'network' | 'duplicate';
  constructor(kind: SessionError['kind']) {
    super(kind);
    this.kind = kind;
  }
}

export function sessionIdFromPath(path: string): string | null {
  return /^\/v1\/sessions\/([a-f0-9]{64})$/.exec(path)?.[1] ?? null;
}

export function isPublicKey(value: string): boolean {
  try { return bs58.decode(value).length === 32; } catch { return false; }
}

export function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

export function parseChallenge(
  input: unknown, sessionId: string, origin: string, now = Math.floor(Date.now() / 1000),
): LoginChallenge {
  const invalid = () => { throw new SessionError('invalid'); };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  const publication = input as Record<string, unknown>;
  if (Object.keys(publication).sort().join(',') !== 'challenge_base64,expires_at,session_id'
    || publication.session_id !== sessionId
    || typeof publication.challenge_base64 !== 'string'
    || publication.challenge_base64.length > 5500
    || !Number.isSafeInteger(publication.expires_at)) return invalid();
  const encoded = publication.challenge_base64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return invalid();
  let bytes: Uint8Array;
  let text: string;
  try {
    bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (bytes.length === 0 || bytes.length > 4096 || encodeBase64(bytes) !== encoded) return invalid();
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return invalid(); }

  const fields = ['cluster', 'program_id', 'provider', 'server_id', 'unix_user', 'session_id', 'nonce', 'issued_at', 'expires_at', 'auth_origin'] as const;
  const lines = text.split('\n');
  if (lines.length !== fields.length + 2 || lines[0] !== 'VPS-ACCESS-AUTH/1' || lines.at(-1) !== '') return invalid();
  // Every field is assigned below, or the challenge is rejected.
  const values = {} as Record<(typeof fields)[number], string>;
  for (const [index, field] of fields.entries()) {
    const line = lines[index + 1] ?? '';
    const prefix = `${field}=`;
    if (!line.startsWith(prefix)) return invalid();
    values[field] = line.slice(prefix.length);
    // eslint-disable-next-line no-control-regex -- rejects control characters in signed fields
    if (/[\u0000-\u001f\u007f]/.test(values[field])) return invalid();
  }
  const issuedAt = Number(values.issued_at);
  const expiresAt = Number(values.expires_at);
  if (!['localnet', 'devnet', 'testnet', 'mainnet-beta'].includes(values.cluster)
    || !isPublicKey(values.program_id) || !isPublicKey(values.provider)
    || !/^[a-f0-9]{64}$/.test(values.server_id) || !/^[a-f0-9]{64}$/.test(values.nonce)
    || values.session_id !== sessionId
    || !/^[a-zA-Z0-9_-]{1,32}$/.test(values.unix_user) || values.unix_user === 'root'
    || !/^[0-9]+$/.test(values.issued_at) || !/^[0-9]+$/.test(values.expires_at)
    || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
    || expiresAt - issuedAt !== CHALLENGE_TTL_SECONDS || issuedAt > now
    || expiresAt !== publication.expires_at
    || values.auth_origin !== origin) return invalid();
  if (expiresAt <= now) throw new SessionError('expired');
  return {
    bytes, text, sessionId, cluster: values.cluster, programId: values.program_id,
    provider: values.provider, serverId: values.server_id, unixUser: values.unix_user,
    issuedAt, expiresAt, authOrigin: values.auth_origin,
  };
}

export async function loadChallenge(id: string, signal: AbortSignal): Promise<LoginChallenge> {
  let response: Response;
  try {
    response = await fetch(`/v1/sessions/${id}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SessionError('network');
  }
  if (response.status === 404) throw new SessionError('missing');
  if (response.status === 410) throw new SessionError('expired');
  if (!response.ok) throw new SessionError('network');
  let data: unknown;
  try { data = await response.json(); } catch { throw new SessionError('invalid'); }
  return parseChallenge(data, id, window.location.origin);
}

export async function submitProof(id: string, proof: SignedResponse): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/v1/sessions/${id}/response`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(proof), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new SessionError('network'); }
  if (response.status === 202) return;
  if (response.status === 409) throw new SessionError('duplicate');
  if (response.status === 404) throw new SessionError('missing');
  if (response.status === 410) throw new SessionError('expired');
  throw new SessionError('network');
}
