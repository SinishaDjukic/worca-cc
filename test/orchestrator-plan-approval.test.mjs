// test/orchestrator-plan-approval.test.mjs — the `plan` ask on a shaped run: hold, approve / revise / stop,
// --yes and Away exclusion, resume while held, and the unshaped run that never holds (shape-it-first D2, D12).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { GRAPH_SHAPE_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { readPipelineForResume, readPipelineExtras } from '../src/core/artifacts.mjs';
import { hasBlocking } from '../src/shared/graph/verdict.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { resolveShapeRequest } from '../src/core/shape/run.mjs';
import { MOCK_OUTLINE } from '../src/core/engines/mock.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-plan-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SHAPE = { perspectives: ['product', 'architect', 'qa'] };
const waitFor = async (pred, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('waitFor timed out');
};

/** Start a mock run. Clarify asks are answered with no answers; plan asks go to `onPlan(q, orch)`; a Care ask (Shaper small
 *  runs B2, a marked run) goes to `opts.onCare(q, orch)`, by default Worca's pick. */
const pickCare = (q, orch) => orch.answer(q.id, { care: { position: q.care.pick.position } });
function start({ onCare = pickCare, ...opts } = {}, onPlan = () => {}) {
  const dir = opts.projectDir || gitDir('plan');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  const plans = [];
  const execs = [];
  const asked = [];
  let unanswered;
  const failFast = new Promise((_, reject) => { unanswered = reject; });
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asked.push(q);
    if (q.kind === 'care') { setImmediate(() => onCare(q, orch)); return; }
    if (q.kind === 'plan') { plans.push(q); setImmediate(() => onPlan(q, orch)); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') { setImmediate(() => orch.answer(q.id, { answers: [] })); return; }
    // C3: a marked, non-auto run whose review loop runs out stops on dev's gate ask.
    if (q.kind === 'gate') { setImmediate(() => orch.answer(q.id, { decision: 'continue' })); return; }
    unanswered(new Error('unanswered ask kind ' + q.kind));
  });
  const done = Promise.race([opts.resume ? orch.resume() : orch.run(), failFast]);
  return { orch, plans, execs, asked, done, dir };
}
const ran = (execs, nodeId, status) => execs.filter((e) => e.nodeId === nodeId && (!status || e.status === status));

test('approve: one plan question carries the file and an 8-item check; nothing is built before the answer', async () => {
  let implAtAsk = null;
  const h = start({}, (q, orch) => { implAtAsk = ran(h.execs, 'n_impl').length; orch.answer(q.id, { decision: 'approve' }); });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.plans.length, 1);
  const q = h.plans[0];
  assert.equal(q.id, 'plan-n_refine-1');
  assert.ok(q.plan.file, 'the plan file rides the question');
  assert.equal(q.plan.check.total, 8);
  assert.notEqual(q.plan.check.passed, true, 'the mock plan fails most shape checks');
  assert.equal(implAtAsk, 0, 'no n_impl execution before the answer');
  assert.ok(ran(h.execs, 'n_impl').length > 0, 'n_impl ran after approval');
  assert.ok(ran(h.execs, 'n_review').length > 0, 'n_review ran after approval');

  // 8. audit
  const texts = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(h.orch.getState().id).map((r) => r.text);
  assert.ok(texts.some((t) => t.includes('Plan approval **approve**')), 'the audit trail records the plan decision');
});

test('revise: feedback is written to plan-feedback-1.md, the planner reruns, the second question is round 2', async () => {
  const h = start({}, (q, orch) => {
    if (q.id === 'plan-n_refine-1') orch.answer(q.id, { decision: 'revise', feedback: 'Cover the empty state.' });
    else orch.answer(q.id, { decision: 'approve' });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1', 'plan-n_refine-2']);
  const text = await readFile(join(h.orch.pipeline.dir, 'plan-feedback-1.md'), 'utf8');
  assert.ok(text.includes('Cover the empty state.'));
  assert.equal(ran(h.execs, 'n_plan', 'done').length, 2);
});

test('an invalid answer throws INVALID_ANSWER and the question stays open', async () => {
  const h = start();
  await waitFor(() => h.plans.length === 1);
  const id = h.plans[0].id;
  assert.throws(() => h.orch.answer(id, { decision: 'revise' }), (e) => e.code === 'INVALID_ANSWER');
  assert.equal(h.orch.pendingQuestion?.id, id);
  h.orch.answer(id, { decision: 'approve' });
  assert.equal((await h.done).status, 'done');
});

test('stop: the run ends stopped and nothing is built', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, { decision: 'stop' }));
  const res = await h.done;
  assert.equal(res.status, 'stopped');
  assert.equal(h.orch.getState().status, 'stopped');
  assert.equal(ran(h.execs, 'n_impl').length, 0);
});

test('--yes never answers a plan approval', async () => {
  const h = start({ auto: true });
  await waitFor(() => h.plans.length === 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h.orch.pendingQuestion?.id, h.plans[0].id, 'still waiting for a person');
  h.orch.answer(h.plans[0].id, { decision: 'approve' });
  assert.equal((await h.done).status, 'done');
});

