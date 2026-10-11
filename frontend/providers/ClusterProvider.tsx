"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { clusterApiUrl } from "@solana/web3.js";

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

interface ClusterContextValue {
    cluster: SolanaCluster;
    setCluster: (cluster: SolanaCluster) => void;
    endpoint: string;
    customEndpoint: string | null;
    setCustomEndpoint: (url: string | null) => void;
}

const STORAGE_KEY = "solana_vps_cluster";
const CUSTOM_ENDPOINT_STORAGE_KEY = "solana_vps_custom_endpoint";

const ClusterContext = createContext<ClusterContextValue | null>(null);

function resolveDefaultEndpoint(cluster: SolanaCluster): string {
    if (cluster === "localnet") {
        return process.env.NEXT_PUBLIC_LOCALNET_RPC_URL || "http://127.0.0.1:8899";
    }
    if (cluster === "devnet" && process.env.NEXT_PUBLIC_DEVNET_RPC_URL) {
        return process.env.NEXT_PUBLIC_DEVNET_RPC_URL;
    }
    if (cluster === "mainnet-beta" && process.env.NEXT_PUBLIC_MAINNET_RPC_URL) {
        return process.env.NEXT_PUBLIC_MAINNET_RPC_URL;
    }
    if (cluster === "testnet" && process.env.NEXT_PUBLIC_TESTNET_RPC_URL) {
        return process.env.NEXT_PUBLIC_TESTNET_RPC_URL;
    }
    try {
        return clusterApiUrl(cluster);
    } catch {
        return "https://api.devnet.solana.com";
    }
}

export function ClusterProvider({
    children,
    defaultCluster = "devnet",
}: {
    children: React.ReactNode;
    defaultCluster?: SolanaCluster;
}) {
    const [cluster, setClusterState] = useState<SolanaCluster>(defaultCluster);
    const [customEndpoint, setCustomEndpointState] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== "undefined") {
            const savedCluster = localStorage.getItem(STORAGE_KEY) as SolanaCluster | null;
            if (savedCluster && ["mainnet-beta", "devnet", "testnet", "localnet"].includes(savedCluster)) {
                setClusterState(savedCluster);
            }
            const savedCustom = localStorage.getItem(CUSTOM_ENDPOINT_STORAGE_KEY);
            if (savedCustom) {
                setCustomEndpointState(savedCustom);
            }
        }
    }, []);

    const setCluster = useCallback((newCluster: SolanaCluster) => {
        setClusterState(newCluster);
        if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY, newCluster);
        }
    }, []);

    const setCustomEndpoint = useCallback((endpointUrl: string | null) => {
        setCustomEndpointState(endpointUrl);
        if (typeof window !== "undefined") {
            if (endpointUrl) {
                localStorage.setItem(CUSTOM_ENDPOINT_STORAGE_KEY, endpointUrl);
            } else {
                localStorage.removeItem(CUSTOM_ENDPOINT_STORAGE_KEY);
            }
        }
    }, []);

    const endpoint = useMemo(() => {
        if (customEndpoint && customEndpoint.trim().length > 0) {
            return customEndpoint;
        }
        return resolveDefaultEndpoint(cluster);
    }, [cluster, customEndpoint]);

    const value = useMemo(
        () => ({
            cluster,
            setCluster,
            endpoint,
            customEndpoint,
            setCustomEndpoint,
        }),
        [cluster, setCluster, endpoint, customEndpoint, setCustomEndpoint]
    );

    return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>;
}

export function useCluster(): ClusterContextValue {
    const context = useContext(ClusterContext);
    if (!context) {
        throw new Error("useCluster must be used within a ClusterProvider");
    }
    return context;
}
