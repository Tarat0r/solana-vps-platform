"use client";

import React, { useState } from "react";
import {
    Cpu,
    HardDrive,
    Zap,
    Globe,
    Check,
    ArrowRight,
    Server,
    Shield,
    Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    HARDWARE_PLANS,
    DATACENTER_REGIONS,
    calculateTierPrice,
    REFERENCE_SOL_USD_RATE,
} from "@/lib/pricing";
import { HardwarePlan, DatacenterRegion, RentalPeriodDays } from "@/types/vps";

interface PricingSectionProps {
    onSelectPlan: (plan: HardwarePlan, periodDays: RentalPeriodDays, regionId: string) => void;
}

const PERIOD_OPTIONS: { days: RentalPeriodDays; label: string; badge?: string }[] = [
    { days: 7, label: "7 Days" },
    { days: 14, label: "14 Days", badge: "-10%" },
    { days: 30, label: "30 Days", badge: "-20%" },
    { days: 90, label: "90 Days", badge: "-25%" },
];

export function PricingSection({ onSelectPlan }: PricingSectionProps) {
    const [selectedPeriod, setSelectedPeriod] = useState<RentalPeriodDays>(7);
    const [selectedRegion, setSelectedRegion] = useState<string>("eu-central-1");

    const currentRegion = DATACENTER_REGIONS.find((r) => r.id === selectedRegion) || DATACENTER_REGIONS[0];

    return (
        <section id="hardware-plans-section" className="space-y-10 py-6 scroll-mt-20">
            {/* Section Header */}
            <div className="text-center max-w-3xl mx-auto space-y-3">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-mono text-purple-300">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span>Transparent On-Chain Pricing</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                    Bare-Metal Performance. Paid in SOL.
                </h2>
                <p className="text-sm sm:text-base text-zinc-400">
                    Deploy high performance AMD EPYC Zen 4 micro-nodes with zero lock-in contracts, sub-second provisioning, and automated on-chain lease renewal.
                </p>
            </div>

            {/* Controls Bar: Duration Switcher & Datacenter Region */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-3 rounded-2xl bg-zinc-900/60 border border-zinc-800 backdrop-blur-md max-w-4xl mx-auto">
                {/* Duration Pills */}
                <div className="flex items-center space-x-1.5 p-1 rounded-xl bg-zinc-950 border border-zinc-800/80 w-full sm:w-auto">
                    {PERIOD_OPTIONS.map((opt) => {
                        const isSelected = selectedPeriod === opt.days;
                        return (
                            <button
                                key={opt.days}
                                onClick={() => setSelectedPeriod(opt.days)}
                                className={`flex-1 sm:flex-initial flex items-center justify-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                                    isSelected
                                        ? "bg-purple-600/20 text-purple-300 border border-purple-500/40 font-semibold"
                                        : "text-zinc-400 hover:text-white hover:bg-zinc-850"
                                }`}
                            >
                                <span>{opt.label}</span>
                                {opt.badge && (
                                    <span
                                        className={`text-[10px] px-1 py-0.2 rounded font-bold ${
                                            isSelected
                                                ? "bg-purple-500 text-zinc-950"
                                                : "bg-zinc-800 text-emerald-400"
                                        }`}
                                    >
                                        {opt.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Region Selector Pills */}
                <div className="flex items-center space-x-1.5 w-full sm:w-auto justify-end">
                    <span className="text-xs font-mono text-zinc-500 hidden md:inline-flex items-center gap-1 mr-1">
                        <Globe className="w-3.5 h-3.5" />
                        <span>Datacenter:</span>
                    </span>
                    <div className="flex items-center space-x-1 p-1 rounded-xl bg-zinc-950 border border-zinc-800/80 w-full sm:w-auto">
                        {DATACENTER_REGIONS.map((region) => {
                            const isSelected = selectedRegion === region.id;
                            return (
                                <button
                                    key={region.id}
                                    onClick={() => setSelectedRegion(region.id)}
                                    className={`flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                                        isSelected
                                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold"
                                            : "text-zinc-400 hover:text-white"
                                    }`}
                                >
                                    <span>{region.flag}</span>
                                    <span>{region.city}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Plan Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                {HARDWARE_PLANS.map((plan) => {
                    const price = calculateTierPrice(plan.baseWeeklySol, selectedPeriod);
                    const isPopular = plan.popular;

                    return (
                        <div
                            key={plan.id}
                            className={`rounded-3xl border p-6 flex flex-col justify-between transition-all duration-200 relative ${
                                isPopular
                                    ? "bg-gradient-to-b from-zinc-900/90 to-zinc-950 border-purple-500/40 shadow-xl shadow-purple-950/20 ring-1 ring-purple-500/20"
                                    : "bg-zinc-950/70 border-zinc-800/90 hover:border-zinc-700/80"
                            }`}
                        >
                            {/* Popular Highlight Badge */}
                            {isPopular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <span className="px-3 py-1 rounded-full text-[10px] uppercase font-mono font-bold bg-gradient-to-r from-purple-500 to-emerald-400 text-zinc-950 shadow-md">
                                        Most Popular Tier
                                    </span>
                                </div>
                            )}

                            <div>
                                {/* Header: Plan name, badge, and tagline */}
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-xl font-bold text-white tracking-tight">
                                        {plan.name}
                                    </h3>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
                                        {plan.badge}
                                    </span>
                                </div>
                                <p className="text-xs text-zinc-400 min-h-[32px] leading-relaxed mb-6">
                                    {plan.tagline}
                                </p>

                                {/* Dynamic Price Box */}
                                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 mb-6 space-y-1">
                                    <div className="flex items-baseline justify-between">
                                        <div className="flex items-baseline space-x-1.5">
                                            <span className="text-2xl sm:text-3xl font-black text-white font-mono">
                                                {price.totalSol}
                                            </span>
                                            <span className="text-sm font-bold text-emerald-400 font-mono">
                                                SOL
                                            </span>
                                        </div>
                                        <span className="text-xs font-mono text-zinc-400">
                                            / {selectedPeriod} Days
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-1 border-t border-zinc-800/60">
                                        <span>~${price.usdEstimate} USD</span>
                                        <span className="text-zinc-400">
                                            {price.totalLamports.slice(0, 3)}M lamports
                                        </span>
                                    </div>
                                </div>

                                {/* Detailed Hardware Specs */}
                                <div className="space-y-3 text-xs font-mono mb-6">
                                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-900 text-zinc-300">
                                        <span className="flex items-center gap-2 text-zinc-400">
                                            <Cpu className="w-3.5 h-3.5 text-purple-400" />
                                            <span>vCPU Compute</span>
                                        </span>
                                        <span className="font-semibold text-white">
                                            {plan.vCpu} Cores (AMD EPYC)
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-900 text-zinc-300">
                                        <span className="flex items-center gap-2 text-zinc-400">
                                            <Server className="w-3.5 h-3.5 text-emerald-400" />
                                            <span>DDR5 Memory</span>
                                        </span>
                                        <span className="font-semibold text-white">
                                            {plan.ramGb} GB RAM
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-900 text-zinc-300">
                                        <span className="flex items-center gap-2 text-zinc-400">
                                            <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                                            <span>NVMe Storage</span>
                                        </span>
                                        <span className="font-semibold text-white">
                                            {plan.storageGb} GB {plan.storageType}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-1.5 border-b border-zinc-900 text-zinc-300">
                                        <span className="flex items-center gap-2 text-zinc-400">
                                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                                            <span>Uplink Port</span>
                                        </span>
                                        <span className="font-semibold text-white">
                                            {plan.portSpeed}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-1.5 text-zinc-300">
                                        <span className="flex items-center gap-2 text-zinc-400">
                                            <Shield className="w-3.5 h-3.5 text-emerald-400" />
                                            <span>Static IPv4 &amp; IPv6</span>
                                        </span>
                                        <span className="text-emerald-400 font-semibold">Included</span>
                                    </div>
                                </div>
                            </div>

                            {/* Target workload hint & Deploy CTA */}
                            <div className="space-y-3 pt-3 border-t border-zinc-900">
                                <div className="text-[11px] text-zinc-500 font-mono">
                                    <span className="text-zinc-400 font-semibold">Best for: </span>
                                    <span>{plan.targetWorkload}</span>
                                </div>

                                <Button
                                    onClick={() => onSelectPlan(plan, selectedPeriod, selectedRegion)}
                                    className={`w-full h-11 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer shadow-md ${
                                        isPopular
                                            ? "bg-emerald-400 hover:bg-emerald-300 text-zinc-950 shadow-emerald-950/30 border-0"
                                            : "bg-zinc-100 hover:bg-white text-zinc-950 border-0"
                                    }`}
                                >
                                    <span>Deploy {plan.name}</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
