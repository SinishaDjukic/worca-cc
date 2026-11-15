// test/ask-api-runs.test.mjs — GET /api/ask/runs/:id (plan D9): one run's detail state by pipeline id or live run id, no store key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { _resetForTests as closeDbForTests, getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);                       // WORCA_HOME is a temp dir from here on; db.mjs opens lazily
let mod, srv, base;
const tmpDirs = [];
before(async () => {
  mod = await import('../ui/server.mjs');   // DYNAMIC: evaluated after useTempHome() ran (ask-api-cards.test.mjs:44)
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  closeDbForTests();
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});
async function makeProjectDir() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-ask-runs-')); tmpDirs.push(d); return d; }
/** A runs-Map entry the way ui-runs-live-id.test.mjs:31-43 builds one (a bare EventEmitter is a valid orch). */
function makeEntry(overrides = {}) {
  return { id: 'uuid-AAAA', orch: new EventEmitter(), projectDir: '/tmp/x', title: 't', status: 'starting', startedAt: new Date().toISOString(), events: [], pendingQuestion: null, ...overrides };
}

test('GET /api/ask/runs/:id: a finished pipeline by id alone, 404 for an unknown one, 400 for a bad id', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Seeded', status: 'done', totalCostUsd: 1.5, totalActiveMs: 120000, steps: [] });
  const r = await fetch(`${base}/api/ask/runs/${id}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.state.id, id);
  assert.equal(body.state.status, 'done');
  assert.equal(body.state.projectKey, projectKey(dir));
  assert.equal(body.state.totalCostUsd, 1.5);
  assert.equal(body.state.totalActiveMs, 120000);
  assert.ok(Array.isArray(body.state.steps));
  assert.equal(body.live, null);
  assert.equal((await fetch(`${base}/api/ask/runs/00000000`)).status, 404);
  assert.equal((await fetch(`${base}/api/ask/runs/x`)).status, 400, 'neither 8 hex nor a run-id shape');
});

test('GET /api/ask/runs/:id: a soft-deleted pipeline answers 404, so the chat card reads "This run was deleted"', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Gone', status: 'done', steps: [] });
  getDb().prepare('UPDATE pipelines SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  assert.equal((await fetch(`${base}/api/ask/runs/${id}`)).status, 404);
});

test('GET /api/ask/runs/:id: a live runId or pipeline id resolves through the runs Map and reports the live entry', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Live', status: 'running', steps: [] });
  // D23: a same-pipeline entry left settled by an earlier lineage (resumeRun evicts only paused/interrupted) sits
  // EARLIER in Map order — the entry still driving the pipeline must win.
  const stale = makeEntry({ id: 'uuid-STALE', pipelineId: id, status: 'error' });
  const entry = makeEntry({ id: 'uuid-LIVE', pipelineId: id, status: 'running' });
  mod.runs.set(stale.id, stale);
  mod.runs.set(entry.id, entry);
  try {
    for (const key of ['uuid-LIVE', id]) {
      const body = await (await fetch(`${base}/api/ask/runs/${key}`)).json();
      assert.equal(body.state.id, id);
      assert.deepEqual(body.live, { runId: 'uuid-LIVE', status: 'running' }, `${key}: the live lineage, not the settled twin inserted first`);
    }
  } finally { mod.runs.delete(entry.id); mod.runs.delete(stale.id); }
});

// ── GET /api/ask/run-links: the run → chat lookup (Stillhet Chat, D7) ──────────────────────────────────────────────
// Only POST /api/run with askCardId links a run WITH its card (`started`); track_run links without one. linkRun is that
// write, so the cases seed it directly and read it back through the store and the route.
test('runLinksForViewer: started only with a card, oldest first, kept on resume and archive, gone with the thread, owner-scoped', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const mine = store.createThread({ createdBy: 'ana' });
  const follower = store.createThread({ createdBy: 'ana' });
  const theirs = store.createThread({ createdBy: 'bo' });
  const legacy = store.createThread({});
  const gone = store.createThread({ createdBy: 'ana' });
  store.linkRun(mine.id, { runId: 'run-first', pipelineId: 'aaaaaaa1', cardId: 'card-1' });
  await new Promise((r) => setTimeout(r, 5));
  store.linkRun(follower.id, { runId: 'run-first', pipelineId: 'aaaaaaa1' });
  store.linkRun(mine.id, { runId: 'run-second', pipelineId: 'aaaaaaa2', cardId: 'card-2' });
  store.linkRun(theirs.id, { runId: 'run-theirs', pipelineId: 'aaaaaaa3', cardId: 'card-3' });
  store.linkRun(legacy.id, { runId: 'run-legacy', pipelineId: 'aaaaaaa4', cardId: 'card-4' });
  store.linkRun(gone.id, { runId: 'run-gone', pipelineId: 'aaaaaaa5', cardId: 'card-5' });
  // a resume moves the link to the new run id; it stays started
  store.updateRunLink(mine.id, 'run-second', { runId: 'run-second-resumed' });
  store.setArchived(mine.id, true);
  store.deleteThread(gone.id);

  const ana = store.runLinksForViewer({ visibleTo: 'ana' });
  const mineRows = ana.filter((l) => l.threadId === mine.id);
  assert.deepEqual(mineRows, [
    { threadId: mine.id, runId: 'run-first', pipelineId: 'aaaaaaa1', started: true },
    { threadId: mine.id, runId: 'run-second-resumed', pipelineId: 'aaaaaaa2', started: true },
  ], 'oldest first, the resumed id kept as started, an archived thread kept');
  assert.deepEqual(ana.find((l) => l.threadId === follower.id), { threadId: follower.id, runId: 'run-first', pipelineId: 'aaaaaaa1', started: false });
  assert.ok(ana.some((l) => l.threadId === legacy.id), 'an ownerless legacy thread is visible to everyone');
  assert.ok(!ana.some((l) => l.threadId === theirs.id), "another viewer's thread is left out");
  assert.ok(!ana.some((l) => l.threadId === gone.id), "a deleted thread's links are gone");
  const all = store.runLinksForViewer();
  assert.ok(all.some((l) => l.threadId === theirs.id), 'no viewer (a local deployment): every thread');

  const r = await fetch(`${base}/api/ask/run-links`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.links));
  assert.deepEqual(body.links.filter((l) => l.threadId === mine.id).map((l) => l.runId), ['run-first', 'run-second-resumed']);

  // the route scopes by the request's own viewer: a signed-in 'ana' never gets 'bo''s link
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-User';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1';
  try {
    const asAna = await (await fetch(`${base}/api/ask/run-links`, { headers: { 'x-forwarded-user': 'ana' } })).json();
    assert.ok(asAna.links.some((l) => l.threadId === mine.id), "ana's own link");
    assert.ok(!asAna.links.some((l) => l.threadId === theirs.id), "bo's link is left out");
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});
