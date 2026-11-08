'use client';

/**
 * Guard log in the style of "Live Notification Feed" by @dhxwhy on 21st.dev (MIT).
 * Rebuilt for IntentGuard: each payment acts out its outcome as it lands.
 */

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { type Activity, type State, explorer, short } from '../types';

const TONE = {
    executed: { tint: '#14F195', label: 'paid', app: 'Settled on Solana' },
    pending: { tint: '#F5B73B', label: 'needs you', app: 'Waiting for approval' },
    blocked: { tint: '#FF5C7A', label: 'blocked', app: 'IntentGuard firewall' },
    denied: { tint: '#FF5C7A', label: 'denied', app: 'Denied by you' },
    failed: { tint: '#FF5C7A', label: 'failed', app: 'Transaction failed' },
    info: { tint: '#9945FF', label: '', app: 'IntentGuard' },
} as const;

function ago(ts: number, now: number) {
    if (!now) return '';
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 10) return 'now';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
}

function Icon({ a }: { a: Activity }) {
    const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
    if (a.kind !== 'payment') return <svg {...p}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /><path d="M9 12l2 2 4-4" /></svg>;
    if (a.status === 'executed') return <svg {...p}><path d="M12 19V5m0 14-6-6m6 6 6-6" transform="rotate(180 12 12)" /></svg>;
    if (a.status === 'pending') return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    return <svg {...p}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /><path d="m9.5 9.5 5 5m0-5-5 5" /></svg>;
}

/** Rolling digits, like the payment card in the original feed. */
function Rolling({ value, color }: { value: string; color: string }) {
    const [on, setOn] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setOn(true));
        return () => cancelAnimationFrame(id);
    }, []);
    return (
        <span className="inline-flex overflow-hidden font-mono text-[26px] font-semibold leading-none tabular-nums" style={{ color }} aria-label={value}>
            {value.split('').map((ch, i) =>
                /\d/.test(ch) ? (
                    <span key={i} className="relative inline-block h-[26px] overflow-hidden" aria-hidden>
                        <span
                            className="flex flex-col"
                            style={{ transform: `translateY(-${on ? Number(ch) * 26 : 0}px)`, transition: `transform 900ms cubic-bezier(.22,1,.36,1) ${i * 70}ms` }}
                        >
                            {Array.from({ length: 10 }, (_, d) => (
                                <span key={d} className="h-[26px]">{d}</span>
                            ))}
                        </span>
                    </span>
                ) : (
                    <span key={i} aria-hidden>{ch}</span>
                ),
            )}
        </span>
    );
}

