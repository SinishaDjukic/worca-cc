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
import { createPipeline } from '../src/core/artifacts.mjs';
import { prepare } from '../src/core/db.mjs';
import { readNightDecisions } from '../src/core/night/store.mjs';

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

test('a Codex run with no model: an effort codex\'s default model does not offer drops to medium, said once', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderEffort: 'max' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const { run, seen } = recordingRun();
  const orch = createOrchestrator({ projectDir: '/tmp/night-dm-codex3', nightClock: clock, nightRunClaude: run, claude: { engine: 'codex' } });
  const logged = [];
  orch._log = (source, level, text) => logged.push({ source, level, text });
  await answerOne(orch, clock, 'cx3');
  assert.equal(seen[0].model, 'gpt-5.6-sol');
  assert.equal(seen[0].effort, 'medium');
  assert.equal(logged.filter((l) => /does not offer effort "max"/.test(l.text)).length, 1, JSON.stringify(logged));
});

// ── Away mode cost visibility (T2): every review is booked as its own "away" share ─────────────
const U1200 = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
/** A review that streams ONE message as two content blocks (same id, same usage) and then blocks:
 *  `onAbort` decides how it ends once the run's signal fires. `entered` flips once the CLI "runs". */
function streamingRun(onAbort = (rej) => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))) {
  const st = { entered: false };
  st.run = (o) => new Promise((res, rej) => {
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', usage: U1200 } } });
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', usage: U1200 } } });
    const fire = () => onAbort(rej, res, o);
    if (o.signal.aborted) fire(); else o.signal.addEventListener('abort', fire, { once: true });
    st.entered = true;
  });
  return st;
}
const spyBooking = (orch) => {
  const booked = []; const floors = [];
  orch._recordCost = (usd, key, opts) => booked.push([usd, key, opts?.aux ?? null]);
  orch._recordAuxStopped = (key, kind, usd) => floors.push([key, kind, usd]);
  return { booked, floors };
};

test('a review books aux "away" on the asking step, names its cost on the record, and gets a random row id', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux1'), nightClock: clock, nightRunClaude: recordingRun().run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c1', kind: 'clarify', questions: QA, executionId: 'n_plan:1', nodeId: 'n_plan' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual(booked, [[0.05, 'n_plan:1', 'away']]);
  assert.deepEqual(floors, []);
  const rec = orch.nightDecision('c1');
  assert.deepEqual([rec.costUsd, rec.tokens, rec.executionId, rec.reviewStatus, 'floorUsd' in rec], [0.05, 5, 'n_plan:1', 'finished', false]);
  assert.match(rec.reviewId, /^night-decider-[0-9a-f]{8}$/);
  const row = deciderRows(orch)[0];
  assert.deepEqual([row.id, row.label, row.status, row.stepKey], [rec.reviewId, 'Away mode review (clarify)', 'finished', 'n_plan:1']);
});

test('a resumed run (a new harness on the SAME pipeline) never overwrites the first review\'s row', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const dir = await mkdtemp(join(tmpdir(), 'night-aux2-'));
  try {
    const pipeline = await createPipeline(dir, { prompt: 'resume twice' });
    for (const qid of ['c2a', 'c2b']) {                           // first run, then the resumed harness
      const clock = fakeClock();
      const orch = createOrchestrator({ projectDir: dir, nightClock: clock, nightRunClaude: recordingRun().run, claude: { model: 'claude-sonnet-5-5' } });
      orch.pipeline = { id: pipeline.id, dir: pipeline.dir, promptText: 'resume twice' };
      orch._recordCost = () => {};
      await answerOne(orch, clock, qid);
    }
    const rows = prepare("SELECT id, cost_usd FROM sub_agents WHERE pipeline_id = ? AND subagent_type = 'night-decider'").all(pipeline.id);
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.deepEqual(rows.map((r) => r.cost_usd), [0.05, 0.05]);
    // The answer's review fields survive night_decisions (History reads them from there).
    const saved = readNightDecisions(pipeline.id);
    assert.deepEqual(saved.map((d) => [d.reviewId, d.reviewStatus, d.costUsd, d.tokens]).sort(), rows.map((r) => [r.id, 'finished', 0.05, 5]).sort());
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 3 }); }
});

