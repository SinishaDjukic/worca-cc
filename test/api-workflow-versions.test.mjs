// test/api-workflow-versions.test.mjs — the Versions routes (flag workflowTests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, srv, base, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const graphBody = (name) => ({
  version: 2, id: 'wf_api_v', name, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body || {}) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfvapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('save version, edit, save again, use, restore — over HTTP', async () => {
  assert.equal((await post('/api/workflows', graphBody('API versions'))).status, 201);
  let r = await post('/api/workflows/wf_api_v/versions', { note: 'First' });
  assert.equal(r.status, 201);
  let o = await r.json();
  assert.deepEqual([o.liveVersionNo, o.versions.length, o.versions[0].note], [1, 1, 'First']);
  assert.equal((await post('/api/workflows/wf_api_v/versions', {})).status, 409);

  assert.equal((await post('/api/workflows', graphBody('API versions 2'))).status, 201);
  o = await (await fetch(`${base}/api/workflows/wf_api_v/versions`)).json();
  assert.equal(o.draft.changed, true);
  r = await post('/api/workflows/wf_api_v/versions', { note: 'Renamed', use: true });
  o = await r.json();
  assert.deepEqual([o.liveVersionNo, o.versions.map((v) => v.versionNo)], [2, [2, 1]]);
  o = await (await post('/api/workflows/wf_api_v/versions/1/use')).json();
  assert.equal(o.liveVersionNo, 1);
  assert.equal((await post('/api/workflows/wf_api_v/versions/9/use')).status, 404);

  const h = await (await fetch(`${base}/api/workflows/wf_api_v/history`)).json();
  const auto = h.revisions.find((x) => x.versionNo === null);
  const one = await (await fetch(`${base}/api/workflows/wf_api_v/history/${auto.id}`)).json();
  assert.equal(one.revision.graph.nodes.length, 3);
  r = await post(`/api/workflows/wf_api_v/history/${auto.id}/restore`);
  assert.equal(r.status, 200);
  const back = await r.json();
  assert.equal(back.workflow.name, 'API versions');
  assert.equal(back.overview.liveVersionNo, 1);
});

test('unknown workflow → 404', async () => {
  assert.equal((await fetch(`${base}/api/workflows/wf_none/versions`)).status, 404);
});

test('I3: GET /api/workflows/:id is the draft; ?use=live is what new runs use (the version in use)', async () => {
  const body = { ...graphBody('Live read'), id: 'wf_api_live' };
  assert.equal((await post('/api/workflows', body)).status, 201);
  assert.equal((await post('/api/workflows/wf_api_live/versions', {})).status, 201);
  assert.equal((await post('/api/workflows', { ...body, name: 'Live read (draft)' })).status, 201);
  const draft = await (await fetch(`${base}/api/workflows/wf_api_live`)).json();
  assert.deepEqual([draft.name, draft.versionNo], ['Live read (draft)', null], 'the Composer opens the draft');
  const live = await (await fetch(`${base}/api/workflows/wf_api_live?use=live`)).json();
  assert.deepEqual([live.name, live.versionNo], ['Live read', 1], 'New run and the Ask lane read what runs');
  assert.equal((await fetch(`${base}/api/workflows/wf_api_live?use=draft`).then((r) => r.json())).name, 'Live read (draft)');
  assert.equal((await fetch(`${base}/api/workflows/wf_none?use=live`)).status, 404);
});

test('I5 / scenario 4 over HTTP: restoring a state that no longer validates → 422; the draft and the version in use stay', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  const body = { ...graphBody('Restore check'), id: 'wf_api_bad' };
  assert.equal((await post('/api/workflows', body)).status, 201);
  assert.equal((await post('/api/workflows/wf_api_bad/versions', {})).status, 201);
  const info = getDb().prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_api_bad', NULL, 'Restore check', ?, 'f', 'save', '2026-10-25T00:00:00Z')`)
    .run(JSON.stringify({ nodes: [{ id: 'n_x', kind: 'agent', key: 'no-such-agent', config: {} }], wires: [] }));
  const before = await (await fetch(`${base}/api/workflows/wf_api_bad`)).json();
  const r = await post(`/api/workflows/wf_api_bad/history/${Number(info.lastInsertRowid)}/restore`);
  assert.equal(r.status, 422);
  const err = await r.json();
  assert.ok(typeof err.error === 'string' && Array.isArray(err.errors) && err.errors.length > 0, JSON.stringify(err));
  const after = await (await fetch(`${base}/api/workflows/wf_api_bad`)).json();
  assert.deepEqual([after.name, after.nodes.length, after.updatedAt], [before.name, before.nodes.length, before.updatedAt]);
  assert.equal((await (await fetch(`${base}/api/workflows/wf_api_bad/versions`)).json()).liveVersionNo, 1);
});

test('I5 / scenario 6 over HTTP: a plugin row cannot have versions → 400', async () => {
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  await writeGraphWorkflow({ ...graphBody('Plugin flow'), id: 'wfp_p_api', origin: 'plugin:p' });
  const r = await post('/api/workflows/wfp_p_api/versions', {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /cannot have versions/);
  assert.equal((await fetch(`${base}/api/workflows/wfp_p_api/versions`)).status, 400);
});
