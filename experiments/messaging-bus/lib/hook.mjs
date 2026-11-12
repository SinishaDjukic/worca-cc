#!/usr/bin/env node
// experiments/messaging-bus/lib/hook.mjs — the Claude PostToolUse mailbox hook (plan §3.4, §4.1).
//   node lib/hook.mjs --db <p> --consumer-prefix <c> --topics <a,b> [--start-mark <name>] [--max-chars <n>]
// Reads the hook payload from stdin, derives the consumer from session_id/agent_id, and in ONE
// transaction reads, renders and acks only the shown prefix. Prints
// {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":…}} when something is
// shown and NOTHING otherwise. Every error prints nothing, acks nothing, exits 0 and writes one
// stderr line starting with its code: a broken mailbox never blocks a tool call.
import { existsSync } from 'node:fs';
import { createSqliteBus } from './sqlite-bus.mjs';
import { consumerFromPayload } from './consumer-id.mjs';
import { renderMailbox } from './render.mjs';

function parseArgs(argv) {
  const o = { db: null, prefix: null, topics: [], startMark: null, maxChars: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--db') { o.db = v; i++; }
    else if (argv[i] === '--consumer-prefix') { o.prefix = v; i++; }
    else if (argv[i] === '--topics') { o.topics = String(v ?? '').split(',').filter(Boolean); i++; }
    else if (argv[i] === '--start-mark') { o.startMark = v; i++; }
    else if (argv[i] === '--max-chars') { o.maxChars = Number(v); i++; }
  }
  return o;
}

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

class HookError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function main(argv = process.argv.slice(2)) {
  let bus = null;
  try {
    const o = parseArgs(argv);
    if (!o.db) throw new HookError('BUS_USAGE', '--db is required');
    if (!Number.isInteger(o.maxChars) || o.maxChars < 1) throw new HookError('BUS_USAGE', '--max-chars must be a positive integer');
    let payload;
    try { payload = JSON.parse(await readStdin()); } catch { throw new HookError('BUS_BAD_CONSUMER', 'hook payload is not JSON'); }
    const id = consumerFromPayload(payload, o.prefix);
    if (!id.ok) throw new HookError(id.code, id.message);
    if (!existsSync(o.db)) throw new HookError('BUS_NO_DB', `no bus database at ${o.db}`);
    bus = createSqliteBus({ path: o.db });
    const patterns = [...new Set([...o.topics, id.ownTopic])];
    const res = bus.readRenderAck(id.consumer, patterns, {
      limit: 100,
      startMark: o.startMark ?? undefined,
      self: { sessionId: id.sessionId, agentKey: id.agentKey },
      claim: id.agentKey === 'main' ? null : { sessionKey: id.sessionKey, topicKey: id.topicKey, agentId: id.agentKey },
      render: (envs, meta) => renderMailbox(envs, { maxChars: o.maxChars, limitHit: meta.limitHit }),
    });
    if (res.noMark) {
      process.stderr.write(`BUS_NO_MARK ${o.startMark ? `mark ${JSON.stringify(o.startMark)} not found` : 'no --start-mark'}; reading all retained rows\n`);
    }
    if (res.shown.length > 0) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: res.text } }));
    }
  } catch (e) {
    process.stderr.write(`${e?.code ?? 'BUS_ERROR'} ${String(e?.message ?? e).split('\n')[0]}\n`);
  } finally {
    try { bus?.close(); } catch { /* closing a broken bus */ }
  }
  process.exitCode = 0;
}

main();
