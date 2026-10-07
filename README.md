# Solana VPS Platform

A proof of concept for paying for VPS access with SOL and signing in over SSH with a Solana wallet.

Users purchase or renew access, delegate access to other wallets, and sign SSH login challenges with Phantom or Solflare.

## Development

Start with [Architecture.md](Architecture.md) for the system design and implementation responsibilities. Each folder has a README describing its scope.

| Folder | Purpose |
| --- | --- |
| [frontend/](frontend/) | Wallet-connected portal |
| [backend/](backend/) | Orders, payments, authentication gateway, and provisioning coordination |
| [programs/](programs/) | Solana billing and access program |
| [ssh/](ssh/) | OpenSSH PAM module and VPS authentication daemon |
| [shared/](shared/) | Interfaces and integration fixtures |
| [infra/](infra/) | Docker and Linux VM setup |
| [tests/](tests/) | Integration and end-to-end scenarios |

**Status:** Initial scaffold. Implementation and run commands will be added as components are built.
