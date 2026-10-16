# Integration tests

## Existing authentication suite

The working Rust, gateway, network, and Debian/OpenSSH tests live under [ssh/](../ssh/README.md). To run them with every other suite, from the repository root after installing the documented prerequisites:

```sh
./test-all.sh
```

Download [debian-13-nocloud-amd64.qcow2](https://saimei.ftp.acc.umu.se/images/cloud/trixie/latest/debian-13-nocloud-amd64.qcow2) into this directory for the QEMU harness. The harness keeps the supplied image unchanged and uses its own overlay.

Program, provider-script, and daemon-RPC tests against a local validator live under [programs/](../programs/README.md) (`npm --prefix programs run test:all`). `./test-all.sh` runs them before the SSH pipeline, whose browser stage also needs the built program.

These tests exercise real PAM, daemon logic, signatures, and OpenSSH with simulated gateway/RPC services and a command-line signer. They do not verify a deployed Solana program, SOL payments, browser wallets, or HTTPS. The fixture suite uses `localnet`; the planned integrated demonstration uses devnet.

## Planned integrated coverage

Keep component tests beside their implementations and add cross-component scenarios here once the real program, gateway, and frontend exist:

- Provider registers an already prepared server; its owner pays SOL, waits for finalized access state, signs in through the browser, and reaches the configured Linux account over SSH.
- Pending/invalid payments do not establish access; duplicate payment IDs cannot charge twice; uncertain results reconcile against finalized receipts before retrying.
- Subscription expiry denies new logins and ends open SSH sessions after a one-minute warning; finalized renewal restores access.
- Owner grants a delegate access, the delegate logs in, and revocation/expiry prevents subsequent logins. Provider disablement also denies new logins.
- Invalid signatures, replay, expired challenges, wrong server/account bindings, and unauthorized IPC or gateway requests fail closed.
- Stale/unavailable RPC and gateway/daemon failures deny login; gateway/daemon restarts require new pending login attempts; provider console recovery remains usable.
- Dashboard reload/reconnect recovers pending payment metadata and re-reads on-chain state without an order database or a second payment for an uncertain operation. The frontend browser suite covers this against a local validator; devnet remains.

Use non-secret fixtures from [shared/](../shared/README.md). Record the cluster/program ID, payment IDs, transaction signatures, and redacted outcomes. Never publish wallet keys, daemon tokens, or full login challenges/signatures. Add integrated test commands when that harness exists; the command above covers the current fixture suite only.

See [Architecture.md](../Architecture.md).
