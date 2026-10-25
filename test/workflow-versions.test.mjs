// test/workflow-versions.test.mjs — Save version, Use for new runs, what changed, restore into draft.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORCA_FLAGS = 'workflowTests';
const { writeGraphWorkflow, readWorkflow } = await import('../src/core/workflows.mjs');
const { createVersion, useVersion, versionStatus, restoreRevision, versionsOverview } = await import('../src/core/workflow-versions.mjs');
const { listRevisions, liveVersionNo } = await import('../src/core/workflow-revisions.mjs');
const { _resetForTests, getDb } = await import('../src/core/db.mjs');

const homes = [];
let deps;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfver-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  const md = join(dir, 'planner.md');
  await writeFile(md, 'Plan it.');
  deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {}, mdPath: md };
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const tpl = (over = {}) => ({
  id: 'wf_v', name: 'Versioned', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
  ...over,
});

test('the first version becomes the one in use; saving again without changes is refused', async () => {
  await writeGraphWorkflow(tpl());
  const v = await createVersion('wf_v', { note: 'First', by: 'Tomica', deps });
  assert.deepEqual(v, { versionNo: 1, liveVersionNo: 1 });
  await assert.rejects(createVersion('wf_v', { deps }), { code: 'UNCHANGED', versionNo: 1 });
});

test('a later version does not change what runs until Use', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  await writeGraphWorkflow(tpl({ name: 'Versioned 2' }));
  assert.deepEqual(await createVersion('wf_v', { deps }), { versionNo: 2, liveVersionNo: 1 });
  assert.deepEqual(useVersion('wf_v', 2), { liveVersionNo: 2 });
  assert.equal(liveVersionNo('wf_v'), 2);
  assert.throws(() => useVersion('wf_v', 9), { code: 'NOT_FOUND' });
});

test('status: the draft differs from the version in use, in plain words, including a Library edit', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  const t = tpl(); t.nodes[1] = { ...t.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(t);
  await writeFile(deps.mdPath, 'Plan it carefully.');
  const s = await versionStatus('wf_v', { deps });
  assert.equal(s.liveVersionNo, 1);
  assert.equal(s.draft.changed, true);
  assert.deepEqual(s.draft.changes, ['Planner: AI model default → sonnet', 'Planner: changed in the Library']);
  assert.deepEqual(s.draft.partsChanged, [{ kind: 'agent', key: 'planner' }]);
});

test('status without versions: draft is null, and so is sinceLatest (the next save is the first version)', async () => {
  await writeGraphWorkflow(tpl());
  assert.deepEqual(await versionStatus('wf_v', { deps }), { liveVersionNo: null, latestVersionNo: null, draft: null, sinceLatest: null });
});

test('status: sinceLatest compares the draft with the LATEST version (what Save version compares), not the one in use', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });                       // v1, in use
  const t = tpl(); t.nodes[1] = { ...t.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(t);
  await createVersion('wf_v', { deps });                       // v2, not in use
  const s = await versionStatus('wf_v', { deps });
  assert.equal(s.liveVersionNo, 1);
  assert.deepEqual(s.draft.changes, ['Planner: AI model default → sonnet'], 'draft.changes still compares with the version in use');
  assert.deepEqual(s.draft.sinceLatest, { versionNo: 2, changes: [] });
  assert.deepEqual(s.sinceLatest, s.draft.sinceLatest);
  // A Library edit after v2 shows since v2 too.
  await writeFile(deps.mdPath, 'Plan it carefully.');
  const s2 = await versionStatus('wf_v', { deps });
  assert.deepEqual(s2.draft.sinceLatest, { versionNo: 2, changes: ['Planner: changed in the Library'] });
  const o = await versionsOverview('wf_v', { deps });
  assert.deepEqual(o.sinceLatest, { versionNo: 2, changes: ['Planner: changed in the Library'] });
  assert.deepEqual(o.draft.sinceLatest, o.sinceLatest);
});

test('restore puts a saved state into the draft, keeps the version in use, and can itself be undone', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  await writeGraphWorkflow(tpl({ name: 'Edited' }));
  const auto = listRevisions('wf_v').find((r) => r.versionNo === null);
  await restoreRevision('wf_v', auto.id, { by: 'Tomica' });
  assert.equal((await readWorkflow('wf_v')).name, 'Versioned');
  assert.equal(liveVersionNo('wf_v'), 1);
  assert.equal(listRevisions('wf_v')[0].source, 'restore');
  await assert.rejects(restoreRevision('wf_v', 99999), { code: 'NOT_FOUND' });
});

test('plugin rows cannot be versioned; unknown ids are NOT_FOUND', async () => {
  await writeGraphWorkflow(tpl({ id: 'wfp_p_x', origin: 'plugin:p' }));
  await assert.rejects(createVersion('wfp_p_x', { deps }), { code: 'NOT_VERSIONABLE' });
  await assert.rejects(createVersion('wf_nope', { deps }), { code: 'NOT_FOUND' });
});

test('overview: versions newest first with what changed, in use, runs; history of automatic saves', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { note: 'First', deps });
  await writeGraphWorkflow(tpl({ name: 'Versioned 2' }));
  await createVersion('wf_v', { note: 'Renamed', deps });
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, stepper) VALUES ('p1', 'k', 'done', ?)`)
    .run(JSON.stringify({ template: { id: 'wf_v', name: 'Versioned' }, workflowVersion: { no: 1 } }));
  const o = await versionsOverview('wf_v', { deps });
  assert.deepEqual(o.versions.map((v) => [v.versionNo, v.inUse, v.runs]), [[2, false, 0], [1, true, 1]]);
  assert.deepEqual(o.versions[0].changes, ['Renamed from "Versioned" to "Versioned 2"']);
  assert.deepEqual(o.versions[1].changes, ['First version']);
  assert.deepEqual(o.history.map((h) => h.source), ['save']);
});
