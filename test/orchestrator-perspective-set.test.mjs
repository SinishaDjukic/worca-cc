// test/orchestrator-perspective-set.test.mjs — a run's chosen perspective set (flag proposedPerspectives) through the
// orchestrator: the code review fans out one role per chosen key, Shaper's plan role review opts Compliance in, the set
// survives a pause, and a run without a set is today's run. Mock engine, a git dir, no server. The orchestrator is
// needed because the role fan-out is only observable there.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { GRAPH_DEFAULT_WORKFLOW, GRAPH_SHAPE_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { ROLE_REVIEW_DIFF_PORTS } from '../src/shared/graph/ports.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_ROLE_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-persp-set-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
});
afterEach(() => { _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const answerAll = (orch, { plan = () => ({ decision: 'approve' }) } = {}) => orch.on('question', (q) => setImmediate(() => {
  orch.answer(q.id, q.kind === 'plan' ? plan(q) : { answers: (q.questions || []).map((x) => ({ id: x.id, choice: x.options?.[0]?.label ?? 'A' })) });
}));

/** One mock run; `execs` are the exec events. */
async function runOnce({ workflowId = 'wf_default', perspectiveSet, shape, dir = gitDir('persp-set'), plan } = {}) {
  const orch = createOrchestrator({ projectDir: dir, workflowId, prompt: 'demo', claude: { mock: true },
    ...(perspectiveSet ? { perspectiveSet } : {}), ...(shape ? { shape } : {}) });
  const execs = [];
  orch.on('exec', (e) => execs.push(e));
  answerAll(orch, { plan });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  return { orch, execs };
}
/** The role slices one node ran, by their task id, in first-start order. */
const roleSlices = (execs, nodeId) => [...new Set(execs.filter((e) => e.nodeId === nodeId && e.kind === 'task' && e.status === 'start')
  .map((e) => e.taskId))];
const nodeCfg = (orch, id) => orch.state.stepper.graph.nodes.find((n) => n.id === id);
const graphOk = (orch) => {
  const portsFn = registryPortsFn(loadAgentRegistry());
  const r = validateGraph(orch.resolved.template, portsFn);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  const review = orch.resolved.template.nodes.find((n) => n.id === 'n_review');
  assert.deepEqual(portsFn(review).inputs.map((p) => p.id).filter((id) => id !== 'await'), ROLE_REVIEW_DIFF_PORTS.inputs.map((p) => p.id));
  assert.deepEqual(portsFn(review).outputs.map((p) => p.id), ROLE_REVIEW_DIFF_PORTS.outputs.map((p) => p.id));
};

test('an unshaped run with [product, qa, security] runs those code review roles, and the graph validates', { timeout: 120000 }, async () => {
  const { orch, execs } = await runOnce({ perspectiveSet: { chosen: ['product', 'qa', 'security'] } });
  assert.deepEqual(roleSlices(execs, 'n_review'), ['role-product', 'role-qa', 'role-security']);
  graphOk(orch);
});

test('a shaped run with compliance: code roles equal the set, and the plan role review runs role-compliance', { timeout: 120000 }, async () => {
  const chosen = ['product', 'qa', 'security', 'compliance'];
  const { execs } = await runOnce({ workflowId: 'wf_shape', shape: { perspectives: chosen }, perspectiveSet: { chosen } });
  assert.deepEqual(roleSlices(execs, 'n_review'), chosen.map((k) => `role-${k}`));
  assert.deepEqual(roleSlices(execs, 'n_roles'), chosen.map((k) => `role-${k}`));
});

test('a run without a set resolves today\'s builtin configs and runs one plain reviewer', { timeout: 120000 }, async () => {
  for (const [workflowId, graph] of [['wf_default', GRAPH_DEFAULT_WORKFLOW], ['wf_shape', GRAPH_SHAPE_WORKFLOW]]) {
    const orch = createOrchestrator({ projectDir: gitDir('persp-none'), workflowId, prompt: 'demo', claude: { mock: true } });
    await orch._resolveTopology(loadAgentRegistry());
    for (const n of graph.nodes) assert.deepEqual(orch.resolved.template.nodes.find((x) => x.id === n.id).config, n.config, `${workflowId}/${n.id}`);
    assert.equal(orch.perspectiveSet, null);
  }
  const { execs, orch } = await runOnce();
  assert.deepEqual(roleSlices(execs, 'n_review'), []);
  assert.ok(execs.some((e) => e.nodeId === 'n_review' && e.kind !== 'task' && e.status === 'done'), 'one reviewer ran');
  assert.equal('perspectiveSet' in orch._buildResumePoint(null), false);
});

test('a run paused at Clarify and resumed keeps its set and its code roles', { timeout: 120000 }, async () => {
  const dir = gitDir('persp-resume');
  const chosen = ['product', 'qa', 'security'];
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', claude: { mock: true }, perspectiveSet: { chosen } });
  let asked = false;
  orch.on('question', (q) => setImmediate(() => {
    if (!asked && q.kind !== 'plan') { asked = true; orch.pause(); return; }
    orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] });
  }));
  const first = await orch.run();
  assert.equal(first.status, 'paused', first.error);
  assert.ok(asked, 'Clarify asked');
  const saved = readPipelineForResume(orch.getState().id);
  assert.deepEqual(saved.resumePoint.perspectiveSet, { chosen });
  const orch2 = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', claude: { mock: true }, resume: saved });
  const execs = [];
  orch2.on('exec', (e) => execs.push(e));
  answerAll(orch2);
  const second = await orch2.resume();
  assert.equal(second.status, 'done', second.error);
  assert.deepEqual(orch2.perspectiveSet, { chosen });
  assert.deepEqual(roleSlices(execs, 'n_review'), ['role-product', 'role-qa', 'role-security']);
});

