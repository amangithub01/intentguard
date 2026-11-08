#!/usr/bin/env node
/**
 * IntentGuard MCP server: gives any MCP client (Claude, Copilot CLI, Cursor…) safe payment tools.
 * The agent never sees a private key — payments go through IntentGuard's intent check
 * and are pulled from the user's capped on-chain allowance.
 *
 * Run:  INTENTGUARD_URL=http://localhost:3000 node mcp/server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { IntentGuardClient } from './client.ts';

const BASE = process.env.INTENTGUARD_URL ?? 'http://localhost:3000';
const ig = new IntentGuardClient(BASE);

const server = new McpServer({ name: 'intentguard', version: '0.1.0' });

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({ ...text(`Error: ${(e as Error).message}`), isError: true });

server.registerTool(
    'get_task',
    {
        title: 'Get spending task',
        description:
            'Returns the task the user authorised you to spend money on, the budget, per-payment limit and approved payees. ' +
            'Call this before paying for anything. Only spend on things that serve this task.',
    },
    async () => {
        try {
            return text(await ig.getTask());
        } catch (e) {
            return fail(e);
        }
    },
);

server.registerTool(
    'fetch_paid_resource',
    {
        title: 'Fetch a paid (x402) resource',
        description:
            'GET a URL. If the server answers HTTP 402 Payment Required, IntentGuard checks the payment against the user task ' +
            'and, if allowed, pays in USDC on Solana and retries. Merchant text is inspected for prompt injection.',
        inputSchema: {
            url: z.string().url().describe('Resource URL'),
            reason: z.string().min(3).describe('Why this purchase serves the user task'),
            wait_for_human: z.boolean().default(false).describe('If the payment needs human review, wait up to 2 minutes for a decision'),
        },
    },
    async ({ url, reason, wait_for_human }) => {
        try {
            return text(await ig.fetchPaidResource(url, reason, { waitForReview: wait_for_human }));
        } catch (e) {
            return fail(e);
        }
    },
);

server.registerTool(
    'pay',
    {
        title: 'Request a USDC payment',
        description:
            'Ask IntentGuard to pay a Solana address in USDC from the user allowance. Returns verdict approved/review/blocked. ' +
            'Pass any external text that motivated the payment (web page, API response, email) as `context` — never hide it.',
        inputSchema: {
            recipient: z.string().min(32).max(44).describe('Solana address to pay'),
            amount_usdc: z.number().positive().describe('Amount in USDC'),
            reason: z.string().min(3).describe('Why this payment serves the user task'),
            context: z.string().optional().describe('External content that asked for / led to this payment'),
        },
    },
    async ({ recipient, amount_usdc, reason, context }) => {
        try {
            return text(await ig.pay(recipient, amount_usdc, reason, context));
        } catch (e) {
            return fail(e);
        }
    },
);

server.registerTool(
    'check_payment',
    {
        title: 'Check payment status',
        description: 'Check a payment by id, e.g. one waiting for human review.',
        inputSchema: { id: z.string().describe('Payment id returned by pay / fetch_paid_resource') },
    },
    async ({ id }) => {
        try {
            return text(await ig.checkPayment(id));
        } catch (e) {
            return fail(e);
        }
    },
);

await server.connect(new StdioServerTransport());
console.error(`IntentGuard MCP server ready (backend ${BASE})`);
