# Billing and access program

**Lead:** Bala

- Define `ServerRecord`, `Subscription`, `AccessGrant`, and `PaymentReceipt` accounts and their PDA seeds.
- Implement provider-signed `register_server` and `set_server_enabled` instructions.
- Implement owner-signed `purchase_access`, `renew_access`, `grant_delegated_access`, and `revoke_delegated_access` instructions.
- Transfer native SOL and update receipts, subscriptions, and owner grants atomically.
- Enforce signer/account relationships, unique payment IDs, expiry, delegation limits, and disabled-server behavior.

Start by sharing account layouts, seed encodings, instruction arguments, errors, and fixtures in [shared/](../../shared/). Add build, deployment, and test commands when the toolchain is selected. Use a local validator for isolated tests and devnet/testnet for the integrated POC.

See [Architecture.md](../../Architecture.md).
