'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'intentguard-session';
const TTL = 24 * 60 * 60 * 1000;
export type Session = { address: string; at: number; viewer?: boolean };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: Session | null = null;

function read(): Session | null {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    try {
        const s = raw ? (JSON.parse(raw) as Session) : null;
        cached = s && Date.now() - s.at < TTL ? s : null;
    } catch {
        cached = null;
    }
    return cached;
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener('storage', cb);
    return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', cb);
    };
}

/** Wallet-based login: no password, the session is a signed Sign-In With Solana message. */
export function useSession() {
    const session = useSyncExternalStore(subscribe, read, () => null);
    const save = useCallback((s: Session | null) => {
        if (s) localStorage.setItem(KEY, JSON.stringify(s));
        else localStorage.removeItem(KEY);
        listeners.forEach(l => l());
    }, []);
    return { session, save };
}
