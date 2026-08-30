// test/model-cost-override-surfaces.test.mjs
// The per-model cost override (config.mjs) at every surface that books spend,
// plus the invariants that keep it from misfiring:
//   1. ONLY a cost-bearing `result` event may be re-priced. Every stream frame
//      reaches the orchestrator's intake, and a {free} override answers $0 for
//      any input — resolving unconditionally would book a real $0 per FRAME
//      (each one a writeState + a 'state' broadcast) instead of once per node.
//   2. A {perMtok} model is priced from tokens alone, so a result with NO usage
//      is unpriceable and must be reported, never silently booked at $0.
//   3. Ask Worca spend feeds the SAME windowed budget as pipeline spend
//      (cost-budget.mjs combinedWindowedSpendUsd), so it must be re-priced too.
//   4. The overview agent's sub-agent row is priced like any pipeline node.
// Sandboxes HOME (settingsFile lives under it) + WORCA_HOME + the catalog
// test-guard opt-in, exactly like model-cost-override.test.mjs.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addGlobalModel } from '../src/core/settings.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage, getThread } from '../src/core/ask/store.mjs';
import { generateOverview } from '../src/core/overview-agent.mjs';
import { persistResults, persistDiffPatch } from '../src/core/results.mjs';
import { listSubAgents } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
let home;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-mcos-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-mcos-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const USAGE = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
const FRAME = (i) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { id: `m${i}`, content: [{ type: 'text', text: `chunk ${i}` }] } },
});

/** An orchestrator parked mid-'plan', counting every state broadcast. */
function pausedOrch(name) {
  const orch = createOrchestrator({ projectDir: join(tmpdir(), name) });
  orch._phase('plan', 0, 'start');
  const seen = { states: 0, warns: [] };
  orch.on('state', () => { seen.states += 1; });
  const log = orch._log.bind(orch);
  orch._log = (role, level, msg, attr) => { if (level === 'warn') seen.warns.push(msg); return log(role, level, msg, attr); };
  return { orch, seen };
}

// ── 1. non-result frames are never re-priced ──────────────────────────────────

test('orchestrator: an override never turns a NON-result frame into a booked $0', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const { orch, seen } = pausedOrch('mcos-frames');
  for (let i = 0; i < 25; i++) orch._onAgentEvent('planner', FRAME(i), { model: 'onprem', stepKey: 'plan' });

  const step = orch.getState().steps.find((s) => s.key === 'plan');
  assert.equal(step.costUsd, undefined, 'no result yet -> the step carries no cost figure at all');
  assert.equal(seen.states, 0,
    'not one state broadcast: _recordCost (writeState + broadcast) must fire once per NODE, never per frame');

  // The terminal result IS re-priced — the whole point of the feature.
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0.4625, raw: { type: 'result', total_cost_usd: 0.4625, usage: USAGE } },
    { model: 'onprem', stepKey: 'plan' });
  assert.equal(orch.getState().totalCostUsd, 0, 'the fabricated 0.4625 is discarded');
  assert.equal(seen.states, 1, 'exactly one broadcast, from the result');
});

test('orchestrator: a {perMtok} override is likewise inert on non-result frames', async () => {
  await addGlobalModel({ id: 'priced', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { perMtok: { input: 1 } } });
  const { orch, seen } = pausedOrch('mcos-frames2');
  for (let i = 0; i < 25; i++) orch._onAgentEvent('planner', FRAME(i), { model: 'priced', stepKey: 'plan' });
  assert.equal(seen.states, 0);
  assert.equal(orch.getState().steps.find((s) => s.key === 'plan').costUsd, undefined);
});

// ── 2. {perMtok} with nothing to price on ─────────────────────────────────────

test('orchestrator: {perMtok} + a result with NO usage is reported, not silently booked at $0', async () => {
  await addGlobalModel({ id: 'priced', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { perMtok: { input: 1, output: 3 } } });
  const { orch, seen } = pausedOrch('mcos-nousage');
  orch.claude.mock = false;
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0.4625, raw: { type: 'result', total_cost_usd: 0.4625 } },
    { model: 'priced', stepKey: 'plan' });

  assert.equal(orch.getState().steps.find((s) => s.key === 'plan').costUsd, undefined,
    'unpriceable -> nothing booked (and certainly not the CLI figure it was told to ignore)');
  assert.equal(orch.getState().totalCostUsd, 0);
  assert.ok(seen.warns.some((w) => /priced per-Mtok but the result carried no token usage/.test(w)),
    `the operator is told their priced model went unaccounted; saw: ${JSON.stringify(seen.warns)}`);
});

test('orchestrator: {perMtok} + a usage object of genuine ZEROES prices at $0 (it IS priceable)', async () => {
  await addGlobalModel({ id: 'priced', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { perMtok: { input: 1, output: 3 } } });
  const { orch, seen } = pausedOrch('mcos-zerousage');
  orch.claude.mock = false;
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0.4625, raw: { type: 'result', total_cost_usd: 0.4625, usage: { input_tokens: 0, output_tokens: 0 } } },
    { model: 'priced', stepKey: 'plan' });
  assert.equal(orch.getState().steps.find((s) => s.key === 'plan').costUsd, 0, 'zero tokens is a price, not a gap');
  assert.equal(seen.warns.length, 0, 'and no warning — nothing went unaccounted');
});

