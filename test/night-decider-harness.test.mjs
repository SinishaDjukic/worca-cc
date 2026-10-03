// test/night-decider-harness.test.mjs — the run harness hands the nightDecider the RESOLVED model and
// effort (Settings › Away mode › Decided by / Effort), routes and prices it as that model, and names it
// on the decision record and the "Night decider" sub-agent row. A model that cannot run falls back to
// the run's model with ONE run-log line. Sandboxes HOME (settings.json) + WORCA_HOME + the catalog
// test-guard opt-in (WORCA_TEST_ALLOW_HOME_FALLBACK), like model-cost-override-surfaces.test.mjs.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNightMode, setNightModeToggle, addGlobalModel } from '../src/core/settings.mjs';

useTempHome(after);                                  // sqlite under WORCA_HOME
let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-night-dm-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';    // the catalog reads the sandboxed settings.json
  // A global model on its own endpoint that prices at $0: proves env AND cost follow the decider model.
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});
beforeEach(async () => { await setNightMode(null); await setNightModeToggle('auto'); });

function fakeClock(start = Date.parse('2026-09-27T12:00:00Z')) {
  let t = start; let seq = 0; const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async tick(ms) {
      t += ms;
      for (const [id, tm] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (tm.at <= t) { timers.delete(id); tm.fn(); }
      await new Promise((r) => setImmediate(r));
    },
  };
}
async function settle(clock, done) {
  for (const end = Date.now() + 5000; !done() && Date.now() < end;) {
    await clock.tick(0);
    if (!done()) await new Promise((r) => setTimeout(r, 2));
  }
}
const QA = [{ id: 'a', question: 'A?', options: ['x', 'y'] }];
/** A nightDecider spawn that records what it was handed and reports $0.05. */
function recordingRun() {
  const seen = [];
  const run = async (o) => {
    seen.push(o);
    // The engine adapters emit the normalized vocabulary (claude-events.mjs): a result carries its own usage.
    o.onEvent({ type: 'result', text: '', costUsd: 0.05, isError: false, usage: { input_tokens: 3, output_tokens: 2 } });
    return { text: '{"decisions":[{"id":"a","choice":"y","confidence":90,"rationale":"fits","reversible":true,"scores":{}}]}' };
  };
  return { run, seen };
}
async function answerOne(orch, clock, id) {
  const p = orch._ask({ id, kind: 'clarify', questions: QA });
  await settle(clock, () => !orch.pendingQuestion);
  return p;
}
const deciderRows = (orch) => orch.state.subAgents.filter((s) => s.subagentType === 'night-decider');

test('a configured Decided by model runs the review: its model, effort and env, its price, named on the record and the row', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'onprem', deciderEffort: 'high' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm1', nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const booked = [];
  orch._recordCost = (usd) => booked.push(usd);
  assert.deepEqual(await answerOne(orch, clock, 'c1'), { answers: [{ id: 'a', choice: 'y' }] });
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].model, seen[0].effort], ['onprem', 'high']);
  assert.equal(seen[0].modelEnv?.ANTHROPIC_BASE_URL, 'https://p', 'the decider model\'s routing env, not the run model\'s');
  assert.deepEqual(booked, [0], 'priced as the decider model ({free}), not the CLI\'s $0.05');
  const rec = orch.nightDecision('c1');
  assert.deepEqual([rec.model, rec.effort, rec.strategy], ['onprem', 'high', 'analysis']);
  assert.deepEqual(deciderRows(orch).map((s) => [s.runModel, s.effort, s.costUsd]), [['onprem', 'high', 0]]);
});

test('unset → the run\'s model at medium, priced as the CLI says; no run model → the CLI default (null)', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  for (const [claude, want] of [[{ model: 'claude-sonnet-5-5' }, 'claude-sonnet-5-5'], [undefined, null]]) {
    const clock = fakeClock();
    const { run, seen } = recordingRun();
    const orch = createOrchestrator({ projectDir: '/tmp/night-dm2', nightClock: clock, nightRunClaude: run, ...(claude ? { claude } : {}) });
    const booked = [];
    orch._recordCost = (usd) => booked.push(usd);
    await answerOne(orch, clock, 'c2');
    assert.deepEqual([seen[0].model, seen[0].effort], [want, 'medium']);
    assert.deepEqual(booked, [0.05]);
    assert.deepEqual([orch.nightDecision('c2').model, orch.nightDecision('c2').effort], [want, 'medium']);
    assert.equal(deciderRows(orch)[0].runModel, want);
  }
});

