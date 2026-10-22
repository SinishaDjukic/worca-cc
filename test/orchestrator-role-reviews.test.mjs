// test/orchestrator-role-reviews.test.mjs — role reviews (spec §3) end to end on the real orchestrator in mock mode:
// one planReviewer slice per picked perspective, in parallel, each with its own brief; one refiner per round on all
// findings; at most 2 rounds, then the plan approval; the round-2 skip; resume; "Ask for changes"; an old manifest.
// It needs the orchestrator and a git dir (no browser, no server).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { GRAPH_SHAPE_WORKFLOW, GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_ROLE_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-roles-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
});
afterEach(() => { delete process.env.WORCA_MOCK_ROLE_REVIEW; _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SHAPE = { perspectives: ['product', 'ux', 'qa'] };
const waitFor = async (pred, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('waitFor timed out');
};
const severities = (table) => { process.env.WORCA_MOCK_ROLE_REVIEW = JSON.stringify(table); };

/** A mock wf_shape run; Clarify answers empty, plan asks go to `onPlan(q, orch)` (default: approve). */
function start(opts = {}, onPlan = (q, orch) => orch.answer(q.id, { decision: 'approve' }), onClarify = null) {
  const dir = opts.projectDir || gitDir('roles');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  const plans = []; const execs = []; const asks = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'plan') { plans.push(q); setImmediate(() => onPlan(q, orch)); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') {
      setImmediate(() => (onClarify ? onClarify(q, orch) : orch.answer(q.id, { answers: [] })));
    }
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, plans, execs, asks, done, dir };
}
const shells = (execs, nodeId, status = 'start') => execs.filter((e) => e.nodeId === nodeId && e.kind !== 'task' && e.status === status);
const slices = (execs, status = 'start') => execs.filter((e) => e.nodeId === 'n_roles' && e.kind === 'task' && e.status === status);
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);

