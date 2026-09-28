// test/api-schedules.test.mjs — scheduled runs over HTTP: POST /api/run with scheduledFor /
// repeat answers 202 and stores a ticket; the scheduler tick starts it through the SAME
// start path (mock mode), stamps provenance on the pipeline row, and feeds notifications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after); // outer isolation: /api/run finishes ASYNC in-process

let homeDir, prevHome, srv, base, runs, schedulerTick, getDb, dir;
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
    // /api/run never forwards the orchestrator's `auto` flag, so a real mock run parks at
    // wf_default's HITL gates: answer them as auto mode would (ask-api-cards pattern).
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
async function rmWithRetry(d) {
  for (let i = 0; i < 12; i++) {
    try { await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); return; }
    catch { await new Promise((r) => setTimeout(r, 25)); }
  }
}
/** entry.status mirrors the `state` frame, which lands BEFORE the `done` event that records the outcome. */
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('condition never became true');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-sched-api-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs'); // imported => no port bind, no scheduler timer
  ({ runs, schedulerTick } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('sched-api');
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rmWithRetry(homeDir);
});

test('scheduledFor is validated before anything is stored', async () => {
  const bad = async (patch, re) => {
    const r = await post('/api/run', { projectDir: dir, prompt: 'x', ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match((await r.json()).error, re);
  };
  await bad({ scheduledFor: '2026-09-19T02:00:00' }, /offset/);
  await bad({ scheduledFor: 'tomorrow' }, /ISO 8601/);
  await bad({ scheduledFor: '2020-01-01T00:00:00Z' }, /in the past/);
  await bad({ scheduledFor: inFuture(3600_000), ifMissed: 'maybe' }, /ifMissed/);
  await bad({ scheduledFor: inFuture(3600_000), graceMin: -1 }, /graceMin/);
  await bad({ scheduledFor: inFuture(3600_000), repeat: { rule: {} } }, /not both/);
  await bad({ repeat: { rule: { freq: 'daily', time: '02:00', tz: 'Mars/Base' } } }, /timezone/);
  await bad({ repeat: { rule: { freq: 'daily', time: '02:00', tz: 'UTC' }, overlap: 'never' } }, /overlap/);
  await bad({ repeat: { rule: { freq: 'daily', time: '02:00', tz: 'UTC' }, maxFailures: 1.5 } }, /maxFailures/);
  // The run request itself is still validated: a schedule fails fast.
  await bad({ scheduledFor: inFuture(3600_000), workflowId: 'wf_nope' }, /workflow/i);
  await bad({ scheduledFor: inFuture(3600_000), sourceBranch: '-x' }, /sourceBranch/);
  assert.equal((await get('/api/schedules')).tickets.length, 0);
});

test('a run without schedule fields is untouched: 200 { runId } and no ticket', async () => {
  const r = await post('/api/run', { projectDir: dir, prompt: 'plain run', mock: true });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(Object.keys(body), ['runId']);
  await untilSettled(body.runId);
  assert.equal((await get('/api/schedules')).tickets.length, 0);
});

test('one-shot: 202, listed, movable, started by the tick, provenance stamped, feed item posted', async () => {
  const at = inFuture(2 * 3600_000);
  const r = await post('/api/run', {
    projectDir: dir, prompt: 'Upgrade dependencies', title: 'Upgrade deps', mock: true, scheduledFor: at,
    extras: [{ name: 'notes.txt', dataBase64: Buffer.from('hello').toString('base64') }],
    internal: { permissionMode: 'bypassPermissions' }, // an HTTP caller can NOT smuggle internals
  });
  assert.equal(r.status, 202);
  const made = await r.json();
  assert.equal(made.status, 'scheduled');
  assert.equal(made.scheduledFor, at);
  assert.match(made.runId, /^[0-9a-f-]{36}$/);
  assert.equal(runs.has(made.runId), false, 'nothing is running yet');

  let listed = await get(`/api/schedules?projectDir=${encodeURIComponent(dir)}`);
  assert.equal(listed.tickets.length, 1);
  assert.equal(listed.tickets[0].title, 'Upgrade deps');
  assert.equal(listed.tickets[0].summary.extras, 1);
  assert.equal(listed.counts.scheduled, 1);
  const stage = join(homeDir, '.worca-cc', 'scheduled', made.runId, 'extras');
  assert.deepEqual(readdirSync(stage), ['notes.txt'], 'extras are staged durably, not in the OS temp dir');
  const stored = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(made.runId).request);
  assert.equal(stored.internal.permissionMode, undefined);
  assert.equal(stored.extras, undefined);

  // GET /api/runs is additive.
  const runsList = await get(`/api/runs?projectDir=${encodeURIComponent(dir)}`);
  assert.equal(runsList.scheduled.length, 1);
  assert.ok(Array.isArray(runsList.pipelines) && Array.isArray(runsList.live));

  // Not due: a tick starts nothing.
  assert.deepEqual((await schedulerTick()).fired, []);

  // Move it, then run it now.
  const moved = await call('PATCH', `/api/schedules/${made.runId}`, { scheduledFor: inFuture(5 * 3600_000), ifMissed: 'skip' });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).item.ifMissed, 'skip');
  assert.equal((await call('PATCH', `/api/schedules/${made.runId}`, { scheduledFor: '2020-01-01T00:00:00Z' })).status, 400);

  const now = await post(`/api/schedules/${made.runId}/run-now`);
  assert.equal(now.status, 200);
  assert.equal((await now.json()).status, 'fired');
  const entry = await untilSettled(made.runId); // the ticket id IS the runId
  assert.equal(entry.status, 'done');
  assert.ok(entry.pipelineId);

  const row = getDb().prepare('SELECT scheduled_for, schedule_id, status FROM pipelines WHERE id = ?').get(entry.pipelineId);
  assert.ok(row.scheduled_for, 'the pipeline row carries its schedule provenance');
  assert.equal(row.schedule_id, null);
  assert.equal(row.status, 'done');
  assert.ok(existsSync(join(entry.orch.pipeline.dir, 'extras', 'notes.txt')), 'the staged extra reached the pipeline');

  listed = await get('/api/schedules?all=1');
  assert.equal(listed.tickets.find((t) => t.id === made.runId).status, 'fired');
  const feed = await until(async () => { const f = await get('/api/notifications'); return f.notifications.length ? f : null; });
  assert.equal(feed.notifications[0].kind, 'completed');
  assert.equal(feed.unread, 0, 'a completed run is a quiet item');
  assert.equal(existsSync(join(homeDir, '.worca-cc', 'scheduled', made.runId)), false, 'a finished one-shot drops its staging dir');
});

