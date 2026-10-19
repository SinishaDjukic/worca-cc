// test/orchestrator-run-overlay.test.mjs — a NORMAL run hands opts.overlay to resolveGraph (merged over the project
// layer, never ignoreProjectOverrides) and records it on the manifest beside the cells it resolved to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-oro-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});
const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });

test('a normal run resolves opts.overlay per node and records it as manifest.runOverlay', async () => {
  const overlay = { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' }, n_review: { fanOut: true } } };
  const orch = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true }, overlay });
  const t = await orch._resolveTopology(REG);
  const cell = (id) => t.manifest.graph.nodes.find((n) => n.id === id);
  assert.deepEqual([cell('n_plan').model, cell('n_plan').effort], ['claude-haiku-4-5', 'medium']);
  assert.equal(cell('n_review').fanOut, true);
  assert.equal(cell('n_impl').model, '', 'a node the overlay does not name keeps its own layers');
  assert.deepEqual(t.manifest.runOverlay, overlay);
  assert.notEqual(t.manifest.runOverlay.nodes, overlay.nodes, 'a copy, never the caller\'s object');
  const plain = await createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true } })._resolveTopology(REG);
  assert.equal('runOverlay' in plain.manifest, false, 'no overlay, no key');
  const empty = await createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true }, overlay: { nodes: {} } })._resolveTopology(REG);
  assert.equal('runOverlay' in empty.manifest, false, 'an empty overlay is none');
});

test('a ticket-shaped overlay (a model, no effort) lets neither the project\'s stored effort nor the template\'s ride under it — in the run or on its record', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-oro-'));
  try {
    const { id } = await writeGraphWorkflow({
      id: 'wf_oro', name: 'ORO', domain: 'coding',
      nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
        { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
        { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: { model: 'claude-opus-5-5', effort: 'max' } },
        { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
        { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
      wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
        { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
        { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
        { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
        { id: 'w5', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
        { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
    });
    await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-5-5', effort: 'max' });
    // What a firing schedule ticket hands over: its re-parse (run-overlay.mjs parseRunOverlay) drops `effort: ''`.
    const overlay = { nodes: { n_plan: { model: 'claude-haiku-4-5' }, n_impl: { model: 'claude-haiku-4-5', effort: '' } } };
    const t = await createOrchestrator({ projectDir, workflowId: id, claude: { mock: true }, overlay })._resolveTopology(REG);
    const cell = (nid) => t.manifest.graph.nodes.find((n) => n.id === nid);
    assert.deepEqual([cell('n_plan').model, cell('n_plan').effort], ['claude-haiku-4-5', ''], 'the project node\'s stored max stays out');
    assert.deepEqual([cell('n_impl').model, cell('n_impl').effort], ['claude-haiku-4-5', ''], 'the template\'s max stays off the record a resume spawns');
    assert.deepEqual(t.manifest.runOverlay.nodes.n_plan, { model: 'claude-haiku-4-5', effort: '' }, 'recorded as it ran');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('the overlay record is not a model the run dispatches: the credential preflight (manifestModels) sees only the cells', async () => {
  const { manifestModels } = await import('../src/core/broker-routing.mjs');
  // A defragment run's pinned pair (named at start) beats an overlay model; the overlay stays on the record.
  const defrag = await createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_memory_defrag', memoryScope: 'project',
    claude: { mock: true, model: 'claude-opus-5-5' }, overlay: { nodes: { n_defrag: { model: 'claude-haiku-4-5', effort: '' } } } })._resolveTopology(REG);
  assert.equal(defrag.manifest.graph.nodes.find((n) => n.id === 'n_defrag').model, 'claude-opus-5-5', 'the pinned pair wins');
  assert.equal(defrag.manifest.runOverlay.nodes.n_defrag.model, 'claude-haiku-4-5', 'the request stays on the record');
  assert.equal(manifestModels(defrag.manifest).has('claude-haiku-4-5'), false, 'a model no cell runs needs no key');
  // A fired ticket whose engine changed since it was scheduled: the resolver drops the other engine's model.
  const dropped = await createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true },
    overlay: { nodes: { n_plan: { model: 'gpt-5.5', effort: '' } } } })._resolveTopology(REG);
  assert.notEqual(dropped.manifest.graph.nodes.find((n) => n.id === 'n_plan').model, 'gpt-5.5');
  assert.equal(manifestModels(dropped.manifest).has('gpt-5.5'), false);
});

test('an overlay\'s loop budgets reach resolveGraph and the record; a wires-only overlay records no nodes', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-oro-w-'));
  try {
    const { id } = await writeGraphWorkflow({
      id: 'wf_oro_w', name: 'ORO wires', domain: 'coding',
      nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
        { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
        { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} },
        { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
      wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
        { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
        { id: 'w_loop', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
        { id: 'w3', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
    });
    const orch = createOrchestrator({ projectDir, workflowId: id, claude: { mock: true }, overlay: { wires: { w_loop: { maxCycles: 1 } } } });
    const t = await orch._resolveTopology(REG);
    assert.deepEqual(t.manifest.runOverlay, { wires: { w_loop: { maxCycles: 1 } } });
    assert.equal(orch.resolved.wires.w_loop.maxCycles, 1);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
