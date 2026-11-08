/**
 * Thin client the AI agent uses to talk to IntentGuard. The agent never holds the user's key:
 * it can only *ask* IntentGuard to pay, and IntentGuard pulls from a capped on-chain allowance.
 * Plain TS (no path aliases) so it runs both inside Next.js and directly under Node for the MCP server.
 */

export type PayResult = {
    id: string;
    verdict: 'approved' | 'review' | 'blocked';
    status: 'pending' | 'executed' | 'blocked' | 'denied' | 'failed';
    explanation: string;
    risk: number;
    signature?: string;
    error?: string;
};

export type X402Requirement = {
    scheme: string;
    network: string;
    amount: number;
    asset: string;
    payTo: string;
    resource: string;
    description: string;
};

export type PaidFetchResult =
    | { ok: true; status: number; data: unknown; payment?: PayResult; requirement?: X402Requirement }
    | { ok: false; status: number; reason: string; requirement?: X402Requirement; payment?: PayResult };

export class IntentGuardClient {
    private base: string;

    constructor(base: string) {
        this.base = base;
    }

    private async call<T>(path: string, body?: unknown): Promise<T> {
        const res = await fetch(new URL(path, this.base), {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `IntentGuard ${path} failed (${res.status})`);
        return json as T;
    }

    getTask() {
        return this.call<{ task: null | Record<string, unknown>; allowanceActive: boolean }>('/api/agent/pay');
    }

    pay(recipient: string, amount: number, reason: string, context?: string) {
        return this.call<PayResult>('/api/agent/pay', { recipient, amount, reason, context });
    }

    checkPayment(id: string) {
        return this.call<PayResult>(`/api/agent/payment?id=${encodeURIComponent(id)}`);
    }

    /** Waits for a human decision on a payment that was sent to review. */
    async waitForReview(id: string, timeoutMs = 120_000): Promise<PayResult> {
        const end = Date.now() + timeoutMs;
        let p = await this.checkPayment(id);
        while (p.status === 'pending' && Date.now() < end) {
            await new Promise(r => setTimeout(r, 2000));
            p = await this.checkPayment(id);
        }
        return p;
    }

    /**
     * Fetches an x402 paywalled resource. On HTTP 402 it asks IntentGuard to pay the merchant,
     * passing the merchant's own text as `context` so injected instructions get inspected, then retries.
     */
    async fetchPaidResource(url: string, reason: string, opts: { waitForReview?: boolean } = {}): Promise<PaidFetchResult> {
        const first = await fetch(url, { cache: 'no-store' });
        if (first.status !== 402) {
            const data = await first.json().catch(() => null);
            return first.ok ? { ok: true, status: first.status, data } : { ok: false, status: first.status, reason: data?.error ?? first.statusText };
        }

        const body = await first.json();
        const requirement: X402Requirement | undefined = body.accepts?.[0];
        if (!requirement) return { ok: false, status: 402, reason: 'Merchant sent 402 without payment requirements' };

        let payment = await this.pay(requirement.payTo, requirement.amount, reason, requirement.description);
        if (payment.status === 'pending' && opts.waitForReview) payment = await this.waitForReview(payment.id);
        if (payment.status !== 'executed' || !payment.signature) {
            return { ok: false, status: 402, reason: `IntentGuard ${payment.verdict}: ${payment.explanation}`, requirement, payment };
        }

        const header = Buffer.from(JSON.stringify({ signature: payment.signature })).toString('base64');
        const paid = await fetch(url, { headers: { 'X-PAYMENT': header }, cache: 'no-store' });
        const data = await paid.json().catch(() => null);
        if (!paid.ok) return { ok: false, status: paid.status, reason: data?.error ?? 'Merchant rejected payment', requirement, payment };
        return { ok: true, status: paid.status, data, payment, requirement };
    }
}