/** The ask _planAsk raises, at its seam: no agent runs. */
async function askedBy(orch, spec = {}) {
  let seen = null;
  orch.pipeline = { id: 'x', dir: gitDir('plan-seam') };
  orch._planCheck = async () => ({ ok: true, passed: 8, total: 8, items: [] });
  orch._approveSpec = () => spec;
  orch._ask = async (a) => { seen = a; return { decision: 'withdrawn' }; };
  await orch._planAsk({ id: 'plan-n_refine-1', nodeId: 'n_refine', plan: { file: 'none.md', round: 1 } });
  return seen;
}

test('unreadable coverage reaches the ask as null', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('plan-cov'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE });
  orch._planCoverage = async () => null;
  const q = await askedBy(orch, { coverage: 'criteria' });
  assert.equal(Object.hasOwn(q.plan, 'coverage'), true);
  assert.equal(q.plan.coverage, null);
  const none = await askedBy(createOrchestrator({ projectDir: gitDir('plan-cov-none'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE }));
  assert.equal(Object.hasOwn(none.plan, 'coverage'), false, 'no coverage configured: no key');
});

test('open conflicts reach the ask as a count', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('plan-conf'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE });
  orch.state.roleReviews = { rounds: [{ node: 'n_roles', target: 'plan', pass: 1, round: 1, roles: [], conflicts: [{ id: 'conflict-1' }, { id: 'conflict-2' }] }] };
  assert.equal((await askedBy(orch)).plan.openConflicts, 2);
  const clean = createOrchestrator({ projectDir: gitDir('plan-noconf'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE });
  assert.equal(Object.hasOwn((await askedBy(clean)).plan, 'openConflicts'), false);
});

test('--yes never arms or decides a plan approval, even with the run marked', async () => {
  const dir = gitDir('plan-away');
  const clock = { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => {} };
  const armed = [];
  const h = start({ projectDir: dir, auto: true, nightMode: true, nightClock: clock });
  const orig = h.orch._nightArm.bind(h.orch);
  h.orch._nightArm = (q) => { armed.push(q); return orig(q); };
  await waitFor(() => h.plans.length === 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h.orch.pendingQuestion?.id, h.plans[0].id);
  assert.ok(!armed.some((q) => q?.kind === 'plan'), 'no Away arm for the plan ask');
  h.orch.answer(h.plans[0].id, { decision: 'approve' });
  assert.equal((await h.done).status, 'done');
});

test('pause while the plan is held, then resume: the same question comes back and nothing was built', async () => {
  const dir = gitDir('plan-resume');
  const h = start({ projectDir: dir });
  await waitFor(() => h.plans.length === 1);
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  assert.equal(ran(h.execs, 'n_impl').length, 0);

  const saved = readPipelineForResume(h.orch.getState().id);
  assert.deepEqual(saved.resumePoint.shape?.perspectives, SHAPE.perspectives);
  const questions = saved.state.shapeStats.questions;   // the pause persisted the recorded part

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.plans[0].id, 'plan-n_refine-1');
  assert.ok(ran(h2.execs, 'n_impl').length > 0);
  // rebuilt from row.shape_stats on resume, not counted twice
  assert.deepEqual(readPipelineForResume(h2.orch.getState().id).state.shapeStats.questions, questions);
});

/** Revise round 1 and pause in the same tick (F19), then wait for the feedback file. */
async function pauseDuringRevise(dir) {
  const h = start({ projectDir: dir }, (q, orch) => {
    orch.answer(q.id, { decision: 'revise', feedback: 'Cover the empty state.' });
    orch.pause();
  });
  assert.equal((await h.done).status, 'paused');
  const path = join(h.orch.pipeline.dir, 'plan-feedback-1.md');
  await waitFor(() => existsSync(path));
  return { h, path, saved: readPipelineForResume(h.orch.getState().id) };
}

test('pause in the same tick as a revise: the resume replays the feedback, round 1 is not asked again (F19)', async () => {
  const dir = gitDir('plan-revise-pause');
  const { path, saved } = await pauseDuringRevise(dir);
  assert.deepEqual(saved.resumePoint.planRevise, { id: 'plan-n_refine-1', path });

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h2.plans.map((q) => q.id), ['plan-n_refine-2'], 'round 1 is never re-asked');
  const rerun = h2.orch._graphSnapshot.execs.find((e) => e.nodeId === 'n_plan' && e.ordinal === 2);
  assert.ok(rerun, 'the planner ran again');
  assert.ok(rerun.bindings.revise.path.endsWith('plan-feedback-1.md'), 'with the feedback bound');
});

test('a replayed revise whose feedback file is gone asks round 1 again', async () => {
  const dir = gitDir('plan-revise-missing');
  const { path, saved } = await pauseDuringRevise(dir);
  await rm(path, { force: true });

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.plans[0].id, 'plan-n_refine-1');
});

test('a normal revise leaves no stash behind for the next round', async () => {
  let seen = null;
  const h = start({}, (q, orch) => {
    if (q.id === 'plan-n_refine-1') return orch.answer(q.id, { decision: 'revise', feedback: 'More tests.' });
    seen = { stash: orch._planRevise, rp: orch.state.resumePoint?.planRevise };
    orch.answer(q.id, { decision: 'approve' });
  });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(seen, { stash: null, rp: undefined });
});

