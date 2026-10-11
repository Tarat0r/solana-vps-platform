"use client";

import React, { useState } from "react";
import {
    ChevronDown,
    HelpCircle,
    Sparkles,
    Shield,
    CreditCard,
    Cpu,
    CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FAQ_ITEMS } from "@/lib/faq-data";
import { FaqItem } from "@/types/vps";

export function FaqSection() {
    const [selectedCategory, setSelectedCategory] = useState<"all" | "auth" | "billing" | "hardware">("all");
    const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
        "pam-auth-flow": true,
    });

    const toggleItem = (id: string) => {
        setExpandedIds((prev) => ({
            ...prev,
            [id]: !prev[id],
        }));
    };

    const filteredFaqs = selectedCategory === "all"
        ? FAQ_ITEMS
        : FAQ_ITEMS.filter((item) => item.category === selectedCategory);

    return (
        <section
            id="faq-section"
            className="space-y-10 py-10 scroll-mt-20 animate-in fade-in duration-200"
        >
            {/* Header */}
            <div className="text-center max-w-3xl mx-auto space-y-3">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-mono text-purple-300">
                    <HelpCircle className="w-3.5 h-3.5 text-purple-400" />
                    <span>Frequently Asked Questions</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                    Everything You Need to Know
                </h2>
                <p className="text-sm sm:text-base text-zinc-400">
                    Clear answers on our Linux PAM wallet authentication, on-chain lease renewals, server specs, and privacy guarantees.
                </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center justify-center flex-wrap gap-2">
                {[
                    { id: "all", label: "All Questions" },
                    { id: "auth", label: "PAM & Auth", icon: Shield },
                    { id: "billing", label: "Billing & Renewals", icon: CreditCard },
                    { id: "hardware", label: "Hardware & Network", icon: Cpu },
                ].map((tab) => {
                    const isSelected = selectedCategory === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSelectedCategory(tab.id as any)}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all duration-150 flex items-center space-x-1.5 cursor-pointer ${
                                isSelected
                                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/25 border border-purple-500 font-semibold"
                                    : "bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700"
                            }`}
                        >
                            {Icon && <Icon className="w-3 h-3" />}
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* FAQ Accordion List */}
            <div className="max-w-3xl mx-auto space-y-3">
                {filteredFaqs.map((faq) => {
                    const isExpanded = !!expandedIds[faq.id];
                    return (
                        <div
                            key={faq.id}
                            className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                                isExpanded
                                    ? "bg-zinc-900/80 border-purple-500/40 shadow-lg shadow-purple-950/20"
                                    : "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700/80"
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => toggleItem(faq.id)}
                                className="w-full p-5 text-left flex items-start justify-between gap-4 cursor-pointer"
                                aria-expanded={isExpanded}
                            >
                                <span className="font-semibold text-sm sm:text-base text-zinc-100 leading-snug">
                                    {faq.question}
                                </span>
                                <div
                                    className={`w-6 h-6 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 mt-0.5 text-zinc-400 transition-transform duration-200 ${
                                        isExpanded ? "rotate-180 text-purple-400 border-purple-500/50" : ""
                                    }`}
                                >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                </div>
                            </button>

                            {isExpanded && (
                                <div className="px-5 pb-5 pt-1 space-y-3 text-xs sm:text-sm text-zinc-300 leading-relaxed border-t border-zinc-800/60 animate-in fade-in duration-150">
                                    <p>{faq.answer}</p>
                                    {faq.highlight && (
                                        <div className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-500/30 flex items-center space-x-2 text-xs font-mono text-purple-300">
                                            <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                            <span>{faq.highlight}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
