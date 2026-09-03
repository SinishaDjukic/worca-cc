// test/workflow-share-api.test.mjs
// HTTP surface of issue #421: GET /api/workflows/:id/json (download),
// POST /api/workflows/import-json(suffix-on-collision), and destination 'plugin'
// on POST /api/workflows/:id/export. Boots the real server like
// workflow-export-api.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, prevHome;
const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-share-api-')); dirs.push(d); return d; };
const JSONH = { 'Content-Type': 'application/json' };
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-shareapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('GET /api/workflows/:id/json serves the unstamped graph as a download', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default/json`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="default\.json"/);
  const j = await r.json();
  assert.deepEqual(Object.keys(j), ['version', 'name', 'domain', 'nodes', 'wires']);
  assert.equal('id' in j, false);
  const missing = await fetch(`${base}/api/workflows/wf_nope/json`);
  assert.equal(missing.status, 404);
});

test('POST /api/workflows/import-jsonmints an id and suffixes a taken name', async () => {
  const src = await (await fetch(`${base}/api/workflows/wf_default/json`)).json();
  const a = await post('/api/workflows/import-json', { workflow: { ...src, name: 'Shared In' } });
  assert.equal(a.status, 201);
  const ja = await a.json();
  assert.equal(ja.workflow.name, 'Shared In');
  assert.equal(ja.renamed, false);
  const b = await post('/api/workflows/import-json', { workflow: { ...src, id: 'wf_default', name: 'Shared In' } });
  assert.equal(b.status, 201);
  const jb = await b.json();
  assert.equal(jb.workflow.name, 'Shared In (2)');
  assert.equal(jb.renamed, true);
  assert.equal(jb.requestedName, 'Shared In');
  assert.notEqual(jb.workflow.id, 'wf_default', 'the file id is ignored');
  // `name` in the body overrides the file's name.
  const c = await post('/api/workflows/import-json', { workflow: src, name: 'Body Name' });
  assert.equal((await c.json()).workflow.name, 'Body Name');
  // The list shows all three next to the built-in.
  const list = (await (await fetch(`${base}/api/workflows`)).json()).workflows.map((w) => w.name);
  assert.ok(list.includes('Shared In') && list.includes('Shared In (2)') && list.includes('Body Name'), list.join(', '));
});

test('POST /api/workflows/import-json: 400 without a workflow object, 422 + summary for unknown agents, 422 for the reserved name', async () => {
  assert.equal((await post('/api/workflows/import-json', {})).status, 400);
  assert.equal((await post('/api/workflows/import-json', { workflow: [] })).status, 400);
  const src = await (await fetch(`${base}/api/workflows/wf_default/json`)).json();
  const nodes = src.nodes.map((n) => (n.kind === 'agent' && n.key === 'planner' ? { ...n, key: 'ghostAgent' } : n));
  const r = await post('/api/workflows/import-json', { workflow: { ...src, name: 'Ghost', nodes } });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.equal(j.error, 'invalid graph');
  assert.ok(Array.isArray(j.errors) && j.errors.some((e) => e.code === 'V4'));
  assert.match(j.summary, /ghostAgent/);
  const reserved = await post('/api/workflows/import-json', { workflow: { ...src, name: 'Default' } });
  assert.equal(reserved.status, 422);
  assert.match((await reserved.json()).error, /reserved/);
});

test('POST /api/workflows (composer save) still answers 409 on a minted collision and 422 with the issue list', async () => {
  const src = await (await fetch(`${base}/api/workflows/wf_default/json`)).json();
  const a = await post('/api/workflows', { ...src, name: 'Composer Row' });
  assert.equal(a.status, 201);
  const b = await post('/api/workflows', { ...src, name: 'Composer Row' });
  assert.equal(b.status, 409);
  assert.equal((await b.json()).id, (await a.json()).workflow.id);
  const bad = await post('/api/workflows', { ...src, name: 'Bad', wires: [] });
  assert.equal(bad.status, 422);
  const jb = await bad.json();
  assert.equal(jb.error, 'invalid graph');
  assert.ok(Array.isArray(jb.errors) && jb.errors.length > 0);
  assert.equal((await post('/api/workflows', { name: 'v1', steps: [] })).status, 400);
});

test('POST /api/workflows/:id/export destination=plugin: plan, apply, validation', async () => {
  const bad = await post('/api/workflows/wf_default/export', { destination: 'plugin' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /pluginDir/);
  const dest = join(await tmp(), 'default-as-plugin');
  const plan = await post('/api/workflows/wf_default/export', { destination: 'plugin', pluginDir: dest, dryRun: true });
  assert.equal(plan.status, 200);
  const jp = await plan.json();
  assert.equal(jp.name, 'default-as-plugin');
  assert.equal(jp.slug, 'default');
  assert.ok(jp.created.some((p) => p.endsWith('worca-cc-plugin.json')));
  assert.deepEqual(jp.conflicts, []);
  assert.equal(existsSync(dest), false, 'dry-run writes nothing');
  const apply = await post('/api/workflows/wf_default/export', { destination: 'plugin', pluginDir: dest, pluginName: 'default-as-plugin' });
  assert.equal(apply.status, 200);
  const ja = await apply.json();
  assert.equal(ja.validation.ok, true, JSON.stringify(ja.validation));
  assert.ok(existsSync(join(dest, 'workflows', 'default.json')));
  assert.ok(existsSync(join(dest, 'worca-cc-plugin.json')));
  assert.equal(existsSync(join(dest, 'agents')), false, 'the default uses built-ins only: nothing to bundle');
  const mismatch = await post('/api/workflows/wf_default/export', { destination: 'plugin', pluginDir: dest, pluginName: 'other' });
  assert.equal(mismatch.status, 409);
  const unknown = await post('/api/workflows/wf_default/export', { destination: 'elsewhere' });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /'plugin'/);
});
