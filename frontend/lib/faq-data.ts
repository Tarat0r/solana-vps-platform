import { FaqItem } from "@/types/vps";

export const FAQ_ITEMS: FaqItem[] = [
    {
        id: "pam-auth-flow",
        category: "auth",
        question: "How does SSH authentication work without static passwords or uploaded keys?",
        answer: "When you run 'ssh ubuntu@<vps-ip>', OpenSSH triggers our native Linux PAM module (pam_solana.so). The module requests an ephemeral 90-second challenge from the local solana-authd daemon and displays a verification link. You sign this challenge in your browser using Phantom or Solflare. The daemon cryptographically verifies the Ed25519 signature and on-chain access grant, allowing PAM to admit you directly to root shell.",
        highlight: "OpenSSH keyboard-interactive auth via pam_solana.so & solana-authd",
    },
    {
        id: "lease-expiration",
        category: "billing",
        question: "What happens when my VPS rental lease period expires?",
        answer: "Your instance enters a 24-hour grace period upon lease expiry. You can renew your lease at any time from the dashboard by submitting an on-chain renewal transaction (renew_access instruction) with zero downtime. If not renewed after the grace window, the VM storage volume is safely zeroized and decommissioned to protect user privacy.",
        highlight: "24-hour grace period with zero-downtime on-chain renewals",
    },
    {
        id: "validator-workloads",
        category: "hardware",
        question: "Can I run Solana validator nodes or high-throughput indexers on these servers?",
        answer: "Yes! All instances are powered by dedicated AMD EPYC Zen 4 cores with PCIe 4.0 NVMe storage (up to 7,000 MB/s IOPS) and unmetered gigabit ports. Tiers like 'Validator Dev' (16GB RAM) and 'RPC Turbo' (32GB RAM) are pre-tuned with sysctl kernel parameters specifically optimized for Yellowstone gRPC, Geyser plugins, and Solana devnet/testnet validator workloads.",
        highlight: "Pre-tuned sysctl kernel parameters for Solana UDP & gRPC throughput",
    },
    {
        id: "zero-kyc-privacy",
        category: "auth",
        question: "Are any email addresses, phone numbers, or credit cards required?",
        answer: "None. We operate on a strict zero-KYC philosophy. Your account identity is purely your Solana public key. We store no tracking cookies, require no credit check, and retain no billing history beyond the publicly verifiable on-chain payment receipt (PaymentReceipt PDA).",
        highlight: "100% pseudonymous: wallet address is your sole identity",
    },
    {
        id: "datacenter-locations",
        category: "hardware",
        question: "Where are the physical datacenter facilities located?",
        answer: "Instances are hosted in certified Tier 3+ facilities across three strategic global zones: Frankfurt, Germany (eu-central-1, ~18ms avg slot latency to European Solana nodes), Ashburn, Virginia (us-east-1, ~24ms latency), and Singapore (ap-southeast-1, ~35ms latency) with redundant dark-fiber uplinks.",
        highlight: "Tier 3+ facilities in Frankfurt (DE), Ashburn (US), and Singapore (SG)",
    },
    {
        id: "team-delegation",
        category: "auth",
        question: "Can I grant team members or DevOps engineers access without sharing keys?",
        answer: "Yes. The on-chain billing and access program includes native grant_delegated_access instructions. As the server owner, you can designate secondary Solana wallet addresses with temporary access boundaries, allowing teammates to authenticate through pam_solana.so without ever transferring ownership.",
        highlight: "Native on-chain delegation via grant_delegated_access",
    },
    {
        id: "payment-reconciliation",
        category: "billing",
        question: "How are on-chain payments reconciled if my transaction times out?",
        answer: "Every payment intent receives a unique, stable 32-byte payment ID. The backend verifies finalized on-chain receipts before provisioning. If network congestion delays block inclusion, the system idempotently polls the cluster without creating duplicate charges or overwriting your reservation.",
        highlight: "Idempotent payment IDs prevent duplicate charges",
    },
];
