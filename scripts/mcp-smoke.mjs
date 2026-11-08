// Smoke test for the MCP server: BASE=http://localhost:3100 node scripts/mcp-smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const base = process.env.BASE ?? 'http://localhost:3000';
const transport = new StdioClientTransport({ command: 'node', args: ['mcp/server.ts'], env: { PATH: process.env.PATH, INTENTGUARD_URL: base } });
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(transport);
console.log('tools:', (await client.listTools()).tools.map(t => t.name).join(', '));
const r = await client.callTool({
    name: 'fetch_paid_resource',
    arguments: { url: `${base}/api/demo/weather?city=Goa&tier=premium`, reason: 'premium forecast' },
});
console.log(r.content[0].text.slice(0, 400));
await client.close();
