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
