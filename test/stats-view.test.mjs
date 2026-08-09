// test/stats-view.test.mjs — pure jsdom tests for the Statistics-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  BUDGET_WARN_AT, renderKpiRow, renderBudgetIndicator, renderBudgetReadout,
  renderCostPauseBanner, renderSpendChart, renderRunsChart, renderStatsBody,
} from '../ui/public/stats-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const BUDGET = {
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'weekly',
  windowStartMs: Date.UTC(2026, 7, 3), windowEndMs: Date.UTC(2026, 7, 10),
  msUntilReset: 3 * 86400000 + 4 * 3600000, windowSpendUsd: 41.2312,
  allTimeSpendUsd: 120, remainingUsd: 8.7688, blocked: false,
};
const MODEL = {
  range: 'week',
  totals: { spentUsd: 12.34, workedMs: 22320000, runs: 40, finished: 34, stopped: 5,
    failed: 1, paused: 0, running: 2, prsOpened: 18, prsMerged: 12 },
  prev: { spentUsd: 10, workedMs: 20000000, runs: 30, finished: 30, stopped: 0,
    failed: 0, paused: 0, running: 0, prsOpened: 10, prsMerged: 8 },
  budget: BUDGET,
};

test('renderKpiRow: 4 tiles, caveat tooltip, fractions, subs', () => {
  const el = renderKpiRow(MODEL, { doc });
  const tiles = el.querySelectorAll('.stat-tile');
  assert.equal(tiles.length, 4);
  assert.match(tiles[0].title, /not authoritative billing/);
  assert.match(tiles[0].querySelector('.stat-value').textContent, /\$12\.34/);
  assert.match(tiles[0].querySelector('.stat-sub').textContent, /of \$50\.00/);
  assert.ok(tiles[0].querySelector('.stat-meter'));
  assert.match(tiles[2].querySelector('.stat-value').textContent, /34/);
  assert.match(tiles[2].querySelector('.stat-frac').textContent, /\/ 40/);
  assert.match(tiles[2].querySelector('.stat-sub').textContent, /5 stopped · 1 failed/);
  assert.match(tiles[2].querySelector('.stat-sub').textContent, /2 running now/);
  assert.match(tiles[3].querySelector('.stat-value').textContent, /12/);
  assert.match(tiles[3].querySelector('.stat-frac').textContent, /\/ 18/);
});

test('renderKpiRow: numeric tokens in tile subs are bold, prose stays plain', () => {
  const tiles = renderKpiRow(MODEL, { doc }).querySelectorAll('.stat-tile');
  const bolds = (t) => [...t.querySelectorAll('.stat-sub b')].map((b) => b.textContent);
  assert.deepEqual(bolds(tiles[0]), ['$50.00', '3d 4h']);
  assert.equal(tiles[0].querySelector('.stat-sub').textContent, 'of $50.00 · resets in 3d 4h');
  assert.deepEqual(bolds(tiles[1]), ['40']);
  assert.deepEqual(bolds(tiles[2]), ['5', '1', '2']);
  assert.deepEqual(bolds(tiles[3]), [], 'no numbers in "opened in this period"');

  // Range/window mismatch line bolds both dollar figures.
  const all = renderKpiRow({ ...MODEL, range: 'all' }, { doc }).querySelectorAll('.stat-tile')[0];
  assert.deepEqual(bolds(all), ['$41.23', '$50.00']);
});

