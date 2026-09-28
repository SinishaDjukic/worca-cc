// test/workflows-workspace-scan.test.mjs
// The reserved Workspace scan workflow (wf_workspace_scan) — the hybrid interconnection map (wsmap
// spec D5): a built-in graph that may carry the unplaceable scan agents AND scripts, runnable, never
// listed, while a SAVED copy of it is still refused — by the run gate (V4) and by resolveGraph.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import {
  WORKSPACE_SCAN_WORKFLOW_ID, GRAPH_WORKSPACE_SCAN_WORKFLOW, RESERVED_WORKFLOW_IDS, isReservedWorkflowId, WORKSPACE_SCAN_DEFAULT_MODELS,
} from '../src/core/graph/builtin-workflows.mjs';
import {
  readWorkflow, assertRunnableWorkflow, resolveGraph, listWorkflows, writeGraphWorkflow,
} from '../src/core/workflows.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { WORKSPACE_SCAN_OUTPUT_FILE } from '../src/core/workspace-scan-run.mjs';

useTempHome(after);
// runOpts' spawnEnv honours a LOWER ambient cap (min(8, ambient)); start from none so the cap test
// below reads worca's own 8 whatever the developer shell exports.
delete process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY;
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wfscan-')); dirs.push(d); return d; };

/** The index's wire list (P2 "Workflow v3"), in template order. */
const WIRES = [
  'n_task.task->n_extract.task',
  'n_extract.brief->n_scan.brief',
  'n_extract.extract->n_catalog.extract',
  'n_scan.survey->n_catalog.survey',
  'n_catalog.brief->n_usage.brief',
  'n_catalog.catalog->n_join.catalog',
  'n_usage.usage->n_join.usage',
  'n_join.brief->n_synth.brief',
  'n_join.map->n_render.map',
  'n_synth.synthesis->n_render.synthesis',
  'n_render.workspace->n_end.result',
];
const SCRIPT_KEYS = ['workspaceMapCatalog', 'workspaceMapExtract', 'workspaceMapJoin', 'workspaceMapRender'];
const UNPLACEABLE_NODES = ['n_catalog', 'n_extract', 'n_join', 'n_render', 'n_scan', 'n_synth', 'n_usage'];
const resolveScan = async (opts = {}) => resolveGraph(await tmp(), 'wf_workspace_scan', loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace: true, ...opts });

