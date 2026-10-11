"use client";

import React from "react";
import { OrderStatus } from "@/types/vps";

interface StateBarProps {
  onSimulateState: (status: OrderStatus) => void;
  currentOrderId: string;
}

export function StateBar({ onSimulateState, currentOrderId }: StateBarProps) {
  return (
    <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping mr-1.5" />
            Live Mock Engine
          </span>
          <span className="text-zinc-500">|</span>
          <span className="text-zinc-300">Quick Test Order Lifecycle States:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <button
            onClick={() => onSimulateState("PAYMENT_PENDING")}
            className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition cursor-pointer"
          >
            1. PAYMENT_PENDING
          </button>
          <button
            onClick={() => onSimulateState("PAID")}
            className="px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 transition cursor-pointer"
          >
            2. PAID
          </button>
          <button
            onClick={() => onSimulateState("PROVISIONING")}
            className="px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 transition cursor-pointer"
          >
            3. PROVISIONING
          </button>
          <button
            onClick={() => onSimulateState("ACTIVE")}
            className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition cursor-pointer"
          >
            4. ACTIVE (SSH)
          </button>
          <button
            onClick={() => onSimulateState("PROVISIONING_FAILED")}
            className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition cursor-pointer"
          >
            5. FAILED
          </button>
        </div>
      </div>
    </div>
  );
}