// ── 3. sub-agent attribution ──────────────────────────────────────────────────

const spawnFrame = (id, input = {}) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { description: 'd', ...input } }] } },
});
const hookFrame = (id, costUsd) => ({
  type: 'hook-event',
  raw: {
    type: 'hook-event', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: id,
    tool_response: { totalDurationMs: 100, totalTokens: 10, usage: { cost_usd: costUsd, input_tokens: 1_000_000 } },
  },
});

test('sub-agent: inherits the PARENT node\'s price — the child shares its endpoint', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const { orch } = pausedOrch('mcos-sub1');
  const attr = { model: 'onprem', stepKey: 'plan', nodeId: 'n', stepIndex: 0, cycle: 1 };
  orch._onAgentEvent('planner', spawnFrame('toolu_A'), attr);
  orch._onAgentEvent('planner', hookFrame('toolu_A', 0.012), attr);
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').costUsd, 0);
});

test('sub-agent: a bare Task `model` alias with no catalog entry keeps the parent\'s override', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const { orch } = pausedOrch('mcos-sub2');
  const attr = { model: 'onprem', stepKey: 'plan', nodeId: 'n', stepIndex: 0, cycle: 1 };
  orch._onAgentEvent('planner', spawnFrame('toolu_B', { model: 'haiku' }), attr);
  orch._onAgentEvent('planner', hookFrame('toolu_B', 0.012), attr);
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').costUsd, 0,
    "'haiku' resolves to nothing — falling back to the CLI figure would re-inflate a free endpoint");
});

test('sub-agent: a Task `model` that carries its OWN override is priced by it', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  await addGlobalModel({ id: 'sidecar', cost: { perMtok: { input: 2 } } });
  const { orch } = pausedOrch('mcos-sub3');
  const attr = { model: 'onprem', stepKey: 'plan', nodeId: 'n', stepIndex: 0, cycle: 1 };
  orch._onAgentEvent('planner', spawnFrame('toolu_C', { model: 'sidecar' }), attr);
  orch._onAgentEvent('planner', hookFrame('toolu_C', 0.012), attr);
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_C').costUsd, 2, '1M input @ $2/Mtok');
});

test('sub-agent: an unpriceable {perMtok} child leaves the row\'s cost UNSET, not fabricated', async () => {
  await addGlobalModel({ id: 'priced', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { perMtok: { input: 2 } } });
  const { orch } = pausedOrch('mcos-sub4');
  const attr = { model: 'priced', stepKey: 'plan', nodeId: 'n', stepIndex: 0, cycle: 1 };
  orch._onAgentEvent('planner', spawnFrame('toolu_D'), attr);
  orch._onAgentEvent('planner', {
    type: 'hook-event',
    raw: {
      type: 'hook-event', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_D',
      tool_response: { totalDurationMs: 100, totalTokens: 10, cost_usd: 0.012 }, // cost, but no usage
    },
  }, attr);
  const rec = orch.state.subAgents.find((s) => s.id === 'toolu_D');
  assert.equal(rec.costUsd, undefined);
  assert.equal(rec.durationMs, 100, 'the rest of the telemetry still lands');
});

// ── 4. Ask Worca ──────────────────────────────────────────────────────────────

const ASK_RESULT = (over = {}) => ({
  type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.4625,
  usage: { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: {}, duration_ms: 40, num_turns: 1, session_id: 'sess-1', permission_denials: [], ...over,
});

function askTurn(model, runClaudeImpl) {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello there' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  const frames = [];
  const turn = createAskTurn({
    threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id,
    prompt: 'P', systemPrompt: 'SYS', restoredPrompt: 'R',
    model, effort: 'high',
    resumeSessionId: null, firstTurn: false, firstText: 'hello there', deterministicTitle: null,
    mock: null, attachmentNames: {},
    deps: { onFrame: (f) => frames.push(f), generateTitle: async () => '', runClaudeImpl },
  });
  return { turn, frames, thread, asst };
}

const askLedger = () => getDb().prepare('SELECT amount_usd FROM ask_cost_ledger ORDER BY id').all();

test('ask: a {free} model books $0 in the row, the thread totals, the budget ledger AND the frame', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const { turn, frames, thread, asst } = askTurn('onprem', async (opts) => {
    opts.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null } });
    opts.onEvent({ type: 'result', raw: ASK_RESULT() });
    return { text: 'hi', exitCode: 0 };
  });
  assert.equal((await turn.run()).status, 'done');

  assert.equal(getMessage(asst.id).costUsd, 0, 'message row');
  assert.equal(getThread(thread.id).totals.costUsd, 0, 'thread totals');
  assert.deepEqual(askLedger(), [], 'ledger: a $0 turn leaves no row, so the windowed budget sees nothing');
  assert.equal(frames.at(-1).costUsd, 0, 'ask-done frame');
  // The live frames never showed the fabricated figure either.
  assert.ok(frames.filter((f) => f.type === 'ask-usage').every((f) => f.costUsd === 0 || f.costUsd === null),
    'no ask-usage frame leaked the CLI figure');
});

