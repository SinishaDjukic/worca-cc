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
  // The latest version is the one in use: Save version's comparison lists the same changes as the status.
  assert.deepEqual(s.sinceLatest.changes, s.draft.changes);
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

test('overview: changesFromInUse is what changes for new runs (the version in use → this one), across versions too', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });                       // v1, in use
  const t = tpl(); t.nodes[1] = { ...t.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(t);
  await createVersion('wf_v', { deps });                       // v2
  await writeFile(deps.mdPath, 'Plan it carefully.');
  await writeGraphWorkflow({ ...t, name: 'Versioned 3' });
  await createVersion('wf_v', { deps });                       // v3: not next to v1
  const o = await versionsOverview('wf_v', { deps });
  const by = Object.fromEntries(o.versions.map((v) => [v.versionNo, v]));
  assert.deepEqual(by[1].changesFromInUse, [], 'the version in use differs from nothing');
  assert.deepEqual(by[2].changesFromInUse, ['Planner: AI model default → sonnet']);
  // I4 / D6: every version runs today's agent text, so a Library edit is not a difference between versions.
  assert.deepEqual(by[3].changesFromInUse, ['Renamed from "Versioned" to "Versioned 3"', 'Planner: AI model default → sonnet']);
  // …but the Use dialog may say once that Library edits apply to every version: v1 and v2 recorded the old text.
  assert.deepEqual(o.versions.map((v) => [v.versionNo, v.libraryEdited]), [[3, false], [2, true], [1, true]]);
  assert.deepEqual(by[3].changes, ['Renamed from "Versioned" to "Versioned 3"'], 'changes still compares with the previous version');
  useVersion('wf_v', 3);
  const o3 = await versionsOverview('wf_v', { deps });
  assert.deepEqual(o3.versions.find((v) => v.versionNo === 1).changesFromInUse,
    ['Renamed from "Versioned 3" to "Versioned"', 'Planner: AI model sonnet → default']);
});

// C1: the loop budget lives in the stored wire.config (composer.mjs, canvas-ops.mjs), not at the wire's top level.
const loopTpl = (cycles) => ({
  id: 'wf_loop', name: 'Loop', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 320, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 600, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 880, y: 200, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w4', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: cycles } },
    { id: 'w5', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
});

test('C1: a loop budget edit (3 → 7) shows as a change, Save version takes it, and runs keep the version in use', async () => {
  const md = deps.mdPath;
  const loopDeps = { registry: { implementer: { key: 'implementer', origin: 'builtin', agentPath: md, displayName: 'Implement' },
    reviewer: { key: 'reviewer', origin: 'builtin', agentPath: md, displayName: 'Review' } }, scripts: {} };
  await writeGraphWorkflow(loopTpl(3));
  assert.deepEqual(await createVersion('wf_loop', { deps: loopDeps }), { versionNo: 1, liveVersionNo: 1 });
  await writeGraphWorkflow(loopTpl(7));
  const s = await versionStatus('wf_loop', { deps: loopDeps });
  assert.equal(s.draft.changed, true);
  assert.deepEqual(s.draft.changes, ['Implement loop: at most 3 rounds → 7']);
  assert.deepEqual(s.sinceLatest.changes, ['Implement loop: at most 3 rounds → 7']);
  assert.deepEqual(await createVersion('wf_loop', { deps: loopDeps }), { versionNo: 2, liveVersionNo: 1 });
  const { readRunnableWorkflow, resolveGraph } = await import('../src/core/workflows.mjs');
  const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
  const run = await readRunnableWorkflow('wf_loop');
  assert.deepEqual([run.versionNo, run.wires.find((w) => w.id === 'w4').config], [1, { maxCycles: 3 }]);
  const resolved = await resolveGraph(null, 'wf_loop', loadAgentRegistry());
  assert.deepEqual([resolved.versionNo, resolved.wires.w4.maxCycles], [1, 3]);
  useVersion('wf_loop', 2);
  assert.equal((await resolveGraph(null, 'wf_loop', loadAgentRegistry())).wires.w4.maxCycles, 7);
});

test('I6: one malformed pipelines.stepper does not break the overview', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, stepper) VALUES ('pbad', 'k', 'done', 'not json')`).run();
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, stepper) VALUES ('pok', 'k', 'done', ?)`)
    .run(JSON.stringify({ template: { id: 'wf_v' }, workflowVersion: { no: 1 } }));
  const o = await versionsOverview('wf_v', { deps });
  assert.deepEqual(o.versions.map((v) => [v.versionNo, v.runs]), [[1, 1]]);
});

test('I5 / scenario 4: restoring a state that no longer validates is INVALID_GRAPH; the draft and the version in use stay', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  await writeGraphWorkflow(tpl({ name: 'Edited' }));
  getDb().prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_v', NULL, 'Versioned', ?, 'f', 'save', '2026-10-25T00:00:00Z')`)
    .run(JSON.stringify({ nodes: [{ id: 'n_x', kind: 'agent', key: 'no-such-agent', config: {} }], wires: [] }));
  const bad = listRevisions('wf_v')[0];
  const before = { draft: await readWorkflow('wf_v'), revisions: listRevisions('wf_v').length };
  await assert.rejects(restoreRevision('wf_v', bad.id), (e) => e.code === 'INVALID_GRAPH' && Array.isArray(e.errors) && e.errors.length > 0);
  const draft = await readWorkflow('wf_v');
  assert.deepEqual([draft.name, draft.nodes.length, draft.updatedAt], [before.draft.name, before.draft.nodes.length, before.draft.updatedAt]);
  assert.equal(liveVersionNo('wf_v'), 1);
  assert.equal(listRevisions('wf_v').length, before.revisions, 'a refused restore takes no snapshot');
});

test('M1: a deleted workflow saved again under the same id keeps its old versions, with no version in use', async () => {
  const { deleteWorkflow } = await import('../src/core/workflows.mjs');
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  await deleteWorkflow('wf_v');
  await writeGraphWorkflow(tpl({ name: 'Versioned again' }));
  const o = await versionsOverview('wf_v', { deps });
  assert.deepEqual([o.liveVersionNo, o.draft, o.versions.map((v) => [v.versionNo, v.changesFromInUse])], [null, null, [[1, null]]]);
  assert.deepEqual(await createVersion('wf_v', { deps }), { versionNo: 2, liveVersionNo: 2 });
});