test('a revise may change perspectives: the next ask, the state and the resume point carry the new list', async () => {
  const next = ['product', 'architect', 'security'];
  let rp = null;
  let shaping = null;
  const h = start({}, (q, orch) => {
    if (q.id === 'plan-n_refine-1') return orch.answer(q.id, { decision: 'revise', feedback: 'Threats.', perspectives: next });
    rp = orch.state.resumePoint?.shape?.perspectives;
    shaping = orch.state.shaping.perspectives;
    orch.answer(q.id, { decision: 'approve' });
  });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.plans[0].plan.perspectives, SHAPE.perspectives);
  assert.deepEqual(h.plans[1].plan.perspectives, next);
  assert.deepEqual(rp, next);
  assert.deepEqual(shaping, next);
});

test('state.shaping: rounds with the check, approved on approve, savedTo from recordPlanSaved', async () => {
  let atAsk = null;
  const h = start({}, (q, orch) => { atAsk = orch.getState().shaping; orch.answer(q.id, { decision: 'approve' }); });
  assert.equal((await h.done).status, 'done');
  const q = h.plans[0];
  assert.deepEqual(atAsk.perspectives, SHAPE.perspectives);
  assert.deepEqual(atAsk.rounds, [{ round: 1, file: q.plan.file, passed: q.plan.check.passed, total: 8, decision: null }]);
  assert.equal(atAsk.approved, null);
  const s = h.orch.getState().shaping;
  assert.equal(s.rounds[0].decision, 'approve');
  assert.deepEqual(s.approved, { round: 1, file: q.plan.file });
  assert.equal(s.savedTo, null);
  assert.equal(h.orch.recordPlanSaved('plans/demo.md'), true);
  assert.equal(h.orch.getState().shaping.savedTo, 'plans/demo.md');
});

test('a re-raised round replaces its row and drops a stale approved', () => {
  const orch = createOrchestrator({ projectDir: gitDir('plan-reraise'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE });
  const q = { plan: { round: 1, file: '/p/plan.md' } };
  orch._shapingRound(q, { passed: 3, total: 8 });
  orch.state.shaping.approved = { round: 1, file: '/p/plan.md' };
  orch._shapingRound(q, { passed: 4, total: 8 });
  assert.equal(orch.state.shaping.approved, null);
  assert.deepEqual(orch.state.shaping.rounds, [{ round: 1, file: '/p/plan.md', passed: 4, total: 8, decision: null }]);
});

test('an unshaped run of a copy of wf_shape never holds (D12)', async () => {
  const wf = await writeGraphWorkflow({ id: 'wf_shape_copy', name: 'Shape copy', nodes: GRAPH_SHAPE_WORKFLOW.nodes, wires: GRAPH_SHAPE_WORKFLOW.wires });
  const h = start({ workflowId: wf.id || 'wf_shape_copy', shape: undefined });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.plans.length, 0);
  assert.ok(ran(h.execs, 'n_impl').length > 0);
  assert.equal('shaping' in h.orch.getState(), false, 'a non-shaped run has no shaping state');
  assert.equal(readPipelineForResume(h.orch.getState().id).state.shapeStats, undefined);
});

test('D28: an approved shaped run records shapeStats; a fixed plan never adds a round', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  const res = await h.done;
  assert.equal(res.status, 'done');
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1']);
  assert.ok(Array.isArray(h.plans[0].plan.check.fixed));
  const { state, row } = readPipelineForResume(h.orch.getState().id);
  const ss = state.shapeStats;
  assert.equal(ss.questions.skipped, ss.questions.asked);
  assert.ok(ss.questions.asked <= 3);
  assert.deepEqual(ss.revises, []);
  const c = h.plans[0].plan.check;
  assert.equal(ss.shapeScore, Math.round((c.passed / c.total) * 1000) / 1000);
  assert.ok(ss.reviewCycles >= 1);
  assert.equal(ss.checklist, null);
  // shaping and building are rounded separately, so allow one rounding step against the total
  assert.ok(Math.abs(ss.cost.shaping + ss.cost.building - state.totalCostUsd) < 1e-3);
  assert.ok(row.run_size === null || ['small', 'medium', 'large'].includes(row.run_size));
});

test('D28: a person revise and a check revise are recorded by round', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, q.id === 'plan-n_refine-1'
    ? { decision: 'revise', feedback: 'Name the table.' }
    : q.id === 'plan-n_refine-2' ? { decision: 'revise', feedback: 'Fix the check.', source: 'check' } : { decision: 'approve' }));
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const { state } = readPipelineForResume(h.orch.getState().id);
  assert.deepEqual(state.shapeStats.revises, [{ round: 1, by: 'person' }, { round: 2, by: 'check' }]);
});

