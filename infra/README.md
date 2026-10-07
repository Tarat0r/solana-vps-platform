# Infrastructure

**Leads:** Anurag (Docker/SQLite) and Vassil (Linux VM/SSH)

- Add backend container configuration and persistent storage for `/data/solana-vps.sqlite`.
- Add VM installation/configuration for OpenSSH, PAM, and `solana-authd`.
- Provide a root-owned server configuration template and daemon service definition.
- Configure backend/VM/RPC connectivity, HTTPS, and clock synchronization.
- Provide repeatable preparation/readiness checks and a tested provider console recovery procedure.

Start with one pre-created local Linux VM and Solana devnet/testnet. Use `ubuntu` as the POC wallet-login account. Verify console recovery before enforcing wallet-only SSH. Add deployment commands and non-secret configuration examples as implementation progresses.

See [Architecture.md](../Architecture.md).