test('a stale Decided by model never fails the run: the run\'s model instead, and ONE run-log line naming both', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'gone-model' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm3', nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const logged = [];
  orch._log = (source, level, text) => logged.push({ source, level, text });
  await answerOne(orch, clock, 'c3a');
  await answerOne(orch, clock, 'c3b');
  assert.deepEqual(seen.map((o) => o.model), ['claude-sonnet-5-5', 'claude-sonnet-5-5']);
  const lines = logged.filter((l) => l.text.includes('gone-model'));
  assert.equal(lines.length, 1, JSON.stringify(logged));
  assert.equal(lines[0].level, 'warn');
  assert.match(lines[0].text, /"gone-model".*not in the model catalog.*"claude-sonnet-5-5" instead/);
  assert.equal(orch.nightDecision('c3b').model, 'claude-sonnet-5-5');
  assert.equal(orch.nightDecision('c3b').flagged, false, 'the answer itself is not flagged by the fallback');
});

test('an effort the decider model does not offer runs at medium, with one run-log line', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'claude-haiku-4-5', deciderEffort: 'max' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm4', nightClock: clock, nightRunClaude: run });
  const logged = [];
  orch._log = (source, level, text) => logged.push({ source, level, text });
  await answerOne(orch, clock, 'c4a');
  await answerOne(orch, clock, 'c4b');
  assert.deepEqual(seen.map((o) => [o.model, o.effort]), [['claude-haiku-4-5', 'medium'], ['claude-haiku-4-5', 'medium']]);
  assert.equal(logged.filter((l) => /does not offer effort "max"/.test(l.text)).length, 1, JSON.stringify(logged));
});

test('the agent\'s own answer (weights) never runs the review: no model on its record', async () => {
  await setNightMode({ enabled: true, strategy: 'weights', graceMinutes: 1, deciderModel: 'onprem' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm5', nightClock: clock, nightRunClaude: run });
  const p = orch._ask({ id: 'c5', kind: 'clarify', questions: [{ id: 'a', question: 'A?', options: ['x', 'y'], confidence: [90, 10], recommended: 'x' }] });
  await settle(clock, () => !orch.pendingQuestion);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(seen.length, 0);
  assert.equal('model' in orch.nightDecision('c5'), false);
  assert.equal(deciderRows(orch).length, 0);
});

test('mock mode is unchanged: no spawn, the recommended-else-first answer, $0', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'onprem', deciderEffort: 'max' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm6', nightClock: clock, nightRunClaude: run, claude: { mock: true } });
  const booked = [];
  orch._recordCost = (usd) => booked.push(usd);
  assert.deepEqual(await answerOne(orch, clock, 'c6'), { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(seen.length, 0, 'the mock branch never spawns');
  assert.deepEqual(booked, [0]);
});

test('a Codex run: the decider runs on Codex — a Codex Decided by pick is used, read-only, with the file tools over the checkout', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'gpt-5.5' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm-codex', nightClock: clock, nightRunClaude: run, claude: { model: 'gpt-5.6-sol', engine: 'codex' } });
  await answerOne(orch, clock, 'cx1');
  assert.equal(seen[0].model, 'gpt-5.5');
  assert.equal(seen[0].engine, 'codex');
  assert.equal(seen[0].sandbox, 'read-only');
  assert.equal(seen[0].modelEnv, undefined, 'no Claude routing env');
  assert.ok(seen[0].mcpConfigPath, 'its repo look is worca\'s read_file/grep/glob');
  assert.match(seen[0].systemPrompt, /read_file, grep and glob/);
});

test('a Codex run: a Claude Decided by pick reads as stale, and the run\'s Codex model weighs the options', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'claude-sonnet-5' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm-codex2', nightClock: clock, nightRunClaude: run, claude: { model: 'gpt-5.6-sol', engine: 'codex' } });
  await answerOne(orch, clock, 'cx2');
  assert.equal(seen[0].model, 'gpt-5.6-sol');
  assert.equal(seen[0].engine, 'codex');
});
