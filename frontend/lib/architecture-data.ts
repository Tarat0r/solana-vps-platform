import { DeploymentLifecycleStep, SecurityPillar, ArchitectureComponent, OnChainAccount } from "@/types/vps";

export const DEPLOYMENT_STEPS: DeploymentLifecycleStep[] = [
    {
        stepNumber: 1,
        title: "Wallet Payment & Verification",
        subtitle: "On-chain transaction signature and cluster polling",
        duration: "~400ms (1 slot)",
        protocol: "Solana JSON-RPC 2.0",
        description: "User signs a direct lamport transfer instruction via official Solana Wallet Adapter. The background worker polls the cluster for finalized commitment and links the transaction signature to the instance order.",
        inspectorTitle: "solana-tx-payload.json",
        inspectorLanguage: "json",
        inspectorContent: `{
  "jsonrpc": "2.0",
  "method": "sendTransaction",
  "params": [
    "5xK9m...base58_encoded_transaction...",
    {
      "skipPreflight": false,
      "preflightCommitment": "confirmed",
      "encoding": "base64",
      "maxRetries": 3
    }
  ],
  "id": "req_order_prov_01"
}`,
        highlights: [
            "Official Solana Wallet Standard integration",
            "Finalized block commitment confirmation",
            "Zero custodial escrow risk",
        ],
    },
    {
        stepNumber: 2,
        title: "Hypervisor Provisioning",
        subtitle: "Bare-metal AMD EPYC core pinning and NVMe slice attachment",
        duration: "~450ms",
        protocol: "QEMU / KVM Virtualization",
        description: "Automated daemon allocates dedicated Zen 4 vCPU cores, carves out PCIe 4.0 NVMe storage blocks, and establishes a tap bridge network interface with dedicated IPv4 routing.",
        inspectorTitle: "qemu-kvm-spawn.sh",
        inspectorLanguage: "bash",
        inspectorContent: `#!/usr/bin/env bash
# Hypervisor allocation daemon
qemu-system-x86_64 \\
  -enable-kvm -cpu EPYC-Genoa,check \\
  -smp cpus=4,cores=4,threads=1 \\
  -m 16384M -overcommit mem-lock=off \\
  -drive file=/dev/nvme0n1p3,format=raw,if=virtio,cache=none \\
  -netdev tap,id=net0,ifname=tap_vps_42,script=no \\
  -device virtio-net-pci,netdev=net0,mac=52:54:00:12:34:56 \\
  -daemonize -pidfile /run/vps/vps_42.pid`,
        highlights: [
            "Hardware hardware-assisted virtualization (AMD-V)",
            "Strict non-oversold RAM & PCIe 4.0 NVMe allocation",
            "Isolated bridge tap networking per guest",
        ],
    },
    {
        stepNumber: 3,
        title: "Linux PAM & solana-authd Daemon",
        subtitle: "OpenSSH keyboard-interactive challenge generation & verification",
        duration: "~90ms",
        protocol: "Linux PAM (pam_solana.so)",
        description: "When SSH connects, pam_solana.so pauses login and requests a 90-second challenge from solana-authd. The user signs the exact challenge payload with Phantom or Solflare, proving wallet identity without transmitting private keys.",
        inspectorTitle: "pam_solana_challenge.txt",
        inspectorLanguage: "text",
        inspectorContent: `VPS-ACCESS-AUTH/1
cluster=devnet
program_id=vps7bL3Z9QvB9mK1xY2qT4L8z9QvB9mK1xY2q
server_id=fra1_epyc_genoa_node_42
unix_user=ubuntu
session_id=sess_8f29c401
nonce=7e8b209d18fa4b
issued_at=2026-10-10T17:48:00Z
expires_at=2026-10-10T17:49:30Z
auth_origin=https://auth.solanavps.cloud`,
        highlights: [
            "Native Linux PAM module (pam_solana.so) integration",
            "Local Unix socket IPC with root-protected solana-authd",
            "Single-use 90-second challenge with cryptographic replay defense",
        ],
    },
    {
        stepNumber: 4,
        title: "Live Edge Terminal Access",
        subtitle: "On-chain subscription verified, PAM grants shell access",
        duration: "<1.0s Total Time",
        protocol: "OpenSSH v9 / Ubuntu 24.04 LTS",
        description: "solana-authd verifies the Ed25519 signature and queries finalized Solana on-chain access grants. Once confirmed, PAM authorizes login and drops the operator into an active bash shell with root sudoer privileges.",
        inspectorTitle: "terminal-connect.sh",
        inspectorLanguage: "bash",
        inspectorContent: `# Connect to your autonomous VPS node
ssh ubuntu@185.220.101.42

# OpenSSH keyboard-interactive prompt:
# Authenticate with your Solana wallet at:
# https://auth.solanavps.cloud/verify?session=sess_8f29c401

# [Signature confirmed by solana-authd -> PAM allow]
# Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-40-generic x86_64)
# System load:  0.02               Memory usage: 3% of 16384MB
# IPv4 address: 185.220.101.42     Datacenter:   Frankfurt (eu-central-1)
# Port speed:   2.5 Gbps           Solana Node:  Ready
ubuntu@vps-node-frankfurt-01:~$ `,
        highlights: [
            "Zero private key transmission to servers",
            "On-chain access grant checked at login time",
            "Automatic rejection upon subscription expiry or grant revocation",
        ],
    },
];

