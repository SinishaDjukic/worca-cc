// test/server-drain.test.mjs
// B2 graceful drain and B3 auto-resume (src/core/drain.mjs, ui/server.mjs). The server runs in
// remote mode with no identity check (WORCA_INSECURE_NO_IDENTITY_CHECK) so a request with the
// public Host is "from outside the container" for /api/drain. A drain is one-way per process, so
// the tests run in order: the pure helpers, auto-resume, the /api/drain gate, then the drain.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { busySliceOf, createSliceFeature, featureOfPipeline } from '../src/core/shape/features.mjs';
import { heldStopTurn } from '../src/core/shape/chain.mjs';
import {
  drainTimeoutMs, sigtermGraceMs, autoResumeMode, autoResumeCandidates, DRAIN_TIMEOUT_DEFAULT_MS,
} from '../src/core/drain.mjs';
import { pauseConsequences, REASON } from '../src/core/failure-policy.mjs';

const PUBLIC = 'worca-01.example.com';
const HB = 'hb-token-0123456789abcdef0123456789abcdef';
let homeDir, prevHome, srv, port, runs, _testing, schedulerTick;
const tmp = [];
const seeded = {};

const ENV = {
  WORCA_ALLOWED_HOSTS: PUBLIC,
  WORCA_INSECURE_NO_IDENTITY_CHECK: '1',
  WORCA_HEARTBEAT_TOKEN: HB,
  WORCA_MOCK: '1',
};

async function dir(prefix) {
  const d = await mkdtemp(join(tmpdir(), `worca-cc-drain-${prefix}-`));
  tmp.push(d);
  return d;
}

/** A paused (or interrupted) run that resumeRun can actually resume in mock mode. */
async function resumable(name, { status = 'paused', pauseReason = null, resumeAs = null, startedBy = null } = {}) {
  const proj = await dir(`proj-${name}`);
  const wt = await dir(`wt-${name}`);
  await addProject({ name: `drain-${name}`, path: proj });
  const rp = graphResumePoint({ pipelineDir: proj, ...(pauseReason ? { pauseReason } : {}), ...(resumeAs ? { resumeAs } : {}) });
  const { id } = await seedPipeline(proj, {
    title: `run ${name}`, status,
    branch: { source: 'main', feature: 'f', worktreeDir: wt, reusedExisting: false },
    resumePoint: rp,
  });
  if (startedBy) getDb().prepare('UPDATE pipelines SET started_by = ? WHERE id = ?').run(startedBy, id);
  return id;
}

const status = (id) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-drain-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  Object.assign(process.env, ENV);
  _resetForTests();

  seeded.drained = await resumable('drained', { pauseReason: 'drain', resumeAs: 'ada@example.com', startedBy: 'bob@example.com' });
  seeded.userPaused = await resumable('user', { startedBy: 'bob@example.com' });
  seeded.costPaused = await resumable('cost', { pauseReason: 'cost_pipeline' });
  seeded.crashedNow = await resumable('crashed', { status: 'interrupted', startedBy: 'cy@example.com' });
  seeded.crashedLongAgo = await resumable('old', { status: 'interrupted' });

  const mod = await import('../ui/server.mjs');
  ({ runs, _testing, schedulerTick } = mod);
  srv = appServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of Object.keys(ENV)) delete process.env[k];
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const d of [homeDir, ...tmp]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function request(method, path, { host = PUBLIC, headers = {}, body } = {}) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port, path, method,
      headers: { host, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers },
    }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ } res({ status: resp.statusCode, body: json }); });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

// ── pure helpers ─────────────────────────────────────────────────────────────

test('drainTimeoutMs: 20 s by default, the env overrides it, junk falls back, capped at 10 min', () => {
  assert.equal(drainTimeoutMs({}), DRAIN_TIMEOUT_DEFAULT_MS);
  assert.equal(DRAIN_TIMEOUT_DEFAULT_MS, 20_000);
  assert.equal(drainTimeoutMs({ WORCA_DRAIN_TIMEOUT_MS: '5000' }), 5000);
  assert.equal(drainTimeoutMs({ WORCA_DRAIN_TIMEOUT_MS: '0' }), 0);
  assert.equal(drainTimeoutMs({ WORCA_DRAIN_TIMEOUT_MS: 'soon' }), DRAIN_TIMEOUT_DEFAULT_MS);
  assert.equal(drainTimeoutMs({ WORCA_DRAIN_TIMEOUT_MS: '99999999' }), 600_000);
});

