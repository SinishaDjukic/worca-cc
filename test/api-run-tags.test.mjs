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

let homeDir, prevHome, prevEnv, srv, base, runs, schedulerTick, _testing, repo;
let getDb, projectKey, readRunTags, readTagEvents, insertRunTags, writeProjectDefaultTags;
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
  // Settings (tag dimensions) live under HOME, not WORCA_HOME: sandbox it so no POST reaches the real ~/.worca-cc.
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind, no scheduler timer
  ({ runs, schedulerTick, _testing } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ projectKey } = await import('../src/core/store.mjs'));
  ({ readRunTags, readTagEvents, insertRunTags } = await import('../src/core/run-tags-store.mjs'));
  ({ writeProjectDefaultTags } = await import('../src/core/config.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  repo = gitDir('run-tags');
  await addProject({ name: 'run-tags', path: repo });
  await post('/api/settings', { flags: { runTags: true } });   // experimental, off by default: these tests are about it on
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('POST /api/run stores normalised tags and the run detail returns them', async () => {
  const entry = await startTagged({ tags: ['Client: Acme ', 'team:core-ui'] });
  const rows = getDb().prepare('SELECT key, value FROM run_tags WHERE pipeline_id = ? ORDER BY key').all(entry.pipelineId);
  assert.deepEqual(rows.map((x) => ({ ...x })), [{ key: 'client', value: 'acme' }, { key: 'team', value: 'core-ui' }]);
  assert.deepEqual(entry.tags, ['client:acme', 'team:core-ui']);
  const detail = await get(`/api/history/${projectKey(repo)}/${entry.pipelineId}`);
  assert.deepEqual(detail.state.tags, ['client:acme', 'team:core-ui']);
  // The origin of a PR-watch fix run carries the run's tags (pr-watch.mjs copies them into the body).
  assert.deepEqual(_testing.prWatchOrigin({ pipelineId: entry.pipelineId })?.tags, ['client:acme', 'team:core-ui']);
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

const KV = (raw) => `tags: "${raw}": a tag is key:value, for example client:acme`;

test('POST /api/run: a tag is key:value — free text and a bare key are 400 and start nothing', async () => {
  const before = runs.size;
  for (const raw of ['hello world', 'client']) {
    const bad = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, tags: [raw] });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, KV(raw));
  }
  assert.equal(runs.size, before);
  const ok = await startTagged({ tags: ['client:acme'] });
  assert.deepEqual(readRunTags(ok.pipelineId), ['client:acme']);
});

test('grandfathered bare keys: the run page edit, project defaults and an after-chain keep a stored bare key', async () => {
  const key = projectKey(repo);
  // Run page edit: a bare key already on the run comes back in the full list and passes; a new one is refused.
  const a = await startTagged({ tags: ['client:acme'] });
  insertRunTags(a.pipelineId, ['client:acme', 'urgent']);
  const put = (body) => call('PUT', `/api/runs/${a.pipelineId}/tags`, body);
  const edited = await put({ tags: ['urgent', 'client:globex'] });
  assert.equal(edited.status, 200);
  assert.deepEqual((await edited.json()).tags, ['client:globex', 'urgent']);
  const refused = await put({ tags: ['urgent', 'spike'] });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, '"spike": a tag is key:value, for example client:acme');
  // An after-chained run inherits its predecessor's bare key at fire.
  const r = await post('/api/run', { projectDir: repo, prompt: 'next', mock: true, after: { kind: 'pipeline', id: a.pipelineId } });
  assert.equal(r.status, 202);
  const made = await r.json();
  // The predecessor's post-finish step nudges the scheduler (server.mjs, after the merge-back), so on a busy runner
  // the chain can already be firing on its own when Run now arrives: that 409 is the chain working, not a refusal.
  const now = await post(`/api/schedules/${made.runId}/run-now`);
  if (now.status !== 200) assert.match(`${now.status} ${(await now.json()).error}`, /^409 this run is firing and cannot be started$/);
  assert.deepEqual(readRunTags((await untilSettled(made.runId)).pipelineId), ['client:globex', 'urgent']);
  // Project defaults saved before the rule: re-saving and starting a run with them passes; a new bare key does not.
  writeProjectDefaultTags(key, ['urgent']);
  const saved = await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['urgent', 'team:web'] });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { tags: ['team:web', 'urgent'] });
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['urgent', 'spike'] })).status, 400);
  const withDefaults = await startTagged({ tags: ['urgent', 'team:web'] });
  assert.deepEqual(readRunTags(withDefaults.pipelineId), ['team:web', 'urgent']);
  assert.equal((await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, tags: ['spike'] })).status, 400);
  await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: [] });
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
  const put = await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['Client: Acme', 'team:web'] });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { tags: ['client:acme', 'team:web'] });
  assert.deepEqual(await get(`/api/projects/${key}/tags/defaults`), { tags: ['client:acme', 'team:web'] });
  const d = await get(`/api/run-defaults?projectDir=${encodeURIComponent(repo)}`);
  assert.equal(d.projectKey, key);
  assert.deepEqual(d.tags, ['client:acme', 'team:web']);
  assert.deepEqual(readRunTags(run.pipelineId), ['team:api']);
  const none = await get('/api/run-defaults');
  assert.equal(none.projectKey, null);
  assert.deepEqual(none.tags, []);
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['client:'] })).status, 400);
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, {})).status, 400);
  // With enforcement off, the server never applies them: a body without tags still starts an untagged run.
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
    // The predecessor is done, so the next tick fires this run. Drive it here rather than through run-now: a tick the
    // previous run's merge-back queued (afterRunSettled) may already have claimed it, and run-now then answers 409.
    await schedulerTick({ now: Date.now() + 2000 });
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

