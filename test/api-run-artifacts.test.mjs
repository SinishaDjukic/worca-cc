// test/api-run-artifacts.test.mjs
// The plural run-artifacts list route: GET /api/runs/:id/artifacts returns the
// run's indexed artifacts with step attribution + byte size. Server idiom mirrors
// test/api-run-artifact.test.mjs (WORCA_HOME set BEFORE importing ui/server.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let homeDir, srv, base, prevHome, proj, id, dir;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-run-artifacts-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-run-artifacts-proj-'));
  ({ id, dir } = await seedPipeline(proj, { title: 'A', status: 'done' }));
  await writeFile(join(dir, 'plan.md'), 'hi', 'utf8');
  recordArtifact(id, 'plan', 'plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
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
  await rm(proj, { recursive: true, force: true });
});

test('GET /api/runs/:id/artifacts lists attributed artifacts', async () => {
  const res = await fetch(`${base}/api/runs/${id}/artifacts`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.runId, id);
  assert.ok(Array.isArray(body.artifacts));
  const plan = body.artifacts.find((a) => a.relPath === 'plan.md');
  assert.ok(plan, 'plan.md artifact present');
  assert.equal(plan.stepKey, 'exec-1');
  assert.equal(plan.nodeId, 'planner');
  assert.equal(plan.cycle, 0);
  assert.equal(plan.bytes, 2);
});

test('GET /api/runs/:id/artifacts 404s an unknown run', async () => {
  const res = await fetch(`${base}/api/runs/00000000/artifacts`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'pipeline not found' });
});