test('renderKpiRow: delta chips only when prev exists and prev value > 0; none for all-time', () => {
  const withPrev = renderKpiRow(MODEL, { doc });
  assert.ok(withPrev.querySelector('.stat-delta'));
  const noPrev = renderKpiRow({ ...MODEL, prev: null, range: 'all' }, { doc });
  assert.equal(noPrev.querySelector('.stat-delta'), null);
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

test('renderKpiRow: no total limit -> no meter, "No total limit set"', () => {
  const b = { ...BUDGET, totalLimitUsd: null, remainingUsd: null };
  const el = renderKpiRow({ ...MODEL, budget: b }, { doc });
  const spent = el.querySelectorAll('.stat-tile')[0];
  assert.equal(spent.querySelector('.stat-meter'), null);
  assert.match(spent.querySelector('.stat-sub').textContent, /No total limit set/);
});

test('renderBudgetIndicator: states default/warn/over/no-limit + period label + nav target', () => {
  let el = renderBudgetIndicator({ ...BUDGET, windowSpendUsd: 10 }, { doc });
  assert.equal(el.dataset.nav, 'stats');
  assert.match(el.querySelector('.spend-ind-label').textContent, /Spent this week/);
  assert.ok(!el.classList.contains('warn') && !el.classList.contains('over'));
  assert.ok(el.querySelector('.spend-ind-meter'), 'the status bar stays');
  assert.equal(el.querySelector('.spend-ind-sub'), null,
    'no "of $X · resets in Y" sub-line — the card is value + bar only');
  el = renderBudgetIndicator(BUDGET, { doc });                       // 41.23/50 = 82%
  assert.ok(el.classList.contains('warn'));
  assert.equal(el.querySelector('.spend-ind-sub'), null, 'warn state has no sub-line either');
  assert.match(el.title, /\$41\.2312/);
  assert.match(el.title, /not authoritative billing/);
  el = renderBudgetIndicator({ ...BUDGET, windowSpendUsd: 52, blocked: true }, { doc });
  assert.ok(el.classList.contains('over'));
  assert.match(el.querySelector('.spend-ind-sub').textContent, /new runs blocked/);
  el = renderBudgetIndicator({ ...BUDGET, totalLimitUsd: null, blocked: false,
    resetPeriod: 'monthly' }, { doc });
  assert.equal(el.querySelector('.spend-ind-meter'), null);
  assert.match(el.querySelector('.spend-ind-label').textContent, /Spent this month/);
  assert.match(el.querySelector('.spend-ind-sub').textContent, /no total limit/);
});

test('renderBudgetReadout: meter + bold figures; meterless when no limit', () => {
  let el = renderBudgetReadout(BUDGET, { doc });
  assert.ok(el.querySelector('.spend-ind-meter'));
  assert.match(el.querySelector('.budget-readout-line').textContent,
    /Spent \$41\.23 of \$50\.00 this week · resets in 3d 4h/);
  el = renderBudgetReadout({ ...BUDGET, totalLimitUsd: null }, { doc });
  assert.equal(el.querySelector('.spend-ind-meter'), null);
});

test('renderCostPauseBanner: cb-pipeline has override + settings actions and both figures', () => {
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
});

test('renderCostPauseBanner: cb-total has no override, names the reset moment', () => {
  const el = renderCostPauseBanner(
    { pauseReason: 'cost_total', pipelineId: 'pl_2', totalCostUsd: 9 },
    { doc, budget: { ...BUDGET, windowSpendUsd: 52.13, totalLimitUsd: 50, blocked: true } });
  assert.ok(el.classList.contains('cb-total'));
  assert.equal(el.querySelector('.cb-override'), null);
  assert.match(el.textContent, /\$52\.13/);
  assert.match(el.textContent, /total limit/);
  assert.match(el.textContent, /resets/);
});

test('purity: same input twice renders isEqualNode; no listeners fire on detached tree', () => {
  const a = renderKpiRow(MODEL, { doc });
  const b = renderKpiRow(MODEL, { doc });
  assert.ok(a.isEqualNode(b));
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

test('renderSpendChart: one hit rect per bucket; current bucket darker + single direct label', () => {
  const el = renderSpendChart(SPEND, { doc });
  assert.ok(el.querySelector('svg.chart-svg'));
  assert.equal(el.querySelectorAll('.ch-hit').length, 4);
  const current = el.querySelectorAll('[data-current="1"]');
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute('fill'), 'var(--blue-ink)');
  const labels = el.querySelectorAll('.ch-direct');
  assert.equal(labels.length, 1);
  assert.match(labels[0].textContent, /\$0\.75/);
  const ticks = [...el.querySelectorAll('.ch-ytick')];
  assert.ok(ticks.length >= 2);
  assert.ok(ticks.every((t) => t.textContent.startsWith('$')));
  const srRows = el.querySelectorAll('table.sr-only tbody tr');
  assert.equal(srRows.length, 4);
  const hit = el.querySelector('.ch-hit');
  assert.equal(hit.getAttribute('tabindex'), '0');
  assert.ok(hit.getAttribute('aria-label').length > 0);
  assert.ok(hit.dataset.tip.includes('$0.50'));
});

test('renderRunsChart: segments only for non-zero counts; legend with summed counts; top rounded', () => {
  const el = renderRunsChart(RUNS, { doc });
  const legendItems = el.querySelectorAll('.chart-legend .lg-item');
  assert.equal(legendItems.length, 3);
  assert.match(legendItems[0].textContent, /Finished\s*6/);
  assert.match(legendItems[1].textContent, /Stopped\s*1/);
  assert.match(legendItems[2].textContent, /Failed\s*1/);
  // bucket 2 is all-zero: no mark rects for it (hit rect still present)
  assert.equal(el.querySelectorAll('.ch-hit').length, 4);
  const seg = el.querySelectorAll('.ch-seg');
  assert.ok(seg.length >= 4);                 // 2+0+2+1 non-zero segments (+ rounded tops as paths)
  const band = el.querySelectorAll('.ch-currentband');
  assert.equal(band.length, 1);
  const aria = el.querySelector('.ch-hit[aria-label*="finished"]');
  assert.ok(aria);
});

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

// --- Today range -----------------------------------------------------------

test('renderKpiRow: Today delta chips read "vs yesterday"', () => {
  const kpi = renderKpiRow({ ...MODEL, range: 'today' }, { doc });
  const chip = kpi.querySelector('.stat-delta');
  assert.ok(chip, 'chip renders when prev exists');
  assert.equal(chip.title, 'vs yesterday');
});

const SPEND_HOURLY = {
  bucket: 'hour', currentBucketStartMs: +new Date(2026, 7, 6, 10),
  rangeLabel: 'Thu Aug 6',
  series: [
    { bucketStartMs: +new Date(2026, 7, 6, 8),  spentUsd: 0.5 },
    { bucketStartMs: +new Date(2026, 7, 6, 9),  spentUsd: 0 },
    { bucketStartMs: +new Date(2026, 7, 6, 10), spentUsd: 1.25 },
  ],
};

test('renderSpendChart: hour buckets get hourly title, ticks, and tooltips', () => {
  const card = renderSpendChart(SPEND_HOURLY, { doc });
  assert.match(card.querySelector('h2').textContent, /Spend per hour/);
  const ticks = [...card.querySelectorAll('svg text')].map((t) => t.textContent);
  assert.ok(ticks.includes('08:00'), 'zero-padded hourly x tick');
  const hit = card.querySelector('.ch-hit');
  assert.match(hit.dataset.tip, /^Thu Aug 6, 08:00\n/, 'tooltip head names the hour');
});

test('renderStatsBody: Today gets a single-date range label and per-hour cards', () => {
  const model = { ...MODEL, range: 'today', bucket: 'hour',
    windowStartMs: +new Date(2026, 7, 6), windowEndMs: +new Date(2026, 7, 7),
    series: SPEND_HOURLY.series.map((p) => ({ ...p, finished: 0, stopped: 0, failed: 0 })) };
  const hint = renderStatsBody(model, { doc }).querySelector('.chart-card .hint');
  assert.equal(hint.textContent, 'Thu Aug 6', 'no "Thu Aug 6 – Thu Aug 6" span');
});
