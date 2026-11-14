#!/usr/bin/env node
// experiments/messaging-bus/e2-mailbox-tokens.mjs — E2 (plan §4.2): what a mailbox costs an agent.
// A scripted fake agent makes T tool calls (40, quick 10) while messages arrive on a schedule; each
// delivery mode is measured from the EXACT text that would be injected:
//   hook       — spawns lib/hook.mjs per tool call with a synthetic PostToolUse payload
//   mcp-poll   — calls bus_read through lib/mcp-mailbox.mjs on every tool call (request + response)
//   step-start — one render at the next step start (today's directions path)
// Tokens are estimated as utf8 bytes / 4 (a heuristic; no tokenizer, no API call).
//   node e2-mailbox-tokens.mjs [--quick] [--out <path>]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createSqliteBus } from './lib/sqlite-bus.mjs';
import { renderMailbox, estimateTokens } from './lib/render.mjs';
import { percentiles, hrtimeMs, round } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'lib', 'hook.mjs');
const MCP = join(HERE, 'lib', 'mcp-mailbox.mjs');
const TOPIC = 'run.r_e2.siblings';
const PREFIX = 'run.r_e2.step.impl';
const MARK = 'step:r_e2:impl:1';
const FROM = { kind: 'step', id: 'sibling', sub: null };
const ID_RE = /m_[0-9A-HJKMNP-TV-Z]{26}/g;
const bytes = (s) => Buffer.byteLength(s, 'utf8');

/** Exactly 200 ASCII chars, deterministic per message index. */
export function bodyText(i) {
  return `note ${String(i).padStart(3, '0')}: ${'the shared contract changed; check your call sites. '.repeat(5)}`.slice(0, 200);
}

function schedules(T, quick) {
  return {
    none: {},
    one: { [quick ? 5 : 10]: 1 },
    burst: { [quick ? 5 : 20]: 10 },
    steady: Object.fromEntries(Array.from({ length: Math.floor(T / 5) }, (_, i) => [(i + 1) * 5, 1])),
  };
}

