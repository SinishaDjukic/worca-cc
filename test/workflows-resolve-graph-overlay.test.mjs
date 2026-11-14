// test/workflows-resolve-graph-overlay.test.mjs — a per-run overlay on a NORMAL run (no ignoreProjectOverrides):
// merged per node over the project layer, and an effort only travels with the model that named it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel, setStep } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { writeGraphWorkflow, resolveGraph } from '../src/core/workflows.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-rgo-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-rgo-'));
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const GRAPH = {
  id: 'wf_rgo', name: 'RGO', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w5', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
    { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
};

test('wf_default: an overlay model takes no effort from the legacy per-role layer (an effort travels with its model)', async () => {
  await setStep(projectDir, 'planner', { model: 'claude-opus-5-5', effort: 'max' });
  const base = await resolveGraph(projectDir, 'wf_default', REG());
  assert.deepEqual([base.nodes.n_plan.model, base.nodes.n_plan.effort], ['claude-opus-5-5', 'max'], 'the project layer');
  const over = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5' } } } });
  assert.equal(over.nodes.n_plan.model, 'claude-haiku-4-5');
  assert.equal(over.nodes.n_plan.effort, undefined, 'Haiku 4.5 offers no max: the legacy effort must not ride under it');
  const paired = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } } } });
  assert.deepEqual([paired.nodes.n_plan.model, paired.nodes.n_plan.effort], ['claude-haiku-4-5', 'medium']);
  const effortOnly = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { overlay: { nodes: { n_plan: { fanOut: true } } } });
  assert.deepEqual([effortOnly.nodes.n_plan.model, effortOnly.nodes.n_plan.effort, effortOnly.nodes.n_plan.fanOut], ['claude-opus-5-5', 'max', true], 'a node the overlay gives no model keeps the legacy pair');
});

test('a saved workflow: the canonical overlay ({ model, effort: "" }) drops the project node\'s stored effort for that run only', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH });
  await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-5-5', effort: 'max' });
  const r = await resolveGraph(projectDir, id, REG(), undefined, { overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: '' } } } });
  assert.deepEqual([r.nodes.n_plan.model, r.nodes.n_plan.effort], ['claude-haiku-4-5', undefined]);
  const stored = await resolveGraph(projectDir, id, REG());
  assert.deepEqual([stored.nodes.n_plan.model, stored.nodes.n_plan.effort], ['claude-opus-5-5', 'max'], 'the project layer is unchanged');
});

