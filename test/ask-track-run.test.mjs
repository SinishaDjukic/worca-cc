// test/ask-track-run.test.mjs — askTrackRun (plan D5/D6/D22): link a run to a thread once per pipeline, follow a live one once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createThread, listRunLinks, listMessages, linkRun } from '../src/core/ask/store.mjs';   // lazy getDb(): safe after useTempHome()

useTempHome(after);                       // WORCA_HOME is a temp dir from here on; db.mjs opens lazily
let mod, srv;
const tmpDirs = [];
before(async () => {
  mod = await import('../ui/server.mjs');   // DYNAMIC: evaluated after useTempHome() ran (ask-api-cards.test.mjs:44)
  srv = mod.server;
});
after(async () => {
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  closeDbForTests();
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});
async function makeProjectDir() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-ask-track-')); tmpDirs.push(d); return d; }
/** A runs-Map entry the way ui-runs-live-id.test.mjs:31-43 builds one (a bare EventEmitter is a valid orch). */
function makeEntry(overrides = {}) {
  return { id: 'uuid-AAAA', orch: new EventEmitter(), projectDir: '/tmp/x', title: 't', status: 'starting', startedAt: new Date().toISOString(), events: [], pendingQuestion: null, ...overrides };
}

test('askTrackRun: a finished run links once under its pipeline id, returns the card identity, attaches no follower', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Old run', status: 'done', steps: [] });
  const t = createThread();
  const r1 = mod._testing.askTrackRun(t.id, { id }, null);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.card, { type: 'progress', pipelineId: id, runId: null, projectKey: projectKey(dir), workspaceId: null, title: 'Old run', label: basename(dir), status: 'done' });
  const links = listRunLinks(t.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].runId, id, 'no live UUID: the pipeline id keys the row (D5)');
  assert.equal(links[0].pipelineId, id);
  assert.equal(links[0].cardId, null);
  mod._testing.askTrackRun(t.id, { id }, null);
  assert.equal(listRunLinks(t.id).length, 1, 'idempotent per (thread, pipeline) — app-level: the PK is (thread, run_id) and linkRun throws on a collision');
  assert.equal(mod._testing.askFollowers.get(t.id), undefined);
});

test('askTrackRun: a live run links under its UUID, attaches ONE follower, and takes over a pipeline-keyed row', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Live', status: 'running', steps: [] });
  const t = createThread();
  mod._testing.askTrackRun(t.id, { id }, null);                         // tracked while nobody had it live
  const orch = new EventEmitter(); orch.state = {}; orch.getState = () => ({ ...orch.state });
  const entry = makeEntry({ id: 'uuid-LIVE', orch, pipelineId: id, status: 'running', projectDir: dir, title: 'Live' });
  mod.runs.set(entry.id, entry);
  try {
    const r = mod._testing.askTrackRun(t.id, { id: 'uuid-LIVE' }, null);
    assert.equal(r.ok, true);
    assert.equal(r.card.runId, 'uuid-LIVE');
    assert.equal(r.card.pipelineId, id);
    const links = listRunLinks(t.id);
    assert.equal(links.length, 1, 'the pipeline-keyed row was MOVED, not duplicated');
    assert.equal(links[0].runId, 'uuid-LIVE');
    assert.equal(mod._testing.askFollowers.get(t.id).size, 1);
    mod._testing.askTrackRun(t.id, { id }, null);
    assert.equal(mod._testing.askFollowers.get(t.id).size, 1, 'a second track never double-follows (D6)');
    // a null-cardId follower never flips a card: an error only posts the notice + the status frame, then detaches
    orch.emit('error', { message: 'boom' });
    assert.ok(listMessages(t.id).some((m) => /^Run failed: boom/.test(m.text)));
    assert.equal(mod._testing.askFollowers.get(t.id), undefined, 'detached on error');
    assert.equal(listRunLinks(t.id)[0].status, 'error');
  } finally { mod.runs.delete(entry.id); }
});

