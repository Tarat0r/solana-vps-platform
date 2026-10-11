"use client";

import React from "react";
import { ToastMessage } from "@/types/vps";

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        let borderCol = "border-zinc-700 bg-zinc-900 text-zinc-100";
        let dotCol = "bg-purple-400";

        if (toast.type === "success") {
          borderCol = "border-emerald-500/50 bg-zinc-900 text-emerald-300";
          dotCol = "bg-emerald-400";
        } else if (toast.type === "error") {
          borderCol = "border-rose-500/50 bg-zinc-900 text-rose-300";
          dotCol = "bg-rose-400";
        } else if (toast.type === "warn") {
          borderCol = "border-amber-500/50 bg-zinc-900 text-amber-300";
          dotCol = "bg-amber-400";
        }

        return (
          <div
            key={toast.id}
            onClick={() => onDismiss(toast.id)}
            className={`pointer-events-auto px-4 py-3 rounded-xl border ${borderCol} shadow-2xl flex items-center space-x-3 text-xs font-mono transition-all transform animate-in fade-in slide-in-from-bottom-2 duration-200 cursor-pointer`}
          >
            <span className={`w-2 h-2 rounded-full ${dotCol} shrink-0`} />
            <span className="flex-1 break-words">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