test('the user answers while the review runs: a "stopped" row with its tokens, a lower bound apart from the total', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const r = streamingRun();
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux3'), nightClock: clock, nightRunClaude: r.run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c3', kind: 'clarify', questions: QA, executionId: 'n_impl:1', nodeId: 'n_impl' });
  await clock.tick(60_000);                                      // grace is up: the review starts…
  await settle(clock, () => r.entered);                          // …and is running inside the CLI
  assert.equal(r.entered, true, 'the review spawned');
  assert.equal(orch.answer('c3', { answers: [{ id: 'a', choice: 'x' }] }, 'local'), true);   // the user wins the race
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  await settle(clock, () => deciderRows(orch).length === 1 && !orch._night.deciding);
  assert.deepEqual(booked, [], 'nothing booked to the total');
  const row = deciderRows(orch)[0];
  assert.deepEqual([row.status, row.costUsd, row.stepKey], ['stopped', null, 'n_impl:1']);
  assert.equal(row.tokens, 1200, 'message m1 counted once, not per content block');
  assert.equal(floors.length, 1);
  assert.deepEqual(floors[0].slice(0, 2), ['n_impl:1', 'away']);
  assert.ok(Math.abs(floors[0][2] - 0.004) < 1e-9, `the sonnet list-price floor: ${floors[0][2]}`);   // 1000×$2 + 200×$10 per Mtok
  assert.equal(orch.nightDecision('c3'), null, 'the user answered: no Away mode answer');
});

test('answered before the review spawned: nothing ran, so no row and no lower bound', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const r = streamingRun();
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux4'), nightClock: clock, nightRunClaude: r.run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c4', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await clock.tick(60_000);                                      // the decision started (deciding) but has not spawned yet
  assert.equal(orch._night.deciding, true);
  orch.answer('c4', { answers: [{ id: 'a', choice: 'x' }] }, 'local');
  await p;
  await settle(clock, () => !orch._night.deciding);
  assert.equal(orch._night.deciding, false, 'the decision ended (no hang on an already-aborted signal)');
  assert.equal(r.entered, false, 'no CLI was spawned');
  assert.deepEqual([deciderRows(orch).length, booked.length, floors.length], [0, 0, 0]);
});

test('the user answered as the result landed: the failed review is still booked, with no Away mode answer', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const r = streamingRun((rej, _res, o) => {
    o.onEvent({ type: 'result', costUsd: 0.05, raw: { type: 'result', usage: { input_tokens: 3, output_tokens: 2 } } });
    rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux5'), nightClock: clock, nightRunClaude: r.run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c5', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await clock.tick(60_000);
  await settle(clock, () => r.entered);
  orch.answer('c5', { answers: [{ id: 'a', choice: 'x' }] }, 'local');
  await p;
  await settle(clock, () => deciderRows(orch).length === 1 && !orch._night.deciding);
  assert.deepEqual(booked, [[0.05, 'n_impl:1', 'away']], 'booked: it reported its cost');
  assert.deepEqual(floors, []);
  assert.equal(deciderRows(orch)[0].status, 'error');
  assert.equal(orch.nightDecision('c5'), null);
});

test('a review that times out still answers (flagged); the answer says it was stopped and carries its lower bound', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const run = async (o) => {                                     // the 5-min timeout aborts the CLI from inside
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', usage: U1200 } } });
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux6'), nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked } = spyBooking(orch);
  const p = orch._ask({ id: 'c6', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual(booked, []);
  const rec = orch.nightDecision('c6');
  assert.equal(rec.strategy, 'analysis', 'the fallback answer still names the strategy (night/strategies.mjs)');
  assert.equal(rec.flagged, true);
  assert.deepEqual([rec.reviewStatus, rec.costUsd, rec.tokens], ['stopped', null, 1200]);
  assert.ok(Math.abs(rec.floorUsd - 0.004) < 1e-9, `the lower bound rides on the answer: ${rec.floorUsd}`);
  assert.equal(rec.reviewId, deciderRows(orch)[0].id);
});

test('a reply with no priced result frame is a stopped review with a lower bound, never a silent $0', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const run = async (o) => {
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', usage: U1200 } } });
    o.onEvent({ type: 'result', raw: { type: 'result', usage: U1200 } });       // a result that carried no cost
    return { text: '{"decisions":[{"id":"a","choice":"y","confidence":90,"rationale":"fits","reversible":true,"scores":{}}]}' };
  };
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux7'), nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c7', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await settle(clock, () => !orch.pendingQuestion);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'y' }] }, 'the review still answers');
  assert.deepEqual(booked, []);
  assert.equal(floors.length, 1);
  assert.equal(deciderRows(orch)[0].status, 'stopped');
  assert.equal(orch.nightDecision('c7').reviewStatus, 'stopped');
});

