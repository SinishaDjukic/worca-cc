// test/night-shaper-harness.test.mjs — Away mode on a Shaper run, at the _ask seam: which asks are armed, and how an
// approval lands. Real settings and a fake clock, as test/night-harness.test.mjs; no agent runs.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { isPause } from '../src/core/run-harness.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNightMode, setNightModeToggle } from '../src/core/settings.mjs';

useTempHome(after);
let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-night-shaper-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
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
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (x.at <= t) { timers.delete(id); x.fn(); }
      }
      await new Promise((r) => setImmediate(r));
    },
    pending: () => timers.size,
  };
}

const SHAPE = { perspectives: ['product', 'qa'] };
const PASS = { ok: true, passed: 8, total: 8, items: [] };
const FAIL = { ok: false, passed: 3, total: 8, items: [] };
const OK = { ok: true, payload: { decision: 'approve' } };
const Q = [{ id: 'a', question: 'A?', options: ['x', 'y'], confidence: [90, 10], recommended: 'x' }];
const cleanPlan = (id = 'plan-n_refine-1') => ({ id, kind: 'plan', plan: { file: 'plan.md', round: 1, check: PASS } });

let n = 0;
/** An orchestrator at the _ask seam, away right now unless the test sets otherwise. */
async function away(opts = {}, { toggle = 'on', night = { enabled: true, graceMinutes: 1, strategy: 'weights', window: null } } = {}) {
  await setNightMode(night);
  if (toggle) await setNightModeToggle(toggle);
  const clock = fakeClock();
  n += 1;
  const orch = createOrchestrator({ projectDir: `/tmp/night-shaper-${n}`, nightClock: clock, shape: SHAPE, ...opts });
  return { orch, clock };
}
const askWith = (orch, q) => { const p = orch._ask(q); p.catch(() => {}); return p; };

test('a clean plan is approved at once with a zero delay', async () => {
  const { orch, clock } = await away();
  const p = askWith(orch, cleanPlan());
  await clock.tick(0);
  assert.deepEqual(await p, { decision: 'approve' });
  assert.equal(orch.answeredBy('plan-n_refine-1'), 'night-mode');
  assert.equal(orch.nightDecision('plan-n_refine-1').strategy, 'rule');
  assert.equal(orch.state.night.decisions, 1);
});

test('a clean outline is approved by Away', async () => {
  const { orch, clock } = await away();
  const outline = { why: 'because', slices: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] };
  const p = askWith(orch, { id: 'plan-outline-n_plan-1', kind: 'plan', plan: { outline, round: 1, check: PASS, approveEach: true } });
  await clock.tick(0);
  assert.deepEqual(await p, { decision: 'approve', approveEach: true });
  assert.deepEqual(orch.nightDecision('plan-outline-n_plan-1').meta, { ask: 'outline' });
});

test('Clarify on a Shaper run is never armed', async () => {
  const { orch, clock } = await away();
  askWith(orch, { id: 'c1', kind: 'clarify', questions: Q });
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'c1');
  assert.equal(clock.pending(), 0);
  assert.equal(orch.state.night?.openedAt ?? null, null);
});

test('a clarify form on a Shaper run is never armed', async () => {
  const { orch, clock } = await away();
  askWith(orch, { id: 'f1', kind: 'form', origin: 'clarify', form: 'clarify', version: 1, answerSchema: { properties: {} }, autoValues: {} });
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'f1');
  assert.equal(clock.pending(), 0);
});

test('Clarify on a normal run is still answered', async () => {
  const { orch, clock } = await away({ shape: null });
  const p = askWith(orch, { id: 'c2', kind: 'clarify', questions: Q });
  await clock.tick(0);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
});

test("agents' questions, gates and failed steps on a Shaper run still go to Away", async () => {
  const { orch, clock } = await away();
  const asks = [
    [{ id: 'q1', kind: 'questions', questions: Q }, { answers: [{ id: 'a', choice: 'x' }] }],
    [{ id: 'g1', kind: 'gate', issues: [], wireId: 'w', deliveryNo: 1 }, { decision: 'continue' }],
    [{ id: 'r1', kind: 'recovery', recovery: { cls: 'unknown', attempt: 9 } }, { decision: 'pause' }],
  ];
  for (const [q, want] of asks) {
    const p = askWith(orch, q);
    await clock.tick(0);
    assert.deepEqual(await p, want, q.kind);
    assert.equal(orch.answeredBy(q.id), 'night-mode');
  }
});

test('a Requirements hold is never armed', async () => {
  const { orch, clock } = await away();
  askWith(orch, { id: 'plan-n_reqrefine-1', kind: 'plan', plan: { criteria: { ok: true, passed: 8, total: 8 }, decisions: [] } });
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'plan-n_reqrefine-1');
  assert.equal(clock.pending(), 0);
  assert.equal(orch.state.night?.openedAt ?? null, null);
});

test('a failed-check plan is never armed, and publishes no countdown', async () => {
  const { orch, clock } = await away();
  askWith(orch, { id: 'p3', kind: 'plan', plan: { file: 'plan.md', check: FAIL } });
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'p3');
  assert.equal(clock.pending(), 0);
  assert.equal(orch.state.night?.openedAt ?? null, null);
});

