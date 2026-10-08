// test/server-resume-engine.test.mjs
// A UI-triggered /api/resume should come back on the run's SAVED engine (and its
// saved unguarded-engine consent), with the server itself naming no engine — the
// constructor restore (src/core/run-harness.mjs) does all the work; this is its
// own process so it does not share server-pause-resume.test.mjs's `runs` Map.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';

let homeDir, srv, base, prevHome, app, runs;
let projC, liveWt;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-resumeengine-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();

  projC = await mkdtemp(join(tmpdir(), 'worca-cc-resumeengine-projC-'));
  liveWt = await mkdtemp(join(tmpdir(), 'worca-cc-resumeengine-livewt-'));
  await addProject({ name: 'resumeengine-projC', path: projC });

  const mod = await import('../ui/server.mjs');
  ({ app, runs } = mod);
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (liveWt) await rm(liveWt, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function post(path, body) {
  return fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function untilSettled(runId, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = runs.get(runId)?.status;
    if (st && st !== 'running' && st !== 'pausing') return st;
    await new Promise((r) => setTimeout(r, 25));
  }
  return runs.get(runId)?.status;
}

test('a resume from the UI comes back on the run\'s saved engine, with its consent', async () => {
  const resumePoint = graphResumePoint({ pipelineDir: projC, claude: { engine: 'codex', allowUnguardedEngine: true } });
  const { id } = await seedPipeline(projC, {
    title: 'resumable codex run', status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: liveWt, reusedExisting: false },
    resumePoint,
  });
  const r = await post('/api/resume', { pipelineId: id, mock: true });
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  const o = runs.get(out.runId).orch;
  assert.equal(o.claude.engine, 'codex');
  assert.equal(o._allowUnguardedEngine, true);
  assert.equal('engine' in o.opts.claude, false, 'the server names no engine; the point does');
  await untilSettled(out.runId);
});

async function seedPaused(title, claude, extra = {}) {
  const resumePoint = graphResumePoint({ pipelineDir: projC, ...(claude ? { claude } : {}), ...extra });
  return seedPipeline(projC, {
    title, status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: liveWt, reusedExisting: false },
    resumePoint,
  });
}

test('"Resume on Claude" of a Codex run names Claude, so the saved engine does not win', async () => {
  const { id } = await seedPaused('codex run to claude', { engine: 'codex', allowUnguardedEngine: true });
  const r = await post('/api/resume', { pipelineId: id, mock: true, engine: 'claude' });
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  const o = runs.get(out.runId).orch;
  assert.equal(o.opts.claude.engine, 'claude', 'Claude is passed explicitly');
  assert.equal(o.claude.engine, 'claude');
  assert.equal(o._allowUnguardedEngine, false, 'the codex consent does not follow the run to another engine');
  await untilSettled(out.runId);
});

test('a refused switch answers 409 before anything resumes; the consent re-send goes through', async () => {
  const { id } = await seedPaused('claude run to codex', null, { guardrailsId: 'normal' });
  const before = runs.size;
  const r = await post('/api/resume', { pipelineId: id, mock: true, engine: 'codex' });
  const data = await r.json();
  assert.equal(r.status, 409, JSON.stringify(data));
  assert.equal(data.code, 'engine-refused');
  assert.equal(data.overridable, true);
  assert.match(data.error, /^engine codex: guardrail set "normal" has permission rules this engine cannot enforce/);
  assert.doesNotMatch(data.error, /--allow-unguarded-engine/, 'worded for the UI');
  assert.equal(runs.size, before, 'no run entry is left behind');
  const { readPipelineForResume } = await import('../src/core/artifacts.mjs');
  assert.equal(readPipelineForResume(id).row.status, 'paused', 'the run stays paused');

  const r2 = await post('/api/resume', { pipelineId: id, mock: true, engine: 'codex', allowUnguardedEngine: true });
  const out = await r2.json();
  assert.equal(r2.status, 200, JSON.stringify(out));
  const o = runs.get(out.runId).orch;
  assert.equal(o.claude.engine, 'codex');
  assert.equal(o._allowUnguardedEngine, true);
  await untilSettled(out.runId);
});

test('a bad engine or consent is a 400', async () => {
  const { id } = await seedPaused('bad engine body', null);
  for (const [body, re] of [[{ engine: 'codx' }, /unknown engine "codx"/], [{ engine: 'mock' }, /"mock" is not a run engine/], [{ engine: 42 }, /engine must be a string/], [{ allowUnguardedEngine: 'yes' }, /allowUnguardedEngine must be true or false/]]) {
    const r = await post('/api/resume', { pipelineId: id, mock: true, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match((await r.json()).error, re);
  }
});
