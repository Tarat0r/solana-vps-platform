import { HardwarePlan, RentalPeriodDays, DatacenterRegion } from "@/types/vps";

export const HARDWARE_PLANS: HardwarePlan[] = [
    {
        id: "edge-micro",
        name: "Edge Micro",
        tagline: "Ultra-low latency edge proxies, relays & bots",
        badge: "Lightweight",
        vCpu: 2,
        cpuModel: "AMD EPYC Zen 4",
        ramGb: 4,
        storageGb: 80,
        storageType: "Gen4 NVMe",
        bandwidth: "Unmetered",
        portSpeed: "1 Gbps Dedicated",
        baseWeeklySol: 0.05,
        targetWorkload: "RPC Proxies, TG Trading Bots, Relays",
    },
    {
        id: "validator-dev",
        name: "Validator Dev",
        tagline: "High throughput devnet validators & rust builds",
        badge: "Most Popular",
        popular: true,
        vCpu: 4,
        cpuModel: "AMD EPYC Zen 4",
        ramGb: 16,
        storageGb: 250,
        storageType: "Gen4 NVMe",
        bandwidth: "Unmetered",
        portSpeed: "2.5 Gbps Dedicated",
        baseWeeklySol: 0.15,
        targetWorkload: "Devnet/Testnet Validators, CI/CD Rust Pipelines",
    },
    {
        id: "rpc-turbo",
        name: "RPC Turbo",
        tagline: "High memory indexers & full archival nodes",
        badge: "Maximum IOPS",
        vCpu: 8,
        cpuModel: "AMD EPYC Zen 4",
        ramGb: 32,
        storageGb: 600,
        storageType: "Gen4 NVMe Enterprise",
        bandwidth: "Unmetered",
        portSpeed: "10 Gbps Dedicated",
        baseWeeklySol: 0.35,
        targetWorkload: "Geyser Plugins, Yellowstone gRPC, High-load Indexers",
    },
];

export const DATACENTER_REGIONS: DatacenterRegion[] = [
    {
        id: "eu-central-1",
        name: "Frankfurt (eu-central-1)",
        city: "Frankfurt",
        country: "Germany",
        flag: "🇩🇪",
        pingEstimate: "18ms",
    },
    {
        id: "us-east-1",
        name: "Ashburn (us-east-1)",
        city: "Virginia",
        country: "United States",
        flag: "🇺🇸",
        pingEstimate: "24ms",
    },
    {
        id: "ap-southeast-1",
        name: "Singapore (ap-southeast-1)",
        city: "Singapore",
        country: "Singapore",
        flag: "🇸🇬",
        pingEstimate: "35ms",
    },
];

export const REFERENCE_SOL_USD_RATE = 160;

export interface PricingCalculation {
    periodDays: RentalPeriodDays;
    totalSol: number;
    totalLamports: string;
    usdEstimate: number;
    discountPercent: number;
    effectiveDailySol: number;
}

export function calculateTierPrice(
    baseWeeklySol: number,
    periodDays: RentalPeriodDays
): PricingCalculation {
    let discountPercent = 0;
    let factor = 1;

    switch (periodDays) {
        case 7:
            factor = 1;
            discountPercent = 0;
            break;
        case 14:
            factor = 2 * 0.90; // 10% discount
            discountPercent = 10;
            break;
        case 30:
            factor = (30 / 7) * 0.80; // 20% discount
            discountPercent = 20;
            break;
        case 90:
            factor = (90 / 7) * 0.75; // 25% discount
            discountPercent = 25;
            break;
    }

    const totalSol = Number((baseWeeklySol * factor).toFixed(4));
    const totalLamports = Math.round(totalSol * 1_000_000_000).toString();
    const usdEstimate = Number((totalSol * REFERENCE_SOL_USD_RATE).toFixed(2));
    const effectiveDailySol = Number((totalSol / periodDays).toFixed(4));

    return {
        periodDays,
        totalSol,
        totalLamports,
        usdEstimate,
        discountPercent,
        effectiveDailySol,
    };
}
