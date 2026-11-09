// test/stats-groups-design.test.mjs — Design spend (design_cost_ledger) under the Statistics filters, Group by and
// the Cost report: like Chat and Requirements spend it counts in Spent, gets its own row (last) in every group table
// so the rows still reconcile with Spent, a filter (tags, person) drops it, and the `design` flag off hides only figures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import {
  budgetStatus, recordCostDelta, recordAskCostDelta, recordRequirementsCostDelta, recordDesignCostDelta, roundUsd,
} from '../src/core/cost-budget.mjs';
import { insertRunTags } from '../src/core/run-tags-store.mjs';
import { flagByKey } from '../src/shared/flags/registry.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-statsgd-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 10, 12);                   // Thu 2026-09-10 local → lastMonth = August
const at = (m, d, hh = 12) => +new Date(2026, m - 1, d, hh);
const iso = (m, d, hh = 12) => new Date(2026, m - 1, d, hh).toISOString();
const sum = (rows) => roundUsd(rows.reduce((a, r) => a + r.spentUsd, 0));

before(async () => {
  const { id } = await seedPipeline('/tmp/p', { status: 'done' });
  getDb().prepare('UPDATE pipelines SET started_at = ?, started_by = ? WHERE id = ?').run(iso(8, 3), 'alice', id);
  insertRunTags(id, ['client:acme']);
  recordCostDelta({ pipelineId: id, amountUsd: 2, tsMs: at(8, 3) });
  recordAskCostDelta({ threadId: 't1', messageId: 'm1', amountUsd: 0.75, tokens: 10, model: 'x', tsMs: at(8, 20) });
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 1, amountUsd: 0.5, tsMs: at(8, 10) });
  recordRequirementsCostDelta({ featureSeq: 2, turnId: 2, amountUsd: 0.25, tsMs: at(8, 11) });
  // Two rows of d_a pin COUNT(DISTINCT design_id).
  recordDesignCostDelta({ designId: 'd_a', amountUsd: 0.25, tsMs: at(8, 10) });
  recordDesignCostDelta({ designId: 'd_a', amountUsd: 0.25, tsMs: at(8, 10, 13) });
  recordDesignCostDelta({ designId: 'd_b', amountUsd: 0.25, tsMs: at(8, 11) });
});

const ON = { designEnabled: true, requirementsEnabled: true };

test('unfiltered: Spent carries Design spend; every group table has a Design row last that reconciles', () => {
  const s = getStats({ ...ON, range: 'lastMonth', now: NOW, groupBy: 'tag:client', tagKeys: ['client'] });
  assert.deepEqual(s.totals.design, { spendUsd: 0.75, designs: 2 });
  assert.equal(s.totals.spentUsd, 4.25);                 // 2 run + 0.75 Chat + 0.75 Requirements + 0.75 Design
  const row = s.groups.rows.at(-1);
  assert.deepEqual([row.kind, row.label, row.spentUsd, row.designs, row.runs], ['design', 'Design', 0.75, 2, 0]);
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
  assert.equal(s.groups.rows.find((r) => r.kind === 'value').spentUsd, 2);
  for (const t of s.tagGroups) assert.equal(sum(t.rows), s.totals.spentUsd, t.key);
  assert.equal(roundUsd(s.series.reduce((a, b) => a + b.spentUsd, 0)), s.totals.spentUsd);
});

test('a filter drops Design spend everywhere, like Chat', () => {
  for (const filter of [{ tags: ['client:acme'] }, { person: 'alice' }]) {
    const s = getStats({ ...ON, range: 'lastMonth', now: NOW, filter, groupBy: 'person', report: true });
    assert.deepEqual(s.totals.design, { spendUsd: 0, designs: 0 });
    assert.equal(s.totals.spentUsd, 2);
    assert.ok(!s.groups.rows.some((r) => r.kind === 'design'));
    assert.equal(s.report.design, null);
    assert.equal(roundUsd(s.series.reduce((a, b) => a + b.spentUsd, 0)), 2, 'the bars drop it too');
  }
});

test('all time: it counts, and the budget card agrees with the all-time total', () => {
  const s = getStats({ ...ON, range: 'all', now: NOW, groupBy: 'person' });
  assert.deepEqual(s.totals.design, { spendUsd: 0.75, designs: 2 });
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
  assert.equal(budgetStatus(NOW).allTimeSpendUsd, s.totals.spentUsd);
});

test('report: design beside ask and requirements, with its series', () => {
  const s = getStats({ ...ON, range: 'lastMonth', now: NOW, report: true });
  assert.equal(s.report.design.spentUsd, 0.75);
  assert.equal(s.report.design.series.length, s.report.buckets.length);
  assert.equal(s.report.design.series[9], 0.5, 'the 10 August bucket');
  assert.equal(s.report.design.prevSpentUsd, 0);
  assert.equal(roundUsd(s.totals.pipelineSpendUsd + s.report.ask.spentUsd + s.report.requirements.spentUsd + s.report.design.spentUsd), s.totals.spentUsd);
});

test('flag off: the money stays in Spent and its row; only the figures go, and the API shape is today\'s without spend', () => {
  const off = { designEnabled: false, requirementsEnabled: true };
  const s = getStats({ ...off, range: 'lastMonth', now: NOW, groupBy: 'tag:client', tagKeys: ['client'], report: true });
  assert.equal('design' in s.totals, false);
  assert.equal('design' in s.prev, false);
  assert.equal(s.totals.spentUsd, 4.25);
  assert.equal(s.groups.rows.find((r) => r.kind === 'design').spentUsd, 0.75);
  assert.equal(s.report.design.spentUsd, 0.75);
  const none = getStats({ ...off, range: 'lastMonth', now: new Date(2025, 8, 10, 12), report: true });
  assert.equal('design' in none.report, false);
  assert.equal('design' in getStats({ ...off, range: 'all', now: NOW }).totals, false, 'all time has no prev: the block must not throw');
  const was = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = '-design';
  try {
    const byFlag = getStats({ requirementsEnabled: true, range: 'lastMonth', now: NOW });
    assert.equal('design' in byFlag.totals, false, 'no designEnabled: the design flag (off here) decides');
    assert.equal(byFlag.totals.spentUsd, 4.25);
  } finally {
    if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was;
  }
});

test('no designEnabled: the design flag itself decides (WORCA_FLAGS=design, requirements off)', () => {
  const was = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'design';
  try {
    assert.deepEqual(getStats({ requirementsEnabled: true, range: 'lastMonth', now: NOW }).totals.design, { spendUsd: 0.75, designs: 2 });
  } finally {
    if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was;
  }
});

test('the design flag is registered (stage, default, docs and reviewBy are left to the flag pins: P6 and P8 change them)', () => {
  const f = flagByKey('design');
  assert.deepEqual([f.title, f.owner, f.added], ['Design', 'denislavprinov', '2026-11-05']);
});
