// test/orchestrator-shape-care-run.test.mjs — Shaper small runs C2: a slice run of a marked feature builds by its Care
// plan (Test writer, plan reviewers, Challenger, fix cycles), fixed at start in `manifest.careRun`; every other run
// resolves to dev's slice graph. Mock engine.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { resolveGraph } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { normalizeOutline, sliceBrief } from '../src/shared/shape/slices.mjs';
import { MOCK_OUTLINE } from '../src/core/engines/mock.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV_KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_MOCK_ROLE_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-care-run-home-'));
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
afterEach(() => { delete process.env.WORCA_MOCK_ROLE_REVIEW; });
after(async () => {
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SHAPE = { perspectives: ['product', 'architect', 'qa'] };
const DEV = JSON.parse(readFileSync(new URL('./fixtures/shape-slice-graphs-dev.json', import.meta.url), 'utf8'));
const setFlag = (on) => { if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS; };
async function withFlag(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  setFlag(on);
  try { return await fn(); } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
}
const approveAll = (q, orch) => orch.answer(q.id, { decision: 'approve' });
const auditOf = (pid) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid).map((r) => r.text);

/** A mock run; Clarify asks get no answers, Care asks Worca's pick, plan asks `onPlan`, an exhausted loop budget (the
 *  mock code review always blocks its first cycle: the plan checklist's first item is unmet) continues. */
function start({ onPlan = approveAll, ...opts } = {}) {
  const orch = createOrchestrator({ workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  const execs = [];
  const asked = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asked.push(q);
    if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position: q.care.pick.position } }));
    else if (q.kind === 'plan') setImmediate(() => onPlan(q, orch));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
    else if (q.kind === 'gate') setImmediate(() => orch.answer(q.id, { decision: 'continue' }));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, execs, asked, done };
}

// The agreed requirements: run 2 owns an Architect and a Security id; run 3 a QA id. Examples on two of them.
const AGREED = [
  { id: 'R-po-1', text: 'People save a chart', example: 'Ana saves "Runs by day" and sees it listed.' },
  { id: 'R-arch-1', text: 'Charts live in the project store' },
  { id: 'R-sec-1', text: 'Only members read a chart', example: 'A visitor opens a chart link and is refused.' },
  { id: 'R-qa-1', text: 'Every chart type has a test' },
];
const OWNED = { 1: ['R-po-1'], 2: ['R-arch-1', 'R-sec-1'], 3: ['R-qa-1'] };
const RAW = {
  why: 'three steps',
  slices: [1, 2, 3].map((i) => ({ ...MOCK_OUTLINE.slices[i === 1 ? 0 : 1], id: `s${i}`, title: `Part ${i}`, dependsOn: i === 1 ? [] : [`s${i - 1}`],
    requirements: OWNED[i] })),
  leftOut: [],
};
const OUTLINE = normalizeOutline(RAW, { agreed: AGREED }).outline;
// The same feature with run 2 owning a Compliance id (small runs only) instead of the Security one.
const AGREED_COMP = [...AGREED, { id: 'R-comp-1', text: 'Chart data keeps its retention period' }];
const OUTLINE_COMP = normalizeOutline({ ...RAW, slices: RAW.slices.map((s) => (s.id === 's2' ? { ...s, requirements: ['R-arch-1', 'R-comp-1'] } : s)) },
  { agreed: AGREED_COMP, smallRuns: true }).outline;

/** A finished planning run (stamped when `marked`) and a feature with the outline above, its Care set to `position`. */
async function feature({ marked = true, position = 'balanced', tag = 'f', outline = OUTLINE } = {}) {
  const dir = gitDir(`care-run-${tag}`);
  const h = await withFlag(marked, async () => { const x = start({ projectDir: dir }); await x.done; return x; });
  const pid = h.orch.getState().id;
  const f = createSliceFeature({ pipelineId: pid, projectDir: dir, title: 'Charts', outline, perspectives: SHAPE.perspectives,
    workflowId: 'wf_shape', smallRuns: true, care: { position, chosenBy: 'person', worcaPick: 'balanced' } });
  return { f, dir, outline };
}
/** A slice run of `f` on `workflowId` (the slice requirements graph by default). */
function sliceRun({ f, dir, outline = OUTLINE }, { index = 2, workflowId = 'wf_shape_slice_req', ...opts } = {}) {
  const shape = { ...SHAPE, slices: 'off', slice: { feature: f.id, index, total: 3, outline } };
  return start({ projectDir: dir, workflowId, prompt: sliceBrief({ featureTitle: 'Charts', outline, index }), shape, ...opts });
}
const starts = (execs) => execs.filter((e) => e.kind !== 'task' && e.status === 'start').map((e) => e.nodeId);
const count = (execs, id) => starts(execs).filter((x) => x === id).length;
const planRoles = (orch) => (orch.state.roleReviews?.rounds || []).filter((r) => r.node === 'n_roles').map((r) => r.roles.map((x) => x.key));
const graphOf = (orch) => orch.state.stepper.graph;
const nodeIds = (orch) => graphOf(orch).nodes.map((n) => n.id);
const wire = (orch, id) => graphOf(orch).wires.find((w) => w.id === id);

