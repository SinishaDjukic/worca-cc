// test/ui-cost-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCostReport, loadViews, saveView, COST_STATE_KEY, COST_VIEWS_KEY } from '../ui/public/cost-report.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const fact = (id, usd, tags, extra = {}) => ({ id, usd, hours: 2, inCohort: true, status: 'finished', pr: null,
  person: 'Developer A', project: 'web-app', workflow: 'Default', tags, spend: [[0, usd]], hourBucket: 0, ...extra });
const DATA = {
  bucket: 'day', humanRateUsd: 35,
  report: {
    buckets: [Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2)],
    runs: [fact('p1', 6, { client: 'acme', project: 'web-app' }), fact('p2', 3, { client: 'acme', project: 'api' }),
      fact('p3', 2, { client: 'globex', project: 'api' }), fact('p4', 1, {})],
    prevRuns: [fact('p0', 4, { client: 'acme' })],
    ask: { spentUsd: 0.5, prevSpentUsd: 0, series: [0.5, 0] },
  },
};
function mount(opts = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const calls = { open: [], csv: [] };
  const storage = opts.storage || mem();
  if (opts.state) storage.setItem('worca-cc.stats.cost.v1', JSON.stringify(opts.state));
  const r = createCostReport({ doc, storage, onOpenRuns: (ids) => calls.open.push(ids), onDownload: (csv, name) => calls.csv.push({ csv, name }) });
  doc.body.append(r.el);
  r.update({ data: DATA, dims: [{ key: 'client', label: 'Client' }], rangeLabel: 'Oct 1 – Oct 31', range: 'month' });
  return { doc, r, calls, storage };
}
const rowLabels = (doc) => [...doc.querySelectorAll('.cr-table tbody tr')].map((tr) => tr.querySelector('.cr-name').textContent);

test('expanding a table row inserts its second-level rows right under it; collapsing removes them', () => {
  const { doc } = mount({ state: { by: 'tag:client', thenBy: 'tag:project' } });
  assert.deepEqual(rowLabels(doc), ['acme', 'globex', 'Unallocated', 'Chat']);
  const exp = doc.querySelector('tr[data-path="v:acme"] .cr-expand');
  assert.equal(exp.getAttribute('aria-expanded'), 'false');
  exp.click();
  assert.deepEqual(rowLabels(doc), ['acme', 'web-app', 'api', 'globex', 'Unallocated', 'Chat']);
  assert.ok(doc.querySelector('tr[data-path="v:acme/v:web-app"]').classList.contains('cr-row-child'));
  assert.equal(doc.querySelector('tr[data-path="v:acme"] .cr-expand').getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement, doc.querySelector('tr[data-path="v:acme"] .cr-expand'), 'focus stays on the toggle');
  doc.querySelector('tr[data-path="v:acme"] .cr-expand').click();
  assert.deepEqual(rowLabels(doc), ['acme', 'globex', 'Unallocated', 'Chat']);
});

test('KPIs: 5 tiles, delta vs previous, Allocated share; Saved red when negative', () => {
  const { doc } = mount({ state: { by: 'tag:client' } });
  // tile() puts the delta chip (span.stat-delta) inside .stat-label too: take only the label span.
  const labels = [...doc.querySelectorAll('.cr-kpis .stat-label > span:not(.stat-delta)')].map((n) => n.textContent);
  assert.deepEqual(labels, ['Spent', 'Human hours', 'Saved', 'Cost per hour', 'Allocated']);
  assert.match(doc.querySelector('.cr-kpis .stat-tile').textContent, /\$12\.50/);
  assert.ok(doc.querySelector('.cr-kpis .stat-delta'));
});

test('clicking a value adds a filter chip; Ask Worca leaves; the chip × removes it', () => {
  const { doc } = mount({ state: { by: 'tag:client', thenBy: 'tag:project' } });
  doc.querySelector('tr[data-path="v:acme"] .cr-value').click();
  assert.equal(doc.querySelector('.cr-chip').textContent.trim(), 'Client = acme');
  assert.deepEqual(rowLabels(doc), ['web-app', 'api'], 'then by moved up to Allocate by');
  doc.querySelector('.cr-chip-x').click();
  assert.equal(doc.querySelector('.cr-chip'), null);
});