test('askTrackRun: unknown id → {ok:false}; a live entry without a pipeline id yet is reported; the pinned scope is tried first', async () => {
  const t = createThread();
  assert.deepEqual(mod._testing.askTrackRun(t.id, { id: 'zzzzzzzz' }, null), { ok: false, error: 'run not found' });
  assert.deepEqual(mod._testing.askTrackRun(t.id, {}, null), { ok: false, error: 'id is required' });
  const entry = makeEntry({ id: 'uuid-YOUNG', pipelineId: null, status: 'starting' });
  mod.runs.set(entry.id, entry);
  try { assert.equal(mod._testing.askTrackRun(t.id, { id: 'uuid-YOUNG' }, null).ok, false); } finally { mod.runs.delete(entry.id); }
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Scoped', status: 'done', steps: [] });
  assert.equal(mod._testing.askTrackRun(t.id, { id }, { projectKey: projectKey(dir) }).ok, true, 'pinned project scope resolves');
  assert.equal(mod._testing.askTrackRun(t.id, { id, projectKey: 'other-00000003' }, null).ok, true, 'a wrong explicit scope still falls back to the id-only lookup (get_run in the child already rejected a real mismatch)');
});

test('askTrackRun: an orphan proposal link (uuid row, pipeline id never filled) is adopted, never duplicated, never a throw', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Orphan', status: 'running', steps: [] });
  const t = createThread();
  linkRun(t.id, { runId: 'uuid-ORPHAN', cardId: 'card_00000009', status: 'running' });   // what POST /api/run inserts before the first state
  const entry = makeEntry({ id: 'uuid-ORPHAN', pipelineId: id, status: 'running', projectDir: dir, title: 'Orphan' });
  mod.runs.set(entry.id, entry);
  try {
    const r = mod._testing.askTrackRun(t.id, { id }, null);
    assert.equal(r.ok, true);
    const links = listRunLinks(t.id);
    assert.equal(links.length, 1, 'the uuid row is adopted, not duplicated (the PK is (thread, run_id))');
    assert.equal(links[0].pipelineId, id, 'and it learns its pipeline id');
    assert.equal(links[0].cardId, 'card_00000009', 'the proposal card keeps its link');
  } finally {
    for (const f of mod._testing.askFollowers.get(t.id) || []) f.detach();
    mod.runs.delete(entry.id);
  }
});

test('askTrackRun: a settled runs-Map entry links but is never followed (a finished orchestrator emits nothing again)', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Settled', status: 'done', steps: [] });
  const t = createThread();
  const entry = makeEntry({ id: 'uuid-SETTLED', pipelineId: id, status: 'done', projectDir: dir, title: 'Settled' });
  mod.runs.set(entry.id, entry);
  try {
    const r = mod._testing.askTrackRun(t.id, { id }, null);
    assert.equal(r.ok, true);
    assert.equal(r.card.runId, 'uuid-SETTLED', 'the entry still names the lineage the card opens');
    assert.equal(listRunLinks(t.id).length, 1);
    assert.equal(mod._testing.askFollowers.get(t.id), undefined, 'no zombie follower on a settled entry the server never prunes');
    assert.equal(entry.orch.listenerCount('done'), 0);
  } finally {
    for (const f of mod._testing.askFollowers.get(t.id) || []) f.detach();
    mod.runs.delete(entry.id);
  }
});

test('askTrackRun: an uppercase or dir-name id finds the LIVE entry, not just the row (the DB lookup canonicalises, the Map scan does not)', async () => {
  const dir = await makeProjectDir();
  const { id } = await seedPipeline(dir, { title: 'Canon', status: 'running', steps: [] });
  const t = createThread();
  const entry = makeEntry({ id: 'uuid-CANON', pipelineId: id, status: 'running', projectDir: dir, title: 'Canon' });
  mod.runs.set(entry.id, entry);
  try {
    const r = mod._testing.askTrackRun(t.id, { id: id.toUpperCase() }, null);
    assert.equal(r.ok, true);
    assert.equal(r.card.pipelineId, id);
    assert.equal(r.card.runId, 'uuid-CANON', 'an uppercase id must not fall back to the pipeline-id sentinel while the run is live');
    assert.equal(listRunLinks(t.id)[0].runId, 'uuid-CANON', 'the row is keyed by the live UUID (D5)');
    assert.equal(mod._testing.askFollowers.get(t.id).size, 1, 'and the live run is followed');
  } finally {
    for (const f of mod._testing.askFollowers.get(t.id) || []) f.detach();
    mod.runs.delete(entry.id);
  }
});