export const SECURITY_PILLARS: SecurityPillar[] = [
    {
        id: "zero-kyc",
        title: "Zero KYC & Identity Freedom",
        badge: "Privacy Guarantee",
        iconName: "ShieldCheck",
        description: "No credit cards, no phone numbers, and no billing addresses. Authentication is cryptographically bound to your Solana wallet address.",
        technicalSpecs: [
            "Zero tracking cookies or analytics telemetry",
            "No credit check or personal data storage",
            "Autonomous lease expiry without recurring billing traps",
        ],
    },
    {
        id: "pam-auth",
        title: "Linux PAM & Daemon Verification",
        badge: "Cryptographic PAM",
        iconName: "Key",
        description: "OpenSSH integrates with pam_solana.so and solana-authd. Login challenges are signed by Phantom or Solflare and verified without static passwords.",
        technicalSpecs: [
            "Linux PAM module (pam_solana.so) with keyboard-interactive auth",
            "Local Unix socket IPC with solana-authd daemon",
            "Zero password exposure and automatic replay protection",
        ],
    },
    {
        id: "hardware-isolation",
        title: "Hardware KVM Guest Isolation",
        badge: "Enterprise Hypervisor",
        iconName: "Cpu",
        description: "Instances run on bare-metal AMD EPYC Zen 4 hosts with hardware-enforced CPU core isolation and strictly unshared DDR5 memory spaces.",
        technicalSpecs: [
            "Kernel-based Virtual Machine (KVM) boundary",
            "Dedicated PCIe 4.0 NVMe storage partitions",
            "No CPU oversubscription or noisy neighbor throttling",
        ],
    },
    {
        id: "dedicated-network",
        title: "Dedicated Clean IPv4 Subnet",
        badge: "High Throughput",
        iconName: "Globe",
        description: "Every instance receives a dedicated, non-shared public IPv4 address with unmetered gigabit uplink across tier 1 transits.",
        technicalSpecs: [
            "Clean reputation IP pools without blacklisting",
            "Full reverse DNS (rDNS) customization",
            "Optimized for Solana gRPC, Yellowstone, and Geyser feeds",
        ],
    },
];

export const SYSTEM_COMPONENTS: ArchitectureComponent[] = [
    {
        id: "solana-program",
        name: "Billing & Access Program",
        category: "on-chain",
        role: "On-Chain State Authority",
        description: "Enforces atomic SOL payments, mints payment receipts, calculates subscription validity (Clock sysvar), and manages owner and delegated access grants.",
        techStack: "Rust / Anchor (programs/billing-access)",
        sourcePath: "programs/billing-access",
    },
    {
        id: "pam-module",
        name: "Linux PAM Module",
        category: "vps-daemon",
        role: "OpenSSH Hook (pam_solana.so)",
        description: "C PAM module loaded by OpenSSH during keyboard-interactive authentication. Connects over local Unix socket /run/solana-authd.sock to initiate login challenges.",
        techStack: "Linux C / libpam (ssh/pam/pam_solana.c)",
        sourcePath: "ssh/pam",
    },
    {
        id: "auth-daemon",
        name: "VPS Auth Daemon",
        category: "vps-daemon",
        role: "Access Decision Maker (solana-authd)",
        description: "Generates high-entropy 90s challenges, verifies Ed25519 wallet signatures, and queries finalized on-chain accounts via Solana RPC to decide allow/deny.",
        techStack: "Rust / Unix Socket IPC (ssh/solana-authd)",
        sourcePath: "ssh/solana-authd",
    },
    {
        id: "auth-gateway",
        name: "Auth Gateway & Backend",
        category: "gateway",
        role: "HTTPS Relay & Order Store",
        description: "Relays authentication challenge URLs to browser wallets, coordinates idempotent VM preparation, and stores order records in SQLite.",
        techStack: "Docker / SQLite / HTTPS (backend)",
        sourcePath: "backend",
    },
];

export const ON_CHAIN_ACCOUNTS: OnChainAccount[] = [
    {
        name: "ServerRecord",
        pdaSeeds: "['server', provider_pubkey, server_id]",
        responsibility: "Stores provider terms, fixed price in lamports, rental period in seconds, treasury wallet, and active/disabled flag.",
        fields: ["provider_pubkey", "server_id (32B)", "owner_wallet", "treasury_wallet", "price_lamports", "period_seconds", "enabled"],
    },
    {
        name: "Subscription",
        pdaSeeds: "['subscription', server_record_pda]",
        responsibility: "Tracks the prepaid expiration timestamp (paid_until). Updated atomically with payment receipts.",
        fields: ["server_record", "owner_wallet", "paid_until (unix timestamp)"],
    },
    {
        name: "AccessGrant",
        pdaSeeds: "['grant', server_record_pda, wallet_pubkey]",
        responsibility: "Authorizes specific wallets (OWNER or DELEGATED) with a valid_until boundary to access the VPS.",
        fields: ["server_record", "wallet", "grant_type (OWNER | DELEGATED)", "active (bool)", "valid_until"],
    },
    {
        name: "PaymentReceipt",
        pdaSeeds: "['payment', server_record_pda, payment_id]",
        responsibility: "Immutable record of a successful SOL transfer to treasury, guaranteeing idempotency and preventing duplicate charges.",
        fields: ["server_record", "payer_wallet", "payment_id (32B)", "amount_lamports", "paid_at", "resulting_paid_until"],
    },
];

