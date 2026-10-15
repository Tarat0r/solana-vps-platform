# Owner dashboard and SSH signing

**Status: owner dashboard and SSH signing implemented.** The React/TypeScript pages support Phantom and Solflare; the signing page also links to their mobile wallet browsers.

The interface has two views:

- **Owner dashboard (`/`):** has two menus, with the wallet panel above both. **Browse servers** lists the provider's servers from the gateway's settings, each with its price and its status for the connected wallet (Available, Taken, Owned by you, Shared with you, Disabled). Selecting one shows its details. Everyone sees the price and whether a server is available. Any wallet can buy an available server and becomes its owner; once the purchase is finalized, the page opens it in **My servers**. My servers (`/#my-servers`, kept across reloads) lists only the servers the connected wallet owns, including expired ones it can still renew. There the owner sees its expiry, renews, grants/revokes delegated wallets, and lists its finalized payments, each with what it took from the wallet (price, network fee, and account rent, read from its finalized transaction) and a Solana Explorer link. A delegate sees only its own access. The SSH command appears only to a wallet with current access, with a copy button. Every payment shows a confirm step before the wallet opens: the resulting expiry and an itemized cost (server price, network fee from `getFeeForMessage`, rent for the receipt and access accounts it creates, and the total). Sharing access shows the same fee and rent before the wallet opens. While a payment or a change is in progress, a notification pinned to the bottom of the page shows the current step (preparing, waiting for the wallet, sending, waiting for Solana to finalize). The gateway serves its settings from `SOLANA_DASHBOARD_CONFIG`; without them, `/` shows SSH signing instructions.
- **SSH signing page:** open the daemon's displayed URL, show the server/account and expiry, connect a wallet, and sign the exact decoded challenge bytes. Owners and delegates can use this page. Login signing is a message signature, not a payment transaction.

The provider registers the already prepared server and controls enable/disable status with a manually run Bash script. The browser has no provider administration, server ordering, or preparation workflow.

The dashboard builds version-0 transactions with `@solana/kit` ([billing.ts](src/billing.ts)), has the wallet sign them, and submits them directly through the configured RPC. It reads finalized program-owned accounts only; a wallet callback, transaction signature, or standalone SOL transfer is never shown as paid access.

Payments follow [payment recovery](../Architecture.md#payments-and-recovery) ([payments.ts](src/payments.ts)). Before signing, the dashboard stores the operation and a fresh 32-byte payment ID in `localStorage`, keyed by cluster, program, server, and wallet. After signing and before sending, it adds the signature and the blockhash's last valid block height. A matching finalized receipt completes the payment. A transaction that failed, expired unexecuted, or was never signed may be retried with the same payment ID or cancelled. Anything else stays pending, and no new payment can start meanwhile. A wallet rejection or a failed preflight clears the record, since nothing reached the network. Without browser storage, payments do not start.

Follow [authentication contract v1](../ssh/CONTRACTS.md) without changing its challenge or proof format. The daemon emits `/v1/sessions/{id}` as the signing URL: coordinate HTML rendering with the gateway while retaining the JSON representation. Decode `challenge_base64` and sign its bytes without rebuilding the message or changing line endings. Submit `{wallet, signature_base64}` and report that the proof was submitted; only SSH can confirm that the daemon allowed the login.

The signing page keeps no wallet secrets, daemon tokens, or proofs in browser storage. A failed submission can retry the same signature in memory while the challenge is active. The dashboard loads as a separate chunk, so signing links do not download its RPC client.

## Build and run

From the repository root:

```sh
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend run build
```

If your terminal is already in `frontend/`, omit `--prefix frontend`:

```sh
npm ci --ignore-scripts
npm run build
```

The prefix is relative to your current directory; using it from inside `frontend/` makes npm look in `frontend/frontend/`, where there is no lockfile.

The [Axum gateway](../backend/README.md) serves `frontend/dist`. Open the signing URL from SSH; visiting the homepage alone shows instructions for starting a login. The page validates the challenge's session, signed fields, expiry, and exact public origin before signing its original bytes.

For development, start the gateway, then run:

```sh
npm --prefix frontend run dev -- --host 127.0.0.1
```

Inside `frontend/`, use `npm run dev -- --host 127.0.0.1` instead.

Vite proxies JSON session requests to `http://127.0.0.1:3000`. Set `SOLANA_GATEWAY_PROXY` for another backend transport URL. For native loopback development, configure the daemon's `auth_origin` to the exact Vite origin and its `auth_gateway` to the backend; loopback HTTP requires `cluster = "localnet"` and `local_test = true`. For the managed VM, use its signing URL directly: `npm --prefix ssh run vm -- prepare` builds and installs the same frontend on its existing fixture gateway.

## Checks and wallet verification

```sh
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run test:browser
```

`lint` runs ESLint with type-aware TypeScript rules and the React Hooks rules ([eslint.config.js](eslint.config.js)). `package.json` overrides `uuid` and `stream-json` under `@solana/web3.js` v1 with patched releases: web3.js loads only jayson's browser client, which calls `uuid.v4()` and never loads `stream-json`.

Unit tests check the dashboard client against the published IDL (discriminators, account order and roles, errors, layouts), PDAs against web3.js, settings validation, and every payment-recovery outcome.

Browser tests launch the real Axum gateway on port 3081, Vite on port 4173, and Chromium. They inject Phantom/Solflare provider doubles that create real Ed25519 signatures. Signing cases verify the submitted proof against the exact published bytes, and cover mobile links, narrow layouts, expiry, malformed/missing challenges, wallet rejection, duplicate proofs, and retry after a failed request.

Dashboard cases start `solana-test-validator` with the program on ports 38001, 38100–38200, 38899–38900, and 39900, and register the server with `provider.sh`. They cover purchase and renewal with treasury balances, a cancelled payment, a lost RPC response recovered after reload without a second charge, sharing and revoking access with the delegate's view, a wallet without access, and a disabled server. One case loads the built page from the gateway under its real CSP. First run `npm --prefix programs ci` and `npm --prefix programs run build`, and build the frontend. Install Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, or run `npx --prefix frontend playwright install chromium` to use Playwright's browser.

For real-phone acceptance, deploy behind HTTPS and configure `auth_origin` to that reachable origin. Start SSH, scan its QR code, choose **Open in Phantom** or **Open in Solflare**, connect and sign in the wallet browser, then return to SSH and press Enter. Verify with an authorized wallet and repeat with an expired link and a rejected signature. The phone's clock must be synchronized.

By default the VM uses loopback URLs and fixed synthetic owner/delegate wallets, so a phone cannot reach `127.0.0.2` and an arbitrary wallet has no grant. For a quick phone check, `npm --prefix ssh run vm -- phone --host <private-LAN-IP>` exposes the VM's signing page on the LAN, or `phone --origin <https-tunnel-origin>` serves it through an HTTPS tunnel (needed by wallet browsers that refuse plain HTTP); both grant a generated test wallet delegated access. See [phone mode](../ssh/README.md#phone-mode). The automated SSH suite still uses the CLI signer; mobile HTTPS and installed-wallet verification remain manual checks.

See [Architecture.md](../Architecture.md) for the implementation order and acceptance scenarios.