test('cancel: DELETE turns a waiting ticket into canceled, once', async () => {
  const made = await (await post('/api/run', { projectDir: dir, prompt: 'never', mock: true, scheduledFor: inFuture(3600_000) })).json();
  assert.equal((await call('DELETE', `/api/schedules/${made.runId}`)).status, 200);
  assert.equal((await call('DELETE', `/api/schedules/${made.runId}`)).status, 409);
  assert.equal((await post(`/api/schedules/${made.runId}/run-now`)).status, 409);
  assert.equal((await call('DELETE', '/api/schedules/nope')).status, 404);
});

test('a ticket that cannot start fails with the reason and raises an unread problem', async () => {
  const made = await (await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, workflowId: 'wf_default', scheduledFor: inFuture(3600_000) })).json();
  // The workflow disappears while the ticket waits.
  const req = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(made.runId).request);
  getDb().prepare('UPDATE scheduled_runs SET request = ? WHERE id = ?').run(JSON.stringify({ ...req, workflowId: 'wf_gone' }), made.runId);
  const now = await (await post(`/api/schedules/${made.runId}/run-now`)).json();
  assert.equal(now.status, 'failed');
  assert.match(now.failReason, /workflow/i);
  const feed = await get('/api/notifications?unread=1');
  assert.equal(feed.unread, 1);
  assert.equal(feed.notifications[0].kind, 'failed');
  // read state
  assert.equal((await post(`/api/notifications/${feed.notifications[0].id}/read`)).status, 200);
  assert.equal((await get('/api/notifications')).unread, 0);
  assert.equal((await post(`/api/notifications/${feed.notifications[0].id}/read`, { read: false })).status, 200);
  assert.equal((await (await post('/api/notifications/read-all')).json()).unread, 0);
  assert.equal((await post('/api/notifications/999999/read')).status, 404);
});