test('wf_workspace_scan is the reserved hybrid map pipeline, wired exactly as the index pins it', async () => {
  assert.equal(WORKSPACE_SCAN_WORKFLOW_ID, 'wf_workspace_scan');
  assert.ok(RESERVED_WORKFLOW_IDS.includes('wf_workspace_scan'));
  assert.equal(isReservedWorkflowId('wf_workspace_scan'), true);
  assert.equal(await readWorkflow('wf_workspace_scan'), GRAPH_WORKSPACE_SCAN_WORKFLOW);
  assert.equal(GRAPH_WORKSPACE_SCAN_WORKFLOW.version, 2, 'the template FORMAT — resolveGraph runs version 2 only');
  assert.deepEqual(GRAPH_WORKSPACE_SCAN_WORKFLOW.nodes.map((n) => [n.id, n.kind, n.key ?? null]), [
    ['n_task', 'task', null], ['n_extract', 'script', 'workspaceMapExtract'], ['n_scan', 'agent', 'workspaceScanner'],
    ['n_catalog', 'script', 'workspaceMapCatalog'], ['n_usage', 'agent', 'workspaceUsageMapper'], ['n_join', 'script', 'workspaceMapJoin'],
    ['n_synth', 'agent', 'workspaceSynthesizer'], ['n_render', 'script', 'workspaceMapRender'], ['n_end', 'end', null],
  ]);
  assert.deepEqual(GRAPH_WORKSPACE_SCAN_WORKFLOW.wires.map((w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`), WIRES);
  const cfg = Object.fromEntries(GRAPH_WORKSPACE_SCAN_WORKFLOW.nodes.map((n) => [n.id, { ...n.config }]));
  const M = WORKSPACE_SCAN_DEFAULT_MODELS;
  const fan = { model: M.scanModel, effort: M.scanEffort, subagentModel: M.agentModel, subagentEffort: M.agentEffort };
  assert.deepEqual(cfg.n_scan, fan);
  assert.deepEqual(cfg.n_usage, fan);
  assert.deepEqual(cfg.n_synth, { model: M.scanModel, effort: M.scanEffort });
  for (const id of ['n_catalog', 'n_join', 'n_render']) assert.deepEqual(cfg[id], { awaitAll: true }, id);
  assert.deepEqual(cfg.n_extract, {});
  assert.equal(Object.isFrozen(GRAPH_WORKSPACE_SCAN_WORKFLOW.nodes[2].config), true, 'deep-frozen');
});

test('it is runnable (assertRunnableWorkflow) and never listed', async () => {
  const row = await assertRunnableWorkflow('wf_workspace_scan');
  assert.equal(row.id, 'wf_workspace_scan');
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_workspace_scan'), 'hidden from listWorkflows');
});

test('V4 refuses every placeable:false agent AND script by default, allows them with allowUnplaceable — and nothing warns', () => {
  const reg = loadAgentRegistry();
  const portsFn = registryPortsFn(reg, loadScriptRegistry({ agentKeys: Object.keys(reg) }));
  const plain = validateGraph(GRAPH_WORKSPACE_SCAN_WORKFLOW, portsFn);
  assert.deepEqual(plain.errors.filter((e) => e.code === 'V4').map((e) => e.nodeId).sort(), UNPLACEABLE_NODES);
  const allowed = validateGraph(GRAPH_WORKSPACE_SCAN_WORKFLOW, portsFn, { allowUnplaceable: true });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
  assert.deepEqual(allowed.warnings, [], 'no V16/V17/V18: the awaitAll barriers sit exactly on the two-input stages');
});

test('resolveGraph resolves the reserved graph: the four cards placed, survey + usage fan out, synthesis does not', async () => {
  const r = await resolveScan();
  assert.deepEqual([...r.scriptKeys].sort(), SCRIPT_KEYS);
  assert.equal(r.nodes.n_extract.kind, 'script');
  assert.equal(r.nodes.n_extract.timeoutMs, 1800000);
  assert.equal(r.nodes.n_catalog.awaitAll, true);
  assert.equal(r.nodes.n_scan.fanOut, true);
  assert.equal(r.nodes.n_usage.fanOut, true);
  assert.equal(r.nodes.n_synth.fanOut, false);
});

test('the fan-out stages spawn with the concurrency cap, the synthesizer without it (D9)', async () => {
  const projectDir = await tmp();
  const r = await resolveGraph(projectDir, 'wf_workspace_scan', loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace: true });
  const call = { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] };
  const spawnEnvOf = (id) => runOpts({ projectDir, claudeOpts: {}, node: r.nodes[id] }, call).spawnEnv;
  const fanOutEnv = { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '8', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' };
  assert.deepEqual(spawnEnvOf('n_scan'), fanOutEnv);
  assert.deepEqual(spawnEnvOf('n_usage'), fanOutEnv);
  assert.equal(spawnEnvOf('n_synth'), undefined);
});

test('a SAVED copy is refused by the run gate AND by resolveGraph — the exemption is reserved-only, for scripts too', async () => {
  const { id } = await writeGraphWorkflow({ ...structuredClone(GRAPH_WORKSPACE_SCAN_WORKFLOW), id: 'wf_my_scan', name: 'My scan' });
  assert.notEqual(id, 'wf_workspace_scan');
  await assert.rejects(() => assertRunnableWorkflow(id), (e) => e.code === 'INVALID_GRAPH' && /placeable: false/.test(e.message));
  const projectDir = await tmp();
  await assert.rejects(
    () => resolveGraph(projectDir, id, loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace: true }),
    /script "workspaceMapExtract" declares placeable: false and cannot be a graph node/,
  );
});

test('the render stage writes workspace-scan.md — the file the finalize reads (createPipeline owns workspace-description.md)', () => {
  const scripts = loadScriptRegistry({ agentKeys: Object.keys(loadAgentRegistry()) });
  assert.equal(scripts.workspaceMapRender.outputs[0].filename, WORKSPACE_SCAN_OUTPUT_FILE);
  assert.equal(WORKSPACE_SCAN_OUTPUT_FILE, 'workspace-scan.md');
});
