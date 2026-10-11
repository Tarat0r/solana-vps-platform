"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export interface WalletBalanceState {
    balanceLamports: number | null;
    balanceSol: number | null;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useWalletBalance(): WalletBalanceState {
    const { connection } = useConnection();
    const { publicKey, connected } = useWallet();

    const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
    const [balanceSol, setBalanceSol] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const isFetchingRef = useRef(false);

    const fetchBalance = useCallback(async () => {
        if (!publicKey || !connected) {
            setBalanceLamports(null);
            setBalanceSol(null);
            setError(null);
            return;
        }

        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        setIsLoading(true);
        setError(null);

        try {
            const lamports = await connection.getBalance(publicKey, "confirmed");
            setBalanceLamports(lamports);
            setBalanceSol(lamports / LAMPORTS_PER_SOL);
            setError(null);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to fetch balance";
            // Suppress verbose log when cluster validator is offline (e.g. localnet) or rate limited
            setError(message);
        } finally {
            setIsLoading(false);
            isFetchingRef.current = false;
        }
    }, [connection, publicKey, connected]);

    useEffect(() => {
        let isMounted = true;
        const timer = setTimeout(() => {
            if (isMounted) {
                fetchBalance();
            }
        }, 0);
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [fetchBalance]);

    return {
        balanceLamports,
        balanceSol,
        isLoading,
        error,
        refresh: fetchBalance,
    };
}
