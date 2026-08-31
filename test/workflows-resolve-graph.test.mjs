import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel, setWireCycles, setStep } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import {
  writeGraphWorkflow, readWorkflow, resolveGraph, workspaceVariants, workflowNodeDefaults,
  setWorkflowNodeDefaults,
} from '../src/core/workflows.mjs';

useTempHome(after);
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-rg-'));
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null });
const GRAPH = (over = {}) => ({
  name: 'RG', domain: 'coding',
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
  ...over,
});

test('resolveGraph returns the template, per-node effective config, wire budgets and the key set', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg' });
  const g = await resolveGraph(projectDir, id, REG());
  assert.equal(g.template.version, 2);
  assert.deepEqual(g.template.nodes.find((n) => n.id === 'n_plan').config, { model: 'tpl-model', effort: 'high' },
    'the stored template is NOT mutated by resolution');
  assert.deepEqual([...g.agentKeys].sort(), ['implementer', 'planner', 'reviewer']);
  assert.deepEqual(Object.keys(g.nodes).sort(), ['n_end', 'n_impl', 'n_plan', 'n_rev', 'n_task']);
  assert.equal(g.nodes.n_task.key, null);
  assert.equal(g.nodes.n_plan.model, 'tpl-model', 'template config is the third layer');
  assert.equal(g.nodes.n_plan.effort, 'high');
  assert.equal(g.nodes.n_plan.runnerType, 'producer');
  assert.equal(typeof g.nodes.n_plan.agentPrompt, 'string');
  assert.equal(g.nodes.n_impl.fanOut, true, 'the sidecar default carries');
  assert.equal(g.agentsByKey.planner.metaVersion, 2);
  assert.equal(typeof g.ports, 'function', 'the run portsFn rides the result');
  assert.ok(g.loops.loopWireIds instanceof Set && Array.isArray(g.loops.launchOrder), 'loops are classified once, here');
  assert.equal(g.nodes.n_plan.authoredKey, 'planner');
  assert.equal(g.nodes.n_plan.duplicateKey, false);
  assert.deepEqual(g.nodes.n_plan.config, g.template.nodes.find((n) => n.id === 'n_plan').config);
  assert.deepEqual(g.wires, { w5: { maxCycles: 4 } }, 'loop wires only, authored budget');
});

test('overlay precedence: run-config wins, and effort never inherits across a model change', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg2' });
  // Catalog ids only past a SETTER: setNodeModel/setStep validate `model`
  // against listModels() and `effort` against that model's own efforts list
  // (`setNodeModel` `config.mjs:617-629`, `setStep` `:400-414`; EFFORTS = medium/high/xhigh/max — there is
  // no 'low'). The RAW template config below (`tpl-model`) is never validated.
  await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-5' });
  const g = await resolveGraph(projectDir, id, REG());
  assert.equal(g.nodes.n_plan.model, 'claude-opus-5');
  assert.equal(g.nodes.n_plan.effort, undefined, 'the template effort belonged to the template model');
  await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-5', effort: 'max' });
  assert.equal((await resolveGraph(projectDir, id, REG())).nodes.n_plan.effort, 'max');
});

test('wire budgets: overlay > authored > 3', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg3' });
  assert.equal((await resolveGraph(projectDir, id, REG())).wires.w5.maxCycles, 4);
  await setWireCycles(projectDir, id, 'w5', 9);
  assert.equal((await resolveGraph(projectDir, id, REG())).wires.w5.maxCycles, 9);
  const bare = GRAPH();
  bare.wires = bare.wires.map((w) => (w.id === 'w5' ? { id: w.id, from: w.from, to: w.to } : w));
  const { id: id2 } = await writeGraphWorkflow({ ...bare, id: 'wf_rg4' });
  assert.equal((await resolveGraph(projectDir, id2, REG())).wires.w5.maxCycles, 3);
});

