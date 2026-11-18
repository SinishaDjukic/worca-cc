// test/stats-design-figures.test.mjs — report.design's own figures (Spent, its previous period, the series), the
// design window bounds [start, end), and a filtered All time. Design amounts differ from Requirements' here, so a
// figure read from the wrong ledger shows. Its own file: test/stats-groups-design.test.mjs pins all-time totals of
// its own fixture, which any extra Design row would change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta, recordRequirementsCostDelta, recordDesignCostDelta, roundUsd } from '../src/core/cost-budget.mjs';
import { insertRunTags } from '../src/core/run-tags-store.mjs';

useTempHome(after, 'worca-stats-design-figures-');
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-statsdf-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 10, 12);                   // Thu 2026-09-10 local → lastMonth = August
const at = (m, d, hh = 12, mi = 0) => +new Date(2026, m - 1, d, hh, mi);
const iso = (m, d, hh = 12) => new Date(2026, m - 1, d, hh).toISOString();

before(async () => {
  const { id } = await seedPipeline('/tmp/p', { status: 'done' });
  getDb().prepare('UPDATE pipelines SET started_at = ?, started_by = ? WHERE id = ?').run(iso(8, 3), 'alice', id);
  insertRunTags(id, ['client:acme']);
  recordCostDelta({ pipelineId: id, amountUsd: 2, tsMs: at(8, 3) });
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 1, amountUsd: 0.5, tsMs: at(8, 10) });
  recordRequirementsCostDelta({ featureSeq: 2, turnId: 2, amountUsd: 0.25, tsMs: at(8, 11) });
  recordDesignCostDelta({ designId: 'd_e', amountUsd: 0.05, tsMs: +new Date(2026, 7, 1) });   // exactly Aug 1 00:00
  recordDesignCostDelta({ designId: 'd_a', amountUsd: 0.3, tsMs: at(8, 12) });
  recordDesignCostDelta({ designId: 'd_a', amountUsd: 0.2, tsMs: at(8, 12, 13) });
  recordDesignCostDelta({ designId: 'd_b', amountUsd: 0.1, tsMs: at(8, 13) });
  recordDesignCostDelta({ designId: 'd_c', amountUsd: 0.4, tsMs: at(7, 20) });
  recordDesignCostDelta({ designId: 'd_f', amountUsd: 0.07, tsMs: +new Date(2026, 8, 1) });   // exactly Sep 1 00:00
});

const ON = { designEnabled: true, requirementsEnabled: true };

test('report.design is Design\'s own: Spent, its previous period and the series; a window is [start, end)', () => {
  const s = getStats({ ...ON, range: 'lastMonth', now: NOW, report: true });
  assert.deepEqual(s.totals.design, { spendUsd: 0.65, designs: 3 });
  assert.deepEqual(s.prev.design, { spendUsd: 0.4, designs: 1 });
  assert.equal(s.report.design.spentUsd, 0.65);
  assert.equal(s.report.design.prevSpentUsd, 0.4);
  assert.deepEqual([s.report.design.series[0], s.report.design.series[11], s.report.design.series[12]], [0.05, 0.5, 0.1]);
  assert.equal(roundUsd(s.report.design.series.reduce((a, b) => a + b, 0)), 0.65);
  const m = getStats({ ...ON, range: 'month', now: NOW, report: true });
  assert.equal(m.totals.design.spendUsd, 0.07);
  assert.equal(m.report.design.prevSpentUsd, 0.65);
});

test('all time with a filter drops Design spend', () => {
  const s = getStats({ ...ON, range: 'all', now: NOW, filter: { person: 'alice' } });
  assert.deepEqual(s.totals.design, { spendUsd: 0, designs: 0 });
  assert.equal(s.totals.spentUsd, s.totals.pipelineSpendUsd);
});

test('flag off: a period with Design spend only in the one before keeps report.design', () => {
  const s = getStats({ designEnabled: false, requirementsEnabled: true, range: 'lastMonth', now: new Date(2026, 10, 10, 12), report: true });
  assert.equal(s.report.design.spentUsd, 0);
  assert.equal(s.report.design.prevSpentUsd, 0.07);
});
