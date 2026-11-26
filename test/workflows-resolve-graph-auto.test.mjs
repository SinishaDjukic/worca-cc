import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel, setWireCycles } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { writeGraphWorkflow, resolveGraph } from '../src/core/workflows.mjs';

useTempHome(after);
// setNodeModel validates its model against listModels() -> readSettings() -> HOME/settings.json:
// sandbox HOME like test/orchestrator-graph.test.mjs:23-38 so the developer's real
// settings file is never read by the suite.
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-rga-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-rga-'));
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const GRAPH = {
  id: 'wf_rga', name: 'RGA', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'tpl-model', effort: 'high' } },
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

test('ignoreProjectOverrides skips the per-project layers; overlay is the only overlay', async () => {
  await writeGraphWorkflow(GRAPH);
  await setNodeModel(projectDir, 'wf_rga', 'n_plan', { model: 'claude-opus-5-5', effort: 'high' });
  await setWireCycles(projectDir, 'wf_rga', 'w5', 7);
  const plain = await resolveGraph(projectDir, 'wf_rga', REG());
  assert.equal(plain.nodes.n_plan.model, 'claude-opus-5-5');
  assert.deepEqual(plain.wires, { w5: { maxCycles: 7 } });

  const auto = await resolveGraph(projectDir, 'wf_rga', REG(), undefined, {
    ignoreProjectOverrides: true,
    overlay: { nodes: { n_plan: { model: 'claude-sonnet-5', effort: 'medium', fanOut: true }, n_impl: { askQuestions: false } } },
  });
  assert.equal(auto.nodes.n_plan.model, 'claude-sonnet-5');
  assert.equal(auto.nodes.n_plan.effort, 'medium');
  assert.equal(auto.nodes.n_plan.fanOut, true);
  assert.equal(auto.nodes.n_impl.model, 'claude-sonnet-5-5', 'a node absent from the overlay falls through to the template, then Worca\'s default (#1450 D-h)');
  assert.equal(auto.nodes.n_impl.modelSource, 'worca-default');
  assert.equal(auto.nodes.n_plan.modelSource, 'auto', 'a classifier pick is nobody\'s choice: the premium guard applies');
  assert.deepEqual(auto.wires, { w5: { maxCycles: 4 } }, 'the per-project wire budget is ignored; the authored one stands');
  assert.deepEqual(auto.template.nodes.find((n) => n.id === 'n_plan').config, { model: 'tpl-model', effort: 'high' }, 'the template is never mutated');
});

test('without ignoreProjectOverrides an overlay merges PER NODE over the project layer', async () => {
  const merged = await resolveGraph(projectDir, 'wf_rga', REG(), undefined, {
    overlay: { nodes: { n_plan: { effort: 'max' } }, wires: { w5: { maxCycles: 2 } } },
  });
  assert.equal(merged.nodes.n_plan.model, 'claude-opus-5-5', 'the project model survives a partial overlay');
  assert.equal(merged.nodes.n_plan.effort, 'max');
  assert.deepEqual(merged.wires, { w5: { maxCycles: 2 } });
});

test('neither an overlay nor the project\'s agent defaults can add a node limit (#1646, R-po-2, R-qa-10)', async () => {
  const limits = { timeLimitMinutes: 5, idleLimitMinutes: 5 };
  await writeGraphWorkflow(GRAPH);
  await setNodeModel(projectDir, 'wf_rga', 'n_impl', { model: 'claude-opus-5-5', ...limits });
  for (const ignoreProjectOverrides of [false, true]) {
    const r = await resolveGraph(projectDir, 'wf_rga', REG(), undefined, { overlay: { nodes: { n_impl: limits } }, ignoreProjectOverrides });
    const configs = [r.nodes.n_impl, r.nodes.n_impl.config, r.template.nodes.find((n) => n.id === 'n_impl').config];
    for (const c of configs) for (const k of Object.keys(limits)) assert.equal(k in c, false, `${k} (ignoreProjectOverrides: ${ignoreProjectOverrides})`);
  }
});
