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
