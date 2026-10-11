import { VPSOrder, OrderStatus } from "@/types/vps";

export const LAMPORTS_PER_SOL = 1_000_000_000;

export function lamportsToSol(lamports: string | number): string {
    const num = Number(lamports);
    return (num / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, "") + " SOL";
}

export function shortenAddress(addr: string | null | undefined): string {
    if (!addr) return "";
    if (addr.length < 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export const INITIAL_ORDERS: VPSOrder[] = [
    {
        order_id: "ord_active_01",
        name: "vps-solana-validator-fra",
        owner_wallet: "8xP3kM9L71z4QvB9mK1xY2qT4L8z9QvB9mK1xY2q",
        region: "Frankfurt (eu-central-1)",
        status: "ACTIVE",
        price_lamports: "50000000", // 0.05 SOL
        period_days: 7,
        created_at: "2025-05-10T12:00:00Z",
        paid_until: "2025-05-17T12:00:00Z",
        host: "185.220.101.42",
        port: 22,
        username: "ubuntu",
        tx_hash: "5xK9MockSolanaTxHashActive11894a",
    },
    {
        order_id: "ord_pending_02",
        name: "vps-rust-build-box",
        owner_wallet: "8xP3kM9L71z4QvB9mK1xY2qT4L8z9QvB9mK1xY2q",
        region: "Ashburn (us-east-1)",
        status: "PAYMENT_PENDING",
        price_lamports: "50000000",
        period_days: 7,
        created_at: "2025-05-12T08:15:00Z",
        paid_until: null,
        host: "TBD",
        port: 22,
        username: "ubuntu",
        tx_hash: null,
    },
    {
        order_id: "ord_prov_03",
        name: "vps-rpc-proxy-sg",
        owner_wallet: "8xP3kM9L71z4QvB9mK1xY2qT4L8z9QvB9mK1xY2q",
        region: "Singapore (ap-southeast-1)",
        status: "PROVISIONING",
        price_lamports: "90000000", // 0.09 SOL
        period_days: 14,
        created_at: "2025-05-12T09:40:00Z",
        paid_until: null,
        host: "103.25.14.88",
        port: 22,
        username: "ubuntu",
        tx_hash: "4h99SolanaTxConfirmProv771a",
    },
    {
        order_id: "ord_failed_04",
        name: "vps-ephemeral-test-node",
        owner_wallet: "8xP3kM9L71z4QvB9mK1xY2qT4L8z9QvB9mK1xY2q",
        region: "Frankfurt (eu-central-1)",
        status: "PROVISIONING_FAILED",
        price_lamports: "50000000",
        period_days: 7,
        created_at: "2025-05-11T16:20:00Z",
        paid_until: null,
        host: null,
        port: 22,
        username: "ubuntu",
        tx_hash: "3zTxFailedRecordSim8910",
    },
];
