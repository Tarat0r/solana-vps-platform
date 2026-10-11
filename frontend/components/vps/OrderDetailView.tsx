"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Clock,
  Zap,
  Loader2,
  CheckCircle2,
  CheckCircle,
  Cpu,
  AlertTriangle,
  RotateCw,
  RefreshCw,
  Terminal,
  Copy,
  Calendar,
  ExternalLink,
  Code,
  Check,
  KeyRound,
  Users,
  Trash2,
  ShieldCheck,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VPSOrder, OrderStatus } from "@/types/vps";
import { lamportsToSol, shortenAddress } from "@/lib/utils";
import { TerminalConsole } from "@/components/vps/TerminalConsole";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchSshChallenge,
  submitChallengeResponse,
  fetchDelegates,
  addDelegate as apiAddDelegate,
  removeDelegate as apiRemoveDelegate,
} from "@/lib/api";

interface OrderDetailViewProps {
  order: VPSOrder;
  isPolling: boolean;
  provisionProgress: number;
  provisionStepText: string;
  onBack: () => void;
  onExecutePayment: () => void;
  onRetryProvision: () => void;
  onSimulateState: (status: OrderStatus) => void;
  onRenewLease: () => void;
  onCopy: (text: string, label: string) => void;
  onOpenExplorer: () => void;
}