test('Runs opens the row\'s runs (and adds no filter); Tag N runs opens the Unallocated runs', () => {
  const { doc, calls } = mount({ state: { by: 'tag:client' } });
  doc.querySelector('tr[data-path="v:acme"] .cr-runs').click();
  assert.deepEqual(calls.open[0], ['p1', 'p2']);
  assert.equal(doc.querySelector('.cr-chip'), null, 'a click in a value row outside the value button adds no filter');
  const tag = doc.querySelector('.cr-tag-runs');
  assert.equal(tag.textContent, 'Tag 1 run');
  tag.click();
  assert.deepEqual(calls.open[1], ['p4']);
});

test('Download CSV hands over today\'s columns plus hours under the report file name', () => {
  const { doc, calls } = mount({ state: { by: 'tag:client' } });
  doc.querySelector('.cr-csv').click();
  assert.equal(calls.csv[0].name, 'statistics-month-cost-client.csv');
  assert.match(calls.csv[0].csv, /Client,spendUsd,runs,finished,stopped,failed,running,paused,prsOpened,prsMerged,humanHours,savedUsd,usdPerHour\r\n/);
});

test('saved views: save, replace a same-name view, apply, delete — per browser storage only', () => {
  const storage = mem();
  saveView(storage, 'Client chargeback', { by: 'tag:client', thenBy: 'tag:project', metric: 'spend', filters: [] });
  saveView(storage, 'client chargeback', { by: 'tag:client', thenBy: '', metric: 'hours', filters: [] });
  assert.deepEqual(loadViews(storage).map((v) => [v.name, v.metric]), [['client chargeback', 'hours']]);
  const { doc } = mount({ storage, state: { by: 'person' } });
  const sel = doc.querySelector('.cr-views');
  sel.value = 'client chargeback';
  sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('.cr-dim[data-role="by"]').textContent, 'Client');
  doc.querySelector('.cr-delete-view').click();
  assert.deepEqual(JSON.parse(storage.getItem(COST_VIEWS_KEY)), []);
});

test('picking from Allocate by repaints and puts the focus on the new Allocate by button', () => {
  const { doc } = mount({ state: { by: 'tag:client' } });
  doc.querySelector('.cr-dim[data-role="by"]').click();
  const pick = [...doc.querySelectorAll('.cr-pick-row')].find((b) => b.dataset.id === 'person');
  pick.click();
  const by = doc.querySelector('.cr-dim[data-role="by"]');
  assert.equal(by.textContent, 'Person');
  assert.equal(doc.activeElement, by, 'focus follows the repainted button, not the removed one');
});

test('Saved KPI turns red through .stat-value.is-neg when spend beats the hours value', () => {
  const { doc, r } = mount({ state: { by: 'tag:client' } });
  r.update({ data: { ...DATA, humanRateUsd: 0 }, dims: [{ key: 'client', label: 'Client' }], range: 'month' });
  const saved = [...doc.querySelectorAll('.cr-kpis .stat-tile')].find((t) => /Saved/.test(t.textContent));
  assert.ok(saved.querySelector('.stat-value').classList.contains('is-neg'));
});

test('filters that match nothing show the empty card with Clear filters', () => {
  const { doc } = mount({ state: { by: 'tag:client', filters: [{ dim: 'person', value: 'Developer B' }] } });
  assert.equal(doc.querySelector('.cr-empty-card .chart-empty').textContent, 'No runs match these filters.');
  doc.querySelector('.cr-clear-filters').click();
  assert.equal(doc.querySelector('.cr-empty-card').hidden, true);
});

test('Add filter on a filtered dimension offers every value, so a second chip on it can replace the first', () => {
  const { doc } = mount({ state: { by: 'person', filters: [{ dim: 'tag:client', value: 'acme' }] } });
  doc.querySelector('.cr-add-filter').click();
  [...doc.querySelectorAll('.cr-pick-row')].find((b) => b.dataset.id === 'tag:client').click();
  const vals = [...doc.querySelectorAll('.cr-pick-row')].map((b) => b.dataset.id);
  assert.ok(vals.includes('globex'), `globex is offered: ${vals}`);
  [...doc.querySelectorAll('.cr-pick-row')].find((b) => b.dataset.id === 'globex').click();
  assert.deepEqual([...doc.querySelectorAll('.cr-chip')].map((c) => c.textContent.trim()), ['Client = globex']);
});

