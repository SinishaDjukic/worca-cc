// test/team-metrics-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { aggregate } from '../src/shared/team-metrics/aggregate.mjs';
import {
  renderScopeOptions, renderSyncChip, renderTmKpiRow, renderTeamMetricsBody, renderTmEmptyState, renderRunsTable, renderTmSkeleton } from '../ui/public/team-metrics-view.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const NOW = Date.parse('2026-09-16T12:00:00Z');
const recs = [
  makeRecord({ id: '1', startedAt: '2026-09-07T10:00:00Z', usd: 4.12, review: 1, pr: { number: 438, url: 'https://x/pull/438' } }),
  makeRecord({ id: '2', startedAt: '2026-09-08T10:00:00Z', usd: 9, result: 'failed', review: 3, workflow: { id: 'wf_bug', name: 'Bugfix' } }),
  makeRecord({ id: '3', startedAt: '2026-08-05T10:00:00Z', usd: 2 }),   // inside the like-for-like previous window (Aug 1–16 12:00)
];

test('scope select groups Projects / Workspaces and marks the selection', () => {
  const sel = doc.createElement('select');
  renderScopeOptions(sel, { projects: [{ id: 'project:a-0123abcd', label: 'acme/billing-api' }], workspaces: [{ id: 'workspace:wks-iot-0123abcd', label: 'IoT SP Platform' }] }, 'workspace:wks-iot-0123abcd', { doc });
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Projects', 'Workspaces']);
  assert.equal(sel.value, 'workspace:wks-iot-0123abcd');
  const empty = doc.createElement('select');
  renderScopeOptions(empty, { projects: [], workspaces: [] }, '', { doc });
  assert.equal(empty.options[0].textContent, 'Nothing is recording yet');
  assert.ok(empty.disabled);
});

test('KPI row: six tiles with mockup labels, deltas and subs', () => {
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const row = renderTmKpiRow(agg, { doc, now: NOW });
  assert.deepEqual([...row.querySelectorAll('.stat-label span:not(.stat-delta)')].map((s) => s.textContent),
    ['Spend', 'Runs', 'Cost per run', 'Duration', 'Autonomy', 'Review cycles']);
  assert.equal(row.querySelectorAll('.stat-tile').length, 6);
  assert.match(row.textContent, /\$13\.12/);
  assert.match(row.textContent, /1 done · 1 failed · 0 stopped · 50% success/);
  assert.match(row.textContent, /with a PR \$4\.12/);
  assert.ok(row.querySelector('.stat-meter'));
  assert.match(row.querySelector('.stat-delta').textContent, /vs prev/);
});

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

test('enabled but no records in range → zeros and the run table says so', () => {
  const agg = aggregate([], { range: 'this-month', now: NOW });
  const body = renderTeamMetricsBody(agg, { doc, now: NOW, scopeKind: 'project', sort: {}, filter: {} });
  assert.match(body.querySelector('.stat-row').textContent, /\$0\.00/);
  assert.match(body.querySelector('.tm-runs').textContent, /No runs recorded in this range/);
});

test('nothing enabled → two ways in with deep links and Check now', () => {
  const e = renderTmEmptyState({ doc });
  assert.equal(e.querySelectorAll('.card').length, 2);
  assert.equal(e.querySelector('a[href="#projects"]').textContent, 'Go to Projects');
  assert.equal(e.querySelector('a[href="#workspaces"]').textContent, 'Go to Workspaces');
  assert.ok(e.querySelector('button.tm-check-now'));
});

test('run table rows newest first with PR link and result badge', () => {
  const agg = aggregate(recs, { range: 'all', now: NOW });
  const t = renderRunsTable(agg.runs, { doc, total: agg.runs.length });
  const first = t.querySelector('tbody tr');
  assert.match(first.textContent, /run 2/);
  assert.equal(first.querySelector('.badge').textContent, 'failed');
  assert.equal(t.querySelectorAll('tbody tr')[1].querySelector('a').getAttribute('href'), 'https://x/pull/438');
});

