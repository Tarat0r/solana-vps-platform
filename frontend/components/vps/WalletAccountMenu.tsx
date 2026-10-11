"use client";

import React, { useState, useRef, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import {
    Copy,
    Check,
    ExternalLink,
    LogOut,
    ChevronDown,
    RefreshCw,
    Wallet,
} from "lucide-react";
import { shortenAddress } from "@/lib/utils";
import { useCluster } from "@/providers/ClusterProvider";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletPhantom, WalletSolflare, WalletBackpack, TokenSOL } from "@web3icons/react";

interface WalletAccountMenuProps {
    publicKey: PublicKey;
    onDisconnect: () => void;
}

export function WalletAccountMenu({
    publicKey,
    onDisconnect,
}: WalletAccountMenuProps) {
    const { cluster } = useCluster();
    const { balanceSol, isLoading: isBalanceLoading, refresh: refreshBalance } = useWalletBalance();
    const [isOpen, setIsOpen] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const base58Address = publicKey.toBase58();

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleCopy = () => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(base58Address).then(() => {
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            });
        }
    };

    const { wallet } = useWallet();
    const walletName = wallet?.adapter.name.toLowerCase() || "";

    const WalletIcon =
        walletName.includes("phantom")
            ? WalletPhantom
            : walletName.includes("solflare")
            ? WalletSolflare
            : walletName.includes("backpack")
            ? WalletBackpack
            : null;

    const explorerUrl = `https://explorer.solana.com/address/${base58Address}${
        cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`
    }`;

    return (
        <div className="relative inline-block text-left" ref={menuRef}>
            {/* Wallet trigger pill */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 text-xs font-mono h-9 transition cursor-pointer text-zinc-200"
            >
                {WalletIcon ? (
                    <WalletIcon size={16} className="shrink-0" />
                ) : (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400/50" />
                )}
                <span className="font-semibold">{shortenAddress(base58Address)}</span>
                {balanceSol !== null && (
                    <span className="text-zinc-400 hidden sm:inline-flex items-center gap-1 border-l border-zinc-800 pl-2">
                        <span>{balanceSol.toFixed(3)}</span>
                        <TokenSOL size={12} className="shrink-0" />
                    </span>
                )}
                <ChevronDown
                    className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-150 ${
                        isOpen ? "rotate-180" : ""
                    }`}
                />
            </button>

            {/* Account Popover Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                    {/* Header info */}
                    <div className="px-3 py-2.5 border-b border-zinc-800/80 mb-1 space-y-1">
                        <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span className="flex items-center gap-1.5">
                                {WalletIcon ? (
                                    <WalletIcon size={15} />
                                ) : (
                                    <Wallet className="w-3.5 h-3.5 text-purple-400" />
                                )}
                                <span>{wallet?.adapter.name || "Connected Wallet"}</span>
                            </span>
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                                {cluster}
                            </span>
                        </div>
                        <div className="text-xs font-mono text-zinc-200 break-all select-all pt-1">
                            {base58Address}
                        </div>
                    </div>

                    {/* Balance display */}
                    <div className="px-3 py-2 flex items-center justify-between bg-zinc-950/60 rounded-lg mx-1 mb-2 border border-zinc-800/60">
                        <div>
                            <div className="text-[10px] uppercase font-mono text-zinc-500">
                                Balance
                            </div>
                            <div className="text-sm font-bold text-white font-mono flex items-center gap-1.5 pt-0.5">
                                {balanceSol !== null ? (
                                    <>
                                        <span>{balanceSol.toFixed(4)}</span>
                                        <TokenSOL size={15} />
                                    </>
                                ) : (
                                    "—"
                                )}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => refreshBalance()}
                            title="Refresh balance"
                            disabled={isBalanceLoading}
                            className="p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition"
                        >
                            <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                    isBalanceLoading ? "animate-spin text-emerald-400" : ""
                                }`}
                            />
                        </button>
                    </div>

                    {/* Actions */}
                    <div className="space-y-1">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-white transition"
                        >
                            <span className="flex items-center gap-2">
                                {isCopied ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                                )}
                                <span>{isCopied ? "Copied to clipboard!" : "Copy Address"}</span>
                            </span>
                        </button>

                        <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-white transition"
                        >
                            <span className="flex items-center gap-2">
                                <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                                <span>View on Solana Explorer</span>
                            </span>
                        </a>

                        <div className="border-t border-zinc-800/80 my-1" />

                        <button
                            type="button"
                            onClick={() => {
                                setIsOpen(false);
                                onDisconnect();
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition"
                        >
                            <span className="flex items-center gap-2">
                                <LogOut className="w-3.5 h-3.5" />
                                <span>Disconnect Wallet</span>
                            </span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
