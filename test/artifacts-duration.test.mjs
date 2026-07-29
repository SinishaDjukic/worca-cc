// test/artifacts-duration.test.mjs
// Phase 3.6 — listPipelines reads totalActiveMs from the pipelines row; a 0 row
// total falls back to the per-step SUM/COUNT(active_ms). Fixtures seed DB rows via
// the production writers (seedPipeline -> createPipeline + writeState). Cases:
// explicit total -> verbatim; 0 total + step activeMs -> SUM; no steps (no timing
// anywhere) -> null (blank chip rather than a misleading 0s). Each fresh home holds
// exactly one row, so list[0] is the seeded pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPipelines } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

async function freshProj() {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-dur-home-'));
  process.env.WORCA_HOME = home;
  _resetForTests();
  return mkdtemp(join(tmpdir(), 'worca-cc-'));
}

test('listPipelines surfaces totalActiveMs from the persisted row total', async () => {
  const proj = await freshProj();
  const { id } = await seedPipeline(proj, {
    title: 'x', status: 'done',
    startedAt: '2026-06-01T00:00:00.000Z', totalActiveMs: 4200,
    steps: [{ key: 'plan', phase: 'plan', activeMs: 4200, runningSince: null }],
  });
  const list = await listPipelines(proj);
  assert.equal(list.find((p) => p.id === id).totalActiveMs, 4200);
});

test('totalActiveMs falls back to summing steps when the row total is 0', async () => {
  const proj = await freshProj();
  const { id } = await seedPipeline(proj, {
    title: 'y', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    steps: [{ key: 'plan', activeMs: 1000 }, { key: 'refine#1', activeMs: 2000 }],
  });
  const list = await listPipelines(proj);
  assert.equal(list.find((p) => p.id === id).totalActiveMs, 3000);
});

test('totalActiveMs is null for a pre-timer run with no timing data', async () => {
  const proj = await freshProj();
  // No steps at all -> COUNT(active_ms)=0 -> null display.
  const { id } = await seedPipeline(proj, {
    title: 'z', status: 'done', startedAt: '2026-06-01T00:00:00Z', steps: [],
  });
  const list = await listPipelines(proj);
  assert.equal(list.find((p) => p.id === id).totalActiveMs, null);
});
