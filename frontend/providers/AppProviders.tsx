"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { ClusterProvider } from "./ClusterProvider";
import { SolanaWalletProvider } from "./SolanaWalletProvider";

interface AppProvidersProps {
    children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <ClusterProvider defaultCluster="devnet">
            <SolanaWalletProvider autoConnect={true}>
                {children}
            </SolanaWalletProvider>
        </ClusterProvider>
    );
}
