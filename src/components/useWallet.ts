'use client';

import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
    createKeyPairSignerFromPrivateKeyBytes,
    getBase58Decoder,
    getBase64EncodedWireTransaction,
    getBase64Encoder,
    getTransactionDecoder,
    signTransaction,
    type KeyPairSigner,
} from '@solana/kit';
import { useCallback, useEffect, useState } from 'react';

const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';
const CHAIN = `solana:${CLUSTER}` as const;
const BURNER_KEY = 'intentguard-demo-wallet';

type ConnectFeature = { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
type SignAndSendFeature = {
    signAndSendTransaction: (...inputs: { account: WalletAccount; chain: string; transaction: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]>;
};

function solanaWallets(): Wallet[] {
    return getWallets()
        .get()
        .filter(w => 'standard:connect' in w.features && 'solana:signAndSendTransaction' in w.features);
}

/** Devnet-only browser wallet: key is generated and kept in this browser's localStorage, never sent to the server. */
async function loadBurner(): Promise<KeyPairSigner> {
    let hex = localStorage.getItem(BURNER_KEY);
    if (!hex) {
        hex = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(BURNER_KEY, hex);
    }
    const bytes = new Uint8Array(hex.match(/../g)!.map(h => parseInt(h, 16)));
    return createKeyPairSignerFromPrivateKeyBytes(bytes);
}

export function useWallet() {
    const [wallets, setWallets] = useState<Wallet[]>([]);
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [account, setAccount] = useState<WalletAccount | null>(null);
    const [burner, setBurner] = useState<KeyPairSigner | null>(null);

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
        setBurner(null);
        setWallet(w);
        setAccount(acct);
        return acct.address;
    }, []);

    const connectBurner = useCallback(async () => {
        const signer = await loadBurner();
        setWallet(null);
        setAccount(null);
        setBurner(signer);
        return signer.address as string;
    }, []);

    /** Signs and sends a base64 wire transaction built by the server; returns the base58 signature. */
    const signAndSend = useCallback(
        async (txBase64: string) => {
            const bytes = new Uint8Array(getBase64Encoder().encode(txBase64));
            if (burner) {
                const signed = await signTransaction([burner.keyPair], getTransactionDecoder().decode(bytes));
                const res = await fetch('/api/wallet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'relay', tx: getBase64EncodedWireTransaction(signed) }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Send failed');
                return json.signature as string;
            }
            if (!wallet || !account) throw new Error('Connect a wallet first');
            const feature = wallet.features['solana:signAndSendTransaction'] as SignAndSendFeature;
            const [out] = await feature.signAndSendTransaction({ account, chain: CHAIN, transaction: bytes });
            return getBase58Decoder().decode(out.signature);
        },
        [wallet, account, burner],
    );

    return {
        wallets,
        wallet,
        isBurner: Boolean(burner),
        address: burner?.address ?? account?.address ?? null,
        connect,
        connectBurner,
        signAndSend,
    };
}
