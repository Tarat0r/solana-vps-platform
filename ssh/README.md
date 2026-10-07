# SSH access

**Lead:** Vassil

Wallet-authenticated SSH access is implemented by two components in this folder:

- [pam/](pam/): the OpenSSH PAM module that displays the signing URL and returns the authentication result.
- [solana-authd/](solana-authd/): the daemon that manages challenges, verifies wallet signatures, and checks on-chain access.

The components communicate through a protected local Unix socket. Start with the IPC and authentication contracts in [shared/](../shared/) and coordinate VM setup with [infra/](../infra/).
