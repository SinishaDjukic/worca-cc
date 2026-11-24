// test/team-metrics-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { aggregate } from '../src/shared/team-metrics/aggregate.mjs';
import {
  renderSyncChip, renderTmKpiRow, renderTeamMetricsBody, renderRunsTable, renderTmViewChips,
  renderHeatGrid, renderMissingTagsStrip, heatLevel } from '../ui/public/team-metrics-view.mjs';
import { heatGrid } from '../src/shared/team-metrics/cost-facts.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const NOW = Date.parse('2026-09-16T12:00:00Z');
const recs = [
  makeRecord({ id: '1', startedAt: '2026-09-07T10:00:00Z', usd: 4.12, review: 1, pr: { number: 438, url: 'https://x/pull/438' } }),
  makeRecord({ id: '2', startedAt: '2026-09-08T10:00:00Z', usd: 9, result: 'failed', review: 3, workflow: { id: 'wf_bug', name: 'Bugfix' } }),
  makeRecord({ id: '3', startedAt: '2026-08-05T10:00:00Z', usd: 2 }),   // inside the like-for-like previous window (Aug 1–16 12:00)
];

test('KPI row: Spend sub-line is suppressed when "now" falls outside the selected range (M3)', () => {
  const augRecs = [makeRecord({ id: 'aug1', startedAt: '2026-08-05T10:00:00Z', usd: 5 })];
  const agg = aggregate(augRecs, { range: 'last-month', now: NOW });
  const spendTile = renderTmKpiRow(agg, { doc, now: NOW }).querySelectorAll('.stat-tile')[0];
  assert.match(spendTile.textContent, /\$5\.00/, 'the Spend headline itself is still correct for the selected range');
  assert.doesNotMatch(spendTile.querySelector('.stat-sub').textContent, /so far in/,
    'no month sub-line — spendThisMonthUsd tracks the CURRENT month, not the selected range, so it would misleadingly read $0.00');
});

test('sync chip states: synced, pending, error, unknown-v, fetch error', () => {
  const ok = renderSyncChip({ sync: [{ slug: 'a', pending: 0, lastSyncAt: new Date(NOW - 120_000).toISOString(), fetchedAt: new Date(NOW - 120_000).toISOString() }], stats: { unknownV: 0 } }, { doc, now: NOW });
  assert.match(ok.textContent, /Synced 2 min ago/);
  assert.equal(ok.querySelector('.dot').classList.contains('green'), true);
  assert.ok(ok.querySelector('button.tm-refresh'));
  assert.equal(ok.querySelector('button.tm-push-now'), null, 'nothing pending: no Push now button at all');
  const pend = renderSyncChip({ sync: [{ slug: 'a', pending: 3, fetchedAt: null }], stats: { unknownV: 0 } }, { doc, now: NOW });
  assert.match(pend.textContent, /3 runs pending push/);
  assert.ok(pend.querySelector('.dot.amber'));
  assert.ok(pend.querySelector('button.tm-push-now'), 'pending runs: Push now is offered');
  const err = renderSyncChip({ sync: [{ slug: 'a', pending: 1, lastError: 'remote: protected branch hook declined\nremote: error: GH006', lastErrorCode: 'PUSH_REJECTED', hint: 'exempt `worca-metrics` from branch protection in the repository rules — Worca pushes to it directly, without a pull request' }], stats: { unknownV: 2 } }, { doc, now: NOW });
  assert.ok(err.querySelector('.dot.red'));
  assert.match(err.querySelector('.tm-sync-error').textContent, /protected branch hook declined/);
  assert.match(err.querySelector('.tm-sync-error').textContent, /GH006/, 'stderr verbatim, not only its first line (§4.7)');
  assert.match(err.querySelector('.tm-sync-hint').textContent, /exempt `worca-metrics`/);
  assert.match(err.textContent, /2 records need a newer Worca/);
  const limited = renderSyncChip({ sync: [], stats: {}, refresh: { limited: true, fetched: false, retryInMs: 30_000 } }, { doc, now: NOW });
  assert.match(limited.textContent, /refresh again in 30 s/);
  const limitedButFresh = renderSyncChip({ sync: [], stats: {}, refresh: { limited: true, fetched: true, retryInMs: 30_000 } }, { doc, now: NOW });
  assert.doesNotMatch(limitedButFresh.textContent, /refresh again/);
});

