// test/stats-view.test.mjs — pure jsdom tests for the Statistics-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  BUDGET_WARN_AT, renderKpiRow,
  renderCostPauseBanner, renderStatsBody,
} from '../ui/public/stats-view.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const BUDGET = {
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'weekly',
  windowStartMs: Date.UTC(2026, 7, 3), windowEndMs: Date.UTC(2026, 7, 10),
  msUntilReset: 3 * 86400000 + 4 * 3600000, windowSpendUsd: 41.2312,
  allTimeSpendUsd: 120, remainingUsd: 8.7688, blocked: false,
};
const MODEL = {
  range: 'week',
  totals: { spentUsd: 12.34, pipelineSpendUsd: 10.34,
    ask: { spendUsd: 2, sessions: 4, turns: 10 },
    workedMs: 22320000, humanHours: 449.2, savedUsd: 35315, runs: 40, finished: 34, stopped: 5,
    failed: 1, paused: 0, running: 2, prsOpened: 18, prsMerged: 12 },
  prev: { spentUsd: 10, pipelineSpendUsd: 9, ask: { spendUsd: 1, sessions: 2, turns: 3 },
    workedMs: 20000000, humanHours: 100, savedUsd: -12.5, runs: 30, finished: 30, stopped: 0,
    failed: 0, paused: 0, running: 0, prsOpened: 10, prsMerged: 8 },
  budget: BUDGET,
};

test('renderKpiRow: 6 tiles, caveat tooltip, fractions, subs', () => {
  const el = renderKpiRow(MODEL, { doc });
  const tiles = el.querySelectorAll('.stat-tile');
  assert.equal(tiles.length, 7);
  assert.match(tiles[0].title, /not authoritative billing/);
  assert.match(tiles[0].querySelector('.stat-value').textContent, /\$12\.34/);
  assert.match(tiles[0].querySelector('.stat-sub').textContent, /of \$50\.00/);
  assert.ok(tiles[0].querySelector('.stat-meter'));
  assert.match(tiles[5].querySelector('.stat-value').textContent, /34/);
  assert.match(tiles[5].querySelector('.stat-frac').textContent, /\/ 40/);
  assert.match(tiles[5].querySelector('.stat-sub').textContent, /5 stopped · 1 failed/);
  assert.match(tiles[5].querySelector('.stat-sub').textContent, /2 running now/);
  assert.match(tiles[6].querySelector('.stat-value').textContent, /12/);
  assert.match(tiles[6].querySelector('.stat-frac').textContent, /\/ 18/);
});

test('renderKpiRow: the Spent meter only when the selected range IS the budget reset window', () => {
  // MODEL.range 'week' + BUDGET.resetPeriod 'weekly' are aligned (metered above).
  // Any mismatch compares a range-scoped spend to a window-scoped limit, so the
  // ratio — and "resets in…" — are nonsense: drop the meter, name the window.
  const all = renderKpiRow({ ...MODEL, range: 'all' }, { doc }).querySelectorAll('.stat-tile')[0];
  assert.equal(all.querySelector('.stat-meter'), null, 'all-time spend vs a weekly cap is not a ratio');
  assert.match(all.querySelector('.stat-value').textContent, /\$12\.34/, 'the value still follows the range');
  assert.match(all.querySelector('.stat-sub').textContent, /this week: \$41\.23 of \$50\.00/);

  const month = renderKpiRow({ ...MODEL, range: 'month' }, { doc }).querySelectorAll('.stat-tile')[0];
  assert.equal(month.querySelector('.stat-meter'), null, 'Month under a weekly reset is also a mismatch');

  const aligned = renderKpiRow({ ...MODEL, range: 'month', budget: { ...BUDGET, resetPeriod: 'monthly' } },
    { doc }).querySelectorAll('.stat-tile')[0];
  assert.ok(aligned.querySelector('.stat-meter'), 'a monthly reset realigns the Month range');
  assert.match(aligned.querySelector('.stat-sub').textContent, /of \$50\.00 · resets in/);
});

