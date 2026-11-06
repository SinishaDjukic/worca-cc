// test/api-workflow-versions-flag-off.test.mjs — the Versions routes answer 404 while workflowTests is off.
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
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body || {}) });
const graphBody = (name) => ({
  version: 2, id: 'wf_off_api', name, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfvapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_FLAGS;
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

test('flag off: all six versions routes answer the gate 404 on a real workflow with a version and history', async () => {
  // A real workflow: saved twice (one automatic snapshot), with version 1 in use — so only the gate can answer 404.
  assert.equal((await post('/api/workflows', graphBody('Off'))).status, 201);
  assert.equal((await post('/api/workflows', graphBody('Off 2'))).status, 201);
  const { getDb, tx } = await import('../src/core/db.mjs');
  const { insertVersionTx, setLiveVersionTx, listRevisions } = await import('../src/core/workflow-revisions.mjs');
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_off_api');
  tx(() => { setLiveVersionTx('wf_off_api', insertVersionTx(row, { parts: [], fingerprint: 'f' })); });
  const rev = listRevisions('wf_off_api').find((r) => r.versionNo === null).id;
  const routes = [
    () => fetch(`${base}/api/workflows/wf_off_api/versions`),
    () => post('/api/workflows/wf_off_api/versions', { note: 'x' }),
    () => post('/api/workflows/wf_off_api/versions/1/use'),
    () => fetch(`${base}/api/workflows/wf_off_api/history`),
    () => fetch(`${base}/api/workflows/wf_off_api/history/${rev}`),
    () => post(`/api/workflows/wf_off_api/history/${rev}/restore`),
  ];
  for (const [i, call] of routes.entries()) {
    const r = await call();
    assert.deepEqual([i, r.status, await r.json()], [i, 404, { error: 'not found' }], `route ${i}`);
  }
  // The same calls with the flag on never answer the gate body: the 404s above came from the gate.
  process.env.WORCA_FLAGS = 'workflowTests';
  try {
    for (const [i, call] of routes.entries()) {
      const r = await call();
      const body = await r.json().catch(() => null);
      assert.notDeepEqual(body, { error: 'not found' }, `route ${i} with the flag on`);
    }
  } finally { delete process.env.WORCA_FLAGS; }
});

test('flag off: ?use=live reads the row (the draft), exactly as before, though version 1 is marked in use', async () => {
  const row = await (await fetch(`${base}/api/workflows/wf_off_api`)).json();
  const wf = await (await fetch(`${base}/api/workflows/wf_off_api?use=live`)).json();
  assert.deepEqual(wf, row);
  assert.equal(wf.versionNo ?? null, null);
});
