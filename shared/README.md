# Shared interfaces

**Leads:** Vassil, Anurag, and Bala

Agree on these contracts before connecting the implementations. This folder will hold interface definitions, client helpers, and non-secret fixtures as they are created.

| Contract | Lead | Define first |
| --- | --- | --- |
| Solana program/client | Bala | Cluster/program ID, account layouts, PDA seed encodings, instructions, errors, and payment fixtures |
| Authentication | Vassil, with Anurag | Exact challenge bytes, wallet signature encoding, expiry, gateway publish/fetch/submit/poll payloads, and daemon authentication |
| PAM/daemon IPC | Vassil | Request/response format, Linux account binding, timeouts, cancellation, and result codes |
| Orders/payments | Anurag, with Vassil | API payloads, SQLite states, payment IDs, reconciliation, and retry behavior |
| VM preparation | Vassil, with Anurag | Server configuration, reachable endpoints, idempotent preparation, readiness, and failure results |

See [Architecture.md](../Architecture.md).