test('a shaped run holding compliance revised at plan approval keeps it, and the next plan round runs role-compliance', { timeout: 120000 }, async () => {
  const chosen = ['product', 'architect', 'compliance'];
  let revised = false;
  const { execs, orch } = await runOnce({ workflowId: 'wf_shape', shape: { perspectives: chosen }, perspectiveSet: { chosen },
    plan: () => {
      if (revised) return { decision: 'approve' };
      revised = true;
      return { decision: 'revise', feedback: 'Add QA.', perspectives: ['product', 'architect', 'qa', 'compliance'] };
    } });
  assert.ok(revised);
  assert.deepEqual(orch.runShape.perspectives, ['product', 'architect', 'qa', 'compliance']);
  const roleStarts = execs.filter((e) => e.nodeId === 'n_roles' && e.kind === 'task' && e.status === 'start').map((e) => e.taskId);
  assert.ok(roleStarts.filter((t) => t === 'role-compliance').length >= 2, roleStarts.join());
  assert.ok(roleStarts.includes('role-qa'), 'the next round reads the revised set');
});

test('a per-project role model for qa on the reviewer is kept, and adds or drops no role', { timeout: 120000 }, async () => {
  const dir = gitDir('persp-overlay');
  await setNodeModel(dir, 'wf_default', 'n_review', { roles: { qa: { model: 'claude-haiku-4-5', effort: 'high' } } });
  const { orch, execs } = await runOnce({ dir, perspectiveSet: { chosen: ['product', 'qa'] } });
  assert.deepEqual(roleSlices(execs, 'n_review'), ['role-product', 'role-qa']);
  const qa = orch.state.roleReviews.rounds.filter((r) => r.node === 'n_review').at(-1).roles.find((r) => r.key === 'qa');
  assert.deepEqual([qa.model, qa.effort], ['claude-haiku-4-5', 'high']);
  assert.deepEqual(Object.keys(nodeCfg(orch, 'n_review').roles || {}).sort(), ['qa']);
});

test('Default\'s n_review resolves to the same node model and effort with a set as without one', async () => {
  const pick = async (perspectiveSet) => {
    const orch = createOrchestrator({ projectDir: gitDir('persp-model'), workflowId: 'wf_default', prompt: 'demo', claude: { mock: true },
      ...(perspectiveSet ? { perspectiveSet } : {}) });
    await orch._resolveTopology(loadAgentRegistry());
    const nc = orch.resolved.nodeCtx.n_review;
    return [nc.model, nc.effort];
  };
  assert.deepEqual(await pick({ chosen: ['product', 'qa', 'security'] }), await pick(null));
});