test('body: charts, breakdown tables with row filters and sortable headers, run table, CSV button', () => {
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const body = renderTeamMetricsBody(agg, { doc, now: NOW, scopeKind: 'project', sort: {}, filter: {} });
  assert.deepEqual([...body.querySelectorAll('.chart-card h2')].map((h) => h.textContent).slice(0, 2), ['Spend per week', 'Runs per week']);
  const wfTable = body.querySelector('table.tm-tbl[data-dim="workflow"]');
  assert.ok(wfTable.querySelector('th[data-sort="usd"]'));
  assert.equal(wfTable.querySelectorAll('tbody tr[data-filter-dim="workflow"]').length, 2);
  assert.ok(body.querySelector('table.tm-tbl[data-dim="source"]'));
  assert.equal(body.querySelector('table.tm-tbl[data-dim="project"]'), null, 'project breakdown only in workspace scope');
  assert.equal(body.querySelector('button.tm-export').textContent, 'Export CSV');
  assert.match(body.querySelector('.tm-runs-head').textContent, /2 in range/);
});

test('every tm-tbl is the shared table in a table-wrap; cells carry their column label (D10)', () => {
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const body = renderTeamMetricsBody(agg, { doc, now: NOW, scopeKind: 'project', sort: {}, filter: {} });
  const tables = [...body.querySelectorAll('table.tm-tbl')];
  assert.ok(tables.length >= 2);
  for (const t of tables) {
    assert.ok(t.classList.contains('table'), t.dataset.dim || 'runs');
    assert.ok(t.parentElement.classList.contains('table-wrap'));
    const row = t.querySelector('tbody tr');
    const cells = [...row.cells];
    if (cells.length > 1) {
      assert.ok(cells[0].classList.contains('table-main'));
      const labels = [...t.querySelectorAll('thead th')].map((th) => th.textContent);
      cells.slice(1).forEach((td, i) => assert.equal(td.dataset.label ?? '', labels[i + 1]));
    }
  }
});

test('every card that draws a chart has a legend, with sans values (D16)', () => {
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const body = renderTeamMetricsBody(agg, { doc, now: NOW, scopeKind: 'project', sort: {}, filter: {} });
  const charts = [...body.querySelectorAll('.card')].filter((c) => c.querySelector('svg.chart-svg'));
  assert.ok(charts.length >= 1);
  for (const c of charts) assert.ok(c.querySelector('.chart-legend'), c.querySelector('h2')?.textContent);
  assert.equal(body.querySelectorAll('.chart-legend b.mono').length, 0);
  assert.equal(body.querySelectorAll('.stat-value.mono').length, 0, 'tile values are sans');
});

test('run table rows newest first with PR link and result badge', () => {
  const agg = aggregate(recs, { range: 'all', now: NOW });
  const t = renderRunsTable(agg.runs, { doc, total: agg.runs.length });
  const first = t.querySelector('tbody tr');
  assert.match(first.textContent, /run 2/);
  assert.equal(first.querySelector('.badge').textContent, 'failed');
  assert.equal(t.querySelectorAll('tbody tr')[1].querySelector('a').getAttribute('href'), 'https://x/pull/438');
});

