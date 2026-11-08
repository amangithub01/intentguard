export type Check = { name: string; passed: boolean; detail: string; severity: 'block' | 'review' | 'info' };
export type Activity = {
    id: string;
    ts: number;
    kind: 'payment' | 'intent' | 'setup' | 'revoke' | 'info';
    title: string;
    recipient?: string;
    recipientName?: string;
    amount?: number;
    reason?: string;
    context?: string;
    verdict?: 'approved' | 'review' | 'blocked';
    status?: 'pending' | 'executed' | 'blocked' | 'denied' | 'failed';
    risk?: number;
    explanation?: string;
    judgedBy?: 'llm' | 'rules';
    checks?: Check[];
    signature?: string;
    error?: string;
};
export type Recipient = { name: string; address: string };
export type State = {
    cluster: string;
    rpcUrl: string;
    llm: boolean;
    agent: { address: string; sol: number };
    owner: { address: string; sol: number | null; usdc: number | null } | null;
    mint: string | null;
    delegation: { address: string; amount: number; expiryTs: number } | null;
    allowance: { remaining: number; expiryTs: number; delegatee: string } | null;
    policy: null | { summary: string; maxTotal: number; maxPerTx: number; reviewAbove: number; allowedRecipients: Recipient[]; parsedBy: string; purposes: string[] };
    spent: number;
    addressBook: Recipient[];
    merchantUsdc: number;
    activity: Activity[];
};
export type Step = { actor: 'agent' | 'merchant' | 'guard'; text: string; tone?: 'ok' | 'warn' | 'bad' };

export const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');

export function explorer(kind: 'tx' | 'address', id: string, cluster: string, rpcUrl: string) {
    const q = cluster === 'localnet' ? `cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}` : `cluster=${cluster}`;
    return `https://explorer.solana.com/${kind}/${id}?${q}`;
}
