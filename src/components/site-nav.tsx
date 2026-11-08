'use client';

import Link from 'next/link';

export const GITHUB = 'https://github.com/amangithub01/intentguard';

export function Logo() {
    return (
        <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-sol-purple to-sol-green text-black">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
                    <path d="M9 12l2 2 4-4" />
                </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">IntentGuard</span>
        </Link>
    );
}

export function SiteNav({ cluster, right, links }: { cluster?: string; right?: React.ReactNode; links?: { href: string; label: string }[] }) {
    return (
        <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#030303]/60 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
                <Logo />
                <div className="hidden items-center gap-6 text-[13px] text-muted-foreground md:flex">
                    {(links ?? []).map(l => (
                        <Link key={l.href} href={l.href} className="hover:text-foreground">
                            {l.label}
                        </Link>
                    ))}
                    <a href={GITHUB} target="_blank" className="hover:text-foreground">
                        GitHub
                    </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium sm:flex">
                        <span className="size-2 rounded-full bg-sol-green" />
                        {cluster ?? process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet'}
                    </span>
                    {right}
                </div>
            </div>
        </nav>
    );
}
