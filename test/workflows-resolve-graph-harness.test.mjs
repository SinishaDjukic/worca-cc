// test/workflows-resolve-graph-harness.test.mjs — a pick that names its harness (`engine`): resolveGraph runs that step
// on it (effort mapped, marked pinned), the pin travels with its model, a pin its harness cannot run is dropped and
// named, roles keep their own pin, a pinned workflow pick counts as set for the step slots, and Auto drops a pin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { writeGraphWorkflow, resolveGraph } from '../src/core/workflows.mjs';
import { pickDropWarnings } from '../src/shared/graph/role-slots.mjs';
import { createOrchestrator, resolvedFromManifest } from '../src/core/orchestrator.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-rgh-'));
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const GRAPH = {
  id: 'wf_rgh', name: 'RGH', domain: 'coding',
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
const withConfig = (id, nodeId, config) => ({ ...structuredClone(GRAPH), id, nodes: GRAPH.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n)) });
const GRAPH_ROLES = withConfig('wf_rgh_roles', 'n_rev', { roleReview: { roles: [{ key: 'security', label: 'Security', model: 'gpt-5.5', engine: 'codex' }, { key: 'fit', label: 'Fit' }], source: 'declared', target: 'diff', sink: 'implementer' } });
const GRAPH_PIN = withConfig('wf_rgh_pin', 'n_plan', { model: 'gpt-5.5', engine: 'codex' });
const GRAPH_SOFT = withConfig('wf_rgh_soft', 'n_plan', { model: 'claude-opus-5-5' });
/** The person's settings.json (Settings step slots), as writeUser in test/step-model-slots.test.mjs. */
const slot = (obj) => { mkdirSync(join(sandboxHome, '.worca-cc'), { recursive: true }); writeFileSync(join(sandboxHome, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-rgh-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  for (const g of [GRAPH, GRAPH_ROLES, GRAPH_PIN, GRAPH_SOFT]) await writeGraphWorkflow(structuredClone(g));
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

test('a pinned overlay pick runs its step on its own harness, effort mapped, marked pinned; the other steps stay on the default harness', async () => {
  const r = await resolveGraph(projectDir, 'wf_rgh', REG(), undefined, { overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex', effort: 'max' } } } });
  assert.deepEqual([r.nodes.n_plan.model, r.nodes.n_plan.effort, r.nodes.n_plan.engine, r.nodes.n_plan.modelSource, r.nodes.n_plan.pinned], ['gpt-5.5', 'high', 'codex', 'run', true]);
  assert.equal(r.nodes.n_impl.engine, 'claude');
  assert.equal('pinned' in r.nodes.n_impl, false);
});
test('a project pin travels with its model: an overlay naming another model runs that step on the default harness', async () => {
  await setNodeModel(projectDir, 'wf_rgh', 'n_impl', { model: 'claude-opus-5-5', engine: 'claude' });
  const pinned = await resolveGraph(projectDir, 'wf_rgh', REG(), undefined, { engine: 'codex' });
  assert.deepEqual([pinned.nodes.n_impl.model, pinned.nodes.n_impl.engine, pinned.nodes.n_plan.engine], ['claude-opus-5-5', 'claude', 'codex']);
  const over = await resolveGraph(projectDir, 'wf_rgh', REG(), undefined, { engine: 'codex', overlay: { nodes: { n_impl: { model: 'gpt-5.5', effort: '' } } } });
  assert.deepEqual([over.nodes.n_impl.model, over.nodes.n_impl.engine, 'pinned' in over.nodes.n_impl], ['gpt-5.5', 'codex', false]);
  await setNodeModel(projectDir, 'wf_rgh', 'n_impl', {});
});
test('a pin its harness does not run is dropped like any pick: the next layer, the default harness, and the pin\'s harness in the warning', async () => {
  const r = await resolveGraph(projectDir, 'wf_rgh', REG(), undefined, { engine: 'codex', overlay: { nodes: { n_rev: { model: 'gpt-5.5', engine: 'claude' } } } });
  assert.equal(r.nodes.n_rev.engine, 'codex');
  assert.deepEqual(r.nodes.n_rev.wanted, { model: 'gpt-5.5', engine: 'claude', source: 'run' });
  const instead = r.nodes.n_rev.model || "OpenAI Codex's default model";
  assert.ok(pickDropWarnings(r.nodes, { engine: 'codex' }).includes(`Review Implementation: gpt-5.5 is not on Claude Code, runs ${instead}`));
});
test('roles: a pinned role keeps its harness; a soft role is judged on its node\'s harness', async () => {
  const r = await resolveGraph(projectDir, 'wf_rgh_roles', REG(), undefined, {});
  assert.deepEqual(r.nodes.n_rev.roles.security, { model: 'gpt-5.5', engine: 'codex', source: 'template' });
  const onCodex = await resolveGraph(projectDir, 'wf_rgh_roles', REG(), undefined, { overlay: { nodes: { n_rev: { model: 'gpt-5.5', engine: 'codex', roles: { fit: { model: 'claude-haiku-4-5' } } } } } });
  assert.equal(onCodex.nodes.n_rev.engine, 'codex');
  assert.deepEqual(onCodex.nodes.n_rev.roles.fit, { source: 'run', wanted: { model: 'claude-haiku-4-5' } });
});
test('rule 6: a Settings step slot skips a step the workflow pins, and fills one the workflow picks soft, as today', async () => {
  slot({ stepModels: { claude: { planner: { model: 'claude-haiku-4-5' } } } });
  try {
    const pinned = await resolveGraph(projectDir, 'wf_rgh_pin', REG(), undefined, {});
    assert.deepEqual([pinned.nodes.n_plan.model, pinned.nodes.n_plan.engine, pinned.nodes.n_plan.modelSource, pinned.nodes.n_plan.pinned], ['gpt-5.5', 'codex', 'template', true]);
    const soft = await resolveGraph(projectDir, 'wf_rgh_soft', REG(), undefined, {});
    assert.deepEqual([soft.nodes.n_plan.model, soft.nodes.n_plan.engine, soft.nodes.n_plan.modelSource], ['claude-haiku-4-5', 'claude', 'slot']);
  } finally { slot({}); }
});
test('Auto drops a pin: the step runs on the default harness, its record keeps the pin, and the run warns once naming the harness', async () => {
  const r = await resolveGraph(projectDir, 'wf_rgh_pin', REG(), undefined, { ignoreProjectOverrides: true });
  assert.equal(r.nodes.n_plan.engine, 'claude');
  assert.deepEqual(r.nodes.n_plan.wanted, { model: 'gpt-5.5', engine: 'codex', source: 'template' });
  const o = createOrchestrator({ projectDir, claude: { mock: true } });
  const lines = o._noteAutoPins(r.nodes);
  assert.deepEqual(lines, [`Plan: set to OpenAI Codex, but an Auto run uses one harness, so it runs ${r.nodes.n_plan.model || "Claude Code's default model"} on Claude Code`]);
  assert.ok(o.getState().warnings.includes(lines[0]));
});

test('a restore reads each step\'s harness back; a manifest from before the field restores none; the gate sees it', async () => {
  const r = await resolveGraph(projectDir, 'wf_rgh', REG(), undefined, { overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex' } } } });
  const m = buildGraphManifest(r.template, r.agentsByKey, { overlays: { nodes: r.nodes, wires: r.wires }, scripts: r.scriptsByKey, engine: 'claude' });
  const back = resolvedFromManifest(m, REG());
  assert.equal(back.nodes.n_plan.engine, 'codex');
  assert.equal('engine' in back.nodes.n_impl, false);
  const old = structuredClone(m);
  for (const n of old.graph.nodes) delete n.engine;
  assert.equal('engine' in resolvedFromManifest(old, REG()).nodes.n_plan, false);
  const gate = await createOrchestrator({ projectDir, claude: { mock: true } })._engineGateNodes({ manifest: m });
  assert.equal(gate.find((n) => n.nodeId === 'n_plan').engine, 'codex');
  assert.equal(gate.find((n) => n.nodeId === 'n_plan').meta.displayName, 'Plan');
});
test('Care\'s re-resolve keeps each node\'s model with its harness, and a one-harness Codex run\'s cells stay without engine', async () => {
  const careRun = async (claude) => {
    const o = createOrchestrator({ projectDir, workflowId: 'wf_rgh', prompt: 'x', claude });
    o.registry = REG();
    o.state.stepper = (await o._resolveTopology(o.registry)).manifest;
    o._careRunGraph = (t) => t;      // the seam: the start graph, unchanged
    o._persist = async () => {};
    return o;
  };
  const codex = await careRun({ mock: true, engine: 'codex' });
  await codex._careOriginGraph('balanced');
  assert.ok(codex.state.stepper.graph.nodes.filter((n) => n.kind === 'agent').every((n) => !('engine' in n)));
  const mixed = await careRun({ mock: true });
  Object.assign(mixed.resolved.nodeCtx.n_impl, { model: 'gpt-5.5', engine: 'codex', pinned: true });
  await mixed._careOriginGraph('balanced');
  const live = mixed.resolved.nodeCtx.n_impl;
  assert.deepEqual([live.model, live.engine, live.pinned], ['gpt-5.5', 'codex', true]);
  assert.equal(mixed.state.stepper.graph.nodes.find((n) => n.id === 'n_impl').engine, 'codex');
});
