"use client";

import React, { useState } from "react";
import {
    ShieldCheck,
    Key,
    Cpu,
    Globe,
    Terminal,
    Copy,
    Check,
    Clock,
    Layers,
    Server,
    ExternalLink,
    Lock,
    Sparkles,
    Database,
    FileCode,
    Network,
    HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    DEPLOYMENT_STEPS,
    SECURITY_PILLARS,
    SYSTEM_COMPONENTS,
    ON_CHAIN_ACCOUNTS,
} from "@/lib/architecture-data";

interface ArchitectureSecuritySectionProps {
    onOpenCreateModal?: () => void;
}

export function ArchitectureSecuritySection({
    onOpenCreateModal,
}: ArchitectureSecuritySectionProps) {
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const [copiedContent, setCopiedContent] = useState(false);

    const activeStep = DEPLOYMENT_STEPS[activeStepIndex];

    const handleCopy = () => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(activeStep.inspectorContent).then(() => {
                setCopiedContent(true);
                setTimeout(() => setCopiedContent(false), 2000);
            });
        }
    };

    const getPillarIcon = (iconName: string) => {
        switch (iconName) {
            case "ShieldCheck":
                return <ShieldCheck className="w-5 h-5 text-emerald-400" />;
            case "Key":
                return <Key className="w-5 h-5 text-purple-400" />;
            case "Cpu":
                return <Cpu className="w-5 h-5 text-cyan-400" />;
            case "Globe":
                return <Globe className="w-5 h-5 text-amber-400" />;
            default:
                return <Lock className="w-5 h-5 text-emerald-400" />;
        }
    };

    return (
        <section
            id="architecture-security-section"
            className="space-y-12 py-8 scroll-mt-20 animate-in fade-in duration-200"
        >
            {/* Section Header */}
            <div className="text-center max-w-3xl mx-auto space-y-3">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-400">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Technical Architecture &amp; Security</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                    Under The Hood: From Block to Bare-Metal
                </h2>
                <p className="text-sm sm:text-base text-zinc-400">
                    Explore how our automated provisioning engine bridges Solana on-chain payments with high-performance AMD EPYC virtualization in sub-second time.
                </p>
            </div>

            {/* Stepper + Inspector Two-Column Interactive Card */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-md overflow-hidden">
                {/* Stepper Progress Bar Header */}
                <div className="grid grid-cols-2 md:grid-cols-4 border-b border-zinc-800 bg-zinc-950/60 divide-y md:divide-y-0 md:divide-x divide-zinc-800/80">
                    {DEPLOYMENT_STEPS.map((step, idx) => {
                        const isActive = idx === activeStepIndex;
                        const isCompleted = idx < activeStepIndex;

                        return (
                            <button
                                key={step.stepNumber}
                                type="button"
                                onClick={() => setActiveStepIndex(idx)}
                                className={`p-4 text-left transition-all duration-200 cursor-pointer flex items-start space-x-3 relative ${
                                    isActive
                                        ? "bg-purple-950/20 border-b-2 md:border-b-0 md:border-t-2 border-purple-500"
                                        : "hover:bg-zinc-900/80"
                                }`}
                            >
                                <div
                                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 mt-0.5 ${
                                        isActive
                                            ? "bg-purple-500 text-white shadow-md shadow-purple-500/30"
                                            : isCompleted
                                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                            : "bg-zinc-800 text-zinc-400 border border-zinc-700/60"
                                    }`}
                                >
                                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : `0${step.stepNumber}`}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center space-x-1.5">
                                        <span className="text-[10px] font-mono uppercase text-zinc-500">
                                            Step {step.stepNumber}
                                        </span>
                                        <span className="text-[10px] font-mono text-purple-400">
                                            {step.duration}
                                        </span>
                                    </div>
                                    <h4
                                        className={`text-xs sm:text-sm font-semibold truncate ${
                                            isActive ? "text-white" : "text-zinc-300"
                                        }`}
                                    >
                                        {step.title}
                                    </h4>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Step Detail + Payload Inspector Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
                    {/* Left: Step Description & Highlights */}
                    <div className="lg:col-span-5 p-6 sm:p-8 space-y-6 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                    variant="outline"
                                    className="px-2.5 py-0.5 rounded-md bg-purple-500/10 border-purple-500/30 text-purple-400 text-xs font-mono"
                                >
                                    {activeStep.protocol}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-xs font-mono flex items-center space-x-1"
                                >
                                    <Clock className="w-3 h-3 mr-1" />
                                    <span>Latency: {activeStep.duration}</span>
                                </Badge>
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-xl font-bold text-white tracking-tight">
                                    {activeStep.title}
                                </h3>
                                <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                                    {activeStep.subtitle}
                                </p>
                            </div>

                            <p className="text-sm text-zinc-300 leading-relaxed">
                                {activeStep.description}
                            </p>

                            <div className="space-y-2 pt-2">
                                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 block">
                                    Key Guarantees:
                                </span>
                                <ul className="space-y-2">
                                    {activeStep.highlights.map((highlight, i) => (
                                        <li
                                            key={i}
                                            className="flex items-start space-x-2 text-xs text-zinc-300"
                                        >
                                            <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                                                <Check className="w-2.5 h-2.5" />
                                            </div>
                                            <span>{highlight}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        {onOpenCreateModal && (
                            <div className="pt-4 border-t border-zinc-800/80">
                                <Button
                                    onClick={onOpenCreateModal}
                                    className="w-full h-10 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-bold text-xs transition flex items-center justify-center space-x-2 cursor-pointer border-0 shadow-md shadow-emerald-950/30"
                                >
                                    <Server className="w-4 h-4 text-zinc-950" />
                                    <span>Deploy Instance In This Pipeline</span>
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Right: Technical Payload Inspector */}
                    <div className="lg:col-span-7 p-4 sm:p-6 bg-zinc-950/80 flex flex-col justify-between space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
                            <div className="flex items-center space-x-2">
                                <div className="flex space-x-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/60" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                                </div>
                                <span className="text-xs font-mono text-zinc-400 ml-2">
                                    {activeStep.inspectorTitle}
                                </span>
                            </div>
                            <Button
                                onClick={handleCopy}
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 rounded-lg bg-zinc-900 border-zinc-800 text-[11px] font-mono text-zinc-300 hover:text-white flex items-center space-x-1.5 cursor-pointer"
                            >
                                {copiedContent ? (
                                    <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span>Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3 h-3 text-zinc-400" />
                                        <span>Copy Payload</span>
                                    </>
                                )}
                            </Button>
                        </div>

                        {/* Code Block Container */}
                        <div className="rounded-xl border border-zinc-850 bg-black/60 p-4 font-mono text-xs overflow-x-auto text-zinc-200">
                            <pre className="whitespace-pre leading-relaxed font-mono">
                                <code>{activeStep.inspectorContent}</code>
                            </pre>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-2 border-t border-zinc-850">
                            <div className="flex items-center space-x-2">
                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                <span>Simulated live inspection verified against Ubuntu 24.04 kernel</span>
                            </div>
                            <span className="text-purple-400">Step {activeStepIndex + 1} of 4</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 4 Core Trust & Security Pillars Grid */}
            <div className="space-y-4">
                <div className="text-left space-y-1">
                    <h3 className="text-lg font-bold text-white tracking-tight">
                        Foundational Security &amp; Isolation Guarantees
                    </h3>
                    <p className="text-xs text-zinc-400">
                        Cryptographic protection designed for decentralized protocols and high-throughput validators.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {SECURITY_PILLARS.map((pillar) => (
                        <div
                            key={pillar.id}
                            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70 hover:border-zinc-700 transition p-5 space-y-3.5 flex flex-col justify-between"
                        >
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="w-9 h-9 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center">
                                        {getPillarIcon(pillar.iconName)}
                                    </div>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/60 text-zinc-400 border border-zinc-750">
                                        {pillar.badge}
                                    </span>
                                </div>

                                <div className="space-y-1">
                                    <h4 className="text-sm font-semibold text-white">
                                        {pillar.title}
                                    </h4>
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        {pillar.description}
                                    </p>
                                </div>
                            </div>

                            <ul className="space-y-1.5 pt-2 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                                {pillar.technicalSpecs.map((spec, i) => (
                                    <li key={i} className="flex items-start space-x-1.5">
                                        <span className="text-emerald-400">•</span>
                                        <span>{spec}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>

            {/* Architecture Overview: Components & On-Chain State Machine */}
            <div className="space-y-6 pt-4 border-t border-zinc-800/80">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <div className="inline-flex items-center space-x-2 text-xs font-mono text-purple-400 mb-1">
                            <Layers className="w-3.5 h-3.5" />
                            <span>System Architecture Specification</span>
                        </div>
                        <h3 className="text-xl font-bold text-white tracking-tight">
                            Core Subsystems &amp; On-Chain State PDA Map
                        </h3>
                    </div>
                    <span className="text-xs font-mono text-zinc-500">
                        Governed by Architecture.md (4 Core Workstreams)
                    </span>
                </div>

                {/* Subsystems Breakdown Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {SYSTEM_COMPONENTS.map((comp) => (
                        <div
                            key={comp.id}
                            className="p-5 rounded-2xl bg-zinc-950/70 border border-zinc-850 space-y-3"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                                        {comp.category === "on-chain" ? (
                                            <Database className="w-3.5 h-3.5 text-purple-400" />
                                        ) : comp.category === "vps-daemon" ? (
                                            <Server className="w-3.5 h-3.5 text-emerald-400" />
                                        ) : (
                                            <Network className="w-3.5 h-3.5 text-cyan-400" />
                                        )}
                                    </div>
                                    <h4 className="text-sm font-bold text-white">
                                        {comp.name}
                                    </h4>
                                </div>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                                    {comp.role}
                                </span>
                            </div>

                            <p className="text-xs text-zinc-400 leading-relaxed">
                                {comp.description}
                            </p>

                            <div className="pt-2 border-t border-zinc-900 flex items-center justify-between text-[11px] font-mono">
                                <span className="text-zinc-500">Stack:</span>
                                <span className="text-purple-300">{comp.techStack}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* On-Chain Account State PDA Schema */}
                <div className="rounded-2xl border border-zinc-850 bg-zinc-950/90 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <FileCode className="w-4 h-4 text-emerald-400" />
                            <h4 className="text-sm font-bold text-white font-mono">
                                Solana Program PDAs (billing-access)
                            </h4>
                        </div>
                        <span className="text-[11px] font-mono text-zinc-500">
                            Clock Sysvar Validation • Atomic Transfers
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {ON_CHAIN_ACCOUNTS.map((acc) => (
                            <div
                                key={acc.name}
                                className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-2 flex flex-col justify-between"
                            >
                                <div>
                                    <span className="text-xs font-bold font-mono text-emerald-400 block">
                                        {acc.name}
                                    </span>
                                    <span className="text-[10px] font-mono text-zinc-500 block truncate" title={acc.pdaSeeds}>
                                        {acc.pdaSeeds}
                                    </span>
                                    <p className="text-[11px] text-zinc-400 mt-2 leading-snug">
                                        {acc.responsibility}
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-zinc-800/60">
                                    <span className="text-[10px] font-mono text-zinc-500 block mb-1">
                                        Key Fields:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                        {acc.fields.slice(0, 3).map((f) => (
                                            <span
                                                key={f}
                                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-300"
                                            >
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