test('a {free} review that fails after its result is a $0 booked review, not a stopped one', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'onprem' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const run = async (o) => {
    o.onEvent({ type: 'result', costUsd: 0.05, raw: { type: 'result', usage: { input_tokens: 3, output_tokens: 2 } } });
    throw new Error('claude exited with code 1');
  };
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux8'), nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c8', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual(booked, [[0, 'n_impl:1', 'away']], 'priced at $0 as the {free} decider model — still one booked review');
  assert.deepEqual(floors, []);
  assert.deepEqual([deciderRows(orch)[0].status, orch.nightDecision('c8').reviewStatus, orch.nightDecision('c8').costUsd], ['error', 'error', 0]);
});

test('a {free} review stopped before its result has a $0 lower bound, not "not priced"', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1, deciderModel: 'onprem' });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const run = async (o) => {
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', usage: U1200 } } });
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux9'), nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const { floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c9', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual(floors, [['n_impl:1', 'away', 0]]);
  assert.equal(orch.nightDecision('c9').floorUsd, 0);
});

test('a decider model with no list price: the stopped review is counted, not priced (floor null)', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const run = async (o) => {
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', usage: U1200 } } });
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux10'), nightClock: clock, nightRunClaude: run, claude: { model: 'some-unpriced-model' } });
  const { floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c10', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual(floors, [['n_impl:1', 'away', null]]);
  const rec = orch.nightDecision('c10');
  assert.deepEqual([rec.reviewStatus, rec.floorUsd, rec.tokens], ['stopped', null, 1200]);
});

test('no model configured (the CLI\'s default): the lower bound is priced at the model the review\'s own messages named', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const stopAfter = (model) => async (o) => {                    // one streamed message, then the timeout
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'm1', ...(model ? { model } : {}), usage: U1200 } } });
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  const floorFor = async (run, claude, qid) => {
    const clock = fakeClock();
    const orch = createOrchestrator({ projectDir: join(tmpdir(), `night-aux-${qid}`), nightClock: clock, nightRunClaude: run, claude });
    const { floors } = spyBooking(orch);
    const p = orch._ask({ id: qid, kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
    await settle(clock, () => !orch.pendingQuestion); await p;
    return [floors.map((f) => f[2]), orch.nightDecision(qid).floorUsd];
  };
  const named = await floorFor(stopAfter('claude-sonnet-5-5'), {}, 'c11');      // no decider model, no run model
  assert.ok(Math.abs(named[0][0] - 0.004) < 1e-9, `priced at the streamed message.model: ${named[0][0]}`);
  assert.ok(Math.abs(named[1] - 0.004) < 1e-9, `the record carries it: ${named[1]}`);
  assert.deepEqual(await floorFor(stopAfter(null), {}, 'c12'), [[null], null], 'no model anywhere: counted, not priced');
  const configured = await floorFor(stopAfter('claude-opus-5-5'), { model: 'claude-sonnet-5-5' }, 'c13');
  assert.ok(Math.abs(configured[0][0] - 0.004) < 1e-9, `the configured model wins over the streamed one (opus: 0.008): ${configured[0][0]}`);
});

