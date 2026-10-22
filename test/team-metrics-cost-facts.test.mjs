import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import { recordFact, recordFacts, costBuckets, heatGrid, missingKeyTodos } from '../src/shared/team-metrics/cost-facts.mjs';

const fact = (id, person, usd, tags = {}) => ({ id, person, usd, hours: 1, inCohort: true, status: 'finished', pr: null,
  project: 'acme/web', workflow: 'Auto', tags, spend: [[0, usd]], hourBucket: 0 });
const SAMPLE = [
  fact('a1', 'Developer A', 4, { client: 'acme' }), fact('a2', 'Developer A', 2, { client: 'acme' }),
  fact('a3', 'Developer A', 2, { client: 'globex' }), fact('a4', 'Developer A', 1),
  fact('b1', 'Developer B', 3, { client: 'acme' }), fact('n1', null, 1.25, { client: 'globex' }),
];

test('heat grid: one cell per person × column, and each person\'s cells sum to their total', () => {
  const g = heatGrid(SAMPLE, { by: 'tag:client' });
  assert.deepEqual(g.columns.map((c) => c.label), ['acme', 'globex', 'Unallocated']);
  assert.deepEqual(g.people.map((p) => [p.label, p.spentUsd]), [['Developer A', 9], ['Developer B', 3], ['Unallocated', 1.25]]);
  assert.equal(g.cells.length, g.people.length * g.columns.length);
  for (const p of g.people) {
    const sum = g.cells.filter((c) => c.person === p.key).reduce((a, c) => a + Math.round(c.spentUsd * 1e4), 0) / 1e4;
    assert.equal(sum, p.spentUsd, p.label);
  }
  const cell = (who, col) => g.cells.find((c) => c.person === g.people.find((p) => p.label === who).key
    && c.col === g.columns.find((x) => x.label === col).key);
  assert.deepEqual([cell('Developer A', 'acme').spentUsd, cell('Developer A', 'acme').runs], [6, 2]);
  assert.equal(cell('Developer B', 'globex').spentUsd, 0);
  assert.equal(g.maxUsd, 6);
});

test('heat grid: values past the top 5 share one Other column; Allocate by Person has no grid', () => {
  const many = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((c, i) => fact(`x${i}`, 'Developer A', 7 - i, { client: c }));
  const g = heatGrid(many, { by: 'tag:client' });
  assert.deepEqual(g.columns.map((c) => c.label), ['c1', 'c2', 'c3', 'c4', 'c5', 'Other (2)']);
  assert.equal(g.cells.find((c) => c.col === 'other').spentUsd, 3);   // c6 (2) + c7 (1)
  assert.equal(heatGrid(many, { by: 'person' }), null);
});

test('missing keys: Developer A with 3 runs and their spend when 3 of their runs lack the required client key', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const at = '2026-10-10T10:00:00Z';
  const records = [
    makeRecord({ id: 'a1', startedAt: at, usd: 1.5, actor: 'Developer A' }),
    makeRecord({ id: 'a2', startedAt: at, usd: 2, actor: 'Developer A' }),
    { ...makeRecord({ id: 'a3', startedAt: at, usd: 0.5, actor: 'Developer A' }), tags: ['spike'] },
    { ...makeRecord({ id: 'a4', startedAt: at, usd: 9, actor: 'Developer A' }), tags: ['client:acme'] },
    makeRecord({ id: 'b1', startedAt: at, usd: 0.8, actor: 'Developer B' }),
  ];
  const { runs } = recordFacts(records, { range: 'this-month', now });
  const todo = missingKeyTodos(runs, [{ key: 'client', label: 'Client', required: true }, { key: 'team', label: 'Team', required: false }]);
  assert.deepEqual(todo.keys, ['client']);
  assert.deepEqual(todo.rows, [
    { person: 'Developer A', label: 'Developer A', runs: 3, spentUsd: 4, keys: ['client'] },
    { person: 'Developer B', label: 'Developer B', runs: 1, spentUsd: 0.8, keys: ['client'] },
  ]);
  assert.deepEqual(missingKeyTodos(runs, [{ key: 'client', required: false }]), { keys: [], rows: [] });
});

test('recordFact: tags as an object, actor as person, status and project mapped; record format untouched', () => {
  const r = { ...makeRecord({ id: 'r1', usd: 2.5, actor: 'Developer A', result: 'stopped', pr: { number: 7, url: 'https://x/7' } }),
    tags: ['client:acme', 'spike'], human: { hours: 1.5 } };
  const before = JSON.stringify(r);
  const f = recordFact(r);
  assert.deepEqual({ ...f, startedMs: undefined }, { id: 'r1', person: 'Developer A', project: 'acme/billing-api', workflow: 'Auto',
    status: 'stopped', pr: 'opened', tags: { client: 'acme', spike: '' }, usd: 2.5, hours: 1.5, inCohort: true,
    startedMs: undefined, spend: [], hourBucket: -1 });
  assert.equal(JSON.stringify(r), before);
  assert.equal(recordFact(makeRecord({ id: 'w', kind: 'workspace', workspace: 'IoT SP Platform' })).project, 'IoT SP Platform');
  assert.equal(recordFact({ ...makeRecord({ id: 'n' }), actor: null }).person, null);
});

test('recordFacts: day buckets for a month, cost in the start bucket, previous period, month buckets past 62 days', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const recs = [makeRecord({ id: 'a', startedAt: '2026-10-03T09:00:00Z', usd: 2 }), makeRecord({ id: 'p', startedAt: '2026-09-05T09:00:00Z', usd: 1 })];
  const m = recordFacts(recs, { range: 'this-month', now });
  assert.equal(m.bucket, 'day');
  assert.equal(m.buckets.length, 31);
  assert.deepEqual(m.runs.map((f) => [f.id, f.spend, f.hourBucket]), [['a', [[2, 2]], 2]]);
  assert.deepEqual(m.prevRuns.map((f) => f.id), ['p']);
  const all = recordFacts(recs, { range: 'all', now });
  assert.equal(all.prevRuns, null);
  assert.equal(all.bucket, 'day');                        // Sep 5 → Oct 20 is 46 days
  assert.equal(costBuckets(Date.UTC(2026, 0, 1), Date.UTC(2026, 9, 1)).bucket, 'month');
  assert.equal(costBuckets(Date.UTC(2026, 0, 1), Date.UTC(2026, 9, 1)).buckets.length, 9);
});

test('recordFacts: All time draws at most 3660 days; an older record still counts, without a chart bucket', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const recs = [makeRecord({ id: 'old', startedAt: '1000-01-01T00:00:00Z', usd: 5 }), makeRecord({ id: 'new', startedAt: '2026-10-03T09:00:00Z', usd: 2 })];
  const all = recordFacts(recs, { range: 'all', now });
  assert.equal(all.bucket, 'month');
  assert.ok(all.buckets.length <= 122, `${all.buckets.length} buckets`);
  assert.deepEqual(all.runs.map((f) => [f.id, f.usd, f.spend.length]), [['old', 5, 0], ['new', 2, 1]]);
});
