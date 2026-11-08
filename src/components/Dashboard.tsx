'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from './useWallet';
import { type State, type Step, explorer, short } from './types';
import { GuardFeed } from './ui/guard-feed';
import { AgentStage, type ScenarioId } from './ui/agent-stage';
import { CoinOrbit } from './landing/coin-orbit';
import { GITHUB, SiteNav } from './site-nav';
import { useSession } from './session';

async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    return json;
}

const GREEN = '#14F195';
const PURPLE = '#9945FF';
const RED = '#FF5C7A';
const AMBER = '#F5B73B';
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function useCountUp(target: number, duration = 1100) {
    const [v, setV] = useState(target);
    useEffect(() => {
        let raf = 0;
        const from = v;
        const t0 = performance.now();
        const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / duration);
            setV(from + (target - from) * (1 - Math.pow(1 - p, 4)));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target, duration]);
    return v;
}

export default function Dashboard() {
    const w = useWallet();
    const { session, save } = useSession();
    const [s, setS] = useState<State | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [allowance, setAllowance] = useState(1);
    const [task, setTask] = useState('Get weather forecasts for my Goa trip planning. Budget max 1 USDC, 0.1 per call.');
    const [chosenPayees, setChosenPayees] = useState<string[] | null>(null);
    const [transcript, setTranscript] = useState<Step[]>([]);

    const refresh = useCallback(async () => {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok) setS(await res.json());
    }, []);

    useEffect(() => {
        const first = setTimeout(refresh, 0);
        const t = setInterval(refresh, 3000);
        return () => {
            clearTimeout(first);
            clearInterval(t);
        };
    }, [refresh]);

    const payees = chosenPayees ?? (s?.addressBook[0] ? [s.addressBook[0].address] : []);
    const setPayees = (f: (p: string[]) => string[]) => setChosenPayees(f(payees));

    const run = async (label: string, fn: () => Promise<void>) => {
        setBusy(label);
        setErr(null);
        try {
            await fn();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setBusy(null);
            refresh();
        }
    };

    const owner = w.address;
    const sendTx = async (tx: string) => {
        const signature = await w.signAndSend(tx);
        await post('/api/wallet', { action: 'confirm', signature });
        return signature;
    };

    const connect = (wallet: (typeof w.wallets)[number]) =>
        run('connect', async () => {
            const addr = await w.connect(wallet);
            await post('/api/wallet', { action: 'connect', owner: addr });
        });

    const fundAgent = () =>
        run('fund', async () => {
            const { tx } = await post<{ tx: string }>('/api/wallet', { action: 'fund-agent-tx', owner, sol: 0.1 });
            await sendTx(tx);
        });

    const getUsdc = () => run('faucet', async () => void (await post('/api/wallet', { action: 'faucet', owner, amount: 100 })));

    const grant = () =>
        run('grant', async () => {
            let step = await post<{ step: string; tx: string; nonce?: string; delegation?: string }>('/api/wallet', { action: 'setup-tx', owner, amount: allowance, expiryHours: 24 });
            if (step.step === 'init-authority') {
                await sendTx(step.tx);
                step = await post('/api/wallet', { action: 'setup-tx', owner, amount: allowance, expiryHours: 24 });
            }
            const signature = await sendTx(step.tx);
            await post('/api/wallet', { action: 'setup-confirmed', owner, nonce: step.nonce, delegation: step.delegation, signature });
        });

    const revoke = () =>
        run('revoke', async () => {
            const { tx } = await post<{ tx: string }>('/api/wallet', { action: 'revoke-tx', owner });
            const signature = await sendTx(tx);
            await post('/api/wallet', { action: 'revoke-confirmed', signature });
        });

    const saveTask = () =>
        run('task', async () => {
            const recipients = s!.addressBook.filter(r => payees.includes(r.address));
            await post('/api/intent', { raw: task, recipients });
        });

    const simulate = (scenario: 'legit' | 'attack' | 'bundle') =>
        run(scenario, async () => {
            setTranscript([]);
            const { steps } = await post<{ steps: Step[] }>('/api/demo/agent', { scenario, city: 'Goa' });
            setTranscript(steps);
        });

    const review = (id: string, approve: boolean) => run(`review-${id}`, async () => void (await post('/api/review', { id, approve })));

    const connected = Boolean(owner && s?.owner?.address === owner);
    const agentFunded = (s?.agent.sol ?? 0) >= 0.02;
    const hasUsdc = (s?.owner?.usdc ?? 0) > 0;
    const granted = Boolean(s?.allowance);
    const remaining = s?.allowance?.remaining ?? 0;
    const grantedAmt = s?.delegation?.amount ?? 0;
    const pct = grantedAmt ? Math.max(0, Math.min(100, (remaining / grantedAmt) * 100)) : 0;

    const payments = (s?.activity ?? []).filter(a => a.kind === 'payment');
    const blocked = payments.filter(a => a.status === 'blocked' || a.status === 'denied').length;
    const paid = payments.filter(a => a.status === 'executed').length;
    const savedUsdc = payments.filter(a => a.status === 'blocked' || a.status === 'denied').reduce((t, a) => t + (a.amount ?? 0), 0);
    const lastRisk = payments.find(a => typeof a.risk === 'number');

    const signIn = (wallet: (typeof w.wallets)[number]) =>
        run('signin', async () => {
            const res = await w.signIn(wallet);
            await post('/api/wallet', { action: 'sign-in', owner: res.address, message: res.message, signature: res.signature });
            save({ address: res.address, at: Date.now() });
        });

    const signOut = () => save(null);
    const viewOnly = () => save({ address: s?.owner?.address ?? '', at: Date.now(), viewer: true });

    if (!session) return <SignIn s={s} wallets={w.wallets} onSignIn={signIn} onViewOnly={viewOnly} busy={busy === 'signin'} err={err} />;

    const account = (
        <>
            {session.viewer ? (
                <span className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground">view only</span>
            ) : (
                !owner &&
                w.wallets.slice(0, 1).map(x => (
                    <button key={x.name} onClick={() => connect(x)} className="rounded-full border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-white/5" title="Needed to sign setup transactions">
                        Reconnect {x.name}
                    </button>
                ))
            )}
            <span className="rounded-full bg-white px-3 py-1.5 font-mono text-[12px] font-semibold text-black">{short(s?.owner?.address ?? session.address)}</span>
            <button onClick={signOut} className="rounded-full px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                Sign out
            </button>
        </>
    );

    const setupDone = Boolean(s?.owner) && agentFunded && hasUsdc && granted;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNav cluster={s?.cluster} links={[{ href: '/', label: 'Home' }, { href: '/dashboard', label: 'Dashboard' }]} right={account} />
            <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_50%_60%_at_20%_0%,rgba(153,69,255,0.14),transparent_70%),radial-gradient(ellipse_40%_50%_at_85%_10%,rgba(20,241,149,0.08),transparent_70%)]" />

            <main className="relative mx-auto max-w-6xl px-5 pt-28 pb-24">
                {/* Header: who you are, what the agent can still spend */}
                <section data-tile="allowance" className="flex flex-wrap items-end justify-between gap-8">
                    <div>
                        <p className="text-[15px] text-muted-foreground">gm,</p>
                        <h1 className="mt-1 font-mono text-[40px] leading-none font-semibold tracking-[-0.04em] md:text-[56px]">
                            <span className="bg-linear-to-r from-[#c9a0ff] to-sol-green bg-clip-text text-transparent">{s?.owner ? short(s.owner.address) : 'anon'}</span>
                        </h1>
                        <p className="mt-3 text-[14px] text-muted-foreground">
                            {session.viewer ? 'Viewing the live demo wallet.' : 'Signed in with your wallet.'} Your agent’s spending, enforced by Solana.
                        </p>
                    </div>
                    <AllowanceNumber remaining={remaining} grantedAmt={grantedAmt} expiryTs={s?.allowance?.expiryTs} href={s?.delegation ? explorer('address', s.delegation.address, s.cluster, s.rpcUrl) : undefined} />
                    <h3 className="sr-only">On-chain allowance</h3>
                </section>
                <div className="mt-8 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-linear-to-r from-sol-purple to-sol-green" style={{ width: `${pct}%`, transition: `width 1000ms ${EASE}` }} />
                </div>

                {/* Stats, inline */}
                <section className="mt-10 grid grid-cols-2 gap-y-8 border-b border-white/[0.06] pb-10 md:grid-cols-4 md:divide-x md:divide-white/[0.06]">
                    <Metric label="Attacks blocked" value={String(blocked)} sub={`${savedUsdc.toFixed(2)} USDC kept safe`} color={RED} />
                    <Metric label="Payments settled" value={String(paid)} sub={`${s?.merchantUsdc ?? 0} USDC to merchant`} color={GREEN} className="md:pl-8" />
                    <div className="md:pl-8">
                        <p className="text-[12px] text-muted-foreground">Last risk score</p>
                        <MiniGauge risk={lastRisk?.risk} status={lastRisk?.status} />
                    </div>
                    <div className="md:pl-8">
                        <p className="text-[12px] text-muted-foreground">AI judge · {s?.llm ? 'on' : 'rules only'}</p>
                        <DecisionStrip payments={payments} />
                    </div>
                </section>

                {err && (
                    <div className="mt-8 flex items-center justify-between rounded-xl bg-[#FF5C7A]/10 px-4 py-3 text-sm text-[#ffb3c0]">
                        <span>{err}</span>
                        <button className="ml-2 underline" onClick={() => setErr(null)}>
                            dismiss
                        </button>
                    </div>
                )}

                <div id="dashboard" className="mt-14 grid gap-16 lg:grid-cols-[minmax(0,1fr)_380px]">
                    {/* Agent workspace: a single timeline */}
                    <ol className="relative">
                        <span className="absolute top-5 bottom-5 left-[19px] w-px bg-linear-to-b from-sol-purple/60 via-white/10 to-sol-green/60" />

                        <Step n={1} title="1 · Setup" done={setupDone} hint="once">
                            {setupDone ? (
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-foreground/80">
                                    <Done>Wallet {short(s?.owner?.address)}</Done>
                                    <Done>Agent gas {s?.agent.sol.toFixed(3)} SOL</Done>
                                    <Done>{s?.owner?.usdc} test USDC</Done>
                                    <Done>{grantedAmt} USDC allowance</Done>
                                    {connected && (
                                        <button onClick={revoke} disabled={busy === 'revoke'} className="text-[12px] text-[#ff9aac] underline-offset-2 hover:underline disabled:opacity-50">
                                            {busy === 'revoke' ? 'revoking…' : 'revoke'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <SetupRow done={Boolean(s?.owner)} label="Connect wallet" detail={s?.owner ? short(s.owner.address) : 'Phantom on ' + (s?.cluster ?? 'devnet')} />
                                    <SetupRow
                                        done={agentFunded}
                                        label="Fund agent gas"
                                        detail={`Agent ${short(s?.agent.address)} · ${s?.agent.sol.toFixed(3) ?? 0} SOL`}
                                        action={!agentFunded && connected ? <Btn onClick={fundAgent} busy={busy === 'fund'}>Send 0.1 SOL</Btn> : null}
                                    />
                                    <SetupRow
                                        done={hasUsdc}
                                        label="Get test USDC"
                                        detail={hasUsdc ? `${s?.owner?.usdc} USDC in your wallet` : 'Demo stablecoin minted to you'}
                                        action={connected && agentFunded ? <Btn onClick={getUsdc} busy={busy === 'faucet'}>{hasUsdc ? 'More' : 'Mint 100'}</Btn> : null}
                                    />
                                    <SetupRow
                                        done={granted}
                                        label="Grant on-chain allowance"
                                        detail={granted ? `${grantedAmt} USDC cap · until ${new Date((s?.allowance?.expiryTs ?? 0) * 1000).toLocaleString()}` : 'Agent can never pull more than this'}
                                        action={
                                            connected && hasUsdc ? (
                                                granted ? (
                                                    <Btn onClick={revoke} busy={busy === 'revoke'} tone="danger">
                                                        Revoke
                                                    </Btn>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <input type="number" min={0.1} step={0.1} value={allowance} onChange={e => setAllowance(Number(e.target.value))} className="w-16 rounded-lg border border-border bg-transparent px-2 py-1 text-xs" />
                                                        <Btn onClick={grant} busy={busy === 'grant'}>Grant</Btn>
                                                    </div>
                                                )
                                            ) : null
                                        }
                                    />
                                    {!connected && !session.viewer && <p className="pt-2 text-[12px] text-muted-foreground">Reconnect your wallet (top right) to sign setup transactions.</p>}
                                </div>
                            )}
                        </Step>

                        <Step n={2} title="2 · Give the agent a task" done={Boolean(s?.policy)} hint="plain English">
                            <textarea
                                value={task}
                                onChange={e => setTask(e.target.value)}
                                rows={2}
                                className="w-full resize-none border-b border-white/15 bg-transparent pb-3 text-[18px] leading-snug tracking-tight outline-none placeholder:text-muted-foreground focus:border-sol-purple"
                            />
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className="mr-1 text-[12px] text-muted-foreground">Agent may pay</span>
                                {s?.addressBook.map(r => {
                                    const on = payees.includes(r.address);
                                    return (
                                        <label key={r.address} className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-[12px] transition ${on ? 'bg-sol-green/15 text-sol-green' : 'text-muted-foreground ring-1 ring-white/10 hover:text-foreground'}`}>
                                            <input type="checkbox" className="sr-only" checked={on} onChange={e => setPayees(p => (e.target.checked ? [...p, r.address] : p.filter(x => x !== r.address)))} />
                                            {on ? '✓' : '+'} {r.name}
                                        </label>
                                    );
                                })}
                                <span className="ml-auto">
                                    <Btn onClick={saveTask} busy={busy === 'task'}>
                                        Set task
                                    </Btn>
                                </span>
                            </div>
                            {s?.policy && (
                                <p className="mt-5 text-[13px] leading-relaxed text-muted-foreground">
                                    <span className="text-sol-green">Active policy</span> ({s.policy.parsedBy === 'llm' ? 'parsed by AI' : 'parsed by rules'}): {s.policy.summary}. Budget{' '}
                                    <b className="font-mono font-medium text-foreground">{s.policy.maxTotal} USDC</b>, per payment <b className="font-mono font-medium text-foreground">{s.policy.maxPerTx}</b>, spent{' '}
                                    <b className="font-mono font-medium text-foreground">{s.spent}</b>.
                                </p>
                            )}
                        </Step>

                        <Step n={3} title="3 · Let the agent loose" done={false} hint="simulated agent, or a real one via MCP" last>
                            <AgentStage busy={busy && ['legit', 'attack', 'bundle'].includes(busy) ? (busy as ScenarioId) : null} transcript={transcript} onRun={simulate} s={s} />
                        </Step>
                    </ol>

                    <aside>
                        <div className="lg:sticky lg:top-24">
                            <GuardFeed s={s} onReview={review} busy={busy} />
                        </div>
                    </aside>
                </div>
            </main>

            <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-muted-foreground">
                Built for the MLH Solana Hackathon · devnet demo · not financial advice ·{' '}
                <a href={GITHUB} target="_blank" className="underline-offset-2 hover:underline">
                    GitHub
                </a>
            </footer>

            <style>{`@keyframes ig-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
        </div>
    );
}

function SignIn({ s, wallets, onSignIn, onViewOnly, busy, err }: { s: State | null; wallets: ReturnType<typeof useWallet>['wallets']; onSignIn: (w: ReturnType<typeof useWallet>['wallets'][number]) => void; onViewOnly: () => void; busy: boolean; err: string | null }) {
    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
            <SiteNav cluster={s?.cluster} links={[{ href: '/', label: 'Home' }]} />
            <CoinOrbit className="pointer-events-none absolute inset-0 opacity-35" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(3,3,3,0.92)_0%,rgba(3,3,3,0.6)_35%,transparent_70%)]" />
            <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-sol-purple to-sol-green text-black shadow-[0_0_60px_rgba(153,69,255,0.35)]">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
                        <path d="M9 12l2 2 4-4" />
                    </svg>
                </span>
                <h1 className="mt-7 text-[34px] leading-tight font-bold tracking-[-0.04em]">Sign in to IntentGuard</h1>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">No password. Your wallet is your login: Phantom signs a short message to prove it’s you. It’s free and moves no funds.</p>
                <div className="mt-8 flex w-full flex-col gap-2">
                    {wallets.length ? (
                        wallets.map(x => (
                            <button key={x.name} onClick={() => onSignIn(x)} disabled={busy} className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-60">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={x.icon} alt="" className="size-5" /> {busy ? 'Check your wallet…' : `Sign in with ${x.name}`}
                            </button>
                        ))
                    ) : (
                        <a href="https://phantom.com/download" target="_blank" className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black">
                            Install Phantom to sign in
                        </a>
                    )}
                    <button onClick={onViewOnly} className="w-full rounded-full py-3 text-[14px] text-muted-foreground transition hover:text-foreground">
                        Just look around (view only) →
                    </button>
                </div>
                {err && <p className="mt-4 text-[13px] text-[#ff9aac]">{err}</p>}
            </main>
        </div>
    );
}

function Step({ n, title, done, hint, last, children }: { n: number; title: string; done: boolean; hint?: string; last?: boolean; children: React.ReactNode }) {
    return (
        <li className={`relative pl-16 ${last ? '' : 'pb-14'}`}>
            <span className={`absolute top-0 left-0 grid size-10 place-items-center rounded-full font-mono text-[13px] font-semibold ring-4 ring-background ${done ? 'bg-sol-green text-black' : 'bg-[#15151b] text-foreground ring-offset-0'}`}>
                {done ? '✓' : `0${n}`}
            </span>
            <header className="flex min-h-10 flex-wrap items-baseline justify-between gap-x-4 pt-1.5">
                <h3 className="text-[20px] font-semibold tracking-tight">{title.replace(/^\d · /, '')}</h3>
                {hint && <span className="font-mono text-[11px] text-muted-foreground">{hint}</span>}
            </header>
            <span className="sr-only">{title}</span>
            <div className="mt-4">{children}</div>
        </li>
    );
}

function Done({ children }: { children: React.ReactNode }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className="text-sol-green">✓</span>
            {children}
        </span>
    );
}

function Metric({ label, value, sub, color, className }: { label: string; value: string; sub: string; color: string; className?: string }) {
    return (
        <div className={className}>
            <p className="text-[12px] text-muted-foreground">{label}</p>
            <p className="mt-2 font-mono text-[40px] leading-none font-semibold tracking-[-0.04em] tabular-nums" style={{ color }}>
                {value}
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">{sub}</p>
        </div>
    );
}

function MiniGauge({ risk, status }: { risk?: number; status?: string }) {
    const t = Math.min(1, (risk ?? 0) / 100);
    const len = Math.PI * 62;
    const col = risk === undefined ? '#555' : risk >= 70 ? RED : risk >= 30 ? AMBER : GREEN;
    return (
        <div className="mt-2 flex items-end gap-3">
            <svg width="76" height="44" viewBox="0 0 150 86" aria-hidden>
                <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="12" strokeLinecap="round" stroke="rgba(255,255,255,0.08)" />
                <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="12" strokeLinecap="round" strokeDasharray={len} style={{ stroke: col, strokeDashoffset: len * (1 - t), transition: `stroke-dashoffset 900ms ${EASE}, stroke 300ms` }} />
            </svg>
            <div>
                <p className="font-mono text-[28px] leading-none font-semibold tabular-nums">{risk ?? '–'}</p>
                <p className="mt-1 font-mono text-[11px]" style={{ color: col }}>
                    {status === 'executed' ? 'paid' : status === 'pending' ? 'needs you' : status ?? 'no payments yet'}
                </p>
            </div>
        </div>
    );
}

function AllowanceNumber({ remaining, grantedAmt, expiryTs, href }: { remaining: number; grantedAmt: number; expiryTs?: number; href?: string }) {
    const shown = useCountUp(remaining);
    return (
        <div className="text-left md:text-right">
            <p className="text-[12px] text-muted-foreground">On-chain allowance left</p>
            <p className="mt-1 font-mono text-[56px] leading-none font-semibold tracking-[-0.05em] tabular-nums md:text-[72px]">
                {shown.toFixed(2)}
                <span className="ml-2 text-base font-normal tracking-normal text-muted-foreground">/ {grantedAmt.toFixed(2)} USDC</span>
            </p>
            <p className="mt-2 font-mono text-[12px] text-muted-foreground">
                {expiryTs ? `expires ${new Date(expiryTs * 1000).toLocaleString()}` : 'not granted yet'}
                {href && (
                    <a href={href} target="_blank" className="ml-3 text-sol-green underline-offset-2 hover:underline">
                        view on explorer ↗
                    </a>
                )}
            </p>
        </div>
    );
}

function DecisionStrip({ payments }: { payments: State['activity'] }) {
    const bars = [...payments].reverse().slice(-24);
    const color = (st?: string) => (st === 'executed' ? GREEN : st === 'pending' ? AMBER : st === 'blocked' || st === 'denied' || st === 'failed' ? RED : PURPLE);
    return (
        <div className="mt-2">
            <div className="flex items-end gap-[3px]" style={{ height: 40 }}>
                {bars.length ? (
                    bars.map(a => {
                        const h = 20 + Math.min(80, Math.log10(1 + (a.amount ?? 0) * 10) * 60);
                        return <span key={a.id} title={`${a.amount} USDC · ${a.status}`} className="max-w-3 flex-1 rounded-[3px]" style={{ height: `${h}%`, background: color(a.status), animation: `ig-in 500ms ${EASE} both` }} />;
                    })
                ) : (
                    <span className="self-center text-[12px] text-muted-foreground">No agent payments yet.</span>
                )}
            </div>
            <div className="mt-2 flex gap-3 font-mono text-[11px] text-muted-foreground">
                <Legend c={GREEN} t="paid" />
                <Legend c={AMBER} t="review" />
                <Legend c={RED} t="blocked" />
            </div>
        </div>
    );
}

function Legend({ c, t }: { c: string; t: string }) {
    return (
        <span className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: c }} /> {t}
        </span>
    );
}

function SetupRow({ done, label, detail, action }: { done: boolean; label: string; detail?: string; action?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
            <div className="flex min-w-0 items-center gap-3">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${done ? 'bg-sol-green text-black' : 'border border-white/20 text-muted-foreground'}`}>{done ? '✓' : ''}</span>
                <div className="min-w-0">
                    <div className="text-[13px] font-medium">{label}</div>
                    {detail && <div className="truncate text-[11px] text-muted-foreground">{detail}</div>}
                </div>
            </div>
            {action}
        </div>
    );
}

function Btn({ children, onClick, busy, tone }: { children: React.ReactNode; onClick: () => void; busy?: boolean; tone?: 'danger' }) {
    return (
        <button
            onClick={onClick}
            disabled={busy}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-[0.97] disabled:opacity-50 ${tone === 'danger' ? 'bg-[#FF5C7A]/15 text-[#ff9aac] hover:bg-[#FF5C7A]/25' : 'bg-white text-black hover:bg-zinc-200'}`}
        >
            {busy ? '…' : children}
        </button>
    );
}
