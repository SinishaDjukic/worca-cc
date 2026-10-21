// test/server-drain.test.mjs
// B2 graceful drain and B3 auto-resume (src/core/drain.mjs, ui/server.mjs). The server runs in
// remote mode with no identity check (WORCA_INSECURE_NO_IDENTITY_CHECK) so a request with the
// public Host is "from outside the container" for /api/drain. A drain is one-way per process, so
// the tests run in order: the pure helpers, auto-resume, the /api/drain gate, then the drain.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
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
  srv = http.createServer(mod.app);
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
});

test('with no WORCA_AUTO_RESUME a start resumes the drained run only, never the interrupted one', async () => {
  const drained2 = await resumable('drained2', { pauseReason: 'drain' });
  const crashed2 = await resumable('crashed2', { status: 'interrupted' });
  const out = await _testing.autoResumeOnBoot({ interruptedIds: [crashed2], env: {}, mock: true });
  assert.deepEqual(out.resumed.map((r) => [r.pipelineId, r.why]), [[drained2, 'drain']]);
  assert.equal(status(crashed2), 'interrupted');
  assert.equal(status(seeded.userPaused), 'paused');
  assert.equal(status(seeded.costPaused), 'paused');
});

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
});
