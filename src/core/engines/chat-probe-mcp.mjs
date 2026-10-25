// src/core/engines/chat-probe-mcp.mjs
// The MCP server of a chat self-test (engines/chat-selftest.mjs): a stdio server standing in for worca's own, under the
// same name, with a few of worca's tool names — those that clash with a CLI's built-ins (read_file, grep, glob, web_fetch,
// web_search, git), which a lockdown must leave offered — and `worca_probe`, whose call it records in $WORCA_PROBE_LOG.
// Every tool answers a fixed text; none reads or writes anything else.
import { appendFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const PROBE_TOOLS = Object.freeze(['worca_probe', 'read_file', 'grep', 'glob', 'web_fetch', 'web_search', 'git']);
export const PROBE_ANSWER = 'WORCA_PROBE_OK';

function serve() {
  const tools = PROBE_TOOLS.map((name) => ({ name, description: `worca chat self-test: ${name}`, inputSchema: { type: 'object', properties: {} } }));
  const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  createInterface({ input: process.stdin }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.method === 'initialize') {
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'worca-probe', version: '1' } } });
    } else if (m.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: m.id, result: { tools } });
    } else if (m.method === 'tools/call') {
      const name = String(m.params?.name || '');
      if (process.env.WORCA_PROBE_LOG) { try { appendFileSync(process.env.WORCA_PROBE_LOG, `${JSON.stringify({ name })}\n`); } catch { /* the self-test reads a missing call as a failure */ } }
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `${PROBE_ANSWER} ${name}` }] } });
    } else if (m.method === 'ping') {
      send({ jsonrpc: '2.0', id: m.id, result: {} });
    } else if (m.id !== undefined && typeof m.method === 'string') {
      // Anything else is unknown (a client that opens with `server/discover`, as goose does, falls back to initialize).
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
    }
  });
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) serve();
