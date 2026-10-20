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

let homeDir, prevHome, prevEnv, srv, base, repo, getDb, runs, schedulerTick, readRunTags, readRunLabels;
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, p, b) => fetch(`${base}${p}`, { method, headers: JSONH, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
const post = (p, b) => call('POST', p, b ?? {});
const get = async (p) => (await fetch(`${base}${p}`)).json();
const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
const answered = new Set();
async function untilSettled(runId, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && settled.has(String(e.status || ''))) return e;
    // A mock run parks at wf_default's HITL gates: answer them as auto mode would (api-schedules pattern).
    const pq = e && e.pendingQuestion;
    if (pq && !answered.has(`${runId}:${pq.id}`)) {
      answered.add(`${runId}:${pq.id}`);
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      await post('/api/answer', { runId, id: pq.id, payload });
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}
const startRun = async (body) => untilSettled((await (await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, ...body })).json()).runId);

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-labels-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // Settings (the flag) live under HOME, not WORCA_HOME: sandbox it so no POST reaches the real ~/.worca-cc.
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind, no scheduler timer
  ({ runs, schedulerTick } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ readRunTags } = await import('../src/core/run-tags-store.mjs'));
  ({ readRunLabels } = await import('../src/core/run-labels-store.mjs'));
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
    assert.equal((await post('/api/labels/rename', { from: 'a', to: 'b' })).status, 404);
    assert.equal((await call('DELETE', '/api/labels/a')).status, 404);
  } finally { await post('/api/settings', { flags: { runLabels: true } }); }
});

test('a start with labels stores them; an after-chained run inherits tags and labels; labels: [] opts out', async () => {
  const a = await startRun({ tags: ['client:acme'], labels: ['hotfix'] });
  assert.deepEqual(readRunLabels(a.pipelineId), ['hotfix']);
  const chain = async (extra) => {
    const r = await post('/api/run', { projectDir: repo, prompt: 'next', mock: true, after: { kind: 'pipeline', id: a.pipelineId }, ...extra });
    assert.equal(r.status, 202);
    const made = await r.json();
    await schedulerTick({ now: Date.now() + 2000 });
    return untilSettled(made.runId);
  };
  const b = await chain({});
  assert.deepEqual([readRunTags(b.pipelineId), readRunLabels(b.pipelineId)], [['client:acme'], ['hotfix']]);
  assert.deepEqual(readRunLabels((await chain({ labels: [] })).pipelineId), []);
});

test('POST /api/run with an invalid label answers 400 "labels: …"', async () => {
  const r = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, labels: ['x'.repeat(40)] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^labels: /);
});

test('POST /api/labels/rename renames on every run and merges into an existing label; DELETE removes it everywhere', async () => {
  const { id: a } = await seedPipeline(repo, { title: 'Ren A' });
  const { id: b } = await seedPipeline(repo, { title: 'Ren B' });
  await call('PUT', `/api/runs/${a}/labels`, { labels: ['api-old'] });
  await call('PUT', `/api/runs/${b}/labels`, { labels: ['api-old', 'api-into'] });
  assert.deepEqual(await (await post('/api/labels/rename', { from: 'api-old', to: 'API-New' })).json(), { label: 'api-new', runs: 2, merged: false });
  assert.deepEqual(await (await post('/api/labels/rename', { from: 'api-new', to: 'api-into' })).json(), { label: 'api-into', runs: 2, merged: true });
  assert.deepEqual((await get('/api/labels')).labels.filter((l) => l.label.startsWith('api-')), [{ label: 'api-into', count: 2 }]);
  assert.deepEqual((await get('/api/history')).pipelines.find((p) => p.id === b).labels, ['api-into']);
  assert.deepEqual(await (await call('DELETE', `/api/labels/${encodeURIComponent('api-into')}`)).json(), { label: 'api-into', runs: 2 });
  assert.ok(!(await get('/api/labels')).labels.some((l) => l.label === 'api-into'));
  assert.equal((await call('DELETE', '/api/labels/api-into')).status, 404);
  assert.equal((await post('/api/labels/rename', { from: 'nowhere-x', to: 'y' })).status, 404);
  assert.equal((await post('/api/labels/rename', { from: 'api-into', to: '' })).status, 400);
});