test('a shaped run with checklists: the reviewer reports the plan items, the rows keep them, results.json tallies the last (spec D7)', async () => {
  const h = start({}, (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const id = h.orch.getState().id;
  const impl = readPipelineExtras(id).reviews.filter((r) => r.kind === 'impl');
  assert.deepEqual(impl.map((r) => r.cycle), [1, 2], 'the checklist adds no cycle (C10)');
  const [c1, c2] = impl;
  assert.deepEqual(c1.checklist.map((c) => [c.id, c.status]), [['R-arch-1', 'unmet'], ['R-qa-1', 'met']]);
  for (const c of c1.checklist) assert.ok(c.perspective && c.text, 'the merged row keeps perspective and text');
  assert.ok(c1.issues.some((i) => i.severity === 'major' && i.title.startsWith('R-arch-1 not met')));
  assert.deepEqual(c2.checklist.map((c) => [c.id, c.status]), [['R-arch-1', 'met'], ['R-qa-1', 'na']]);
  assert.equal(hasBlocking(c2), false);
  const results = JSON.parse(await readFile(join(h.orch.pipeline.dir, 'results.json'), 'utf8'));
  assert.deepEqual(results.checklist, { met: 1, unmet: 0, na: 1, missing: 0, total: 2, cycle: 2 });
});

test('the unshaped copy of wf_shape stores no checklist and results.json has none (spec D7)', async () => {
  const wf = await writeGraphWorkflow({ id: 'wf_shape_copy_cl', name: 'Shape copy', nodes: GRAPH_SHAPE_WORKFLOW.nodes, wires: GRAPH_SHAPE_WORKFLOW.wires });
  const h = start({ workflowId: wf.id || 'wf_shape_copy_cl', shape: undefined });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const rows = readPipelineExtras(h.orch.getState().id).reviews.filter((r) => r.kind === 'impl');
  assert.ok(rows.length > 0);
  for (const r of rows) assert.equal(Object.hasOwn(r, 'checklist'), false);
  const results = JSON.parse(await readFile(join(h.orch.pipeline.dir, 'results.json'), 'utf8'));
  assert.equal(Object.hasOwn(results, 'checklist'), false);
});

// ── Shaper small runs B1: the marker stamped on the planning run when it starts (D1), and the requirements line (D6) ──
/** Runs `fn` with WORCA_FLAGS set to `shaperSmallRuns` (on) or unset (off), restoring it afterwards. */
async function withSmallRuns(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
}
const setFlag = (on) => { if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS; };
const statsOf = (pid) => JSON.parse(getDb().prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(pid)?.shape_stats || 'null');
const approveAll = (q, orch) => orch.answer(q.id, { decision: 'approve' });
const auditOf = (pid) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid).map((r) => r.text);
/** A finished shaped run, stamped or not, and a feature whose origin it is. */
async function featureFrom(on) {
  const dir = gitDir(`b1-origin-${on ? 'on' : 'off'}`);
  const h = await withSmallRuns(on, async () => { const x = start({ projectDir: dir }, approveAll); await x.done; return x; });
  const pid = h.orch.getState().id;
  const f = createSliceFeature({ pipelineId: pid, projectDir: dir, title: 'T', outline: MOCK_OUTLINE, perspectives: SHAPE.perspectives, workflowId: 'wf_shape' });
  return { pid, f, dir };
}

test('B1 stamp: a shaped run started with the flag on records smallRuns: true; with it off, no key', async () => {
  for (const on of [true, false]) {
    const h = await withSmallRuns(on, async () => { const x = start({ projectDir: gitDir(`b1-stamp-${on}`) }, approveAll); assert.equal((await x.done).status, 'done'); return x; });
    const stats = statsOf(h.orch.getState().id);
    if (on) assert.equal(stats.smallRuns, true, 'stamped');
    else assert.equal(Object.hasOwn(stats, 'smallRuns'), false, 'no key with the flag off');
  }
});

test('B1 stamp: a re-plan run of a marked feature is stamped with the flag off; of an unmarked one it is not', async () => {
  for (const marked of [true, false]) {
    const { f } = await featureFrom(marked);
    const h = await withSmallRuns(false, async () => {
      const x = start({ projectDir: gitDir(`b1-replan-${marked}`), shape: { ...SHAPE, replaces: f.id } }, approveAll); await x.done; return x;
    });
    assert.equal(statsOf(h.orch.getState().id).smallRuns === true, marked);
  }
});

test('B1 stamp: a re-plan run of an unmarked feature started with the flag ON is not stamped (it inherits only)', async () => {
  const { f } = await featureFrom(false);
  const h = await withSmallRuns(true, async () => {
    const x = start({ projectDir: gitDir('b1-replan-unmarked-on'), shape: { ...SHAPE, replaces: f.id } }, approveAll); await x.done; return x;
  });
  assert.equal(Object.hasOwn(statsOf(h.orch.getState().id), 'smallRuns'), false);
});

test('B1 stamp: a slice run is never stamped, even with the flag on', async () => {
  const { f, dir } = await featureFrom(true);
  const shape = { ...SHAPE, slices: 'off', slice: { feature: f.id, index: 2, total: 2, outline: MOCK_OUTLINE } };
  const h = await withSmallRuns(true, async () => { const x = start({ projectDir: dir, prompt: 'demo', shape }, approveAll); await x.done; return x; });
  assert.equal(Object.hasOwn(statsOf(h.orch.getState().id), 'smallRuns'), false);
});

test('B1 stamp: a resume after the flag flips keeps the stamp it started with, and never gains one', async () => {
  for (const on of [true, false]) {
    const dir = gitDir(`b1-resume-${on}`);
    const prev = process.env.WORCA_FLAGS;
    try {
      setFlag(on);
      const h = start({ projectDir: dir });
      await waitFor(() => h.plans.length === 1);
      h.orch.pause();
      assert.equal((await h.done).status, 'paused');
      setFlag(!on);
      const saved = readPipelineForResume(h.orch.getState().id);
      const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, approveAll);
      assert.equal((await h2.done).status, 'done');
      assert.equal(statsOf(h2.orch.getState().id).smallRuns === true, on, `started with the flag ${on ? 'on' : 'off'}`);
    } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
  }
});