test('recurring: repeat creates a series, previews, pauses, resumes, skips, runs now, deletes', async () => {
  const rule = { freq: 'weekly', weekdays: ['mo', 'tu', 'we', 'th', 'fr'], time: '02:00', tz: 'Europe/Berlin' };
  const pv = await (await post('/api/schedules/preview', { rule, count: 3 })).json();
  assert.equal(pv.sentence, 'Every weekday at 02:00');
  assert.equal(pv.next.length, 3);
  assert.equal((await post('/api/schedules/preview', { rule: { ...rule, weekdays: [] } })).status, 400);

  const r = await post('/api/run', { projectDir: dir, prompt: 'Nightly lint', title: 'Nightly lint', mock: true, featureBranch: 'nightly-lint', repeat: { rule, overlap: 'queue', maxFailures: 2 } });
  assert.equal(r.status, 202);
  const made = await r.json();
  assert.match(made.scheduleId, /^sch_[0-9a-f]{8}$/);
  assert.equal(made.sentence, 'Every weekday at 02:00');
  assert.equal(made.scheduledFor, pv.next[0]);

  let one = await get(`/api/schedules/${made.scheduleId}`);
  assert.equal(one.kind, 'recurring');
  assert.equal(one.item.overlap, 'queue');
  assert.equal(one.item.maxFailures, 2);
  assert.equal(one.item.nextRunAt, pv.next[0]);

  // An occurrence is skipped, never moved or canceled on its own.
  assert.equal((await call('PATCH', `/api/schedules/${made.runId}`, { scheduledFor: inFuture(3600_000) })).status, 400);
  assert.equal((await call('DELETE', `/api/schedules/${made.runId}`)).status, 400);
  const skipped = await (await post(`/api/schedules/${made.scheduleId}/skip-next`)).json();
  assert.equal(skipped.item.nextRunAt, pv.next[1]);

  const edited = await (await call('PATCH', `/api/schedules/${made.scheduleId}`, { rule: { ...rule, weekdays: ['sa'], time: '06:30' }, overlap: 'skip' })).json();
  assert.equal(edited.item.sentence, 'Every Saturday at 06:30');
  assert.equal((await call('PATCH', `/api/schedules/${made.scheduleId}`, { overlap: 'x' })).status, 400);

  assert.equal((await (await post(`/api/schedules/${made.scheduleId}/pause`)).json()).item.status, 'paused');
  assert.equal((await post(`/api/schedules/${made.scheduleId}/pause`)).status, 409);
  assert.equal((await (await post(`/api/schedules/${made.scheduleId}/resume`)).json()).item.status, 'active');

  // Run now: one extra occurrence through the real start path, on a dated branch.
  const now = await (await post(`/api/schedules/${made.scheduleId}/run-now`)).json();
  assert.equal(now.status, 'fired');
  const entry = await untilSettled(now.runId);
  assert.equal(entry.status, 'done');
  const row = getDb().prepare('SELECT schedule_id, branch FROM pipelines WHERE id = ?').get(entry.pipelineId);
  assert.equal(row.schedule_id, made.scheduleId);
  assert.match(JSON.parse(row.branch).feature, /^nightly-lint-\d{8}/, 'each occurrence gets its own dated feature branch');
  one = await until(async () => { const o = await get(`/api/schedules/${made.scheduleId}`); return o.item.lastResult ? o : null; });
  assert.equal(one.item.runsCount, 1);
  assert.equal(one.item.lastResult, 'completed');
  assert.equal(one.history.some((t) => t.id === now.runId && t.status === 'fired'), true);

  const deps = await get(`/api/schedules/dependents?projectDir=${encodeURIComponent(dir)}`);
  assert.ok(deps.dependents.some((d) => d.id === made.scheduleId));
  assert.ok((await get('/api/schedules/dependents?workflowId=wf_default')).dependents.length >= 1);
  assert.equal((await fetch(`${base}/api/schedules/dependents`)).status, 400);

  assert.equal((await call('DELETE', `/api/schedules/${made.scheduleId}`)).status, 200);
  assert.equal((await fetch(`${base}/api/schedules/${made.scheduleId}`)).status, 404);
});

