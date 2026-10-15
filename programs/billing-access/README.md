# Billing and access program

**Status: implemented and tested locally; not yet deployed to devnet.** Anchor 1.2.1 program `FxQU6c2sjyAADR7vg3PXTZrxUaQNzV2Jh2w7PweEkfTY` in [src/lib.rs](src/lib.rs). The daemon's RPC reader has authorized logins from it on `solana-test-validator`, but not yet on devnet.

- `ServerRecord`, `Subscription`, and `AccessGrant` use the exact discriminators, Borsh field order, PDA seeds, bumps, and grant-role values of [authentication contract v1](../../ssh/CONTRACTS.md). The tests decode every account with [the daemon's decoder](../../ssh/auth-core/src/accounts.rs), require byte-identical re-encoding, and make login decisions with `AccessSnapshot::authorize`.
- `PaymentReceipt` (seeds `payment`, server record, payment ID) stores server, payer, payment ID, amount, `paid_at`, and resulting `paid_until`, then a bump. Receipts support payment recovery; the daemon does not read them.
- The [IDL](../../shared/billing-access/billing_access.json) in `shared/` defines instruction discriminators, account order, arguments, and error codes 6000–6008.

| Instruction | Signer | Effect |
| --- | --- | --- |
| `register_server(server_id, treasury, price_lamports, period_seconds)` | Provider | Creates an enabled server record for sale with no owner (`NO_OWNER`, the all-zero key) and an unpaid subscription; price and period must be positive |
| `set_server_enabled(enabled)` | Provider | Enables or disables payments, delegation changes, and logins |
| `purchase_access(payment_id)` | Any wallet | Buys a server that has no owner or whose subscription has expired: transfers the price, records the buyer as owner, creates or rewrites its owner grant, and writes a receipt |
| `renew_access(payment_id)` | Current owner | Same transfer; extends the term and owner grant, even after expiry while no one else has bought; writes a receipt |
| `grant_delegated_access(wallet, valid_until)` | Current owner | Creates or updates an active delegated grant, `now < valid_until <= paid_until` |
| `revoke_delegated_access(wallet)` | Current owner | Sets a delegated grant inactive |

Payments set `paid_until = max(paid_until, Clock.unix_timestamp) + period_seconds` with checked arithmetic. The transfer, subscription, owner grant, and receipt update together or not at all. Payments reject disabled servers, wrong signers, and wrong treasuries. A reused payment ID fails because its receipt already exists, so nothing is charged. Buying a server whose term is still running fails with `NotAvailable`, even for its owner, who renews instead. After a resale, the previous owner and its delegates have only expired grants, so the daemon denies them, and only the new owner can renew or delegate. A buyer who was a delegate has its grant rewritten as the owner grant. Delegation changes require an enabled server and the owner's unexpired subscription and grant. They cannot touch the owner grant. Renewal leaves delegated expiries unchanged. A delegate cannot manage access, because instructions derive the owner grant from the signer.

The treasury is a system account. It must already exist, or the first payment must cover the rent-exempt minimum of an empty account (`solana rent 0`).

## Build and test

Requires Anchor 1.2.1, Solana CLI 4.2+, and Node 22.18+. From `programs/`:

```sh
npm ci
npm run build          # anchor build --arch v0, then publish the IDL to shared/
npm run compile        # anchor build --arch v0 only
npm test               # LiteSVM program tests (cargo test)
npm run test:provider  # provider.sh against solana-test-validator on ports 18001, 18100-18200, 18899-18900 and 19900
npm run test:daemon    # end to end against solana-test-validator on ports 28001, 28100-28200, 28899-28900 and 29900
npm run test:all       # compile, typecheck, and all three suites; the IDL test fails if shared/ is stale
npm run radar          # Radar static analysis; see below
```

| Suite | Covers |
| --- | --- |
| [tests/litesvm.rs](tests/litesvm.rs) | Every instruction and error path; atomic rollback on wrong accounts, overflow, insufficient funds, and rent; account substitution, type confusion, and look-alike accounts; the receipt's byte layout; login decisions through auth-core |
| [tests/provider.test.ts](../tests/provider.test.ts) | provider.sh register/enable/disable/show, confirmation prompt, input validation, and other keypairs |
| [tests/daemon_rpc.rs](tests/daemon_rpc.rs) | provider.sh registration, then owner payment and delegation, read by the daemon's own `rpc::read_access` at finalized commitment: owner and delegate allowed, unknown wallet denied, then revocation and provider disablement deny. Takes about a minute |

Build with `--arch v0`. Anchor 1.2.1 defaults to SBPF v3. LiteSVM accepts that build, but `solana-test-validator` 4.2.2 reports "Program is not deployed". v0 does not depend on SBPF v3 support on the target cluster.

The program address keypair is `target/deploy/billing_access-keypair.json`. It is git-ignored. Keep it until the program is deployed. If it is lost before deployment, run `anchor keys sync` and republish the IDL so the new ID is used everywhere.

## Static analysis

`npm run radar` ([scripts/radar.sh](../scripts/radar.sh)) scans `src/` with [Radar](https://github.com/Auditware/radar), Auditware's static analyzer for Anchor programs. It runs Radar's 45 Rust/Anchor templates, among them missing signer and owner checks, PDA sharing, arbitrary CPI, type cosplay, and `init_if_needed` reinitialization. It prints each finding with its location, writes `target/radar.sarif`, and exits 1 on any finding (`--fail-on high` relaxes that) and 2 if Radar itself fails. Tests are not scanned. `./static-analysis.sh` runs it.

Radar runs from [radar/compose.yaml](../radar/compose.yaml) instead of its installer and `radar` launcher. That file follows Radar's own compose setup at commit `3439053`, but pins every image by digest, publishes no host ports, mounts the sources read-only, and gives the containers no network access outside the stack. The script generates throwaway credentials for each run and then removes only this project's containers and volumes. The first run pulls about 2 GB of images.

To update Radar, take the digests of `ghcr.io/auditware/radar-api:main` and `radar-controller:main` (`docker buildx imagetools inspect`), check that both images' `org.opencontainers.image.revision` label names the same commit, compare that commit's `docker-compose.yml` with `radar/compose.yaml`, then rescan.

A finding that is not a vulnerability is accepted on its line with `// radar-disable-line <Template_Name>`, or `// radar-disable-next-line` on the line above, next to a comment that says why. The two `init_if_needed` accounts are accepted this way: rewriting the buyer's grant is only reachable while the server is for sale, and rewriting a delegate's grant needs its active owner (`a_former_delegate_who_buys_becomes_the_owner` and `delegated_grants_are_independent_and_updatable` in the LiteSVM tests).

## Provider script

[provider.sh](../scripts/provider.sh) registers the prepared server and enables or disables it with the provider's keypair. It defaults to devnet and `~/.config/solana/id.json`. Before sending, it shows the current on-chain state and the planned change, then asks for confirmation unless `--yes` is given.

```sh
scripts/provider.sh register --server-id <server_id from server.toml> \
  --treasury <treasury> --price-lamports 100000000 --period-seconds 2592000
scripts/provider.sh disable --server-id <server_id>
scripts/provider.sh enable --server-id <server_id>
scripts/provider.sh show --server-id <server_id>
```

The script validates input in Bash. [provider-tx.ts](../scripts/provider-tx.ts) encodes instructions from the published IDL and sends version-0 transactions with @solana/kit. It reads back the server record and subscription after checking each account's owner, discriminator, and exact size.

## Devnet deployment

Deployment needs a funded devnet wallet: about 1.3 SOL of rent for the ~250 KB program, plus about as much again for a temporary deploy buffer that is refunded:

```sh
solana program deploy target/deploy/billing_access.so \
  --program-id target/deploy/billing_access-keypair.json --url devnet
scripts/provider.sh register ...   # with the prepared server's server_id and owner
```

Then set `program_id` and `provider_pubkey` in the server's `/etc/solana-auth/server.toml`.

See [on-chain behavior](../../Architecture.md#on-chain-state-and-instructions) and [payment recovery](../../Architecture.md#payments-and-recovery).
