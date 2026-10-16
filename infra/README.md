# Server and service setup

The first integrated target is one existing Debian 13 VM, Solana devnet, and the configured non-root Linux account (`ubuntu` in the demo). Prepare the server manually before selling access. Automated VPS provisioning and inventory management are outside scope; Docker is optional.

Existing installation artifacts live under [ssh/deploy/](../ssh/deploy/):

- [Server configuration](../ssh/deploy/server.toml.example): root-owned mode 0600, binding the program, provider, server ID, Linux user, gateway, and RPC endpoint.
- [Daemon unit](../ssh/deploy/solana-authd.service) and [OpenSSH policy](../ssh/deploy/sshd-wallet.conf): install alongside the PAM module and preserve Debian's account/session checks.
- [SSH setup and recovery instructions](../ssh/README.md): existing QEMU preparation scripts and independent console recovery. This test automation remains available; it is not a payment-triggered provisioning service.

The remaining deployment work is a real HTTPS gateway serving the frontend, a compatible devnet program, and a simple provider Bash script for manual registration and enable/disable operations. A dedicated provider CLI is outside the MVP scope. Keep provider signing keys under the operator's control. Publish only non-secret server identity and SSH connection details to the dashboard. No database service or persistent database volume is needed.

Verify daemon-to-gateway/RPC connectivity, browser access, synchronized clocks, and console recovery before enforcing wallet-only SSH. Use `sshd -t` to check the installed SSH policy. A grant change or subscription expiry denies new logins and ends open wallet logins, after a one-minute warning at expiry.

The local fixture harness exposes SSH at `127.0.0.2:2222`; gateway/RPC forwarding and guest addresses are documented in the SSH README. Do not install its fixture services or keys on a real server.

## Public deployment

[deploy.sh](deploy.sh) installs the system on public Ubuntu 26.04 servers that share one address with a separate SSH port each: a backend for the gateway and dashboard, and one server per devnet registration from `./run.sh --devnet`. Copy [deploy.env.example](deploy.env.example) to `deploy.env` (git-ignored), set the address, ports, domain, and the backend's private address, then run:

```sh
infra/deploy.sh build      # binaries built in an ubuntu:26.04 container, and the frontend
infra/deploy.sh cert       # Let's Encrypt certificate; add the DNS TXT record it shows
infra/deploy.sh backend    # gateway, dashboard, and nginx with TLS on port 8080
infra/deploy.sh server 1   # wallet-only SSH for ubuntu; repeat for each server
infra/deploy.sh status
```

- **Access:** root logs in only with the configured SSH key. `ubuntu` logs in only with a wallet signature, through the daemon and PAM module.
- **Certificate:** the provider forwards a non-standard public port to the backend's 8080, and Let's Encrypt cannot reach ports 80 or 443. `cert` therefore uses a DNS-01 challenge with no DNS API key: it shows a TXT record, then continues once the domain's name servers serve it. The certificate lasts about 90 days; rerun `cert` in its last 30 days.
- **Private network:** the public address does not loop back inside the provider network. Each server maps the domain to the backend's private address in `/etc/hosts`, so its daemon reaches the gateway with the real certificate, and `local_test` stays off.
- **Lockout protection:** `server` changes sshd and PAM behind a 10-minute timer that restores the previous configuration. The timer is cancelled only after a new root key login succeeds. The previous PAM file is kept as `/etc/pam.d/sshd.before-solana`.
- **Logging:** nginx keeps no access log, because request paths contain signing-session IDs.

The current deployment serves the dashboard at `https://vps.oblaka.top:6441`. The servers for sale are `ssh -p 6108 ubuntu@vps.oblaka.top` (30-day term) and `ssh -p 6107 ubuntu@vps.oblaka.top` (10-minute term).

## Gateway in Docker

[compose.yaml](../compose.yaml) runs the gateway with the built frontend in Docker; see [the backend README](../backend/README.md#run-with-docker). The Solana program and the SSH server stay outside Docker: the program runs on devnet, or on `solana-test-validator` for local work, and the PAM module and daemon run on the Debian server.

See [Architecture.md](../Architecture.md).