test('counts and settings expose the schedule surface', async () => {
  const counts = await get('/api/counts');
  assert.equal(typeof counts.schedules.scheduled, 'number');
  assert.equal(typeof counts.schedules.unread, 'number');
});

test('an external task is fetched at start: transient errors retry, permanent ones fail with the reason', async () => {
  // WORCA_MOCK fakes task sources; the shim's test hook makes getTask fail on demand.
  const { setMockSourceResponses } = await import('../src/core/plugin-shim.mjs');
  const fail = (kind, message) => () => { throw Object.assign(new Error(message), { kind }); };
  const r = await post('/api/run', {
    projectDir: dir, mock: true, scheduledFor: inFuture(3600_000),
    source: { type: 'plugin', plugin: 'mock-source', sourceId: 'issues', taskId: 'X-1' },
  });
  assert.equal(r.status, 202);
  const made = await r.json();
  const stored = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(made.runId).request);
  assert.equal(stored.source.taskId, 'X-1');
  assert.equal(stored.source.promptText, undefined, 'a reference, not a copy of the task');
  try {
    setMockSourceResponses({ getTask: fail('network', 'tracker unreachable') });
    let now = await (await post(`/api/schedules/${made.runId}/run-now`)).json();
    assert.equal(now.status, 'scheduled', 'a transient error keeps the ticket, with a retry delay');
    assert.match(now.failReason, /tracker unreachable/);
    const t = getDb().prepare('SELECT retry_at, attempts FROM scheduled_runs WHERE id = ?').get(made.runId);
    assert.ok(t.retry_at && t.attempts === 1);
    assert.equal((await schedulerTick()).fired.length + (await schedulerTick()).retried.length, 0, 'the delay holds even for Run now');

    setMockSourceResponses({ getTask: fail('plugin', 'task X-1 not found') });
    now = await (await post(`/api/schedules/${made.runId}/run-now`)).json();
    assert.equal(now.status, 'failed');
    assert.match(now.failReason, /X-1 not found/);
    assert.equal(runs.has(made.runId), false, 'no run was started');
    const feed = await get('/api/notifications?problems=1');
    assert.ok(feed.notifications.some((n) => n.kind === 'failed' && n.ticketId === made.runId));
  } finally {
    setMockSourceResponses(null);
  }
});

// The file's `bad` lives inside its first test — this one is ours.
const bad = async (patch, re) => {
  const r = await post('/api/run', { projectDir: dir, prompt: 'x', ...patch });
  assert.equal(r.status, 400, JSON.stringify(patch));
  assert.match((await r.json()).error, re);
};

