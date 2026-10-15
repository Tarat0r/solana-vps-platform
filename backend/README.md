# Authentication gateway

**Status: implemented in Rust with Axum 0.8 and Tokio.** This standalone Cargo package reuses the daemon's `auth-core` challenge/proof types. The gateway in [the SSH test services](../ssh/test-services/src/main.rs) remains a separate fixture with synthetic RPC data and test controls.

The service serves the frontend, including the owner dashboard and its non-secret settings, and relays login challenges and wallet responses. It keeps up to 256 live sessions in memory and limits JSON requests to 16 KiB. Published challenge bytes are limited to 4096 bytes and signatures to 64 bytes. A restart loses pending sessions, so the user starts a new SSH attempt. No application database or Docker deployment is required.

Preserve [authentication contract v1](../ssh/CONTRACTS.md):

| Endpoint | Responsibility |
| --- | --- |
| `POST /v1/sessions` | Bearer-authenticated daemon publication; return 201 and reject duplicate IDs |
| `GET /v1/sessions/{id}` | Public retrieval of the exact published challenge; render the signing page for HTML requests and retain JSON for API clients |
| `POST /v1/sessions/{id}/response` | Accept one wallet proof per live session; return 202, or 409 for duplicates |
| `GET /v1/sessions/{id}/response` | Bearer-authenticated daemon polling; return 204 while pending or 200 with the proof |
| `DELETE /v1/sessions/{id}` | Bearer-authenticated cleanup; return 204 |
| `GET /v1/dashboard` | Public dashboard settings from `SOLANA_DASHBOARD_CONFIG`; 404 when not configured |

HTML session requests receive the signing page; JSON requests, wildcard requests, and clients without `Accept` retain the published JSON representation. Session responses include `Vary: Accept` and `Cache-Control: no-store`. Missing and expired HTML views retain HTTP 404/410 and let the frontend display recovery instructions. Static files are served only from the build's assets directory. The service has no fixture-control or synthetic RPC endpoints.

## Build and run

From the repository root, build the frontend, set `SOLANA_GATEWAY_TOKEN` to the same secret as `gateway_token` in the daemon's root-owned configuration, then start the backend:

```sh
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend run build
cargo run --locked --manifest-path backend/Cargo.toml
```

| Environment variable | Default / requirement |
| --- | --- |
| `SOLANA_GATEWAY_TOKEN` | Required: 32–256 printable ASCII characters; never supplied to the browser |
| `SOLANA_GATEWAY_BIND` | `127.0.0.1:3000` |
| `SOLANA_FRONTEND_DIR` | Checkout's `frontend/dist`; set an absolute installed-build directory when deploying the binary |
| `SOLANA_DASHBOARD_CONFIG` | Optional path to the owner dashboard's JSON settings; without it, `/` shows SSH signing instructions |

Build an installable binary with `cargo build --locked --release --manifest-path backend/Cargo.toml`. The gateway refuses startup without a valid token or frontend `index.html`, or with invalid dashboard settings.

The dashboard settings ([example](dashboard.json.example)) name the cluster, RPC URL, program, and provider, then list 1–16 `servers`. Each server has a display `name`, a unique `server_id` that must match that server's daemon `server.toml`, and the SSH account and host to display. They contain no secrets: the gateway serves them to every browser. The RPC URL must use HTTPS, except loopback HTTP on `localnet`, and must not contain credentials. Pages may connect only to the gateway itself and that RPC origin (`Content-Security-Policy: connect-src`). Unknown fields are rejected, so a daemon token cannot be copied in by mistake.

Run behind an HTTPS reverse proxy that forwards the original path and `Accept` header. Configure the daemon's `auth_origin` as the exact externally reachable HTTPS origin, without a trailing slash, and `auth_gateway` as its HTTPS transport URL. The reverse proxy must serve both `/v1/` and `/assets/` through this gateway. TLS terminates at the proxy; the Rust listener stays on loopback by default. Do not log authorization headers, session URLs, challenges, or signatures.

## Run with Docker

[compose.yaml](../compose.yaml) builds one image ([Dockerfile](Dockerfile)) containing the release gateway and the production frontend build, and runs it as an unprivileged user. Only the gateway and frontend run in Docker: the program runs on devnet or `solana-test-validator`, and the PAM module and daemon on the Debian server.

From the repository root:

```sh
cp backend/dashboard.json.example backend/dashboard.json   # fill in the server's values
echo "SOLANA_GATEWAY_TOKEN=<gateway_token from server.toml>" > .env
docker compose up --build -d
```

The dashboard settings are required and mounted read-only; set `DASHBOARD_CONFIG` to use another file. Both `backend/dashboard.json` and `.env` are git-ignored. Without a token the container exits with `SOLANA_GATEWAY_TOKEN is required` (see `docker compose logs`). The gateway is published on `127.0.0.1:3000`; `GATEWAY_BIND` and `GATEWAY_PORT` change that. As without Docker, serve it through an HTTPS reverse proxy and set the daemon's `auth_origin` and `auth_gateway` to that origin.

## Validation

```sh
cargo test --locked --manifest-path backend/Cargo.toml
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --locked --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

Router tests cover bearer authentication, simultaneous duplicate proofs, publication/deletion/polling, expiry, validation and size/capacity limits, HTML/JSON negotiation, static files, exclusion of fixture routes, dashboard settings validation, and the RPC origin in the CSP. The frontend browser suite exercises this gateway with cryptographically verified message signatures and, for the dashboard, real program transactions on a local validator.

`solana-authd` verifies signatures and finalized on-chain state and makes the access decision. The gateway never approves access. Payments and delegation use browser-wallet-signed program transactions through RPC; provider setup uses a manually run Bash script. This service has no order, payment-processing, server-registration, or VM-preparation API.

See [shared interfaces](../shared/README.md), [frontend setup and phone verification](../frontend/README.md), and [Architecture.md](../Architecture.md).