test('ask: a {perMtok} model books the recomputed cost into the budget ledger', async () => {
  await addGlobalModel({ id: 'priced', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { perMtok: { input: 1, output: 3 } } });
  const { turn, frames, thread, asst } = askTurn('priced', async (opts) => {
    opts.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null } });
    opts.onEvent({ type: 'result', raw: ASK_RESULT() });
    return { text: 'hi', exitCode: 0 };
  });
  await turn.run();
  assert.equal(getMessage(asst.id).costUsd, 4, '1M input@1 + 1M output@3, not the CLI 0.4625');
  assert.equal(getThread(thread.id).totals.costUsd, 4);
  assert.deepEqual(askLedger().map((r) => r.amount_usd), [4]);
  assert.equal(frames.at(-1).costUsd, 4);
});

test('ask: with NO override the CLI figure stands unchanged (default behavior)', async () => {
  await addGlobalModel({ id: 'plain', env: { ANTHROPIC_BASE_URL: 'https://p' } });
  const { turn, thread, asst } = askTurn('plain', async (opts) => {
    opts.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null } });
    opts.onEvent({ type: 'result', raw: ASK_RESULT() });
    return { text: 'hi', exitCode: 0 };
  });
  await turn.run();
  assert.equal(getMessage(asst.id).costUsd, 0.4625);
  assert.equal(getThread(thread.id).totals.costUsd, 0.4625);
  assert.deepEqual(askLedger().map((r) => r.amount_usd), [0.4625]);
});

test('ask: §6.2.8 — no `result` frame still means costUsd NULL, an override does not forge a $0', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const { turn, frames, asst } = askTurn('onprem', async (opts) => {
    opts.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null } });
    return { text: 'hi', exitCode: 0 };   // no result event at all
  });
  await turn.run();
  assert.equal(getMessage(asst.id).costUsd, null, 'null means "no cost observed" — not a price to re-price');
  assert.equal(frames.at(-1).costUsd, null);
  assert.deepEqual(askLedger(), []);
});

test('ask: a {free} turn\'s sub-agent rows are scaled to $0 too (agents never out-total their turn)', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const AGENT_TUR = {
    status: 'completed', agentId: 'a1', agentType: 'general-purpose', model: 'onprem',
    totalDurationMs: 1000, totalTokens: 4139,
    usage: { input_tokens: 4016, output_tokens: 123, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const { turn, asst } = askTurn('onprem', async (opts) => {
    opts.onEvent({ type: 'assistant', raw: { type: 'assistant', parent_tool_use_id: null, session_id: 'sess-1',
      message: { id: 'm1', role: 'assistant', content: [
        { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'general-purpose', description: 'dig', prompt: 'P' } }] } } });
    opts.onEvent({ type: 'user', raw: { type: 'user', parent_tool_use_id: null, session_id: 'sess-1',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'ok' }] }] },
      tool_use_result: AGENT_TUR } });
    opts.onEvent({ type: 'result', raw: ASK_RESULT({
      modelUsage: { onprem: { inputTokens: 8032, outputTokens: 246, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.4625 } },
    }) });
    return { text: 'done', exitCode: 0 };
  });
  await turn.run();
  const agents = (getMessage(asst.id).blocks || []).filter((b) => b.kind === 'agent');
  assert.equal(agents.length, 1, 'the sub-agent block is there to price');
  assert.equal(agents[0].costUsd, 0,
    'the §6.6 share rides the override — a $0 turn cannot contain a billing agent');
  assert.equal(getMessage(asst.id).costUsd, 0);
});

// ── 5. the overview agent ─────────────────────────────────────────────────────

test('overview agent: its sub-agent row is priced by the override, like any pipeline node', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const { id, dir, key } = await seedPipeline(join(home, 'proj'));
  await mkdir(dir, { recursive: true });
  await persistResults(dir, { summary: { filesNew: 1 } });
  await persistDiffPatch(dir, 'diff --git a/x b/x\n+hi');

  await generateOverview(key, id, {
    model: 'onprem',
    runClaudeImpl: async (opts) => {
      opts.onEvent({ type: 'result', costUsd: 0.4625, raw: { type: 'result', total_cost_usd: 0.4625, usage: USAGE } });
      return { text: '{"narrative":"did x","diffFindings":[],"diffCheckTruncated":false}' };
    },
  });
  const row = listSubAgents(id).find((s) => s.id === `overview-${id}`);
  assert.ok(row, 'the overview run is recorded as a sub-agent');
  assert.equal(row.costUsd, 0, 'the CLI\'s by-name 0.4625 is discarded');
});
