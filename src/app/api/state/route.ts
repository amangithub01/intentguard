import { NextResponse, connection } from 'next/server';
import { address } from '@solana/kit';
import { CLUSTER, RPC_URL } from '@/lib/config';
import { llmEnabled } from '@/lib/intent';
import { readDelegation, solBalance, tokenBalance } from '@/lib/solana';
import { getAddressBook, getSigner, readState } from '@/lib/store';


export async function GET() {
    await connection();
    const state = readState();
    const agent = await getSigner('agent');
    const [agentSol, addressBook] = await Promise.all([solBalance(agent.address).catch(() => 0), getAddressBook()]);
    let ownerUsdc: number | null = null;
    let ownerSol: number | null = null;
    let allowance: Awaited<ReturnType<typeof readDelegation>> = null;
    if (state.owner) {
        const owner = address(state.owner);
        [ownerSol, ownerUsdc] = await Promise.all([
            solBalance(owner).catch(() => null),
            state.mint ? tokenBalance(owner, address(state.mint)).catch(() => null) : Promise.resolve(null),
        ]);
    }
    if (state.delegation) allowance = await readDelegation(state.delegation.address).catch(() => null);
    const merchant = addressBook[0];
    const merchantUsdc = state.mint ? await tokenBalance(address(merchant.address), address(state.mint)).catch(() => 0) : 0;

    return NextResponse.json({
        cluster: CLUSTER,
        rpcUrl: RPC_URL,
        llm: llmEnabled(),
        agent: { address: agent.address, sol: agentSol },
        owner: state.owner ? { address: state.owner, sol: ownerSol, usdc: ownerUsdc } : null,
        mint: state.mint,
        delegation: state.delegation,
        allowance,
        policy: state.policy,
        spent: state.spent,
        addressBook,
        merchantUsdc,
        activity: state.activity,
    });
}
