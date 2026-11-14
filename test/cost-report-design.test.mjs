// test/cost-report-design.test.mjs — Design spend in the Statistics › Cost report, mirroring the Requirements tests in
// cost-report-requirements: its own last row after Requirements, part of the total, never allocated, out of the hours
// chart, dropped by a filter chip or when the server sends no report.design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { allocate, allocationSeries, reportCsv } from '../src/shared/cost/allocation.mjs';
import { createCostReport } from '../ui/public/cost-report.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

// ---- allocation (pure) ----
const run = (id, usd, tags) => ({ id, usd, hours: 1, inCohort: true, status: 'finished', pr: null,
  person: 'Developer A', project: 'web-app', workflow: 'Default', tags, spend: [[0, usd]], hourBucket: 0 });
const RUNS = [run('a', 6, { client: 'acme' }), run('g', 3, { client: 'globex' }), run('x', 1, {})];
const sum = (rows) => rows.reduce((a, r) => a + r.units, 0);

test('allocate: Design is the last row, part of the total, never allocated', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, askUsd: 1.2, requirementsUsd: 0.8, designUsd: 0.5 });
  assert.deepEqual(m.rows.map((r) => r.label), ['acme', 'globex', 'Unallocated', 'Chat', 'Requirements', 'Design']);
  const d = m.rows.at(-1);
  assert.deepEqual([d.kind, d.spentUsd, d.runs, d.humanHours], ['design', 0.5, 0, 0]);
  assert.equal(sum(m.rows), m.total.units);
  assert.equal(m.total.spentUsd, 12.5);
  assert.equal(m.allocatedShare, 9 / 12.5);
  assert.equal(allocate(RUNS, { by: 'tag:client', rate: 35 }).rows.some((r) => r.kind === 'design'), false);
});

test('series: Design stacks and adds up; hours leave it out; CSV has its row', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, designUsd: 0.5 });
  const s = allocationSeries(m, RUNS, { buckets: [0, 1], metric: 'spend', designSeries: [0.25, 0.25] });
  assert.deepEqual(s.find((x) => x.kind === 'design').values, [0.25, 0.25]);
  assert.equal(allocationSeries(m, RUNS, { buckets: [0, 1], metric: 'hours' }).some((x) => x.kind === 'design'), false);
  assert.ok(reportCsv(m, { byLabel: 'Client' }).split('\r\n').some((l) => l.startsWith('Design,0.5,')));
});

// ---- the report UI ----
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const DATA = {
  bucket: 'day', humanRateUsd: 35,
  report: {
    buckets: [Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2)],
    runs: RUNS, prevRuns: [run('p0', 4, { client: 'acme' })],
    ask: { spentUsd: 0.5, prevSpentUsd: 0, series: [0.5, 0] },
    requirements: { spentUsd: 0.75, prevSpentUsd: 0.25, series: [0.5, 0.25] },
    design: { spentUsd: 0.25, prevSpentUsd: 0, series: [0.25, 0] },
  },
};
function mount(data = DATA) {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const r = createCostReport({ doc, storage: mem() });
  doc.body.append(r.el);
  r.update({ data, dims: [{ key: 'client', label: 'Client' }], rangeLabel: 'Oct', range: 'month' });
  return doc;
}
const rowLabels = (doc) => [...doc.querySelectorAll('.cr-table tbody tr')].map((tr) => tr.querySelector('.cr-name').textContent);

test('report UI: a muted Design row last, no hours, no runs, Spent adds it; a filter chip or no data drops it', () => {
  const doc = mount();
  assert.deepEqual(rowLabels(doc), ['acme', 'globex', 'Unallocated', 'Chat', 'Requirements', 'Design']);
  const tr = [...doc.querySelectorAll('.cr-table tbody tr')].at(-1);
  assert.ok(tr.classList.contains('cr-kind-design'));
  assert.equal(tr.cells[3].textContent, '—'); assert.equal(tr.cells[6].textContent, '—');
  assert.match(doc.querySelector('.cr-kpis .stat-tile').textContent, /\$11\.50/);   // 10 runs + 0.5 Chat + 0.75 Requirements + 0.25 Design
  assert.match(readStyleCss(), /\.cr-table tr\.cr-kind-design td/);
  assert.equal(rowLabels(mount({ ...DATA, report: { ...DATA.report, design: null } })).includes('Design'), false);
  doc.querySelector('tr[data-path="v:acme"] .cr-value').click();
  assert.equal(rowLabels(doc).includes('Design'), false);
});

test('report UI: the chart stacks the Design series in lime; the previous period counts its Design spend', () => {
  const doc = mount({ ...DATA, report: { ...DATA.report, design: { spentUsd: 0.25, prevSpentUsd: 0.5, series: [0.25, 0] } } });
  assert.equal(doc.querySelector('path.cr-area[data-key="design"]').getAttribute('fill'), 'var(--lime)');
  assert.match(doc.querySelector('.ch-hit[data-i="0"]').dataset.tip, /^Design: \$0\.25$/m);
  // Spent $11.50 vs 4 (prevRuns) + 0.25 Requirements + 0.5 Design = 4.75
  assert.equal(doc.querySelector('.cr-kpis .stat-tile .stat-delta').textContent, '↑ 142%');
});
