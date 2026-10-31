// test/cost-invariant-away.test.mjs — the run cost invariant with worca's own AI calls in the run
// (I1–I4 of the Away mode cost visibility plan). A REAL orchestrator over a saved v2 graph (task →
// planner → implementer → End), both agents asking one question each, Away mode opted in per run with
// the `analysis` strategy so each ask is answered by a review call. Every AI call is a seam:
//   - the two agent nodes: an injected `producer` runner that reports a priced `result` frame
//   - the Away mode review: `nightRunClaude` ($0.05 per review)
//   - the run title: `titleRunClaude` ($0.0021)
// The run is NOT a claude:{mock:true} run on purpose: a mock run short-circuits the review to the
// offline $0 mock (night/analysis.mjs mockEnabled), which would make every Away assertion vacuous.
// `bin` names a file that does not exist, on every OS: the capability probe (the one other spawn of a
// non-mock run) then reads "no version" and moves on, and no real `claude` can ever be spawned. The
// project dir is not a git repo: no worktree, so no graph build.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume, listSubAgents } from '../src/core/artifacts.mjs';
import { readNightDecisions } from '../src/core/night/store.mjs';
import { prepare } from '../src/core/db.mjs';
import { roundUsd, sumStepCosts } from '../src/core/run-harness.mjs';
import { setNightMode } from '../src/core/settings.mjs';
import { runCostBreakdown } from '../src/shared/cost/breakdown.mjs';

useTempHome(after);                                   // sqlite (cost_ledger, sub_agents, night_decisions) under WORCA_HOME
let home; const prev = {};
const dirs = [];
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cost-inv-home-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

const BIN = join(tmpdir(), 'worca-no-such-dir', 'claude-must-not-spawn');   // never created
const MODEL = 'claude-sonnet-5-5';

