// P1/T17: replay the CAPTURED fixtures (test/fixtures/ask/*.jsonl, real claude
// 2.1.239 output, sanitised) through the reducer and assert STRUCTURE only —
// ids, tokens and timings vary between captures and are never asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTurnReducer, normalizeUsage } from '../src/core/ask/events.mjs';

const DIR = fileURLToPath(new URL('./fixtures/ask/', import.meta.url));
const FRAME_TYPES = new Set(['ask-label', 'ask-delta', 'ask-block', 'ask-card', 'ask-usage']);

function load(name) {
  const frames = readFileSync(join(DIR, `${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = JSON.parse(readFileSync(join(DIR, `${name}.meta.json`), 'utf8'));
  return { frames, meta };
}
function replay(name, opts = {}) {
  const { frames, meta } = load(name);
  const out = [];
  const proposals = [];
  const r = createTurnReducer({ onFrame: (f) => out.push(f), onProposal: (p) => proposals.push(p), setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {}, ...opts });
  const init = frames.find((f) => f.type === 'system' && f.subtype === 'init');
  if (init) r.push({ type: 'session', sessionId: init.session_id });
  for (const raw of frames) r.push({ type: raw.type, raw });
  return { frames, meta, out, proposals, summary: r.finish(), init, result: [...frames].reverse().find((f) => f.type === 'result') };
}
/** Main-stream assistant text the way the reducer joins it: blocks of one message concatenated, messages joined by a blank line. */
const mainText = (frames) => {
  const byMsg = new Map();
  for (const f of frames) {
    if (f.type !== 'assistant' || (f.parent_tool_use_id ?? null) !== null) continue;
    const id = f.message?.id ?? '?';
    const texts = (f.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text);
    byMsg.set(id, (byMsg.get(id) ?? '') + texts.join(''));
  }
  return [...byMsg.values()].filter(Boolean).join('\n\n');
};

test('fixture set present and sanitised', () => {
  assert.ok(existsSync(DIR), 'run `npm run ask:fixtures` (Task 17) — the fixture directory is missing');
  const names = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, '')).sort();
  assert.deepEqual(names, ['bogus-resume', 'max-budget', 'max-turns', 'plain-text', 'propose-run', 'task-subagent', 'tool-list-runs']);
  for (const n of names) {
    const text = readFileSync(join(DIR, `${n}.jsonl`), 'utf8');
    assert.ok(!text.includes(process.env.HOME ?? '/nonexistent-home'), `${n}: home path leaked`);
    assert.ok(!/\/Users\/[a-z]/.test(text) && !/\/home\/[a-z]/.test(text), `${n}: user path leaked`);
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
    assert.ok(uuids.every((u) => /^00000000-0000-4000-8000-\d{12}$/.test(u) || u === '00000000-0000-0000-0000-000000000000'), `${n}: a real uuid leaked`);
    assert.ok(!/sk-ant-api/.test(text), `${n}: secret leaked`);
  }
});

test('every replay: only known frame types, no reducer errors, session id from init', () => {
  for (const name of ['plain-text', 'tool-list-runs', 'task-subagent', 'propose-run', 'max-turns', 'max-budget']) {
    const r = replay(name);
    assert.ok(r.out.every((f) => FRAME_TYPES.has(f.type)), `${name}: frame types`);
    assert.equal(r.summary.reducerErrors, 0, `${name}: reducer errors`);
    assert.equal(r.summary.sessionId, r.init.session_id, `${name}: session id`);
    assert.equal(r.summary.sawInit, true);
    assert.equal(r.out[0].type, 'ask-label');
    assert.equal(r.out[0].label, 'Thinking');
  }
});

test('plain-text: text equals the assistant blocks, usage/cost equal the result frame, no blocks', () => {
  const r = replay('plain-text');
  assert.equal(r.summary.text, mainText(r.frames));
  assert.ok(r.summary.text.length > 0);
  assert.deepEqual(r.summary.blocks, []);
  assert.deepEqual(r.summary.usage, normalizeUsage(r.result.usage));
  assert.equal(r.summary.costUsd, r.result.total_cost_usd);
  assert.equal(r.summary.status, 'done');
  assert.equal(r.summary.sawAssistant, true);
  const deltas = r.out.filter((f) => f.type === 'ask-delta').map((f) => f.text).join('');
  assert.ok(deltas.length > 0, 'text deltas streamed (--include-partial-messages)');
  assert.ok(r.out.some((f) => f.type === 'ask-usage' && f.costUsd === r.result.total_cost_usd));
});

test('tool-list-runs: one tool block, running then done, input from the fixture, label', () => {
  const r = replay('tool-list-runs');
  const tools = r.summary.blocks.filter((b) => b.kind === 'tool');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'mcp__worca__list_runs');
  assert.equal(tools[0].status, 'done');
  assert.ok(tools[0].durationMs >= 0);
  const use = r.frames.flatMap((f) => (f.type === 'assistant' && (f.parent_tool_use_id ?? null) === null ? f.message.content : [])).find((c) => c.type === 'tool_use');
  assert.deepEqual(tools[0].input, use.input);
  const blockFrames = r.out.filter((f) => f.type === 'ask-block' && f.block.id === tools[0].id).map((f) => f.block.status);
  assert.deepEqual(blockFrames, ['running', 'done']);
  assert.ok(r.summary.labels.includes('Finding runs'));
  assert.ok(r.summary.labels.indexOf('Finding runs') < r.summary.labels.lastIndexOf('Writing'), 'Writing after the tool');
});

test('task-subagent (foreground, probe F3): one agent block with model, tokens, usage, child log; prompt never stored; cost estimated', () => {
  const r = replay('task-subagent');
  const agents = r.summary.blocks.filter((b) => b.kind === 'agent');
  assert.equal(agents.length, 1);
  const a = agents[0];
  assert.equal(a.status, 'done');
  assert.equal(typeof a.model, 'string');
  assert.ok(a.tokens > 0);
  assert.ok(a.usage && a.usage.input >= 0 && a.usage.output > 0);
  assert.ok(a.durationMs > 0);
  assert.ok(a.log.length >= 2, 'a child tool call and its result');
  assert.ok(a.log.some((l) => l.text.startsWith('→ ')) && a.log.some((l) => l.text.startsWith('← ')), 'child call + result lines (parallel calls may interleave)');
  assert.equal(a.estimated, true);
  assert.ok(a.costUsd > 0 && a.costUsd < r.result.total_cost_usd, `estimated from modelUsage (got ${a.costUsd})`);
  assert.equal(r.summary.text, mainText(r.frames), 'the answer is the MAIN stream text only');
  assert.ok(!JSON.stringify(r.summary.blocks).includes('CAPTURE-SECRET-7f3a'), 'the Task prompt is never persisted');
  assert.ok(r.summary.labels.includes('Running 1 sub-agent'));
  assert.equal(r.summary.agents, 1);
  assert.equal(r.frames.filter((f) => f.type === 'result').length, 1, 'foreground mode: one result');
});

test('propose-run: the tool block and the proposal hook with the full input', () => {
  const r = replay('propose-run');
  const p = r.summary.blocks.find((b) => b.kind === 'tool' && b.name === 'mcp__worca__propose_run');
  assert.ok(p);
  assert.equal(p.status, 'done');
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].childOk, true);
  assert.equal(r.proposals[0].input.workflowId, 'wf_default');
  assert.equal(r.proposals[0].input.guardrailsId, 'normal');
  assert.match(r.proposals[0].input.projectKey, /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/);
  assert.ok(r.summary.labels.includes('Preparing a run'));
});

test('max-turns / max-budget (probe F5): stopped with the reason; the capture recorded exit code 1', () => {
  for (const [name, reason] of [['max-turns', 'max_turns'], ['max-budget', 'max_budget']]) {
    const r = replay(name);
    assert.equal(r.summary.status, 'stopped', name);
    assert.equal(r.summary.reason, reason, name);
    assert.equal(r.summary.isError, true);
    assert.ok(r.summary.errors.length >= 1);
    assert.equal(r.meta.exitCode, 1, `${name}: the CLI exits 1 on this subtype`);
    assert.ok(r.meta.error, 'the runner rejected');
  }
});

test('bogus-resume (probe F9): no assistant, a result with the error, $0, exit 1', () => {
  const r = replay('bogus-resume');
  assert.equal(r.summary.sawAssistant, false);
  assert.equal(r.summary.sawResult, true);
  assert.equal(r.summary.costUsd, 0);
  assert.equal(r.summary.resultSubtype, 'error_during_execution');
  assert.match(r.summary.errors.join(' '), /No conversation found/);
  assert.equal(r.meta.exitCode, 1);
  assert.match(r.meta.error, /No conversation found/);
});
