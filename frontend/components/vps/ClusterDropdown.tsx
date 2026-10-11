"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Globe } from "lucide-react";
import { useCluster, SolanaCluster } from "@/providers/ClusterProvider";

interface ClusterOption {
    id: SolanaCluster;
    name: string;
    badge: string;
    description: string;
    colorDot: string;
    activeBorder: string;
}

const CLUSTERS: ClusterOption[] = [
    {
        id: "mainnet-beta",
        name: "Mainnet Beta",
        badge: "Mainnet",
        description: "Production Solana cluster",
        colorDot: "bg-emerald-400",
        activeBorder: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
    },
    {
        id: "devnet",
        name: "Devnet",
        badge: "Devnet",
        description: "Primary testing environment",
        colorDot: "bg-purple-400",
        activeBorder: "border-purple-500/40 text-purple-400 bg-purple-500/10",
    },
    {
        id: "testnet",
        name: "Testnet",
        badge: "Testnet",
        description: "Validator stress testing",
        colorDot: "bg-amber-400",
        activeBorder: "border-amber-500/40 text-amber-400 bg-amber-500/10",
    },
    {
        id: "localnet",
        name: "Localnet",
        badge: "Local",
        description: "Local validator (127.0.0.1:8899)",
        colorDot: "bg-cyan-400",
        activeBorder: "border-cyan-500/40 text-cyan-400 bg-cyan-500/10",
    },
];

export function ClusterDropdown() {
    const { cluster, setCluster } = useCluster();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentOption = CLUSTERS.find((c) => c.id === cluster) || CLUSTERS[1];

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (selectedCluster: SolanaCluster) => {
        setCluster(selectedCluster);
        setIsOpen(false);
    };

    return (
        <div className="relative inline-block text-left" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 text-xs font-mono transition text-zinc-300 hover:text-white"
            >
                <span className={`w-2 h-2 rounded-full ${currentOption.colorDot} shadow-xs shadow-current`} />
                <span className="font-medium">{currentOption.badge}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-64 origin-top-left sm:origin-top-right rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-2 border-b border-zinc-800/80 mb-1">
                        <div className="flex items-center space-x-1.5 text-xs font-semibold text-zinc-200">
                            <Globe className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Select Solana Cluster</span>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            Active RPC switches dynamically
                        </p>
                    </div>

                    <div className="space-y-1">
                        {CLUSTERS.map((item) => {
                            const isSelected = item.id === cluster;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => handleSelect(item.id)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition text-xs ${
                                        isSelected
                                            ? "bg-zinc-800/80 text-white font-medium"
                                            : "hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200"
                                    }`}
                                >
                                    <div className="flex items-center space-x-2.5">
                                        <span className={`w-2 h-2 rounded-full ${item.colorDot}`} />
                                        <div>
                                            <div className="text-xs font-semibold text-zinc-200">
                                                {item.name}
                                            </div>
                                            <div className="text-[10px] text-zinc-500 font-mono">
                                                {item.description}
                                            </div>
                                        </div>
                                    </div>
                                    {isSelected && (
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
