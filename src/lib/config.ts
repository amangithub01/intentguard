import { address } from '@solana/kit';

export const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';
export const SUBSCRIPTIONS_PROGRAM = address('De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44');
export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = 'USDC';
export const DATA_DIR = process.env.INTENTGUARD_DATA_DIR ?? `${process.cwd()}/data`;
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

export const LLM = {
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    promptGuardModel: process.env.PROMPT_GUARD_MODEL ?? '',
};

export function toBaseUnits(amount: number): bigint {
    return BigInt(Math.round(amount * 10 ** TOKEN_DECIMALS));
}

export function fromBaseUnits(amount: bigint | number): number {
    return Number(amount) / 10 ** TOKEN_DECIMALS;
}
