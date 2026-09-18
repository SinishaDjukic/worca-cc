// test/api-schedules.test.mjs — scheduled runs over HTTP: POST /api/run with scheduledFor /
// repeat answers 202 and stores a ticket; the scheduler tick starts it through the SAME
// start path (mock mode), stamps provenance on the pipeline row, and feeds notifications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

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
