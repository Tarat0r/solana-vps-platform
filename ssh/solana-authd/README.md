# solana-authd

Run `solana-authd /etc/solana-auth/server.toml` as root with a root-owned mode-0600
configuration. The daemon accepts root Unix-socket peers and at most 64 concurrent
connections. Each session belongs to one connection, lasts 5 minutes, and can
return success once. Restart invalidates all pending local sessions.

It publishes exact challenge bytes, polls wallet responses, verifies strict
Ed25519 signatures, and checks a combined finalized account snapshot: PDA
addresses/bumps, discriminators, program ownership, wallet/server relationships,
grants, subscription expiry and block-time freshness. Malformed data, disconnects
and network failures deny authentication.

Allowed logins stay bound to their access ([sessions.rs](src/sessions.rs)). The
daemon records each login's `sshd-session` process, warns its terminal a minute
before access ends, and then terminates its logind session (or, without one, the
`sshd-session` process). Finalized access state is re-read every 60 seconds, so
revocation, a disabled server or a new owner end open logins and renewal extends
them. Logins whose `sshd-session` process cannot be identified are denied. Open
logins are saved in `/run/solana-authd.sessions` and survive a daemon restart.
The [unit](../deploy/solana-authd.service) gives the daemon group `tty` and write
access to pseudo-terminals for the warning; users who run `mesg n` get no warning.

See [the contract](../CONTRACTS.md), [setup/tests](../README.md) and
[sample configuration](../deploy/server.toml.example). Audit records
(`ssh_login` and `ssh_session_ended`) exclude session URLs, tokens, nonces, full
challenges and signatures.
