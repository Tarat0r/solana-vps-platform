# PAM module

**Lead:** Vassil

Implement `pam_solana.so` for OpenSSH keyboard-interactive authentication.

- Ask `solana-authd` for a login session over its protected Unix socket.
- Display the HTTPS wallet-signing URL through the PAM conversation.
- Wait for the daemon's result and return the corresponding PAM result.
- Deny on cancellation, timeout, daemon failure, or invalid responses.

Start with the PAM/daemon IPC contract in [shared/](../../shared/). Keep signature verification and Solana RPC logic in the daemon. Add build/install commands and coordinate VM configuration with [infra/](../../infra/).

See [Architecture.md](../../Architecture.md).