function startMcp(db) {
  const c = spawn(process.execPath, [MCP, '--db', db, '--consumer-prefix', PREFIX, '--session', 'e2s', '--topics', TOPIC, '--start-mark', MARK],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let next = 0;
  createInterface({ input: c.stdout }).on('line', (line) => {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  const rpc = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { child: c, rpc, close: () => new Promise((r) => { c.once('exit', r); c.stdin.end(); }) };
}

async function runOne({ schedule, plan, mode, T, pids }) {
  const dir = mkdtempSync(join(tmpdir(), 'bus-e2-'));
  const db = join(dir, 'bus.db');
  const bus = createSqliteBus({ path: db, origin: 'h_e2' });
  bus.mark(MARK);
  const publishedAt = new Map();
  const bodies = new Map();
  let msgIndex = 0;
  const perCall = [];
  const shows = new Map();
  const delays = [];
  const hookMs = [];
  let mcp = null;
  if (mode === 'mcp-poll') {
    mcp = startMcp(db);
    pids.push(mcp.child.pid);
    await mcp.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
  }
  const record = (call, text, extraBytes = 0) => {
    const ids = text.match(ID_RE) ?? [];
    for (const id of new Set(ids)) {
      if (!publishedAt.has(id)) continue;
      shows.set(id, (shows.get(id) ?? 0) + 1);
      delays.push(call - publishedAt.get(id));
    }
    perCall.push({ call, bytes: bytes(text) + extraBytes, chars: text.length, tokens: estimateTokens(text) + Math.ceil(extraBytes / 4), ids: ids.length });
  };
  try {
    const undelivered = () => [...publishedAt.keys()].some((id) => !shows.has(id));
    for (let call = 1; call <= T + 5; call++) {
      if (call > T && (mode === 'step-start' || !undelivered())) break;
      for (let j = 0; j < (call <= T ? plan[call] ?? 0 : 0); j++) {
        const text = bodyText(msgIndex++);
        const r = bus.publish({ topic: TOPIC, kind: 'note', body: { text } }, { from: FROM });
        publishedAt.set(r.id, call);
        bodies.set(r.id, text);
      }
      if (mode === 'hook') {
        const payload = JSON.stringify({ session_id: 'e2s', tool_name: 'Bash', tool_use_id: `tu_${call}` });
        const t0 = hrtimeMs();
        const r = spawnSync(process.execPath, [HOOK, '--db', db, '--consumer-prefix', PREFIX, '--topics', TOPIC, '--start-mark', MARK], { input: payload, encoding: 'utf8' });
        hookMs.push(hrtimeMs() - t0);
        if (r.pid) pids.push(r.pid);
        const text = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
        record(call, text);
      } else if (mode === 'mcp-poll') {
        const params = { name: 'bus_read', arguments: {} };
        const res = await mcp.rpc('tools/call', params);
        const text = res.result.content[0].text;
        record(call, text, bytes(JSON.stringify(params)));
      } else if (mode === 'step-start') {
        if (call === 1) record(0, ''); // nothing is waiting when the step starts
      }
    }
    if (mode === 'step-start') {
      // the next step's start renders everything published during this one
      const envs = bus.read('e2:next-step', [TOPIC], { limit: 100, startMark: MARK });
      const r = renderMailbox(envs, { maxChars: 1_000_000 });
      record(T + 1, r.text);
    }
  } finally {
    if (mcp) await mcp.close();
    bus.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const shownTexts = [...shows.keys()];
  const totalTokens = perCall.reduce((a, c) => a + c.tokens, 0);
  const bodyTokens = shownTexts.reduce((a, id) => a + estimateTokens(bodies.get(id)) * shows.get(id), 0);
  const messagesShown = [...shows.values()].reduce((a, b) => a + b, 0);
  return {
    schedule, mode, calls: perCall.length, messages: publishedAt.size,
    totalBytes: perCall.reduce((a, c) => a + c.bytes, 0),
    totalChars: perCall.reduce((a, c) => a + c.chars, 0),
    totalTokens,
    maxBytesPerCall: perCall.reduce((a, c) => Math.max(a, c.bytes), 0),
    headerOverheadTokens: messagesShown && mode !== 'mcp-poll' ? (totalTokens - bodyTokens) / messagesShown : null,
    idsPublished: publishedAt.size,
    idsDelivered: shows.size,
    maxShowsPerId: shows.size ? Math.max(...shows.values()) : 0,
    maxDelayCalls: delays.length ? Math.max(...delays) : 0,
    hookMs,
    perCall,
  };
}

async function main(argv) {
  const quick = argv.includes('--quick');
  const i = argv.indexOf('--out');
  const outPath = i >= 0 ? argv[i + 1] : join(HERE, 'results', 'e2.json');
  const T = quick ? 10 : 40;
  const pids = [];
  const runs = [];
  const t0 = Date.now();
  for (const [schedule, plan] of Object.entries(schedules(T, quick))) {
    for (const mode of ['hook', 'mcp-poll', 'step-start']) runs.push(await runOne({ schedule, plan, mode, T, pids }));
  }
  const summary = { 'e2.calls': T, 'e2.bodyChars': 200 };
  for (const r of runs) {
    summary[`e2.${r.schedule}.${r.mode}.totalBytes`] = r.totalBytes;
    summary[`e2.${r.schedule}.${r.mode}.totalTokens`] = r.totalTokens;
    if (r.mode === 'hook' && r.headerOverheadTokens !== null) summary[`e2.${r.schedule}.hook.headerOverheadTokens`] = round(r.headerOverheadTokens, 2);
    if (r.mode !== 'mcp-poll' && r.messages) summary[`e2.${r.schedule}.${r.mode}.maxDelayCalls`] = r.maxDelayCalls;
  }
  const none = runs.find((r) => r.schedule === 'none' && r.mode === 'hook');
  summary['e2.none.hook.maxBytesPerCall'] = none.maxBytesPerCall;
  const burst = runs.find((r) => r.schedule === 'burst' && r.mode === 'hook');
  summary['e2.burst.hook.idsPublished'] = burst.idsPublished;
  summary['e2.burst.hook.idsDelivered'] = burst.idsDelivered;
  summary['e2.burst.hook.allDelivered'] = burst.idsDelivered === burst.idsPublished;
  summary['e2.burst.hook.maxShowsPerId'] = burst.maxShowsPerId;
  const hookAll = runs.filter((r) => r.mode === 'hook').flatMap((r) => r.hookMs);
  const p = percentiles(hookAll, [50, 99]);
  summary['e2.hook.p50Ms'] = round(p.p50, 2);
  summary['e2.hook.p99Ms'] = round(p.p99, 2);
  const result = {
    experiment: 'e2', quick,
    env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
    method: 'tokens = ceil(utf8 bytes / 4) of the exact injected text; mcp-poll also counts the request JSON',
    durationMs: Date.now() - t0, summary, runs: runs.map(({ hookMs, ...r }) => ({ ...r, hookMsP50: percentiles(hookMs, [50]).p50 })), pids,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
}

main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
