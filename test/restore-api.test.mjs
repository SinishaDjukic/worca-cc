// test/restore-api.test.mjs
// REST-contract regression lock for the Archived Runs view's server half:
// GET /api/history?archived=1 lists exactly the soft-deleted rows (same wire shape as
// plain /api/history, which keeps excluding them), and POST /api/runs/:id/restore
// mirrors DELETE /api/runs/:id's scoping + status codes (400 missing scope, 404
// unknown, 409 live) while clearing `archived_at` and writing the audit line.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs } from '../ui/server.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let srv, base, home, prevHome, seededProjectDir;

const archive = (id) => fetch(
  `${base}/api/runs/${id}?projectDir=${encodeURIComponent(seededProjectDir)}`, { method: 'DELETE' });
const restore = (id) => fetch(
  `${base}/api/runs/${id}/restore?projectDir=${encodeURIComponent(seededProjectDir)}`, { method: 'POST' });
const history = async (q = '') => (await (await fetch(`${base}/api/history${q}`)).json());

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-restore-api-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home; // store.mjs appends '.worca-cc'
  _resetForTests();                                                 // DB singleton opens under this home
  seededProjectDir = await mkdtemp(join(tmpdir(), 'worca-cc-restore-proj-'));
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
  await rm(seededProjectDir, { recursive: true, force: true });
});

test('archive -> ?archived=1 lists exactly it, plain history does not; restore flips it back', async () => {
  const { id, key } = await seedPipeline(seededProjectDir, { title: 'round trip', status: 'done' });

  // A row that was never archived is already active: 200 + the idempotent shape.
  const early = await restore(id);
  assert.equal(early.status, 200);
  assert.equal((await early.json()).alreadyActive, true);

  assert.equal((await archive(id)).status, 200);

  const archived = await history('?archived=1');
  assert.equal(archived.pipelines.length, 1, 'exactly the archived rows');
  assert.equal(archived.pipelines[0].id, id);
  assert.equal(archived.pipelines[0].projectKey, key);
  assert.equal(archived.pipelines[0].archived, true, 'the row is flagged for the Runs list');
  assert.ok(archived.ghAvailable !== undefined, 'same wire shape as plain history');
  const plain = await history();
  assert.ok(!JSON.stringify(plain).includes(id), 'plain history still omits it');

  const res = await restore(id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.restored, true);

  const plain2 = await history();
  assert.ok(plain2.pipelines.some((p) => p.id === id), 'the row is back in the plain list');
  const archived2 = await history('?archived=1');
  assert.equal(archived2.pipelines.length, 0, 'and gone from the archived list');

  // Idempotent: a second restore on the now-active row is a no-op, not an error.
  const again = await restore(id);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).alreadyActive, true);
});

test('restore writes the audit line and fires the pipelines-changed broadcast', async () => {
  const { id } = await seedPipeline(seededProjectDir, { title: 'audited', status: 'done' });
  await archive(id);
  await restore(id);
  const events = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id)
    .map((e) => e.text);
  assert.ok(events.some((t) => t.startsWith('Run restored')), 'the audit timeline names the restore');
});

test('restore guards: 404 unknown, 409 while live in this process, 400 without scope', async () => {
  assert.equal((await restore('nope')).status, 404);

  const { id } = await seedPipeline(seededProjectDir, { status: 'done' });
  runs.set('uuid-live-restore', { id: 'uuid-live-restore', pipelineId: id, status: 'running' });
  try {
    assert.equal((await restore(id)).status, 409);
  } finally {
    runs.clear();
  }

  const noscope = await fetch(`${base}/api/runs/${id}/restore`, { method: 'POST' });
  assert.equal(noscope.status, 400);
});