test('POST /api/run with after: validations, then a 202 that names the predecessor', async () => {
  const seed = await post('/api/run', { projectDir: dir, prompt: 'Refactor', mock: true, scheduledFor: inFuture(3600_000) });
  const { runId: predId } = await seed.json();
  await bad({ after: 'abc' }, /after must be \{ kind: ticket \| pipeline, id \}/);
  await bad({ after: { kind: 'ticket', id: predId }, scheduledFor: inFuture(3600_000) }, /provide scheduledFor, repeat OR after, not both/);
  await bad({ after: { kind: 'ticket', id: predId }, ifMissed: 'skip' }, /ifMissed and graceMin do not apply to a run after another run/);
  await bad({ after: { kind: 'ticket', id: predId }, afterPolicy: 'sometimes' }, /afterPolicy must be one of done \| any/);
  await bad({ sourceFromPrevious: true }, /sourceFromPrevious needs after/);
  await bad({ after: { kind: 'ticket', id: predId }, sourceFromPrevious: true, sourceBranch: 'main' }, /sourceFromPrevious and sourceBranch \/ sourceBranchByKey cannot both be given/);
  await bad({ after: { kind: 'ticket', id: 'nope' } }, /no run or scheduled run has id nope/);
  // A plain run that says sourceFromPrevious: false must NOT enter parseScheduleRequest
  // (it would 400 as "scheduledFor must be an ISO 8601 string").
  const plain = await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, sourceFromPrevious: false });
  assert.equal(plain.status, 200);
  await untilSettled((await plain.json()).runId);

  const res = await post('/api/run', { projectDir: dir, prompt: 'Tests', mock: true, after: { kind: 'ticket', id: predId }, afterPolicy: 'any', sourceFromPrevious: true });
  assert.equal(res.status, 202);
  const out = await res.json();
  assert.equal(out.status, 'scheduled'); assert.equal(out.scheduledFor, null);
  assert.deepEqual(out.after, { kind: 'ticket', id: predId, title: 'Refactor' });
  assert.equal(out.sourceFromPrevious, true);
  const row = getDb().prepare('SELECT after_kind, after_id, after_policy, source_from_previous, request FROM scheduled_runs WHERE id = ?').get(out.runId);
  assert.deepEqual([row.after_kind, row.after_id, row.after_policy, row.source_from_previous], ['ticket', predId, 'any', 1]);
  const req = JSON.parse(row.request);
  assert.ok(!('after' in req) && !('afterPolicy' in req) && !('sourceFromPrevious' in req), 'columns, never request fields');
  // POST carries no selfId — a NEW run waiting for out.runId is a legitimate chain (cycles are a PATCH concern, Task 7).
  const selfRef = await post('/api/run', { projectDir: dir, prompt: 'x', after: { kind: 'ticket', id: out.runId } });
  assert.equal(selfRef.status, 202);
});

test('a chain of two mock runs: B starts after A finishes, on A\'s feature branch', async () => {
  const a = await (await post('/api/run', { projectDir: dir, prompt: 'Refactor the README', title: 'Refactor', mock: true, scheduledFor: inFuture(1500) })).json();
  const b = await (await post('/api/run', { projectDir: dir, prompt: 'Add tests', title: 'Tests', mock: true, after: { kind: 'ticket', id: a.runId }, sourceFromPrevious: true })).json();
  await new Promise((r) => setTimeout(r, 1600));
  await schedulerTick();
  const ea = await untilSettled(a.runId);
  assert.equal(ea.status, 'done');
  const aRow = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(ea.pipelineId);
  const aFeature = JSON.parse(aRow.branch).feature;
  assert.ok(aFeature, 'A left a feature branch');
  // B is started by the run-end nudge: when untilSettled(a) returns, A's `pipelines.status` is usually
  // still `running` (the `state` frame lands BEFORE the `done` event persists — see the file's own
  // comment on `until`), so one explicit tick here can be a no-op. Tick until B is there instead.
  await until(async () => { await schedulerTick(); return runs.get(b.runId); });
  const eb = await untilSettled(b.runId);
  assert.equal(eb.status, 'done');
  const bRow = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(eb.pipelineId);
  assert.equal(JSON.parse(bRow.branch).source, aFeature, 'B branched off A\'s feature branch');
  const tb = (await get(`/api/schedules/${b.runId}`)).item;
  assert.equal(tb.status, 'fired');
  assert.notEqual(tb.runAt, '9999-12-31T00:00:00.000Z', 'run_at became the gate time');
});

test('Run now on an after-ticket that starts from its predecessor\'s branch needs that branch to exist', async () => {
  const a = await (await post('/api/run', { projectDir: dir, prompt: 'A', mock: true, scheduledFor: inFuture(3600_000) })).json();
  const b = await (await post('/api/run', { projectDir: dir, prompt: 'B', mock: true, after: { kind: 'ticket', id: a.runId }, sourceFromPrevious: true })).json();
  const r = await post(`/api/schedules/${b.runId}/run-now`);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /^Start ‘A’ first, or change its source branch$/);
});

