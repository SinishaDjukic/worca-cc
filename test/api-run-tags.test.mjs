// test/api-run-tags.test.mjs — run tags over HTTP (#718): POST /api/run validation and storage, the edit
// route and its audit, the vocabulary and project-default routes, schedules, and the inheritance paths.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';

let homeDir, prevHome, srv, base, runs, schedulerTick, _testing, repo;
let getDb, projectKey, readRunTags, readTagEvents, insertRunTags;
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, p, b) => fetch(`${base}${p}`, { method, headers: JSONH, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
const post = (p, b) => call('POST', p, b ?? {});
const get = async (p) => (await fetch(`${base}${p}`)).json();
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();
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
const startTagged = async (body) => untilSettled((await (await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, ...body })).json()).runId);

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-tags-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind, no scheduler timer
  ({ runs, schedulerTick, _testing } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ projectKey } = await import('../src/core/store.mjs'));
  ({ readRunTags, readTagEvents, insertRunTags } = await import('../src/core/run-tags-store.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  repo = gitDir('run-tags');
  await addProject({ name: 'run-tags', path: repo });
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('POST /api/run stores normalised tags and the run detail returns them', async () => {
  const entry = await startTagged({ tags: ['Client: Acme ', 'spike'] });
  const rows = getDb().prepare('SELECT key, value FROM run_tags WHERE pipeline_id = ? ORDER BY key').all(entry.pipelineId);
  assert.deepEqual(rows.map((x) => ({ ...x })), [{ key: 'client', value: 'acme' }, { key: 'spike', value: '' }]);
  assert.deepEqual(entry.tags, ['client:acme', 'spike']);
  const detail = await get(`/api/history/${projectKey(repo)}/${entry.pipelineId}`);
  assert.deepEqual(detail.state.tags, ['client:acme', 'spike']);
  // The origin of a PR-watch fix run carries the run's tags (pr-watch.mjs copies them into the body).
  assert.deepEqual(_testing.prWatchOrigin({ pipelineId: entry.pipelineId })?.tags, ['client:acme', 'spike']);
});

test('a body without tags stores none; a bad tag is refused with 400 and starts nothing', async () => {
  const e = await startTagged({});
  assert.deepEqual(readRunTags(e.pipelineId), []);
  const before = runs.size;
  const bad = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, tags: ['client:'] });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /needs a value/);
  assert.equal(runs.size, before);
  assert.equal((await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, tags: 'client:acme' })).status, 400);
});

test('PUT /api/runs/:id/tags retags, writes one audit row with the actor, and changes no other run', async (t) => {
  // resolveIdentity reads the env at request time; restore it so later tests keep the default identity.
  const prev = process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-Email';
  t.after(() => { if (prev === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prev; });
  const a = await startTagged({ tags: ['client:acme'] });
  const b = await startTagged({ prompt: 'y', tags: ['client:acme'] });
  const put = (id, body, headers = {}) => fetch(`${base}/api/runs/${id}/tags`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body });
  const res = await put(a.pipelineId, JSON.stringify({ tags: ['client:globex'] }), { 'x-forwarded-email': 'ada@x.io' });
  assert.deepEqual(await res.json(), { tags: ['client:globex'], changed: true });
  assert.deepEqual(readTagEvents(a.pipelineId).map((x) => [x.actor, x.before, x.after]), [['ada@x.io', ['client:acme'], ['client:globex']]]);
  assert.deepEqual(readRunTags(b.pipelineId), ['client:acme']);
  assert.deepEqual(a.tags, ['client:globex'], 'the live runs-map entry follows the edit');
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(a.pipelineId).map((r) => r.text);
  assert.ok(audit.some((m) => m === 'Tags changed by ada@x.io: +client:globex −client:acme.'), JSON.stringify(audit));
  const same = await put(a.pipelineId, JSON.stringify({ tags: ['client:globex'] }));
  assert.deepEqual(await same.json(), { tags: ['client:globex'], changed: false });
  assert.equal(readTagEvents(a.pipelineId).length, 1);
  assert.equal((await put(a.pipelineId, '{"tags":["client:"]}')).status, 400);
  assert.equal((await put(a.pipelineId, '{}')).status, 400);
  assert.equal((await put('ffffffff', '{"tags":[]}')).status, 404);
});

