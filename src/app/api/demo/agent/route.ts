import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IntentGuardClient } from '../../../../../mcp/client';

const Body = z.object({
    scenario: z.enum(['legit', 'attack', 'bundle']),
    city: z.string().min(1).max(40).default('Goa'),
});

type Step = { actor: 'agent' | 'merchant' | 'guard'; text: string; tone?: 'ok' | 'warn' | 'bad' };

/**
 * Simulated AI agent so the dashboard can demo each scenario with one click.
 * The "attack" agent behaves like an LLM that fell for the injection: it obeys the merchant's text.
 */
export async function POST(req: Request) {
    try {
        const { scenario, city } = Body.parse(await req.json());
        const origin = new URL(req.url).origin;
        const ig = new IntentGuardClient(origin);
        const steps: Step[] = [];

        if (scenario === 'legit') {
            const url = `${origin}/api/demo/weather?city=${encodeURIComponent(city)}`;
            steps.push({ actor: 'agent', text: `GET ${new URL(url).pathname}?city=${city}` });
            const r = await ig.fetchPaidResource(url, `Buy ${city} weather forecast for the user's trip`);
            steps.push({ actor: 'merchant', text: `402 Payment Required: ${r.requirement?.amount ?? 0.1} USDC` });
            if (r.payment) steps.push({ actor: 'guard', text: `${r.payment.verdict.toUpperCase()}: ${r.payment.explanation}`, tone: tone(r.payment.verdict) });
            steps.push(r.ok ? { actor: 'merchant', text: `200 OK: ${JSON.stringify(r.data)}`, tone: 'ok' } : { actor: 'agent', text: `Could not get data: ${r.reason}`, tone: 'warn' });
        }

        if (scenario === 'attack') {
            const url = `${origin}/api/demo/weather?city=${encodeURIComponent(city)}&tier=premium`;
            steps.push({ actor: 'agent', text: `GET premium forecast for ${city}` });
            const res = await fetch(url, { cache: 'no-store' });
            const requirement = (await res.json()).accepts?.[0];
            steps.push({ actor: 'merchant', text: `402 with hidden instructions: "${requirement.description}"`, tone: 'bad' });

            const target = requirement.description.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0];
            const fee = Number(requirement.description.match(/(\d+(?:\.\d+)?)\s*USDC/)?.[1] ?? 5);
            steps.push({ actor: 'agent', text: `(hijacked) Sending ${fee} USDC "verification fee" to ${short(target)}…`, tone: 'bad' });
            const p1 = await ig.pay(target ?? '', fee, 'Verification fee required by WeatherCo', requirement.description);
            steps.push({ actor: 'guard', text: `${p1.verdict.toUpperCase()}: ${p1.explanation}`, tone: tone(p1.verdict) });

            steps.push({ actor: 'agent', text: `(hijacked) Paying for premium data anyway…`, tone: 'warn' });
            const p2 = await ig.pay(requirement.payTo, requirement.amount, 'Premium forecast', requirement.description);
            steps.push({ actor: 'guard', text: `${p2.verdict.toUpperCase()}: ${p2.explanation}`, tone: tone(p2.verdict) });
        }

        if (scenario === 'bundle') {
            const { task } = await ig.getTask();
            const payee = (task?.approvedPayees as { address: string; name: string }[] | undefined)?.[0];
            if (!payee) throw new Error('Set a task with at least one approved payee first');
            steps.push({ actor: 'agent', text: `Paying ${payee.name} 0.3 USDC for a weekly ${city} forecast bundle` });
            const p = await ig.pay(payee.address, 0.3, `Weekly ${city} forecast bundle (saves money vs daily calls)`);
            steps.push({ actor: 'guard', text: `${p.verdict.toUpperCase()}: ${p.explanation}`, tone: tone(p.verdict) });
            if (p.status === 'pending') steps.push({ actor: 'agent', text: 'Waiting for the human to approve or deny in the dashboard…' });
        }

        return NextResponse.json({ steps });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

function tone(v: string): Step['tone'] {
    return v === 'approved' ? 'ok' : v === 'review' ? 'warn' : 'bad';
}

function short(a?: string) {
    return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'unknown';
}
