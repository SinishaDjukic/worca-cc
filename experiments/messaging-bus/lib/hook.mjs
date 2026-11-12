#!/usr/bin/env node
// experiments/messaging-bus/lib/hook.mjs — the Claude PostToolUse mailbox hook (plan §3.4, §4.1).
//   node lib/hook.mjs --db <p> --consumer-prefix <c> --topics <a,b> [--start-mark <name>] [--max-chars <n>]
// Reads the hook payload from stdin, derives the consumer from session_id/agent_id, and in ONE
// transaction reads, renders and acks only the shown prefix. Prints
// {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":…}} when something is
// shown and NOTHING otherwise. Every error prints nothing, acks nothing, exits 0 and writes one
// stderr line starting with its code: a broken mailbox never blocks a tool call.
//
// --detect (plan §3.3, §4.6) adds layer 2's publish pass BEFORE the read, in its own transaction:
//   --detect --publish-topic <t> [--task-map <p> --task-id <id>] [--siblings-files <p>] [--root <dir>]
//   [--debounce-ms <n>] [--debounce-calls <n>] [--max-auto <n>]
// Any detector error rolls that transaction back and prints one BUS_DETECT_ERROR line; the read then
// runs unchanged. With --detect a PreToolUse call only snapshots (Bash) and prints nothing. Without
// --detect the behaviour and output are byte-identical to the hook before this option existed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSqliteBus } from './sqlite-bus.mjs';
import { consumerFromPayload } from './consumer-id.mjs';
import { renderMailbox } from './render.mjs';
import { openDetectState } from './detect-state.mjs';
import { runDetect, DEBOUNCE_MS, DEBOUNCE_CALLS, MAX_AUTO, AUTO_MAX_HOP } from './detector.mjs';

function parseArgs(argv) {
  const o = {
    db: null, prefix: null, topics: [], startMark: null, maxChars: 2000,
    detect: false, publishTopic: null, taskMap: null, taskId: null, siblingsFiles: null, root: null,
    debounceMs: DEBOUNCE_MS, debounceCalls: DEBOUNCE_CALLS, maxAuto: MAX_AUTO,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--db') { o.db = v; i++; }
    else if (argv[i] === '--consumer-prefix') { o.prefix = v; i++; }
    else if (argv[i] === '--topics') { o.topics = String(v ?? '').split(',').filter(Boolean); i++; }
    else if (argv[i] === '--start-mark') { o.startMark = v; i++; }
    else if (argv[i] === '--max-chars') { o.maxChars = Number(v); i++; }
    else if (argv[i] === '--detect') o.detect = true;
    else if (argv[i] === '--publish-topic') { o.publishTopic = v; i++; }
    else if (argv[i] === '--task-map') { o.taskMap = v; i++; }
    else if (argv[i] === '--task-id') { o.taskId = v; i++; }
    else if (argv[i] === '--siblings-files') { o.siblingsFiles = v; i++; }
    else if (argv[i] === '--root') { o.root = v; i++; }
    else if (argv[i] === '--debounce-ms') { o.debounceMs = Number(v); i++; }
    else if (argv[i] === '--debounce-calls') { o.debounceCalls = Number(v); i++; }
    else if (argv[i] === '--max-auto') { o.maxAuto = Number(v); i++; }
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

/** Layer 2's pass: detect → plan → publish → state, in ONE transaction (runDetect). */
function detectPass(o, payload, id, bus, state, scope) {
  if (!o.publishTopic) throw new HookError('BUS_USAGE', '--detect needs --publish-topic');
  const root = o.root ?? payload.cwd ?? process.cwd();
  const taskMap = o.taskMap ? JSON.parse(readFileSync(o.taskMap, 'utf8')) : null;
  const siblingsFiles = o.siblingsFiles
    ? new Set(JSON.parse(readFileSync(o.siblingsFiles, 'utf8')))
    : new Set(Object.entries(taskMap?.tasks ?? {}).filter(([tid]) => tid !== o.taskId).flatMap(([, t]) => t.files ?? []));
  const ctx = {
    root, taskId: o.taskId, taskMap, siblingsFiles,
    readFile: (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; } },
    git: (args) => {
      try {
        return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 });
      } catch { return null; }
    },
  };
  const call = {
    event: payload.hook_event_name ?? 'PostToolUse', tool: payload.tool_name, input: payload.tool_input,
    response: payload.tool_response, cwd: payload.cwd ?? root, toolUseId: payload.tool_use_id ?? null,
  };
  const opts = { topic: o.publishTopic, now: Date.now(), debounceMs: o.debounceMs, debounceCalls: o.debounceCalls, maxAuto: o.maxAuto, maxHop: AUTO_MAX_HOP };
  return runDetect({
    bus, state, scope, call, ctx, opts, from: { kind: 'agent', id: id.sessionId, sub: id.agentKey },
    faultAfterPublish: process.env.BUS_DETECT_FAULT_AFTER_PUBLISH === '1',
  });
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
    let state = null;
    let scope = null;
    let callNo = null;
    if (o.detect) {
      try {
        state = openDetectState(bus.db);
        scope = `${o.startMark ?? ''}|${id.consumer}`;
        const r = detectPass(o, payload, id, bus, state, scope);
        callNo = r.callNo;
        for (const line of r.lines) process.stderr.write(`${line}\n`);
      } catch (e) {
        process.stderr.write(`BUS_DETECT_ERROR ${String(e?.message ?? e).split('\n')[0]}\n`);
      }
      if ((payload.hook_event_name ?? 'PostToolUse') === 'PreToolUse') return;
    }
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
    if (o.detect && callNo !== null && state) {
      // the hop rule (§3.3 Loops) needs the newest contract.changed this consumer was SHOWN
      const cc = res.shown.filter((m) => m.kind === 'contract.changed').at(-1);
      if (cc) {
        try {
          bus.transaction(() => state.apply(scope, [{ op: 'counters', row: { lastShown: { id: cc.id, hop: cc.hop ?? 1, callNo } } }]));
        } catch (e) {
          process.stderr.write(`BUS_DETECT_ERROR ${String(e?.message ?? e).split('\n')[0]}\n`);
        }
      }
    }
  } catch (e) {
    process.stderr.write(`${e?.code ?? 'BUS_ERROR'} ${String(e?.message ?? e).split('\n')[0]}\n`);
  } finally {
    try { bus?.close(); } catch { /* closing a broken bus */ }
  }
  process.exitCode = 0;
}

main();
