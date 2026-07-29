// test/counts-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { countPipelines } from '../src/core/artifacts.mjs';

let srv, base, homeDir, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-counts-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
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

test('GET /api/counts: zero on a fresh home', async () => {
  const r = await fetch(`${base}/api/counts`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { pipelines: 0, projects: 0, workspaces: 0 });
});

test('GET /api/counts: projects count tracks create + delete', async () => {
  await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'demo', path: homeDir }),
  });
  let r = await fetch(`${base}/api/counts`);
  assert.equal((await r.json()).projects, 1);

  await fetch(`${base}/api/projects?name=${encodeURIComponent('demo')}`, { method: 'DELETE' });
  r = await fetch(`${base}/api/counts`);
  assert.equal((await r.json()).projects, 0);
});

// Core unit test for countPipelines. seedPipeline's first arg is a PROJECT DIR (only its
// projectKey is used); countPipelines is a global COUNT(*), so the key is irrelevant here.
// Assert RELATIVE to a baseline so this test is independent of any rows other tests left.
test('countPipelines() reflects newly-seeded rows (all statuses count)', async () => {
  const baseline = countPipelines();
  await seedPipeline(homeDir, { title: 'one', status: 'done' });
  await seedPipeline(homeDir, { title: 'two', status: 'running' });
  assert.equal(countPipelines(), baseline + 2);
  let r = await fetch(`${base}/api/counts`);
  assert.equal((await r.json()).pipelines, baseline + 2); // endpoint agrees with the helper
});
