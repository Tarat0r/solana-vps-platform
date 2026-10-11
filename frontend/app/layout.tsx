import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProviders } from "@/providers/AppProviders";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

const inter = Inter({
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Solana VPS — Decentralized Cloud Compute",
    description:
        "Deploy high performance VPS instances paid in SOL with sub-second provisioning.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html
            lang="en"
            className={cn(
                "h-full dark",
                geistSans.variable,
                geistMono.variable,
                inter.className,
            )}
        >
            <body className="min-h-full flex flex-col bg-[#09090b] text-zinc-100 font-sans selection:bg-purple-600/30 selection:text-emerald-300">
                <AppProviders>
                    <TooltipProvider>{children}</TooltipProvider>
                </AppProviders>
            </body>
        </html>
    );
}
