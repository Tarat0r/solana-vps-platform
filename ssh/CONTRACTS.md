# Authentication contract v1

This contract is provisional: the billing/access program and production gateway
are not implemented in this repository. Fixtures exercise real daemon validation;
they do not establish compatibility with a deployed program.

## Challenge and wallet proof

The exact signed bytes are UTF-8, LF-separated, ending in LF, in this order:
`VPS-ACCESS-AUTH/1`, `cluster`, `program_id`, `provider`, `server_id`, `unix_user`,
`session_id`, `nonce`, `issued_at`, `expires_at`, `auth_origin`. Fields after the
first line are `name=value`. Public keys are base58; server ID, session ID, and
nonce are 32 bytes encoded as lowercase hex. Times are integer UTC Unix seconds.
Lifetime is exactly 90 seconds. See the golden-byte test in auth-core.

Wallet responses contain `wallet` (base58 public key) and `signature_base64`
(standard padded base64 of a 64-byte Ed25519 signature). No transaction is signed.

## PAM IPC

Root-only Unix socket `/run/solana-authd.sock`; both peers must have UID 0.
One JSON object plus LF per frame, at most 16 KiB. Unknown fields are rejected.
Every message carries `version: 1`; sessions belong to their original connection.

1. PAM sends `{"op":"start","version":1,"unix_user":"ubuntu"}`.
2. Daemon sends `{"op":"challenge","version":1,"url":"...","expires_at":123}`.
3. PAM displays the URL and prompts the client to press Enter after signing.
4. PAM sends `{"op":"wait","version":1}` and waits for
   `{"op":"result","version":1,"allow":true,"reason":"authorized"}`.

`cancel` uses the same version field. Cancellation, EOF, malformed input, timeout,
or service failure denies the attempt. A connection can produce at most one
decision and cannot resume or consume another connection's session.

## Gateway HTTP API

- `POST /v1/sessions`: bearer-authenticated daemon publication of
  `{session_id, challenge_base64, expires_at}`; respond 201. Reject duplicate IDs.
- `GET /v1/sessions/{id}`: public retrieval of those exact fields; this is also
  the signing URL in the test gateway. A future frontend can render this route.
- `POST /v1/sessions/{id}/response`: submit the wallet proof; respond 202.
  One immutable response per live challenge; duplicates return 409.
- `GET /v1/sessions/{id}/response`: bearer-authenticated polling;
  respond 204 while pending, or 200 with the proof.
- `DELETE /v1/sessions/{id}`: bearer-authenticated cleanup, respond 204.

Absent/expired IDs return 404/410; bad authentication returns 401. Daemon tokens
never appear in URLs. TLS and a fixed public origin are required, except explicit
localnet tests with loopback HTTP. The daemon ignores gateway authorization claims
and verifies original challenge bytes, wallet proof, and RPC data itself.

## Solana accounts

All account public keys are 32-byte values; PDA literal seeds are ASCII. Use the
canonical Solana PDA bump search. Account bytes are the first eight bytes of
SHA-256(`account:<TypeName>`) followed by Borsh fields below, in order. Integers
are little-endian; booleans are 0/1; the bump is one byte. No trailing bytes.

| Type | Borsh fields | Seeds |
| --- | --- | --- |
| ServerRecord | provider:key, server_id:bytes32, owner_wallet:key, treasury:key, price_lamports:u64, period_seconds:i64, enabled:bool, bump:u8 | `server`, provider, server_id |
| Subscription | server:key, owner_wallet:key, paid_until:i64, bump:u8 | `subscription`, server address |
| AccessGrant | server:key, wallet:key, grant_type:u8 (owner=0, delegated=1), active:bool, valid_until:i64, bump:u8 | `grant`, server address, wallet |

RPC uses finalized `getAccountInfo` for owner discovery, then one finalized
`getMultipleAccounts` for server/subscription/owner grant/wallet grant with
`minContextSlot` from discovery. Revalidate the owner in the combined result.
Account owner must equal program ID, executable must be false, lamports positive,
and account data encoding must be base64. `getBlockTime` for the combined context
slot must be within 30 seconds of the synchronized VM clock. No authorization
cache or RPC-error fallback is permitted.
