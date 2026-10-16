# Solana Wallet Authentication for SSH

Sign in to an existing Linux server with a Solana wallet through OpenSSH and PAM. The daemon verifies the wallet's signature and finalized on-chain access records before allowing a new login.

The target product adds a small owner dashboard for native SOL payments, renewal, and delegated access, plus a browser page for signing SSH challenges with Phantom or Solflare. Servers are prepared in advance; provider registration and enable/disable operations use a simple operator-run Bash script. A dedicated provider CLI is outside the MVP scope.

## Current status

- **Implemented:** `pam_solana.so`, `solana-authd`, shared signature/account validation, and a Debian 13 QEMU/OpenSSH test harness.
- **Implemented program:** the Anchor billing/access program and provider Bash script. LiteSVM tests check its accounts with the daemon's decoder. On a local validator, the script registers a server and the daemon's RPC reader authorizes logins from finalized program state. It is not yet deployed to devnet.
- **Test fixtures:** simulated authentication gateway and Solana RPC responses, with a command-line wallet signer. These exercise real PAM, SSH, and cryptography, but do not deploy a program, transfer SOL, or test browser wallets.
- **Implemented UI/gateway:** an Axum session gateway and React signing page for Phantom/Solflare, with a terminal QR code and signing link. Browser tests use provider doubles with real message signatures.
- **Implemented dashboard:** the owner page buys and renews access with SOL, shows expiry, SSH instructions, and payment history, shares and revokes access, and recovers interrupted payments. Browser tests run it against the program on a local validator.
- **Planned:** devnet deployment of the program and real-wallet HTTPS/devnet integration.

The simplification preserves the existing authentication code and contracts. VPS ordering, inventory, automated provisioning, order tracking, and a database are outside the product scope. Docker is not required; an optional [compose file](backend/README.md#run-with-docker) runs the gateway and frontend.

## Development

Start with [Architecture.md](Architecture.md) for the reduced design and solo-developer roadmap. [Authentication contract v1](ssh/CONTRACTS.md) defines the compatibility baseline for the remaining components.

| Folder | Purpose |
| --- | --- |
| [ssh/](ssh/README.md) | Working PAM module, authentication daemon, and local SSH tests |
| [programs/](programs/README.md) | Solana billing/access program and provider Bash script |
| [frontend/](frontend/README.md) | Owner dashboard and SSH signing page |
| [backend/](backend/README.md) | Axum authentication gateway and frontend hosting |
| [shared/](shared/README.md) | Contract references, program IDL, and planned client helpers/fixtures |
| [infra/](infra/README.md) | Manual server installation and service deployment guidance |
| [tests/](tests/README.md) | Existing VM image prerequisite and future integrated acceptance scenarios |

To build and test everything, install the prerequisites in [the SSH README](ssh/README.md) and [the program README](programs/billing-access/README.md#build-and-test), then run from the repository root:

```sh
./test-all.sh            # add --stop-vm to stop the Debian VM after a successful run
```

It runs the static checks first, then builds and tests the billing program, then runs the SSH pipeline: frontend, gateway, signing and dashboard browser tests, daemon/PAM checks, and the Debian/OpenSSH VM suite. It stops at the first failure and names the failed stage.

To run only the static checks, which take a few minutes and need no VM or validator:

```sh
./static-analysis.sh
```

It fails on any finding:

- **Secrets:** gitleaks scans git history and exactly the files git would commit ([.gitleaks.toml](.gitleaks.toml)), and the script checks that `.run/`, `.env`, and VM state stay git-ignored.
- **Shell and Docker:** ShellCheck on every script, hadolint on the gateway Dockerfile, and `docker compose config`.
- **Rust**, in `backend/`, `ssh/`, and `programs/`: rustfmt, Clippy with the lint levels in each `Cargo.toml`, and cargo-deny for advisories, licenses, and crate sources ([deny.toml](deny.toml)). Unsafe code is denied except in the PAM module and daemon, where every unsafe block needs a `SAFETY:` comment. [clippy.toml](clippy.toml) allows `unwrap` only in tests.
- **Solana program:** [Radar](https://github.com/Auditware/radar) runs its Anchor vulnerability templates on the billing program and fails on any finding ([details](programs/billing-access/README.md#static-analysis)).
- **TypeScript**, in `frontend/`, `ssh/`, and `programs/`: strict `tsc` and `npm audit`, plus ESLint in the frontend.

Accepted advisories and lint exceptions carry their reasons where they are declared. It needs Docker and cargo-deny (`cargo install --locked cargo-deny`); ShellCheck, hadolint, and gitleaks run from pinned Docker images unless they are installed, and Radar always runs in Docker. The first run pulls about 2 GB of Radar images.

To build and run the whole system for manual testing with a browser wallet (Docker is also needed here):

```sh
./run.sh --fund <wallet address>         # repeat --fund per wallet; add --no-vm to skip the Debian VMs
./run.sh down                            # stop it and restore the VMs' test setup
```

It starts `solana-test-validator` with the program, registers two servers for sale, and airdrops 10 SOL to each `--fund` wallet. Without `--fund`, it funds the keypair in `.run/owner.json`. It also runs the gateway and frontend in Docker at `http://127.0.0.1:3000`. Each server has its own Debian VM, whose daemon it points at that server, the validator, and the gateway: server 1 is `ssh -p 2222 ubuntu@127.0.0.2`, server 2 is `ssh -p 2222 ubuntu@127.0.0.3`. The two VMs use about 4 GB of memory together. Set your wallet to localnet (`http://127.0.0.1:8899`), pick a server and buy access in the dashboard, then SSH to that server and approve its signing link. Any wallet can buy a server; once the buyer's subscription expires it is for sale again. The chain restarts empty on every run.

To run the same setup against Solana devnet:

```sh
./run.sh --devnet --fund <wallet address>    # FUND_SOL (default 1) per wallet, sent from the provider key
```

The first run creates the provider key in `.run/devnet/` and stops with its address: fund it with about 3 SOL at [faucet.solana.com](https://faucet.solana.com) and rerun. It deploys the program with that key, which becomes the upgrade authority, and registers two servers for 0.01 SOL: server 1 for 30 days and server 2 for 10 minutes, to show expiry and renewal. Devnet keeps its state, so later runs skip the deployment and registrations unless the program build changed. The VMs' daemons read devnet through `https://api.devnet.solana.com` (set `RPC_URL` for another HTTPS RPC), and the gateway stays on loopback HTTP: `local_test` allows that on devnet, so sign with a desktop wallet extension, not a phone. Set your wallet to devnet (Phantom: Settings → Developer Settings → Testnet Mode; Solflare: Settings → Network). Stop it with `./run.sh down`.

To run only the gateway and frontend in Docker, see [Run with Docker](backend/README.md#run-with-docker).

The eventual integrated demonstration uses Solana devnet and one existing Debian VM. The current fixture suite uses `localnet`. Expiry and revocation deny new logins and end open SSH sessions, after a one-minute warning at expiry.