test('B1 audit: a real requirements ask answered via answer() writes "Requirements approval **approve**" only on a marked run', async () => {
  const lines = {};
  for (const on of [true, false]) {
    const req = resolveShapeRequest({ shape: { size: 'large', lead: 'security' } }, {});
    assert.equal(req.ok, true, req.error);
    const asks = [];
    const res = await withSmallRuns(on, async () => {
      const orch = createOrchestrator({ projectDir: gitDir(`b1-req-${on}`), workflowId: req.workflowId, prompt: 'demo', claude: { mock: true }, shape: req.shape });
      orch.on('question', (q) => {
        asks.push(q);
        if (q.kind === 'care') setImmediate(() => pickCare(q, orch));
        else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
        else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
      });
      const r = await orch.run();
      return { r, pid: orch.getState().id };
    });
    assert.equal(res.r.status, 'done', res.r.error);
    assert.ok(asks.some((q) => q.kind === 'plan' && (q.plan?.criteria || q.plan?.error)), 'a real requirements ask was raised');
    lines[on] = auditOf(res.pid);
  }
  const count = (texts, head) => texts.filter((t) => t.startsWith(head)).length;
  assert.equal(count(lines.true, 'Requirements approval **approve**'), 1, 'marked: the requirements line');
  assert.equal(count(lines.false, 'Requirements approval'), 0, 'unmarked: dev\'s lines');
  assert.equal(count(lines.false, 'Plan approval **approve**'), count(lines.true, 'Plan approval **approve**') + 1,
    'the requirements approval is the one line that changed');
});

test('B1 audit: an outline ask\'s line is unchanged with the marker', async () => {
  const lines = {};
  for (const on of [true, false]) {
    const res = await withSmallRuns(on, async () => {
      const orch = createOrchestrator({ projectDir: gitDir(`b1-outline-${on}`), workflowId: 'wf_shape', prompt: 'Plan this in slices: demo', claude: { mock: true }, shape: SHAPE });
      orch.on('question', (q) => {
        if (q.kind === 'care') setImmediate(() => pickCare(q, orch));
        else if (q.kind === 'plan' && q.plan?.outline) setImmediate(() => orch.answer(q.id, { decision: 'stop' }));
        else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
        else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
      });
      const r = await orch.run();
      return { r, pid: orch.getState().id };
    });
    assert.equal(statsOf(res.pid).smallRuns === true, on);
    lines[on] = auditOf(res.pid).filter((t) => t.startsWith('Slice outline'));
  }
  assert.deepEqual(lines.true, ['Slice outline **stop** (round 1).']);
  assert.deepEqual(lines.true, lines.false);
});

// ── Shaper small runs B2: the Start step (the Care ask), saved with the planning run, fixed after Start ──
import { writeFileSync, mkdirSync } from 'node:fs';
import { careOfPipeline } from '../src/core/shape/small-runs.mjs';
import { careOfRow } from '../src/shared/shape/feature-record.mjs';

const ROLES = { deep: { model: 'claude-sonnet-5' }, everyday: { model: 'claude-haiku-4-5' }, quick: { model: 'claude-haiku-4-5' } };
/** Runs `fn` with the flag on and the install roles of the fixture, restoring both. */
async function marked(fn) {
  const file = join(sandboxHome, '.worca-cc', 'settings.json');
  mkdirSync(join(sandboxHome, '.worca-cc'), { recursive: true });
  writeFileSync(file, JSON.stringify({ modelRoles: { claude: ROLES } }));
  try { return await withSmallRuns(true, fn); } finally { writeFileSync(file, '{}'); }
}
const PAY = 'take payments';            // no size: Worca picks Thorough ("it touches payments, and its size is not known")
const answerCare = (position, extra = {}) => (q, orch) => orch.answer(q.id, { care: { position, ...extra } });
const careAudit = (pid) => auditOf(pid).filter((t) => t.startsWith('Care **'));
const cellsOf = (orch) => Object.fromEntries(orch.getState().stepper.graph.nodes.filter((c) => c.kind === 'agent').map((c) => [c.id, c.model]));

