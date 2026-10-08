// test/api-schedule-resume.test.mjs
// POST /api/schedules/resume + firing of resume tickets through schedulerTick.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';

let homeDir, srv, base, dir, mod, getDb, schedulerTick, runs;
let prevHome, prevMock;
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, p, b) => fetch(`${base}${p}`, { method, headers: JSONH, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
const post = (p, b) => call('POST', p, b ?? {});
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();
/** Poll until fn() answers truthy (api-schedules :52-60 idiom): orch.resume() persists
 *  asynchronously, so a fire test cannot assert the audit line / row status right after
 *  the tick returns. */
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('condition never became true');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-sched-resume-'));
  prevHome = process.env.WORCA_HOME; prevMock = process.env.WORCA_MOCK;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  ({ runs, schedulerTick } = mod);          // api-schedules :69 shape
  ({ getDb } = await import('../src/core/db.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('sched-resume');
  await addProject({ name: 'sched-resume', path: dir });
});

after(async () => {
  await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
});

/** A paused, resumable fixture: v2 resume point + a real on-disk worktree dir. */
async function pausedFixture({ pauseReason = null, pauseDetail = null, title = 'Paused feat', guardrailsId = null } = {}) {
  const wt = await mkdtemp(join(tmpdir(), 'sched-resume-wt-'));
  const branch = { source: 'main', feature: 'feat/x', worktreeDir: wt, reusedExisting: false };
  const resumePoint = graphResumePoint({ pipelineDir: dir, ...(pauseReason ? { pauseReason } : {}), ...(pauseDetail ? { pauseDetail } : {}), ...(guardrailsId ? { guardrailsId } : {}) });
  const { id } = await seedPipeline(dir, { title, status: 'paused', branch, resumePoint });
  return { id, wt };
}

/** Fire tests leave a live entry behind; a mock run may already be settled (api-schedules'
 *  untilSettled proves mock runs reach 'done'), so stop only a LIVE one. */
async function cleanupRun(pipelineId) {
  const found = [...runs.entries()].find(([, e]) => e.pipelineId === pipelineId);
  if (found && !['done', 'stopped', 'error'].includes(found[1].status)) {
    await post('/api/stop', { runId: found[0] });
  }
}

test('create: 202 with the ticket wire shape, listed by GET /api/schedules, default ifMissed=skip', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(2 * 3600_000) });
  assert.equal(r.status, 202);
  const made = await r.json();
  assert.equal(made.status, 'scheduled');
  assert.equal(made.resumePipelineId, id);
  const list = await (await fetch(`${base}/api/schedules?projectDir=${encodeURIComponent(dir)}`)).json();
  const t = list.tickets.find((x) => x.id === made.runId);
  assert.ok(t, 'the resume ticket is listed');
  assert.equal(t.resumePipelineId, id);
  assert.equal(t.ifMissed, 'skip');
  assert.equal(t.title, `Resume ‘Paused feat’`);
  const ev = getDb().prepare("SELECT text, actor FROM pipeline_events WHERE pipeline_id = ? AND text LIKE 'Resume scheduled for%'").get(id);
  assert.ok(ev, 'the schedule itself is audited on the run');
});

test('create refuses a non-paused run (409), an unknown pipeline (404) and a second open ticket for the same pipeline (409)', async () => {
  await checkRows([
    { name: 'create refuses a run that is not paused (409) and an unknown pipeline (404)', run: async () => {
      const done = await seedPipeline(dir, { title: 'done', status: 'done' });
      assert.equal((await post('/api/schedules/resume', { pipelineId: done.id, scheduledFor: inFuture(3600_000) })).status, 409);
      assert.equal((await post('/api/schedules/resume', { pipelineId: 'pl_missing', scheduledFor: inFuture(3600_000) })).status, 404);
    } },
    { name: 'one open resume ticket per pipeline (409 on the second)', run: async () => {
      const { id } = await pausedFixture();
      assert.equal((await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(3600_000) })).status, 202);
      assert.equal((await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(7200_000) })).status, 409);
    } },
  ]);
});

test('create refuses every cap pause (clarify: team and personal caps always need a live decision)', async () => {
  for (const reason of ['cost_pipeline', 'cost_total', 'cost_pipeline_policy', 'cost_total_policy']) {
    const { id } = await pausedFixture({ pauseReason: reason, pauseDetail: 'cap hit' });
    const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(3600_000) });
    assert.equal(r.status, 409, reason);
    assert.equal((await r.json()).code, 'CAP_PAUSE', reason);
  }
});