test('a marked run by day approves after the grace time', async () => {
  const { orch, clock } = await away({ nightMode: true }, { toggle: null, night: { enabled: false, graceMinutes: 1, strategy: 'weights', window: null } });
  const p = askWith(orch, cleanPlan());
  await clock.tick(59_000);
  assert.ok(orch.pendingQuestion, 'still waiting before the grace time');
  await clock.tick(2_000);
  assert.deepEqual(await p, { decision: 'approve' });
  assert.equal(orch.answeredBy('plan-n_refine-1'), 'night-mode');
});

test('Never on this run: the plan waits; As set up re-arms it', async () => {
  const { orch, clock } = await away();
  orch.setNightOverride('off');
  const p = askWith(orch, cleanPlan());
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'plan-n_refine-1');
  assert.equal(clock.pending(), 0);
  orch.setNightOverride('auto');
  await clock.tick(0);
  assert.deepEqual(await p, { decision: 'approve' });
});

test('maxDecisions pauses the run on a plan ask', async () => {
  const { orch, clock } = await away({}, { night: { enabled: true, maxDecisions: 1, graceMinutes: 1, window: null } });
  orch._nightCount = () => 1;
  orch.state.status = 'running';
  const rejected = assert.rejects(orch._ask(cleanPlan()), (e) => isPause(e));
  await clock.tick(0);
  await rejected;
  assert.equal(orch.pauseReason, 'night_guardrail');
});

test('at the answer limit, a failed-check plan stays open and the run does not pause', async () => {
  const { orch, clock } = await away({}, { night: { enabled: true, maxDecisions: 1, graceMinutes: 1, window: null } });
  orch._nightCount = () => 1;
  orch.state.status = 'running';
  askWith(orch, { id: 'p5', kind: 'plan', plan: { file: 'plan.md', check: FAIL } });
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'p5');
  assert.equal(orch.pauseReason ?? null, null);
  assert.equal(orch.state.status, 'running');
  assert.equal(orch._night.since ?? null, null, 'the unattended stretch is not started by an ask Away will not decide');
});

test('a rule approval spawns no decider and records no cost', async () => {
  const seen = [];
  const { orch, clock } = await away({ nightRunClaude: async (o) => { seen.push(o); return { text: '{}' }; } }, { night: { enabled: true, strategy: 'analysis', graceMinutes: 1, window: null } });
  const booked = [];
  orch._recordCost = (usd) => booked.push(usd);
  const p = askWith(orch, cleanPlan());
  await clock.tick(0);
  await p;
  assert.equal(seen.length, 0);
  assert.deepEqual(booked, []);
  assert.deepEqual(orch.state.subAgents.filter((s) => s.subagentType === 'night-decider'), []);
  const rec = orch.nightDecision('plan-n_refine-1');
  for (const k of ['model', 'reviewId', 'costUsd']) assert.equal(k in rec, false, k);
});

test('a validator refusing Away\'s approve leaves the ask open, no record', async () => {
  const { orch, clock } = await away();
  let refused = 0;
  const validate = () => { refused += 1; return { ok: false, errors: [{ path: 'decision', code: 'invalid', message: 'no' }] }; };
  askWith(orch, { ...cleanPlan('p6'), validate });
  await clock.tick(0);
  for (let i = 0; i < 5; i += 1) await clock.tick(0);
  assert.ok(refused >= 1, 'Away did try to answer');
  assert.equal(orch.pendingQuestion?.id, 'p6');
  assert.equal(orch.nightDecision('p6'), null);
  assert.equal(orch.state.night.decisions, 0);
});

test('a person approving during the delay cancels Away\'s approval', async () => {
  const { orch, clock } = await away({ nightMode: true }, { toggle: null, night: { enabled: false, graceMinutes: 1, strategy: 'weights', window: null } });
  const p = askWith(orch, { ...cleanPlan('p7'), validate: () => OK });
  await clock.tick(1_000);
  assert.equal(orch.answer('p7', { decision: 'approve' }, 'ann'), true);
  await p;
  await clock.tick(60 * 60_000);
  assert.equal(orch.answeredBy('p7'), 'ann');
  assert.equal(orch.nightDecision('p7'), null);
  assert.equal(orch.state.night.decisions, 0);
});

test('--yes: a plan ask is not armed, even when Away owns the run', async () => {
  const { orch, clock } = await away({ auto: true }, { night: { enabled: true, graceMinutes: 1, strategy: 'weights', window: null } });
  const armed = [];
  const real = orch._nightArm.bind(orch);
  orch._nightArm = (q) => { armed.push(q); return real(q); };
  askWith(orch, cleanPlan('p8'));
  await clock.tick(60 * 60_000);
  assert.equal(orch.pendingQuestion?.id, 'p8');
  assert.deepEqual(armed, []);
  assert.equal(clock.pending(), 0);
});

test('--yes: Clarify on a Shaper run goes the way it does today', async () => {
  const { orch, clock } = await away({ auto: true });
  const p = askWith(orch, { id: 'c9', kind: 'clarify', questions: Q });
  await clock.tick(0);
  assert.deepEqual(await p, { answers: [{ id: 'a', choice: 'x' }] });
  assert.equal(orch.answeredBy('c9'), 'night-mode', 'the night-owned --yes run still has Away answer it');
});
