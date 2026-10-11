"use client";

import React from "react";
import {
  ChevronRight,
  Terminal,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VPSOrder, HardwarePlan, RentalPeriodDays } from "@/types/vps";
import { lamportsToSol } from "@/lib/mock-api";
import { HeroSection } from "@/components/vps/HeroSection";
import { PricingSection } from "@/components/vps/PricingSection";
import { ArchitectureSecuritySection } from "@/components/vps/ArchitectureSecuritySection";
import { FaqSection } from "@/components/vps/FaqSection";

interface LandingViewProps {
  orders: VPSOrder[];
  walletAddress: string | null;
  onOpenWalletModal: () => void;
  onConnectDemoWallet: () => void;
  onOpenCreateModal: () => void;
  onNavigateToOrderList: () => void;
  onSelectOrder: (orderId: string) => void;
  onOpenApiDocModal: () => void;
  onSelectPlan: (plan: HardwarePlan, periodDays: RentalPeriodDays, regionId: string) => void;
}

export function LandingView({
  orders,
  onOpenWalletModal,
  onOpenCreateModal,
  onNavigateToOrderList,
  onSelectOrder,
  onOpenApiDocModal,
  onSelectPlan,
}: LandingViewProps) {
  const activeCount = orders.filter((o) => o.status === "ACTIVE").length;
  const recentOrders = orders.slice(0, 3);

  return (
    <section className="space-y-16 animate-in fade-in duration-200">
      {/* High-Impact Hero Section */}
      <HeroSection
        onOpenWalletModal={onOpenWalletModal}
        onOpenCreateModal={onOpenCreateModal}
        onNavigateToOrderList={onNavigateToOrderList}
        activeCount={activeCount}
      />

      {/* VPS Hardware Specifications and Pricing Calculator */}
      <PricingSection onSelectPlan={onSelectPlan} />

      {/* Quick Jump / Recent Instances Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Active Deployments &amp; Quick Access
            </h2>
            <p className="text-xs text-zinc-400">
              Select any instance below to explore its live order lifecycle state
            </p>
          </div>
          <button
            onClick={onNavigateToOrderList}
            className="text-xs font-mono text-zinc-400 hover:text-emerald-400 transition flex items-center space-x-1 cursor-pointer"
          >
            <span>View All ({orders.length})</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recentOrders.map((order) => (
            <div
              key={order.order_id}
              onClick={() => onSelectOrder(order.order_id)}
              className="group cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-850/80 hover:border-zinc-700 transition p-4 space-y-3 relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300 group-hover:text-emerald-400 transition">
                    <Server className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition truncate max-w-[150px]">
                      {order.name}
                    </h3>
                    <p className="text-[10px] font-mono text-zinc-500">
                      {order.region}
                    </p>
                  </div>
                </div>

                {/* Status Badge */}
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase ${
                    order.status === "ACTIVE"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-medium"
                      : order.status === "PAYMENT_PENDING"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : order.status === "PROVISIONING"
                      ? "bg-purple-500/10 text-purple-400 border-purple-500/30 animate-pulse"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                  }`}
                >
                  {order.status}
                </span>
              </div>

              <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-500">
                  {order.host ? `${order.host}:${order.port}` : "Host TBD"}
                </span>
                <span className="text-zinc-300 font-semibold">
                  {lamportsToSol(order.price_lamports)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Technical Architecture & Security Showcase Section */}
      <ArchitectureSecuritySection onOpenCreateModal={onOpenCreateModal} />

      {/* Interactive FAQ Section */}
      <FaqSection />
    </section>
  );
}
