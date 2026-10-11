"use client";

import React, { useState, useEffect } from "react";
import { Server, X, Check, Loader2, Cpu, HardDrive, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanId, RentalPeriodDays } from "@/types/vps";
import { HARDWARE_PLANS, DATACENTER_REGIONS, calculateTierPrice } from "@/lib/pricing";

interface CreateOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletAddress: string;
    initialPlanId?: PlanId;
    initialPeriodDays?: RentalPeriodDays;
    initialRegionId?: string;
    onCreateOrder: (data: {
        name: string;
        region: string;
        periodDays: number;
        priceLamports: string;
    }) => Promise<void>;
}

export function CreateOrderModal({
    isOpen,
    onClose,
    walletAddress,
    initialPlanId = "validator-dev",
    initialPeriodDays = 7,
    initialRegionId = "eu-central-1",
    onCreateOrder,
}: CreateOrderModalProps) {
    const [hostname, setHostname] = useState("production-edge-node");
    const [selectedPlanId, setSelectedPlanId] = useState<PlanId>(initialPlanId);
    const [region, setRegion] = useState<string>(initialRegionId);
    const [period, setPeriod] = useState<RentalPeriodDays>(initialPeriodDays);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Sync state when props change
    useEffect(() => {
        if (isOpen) {
            setSelectedPlanId(initialPlanId);
            setPeriod(initialPeriodDays);
            setRegion(initialRegionId);
        }
    }, [isOpen, initialPlanId, initialPeriodDays, initialRegionId]);

    if (!isOpen) return null;

    const selectedPlan = HARDWARE_PLANS.find((p) => p.id === selectedPlanId) || HARDWARE_PLANS[1];
    const pricing = calculateTierPrice(selectedPlan.baseWeeklySol, period);

    const regionObj = DATACENTER_REGIONS.find((r) => r.id === region) || DATACENTER_REGIONS[0];


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await onCreateOrder({
                name:
                    hostname.trim() ||
                    `vps-node-${Math.random().toString(36).substring(2, 6)}`,
                region: regionObj.name,
                periodDays: period,
                priceLamports: pricing.totalLamports,
            });
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-5 right-5 text-zinc-400 hover:text-white transition cursor-pointer"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="space-y-1">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mb-2">
                        <Server className="w-5 h-5 text-emerald-400" />
                    </div>
                    <h3 className="text-lg font-bold text-white">
                        Create New Solana VPS
                    </h3>
                    <p className="text-xs text-zinc-400">
                        Configure node specifications and generate on-chain payment invoice.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Hardware Tier Selection */}
                    <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                            Hardware Tier
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {HARDWARE_PLANS.map((plan) => {
                                const isSelected = plan.id === selectedPlanId;
                                return (
                                    <button
                                        key={plan.id}
                                        type="button"
                                        onClick={() => setSelectedPlanId(plan.id)}
                                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                                            isSelected
                                                ? "bg-purple-950/40 border-purple-500/80 ring-1 ring-purple-500/50"
                                                : "bg-zinc-950/70 border-zinc-800 hover:border-zinc-700"
                                        }`}
                                    >
                                        <div className="text-xs font-bold text-white truncate">
                                            {plan.name}
                                        </div>
                                        <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                                            {plan.vCpu}vCPU / {plan.ramGb}GB
                                        </div>
                                        <div className="text-[10px] font-mono text-emerald-400 font-semibold mt-1">
                                            {plan.baseWeeklySol} SOL/wk
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                            Instance Hostname
                        </label>
                        <Input
                            type="text"
                            required
                            value={hostname}
                            onChange={(e) => setHostname(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-400"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                                Datacenter Region
                            </label>
                            <select
                                value={region}
                                onChange={(e) => setRegion(e.target.value)}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-400"
                            >
                                {DATACENTER_REGIONS.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.flag} {r.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                                Billing Lease Period
                            </label>
                            <select
                                value={period}
                                onChange={(e) =>
                                    setPeriod(Number(e.target.value) as RentalPeriodDays)
                                }
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-400"
                            >
                                <option value={7}>7 Days (Regular)</option>
                                <option value={14}>14 Days (-10% Off)</option>
                                <option value={30}>30 Days (-20% Off)</option>
                                <option value={90}>90 Days (-25% Off)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                            Owner Wallet Address
                        </label>
                        <Input
                            type="text"
                            readOnly
                            value={walletAddress}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs font-mono text-zinc-400 select-all cursor-not-allowed"
                        />
                        <span className="text-[11px] text-zinc-500 mt-1 block">
                            Injected from active wallet adapter
                        </span>
                    </div>

                    {/* Cost Summary Box */}
                    <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl p-3.5 space-y-1.5 font-mono text-xs">
                        <div className="flex justify-between text-zinc-400">
                            <span>Hardware: {selectedPlan.vCpu} vCPU / {selectedPlan.ramGb} GB RAM / {selectedPlan.storageGb}GB NVMe</span>
                            <span className="text-zinc-200">{selectedPlan.name}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400">
                            <span>Datacenter:</span>
                            <span className="text-zinc-300">{regionObj.city}, {regionObj.country} ({regionObj.pingEstimate})</span>
                        </div>
                        <div className="flex justify-between text-zinc-400">
                            <span>Calculated Lamports:</span>
                            <span className="text-purple-400">
                                {Number(pricing.totalLamports).toLocaleString()}{" "}
                                lamports
                            </span>
                        </div>
                        {pricing.discountPercent > 0 && (
                            <div className="flex justify-between text-zinc-400">
                                <span>Duration Discount:</span>
                                <span className="text-emerald-400 font-semibold">
                                    {pricing.discountPercent}% Saved
                                </span>
                            </div>
                        )}
                        <div className="border-t border-zinc-800 pt-1.5 flex justify-between font-bold text-white">
                            <span>Order Total:</span>
                            <div className="text-right">
                                <span className="text-emerald-400 text-sm">
                                    {pricing.totalSol} SOL
                                </span>
                                <span className="text-zinc-500 text-[11px] block font-normal">
                                    ~${pricing.usdEstimate} USD
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3.5 h-11 rounded-xl bg-emerald-400 hover:bg-emerald-300 font-bold text-xs text-zinc-950 transition flex items-center justify-center space-x-2 border-0 cursor-pointer shadow-md shadow-emerald-950/30 disabled:opacity-50"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
                                <span>Deploying...</span>
                            </>
                        ) : (
                            <>
                                <Check className="w-4 h-4 text-zinc-950" />
                                <span>
                                    Create Order &amp; Proceed to Payment
                                </span>
                            </>
                        )}
                    </Button>
                </form>
            </div>
        </div>
    );
}
