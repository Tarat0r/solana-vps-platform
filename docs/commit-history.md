# Commit History (Last 3 Days)

**Author:** Anurag Borkar  
**Date:** 2026-10-11  
**Scope:** 3-Day Development Activity (October 9, 2026 – October 11, 2026)  
**Contributors Included:** Anurag Borkar only (excluding Vassil Vassilev)

---

## Overview

This document tracks all commits authored by Anurag Borkar over the last 3 development days across the frontend and backend integration workstreams for the Solana VPS Platform.

```
October 9, 2026  ───►  October 10, 2026  ───►  October 11, 2026
Backend & UI Base       Live API & Merge        Gateway Relay, Base64 PAM & Production Slices
```

---

## Day 1: October 9, 2026

### 1. `feat(backend): implement Axum service with SQLite persistence and order handlers`
- **Commit:** `8f99463`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-09 11:10:16 +0530
- **Summary:**
  - Initialized backend Axum 0.8 service with Tokio runtime.
  - Implemented SQLite database connection pool and schema migrations for orders.
  - Added REST API routes for creating orders, listing orders, and mock payment verification.
  - Configured state container and CORS middleware for frontend communication.

### 2. `feat(frontend): build decentralized Solana VPS platform UI with PAM auth and terminal console`
- **Commit:** `849df9c`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-09 18:21:37 +0530
- **Summary:**
  - Integrated official Solana Wallet Adapter supporting Phantom and Solflare.
  - Implemented cluster switcher supporting Devnet, Testnet, and Mainnet Beta.
  - Built high-impact landing hero with live telemetry and cluster health status.
  - Created AMD EPYC hardware tiers with dynamic pricing calculator.
  - Built 4-step architecture showcase demonstrating Linux PAM (`pam_solana.so`) workflow.
  - Implemented interactive in-browser live shell terminal console (`TerminalConsole.tsx`).
  - Added FAQ accordion and platform footer with cluster sync.

---

## Day 2: October 10, 2026

### 3. `merge: merge develop/backend into develop/frontend`
- **Commit:** `2a1ffe2`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-10 11:13:12 +0530
- **Summary:**
  - Synchronized backend order and database changes into the frontend development branch.
  - Resolved merge points across shared type definitions and environment configuration.

### 4. `feat(frontend): integrate live backend api endpoints for orders and payment verification`
- **Commit:** `f78d2fa`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-10 16:14:33 +0530
- **Summary:**
  - Switched frontend client from mock state to live backend HTTP endpoints (`lib/api.ts`).
  - Wired `fetchOrders`, `createOrder`, and `verifyPayment` API calls.
  - Added real-time order polling and progress state synchronization in `app/page.tsx`.
  - Added address shortening and lamport-to-SOL conversion helpers in `lib/utils.ts`.

---

## Day 3: October 11, 2026

### 5. `feat(frontend): add localnet cluster support, web3icons integration, and remove button gradients`
- **Commit:** `ac1463a`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-11 11:38:40 +0530
- **Summary:**
  - Added localnet / 127.0.0.1 cluster toggle to `ClusterProvider` for local test validator workflows.
  - Integrated SVG wallet icons via Web3Icons in `WalletModal` and `WalletAccountMenu`.
  - Refined UI styles and button aesthetics across pricing and hero sections.

### 6. `feat: implement auth gateway relay, payment attempts lifecycle, and ssh verification portal`
- **Commit:** `4b1a714`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-11 19:00:01 +0530
- **Summary:**
  - Added `PaymentAttempt` model, database table, and handlers supporting `PURCHASE` and `RENEWAL` receipts.
  - Implemented Auth Gateway relay endpoints with 90-second TTL challenge sessions.
  - Built dedicated `/auth` portal page for wallet-signed SSH challenge verification.
  - Supported delegated access grants with add/remove/list endpoints and UI controls.
  - Updated `SolanaWalletProvider` to use Wallet Standard auto-detection.
  - Added resilient fallback handling and clean RPC error handling in `useWalletBalance`.

### 7. `feat(frontend): scaffold Next.js 16 app with wallet adapters and UI primitives`
- **Commit:** `d68f1b5`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-11 23:15:45 +0530
- **Summary:**
  - Scaffolding of Next.js 16 App Router foundation with Tailwind CSS and Turbopack.
  - Base shadcn UI components (`Button`, `Card`, `Badge`, `Dialog`, `Input`, `Progress`, `Table`, `Tabs`, `Tooltip`).
  - Provider boundary setup with `AppProviders`, `ClusterProvider`, and `SolanaWalletProvider`.
  - TypeScript types (`types/vps.ts`), mock APIs, and base project configuration.

### 8. `feat(frontend): implement streamlined header, cluster switcher, and landing hero`
- **Commit:** `afd44d4`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-11 23:16:11 +0530
- **Summary:**
  - Streamlined `Navbar` with brand logo and direct navigation anchors.
  - Cluster selection dropdown with active indicator checkmarks.
  - `WalletAccountMenu` with address copy, explorer link, and disconnect button.
  - `HeroSection` and `LandingView` with live node preview card and cluster health telemetry.

### 9. `feat(frontend): add AMD EPYC hardware tiers, pricing calculator, and architecture showcase`
- **Commit:** `ef09326`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-11 23:16:28 +0530
- **Summary:**
  - Hardware specifications data model for AMD EPYC Genoa 9654 nodes.
  - `PricingSection` with duration discount calculator (7, 14, 30, 90 days) and region selectors.
  - `ArchitectureSecuritySection` showcasing 4-step deployment cycle and security pillars.
  - Wired `CreateOrderModal` pre-fill for chosen hardware tiers.

### 10. `feat(frontend): add PAM auth gateway verification portal, terminal console, and views`
- **Commit:** `698921e`
- **Author:** Anurag Borkar <anuragborkar2005@gmail.com>
- **Date:** 2026-10-11 23:16:55 +0530
- **Summary:**
  - Dedicated `/auth` portal for signing PAM SSH challenges with Solana wallets.
  - Updated API client (`lib/api.ts`) for standard `/v1/sessions` routes and base64 signature encoding.
  - Added live 90-second countdown clock with auto-locking upon expiry.
  - Enhanced `TerminalConsole` with regex pattern detection for incoming PAM SSH challenge links and quick action badge.
  - Added `OrderDetailView`, `OrderListView`, `FaqSection`, `Footer`, and toast notifications.