test('refusals: unknown key, un-ported sidecar, placeable:false', async () => {
  const ghost = GRAPH();
  ghost.nodes = ghost.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'ghost' } : n));
  const { id } = await writeGraphWorkflow({ ...ghost, id: 'wf_ghost' });
  await assert.rejects(() => resolveGraph(projectDir, id, REG()), /unknown agent "ghost" — no such key in the registry/);
  const legacy = { ...REG(), planner: { ...REG().planner, inputs: undefined, outputs: undefined } };
  const { id: id2 } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_legacy' });
  await assert.rejects(() => resolveGraph(projectDir, id2, legacy),
    /agent "planner" has no v2 ports — port its sidecar to metaVersion 2/);
  const scanner = GRAPH();
  scanner.nodes = scanner.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'workspaceScanner' } : n));
  const { id: id3 } = await writeGraphWorkflow({ ...scanner, id: 'wf_scanner' });
  await assert.rejects(() => resolveGraph(projectDir, id3, REG()),
    /agent "workspaceScanner" declares placeable: false and cannot be a graph node/);
});

test('workspace resolve substitutes the variant, checks its port signature and forces fan-out', async () => {
  const reg = REG();
  assert.deepEqual(workspaceVariants(reg), { reviewer: reg.workspaceReviewer });
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_ws' });
  const g = await resolveGraph(projectDir, id, reg, undefined, { isWorkspace: true });
  assert.equal(g.nodes.n_rev.key, 'workspaceReviewer');
  assert.equal(g.nodes.n_rev.fanOut, true, 'workspaceFanOut forces it');
  assert.equal(g.nodes.n_plan.fanOut, true);
  assert.equal(g.agentsByKey.workspaceReviewer.key, 'workspaceReviewer');
  assert.equal(g.template.nodes.find((n) => n.id === 'n_rev').key, 'workspaceReviewer', 'the resolved template carries the substituted key');
  assert.equal(g.nodes.n_rev.authoredKey, 'reviewer', 'the authored key is kept for the legacy layer');
  // The sharp pin for A1: with the template walked under AUTHORED keys against a
  // SUBSTITUTED index, `n_rev` resolves known:false, classifyLoops finds NO loop
  // wire and `g.wires` comes back `{}` — a size >= 1 check would still pass on a
  // half-broken map, so pin the exact sets.
  assert.deepEqual([...g.loops.loopWireIds].sort(), ['w5'],
    'loop classification sees the substituted reviewer\'s ports');
  assert.deepEqual(g.wires, { w5: { maxCycles: 4 } }, 'per-wire budgets survive the substitution');
  assert.equal((await resolveGraph(projectDir, id, reg)).nodes.n_rev.key, 'reviewer', 'single-project is untouched');
  const drifted = { ...reg, workspaceReviewer: { ...reg.workspaceReviewer,
    inputs: [{ id: 'plan', type: 'json', required: true }] } };
  await assert.rejects(() => resolveGraph(projectDir, id, drifted, undefined, { isWorkspace: true }),
    /workspace variant "workspaceReviewer" does not match the port signature of "reviewer"/);
});

test('the legacy per-role layer applies to wf_default only', async () => {
  await setStep(projectDir, 'planner', { model: 'claude-opus-4-8' });
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_rg5' });
  assert.equal((await resolveGraph(projectDir, id, REG())).nodes.n_plan.model, 'tpl-model', 'saved rows ignore it');
});

test('workflowNodeDefaults / setWorkflowNodeDefaults on a v2 row rewrite graph.nodes[].config', async () => {
  const { id } = await writeGraphWorkflow({ ...GRAPH(), id: 'wf_def' });
  assert.deepEqual(workflowNodeDefaults(await readWorkflow(id)), { n_plan: { model: 'tpl-model', effort: 'high' } });
  // `sanitizeNodeDefaults` DROPS an effort outside EFFORTS (and warns), so an
  // effort like `low` would silently vanish and fail this deepEqual.
  const updated = await setWorkflowNodeDefaults(id,
    { n_plan: { model: 'claude-sonnet-5', effort: 'medium' }, n_impl: { fanOut: true } });
  assert.deepEqual(updated.nodes.find((n) => n.id === 'n_plan').config, { model: 'claude-sonnet-5', effort: 'medium' });
  assert.deepEqual(updated.nodes.find((n) => n.id === 'n_impl').config, { fanOut: true });
  const cleared = await setWorkflowNodeDefaults(id, { n_plan: null });
  assert.deepEqual(cleared.nodes.find((n) => n.id === 'n_plan').config, {});
  assert.deepEqual(cleared.nodes.find((n) => n.id === 'n_impl').config, { fanOut: true }, 'absent nodes keep theirs');
  await assert.rejects(() => setWorkflowNodeDefaults('wf_default', { x: null }), /cannot store defaults/);
});
