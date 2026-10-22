// test/cost-report-requirements.test.mjs — Requirements spend (plans/requirements-design.md D9) in the Statistics ›
// Cost report, mirroring the Ask Worca (Chat) tests in cost-allocation, ui-cost-report and stats-groups: its own last
// row, part of the total, never allocated, out of the hours chart, dropped by a filter; with the flag off only money
// already spent shows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { allocate, allocationSeries, reportCsv } from '../src/shared/cost/allocation.mjs';
import { createCostReport } from '../ui/public/cost-report.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta, recordAskCostDelta, recordRequirementsCostDelta, roundUsd } from '../src/core/cost-budget.mjs';

// ---- allocation (pure) ----
const run = (id, usd, tags) => ({ id, usd, hours: 1, inCohort: true, status: 'finished', pr: null,
  person: 'Developer A', project: 'web-app', workflow: 'Default', tags, spend: [[0, usd]], hourBucket: 0 });
const RUNS = [run('a', 6, { client: 'acme' }), run('g', 3, { client: 'globex' }), run('x', 1, {})];
const sum = (rows) => rows.reduce((a, r) => a + r.units, 0);

test('allocate: Requirements is a last row after Chat and part of the total; allocated share leaves it out', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, askUsd: 1.2, requirementsUsd: 0.8 });
  assert.deepEqual(m.rows.map((r) => r.label), ['acme', 'globex', 'Unallocated', 'Chat', 'Requirements']);
  const req = m.rows.at(-1);
  assert.equal(req.kind, 'requirements');
  assert.equal(req.spentUsd, 0.8);
  assert.equal(req.runs, 0);
  assert.equal(req.humanHours, 0);
  assert.equal(sum(m.rows), m.total.units);
  assert.equal(m.total.spentUsd, 12);
  assert.equal(m.allocatedShare, 9 / 12);
  assert.equal(allocate(RUNS, { by: 'tag:client', rate: 35 }).rows.some((r) => r.kind === 'requirements'), false, 'no spend, no row');
});

test('series: the Requirements series stacks and the total adds up; hours leave it out', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, askUsd: 1, requirementsUsd: 0.5 });
  const s = allocationSeries(m, RUNS, { buckets: [0, 1], metric: 'spend', askSeries: [1, 0], requirementsSeries: [0.25, 0.25] });
  const units = (i) => s.reduce((a, x) => a + Math.round(x.values[i] * 1e4), 0);
  assert.equal(units(0) + units(1), m.total.units);
  assert.deepEqual(s.find((x) => x.kind === 'requirements').values, [0.25, 0.25]);
  assert.equal(allocationSeries(m, RUNS, { buckets: [0, 1], metric: 'hours' }).some((x) => x.kind === 'requirements'), false);
});

test('CSV: the Requirements row is a row of its own', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, requirementsUsd: 0.5 });
  assert.ok(reportCsv(m, { byLabel: 'Client' }).split('\r\n').some((l) => l.startsWith('Requirements,0.5,')));
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

test('report UI: a muted Requirements row after Chat, no hours, and Spent adds it in', () => {
  const doc = mount();
  assert.deepEqual(rowLabels(doc), ['acme', 'globex', 'Unallocated', 'Chat', 'Requirements']);
  const tr = [...doc.querySelectorAll('.cr-table tbody tr')].at(-1);
  assert.ok(tr.classList.contains('cr-kind-requirements'));
  assert.equal(tr.cells[3].textContent, '—', 'no human hours');
  assert.equal(tr.cells[6].textContent, '—', 'no runs');
  assert.match(doc.querySelector('.cr-kpis .stat-tile').textContent, /\$11\.25/);     // 10 runs + 0.5 Chat + 0.75 Requirements
  assert.match(readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8'), /\.cr-table tr\.cr-kind-requirements td/);
});


test('report UI: no report.requirements (a filtered server answer, or an older server) → no row', () => {
  const doc = mount({ ...DATA, report: { ...DATA.report, requirements: null } });
  assert.equal(rowLabels(doc).includes('Requirements'), false);
});

test('report UI: a filter chip drops Requirements like Chat', () => {
  const doc = mount();
  doc.querySelector('tr[data-path="v:acme"] .cr-value').click();
  assert.equal(rowLabels(doc).includes('Requirements'), false);
  assert.equal(rowLabels(doc).includes('Chat'), false);
});

// ---- GET /api/stats?report=1 data (getStats) ----
useTempHome(after);
let sandboxHome; const prevEnv = {};
const NOW = new Date(2026, 8, 10, 12);                  // lastMonth = August 2026
const at = (m, d, hh = 12) => +new Date(2026, m - 1, d, hh);
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-costreq-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
  const { id } = await seedPipeline('/tmp/p', { status: 'done' });
  getDb().prepare('UPDATE pipelines SET started_at = ?, started_by = ? WHERE id = ?').run(new Date(at(8, 3)).toISOString(), 'alice', id);
  recordCostDelta({ pipelineId: id, amountUsd: 2, tsMs: at(8, 3) });
  recordAskCostDelta({ threadId: 't1', messageId: 'm1', amountUsd: 0.5, tokens: 10, model: 'x', tsMs: at(8, 4) });
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 1, amountUsd: 0.75, tsMs: at(8, 5) });
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 2, amountUsd: 0.25, tsMs: at(7, 5) });    // the month before
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('report data: requirements beside ask; runs + Chat + Requirements = Spent; series per bucket', () => {
  const s = getStats({ requirementsEnabled: true, range: 'lastMonth', now: NOW, report: true });
  const r = s.report.requirements;
  assert.equal(r.spentUsd, 0.75);
  assert.equal(r.prevSpentUsd, 0.25);
  assert.equal(r.series.length, s.report.buckets.length);
  assert.equal(r.series[4], 0.75, 'the 5 August bucket');
  assert.equal(roundUsd(s.totals.pipelineSpendUsd + s.report.ask.spentUsd + r.spentUsd), s.totals.spentUsd);
});

test('report data: a filter drops Requirements like Chat', () => {
  const s = getStats({ requirementsEnabled: true, range: 'lastMonth', now: NOW, report: true, filter: { person: 'alice' } });
  assert.equal(s.report.requirements, null);
  assert.equal(s.report.ask, null);
});

test('report data, flag off: report.requirements only when there is spend to show', () => {
  const s = getStats({ requirementsEnabled: false, range: 'lastMonth', now: NOW, report: true });
  assert.equal(s.report.requirements.spentUsd, 0.75, 'August spend stays visible');
  assert.equal(roundUsd(s.totals.pipelineSpendUsd + s.report.ask.spentUsd + s.report.requirements.spentUsd), s.totals.spentUsd);
  const none = getStats({ requirementsEnabled: false, range: 'lastMonth', now: new Date(2025, 8, 10, 12), report: true });
  assert.equal('requirements' in none.report, false, 'no spend: the API shape is the one without Requirements');
  assert.equal('requirements' in none.totals, false);
  const filtered = getStats({ requirementsEnabled: false, range: 'lastMonth', now: NOW, report: true, filter: { person: 'alice' } });
  assert.equal('requirements' in filtered.report, false);
});