test('run table never renders a non-http(s) PR link', () => {
  const t = renderRunsTable([{ id: 'x', title: 't', result: 'done', usd: 1, wallMs: 1, reviewCycles: null, pr: { number: 7, url: 'javascript:alert(1)' }, actor: null, startedAt: '2026-09-10T10:00:00Z' }], { doc, total: 1 });
  assert.equal(t.querySelector('tbody a'), null);
  assert.match(t.querySelector('tbody').textContent, /#7/);
});

test('Group by lives in the Spend per week card head, reflects agg.groupBy, and never offers "project" (spend is not split across projects)', async () => {
  const { renderTeamMetricsBody, renderGroupBySelect } = await import('../ui/public/team-metrics-view.mjs');
  const { aggregate } = await import('../src/shared/team-metrics/aggregate.mjs');
  const recs = [makeRecord({ id: 'g1', startedAt: '2026-09-05T10:00:00Z', usd: 2 })];
  const body = renderTeamMetricsBody(aggregate(recs, { range: 'this-month', groupBy: 'actor', now: NOW }), { doc, now: NOW, scopeKind: 'project' });
  const sel = body.querySelector('#tm-group');
  assert.ok(sel, 'the select is rendered by the body');
  assert.equal(sel.closest('.chart-card').querySelector('h2').textContent, 'Spend per week', 'inside the Spend per week card');
  assert.ok(sel.closest('.card-head'), 'in the card head, next to the title');
  assert.equal(sel.value, 'actor');
  assert.deepEqual([...sel.options].map((o) => o.value), ['workflow', 'result', 'actor']);
  assert.equal(body.querySelectorAll('#tm-group').length, 1, 'exactly one, never on the Runs per week card');
  const ws = renderGroupBySelect('actor', 'workspace', { doc });
  assert.deepEqual([...ws.querySelector('select').options].map((o) => o.value), ['workflow', 'result', 'actor'], 'a workspace scope offers the same three: a run\'s cost is one number, never split by project touched');
  assert.equal(ws.querySelector('select').value, 'actor');
  // Run tags: one option per tag key in the loaded records, labelled by its dimension when configured.
  const tagged = renderGroupBySelect('workflow', 'project', { doc, tagKeys: ['client'], dims: [{ key: 'client', label: 'Client' }] }).querySelector('select');
  assert.deepEqual([...tagged.options].map((o) => o.value), ['workflow', 'result', 'actor', 'tag:client']);
  assert.equal(tagged.options[3].textContent, 'Client');
  const tagBody = renderTeamMetricsBody(aggregate(recs, { range: 'this-month', now: NOW }), { doc, now: NOW, tagKeys: ['client'], tagDims: [{ key: 'client', label: 'Client' }] });
  assert.ok([...tagBody.querySelectorAll('#tm-group option')].some((o) => o.value === 'tag:client' && o.textContent === 'Client'));
  const wsBody = renderTeamMetricsBody(aggregate([makeRecord({ id: 'g2', startedAt: '2026-09-05T10:00:00Z', usd: 2, kind: 'workspace', touched: ['acme/gateway', 'acme/console'] })], { range: 'this-month', now: NOW }), { doc, now: NOW, scopeKind: 'workspace' });
  assert.ok(!wsBody.textContent.includes('split evenly'), 'no "split evenly" hint anywhere');
  const projTbl = wsBody.querySelector('.tm-breakdown table[data-dim="project"]');
  assert.ok(projTbl, 'the By project touched table stays');
  assert.deepEqual([...projTbl.querySelectorAll('th')].map((t) => t.textContent), ['Project', 'Runs touched', 'Files changed', ''], 'no spend column: cost is not a per-project fact');
  assert.equal(projTbl.closest('.tm-breakdown').querySelector('.card-head .hint').textContent, 'click a project to see only the runs that touched it');
  const bars = [...projTbl.querySelectorAll('tbody tr')].map((tr) => [tr.querySelector('td span').textContent, tr.querySelector('.tm-share-fill').style.width, tr.querySelector('td:last-child').title]);
  assert.deepEqual(bars, [['acme/console', '100%', '100% of the runs in range touched it'], ['acme/gateway', '100%', '100% of the runs in range touched it']], 'the bar is the share of runs that touched it');
  assert.doesNotMatch(projTbl.textContent, /\$/, 'no dollar amount anywhere in the project table');
});

test('KPI row: Saved tile appears only with human hours, prices them at the rate, and wears a "× spend" pill (none for a loss)', async () => {
  const withHuman = recs.map((r, i) => (i === 0 ? { ...r, human: { hours: 12.5, byPhase: {} } } : r));
  const row = renderTmKpiRow(aggregate(withHuman, { range: 'this-month', now: NOW, humanRateUsd: 35 }), { doc, now: NOW });
  const tile = row.querySelectorAll('.stat-tile')[1];
  const tiny = recs.map((r, i) => (i === 0 ? { ...r, human: { hours: 0.1, byPhase: {} } } : r));
  const neg = renderTmKpiRow(aggregate(tiny, { range: 'this-month', now: NOW, humanRateUsd: 35 }), { doc, now: NOW }).querySelectorAll('.stat-tile')[1];
  await checkRows([
    { name: 'KPI row: Saved tile appears only when a record in range carries human hours; prices them at the aggregate rate', run: () => {
      assert.deepEqual([...row.querySelectorAll('.stat-label span:not(.stat-delta):not(.stat-mult)')].map((s) => s.textContent),
        ['Spend', 'Saved', 'Runs', 'Cost per run', 'Duration', 'Autonomy', 'Review cycles']);
      assert.equal(tile.querySelector('.stat-value').textContent, '$424.38');       // 12.5×35 − 13.12
      assert.equal(tile.querySelector('.stat-sub').textContent, '≈ 12.5 h of human work');
      assert.ok(tile.querySelector('.stat-value').classList.contains('is-pos'), 'a positive Saved figure is green');
      assert.equal(tile.querySelector('.stat-delta'), null, 'the previous window has no human record → no positive baseline');
      assert.equal(neg.querySelector('.stat-value').textContent, '−$9.62');        // 0.1×35 − 13.12
      assert.ok(neg.querySelector('.stat-value').classList.contains('is-neg'));
      assert.equal(neg.querySelector('.stat-value').classList.contains('is-pos'), false);
      assert.equal(renderTmKpiRow(aggregate(recs, { range: 'this-month', now: NOW, humanRateUsd: 35 }), { doc, now: NOW }).querySelectorAll('.stat-tile').length, 6, 'no human → no tile');
    } },
    { name: 'KPI row: Saved tile wears a "× spend" pill (saved ÷ spend) at the far right of its label; none for a loss', run: () => {
      const mult = tile.querySelector('.stat-mult');
      assert.equal(mult.textContent, '32× spend', '424.38 ÷ 13.12');
      assert.equal(mult.title, 'Saved ÷ spent in this period');
      assert.equal(tile.querySelector('.stat-label').lastElementChild, mult, 'far right of the label row');
      assert.equal(neg.querySelector('.stat-mult'), null, 'a loss has no multiplier');
      assert.equal(tile.parentElement.querySelectorAll('.stat-mult').length, 1, 'only the Saved tile carries the pill');
    } },
  ]);
});

const VIEW_RECS = [
  { ...makeRecord({ id: 'v1', startedAt: '2026-09-08T10:00:00Z', usd: 3, actor: 'Ana' }), tags: ['client:acme'] },
  makeRecord({ id: 'v2', startedAt: '2026-09-09T10:00:00Z', usd: 1 }),
];

test('renderTeamMetricsBody: no view (flag off) = no chips; By person = the By actor table alone; Cost = the report element', () => {
  const agg = aggregate(VIEW_RECS, { range: 'this-month', now: NOW });
  assert.equal(renderTeamMetricsBody(agg, { doc }).querySelector('#tm-view'), null);
  const person = renderTeamMetricsBody(agg, { doc, view: 'person' });
  assert.deepEqual([...person.querySelectorAll('#tm-view button')].map((b) => b.textContent), ['Overview', 'By person', 'Cost']);
  assert.deepEqual([...person.querySelectorAll('.tm-tbl')].map((t) => t.dataset.dim), ['actor']);
  const costEl = doc.createElement('div');
  costEl.className = 'cost-report';
  const cost = renderTeamMetricsBody(agg, { doc, view: 'cost', costEl });
  assert.equal(cost.querySelector('#tm-view').nextElementSibling, costEl);
  assert.equal(cost.querySelector('.tm-tbl'), null);
  assert.deepEqual([...renderTmViewChips('overview', { doc }).querySelectorAll('button')].map((b) => b.textContent), ['Overview', 'By person', 'Cost']);
});

test('renderHeatGrid: a row per person, a column per value + Total, amounts in cells, shade steps l0–l4', () => {
  const f = (id, person, usd, client) => ({ id, person, usd, hours: 0, inCohort: true, status: 'finished', tags: client ? { client } : {}, spend: [], hourBucket: -1 });
  const grid = heatGrid([f('1', 'Developer A', 6, 'acme'), f('2', 'Developer A', 2, 'globex'), f('3', 'Developer B', 3, 'acme')], { by: 'tag:client' });
  const card = renderHeatGrid(grid, { doc, byLabel: 'Client' });
  assert.equal(card.querySelector('h2').textContent, 'Person × Client');
  const t = card.querySelector('.tm-heat-table');
  assert.deepEqual([...t.querySelectorAll('thead th')].map((x) => x.textContent), ['Person', 'acme', 'globex', 'Total']);
  assert.deepEqual([...t.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.textContent)),
    [['Developer A', '$6.00', '$2.00', '$8.00'], ['Developer B', '$3.00', '—', '$3.00']]);
  assert.ok(t.querySelector('tbody tr td.tm-heat-l4'));
  assert.ok(t.querySelectorAll('tbody tr')[1].cells[2].classList.contains('tm-heat-l0'));
  assert.equal(t.querySelector('tbody tr').cells[1].title, 'Developer A · acme: $6.00 · 1 run');
  assert.deepEqual([heatLevel(0, 6), heatLevel(1, 6), heatLevel(6, 6)], [0, 1, 4]);
  assert.equal(renderHeatGrid(null, { doc, byLabel: 'Person' }).querySelector('.tm-heat-table'), null);
});

