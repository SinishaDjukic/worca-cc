// test/artifacts-duration.test.mjs
// Phase 3.6 — listPipelines reads totalActiveMs from the pipelines row; a 0 row
// total falls back to the per-step SUM/COUNT(active_ms). Fixtures seed DB rows via
// the production writers (seedPipeline -> createPipeline + writeState). Cases:
// explicit total -> verbatim; 0 total + step activeMs -> SUM; no steps (no timing
// anywhere) -> null (blank chip rather than a misleading 0s). The three seeds share
// ONE home, each in its own project; look each up by the RETURNED id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPipelines, readPipelineStateById, rowElapsedMs, writeState } from '../src/core/artifacts.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let home;
async function freshProj() {
  if (!home) {
    home = await mkdtemp(join(tmpdir(), 'worca-cc-dur-home-'));
    process.env.WORCA_HOME = home;
    _resetForTests();
  }
  return mkdtemp(join(tmpdir(), 'worca-cc-'));
}

test('listPipelines totalActiveMs: row total verbatim, step-sum fallback, null without timing', async () => {
  await checkRows([
    { name: 'listPipelines surfaces totalActiveMs from the persisted row total', run: async () => {
      const proj = await freshProj();
      const { id } = await seedPipeline(proj, {
        title: 'x', status: 'done',
        startedAt: '2026-06-01T00:00:00.000Z', totalActiveMs: 4200,
        steps: [{ key: 'plan', phase: 'plan', activeMs: 4200, runningSince: null }],
      });
      const list = await listPipelines(proj);
      assert.equal(list.find((p) => p.id === id).totalActiveMs, 4200);
    } },
    { name: 'totalActiveMs falls back to summing steps when the row total is 0', run: async () => {
      const proj = await freshProj();
      const { id } = await seedPipeline(proj, {
        title: 'y', status: 'done', startedAt: '2026-06-01T00:00:00Z',
        steps: [{ key: 'plan', activeMs: 1000 }, { key: 'refine#1', activeMs: 2000 }],
      });
      const list = await listPipelines(proj);
      assert.equal(list.find((p) => p.id === id).totalActiveMs, 3000);
    } },
    { name: 'totalActiveMs is null for a pre-timer run with no timing data', run: async () => {
      const proj = await freshProj();
      // No steps at all -> COUNT(active_ms)=0 -> null display.
      const { id } = await seedPipeline(proj, {
        title: 'z', status: 'done', startedAt: '2026-06-01T00:00:00Z', steps: [],
      });
      const list = await listPipelines(proj);
      assert.equal(list.find((p) => p.id === id).totalActiveMs, null);
    } },
  ]);
});

// ── The run clock columns: elapsed_ms (folded) + elapsed_since (anchor, NULL = parked or no figure) ──
const rawClock = (id) => getDb().prepare('SELECT elapsed_ms, elapsed_since FROM pipelines WHERE id = ?').get(id);

test('writeState round-trips elapsedMs and elapsedSince', async () => {
  const proj = await freshProj();
  const { id, dir, key } = await seedPipeline(proj, {
    title: 'clock', status: 'running', startedAt: '2026-06-01T00:00:00.000Z',
    totalActiveMs: 9000, elapsedMs: 4200.4, elapsedSince: 1_780_000_000_000,
  });
  assert.deepEqual({ ...rawClock(id) }, { elapsed_ms: 4200, elapsed_since: 1_780_000_000_000 });
  // The run ends: the figure moves and a null anchor clears the stored one.
  await writeState(dir, { projectKey: key, id, status: 'done', totalActiveMs: 9000, elapsedMs: 6000, elapsedSince: null });
  assert.deepEqual({ ...rawClock(id) }, { elapsed_ms: 6000, elapsed_since: null });
  assert.equal(readPipelineStateById(id).elapsedMs, 6000);
  assert.equal('elapsedSince' in readPipelineStateById(id), false, 'a saved state never ticks');
  assert.equal((await listPipelines(proj)).find((p) => p.id === id).elapsedMs, 6000);
});

test('a writer without the elapsed figure keeps the stored one', async () => {
  const proj = await freshProj();
  const { id, dir, key } = await seedPipeline(proj, {
    title: 'kept', status: 'running', startedAt: '2026-06-01T00:00:00.000Z', elapsedMs: 5000, elapsedSince: 1_780_000_000_000,
  });
  await writeState(dir, { projectKey: key, id, status: 'running', totalActiveMs: 100 });   // a partial writer
  assert.deepEqual({ ...rawClock(id) }, { elapsed_ms: 5000, elapsed_since: 1_780_000_000_000 });
});

test('rowElapsedMs: parked row; a dead row is credited up to its heartbeat; an old row is null', () => {
  assert.equal(rowElapsedMs({ elapsed_ms: 5000, elapsed_since: null }), 5000, 'parked row');
  const since = Date.parse('2026-06-01T00:00:00.000Z');
  // A row whose process died mid-work: credited up to the last heartbeat, never the reader's clock.
  assert.equal(rowElapsedMs({ elapsed_ms: 5000, elapsed_since: since, heartbeat_at: '2026-06-01T00:00:30.000Z', updated_at: '2026-06-01T00:09:00.000Z' }), 35_000);
  assert.equal(rowElapsedMs({ elapsed_ms: 5000, elapsed_since: since, heartbeat_at: null, updated_at: '2026-06-01T00:00:10.000Z' }), 15_000,
    'no heartbeat: the last write');
  assert.equal(rowElapsedMs({ elapsed_ms: 5000, elapsed_since: since, heartbeat_at: null, updated_at: null }), 5000, 'no stamp adds nothing');
  assert.equal(rowElapsedMs({ elapsed_ms: 5000, elapsed_since: since, heartbeat_at: '2026-05-31T00:00:00.000Z' }), 5000, 'a stamp before the anchor adds nothing');
  assert.equal(rowElapsedMs({ elapsed_ms: 0, elapsed_since: null }), null, 'an old row');
  assert.equal(rowElapsedMs({}), null, 'a SELECT without the columns');
});

test('an old row has elapsedMs null and its totalActiveMs', async () => {
  const proj = await freshProj();
  const { id } = await seedPipeline(proj, {
    title: 'old', status: 'done', startedAt: '2026-06-01T00:00:00.000Z', totalActiveMs: 4200,
    steps: [{ key: 'plan', phase: 'plan', activeMs: 4200, runningSince: null }],
  });
  const entry = (await listPipelines(proj)).find((p) => p.id === id);
  assert.equal(entry.elapsedMs, null, 'History entry: absent reads as null, never 0');
  assert.equal(entry.totalActiveMs, 4200);
  const st = readPipelineStateById(id);
  assert.equal(st.elapsedMs, null, 'saved state');
  assert.equal(st.totalActiveMs, 4200);
});
