"use client";

import React from "react";
import {
    Server,
    ExternalLink,
    ArrowUp,
    Shield,
    Heart,
    Terminal,
    Code2,
    Activity,
} from "lucide-react";
import { useCluster } from "@/providers/ClusterProvider";

interface FooterProps {
    onNavigate?: (view: "landing" | "order-detail" | "order-list") => void;
}

export function Footer({ onNavigate }: FooterProps) {
    const { cluster, endpoint } = useCluster();

    const scrollToTop = () => {
        if (typeof window !== "undefined") {
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const clusterBadgeColor =
        cluster === "mainnet-beta"
            ? "bg-emerald-400"
            : cluster === "testnet"
            ? "bg-amber-400"
            : "bg-[#14F195]";

    return (
        <footer className="border-t border-zinc-800/80 bg-[#070709] mt-20 text-zinc-400 text-xs font-sans">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
                {/* Top Section */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    {/* Col 1: Brand & Description */}
                    <div className="space-y-4 md:col-span-1">
                        <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-xl bg-linear-to-br from-[#9945FF] to-[#14F195] p-0.5 flex items-center justify-center shadow-md shadow-purple-500/20">
                                <div className="w-full h-full bg-[#0e0e11] rounded-[10px] flex items-center justify-center">
                                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                                </div>
                            </div>
                            <span className="font-bold text-base text-white tracking-tight">
                                Solana<span className="text-zinc-400 font-medium">VPS</span>
                            </span>
                        </div>
                        <p className="text-zinc-400 leading-relaxed text-xs">
                            Decentralized bare-metal cloud compute on AMD EPYC Zen 4. Zero KYC, native Linux PAM wallet authentication, and automated on-chain lease renewals.
                        </p>
                        {/* Live Cluster Pill */}
                        <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
                            <span className={`w-2 h-2 rounded-full ${clusterBadgeColor} animate-pulse`} />
                            <span className="capitalize">{cluster} Cluster</span>
                        </div>
                    </div>

                    {/* Col 2: Navigation Links */}
                    <div className="space-y-3">
                        <h4 className="text-white font-semibold text-xs uppercase tracking-wider font-mono">
                            Platform Navigation
                        </h4>
                        <ul className="space-y-2 font-mono text-[11px]">
                            <li>
                                <button
                                    onClick={() => onNavigate?.("landing")}
                                    className="hover:text-emerald-400 transition cursor-pointer"
                                >
                                    Home Overview
                                </button>
                            </li>
                            <li>
                                <a
                                    href="#hardware-plans-section"
                                    className="hover:text-emerald-400 transition"
                                >
                                    Hardware Plans &amp; Pricing
                                </a>
                            </li>
                            <li>
                                <a
                                    href="#architecture-security-section"
                                    className="hover:text-emerald-400 transition"
                                >
                                    Technical Architecture
                                </a>
                            </li>
                            <li>
                                <a
                                    href="#faq-section"
                                    className="hover:text-emerald-400 transition"
                                >
                                    FAQ &amp; Knowledge Base
                                </a>
                            </li>
                            <li>
                                <button
                                    onClick={() => onNavigate?.("order-list")}
                                    className="hover:text-emerald-400 transition cursor-pointer"
                                >
                                    Manage Deployments
                                </button>
                            </li>
                        </ul>
                    </div>

                    {/* Col 3: Technical Specifications */}
                    <div className="space-y-3">
                        <h4 className="text-white font-semibold text-xs uppercase tracking-wider font-mono">
                            Infrastructure Specs
                        </h4>
                        <ul className="space-y-2 text-[11px] text-zinc-400">
                            <li className="flex items-center space-x-2">
                                <span className="text-emerald-400">•</span>
                                <span>AMD EPYC Zen 4 Bare-Metal</span>
                            </li>
                            <li className="flex items-center space-x-2">
                                <span className="text-emerald-400">•</span>
                                <span>PCIe 4.0 NVMe (up to 7,000 MB/s)</span>
                            </li>
                            <li className="flex items-center space-x-2">
                                <span className="text-emerald-400">•</span>
                                <span>OpenSSH + Linux pam_solana.so</span>
                            </li>
                            <li className="flex items-center space-x-2">
                                <span className="text-emerald-400">•</span>
                                <span>Dedicated Static Public IPv4</span>
                            </li>
                            <li className="flex items-center space-x-2">
                                <span className="text-emerald-400">•</span>
                                <span>Tier 3+ Datacenters (FRA, IAD, SIN)</span>
                            </li>
                        </ul>
                    </div>

                    {/* Col 4: Community & Project Links */}
                    <div className="space-y-3">
                        <h4 className="text-white font-semibold text-xs uppercase tracking-wider font-mono">
                            Ecosystem &amp; Open Source
                        </h4>
                        <ul className="space-y-2 font-mono text-[11px]">
                            <li>
                                <a
                                    href="https://github.com"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:text-purple-400 transition flex items-center space-x-1.5"
                                >
                                    <Code2 className="w-3.5 h-3.5 text-purple-400" />
                                    <span>GitHub Repository</span>
                                    <ExternalLink className="w-2.5 h-2.5 text-zinc-500" />
                                </a>
                            </li>
                            <li>
                                <a
                                    href="https://explorer.solana.com"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:text-purple-400 transition flex items-center space-x-1.5"
                                >
                                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Solana Explorer</span>
                                    <ExternalLink className="w-2.5 h-2.5 text-zinc-500" />
                                </a>
                            </li>
                            <li>
                                <span className="text-zinc-500 block">
                                    Colosseum Hackathon Project
                                </span>
                            </li>
                            <li>
                                <span className="text-zinc-500 block">
                                    Audit Status: Architecture POC
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Bottom Bar: Copyright, Back to top */}
                <div className="pt-8 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-zinc-500">
                    <div>
                        <span>&copy; 2026 Solana VPS Platform. Open Source Decentralized Infrastructure.</span>
                    </div>

                    <button
                        onClick={scrollToTop}
                        className="flex items-center space-x-1 text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                        <span>Back to top</span>
                        <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </footer>
    );
}