test('B2: a marked run raises exactly 1 care ask, before Clarify, with care on the frame; an unmarked run raises none', async () => {
  const on = await marked(async () => { const h = start({ projectDir: gitDir('b2-ask-on'), prompt: PAY }, approveAll); await h.done; return h; });
  const kinds = on.asked.map((q) => q.kind);
  assert.equal(kinds.filter((k) => k === 'care').length, 1);
  assert.equal(kinds[0], 'care', `the Start step comes first: ${kinds}`);
  const q = on.asked[0];
  assert.equal(q.id, 'care-1');
  assert.equal(q.care.pick.position, 'thorough');
  assert.deepEqual(Object.keys(q.care.positions), ['lean', 'balanced', 'thorough']);
  const off = await withSmallRuns(false, async () => { const h = start({ projectDir: gitDir('b2-ask-off'), prompt: PAY }, approveAll); await h.done; return h; });
  assert.equal(off.asked.filter((x) => x.kind === 'care').length, 0);
  assert.equal(Object.hasOwn(statsOf(off.orch.getState().id), 'care'), false);
});

test('B2: answering Lean under a Thorough pick stores chosenBy person with the pick, one audit line, and fills every Default agent with the everyday model', async () => {
  const h = await marked(async () => { const x = start({ projectDir: gitDir('b2-lean'), prompt: PAY, onCare: answerCare('lean') }, approveAll); assert.equal((await x.done).status, 'done'); return x; });
  const pid = h.orch.getState().id;
  const care = statsOf(pid).care;
  assert.deepEqual([care.position, care.chosenBy, care.worcaPick], ['lean', 'person', 'thorough']);
  assert.equal(care.reason, h.asked[0].care.pick.reason);
  assert.deepEqual(careOfPipeline(pid), care);
  assert.deepEqual(careAudit(pid), ["Care **lean** · Worca's pick **thorough**."]);
  for (const [id, model] of Object.entries(cellsOf(h.orch))) assert.equal(model, ROLES.everyday.model, id);
  assert.equal(h.orch.getState().stepper.careFill.position, 'lean');
});

test('B2: a Care fill adopted after the start resolve leaves every filled node with modelSource care, in the cell and in nodeCtx; a cliDecides mapping leaves cli-decides', async () => {
  const sourcesOf = (orch) => {
    const cells = Object.fromEntries(orch.getState().stepper.graph.nodes.filter((c) => c.kind === 'agent').map((c) => [c.id, c.modelSource]));
    const live = Object.fromEntries(Object.keys(cells).map((id) => [id, orch.resolved.nodeCtx[id]?.modelSource]));
    return { cells, live };
  };
  // _careOriginGraph re-resolves after the adopt and would mask a stale source; stub it so the adopt alone is checked.
  const adoptOnly = (h) => { h.orch._careOriginGraph = async () => {}; return h; };
  const lean = await marked(async () => { const x = adoptOnly(start({ projectDir: gitDir('b2-src-lean'), prompt: PAY, onCare: answerCare('lean') }, approveAll)); assert.equal((await x.done).status, 'done'); return x; });
  const fillable = lean.orch.getState().stepper.careFill.fillable;
  assert.ok(fillable.length > 0);
  const a = sourcesOf(lean.orch);
  for (const id of fillable) { assert.equal(a.cells[id], 'care', `cell ${id}`); assert.equal(a.live[id], 'care', `nodeCtx ${id}`); }
  // Thorough maps deep → deep; deep stored as "Let Claude Code decide" leaves those nodes with no model, never a floor.
  const file = join(sandboxHome, '.worca-cc', 'settings.json');
  const cli = await withSmallRuns(true, async () => {
    writeFileSync(file, JSON.stringify({ modelRoles: { claude: { ...ROLES, deep: { cliDecides: true } } } }));
    try { const x = adoptOnly(start({ projectDir: gitDir('b2-src-cli'), prompt: PAY, onCare: answerCare('thorough') }, approveAll)); assert.equal((await x.done).status, 'done'); return x; }
    finally { writeFileSync(file, '{}'); }
  });
  const b = sourcesOf(cli.orch);
  const cells = cellsOf(cli.orch);
  for (const id of cli.orch.getState().stepper.careFill.fillable) assert.ok(['care', 'cli-decides'].includes(b.cells[id]), `${id}: ${b.cells[id]}`);
  const cliIds = cli.orch.getState().stepper.careFill.fillable.filter((id) => b.cells[id] === 'cli-decides');
  assert.ok(cliIds.length > 0, `some fillable node maps to the cliDecides role: ${JSON.stringify(b.cells)}`);
  for (const id of cliIds) { assert.equal(b.live[id], 'cli-decides', `nodeCtx ${id}`); assert.equal(cells[id], '', `cell model ${id}`); }
});

test('B2: a Lean marked run whose review runs out stops at the gate and continues on the answer', async () => {
  const h = await marked(async () => { const x = start({ projectDir: gitDir('b2-lean-gate'), prompt: PAY, onCare: answerCare('lean') }, approveAll); return { x, res: await x.done }; });
  const gate = h.x.asked.find((q) => q.kind === 'gate');
  assert.ok(gate, `a gate ask was raised: ${h.x.asked.map((q) => q.kind)}`);
  assert.ok(gate.stop, 'the gate carries a stop');
  assert.equal(h.res.status, 'done', h.res.error);
});