test('GET /api/tag-dimensions: none by default, the Settings list after a POST, 400 on a NUL projectDir', async () => {
  assert.deepEqual(await get('/api/tag-dimensions'), { dims: [], team: null });
  const saved = await post('/api/settings', { tagDimensions: [{ key: 'cc', label: 'Cost centre' }] });
  assert.equal(saved.status, 200);
  try {
    assert.deepEqual((await get('/api/tag-dimensions')).dims, [{ key: 'cc', label: 'Cost centre', values: [], required: false }]);
    assert.equal((await fetch(`${base}/api/tag-dimensions?projectDir=%00`)).status, 400);
  } finally { await post('/api/settings', { tagDimensions: [] }); }
});

// ── Enforced tags (slice 4A): pre-fill, then refuse a missing mandatory tag or an off-list value ──
const CCD = { key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true };
// runTags is experimental (off by default): enforcement only applies with it on.
const enforce = (dims, on = true) => post('/api/settings', { tagDimensions: dims, enforceTags: on, flags: { runTags: true } });
// The default identity is a real person here, so a cc run in one test would pre-fill the next one
// (last value used): clearing drops the stored cc tags too.
const clear = async () => {
  await post('/api/settings', { tagDimensions: [], enforceTags: false });
  getDb().prepare("DELETE FROM run_tags WHERE key = 'cc'").run();
};
const withIdentity = (t) => {
  const prev = process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-Email';
  t.after(() => { if (prev === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prev; });
};
const postAs = (body, email) => fetch(`${base}/api/run`, { method: 'POST', headers: { ...JSONH, 'x-forwarded-email': email },
  body: JSON.stringify({ projectDir: repo, prompt: 'x', mock: true, ...body }) });

test('enforced: a missing mandatory tag with no default anywhere → 422 with fields.tags; nothing starts', async () => {
  await enforce([CCD]);
  try {
    const before = runs.size;
    const r = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true });
    assert.equal(r.status, 422);
    assert.deepEqual(await r.json(), { error: 'Add Cost centre to start', fields: { tags: 'Add Cost centre to start' } });
    assert.equal(runs.size, before);
  } finally { await clear(); }
});

