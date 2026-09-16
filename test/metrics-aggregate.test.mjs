// test/metrics-aggregate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Pure module directly — read.mjs would pull in sync/DB/projects for no reason.
import { aggregate, resolveRange, weekStartMs, parseRecordLine, toCsv, safeHttpUrl } from '../src/shared/team-metrics/aggregate.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const NOW = Date.parse('2026-09-16T12:00:00Z');

test('ranges are UTC calendar windows; the previous window is like-for-like while the current one is open', () => {
  const m = resolveRange('this-month', { now: NOW });
  assert.equal(new Date(m.startMs).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(new Date(m.endMs).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(new Date(m.prevStartMs).toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(new Date(m.prevEndMs).toISOString(), '2026-08-16T12:00:00.000Z');   // same 15.5 days elapsed
  const q = resolveRange('quarter', { now: NOW });
  assert.equal(new Date(q.startMs).toISOString(), '2026-07-01T00:00:00.000Z');
  const lm = resolveRange('last-month', { now: Date.parse('2026-01-10T00:00:00Z') });
  assert.equal(new Date(lm.startMs).toISOString(), '2025-12-01T00:00:00.000Z');
  assert.equal(new Date(lm.prevEndMs).toISOString(), '2025-12-01T00:00:00.000Z');   // closed window: full previous month
  const c = resolveRange('custom', { now: NOW, from: '2026-09-01', to: '2026-09-07' });
  assert.equal(c.endMs - c.startMs, 7 * 86_400_000);
  assert.throws(() => resolveRange('week', { now: NOW }), RangeError);
  assert.throws(() => resolveRange('custom', { from: '2026-09-07', to: '2026-09-01' }), RangeError);
  assert.throws(() => resolveRange('custom', { from: '2026-02-01', to: '2026-02-31' }), RangeError);   // no silent roll-over
  assert.throws(() => resolveRange('custom', { from: '0001-01-01', to: '9999-12-31' }), RangeError);   // bounded span
});

test('month boundary is decided in UTC, not local time; deltas compare like-for-like', () => {
  const recs = [
    makeRecord({ id: 'a', startedAt: '2026-08-31T23:59:59Z', usd: 1 }),  // last month, after the like-for-like cut
    makeRecord({ id: 'b', startedAt: '2026-09-01T00:00:00Z', usd: 2 }),
    makeRecord({ id: 'c', startedAt: '2026-08-10T00:00:00Z', usd: 4 }),  // inside Aug 1–16 12:00
  ];
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  assert.equal(agg.kpis.runs, 1); assert.equal(agg.kpis.spendUsd, 2);
  assert.equal(agg.prev.runs, 1); assert.equal(agg.prev.spendUsd, 4);
  assert.equal(agg.deltas.spendPct, -0.5);
});

test('series include a record dated after now (clock skew) and survive very large inputs', () => {
  const ahead = makeRecord({ id: 'f', startedAt: '2026-09-29T10:00:00Z', usd: 1 });
  const agg = aggregate([ahead], { range: 'this-month', now: NOW });
  assert.ok(agg.series.spend.some((p) => p.weekStartMs === Date.parse('2026-09-28T00:00:00Z') && p.totalUsd === 1));
  const many = Array.from({ length: 150_000 }, (_, i) => makeRecord({ id: `m${i}`, startedAt: '2026-09-10T10:00:00Z' }));
  assert.equal(aggregate(many, { range: 'all', now: NOW }).kpis.runs, 150_000);
});

test('hostile or non-UTC startedAt values cannot blow up the series', () => {
  assert.deepEqual(parseRecordLine(JSON.stringify({ ...makeRecord({ id: 'l' }), startedAt: '2026-09-01 00:30' })), { malformed: true });
  assert.deepEqual(parseRecordLine(JSON.stringify({ ...makeRecord({ id: 'x' }), startedAt: '+200000-01-01T00:00:00Z' })), { malformed: true });
  // Records that bypass parseRecordLine (e.g. the browser re-aggregating) are still bounded.
  const far = [makeRecord({ id: 'a', startedAt: '1900-01-01T00:00:00Z' }), makeRecord({ id: 'b', startedAt: '9999-01-01T00:00:00Z' })];
  const agg = aggregate(far, { range: 'all', now: NOW });
  assert.ok(agg.series.spend.length <= Math.ceil(3660 / 7) + 2, `weeks: ${agg.series.spend.length}`);
  assert.equal(agg.kpis.runs, 2);
});

test('record-supplied keys such as constructor / __proto__ stay ordinary stack keys', () => {
  const recs = [
    makeRecord({ id: '1', startedAt: '2026-09-07T10:00:00Z', usd: 2, workflow: { id: 'constructor', name: 'constructor' } }),
    makeRecord({ id: '2', startedAt: '2026-09-07T11:00:00Z', usd: 3, workflow: { id: '__proto__', name: '__proto__' } }),
  ];
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  const w = agg.series.spend.find((p) => p.weekStartMs === Date.parse('2026-09-07T00:00:00Z'));
  assert.equal(w.stacks.constructor, 2);
  assert.equal(Object.getOwnPropertyDescriptor(w.stacks, '__proto__').value, 3);
  assert.deepEqual(agg.series.stackKeys.map((s) => s.key).sort(), ['__proto__', 'constructor']);
  assert.doesNotThrow(() => toCsv(aggregate([makeRecord({ id: 'z', kind: 'workspace', touched: 'acme/x' })], { range: 'all', now: NOW }).runs));
});

test('only http(s) PR links survive into run rows', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('https://github.com/acme/x/pull/1'), 'https://github.com/acme/x/pull/1');
  const agg = aggregate([makeRecord({ id: 'x', pr: { number: 1, url: 'javascript:alert(1)' } })], { range: 'all', now: NOW });
  assert.deepEqual(agg.runs[0].pr, { number: 1, url: null });
});

test('KPIs: spend, split, success, median/P90, autonomy, review cycles, interventions, cost per run with a PR', () => {
  const recs = [
    makeRecord({ id: '1', usd: 2, result: 'done', wallMs: 100, activeMs: 80, review: 1, questions: 1, pr: { number: 5, url: 'u' } }),
    makeRecord({ id: '2', usd: 4, result: 'done', wallMs: 300, activeMs: 150, review: 2 }),
    makeRecord({ id: '3', usd: 6, result: 'failed', wallMs: 200, activeMs: 170, review: 3, pauses: 1 }),
    makeRecord({ id: '4', usd: 8, result: 'stopped', wallMs: null, activeMs: 10 }),
  ];
  const k = aggregate(recs, { range: 'all', now: NOW }).kpis;
  assert.equal(k.spendUsd, 20); assert.equal(k.runs, 4);
  assert.deepEqual([k.done, k.failed, k.stopped], [2, 1, 1]);
  assert.equal(k.successRate, 0.5);
  assert.equal(k.costPerRunUsd, 5); assert.equal(k.costPerRunMedianUsd, 4); assert.equal(k.costPerRunP90Usd, 8);
  assert.equal(k.durationMedianMs, 200);
  assert.equal(k.machineMs, 410);
  assert.equal(k.autonomy, 400 / 600);
  assert.equal(k.reviewCyclesMean, 2); assert.equal(k.convergeInOneRate, 1 / 3);
  assert.equal(k.interventionsPerRun, 0.5);
  assert.equal(k.runsWithPr, 1); assert.equal(k.costPerRunWithPrUsd, 2);
});

test('weekly series start Monday UTC; spend stacked by group, runs by result', () => {
  const recs = [
    makeRecord({ id: '1', startedAt: '2026-09-07T00:00:00Z', usd: 3, workflow: { id: 'wf_auto', name: 'Auto' } }),   // Monday
    makeRecord({ id: '2', startedAt: '2026-09-13T23:59:59Z', usd: 1, workflow: { id: 'wf_bug', name: 'Bugfix' }, result: 'failed' }), // Sunday same week
    makeRecord({ id: '3', startedAt: '2026-09-14T00:00:00Z', usd: 2, workflow: { id: 'wf_auto', name: 'Auto' } }),
  ];
  const agg = aggregate(recs, { range: 'this-month', groupBy: 'workflow', now: NOW });
  assert.equal(weekStartMs(Date.parse('2026-09-13T23:59:59Z')), Date.parse('2026-09-07T00:00:00Z'));
  const w = agg.series.spend.find((p) => p.weekStartMs === Date.parse('2026-09-07T00:00:00Z'));
  assert.deepEqual(w.stacks, { wf_auto: 3, wf_bug: 1 });
  const r = agg.series.runs.find((p) => p.weekStartMs === Date.parse('2026-09-07T00:00:00Z'));
  assert.deepEqual([r.done, r.failed], [1, 1]);
  assert.deepEqual(agg.series.stackKeys.map((s) => s.key), ['wf_auto', 'wf_bug']);
});

test('breakdowns: workflow, source (No ticket last), actor only when present, project touched counts in both, row filter', () => {
  const recs = [
    makeRecord({ id: '1', usd: 10, source: { type: 'github-issues', ref: '#412', title: 'Idempotency' }, actor: 'Mara K.', kind: 'workspace', touched: ['acme/gateway', 'acme/console'], files: 4, touchedFiles: { 'acme/gateway': 3, 'acme/console': 1 } }),
    makeRecord({ id: '2', usd: 5, kind: 'workspace', touched: ['acme/gateway'], files: 1, touchedFiles: { 'acme/gateway': 1 } }),
  ];
  assert.throws(() => aggregate(recs, { range: 'all', groupBy: 'project', now: NOW }), RangeError, 'spend is never stacked by project: a run\'s cost is one number');
  const agg = aggregate(recs, { range: 'all', now: NOW });
  assert.deepEqual(agg.breakdowns.source.map((r) => r.label), ['#412 Idempotency', 'No ticket']);
  assert.ok(agg.breakdowns.actor);
  const gw = agg.breakdowns.project.find((r) => r.key === 'acme/gateway');
  assert.deepEqual([gw.runs, gw.usd, gw.filesChanged, gw.filesUnknown], [2, 15, 4, 0], 'files per PROJECT (3 + 1), not the runs\' totals (4 + 1)');
  assert.equal(agg.breakdowns.project.find((r) => r.key === 'acme/console').filesChanged, 1);
  assert.deepEqual(agg.breakdowns.project.map((r) => [r.key, r.runShare]), [['acme/gateway', 1], ['acme/console', 0.5]], 'share of runs touched; ordered by runs touched, not spend');
  assert.equal(agg.breakdowns.workflow[0].runShare, 1, 'every dimension carries it; only the project table shows it');
  assert.equal(agg.breakdowns.workflow[0].filesChanged, 5, 'a whole-run dimension still sums the runs\' totals');
  // Records that predate target.touchedFiles: the count is unknown, never the run's total.
  const old = aggregate([makeRecord({ id: '3', kind: 'workspace', touched: ['acme/gateway', 'acme/console'], files: 9 })], { range: 'all', now: NOW });
  assert.deepEqual(old.breakdowns.project.map((r) => [r.key, r.filesChanged, r.filesUnknown]), [['acme/console', null, 1], ['acme/gateway', null, 1]], 'a tie on runs and files falls back to the name');
  const mixed = aggregate([...recs, makeRecord({ id: '3', kind: 'workspace', touched: ['acme/gateway'], files: 9 })], { range: 'all', now: NOW });
  assert.deepEqual([mixed.breakdowns.project.find((r) => r.key === 'acme/gateway').filesChanged, mixed.breakdowns.project.find((r) => r.key === 'acme/gateway').filesUnknown], [4, 1], 'a mixed row counts what it knows and says how many it does not');
  const spendStacks = agg.series.spend.find((p) => p.totalUsd > 0).stacks;
  assert.deepEqual(Object.values(spendStacks), [15], 'one workflow stack carrying the full spend — nothing is divided');
  const filtered = aggregate(recs, { range: 'all', filter: { source: 'github-issues:#412' }, now: NOW });
  assert.equal(filtered.kpis.runs, 1);
  assert.equal(aggregate([makeRecord({ id: 'x', actor: null })], { range: 'all', now: NOW }).breakdowns.actor, null);
});

test('parseRecordLine: unknown v and malformed lines are flagged, not thrown', () => {
  assert.deepEqual(parseRecordLine('{"v":2,"id":"x"}'), { unknownV: true });
  assert.deepEqual(parseRecordLine('{nope'), { malformed: true });
  assert.deepEqual(parseRecordLine('{"v":1}'), { malformed: true });
  assert.ok(parseRecordLine(JSON.stringify(makeRecord({ id: 'ok' }))).record);
});

test('CSV escapes quotes/commas/newlines and guards formulas', () => {
  const agg = aggregate([makeRecord({ id: 'c', title: '=SUM(A1), "quoted"' })], { range: 'all', now: NOW });
  const csv = toCsv(agg.runs);
  assert.match(csv, /^﻿startedAt,title,workflow,result,costUsd/);   // BOM for Excel
  assert.match(csv, /"'=SUM\(A1\), ""quoted"""/);
});

test('empty input renders zeros, not NaN', () => {
  const agg = aggregate([], { range: 'this-month', now: NOW });
  assert.equal(agg.kpis.runs, 0); assert.equal(agg.kpis.spendUsd, 0);
  assert.equal(agg.kpis.successRate, null);
  assert.equal(agg.series.spend.length, 3); // weeks of Aug 31, Sep 7, Sep 14 — series stop at `now`
});
