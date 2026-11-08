import { NextResponse, connection } from 'next/server';
import { z } from 'zod';
import { requestPayment } from '@/lib/guard';
import { readState } from '@/lib/store';


const Body = z.object({
    recipient: z.string().min(32).max(44),
    amount: z.number().positive(),
    reason: z.string().min(1).max(500),
    context: z.string().max(8000).optional(),
});

/** What the agent is allowed to know: its task and limits (never keys). */
export async function GET() {
    await connection();
    const s = readState();
    return NextResponse.json({
        task: s.policy ? { summary: s.policy.summary, instructions: s.policy.raw, budget: s.policy.maxTotal, spent: s.spent, maxPerPayment: s.policy.maxPerTx, approvedPayees: s.policy.allowedRecipients } : null,
        allowanceActive: Boolean(s.delegation),
    });
}

export async function POST(req: Request) {
    try {
        const body = Body.parse(await req.json());
        return NextResponse.json(await requestPayment(body));
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}
