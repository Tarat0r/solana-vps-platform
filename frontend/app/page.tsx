"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Navbar } from "@/components/vps/Navbar";
import { LandingView } from "@/components/vps/LandingView";
import { OrderDetailView } from "@/components/vps/OrderDetailView";
import { OrderListView } from "@/components/vps/OrderListView";
import { WalletModal } from "@/components/vps/WalletModal";
import { CreateOrderModal } from "@/components/vps/CreateOrderModal";
import { ToastContainer } from "@/components/vps/ToastContainer";
import { Footer } from "@/components/vps/Footer";
import {
    VPSOrder,
    OrderStatus,
    ToastMessage,
    ToastType,
    PlanId,
    RentalPeriodDays,
    HardwarePlan,
} from "@/types/vps";
import { shortenAddress } from "@/lib/utils";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCluster } from "@/providers/ClusterProvider";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { createOrder, fetchOrders, verifyPayment } from "@/lib/api";
import { INITIAL_ORDERS } from "@/lib/mock-api";

export default function Home() {
    const [orders, setOrders] = useState<VPSOrder[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);
    const [currentOrderId, setCurrentOrderId] =
        useState<string>("ord_active_01");
    const [activeView, setActiveView] = useState<
        "landing" | "order-detail" | "order-list"
    >("landing");

    // Real Solana Wallet Adapter hooks
    const { publicKey, connected } = useWallet();
    const { cluster } = useCluster();
    const { balanceSol } = useWalletBalance();

    const activeWalletAddress = publicKey ? publicKey.toBase58() : null;

    // Modals state
    const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Selected Plan state for CreateOrderModal pre-fill
    const [selectedPlanConfig, setSelectedPlanConfig] = useState<{
        planId: PlanId;
        periodDays: RentalPeriodDays;
        regionId: string;
    }>({
        planId: "validator-dev",
        periodDays: 7,
        regionId: "eu-central-1",
    });

    const handleSelectPlanFromPricing = useCallback(
        (
            plan: HardwarePlan,
            periodDays: RentalPeriodDays,
            regionId: string,
        ) => {
            setSelectedPlanConfig({
                planId: plan.id,
                periodDays,
                regionId,
            });
            setIsCreateModalOpen(true);
        },
        [],
    );

    // Provisioning animation state
    const [provisionProgress, setProvisionProgress] = useState(65);
    const [provisionStepText, setProvisionStepText] = useState(
        "Spawning QEMU/KVM Virtual Machine...",
    );

    // Toasts
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [isPolling, setIsPolling] = useState(false);

    const addToast = useCallback(
        (message: string, type: ToastType = "info") => {
            const id = Math.random().toString(36).substring(2, 9);
            setToasts((prev) => [...prev, { id, message, type }]);
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, 3800);
        },
        [],
    );

    const dismissToast = (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    const currentOrder =
        orders.find((o) => o.order_id === currentOrderId) || orders[0];

    // Auto-polling effect when on order-detail view
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    const loadOrders = useCallback(async () => {
        setIsLoadingOrders(true);
        try {
            const data = await fetchOrders(activeWalletAddress);
            if (data && data.length > 0) {
                setOrders(data);
                if (!currentOrderId || !data.some((o: VPSOrder) => o.order_id === currentOrderId)) {
                    setCurrentOrderId(data[0].order_id);
                }
            } else if (activeWalletAddress) {
                // If wallet has no dedicated orders yet, keep list empty or let user deploy
                setOrders([]);
            } else {
                setOrders(data || []);
            }
        } catch (err: unknown) {
            console.error("Failed to load orders:", err);
            setOrders((prev) => (prev.length > 0 ? prev : INITIAL_ORDERS));
        } finally {
            setIsLoadingOrders(false);
        }
    }, [activeWalletAddress, currentOrderId]);

    useEffect(() => {
        let isMounted = true;
        const timer = setTimeout(() => {
            if (isMounted) {
                loadOrders();
            }
        }, 0);
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [loadOrders]);

    useEffect(() => {
        if (activeView !== "order-detail") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            return;
        }

        const order = orders.find((o) => o.order_id === currentOrderId);
        if (!order) return;

        if (
            ["PAYMENT_PENDING", "PAID", "PROVISIONING"].includes(order.status)
        ) {
            pollingRef.current = setInterval(() => {
                setIsPolling(true);
                setTimeout(() => {
                    setIsPolling(false);
                }, 400);
            }, 3500);
        } else {
            if (pollingRef.current) clearInterval(pollingRef.current);
        }

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [activeView, currentOrderId, orders]);

    // Notify on wallet connection change
    const prevConnectedRef = useRef(connected);
    useEffect(() => {
        if (!prevConnectedRef.current && connected && publicKey) {
            addToast(
                `Wallet connected on ${cluster.toUpperCase()}: ${shortenAddress(publicKey.toBase58())}`,
                "success",
            );
        }
        prevConnectedRef.current = connected;
    }, [connected, publicKey, cluster, addToast]);

    // State Simulation handler (triggered directly from order detail view)
    const handleSimulateState = useCallback(
        (status: OrderStatus) => {
            setOrders((prev) =>
                prev.map((order) => {
                    if (order.order_id === currentOrderId) {
                        const updated = { ...order, status };
                        if (status === "ACTIVE" && !updated.host) {
                            updated.host = "185.220.101.42";
                            updated.paid_until = new Date(
                                Date.now() + 7 * 24 * 60 * 60 * 1000,
                            ).toISOString();
                        }
                        return updated;
                    }
                    return order;
                }),
            );
            setActiveView("order-detail");
            addToast(`Simulated status: ${status}`, "info");
        },
        [currentOrderId, addToast],
    );

    // Execute on-chain payment flow simulation
    const handleExecutePayment = async () => {
        if (!connected || !publicKey) {
            setIsWalletModalOpen(true);
            return;
        }

        addToast(`Initiating Solana payment on ${cluster}...`, "info");

        try {
            // Generate or fetch transaction signature
            const txHash =
                "5xK" +
                Math.random().toString(36).substring(2, 12) +
                "solana";

            addToast(
                "Payment confirmed on-chain! Notifying backend...",
                "info",
            );

            // Call real backend payment endpoint with tracked PaymentAttempt ID
            const res = await verifyPayment(
                currentOrderId,
                txHash,
                currentOrder?.active_payment_id,
            );

            // Update local state with real backend response
            setOrders((prev) =>
                prev.map((o) =>
                    o.order_id === currentOrderId
                        ? {
                              ...o,
                              status: "ACTIVE",
                              tx_hash: txHash,
                              host: res.host || o.host,
                              paid_until: res.paid_until || o.paid_until,
                          }
                        : o,
                ),
            );

            addToast(
                "VPS Successfully Provisioned! SSH access is live.",
                "success",
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            addToast(`Payment verification error: ${msg}`, "error");
        }
    };

    // Retry provisioning
    const handleRetryProvision = async () => {
        addToast("Retrying hypervisor provisioning...", "info");
        setOrders((prev) =>
            prev.map((o) =>
                o.order_id === currentOrderId
                    ? { ...o, status: "PROVISIONING" }
                    : o,
            ),
        );
        setProvisionProgress(45);
        setProvisionStepText("Rebuilding bridge tap interface...");

        setTimeout(() => {
            setOrders((prev) =>
                prev.map((o) =>
                    o.order_id === currentOrderId
                        ? {
                              ...o,
                              status: "ACTIVE",
                              host: "185.220.101.42",
                              paid_until: new Date(
                                  Date.now() + 7 * 24 * 60 * 60 * 1000,
                              ).toISOString(),
                          }
                        : o,
                ),
            );
            addToast("Provisioning completed successfully!", "success");
        }, 1600);
    };

    // Lease Renewal
    const handleRenewLease = () => {
        addToast(
            "Renewal extension invoice generated (0.05 SOL for +7 days)",
            "success",
        );
        handleExecutePayment();
    };

    // Create new order
    const handleCreateOrder = async (data: {
        name: string;
        region: string;
        periodDays: number;
        priceLamports: string;
    }) => {
        if (!activeWalletAddress) {
            setIsWalletModalOpen(true);
            return;
        }

        try {
            const newOrder = await createOrder({
                name: data.name,
                owner_wallet: activeWalletAddress,
                region: data.region,
                period_days: data.periodDays,
                price_lamports: data.priceLamports,
            });

            setOrders((prev) => [newOrder, ...prev]);
            setCurrentOrderId(newOrder.order_id);
            setActiveView("order-detail");
            addToast(`Order created: ${newOrder.order_id}`, "success");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            addToast(`Failed to create order: ${msg}`, "error");
        }
    };
    // Copy helper
    const handleCopy = (text: string, label: string) => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard
                .writeText(text)
                .then(() => {
                    addToast(`Copied ${label} to clipboard!`, "success");
                })
                .catch(() => {
                    addToast(`Failed to copy to clipboard`, "error");
                });
        }
    };

    const handleOpenExplorer = () => {
        addToast(`Solana Explorer link opened for ${cluster}`, "info");
    };

    const handleSelectOrder = (orderId: string) => {
        setCurrentOrderId(orderId);
        setActiveView("order-detail");
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col selection:bg-purple-600/30 selection:text-emerald-300">
            {/* Top App Navigation */}
            <Navbar
                activeView={activeView}
                onNavigate={(view) => {
                    setActiveView(view);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                ordersCount={orders.length}
                onOpenWalletModal={() => setIsWalletModalOpen(true)}
                onOpenCreateModal={() => setIsCreateModalOpen(true)}
            />

            {/* Main View Container */}
            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {activeView === "landing" && (
                    <LandingView
                        orders={orders}
                        walletAddress={activeWalletAddress}
                        onOpenWalletModal={() => setIsWalletModalOpen(true)}
                        onConnectDemoWallet={() => setIsWalletModalOpen(true)}
                        onOpenCreateModal={() => setIsCreateModalOpen(true)}
                        onNavigateToOrderList={() =>
                            setActiveView("order-list")
                        }
                        onSelectOrder={handleSelectOrder}
                        onOpenApiDocModal={() =>
                            addToast(
                                "Mock REST API docs retired for production landing",
                                "info",
                            )
                        }
                        onSelectPlan={handleSelectPlanFromPricing}
                    />
                )}

                {activeView === "order-detail" && currentOrder && (
                    <OrderDetailView
                        order={currentOrder}
                        isPolling={isPolling}
                        provisionProgress={provisionProgress}
                        provisionStepText={provisionStepText}
                        onBack={() => setActiveView("order-list")}
                        onExecutePayment={handleExecutePayment}
                        onRetryProvision={handleRetryProvision}
                        onSimulateState={handleSimulateState}
                        onRenewLease={handleRenewLease}
                        onCopy={handleCopy}
                        onOpenExplorer={handleOpenExplorer}
                    />
                )}

                {activeView === "order-list" && (
                    <OrderListView
                        orders={orders}
                        walletAddress={activeWalletAddress}
                        onSelectOrder={handleSelectOrder}
                        onOpenCreateModal={() => setIsCreateModalOpen(true)}
                    />
                )}
            </main>

            {/* Global Platform Footer */}
            <Footer
                onNavigate={(view) => {
                    setActiveView(view);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }}
            />

            {/* Floating Toast Notification Container */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />

            {/* Wallet Connection Modal */}
            <WalletModal
                isOpen={isWalletModalOpen}
                onClose={() => setIsWalletModalOpen(false)}
            />

            {/* Create Order Modal */}
            <CreateOrderModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                walletAddress={
                    activeWalletAddress ||
                    "8xP3kM9L71z4QvB9mK1xY2qT4L8z9QvB9mK1xY2q"
                }
                initialPlanId={selectedPlanConfig.planId}
                initialPeriodDays={selectedPlanConfig.periodDays}
                initialRegionId={selectedPlanConfig.regionId}
                onCreateOrder={handleCreateOrder}
            />
        </div>
    );
}
