// test/server-pause-resume.test.mjs
// Endpoint guards only (no live claude): unknown ids 400/404, wrong-status 400,
// paused row with a missing worktree -> 400 with a clear error. Harness mirrors
// test/history-api.test.mjs (env BEFORE the dynamic server import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let homeDir, srv, base, prevHome, doneId, pausedNoWtId;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();

  const projA = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projA-'));
  ({ id: doneId } = await seedPipeline(projA, { title: 'done run', status: 'done' }));

  const projB = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-projB-'));
  const goneWt = await mkdtemp(join(tmpdir(), 'worca-cc-pauseapi-wt-'));
  await rm(goneWt, { recursive: true, force: true }); // worktree no longer exists
  ({ id: pausedNoWtId } = await seedPipeline(projB, {
    title: 'paused run', status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: goneWt, reusedExisting: false },
    resumePoint: { version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
      bus: null, stepModels: null, workflowId: 'wf_default', plan: null, nodes: [], gate: null,
      pipelineDir: projB, pausedAt: '2026-06-09T00:00:00Z' },
  }));

  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

function post(path, body) {
  return fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('POST /api/pause: unknown runId -> 400', async () => {
  const res = await post('/api/pause', { runId: 'nope' });
  assert.equal(res.status, 400);
});

test('POST /api/resume: unknown pipelineId -> 404', async () => {
  const res = await post('/api/resume', { pipelineId: 'pl_missing' });
  assert.equal(res.status, 404);
});

test('POST /api/resume: non-paused pipeline -> 400', async () => {
  const res = await post('/api/resume', { pipelineId: doneId });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not resumable/i);
});

test('POST /api/resume: paused row with missing worktree -> 400', async () => {
  const res = await post('/api/resume', { pipelineId: pausedNoWtId });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /worktree/i);
});