test('enforced: an off-list value → 422 even when the tag is optional', async () => {
  await enforce([{ ...CCD, required: false }]);
  try {
    const r = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, tags: ['cc:9999'] });
    assert.equal(r.status, 422);
    assert.match((await r.json()).fields.tags, /Cost centre "9999" is not one of its values/);
  } finally { await clear(); }
});

test('enforced: pre-fill runs first — the Default, then the project default wins over it', async () => {
  await enforce([{ ...CCD, default: '4420' }]);
  const key = projectKey(repo);
  try {
    let e = await startTagged({});
    assert.deepEqual(readRunTags(e.pipelineId), ['cc:4420']);
    await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['cc:4410'] });
    e = await startTagged({});
    assert.deepEqual(readRunTags(e.pipelineId), ['cc:4410']);
  } finally {
    await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: [] });
    await clear();
  }
});

test('enforced: the last value this person used in this project fills a mandatory tag', async (t) => {
  withIdentity(t);
  const first = await postAs({ tags: ['cc:4410'] }, 'ana@x.io');
  assert.ok(first.ok, String(first.status));
  await untilSettled((await first.json()).runId);
  await enforce([CCD]);
  try {
    const again = await postAs({}, 'ana@x.io');
    assert.ok(again.ok, String(again.status));
    const e = await untilSettled((await again.json()).runId);
    assert.deepEqual(readRunTags(e.pipelineId), ['cc:4410']);
    const other = await postAs({}, 'bo@x.io');
    assert.equal(other.status, 422);
  } finally { await clear(); }
});

test('enforced: schedule creation is refused with 422 and stores the pre-filled list when it passes', async () => {
  await enforce([CCD]);
  try {
    const bad = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, scheduledFor: inFuture(60_000) });
    assert.equal(bad.status, 422);
    await enforce([{ ...CCD, default: '4410' }]);
    const ok = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, scheduledFor: inFuture(60_000) });
    assert.equal(ok.status, 202);
    const { runId } = await ok.json();
    const req = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(runId).request);
    assert.deepEqual(req.tags, ['cc:4410']);
  } finally { await clear(); }
});

test('enforced: a ticket whose tag became mandatory with no default is skipped at firing, with the reason (not failed)', async () => {
  const ok = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, scheduledFor: inFuture(1500) });
  const { runId } = await ok.json();
  await enforce([CCD]);
  try {
    await schedulerTick({ now: Date.now() + 2000 });
    const row = getDb().prepare('SELECT status, fail_reason FROM scheduled_runs WHERE id = ?').get(runId);
    assert.deepEqual({ ...row }, { status: 'skipped', fail_reason: 'Add Cost centre to start' });
    const { notifications } = await get('/api/notifications');
    assert.ok(notifications.some((n) => n.ticketId === runId && /was skipped: Add Cost centre to start/.test(n.message)));
  } finally { await clear(); }
});

test('enforced: a ticket whose tag became mandatory WITH a default fires with it filled', async () => {
  const ok = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, scheduledFor: inFuture(1500) });
  const { runId } = await ok.json();
  await enforce([{ ...CCD, default: '4420' }]);
  try {
    await schedulerTick({ now: Date.now() + 2000 });
    const entry = await untilSettled(runId);
    assert.deepEqual(readRunTags(entry.pipelineId), ['cc:4420']);
  } finally { await clear(); }
});

