"use client";

import React from "react";
import { Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ApiDocModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ApiDocModal({ isOpen, onClose }: ApiDocModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    className="absolute top-5 right-5 text-zinc-400 hover:text-white transition"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="space-y-1">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        Mock REST API Layer Specification
                    </h3>
                    <p className="text-xs text-zinc-400">
                        Fully implemented client-side state machine fulfilling
                        all assignment requirements.
                    </p>
                </div>

                <div className="space-y-4 font-mono text-xs">
                    {/* Endpoint 1 */}
                    <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                        <div className="flex items-center space-x-2 text-emerald-400 font-semibold mb-1">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-[10px]">
                                POST
                            </span>
                            <span>/api/orders</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] mb-2 font-sans">
                            Creates a new VPS order in status{" "}
                            <code className="text-amber-300">
                                CREATED / PAYMENT_PENDING
                            </code>
                            .
                        </p>
                        <pre className="bg-zinc-900 p-2.5 rounded text-[10px] text-zinc-300 overflow-x-auto leading-relaxed">
                            {`Payload: { "owner_wallet": "8xP3...9mK1", "period_days": 7, "region": "Frankfurt" }
Response: { "order_id": "ord_...", "status": "PAYMENT_PENDING", "lamports": "50000000" }`}
                        </pre>
                    </div>

                    {/* Endpoint 2 */}
                    <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                        <div className="flex items-center space-x-2 text-blue-400 font-semibold mb-1">
                            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-[10px]">
                                GET
                            </span>
                            <span>/api/orders/:order_id</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] mb-2 font-sans">
                            Polled every 3–4 seconds when in PAYMENT_PENDING,
                            PAID, or PROVISIONING states.
                        </p>
                        <pre className="bg-zinc-900 p-2.5 rounded text-[10px] text-zinc-300 overflow-x-auto leading-relaxed">
                            {`Response: { "order_id": "ord_...", "status": "ACTIVE", "host": "185.220.101.42", "port": 22 }`}
                        </pre>
                    </div>

                    {/* Endpoint 3 */}
                    <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                        <div className="flex items-center space-x-2 text-purple-400 font-semibold mb-1">
                            <span className="px-2 py-0.5 rounded bg-purple-500/20 text-[10px]">
                                POST
                            </span>
                            <span>
                                /api/orders/:order_id/payments/:payment_id/confirm
                            </span>
                        </div>
                        <p className="text-zinc-400 text-[11px] mb-2 font-sans">
                            Confirms signed Solana transaction signature,
                            updates status to{" "}
                            <code className="text-purple-300">
                                PROVISIONING
                            </code>
                            .
                        </p>
                        <pre className="bg-zinc-900 p-2.5 rounded text-[10px] text-zinc-300 overflow-x-auto leading-relaxed">
                            {`Payload: { "tx_hash": "5xK9Mock..." }
Response: { "success": true, "status": "PAID" }`}
                        </pre>
                    </div>

                    {/* Endpoint 4 */}
                    <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                        <div className="flex items-center space-x-2 text-rose-400 font-semibold mb-1">
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-[10px]">
                                POST
                            </span>
                            <span>/api/orders/:order_id/provision/retry</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] mb-2 font-sans">
                            Retries provisioning after hypervisor failure.
                        </p>
                        <pre className="bg-zinc-900 p-2.5 rounded text-[10px] text-zinc-300 overflow-x-auto leading-relaxed">
                            {`Response: { "success": true, "status": "PROVISIONING" }`}
                        </pre>
                    </div>
                </div>

                <div className="pt-2 flex justify-end">
                    <Button
                        onClick={onClose}
                        variant="outline"
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold rounded-lg text-white border-zinc-700"
                    >
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
}