test('a clarifier ask names only its node: the review books on that node\'s open row, not on a later sibling', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux14'), nightClock: clock, nightRunClaude: recordingRun().run, claude: { model: 'claude-sonnet-5-5' } });
  orch.state.steps.push(
    { key: 'x:n_clar:1', executionId: 'x:n_clar:1', nodeId: 'n_clar', status: 'start', costUsd: 0 },
    { key: 'x:n_side:1', executionId: 'x:n_side:1', nodeId: 'n_side', status: 'start', costUsd: 0 },   // a parallel sibling, started later
  );
  const { booked } = spyBooking(orch);
  // graph/executor.mjs: the clarifier's asks carry the node, never the execution.
  const p = orch._ask({ id: 'c14', kind: 'clarify', questions: QA, nodeId: 'n_clar' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual(booked, [[0.05, 'x:n_clar:1', 'away']]);
  assert.equal(orch.nightDecision('c14').executionId, 'x:n_clar:1');
  assert.equal(deciderRows(orch)[0].stepKey, 'x:n_clar:1');
});

test('a review whose CLI never started (no frame at all) is no review: no row, no booking, no lower bound', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  const run = async () => { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); };
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux15'), nightClock: clock, nightRunClaude: run, claude: { model: 'claude-sonnet-5-5' } });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c15', kind: 'clarify', questions: QA, executionId: 'n_impl:1' });
  await settle(clock, () => !orch.pendingQuestion); await p;
  assert.deepEqual([deciderRows(orch).length, booked.length, floors.length], [0, 0, 0]);
  const rec = orch.nightDecision('c15');
  assert.equal(rec.flagged, true, 'the strategy still answers with its flagged fallback');
  assert.equal('reviewStatus' in rec, false, 'and names no review');
});

test('a clarifier review the user cuts books on the clarifier, even when the next node started before it settled', async () => {
  await setNightMode({ enabled: true, strategy: 'analysis', graceMinutes: 1 });
  await setNightModeToggle('on');
  const clock = fakeClock();
  let orch;
  // The user's answer ends the ask at once, but the cut CLI settles only when its process closes. In
  // that gap the clarifier finishes and the scheduler starts the next node, whose clock runs.
  const r = streamingRun((rej) => {
    orch.state.steps[0].status = 'done';
    orch.state.steps.push({ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start', costUsd: 0, runningSince: Date.now() });
    rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  });
  orch = createOrchestrator({ projectDir: join(tmpdir(), 'night-aux16'), nightClock: clock, nightRunClaude: r.run, claude: { model: 'claude-sonnet-5-5' } });
  orch.state.steps.push({ key: 'x:n_clar:1', executionId: 'x:n_clar:1', nodeId: 'n_clar', status: 'start', costUsd: 0 });
  const { booked, floors } = spyBooking(orch);
  const p = orch._ask({ id: 'c16', kind: 'clarify', questions: QA, nodeId: 'n_clar' });
  await clock.tick(60_000);
  await settle(clock, () => r.entered);
  assert.equal(r.entered, true, 'the review spawned');
  orch.answer('c16', { answers: [{ id: 'a', choice: 'x' }] }, 'local');
  await p;
  await settle(clock, () => deciderRows(orch).length === 1 && !orch._night.deciding);
  assert.deepEqual(booked, []);
  assert.deepEqual(floors.map((f) => f.slice(0, 2)), [['x:n_clar:1', 'away']], 'pinned when the review started, not when it settled');
  assert.equal(deciderRows(orch)[0].stepKey, 'x:n_clar:1');
});