test('B2: answering the pick stores chosenBy default', async () => {
  const h = await marked(async () => { const x = start({ projectDir: gitDir('b2-pick'), prompt: PAY }, approveAll); await x.done; return x; });
  const care = statsOf(h.orch.getState().id).care;
  assert.deepEqual([care.position, care.chosenBy, care.worcaPick], ['thorough', 'default', 'thorough']);
  assert.equal(cellsOf(h.orch).n_plan, ROLES.deep.model, 'Thorough keeps the deep model on planning');
});

test('B2: a bad position throws INVALID_ANSWER and leaves shape_stats without care; the question stays open', async () => {
  let refused = null;
  const h = await marked(async () => {
    const x = start({ projectDir: gitDir('b2-bad'), prompt: PAY, onCare: (q, orch) => {
      try { orch.answer(q.id, { care: { position: 'max' } }); } catch (err) { refused = err; }
      assert.equal(orch.pendingQuestion?.id, q.id, 'still open');
      assert.equal(Object.hasOwn(statsOf(orch.getState().id) || {}, 'care'), false);
      orch.answer(q.id, { care: { position: 'balanced' } });
    } }, approveAll);
    await x.done; return x;
  });
  assert.equal(refused?.code, 'INVALID_ANSWER');
  assert.deepEqual(refused.errors, [{ field: 'care', message: 'Care must be Lean, Balanced or Thorough.' }]);
  assert.equal(statsOf(h.orch.getState().id).care.position, 'balanced');
});

test('B2: a client-sent worcaPick and chosenBy are ignored', async () => {
  const h = await marked(async () => {
    const x = start({ projectDir: gitDir('b2-client'), prompt: PAY, onCare: answerCare('lean', { worcaPick: 'lean', chosenBy: 'default', reason: 'mine' }) }, approveAll);
    await x.done; return x;
  });
  const care = statsOf(h.orch.getState().id).care;
  assert.deepEqual([care.worcaPick, care.chosenBy], ['thorough', 'person']);
  assert.notEqual(care.reason, 'mine');
});

test('B2: --yes stores the pick with chosenBy default and exactly one audit line', async () => {
  const h = await marked(async () => { const x = start({ projectDir: gitDir('b2-yes'), prompt: PAY, auto: true, onCare: () => {} }, approveAll); await x.done; return x; });
  const pid = h.orch.getState().id;
  assert.deepEqual([statsOf(pid).care.position, statsOf(pid).care.chosenBy], ['thorough', 'default']);
  assert.deepEqual(careAudit(pid), ["Care **thorough** · Worca's pick **thorough**."]);
});

test('B2: an Away-owned --yes marked run passes Start with chosenBy default', async () => {
  const h = await marked(async () => {
    const x = start({ projectDir: gitDir('b2-away'), prompt: PAY, auto: true, nightMode: true, onCare: () => {} }, approveAll);
    assert.equal((await x.done).status, 'done'); return x;
  });
  const pid = h.orch.getState().id;
  assert.deepEqual([statsOf(pid).care.position, statsOf(pid).care.chosenBy], ['thorough', 'default']);
  assert.equal(careAudit(pid).length, 1);
});

test('B2: an overlay model survives pause at S0 and a Lean answer; the other Default agents get the everyday model', async () => {
  const dir = gitDir('b2-s0-overlay');
  await marked(async () => {
    const h = start({ projectDir: dir, prompt: PAY, overlay: { nodes: { n_roles: { model: 'claude-opus-5' } } }, onCare: (q, orch) => orch.pause() });
    assert.equal((await h.done).status, 'paused');
    const saved = readPipelineForResume(h.orch.getState().id);
    assert.equal(saved.resumePoint.snapshot, null, 'no node ran');
    assert.deepEqual(saved.resumePoint.manifest.careFill.kept.run, ['n_roles']);
    const h2 = start({ projectDir: dir, resume: saved, shape: undefined, onCare: answerCare('lean') }, approveAll);
    assert.equal((await h2.done).status, 'done');
    assert.equal(h2.asked.filter((q) => q.kind === 'care').length, 1, 'a pause while S0 is open resumes with exactly 1 care ask');
    const cells = cellsOf(h2.orch);
    assert.equal(cells.n_roles, 'claude-opus-5');
    for (const id of ['n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review']) assert.equal(cells[id], ROLES.everyday.model, id);
    assert.equal(h2.orch.getState().stepper.careFill.kept.run.length, 1);
  });
});

test('B2: answer, pause and resume keeps the Care deep-equal and raises no more care asks', async () => {
  const dir = gitDir('b2-resume');
  await marked(async () => {
    const h = start({ projectDir: dir, prompt: PAY, onCare: answerCare('lean') });
    await waitFor(() => h.plans.length === 1);
    h.orch.pause();
    assert.equal((await h.done).status, 'paused');
    const pid = h.orch.getState().id;
    const before = statsOf(pid).care;
    const h2 = start({ projectDir: dir, resume: readPipelineForResume(pid), shape: undefined }, approveAll);
    assert.equal((await h2.done).status, 'done');
    assert.equal(h2.asked.filter((q) => q.kind === 'care').length, 0);
    assert.deepEqual(statsOf(pid).care, before);
    assert.deepEqual(careOfPipeline(pid), before);
  });
});

