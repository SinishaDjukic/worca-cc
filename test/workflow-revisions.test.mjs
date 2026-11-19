// test/workflow-revisions.test.mjs — every write of a workflow row keeps the state it replaced (#721, workflow part).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGraphWorkflow, setWorkflowNodeDefaults, deleteWorkflow } from '../src/core/workflows.mjs';
import { listRevisions, readRevision, AUTO_KEEP, snapshotRowTx, insertVersionTx } from '../src/core/workflow-revisions.mjs';
import { getDb, tx, _resetForTests } from '../src/core/db.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfrev-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const tpl = (over = {}) => ({
  id: 'wf_brief', name: 'Brief writer', domain: 'general',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }],
  ...over,
});

test('the first save takes no snapshot; a changing save snapshots the previous state', async () => {
  await writeGraphWorkflow(tpl());
  assert.equal(listRevisions('wf_brief').length, 0);
  await writeGraphWorkflow(tpl({ name: 'Product brief writer' }));
  const revs = listRevisions('wf_brief');
  assert.equal(revs.length, 1);
  assert.deepEqual([revs[0].name, revs[0].source, revs[0].versionNo], ['Brief writer', 'save', null]);
  assert.equal(readRevision('wf_brief', revs[0].id).graph.nodes.length, 2);
});

test('a save that changes nothing takes no snapshot', async () => {
  await writeGraphWorkflow(tpl());
  await writeGraphWorkflow(tpl());
  await writeGraphWorkflow(tpl());
  assert.equal(listRevisions('wf_brief').length, 0);
});

test('revisionSource and by are recorded', async () => {
  await writeGraphWorkflow(tpl());
  await writeGraphWorkflow(tpl({ name: 'X' }), { revisionSource: 'restore', by: 'Tomica' });
  const [r] = listRevisions('wf_brief');
  assert.deepEqual([r.source, r.by], ['restore', 'Tomica']);
});

test('defaults and delete snapshot too; history outlives the deleted row', async () => {
  await writeGraphWorkflow(tpl());
  await setWorkflowNodeDefaults('wf_brief', { n_plan: { model: 'sonnet' } });
  assert.deepEqual(listRevisions('wf_brief').map((r) => r.source), ['defaults']);
  assert.equal(await deleteWorkflow('wf_brief'), true);
  assert.deepEqual(listRevisions('wf_brief').map((r) => r.source), ['delete', 'defaults']);
  assert.equal(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_brief'), undefined);
});

test('plugin-owned rows take no snapshots', async () => {
  await writeGraphWorkflow(tpl({ id: 'wfp_x_brief', origin: 'plugin:x' }));
  await writeGraphWorkflow(tpl({ id: 'wfp_x_brief', name: 'changed' }));
  assert.equal(listRevisions('wfp_x_brief').length, 0);
});

test(`only the last ${AUTO_KEEP} automatic snapshots are kept; named versions are never pruned`, async () => {
  await writeGraphWorkflow(tpl());
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_brief');
  tx(() => { insertVersionTx(row, { note: 'v1', by: null, parts: [], fingerprint: 'f', now: '2026-10-25T00:00:00Z' }); });
  tx(() => { for (let i = 0; i < AUTO_KEEP + 5; i += 1) snapshotRowTx(row, { source: 'save' }); });
  const revs = listRevisions('wf_brief');
  assert.equal(revs.filter((r) => r.versionNo === null).length, AUTO_KEEP);
  assert.equal(revs.filter((r) => r.versionNo === 1).length, 1);
});
