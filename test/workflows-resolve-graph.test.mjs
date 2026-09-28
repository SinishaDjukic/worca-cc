import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel, setWireCycles, setStep } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import {
  writeGraphWorkflow, readWorkflow, resolveGraph, workspaceVariants, workflowNodeDefaults,
  setWorkflowNodeDefaults, assertRunnableWorkflow,
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
  await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-5-5' });
  const g = await resolveGraph(projectDir, id, REG());
  assert.equal(g.nodes.n_plan.model, 'claude-opus-5-5');
  assert.equal(g.nodes.n_plan.effort, undefined, 'the template effort belonged to the template model');
  await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-5-5', effort: 'max' });
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

/** A script layer with one node-runtime script; `passAt` and a required `cmd` param. */
function scriptLayer() {
  const sdir = mkdtempSync(join(tmpdir(), 'worca-rg-scripts-'));
  writeFileSync(join(sdir, 'runTests.mjs'), 'export default async () => ({ summary: "ok" });\n');
  writeFileSync(join(sdir, 'runTests.meta.json'), JSON.stringify({
    key: 'runTests', metaVersion: 2, runtime: 'node', file: 'runTests.mjs', timeoutMs: 20000,
    params: [{ id: 'passAt', type: 'number', default: 0 }, { id: 'cmd', type: 'command', required: true }],
    inputs: [{ id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
      { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
    verdict: { filename: 'tests-cycle{cycle}.json' }, mock: { summary: 'sidecar mock' },
  }));
  return { sdir, scripts: loadScriptRegistry({ scriptsDir: sdir, userScriptsDir: null, includePlugins: false, agentKeys: null }) };
}
/** task -> plan -> impl -> runTests -> rev -> end, with runTests.fail -> impl.fix (3). rev.review stays unwired. */
const SCRIPT_GRAPH = (config) => ({
  ...GRAPH(),
  nodes: [...GRAPH().nodes, { id: 'n_tests', kind: 'script', key: 'runTests', x: 750, y: 0, config }],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w7', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_tests', port: 'done' } },
    { id: 'w8', from: { node: 'n_tests', port: 'fail' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w9', from: { node: 'n_tests', port: 'pass' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
});

test('resolveGraph: a script node resolves to a script ctx (merged params, timeout precedence, sidecar mock) beside the agents', async () => {
  const { sdir, scripts } = scriptLayer();
  const { id } = await writeGraphWorkflow({ ...SCRIPT_GRAPH({ params: { cmd: 'npm test', passAt: 2 }, timeoutMs: 5000 }), id: 'wf_rg_script' });
  const g = await resolveGraph(projectDir, id, REG(), undefined, { scripts });
  const nc = g.nodes.n_tests;
  assert.equal(nc.kind, 'script');
  assert.equal(nc.key, 'runTests');
  assert.equal(nc.authoredKey, 'runTests');
  assert.equal(nc.runtime, 'node');
  assert.equal(nc.file, join(sdir, 'runTests.mjs'));
  assert.equal(nc.command, null);
  assert.deepEqual(nc.params, { passAt: 2, cmd: 'npm test' });
  assert.equal(nc.timeoutMs, 5000, 'node config beats the sidecar');
  assert.deepEqual(nc.mock, { summary: 'sidecar mock' }, 'the sidecar mock rides when the node declares none');
  assert.equal(nc.meta, scripts.runTests);
  assert.equal(nc.awaitAll, false);
  assert.equal(nc.duplicateKey, false);
  assert.deepEqual(nc.config, { params: { cmd: 'npm test', passAt: 2 }, timeoutMs: 5000 });
  assert.deepEqual([...g.scriptKeys], ['runTests']);
  assert.deepEqual(Object.keys(g.scriptsByKey), ['runTests']);
  assert.deepEqual([...g.agentKeys].sort(), ['implementer', 'planner', 'reviewer'], 'agentKeys stays agent-only');
  assert.deepEqual(g.ports(g.template.nodes.find((n) => n.id === 'n_tests')).inputs.map((i) => i.id), ['done', 'await']);
  assert.deepEqual(g.wires, { w8: { maxCycles: 3 } });
  const plain = await writeGraphWorkflow({ ...SCRIPT_GRAPH({ params: { cmd: 'x' }, mock: { summary: 'node mock' } }), id: 'wf_rg_script2' });
  const g2 = await resolveGraph(projectDir, plain.id, REG(), undefined, { scripts });
  assert.equal(g2.nodes.n_tests.timeoutMs, 20000, 'the sidecar timeout when the node sets none');
  assert.deepEqual(g2.nodes.n_tests.mock, { summary: 'node mock' }, 'the node mock beats the sidecar mock');
});

test('resolveGraph: an unknown script key throws the registry sentence; the run gate validates with scripts', async () => {
  const { scripts } = scriptLayer();
  const { id } = await writeGraphWorkflow({ ...SCRIPT_GRAPH({ params: { cmd: 'x' } }), id: 'wf_rg_script3' });
  await assert.rejects(resolveGraph(projectDir, id, REG(), undefined, { scripts: {} }), { message: 'unknown script "runTests" — no such key in the registry' });
  await assert.rejects(assertRunnableWorkflow(id, { registry: REG(), scripts: {} }), (e) => e.code === 'INVALID_GRAPH' && /unknown script "runTests"/.test(e.message));
  const live = await assertRunnableWorkflow(id, { registry: REG(), scripts });
  assert.equal(live.id, id);
});