const ROLE_GRAPH = {
  id: 'wf_rgo_roles', name: 'RGO roles', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_reviewer', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { model: 'claude-sonnet-5-5', effort: 'medium',
      roleReview: { roles: [{ key: 'correctness', label: 'Correctness' }, { key: 'security', label: 'Security', model: 'claude-haiku-4-5', effort: 'medium' }, { key: 'fit', label: 'Fit' }],
        source: 'declared', target: 'plan', sink: 'refiner' } } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 900, y: 0, config: { awaitAll: true } },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_reviewer', port: 'plan' } },
    { id: 'w3', from: { node: 'n_reviewer', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w4', from: { node: 'n_reviewer', port: 'findings' }, to: { node: 'n_refine', port: 'findings' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_reviewer', port: 'revise' }, config: { maxCycles: 2, onExhausted: 'clean' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};

test('a role-review node resolves its per-role picks: run > project > template, each with its source', async () => {
  const { id } = await writeGraphWorkflow({ ...ROLE_GRAPH });
  await setNodeModel(projectDir, id, 'n_reviewer', { roles: { correctness: { model: 'claude-opus-5-5', effort: 'max' }, security: { model: 'claude-opus-5-5' } } });
  const stored = await resolveGraph(projectDir, id, REG());
  assert.deepEqual(stored.nodes.n_reviewer.roles, {
    correctness: { model: 'claude-opus-5-5', effort: 'max', source: 'project' },
    security: { model: 'claude-opus-5-5', source: 'project' },
  }, 'the project beats the template; an effort travels with its model');
  const run = await resolveGraph(projectDir, id, REG(), undefined, { overlay: { nodes: { n_reviewer: { roles: { correctness: { model: 'claude-haiku-4-5', effort: 'high' } } } } } });
  assert.deepEqual(run.nodes.n_reviewer.roles.correctness, { model: 'claude-haiku-4-5', effort: 'high', source: 'run' });
  assert.deepEqual(run.nodes.n_reviewer.roles.security, { model: 'claude-opus-5-5', source: 'project' }, 'a role the overlay names nothing for keeps its project pick');
  await setNodeModel(projectDir, id, 'n_reviewer', { roles: {} });
  assert.deepEqual((await resolveGraph(projectDir, id, REG())).nodes.n_reviewer.roles, {
    security: { model: 'claude-haiku-4-5', effort: 'medium', source: 'template' },
  });
  assert.equal(Object.hasOwn(stored.nodes.n_reviewer.roles, 'fit'), false, 'a role nothing names is absent');
});

test('a node without a role review has no roles key; Auto ignores the project layer', async () => {
  const { id } = await writeGraphWorkflow({ ...ROLE_GRAPH, id: 'wf_rgo_roles_auto' });
  await setNodeModel(projectDir, id, 'n_reviewer', { roles: { correctness: { model: 'claude-opus-5-5' } } });
  const g = await resolveGraph(projectDir, id, REG());
  for (const nid of ['n_task', 'n_plan', 'n_refine', 'n_end']) assert.equal(Object.hasOwn(g.nodes[nid], 'roles'), false, nid);
  const def = await resolveGraph(projectDir, 'wf_default', REG());
  for (const [nid, nc] of Object.entries(def.nodes)) assert.equal(Object.hasOwn(nc, 'roles'), false, nid);
  const auto = await resolveGraph(projectDir, id, REG(), undefined, { ignoreProjectOverrides: true });
  assert.deepEqual(auto.nodes.n_reviewer.roles, { security: { model: 'claude-haiku-4-5', effort: 'medium', source: 'template' } });
  const pinned = await resolveGraph(projectDir, id, REG(), undefined, { agentPair: { model: 'claude-opus-5-5' } });
  assert.equal(Object.hasOwn(pinned.nodes.n_reviewer, 'roles'), false, 'an agentPair pin skips role picks');
});

// Effort intents (effort-intents.mjs): a run start (fillIntents) fills only an UNSET effort; a named one always wins.
test('effort intents: the overlay, the legacy layer and the template name efforts the intent never replaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-rgo-ei-'));
  try {
    const FILL = { engine: 'claude', fillIntents: true };
    const over = (pick) => resolveGraph(dir, 'wf_default', REG(), undefined, { ...FILL, overlay: { nodes: { n_plan: pick } } });
    assert.equal((await over({ model: 'claude-opus-4-8', effort: '' })).nodes.n_plan.effort, 'xhigh', "'' reads as unset: planner is deep");
    assert.equal((await over({ model: 'claude-opus-4-8', effort: 'medium' })).nodes.n_plan.effort, 'medium');
    assert.equal((await over({ model: 'claude-opus-4-7', effort: '' })).nodes.n_plan.effort, undefined, 'opus-4-7 has no row');
    const run = await resolveGraph(dir, 'wf_default', REG(), undefined, { ...FILL, runModel: 'claude-opus-4-8' });
    assert.equal(run.nodes.n_impl.effort, 'high', 'implementer: standard');
    assert.equal(run.nodes.n_review.effort, 'xhigh', 'reviewer: deep');
    await setStep(dir, 'planner', { model: 'claude-opus-4-8', effort: 'max' });
    assert.equal((await resolveGraph(dir, 'wf_default', REG(), undefined, FILL)).nodes.n_plan.effort, 'max', 'the legacy per-role effort');
    const { id } = await writeGraphWorkflow({ ...GRAPH, id: 'wf_rgo_ei',
      nodes: GRAPH.nodes.map((n) => (n.id === 'n_plan' ? { ...n, config: { effort: 'high' } } : n)) });
    const tpl = await resolveGraph(dir, id, REG(), undefined, { ...FILL, runModel: 'claude-opus-4-8' });
    assert.equal(tpl.nodes.n_plan.effort, 'high', 'the template effort');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