test('run table: Saved column after Cost — green when positive, red with a − sign when negative, — without human hours', () => {
  const base = { title: 't', workflow: null, result: 'done', usd: 13.12, wallMs: 1, reviewCycles: null, pr: null, actor: null, startedAt: '2026-09-10T10:00:00Z' };
  const t = renderRunsTable([
    { ...base, id: 'p', humanHours: 12.5, savedUsd: 424.38 },
    { ...base, id: 'n', humanHours: 0.1, savedUsd: -9.62 },
    { ...base, id: 'x', humanHours: null, savedUsd: null },
  ], { doc, total: 3 });
  assert.deepEqual([...t.querySelectorAll('thead th')].map((th) => th.textContent), ['Title', 'Workflow', 'Result', 'Cost', 'Saved', 'Duration', 'Cycles', 'PR', 'Actor', 'Started']);
  const cells = [...t.querySelectorAll('tbody td.tm-saved')];
  assert.deepEqual(cells.map((c) => c.textContent), ['$424.38', '−$9.62', '—']);
  assert.ok(cells[0].classList.contains('pos') && !cells[0].classList.contains('neg'));
  assert.ok(cells[1].classList.contains('neg') && !cells[1].classList.contains('pos'));
  assert.equal(cells[0].title, '≈ 12.5 h of human work');
  assert.equal(cells[2].title, '');
  assert.equal([...cells[2].classList].filter((c) => /^(pos|neg)$/.test(c)).length, 0);
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

test('sync chip while a deferred fetch runs (refresh.pending, or busy from the caller): spinner for the dot, "Checking origin…", Refresh held', () => {
  const pending = renderSyncChip({ sync: [{ slug: 'a', pending: 0, fetchedAt: new Date(NOW - 120_000).toISOString() }], stats: {}, refresh: { pending: true } }, { doc, now: NOW });
  assert.ok(pending.classList.contains('is-busy'));
  assert.equal(pending.getAttribute('aria-busy'), 'true');
  assert.ok(pending.querySelector('.tm-busy-spin')); assert.equal(pending.querySelector('.dot'), null);
  assert.match(pending.textContent, /Checking origin… · synced 2 min ago/);
  assert.equal(pending.querySelector('.tm-refresh').disabled, true);
  assert.ok(pending.querySelector('.tm-refresh').classList.contains('busy'));
  const first = renderSyncChip({ sync: [{ slug: 'a', pending: 0 }], stats: {}, refresh: { pending: true } }, { doc, now: NOW });
  assert.ok(first.textContent.startsWith('Checking origin…'), 'a first fetch has nothing older to date');
  assert.doesNotMatch(first.textContent, /Not synced yet/);
  const busy = renderSyncChip({ sync: [], stats: {} }, { doc, now: NOW, busy: true });
  assert.ok(busy.classList.contains('is-busy'));
  const idle = renderSyncChip({ sync: [{ slug: 'a', pending: 0, fetchedAt: new Date(NOW - 120_000).toISOString() }], stats: {}, refresh: { pending: false } }, { doc, now: NOW });
  assert.equal(idle.querySelector('.tm-busy-spin'), null); assert.ok(idle.querySelector('.dot.green'));
  assert.equal(idle.querySelector('.tm-refresh').disabled, false);
  assert.match(idle.textContent, /^Synced 2 min ago/);
});

test('skeleton: the page shape with shimmer bars, no words, decorative', () => {
  const sk = renderTmSkeleton({ doc });
  assert.equal(sk.getAttribute('aria-hidden'), 'true');
  assert.equal(sk.querySelectorAll('.stat-tile').length, 6);
  assert.equal(sk.querySelectorAll('.chart-card').length, 2);
  assert.equal(sk.querySelectorAll('.tm-breakdowns .card').length, 4);
  assert.equal(renderTmSkeleton({ doc, scopeKind: 'workspace' }).querySelectorAll('.tm-breakdowns .card').length, 5, 'a workspace scope has the project breakdown too');
  assert.ok(sk.querySelector('.tm-runs'));
  assert.ok(sk.querySelectorAll('.skel').length > 20);
  assert.equal(sk.textContent.trim(), '', 'no words — the live state is #tm-body aria-busy');
});

test('KPI row: Saved tile appears only when a record in range carries human hours; prices them at the aggregate rate', () => {
  const withHuman = recs.map((r, i) => (i === 0 ? { ...r, human: { hours: 12.5, byPhase: {} } } : r));
  const row = renderTmKpiRow(aggregate(withHuman, { range: 'this-month', now: NOW, humanRateUsd: 35 }), { doc, now: NOW });
  assert.deepEqual([...row.querySelectorAll('.stat-label span:not(.stat-delta)')].map((s) => s.textContent),
    ['Spend', 'Saved', 'Runs', 'Cost per run', 'Duration', 'Autonomy', 'Review cycles']);
  const tile = row.querySelectorAll('.stat-tile')[1];
  assert.equal(tile.querySelector('.stat-value').textContent, '$424.38');       // 12.5×35 − 13.12
  assert.equal(tile.querySelector('.stat-sub').textContent, '≈ 12.5 h of human work');
  assert.ok(tile.querySelector('.stat-value').classList.contains('is-pos'), 'a positive Saved figure is green');
  assert.equal(tile.querySelector('.stat-delta'), null, 'the previous window has no human record → no positive baseline');
  const tiny = recs.map((r, i) => (i === 0 ? { ...r, human: { hours: 0.1, byPhase: {} } } : r));
  const neg = renderTmKpiRow(aggregate(tiny, { range: 'this-month', now: NOW, humanRateUsd: 35 }), { doc, now: NOW }).querySelectorAll('.stat-tile')[1];
  assert.equal(neg.querySelector('.stat-value').textContent, '−$9.62');        // 0.1×35 − 13.12
  assert.ok(neg.querySelector('.stat-value').classList.contains('is-neg'));
  assert.equal(neg.querySelector('.stat-value').classList.contains('is-pos'), false);
  assert.equal(renderTmKpiRow(aggregate(recs, { range: 'this-month', now: NOW, humanRateUsd: 35 }), { doc, now: NOW }).querySelectorAll('.stat-tile').length, 6, 'no human → no tile');
});