function Story({ a, s, onReview, busy }: { a: Activity; s: State; onReview: (id: string, ok: boolean) => void; busy: string | null }) {
    if (a.kind !== 'payment') return null;
    const tone = TONE[a.status ?? 'info'];
    if (a.status === 'executed') {
        return (
            <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                    <Rolling value={`-${(a.amount ?? 0).toFixed(2)}`} color={tone.tint} />
                    <span className="ml-1 text-xs text-muted-foreground">USDC</span>
                </div>
                {a.signature && (
                    <a className="font-mono text-[11px] text-sol-green underline-offset-2 hover:underline" target="_blank" href={explorer('tx', a.signature, s.cluster, s.rpcUrl)}>
                        tx {short(a.signature)} ↗
                    </a>
                )}
            </div>
        );
    }
    if (a.status === 'blocked' || a.status === 'denied' || a.status === 'failed') {
        const risk = a.risk ?? 0;
        return (
            <div className="mt-3">
                <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-[#ff9aac]">{a.amount} USDC never left your wallet</span>
                    <span className="text-muted-foreground">risk {risk}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                    <motion.div className="h-full rounded-full bg-linear-to-r from-[#F5B73B] to-[#FF5C7A]" initial={{ width: 0 }} animate={{ width: `${risk}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
                </div>
            </div>
        );
    }
    if (a.status === 'pending') {
        return (
            <div className="mt-3 flex items-center gap-2">
                <button
                    onClick={() => onReview(a.id, true)}
                    disabled={busy === `review-${a.id}`}
                    className="flex-1 rounded-xl bg-sol-green py-2 text-xs font-semibold text-black transition active:scale-[0.98] disabled:opacity-50"
                >
                    {busy === `review-${a.id}` ? 'Paying…' : 'Approve & pay'}
                </button>
                <button onClick={() => onReview(a.id, false)} className="flex-1 rounded-xl border border-border py-2 text-xs font-semibold text-foreground/80 transition hover:bg-white/5">
                    Deny
                </button>
            </div>
        );
    }
    return null;
}

function FeedCard({ a, s, unread, onRead, onReview, busy, now }: { a: Activity; s: State; unread: boolean; onRead: () => void; onReview: (id: string, ok: boolean) => void; busy: string | null; now: number }) {
    const [open, setOpen] = useState(false);
    const tone = TONE[a.kind === 'payment' ? (a.status ?? 'info') : 'info'];
    const title =
        a.kind === 'payment'
            ? a.status === 'executed'
                ? `Paid ${a.recipientName ?? short(a.recipient)}`
                : a.status === 'pending'
                  ? `${a.amount} USDC to ${a.recipientName ?? short(a.recipient)}?`
                  : `Stopped ${a.amount} USDC → ${a.recipientName ?? short(a.recipient)}`
            : a.title;
    return (
        <motion.li
            layout
            initial={{ opacity: 0, y: -24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={onRead}
            className="relative border-b border-white/[0.06] py-4 pr-1 last:border-0"
        >
            <div className="flex gap-3">
                <span className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-background" style={{ background: `color-mix(in srgb, ${tone.tint} 16%, #030303)`, color: tone.tint }}>
                    <Icon a={a} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{tone.app}</span>
                        <span>·</span>
                        <span>{ago(a.ts, now)}</span>
                        {tone.label && (
                            <span className="ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ background: `${tone.tint}1a`, color: tone.tint }}>
                                {tone.label}
                            </span>
                        )}
                    </div>
                    <p className="mt-0.5 text-[14px] font-semibold leading-snug">{title}</p>
                    {a.reason && <p className="truncate text-[12px] text-muted-foreground">“{a.reason}”</p>}
                </div>
                {unread && <span className="absolute top-4 left-7 z-20 size-2 rounded-full" style={{ background: tone.tint, boxShadow: `0 0 8px ${tone.tint}` }} />}
            </div>
            {a.explanation && <p className="mt-2 ml-12 line-clamp-4 text-[12px] leading-relaxed text-foreground/75">{a.explanation}</p>}
            {a.error && <p className="mt-2 ml-12 text-[12px] text-[#ff9aac]">{a.error}</p>}
            <div className="ml-12"><Story a={a} s={s} onReview={onReview} busy={busy} /></div>
            {a.checks?.length ? (
                <div className="ml-12">
                    <button
                        className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={e => {
                            e.stopPropagation();
                            setOpen(o => !o);
                        }}
                    >
                        {open ? 'hide' : 'show'} {a.checks.length} checks{a.judgedBy === 'llm' ? ' + AI verdict' : ''}
                    </button>
                    <AnimatePresence initial={false}>
                        {open && (
                            <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="mt-2 space-y-1 text-[11px]">
                                    {a.checks.map((c, i) => (
                                        <li key={i} className={c.passed ? 'text-muted-foreground' : c.severity === 'block' ? 'text-[#ff9aac]' : 'text-[#F5B73B]'}>
                                            {c.passed ? '✓' : '✗'} <b className="font-semibold">{c.name}</b>: {c.detail}
                                        </li>
                                    ))}
                                    {a.context && <li className="mt-1 rounded-xl bg-black/50 p-2 font-mono text-muted-foreground">context: {a.context.slice(0, 400)}</li>}
                                </div>
                            </motion.ul>
                        )}
                    </AnimatePresence>
                </div>
            ) : null}
        </motion.li>
    );
}

export function GuardFeed({ s, onReview, busy, className }: { s: State | null; onReview: (id: string, ok: boolean) => void; busy: string | null; className?: string }) {
    const items = s?.activity ?? [];
    const [seen, setSeen] = useState<Set<string> | null>(null);
    const [swing, setSwing] = useState(0);
    const [now, setNow] = useState(0);
    const lastTop = useRef<string | undefined>(undefined);

    useEffect(() => {
        const first = setTimeout(() => setNow(Date.now()), 0);
        const t = setInterval(() => setNow(Date.now()), 5000);
        return () => {
            clearTimeout(first);
            clearInterval(t);
        };
    }, []);

    useEffect(() => {
        if (!s) return;
        const top = s.activity[0]?.id;
        const t = setTimeout(() => {
            setSeen(prev => prev ?? new Set(s.activity.map(a => a.id)));
            if (lastTop.current !== undefined && top && top !== lastTop.current) setSwing(n => n + 1);
            lastTop.current = top ?? '';
        }, 0);
        return () => clearTimeout(t);
    }, [s]);

    const unread = seen ? items.filter(a => !seen.has(a.id)).length : 0;
    const markRead = (id: string) => setSeen(prev => new Set([...(prev ?? []), id]));

    return (
        <div className={`relative ${className ?? ''}`}>
            <div className="relative flex h-full flex-col">
                <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
                    <motion.span key={swing} animate={swing ? { rotate: [0, -18, 14, -8, 4, 0] } : undefined} transition={{ duration: 0.8 }} style={{ transformOrigin: '50% 10%' }} className="text-foreground">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                    </motion.span>
                    <h3 className="text-[15px] font-semibold">Guard log</h3>
                    {unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1.5 font-mono text-[11px] font-bold text-black">{unread}</span>}
                    <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                        <span className="size-1.5 animate-pulse rounded-full bg-sol-green" /> live
                    </span>
                    {unread > 0 && (
                        <button className="ml-2 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setSeen(new Set(items.map(a => a.id)))}>
                            Read all
                        </button>
                    )}
                </header>
                <ul className="relative flex max-h-[760px] flex-1 flex-col overflow-y-auto before:absolute before:top-6 before:bottom-6 before:left-[17.5px] before:w-px before:bg-white/[0.08]">
                    <AnimatePresence initial={false}>
                        {items.length && s ? (
                            items.map(a => <FeedCard key={a.id} a={a} s={s} unread={!!seen && !seen.has(a.id)} onRead={() => markRead(a.id)} onReview={onReview} busy={busy} now={now} />)
                        ) : (
                            <motion.li key="empty" className="relative z-10 bg-background py-14 text-center text-sm text-muted-foreground">
                                Every payment your agent attempts lands here, with the reasoning.
                            </motion.li>
                        )}
                    </AnimatePresence>
                </ul>
            </div>
        </div>
    );
}
