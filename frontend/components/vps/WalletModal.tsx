"use client";

import React, { useState } from "react";
import { Wallet, X, AlertCircle, ExternalLink } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { WalletPhantom, WalletSolflare, WalletBackpack } from "@web3icons/react";

interface WalletModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface WalletOption {
    id: string;
    adapterName: string;
    label: string;
    sublabel: string;
    IconComponent: React.ComponentType<{ className?: string; size?: number | string }>;
    installUrl: string;
}

const WALLET_OPTIONS: WalletOption[] = [
    {
        id: "phantom",
        adapterName: "Phantom",
        label: "Phantom",
        sublabel: "Popular browser extension",
        IconComponent: WalletPhantom,
        installUrl: "https://phantom.app/",
    },
    {
        id: "solflare",
        adapterName: "Solflare",
        label: "Solflare",
        sublabel: "Web & Mobile wallet",
        IconComponent: WalletSolflare,
        installUrl: "https://solflare.com/",
    },
    {
        id: "backpack",
        adapterName: "Backpack",
        label: "Backpack",
        sublabel: "xNFT & multi-chain wallet",
        IconComponent: WalletBackpack,
        installUrl: "https://backpack.app/",
    },
];

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
    const { wallets, select, connect, connecting } = useWallet();
    const [missingWallet, setMissingWallet] = useState<WalletOption | null>(null);

    if (!isOpen) return null;

    const handleSelectWallet = async (option: WalletOption) => {
        setMissingWallet(null);

        // Find adapter in wallet-adapter list
        const targetWallet = wallets.find(
            (w) => w.adapter.name.toLowerCase() === option.adapterName.toLowerCase()
        );

        if (targetWallet) {
            // Check if installed/loadable
            if (
                targetWallet.readyState === WalletReadyState.Installed ||
                targetWallet.readyState === WalletReadyState.Loadable
            ) {
                try {
                    select(targetWallet.adapter.name);
                    await connect();
                    onClose();
                    return;
                } catch (err) {
                    console.error("Failed to connect wallet:", err);
                    onClose();
                    return;
                }
            }
        }

        // Check if window object has injected standard wallet directly
        if (typeof window !== "undefined") {
            const hasPhantom = !!(window as unknown as { phantom?: { solana?: unknown } }).phantom?.solana;
            const hasSolflare = !!(window as unknown as { solflare?: unknown }).solflare;
            const hasBackpack = !!(window as unknown as { backpack?: unknown }).backpack;

            const isPresent =
                (option.id === "phantom" && hasPhantom) ||
                (option.id === "solflare" && hasSolflare) ||
                (option.id === "backpack" && hasBackpack);

            if (isPresent && targetWallet) {
                select(targetWallet.adapter.name);
                await connect();
                onClose();
                return;
            }
        }

        // Extension not detected, show fallback install prompt
        setMissingWallet(option);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-6 shadow-2xl relative">
                <button
                    onClick={() => {
                        setMissingWallet(null);
                        onClose();
                    }}
                    className="absolute top-5 right-5 text-zinc-400 hover:text-white transition"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="space-y-1">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mb-3">
                        <Wallet className="w-5 h-5 text-purple-400" />
                    </div>
                    <h3 className="text-lg font-bold text-white">
                        Connect Solana Wallet
                    </h3>
                    <p className="text-xs text-zinc-400">
                        Select your preferred Solana web3 wallet provider to
                        manage cloud instances.
                    </p>
                </div>

                {missingWallet && (
                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3 text-xs">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div className="space-y-1.5 flex-1">
                            <p className="text-amber-200 font-medium">
                                {missingWallet.label} is not installed
                            </p>
                            <p className="text-zinc-400 text-[11px]">
                                Install the browser extension to connect your wallet.
                            </p>
                            <a
                                href={missingWallet.installUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 underline underline-offset-2"
                            >
                                <span>Get {missingWallet.label}</span>
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    </div>
                )}

                <div className="space-y-2.5">
                    {WALLET_OPTIONS.map((option) => {
                        const Icon = option.IconComponent;
                        return (
                            <button
                                key={option.id}
                                onClick={() => handleSelectWallet(option)}
                                disabled={connecting}
                                className="w-full flex items-center justify-between p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 hover:border-purple-500/50 transition group cursor-pointer disabled:opacity-50"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center p-1.5 shadow-xs">
                                        <Icon size={22} className="shrink-0" />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-semibold text-white group-hover:text-purple-300">
                                            {option.label}
                                        </div>
                                        <div className="text-[11px] text-zinc-500 font-mono">
                                            {option.sublabel}
                                        </div>
                                    </div>
                                </div>
                                <span className="text-xs font-mono text-zinc-400 group-hover:text-white">
                                    Connect &rarr;
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="pt-2 text-center">
                    <p className="text-[11px] text-zinc-500">
                        By connecting, you agree to the decentralized
                        infrastructure Terms of Service.
                    </p>
                </div>
            </div>
        </div>
    );
}
