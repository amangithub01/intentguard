import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from '@solana/kit';
import { DATA_DIR } from './config';

export type Recipient = { name: string; address: string };

export type Policy = {
    raw: string;
    summary: string;
    purposes: string[];
    maxTotal: number;
    maxPerTx: number;
    reviewAbove: number;
    allowedRecipients: Recipient[];
    parsedBy: 'llm' | 'rules';
    createdAt: number;
};

export type Check = { name: string; passed: boolean; detail: string; severity: 'block' | 'review' | 'info' };

export type Verdict = 'approved' | 'review' | 'blocked';

export type Activity = {
    id: string;
    ts: number;
    kind: 'payment' | 'intent' | 'setup' | 'revoke' | 'info';
    title: string;
    recipient?: string;
    recipientName?: string;
    amount?: number;
    reason?: string;
    context?: string;
    verdict?: Verdict;
    status?: 'pending' | 'executed' | 'blocked' | 'denied' | 'failed';
    risk?: number;
    explanation?: string;
    judgedBy?: 'llm' | 'rules';
    checks?: Check[];
    signature?: string;
    error?: string;
};

export type DelegationInfo = { nonce: string; address: string; amount: number; expiryTs: number };

export type State = {
    owner: string | null;
    mint: string | null;
    delegation: DelegationInfo | null;
    policy: Policy | null;
    spent: number;
    activity: Activity[];
};

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');

const emptyState = (): State => ({ owner: null, mint: null, delegation: null, policy: null, spent: 0, activity: [] });

function ensureDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readState(): State {
    ensureDir();
    if (!fs.existsSync(STATE_FILE)) return emptyState();
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
}

export function updateState(mutator: (s: State) => void): State {
    const s = readState();
    mutator(s);
    s.activity = s.activity.slice(0, 200);
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    return s;
}

export function addActivity(a: Omit<Activity, 'id' | 'ts'>): Activity {
    const entry: Activity = { id: crypto.randomUUID(), ts: Date.now(), ...a };
    updateState(s => {
        s.activity.unshift(entry);
    });
    return entry;
}

export function patchActivity(id: string, patch: Partial<Activity>): Activity | undefined {
    let found: Activity | undefined;
    updateState(s => {
        const a = s.activity.find(x => x.id === id);
        if (a) {
            Object.assign(a, patch);
            found = a;
        }
    });
    return found;
}

type KeyName = 'agent' | 'merchant' | 'attacker';

function readSeeds(): Record<string, string> {
    ensureDir();
    if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    const seeds = {
        agent: crypto.randomBytes(32).toString('hex'),
        merchant: crypto.randomBytes(32).toString('hex'),
        attacker: crypto.randomBytes(32).toString('hex'),
    };
    fs.writeFileSync(KEYS_FILE, JSON.stringify(seeds, null, 2), { mode: 0o600 });
    return seeds;
}

const signerCache = new Map<KeyName, Promise<KeyPairSigner>>();

export function getSigner(name: KeyName): Promise<KeyPairSigner> {
    if (!signerCache.has(name)) {
        const seed = Buffer.from(readSeeds()[name], 'hex');
        signerCache.set(name, createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed)));
    }
    return signerCache.get(name)!;
}

export async function getAddressBook(): Promise<Recipient[]> {
    const [merchant, attacker] = await Promise.all([getSigner('merchant'), getSigner('attacker')]);
    return [
        { name: 'WeatherCo API (demo merchant)', address: merchant.address },
        { name: 'Unknown wallet (demo attacker)', address: attacker.address },
    ];
}
