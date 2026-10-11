"use client";

import React from "react";
import { Server, Wallet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@solana/wallet-adapter-react";
import { ClusterDropdown } from "@/components/vps/ClusterDropdown";
import { WalletAccountMenu } from "@/components/vps/WalletAccountMenu";

interface NavbarProps {
    activeView: string;
    onNavigate: (view: "landing" | "order-detail" | "order-list") => void;
    ordersCount: number;
    onOpenWalletModal: () => void;
    onOpenCreateModal: () => void;
}

export function Navbar({
    activeView,
    onNavigate,
    ordersCount,
    onOpenWalletModal,
    onOpenCreateModal,
}: NavbarProps) {
    const { publicKey, connected, disconnect, connecting } = useWallet();

    return (
        <header className="border-b border-zinc-800/80 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                {/* Brand Logo & Cluster Switcher */}
                <div className="flex items-center space-x-4">
                    <div
                        className="flex items-center space-x-3 cursor-pointer group"
                        onClick={() => onNavigate("landing")}
                    >
                        <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#9945FF] to-[#14F195] p-0.5 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-105 transition-transform">
                            <div className="w-full h-full bg-[#0e0e11] rounded-[10px] flex items-center justify-center">
                                <Server className="w-4 h-4 text-emerald-400" />
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <span className="font-bold text-base tracking-tight text-white">
                                    Solana
                                    <span className="text-zinc-400 font-medium">
                                        VPS
                                    </span>
                                </span>
                            </div>
                            <p className="text-[11px] text-zinc-500 font-mono leading-none hidden sm:block">
                                instant edge micro-nodes
                            </p>
                        </div>
                    </div>

                    {/* Interactive Cluster Switcher Dropdown */}
                    <div className="border-l border-zinc-800 pl-4 hidden sm:block">
                        <ClusterDropdown />
                    </div>
                </div>

                {/* Nav Links */}
                <nav className="hidden md:flex items-center space-x-1 font-medium text-sm text-zinc-400">
                    <button
                        onClick={() => onNavigate("landing")}
                        className={`px-3 py-1.5 rounded-lg transition ${
                            activeView === "landing"
                                ? "text-white bg-zinc-800/60 font-semibold"
                                : "hover:text-white hover:bg-zinc-800/40"
                        }`}
                    >
                        Home
                    </button>
                    <button
                        onClick={() => onNavigate("order-list")}
                        className={`px-3 py-1.5 rounded-lg transition flex items-center gap-2 ${
                            activeView === "order-list"
                                ? "text-white bg-zinc-800/60 font-semibold"
                                : "hover:text-white hover:bg-zinc-800/40"
                        }`}
                    >
                        <span>Deployments</span>
                        <span className="px-1.5 py-0.5 text-[11px] font-mono rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                            {ordersCount}
                        </span>
                    </button>
                </nav>

                {/* Right Actions: Cluster Switcher (mobile) + Wallet + Deploy */}
                <div className="flex items-center space-x-3">
                    <div className="sm:hidden">
                        <ClusterDropdown />
                    </div>

                    {/* Deploy VPS Button */}
                    <Button
                        onClick={onOpenCreateModal}
                        className="hidden sm:inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 h-9 rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white transition shadow-sm"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Deploy VPS</span>
                    </Button>

                    {/* Connected Wallet Popover or Connect Button */}
                    {connected && publicKey ? (
                        <WalletAccountMenu
                            publicKey={publicKey}
                            onDisconnect={() => disconnect()}
                        />
                    ) : (
                        <Button
                            onClick={onOpenWalletModal}
                            disabled={connecting}
                            className="inline-flex items-center space-x-2 text-xs font-semibold px-3.5 py-2 h-9 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition shadow-md shadow-purple-900/30 border-0 disabled:opacity-50 cursor-pointer"
                        >
                            <Wallet className="w-3.5 h-3.5" />
                            <span>{connecting ? "Connecting..." : "Connect Wallet"}</span>
                        </Button>
                    )}
                </div>
            </div>
        </header>
    );
}
