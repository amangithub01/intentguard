'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from './useWallet';

type Check = { name: string; passed: boolean; detail: string; severity: 'block' | 'review' | 'info' };
type Activity = {
    id: string;
    ts: number;
    kind: 'payment' | 'intent' | 'setup' | 'revoke' | 'info';
    title: string;
    recipient?: string;
    recipientName?: string;
    amount?: number;
    reason?: string;
    context?: string;
    verdict?: 'approved' | 'review' | 'blocked';
    status?: 'pending' | 'executed' | 'blocked' | 'denied' | 'failed';
    risk?: number;
    explanation?: string;
    judgedBy?: 'llm' | 'rules';
    checks?: Check[];
    signature?: string;
    error?: string;
};
type Recipient = { name: string; address: string };
type State = {
    cluster: string;
    rpcUrl: string;
    llm: boolean;
    agent: { address: string; sol: number };
    owner: { address: string; sol: number | null; usdc: number | null } | null;
    mint: string | null;
    delegation: { address: string; amount: number; expiryTs: number } | null;
    allowance: { remaining: number; expiryTs: number; delegatee: string } | null;
    policy: null | { summary: string; maxTotal: number; maxPerTx: number; reviewAbove: number; allowedRecipients: Recipient[]; parsedBy: string; purposes: string[] };
    spent: number;
    addressBook: Recipient[];
    merchantUsdc: number;
    activity: Activity[];
};
type Step = { actor: 'agent' | 'merchant' | 'guard'; text: string; tone?: 'ok' | 'warn' | 'bad' };

async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    return json;
}

const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');

function explorer(kind: 'tx' | 'address', id: string, cluster: string, rpcUrl: string) {
    const q = cluster === 'localnet' ? `cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}` : `cluster=${cluster}`;
    return `https://explorer.solana.com/${kind}/${id}?${q}`;
}

