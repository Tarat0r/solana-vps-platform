"use client";

import React, { useState, useRef, useEffect } from "react";
import {
    Terminal,
    Play,
    RotateCcw,
    Maximize2,
    Minimize2,
    Copy,
    Check,
    Cpu,
    Activity,
    Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TerminalConsoleProps {
    hostname: string;
    ipAddress: string;
    username: string;
    region: string;
}

interface CommandHistoryItem {
    type: "input" | "output" | "error" | "info";
    text: string;
}

function generateClientSessionId(): string {
    return `ses_${Date.now().toString(36)}`;
}

export function TerminalConsole({
    hostname,
    ipAddress,
    username,
    region,
}: TerminalConsoleProps) {
    const [inputCommand, setInputCommand] = useState("");
    const [isMaximized, setIsMaximized] = useState(false);
    const [copiedAll, setCopiedAll] = useState(false);
    const [history, setHistory] = useState<CommandHistoryItem[]>([
        {
            type: "info",
            text: `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-40-generic x86_64)
* System load: 0.04
* Memory usage: 4% of 16384MB
* IPv4 address: ${ipAddress}
* Datacenter: ${region}
* Authentication: Linux PAM (pam_solana.so) verified`,
        },
        {
            type: "info",
            text: "Type 'help' to see available simulated shell commands.",
        },
    ]);

    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history]);

    const handleRunCommand = (cmdToRun?: string) => {
        const rawCmd = (cmdToRun !== undefined ? cmdToRun : inputCommand).trim();
        if (!rawCmd) return;

        const cmdLower = rawCmd.toLowerCase();
        const newEntries: CommandHistoryItem[] = [
            { type: "input", text: rawCmd },
        ];

        if (cmdLower.startsWith("ssh") || cmdLower === "connect") {
            const sessionId = generateClientSessionId();
            const authOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
            newEntries.push({
                type: "output",
                text: `Authenticated with Linux-PAM (pam_solana.so):\nOpen ${authOrigin}/auth?session_id=${sessionId} and sign with your wallet.\nPress Enter after signing:`,
            });
            setHistory((prev) => [...prev, ...newEntries]);
            setInputCommand("");
            return;
        }

        switch (cmdLower) {
            case "help":
                newEntries.push({
                    type: "output",
                    text: `Available commands:
  ssh ${username}@${ipAddress} - Connect over SSH with Solana PAM wallet authentication
  uptime             - Show system running time and average load
  uname -a           - Display Linux kernel architecture
  solana --version   - Check installed Solana validator CLI toolchain
  htop               - View AMD EPYC CPU and memory utilization snapshot
  df -h              - Display NVMe storage partition utilization
  systemctl status solana-authd - Inspect PAM daemon status
  curl ifconfig.me   - Verify public dedicated IPv4 address
  clear              - Clear terminal console screen`,
                });
                break;

            case "uptime":
                newEntries.push({
                    type: "output",
                    text: " 17:42:10 up 3 days, 14:22,  1 user,  load average: 0.04, 0.08, 0.05",
                });
                break;

            case "uname -a":
                newEntries.push({
                    type: "output",
                    text: `Linux ${hostname} 6.8.0-40-generic #40-Ubuntu SMP PREEMPT_DYNAMIC SMP x86_64 AMD EPYC 9654 Zen 4 GNU/Linux`,
                });
                break;

            case "solana --version":
                newEntries.push({
                    type: "output",
                    text: "solana-cli 2.1.14 (src:9a3f2b4c; feat:4215500140, RPC: client v2.1)",
                });
                break;

            case "htop":
                newEntries.push({
                    type: "output",
                    text: `[AMD EPYC Genoa 9654 Zen 4 - 4 vCPUs]
Core 0: [|||                               2.1%]   Tasks: 42, 112 thr, 1 running
Core 1: [||||                              3.4%]   Load average: 0.04 0.08 0.05
Core 2: [||                                1.8%]   Uptime: 3 days, 14:22:04
Core 3: [|||                               2.6%]
Mem:    [||||||                  682M/16384M]   Swp: 0K/0K

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
 1042 solana    20   0   4120M   480M  12400 S   3.2   2.9  14:20.12 solana-validator
  814 root      20   0  182040  24110   8920 S   0.4   0.1   1:04.22 solana-authd
  912 root      20   0   14200   3240   2100 S   0.1   0.0   0:12.10 sshd: ubuntu [priv]`,
                });
                break;

            case "df -h":
                newEntries.push({
                    type: "output",
                    text: `Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p1  250G   14G  224G   6% /
udev            7.8G     0  7.8G   0% /dev
tmpfs           1.6G  1.2M  1.6G   1% /run`,
                });
                break;

            case "systemctl status solana-authd":
                newEntries.push({
                    type: "output",
                    text: `● solana-authd.service - Solana VPS Linux PAM Authentication Daemon
     Loaded: loaded (/etc/systemd/system/solana-authd.service; enabled; vendor preset: enabled)
     Active: active (running) since Wed 2026-10-07 03:20:06 UTC; 3 days ago
   Main PID: 814 (solana-authd)
      Tasks: 4 (limit: 18432)
     Memory: 24.1M
     CGroup: /system.slice/solana-authd.service
             └─814 /usr/local/bin/solana-authd --socket /run/solana-authd.sock

Oct 10 17:40:02 ${hostname} solana-authd[814]: [INFO] Challenge sess_8f29c401 verified. Ed25519 signature valid.
Oct 10 17:40:02 ${hostname} solana-authd[814]: [INFO] On-chain subscription unexpired (Clock: valid). PAM allow.`,
                });
                break;

            case "curl ifconfig.me":
                newEntries.push({
                    type: "output",
                    text: ipAddress,
                });
                break;

            case "clear":
                setHistory([]);
                setInputCommand("");
                return;

            default:
                newEntries.push({
                    type: "error",
                    text: `bash: ${rawCmd}: command not found. Type 'help' for available commands.`,
                });
                break;
        }

        setHistory((prev) => [...prev, ...newEntries]);
        setInputCommand("");
    };

    const handleCopyAll = () => {
        const fullTranscript = history
            .map((h) => (h.type === "input" ? `${username}@${hostname}:~$ ${h.text}` : h.text))
            .join("\n");
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(fullTranscript).then(() => {
                setCopiedAll(true);
                setTimeout(() => setCopiedAll(false), 2000);
            });
        }
    };

    return (
        <div
            className={`rounded-2xl border border-zinc-800 bg-zinc-950/95 overflow-hidden font-mono shadow-2xl transition-all duration-200 ${
                isMaximized ? "fixed inset-4 z-50 flex flex-col" : "space-y-0"
            }`}
        >
            {/* Console Header Bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/90 border-b border-zinc-800 select-none">
                <div className="flex items-center space-x-3">
                    <div className="flex space-x-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                    </div>
                    <div className="flex items-center space-x-2 text-xs">
                        <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-zinc-200 font-bold truncate">
                            {username}@{hostname}
                        </span>
                        <span className="text-zinc-500 hidden sm:inline">({ipAddress})</span>
                    </div>
                </div>

                <div className="flex items-center space-x-1.5">
                    {/* Quick Command Pills */}
                    <div className="hidden lg:flex items-center space-x-1 mr-2 text-[10px]">
                        {["uptime", "htop", "solana --version"].map((quickCmd) => (
                            <button
                                key={quickCmd}
                                onClick={() => handleRunCommand(quickCmd)}
                                className="px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 hover:text-white border border-zinc-700/60 transition cursor-pointer"
                            >
                                {quickCmd}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={handleCopyAll}
                        title="Copy terminal transcript"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                    >
                        {copiedAll ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                            <Copy className="w-3.5 h-3.5" />
                        )}
                    </button>
                    <button
                        onClick={() => setHistory([])}
                        title="Clear screen"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setIsMaximized(!isMaximized)}
                        title={isMaximized ? "Exit full screen" : "Maximize terminal"}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                    >
                        {isMaximized ? (
                            <Minimize2 className="w-3.5 h-3.5" />
                        ) : (
                            <Maximize2 className="w-3.5 h-3.5" />
                        )}
                    </button>
                </div>
            </div>

            {/* Terminal Body */}
            <div
                onClick={() => inputRef.current?.focus()}
                className={`p-4 text-xs overflow-y-auto leading-relaxed cursor-text ${
                    isMaximized ? "flex-1" : "max-h-[380px] min-h-[260px]"
                }`}
            >
                {history.map((item, idx) => (
                    <div key={idx} className="mb-2">
                        {item.type === "input" && (
                            <div className="flex items-center text-zinc-100 font-semibold">
                                <span className="text-emerald-400 mr-2">
                                    {username}@{hostname}:~$
                                </span>
                                <span>{item.text}</span>
                            </div>
                        )}
                        {item.type === "output" && (
                            <pre className="text-zinc-300 whitespace-pre-wrap font-mono">
                                {item.text}
                            </pre>
                        )}
                        {item.type === "error" && (
                            <div className="text-rose-400 whitespace-pre-wrap font-mono">
                                {item.text}
                            </div>
                        )}
                        {item.type === "info" && (
                            <pre className="text-purple-300/90 whitespace-pre-wrap font-mono text-[11px]">
                                {item.text}
                            </pre>
                        )}
                        {(() => {
                            const match = item.text.match(/(https?:\/\/[^\s]+(?:\/auth\?session_id=|\/v1\/sessions\/)[a-zA-Z0-9_-]+)/) ||
                                          item.text.match(/(https?:\/\/[^\s]+[?&]session_id=[a-zA-Z0-9_-]+)/);
                            if (!match) return null;
                            return (
                                <div className="mt-2.5 mb-1.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                    <div className="flex items-center space-x-2 text-purple-300">
                                        <Shield className="w-4 h-4 text-purple-400 shrink-0" />
                                        <span className="font-semibold text-xs">PAM SSH Challenge Detected</span>
                                    </div>
                                    <a
                                        href={match[0]}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition shadow-sm cursor-pointer"
                                    >
                                        <span>Open Signing Portal</span>
                                        <span>&rarr;</span>
                                    </a>
                                </div>
                            );
                        })()}
                    </div>
                ))}

                {/* Active Input Line */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleRunCommand();
                    }}
                    className="flex items-center text-zinc-100 pt-1"
                >
                    <span className="text-emerald-400 mr-2 shrink-0">
                        {username}@{hostname}:~$
                    </span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputCommand}
                        onChange={(e) => setInputCommand(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none font-mono text-xs text-white p-0 focus:ring-0"
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="Type a command (try 'uptime' or 'htop')..."
                    />
                </form>
                <div ref={bottomRef} />
            </div>

            {/* Bottom Status Ribbon */}
            <div className="px-4 py-2 bg-zinc-900/60 border-t border-zinc-850 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                <div className="flex items-center space-x-3">
                    <span className="flex items-center space-x-1.5 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>SSH PTY Session Active</span>
                    </span>
                    <span className="hidden sm:inline text-zinc-600">•</span>
                    <span className="hidden sm:inline">Port 22</span>
                    <span className="hidden sm:inline text-zinc-600">•</span>
                    <span className="hidden sm:inline">Linux PAM Verified</span>
                </div>
                <span className="text-zinc-400">Bash v5.2</span>
            </div>
        </div>
    );
}
