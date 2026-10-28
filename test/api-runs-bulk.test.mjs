// test/api-runs-bulk.test.mjs — POST /api/runs/bulk (runs redesign §3.2): Stop / Archive / Delete / restore over HTTP,
// booted like test/archive-api.test.mjs.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs, _testing } from '../ui/server.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline, seedPipelineRow, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { addProject, removeProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';

let srv, base, home, prevHome, PROJECT;
const OUTLINE = { why: 'w', slices: [1, 2, 3].map((i) => ({ id: `s${i}`, title: `Slice ${i}`, goal: 'g', inScope: [], outOfScope: [],
  acceptance: [], dependsOn: [], estimate: 'small' })) };

async function post(path, body) {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

function seedFeature() {
  seedPipelineRow({ id: 'p-live', title: 'Slice 1', status: 'running' });
  return createSliceFeature({ pipelineId: 'p-live', projectDir: PROJECT, title: 'Run tags', outline: OUTLINE,
    perspectives: [], workflowId: 'wf_shape' }).id;
}
const sliceTickets = (fid) => getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx > 1 ORDER BY idx')
  .all(fid).map((r) => r.ticket_id);

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-bulk-api-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  PROJECT = await mkdtemp(join(tmpdir(), 'worca-cc-bulk-proj-'));
  await addProject({ name: 'bulk-proj', path: PROJECT });   // an interrupted run with a resume point resumes only while onboarded
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterEach(() => runs.clear());
// A stand-in open tab: every frame the server broadcasts lands in `frames`.
function listen() {
  const frames = [];
  const ws = { OPEN: 1, readyState: 1, send: (t) => frames.push(JSON.parse(t)) };
  _testing.sockets.add(ws);
  return { frames, close: () => _testing.sockets.delete(ws) };
}
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  if (PROJECT) await rm(PROJECT, { recursive: true, force: true });
});

test('API: stopping a feature group stops the running member and cancels its waiting members', async () => {
  const fid = seedFeature();
  let stopped = 0;
  runs.set('r-live', { id: 'r-live', pipelineId: 'p-live', status: 'running', title: 'Slice 1', pendingQuestion: null,
    orch: { stop() { stopped += 1; } } });
  const r = await post('/api/runs/bulk', { action: 'stop', groups: [{ id: fid, kind: 'feature' }] });
  assert.equal(r.status, 200);
  assert.equal(stopped, 1);
  assert.deepEqual(r.body.done.map((d) => d.id), ['p-live']);
  assert.equal(r.body.cancelled.length, 2);
  for (const t of sliceTickets(fid)) assert.equal(getTicket(t).status, 'canceled');
  assert.equal(getDb().prepare('SELECT status FROM shape_features WHERE id = ?').get(fid).status, 'canceled');
});

