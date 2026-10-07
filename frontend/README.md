# Frontend

**Lead:** Anurag

Build the wallet-connected portal for Phantom and Solflare.

- Purchase and renew access with wallet-signed SOL transactions.
- Show order/preparation status, paid-until time, and SSH instructions.
- Manage delegated access and revocation.
- Display and sign the daemon's exact SSH challenge.

Start with the order/payment and challenge contracts in [shared/](../shared/). The backend verifies payment status; the daemon decides SSH access. Add setup and run commands when the frontend is implemented.

See [Architecture.md](../Architecture.md).
