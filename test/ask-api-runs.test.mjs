// test/ask-api-runs.test.mjs — GET /api/ask/runs/:id (plan D9): one run's detail state by pipeline id or live run id, no store key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
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
