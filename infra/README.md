# Server and service setup

The first integrated target is one existing Debian 13 VM, Solana devnet, and the configured non-root Linux account (`ubuntu` in the demo). Prepare the server manually before selling access. Automated VPS provisioning and inventory management are outside scope; Docker is optional.

Existing installation artifacts live under [ssh/deploy/](../ssh/deploy/):

- [Server configuration](../ssh/deploy/server.toml.example): root-owned mode 0600, binding the program, provider, server ID, Linux user, gateway, and RPC endpoint.
- [Daemon unit](../ssh/deploy/solana-authd.service) and [OpenSSH policy](../ssh/deploy/sshd-wallet.conf): install alongside the PAM module and preserve Debian's account/session checks.
- [SSH setup and recovery instructions](../ssh/README.md): existing QEMU preparation scripts and independent console recovery. This test automation remains available; it is not a payment-triggered provisioning service.

The remaining deployment work is a real HTTPS gateway serving the frontend, a compatible devnet program, and a simple provider Bash script for manual registration and enable/disable operations. A dedicated provider CLI is outside the MVP scope. Keep provider signing keys under the operator's control. Publish only non-secret server identity and SSH connection details to the dashboard. No database service or persistent database volume is needed.

Verify daemon-to-gateway/RPC connectivity, browser access, synchronized clocks, and console recovery before enforcing wallet-only SSH. Use `sshd -t` to check the installed SSH policy. A grant change or subscription expiry affects new logins, not established SSH sessions.

The local fixture harness exposes SSH at `127.0.0.2:2222`; gateway/RPC forwarding and guest addresses are documented in the SSH README. Do not install its fixture services or keys on a real server.

## Gateway in Docker

[compose.yaml](../compose.yaml) runs the gateway with the built frontend in Docker; see [the backend README](../backend/README.md#run-with-docker). The Solana program and the SSH server stay outside Docker: the program runs on devnet, or on `solana-test-validator` for local work, and the PAM module and daemon run on the Debian server.

See [Architecture.md](../Architecture.md).
