// test/stats-view.test.mjs — pure jsdom tests for the Statistics-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  BUDGET_WARN_AT, renderKpiRow,
  renderCostPauseBanner, renderStatsBody,
  renderGroupsCard, groupsToCsv, statsQuery, renderStatsView,
  renderSpendChart, renderPeopleCard, renderShapingCard,
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

test('F-20: the two chart cards read "Spend per day" and "Runs per day", and the docs name the same bucket words', () => {
  const body = renderStatsBody({ ...MODEL, bucket: 'day', windowStartMs: 1, windowEndMs: 5,
    series: RUNS.series.map((r, i) => ({ ...r, spentUsd: SPEND.series[i].spentUsd })) }, { doc });
  const titles = [...body.querySelectorAll('.chart-card h2')].map((e) => e.textContent);
  assert.deepEqual(titles, ['Spend per day', 'Runs per day']);
  const labels = [...body.querySelectorAll('.chart-card svg.chart-svg')].map((e) => e.getAttribute('aria-label'));
  assert.match(labels[0], /^Spend per day, /);
  assert.match(labels[1], /^Runs per day by outcome, /);
  const docs = readFileSync(new URL('../docs/statistics.md', import.meta.url), 'utf8');
  for (const w of ['per hour', 'per day', 'per month']) assert.ok(docs.includes(w), w);
});

test('renderSpendChart: the chart has a legend like the Runs chart', () => {
  const card = renderSpendChart(SPEND, { doc });
  const items = [...card.querySelectorAll('.chart-legend .lg-item')];
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /^Spend \$/);
});

test('renderStatsBody: every card that draws a chart has a legend, with sans values (D16)', () => {
  const model = { ...MODEL, bucket: 'day', windowStartMs: 1, windowEndMs: 5,
    series: RUNS.series.map((r, i) => ({ ...r, spentUsd: SPEND.series[i].spentUsd })) };
  const body = renderStatsBody(model, { doc });
  const charts = [...body.querySelectorAll('.card')].filter((c) => c.querySelector('svg.chart-svg'));
  assert.equal(charts.length, 2);
  for (const c of charts) assert.ok(c.querySelector('.chart-legend'), c.querySelector('h2')?.textContent);
  assert.equal(body.querySelectorAll('.chart-legend b.mono').length, 0);
  assert.equal(body.querySelectorAll('.stat-value.mono').length, 0, 'tile values are sans');
});