// The 409 has TWO halves. The one above is `!p.pipelineId` (the predecessor never started);
// this one is the `previousBranchesOf` half — a LIVE predecessor whose row has no
// `branch.feature` yet. Without that half the ticket reaches fireTicket and fails non-transiently.
test('Run now: a running predecessor that has not written its feature branch yet is refused too', async () => {
  seedPipelineRow({ id: 'r0000001', title: 'Bare', status: 'running', projectKey: projectKey(dir), startedAt: new Date().toISOString(), branch: null });
  const res = await post('/api/run', { projectDir: dir, prompt: 'C', mock: true, after: { kind: 'pipeline', id: 'r0000001' }, sourceFromPrevious: true });
  assert.equal(res.status, 202);
  const c = await res.json();
  const r = await post(`/api/schedules/${c.runId}/run-now`);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /^Start ‘Bare’ first, or change its source branch$/);
});

test('after-candidates, after/:id, dependents and the enriched ticket list', async () => {
  const a = await (await post('/api/run', { projectDir: dir, prompt: 'A', title: 'A', mock: true, scheduledFor: inFuture(3600_000) })).json();
  const b = await (await post('/api/run', { projectDir: dir, prompt: 'B', title: 'B', mock: true, after: { kind: 'ticket', id: a.runId } })).json();
  // A PAUSED pipeline is in SETTLED_RUN — it must still be offered (the rows, not the runs Map, decide).
  seedPipelineRow({ id: 'c0000001', title: 'Parked', status: 'paused', projectKey: projectKey(dir), startedAt: '2026-09-20T10:00:00.000Z' });
  // A MISSED ticket is never offered: resolveAfterRef refuses it under either policy.
  const m = await (await post('/api/run', { projectDir: dir, prompt: 'M', title: 'M', mock: true, scheduledFor: inFuture(3600_000) })).json();
  getDb().prepare("UPDATE scheduled_runs SET status = 'missed' WHERE id = ?").run(m.runId);
  const cands = await get(`/api/schedules/after-candidates?projectDir=${encodeURIComponent(dir)}`);
  assert.ok(cands.tickets.some((t) => t.id === a.runId && t.title === 'A' && t.after == null));
  assert.ok(cands.tickets.some((t) => t.id === b.runId && t.after && t.after.id === a.runId));
  assert.equal(cands.tickets.some((t) => t.id === m.runId), false, 'a missed ticket is not a candidate');
  assert.deepEqual(cands.runs.find((r) => r.pipelineId === 'c0000001'), { pipelineId: 'c0000001', runId: null, title: 'Parked', status: 'paused' });
  const ref = await get(`/api/schedules/after/${a.runId}`);
  assert.deepEqual(ref, { kind: 'ticket', id: a.runId, title: 'A', status: 'scheduled', projectDir: dir, workspaceId: null });
  assert.equal((await fetch(`${base}/api/schedules/after/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/schedules/after/sch_deadbeef`)).status, 400);
  const deps = await get(`/api/schedules/dependents?ticketId=${a.runId}`);
  assert.deepEqual(deps.dependents.map((d) => d.id), [b.runId]);
  const list = await get(`/api/schedules?projectDir=${encodeURIComponent(dir)}`);
  const tb = list.tickets.find((t) => t.id === b.runId);
  assert.deepEqual(tb.after, { kind: 'ticket', id: a.runId, policy: 'done', title: 'A', status: 'scheduled', pipelineId: null });
  assert.equal(tb.sourceFromPrevious, false);
});