test('renderMissingTagsStrip: who, how many runs, how much; nothing without required keys', () => {
  const dims = [{ key: 'client', label: 'Client', required: true }];
  const card = renderMissingTagsStrip({ keys: ['client'], rows: [{ person: 'Developer A', label: 'Developer A', runs: 3, spentUsd: 4, keys: ['client'] }] }, { doc, dims });
  assert.equal(card.querySelector('.card-head small').textContent, 'Required: Client');
  assert.deepEqual([...card.querySelectorAll('.tm-todo-row')].map((li) => li.textContent), ['Developer A3 runs$4.00missing Client']);
  assert.equal(card.querySelector('button'), null);
  assert.match(renderMissingTagsStrip({ keys: ['client'], rows: [] }, { doc, dims }).textContent, /Every run in this view carries/);
  assert.equal(renderMissingTagsStrip({ keys: [], rows: [] }, { doc, dims }), null);
});

// ── Leaderboard card and Level column ──────────────────────────────────────────────────────────────
import { buildLeaderboard } from '../src/shared/team-metrics/leaderboard.mjs';
import { renderLeaderboardCard, renderPeriodSelector, leaderboardBanner, renderLevelBadge } from '../ui/public/team-metrics-leaderboard.mjs';
import { renderBreakdownTable } from '../ui/public/team-metrics-view.mjs';

