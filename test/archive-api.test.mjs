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

// The race behind dev CI's intermittent ENOTEMPTY (api-attribution-audit "PR created and run archived"): a run's
// entry reads `stopped` / `done` BEFORE the harness's teardown finishes, and that teardown still writes into the run
// folder (the run.json ledger copy, the last live-log flush). An Archive that lands in that window raced the writer:
// `rm -r` failed with ENOTEMPTY, or the writer recreated files in a folder already reported gone. While the entry has
// not settled (isFinishingRun), the single and the bulk Archive / Delete refuse; once it settles they go through.
test('Archive and Delete refuse a run whose teardown is still writing into its folder, then take it once it settles', async () => {
  const { existsSync } = await import('node:fs');
  const { writeFile } = await import('node:fs/promises');
  const { id, dir } = await seedPipeline(seededProjectDir, { status: 'stopped' });
  const entry = { id: 'r-finishing', pipelineId: id, status: 'stopped', title: 'Finishing run', settled: false, orch: { stop() {} } };
  runs.set(entry.id, entry);
  try {
    const res = await del(id);
    assert.equal(res.status, 409, 'refused while the teardown runs');
    assert.match((await res.json()).error, /finishing/);
    assert.ok(existsSync(dir), 'the run folder is untouched');
    assert.equal(getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(id).archived_at, null);
    const post = (action) => fetch(`${base}/api/runs/bulk`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, targets: [{ pipelineId: id }] }) }).then((r) => r.json());
    for (const action of ['archive', 'delete']) {
      const b = await post(action);
      assert.deepEqual(b.done, [], `bulk ${action} takes nothing while the teardown runs`);
      assert.ok(existsSync(dir), `bulk ${action} leaves the run folder`);
    }
    // The teardown's late write lands, then the launch promise settles (the .finally at each launch site).
    await writeFile(join(dir, 'run.json'), '{}\n');
    entry.settled = true;
    const ok = await del(id);
    assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
    assert.equal((await ok.json()).archived, true);
    assert.ok(!existsSync(dir), 'the whole run folder is gone');
  } finally { runs.delete(entry.id); }
});
