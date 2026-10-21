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
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { app, runs, server, _testing } from '../ui/server.mjs';
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

// A paused pipeline's entry stays in `runs` (the live guard lets it through), so the run page keeps
// drawing its bar from it. The archive marks it: hello carries archivedAt and the open tabs get a
// buffered `archived` frame, so they stop offering Models the server answers 409 ARCHIVED to.
test('archiving a paused run marks its lingering entry: hello carries archivedAt, open tabs get an archived frame', async () => {
  const { id } = await seedPipeline(seededProjectDir, { status: 'paused' });
  const entry = { id: 'uuid-arch-paused', orch: new EventEmitter(), pipelineId: id, projectDir: seededProjectDir,
    title: 't', status: 'paused', startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
  runs.set(entry.id, entry);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  try {
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(String(d))));
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const res = await del(id);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).archived, true);
    for (let i = 0; i < 100 && !frames.some((f) => f.type === 'archived'); i++) await new Promise((r) => setTimeout(r, 10));
    const frame = frames.find((f) => f.type === 'archived');
    assert.ok(frame, 'the open tabs hear about it');
    assert.equal(frame.runId, entry.id);
    assert.ok(typeof frame.archivedAt === 'string' && frame.archivedAt, 'it carries the archive time');
    assert.equal(entry.archivedAt, frame.archivedAt, 'the entry is marked');
    assert.equal(entry.events.at(-1).type, 'archived', 'buffered, so a reconnect replays it');
    const summary = _testing.summarizeRuns().find((r) => r.runId === entry.id);
    assert.equal(summary.archivedAt, frame.archivedAt, 'hello carries the mark');
  } finally {
    ws.close();
    await new Promise((r) => server.close(r));
    runs.delete(entry.id);
  }
});
