# Wallet-authenticated SSH

Rust implementations of `pam_solana.so` and `solana-authd`, with a Debian 13 QEMU
environment and TypeScript tests. PAM performs local IPC and displays a signing
prompt; the daemon verifies Ed25519 signatures and finalized Solana account state.
See [CONTRACTS.md](CONTRACTS.md) for wire formats.

The gateway and RPC in the test environment are **synthetic fixtures**. No program
is deployed, no SOL is transferred, and there is no browser wallet page. Account
encoding is provisional pending integration with the program owner. The daemon
has no fixture authorization bypass.

## Prerequisites and checks

- Linux, QEMU (`qemu-system-x86_64`, `qemu-img`), OpenSSH client and `ssh-keygen`.
- Rust/Cargo 1.85+ and PAM development headers for host checks/signing tools.
- Node.js 22.18+ and npm. Tests and VM management use TypeScript; no Python scripts
  or Docker are required.
- Supplied image at `../tests/debian-13-nocloud-amd64.qcow2`.
- Available host ports `127.0.0.2:2222`, `:8080`, `:8899`; up to 16 GiB guest disk
  space. QEMU uses KVM when available and otherwise TCG.

Run from `ssh/`:

```sh
cargo build --locked --workspace
cargo test --locked --workspace
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
npm ci
npm run typecheck
npm test
npm run vm -- prepare
npm run test:vm
```

For a focused rerun, use e.g.
`npm run test:vm -- --test-name-pattern=disconnect`.

Standalone gateway tests use the same ports as the VM; run them before starting
it or after stopping it. First provisioning downloads Debian packages and Rust
crates; subsequent runs reuse the overlay and guest Cargo cache.

`prepare` handles the first-boot wizard through the serial console, grows the
overlay filesystem, builds and tests the workspace **inside Debian**, and installs
OpenSSH/PAM/systemd configuration. The supplied image is never modified. Failures
stop provisioning and preserve diagnostics. If QEMU's DNS relay fails, a guest-only
DNS fallback is used (1.1.1.1; override with `SOLANA_VM_DNS`).

## VM operation and recovery

```sh
ssh -p 2222 ubuntu@127.0.0.2
npm run vm -- console
npm run vm -- exec 'systemctl status solana-authd --no-pager'
npm run vm -- stop
npm run vm -- up
npm run vm -- reset
```

The recovery console is independent of PAM. Exit with Ctrl-]. Its generated root
password is in `.vm/secrets.json` (0600); never reuse it elsewhere. The harness
normally leaves an authenticated root shell on the private local console socket.
Recovery can restart the daemon or restore `/etc/pam.d/sshd.before-solana`.

`reset` stops this VM and removes its generated overlay/readiness state, preserving
the original image. `stop` preserves the overlay. Private control sockets live in
`/tmp` to accommodate long Unicode workspace paths.

Host SSH `127.0.0.2:2222` forwards to guest port 22. Gateway/RPC forwards use host
`127.0.0.2:8080` and `:8899`; the guest daemon uses `127.0.0.1:8080` and `:8899`.
The signing origin is bound into the challenge separately from the transport URL.

Test signing URLs return exact challenge JSON. For a manual terminal login, run
`target/debug/test-services sign '<displayed-url>' owner` in another terminal,
then press Enter in SSH. Use `delegate` for the other public fixture wallet.

## Artifacts and coverage

Ignored `.vm/` contains the overlay, private test credentials, pinned guest SSH
host key, QEMU/serial diagnostics and `report.json`. The test runner removes
transient challenge/proof files after the suite. Daemon JSON audit events go to
journald without URLs, tokens, nonces or signatures; inspect them from the console
with `journalctl -u solana-authd`.

Tests cover actual OpenSSH/PAM owner/delegate login, signature/account/server
binding, replay, duplicates, subscription/grant expiry, revocation, disabled
servers, invalid account metadata, stale RPC, outages, cancellation, restart,
authentication-method bypasses and console recovery. One test waits through the
real 90-second challenge lifetime. Fixture renewal checks authorization changes,
not payment processing.

The disposable VM disables OpenSSH source-address penalties so deliberate failed
logins do not suppress later test cases. The deployment configuration retains
OpenSSH's normal penalties. Authorization-denial tests require a real challenge
and submitted signature, so a refused connection cannot produce a false pass.

## Real integration

Use a deployed program/layout matching [CONTRACTS.md](CONTRACTS.md), a compatible
authenticated HTTPS gateway and a synchronized clock. Build on the target distro,
install the daemon/PAM library, and supply root-owned mode-0600
`/etc/solana-auth/server.toml` from [the sample](deploy/server.toml.example).

[The daemon unit](deploy/solana-authd.service) applies systemd restrictions.
[The SSH configuration](deploy/sshd-wallet.conf) is a single-account demo policy.
Keep Debian's account/session checks; replace its authentication stack with
`auth requisite pam_solana.so`. Run `sshd -t` and verify console recovery before
activating the policy. Never install the fixture service on a production server.
Grant changes affect new logins; existing SSH sessions remain established.
