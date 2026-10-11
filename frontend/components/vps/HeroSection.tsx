"use client";

import React, { useState } from "react";
import {
    Terminal,
    Server,
    ShieldCheck,
    Cpu,
    HardDrive,
    Activity,
    ArrowRight,
    Wallet,
    PlusCircle,
    Check,
    Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCluster } from "@/providers/ClusterProvider";
import { useWallet } from "@solana/wallet-adapter-react";

interface HeroSectionProps {
    onOpenWalletModal: () => void;
    onOpenCreateModal: () => void;
    onNavigateToOrderList: () => void;
    activeCount: number;
}

export function HeroSection({
    onOpenWalletModal,
    onOpenCreateModal,
    onNavigateToOrderList,
    activeCount,
}: HeroSectionProps) {
    const { cluster, endpoint } = useCluster();
    const { connected } = useWallet();
    const [copiedSsh, setCopiedSsh] = useState(false);

    const clusterLabel =
        cluster === "mainnet-beta"
            ? "Mainnet Beta"
            : cluster === "testnet"
            ? "Testnet"
            : cluster === "localnet"
            ? "Localnet"
            : "Devnet";

    const clusterDotColor =
        cluster === "mainnet-beta"
            ? "bg-emerald-400"
            : cluster === "testnet"
            ? "bg-amber-400"
            : cluster === "localnet"
            ? "bg-cyan-400"
            : "bg-[#14F195]";

    const sampleSshCommand = "ssh ubuntu@185.220.101.42";

    const handleCopySsh = () => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(sampleSshCommand).then(() => {
                setCopiedSsh(true);
                setTimeout(() => setCopiedSsh(false), 2000);
            });
        }
    };

    const handleScrollToPlans = () => {
        const plansSection = document.getElementById("hardware-plans-section");
        if (plansSection) {
            plansSection.scrollIntoView({ behavior: "smooth" });
        } else {
            // Fallback scroll down
            window.scrollBy({ top: 550, behavior: "smooth" });
        }
    };

    return (
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 via-zinc-950/90 to-zinc-950 p-6 sm:p-10 lg:p-14 solana-glow">
            {/* Background Glow Accents */}
            <div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                {/* Left Column: Technical Narrative & CTAs */}
                <div className="lg:col-span-7 space-y-6">
                    {/* Live Network Status Indicator Badge */}
                    <div className="inline-flex items-center space-x-2.5 px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-300">
                        <span className="relative flex h-2 w-2">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${clusterDotColor} opacity-75`} />
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${clusterDotColor}`} />
                        </span>
                        <span className="text-zinc-200 font-medium">Solana {clusterLabel}</span>
                        <span className="text-zinc-600">•</span>
                        <span className="text-emerald-400 font-semibold">Operational (400ms avg slot)</span>
                    </div>

                    {/* Headline */}
                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.08]">
                        Deploy high-performance VPS, paid in{" "}
                        <span className="solana-gradient-text">SOL.</span>
                    </h1>

                    {/* Subhead / Value Proposition */}
                    <p className="text-base sm:text-lg text-zinc-400 font-normal leading-relaxed max-w-xl">
                        Autonomous edge compute provisioned in under 1 second. Zero credit card, zero KYC, full root SSH access, and automated on-chain lease renewals directly on Solana.
                    </p>

                    {/* Context-Aware Action Buttons */}
                    <div className="pt-2 flex flex-wrap items-center gap-4">
                        {!connected ? (
                            <>
                                <Button
                                    onClick={onOpenWalletModal}
                                    className="px-6 py-3.5 h-12 rounded-xl font-bold text-sm bg-emerald-400 hover:bg-emerald-300 text-zinc-950 transition shadow-lg shadow-emerald-950/40 flex items-center space-x-2 border-0 cursor-pointer"
                                >
                                    <Wallet className="w-4 h-4 text-zinc-950" />
                                    <span>Connect Wallet to Deploy</span>
                                </Button>
                                <Button
                                    onClick={handleScrollToPlans}
                                    variant="outline"
                                    className="px-5 py-3.5 h-12 rounded-xl font-medium text-sm bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 transition flex items-center space-x-2 cursor-pointer"
                                >
                                    <span>Explore Plans &amp; Specs</span>
                                    <ArrowRight className="w-4 h-4 text-zinc-400" />
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    onClick={onOpenCreateModal}
                                    className="px-6 py-3.5 h-12 rounded-xl font-bold text-sm bg-emerald-400 hover:bg-emerald-300 text-zinc-950 transition flex items-center space-x-2 shadow-lg shadow-emerald-900/30 border-0 cursor-pointer"
                                >
                                    <PlusCircle className="w-4 h-4 text-zinc-950" />
                                    <span>Deploy VPS Instance</span>
                                </Button>
                                <Button
                                    onClick={onNavigateToOrderList}
                                    variant="outline"
                                    className="px-5 py-3.5 h-12 rounded-xl font-medium text-sm bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 border border-zinc-700 transition flex items-center space-x-2 cursor-pointer"
                                >
                                    <span>Manage Deployments</span>
                                    <span className="px-1.5 py-0.5 text-xs font-mono rounded bg-zinc-900 text-emerald-400 border border-zinc-700/60 ml-1">
                                        {activeCount} Active
                                    </span>
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Right Column: Interactive Live Node Telemetry Card */}
                <div className="lg:col-span-5">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-2xl backdrop-blur-md space-y-4 relative group">
                        {/* Terminal Title Bar */}
                        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                            <div className="flex items-center space-x-2">
                                <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                                <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                                <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                                <span className="text-xs font-mono text-zinc-400 ml-2">
                                    node-edge-fra01 · telemetry
                                </span>
                            </div>
                            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                                Live
                            </span>
                        </div>

                        {/* Node Specs telemetry */}
                        <div className="space-y-2 text-xs font-mono">
                            <div className="flex items-center justify-between text-zinc-400 py-1 border-b border-zinc-900">
                                <span className="flex items-center gap-1.5">
                                    <Cpu className="w-3.5 h-3.5 text-purple-400" />
                                    <span>Hypervisor CPU</span>
                                </span>
                                <span className="text-zinc-200 font-semibold">AMD EPYC 9654 (Dedicated)</span>
                            </div>

                            <div className="flex items-center justify-between text-zinc-400 py-1 border-b border-zinc-900">
                                <span className="flex items-center gap-1.5">
                                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Provision Latency</span>
                                </span>
                                <span className="text-emerald-400 font-semibold">~850ms (sub-second)</span>
                            </div>

                            <div className="flex items-center justify-between text-zinc-400 py-1 border-b border-zinc-900">
                                <span className="flex items-center gap-1.5">
                                    <Server className="w-3.5 h-3.5 text-blue-400" />
                                    <span>Active Cluster</span>
                                </span>
                                <span className="text-zinc-200">{clusterLabel}</span>
                            </div>

                            <div className="flex items-center justify-between text-zinc-400 py-1">
                                <span className="flex items-center gap-1.5">
                                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                                    <span>Authentication</span>
                                </span>
                                <span className="text-zinc-200">Linux PAM (pam_solana.so)</span>
                            </div>
                        </div>

                        {/* Interactive SSH Command Box */}
                        <div className="pt-2">
                            <div className="text-[11px] text-zinc-500 font-mono mb-1.5 flex items-center justify-between">
                                <span>Root SSH Access Preview</span>
                                <button
                                    onClick={handleCopySsh}
                                    className="text-zinc-400 hover:text-white transition flex items-center gap-1 text-[10px]"
                                >
                                    {copiedSsh ? (
                                        <>
                                            <Check className="w-3 h-3 text-emerald-400" />
                                            <span className="text-emerald-400">Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-3 h-3" />
                                            <span>Copy</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300 flex items-center justify-between">
                                <span className="text-emerald-400 mr-2">$</span>
                                <span className="truncate flex-1 select-all">{sampleSshCommand}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Specs Banner across Bottom */}
            <div className="mt-12 pt-8 border-t border-zinc-800/80 grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
                <div>
                    <div className="text-zinc-500 text-xs font-mono">Processor Architecture</div>
                    <div className="text-white font-semibold mt-1">AMD EPYC 9004 Gen</div>
                    <div className="text-zinc-400 text-xs mt-0.5">High IPC Zen 4 Cores</div>
                </div>
                <div>
                    <div className="text-zinc-500 text-xs font-mono">Uplink Throughput</div>
                    <div className="text-white font-semibold mt-1">1 Gbps Unmetered</div>
                    <div className="text-zinc-400 text-xs mt-0.5">Dedicated static IPv4 included</div>
                </div>
                <div>
                    <div className="text-zinc-500 text-xs font-mono">Storage Tier</div>
                    <div className="text-white font-semibold mt-1">Enterprise NVMe SSD</div>
                    <div className="text-zinc-400 text-xs mt-0.5">Up to 7,000 MB/s IOPS</div>
                </div>
                <div>
                    <div className="text-zinc-500 text-xs font-mono">Service Reliability</div>
                    <div className="text-emerald-400 font-semibold mt-1">99.98% Uptime SLA</div>
                    <div className="text-zinc-400 text-xs mt-0.5">Distributed Tier 3 facilities</div>
                </div>
            </div>
        </div>
    );
}
