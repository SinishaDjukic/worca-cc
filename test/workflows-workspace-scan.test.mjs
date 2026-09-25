// test/workflows-workspace-scan.test.mjs
// The reserved Workspace scan workflow (wf_workspace_scan): a built-in graph that may
// carry the unplaceable workspaceScanner, runnable, never listed, while a SAVED row
// carrying the scanner is still refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import {
  WORKSPACE_SCAN_WORKFLOW_ID, GRAPH_WORKSPACE_SCAN_WORKFLOW, RESERVED_WORKFLOW_IDS, isReservedWorkflowId,
} from '../src/core/graph/builtin-workflows.mjs';
import {
  readWorkflow, assertRunnableWorkflow, resolveGraph, listWorkflows, writeGraphWorkflow,
} from '../src/core/workflows.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';

useTempHome(after);
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

test('wf_workspace_scan is a reserved built-in: task -> workspaceScanner -> End', async () => {
  assert.equal(WORKSPACE_SCAN_WORKFLOW_ID, 'wf_workspace_scan');
  assert.ok(RESERVED_WORKFLOW_IDS.includes('wf_workspace_scan'));
  assert.equal(isReservedWorkflowId('wf_workspace_scan'), true);
  assert.equal(await readWorkflow('wf_workspace_scan'), GRAPH_WORKSPACE_SCAN_WORKFLOW);
  const scan = GRAPH_WORKSPACE_SCAN_WORKFLOW.nodes.find((n) => n.id === 'n_scan');
  assert.equal(scan.key, 'workspaceScanner');
  assert.deepEqual(
    GRAPH_WORKSPACE_SCAN_WORKFLOW.wires.map((w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`),
    ['n_task.task->n_scan.task', 'n_scan.workspace->n_end.result'],
  );
  assert.equal(Object.isFrozen(GRAPH_WORKSPACE_SCAN_WORKFLOW.nodes[1]), true, 'deep-frozen');
});

test('it is runnable (assertRunnableWorkflow) and never listed', async () => {
  const row = await assertRunnableWorkflow('wf_workspace_scan');
  assert.equal(row.id, 'wf_workspace_scan');
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_workspace_scan'), 'hidden from listWorkflows');
});

test('V4 refuses placeable:false by default and allows it only with allowUnplaceable', () => {
  const reg = loadAgentRegistry();
  const portsFn = registryPortsFn(reg, {});
  const plain = validateGraph(GRAPH_WORKSPACE_SCAN_WORKFLOW, portsFn);
  assert.ok(plain.errors.some((e) => e.code === 'V4' && /placeable: false/.test(e.message)), 'default still refuses');
  const allowed = validateGraph(GRAPH_WORKSPACE_SCAN_WORKFLOW, portsFn, { allowUnplaceable: true });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
});

test('resolveGraph resolves the reserved scan graph with fan-out on the scanner', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfscan-'));
  dirs.push(projectDir);
  const resolved = await resolveGraph(projectDir, 'wf_workspace_scan', loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace: true });
  assert.equal(resolved.nodes.n_scan.fanOut, true);
});

test('a SAVED row carrying the scanner is still refused (the exemption is reserved-only)', async () => {
  const { id } = await writeGraphWorkflow({ ...structuredClone(GRAPH_WORKSPACE_SCAN_WORKFLOW), id: 'wf_my_scan', name: 'My scan' });
  assert.notEqual(id, 'wf_workspace_scan');
  await assert.rejects(() => assertRunnableWorkflow(id), (e) => e.code === 'INVALID_GRAPH' && /placeable: false/.test(e.message));
});

test('the scanner writes workspace-scan.md (createPipeline owns workspace-description.md)', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.workspaceScanner.outputs[0].filename, 'workspace-scan.md');
});