test('enforced: Run after with no tags of its own still inherits the parent tags (#718) and is checked against them', async (t) => {
  withIdentity(t);
  // Parents run as someone else, so the default identity has no last cc value to pre-fill from.
  const startAs = async (tags) => untilSettled((await (await postAs({ tags }, 'parent@x.io')).json()).runId);
  const parent = await startAs(['cc:4410']);
  const untagged = await startAs([]);
  const parentTicket = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, scheduledFor: inFuture(60_000), tags: ['cc:4420'] });
  assert.equal(parentTicket.status, 202);
  const ticketParentId = (await parentTicket.json()).runId;
  await enforce([CCD]);
  try {
    const r = await post('/api/run', { projectDir: repo, prompt: 'next', mock: true, after: { kind: 'pipeline', id: parent.pipelineId } });
    assert.equal(r.status, 202);
    const made = await r.json();
    assert.equal(JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(made.runId).request).tags, undefined);
    const refused = await post('/api/run', { projectDir: repo, prompt: 'next', mock: true, after: { kind: 'pipeline', id: untagged.pipelineId } });
    assert.equal(refused.status, 422);
    assert.equal((await refused.json()).error, 'Add Cost centre to start');
    const now = await post(`/api/schedules/${made.runId}/run-now`);
    assert.equal(now.status, 200, JSON.stringify(await now.clone().json()));
    assert.deepEqual(readRunTags((await untilSettled(made.runId)).pipelineId), ['cc:4410']);
    // A ticket parent: its stored request's tags count (getTicket(…, { withRequest: true })).
    const onTicket = await post('/api/run', { projectDir: repo, prompt: 'next', mock: true, after: { kind: 'ticket', id: ticketParentId } });
    assert.equal(onTicket.status, 202, JSON.stringify(await onTicket.clone().json()));
  } finally { await clear(); }
});

test('enforcement off: required only warns — the run starts untagged (today)', async () => {
  await enforce([CCD], false);
  try { const e = await startTagged({}); assert.deepEqual(readRunTags(e.pipelineId), []); } finally { await clear(); }
});

test('runTags flag off: enforcement is ignored entirely', async () => {
  await enforce([CCD]);
  await post('/api/settings', { flags: { runTags: false } });
  try { const e = await startTagged({}); assert.ok(e.pipelineId); }
  finally { await post('/api/settings', { flags: { runTags: true } }); await clear(); }
});

test('enforced: a memory defrag start is exempt (system start)', async () => {
  await enforce([CCD]);
  try {
    const r = await post('/api/run', { projectDir: repo, workflowId: 'wf_memory_defrag', memoryScope: 'project', guardrailsId: 'normal', prompt: 'Defragment.', scheduledFor: inFuture(86_400_000) });
    assert.equal(r.status, 202, JSON.stringify(await r.clone().json()));
  } finally { await clear(); }
});

test('GET /api/tag-dimensions: per target adds enforce + prefill; machine-wide adds team', async () => {
  await enforce([{ ...CCD, default: '4420' }]);
  try {
    const t = await get(`/api/tag-dimensions?projectDir=${encodeURIComponent(repo)}`);
    assert.equal(t.enforce, true);
    assert.deepEqual(t.prefill, ['cc:4420']);
    const all = await get('/api/tag-dimensions');
    assert.equal(all.team, null);
  } finally { await clear(); }
});

const dimsAs = async (email) => (await fetch(`${base}/api/tag-dimensions?projectDir=${encodeURIComponent(repo)}`,
  { headers: { 'x-forwarded-email': email } })).json();
test('GET /api/tag-dimensions: autofill is the caller\'s last tagged run in this project; another person does not get it', async (t) => {
  withIdentity(t);
  const r = await postAs({ tags: ['client:acme', 'team:web'] }, 'dee@x.io');
  assert.ok(r.ok, String(r.status));
  await untilSettled((await r.json()).runId);
  assert.deepEqual((await dimsAs('dee@x.io')).autofill, { tags: ['client:acme', 'team:web'], from: 'last-run' });
  assert.notEqual((await dimsAs('eve@x.io')).autofill.from, 'last-run');
});

test('GET /api/tags?projectDir= scopes the vocabulary to that project', async () => {
  const other = gitDir('run-tags-other');
  await (await import('../src/core/projects.mjs')).addProject({ name: 'run-tags-other', path: other });
  await startTagged({ projectDir: other, tags: ['scoped-only:x'] });
  assert.ok((await get(`/api/tags?projectDir=${encodeURIComponent(other)}`)).keys.some((k) => k.key === 'scoped-only'));
  assert.ok(!(await get(`/api/tags?projectDir=${encodeURIComponent(repo)}`)).keys.some((k) => k.key === 'scoped-only'));
  assert.ok((await get('/api/tags')).keys.some((k) => k.key === 'scoped-only'));
});