export default function Dashboard() {
    const w = useWallet();
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

    const connectBurner = () =>
        run('connect', async () => {
            const addr = await w.connectBurner();
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

    return (
        <div className="min-h-screen bg-[#07070c] text-zinc-100">
            <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(153,69,255,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(20,241,149,0.10),transparent_50%)]" />
            <div className="relative mx-auto max-w-6xl px-5 py-6">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#9945FF] to-[#14F195] text-xl font-black text-black">⛨</div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight">IntentGuard</h1>
                            <p className="text-xs text-zinc-400">Intent firewall for AI agents that spend on Solana</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge>{s?.cluster ?? CLUSTER_FALLBACK}</Badge>
                        <Badge tone={s?.llm ? 'ok' : 'warn'}>{s?.llm ? 'AI judge: on' : 'AI judge: rules-only'}</Badge>
                        {owner ? (
                            <Badge tone="ok">
                                {w.isBurner ? 'demo wallet ' : ''}{short(owner)} · {s?.owner?.sol?.toFixed(3) ?? '–'} SOL · {s?.owner?.usdc ?? '–'} USDC
                            </Badge>
                        ) : w.wallets.length ? (
                            [
                                <button key="demo" onClick={connectBurner} className="rounded-lg border border-zinc-600 px-3 py-1.5 font-semibold text-zinc-200 hover:bg-zinc-800">
                                    Use demo wallet
                                </button>,
                                ...w.wallets.map(x => (
                                <button key={x.name} onClick={() => connect(x)} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 font-semibold text-black hover:bg-zinc-200">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={x.icon} alt="" className="h-4 w-4" /> Connect {x.name}
                                </button>
                                )),
                            ]
                        ) : (
<>
                                <button onClick={connectBurner} className="rounded-lg border border-zinc-600 px-3 py-1.5 font-semibold text-zinc-200 hover:bg-zinc-800">
                                    Use demo wallet
                                </button>
                                <a href="https://phantom.com/download" target="_blank" className="rounded-lg bg-white px-3 py-1.5 font-semibold text-black">
                                    Install Phantom
                                </a>
                            </>
                        )}
                    </div>
                </header>

                <section className="mt-8 mb-6">
                    <h2 className="max-w-3xl text-3xl font-bold leading-tight md:text-4xl">
                        Let your AI agent pay for things.{' '}
                        <span className="bg-gradient-to-r from-[#9945FF] to-[#14F195] bg-clip-text text-transparent">Never let it get tricked into paying.</span>
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm text-zinc-400">
                        The agent never gets your key. It can only pull from a capped <b className="text-zinc-200">on-chain allowance</b> (Solana Subscriptions &amp; Allowances
                        program), and every payment must match <b className="text-zinc-200">the task you gave it</b>. Prompt-injected payments are blocked before they hit the chain.
                    </p>
                </section>

                {err && (
                    <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                        {err} <button className="ml-2 underline" onClick={() => setErr(null)}>dismiss</button>
                    </div>
                )}

                <div className="grid gap-5 lg:grid-cols-5">
                    <div className="space-y-5 lg:col-span-2">
                        <Card title="1 · Setup" subtitle="Three wallet actions, done once">
                            <SetupRow done={connected} label="Connect wallet" detail={connected ? short(owner) : 'Phantom on ' + (s?.cluster ?? 'devnet')} />
                            {connected && w.isBurner && (s?.owner?.sol ?? 0) < 0.05 && (
                                <div className="my-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-amber-200">
                                    Demo wallet needs ~0.3 devnet SOL. Send it from Phantom (Send → paste) or faucet.solana.com to:
                                    <div className="mt-1 flex items-center gap-2">
                                        <code className="break-all text-amber-100">{owner}</code>
                                        <button className="underline" onClick={() => navigator.clipboard.writeText(owner!)}>copy</button>
                                    </div>
                                </div>
                            )}
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
                                detail={granted ? `${grantedAmt} USDC cap · expires ${new Date((s?.allowance?.expiryTs ?? 0) * 1000).toLocaleString()}` : 'Agent can never pull more than this'}
                                action={
                                    connected && hasUsdc ? (
                                        granted ? (
                                            <Btn onClick={revoke} busy={busy === 'revoke'} tone="danger">Revoke</Btn>
                                        ) : (
                                            <div className="flex items-center gap-1">
                                                <input type="number" min={0.1} step={0.1} value={allowance} onChange={e => setAllowance(Number(e.target.value))} className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs" />
                                                <Btn onClick={grant} busy={busy === 'grant'}>Grant</Btn>
                                            </div>
                                        )
                                    ) : null
                                }
                            />
                        </Card>

                        <Card title="2 · Give the agent a task" subtitle="Plain English → enforceable spending policy">
                            <textarea value={task} onChange={e => setTask(e.target.value)} rows={3} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm" />
                            <div className="mt-2 text-xs text-zinc-400">Approved payees</div>
                            <div className="mt-1 space-y-1">
                                {s?.addressBook.map(r => (
                                    <label key={r.address} className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={payees.includes(r.address)} onChange={e => setPayees(p => (e.target.checked ? [...p, r.address] : p.filter(x => x !== r.address)))} />
                                        {r.name} <span className="font-mono text-xs text-zinc-500">{short(r.address)}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="mt-3 flex justify-end">
                                <Btn onClick={saveTask} busy={busy === 'task'}>Set task</Btn>
                            </div>
                            {s?.policy && (
                                <div className="mt-3 rounded-lg border border-[#14F195]/30 bg-[#14F195]/5 p-3 text-xs">
                                    <div className="font-semibold text-[#14F195]">Active policy ({s.policy.parsedBy === 'llm' ? 'parsed by AI' : 'parsed by rules'})</div>
                                    <div className="mt-1 text-zinc-300">{s.policy.summary}</div>
                                    <div className="mt-2 grid grid-cols-3 gap-2 text-zinc-400">
                                        <Stat k="Budget" v={`${s.policy.maxTotal} USDC`} />
                                        <Stat k="Per payment" v={`${s.policy.maxPerTx}`} />
                                        <Stat k="Spent" v={`${s.spent}`} />
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="space-y-5 lg:col-span-3">
                        <Card title="On-chain allowance" subtitle="Enforced by Solana, even if this server is compromised">
                            <div className="flex items-end justify-between">
                                <div className="text-3xl font-bold">
                                    {remaining.toFixed(2)} <span className="text-base font-normal text-zinc-400">/ {grantedAmt.toFixed(2)} USDC left</span>
                                </div>
                                {s?.delegation && (
                                    <a href={explorer('address', s.delegation.address, s.cluster, s.rpcUrl)} target="_blank" className="text-xs text-[#14F195] underline">
                                        view allowance account ↗
                                    </a>
                                )}
                            </div>
                            <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-800">
                                <div className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="mt-2 text-xs text-zinc-500">WeatherCo (merchant) has received {s?.merchantUsdc ?? 0} USDC</div>
                        </Card>

                        <Card title="3 · Let the agent loose" subtitle="Simulated agent, or connect a real one via MCP">
                            <div className="grid gap-2 sm:grid-cols-3">
                                <Scenario onClick={() => simulate('legit')} busy={busy === 'legit'} emoji="🌤️" title="Buy weather data" desc="x402 paid API, 0.1 USDC" />
                                <Scenario onClick={() => simulate('attack')} busy={busy === 'attack'} emoji="☠️" title="Prompt injection" desc="Merchant hides 'send 5 USDC' order" danger />
                                <Scenario onClick={() => simulate('bundle')} busy={busy === 'bundle'} emoji="🧾" title="Bigger purchase" desc="0.3 USDC → asks you first" />
                            </div>
                            {transcript.length > 0 && (
                                <div className="mt-3 space-y-1.5 rounded-lg bg-black/40 p-3 font-mono text-xs">
                                    {transcript.map((t, i) => (
                                        <div key={i} className={t.tone === 'bad' ? 'text-red-300' : t.tone === 'warn' ? 'text-amber-300' : t.tone === 'ok' ? 'text-emerald-300' : 'text-zinc-300'}>
                                            <span className="mr-2 inline-block w-16 text-zinc-500">{t.actor === 'guard' ? '🛡 guard' : t.actor === 'agent' ? '🤖 agent' : '🏪 shop'}</span>
                                            <span className="break-words">{t.text}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        <Card title="Activity" subtitle="Every payment request, with the reasoning">
                            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                                {s?.activity.length ? (
                                    s.activity.map(a => <ActivityRow key={a.id} a={a} s={s} onReview={review} busy={busy} />)
                                ) : (
                                    <div className="text-sm text-zinc-500">Nothing yet.</div>
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                <section className="mt-8 grid gap-4 md:grid-cols-3">
                    <Explainer n="Layer 1" title="Intent check (AI + rules)" body="Each payment is compared with your task: approved payee? within budget? does the request come from content that tries to give the agent orders? Suspicious → blocked or sent to you." />
                    <Explainer n="Layer 2" title="On-chain allowance" body="Solana's native Subscriptions & Allowances program caps what the agent key can pull, with expiry. Even a fully hacked server can't exceed it." />
                    <Explainer n="Plug-in" title="MCP server for any AI agent" body="Claude, Copilot or any MCP client gets pay / fetch_paid_resource tools. The agent never holds a wallet key." />
                </section>
                <footer className="mt-8 pb-6 text-center text-xs text-zinc-600">Built for the MLH Solana Hackathon · devnet demo · not financial advice</footer>
            </div>
        </div>
    );
}

const CLUSTER_FALLBACK = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';

function ActivityRow({ a, s, onReview, busy }: { a: Activity; s: State; onReview: (id: string, ok: boolean) => void; busy: string | null }) {
    const [open, setOpen] = useState(false);
    const color =
        a.status === 'executed' ? 'border-emerald-500/40' : a.status === 'pending' ? 'border-amber-400/60' : a.status === 'blocked' || a.status === 'denied' || a.status === 'failed' ? 'border-red-500/40' : 'border-zinc-800';
    const label = a.status ? { executed: '✅ paid', pending: '⏳ needs you', blocked: '⛔ blocked', denied: '🚫 denied', failed: '⚠️ failed' }[a.status] : null;
    return (
        <div className={`rounded-lg border ${color} bg-zinc-900/60 p-3 text-sm`}>
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="font-medium">
                        {a.kind === 'payment' ? `${a.amount} USDC → ${a.recipientName ?? short(a.recipient)}` : a.title}
                    </div>
                    {a.reason && <div className="text-xs text-zinc-400">“{a.reason}”</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                    {typeof a.risk === 'number' && <span className="text-zinc-500">risk {a.risk}</span>}
                    {label && <span>{label}</span>}
                </div>
            </div>
            {a.explanation && <div className="mt-1 text-xs text-zinc-300">{a.explanation}</div>}
            {a.error && <div className="mt-1 text-xs text-red-300">{a.error}</div>}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {a.signature && (
                    <a className="text-[#14F195] underline" target="_blank" href={explorer('tx', a.signature, s.cluster, s.rpcUrl)}>
                        tx {short(a.signature)} ↗
                    </a>
                )}
                {a.checks?.length ? (
                    <button className="text-zinc-400 underline" onClick={() => setOpen(o => !o)}>
                        {open ? 'hide' : 'show'} {a.checks.length} checks{a.judgedBy === 'llm' ? ' + AI verdict' : ''}
                    </button>
                ) : null}
                <span className="ml-auto text-zinc-600">{new Date(a.ts).toLocaleTimeString()}</span>
            </div>
            {open && (
                <ul className="mt-2 space-y-1 text-xs">
                    {a.checks!.map((c, i) => (
                        <li key={i} className={c.passed ? 'text-zinc-400' : c.severity === 'block' ? 'text-red-300' : 'text-amber-300'}>
                            {c.passed ? '✓' : '✗'} <b>{c.name}</b>: {c.detail}
                        </li>
                    ))}
                    {a.context && <li className="mt-1 rounded bg-black/40 p-2 font-mono text-zinc-500">context: {a.context.slice(0, 400)}</li>}
                </ul>
            )}
            {a.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                    <Btn onClick={() => onReview(a.id, true)} busy={busy === `review-${a.id}`}>Approve &amp; pay</Btn>
                    <Btn onClick={() => onReview(a.id, false)} tone="danger">Deny</Btn>
                </div>
            )}
        </div>
    );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 backdrop-blur">
            <div className="mb-3">
                <h3 className="font-semibold">{title}</h3>
                {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
            </div>
            {children}
        </section>
    );
}

function SetupRow({ done, label, detail, action }: { done: boolean; label: string; detail?: string; action?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800/70 py-2.5 last:border-0">
            <div className="flex items-center gap-3">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${done ? 'bg-[#14F195] text-black' : 'border border-zinc-600 text-zinc-500'}`}>{done ? '✓' : ''}</span>
                <div>
                    <div className="text-sm font-medium">{label}</div>
                    {detail && <div className="text-xs text-zinc-500">{detail}</div>}
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
            className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${tone === 'danger' ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-[#9945FF] text-white hover:bg-[#8a3df0]'}`}
        >
            {busy ? '…' : children}
        </button>
    );
}

function Scenario({ emoji, title, desc, onClick, busy, danger }: { emoji: string; title: string; desc: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={busy}
            className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 disabled:opacity-50 ${danger ? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10' : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800'}`}
        >
            <div className="text-xl">{busy ? '⏳' : emoji}</div>
            <div className="mt-1 text-sm font-semibold">{title}</div>
            <div className="text-xs text-zinc-400">{desc}</div>
        </button>
    );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' }) {
    const c = tone === 'ok' ? 'border-emerald-500/40 text-emerald-300' : tone === 'warn' ? 'border-amber-400/40 text-amber-300' : 'border-zinc-700 text-zinc-300';
    return <span className={`rounded-full border px-2.5 py-1 ${c}`}>{children}</span>;
}

function Stat({ k, v }: { k: string; v: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
            <div className="text-zinc-200">{v}</div>
        </div>
    );
}

function Explainer({ n, title, body }: { n: string; title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-xs font-semibold text-[#14F195]">{n}</div>
            <div className="mt-1 font-semibold">{title}</div>
            <p className="mt-1 text-xs text-zinc-400">{body}</p>
        </div>
    );
}