let lbSeq = 0;
const lbRuns = (actor, count, opts = {}) => Array.from({ length: count }, () => makeRecord({ id: `lb${++lbSeq}`, actor, startedAt: '2026-09-10T10:00:00Z', ...opts }));
const board = (records, range = 'this-month', extra = {}) => buildLeaderboard(records, { range, now: NOW, ...extra });
const unknown = () => ({ state: 'unknown' });

test('leaderboard banner: leading so far / joint / closed / all-time / empty states', () => {
  const lead = leaderboardBanner(board([...lbRuns('Ana', 4), ...lbRuns('Bo', 3)]), { now: NOW });
  assert.equal(lead.kind, 'leading');
  assert.equal(lead.headline, 'Leading so far: Ana');
  assert.equal(lead.detail, 'Ends in 15 days, ranking can still change');
  const joint = leaderboardBanner(board([...lbRuns('Ana', 3), ...lbRuns('Bo', 3)]), { now: NOW });
  assert.equal(joint.headline, 'Joint leaders so far: Ana, Bo');
  const closed = leaderboardBanner(board([...lbRuns('Ana', 3, { startedAt: '2026-08-10T10:00:00Z' })], 'last-month'), { now: NOW });
  assert.equal(closed.headline, 'Winner: Ana');
  assert.equal(closed.detail, 'Closed Aug 31, 2026, final ranking');
  const allTime = leaderboardBanner(board([...lbRuns('Ana', 3)], 'all'), { now: NOW });
  assert.equal(allTime.headline, 'All-time leader: Ana');
  assert.match(leaderboardBanner(board([]), { now: NOW }).headline, /^No winner yet/);
  assert.match(leaderboardBanner(board(lbRuns('Ana', 2)), { now: NOW }).headline, /^No winner for this period/);
});

