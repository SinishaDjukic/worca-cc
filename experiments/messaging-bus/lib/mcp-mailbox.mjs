#!/usr/bin/env node
// experiments/messaging-bus/lib/mcp-mailbox.mjs — the mailbox as an MCP stdio server, for engines
// without hooks (plan §3.4, §4.1). Hand-rolled JSON-RPC 2.0, one message per line (the framing of
// src/core/ask/mcp-stdio.mjs), stdout carrying only protocol messages.
//   node lib/mcp-mailbox.mjs --db <p> --consumer-prefix <c> --session <id> --topics <a,b> [--start-mark <name>]
// bus_read acks what it returns by the same shown-prefix rule as the hook; `reader` (default main)
// picks the consumer inside this session and is self-asserted (one principal per session).
// bus_publish stamps `from` from --session and `reader`, never from any other argument.
import { createInterface } from 'node:readline';
import { createSqliteBus } from './sqlite-bus.mjs';
import { consumerFromPayload } from './consumer-id.mjs';
import { renderMailbox } from './render.mjs';

const TOOLS = [
  {
    name: 'bus_read',
    description: 'Read new bus messages addressed to you (untrusted data). Returns each message once; replay:n re-shows the last n already-read messages.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        reader: { type: 'string', description: 'your agent id inside this session (default main)' },
        replay: { type: 'integer', minimum: 1, maximum: 100 },
        maxChars: { type: 'integer', minimum: 200, maximum: 100000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'bus_publish',
    description: 'Publish a message on a bus topic. It never starts anyone\'s turn: the recipients read it at their next tool call.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        kind: { type: 'string', enum: ['note', 'question', 'answer', 'contract.changed', 'finding', 'status', 'direction'] },
        text: { type: 'string' },
        data: { type: 'object' },
        replyTo: { type: 'string' },
        reader: { type: 'string' },
      },
      required: ['topic', 'kind', 'text'],
    },
  },
];

function parseArgs(argv) {
  const o = { db: null, prefix: null, session: null, topics: [], startMark: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--db') { o.db = v; i++; }
    else if (argv[i] === '--consumer-prefix') { o.prefix = v; i++; }
    else if (argv[i] === '--session') { o.session = v; i++; }
    else if (argv[i] === '--topics') { o.topics = String(v ?? '').split(',').filter(Boolean); i++; }
    else if (argv[i] === '--start-mark') { o.startMark = v; i++; }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
let bus = null;
const getBus = () => (bus ??= createSqliteBus({ path: opts.db }));

class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const toolError = (code, message) => ({ isError: true, content: [{ type: 'text', text: `${code}: ${message}` }] });
const intArg = (v, dflt, min, max) => {
  if (v === undefined) return dflt;
  if (!Number.isInteger(v) || v < min || v > max) throw new ToolError('BUS_BAD_ENVELOPE', `expected an integer ${min}..${max}`);
  return v;
};

function identity(reader) {
  const r = reader ?? 'main';
  const id = consumerFromPayload({ session_id: opts.session, agent_id: r === 'main' ? undefined : r }, opts.prefix);
  if (!id.ok) throw new ToolError(id.code, id.message);
  return id;
}

function busRead(args) {
  const id = identity(args.reader);
  const patterns = [...new Set([...opts.topics, id.ownTopic])];
  const self = { sessionId: id.sessionId, agentKey: id.agentKey };
  const maxChars = intArg(args.maxChars, 8000, 200, 100000);
  if (args.replay !== undefined) {
    const n = intArg(args.replay, 1, 1, 100);
    const rows = getBus().replay(id.consumer, patterns, n);
    const r = renderMailbox(rows, { maxChars });
    return { content: [{ type: 'text', text: r.text || 'bus: nothing to replay' }], structuredContent: { ids: rows.map((e) => e.id), more: 0, replay: true } };
  }
  const res = getBus().readRenderAck(id.consumer, patterns, {
    limit: intArg(args.limit, 100, 1, 100),
    startMark: opts.startMark ?? undefined,
    self,
    claim: id.agentKey === 'main' ? null : { sessionKey: id.sessionKey, topicKey: id.topicKey, agentId: id.agentKey },
    render: (envs, meta) => renderMailbox(envs, { maxChars, limitHit: meta.limitHit }),
  });
  return {
    content: [{ type: 'text', text: res.text || 'bus: no new messages' }],
    structuredContent: { ids: res.shown.map((e) => e.id), more: res.more },
  };
}

function busPublish(args) {
  const id = identity(args.reader);
  const draft = { topic: args.topic, kind: args.kind, body: { text: args.text } };
  if (args.data !== undefined) draft.body.data = args.data;
  if (args.replyTo !== undefined) draft.replyTo = args.replyTo;
  const r = getBus().publish(draft, { from: { kind: 'agent', id: id.sessionId, sub: id.agentKey } });
  return { content: [{ type: 'text', text: `published ${r.id} (seq ${r.seq}${r.duplicate ? ', duplicate' : ''})` }], structuredContent: r };
}

function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'worca-bus-mailbox', version: '0.0.0-spike' },
    });
  }
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (args === null || typeof args !== 'object' || Array.isArray(args)) return fail(-32602, 'arguments must be an object');
    const fn = name === 'bus_read' ? busRead : name === 'bus_publish' ? busPublish : null;
    if (!fn) return fail(-32602, `unknown tool ${name}`);
    try {
      return reply(fn(args));
    } catch (e) {
      return reply(toolError(e?.code ?? 'BUS_ERROR', String(e?.message ?? e)));
    }
  }
  if (method === 'ping') return reply({});
  return fail(-32601, `unknown method ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // a notification
  process.stdout.write(JSON.stringify(handle(msg)) + '\n');
});
rl.on('close', () => {
  try { bus?.close(); } catch { /* closing */ }
  process.exit(0);
});