test('sigtermGraceMs: 20 s by default, WORCA_SIGTERM_GRACE_MS overrides it, junk falls back, capped at 10 min', () => {
  assert.equal(sigtermGraceMs({}), 20_000);
  assert.equal(sigtermGraceMs({ WORCA_SIGTERM_GRACE_MS: '1500' }), 1500);
  assert.equal(sigtermGraceMs({ WORCA_SIGTERM_GRACE_MS: '0' }), 0);
  assert.equal(sigtermGraceMs({ WORCA_SIGTERM_GRACE_MS: 'soon' }), 20_000);
  assert.equal(sigtermGraceMs({ WORCA_SIGTERM_GRACE_MS: '99999999' }), 600_000);
  assert.equal(sigtermGraceMs({ WORCA_DRAIN_TIMEOUT_MS: '5000' }), 20_000, 'the server drain bound is a separate knob');
});

test('autoResumeMode: drained runs by default, everything with =1, nothing with =0', () => {
  assert.equal(autoResumeMode({}), 'drain');
  assert.equal(autoResumeMode({ WORCA_AUTO_RESUME: '' }), 'drain');
  assert.equal(autoResumeMode({ WORCA_AUTO_RESUME: '0' }), 'off');
  assert.equal(autoResumeMode({ WORCA_AUTO_RESUME: 'false' }), 'off');
  assert.equal(autoResumeMode({ WORCA_AUTO_RESUME: '1' }), 'all');
  assert.equal(autoResumeMode({ WORCA_AUTO_RESUME: 'true' }), 'all');
});

test('a drain pause is resumable, reported to nobody and labelled', () => {
  assert.equal(REASON.DRAIN, 'drain');
  const c = pauseConsequences('drain');
  assert.equal(c.reportsToSource, false);
  assert.equal(c.stagesResults, false);
  assert.equal(c.severity, 'info');
  assert.ok(c.label);
});

test('autoResumeCandidates: drained and freshly interrupted runs only, as whoever last resumed or started them', () => {
  const rp = (o = {}) => ({ version: 2, ...o });
  const rows = [
    { id: 'a', status: 'paused', started_by: 'bob', resumePoint: rp({ pauseReason: 'drain', resumeAs: 'ada' }) },
    { id: 'b', status: 'paused', started_by: 'bob', resumePoint: rp({ pauseReason: 'drain' }) },
    { id: 'c', status: 'paused', started_by: 'bob', resumePoint: rp() },                              // a person paused it
    { id: 'd', status: 'paused', resumePoint: rp({ pauseReason: 'cost_pipeline' }) },
    { id: 'e', status: 'paused', resumePoint: rp({ pauseReason: 'usage_limit' }) },
    { id: 'f', status: 'interrupted', started_by: 'cy', resumePoint: rp({ pauseReason: 'cost_total' }) },
    { id: 'g', status: 'interrupted', resumePoint: rp() },                                            // an older crash
    { id: 'h', status: 'paused', resumePoint: rp({ pauseReason: 'drain' }), archived_at: '2026-01-01' },
    { id: 'i', status: 'paused', resumePoint: { version: 1, pauseReason: 'drain' } },
    { id: 'j', status: 'paused', resumePoint: rp({ pauseReason: 'drain' }) },                          // has a resume ticket
    { id: 'k', status: 'done', resumePoint: rp({ pauseReason: 'drain' }) },
  ];
  const picks = autoResumeCandidates(rows, { interruptedNow: new Set(['f']), hasResumeTicket: (id) => id === 'j' });
  assert.deepEqual(picks, [
    { pipelineId: 'a', by: 'ada', why: 'drain' },
    { pipelineId: 'b', by: 'bob', why: 'drain' },
    { pipelineId: 'f', by: 'cy', why: 'interrupted' },
  ]);
  assert.deepEqual(autoResumeCandidates(rows), [{ pipelineId: 'a', by: 'ada', why: 'drain' }, { pipelineId: 'b', by: 'bob', why: 'drain' }, { pipelineId: 'j', by: 'local', why: 'drain' }]);
});