test('Balanced: n_plan → n_roles → n_refine → n_tests → n_impl → n_review; careRun stamped; a blocking code review re-runs n_impl, not n_tests', async () => {
  const fx = await feature({ position: 'balanced', tag: 'bal' });
  process.env.WORCA_MOCK_ROLE_REVIEW = JSON.stringify({ correctness: { 1: 'major' } });
  const h = sliceRun(fx);
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const order = starts(h.execs).filter((id) => ['n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'].includes(id));
  assert.deepEqual([...new Set(order)], ['n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review']);
  assert.ok(order.indexOf('n_tests') > order.indexOf('n_refine') && order.indexOf('n_tests') < order.indexOf('n_impl'));
  const careRun = h.orch.state.stepper.careRun;
  assert.equal(careRun.position, 'balanced');
  assert.deepEqual(careRun.planReviewers, ['product', 'architect', 'security']);
  assert.equal(wire(h.orch, 'w9').maxCycles, 2);
  assert.equal(count(h.execs, 'n_impl'), 2, 'the code review blocked once');
  assert.equal(count(h.execs, 'n_tests'), 1, 'n_tests runs once across 2 fix cycles');
  const audit = auditOf(h.orch.getState().id);
  assert.ok(audit.includes('Care Balanced: tests first, by a separate Test writer, fix cycles 2, plan reviewers Product, Architect, Security.'), audit.join('\n'));
});

test('plan reviewers that ran: Lean Product plus one, Balanced the run\'s roles, Thorough plus devil; two runs with different ids differ', async () => {
  const ran = {};
  for (const position of ['lean', 'balanced', 'thorough']) {
    const fx = await feature({ position, tag: `roles-${position}` });
    const h = sliceRun(fx);
    assert.equal((await h.done).status, 'done');
    ran[position] = planRoles(h.orch)[0];
    if (position === 'thorough') {
      const h3 = sliceRun(fx, { index: 3 });
      assert.equal((await h3.done).status, 'done');
      ran.thorough3 = planRoles(h3.orch)[0];
    }
  }
  assert.deepEqual(ran.lean, ['product', 'architect']);
  assert.deepEqual(ran.balanced, ['product', 'architect', 'security']);
  assert.deepEqual(ran.thorough, ['product', 'architect', 'security', 'devil']);
  assert.deepEqual(ran.thorough3, ['product', 'qa', 'devil']);
});

test('a run owning a Compliance id has Compliance in its plan review, and no "has no role" audit line', async () => {
  assert.ok(OUTLINE_COMP.slices[1].requirements.includes('R-comp-1'), 'the fixture keeps the Compliance id');
  const fx = await feature({ position: 'balanced', tag: 'comp', outline: OUTLINE_COMP });
  const h = sliceRun(fx);
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.orch.state.stepper.careRun.planReviewers, ['product', 'architect', 'compliance']);
  assert.deepEqual(planRoles(h.orch)[0], ['product', 'architect', 'compliance']);
  assert.ok(!auditOf(h.orch.getState().id).some((t) => /has no .* role/.test(t)));
});

test('Lean: no n_tests, the fix loop ends after 1 cycle, and its brief carries the tests-first line', async () => {
  const fx = await feature({ position: 'lean', tag: 'lean' });
  const h = sliceRun(fx);
  assert.equal((await h.done).status, 'done');
  assert.ok(!nodeIds(h.orch).includes('n_tests'));
  assert.equal(count(h.execs, 'n_tests'), 0);
  assert.equal(count(h.execs, 'n_impl'), 1);
  assert.deepEqual(h.asked.filter((q) => q.kind === 'gate').map((q) => q.id), ['gate-w9-1'], 'the budget of 1 is spent after one cycle');
  assert.equal(wire(h.orch, 'w9').maxCycles, 1);
  assert.equal(h.orch.state.stepper.careRun.testWriter, false);
  // A run owning only Product ids has one plan reviewer, and its Care line says why.
  assert.match(h.orch._careRunLine({ ...h.orch.state.stepper.careRun, planReviewers: ['product'] }, null),
    /^Care Lean: tests first, by the Implementer, fix cycles 1, plan reviewers Product only, the run owns no other role$/);
  // The feature's chained tickets were written with the Lean line; a Balanced feature's were not.
  const promptOf = (f, idx) => {
    const row = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, idx);
    return getTicket(row.ticket_id, { withRequest: true }).request.prompt;
  };
  assert.match(promptOf(fx.f, 2), /^- \*\*R-sec-1\*\* Only members read a chart\n {2}Example: A visitor opens a chart link and is refused\.\nWrite the tests for these examples first, then the code\.$/m);
  const bal = await feature({ position: 'balanced', tag: 'lean-vs' });
  assert.doesNotMatch(promptOf(bal.f, 2), /Write the tests for these examples first/);
  assert.match(promptOf(bal.f, 2), /Example: A visitor opens a chart link/);
});

