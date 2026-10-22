// test/cost-allocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, formatShare, costPerHour, savedUsd, reportCsv, dimensionOptions, filterDimensionOptions,
  allocationSeries, TODAY_CSV_COLS, HOURS_CSV_COLS } from '../src/shared/cost/allocation.mjs';
import { groupsToCsv } from '../ui/public/stats-view.mjs';

const run = (id, usd, tags, extra = {}) => ({ id, usd, hours: 1, inCohort: true, status: 'finished', pr: null,
  person: 'Developer A', project: 'web-app', workflow: 'Default', tags, spend: [[0, usd]], hourBucket: 0, ...extra });
const CLIENTS = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark', 'wayne'];
const RUNS = [
  ...CLIENTS.flatMap((c, i) => [
    run(`${c}-1`, 10 - i + 0.3333, { client: c, project: 'web-app' }),
    run(`${c}-2`, 2.1111, { client: c, project: i % 2 ? 'api' : 'web-app' }),
  ]),
  run('loose-1', 1.5, {}),                        // no client → Unallocated
  run('loose-2', 0.25, { project: 'api' }),
  run('spender', 0.4, { client: 'acme' }, { inCohort: false, hours: 0 }),   // spent here, started earlier
];
const sum = (rows) => rows.reduce((a, r) => a + r.units, 0);

test('by client then project: top 5 + Other + Unallocated; spend sums equal the total, children sum to each parent', () => {
  const m = allocate(RUNS, { by: 'tag:client', thenBy: 'tag:project', rate: 35, askUsd: 0 });
  assert.deepEqual(m.rows.map((r) => r.kind), ['value', 'value', 'value', 'value', 'value', 'other', 'none']);
  assert.deepEqual(m.rows.slice(0, 5).map((r) => r.label), ['acme', 'globex', 'initech', 'umbrella', 'hooli']);
  assert.equal(m.rows[5].label, 'Other (2)');
  assert.equal(m.rows[6].label, 'Unallocated');
  assert.equal(sum(m.rows), m.total.units);
  const expected = Math.round(RUNS.reduce((a, r) => a + r.usd, 0) * 1e4);
  assert.equal(m.total.units, expected);
  for (const r of m.rows.filter((x) => x.kind !== 'other')) assert.equal(sum(r.children), r.units, `${r.label} children`);
  const other = m.rows[5];
  assert.equal(sum(other.members), other.units);
  assert.equal(m.rows[0].runs, 2, 'the spender counts money, not a run');
});

test('Ask Worca is a last row and is part of the total; allocated share leaves it and Unallocated out', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, askUsd: 1.2 });
  assert.equal(m.rows.at(-1).label, 'Chat');
  assert.equal(sum(m.rows), m.total.units);
  const allocated = sum(m.rows.filter((r) => r.kind === 'value' || r.kind === 'other'));
  assert.equal(m.allocatedShare, allocated / m.total.units);
});

test('a single leftover value is shown as itself, not as Other (1)', () => {
  const six = RUNS.filter((r) => r.tags.client !== 'wayne');
  const m = allocate(six, { by: 'tag:client', rate: 35 });
  assert.equal(m.rows.filter((r) => r.kind === 'value').length, 6);
  assert.equal(m.rows.some((r) => r.kind === 'other'), false);
});

test('a 0.3% share formats as <1%; 0 spend never shows 0% for a non-empty row', () => {
  assert.equal(formatShare(0.3, 100), '<1%');
  assert.equal(formatShare(0, 100), '—');
  assert.equal(formatShare(0.6, 100), '<1%');                 // still under one percent: never rounded up to 1%
  assert.equal(formatShare(1.4, 100), '1%');
  assert.equal(formatShare(99.6, 100), '>99%');
  assert.equal(formatShare(100, 100), '100%');
  const m = allocate([run('free', 0, { client: 'acme' }), run('paid', 5, { client: 'globex' })], { by: 'tag:client', rate: 35 });
  for (const r of m.rows) assert.notEqual(formatShare(r.units, m.total.units), '0%');
});