// ── B3: auto-resume on boot ──────────────────────────────────────────────────

test('WORCA_AUTO_RESUME=0 resumes nothing', async () => {
  assert.deepEqual(await _testing.autoResumeOnBoot({ interruptedIds: [seeded.crashedNow], env: { WORCA_AUTO_RESUME: '0' } }),
    { enabled: false, resumed: [], failed: [] });
  assert.deepEqual(_testing.bootResumingIds(), []);
});

test('WORCA_AUTO_RESUME=1 resumes the drained run and the run this start found interrupted, nothing else', async () => {
  const out = await _testing.autoResumeOnBoot({ interruptedIds: [seeded.crashedNow], env: { WORCA_AUTO_RESUME: '1' }, mock: true });
  assert.equal(out.enabled, true);
  assert.deepEqual(out.failed, []);
  const byId = Object.fromEntries(out.resumed.map((r) => [r.pipelineId, r]));
  assert.deepEqual(Object.keys(byId).sort(), [seeded.drained, seeded.crashedNow].sort());
  // Each as the person who last resumed it (the drain point's resumeAs), else its starter.
  assert.equal(byId[seeded.drained].by, 'ada@example.com');
  assert.equal(byId[seeded.crashedNow].by, 'cy@example.com');
  assert.equal(runs.get(byId[seeded.drained].runId).lastAction.by, 'ada@example.com');
  assert.equal(runs.get(byId[seeded.crashedNow].runId).lastAction.by, 'cy@example.com');
  assert.equal(status(seeded.userPaused), 'paused');
  assert.equal(status(seeded.costPaused), 'paused');
  assert.equal(status(seeded.crashedLongAgo), 'interrupted');
  assert.deepEqual(_testing.bootResumingIds(), []);
});

test('with no WORCA_AUTO_RESUME a start resumes the drained run only, never the interrupted one', async () => {
  const drained2 = await resumable('drained2', { pauseReason: 'drain' });
  const crashed2 = await resumable('crashed2', { status: 'interrupted' });
  const out = await _testing.autoResumeOnBoot({ interruptedIds: [crashed2], env: {}, mock: true });
  assert.deepEqual(out.resumed.map((r) => [r.pipelineId, r.why]), [[drained2, 'drain']]);
  assert.equal(status(crashed2), 'interrupted');
  assert.equal(status(seeded.userPaused), 'paused');
  assert.equal(status(seeded.costPaused), 'paused');
  assert.deepEqual(_testing.bootResumingIds(), []);
});

// ── Shaper small runs, slice 5: the "being resumed" marks of the boot resume ───────────────────────────────────────
// Each test seeds its own drain-paused rows and archives them at its end, so no later test sees them as picks.
const ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const OFF = { WORCA_FLAGS: undefined };
const RESUMING_OVERLAY = { runId: null, status: 'paused', waiting: false, asking: false, approved: false, ask: null, resuming: true };
const archive = (...ids) => {
  for (const id of ids) getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);
};
/** `fn(ids)` over fresh drain-paused rows; the marks and the rows are cleared afterwards. */
async function withDrained(names, fn) {
  const ids = [];
  for (const name of names) ids.push(await resumable(name, { pauseReason: 'drain' }));
  try { await fn(ids); } finally { _testing.markBootResumes?.([]); archive(...ids); }
}

test('bootResumePicks lists the runs a start would resume, and none with WORCA_AUTO_RESUME=0', () => withDrained(['picked'], async ([id]) => {
  assert.deepEqual(_testing.bootResumePicks({ env: {} }).filter((p) => p.pipelineId === id), [{ pipelineId: id, by: 'local', why: 'drain' }]);
  assert.deepEqual(_testing.bootResumePicks({ env: { WORCA_AUTO_RESUME: '0' } }), []);
}));