export function OrderDetailView({
  order,
  isPolling,
  provisionProgress,
  provisionStepText,
  onBack,
  onExecutePayment,
  onRetryProvision,
  onSimulateState,
  onRenewLease,
  onCopy,
  onOpenExplorer,
}: OrderDetailViewProps) {
  const priceSol = lamportsToSol(order.price_lamports);
  const isTerminal = ["ACTIVE", "PROVISIONING_FAILED", "EXPIRED"].includes(order.status);
  const { publicKey, signMessage } = useWallet();

  // SSH Challenge state
  const [challengeData, setChallengeData] = useState<{ challenge: string; expires_at: string } | null>(null);
  const [isFetchingChallenge, setIsFetchingChallenge] = useState(false);
  const [isSigningChallenge, setIsSigningChallenge] = useState(false);
  const [challengeStatus, setChallengeStatus] = useState<string | null>(null);

  // Delegates state
  const [delegates, setDelegates] = useState<{ delegate_wallet: string; created_at: string }[]>([]);
  const [newDelegateInput, setNewDelegateInput] = useState("");
  const [isAddingDelegate, setIsAddingDelegate] = useState(false);

  useEffect(() => {
    if (order.order_id && order.status === "ACTIVE") {
      fetchDelegates(order.order_id)
        .then((data) => setDelegates(data))
        .catch(() => {});
    }
  }, [order.order_id, order.status]);

  const handleGetChallenge = async () => {
    setIsFetchingChallenge(true);
    setChallengeStatus(null);
    try {
      const data = await fetchSshChallenge(order.order_id);
      setChallengeData({ challenge: data.challenge, expires_at: data.expires_at });
    } catch (err: any) {
      setChallengeStatus(`Failed to load challenge: ${err.message}`);
    } finally {
      setIsFetchingChallenge(false);
    }
  };

  const handleSignChallenge = async () => {
    if (!challengeData || !publicKey || !signMessage) {
      setChallengeStatus("Wallet is not connected or does not support message signing");
      return;
    }
    setIsSigningChallenge(true);
    try {
      const messageBytes = new TextEncoder().encode(challengeData.challenge);
      const signatureBytes = await signMessage(messageBytes);
      const signatureHex = Array.from(signatureBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await submitChallengeResponse(order.order_id, publicKey.toBase58(), signatureHex);
      setChallengeStatus("Authentication verified! pam_solana has granted SSH session access.");
    } catch (err: any) {
      setChallengeStatus(`Signing failed: ${err.message}`);
    } finally {
      setIsSigningChallenge(false);
    }
  };

  const handleAddDelegate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDelegateInput.trim()) return;
    setIsAddingDelegate(true);
    try {
      await apiAddDelegate(order.order_id, newDelegateInput.trim());
      const updated = await fetchDelegates(order.order_id);
      setDelegates(updated);
      setNewDelegateInput("");
    } catch (err) {
      console.error(err);
    } finally {
      setIsAddingDelegate(false);
    }
  };

  const handleRemoveDelegate = async (delegateWallet: string) => {
    try {
      await apiRemoveDelegate(order.order_id, delegateWallet);
      setDelegates((prev) => prev.filter((d) => d.delegate_wallet !== delegateWallet));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <section className="space-y-6 animate-in fade-in duration-200">
      {/* Back Breadcrumb & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div className="flex items-center space-x-3">
          <Button
            onClick={onBack}
            variant="outline"
            size="icon"
            className="p-2 h-9 w-9 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>{order.name}</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium font-mono border badge-${order.status.toLowerCase()}`}
                >
                  {order.status}
                </span>
              </h1>
            </div>
            <div className="flex items-center space-x-2 text-xs text-zinc-400 font-mono mt-0.5">
              <span>Order ID:</span>
              <span className="text-zinc-200">{order.order_id}</span>
              <span>•</span>
              <span>{order.region}</span>
              <span>•</span>
              <span>{new Date(order.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Poller Activity Status Indicator */}
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              !isTerminal ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
            }`}
          />
          <span className="text-zinc-400">
            {!isTerminal ? "Auto-polling /api/orders (3s)" : `Idle (Terminal State: ${order.status})`}
          </span>
        </div>
      </div>

      {/* Detail Card Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Main Lifecycle Status State Panels */}
        <div className="lg:col-span-2 space-y-6">
          {/* STATE A: CREATED / PAYMENT_PENDING */}
          {(order.status === "CREATED" || order.status === "PAYMENT_PENDING") && (
            <div className="rounded-2xl border border-amber-500/30 bg-zinc-900/60 p-6 sm:p-8 space-y-6 relative overflow-hidden animate-in fade-in duration-200">
              <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <div className="inline-flex items-center space-x-1.5 text-xs font-mono text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-md border border-amber-400/20 mb-3">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Awaiting Solana Transaction</span>
                  </div>
                  <h2 className="text-xl font-bold text-white">Payment Required to Provision</h2>
                  <p className="text-xs text-zinc-400 mt-1 max-w-md">
                    Your VPS hardware configuration is reserved. Complete the on-chain payment to
                    trigger automated provisioning.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-zinc-500 font-mono">Total Due</span>
                  <div className="text-3xl font-extrabold text-white font-mono mt-0.5">
                    {priceSol}
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    {Number(order.price_lamports).toLocaleString()} lamports
                  </span>
                </div>
              </div>

              {/* Pricing Breakdown Box */}
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs font-mono">
                <div className="flex justify-between text-zinc-400">
                  <span>Billing Period</span>
                  <span className="text-zinc-200">{order.period_days} Days</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>vCPU &amp; Memory Allocation</span>
                  <span className="text-zinc-200">2 vCPU / 4 GB DDR4</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>NVMe Block Storage (80 GB)</span>
                  <span className="text-zinc-200">Included</span>
                </div>
                <div className="border-t border-zinc-800/80 pt-2 flex justify-between font-bold text-white text-sm">
                  <span>Total Amount</span>
                  <span className="text-amber-400">{priceSol}</span>
                </div>
              </div>

              {/* Pay Now CTA Button */}
              <div className="space-y-3">
                <Button
                  onClick={onExecutePayment}
                  className="w-full py-4 h-12 rounded-xl bg-emerald-400 hover:bg-emerald-300 font-bold text-sm text-zinc-950 transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950/40 border-0 cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-zinc-950" />
                  <span>Pay {priceSol} Now</span>
                </Button>
                <div className="flex items-center justify-center space-x-4 text-[11px] text-zinc-500 font-mono">
                  <span>⚡ Devnet / Mainnet Simulation</span>
                  <span>•</span>
                  <span>Auto-sign with Connected Wallet</span>
                </div>
              </div>
            </div>
          )}

          {/* STATE B: PAID / PROCESSING LOADING SKELETON */}
          {order.status === "PAID" && (
            <div className="rounded-2xl border border-blue-500/30 bg-zinc-900/60 p-8 text-center space-y-6 animate-in fade-in duration-200">
              <div className="w-16 h-16 mx-auto rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
              <div className="space-y-2 max-w-md mx-auto">
                <h3 className="text-lg font-bold text-white">
                  Signing &amp; Confirming Solana Transaction
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Interacting with the Solana RPC cluster, building instruction payloads, awaiting
                  signature and confirming on-chain hash...
                </p>
              </div>
              <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 font-mono text-xs text-left max-w-lg mx-auto space-y-1.5 text-zinc-400">
                <div className="flex items-center text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                  <span>Wallet signature requested</span>
                </div>
                <div className="flex items-center text-blue-400 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  <span>Awaiting block confirmation (Commitment: confirmed)</span>
                </div>
                <div className="text-[11px] text-zinc-500 truncate">
                  Tx: {order.tx_hash || "5xK9MockTxSignatureDevnet449Sol"}
                </div>
              </div>
            </div>
          )}

          {/* STATE C: PROVISIONING IN PROGRESS */}
          {order.status === "PROVISIONING" && (
            <div className="rounded-2xl border border-purple-500/30 bg-zinc-900/60 p-8 space-y-6 relative overflow-hidden animate-in fade-in duration-200">
              <div className="absolute -top-12 -right-12 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl" />

              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-purple-400 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Provisioning Your Cloud VPS...</h3>
                  <p className="text-xs text-zinc-400">
                    Hypervisor node is formatting NVMe storage &amp; booting Ubuntu 24.04 LTS kernel
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-zinc-400">
                  <span>{provisionStepText || "Spawning QEMU/KVM Virtual Machine..."}</span>
                  <span className="text-purple-400">{provisionProgress}%</span>
                </div>
                <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-emerald-400 h-full transition-all duration-500 ease-out"
                    style={{ width: `${provisionProgress}%` }}
                  />
                </div>
              </div>

              {/* Provisioning Steps Checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800 flex items-center space-x-2 text-emerald-400">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Payment Confirmed on-chain</span>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800 flex items-center space-x-2 text-emerald-400">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Public IPv4 routed: {order.host || "185.220.101.42"}</span>
                </div>
                <div
                  className={`p-3 rounded-lg border flex items-center space-x-2 ${
                    provisionProgress >= 75
                      ? "bg-zinc-950/70 border-zinc-800 text-emerald-400"
                      : "bg-purple-950/20 border-purple-500/30 text-purple-300"
                  }`}
                >
                  {provisionProgress >= 75 ? (
                    <Check className="w-4 h-4 shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
                  )}
                  <span>Injecting SSH authorized_keys</span>
                </div>
                <div
                  className={`p-3 rounded-lg border flex items-center space-x-2 ${
                    provisionProgress >= 90
                      ? "bg-zinc-950/70 border-zinc-800 text-emerald-400"
                      : "bg-zinc-950/50 border-zinc-800/60 text-zinc-500"
                  }`}
                >
                  {provisionProgress >= 90 ? (
                    <Check className="w-4 h-4 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 shrink-0" />
                  )}
                  <span>Final system health check</span>
                </div>
              </div>
            </div>
          )}

          {/* STATE D: PROVISIONING FAILED */}
          {order.status === "PROVISIONING_FAILED" && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/10 p-6 sm:p-8 space-y-6 animate-in fade-in duration-200">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-rose-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white">Provisioning Failed</h3>
                  <p className="text-xs text-rose-300">
                    Node hypervisor encountered an allocation timeout while configuring the upstream
                    network bridge. Your payment is safely recorded.
                  </p>
                  <div className="mt-2 text-xs font-mono text-zinc-400 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                    Error Code: ERR_HYPERVISOR_BRIDGE_TIMEOUT (host_node_id: frankfurt-fra1-rack4)
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                  onClick={onRetryProvision}
                  className="px-5 py-2.5 h-10 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs flex items-center space-x-2 transition shadow-lg shadow-rose-950/50 border-0"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Retry Provisioning (POST /retry)</span>
                </Button>
                <Button
                  onClick={() => onSimulateState("ACTIVE")}
                  variant="outline"
                  className="px-4 py-2.5 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs border border-zinc-700"
                >
                  Force Success State
                </Button>
              </div>
            </div>
          )}

          {/* STATE E: ACTIVE (SUCCESS STATE WITH SSH CREDENTIALS) */}
          {order.status === "ACTIVE" && (
            <div className="rounded-2xl border border-emerald-500/30 bg-zinc-900/60 p-6 sm:p-8 space-y-6 relative overflow-hidden animate-in fade-in duration-200">
              <div className="absolute -top-10 -right-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h2 className="text-lg font-bold text-white">VPS is Active &amp; Healthy</h2>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                        ONLINE
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Instance is running. Connect immediately via SSH using the credentials below.
                    </p>
                  </div>
                </div>

                {/* Quick Renew Button */}
                <Button
                  onClick={onRenewLease}
                  variant="outline"
                  className="px-3.5 py-2 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-200 hover:text-white transition flex items-center space-x-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Renew Lease</span>
                </Button>
              </div>

              {/* Master SSH One-Liner Box */}
              <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-purple-400" />
                    Quick Connect Command
                  </span>
                  <button
                    onClick={() =>
                      onCopy(
                        `ssh ${order.username || "ubuntu"}@${order.host || "185.220.101.42"} -p ${order.port || 22}`,
                        "Quick SSH Command"
                      )
                    }
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1 cursor-pointer transition"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                </div>
                <div className="font-mono text-xs sm:text-sm text-zinc-200 bg-zinc-900/90 px-3.5 py-2.5 rounded-lg border border-zinc-800/80 flex items-center justify-between select-all overflow-x-auto">
                  <span className="text-emerald-400">
                    ssh{" "}
                    <span className="text-zinc-100">
                      {order.username || "ubuntu"}@{order.host || "185.220.101.42"}
                    </span>{" "}
                    -p {order.port || 22}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-purple-950/20 border border-purple-500/30 flex items-start space-x-2.5 text-xs">
                  <div className="w-4 h-4 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5 font-mono text-[10px] font-bold">
                    PAM
                  </div>
                  <div className="text-zinc-300 text-[11px] leading-relaxed">
                    <strong className="text-purple-300 font-semibold">Linux PAM Authentication (pam_solana.so):</strong>{" "}
                    When you connect via standard OpenSSH, PAM prompts for wallet authorization. Open the displayed challenge link, sign the 90-second challenge with Phantom or Solflare, and the daemon grants terminal access.
                  </div>
                </div>
              </div>

              {/* Breakdown of Host, Port, User Credentials with Copy Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                {/* Host IP */}
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800/80 space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                      Host IPv4
                    </span>
                    <button
                      onClick={() => onCopy(order.host || "185.220.101.42", "Host IP")}
                      className="text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-bold text-white text-sm">
                    {order.host || "185.220.101.42"}
                  </div>
                  <div className="text-[10px] text-zinc-500">Dedicated static IP</div>
                </div>

                {/* Port */}
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800/80 space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                      SSH Port
                    </span>
                    <button
                      onClick={() => onCopy(String(order.port || 22), "SSH Port")}
                      className="text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-bold text-white text-sm">{order.port || 22}</div>
                  <div className="text-[10px] text-zinc-500">Default standard</div>
                </div>

                {/* Username */}
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800/80 space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                      Username
                    </span>
                    <button
                      onClick={() => onCopy(order.username || "ubuntu", "Username")}
                      className="text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-bold text-white text-sm">
                    {order.username || "ubuntu"}
                  </div>
                  <div className="text-[10px] text-zinc-500">Root sudoer privileges</div>
                </div>
              </div>

              {/* Expiration & Renewal Date Details */}
              <div className="flex flex-wrap items-center justify-between p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 text-xs">
                <div className="flex items-center space-x-3">
                  <Calendar className="w-4 h-4 text-zinc-400" />
                  <div>
                    <span className="text-zinc-400">Paid Until:</span>
                    <span className="font-mono font-medium text-white ml-1.5">
                      {order.paid_until
                        ? new Date(order.paid_until).toUTCString()
                        : "Nov 18, 2025, 14:00 UTC"}
                    </span>
                  </div>
                </div>
                <div className="text-zinc-400 text-xs mt-2 sm:mt-0">
                  Auto-terminate after 24hr grace period if not renewed.
                </div>
              </div>

              {/* SSH Challenge Signing Panel (solana-authd & pam_solana integration) */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <KeyRound className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-semibold text-white">
                      SSH Gateway Challenge Verification (solana-authd)
                    </span>
                  </div>
                  <Button
                    onClick={handleGetChallenge}
                    disabled={isFetchingChallenge}
                    variant="outline"
                    className="h-8 px-3 text-xs bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-200"
                  >
                    {isFetchingChallenge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Fetch Daemon Challenge"}
                  </Button>
                </div>

                {challengeData && (
                  <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>Exact Challenge Payload:</span>
                      <span className="text-amber-400">Expires: {new Date(challengeData.expires_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="p-2 rounded bg-black text-emerald-400 break-all select-all">
                      {challengeData.challenge}
                    </div>
                    <Button
                      onClick={handleSignChallenge}
                      disabled={isSigningChallenge}
                      className="w-full h-9 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs border-0"
                    >
                      {isSigningChallenge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Sign with Connected Wallet &amp; Authorize PAM</>}
                    </Button>
                  </div>
                )}

                {challengeStatus && (
                  <div className="text-xs p-2.5 rounded bg-zinc-900 border border-purple-500/30 text-purple-200 font-mono">
                    {challengeStatus}
                  </div>
                )}
              </div>

              {/* Delegated Access Management Panel */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-white">
                      Delegated Access Grants (Secondary Wallets)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {delegates.length} Authorized
                  </span>
                </div>

                <form onSubmit={handleAddDelegate} className="flex gap-2">
                  <input
                    type="text"
                    value={newDelegateInput}
                    onChange={(e) => setNewDelegateInput(e.target.value)}
                    placeholder="Enter delegate Solana public key..."
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 font-mono focus:outline-hidden focus:border-emerald-500"
                  />
                  <Button
                    type="submit"
                    disabled={isAddingDelegate || !newDelegateInput.trim()}
                    className="h-8 px-3 text-xs bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-semibold border-0"
                  >
                    {isAddingDelegate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3 h-3 mr-1" /> Grant</>}
                  </Button>
                </form>

                {delegates.length > 0 ? (
                  <div className="space-y-1.5 pt-1">
                    {delegates.map((d) => (
                      <div
                        key={d.delegate_wallet}
                        className="flex items-center justify-between p-2 rounded-lg bg-zinc-900 border border-zinc-800/80 text-xs font-mono"
                      >
                        <span className="text-zinc-300 truncate max-w-[260px]">
                          {d.delegate_wallet}
                        </span>
                        <button
                          onClick={() => handleRemoveDelegate(d.delegate_wallet)}
                          className="text-zinc-500 hover:text-rose-400 transition cursor-pointer p-1"
                          title="Revoke access"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 font-mono">
                    No secondary delegates added. Only the owner wallet can authenticate via SSH.
                  </p>
                )}
              </div>

              {/* Interactive In-Browser Live Terminal Console */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    Live In-Browser Shell Console
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    Live KVM Session
                  </span>
                </div>
                <TerminalConsole
                  hostname={order.name || "production-edge-node"}
                  ipAddress={order.host || "185.220.101.42"}
                  username={order.username || "ubuntu"}
                  region={order.region || "Frankfurt (eu-central-1)"}
                />
              </div>
            </div>
          )}

          {/* Server Hardware Spec & OS Metrics */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-zinc-400">
              Instance Hardware &amp; Metrics
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div className="bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block text-[11px]">Operating System</span>
                <span className="text-zinc-200 font-medium mt-1 block">Ubuntu 24.04 LTS</span>
              </div>
              <div className="bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block text-[11px]">vCPU Compute</span>
                <span className="text-zinc-200 font-medium mt-1 block">2 Cores (AMD EPYC)</span>
              </div>
              <div className="bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block text-[11px]">Memory (RAM)</span>
                <span className="text-zinc-200 font-medium mt-1 block">4,096 MB ECC</span>
              </div>
              <div className="bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block text-[11px]">Storage IOPS</span>
                <span className="text-zinc-200 font-medium mt-1 block">80 GB NVMe (15k IOPS)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Order Meta, Owner Wallet, and Payment Transaction Hash */}
        <div className="space-y-6">
          {/* Order Summary Card */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 space-y-4">
            <h3 className="text-sm font-bold text-white tracking-tight">Order Information</h3>

            <div className="space-y-3 text-xs font-mono">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Status</span>
                <span className="font-bold text-zinc-200">{order.status}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Owner Wallet</span>
                <span className="text-emerald-400 truncate max-w-[150px]">
                  {shortenAddress(order.owner_wallet)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Datacenter</span>
                <span className="text-zinc-200">{order.region}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Price in SOL</span>
                <span className="text-zinc-200 font-bold">{priceSol}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Lamports</span>
                <span className="text-zinc-500">{order.price_lamports}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-zinc-400">Created At</span>
                <span className="text-zinc-300">
                  {new Date(order.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Solana Explorer Link */}
            <div className="pt-2">
              <button
                onClick={onOpenExplorer}
                className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-400 hover:text-zinc-200 flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                <span>View on Solana Explorer</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Dev API Console Snapshot */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-emerald-400" />
                REST Endpoint
              </span>
              <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                GET 200 OK
              </span>
            </div>
            <pre className="bg-zinc-950 p-3 rounded-lg text-[11px] font-mono text-zinc-400 overflow-x-auto border border-zinc-800/60 max-h-64">
              {JSON.stringify(order, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
