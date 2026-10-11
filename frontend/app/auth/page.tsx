"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ShieldCheck,
  Terminal,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";
import { WalletModal } from "@/components/vps/WalletModal";
import { fetchGatewayChallenge, submitGatewaySignature, GatewayChallenge, bytesToBase64 } from "@/lib/api";
import { shortenAddress } from "@/lib/utils";

function AuthChallengeContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const { publicKey, connected, signMessage } = useWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const [challenge, setChallenge] = useState<GatewayChallenge | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(sessionId));
  const [error, setError] = useState<string | null>(
    sessionId
      ? null
      : "No session_id query parameter provided. Please connect to your VPS via SSH to initiate authentication."
  );

  const [isSigning, setIsSigning] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [now, setNow] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  // Fetch challenge on mount or sessionId change
  useEffect(() => {
    if (!sessionId) return;

    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchGatewayChallenge(sessionId!);
        if (isMounted) {
          setChallenge(data);
          if (data.status === "SUBMITTED" || data.status === "CONSUMED") {
            setIsSuccess(true);
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : "Failed to load authentication challenge";
          setError(msg);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  // Interval timer for 90s session TTL countdown
  useEffect(() => {
    if (!challenge?.expires_at) return;

    const timer = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [challenge?.expires_at]);

  const expiryTime = challenge?.expires_at ? new Date(challenge.expires_at).getTime() : null;
  const secondsRemaining =
    expiryTime !== null && now > 0 ? Math.max(0, Math.floor((expiryTime - now) / 1000)) : null;
  const isExpired = secondsRemaining !== null && secondsRemaining <= 0;

  const handleCopyChallenge = () => {
    if (!challenge) return;
    navigator.clipboard.writeText(challenge.exact_challenge_bytes);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSign = async () => {
    if (!challenge || !sessionId || !publicKey || !signMessage) {
      setError("Wallet is not connected or does not support message signing");
      return;
    }

    setIsSigning(true);
    setError(null);

    try {
      const messageBytes = new TextEncoder().encode(challenge.exact_challenge_bytes);
      const signatureBytes = await signMessage(messageBytes);
      const signatureBase64 = bytesToBase64(signatureBytes);

      await submitGatewaySignature(sessionId, publicKey.toBase58(), signatureBase64);
      setIsSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign or submit gateway challenge";
      setError(msg);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Back Link */}
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to VPS Platform
        </Link>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-6 md:p-8 shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 pb-6 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <ShieldCheck className="w-5 h-5" />
              </span>
              <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                SSH Gateway Authentication
              </h1>
            </div>
            <p className="text-sm text-zinc-400">
              Sign the cryptographic challenge with your Solana wallet to authenticate into your Linux VPS.
            </p>
          </div>

          {secondsRemaining !== null && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-medium shrink-0 ${
                isExpired
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : secondsRemaining < 30
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-purple-500/10 text-purple-400 border-purple-500/20"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{isExpired ? "EXPIRED" : `${secondsRemaining}s TTL`}</span>
            </div>
          )}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="py-16 text-center">
            <div className="inline-block w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-zinc-400 text-sm">Fetching authentication session from Auth Gateway...</p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-red-300">Authentication Error</p>
              <p className="text-red-400/90 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Success state */}
        {isSuccess && (
          <div className="py-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-white">Signature Submitted Successfully</h2>
              <p className="text-sm text-zinc-400 max-w-md mx-auto">
                <code className="text-zinc-300 font-mono">solana-authd</code> has retrieved your proof and is verifying on-chain access grants via Solana RPC. Return to your SSH terminal.
              </p>
            </div>
            <div className="pt-2">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Session unlocked &bull; PAM_SUCCESS
              </div>
            </div>
          </div>
        )}

        {/* Challenge details & signing */}
        {!isLoading && !isSuccess && challenge && (
          <div className="space-y-6">
            {/* Session info cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Server ID</p>
                <p className="text-sm font-mono font-medium text-white truncate" title={challenge.server_id}>
                  {challenge.server_id}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">UNIX User</p>
                <p className="text-sm font-mono font-medium text-purple-400">
                  {challenge.unix_user}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Session ID</p>
                <p className="text-sm font-mono font-medium text-zinc-300 truncate" title={challenge.session_id}>
                  {challenge.session_id}
                </p>
              </div>
            </div>

            {/* Exact challenge bytes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Exact Challenge Payload
                </span>
                <button
                  type="button"
                  onClick={handleCopyChallenge}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-300 break-all select-all leading-relaxed">
                {challenge.exact_challenge_bytes}
              </div>
            </div>

            {/* Wallet connection / signing actions */}
            <div className="pt-2">
              {!connected ? (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-400 text-center">
                    Connect the Solana wallet that owns or is delegated access to this server.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsWalletModalOpen(true)}
                    className="w-full py-3.5 px-4 rounded-xl font-medium text-sm text-white bg-purple-600 hover:bg-purple-500 active:bg-purple-700 transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                  >
                    <KeyRound className="w-4 h-4" />
                    Connect Wallet to Sign
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs">
                    <span className="text-zinc-400">Connected Wallet:</span>
                    <span className="font-mono text-zinc-200 font-medium">
                      {publicKey ? shortenAddress(publicKey.toBase58()) : ""}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isSigning || isExpired}
                    onClick={handleSign}
                    className="w-full py-3.5 px-4 rounded-xl font-medium text-sm text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                  >
                    {isSigning ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Signing with Wallet...</span>
                      </>
                    ) : isExpired ? (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        <span>Session Expired (Restart SSH)</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Sign Challenge &amp; Authorize SSH Access</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Architectural note */}
            <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/60 text-xs text-zinc-500 space-y-1">
              <p className="font-medium text-zinc-400">Off-Chain Relay &amp; On-Chain Verification</p>
              <p>
                No on-chain transaction or SOL fee is executed during login. The daemon verifies your Ed25519 signature and on-chain <code className="text-zinc-400">AccessGrant</code> account directly over Solana RPC.
              </p>
            </div>
          </div>
        )}
      </div>

      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />
    </div>
  );
}

export default function AuthPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] text-zinc-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="py-24 text-center text-zinc-500">
            Loading session...
          </div>
        }
      >
        <AuthChallengeContent />
      </Suspense>
    </main>
  );
}