test('autoResumeOnBoot: every pick is marked while the resumes run, a stale early mark is dropped, each mark clears after its resume', () => withDrained(['mark-a', 'mark-b'], async (ids) => {
  const expected = _testing.bootResumePicks({ env: {} }).map((p) => p.pipelineId).sort();
  for (const id of ids) assert.ok(expected.includes(id));
  _testing.markBootResumes([{ pipelineId: 'stale' }]);
  const calls = [];
  const resume = async (pid) => { calls.push({ pid, marked: _testing.bootResumingIds() }); return { runId: `stub-${pid}` }; };
  const out = await _testing.autoResumeOnBoot({ env: {}, mock: true, resume });
  assert.deepEqual(calls[0]?.marked, expected);
  assert.ok(!calls[1].marked.includes(calls[0].pid), 'the first pick is unmarked as soon as its resume resolves');
  assert.ok(calls[1].marked.includes(calls[1].pid));
  assert.deepEqual(out.resumed.map((r) => r.pipelineId).sort(), expected);
  assert.deepEqual(_testing.bootResumingIds(), []);
}));

test('autoResumeOnBoot: a failed resume clears its mark, every pick is reported failed and no mark is left', () => withDrained(['fail-a', 'fail-b'], async () => {
  const expected = _testing.bootResumePicks({ env: {} }).map((p) => p.pipelineId).sort();
  const calls = [];
  const resume = async (pid) => { calls.push({ pid, marked: _testing.bootResumingIds() }); throw new Error('refused'); };
  const out = await _testing.autoResumeOnBoot({ env: {}, mock: true, resume });
  assert.deepEqual(calls.map((c) => c.pid).sort(), expected);
  assert.ok(!calls[1].marked.includes(calls[0].pid), 'the first pick is unmarked as soon as its resume throws');
  assert.deepEqual(out.failed.map((f) => f.pipelineId).sort(), expected);
  assert.deepEqual(_testing.bootResumingIds(), []);
}));

test('autoResumeOnBoot: with WORCA_AUTO_RESUME=0 an early mark is dropped', async () => {
  _testing.markBootResumes([{ pipelineId: 'stale' }]);
  assert.deepEqual(_testing.bootResumingIds(), ['stale']);
  await _testing.autoResumeOnBoot({ env: { WORCA_AUTO_RESUME: '0' } });
  assert.deepEqual(_testing.bootResumingIds(), []);
});

test('the mark reads only with the flag on', () => withDrained(['mark-flag'], async ([id]) => {
  _testing.markBootResumes([{ pipelineId: id }]);
  assert.deepEqual(_testing.bootResumingIds(), [id]);
  await withEnv(OFF, () => assert.equal(_testing.liveSliceOf(id), null));
  await withEnv(ON, () => assert.deepEqual(_testing.liveSliceOf(id), RESUMING_OVERLAY));
  _testing.markBootResumes([]);
  await withEnv(ON, () => assert.equal(_testing.liveSliceOf(id), null));
}));

test('a marked pipeline with an entry: paused keeps its overlay plus resuming, running wins unchanged, done reads as resuming', () => withDrained(['mark-entry'], async ([id]) => {
  const entry = { id: 'mark-entry-run', pipelineId: id, status: 'paused', orch: { state: {} }, events: [], pendingQuestion: { id: 'q1', kind: 'gate' } };
  const read = (env, status, marked) => withEnv(env, () => {
    entry.status = status;
    _testing.markBootResumes(marked ? [{ pipelineId: id }] : []);
    return _testing.liveSliceOf(id);
  });
  runs.set(entry.id, entry);
  try {
    const paused = await read(ON, 'paused', false);
    assert.equal(paused.runId, entry.id);
    assert.deepEqual(await read(ON, 'paused', true), { ...paused, resuming: true });
    assert.deepEqual(await read(OFF, 'paused', true), paused);
    assert.deepEqual(await read(ON, 'running', true), await read(ON, 'running', false));
    assert.deepEqual(await read(ON, 'done', true), RESUMING_OVERLAY);
  } finally { runs.delete(entry.id); }
}));

