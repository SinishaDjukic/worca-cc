// test/archive-api.test.mjs
// REST-contract regression lock for DELETE /api/runs/:id after it became an
// ARCHIVE (soft delete). The route keeps its status codes (409 live, 404 unknown)
// and its `{ ok: true, ...report }` body — what changes is that the pipelines row
// SURVIVES with archived_at stamped, and the archived run disappears from the
// history read. No settings sandbox here: this path never resolves settingsFile()
// (resolveProjectDir -> normalizeProjectPath is pure, and worcaHome() short-circuits
// on WORCA_HOME), so redirecting HOME would buy nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs } from '../ui/server.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let srv, base, home, prevHome, seededProjectDir;

const del = (id) => fetch(
  `${base}/api/runs/${id}?projectDir=${encodeURIComponent(seededProjectDir)}`, { method: 'DELETE' });

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-archive-api-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home; // store.mjs appends '.worca-cc'
  _resetForTests();                                                 // DB singleton opens under this home
  // Any real directory works as a seed target: only its projectKey is used, and
  // the route never consults the projects registry.
  seededProjectDir = await mkdtemp(join(tmpdir(), 'worca-cc-archive-proj-'));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  if (seededProjectDir) await rm(seededProjectDir, { recursive: true, force: true });
});

test('DELETE /api/runs/:id archives: 200 {archived:true}, row survives, history omits it', async () => {
  const { id } = await seedPipeline(seededProjectDir, { status: 'done' });
  const res = await del(id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.archived, true);
  assert.ok(getDb().prepare('SELECT id FROM pipelines WHERE id = ?').get(id), 'row survives');
  const hist = await (await fetch(`${base}/api/history`)).json();
  assert.ok(!JSON.stringify(hist).includes(id), 'history omits archived');
});

test('DELETE guards unchanged: 409 while live in this process', async () => {
  const { id } = await seedPipeline(seededProjectDir, { status: 'done' });
  runs.set('uuid-live', { id: 'uuid-live', pipelineId: id, status: 'running' });
  try {
    assert.equal((await del(id)).status, 409);
  } finally {
    runs.clear();
  }
});

test('DELETE guards unchanged: 404 unknown', async () => {
  const res = await del('nope');
  assert.equal(res.status, 404);
});
