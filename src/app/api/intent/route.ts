import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseIntent } from '@/lib/intent';
import { addActivity, updateState } from '@/lib/store';


const Body = z.object({
    raw: z.string().min(3).max(1000),
    recipients: z.array(z.object({ name: z.string().min(1), address: z.string().min(32).max(44) })).default([]),
    maxTotal: z.number().positive().optional(),
    maxPerTx: z.number().positive().optional(),
});

export async function POST(req: Request) {
    try {
        const body = Body.parse(await req.json());
        const policy = await parseIntent(body);
        updateState(s => {
            s.policy = policy;
            s.spent = 0;
        });
        addActivity({ kind: 'intent', title: `New task: ${policy.summary}`, explanation: `Budget ${policy.maxTotal} USDC, max ${policy.maxPerTx} per payment, ${policy.allowedRecipients.length} approved payee(s).` });
        return NextResponse.json({ policy });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

export async function DELETE() {
    updateState(s => {
        s.policy = null;
    });
    addActivity({ kind: 'intent', title: 'Task cleared — agent payments will be blocked' });
    return NextResponse.json({ ok: true });
}
