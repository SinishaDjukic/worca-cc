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
import { appServer } from './helpers/app-server.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs, STOPS_IN_FLIGHT } from '../ui/server.mjs';
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
  srv = appServer(app);
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

test('DELETE /api/runs/:id waits for a stopped run\'s teardown before it removes the run dir', async () => {
  // The harness persists `stopped` and emits done BEFORE its finally: teardown then copies run.json into the
  // run dir and flushes live-log.ndjson there. An archive in that window raced it (ENOTEMPTY on CI, or a run
  // dir re-created after the archive). This entry stands in for that run: terminal status, launch not settled.
  const { id, dir } = await seedPipeline(seededProjectDir, { status: 'stopped' });
  const entry = { id: 'run-finishing', pipelineId: id, status: 'stopped', settled: false };
  let wrote = false;
  entry.launch = new Promise((r) => setTimeout(r, 300))
    .then(async () => { await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'run.json'), '{}'); wrote = true; })
    .finally(() => { entry.settled = true; });
  runs.set(entry.id, entry);
  try {
    const res = await del(id);
    assert.equal(res.status, 200, JSON.stringify(await res.json()));
    assert.ok(wrote, 'the archive answered only after the teardown wrote its last file');
    assert.equal(existsSync(dir), false, 'the run dir is gone, not re-created by the teardown');
  } finally { runs.delete(entry.id); }
});

test('DELETE /api/runs/:id waits for a paused run\'s stop in flight', async () => {
  // A paused run's entry settled long ago; its stop (STOPS_IN_FLIGHT) is what still commits and writes the run dir.
  const { id, dir } = await seedPipeline(seededProjectDir, { status: 'stopped' });
  let wrote = false;
  const stop = new Promise((r) => setTimeout(r, 300))
    .then(async () => { await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'run.json'), '{}'); wrote = true; });
  STOPS_IN_FLIGHT.set(id, stop);
  stop.finally(() => STOPS_IN_FLIGHT.delete(id));
  const res = await del(id);
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  assert.ok(wrote, 'the archive answered only after the stop finished');
  assert.equal(existsSync(dir), false);
});
