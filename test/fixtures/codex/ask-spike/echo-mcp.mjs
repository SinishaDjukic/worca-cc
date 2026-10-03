#!/usr/bin/env node
// test/fixtures/codex/ask-spike/echo-mcp.mjs — the MCP server of the Ask on Codex spike (plans/ask-on-codex-spike.md).
// Three tools: echo (a success), env (which marker variables this child sees — values only for the
// spike's own markers, never the developer's), fail (an isError result).
import { createInterface } from 'node:readline';
import { createRpcServer } from '../../../../src/core/ask/mcp-stdio.mjs';
import { AskToolError } from '../../../../src/core/ask/tools.mjs';

const OWN = new Set(['SPIKE_KEY', 'SPIKE_INLINE']);
const MARKERS = ['SPIKE_KEY', 'SPIKE_INLINE', 'SSH_AUTH_SOCK', 'WORCA_HOME', 'HOME', 'PATH', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY'];
const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const tools = {
  list: () => [
    { name: 'echo', description: 'Echo the text back.', inputSchema: obj({ text: { type: 'string' } }, ['text']) },
    { name: 'env', description: 'Report which environment variables this server sees.', inputSchema: obj() },
    { name: 'fail', description: 'Always fails.', inputSchema: obj() },
  ],
  async call(name, input) {
    if (name === 'echo') return { echoed: input.text };
    if (name === 'env') {
      return { count: Object.keys(process.env).length,
        markers: Object.fromEntries(MARKERS.map((k) => [k, process.env[k] === undefined ? null : OWN.has(k) ? process.env[k] : 'set'])) };
    }
    throw new AskToolError('fail: as asked');
  },
};
const server = createRpcServer({ tools, write: (s) => process.stdout.write(s) });
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => { server.feed(line); });
rl.on('close', async () => { await server.idle(); process.exit(0); });
