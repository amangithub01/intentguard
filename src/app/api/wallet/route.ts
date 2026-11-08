import { NextResponse } from 'next/server';
import { address } from '@solana/kit';
import { z } from 'zod';
import { buildFundAgentTx, buildRevokeTx, buildSetupTx, faucet, readDelegation, waitForConfirmation } from '@/lib/solana';
import { addActivity, readState, updateState } from '@/lib/store';


const Body = z.discriminatedUnion('action', [
    z.object({ action: z.literal('connect'), owner: z.string() }),
    z.object({ action: z.literal('fund-agent-tx'), owner: z.string(), sol: z.number().positive().max(2).default(0.2) }),
    z.object({ action: z.literal('faucet'), owner: z.string(), amount: z.number().positive().max(1000).default(100) }),
    z.object({ action: z.literal('setup-tx'), owner: z.string(), amount: z.number().positive(), expiryHours: z.number().positive().default(24) }),
    z.object({ action: z.literal('setup-confirmed'), owner: z.string(), nonce: z.string(), delegation: z.string(), signature: z.string() }),
    z.object({ action: z.literal('revoke-tx'), owner: z.string() }),
    z.object({ action: z.literal('revoke-confirmed'), signature: z.string() }),
    z.object({ action: z.literal('confirm'), signature: z.string() }),
]);

export async function POST(req: Request) {
    try {
        const body = Body.parse(await req.json());
        switch (body.action) {
            case 'connect': {
                const owner = address(body.owner);
                updateState(s => {
                    if (s.owner !== owner) {
                        s.owner = owner;
                        s.delegation = null;
                        s.spent = 0;
                    }
                });
                return NextResponse.json({ ok: true });
            }
            case 'fund-agent-tx':
                return NextResponse.json({ tx: await buildFundAgentTx(address(body.owner), body.sol) });
            case 'faucet': {
                const signature = await faucet(address(body.owner), body.amount);
                addActivity({ kind: 'setup', title: `Minted ${body.amount} test USDC to your wallet`, signature });
                return NextResponse.json({ signature });
            }
            case 'setup-tx':
                return NextResponse.json(await buildSetupTx(address(body.owner), body.amount, body.expiryHours));
            case 'setup-confirmed': {
                const d = await readDelegation(body.delegation);
                if (!d) throw new Error('Allowance account not found on-chain yet');
                updateState(s => {
                    s.owner = body.owner;
                    s.delegation = { nonce: body.nonce, address: body.delegation, amount: d.remaining, expiryTs: d.expiryTs };
                    s.spent = 0;
                });
                addActivity({ kind: 'setup', title: `On-chain allowance of ${d.remaining} USDC granted to the agent`, signature: body.signature });
                return NextResponse.json({ ok: true, allowance: d });
            }
            case 'confirm':
                await waitForConfirmation(body.signature as Parameters<typeof waitForConfirmation>[0]);
                return NextResponse.json({ ok: true });
            case 'revoke-tx':
                return NextResponse.json({ tx: await buildRevokeTx(address(body.owner)) });
            case 'revoke-confirmed': {
                const had = readState().delegation;
                updateState(s => {
                    s.delegation = null;
                });
                addActivity({ kind: 'revoke', title: `Allowance revoked on-chain${had ? '' : ''} — agent can no longer spend`, signature: body.signature });
                return NextResponse.json({ ok: true });
            }
        }
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}
