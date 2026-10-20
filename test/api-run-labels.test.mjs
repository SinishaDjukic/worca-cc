// test/api-run-labels.test.mjs — run labels over HTTP (slice 1): the replace and bulk routes, the vocabulary,
// the flag gate, the hard delete, and that a label never reaches Statistics or the tag vocabulary.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let homeDir, prevHome, prevEnv, srv, base, repo, getDb;
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, p, b) => fetch(`${base}${p}`, { method, headers: JSONH, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
const post = (p, b) => call('POST', p, b ?? {});
const get = async (p) => (await fetch(`${base}${p}`)).json();

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-labels-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // Settings (the flag) live under HOME, not WORCA_HOME: sandbox it so no POST reaches the real ~/.worca-cc.
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind, no scheduler timer
  ({ getDb } = await import('../src/core/db.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  repo = gitDir('run-labels');
  await addProject({ name: 'run-labels', path: repo });
  await post('/api/settings', { flags: { runLabels: true } });   // experimental, off by default: these tests are about it on
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('PUT then GET: a run reads back its labels; /api/labels lists them most used first', async () => {
  const { id: a } = await seedPipeline(repo, { title: 'Alpha' });
  const { id: b } = await seedPipeline(repo, { title: 'Beta' });
  const put = (id, body) => call('PUT', `/api/runs/${id}/labels`, body);
  assert.deepEqual(await (await put(a, { labels: ['hotfix', 'Needs demo'] })).json(), { labels: ['hotfix', 'needs demo'], changed: true });
  await put(b, { labels: ['hotfix'] });
  const hist = await get('/api/history');
  assert.deepEqual(hist.pipelines.find((p) => p.id === a).labels, ['hotfix', 'needs demo']);
  assert.deepEqual((await get('/api/labels')).labels, [{ label: 'hotfix', count: 2 }, { label: 'needs demo', count: 1 }]);
  assert.equal((await put(a, { labels: ['x'.repeat(33)] })).status, 400);
  assert.equal((await put(a, {})).status, 400);
  assert.equal((await put('ffffffff', { labels: [] })).status, 404);
});

test('POST /api/runs/bulk/labels adds to all and removes; names unknown ids', async () => {
  const ids = [];
  for (const t of ['One', 'Two', 'Three']) ids.push((await seedPipeline(repo, { title: t })).id);
  await call('PUT', `/api/runs/${ids[0]}/labels`, { labels: ['hotfix'] });
  const out = await (await post('/api/runs/bulk/labels', { pipelineIds: [...ids, 'ffffffff'], add: ['hotfix'] })).json();
  assert.deepEqual(out.runs.map((r) => [r.labels, r.changed]), [[['hotfix'], false], [['hotfix'], true], [['hotfix'], true]]);
  assert.deepEqual(out.missing, ['ffffffff']);
  const off = await (await post('/api/runs/bulk/labels', { pipelineIds: ids, remove: ['hotfix'] })).json();
  assert.ok(off.runs.every((r) => r.labels.length === 0));
  assert.equal((await post('/api/runs/bulk/labels', { pipelineIds: ids })).status, 400);
});

test('labels never reach Statistics or the tag vocabulary', async () => {
  const { id } = await seedPipeline(repo, { title: 'Gamma' });
  await call('PUT', `/api/runs/${id}/labels`, { labels: ['foobar-demo'] });
  assert.ok(!JSON.stringify(await get('/api/stats?range=lastMonth')).includes('foobar-demo'));
  assert.ok(!JSON.stringify(await get('/api/tags')).includes('foobar-demo'));
});

test('a hard delete leaves no run_labels rows', async () => {
  const { id } = await seedPipeline(repo, { title: 'Delta', status: 'failed' });
  await call('PUT', `/api/runs/${id}/labels`, { labels: ['hotfix'] });
  assert.equal((await post('/api/runs/bulk', { action: 'delete', targets: [{ pipelineId: id }] })).status, 200);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM run_labels WHERE pipeline_id = ?').get(id).n, 0);
});

test('flag off: every label route answers 404', async () => {
  await post('/api/settings', { flags: { runLabels: false } });
  try {
    assert.equal((await fetch(`${base}/api/labels`)).status, 404);
    assert.equal((await call('PUT', '/api/runs/ffffffff/labels', { labels: [] })).status, 404);
    assert.equal((await post('/api/runs/bulk/labels', { pipelineIds: ['x'], add: ['y'] })).status, 404);
  } finally { await post('/api/settings', { flags: { runLabels: true } }); }
});
