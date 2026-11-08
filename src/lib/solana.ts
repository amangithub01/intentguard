import {
    address,
    appendTransactionMessageInstructions,
    compileTransaction,
    createNoopSigner,
    createSolanaRpc,
    createTransactionMessage,
    generateKeyPairSigner,
    getBase64EncodedWireTransaction,
    getSignatureFromTransaction,
    pipe,
    setTransactionMessageFeePayer,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Address,
    type Instruction,
    type KeyPairSigner,
    type Signature,
} from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import {
    TOKEN_PROGRAM_ADDRESS,
    fetchMaybeToken,
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getInitializeMint2Instruction,
    getMintSize,
    getMintToInstruction,
} from '@solana-program/token';
import {
    fetchMaybeFixedDelegation,
    fetchMaybeSubscriptionAuthority,
    findFixedDelegationPda,
    findSubscriptionAuthorityPda,
    getCreateFixedDelegationOverlayInstructionAsync,
    getInitSubscriptionAuthorityOverlayInstructionAsync,
    getRevokeDelegationOverlayInstruction,
    getTransferFixedOverlayInstructionAsync,
} from '@solana/subscriptions';
import { RPC_URL, SUBSCRIPTIONS_PROGRAM, TOKEN_DECIMALS, fromBaseUnits, toBaseUnits } from './config';
import { getSigner, readState, updateState } from './store';

export const rpc = createSolanaRpc(RPC_URL);
const programConfig = { programAddress: SUBSCRIPTIONS_PROGRAM };

async function latestBlockhash() {
    const { value } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    return value;
}