test('create allows usage_limit / error / recoverable / plain pauses', async () => {
  for (const reason of ['usage_limit', 'error', 'recoverable', null]) {
    const { id } = await pausedFixture({ pauseReason: reason });
    const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(3600_000) });
    assert.equal(r.status, 202, String(reason));
  }
});

test('fire: the tick resumes the paused run, audits via the orchestrator, and links the ticket', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(60_000) });
  const { runId: ticketId } = await r.json();
  getDb().prepare("UPDATE scheduled_runs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), ticketId);
  const out = await schedulerTick();
  assert.ok(out.fired.includes(ticketId));
  const row = getDb().prepare('SELECT status, pipeline_id FROM scheduled_runs WHERE id = ?').get(ticketId);
  assert.equal(row.status, 'fired');
  assert.equal(row.pipeline_id, id);
  const entry = [...runs.values()].find((e) => e.pipelineId === id);
  assert.ok(entry, 'a live entry drives the pipeline again');
  assert.equal(entry.ticketId, ticketId);
  assert.equal(entry.lastAction.kind, 'resume');
  const ev = await until(() => getDb().prepare("SELECT text, actor FROM pipeline_events WHERE pipeline_id = ? AND text LIKE 'Pipeline **resumed**%'").get(id));
  assert.ok(ev, 'the orchestrator audit line names the scheduler as actor');
  await cleanupRun(id);
});

test('engine: a scheduled resume on another engine stores it, fires on it, and a refused switch answers at once', async () => {
  const { id } = await pausedFixture({ pauseReason: 'usage_limit' });
  assert.equal((await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(60_000), engine: 'gemini' })).status, 400);
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(60_000), engine: 'codex' });
  assert.equal(r.status, 202);
  const { runId: ticketId } = await r.json();
  const t = getDb().prepare('SELECT title, request FROM scheduled_runs WHERE id = ?').get(ticketId);
  assert.equal(JSON.parse(t.request).internal.resumeEngine, 'codex');
  assert.match(t.title, / on Codex$/, 'Schedules names the engine');
  getDb().prepare('UPDATE scheduled_runs SET run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), ticketId);
  assert.ok((await schedulerTick()).fired.includes(ticketId));
  const entry = [...runs.values()].find((e) => e.pipelineId === id);
  assert.equal(entry.orch.claude.engine, 'codex', 'the ticket resumes on its engine');
  await cleanupRun(id);

  const guarded = await pausedFixture({ pauseReason: 'usage_limit', guardrailsId: 'normal' });
  const refused = await post('/api/schedules/resume', { pipelineId: guarded.id, scheduledFor: inFuture(60_000), engine: 'codex' });
  assert.equal(refused.status, 409, 'checked when scheduled, not only when it fires');
  const body = await refused.json();
  assert.equal(body.code, 'engine-refused');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM scheduled_runs WHERE json_extract(request, \'$.internal.resumePipelineId\') = ?').get(guarded.id).n, 0);
});

test('fire skips when the run was resumed meanwhile (ticket skipped, feed entry, run untouched)', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(60_000) });
  const { runId: ticketId } = await r.json();
  const rr = await post('/api/resume', { pipelineId: id, mock: true });
  assert.equal(rr.status, 200);
  // The manual resume auto-cancels the ticket (next test covers THAT); resurrect it to
  // isolate the fire-time skip guard. Wait for the resumed run to PERSIST its new status
  // first — fireResumeTicket re-checks the live row, and a still-'paused' row would send
  // it into resumeRun's already-live guard (a failure, not the skip under test). The mock
  // run parks at a HITL gate, so 'running' is stable (no done sweep can re-cancel first).
  await until(() => {
    const s = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status;
    return s !== 'paused' && s !== 'interrupted' ? s : null;
  });
  getDb().prepare("UPDATE scheduled_runs SET status = 'scheduled', run_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), ticketId);
  const out = await schedulerTick();
  assert.ok(out.skipped.includes(ticketId));
  const t = getDb().prepare('SELECT status, fail_reason FROM scheduled_runs WHERE id = ?').get(ticketId);
  assert.equal(t.status, 'skipped');
  assert.match(t.fail_reason, /resumed or stopped meanwhile|now "running"/);
  const n = getDb().prepare("SELECT kind, severity FROM notifications WHERE ticket_id = ? AND kind = 'skipped'").get(ticketId);
  assert.ok(n, 'the skip left a feed entry');
  await cleanupRun(id);
});