test('1-3 one round: 3 parallel reviewers, each with only its own brief; Refine runs once on all their findings', async () => {
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);

  // 1. parallel: every slice start precedes the first slice done; Refine starts after the last slice done
  const idx = (e) => h.execs.indexOf(e);
  const starts = slices(h.execs, 'start');
  const dones = slices(h.execs, 'done');
  assert.equal(starts.length, 3);
  assert.deepEqual(starts.map((e) => e.title), ['Product', 'QA', 'UX'], 'titled by perspective, in perspective order');
  assert.ok(Math.max(...starts.map(idx)) < Math.min(...dones.map(idx)), 'all 3 start before any finishes');
  assert.ok(idx(shells(h.execs, 'n_refine')[0]) > Math.max(...dones.map(idx)), 'Refine waits for every reviewer');

  // 2. own brief only
  const reviewerPrompts = prompts.filter((p) => /^MOCK_ROLE: plan-review$/m.test(p));
  assert.equal(reviewerPrompts.length, 3);
  for (const p of reviewerPrompts) {
    const heads = [...p.matchAll(/^## Your role: (.+)$/gm)].map((m) => m[1]);
    const key = /^MOCK_PERSPECTIVE: (\S+)$/m.exec(p)[1];
    assert.deepEqual(heads, [{ product: 'Product', ux: 'UX', qa: 'QA' }[key]]);
  }
  const ux = reviewerPrompts.find((p) => /^MOCK_PERSPECTIVE: ux$/m.test(p));
  assert.match(ux, /`R-ux-1`/);
  assert.doesNotMatch(ux, /`R-qa-1`/);

  // 3. one refiner on the merged findings and on the plan the reviewers read
  assert.equal(shells(h.execs, 'n_refine').length, 1);
  assert.equal(shells(h.execs, 'n_roles').length, 1, 'no blocker: one round');
  const snapExecs = h.orch._graphSnapshot.execs;
  const ref = snapExecs.find((e) => e.nodeId === 'n_refine' && e.ordinal === 1);
  const roles = snapExecs.find((e) => e.nodeId === 'n_roles' && e.ordinal === 1 && e.kind !== 'task');
  assert.equal(ref.bindings.plan.path, roles.bindings.plan.path);
  const findings = await readFile(ref.bindings.findings.path, 'utf8');
  for (const s of ['Product', 'UX', 'QA']) assert.match(findings, new RegExp(`^## ${s}$`, 'm'));
  assert.equal(h.plans.length, 1);

  // 7. state + reviews rows
  const rr = h.orch.state.roleReviews;
  assert.deepEqual(rr.rounds.map((r) => [r.pass, r.round]), [[1, 1]]);
  const kinds = getDb().prepare('SELECT kind FROM reviews WHERE pipeline_id = ?').all(h.orch.getState().id).map((r) => r.kind);
  for (const k of ['role-product', 'role-ux', 'role-qa']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
});

test('4-5 a round-1 critical earns round 2, which starts only the blocked role; then the approval, no gate', async () => {
  severities({ ux: { 1: 'critical' } });
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(shells(h.execs, 'n_roles').length, 2);
  assert.equal(shells(h.execs, 'n_refine').length, 2);
  const round2 = slices(h.execs).filter((e) => e.executionId.startsWith('x:n_roles:2:'));
  assert.deepEqual(round2.map((e) => e.title), ['UX'], 'product and qa make 0 agent calls in round 2');
  assert.equal(h.asks.filter((a) => a.kind === 'gate').length, 0);
  assert.equal(h.plans.length, 1);
  const rr = h.orch.state.roleReviews;
  assert.deepEqual(rr.rounds.map((r) => [r.pass, r.round]), [[1, 1], [1, 2]]);
  assert.deepEqual(rr.rounds[1].roles.filter((r) => r.skipped).map((r) => r.key), ['product', 'qa']);
  assert.equal(rr.rounds[0].roles.find((r) => r.key === 'ux').findings[0].status, 'fixed', 'the mock refiner addressed it');
});

test('6 critical in both rounds: exactly 2 rounds, then the approval with a forced token and the open issues', async () => {
  severities({ product: { 1: 'critical', 2: 'critical' }, ux: { 1: 'critical', 2: 'critical' }, qa: { 1: 'critical', 2: 'critical' } });
  let atAsk = null;
  const h = start({}, (q, orch) => {
    atAsk = orch._graphSnapshot.outputs['n_refine.plan'];
    orch.answer(q.id, { decision: 'approve' });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(shells(h.execs, 'n_roles').length, 2, 'never a 3rd round');
  assert.equal(h.asks.filter((a) => a.kind === 'gate').length, 0, 'no gate ask');
  assert.equal(h.plans.length, 1);
  assert.equal(atAsk.forced, true);
  assert.ok(atAsk.meta.issues.length > 0);
  assert.ok(auditOf(h.orch).some((t) => /Loop on wire w5 \(n_refine\) spent after its last round: sent to approval with \d+ open issue/.test(t)));
  assert.ok(!auditOf(h.orch).some((t) => /the user chose \*\*exhausted\*\*/.test(t)));
});

test('8 pause while round 2\'s slice runs: the resume keeps round 1 and re-runs only the ux slice', async () => {
  severities({ ux: { 1: 'critical' } });
  const dir = gitDir('roles-resume');
  const h = start({ projectDir: dir });
  await waitFor(() => slices(h.execs).some((e) => e.executionId.startsWith('x:n_roles:2:')));
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.deepEqual(saved.resumePoint.roleReviews.rounds.map((r) => r.round), [1]);

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(slices(h2.execs).map((e) => e.title), ['UX']);
  const rr = h2.orch.state.roleReviews;
  assert.deepEqual(rr.rounds.map((r) => [r.pass, r.round]), [[1, 1], [1, 2]]);
  assert.equal(h2.plans.length, 1);
});

test('9 Ask for changes: the Planner re-runs, then a new pass reviews it at round 1 with every role and no revise', async () => {
  severities({ ux: { 1: 'critical' } });
  const h = start({}, (q, orch) => {
    if (q.id === 'plan-n_refine-1') orch.answer(q.id, { decision: 'revise', feedback: 'Cover the empty state.' });
    else orch.answer(q.id, { decision: 'approve' });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1', 'plan-n_refine-2']);
  assert.equal(shells(h.execs, 'n_plan', 'done').length, 2);
  const third = h.orch._graphSnapshot.execs.find((e) => e.nodeId === 'n_roles' && e.ordinal === 3 && e.kind !== 'task');
  assert.ok(third, 'n_roles ran for the new plan');
  assert.equal(third.bindings.revise, undefined, 'no stale revise');
  const pass2 = slices(h.execs).filter((e) => e.executionId.startsWith('x:n_roles:3:'));
  assert.deepEqual(pass2.map((e) => e.title), ['Product', 'QA', 'UX'], 'every role');
  const idx = (e) => h.execs.indexOf(e);
  const lastDone = Math.max(...slices(h.execs, 'done').filter((e) => e.executionId.startsWith('x:n_roles:3:')).map(idx));
  assert.ok(idx(shells(h.execs, 'n_refine')[2]) > lastDone, 'Refine waits for the new pass');
  assert.deepEqual(h.orch.state.roleReviews.rounds.map((r) => [r.pass, r.round]), [[1, 1], [1, 2], [2, 1]]);
});

test('10 an old manifest (refiner self-loop) resumes with its own topology', async () => {
  const dir = gitDir('roles-old');
  let paused = false;
  const h = start({ projectDir: dir }, undefined, (q, orch) => { if (!paused) { paused = true; orch.pause(); } });
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  // The pre-change wf_shape: Default's wires, no n_roles, Refine without awaitAll.
  const old = {
    ...GRAPH_SHAPE_WORKFLOW,
    nodes: GRAPH_SHAPE_WORKFLOW.nodes.filter((n) => n.id !== 'n_roles')
      .map((n) => (n.id === 'n_refine' ? { ...n, config: { approve: { kind: 'plan', port: 'plan' } } } : n)),
    wires: GRAPH_DEFAULT_WORKFLOW.wires,
  };
  const manifest = buildGraphManifest(old, loadAgentRegistry(undefined, { userAgentsDir: null }));
  saved.resumePoint.manifest = { ...saved.resumePoint.manifest, graph: manifest.graph };

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.execs.filter((e) => e.nodeId === 'n_roles').length, 0);
  assert.equal(shells(h2.execs, 'n_refine').length, 2, 'the old self-loop: the mock refiner blocks once');
});
