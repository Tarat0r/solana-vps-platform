# Backend Service Context

Rust HTTP backend powering the Solana VPS platform, built with Axum, Tokio, and SQLite.

## Responsibilities

- Order management and database persistence at solana-vps.sqlite.
- Verification of finalized on-chain receipts and subscription states from the Solana RPC.
- Authentication gateway relaying daemon challenges and signed wallet responses.
- Idempotent virtual machine preparation status updates.

## Architecture and Contracts

- Follows docs/diagrams/off-chain-components.puml and docs/diagrams/billing-and-provisioning.puml.
- Endpoints adhere to models in backend/src/models.rs matching frontend/types/vps.ts.
- Serves HTTP REST on port 8080 with Cross Origin Resource Sharing enabled for frontend development.

## Database Schema

- orders table: order_id, name, owner_wallet, region, status, price_lamports, period_days, created_at, paid_until, host, port, username, tx_hash.
- delegates table: order_id, delegate_wallet, created_at.

## Commands

- Check: cargo check
- Build: cargo build
- Run: cargo run
- Test: cargo test

<!-- drafted by audit skill -->
