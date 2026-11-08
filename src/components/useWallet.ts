'use client';

import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { getBase58Decoder, getBase64Encoder } from '@solana/kit';
import { useCallback, useEffect, useState } from 'react';

const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';
const CHAIN = `solana:${CLUSTER}` as const;

type ConnectFeature = { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
type SignAndSendFeature = {
    signAndSendTransaction: (...inputs: { account: WalletAccount; chain: string; transaction: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]>;
};

function solanaWallets(): Wallet[] {
    return getWallets()
        .get()
        .filter(w => 'standard:connect' in w.features && 'solana:signAndSendTransaction' in w.features);
}

export function useWallet() {
    const [wallets, setWallets] = useState<Wallet[]>([]);
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [account, setAccount] = useState<WalletAccount | null>(null);

    useEffect(() => {
        const api = getWallets();
        const refresh = () => setWallets(solanaWallets());
        refresh();
        const offs = [api.on('register', refresh), api.on('unregister', refresh)];
        return () => offs.forEach(off => off());
    }, []);

    const connect = useCallback(async (w: Wallet) => {
        const { accounts } = await (w.features['standard:connect'] as ConnectFeature).connect();
        const acct = accounts[0] ?? w.accounts[0];
        if (!acct) throw new Error('Wallet returned no accounts');
        setWallet(w);
        setAccount(acct);
        return acct.address;
    }, []);

    /** Signs and sends a base64 wire transaction built by the server; returns the base58 signature. */
    const signAndSend = useCallback(
        async (txBase64: string) => {
            if (!wallet || !account) throw new Error('Connect a wallet first');
            const transaction = new Uint8Array(getBase64Encoder().encode(txBase64));
            const feature = wallet.features['solana:signAndSendTransaction'] as SignAndSendFeature;
            const [out] = await feature.signAndSendTransaction({ account, chain: CHAIN, transaction });
            return getBase58Decoder().decode(out.signature);
        },
        [wallet, account],
    );

    return { wallets, wallet, address: account?.address ?? null, connect, signAndSend };
}