test('API: Archive skips a live run and names it; restore (Undo) brings the archived run back', async () => {
  const done = (await seedPipeline(PROJECT, { status: 'done', title: 'Done run' })).id;
  runs.set('r2', { id: 'r2', pipelineId: 'p-busy', status: 'running', title: 'Busy run', orch: { stop() {} } });
  const r = await post('/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: done }, { runId: 'r2', pipelineId: 'p-busy' }] });
  assert.deepEqual(r.body.done.map((d) => d.id), [done]);
  assert.deepEqual(r.body.skipped.map((s) => [s.title, s.reason]), [['Busy run', 'still running']]);
  assert.ok(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(done).archived_at);
  const u = await post('/api/runs/bulk', { action: 'restore', targets: [{ pipelineId: done }] });
  assert.deepEqual(u.body.done.map((d) => d.id), [done]);
  assert.equal(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(done).archived_at, null);
});

test('API: Delete skips a live run ("stop it first") and stamps a finished one; a bad action or target is 400', async () => {
  const done = (await seedPipeline(PROJECT, { status: 'done', title: 'Old run' })).id;
  runs.set('r3', { id: 'r3', pipelineId: 'p-busy', status: 'running', title: 'Busy run', orch: { stop() {} } });
  const d = await post('/api/runs/bulk', { action: 'delete', targets: [{ pipelineId: done }, { runId: 'r3' }] });
  assert.deepEqual(d.body.skipped.map((s) => s.reason), ['still running — stop it first']);
  assert.ok(getDb().prepare('SELECT deleted_at FROM pipelines WHERE id = ?').get(done).deleted_at);
  assert.equal((await post('/api/runs/bulk', { action: 'explode' })).status, 400);
  assert.equal((await post('/api/runs/bulk', { action: 'stop', targets: [null] })).status, 400);
});

test('API: an interrupted run archives and deletes, resume point or not; Stop still skips it', async () => {
  const rp = { v: 2, nodeId: 'n1' };
  const dead = (await seedPipeline(PROJECT, { status: 'interrupted', title: 'Dead run', resumePoint: null })).id;
  const parked = (await seedPipeline(PROJECT, { status: 'interrupted', title: 'Parked run', resumePoint: rp })).id;
  const gone = (await seedPipeline(PROJECT, { status: 'interrupted', title: 'Gone run', resumePoint: rp })).id;
  const h = await fetch(`${base}/api/history`).then((r) => r.json());
  const listed = Object.fromEntries(h.pipelines.filter((p) => p.id === dead || p.id === parked).map((p) => [p.id, p.resumable]));
  assert.deepEqual(listed, { [dead]: false, [parked]: true });
  const st = await post('/api/runs/bulk', { action: 'stop', targets: [{ pipelineId: parked }] });
  assert.deepEqual(st.body.skipped.map((s) => [s.title, s.reason]), [['Parked run', 'interrupted — resume it first']]);
  // A parked lineage the server drove is still in the runs Map: archiving the run drops it, so no hello replays a ghost.
  runs.set('r-parked', { id: 'r-parked', pipelineId: parked, projectDir: PROJECT, status: 'interrupted', title: 'Parked run' });
  const tab = listen();
  const r = await post('/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: dead }, { pipelineId: parked }] });
  tab.close();
  assert.deepEqual([r.body.done.map((d) => d.id), r.body.skipped], [[dead, parked], []]);
  for (const id of [dead, parked]) assert.ok(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(id).archived_at);
  assert.equal(runs.has('r-parked'), false);
  // ...and the open tabs learn which live card to drop: the frame names it.
  assert.deepEqual(tab.frames.filter((f) => f.type === 'pipelines-changed').map((f) => f.removedRunIds), [['r-parked']]);
  // Restore (Undo) brings the record back, never the resume point: it reads as not resumable.
  await post('/api/runs/bulk', { action: 'restore', targets: [{ pipelineId: parked }] });
  assert.equal(getDb().prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(parked).resume_point, null);
  const h2 = await fetch(`${base}/api/history`).then((r) => r.json());
  assert.deepEqual(h2.pipelines.filter((p) => p.id === parked).map((p) => p.resumable), [false]);
  const del = await post('/api/runs/bulk', { action: 'delete', targets: [{ pipelineId: gone }] });
  assert.deepEqual([del.body.done.map((d) => d.id), del.body.skipped], [[gone], []]);
  assert.ok(getDb().prepare('SELECT deleted_at FROM pipelines WHERE id = ?').get(gone).deleted_at);
});

test('API: the run\'s own Archive (DELETE /api/runs/:id) takes an interrupted run that could still resume', async () => {
  const id = (await seedPipeline(PROJECT, { status: 'interrupted', title: 'Parked one', resumePoint: { v: 2, nodeId: 'n1' } })).id;
  runs.set('r-one', { id: 'r-one', pipelineId: id, projectDir: PROJECT, status: 'interrupted', title: 'Parked one' });
  const tab = listen();
  const one = await fetch(`${base}/api/runs/${id}?projectKey=${projectKey(PROJECT)}`, { method: 'DELETE' });
  tab.close();
  assert.equal(one.status, 200, await one.text());
  assert.ok(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(id).archived_at);
  assert.equal(runs.has('r-one'), false);
  assert.deepEqual(tab.frames.filter((f) => f.type === 'pipelines-changed').map((f) => f.removedRunIds), [['r-one']]);
});

test('API: an interrupted run whose project was removed lists as not resumable, archives and deletes; Resume says why', async () => {
  const gone = await mkdtemp(join(tmpdir(), 'worca-cc-bulk-gone-'));
  try {
    await addProject({ name: 'calculator', path: gone });
    const rp = { version: 2, nodeId: 'n1' };
    const a = (await seedPipeline(gone, { status: 'interrupted', title: 'Calc one', resumePoint: rp })).id;
    const b = (await seedPipeline(gone, { status: 'interrupted', title: 'Calc two', resumePoint: rp })).id;
    const c = (await seedPipeline(gone, { status: 'interrupted', title: 'Calc three', resumePoint: rp })).id;
    await removeProject('calculator', { pruneWaitMs: 0 });
    const h = await fetch(`${base}/api/history`).then((r) => r.json());
    assert.deepEqual(h.pipelines.filter((p) => p.id === a).map((p) => p.resumable), [false]);
    const res = await post('/api/resume', { pipelineId: a });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not onboarded on this machine/);
    const ar = await post('/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: a }] });
    assert.deepEqual([ar.body.done.map((d) => d.id), ar.body.skipped], [[a], []]);
    assert.ok(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(a).archived_at);
    const del = await post('/api/runs/bulk', { action: 'delete', targets: [{ pipelineId: b }] });
    assert.deepEqual([del.body.done.map((d) => d.id), del.body.skipped], [[b], []]);
    // The run's own "…" menu archives by key alone: the project cannot be resolved to a dir any more.
    const one = await fetch(`${base}/api/runs/${c}?projectKey=${projectKey(gone)}`, { method: 'DELETE' });
    assert.equal(one.status, 200, await one.text());
    assert.ok(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(c).archived_at);
  } finally { await rm(gone, { recursive: true, force: true }); }
});

test('API: an interrupted workspace run whose workspace is gone lists as not resumable, archives, and Resume says why', async () => {
  const members = [{ projectKey: projectKey(PROJECT), projectDir: PROJECT, projectName: 'bulk-proj' }];
  const { id } = await seedWorkspacePipeline(PROJECT, 'wks-gone-0000aaaa', { status: 'interrupted', title: 'WS run', resumePoint: { version: 2, nodeId: 'n1' }, projects: members }, members);
  const h = await fetch(`${base}/api/history`).then((r) => r.json());
  assert.deepEqual(h.pipelines.filter((p) => p.id === id).map((p) => p.resumable), [false]);
  const res = await post('/api/resume', { pipelineId: id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /workspace for this pipeline .* not onboarded on this machine/);
  const ar = await post('/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: id }] });
  assert.deepEqual([ar.body.done.map((d) => d.id), ar.body.skipped], [[id], []]);
});
