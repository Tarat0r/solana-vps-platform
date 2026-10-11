export { cn } from "cn";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export function lamportsToSol(lamports: string | number): string {
    const num = Number(lamports);
    return (num / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, "") + " SOL";
}

export function shortenAddress(addr: string | null | undefined): string {
    if (!addr) return "";
    if (addr.length < 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