test('PATCH switches a ticket between a time and a predecessor, and validates the chain', async () => {
  const a = await (await post('/api/run', { projectDir: dir, prompt: 'A', title: 'A', mock: true, scheduledFor: inFuture(3600_000) })).json();
  const b = await (await post('/api/run', { projectDir: dir, prompt: 'B', title: 'B', mock: true, scheduledFor: inFuture(7200_000) })).json();
  let r = await call('PATCH', `/api/schedules/${b.runId}`, { after: { kind: 'ticket', id: a.runId }, sourceFromPrevious: true });
  assert.equal(r.status, 200);
  const item = (await r.json()).item;
  assert.equal(item.after.id, a.runId); assert.equal(item.sourceFromPrevious, true); assert.equal(item.runAt, '9999-12-31T00:00:00.000Z');
  r = await call('PATCH', `/api/schedules/${a.runId}`, { after: { kind: 'ticket', id: b.runId } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /already waits for this run/);
  r = await call('PATCH', `/api/schedules/${b.runId}`, { after: { kind: 'ticket', id: a.runId }, scheduledFor: inFuture(3600_000) });
  assert.equal(r.status, 400);
  // …and the missed-slot fields do not ride with a predecessor here either (the POST rule, same sentence).
  r = await call('PATCH', `/api/schedules/${b.runId}`, { after: { kind: 'ticket', id: a.runId }, ifMissed: 'skip' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ifMissed and graceMin do not apply to a run after another run/);
  // The rejected both-fields PATCH applied NOTHING — b is still an after-ticket at the sentinel.
  const untouched = (await get(`/api/schedules/${b.runId}`)).item;
  assert.equal(untouched.runAt, '9999-12-31T00:00:00.000Z');
  assert.equal(untouched.after.id, a.runId);
  // A move back to a time cannot keep "the branch of the run before it": there is no run before it any more.
  r = await call('PATCH', `/api/schedules/${b.runId}`, { scheduledFor: inFuture(3600_000), sourceFromPrevious: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /sourceFromPrevious needs after/);
  // …nor a policy: a timed ticket has none (updateTicket would drop it; the route says so instead).
  r = await call('PATCH', `/api/schedules/${b.runId}`, { scheduledFor: inFuture(3600_000), afterPolicy: 'any' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /afterPolicy does not apply to a run at a time/);
  r = await call('PATCH', `/api/schedules/${a.runId}`, { afterPolicy: 'any' });
  assert.equal(r.status, 400, 'a policy ALONE on a ticket with no predecessor is the same refusal');
  r = await call('PATCH', `/api/schedules/${b.runId}`, { scheduledFor: inFuture(3600_000) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).item.after, null);
});

test('an occurrence of a repeating schedule cannot be re-chained either', async () => {
  // The same handle the file's repeating test uses: POST /api/run with `repeat` answers
  // { runId, scheduleId } — `runId` IS the pending occurrence's ticket id.
  const made = await (await post('/api/run', { projectDir: dir, prompt: 'Nightly', title: 'Nightly', mock: true, repeat: { rule: { freq: 'daily', time: '02:00', tz: 'UTC' } } })).json();
  const a = await (await post('/api/run', { projectDir: dir, prompt: 'A', title: 'A', mock: true, scheduledFor: inFuture(3600_000) })).json();
  const r = await call('PATCH', `/api/schedules/${made.runId}`, { after: { kind: 'ticket', id: a.runId } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /an occurrence of a repeating schedule cannot be moved/);
  await call('DELETE', `/api/schedules/${made.scheduleId}`);
});

test('GET /api/branches lists the run branches that still exist, newest first', async () => {
  execFileSync('git', ['branch', 'worca/keep-1a2b3c4d'], { cwd: dir });
  seedPipelineRow({ id: '1a2b3c4d', projectKey: projectKey(dir), title: 'Kept', status: 'done', startedAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T11:00:00.000Z', branch: { source: 'main', feature: 'worca/keep-1a2b3c4d' } });
  seedPipelineRow({ id: '2b3c4d5e', projectKey: projectKey(dir), title: 'Gone', status: 'done', startedAt: '2026-09-19T10:00:00.000Z', branch: { source: 'main', feature: 'worca/gone-2b3c4d5e' } });
  const data = await get(`/api/branches?projectDir=${encodeURIComponent(dir)}`);
  // Earlier tests in this file leave real mock-run feature branches in `dir`; assert the seeds by identity.
  assert.deepEqual(data.runs.find((r) => r.pipelineId === '1a2b3c4d'),
    { branch: 'worca/keep-1a2b3c4d', pipelineId: '1a2b3c4d', title: 'Kept', status: 'done', endedAt: '2026-09-20T11:00:00.000Z' });
  assert.equal(data.runs.some((r) => r.pipelineId === '2b3c4d5e'), false, 'a branch that no longer exists is not offered');
  assert.ok(data.branches.includes('worca/keep-1a2b3c4d'), 'the plain list is unchanged');
});