test('Saved = hours × rate − spend; cost per hour = spend ÷ hours, 0 hours → null (not Infinity)', () => {
  assert.equal(savedUsd(10, 35, 50), 300);
  assert.equal(savedUsd(1, 35, 50), -15);
  assert.equal(costPerHour(50, 10), 5);
  assert.equal(costPerHour(50, 0), null);
  assert.equal(costPerHour(0, 0), null);
  const m = allocate([run('a', 50, { client: 'acme' }, { hours: 0 })], { by: 'tag:client', rate: 35 });
  assert.equal(m.rows[0].usdPerHour, null);
  assert.equal(m.rows[0].savedUsd, -50);
});

test('the CSV header equals today\'s columns plus the hours columns', () => {
  const today = groupsToCsv({ label: 'client', rows: [] }).replace(/^\uFEFF/, '').split('\r\n')[0];
  const m = allocate(RUNS, { by: 'tag:client', rate: 35 });
  const csv = reportCsv(m, { byLabel: 'client' });
  assert.equal(csv.replace(/^\uFEFF/, '').split('\r\n')[0], `${today},${HOURS_CSV_COLS.join(',')}`);
  assert.equal(today, ['client', ...TODAY_CSV_COLS].join(','));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + CLIENTS.length + 1, 'Other unfolded, plus Unallocated');
});

test('then by adds a second label column and one row per leaf', () => {
  const m = allocate(RUNS, { by: 'tag:client', thenBy: 'tag:project', rate: 35 });
  const [head, first] = reportCsv(m, { byLabel: 'client', thenByLabel: 'project' }).replace(/^\uFEFF/, '').split('\r\n');
  assert.match(head, /^client,project,spendUsd,/);
  assert.match(first, /^acme,web-app,/);
});

test('a negative Saved exports as a number, not a guarded text cell', () => {
  const m = allocate([run('a', 50, { client: 'acme' }, { hours: 1 })], { by: 'tag:client', rate: 35 });
  const row = reportCsv(m, { byLabel: 'client' }).replace(/^\uFEFF/, '').split('\r\n')[1];
  assert.equal(row.split(',').at(-2), '-15', 'savedUsd = 1 h × $35 − $50');
});

test('row keys encode the value, so a "/" in it cannot split a row path', () => {
  const m = allocate([run('a', 1, { client: 'acme/eu' })], { by: 'tag:client', rate: 35 });
  assert.equal(m.rows[0].key, 'v:acme%2Feu');
  assert.equal(m.rows[0].label, 'acme/eu');
});

test('a deleted run\'s spend (orphan fact) is drawn in Unallocated but cannot be opened or tagged', () => {
  const orphan = { id: 'orphan:gone', orphan: true, usd: 2, hours: 0, inCohort: false, tags: {}, spend: [[0, 2]], hourBucket: -1 };
  const m = allocate([run('a', 1, { client: 'acme' }), orphan], { by: 'tag:client', rate: 35 });
  const none = m.rows.find((r) => r.kind === 'none');
  assert.deepEqual(none.runIds, []);
  const s = allocationSeries(m, [run('a', 1, { client: 'acme' }), orphan], { buckets: [0], metric: 'spend' });
  assert.equal(s.find((x) => x.kind === 'none').values[0], 2);
});

test('dimension options: policy dims, then built-ins, then other keys by share of spend', () => {
  const opts = dimensionOptions({ dims: [{ key: 'client', label: 'Client' }], runs: RUNS });
  assert.deepEqual(opts.slice(0, 5).map((o) => o.id), ['tag:client', 'person', 'project', 'workflow', 'status']);
  assert.deepEqual(opts.slice(5).map((o) => o.id), ['tag:project']);
  assert.equal(filterDimensionOptions(opts, 'PROJ').map((o) => o.id).join(), 'project,tag:project');
});

test('series: spend stacks per row and sums to the total; hours leave Ask Worca out', () => {
  const m = allocate(RUNS, { by: 'tag:client', rate: 35, askUsd: 1 });
  const s = allocationSeries(m, RUNS, { buckets: [0, 1], metric: 'spend', askSeries: [1, 0] });
  const total = s.reduce((a, x) => a + Math.round(x.values[0] * 1e4), 0);
  assert.equal(total, m.total.units);
  assert.equal(allocationSeries(m, RUNS, { buckets: [0, 1], metric: 'hours' }).some((x) => x.kind === 'ask'), false);
});