test('Allocated reads 0% (not —) when every run in view is Unallocated', () => {
  const { doc } = mount({ state: { by: 'tag:client', filters: [{ dim: 'tag:client', value: null }] } });
  const tile = [...doc.querySelectorAll('.cr-kpis .stat-tile')].find((t) => /Allocated/.test(t.textContent));
  assert.equal(tile.querySelector('.stat-value').textContent, '0%');
});

test('style.css: a negative cell stays red in Unallocated and Ask Worca rows', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const kind = css.indexOf('.cr-table tr.cr-kind-none td');
  const neg = css.indexOf('.cr-table tr td.is-neg');
  assert.ok(kind > 0 && neg > kind, 'the is-neg rule matches the kind rule\'s specificity and comes after it');
});

test('team options: own storage keys, no run links, csvName, and the extras slots around the table', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const storage = mem();
  let csvName = '';
  const seen = [];
  const r = createCostReport({ doc, storage, onOpenRuns: null, stateKey: 'tm.cost', viewsKey: 'tm.views',
    csvName: (_st, key) => `team-cost-${key}.csv`, onDownload: (_csv, name) => { csvName = name; },
    extras: (ctx) => { seen.push([ctx.by, ctx.byLabel, ctx.runs.length]);
      return { lead: Object.assign(doc.createElement('p'), { className: 'lead-x' }), tail: [Object.assign(doc.createElement('p'), { className: 'tail-x' })] }; } });
  doc.body.append(r.el);
  r.update({ data: { ...DATA, report: { ...DATA.report, ask: null } }, dims: [{ key: 'client', label: 'Client' }], rangeLabel: 'Oct', range: 'month' });
  assert.deepEqual(seen.at(-1), ['tag:client', 'Client', 4]);
  const kids = [...r.el.children];
  assert.ok(kids.indexOf(r.el.querySelector('.cr-lead')) < kids.indexOf(r.el.querySelector('.cr-chart-card')));
  assert.ok(kids.indexOf(r.el.querySelector('.cr-tail')) > kids.indexOf(r.el.querySelector('.cr-table-card')));
  assert.ok(r.el.querySelector('.cr-lead .lead-x') && r.el.querySelector('.cr-tail .tail-x'));
  assert.equal(r.el.querySelector('.cr-runs'), null);                         // no run links
  assert.match(r.el.querySelector('.cr-table tbody tr').cells[6].textContent, /^\d+ runs?$/);
  assert.equal(r.el.querySelector('.cr-tag-runs'), null);
  r.el.querySelector('.cr-csv').click();
  assert.equal(csvName, 'team-cost-client.csv');
  r.el.querySelector('.cr-metric [data-metric="hours"]').click();          // persists the report state
  assert.equal(JSON.parse(storage.getItem('tm.cost')).metric, 'hours');
  assert.equal(storage.getItem(COST_STATE_KEY), null);
  saveView(storage, 'Chargeback', { by: 'tag:client' }, 'tm.views');
  assert.deepEqual(loadViews(storage, 'tm.views').map((v) => v.name), ['Chargeback']);
  assert.deepEqual(loadViews(storage), []);
});

test('extras: hidden with the empty card when filters match nothing', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const storage = mem();
  storage.setItem('tm.cost', JSON.stringify({ by: 'tag:client', filters: [{ dim: 'tag:client', value: 'nobody' }] }));
  const r = createCostReport({ doc, storage, stateKey: 'tm.cost', onOpenRuns: null,
    extras: () => ({ lead: doc.createElement('p'), tail: [doc.createElement('p')] }) });
  doc.body.append(r.el);
  r.update({ data: DATA, dims: [{ key: 'client', label: 'Client' }], rangeLabel: 'Oct', range: 'month' });
  assert.equal(r.el.querySelector('.cr-lead').hidden, true);
  assert.equal(r.el.querySelector('.cr-tail').hidden, true);
  assert.equal(r.el.querySelector('.cr-empty-card').hidden, false);
});

test('stacked on phones, every table cell is the row name or carries its column label', () => {
  const { doc } = mount({ state: { by: 'tag:client' } });
  const heads = [...doc.querySelectorAll('.cr-table thead th')].map((th) => th.textContent);
  for (const tr of doc.querySelectorAll('.cr-table tbody tr')) {
    const cells = [...tr.cells];
    assert.ok(cells[0].classList.contains('table-main'));
    assert.deepEqual(cells.slice(1).map((td) => td.dataset.label), heads.slice(1));
  }
});
