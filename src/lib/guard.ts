import { address } from '@solana/kit';
import { judgePayment, type PaymentRequest } from './intent';
import { agentPull, readDelegation } from './solana';
import { addActivity, patchActivity, readState, updateState, type Activity } from './store';

export type PaymentResult = {
    id: string;
    verdict: Activity['verdict'];
    status: Activity['status'];
    explanation: string;
    risk: number;
    signature?: string;
    error?: string;
};

function nameFor(recipient: string) {
    return readState().policy?.allowedRecipients.find(r => r.address === recipient)?.name;
}

async function execute(id: string, recipient: string, amount: number): Promise<Activity | undefined> {
    try {
        const signature = await agentPull(address(recipient), amount);
        updateState(s => {
            s.spent = +(s.spent + amount).toFixed(6);
        });
        return patchActivity(id, { status: 'executed', signature });
    } catch (e) {
        return patchActivity(id, { status: 'failed', error: (e as Error).message });
    }
}

export async function requestPayment(req: PaymentRequest): Promise<PaymentResult> {
    const state = readState();
    let onchainRemaining: number | null = null;
    if (state.delegation) onchainRemaining = (await readDelegation(state.delegation.address))?.remaining ?? 0;

    const j = await judgePayment(state.policy, req, state.spent, onchainRemaining);
    const entry = addActivity({
        kind: 'payment',
        title: `Agent wants to pay ${req.amount} USDC`,
        recipient: req.recipient,
        recipientName: nameFor(req.recipient),
        amount: req.amount,
        reason: req.reason,
        context: req.context?.slice(0, 4000),
        verdict: j.verdict,
        status: j.verdict === 'approved' ? 'pending' : j.verdict === 'review' ? 'pending' : 'blocked',
        risk: j.risk,
        explanation: j.explanation,
        judgedBy: j.judgedBy,
        checks: j.checks,
    });

    if (j.verdict === 'approved') {
        const done = await execute(entry.id, req.recipient, req.amount);
        return { id: entry.id, verdict: j.verdict, status: done?.status, explanation: j.explanation, risk: j.risk, signature: done?.signature, error: done?.error };
    }
    return { id: entry.id, verdict: j.verdict, status: entry.status, explanation: j.explanation, risk: j.risk };
}

export async function resolveReview(id: string, approve: boolean): Promise<Activity | undefined> {
    const a = readState().activity.find(x => x.id === id);
    if (!a || a.verdict !== 'review' || a.status !== 'pending') throw new Error('Nothing to resolve for this id');
    if (!approve) return patchActivity(id, { status: 'denied' });
    return execute(id, a.recipient!, a.amount!);
}

export function getPayment(id: string): Activity | undefined {
    return readState().activity.find(x => x.id === id);
}
