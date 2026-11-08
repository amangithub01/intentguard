import { NextResponse } from 'next/server';
import { getPayment } from '@/lib/guard';


export async function GET(req: Request) {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    const p = getPayment(id);
    if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ id: p.id, verdict: p.verdict, status: p.status, explanation: p.explanation, risk: p.risk, signature: p.signature, error: p.error });
}
