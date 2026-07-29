// test/history-reconcile-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs } from '../ui/server.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

let srv, base, home, prevHome;
const KEY = 'beta-00000002';
const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago -> stale (> 30 min)

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-hist-recon-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  writeStoreMeta(KEY, 'project', { key: KEY, name: 'Beta', path: '/repo/beta' });
  // A stale running row (no branch -> no git calls on delete).
  seedPipelineRow({ id: 'pp', projectKey: KEY, title: 'Stuck', status: 'running',
                    startedAt: OLD, updatedAt: OLD });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear(); _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

test('GET /api/history reconciles a stale running row to interrupted', async () => {
  const res = await fetch(`${base}/api/history`);
  assert.equal(res.status, 200);
  const { pipelines } = await res.json();
  const row = pipelines.find((p) => p.id === 'pp');
  assert.ok(row, 'the seeded row is listed');
  assert.equal(row.status, 'interrupted'); // was 'running'
});

test('the reconciled record is now deletable (200, not 409)', async () => {
  // Self-contained: trigger the reconcile here too (idempotent) so this test passes
  // even if run in isolation, then delete.
  await fetch(`${base}/api/history`);
  const res = await fetch(`${base}/api/runs/pp?projectKey=${KEY}`, { method: 'DELETE' });
  assert.equal(res.status, 200); // previously 409 RUNNING
});
