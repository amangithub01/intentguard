import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveReview } from '@/lib/guard';


const Body = z.object({ id: z.string(), approve: z.boolean() });

export async function POST(req: Request) {
    try {
        const { id, approve } = Body.parse(await req.json());
        return NextResponse.json({ activity: await resolveReview(id, approve) });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}