export async function waitForConfirmation(signature: Signature, timeoutMs = 45_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const { value } = await rpc.getSignatureStatuses([signature]).send();
        const status = value[0];
        if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err, bigintReplacer)}`);
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
        await new Promise(r => setTimeout(r, 800));
    }
    throw new Error(`Timed out waiting for ${signature}`);
}

export function bigintReplacer(_k: string, v: unknown) {
    return typeof v === 'bigint' ? v.toString() : v;
}

/** Sign with server-held keys, send and confirm. */
export async function sendAsServer(feePayer: KeyPairSigner, instructions: Instruction[]): Promise<Signature> {
    const blockhash = await latestBlockhash();
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        m => setTransactionMessageFeePayerSigner(feePayer, m),
        m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        m => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signed);
    await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
    await waitForConfirmation(signature);
    return signature;
}

/** Forward a transaction the user already signed in the browser (demo wallet). */
export async function relaySigned(wireBase64: string): Promise<Signature> {
    try {
        return await rpc.sendTransaction(wireBase64 as Parameters<typeof rpc.sendTransaction>[0], { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
    } catch (e) {
        const cause = (e as { cause?: Error }).cause?.message;
        throw new Error(cause ? `${(e as Error).message}: ${cause}` : (e as Error).message);
    }
}

/** Build an unsigned transaction that the user's wallet will sign and send. */
async function buildUserTx(feePayer: Address, instructions: Instruction[]): Promise<string> {
    const blockhash = await latestBlockhash();
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        m => setTransactionMessageFeePayer(feePayer, m),
        m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        m => appendTransactionMessageInstructions(instructions, m),
    );
    return getBase64EncodedWireTransaction(compileTransaction(message));
}

export async function ata(owner: Address, mint: Address): Promise<Address> {
    const [pda] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    return pda;
}

export async function tokenBalance(owner: Address, mint: Address): Promise<number> {
    const acct = await fetchMaybeToken(rpc, await ata(owner, mint));
    return acct.exists ? fromBaseUnits(acct.data.amount) : 0;
}

export async function solBalance(owner: Address): Promise<number> {
    const { value } = await rpc.getBalance(owner).send();
    return Number(value) / 1e9;
}

/** Mint (or reuse) the demo test-USDC token. The agent key is its mint authority and pays fees. */
export async function getOrCreateMint(): Promise<Address> {
    const state = readState();
    if (process.env.DEMO_MINT) return address(process.env.DEMO_MINT);
    if (state.mint) return address(state.mint);
    const agent = await getSigner('agent');
    const mint = await generateKeyPairSigner();
    const space = BigInt(getMintSize());
    const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
    await sendAsServer(agent, [
        getCreateAccountInstruction({ payer: agent, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
        getInitializeMint2Instruction({ mint: mint.address, decimals: TOKEN_DECIMALS, mintAuthority: agent.address }),
    ]);
    updateState(s => {
        s.mint = mint.address;
    });
    return mint.address;
}

export async function faucet(owner: Address, amount: number): Promise<Signature> {
    const agent = await getSigner('agent');
    const mint = await getOrCreateMint();
    const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: agent, owner, mint });
    const mintTo = getMintToInstruction({ mint, token: await ata(owner, mint), mintAuthority: agent, amount: toBaseUnits(amount) });
    return sendAsServer(agent, [createAta, mintTo]);
}

/** A one-click tx for the user to send devnet SOL to the agent so it can pay network fees. */
export async function buildFundAgentTx(owner: Address, sol: number): Promise<string> {
    const agent = await getSigner('agent');
    return buildUserTx(owner, [
        getTransferSolInstruction({ source: createNoopSigner(owner), destination: agent.address, amount: BigInt(Math.round(sol * 1e9)) }),
    ]);
}

export async function getAuthority(owner: Address, mint: Address) {
    const [pda] = await findSubscriptionAuthorityPda({ user: owner, tokenMint: mint }, programConfig);
    const acct = await fetchMaybeSubscriptionAuthority(rpc, pda);
    return acct.exists ? acct.data : null;
}

export type SetupStep =
    | { step: 'init-authority'; tx: string; authority: string }
    | { step: 'create-allowance'; tx: string; nonce: string; delegation: string };

/** Returns the next transaction the user must sign to grant the agent an on-chain allowance. */
export async function buildSetupTx(owner: Address, amount: number, expiryHours: number): Promise<SetupStep> {
    const mint = await getOrCreateMint();
    const agent = await getSigner('agent');
    const ownerSigner = createNoopSigner(owner);
    const authority = await getAuthority(owner, mint);
    if (!authority) {
        const ix = await getInitSubscriptionAuthorityOverlayInstructionAsync({
            ...programConfig,
            owner: ownerSigner,
            tokenMint: mint,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
            userAta: await ata(owner, mint),
        });
        const [authorityPda] = await findSubscriptionAuthorityPda({ user: owner, tokenMint: mint }, programConfig);
        return { step: 'init-authority', tx: await buildUserTx(owner, [ix]), authority: authorityPda };
    }
    const nonce = BigInt(Date.now());
    const [subscriptionAuthority] = await findSubscriptionAuthorityPda({ user: owner, tokenMint: mint }, programConfig);
    const [delegation] = await findFixedDelegationPda(
        { subscriptionAuthority, delegator: owner, delegatee: agent.address, nonce },
        programConfig,
    );
    const ix = await getCreateFixedDelegationOverlayInstructionAsync({
        ...programConfig,
        amount: toBaseUnits(amount),
        delegatee: agent.address,
        delegator: ownerSigner,
        expectedSubscriptionAuthorityInitId: authority.initId,
        expiryTs: BigInt(Math.floor(Date.now() / 1000) + Math.round(expiryHours * 3600)),
        nonce,
        tokenMint: mint,
    });
    return { step: 'create-allowance', tx: await buildUserTx(owner, [ix]), nonce: nonce.toString(), delegation };
}

export async function readDelegation(delegationAddress: string) {
    const acct = await fetchMaybeFixedDelegation(rpc, address(delegationAddress));
    if (!acct.exists) return null;
    return { remaining: fromBaseUnits(acct.data.amount), expiryTs: Number(acct.data.expiryTs), delegatee: acct.data.header.delegatee };
}

export async function buildRevokeTx(owner: Address): Promise<string> {
    const state = readState();
    if (!state.delegation) throw new Error('No active allowance to revoke');
    const ix = getRevokeDelegationOverlayInstruction({
        ...programConfig,
        authority: createNoopSigner(owner),
        delegationAccount: address(state.delegation.address),
    });
    return buildUserTx(owner, [ix]);
}

/** The ONLY way the agent can move user funds: pull from the on-chain allowance. */
export async function agentPull(recipient: Address, amount: number): Promise<Signature> {
    const state = readState();
    if (!state.owner || !state.delegation) throw new Error('No allowance configured. Ask the user to grant one in the dashboard.');
    const agent = await getSigner('agent');
    const mint = await getOrCreateMint();
    const owner = address(state.owner);
    const createReceiverAta = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: agent, owner: recipient, mint });
    const transfer = await getTransferFixedOverlayInstructionAsync({
        ...programConfig,
        amount: toBaseUnits(amount),
        delegatee: agent,
        delegationPda: address(state.delegation.address),
        delegator: owner,
        delegatorAta: await ata(owner, mint),
        receiverAta: await ata(recipient, mint),
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    return sendAsServer(agent, [createReceiverAta, transfer]);
}

/** Verify that `signature` moved at least `amount` of the demo token into `recipient`'s account. */
export async function verifyPayment(signature: string, recipient: Address, amount: number): Promise<boolean> {
    const mint = await getOrCreateMint();
    const tx = await rpc
        .getTransaction(signature as Signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' })
        .send();
    if (!tx?.meta || tx.meta.err) return false;
    const owned = (b: { owner?: string; mint: string; uiTokenAmount: { amount: string } }) => b.owner === recipient && b.mint === mint;
    const pre = tx.meta.preTokenBalances?.find(owned);
    const post = tx.meta.postTokenBalances?.find(owned);
    const delta = BigInt(post?.uiTokenAmount.amount ?? '0') - BigInt(pre?.uiTokenAmount.amount ?? '0');
    return delta >= toBaseUnits(amount);
}