test('leaderboard card: ranked row shows the score and the four parts as points / weight with raw values', () => {
  const recs = [...lbRuns('Ana', 3, { usd: 2 }), ...lbRuns('Ana', 1, { usd: null }), ...lbRuns('Bo', 3, { usd: 4 })];
  const card = renderLeaderboardCard(board(recs, 'this-month', { mergedRunIds: new Set([recs[0].id]) }), { doc, levelFor: unknown, now: NOW, lbRange: 'this-month' });
  const tr = card.querySelector('tr[data-lb-key="Ana"]');
  const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent);
  assert.equal(cells[0], '1');
  assert.match(cells[1], /Ana/);
  assert.match(cells[3], /15\.0 \/ 15.*4/);
  assert.match(cells[4], /15\.0 \/ 15.*\$2\.00 per run.*3 of 4 costed/);
  assert.match(cells[5], /35\.0 \/ 35.*1/);
  assert.match(cells[6], /35\.0 \/ 35.*100%/);
  assert.match(card.textContent, /merged 35, success 35, runs 15, spend per run 15/);
  assert.equal(card.querySelector('.tm-lb-merged-note'), null);
});

test('leaderboard card: merged-state notes (loading, unreachable)', () => {
  const b = board(lbRuns('Ana', 3));
  assert.match(renderLeaderboardCard(b, { doc, levelFor: unknown, now: NOW, mergedState: 'loading' }).textContent, /Checking merged pull requests…/);
  assert.match(renderLeaderboardCard(b, { doc, levelFor: unknown, now: NOW, mergedState: 'unreachable' }).textContent, /GitHub could not be reached/);
});

test('leaderboard card: not-eligible list has a badge and "needs N more run", and no rank cell', () => {
  const card = renderLeaderboardCard(board([...lbRuns('Ana', 3), ...lbRuns('Bo', 2)]), { doc, levelFor: unknown, now: NOW });
  const todo = card.querySelector('.tm-lb-todo');
  assert.match(todo.textContent, /Not eligible yet/);
  assert.match(todo.textContent, /Bo/);
  assert.match(todo.textContent, /needs 1 more run\b/);
  assert.ok(todo.querySelector('.tm-level'));
  assert.equal(card.querySelectorAll('tbody tr').length, 1, 'Bo is not in the ranked table');
  assert.equal(todo.querySelector('td'), null);
});

test('period selector offers exactly the five periods and marks the current one', () => {
  const seg = renderPeriodSelector('quarter', { doc });
  assert.deepEqual([...seg.querySelectorAll('button')].map((b) => [b.dataset.lbRange, b.textContent]),
    [['all', 'All time'], ['year', 'This year'], ['quarter', 'This quarter'], ['last-month', 'Last month'], ['this-month', 'This month']]);
  assert.deepEqual([...seg.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.lbRange), ['quarter']);
});

test('level badge: known (img alt + tint), none and unknown (neutral glyph)', () => {
  const known = renderLevelBadge({ state: 'known', key: 'builder', name: 'Builder', avatar: '/assets/worca-levels/builder.svg' }, { doc });
  assert.equal(known.dataset.levelState, 'known');
  assert.equal(known.dataset.worcaLevel, 'builder');
  assert.equal(known.querySelector('img').alt, 'Builder');
  assert.equal(known.querySelector('img').getAttribute('src'), '/assets/worca-levels/builder.svg');
  assert.match(known.textContent, /Builder/);
  const none = renderLevelBadge({ state: 'none' }, { doc });
  assert.equal(none.dataset.levelState, 'none');
  assert.match(none.textContent, /No level yet/);
  const unk = renderLevelBadge({ state: 'unknown' }, { doc });
  assert.equal(unk.dataset.levelState, 'unknown');
  assert.equal(unk.dataset.worcaLevel, undefined);
  assert.equal(unk.querySelector('img'), null);
  assert.match(unk.textContent, /Level unknown/);
});

