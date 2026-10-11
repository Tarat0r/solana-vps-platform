import { VPSOrder, PaymentAttempt } from "@/types/vps";

const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export async function fetchOrders(ownerWallet?: string | null) {
    const url = ownerWallet
        ? `${BACKEND_URL}/api/orders?owner_wallet=${encodeURIComponent(ownerWallet)}`
        : `${BACKEND_URL}/api/orders`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
        throw new Error(`Failed to fetch orders: ${res.statusText}`);
    }
    return res.json();
}

export async function createOrder(data: {
    name: string;
    owner_wallet: string;
    region: string;
    period_days: number;
    price_lamports: string;
}): Promise<VPSOrder> {
    const res = await fetch(`${BACKEND_URL}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        throw new Error(`Failed to create order: ${res.statusText}`);
    }
    return res.json();
}

export async function verifyPayment(
    orderId: string,
    txHash: string,
    paymentId?: string | null,
): Promise<{
    status: string;
    order_id: string;
    payment_id?: string;
    paid_until: string;
    host: string;
}> {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx_hash: txHash, payment_id: paymentId }),
    });
    if (!res.ok) {
        throw new Error(`Payment verification failed: ${res.statusText}`);
    }
    return res.json();
}

export async function fetchPaymentAttempts(orderId: string): Promise<PaymentAttempt[]> {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/payments`, {
        cache: "no-store",
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch payment attempts: ${res.statusText}`);
    }
    return res.json();
}

export async function createRenewalAttempt(orderId: string): Promise<{
    payment_id: string;
    order_id: string;
    kind: string;
    status: string;
    price_lamports: string;
    created_at: string;
}> {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/renew`, {
        method: "POST",
    });
    if (!res.ok) {
        throw new Error(`Failed to create renewal attempt: ${res.statusText}`);
    }
    return res.json();
}

export async function fetchSshChallenge(
    orderId: string,
): Promise<{ order_id: string; challenge: string; expires_at: string }> {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/challenge`);
    if (!res.ok) {
        throw new Error(`Failed to fetch SSH challenge: ${res.statusText}`);
    }
    return res.json();
}

export async function submitChallengeResponse(
    orderId: string,
    walletPubkey: string,
    signature: string,
): Promise<{ status: string; order_id: string; wallet: string }> {
    const res = await fetch(
        `${BACKEND_URL}/api/orders/${orderId}/challenge/respond`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                wallet_pubkey: walletPubkey,
                signature,
            }),
        },
    );
    if (!res.ok) {
        throw new Error(
            `Failed to submit challenge signature: ${res.statusText}`,
        );
    }
    return res.json();
}

export async function fetchDelegates(
    orderId: string,
): Promise<{ order_id: string; delegate_wallet: string; created_at: string }[]> {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/delegates`, {
        cache: "no-store",
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch delegates: ${res.statusText}`);
    }
    return res.json();
}

export async function addDelegate(
    orderId: string,
    delegateWallet: string,
): Promise<{ status: string }> {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}/delegates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delegate_wallet: delegateWallet }),
    });
    if (!res.ok) {
        throw new Error(`Failed to add delegate: ${res.statusText}`);
    }
    return res.json();
}

export async function removeDelegate(
    orderId: string,
    delegateWallet: string,
): Promise<{ status: string }> {
    const res = await fetch(
        `${BACKEND_URL}/api/orders/${orderId}/delegates/${encodeURIComponent(delegateWallet)}`,
        {
            method: "DELETE",
        },
    );
    if (!res.ok) {
        throw new Error(`Failed to remove delegate: ${res.statusText}`);
    }
    return res.json();
}

export interface GatewayChallenge {
    session_id: string;
    server_id: string;
    unix_user: string;
    exact_challenge_bytes: string;
    expires_at: string;
    status: string;
    challenge_base64?: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
    if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(base64, "base64"));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function base64ToText(base64: string): string {
    const bytes = base64ToBytes(base64);
    return new TextDecoder().decode(bytes);
}

export async function fetchGatewayChallenge(sessionId: string): Promise<GatewayChallenge> {
    // Try standard v1 sessions route first per CONTRACTS.md
    try {
        const v1Res = await fetch(`${BACKEND_URL}/v1/sessions/${encodeURIComponent(sessionId)}`, {
            cache: "no-store",
        });
        if (v1Res.ok) {
            const data = await v1Res.json();
            const exactBytes = data.challenge_base64 ? base64ToText(data.challenge_base64) : (data.exact_challenge_bytes || "");
            
            // Extract server_id and unix_user from challenge payload lines
            let serverId = data.server_id || "srv_solana_vps";
            let unixUser = data.unix_user || "ubuntu";
            if (exactBytes) {
                const lines = exactBytes.split("\n");
                for (const line of lines) {
                    if (line.startsWith("server_id=")) serverId = line.slice("server_id=".length).trim();
                    if (line.startsWith("unix_user=")) unixUser = line.slice("unix_user=".length).trim();
                }
            }

            const expiresAtIso = typeof data.expires_at === "number"
                ? new Date(data.expires_at * 1000).toISOString()
                : (data.expires_at || new Date(Date.now() + 90000).toISOString());

            return {
                session_id: data.session_id || sessionId,
                server_id: serverId,
                unix_user: unixUser,
                exact_challenge_bytes: exactBytes,
                expires_at: expiresAtIso,
                status: data.status || "PENDING",
                challenge_base64: data.challenge_base64,
            };
        }
    } catch {
        // Fall back to legacy gateway endpoint
    }

    // Fallback to /api/gateway/challenges route
    const res = await fetch(`${BACKEND_URL}/api/gateway/challenges/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch gateway challenge: ${res.statusText}`);
    }
    return res.json();
}

export async function submitGatewaySignature(
    sessionId: string,
    walletPubkey: string,
    signatureBase64: string,
): Promise<{ session_id: string; status: string }> {
    // Try standard v1 sessions response route per CONTRACTS.md
    try {
        const v1Res = await fetch(`${BACKEND_URL}/v1/sessions/${encodeURIComponent(sessionId)}/response`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                wallet: walletPubkey,
                signature_base64: signatureBase64,
            }),
        });
        if (v1Res.ok || v1Res.status === 202) {
            return { session_id: sessionId, status: "SUBMITTED" };
        }
    } catch {
        // Fall back to legacy gateway endpoint
    }

    // Fallback to /api/gateway/challenges respond route
    const res = await fetch(`${BACKEND_URL}/api/gateway/challenges/${encodeURIComponent(sessionId)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            wallet_pubkey: walletPubkey,
            signature: signatureBase64,
            wallet: walletPubkey,
            signature_base64: signatureBase64,
        }),
    });
    if (!res.ok) {
        throw new Error(`Failed to submit gateway signature: ${res.statusText}`);
    }
    return res.json();
}