test('flag on: a feature not marked small-runs resumes as before', () => withDrained(['unmarked-feature'], async ([id]) => {
  const feature = createSliceFeature({ pipelineId: id, projectDir: await dir('unmarked'), title: 'Unmarked', smallRuns: false,
    outline: { why: 'because', slices: [{ id: 's1', title: 'One', goal: 'Goal', inScope: ['do'], outOfScope: [], acceptance: ['ok'],
      dependsOn: [], estimate: 'M' }] }, perspectives: ['product'], workflowId: 'wf_shape' });
  await withEnv(ON, async () => {
    assert.equal(featureOfPipeline(id)?.featureId, feature.id);
    const marks = [];
    const resume = (pid, opts) => { marks.push(_testing.bootResumingIds()); return _testing.resumeRun(pid, opts); };
    const out = await _testing.autoResumeOnBoot({ env: {}, mock: true, resume });
    assert.ok(marks[0]?.includes(id), 'marked during its resume');
    assert.deepEqual(out.resumed.filter((r) => r.pipelineId === id).map((r) => r.why), ['drain']);
    assert.deepEqual(out.failed, []);
    assert.deepEqual(_testing.bootResumingIds(), []);
  });
}));

// ── Shaper small runs, slice 7 (R-po-4): the boot resume takes the turn rule ──────────────────────────────────────
/** A marked 6-run feature whose runs in `at` (run number → pipeline id) have started. */
async function markedFeature(at) {
  const proj = await dir('marked');
  const { id: origin } = await seedPipeline(proj, { title: 'marked origin', status: 'done' });
  const slices = Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, title: `Slice ${i + 1}`, goal: 'Goal', inScope: ['do'], outOfScope: [],
    acceptance: ['ok'], dependsOn: [], estimate: 'M' }));
  const f = createSliceFeature({ pipelineId: origin, projectDir: proj, title: 'Marked', smallRuns: false,
    outline: { why: 'because', slices }, perspectives: ['product'], workflowId: 'wf_shape' });
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), origin);
  for (const [run, pid] of Object.entries(at)) {
    getDb().prepare(`UPDATE scheduled_runs SET status = 'fired', pipeline_id = ?
      WHERE id = (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?)`).run(pid, f.id, Number(run));
  }
  return f;
}
const quietTickets = () => getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();

test('S7: two marked picks of one feature: autoResumeOnBoot calls resume for the lower only; the other reads heldResume, not resuming', () => withDrained(['held-six', 'held-four'], async ([six, four]) => {
  // Run 6 started first, so the boot lists it first: the run number decides, not the start time.
  const startedAt = getDb().prepare('UPDATE pipelines SET started_at = ? WHERE id = ?');
  startedAt.run('2026-01-01T00:00:00.000Z', six);
  startedAt.run('2026-01-02T00:00:00.000Z', four);
  const f = await markedFeature({ 4: four, 6: six });
  const mine = (id) => id === four || id === six;
  try {
    await withEnv(ON, async () => {
      assert.deepEqual(_testing.bootResumePicks({ env: {} }).map((p) => p.pipelineId).filter(mine), [six, four]);
      const calls = [];
      const resume = async (pid) => {
        calls.push({ pid, marks: _testing.bootResumingIds().filter(mine), four: _testing.liveSliceOf(four), six: _testing.liveSliceOf(six),
          busyBeside4: busySliceOf(f.id, { exclude: 4, live: _testing.liveSliceOf }) });
        return { ok: true, runId: `stub-${pid}` };
      };
      // The early mark of onReconciled and the real one agree.
      _testing.markBootResumes(_testing.bootResumePicks({ env: {} }));
      assert.deepEqual(_testing.bootResumingIds().filter(mine), [four]);
      const out = await _testing.autoResumeOnBoot({ env: {}, mock: true, resume });
      const ours = calls.filter((c) => mine(c.pid));
      assert.deepEqual(ours.map((c) => c.pid), [four]);
      assert.deepEqual(ours[0].marks, [four]);
      assert.equal(ours[0].four.resuming, true);
      assert.deepEqual(ours[0].six?.heldResume, { after: 4 });
      assert.ok(!ours[0].six.resuming);
      assert.equal(ours[0].busyBeside4, null, 'run 6 holds nothing');
      assert.deepEqual(out.resumed.map((r) => r.pipelineId).filter(mine), [four]);
      assert.deepEqual(out.failed.map((r) => r.pipelineId).filter(mine), []);
      assert.equal(status(six), 'paused');
      assert.deepEqual(_testing.bootResumingIds(), []);
    });
  } finally { _testing.heldStops?.dropResume(six); quietTickets(); }
}));