const GROUPS = { by: 'tag:client', label: 'client', rows: [
  { kind: 'value', key: 'Müller & Söhne, GmbH', label: 'Müller & Söhne, GmbH', spentUsd: 3, runs: 2, finished: 2, stopped: 0, failed: 0, paused: 0, running: 0, prsOpened: 1, prsMerged: 1 },
  { kind: 'none', key: null, label: '(no client)', spentUsd: 0.5, runs: 1, finished: 0, stopped: 1, failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
  { kind: 'ask', key: null, label: 'Chat', spentUsd: 0.75, sessions: 1, runs: 0, finished: 0, stopped: 0, failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
] };

test('renderGroupsCard: one row per group, muted none/ask rows, a total, export enabled', () => {
  const card = renderGroupsCard(GROUPS, 'Aug 1 – Aug 31', { doc, totalUsd: 4.25, totalRuns: 3 });
  assert.equal(card.querySelector('.card-head h2').textContent, 'By client');
  const rows = card.querySelectorAll('tbody tr');
  assert.equal(rows.length, 3);
  assert.ok(rows[1].classList.contains('groups-row-none'));
  assert.ok(rows[2].classList.contains('groups-row-ask'));
  // cells: 0 label · 1 spend · 2 share · 3 runs · 4 finished · 5 stopped · 6 failed · 7 PRs merged
  assert.equal(rows[2].cells[2].textContent, '18%');      // 0.75 / 4.25
  assert.equal(rows[2].cells[3].textContent, '—');
  assert.equal(rows[0].cells[3].textContent, '2');
  const foot = card.querySelector('tfoot tr');
  assert.equal(foot.cells.length, 8);
  assert.match(foot.textContent, /\$4\.25/);
  assert.equal(card.querySelector('button.stats-export').disabled, false);
});

test('people, groups and Shaper tables are the shared table inside a table-wrap', () => {
  const people = renderPeopleCard({ people: [{ person: 'ada@example.com', usd: 2, requests: 3, inputTokens: 10, outputTokens: 5, slots: [{ slot: 'anthropic', plan: 'api' }] }] }, 'x', { doc });
  const groups = renderGroupsCard(GROUPS, 'x', { doc, totalUsd: 4.25, totalRuns: 3 });
  const shaping = renderShapingCard({ groups: [{ size: 'small', shaped: { runs: 1, avgCostUsd: 1, avgActiveMs: 1, avgReviewCycles: 1 },
    unshaped: { runs: 0, avgCostUsd: null, avgActiveMs: null, avgReviewCycles: null } }] }, 'x', { doc });
  for (const card of [people, groups, shaping]) {
    const table = card.querySelector('table');
    assert.ok(table.classList.contains('table'), card.querySelector('h2').textContent);
    assert.ok(table.parentElement.classList.contains('table-wrap'));
    // Stacked on phones the thead is clipped: each value cell names its column, the row's name leads.
    for (const td of table.querySelectorAll('td')) {
      if (!td.textContent.trim()) continue;
      assert.ok(td.classList.contains('table-main') || td.dataset.label, `${card.querySelector('h2').textContent}: "${td.textContent}" is labelled`);
    }
  }
});

test('renderGroupsCard: no rows → empty hint and a disabled export', () => {
  const card = renderGroupsCard({ ...GROUPS, rows: [] }, 'x', { doc, totalUsd: 0, totalRuns: 0 });
  assert.match(card.textContent, /Nothing spent and no runs in this period/);
  assert.equal(card.querySelector('button.stats-export').disabled, true);
});

test('groupsToCsv: BOM, header from the group label, the label cell round-trips', () => {
  const csv = groupsToCsv(GROUPS);
  assert.deepEqual([...Buffer.from(csv, 'utf8').subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'client,spendUsd,runs,finished,stopped,failed,running,paused,prsOpened,prsMerged');
  assert.equal(lines[1], '"Müller & Söhne, GmbH",3,2,2,0,0,0,0,1,1');
  assert.equal(lines[3].startsWith('Chat,0.75,'), true);
});

test('statsQuery: repeated tag params, custom dates only for custom', () => {
  assert.equal(statsQuery({ range: 'month' }), 'range=month');
  assert.equal(statsQuery({ range: 'custom', from: '2026-08-01', to: '2026-08-31', tags: ['client:acme', 'spike'], person: 'bob', groupBy: 'tag:client' }),
    'range=custom&from=2026-08-01&to=2026-08-31&tag=client%3Aacme&tag=spike&person=bob&groupBy=tag%3Aclient');
});

test('renderKpiRow: a filtered model drops the budget meter and says Filtered', () => {
  assert.ok(renderKpiRow({ ...MODEL, budget: { ...BUDGET } }, { doc }).querySelector('.stat-meter'), 'control: unfiltered week draws the meter');
  const el = renderKpiRow({ ...MODEL, budget: { ...BUDGET }, filtered: true }, { doc });
  assert.equal(el.querySelector('.stat-meter'), null);
  assert.match(el.querySelector('.stat-tile .stat-sub').textContent, /Filtered/);
});

const VIEW_MODEL = {
  range: 'month', bucket: 'day', windowStartMs: Date.UTC(2026, 7, 1), windowEndMs: Date.UTC(2026, 8, 1),
  totals: { spentUsd: 4.25, runs: 3 }, series: [], filtered: false,
  groups: { label: 'person', rows: [{ kind: 'value', key: 'ana', label: 'ana', spentUsd: 4.25, runs: 3, finished: 3, stopped: 0, failed: 0, running: 0, paused: 0, prsOpened: 0, prsMerged: 0 }] },
  tagGroups: [
    { key: 'cc', configured: true, rows: [{ kind: 'none', key: null, label: '(no cc)', spentUsd: 3.5, runs: 3 }, { kind: 'ask', key: null, label: 'Chat', spentUsd: 0.75, runs: 0 }] },
    { key: 'client', configured: false, rows: [{ kind: 'value', key: 'acme', label: 'acme', spentUsd: 3.5, runs: 3 }, { kind: 'ask', key: null, label: 'Chat', spentUsd: 0.75, runs: 0 }] },
  ],
};

test('statsQuery: byTag adds byTag=1 and one tagKey per configured key', () => {
  assert.equal(statsQuery({ range: 'month', byTag: true, tagKeys: ['cc', 'team'] }), 'range=month&byTag=1&tagKey=cc&tagKey=team');
  assert.equal(statsQuery({ range: 'month', byTag: false, tagKeys: ['cc'] }), 'range=month');
});

test('statsQuery: report adds report=1 (Statistics › Cost)', () => {
  assert.equal(statsQuery({ range: 'month', report: true }), 'range=month&report=1');
});

test('renderStatsView: By person = the person table alone', () => {
  const person = renderStatsView(VIEW_MODEL, 'person', { doc });
  assert.equal(person.querySelector('.groups-card h2').textContent, 'By person');
  assert.equal(person.querySelectorAll('.groups-card').length, 1);
  assert.equal(person.querySelector('.alloc-card'), null);
});

test('renderStatsBody: the Shaper card only when the model carries shaping', () => {
  const model = { ...MODEL, bucket: 'day', windowStartMs: 1, windowEndMs: 5,
    series: RUNS.series.map((r, i) => ({ ...r, spentUsd: SPEND.series[i].spentUsd })) };
  assert.equal(renderStatsBody(model, { doc }).querySelector('.shaping-card'), null);
  const shaping = { groups: [{ size: 'small',
    shaped: { runs: 2, avgCostUsd: 12.5, avgActiveMs: 600000, avgReviewCycles: 1 },
    unshaped: { runs: 0, avgCostUsd: null, avgActiveMs: null, avgReviewCycles: null } }] };
  const card = renderStatsBody({ ...model, shaping }, { doc }).querySelector('.shaping-card');
  assert.equal(card.querySelector('h2').textContent, 'Shaper');
  const rows = [...card.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], 'Small');
  assert.equal(rows[0][1], 'With Shaper');
  assert.equal(rows[1][0], 'Without');
  assert.equal(rows[1][rows[1].length - 1], '–');
  const empty = renderStatsBody({ ...model, shaping: { groups: [] } }, { doc }).querySelector('.shaping-card');
  assert.ok(empty.querySelector('.chart-empty'));
  const all = renderStatsBody({ ...model, range: 'all', shaping }, { doc }).querySelector('.shaping-card');
  assert.equal(all.querySelector('.card-head small.hint').textContent, 'all time');
});
