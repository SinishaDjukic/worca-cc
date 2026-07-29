// test/artifacts-cost.test.mjs
// Phase 3.6 — listPipelines reads totals from the pipelines row; when the row total
// is 0 it falls back to a per-step SUM/COUNT (the DB-native equivalent of the old
// step-sum). Fixtures seed DB rows via the production writers (seedPipeline ->
// createPipeline + writeState) instead of state.json. The three legacy cases map
// exactly: row-total 0 + step costs → SUM; non-null total → verbatim; no steps (no
// figures anywhere) → null (blank chip). seedPipeline mints the id; look up by the
// RETURNED id (A15(3)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPipelines } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

async function freshProj(prefix) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cost-home-'));
  process.env.WORCA_HOME = home;
  _resetForTests(); // reopen the DB singleton against this temp home
  return mkdtemp(join(tmpdir(), prefix));
}

test('listPipelines derives a missing total from per-step costs (not blank)', async () => {
  const proj = await freshProj('worca-cc-cost-');
  // total omitted (defaults to 0) -> the entry must SUM the steps.
  const { id } = await seedPipeline(proj, {
    title: 'demo', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    steps: [
      { key: 'plan', phase: 'plan', costUsd: 0.10 },
      { key: 'implement', phase: 'implement', costUsd: 0.07 },
    ],
  });
  const list = await listPipelines(proj);
  const entry = list.find((p) => p.id === id);
  assert.equal(entry.totalCostUsd, 0.17, 'summed from steps when the row total is 0');
});

test('listPipelines keeps an explicit persisted total verbatim', async () => {
  const proj = await freshProj('worca-cc-cost-');
  const { id } = await seedPipeline(proj, {
    status: 'done', startedAt: '2026-06-01T00:00:00Z', totalCostUsd: 0.3232,
    steps: [{ key: 'clarify#1', phase: 'clarify', costUsd: 0.3232 }],
  });
  const list = await listPipelines(proj);
  assert.equal(list.find((p) => p.id === id).totalCostUsd, 0.3232);
});

test('listPipelines returns null total only when there is genuinely no cost data', async () => {
  const proj = await freshProj('worca-cc-cost-');
  // No steps at all (and total 0) -> COUNT(cost_usd)=0 -> null display.
  const { id } = await seedPipeline(proj, {
    status: 'done', startedAt: '2026-06-01T00:00:00Z', steps: [],
  });
  const list = await listPipelines(proj);
  assert.equal(list.find((p) => p.id === id).totalCostUsd, null);
});