test('GET /api/tags lists keys and values in use', async () => {
  const v = await get('/api/tags');
  const client = v.keys.find((k) => k.key === 'client');
  assert.ok(client && client.valued);
  assert.ok(v.values.client.some((x) => x.value === 'acme'));
});

test('project default tags: PUT, GET and /api/run-defaults; changing them leaves stored run tags alone', async () => {
  const key = projectKey(repo);
  const run = await startTagged({ tags: ['team:api'] });
  const put = await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['Client: Acme', 'spike'] });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { tags: ['client:acme', 'spike'] });
  assert.deepEqual(await get(`/api/projects/${key}/tags/defaults`), { tags: ['client:acme', 'spike'] });
  const d = await get(`/api/run-defaults?projectDir=${encodeURIComponent(repo)}`);
  assert.equal(d.projectKey, key);
  assert.deepEqual(d.tags, ['client:acme', 'spike']);
  assert.deepEqual(readRunTags(run.pipelineId), ['team:api']);
  const none = await get('/api/run-defaults');
  assert.equal(none.projectKey, null);
  assert.deepEqual(none.tags, []);
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['client:'] })).status, 400);
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, {})).status, 400);
  // The server never applies them: a body without tags still starts an untagged run.
  const plain = await startTagged({});
  assert.deepEqual(readRunTags(plain.pipelineId), []);
  await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: [] });
});

test('a scheduled request keeps clean tags and its run carries them', async () => {
  const r = await post('/api/run', { projectDir: repo, prompt: 'later', mock: true, scheduledFor: inFuture(1500), tags: ['Client: Acme'] });
  assert.equal(r.status, 202);
  const made = await r.json();
  const stored = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(made.runId).request);
  assert.deepEqual(stored.tags, ['client:acme']);
  await schedulerTick({ now: Date.now() + 2000 });
  const entry = await untilSettled(made.runId);
  assert.deepEqual(readRunTags(entry.pipelineId), ['client:acme']);
});

test('an after-chained run without tags inherits its predecessor\'s; tags: [] opts out', async () => {
  const a = await startTagged({ tags: ['client:acme'] });
  const chain = async (extra) => {
    const r = await post('/api/run', { projectDir: repo, prompt: 'next', mock: true, after: { kind: 'pipeline', id: a.pipelineId }, ...extra });
    assert.equal(r.status, 202);
    const made = await r.json();
    const now = await post(`/api/schedules/${made.runId}/run-now`);
    assert.equal(now.status, 200, JSON.stringify(await now.clone().json()));
    return untilSettled(made.runId);
  };
  assert.deepEqual(readRunTags((await chain({})).pipelineId), ['client:acme']);
  assert.deepEqual(readRunTags((await chain({ tags: [] })).pipelineId), []);
});

test('a resumed run\'s live entry carries the run\'s tags', async () => {
  const wt = await mkdtemp(join(tmpdir(), 'run-tags-wt-'));
  const branch = { source: 'main', feature: 'feat/x', worktreeDir: wt, reusedExisting: false };
  const { id } = await seedPipeline(repo, { title: 'Paused', status: 'paused', branch, resumePoint: graphResumePoint({ pipelineDir: repo }) });
  insertRunTags(id, ['client:acme']);
  const rr = await post('/api/resume', { pipelineId: id, mock: true });
  assert.equal(rr.status, 200);
  const { runId } = await rr.json();
  assert.deepEqual(runs.get(runId).tags, ['client:acme']);
  assert.deepEqual(readRunTags(id), ['client:acme']);
  const live = runs.get(runId);
  if (live && !settled.has(String(live.status || ''))) await post('/api/stop', { runId });
});