test('renderKpiRow: a payload without the new fields renders zeros, not a throw', () => {
  const legacy = { ...MODEL,
    totals: { ...MODEL.totals }, prev: { ...MODEL.prev } };
  delete legacy.totals.pipelineSpendUsd; delete legacy.totals.ask;
  delete legacy.prev.pipelineSpendUsd; delete legacy.prev.ask;
  const tiles = renderKpiRow(legacy, { doc }).querySelectorAll('.stat-tile');
  assert.equal(tiles.length, 7);
  assert.match(tiles[2].querySelector('.stat-value').textContent, /\$12\.34/,
    'pipelineSpendUsd falls back to spentUsd');
  assert.match(tiles[3].querySelector('.stat-sub').textContent, /no sessions in this period/);
});

test('renderCostPauseBanner: cb-pipeline offers override + settings with both figures; cb-total has no override and names the reset moment', async () => {
  await checkRows([
    { name: 'renderCostPauseBanner: cb-pipeline has override + settings actions and both figures', run: () => {
      const el = renderCostPauseBanner(
        { pauseReason: 'cost_pipeline', pipelineId: 'pl_1', totalCostUsd: 25.13 },
        { doc, budget: { ...BUDGET, pipelineLimitUsd: 25 } });
      assert.ok(el.classList.contains('cb-pipeline'));
      const override = el.querySelector('.cb-override');
      assert.equal(override.textContent, 'Continue without cap (this pipeline)');
      assert.equal(override.dataset.pipelineId, 'pl_1');
      assert.match(el.textContent, /\$25\.13/);
      assert.match(el.textContent, /\$25\.00/);
      assert.ok(el.querySelector('.cb-settings'));
    } },
    { name: 'renderCostPauseBanner: cb-total has no override, names the reset moment', run: () => {
      const el = renderCostPauseBanner(
        { pauseReason: 'cost_total', pipelineId: 'pl_2', totalCostUsd: 9 },
        { doc, budget: { ...BUDGET, windowSpendUsd: 52.13, totalLimitUsd: 50, blocked: true } });
      assert.ok(el.classList.contains('cb-total'));
      assert.equal(el.querySelector('.cb-override'), null);
      assert.match(el.textContent, /\$52\.13/);
      assert.match(el.textContent, /total limit/);
      assert.match(el.textContent, /resets/);
    } },
  ]);
});

const SPEND = {
  bucket: 'day', currentBucketStartMs: 4,
  rangeLabel: 'Aug 4 – Aug 10',
  series: [
    { bucketStartMs: 1, spentUsd: 0.5 }, { bucketStartMs: 2, spentUsd: 0 },
    { bucketStartMs: 3, spentUsd: 1.25 }, { bucketStartMs: 4, spentUsd: 0.75 },
  ],
};
const RUNS = {
  bucket: 'day', currentBucketStartMs: 4, rangeLabel: 'Aug 4 – Aug 10',
  series: [
    { bucketStartMs: 1, finished: 2, stopped: 1, failed: 0 },
    { bucketStartMs: 2, finished: 0, stopped: 0, failed: 0 },
    { bucketStartMs: 3, finished: 1, stopped: 0, failed: 1 },
    { bucketStartMs: 4, finished: 3, stopped: 0, failed: 0 },
  ],
};

test('renderStatsBody: KPI row + two chart cards; empty range -> chart-empty notes', () => {
  const model = { ...MODEL, bucket: 'day',
    windowStartMs: 1, windowEndMs: 5,
    series: RUNS.series.map((r, i) => ({ ...r, spentUsd: SPEND.series[i].spentUsd })) };
  const el = renderStatsBody(model, { doc });
  assert.ok(el.querySelector('.stat-row'));
  assert.equal(el.querySelectorAll('.chart-card').length, 2);
  const empty = renderStatsBody({ ...model,
    totals: { ...model.totals, runs: 0, finished: 0, stopped: 0, failed: 0, paused: 0, running: 0 },
    series: [] }, { doc });
  assert.equal(empty.querySelectorAll('.chart-empty').length, 2);
  assert.equal(empty.querySelector('svg.chart-svg'), null);
});