test('actor table shows a level cell on every person row; the same badge as the leaderboard', () => {
  const recs = [...lbRuns('Ana', 3), ...lbRuns('Bo', 3), makeRecord({ id: 'x', actor: null, startedAt: '2026-09-10T10:00:00Z' })];
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const levelFor = (label) => (label === 'Ana' ? { state: 'known', key: 'builder', name: 'Builder', avatar: '/a.svg' } : { state: 'unknown' });
  const table = renderBreakdownTable('actor', agg.breakdowns.actor, { doc, levelFor });
  const ths = [...table.querySelectorAll('th')];
  const level = ths.find((th) => th.textContent === 'Level');
  assert.equal(ths[1], level, 'right after the label');
  assert.equal(level.dataset.sort, undefined);
  assert.equal(level.getAttribute('role'), null);
  const rowOf = (name) => [...table.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('.tm-person')?.textContent === name);
  assert.equal(rowOf('Ana').querySelector('.tm-level').dataset.levelState, 'known');
  assert.equal(rowOf('Bo').querySelector('.tm-level').dataset.levelState, 'unknown');
  assert.equal(rowOf('Ana').querySelectorAll('td')[1].dataset.label, 'Level');
  const none = [...table.querySelectorAll('tbody tr')].find((tr) => tr.classList.contains('dim'));
  assert.equal(none.querySelectorAll('td')[1].textContent, '—');
  assert.equal(none.querySelector('.tm-level'), null);
  const card = renderLeaderboardCard(board(recs), { doc, levelFor, now: NOW });
  assert.equal(card.querySelector('tr[data-lb-key="Ana"] .tm-level').outerHTML, rowOf('Ana').querySelector('.tm-level').outerHTML);
});

test('actor table without levelFor is unchanged: no Level column', () => {
  const agg = aggregate(lbRuns('Ana', 3), { range: 'this-month', now: NOW });
  const table = renderBreakdownTable('actor', agg.breakdowns.actor, { doc });
  assert.ok(![...table.querySelectorAll('th')].some((th) => th.textContent === 'Level'));
  assert.equal(table.querySelector('.tm-level'), null);
});

test('person view prepends the leaderboard, also when no actor table exists; overview has the level column', () => {
  const recs = lbRuns('Ana', 3);
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const leaderboard = board(recs);
  const body = renderTeamMetricsBody(agg, { doc, now: NOW, view: 'person', levelFor: unknown, leaderboard, lbRange: 'this-month' });
  const kids = [...body.children];
  assert.ok(kids[1].classList.contains('tm-lb'), 'the card sits right under the view chips');
  assert.ok(body.querySelector('.tm-breakdown .tm-level'));
  const noActor = aggregate([makeRecord({ id: 'z', actor: null, startedAt: '2026-09-10T10:00:00Z' })], { range: 'this-month', now: NOW });
  noActor.breakdowns.actor = null;
  assert.ok(renderTeamMetricsBody(noActor, { doc, now: NOW, view: 'person', levelFor: unknown, leaderboard: board([]) }).querySelector('.tm-lb'));
  const overview = renderTeamMetricsBody(agg, { doc, now: NOW, view: 'overview', levelFor: unknown });
  assert.ok(overview.querySelector('table[data-dim="actor"] .tm-level'));
  assert.equal(overview.querySelector('.tm-lb'), null);
});

test('record-sourced names stay text in the leaderboard and the level column', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const recs = lbRuns(evil, 3);
  const card = renderLeaderboardCard(board(recs), { doc, levelFor: unknown, now: NOW });
  assert.equal(card.querySelector('img'), null);
  assert.ok(card.textContent.includes(evil));
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  assert.equal(renderBreakdownTable('actor', agg.breakdowns.actor, { doc, levelFor: unknown }).querySelector('img'), null);
});
