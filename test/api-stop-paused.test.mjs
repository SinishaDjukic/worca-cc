// test/api-stop-paused.test.mjs — POST /api/stop on a PAUSED run through the real server
// (mock runs): a run this server paused keeps its runId and its tabs get done(stopped);
// a run the server no longer holds (restart) is stopped by pipeline id; an interrupted run
// is refused; a stopped run cannot be resumed; a resume and a stop racing on one paused
// run never both succeed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, runs, getDb, _testing, dir;
const req = async (method, p, body) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
async function until(fn, ms = 30000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${what}`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-stop-paused-api-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  srv = appServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('stop-paused-api');
  const { addProject } = await import('../src/core/projects.mjs');
  await addProject({ name: `stop-paused-api-${Date.now()}`, path: dir });
});
after(async () => {
  for (const e of runs.values()) { try { e.orch?.stop?.(); } catch { /* over */ } }
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A mock run started and paused through the API: { runId, pipelineId, worktreeDir }. */
async function pausedViaApi() {
  const start = await req('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const runId = start.body.runId;
  const e = await until(() => { const x = runs.get(runId); return x?.orch?.state?.id && x.status === 'running' ? x : null; }, 30000, 'a running run');
  assert.equal((await req('POST', '/api/pause', { runId })).status, 200);
  await until(() => runs.get(runId)?.status === 'paused', 30000, 'paused');
  const pipelineId = e.orch.state.id;
  const row = getDb().prepare('SELECT status, branch FROM pipelines WHERE id = ?').get(pipelineId);
  assert.equal(row.status, 'paused');
  return { runId, pipelineId, worktreeDir: JSON.parse(row.branch || '{}').worktreeDir || null };
}
const rowOf = (id) => getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(id);

test('a run this server paused: Stop by runId settles it for real and its tabs get done(stopped)', async () => {
  const { runId, pipelineId, worktreeDir } = await pausedViaApi();
  const r = await req('POST', '/api/stop', { runId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, pipelineId, runId, status: 'stopped' });
  assert.equal(rowOf(pipelineId).status, 'stopped', 'stopped in the DB, not only in memory');
  assert.equal(rowOf(pipelineId).resume_point, null);
  assert.equal(runs.get(runId).status, 'stopped');
  assert.ok(runs.get(runId).events.some((ev) => ev.type === 'done' && ev.status === 'stopped'), 'the entry carried done(stopped)');
  if (worktreeDir) assert.equal(existsSync(worktreeDir), false, 'the worktree is removed');
  const again = await req('POST', '/api/resume', { pipelineId });
  assert.equal(again.status, 400, 'a stopped run is not resumable');
  assert.match(again.body.error, /not resumable/);
});

test('after a restart (no entry): Stop by pipeline id; a stale runId alongside is fine', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  runs.delete(runId);                                        // what a restart leaves behind
  const r = await req('POST', '/api/stop', { runId, pipelineId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, pipelineId, runId: null, status: 'stopped' });
  assert.equal(rowOf(pipelineId).status, 'stopped');
});

test('an interrupted run is refused 409 and stays resumable', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  runs.delete(runId);
  getDb().prepare("UPDATE pipelines SET status = 'interrupted' WHERE id = ?").run(pipelineId);
  const r = await req('POST', '/api/stop', { pipelineId });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'INTERRUPTED');
  assert.equal(rowOf(pipelineId).status, 'interrupted');
  assert.ok(rowOf(pipelineId).resume_point, 'resume point kept');
});

test('a paused entry whose run was stopped elsewhere (a terminal): refused, and the entry settles for its tabs', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  const { claimPausedForStop } = await import('../src/core/artifacts.mjs');
  assert.equal(claimPausedForStop(pipelineId), true, 'another process stopped it');
  const r = await req('POST', '/api/stop', { runId });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_PAUSED');
  assert.equal(runs.get(runId).status, 'stopped', 'no longer offered as Paused');
  assert.ok(runs.get(runId).events.some((ev) => ev.type === 'done' && ev.status === 'stopped'), 'its tabs were told');
  assert.equal(runs.get(runId).orch.getState().status, 'stopped', 'a later subscribe snapshot reads stopped too');
});

test('a paused entry whose run was stopped elsewhere: a Resume is refused, and the entry settles for its tabs', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  const { claimPausedForStop } = await import('../src/core/artifacts.mjs');
  assert.equal(claimPausedForStop(pipelineId), true, 'another process stopped it');
  const r = await req('POST', '/api/resume', { pipelineId, mock: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not resumable/);
  assert.equal(runs.get(runId).status, 'stopped', 'no longer offered as Paused');
  assert.ok(runs.get(runId).events.some((ev) => ev.type === 'done' && ev.status === 'stopped'), 'its tabs were told');
});

test('a stale tab stopping a pipeline this server already resumed stops the live run', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  const resumed = await req('POST', '/api/resume', { pipelineId, mock: true });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  await until(() => ['starting', 'running'].includes(runs.get(resumed.body.runId)?.status), 30000, 'the resumed run is live');
  const r = await req('POST', '/api/stop', { runId: `${runId}-from-an-old-boot`, pipelineId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(runs.get(resumed.body.runId).status, 'stopped');
});

test('neither a known runId nor a pipelineId: 400 unknown runId (unchanged)', async () => {
  const r = await req('POST', '/api/stop', { runId: 'nope' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /unknown runId/);
});

test('a resume and a stop racing on one paused run never both succeed', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  runs.delete(runId);
  const [resume, stop] = await Promise.allSettled([
    _testing.resumeRun(pipelineId, { mock: true }),
    _testing.stopPausedPipeline(pipelineId, 'ada'),
  ]);
  const won = [resume, stop].filter((x) => x.status === 'fulfilled');
  assert.equal(won.length, 1, `exactly one wins: ${JSON.stringify([resume, stop].map((x) => x.reason?.message || 'ok'))}`);
  if (stop.status === 'fulfilled') {
    assert.equal(rowOf(pipelineId).status, 'stopped');
    assert.ok(![...runs.values()].some((e) => e.pipelineId === pipelineId && e.status === 'starting'), 'no resumed run went live');
  } else {
    assert.ok(['LIVE', 'NOT_PAUSED'].includes(stop.reason.code), stop.reason.message);
  }
});

test('a stop while a resume of the same run is going live is refused LIVE and touches nothing', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  runs.delete(runId);
  const resumed = await _testing.resumeRun(pipelineId, { mock: true });
  await assert.rejects(_testing.stopPausedPipeline(pipelineId, 'ada'), (e) => e.code === 'LIVE' && e.status === 409);
  assert.notEqual(rowOf(pipelineId).status, 'stopped', 'the resumed run keeps its row');
  assert.ok(['starting', 'running'].includes(runs.get(resumed.runId).status), 'the resumed run was not disturbed');
});

test('a stop by pipeline id (no entry) cancels its pending "Resume at…" ticket', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  const t = await req('POST', '/api/schedules/resume', { pipelineId, scheduledFor: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(t.status, 202, JSON.stringify(t.body));
  runs.delete(runId);
  assert.equal((await req('POST', '/api/stop', { pipelineId })).status, 200);
  assert.equal(getDb().prepare('SELECT status FROM scheduled_runs WHERE id = ?').get(t.body.runId).status, 'canceled');
});

test('two tabs stopping one paused run at once: both join one stop, its tabs get done(stopped) exactly once', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  const [a, b] = await Promise.all([req('POST', '/api/stop', { runId }), req('POST', '/api/stop', { pipelineId })]);
  assert.deepEqual([a.status, b.status], [200, 200], 'the second request joins the first stop');
  assert.equal(rowOf(pipelineId).status, 'stopped');
  const dones = runs.get(runId).events.filter((ev) => ev.type === 'done' && ev.status === 'stopped');
  assert.equal(dones.length, 1, 'no early settle from the losing request');
});

// A pause unwinds after its state(paused) frame: the harness still persists and audits (a forced pause
// also builds the diff and writes back to the task source) before its done(paused). A Stop in that
// window waits for it: two harnesses never work one run, and the entry ends stopped.
for (const via of ['run', 'resume']) {
  test(`a Stop that lands while a ${via === 'run' ? '' : 'resumed '}run is still unwinding its pause waits for it: the entry ends stopped`, async () => {
    const { RunHarness } = await import('../src/core/run-harness.mjs');
    const audit = RunHarness.prototype._auditAction;
    let armed = false;
    let held = false;
    let release;
    const gate = new Promise((r) => { release = r; });
    // Hold the pausing harness inside _completePaused: after its persist (the row and the entry read
    // paused), before its done(paused).
    RunHarness.prototype._auditAction = async function heldAudit(kind, ...a) {
      if (armed && kind === 'pause' && !held) { held = true; await gate; }
      return audit.call(this, kind, ...a);
    };
    try {
      let runId;
      let pipelineId;
      if (via === 'run') {
        const start = await req('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
        assert.equal(start.status, 200, JSON.stringify(start.body));
        runId = start.body.runId;
        await until(() => runs.get(runId)?.orch?.state?.id && runs.get(runId).status === 'running', 30000, 'a running run');
        pipelineId = runs.get(runId).orch.state.id;
      } else {
        ({ pipelineId } = await pausedViaApi());
        const resumed = await req('POST', '/api/resume', { pipelineId, mock: true });
        assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
        runId = resumed.body.runId;
        await until(() => runs.get(runId)?.status === 'running', 30000, 'the resumed run is running');
      }
      armed = true;
      assert.equal((await req('POST', '/api/pause', { runId })).status, 200);
      await until(() => held && runs.get(runId)?.status === 'paused', 30000, 'a pause still unwinding');
      let answered = false;
      const stopping = req('POST', '/api/stop', { runId }).then((r) => { answered = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(answered, false, 'the stop waits for the pause to finish');
      assert.equal(rowOf(pipelineId).status, 'paused', 'nothing is claimed while the pausing harness still works the run');
      release();
      const r = await stopping;
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(rowOf(pipelineId).status, 'stopped');
      assert.equal(runs.get(runId).status, 'stopped', 'the late done(paused) did not turn it back');
      assert.deepEqual(runs.get(runId).events.filter((ev) => ev.type === 'done').map((ev) => ev.status), ['paused', 'stopped']);
    } finally {
      release();
      RunHarness.prototype._auditAction = audit;
    }
  });
}

test('Check out waits while the stop of a paused run is still tearing its worktree down', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  const { RunHarness } = await import('../src/core/run-harness.mjs');
  const teardown = RunHarness.prototype._teardownRunRoot;
  let release;
  const gate = new Promise((r) => { release = r; });
  // Hold the teardown: the row and the done frame already read stopped, the worktree is still there.
  RunHarness.prototype._teardownRunRoot = async function held(...a) { await gate; return teardown.apply(this, a); };
  try {
    const stopping = req('POST', '/api/stop', { runId });
    await until(() => runs.get(runId).events.some((ev) => ev.type === 'done' && ev.status === 'stopped'), 30000, 'done(stopped)');
    const co = await req('POST', `/api/runs/${pipelineId}/checkout?projectDir=${encodeURIComponent(dir)}`, {});
    assert.equal(co.status, 409, JSON.stringify(co.body));
    assert.equal(co.body.code, 'NOT_FINISHED');
    release();
    assert.equal((await stopping).status, 200);
  } finally {
    release();
    RunHarness.prototype._teardownRunRoot = teardown;
  }
});

// A run this server paused, stopped from a terminal (`worca stop`): no frame reaches this server. A new
// tab (a reload) and the scheduler tick both settle the entry, so no page keeps offering a Stop and a
// Resume the row refuses until someone clicks one or the server restarts.
test('a paused entry whose run was stopped from a terminal settles for a new tab and on the scheduler tick', async () => {
  const mod = await import('../ui/server.mjs');
  const { claimPausedForStop } = await import('../src/core/artifacts.mjs');
  const { WebSocket } = await import('ws');
  const a = await pausedViaApi();
  await until(() => runs.get(a.runId)?.settled, 30000, 'the pause has unwound');
  assert.equal(claimPausedForStop(a.pipelineId), true, 'another process stopped it');
  await new Promise((r) => mod.server.listen(0, '127.0.0.1', r));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${mod.server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
    const hello = await new Promise((res, rej) => {
      ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'hello') res(m); });
      ws.on('error', rej);
    });
    ws.close();
    assert.equal(hello.runs.find((r) => r.runId === a.runId).status, 'stopped', 'a reload no longer reads it paused');
  } finally {
    await new Promise((r) => mod.server.close(r));
  }
  assert.ok(runs.get(a.runId).events.some((ev) => ev.type === 'done' && ev.status === 'stopped'), 'its open tabs were told');
  const b = await pausedViaApi();
  await until(() => runs.get(b.runId)?.settled, 30000, 'the pause has unwound');
  assert.equal(claimPausedForStop(b.pipelineId), true, 'another process stopped it');
  await mod.schedulerTick();
  assert.equal(runs.get(b.runId).status, 'stopped', 'the next tick settled it in the open tabs');
  assert.ok(runs.get(b.runId).events.some((ev) => ev.type === 'done' && ev.status === 'stopped'));
});

// A stop that fails before its claim lands (the database locked past its busy timeout) leaves the
// paused entry as it was: a reload snapshots entry.orch, and the stop's orchestrator was never rehydrated.
test('a stop that fails before its claim leaves the paused entry on its own orchestrator', async () => {
  const { runId, pipelineId } = await pausedViaApi();
  await until(() => runs.get(runId)?.settled, 30000, 'the pause has unwound');
  const paused = runs.get(runId).orch;
  getDb().exec("CREATE TRIGGER stop_fault BEFORE UPDATE ON pipelines WHEN OLD.status = 'paused' AND NEW.status = 'stopped' BEGIN SELECT RAISE(ABORT, 'database is locked (injected)'); END;");
  try {
    const r = await req('POST', '/api/stop', { runId });
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(rowOf(pipelineId).status, 'paused', 'nothing was claimed');
    const e = runs.get(runId);
    assert.equal(e.orch, paused, 'the paused orchestrator is back: a reload snapshots it');
    assert.equal(e.orch.getState().status, 'paused');
    assert.notEqual(e.lastAction?.kind, 'stop', 'no stop is recorded');
  } finally {
    getDb().exec('DROP TRIGGER IF EXISTS stop_fault');
  }
  const again = await req('POST', '/api/stop', { runId });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(rowOf(pipelineId).status, 'stopped');
});

test('a stop of this server still in flight is never settled early by a new tab, the tick or a Resume', async () => {
  const mod = await import('../ui/server.mjs');
  const { RunHarness } = await import('../src/core/run-harness.mjs');
  const { runId, pipelineId } = await pausedViaApi();
  await until(() => runs.get(runId)?.settled, 30000, 'the pause has unwound');
  const memory = RunHarness.prototype._reattachMemoryForStop;
  let held = false;
  let release;
  const gate = new Promise((r) => { release = r; });
  // Hold the stop after its claim (the row reads stopped), before it settles (its state + done frames).
  RunHarness.prototype._reattachMemoryForStop = async function heldMemory(...a) { held = true; await gate; return memory.apply(this, a); };
  try {
    const stopping = req('POST', '/api/stop', { runId });
    await until(() => held, 30000, 'the stop holds after its claim');
    assert.equal(rowOf(pipelineId).status, 'stopped');
    await mod.schedulerTick();
    // A Resume from another tab lands in the same window: refused, and it leaves the tabs to the stop too.
    const resumed = await req('POST', '/api/resume', { pipelineId });
    assert.equal(resumed.status, 400, JSON.stringify(resumed.body));
    const dones = () => runs.get(runId).events.filter((ev) => ev.type === 'done' && ev.status === 'stopped').length;
    assert.equal(dones(), 0, 'not settled early under the stop');
    release();
    assert.equal((await stopping).status, 200);
    assert.equal(dones(), 1, 'one done(stopped): the stop sent it');
  } finally {
    release();
    RunHarness.prototype._reattachMemoryForStop = memory;
  }
});
