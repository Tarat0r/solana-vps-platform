# Frontend

**Lead:** Anurag  
**Date:** 2026-10-11  
**Last Updated:** 2026-10-11  

Wallet-connected portal built with Next.js 16, React 19, Tailwind CSS 4, and official Solana Wallet Adapter.

- Purchase and renew access with wallet-signed SOL transactions.
- Show order/preparation status, paid-until time, and SSH instructions.
- Manage delegated access and revocation.
- Display, inspect, and sign the PAM daemon's 90-second SSH login challenge.
- Live terminal console with automatic PAM challenge detection and quick action triggers.

## Development and Verification

```bash
bun install
bun run dev
bun run build
```

See [Architecture.md](../Architecture.md) and [docs/commit-history.md](../docs/commit-history.md) for 3-day development history by Anurag.
