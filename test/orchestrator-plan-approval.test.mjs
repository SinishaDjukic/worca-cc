// test/orchestrator-plan-approval.test.mjs — the `plan` ask on a shaped run: hold, approve / revise / stop,
// --yes and Away exclusion, resume while held, and the unshaped run that never holds (shape-it-first D2, D12).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { GRAPH_SHAPE_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

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

/** Start a mock run. Clarify asks are answered with no answers; plan asks go to `onPlan(q, orch)`. */
function start(opts = {}, onPlan = () => {}) {
  const dir = opts.projectDir || gitDir('plan');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  const plans = [];
  const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    if (q.kind === 'plan') { plans.push(q); setImmediate(() => onPlan(q, orch)); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, plans, execs, done, dir };
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

test('Away mode never arms or decides a plan approval', async () => {
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

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined }, (q, orch) => orch.answer(q.id, { decision: 'approve' }));
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.plans[0].id, 'plan-n_refine-1');
  assert.ok(ran(h2.execs, 'n_impl').length > 0);
});

test('an unshaped run of a copy of wf_shape never holds (D12)', async () => {
  const wf = await writeGraphWorkflow({ id: 'wf_shape_copy', name: 'Shape copy', nodes: GRAPH_SHAPE_WORKFLOW.nodes, wires: GRAPH_SHAPE_WORKFLOW.wires });
  const h = start({ workflowId: wf.id || 'wf_shape_copy', shape: undefined });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.plans.length, 0);
  assert.ok(ran(h.execs, 'n_impl').length > 0);
});
