"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useCluster } from "@/providers/ClusterProvider";

export function SolanaWalletProvider({
    children,
    autoConnect = true,
}: {
    children: React.ReactNode;
    autoConnect?: boolean;
}) {
    const { endpoint } = useCluster();

    // Standard wallets (Phantom, Backpack, Solflare) are auto-detected via Wallet Standard
    const wallets = useMemo(() => [], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect={autoConnect}>
                {children}
            </WalletProvider>
        </ConnectionProvider>
    );
}
