# Solana VPS Platform

A decentralized virtual private server platform where developers deploy Linux cloud nodes paid in native SOL with cryptographic wallet authentication.

## Stack

- Frontend: Next.js 16 (App Router), React 19, Tailwind CSS 4, Bun, Solana Wallet Adapter, Web3Icons
- Backend: Rust 2024 edition, Axum 0.8, Tokio, SQLx, SQLite persistent store
- Smart contract: Solana on-chain program (billing and access), native Anchor/Rust, System Program transfers
- Node access: Linux VPS, OpenSSH, pam_solana PAM module, solana-authd local daemon

## Architecture and System Flow

The architecture follows the specifications and PlantUML models in docs/diagrams:

1. System overview (docs/diagrams/system-overview.puml):
   - Browser client connects with Phantom, Solflare, or Backpack wallet to the web portal and communicates with the provider backend.
   - Provider backend coordinates order state, SQLite persistence, and payment verification against the Solana cluster.
   - User initiates SSH access through OpenSSH on the rented VM, authenticated via the pam_solana module and solana-authd daemon.
   - On-chain billing and access program governs server registration, subscriptions, access grants, and payment receipts.

2. Off-chain components (docs/diagrams/off-chain-components.puml):
   - Provider backend exposes REST APIs for order management and relays login challenges between the browser wallet and the authentication daemon.
   - Authentication gateway receives challenge publications from solana-authd, serves challenge bytes to the web portal, and allows solana-authd to poll the signed response.
   - Database stores orders and payment attempts with atomic state transitions.

3. On-chain components (docs/diagrams/on-chain-components.puml):
   - Program derived addresses track ServerRecord, Subscription, AccessGrant, and PaymentReceipt accounts.
   - Native SOL transfers credit the provider treasury account directly via System Program Cross Program Invocations.
   - Subscription and AccessGrant validity are verified by both the backend and the VPS daemon before activating access.

4. Billing and provisioning workflow (docs/diagrams/billing-and-provisioning.puml):
   - User selects plan and creates an order.
   - Backend reserves the server on-chain with payment terms.
   - User approves purchase transaction on-chain.
   - Program atomically transfers SOL and updates subscription, owner grant, and payment receipt.
   - Backend confirms finalized on-chain receipts via RPC, provisions the VM, and marks order ACTIVE.

5. SSH login workflow (docs/diagrams/ssh-login.puml):
   - User connects via SSH to target VM.
   - OpenSSH invokes pam_solana, which requests authentication from solana-authd over Unix domain socket.
   - solana-authd publishes a 90 second challenge to the backend gateway and outputs a login verification URL.
   - User opens the portal and signs the exact challenge payload with their Solana wallet.
   - solana-authd retrieves the signature, verifies the cryptographic proof, checks the on-chain AccessGrant and Subscription via RPC, and permits root shell access.

## Project Structure

- frontend/: Next.js client application with cluster switcher and wallet portal
- backend/: Axum HTTP service and SQLite persistence for order management
- programs/billing-access/: Solana on-chain billing and access control program
- ssh/: Linux PAM module (pam_solana) and local authentication daemon (solana-authd)
- docs/: Architectural design documents, system diagrams, and specifications
- shared/: Shared interface contracts, data models, and fixtures

## Commands

### Frontend
- Install: cd frontend && bun install
- Dev: cd frontend && bun run dev
- Build: cd frontend && bun run build
- Lint: cd frontend && bun run lint

### Backend
- Check: cargo check --manifest-path backend/Cargo.toml
- Build: cargo build --manifest-path backend/Cargo.toml
- Run: cargo run --manifest-path backend/Cargo.toml

## Context files

- [frontend/AGENTS.md](frontend/AGENTS.md) (Frontend Next.js client rules and conventions)
- [backend/AGENTS.md](backend/AGENTS.md) (Backend Axum service and API conventions)

<!-- drafted by audit skill -->
