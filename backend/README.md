# Backend

**Leads:** Anurag (orders/payments) and Vassil (authentication gateway/VM preparation)

Build one provider service for the POC.

- Store orders and payment attempts in persistent SQLite at `/data/solana-vps.sqlite`.
- Reserve server identities and coordinate provider-signed registration.
- Verify finalized on-chain receipts and reconcile uncertain payment results.
- Relay daemon-generated challenges and wallet responses through authenticated gateway APIs.
- Coordinate idempotent VM preparation and mark orders active only after readiness and valid paid access.

**Date:** 2026-10-11  
**Last Updated:** 2026-10-11  

Start by agreeing on API payloads, database states, retries, and readiness results in [shared/](../shared/). The gateway relays login data; `solana-authd` makes the access decision.

## Development and Verification

```bash
cargo check
cargo build
cargo run
```

See [Architecture.md](../Architecture.md).
