# solana-authd

**Lead:** Vassil

Implement the VPS authentication daemon.

- Load the root-owned server configuration and serve a protected Unix socket with peer checks.
- Create server/account-bound challenges with a 90-second expiry and single-use sessions.
- Exchange challenges and signed responses with the backend gateway over authenticated HTTPS.
- Verify Ed25519 signatures and finalized Solana accounts, relationships, grants, and freshness.
- Atomically consume successful sessions and return allow/deny to PAM; fail closed on errors.

Start with challenge bytes, IPC, gateway contracts, and program fixtures in [shared/](../../shared/). Log outcomes without exposing session tokens or full challenges. Add build, service, and test commands with the implementation.

See [Architecture.md](../../Architecture.md).
