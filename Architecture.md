# Solana VPS Access Architecture

**Status:** Proposed proof of concept (POC)  
**Date:** 2026-10-11  
**Last Updated:** 2026-10-11  
**Environment:** Docker backend, SQLite file, one local Linux VM/VPS, Solana devnet or testnet  
**Billing:** Prepaid native SOL payments on Solana only  
**Authentication:** OpenSSH + Linux PAM + Solana wallet signature  
**Authorization:** On-chain subscription and wallet access grants
> Diagrams are displayed as SVG images for GitHub. Expand **Diagram source (PlantUML)** below each image to view the editable source. See [regeneration instructions](docs/diagrams/README.md).

<!-- TOC -->
- [1. Purpose and Scope](#1-purpose-and-scope)
- [2. System Requirements](#2-system-requirements)
  - [2.1. Functional Requirements](#21-functional-requirements)
  - [2.2. Security and Reliability Requirements](#22-security-and-reliability-requirements)
  - [2.3. Runtime and Development Requirements](#23-runtime-and-development-requirements)
- [3. Components and Responsibilities](#3-components-and-responsibilities)
  - [3.1. Overview](#31-overview)
  - [3.2. On-Chain Focus](#32-on-chain-focus)
  - [3.3. Off-Chain Focus](#33-off-chain-focus)
  - [3.4. Responsibilities](#34-responsibilities)
- [4. Server Identity and Local Configuration](#4-server-identity-and-local-configuration)
- [5. On-Chain Data and Instructions](#5-on-chain-data-and-instructions)
  - [5.1. On-Chain Entity Diagram](#51-on-chain-entity-diagram)
- [6. Solana-Only Billing and Provisioning Flow](#6-solana-only-billing-and-provisioning-flow)
- [7. Wallet Authentication Through SSH](#7-wallet-authentication-through-ssh)
  - [7.1. Login-Time Sequence Diagram](#71-login-time-sequence-diagram)
- [8. Authorization Decision and Expiration](#8-authorization-decision-and-expiration)
- [9. VPS Enforcement and Recovery](#9-vps-enforcement-and-recovery)
- [10. Local State and Audit Records](#10-local-state-and-audit-records)
  - [10.1. Off-Chain Entity Diagram](#101-off-chain-entity-diagram)
- [11. Testing](#11-testing)
  - [11.1. Test Environment](#111-test-environment)
  - [11.2. Test Execution](#112-test-execution)
- [12. Acceptance Scenarios](#12-acceptance-scenarios)
- [13. Work Breakdown](#13-work-breakdown)
  - [13.1. Vassil: PAM and Backend](#131-vassil-pam-and-backend)
  - [13.2. Anurag: Frontend and Backend](#132-anurag-frontend-and-backend)
  - [13.3. Bala: On-Chain Logic](#133-bala-on-chain-logic)
  - [13.4. Shared Interfaces and Integration Order](#134-shared-interfaces-and-integration-order)
- [14. Future Improvements](#14-future-improvements)
- [15. Commit History (Last 3 Days)](#15-commit-history-last-3-days)
<!-- /TOC -->


## 1. Purpose and Scope

Demonstrate that a user can pay for VPS access with SOL, authenticate with a wallet, and log in through normal SSH while an on-chain subscription is valid.

> **SOL payment activates the subscription → wallet signature proves identity → Solana grants authorize access → PAM allows SSH login.**

The architecture includes:

- one fixed VPS plan with a SOL price and a prepaid access period;
- purchase and manual renewal through a browser wallet;
- one provider-operated portal and authentication gateway;
- one Solana program for payments, subscriptions, and access grants;
- one owner wallet and basic delegation to additional wallets;
- one configured Linux account, such as `ubuntu`, for wallet-authenticated SSH;
- expiration, revocation, replay protection, and provider recovery access.

All billing payments use native SOL on the configured test cluster. Use test SOL on devnet or testnet for the demonstration; a local validator may be used for isolated program tests. Prices and durations are configured when the server is registered; amounts use integer lamports. The payer also pays transaction fees and any required account rent, separately from the plan price.

## 2. System Requirements

### 2.1. Functional Requirements

- **Wallet access:** Support wallet connection and message signing through Phantom or Solflare. Users connect through a standard OpenSSH client with keyboard-interactive authentication.
- **Purchase and renewal:** Offer one fixed SOL plan, reserve a server for its owner, and use wallet-signed transactions for purchase and manual renewal. Verify finalized receipts and subscription state before preparing the VM or marking an order paid.
- **Access control:** Admit an owner or authorized delegate only when the subscription and required grants are active and unexpired. Support delegation, revocation, and provider enable/disable controls.
- **Login authentication:** Generate a unique, server-bound and account-bound challenge for each SSH request; verify its Ed25519 signature, 90-second expiry, and single-use consumption before PAM allows login.
- **Provisioning:** Prepare the existing local VM, install and configure OpenSSH, PAM, and `solana-authd`, and report its SSH endpoint only after readiness checks pass. Repeated preparation must be safe and must not charge again.
- **Persistence and reconciliation:** Persist orders and payment attempts in SQLite, retain them across backend/container restarts, and reconcile uncertain payments against Solana before retrying.
- **Portal feedback:** Show payment and preparation status, paid-until time, renewal and delegation controls, wallet-signing context, and SSH connection instructions.
- **Recovery and audit:** Record order/payment transitions and login outcomes, and keep VM console recovery available independently of wallet authentication.

### 2.2. Security and Reliability Requirements

- Never request or store wallet private keys or seed phrases. The daemon validates the exact locally generated challenge and makes the authorization decision.
- Fail closed on invalid, expired, replayed, or mismatched challenges and on unavailable or stale RPC state. Use finalized reads for payment verification and login authorization.
- Protect root-owned VM configuration and the daemon's Unix socket; authenticate daemon/gateway communication and use HTTPS for externally reachable gateway endpoints.
- Use integer lamports, atomic on-chain payment/state changes, and stable payment IDs to prevent duplicate charges. Keep program authority credentials separate from the browser, gateway, and VPS daemon.
- Synchronize the VM clock. Apply the existing 30-second finalized-block freshness limit and avoid cached allow decisions.

### 2.3. Runtime and Development Requirements

| Component | Required environment |
|-----------|----------------------|
| Backend | Docker engine and a backend container with published portal/API ports and a persistent mount for the SQLite file. |
| Database | SQLite stored in a file, for example `/data/solana-vps.sqlite`; the backend container needs read/write access to its mounted directory. |
| VPS | A local Linux virtual machine with OpenSSH, Linux PAM, `pam_solana.so`, `solana-authd`, a synchronized clock, and console access. |
| On-chain program | A deployed program and reachable RPC on one selected Solana cluster: devnet or testnet. Provider, treasury, owner, and delegate test wallets need test SOL for their relevant transactions. |
| Client | A browser with Phantom or Solflare, a standard SSH client, and access to the portal and wallet-signing page. |
| Build tools | A Linux C toolchain and PAM development headers for the module, the selected backend/frontend toolchains, and Rust/Solana tooling for program builds and deployment. |
| Networking | Host/browser access to the backend and VM SSH endpoint; daemon access to the gateway and Solana RPC; backend access to RPC and its configured VM preparation channel. |

## 3. Components and Responsibilities

### 3.1. Overview

The main components and their labeled dependencies; internal details are expanded in the following two views.

![System overview](docs/diagrams/system-overview.svg)

[PlantUML source](docs/diagrams/system-overview.puml)

### 3.2. On-Chain Focus

The client wallet, provider backend, and VPS daemon connect through RPC to the Solana runtime. The billing/access program manages paid access and invokes the System Program for native SOL transfers.

![On-chain components](docs/diagrams/on-chain-components.svg)

[PlantUML source](docs/diagrams/on-chain-components.puml)

### 3.3. Off-Chain Focus

The backend runs as one process in a Docker container with a file-based SQLite DB. The Linux server separates SSH, PAM, and wallet verification. The daemon uses the Portal / Auth API to publish challenges and poll signed responses, and reads finalized access state through Solana RPC.

![Off-chain components](docs/diagrams/off-chain-components.svg)

[PlantUML source](docs/diagrams/off-chain-components.puml)

### 3.4. Responsibilities

| Component                 | Responsibility                                                                                                                                    |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| Browser portal and wallet | Show the SOL price, sign payment transactions, manage delegated wallets, sign SSH login challenges.                                               |
| Solana program            | Validate payment terms, transfer SOL, record receipts, extend subscription validity, enforce grant permissions.                                   |
| Provider backend          | Reserve the server, register its terms, verify on-chain payment, prepare the configured test VM, and track orders and payment attempts in the DB. |
| Authentication gateway    | Relay the VPS-generated challenge and wallet response over HTTPS.                                                                                 |
| `solana-authd`            | Verify wallet signatures and on-chain authorization, manage local login sessions, return allow/deny.                                              |
| `pam_solana.so`           | Integrate with OpenSSH, display the authentication URL, communicate with the daemon, return a PAM result.                                         |

The backend stores orders, payment attempts, and target preparation status in the DB. Its portal, order service, and authentication gateway run in one process. Solana is the source of truth for payment receipts and paid access validity.

## 4. Server Identity and Local Configuration

Use a random, stable 32-byte `server_id` for the logical VPS. Changing its IP address does not change its subscription or grants.

The DB and the local test configuration map:

```text
DB Order.order_id -> server_id -> configured test VM / SSH endpoint
```

The test VM address and SSH port stay in local configuration; no VPS inventory table is needed for one target. The on-chain server record binds the server to its provider, owner wallet, and payment terms.

Provision the VPS with:

```toml
# /etc/solana-auth/server.toml
cluster = "devnet"
rpc_url = "https://api.devnet.solana.com"
program_id = "<deployed-program-public-key>"
provider_pubkey = "<provider-public-key>"
server_id = "<32-byte-server-id-as-hex>"
unix_user = "root"
auth_gateway = "https://auth.provider.example"
commitment = "finalized"
challenge_ttl_seconds = 90
```

The provider installs this root-owned configuration. Wallet input cannot choose a different server, program, cluster, or Linux account.

## 5. On-Chain Data and Instructions

One program owns the following accounts:

| Account          | Main fields                                                                                              | PDA seeds                                 |
|------------------|----------------------------------------------------------------------------------------------------------|-------------------------------------------|
| `ServerRecord`   | Provider, server ID, reserved owner wallet, treasury, price in lamports, period in seconds, enabled flag | `server`, provider public key, server ID  |
| `Subscription`   | Server, owner wallet, paid-until timestamp                                                               | `subscription`, server record             |
| `AccessGrant`    | Server, wallet, grant type (`OWNER` / `DELEGATED`), active flag, valid-until timestamp                   | `grant`, server record, wallet public key |
| `PaymentReceipt` | Server, payer, payment ID, amount, paid-at timestamp, resulting paid-until timestamp                     | `payment`, server record, payment ID      |

Each payment ID is a unique 32-byte value. All seed encodings are fixed, and all accounts include their account discriminator and PDA bump.

```text
Provider-signed:
  register_server(server_id, owner_wallet, treasury, price_lamports, period_seconds)
  set_server_enabled(enabled)

Owner-signed:
  purchase_access(payment_id)
  renew_access(payment_id)
  grant_delegated_access(wallet, valid_until)
  revoke_delegated_access(wallet)
```

`register_server` reserves the server for its owner and initializes an unpaid subscription. It requires a positive price and period. Payment terms are immutable for that server record.

`purchase_access` requires the reserved owner's signature and an unpaid subscription. `renew_access` requires the same owner's signature and a previously purchased subscription. Both instructions:

1. Validate the program-owned server, subscription, grant, and receipt PDA addresses and their relationships.
2. Require an enabled server and the exact treasury configured in its server record.
3. Create a new receipt; reject an already-used payment ID.
4. Transfer the configured SOL price from the signing owner's wallet to the treasury through the System Program.
5. Calculate `paid_until = max(current_chain_time, previous_paid_until) + period_seconds`, with checked arithmetic.
6. Create or update the owner's active access grant to the new paid-until timestamp and write the receipt.

The SOL transfer and state updates happen in the same transaction. If any step fails, the whole transaction rolls back. The backend cannot activate or extend paid access without a successful on-chain payment.

Only an active owner with an unexpired subscription can create or revoke delegated grants. Delegation instructions reject the reserved owner wallet as their target and cannot overwrite its owner grant. Delegates cannot renew, delegate further, or change the owner. A delegated grant cannot extend beyond the paid subscription. Renewal extends the owner grant; delegates retain their existing expiry until the owner explicitly updates them.

Disabling the server denies all new wallet logins, including the owner's. Payments are rejected while it is disabled.

### 5.1. On-Chain Entity Diagram

![On-chain entity diagram](docs/diagrams/on-chain-entities.svg)

[PlantUML source](docs/diagrams/on-chain-entities.puml)

## 6. Solana-Only Billing and Provisioning Flow

![SOL billing and provisioning flow](docs/diagrams/billing-and-provisioning.svg)

[PlantUML source](docs/diagrams/billing-and-provisioning.puml)

The backend accepts a wallet transaction signature as a tracking hint, then independently verifies the finalized program-owned receipt, server, payer, amount, payment ID, and subscription. A browser callback or a standalone SOL transfer to the treasury cannot mark an order paid.

```text
CREATED -> PAYMENT_PENDING -> PAID -> PROVISIONING -> ACTIVE
                                             |
                                             +-> PROVISIONING_FAILED

ACTIVE -> EXPIRED
EXPIRED -> ACTIVE after finalized renewal, if the VM remains available
```

The backend registers the server before presenting payment to the owner. It starts provisioning only after payment finalizes and marks the order active only after the VM is ready and the subscription is still valid.

The access period starts when payment executes on-chain. Provisioning time therefore consumes part of that period; use a sufficiently long demonstration period and show the paid-until time in the portal.

Renewal uses `renew_access` with a new payment ID. No scheduled debit or automatic wallet signing occurs. After renewal finalizes, the next SSH login reads the updated subscription.

Persist the payment ID before submitting a transaction. If confirmation times out, query the receipt and transaction status before retrying. An uncertain result must not trigger a new payment ID. Reuse the same payment ID when resubmitting a transaction that has definitively expired without execution; its receipt prevents a second charge.

A provisioning failure stays visible as `PROVISIONING_FAILED`. Retry provisioning against the same order and server ID without taking another payment. Recovery is manual; access remains prepaid.

## 7. Wallet Authentication Through SSH

The user connects with the standard client:

```bash
ssh ubuntu@<vps-ip>
```

For a local VM with SSH forwarded to the host, use `ssh -p 2222 ubuntu@127.0.0.1`.

OpenSSH invokes PAM through keyboard-interactive authentication. The PAM module asks `solana-authd` to create a login session and displays its HTTPS URL. The user opens the URL and signs the exact challenge with Phantom or Solflare.

```text
VPS-ACCESS-AUTH/1
cluster=devnet
program_id=<program-public-key>
provider=<provider-public-key>
server_id=<server-id>
unix_user=ubuntu
session_id=<random-session-id>
nonce=<cryptographically-random-nonce>
issued_at=<UTC-timestamp>
expires_at=<UTC-timestamp>
auth_origin=https://auth.provider.example
```

The daemon keeps the authoritative session locally. Each challenge expires after 90 seconds and belongs to one waiting SSH authentication request. The gateway relays the wallet public key and signature; the daemon verifies Ed25519 over the exact locally stored bytes.

A session succeeds only once. Expired, cancelled, consumed, mismatched, and invalidly signed sessions are denied. Atomic session consumption prevents parallel replies from reusing a challenge. Gateway responses cannot replace the challenge, wallet authorization decision, or requested Linux account.

Signing a login challenge requires no Solana transaction or transaction fee. Payment transactions and login signatures have separate purposes and formats. The system never requests or stores a wallet private key or seed phrase.

### 7.1. Login-Time Sequence Diagram

![Wallet-authenticated SSH login sequence](docs/diagrams/ssh-login.svg)

[PlantUML source](docs/diagrams/ssh-login.puml)

## 8. Authorization Decision and Expiration

For each new SSH login, `solana-authd` reads the server, subscription, owner grant, and signing wallet's grant in one finalized RPC account read. It validates account ownership, discriminators, PDA derivation, and all server/wallet relationships.

Allow access only when:

```text
wallet signature is valid for this unused, unexpired login session
AND configured Linux account matches the SSH request
AND server is enabled
AND subscription belongs to the reserved owner and has not expired
AND owner grant is active and has not expired
AND signing wallet has an active, unexpired OWNER or DELEGATED grant
```

Use a synchronized VPS clock for time checks. On-chain instructions use Solana's Clock sysvar. Reject a login if RPC state cannot be read or validated, or the RPC reports a finalized block time more than 30 seconds behind the VPS clock. The daemon uses fresh reads for every authentication decision and no cached allow decisions. Run the local validator continuously so finalized state remains fresh; the same freshness check applies to local tests.

Expired subscriptions deny the owner and all delegates without requiring a backend transaction. Revoked delegated grants and disabled servers deny new logins once the changed state is finalized and observed by RPC.

This check runs at login. Subscription expiry or grant revocation does not terminate an already established SSH session. Linux permissions and the configured account determine what an admitted user can do.

## 9. VPS Enforcement and Recovery

Configure OpenSSH for PAM and keyboard-interactive authentication:

```text
UsePAM yes
KbdInteractiveAuthentication yes
PasswordAuthentication no
PermitRootLogin no

Match User ubuntu
    AuthenticationMethods keyboard-interactive:pam
```

For the demonstration account, configure the PAM authentication stack to require `pam_solana.so` without a password fallback. Check the target distribution's OpenSSH/PAM behavior from the provider console before applying it to remote access.

`pam_solana.so` performs only local IPC and PAM conversation handling. `solana-authd` handles sessions, signatures, HTTPS, and RPC. Protect `/run/solana-authd.sock` with restrictive permissions and verify local peer credentials; unauthorized processes cannot submit authentication decisions.

Keep provider serial-console or rescue access independent of wallet authentication. Test that recovery path before enabling the PAM flow. Protect the provider's program authority and treasury configuration; the VPS and gateway do not hold the owner's keys or the provider registration authority.

## 10. Local State and Audit Records

Run one backend process in a Docker container with a SQLite database file on a persistent mounted volume and one pre-created local Linux test VM. The backend provides the portal, order endpoints, and authentication gateway. For local tests, provisioning means preparing and configuring this VM; no cloud inventory service is required.

Keep two small tables. `Order` tracks the server reservation and target preparation. `PaymentAttempt` tracks each purchase or renewal separately, so a new renewal does not overwrite the original payment ID. Persist each payment ID before submission and reconcile its receipt on Solana after confirmation, an uncertain result, or a backend restart.

### 10.1. Off-Chain Entity Diagram

![Off-chain entity diagram](docs/diagrams/off-chain-entities.svg)

[PlantUML source](docs/diagrams/off-chain-entities.puml)

`TestTargetConfig` is local test-runner configuration. It describes one VM reachable through a forwarded SSH port, for example `127.0.0.1:2222`. Install the relevant server identity, RPC, account, and gateway settings as the root-owned `/etc/solana-auth/server.toml` inside the VM. The SSH host and port stay in the test runner's configuration.

For local-validator tests, use `cluster = "localnet"` and the validator's RPC endpoint. The VM must reach the validator and backend through a VM-accessible host address or port forwarding; its own `127.0.0.1` refers to the VM. Configure the browser wallet for the same validator. Use devnet settings when testing against devnet.

A loopback-only gateway on the host can use HTTP during local testing. Bind the authentication challenge to that exact origin and expose it to the VM through restricted forwarding. Use HTTPS for externally reachable deployments.

Write payment, target preparation, renewal, delegation, and login outcomes to a local JSONL audit log with server ID, wallet where applicable, timestamp, and reason. A local log file is sufficient for audit records. Do not log challenge URLs, session tokens, nonces, or full signed challenges.

Payment status in the DB is a reconciled local view; Solana remains the source of truth for paid access. Preparing the same test target twice must not create another order, VM, or charge.

## 11. Testing

### 11.1. Test Environment

| Component | Test setup |
|-----------|------------|
| Backend | Run the backend in a Docker container and publish the portal/authentication API to the development host. |
| Database | Use a SQLite file on a bind mount or named volume so order and payment records survive container recreation. |
| On-chain logic | Deploy and test on devnet or testnet with test SOL. Configure every component and wallet for the same cluster and program ID. A local validator is optional for isolated program tests. |
| VPS | Use one pre-created local Linux virtual machine with OpenSSH, PAM, and `solana-authd`, plus independent console recovery. |
| SSH endpoint | Use a local endpoint such as `127.0.0.2` on the development host when VM SSH port forwarding is configured; record the actual forwarded port in local configuration and portal instructions. |

`127.0.0.2` is a loopback address. It can expose the VM's SSH service through host-side forwarding; it is not the VM's guest-network address. Inside a Docker container, it refers to that container's loopback. Configure backend-to-VM traffic with a reachable VM address or host gateway/forwarded port, and configure daemon-to-backend traffic with an address reachable from the VM.

Keep the same `server_id` across the backend, program accounts, and VM configuration. Start with separate provider, treasury, owner, and delegate test wallets and a funded owner wallet. Confirm gateway/RPC connectivity and VM console recovery before enabling wallet-only SSH.

### 11.2. Test Execution

1. **Component checks:** Bala tests program account validation, atomic payments, renewal, delegation, and revocation. Vassil tests PAM/daemon signature validation, challenge expiry/replay, authorization, and recovery. Anurag tests wallet connection, signing, and portal flows; Vassil and Anurag test their shared backend APIs with fixtures.
2. **Integration checks:** Run purchase → finalized payment verification → VM preparation → wallet signature → SSH login using the Docker backend, persistent SQLite file, selected Solana cluster, and local VM.
3. **Lifecycle and failure checks:** Run every acceptance scenario in the next section, including expiry/renewal, revocation, duplicate notifications, uncertain payment results, provisioning retry, and RPC/gateway failures.
4. **Persistence and repeatability:** Restart/recreate the backend container with the same SQLite mount and verify that existing orders/payment attempts reconcile without duplicate charges. Restart the daemon and verify that pending challenges are invalidated. Repeat the demo from a clean documented setup.

Record the cluster, program ID, transaction signatures, order/payment IDs, component logs, and expected versus actual outcomes for each integration run. Keep local console access available throughout PAM/SSH testing.

## 12. Acceptance Scenarios

The demonstration is complete when these checks pass:

- **Purchase:** An owner pays the exact SOL price; treasury balance increases by the price, and receipt, subscription, and owner grant update atomically.
- **Payment rejection:** A wrong treasury, wrong owner, insufficient funds, disabled server, or reused payment ID cannot create or extend access; failed transactions leave billing state unchanged.
- **Provisioning:** Only a finalized valid receipt starts provisioning. A repeated confirmation or provisioning retry does not charge twice or create another VM.
- **Login:** The paid owner signs a fresh challenge and enters the configured Linux account through normal OpenSSH.
- **Delegation:** The owner grants a second wallet access; that wallet can log in until its grant is revoked or expires.
- **Expiry and renewal:** An expired subscription denies new logins; a finalized SOL renewal extends the term and restores access.
- **Replay and binding:** A consumed challenge, expired challenge, wrong signature, or challenge for another server/account is denied.
- **Failure and recovery:** RPC or gateway failure denies wallet login, and the provider can still access the VPS through its recovery console.

## 13. Work Breakdown

Divide the POC into three workstreams. Backend work is shared by Vassil and Anurag, with the API boundary agreed before implementation.

| Developer | Primary ownership | Deliverables |
|-----------|-------------------|--------------|
| 1. Vassil | PAM + backend | `pam_solana.so`, `solana-authd`, VM/SSH setup and recovery, authentication gateway/session APIs, VM preparation and readiness integration. |
| 2. Anurag | Frontend + backend | Wallet-connected portal, purchase/renewal and delegation UI, order/payment APIs, SQLite records, finalized payment reconciliation, and Docker backend setup. |
| 3. Bala | On-chain logic | Solana program, account/instruction definitions, client helpers, deployment configuration, and program tests. |

### 13.1. Vassil: PAM and Backend

- Prepare the local Linux VM and repeatable installation/configuration scripts for OpenSSH, PAM, `solana-authd`, and root-owned `server.toml`.
- Implement PAM conversation handling and protected Unix-socket communication with the daemon.
- Generate canonical login challenges; verify signatures, session/account/server binding, expiry, and atomic single-use consumption.
- Read finalized accounts using Bala's definitions and enforce all authorization conditions, including account/PDA validation and RPC freshness checks.
- Implement authentication gateway publication, retrieval, signed-response submission, and daemon polling. Preserve exact challenge bytes and keep the authorization decision in `solana-authd`.
- Provide idempotent VM preparation and readiness checks, and integrate them with Anurag's order workflow.
- Own SSH login, replay/binding, failure/recovery, and VM preparation checks; document console recovery before enabling the PAM flow.

### 13.2. Anurag: Frontend and Backend

- Build wallet connection, fixed-plan purchase, manual renewal, paid-until display, delegation/revocation controls, wallet-signing pages, and SSH instructions.
- Implement `Order` and `PaymentAttempt` records in SQLite and the documented order state transitions; persist payment IDs before transaction submission.
- Register reserved servers through Bala's program, construct wallet-signed transactions, and independently verify finalized receipts and subscription state.
- Reconcile uncertain transactions and make repeated confirmations and provisioning requests idempotent. Retry `PROVISIONING_FAILED` without taking another payment.
- Integrate Vassil's authentication APIs and VM preparation checks; show `ACTIVE` only after readiness succeeds.
- Package the backend in Docker with a persistent SQLite mount and documented networking configuration.
- Own backend/UI preparation checks, duplicate confirmations, uncertain payments, persistence after restart, and preparation retries.

### 13.3. Bala: On-Chain Logic

- Implement `ServerRecord`, `Subscription`, `AccessGrant`, and `PaymentReceipt` with the defined PDA seeds and validation rules.
- Implement server registration and enable/disable controls, purchase, renewal, and delegated grant/revocation instructions.
- Transfer the exact SOL amount to the configured treasury atomically with receipt, subscription, and owner-grant updates; reject duplicate payment IDs and invalid accounts or signers.
- Publish the program ID, account layouts, instruction definitions/IDL, PDA derivation helpers, errors, and example transactions for Vassil and Anurag.
- Deploy to the selected devnet/testnet cluster and provide repeatable setup for provider, treasury, owner, and delegate wallets.
- Own purchase/payment rejection and on-chain expiry/renewal and delegation/revocation checks, including rollback on failure.

### 13.4. Shared Interfaces and Integration Order

| Interface | Lead | Agreement needed |
|-----------|------|------------------|
| On-chain/client contract | Bala | Cluster, program ID, account layouts, PDA seed encodings, instruction arguments, errors, payment IDs, and finalized-state fixtures. |
| Gateway/daemon/frontend contract | Vassil defines sessions and gateway APIs; Anurag integrates the UI | Exact signed bytes, session IDs, publish/fetch/submit/poll payloads, daemon authentication, expiry, and error responses. |
| Order/payment persistence | Anurag, coordinated with Vassil | SQLite schema and volume path, order/payment states, API payloads, reconciliation, and retry behavior. |
| Backend/VM preparation | Vassil supplies setup and readiness checks; Anurag integrates the order flow | Server/configuration inputs, reachable endpoints, execution method, idempotent retries, readiness results, and failure reporting. |

1. **Agree on contracts and fixtures:** Select devnet or testnet, assign test wallets, define shared APIs, and fix VM/container networking. Bala provides account/transaction fixtures, Vassil provides canonical challenge and PAM/daemon fixtures, and Anurag provides order/payment and portal fixtures.
2. **Build each workstream:** Vassil implements PAM/daemon and authentication backend, Anurag implements the portal and order/payment backend, and Bala implements and tests the program.
3. **Integrate purchase and first login:** Connect the real program, finalized payment verification, VM preparation, wallet signing, and SSH access. Demonstrate a paid owner reaching the configured shell.
4. **Complete lifecycle and failure checks:** All three developers verify delegation/revocation and expiry/renewal together and run the testing and acceptance scenarios.

Each developer maintains setup instructions and tests for their workstream. The POC is complete when the combined system passes every acceptance scenario and another team member can reproduce the demo from a clean setup.

## 14. Future Improvements

Possible extensions are:

- SPL-token billing on Solana, including USDC, with explicit mint and token-program validation.
- Multiple plans, providers, regions, and price changes with versioned payment terms.
- Activation-based billing periods, on-chain escrow, and defined refund handling for provisioning failures.
- Wallet-authorized recurring payment mechanisms with explicit spending limits and revocation.
- Separate Linux accounts per wallet, richer team roles, and permission-aware `sudo` integration.
- Active-session revalidation and termination policies after expiry or revocation.
- RPC redundancy, subscription monitoring, and bounded authorization caching with measured revocation delays.
- Multisig provider administration, owner-wallet replacement, and wallet recovery procedures.
- Production hardening, independent program/security reviews, and a mainnet rollout.

## 15. Commit History (Last 3 Days)

This section summarizes commits authored by Anurag Borkar over the last 3 development days (October 9 to October 11, 2026), covering the frontend and backend integration workstreams.

| Date | Commit | Component | Description |
|------|--------|-----------|-------------|
| 2026-10-09 | `8f99463` | Backend | Implement Axum 0.8 service with SQLite persistence and order handlers |
| 2026-10-09 | `849df9c` | Frontend | Build decentralized Solana VPS platform UI with PAM auth and terminal console |
| 2026-10-10 | `2a1ffe2` | Integration | Merge develop/backend into develop/frontend |
| 2026-10-10 | `f78d2fa` | Frontend | Integrate live backend API endpoints for orders and payment verification |
| 2026-10-11 | `ac1463a` | Frontend | Add localnet cluster support, Web3Icons integration, and clean button styles |
| 2026-10-11 | `4b1a714` | Fullstack | Implement auth gateway relay, payment attempts lifecycle, and SSH verification portal |
| 2026-10-11 | `d68f1b5` | Frontend | Scaffold Next.js 16 app with wallet adapters and UI primitives |
| 2026-10-11 | `afd44d4` | Frontend | Implement streamlined header, cluster switcher, and landing hero |
| 2026-10-11 | `ef09326` | Frontend | Add AMD EPYC hardware tiers, pricing calculator, and architecture showcase |
| 2026-10-11 | `698921e` | Frontend | Add PAM auth gateway verification portal, terminal console, and views |

For the complete log and detailed file changes, see [docs/commit-history.md](docs/commit-history.md).