test('flag off and unmarked: the slice topology deep-equals the fixture; a wf_shape_req run equals its no-transform resolve', async () => {
  for (const [marked, flag] of [[false, false], [false, true]]) {
    const fx = await feature({ marked, position: 'balanced', tag: `off-${marked}-${flag}` });
    for (const wf of ['wf_shape_slice_req', 'wf_shape_ux_slice_req']) {
      const h = await withFlag(flag, async () => { const x = sliceRun(fx, { workflowId: wf }); assert.equal((await x.done).status, 'done'); return x; });
      assert.deepEqual(JSON.parse(JSON.stringify(h.orch.resolved.template)), DEV[wf], `${wf} marked=${marked} flag=${flag}`);
      assert.ok(!nodeIds(h.orch).includes('n_tests'));
      assert.equal(wire(h.orch, 'w9').maxCycles, 3);
      assert.equal('careRun' in h.orch.state.stepper, false);
    }
  }
  const fx = await feature({ position: 'balanced', tag: 'req' });
  const h = sliceRun(fx, { workflowId: 'wf_shape_req' });
  await h.done;
  const plain = await resolveGraph(fx.dir, 'wf_shape_req', loadAgentRegistry(), undefined, {});
  assert.deepEqual(h.orch.resolved.template, plain.template);
  assert.equal('careRun' in h.orch.state.stepper, false);
});

test('stamped feature, flag off later: careRun and n_tests are still there', async () => {
  const fx = await feature({ position: 'balanced', tag: 'later' });
  const h = await withFlag(false, async () => { const x = sliceRun(fx); assert.equal((await x.done).status, 'done'); return x; });
  assert.equal(h.orch.state.stepper.careRun?.position, 'balanced');
  assert.ok(nodeIds(h.orch).includes('n_tests'));
});

test('pause, change Care, resume: plan reviewers and n_tests unchanged', async () => {
  const fx = await feature({ position: 'thorough', tag: 'resume' });
  let paused = false;
  const h = sliceRun(fx, { onPlan: (q, orch) => { paused = true; orch.pause(); } });
  const res = await h.done;
  assert.ok(paused);
  assert.equal(res.status, 'paused', res.error);
  getDb().prepare('UPDATE shape_features SET care = ? WHERE id = ?').run('lean', fx.f.id);
  const saved = readPipelineForResume(h.orch.getState().id);
  const r = start({ projectDir: fx.dir, workflowId: 'wf_shape_slice_req', resume: saved, shape: h.orch.runShape });
  assert.equal((await r.done).status, 'done');
  assert.equal(r.orch.state.stepper.careRun.position, 'thorough');
  assert.ok(nodeIds(r.orch).includes('n_tests'));
  assert.equal(count(r.execs, 'n_tests'), 1);
  assert.deepEqual(planRoles(r.orch)[0], ['product', 'architect', 'security', 'devil']);
});

test('refused transform: a reviewer reviewing itself fails the start with GRAPH_TRANSFORM_INVALID and leaves no pipeline dir', async () => {
  const fx = await feature({ position: 'balanced', tag: 'refuse' });
  const shape = { ...SHAPE, slices: 'off', slice: { feature: fx.f.id, index: 2, total: 3, outline: OUTLINE } };
  const orch = createOrchestrator({ projectDir: fx.dir, workflowId: 'wf_shape_slice_req', prompt: 'demo', claude: { mock: true }, shape });
  orch._careRunGraph = (t) => ({ ...t, wires: t.wires.map((w) => (w.id === 'w4' ? { ...w, from: { node: 'n_roles', port: 'plan' } } : w)) });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(String(res.error), /reviews its own output|refused/);
  assert.equal(orch.pipeline?.dir ? existsSync(orch.pipeline.dir) : false, false);
});

test('examples: a marked run\'s n_review requirements text keeps Example lines; an unmarked slice run\'s has none', async () => {
  for (const marked of [true, false]) {
    const fx = await feature({ marked, position: 'balanced', tag: `ex-${marked}` });
    const h = sliceRun(fx);
    assert.equal((await h.done).status, 'done');
    // The file actually bound to n_review's requirements input (read from its execution), narrowed the way each code
    // role's brief is (`ctx.roleRequirementsText`), not a re-computed brief.
    const exec = (h.orch._graphSnapshot?.execs || []).find((e) => e.nodeId === 'n_review' && e.bindings?.requirements?.path);
    assert.ok(exec, 'n_review ran with a requirements binding');
    const bound = readFileSync(exec.bindings.requirements.path, 'utf8');
    assert.match(bound, /^ {2}Example: A visitor opens a chart link and is refused\.$/m, 'the bound file carries the example');
    const text = h.orch._sliceCriteria(bound);
    assert.match(text, /R-sec-1/);
    if (marked) assert.match(text, /^ {2}Example: A visitor opens a chart link and is refused\.$/m);
    else assert.doesNotMatch(text, /Example:/);
  }
});