function fakeClock(start = Date.parse('2026-10-03T12:00:00Z')) {
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

const ASKS = { askQuestions: true };
const G = {
  id: 'wf_cost_inv', name: 'Cost invariant', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_pl', kind: 'agent', key: 'planner', x: 200, y: 0, config: { ...ASKS } },
    { id: 'n_im', kind: 'agent', key: 'implementer', x: 400, y: 0, config: { ...ASKS } },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_pl', port: 'task' } },
    { id: 'w2', from: { node: 'n_pl', port: 'plan' }, to: { node: 'n_im', port: 'plan' } },
    { id: 'w3', from: { node: 'n_im', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

const NODE_USD = { n_pl: 0.4, n_im: 1.25 };           // what each agent spawn reports per `result`
const REVIEW_USD = 0.05;
const TITLE_USD = 0.0021;
const CUT_USAGE = { input_tokens: 20000, output_tokens: 1000 };   // a turn the pause cuts before its result

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

/** The seams of one run. `cut` (optional) is called on each producer spawn first; when it returns a
 *  promise, that spawn streams nothing more and ends the way the promise does (a pause, say). */
function seams({ cut = null } = {}) {
  const asked = new Set();
  const reviews = [];
  const producer = async (ctx) => {
    const cutting = cut ? cut(ctx) : null;
    if (cutting) return cutting;
    // One spawn = one priced `result` frame on this execution's step (the real runner's onEvent path).
    const usd = NODE_USD[ctx.nodeId];
    ctx.onEvent({ type: 'result', costUsd: usd, raw: { type: 'result', total_cost_usd: usd, usage: { input_tokens: 10, output_tokens: 5 } } });
    if (ctx.outputs?.plan?.path) await writeFile(ctx.outputs.plan.path, '# plan\n', 'utf8');
    if (ctx.questionsFile && !asked.has(ctx.nodeId)) {
      asked.add(ctx.nodeId);
      await writeFile(ctx.questionsFile, JSON.stringify({ questions: [{ id: 'q1', question: `${ctx.nodeId}: which store?`, options: ['Redis', 'Postgres'] }] }), 'utf8');
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  };
  const nightRunClaude = async (o) => {
    reviews.push(o.model ?? null);
    o.onEvent({ type: 'result', costUsd: REVIEW_USD, raw: { type: 'result', usage: { input_tokens: 300, output_tokens: 40 } } });
    return { text: JSON.stringify({ decisions: [{ id: 'q1', choice: 'Postgres', confidence: 90, rationale: 'fits', reversible: true, scores: {} }] }) };
  };
  const titleRunClaude = async (o) => {
    o.onEvent({ type: 'result', costUsd: TITLE_USD, raw: { type: 'result', usage: { input_tokens: 90, output_tokens: 8 } } });
    return { text: 'Pick a store' };
  };
  return { producer, nightRunClaude, titleRunClaude, reviews };
}

/** Nobody answers: each question steps the harness's fake clock past the 1-minute grace. */
function unattended(orch, clock, questions) {
  orch.on('question', (q) => {
    questions.push(q);
    setImmediate(async () => { await clock.tick(61_000); await clock.tick(1_000); });
  });
}

async function setup() {
  await setNightMode({ enabled: false, graceMinutes: 1, window: null, strategy: 'analysis' });
  await writeGraphWorkflow(G);
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cost-inv-proj-'));
  dirs.push(projectDir);
  return projectDir;
}

async function costRun() {
  const projectDir = await setup();
  const s = seams();
  const clock = fakeClock();
  const orch = createOrchestrator({
    projectDir, workflowId: G.id, prompt: 'pick a store for the cache',
    claude: { bin: BIN }, runners: { producer: s.producer }, nightMode: true, nightClock: clock,
    nightRunClaude: s.nightRunClaude, titleRunClaude: s.titleRunClaude,
  });
  const questions = [];
  unattended(orch, clock, questions);
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  await orch._titlePromise;                           // fire-and-forget: may settle after `done`
  await orch._persist();                              // its _recordCost persisted fire-and-forget too
  return { orch, id: orch.pipeline.id, questions, reviews: s.reviews };
}

const ledgerOf = (id) => prepare('SELECT SUM(amount_usd) AS s, COUNT(*) AS n FROM cost_ledger WHERE pipeline_id = ?').get(id);

test('every AI call in a run with Away mode on reaches the step costs, the total and the ledger — and is shown apart', { timeout: 120_000 }, async () => {
  const { orch, id, questions, reviews } = await costRun();
  const st = orch.getState();

  // The run did what the fixture says: two asks, each reviewed once, by Away mode.
  assert.deepEqual(questions.map((q) => q.kind), ['questions', 'questions']);
  assert.equal(reviews.length, 2, 'one review per ask');
  for (const q of questions) assert.equal(orch.answeredBy(q.id), 'night-mode');

  const expected = roundUsd(NODE_USD.n_pl * 2 + NODE_USD.n_im * 2 + REVIEW_USD * 2 + TITLE_USD);  // each node spawns twice (ask + resume)

  // I2a — the total is the sum of the step rows.
  assert.equal(st.totalCostUsd, sumStepCosts(st.steps));
  // I1 — nothing hidden: the run title and both reviews are IN the total.
  assert.equal(st.totalCostUsd, expected, `total ${st.totalCostUsd} must include 2 reviews + the title (${expected})`);
  // I2b — the windowed-budget ledger agrees with the total (raw rows: ≤ $0.00005 drift per row).
  const ledger = ledgerOf(id);
  assert.ok(Math.abs(ledger.s - st.totalCostUsd) <= 0.00005 * ledger.n + 1e-9, `ledger ${ledger.s} vs total ${st.totalCostUsd}`);
  assert.equal(ledger.n, 4 + 2 + 1, 'one ledger row per priced call: 4 node spawns, 2 reviews, 1 title');

  // I3 — worca's own spend is shown apart, inside (never on top of) the step costs.
  const b = runCostBreakdown(st.steps, st.totalCostUsd);
  const line = (k) => b.lines.find((l) => l.kind === k);
  assert.ok(line('away'), 'an Away mode line');
  assert.equal(line('away').calls, 2, 'calls = the number of reviewed asks');
  assert.ok(Math.abs(line('away').usd - REVIEW_USD * 2) < 1e-9);
  assert.ok(line('title'), 'a run title line');
  assert.equal(line('title').calls, 1);
  assert.ok(Math.abs(line('title').usd - TITLE_USD) < 1e-9);
  assert.equal(line('auto'), undefined, 'no Auto workflow in a saved-workflow run');
  assert.ok(Math.abs(b.agents - (expected - REVIEW_USD * 2 - TITLE_USD)) < 1e-4, `agents ${b.agents}`);
  for (const s of st.steps) {
    const aux = Object.values(s.auxCosts || {}).reduce((t, x) => t + (Number(x.usd) || 0), 0);
    const bookings = Object.values(s.auxCosts || {}).reduce((t, x) => t + (Number(x.calls) || 0), 0);
    assert.ok(aux <= (Number(s.costUsd) || 0) + 0.00005 * bookings + 1e-9, `step ${s.key}: aux ${aux} within its cost ${s.costUsd}`);
  }
  // Each review sits on the step that asked; the title on the preflight bookend.
  const step = (k) => st.steps.find((s) => s.key === k);
  for (const q of questions) assert.deepEqual(step(q.executionId).auxCosts?.away?.calls, 1, q.executionId);
  assert.equal(step('x:preflight:1').auxCosts?.title?.calls, 1);

  // D2 — each reviewed answer names what its review cost and which review it was.
  const nd = readNightDecisions(id).filter((d) => String(d.strategy || '').includes('analysis'));
  assert.equal(nd.length, 2);
  for (const d of nd) {
    assert.equal(d.costUsd, REVIEW_USD, `record ${d.questionId} names its review's cost`);
    assert.equal(d.reviewStatus, 'finished');
    assert.match(d.reviewId || '', /^night-decider-[0-9a-f]{8}$/);
    // 6.3: the review is auditable afterwards — its prompt, raw reply, config and the model that answered.
    const { readFileSync } = await import('node:fs');
    const rec = JSON.parse(readFileSync(join(orch.pipeline.dir, 'night', `${d.reviewId}.json`), 'utf8'));
    assert.equal(rec.reviewId, d.reviewId);
    assert.match(rec.prompt, /which store\?/);
    assert.ok(rec.systemPrompt.length > 0);
    assert.match(rec.rawReply, /Postgres/);
    assert.equal(rec.model, MODEL === rec.model ? MODEL : rec.model);
    assert.ok(rec.config && typeof rec.config === 'object' && 'criteria' in rec.config);
    assert.ok('turnModel' in rec);
  }
  // D2a/D5 — every worca AI call has its own sub-agent row (unique ids, nothing overwritten).
  const rows = listSubAgents(id);
  const reviewRows = rows.filter((r) => r.subagentType === 'night-decider');
  assert.equal(reviewRows.length, 2);
  assert.equal(new Set(reviewRows.map((r) => r.id)).size, 2);
  assert.deepEqual(reviewRows.map((r) => r.costUsd), [REVIEW_USD, REVIEW_USD]);
  assert.deepEqual(rows.filter((r) => r.subagentType === 'run-title').map((r) => r.costUsd), [TITLE_USD]);

  // Resume parity — auxCosts ride exec_meta: what a resumed run (and History) reads back.
  const saved = readPipelineForResume(id);
  const back = runCostBreakdown(saved.steps, saved.row.total_cost_usd);
  assert.deepEqual(back.lines.map((l) => [l.kind, l.calls]), [['away', 2], ['title', 1]]);
  assert.equal(saved.row.total_cost_usd, st.totalCostUsd);
});

test('paused mid-step and resumed by a NEW harness: the total comes back with the steps, the second review keeps its own row, the cut turn stays out of every total', { timeout: 120_000 }, async () => {
  const projectDir = await setup();
  const h = { orch: null, paused: false, atResume: null };
  // Run 1 pauses inside the implementer's first spawn: one streamed turn, no `result` (Task 3).
  const cut = (ctx) => {
    if (h.orch !== h.first) {                         // the resumed harness: record what it started from
      if (!h.atResume) h.atResume = { total: h.orch.state.totalCostUsd, sum: sumStepCosts(h.orch.state.steps) };
      return null;
    }
    if (ctx.nodeId !== 'n_im' || h.paused) return null;
    h.paused = true;
    ctx.onEvent({ type: 'assistant', raw: { type: 'assistant', message: { id: 'msg_cut', usage: CUT_USAGE } } });
    queueMicrotask(() => h.orch.pause());
    return new Promise((_r, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
  const s = seams({ cut });
  const questions = [];

  const clock1 = fakeClock();
  h.first = h.orch = createOrchestrator({
    projectDir, workflowId: G.id, prompt: 'pick a store for the cache',
    claude: { bin: BIN, model: MODEL }, runners: { producer: s.producer }, nightMode: true, nightClock: clock1,
    nightRunClaude: s.nightRunClaude, titleRunClaude: s.titleRunClaude,
  });
  unattended(h.orch, clock1, questions);
  assert.equal((await h.orch.run()).status, 'paused');
  await h.orch._titlePromise;
  const id = h.orch.pipeline.id;
  const pausedTotal = roundUsd(NODE_USD.n_pl * 2 + REVIEW_USD + TITLE_USD);
  assert.equal(readPipelineForResume(id).row.total_cost_usd, pausedTotal);

  // Run 2: a new harness built the way the server resumes (only `resume: saved`; the Away mode opt-in
  // rides the resume point).
  const clock2 = fakeClock(Date.parse('2026-10-03T13:00:00Z'));
  h.orch = createOrchestrator({
    projectDir, claude: { bin: BIN, model: MODEL }, runners: { producer: s.producer }, nightClock: clock2,
    nightRunClaude: s.nightRunClaude, titleRunClaude: s.titleRunClaude, resume: readPipelineForResume(id),
  });
  unattended(h.orch, clock2, questions);
  const res = await h.orch.resume();
  assert.equal(res.status, 'done', res.error);
  await h.orch._persist();

  // I2 on resume — the new harness starts from the total it paused with, before any new booking.
  assert.deepEqual(h.atResume, { total: pausedTotal, sum: pausedTotal });
  const st = h.orch.getState();
  const expected = roundUsd(NODE_USD.n_pl * 2 + NODE_USD.n_im * 2 + REVIEW_USD * 2 + TITLE_USD);   // the cut spawn booked nothing
  assert.equal(st.totalCostUsd, expected);
  const ledger = ledgerOf(id);
  assert.ok(Math.abs(ledger.s - expected) <= 0.00005 * ledger.n + 1e-9, `ledger ${ledger.s} vs total ${expected}`);

  // D2a — one review per harness, two rows, both priced: the resumed harness never overwrote the first.
  assert.equal(s.reviews.length, 2);
  const reviewRows = listSubAgents(id).filter((r) => r.subagentType === 'night-decider');
  assert.equal(new Set(reviewRows.map((r) => r.id)).size, 2, JSON.stringify(reviewRows.map((r) => r.id)));
  assert.deepEqual(reviewRows.map((r) => r.costUsd), [REVIEW_USD, REVIEW_USD]);

  // I4 — the cut turn is counted on its step with a lower bound, and never in a total or the ledger.
  const saved = readPipelineForResume(id);
  const im = saved.steps.find((x) => x.nodeId === 'n_im');
  assert.equal(im.stoppedTurns?.turns, 1);
  assert.equal(im.stoppedTurns?.tokens, 21000);
  assert.ok(im.stoppedTurns?.floorUsd > 0, 'priced at the sonnet list price, as a floor');
  assert.equal(saved.row.total_cost_usd, expected, 'the floor is not in the stored total');
  const b = runCostBreakdown(saved.steps, saved.row.total_cost_usd);
  assert.deepEqual(b.lines.map((l) => [l.kind, l.calls]), [['away', 2], ['title', 1]]);
  assert.equal(b.cut.turns, 1);
  assert.equal(b.total, expected, 'the breakdown total never includes a floor');
});