test("S7: a stub resume answering {ok: true, held: true} leaves the pid out of resumed and writes no 'resumed automatically' audit", () => withDrained(['held-answer'], async ([id]) => {
  const resume = async (pid) => ({ ok: true, held: true, pipelineId: pid, after: 2 });
  const out = await _testing.autoResumeOnBoot({ env: {}, mock: true, resume });
  assert.deepEqual(out.resumed.filter((r) => r.pipelineId === id), []);
  assert.deepEqual(out.failed.filter((r) => r.pipelineId === id), []);
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id).map((r) => r.text);
  assert.deepEqual(audit.filter((t) => /resumed automatically/i.test(t)), []);
  assert.deepEqual(_testing.bootResumingIds(), []);
}));

// ── A4 (R-qa-2): a stop inside the boot-resume window releases the turn at once ────────────────────────────────────
test('A4 (R-qa-2): a run stopped in the boot-resume window frees the turn before its automatic resume is refused, and the next run takes it', () => withDrained(['a4-blocker', 'a4-four', 'a4-six'], async ([blocker, four, six]) => {
  // The boot resumes in start order: a run of another project first, so run 4 waits its turn in the loop.
  const startedAt = getDb().prepare('UPDATE pipelines SET started_at = ? WHERE id = ?');
  [blocker, four, six].forEach((id, i) => startedAt.run(`2026-01-0${i + 1}T00:00:00.000Z`, id));
  const f = await markedFeature({ 4: four, 6: six });
  quietTickets();   // no tick of this test starts runs 2, 3 or 5
  let open;
  const gate = new Promise((r) => { open = r; });
  const atFour = [];
  const resume = async (pid, opts) => {
    if (pid === blocker) await gate;
    if (pid !== four) return { ok: true, runId: `stub-${pid}` };
    atFour.push({ due: heldStopTurn(f.id, 6, { live: _testing.liveSliceOf }).due, heldResumeOf: _testing.heldStops.heldResumeOf(six) });
    return _testing.resumeRun(pid, opts);
  };
  const sixEntry = () => [...runs.values()].find((e) => e.pipelineId === six) || null;
  await withEnv(ON, async () => {
    const boot = _testing.autoResumeOnBoot({ env: {}, mock: true, resume });
    try {
      assert.ok(_testing.bootResumingIds().includes(four), 'run 4 is marked as being resumed');
      assert.ok(_testing.heldStops.heldResumeOf(six), 'run 6 is held behind run 4');
      // Stop run 4 inside the window.
      await _testing.stopPausedPipeline(four);
      assert.equal(status(four), 'stopped');
      assert.ok(!_testing.bootResumingIds().includes(four), 'the stopped run is no longer marked as being resumed');
      assert.notEqual(_testing.liveSliceOf(four)?.resuming, true);
      await _testing.heldStops.deliver();
      assert.equal(_testing.heldStops.heldResumeOf(six), null, 'run 6 takes the turn');
      assert.ok(sixEntry(), 'run 6 was resumed');
      assert.notEqual(sixEntry().status, 'paused');
      open();
      const out = await boot;
      assert.match(out.failed.find((r) => r.pipelineId === four)?.error || '', /not resumable/);
      assert.deepEqual(atFour, [{ due: true, heldResumeOf: null }], 'the turn was free before the automatic resume of run 4 was refused');
    } finally {
      _testing.heldStops.dropResume(six);
      open();
      await boot;
      const e = sixEntry();
      if (e && !['done', 'stopped', 'error'].includes(String(e.status))) await request('POST', '/api/stop', { host: 'localhost', body: { runId: e.id } });
      quietTickets();
    }
  });
}));

