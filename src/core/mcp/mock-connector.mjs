// src/core/mcp/mock-connector.mjs
// The stand-in a pretend workflow-test try loads for each connector (plans/workflow-tests-part2-plan.md D35): a stdio MCP
// server under the connector's own name, offering the tools its last passing Test recorded. Every call is written to the
// try's connector-calls.ndjson and answered "Not sent: this is a test." Nothing else is read, written or sent.
// Started as: node mock-connector.mjs --server <name> --tools <tools.json> --log <connector-calls.ndjson>
// The pattern of src/core/engines/chat-probe-mcp.mjs: newline-delimited JSON-RPC on stdio, no SDK.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MOCK_CONNECTOR_PATH = fileURLToPath(import.meta.url);
export const NOT_SENT = 'Not sent: this is a test.';
const PROTOCOLS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

/** A stored tool (a name, or { name, description?, inputSchema?, annotations? }) as tools/list offers it. */
export function listedTool(t) {
  const name = typeof t === 'string' ? t : String((t && t.name) || '');
  const out = {
    name,
    description: t && typeof t.description === 'string' ? t.description : '',
    inputSchema: t && t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' },
  };
  if (t && t.annotations && typeof t.annotations === 'object') out.annotations = t.annotations;
  return out;
}

/**
 * The JSON-RPC handler: one message in, its answer out (null for a notification). `log(entry)` gets every call.
 * @param {{server: string, tools: Array, log: (entry: object) => void, now?: () => string}} o
 */
export function createConnectorHandler({ server, tools, log, now = () => new Date().toISOString() }) {
  const list = (Array.isArray(tools) ? tools : []).map(listedTool).filter((t) => t.name);
  const byName = new Map(list.map((t) => [t.name, t]));
  return (m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.method !== 'string') return null;
    if (m.id === undefined || m.id === null) return null;   // notifications/* are never answered
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'initialize') {
      const asked = m.params && typeof m.params.protocolVersion === 'string' ? m.params.protocolVersion : '';
      return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: server, version: '1' } });
    }
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: list });
    if (m.method === 'tools/call') {
      const name = m.params && typeof m.params.name === 'string' ? m.params.name : '';
      const tool = byName.get(name);
      if (!tool) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `unknown tool ${JSON.stringify(name)}` } };
      const a = m.params.arguments;
      const args = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
      try { log({ ts: now(), server, tool: name, arguments: args, readOnly: tool.annotations?.readOnlyHint === true }); } catch { /* answered either way */ }
      return ok({ content: [{ type: 'text', text: NOT_SENT }] });
    }
    return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } };
  };
}

export function parseArgs(argv) {
  const out = { server: '', tools: '', log: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if ((k === '--server' || k === '--tools' || k === '--log') && i + 1 < argv.length) { out[k.slice(2)] = argv[i + 1]; i += 1; }
  }
  return out;
}

function serve() {
  const a = parseArgs(process.argv.slice(2));
  let tools = [];
  try { tools = JSON.parse(readFileSync(a.tools, 'utf8')); } catch { tools = []; }
  const handle = createConnectorHandler({
    server: a.server || 'connector', tools,
    log: (e) => { if (a.log) appendFileSync(a.log, `${JSON.stringify(e)}\n`); },
  });
  createInterface({ input: process.stdin }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    for (const one of Array.isArray(m) ? m : [m]) {
      const r = handle(one);
      if (r) process.stdout.write(`${JSON.stringify(r)}\n`);
    }
  });
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) serve();