test('B2: answer() then pause() in the same tick, then resume: Care is saved and no care ask is raised', async () => {
  const dir = gitDir('b2-answer-pause');
  await marked(async () => {
    const h = start({ projectDir: dir, prompt: PAY, onCare: (q, orch) => { orch.answer(q.id, { care: { position: 'lean' } }); orch.pause(); } });
    assert.equal((await h.done).status, 'paused');
    const pid = h.orch.getState().id;
    assert.equal(statsOf(pid).care.position, 'lean');
    const h2 = start({ projectDir: dir, resume: readPipelineForResume(pid), shape: undefined }, approveAll);
    assert.equal((await h2.done).status, 'done');
    assert.equal(h2.asked.filter((q) => q.kind === 'care').length, 0);
    assert.equal(cellsOf(h2.orch).n_plan, ROLES.everyday.model);
  });
});

test('B2: Care saved without careFill.position re-adopts the fill once on resume', async () => {
  const dir = gitDir('b2-readopt');
  await marked(async () => {
    const h = start({ projectDir: dir, prompt: PAY, onCare: answerCare('lean') });
    h.orch._adoptCareFill = async () => { h.orch.pause(); };     // a stop between the answer and the manifest patch
    assert.equal((await h.done).status, 'paused');
    const pid = h.orch.getState().id;
    const saved = readPipelineForResume(pid);
    assert.equal(statsOf(pid).care.position, 'lean');
    assert.equal(saved.resumePoint.manifest.careFill.position, undefined);
    assert.equal(saved.resumePoint.manifest.graph.nodes.find((c) => c.id === 'n_plan').model, ROLES.deep.model);
    const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, approveAll);
    assert.equal((await h2.done).status, 'done');
    assert.equal(h2.asked.filter((q) => q.kind === 'care').length, 0);
    assert.equal(cellsOf(h2.orch).n_plan, ROLES.everyday.model);
    assert.equal(h2.orch.getState().stepper.careFill.position, 'lean');
  });
});

test('B2: a re-plan copies the feature\'s Care and asks nothing', async () => {
  const { f } = await featureFrom(true);
  getDb().prepare('UPDATE shape_features SET care = ?, care_chosen_by = ?, care_worca_pick = ? WHERE id = ?').run('lean', 'person', 'thorough', f.id);
  const h = await marked(async () => { const x = start({ projectDir: gitDir('b2-replan'), prompt: PAY, shape: { ...SHAPE, replaces: f.id } }, approveAll); await x.done; return x; });
  assert.equal(h.asked.filter((q) => q.kind === 'care').length, 0);
  const care = statsOf(h.orch.getState().id).care;
  assert.deepEqual([care.position, care.chosenBy, care.worcaPick], ['lean', 'person', 'thorough']);
  assert.equal(cellsOf(h.orch).n_plan, ROLES.everyday.model);
  assert.deepEqual(careAudit(h.orch.getState().id), ["Care **lean** · Worca's pick **thorough**."], 'the copy writes one Care audit line');
});

test('B2: a slice run of a marked Lean feature resolves with the saved Care (every Default agent on everyday) and asks nothing; of an unmarked one it is untouched', async () => {
  for (const isMarked of [true, false]) {
    const { f, dir } = await featureFrom(isMarked);
    getDb().prepare('UPDATE shape_features SET care = ?, care_chosen_by = ?, care_worca_pick = ? WHERE id = ?').run('lean', 'person', 'thorough', f.id);
    const shape = { ...SHAPE, slices: 'off', slice: { feature: f.id, index: 2, total: 2, outline: MOCK_OUTLINE } };
    const h = await marked(async () => { const x = start({ projectDir: dir, prompt: 'demo', shape }, approveAll); assert.equal((await x.done).status, 'done'); return x; });
    assert.equal(h.asked.filter((q) => q.kind === 'care').length, 0, 'a slice run has no Start step');
    const cells = cellsOf(h.orch);
    if (isMarked) for (const [id, model] of Object.entries(cells)) assert.equal(model, ROLES.everyday.model, id);
    else assert.equal(cells.n_plan, ROLES.deep.model, 'an unmarked feature keeps the role defaults');
  }
});

test('B2: the split writes the saved Care onto the feature row', async () => {
  const h = await marked(async () => {
    const orch = createOrchestrator({ projectDir: gitDir('b2-split'), workflowId: 'wf_shape', prompt: `Plan this in slices: ${PAY}`, claude: { mock: true }, shape: SHAPE });
    orch.on('question', (q) => {
      if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position: 'lean' } }));
      else if (q.kind === 'plan' && q.plan?.outline) setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
      else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
      else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
      else if (q.kind === 'gate') setImmediate(() => orch.answer(q.id, { decision: 'continue' }));
    });
    await orch.run();
    return { orch };
  });
  const row = getDb().prepare('SELECT care, care_chosen_by, care_worca_pick FROM shape_features WHERE origin_pipeline_id = ?').get(h.orch.getState().id);
  assert.ok(row, 'a feature was created');
  assert.deepEqual(careOfRow(row), { position: 'lean', chosenBy: 'person', worcaPick: 'thorough' });
});
