# solana-authd

Run `solana-authd /etc/solana-auth/server.toml` as root with a root-owned mode-0600
configuration. The daemon accepts root Unix-socket peers and at most 64 concurrent
connections. Each session belongs to one connection, lasts 5 minutes, and can
return success once. Restart invalidates all pending local sessions.

It publishes exact challenge bytes, polls wallet responses, verifies strict
Ed25519 signatures, and checks a combined finalized account snapshot: PDA
addresses/bumps, discriminators, program ownership, wallet/server relationships,
grants, subscription expiry and block-time freshness. Malformed data, disconnects
and network failures deny authentication.

See [the contract](../CONTRACTS.md), [setup/tests](../README.md) and
[sample configuration](../deploy/server.toml.example). Audit records exclude
session URLs, tokens, nonces, full challenges and signatures.