test('manual resume auto-cancels the pending scheduled resume (with a feed entry)', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(3600_000) });
  const { runId: ticketId } = await r.json();
  const rr = await post('/api/resume', { pipelineId: id, mock: true });
  assert.equal(rr.status, 200);
  assert.equal(getDb().prepare('SELECT status FROM scheduled_runs WHERE id = ?').get(ticketId).status, 'canceled');
  const n = getDb().prepare("SELECT message FROM notifications WHERE ticket_id = ? AND kind = 'canceled'").get(ticketId);
  assert.ok(n && /resumed/.test(n.message), 'the cancellation explains itself');
  await cleanupRun(id);
});

test('manual stop of a paused run auto-cancels the pending scheduled resume (stopRun hook)', async () => {
  // Seed paused, create the ticket, then RESUME so the entry exists, then STOP the live entry.
  // Creating the ticket before the resume means the RESUME itself auto-cancels it (hook 1
  // fires first) — so resurrect the ticket after the resume to isolate the stopRun hook,
  // the way the skip test does.
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(3600_000) });
  const { runId: ticketId } = await r.json();
  const rr = await post('/api/resume', { pipelineId: id, mock: true });
  assert.equal(rr.status, 200);
  getDb().prepare("UPDATE scheduled_runs SET status = 'scheduled' WHERE id = ?").run(ticketId);
  const found = [...runs.entries()].find(([, e]) => e.pipelineId === id);
  assert.ok(found, 'the resumed run is live');
  const stop = await post('/api/stop', { runId: found[0] });
  assert.ok(stop.status === 200 || stop.status === 204, `stop answered ${stop.status}`);
  assert.equal(getDb().prepare('SELECT status FROM scheduled_runs WHERE id = ?').get(ticketId).status, 'canceled');
});

test('run-now on a resume ticket fires it and flags the response for pipeline navigation', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(3600_000) });
  const { runId: ticketId } = await r.json();
  const now = await post(`/api/schedules/${ticketId}/run-now`);
  assert.equal(now.status, 200);
  const body = await now.json();
  assert.equal(body.status, 'fired');
  assert.equal(body.resume, true);
  assert.equal(body.pipelineId, id);
  await cleanupRun(id);
});

test('a missed resume slot leaves the miss feed entry (existing miss() machinery)', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(60_000) });
  const { runId: ticketId } = await r.json();
  // Machine-asleep: the slot passed long ago (beyond ON_TIME_SLACK_MS = 90 s, scheduler.mjs)
  // with ifMissed=skip → runDueTickets' late arm takes the miss() path BEFORE claiming/starting.
  // A run_at 8 h in the past is far beyond the slack.
  getDb().prepare("UPDATE scheduled_runs SET run_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 8 * 3600_000).toISOString(), ticketId);
  const out = await schedulerTick();
  assert.ok(out.missed.includes(ticketId));
  const t = getDb().prepare('SELECT status, fail_reason FROM scheduled_runs WHERE id = ?').get(ticketId);
  assert.equal(t.status, 'missed');
  assert.match(t.fail_reason, /skips missed slots/);
  const n = getDb().prepare("SELECT kind, message FROM notifications WHERE ticket_id = ? AND kind = 'missed'").get(ticketId);
  assert.ok(n, 'the missed slot left a feed entry');
  assert.match(n.message, /skips missed slots/);
  const row = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.status, 'paused', 'the run stays paused');
});

test('fire fails (not skips) when the run became cap-paused meanwhile', async () => {
  const { id } = await pausedFixture();
  const r = await post('/api/schedules/resume', { pipelineId: id, scheduledFor: inFuture(60_000) });
  const { runId: ticketId } = await r.json();
  getDb().prepare("UPDATE scheduled_runs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), ticketId);
  const row = getDb().prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(id);
  const rp = { ...JSON.parse(row.resume_point), pauseReason: 'cost_pipeline', pauseDetail: 'cap hit again' };
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?').run(JSON.stringify(rp), id);
  const out = await schedulerTick();
  assert.ok(out.failed.includes(ticketId));
  const t = getDb().prepare('SELECT status, fail_reason FROM scheduled_runs WHERE id = ?').get(ticketId);
  assert.equal(t.status, 'failed');
  assert.match(t.fail_reason, /cost cap/);
});