test('A4 (R-qa-2): a refused stop in the boot window keeps the mark and the turn', () => withDrained(['a4-live-four', 'a4-live-six'], async ([four, six]) => {
  await markedFeature({ 4: four, 6: six });
  quietTickets();
  // A resume of run 4 that is already live: the stop of the paused run is refused.
  const entry = { id: 'a4-live', pipelineId: four, status: 'running', orch: { state: {} }, events: [], pendingQuestion: null };
  await withEnv(ON, async () => {
    try {
      _testing.markBootResumes(_testing.bootResumePicks({ env: {} }));
      assert.ok(_testing.bootResumingIds().includes(four));
      assert.deepEqual(_testing.heldStops.heldResumeOf(six), { after: 4 });
      runs.set(entry.id, entry);
      await assert.rejects(_testing.stopPausedPipeline(four), (e) => e.code === 'LIVE');
      assert.equal(status(four), 'paused');
      assert.ok(_testing.bootResumingIds().includes(four), 'the mark stays');
      await _testing.heldStops.deliver();
      assert.deepEqual(_testing.heldStops.heldResumeOf(six), { after: 4 }, 'run 6 still waits');
    } finally {
      runs.delete(entry.id);
      _testing.heldStops.dropResume(six);
      quietTickets();
    }
  });
}));

// ── B2: /api/drain is not for anyone on the network ─────────────────────────

test('POST /api/drain: refused from outside the container without the heartbeat token', async () => {
  assert.equal((await request('POST', '/api/drain')).status, 403);
  assert.equal((await request('POST', '/api/drain', { headers: { authorization: 'Bearer wrong' } })).status, 403);
  assert.equal(_testing.DRAIN.on, false, 'a refused call drains nothing');
});

// ── B2: the drain ────────────────────────────────────────────────────────────

/** A live entry whose fake harness pauses (for a drain) after a short unwind. */
function fakeRun(id, status = 'running') {
  const calls = [];
  const orch = {
    state: { status },
    pause() { calls.push('pause'); return false; },
    pauseForDrain() {
      if (orch.state.status !== 'running') return false;
      calls.push('drain');
      orch.state.status = 'pausing';
      setTimeout(() => { orch.state.status = 'paused'; }, 50);
      return true;
    },
  };
  runs.set(id, { id, pipelineId: `p-${id}`, orch, status, events: [], pendingQuestion: null });
  return { orch, calls };
}

test('POST /api/drain with the heartbeat token pauses every active run for a drain and waits for it', async () => {
  const a = fakeRun('drain-a');
  const b = fakeRun('drain-b');
  const starting = fakeRun('drain-c', 'starting');
  setTimeout(() => { starting.orch.state.status = 'running'; }, 100);   // paused once it is running
  const done = fakeRun('drain-d', 'done');
  const res = await request('POST', '/api/drain', { headers: { authorization: `Bearer ${HB}` } });
  assert.equal(res.status, 200);
  assert.equal(res.body.draining, true);
  assert.equal(res.body.remaining, 0);
  assert.ok(res.body.paused >= 3, `paused ${res.body.paused}`);
  for (const r of [a, b, starting]) {
    assert.deepEqual(r.calls, ['drain']);
    assert.equal(r.orch.state.status, 'paused');
  }
  assert.deepEqual(done.calls, []);
  assert.equal(runs.get('drain-a').status, 'pausing');
  // A second call (the SIGTERM after the platform's drain) joins the first.
  const again = await request('POST', '/api/drain', { host: 'localhost' });
  assert.equal(again.status, 200);
  assert.deepEqual(a.calls, ['drain']);
});

test('while draining, new runs, resumes and scheduled starts are refused with 503 draining', async () => {
  const run = await request('POST', '/api/run', { host: 'localhost', body: { projectDir: '/nope', prompt: 'x' } });
  assert.equal(run.status, 503);
  assert.equal(run.body.error, 'draining');
  const resume = await request('POST', '/api/resume', { host: 'localhost', body: { pipelineId: seeded.userPaused } });
  assert.equal(resume.status, 503);
  assert.equal(resume.body.error, 'draining');
  assert.equal(await schedulerTick(), null);
  const auto = await _testing.autoResumeOnBoot({ env: { WORCA_AUTO_RESUME: '1' }, mock: true });
  assert.equal(auto.resumed.length, 0, 'a draining server resumes nothing either');
  assert.deepEqual(_testing.bootResumingIds(), []);
});
