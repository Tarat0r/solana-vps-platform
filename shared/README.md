# Shared interfaces

**Status:** authentication contracts and Rust types exist under `ssh/`; the billing/access [IDL](billing-access/billing_access.json) is published here. Browser helpers and real integration fixtures are planned. Keep this folder for those additions rather than duplicating the working protocol.

| Interface | Compatibility baseline / remaining work |
| --- | --- |
| PAM/daemon IPC | [Contract v1](../ssh/CONTRACTS.md) and [protocol types](../ssh/auth-core/src/protocol.rs): preserve version, frames, account binding, cancellation, and fail-closed decisions |
| Gateway/browser/daemon | Same contract: exact challenge bytes, signature encoding, session endpoints, expiry, and daemon authentication |
| On-chain authorization | [Rust account definitions](../ssh/auth-core/src/accounts.rs): preserve layouts, discriminators, PDA seeds, bumps, roles, and validation |
| Program/dashboard/provider Bash script | [IDL](billing-access/billing_access.json) with program ID, instructions, account/receipt layouts, and errors; regenerate with `npm --prefix programs run build`. The dashboard's client ([frontend/src/billing.ts](../frontend/src/billing.ts)) is tested against this IDL |
| Payment recovery | Preserve payment ID and pending transaction metadata; verify finalized receipts and access state before displaying success or retrying an uncertain operation |
| Deployment identity | Non-secret cluster/program/provider/server ID and SSH connection details; daemon tokens and provider/wallet keys are never frontend configuration |

The program and gateway must fit the existing authentication contract. There are no order/database or backend-to-VM provisioning interfaces in the reduced product.

See [Architecture.md](../Architecture.md) for scope and the sequential roadmap.
