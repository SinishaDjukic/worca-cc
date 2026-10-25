// test/workflow-live-version.test.mjs — D2: once a workflow has versions, new runs use the version in use.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORCA_FLAGS = 'workflowTests';          // before the flag module is first read
const { writeGraphWorkflow, readRunnableWorkflow, assertRunnableWorkflow, resolveGraph } = await import('../src/core/workflows.mjs');
const { insertVersionTx, setLiveVersionTx } = await import('../src/core/workflow-revisions.mjs');
const { getDb, tx, _resetForTests } = await import('../src/core/db.mjs');
const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wflive-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const v1 = () => ({
  id: 'wf_live', name: 'Live test', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
async function withVersion1ThenDraftEdit() {
  await writeGraphWorkflow(v1());
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_live');
  tx(() => { const no = insertVersionTx(row, { note: null, by: null, parts: [], fingerprint: 'f1' }); setLiveVersionTx('wf_live', no); });
  const draft = v1(); draft.name = 'Live test (draft)'; draft.nodes[1] = { ...draft.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(draft);
}

test('use: live → version 1; draft → the row; an explicit number → that version', async () => {
  await withVersion1ThenDraftEdit();
  const live = await readRunnableWorkflow('wf_live');
  assert.deepEqual([live.versionNo, live.name, live.nodes[1].config.model], [1, 'Live test', undefined]);
  const draft = await readRunnableWorkflow('wf_live', { use: 'draft' });
  assert.deepEqual([draft.versionNo ?? null, draft.nodes[1].config.model], [null, 'sonnet']);
  assert.equal((await readRunnableWorkflow('wf_live', { use: 1 })).versionNo, 1);
  await assert.rejects(readRunnableWorkflow('wf_live', { use: 7 }), { code: 'NOT_FOUND' });
});

test('a workflow without versions runs its row, exactly as before', async () => {
  await writeGraphWorkflow(v1());
  const t = await readRunnableWorkflow('wf_live');
  assert.equal(t.versionNo ?? null, null);
  assert.equal(t.name, 'Live test');
});

test('assertRunnableWorkflow checks what will run; checkGraph:false (the Composer) reads the draft', async () => {
  await withVersion1ThenDraftEdit();
  assert.equal((await assertRunnableWorkflow('wf_live')).versionNo, 1);
  assert.equal((await assertRunnableWorkflow('wf_live', { checkGraph: false })).name, 'Live test (draft)');
});

test('resolveGraph resolves the version in use and reports its number', async () => {
  await withVersion1ThenDraftEdit();
  const registry = loadAgentRegistry();
  const live = await resolveGraph(null, 'wf_live', registry);
  assert.equal(live.versionNo, 1);
  assert.equal(live.template.name, 'Live test');
  const draft = await resolveGraph(null, 'wf_live', registry, undefined, { use: 'draft' });
  assert.equal(draft.versionNo, null);
});

test('a run records the version it used in its manifest', async () => {
  await withVersion1ThenDraftEdit();
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const { newPipelineId, findPipelineRowById } = await import('../src/core/artifacts.mjs');
  const { NO_PROJECT_KEY, noProjectWorkDir } = await import('../src/core/store.mjs');
  const pipelineId = newPipelineId();
  const orch = createOrchestrator({ workMode: 'none', pipelineId, projectKey: NO_PROJECT_KEY, projectDir: noProjectWorkDir(pipelineId),
    workflowId: 'wf_live', prompt: 'x', claude: { mock: true }, auto: true });
  await orch.run();
  const stepper = JSON.parse(findPipelineRowById(pipelineId).stepper);
  assert.deepEqual(stepper.workflowVersion, { no: 1 });
  assert.equal(stepper.template.name, 'Live test');
});
