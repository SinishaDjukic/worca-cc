// test/stats-groups.test.mjs — Statistics allocation (#718 slice 2): ranges, filters, group-by,
// ledger-exact money across month boundaries, retagging.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta, recordAskCostDelta, roundUsd } from '../src/core/cost-budget.mjs';
import { insertRunTags, editRunTags } from '../src/core/run-tags-store.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-statsg-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 10, 12);                   // Thu 2026-09-10 local → lastMonth = August
const at = (m, d, hh = 12) => +new Date(2026, m - 1, d, hh);
const iso = (m, d, hh = 12) => new Date(2026, m - 1, d, hh).toISOString();
const setRun = (id, startedIso, by = null) =>
  getDb().prepare('UPDATE pipelines SET started_at = ?, started_by = ? WHERE id = ?').run(startedIso, by, id);
const sum = (rows) => roundUsd(rows.reduce((a, r) => a + r.spentUsd, 0));

let acme, globex, untagged, straddle;
before(async () => {
  ({ id: acme } = await seedPipeline('/tmp/p', { status: 'done' }));
  setRun(acme, iso(8, 3), 'alice'); insertRunTags(acme, ['client:acme', 'spike']);
  ({ id: globex } = await seedPipeline('/tmp/p', { status: 'error' }));
  setRun(globex, iso(8, 5), 'bob'); insertRunTags(globex, ['client:globex']);
  ({ id: untagged } = await seedPipeline('/tmp/p', { status: 'stopped' }));
  setRun(untagged, iso(8, 7), null);
  ({ id: straddle } = await seedPipeline('/tmp/p', { status: 'done' }));
  setRun(straddle, iso(8, 30), 'alice'); insertRunTags(straddle, ['client:acme']);

  recordCostDelta({ pipelineId: acme, amountUsd: 1.25, tsMs: at(8, 3) });
  recordCostDelta({ pipelineId: globex, amountUsd: 2, tsMs: at(8, 5) });
  recordCostDelta({ pipelineId: untagged, amountUsd: 0.5, tsMs: at(8, 7) });
  recordCostDelta({ pipelineId: straddle, amountUsd: 1, tsMs: at(8, 31, 22) });   // August
  recordCostDelta({ pipelineId: straddle, amountUsd: 3, tsMs: at(9, 1, 2) });     // September
  recordAskCostDelta({ threadId: 't1', messageId: 'm1', amountUsd: 0.75, tokens: 10, model: 'x', tsMs: at(8, 20) });
});

test('lastMonth is the previous calendar month with day buckets through its last day', () => {
  const s = getStats({ range: 'lastMonth', now: NOW });
  assert.equal(s.windowStartMs, +new Date(2026, 7, 1));
  assert.equal(s.windowEndMs, +new Date(2026, 8, 1));
  assert.equal(s.bucket, 'day');
  assert.equal(s.series.length, 31);
  assert.equal(s.totals.spentUsd, 5.5);                  // 1.25 + 2 + 0.5 + 1 (Aug part only) + 0.75 ask
});

test('a run straddling the month boundary contributes only in-range ledger spend', () => {
  const aug = getStats({ range: 'lastMonth', now: NOW, filter: { tags: ['client:acme'] } });
  assert.equal(aug.totals.spentUsd, 2.25);                // 1.25 + 1, not + 3
  const sep = getStats({ range: 'month', now: NOW, filter: { tags: ['client:acme'] } });
  assert.equal(sep.totals.spentUsd, 3);
  assert.equal(sep.totals.runs, 0);                        // cohort by start: started in August
});

test('custom range is inclusive of `to`, picks day buckets up to 92 days, rejects bad input', () => {
  const s = getStats({ range: 'custom', from: '2026-08-05', to: '2026-08-07', now: NOW });
  assert.equal(s.windowStartMs, +new Date(2026, 7, 5));
  assert.equal(s.windowEndMs, +new Date(2026, 7, 8));
  assert.equal(s.series.length, 3);
  assert.equal(s.totals.pipelineSpendUsd, 2.5);
  assert.equal(s.prev.runs, 1);                            // Aug 2–4 holds acme
  assert.equal(getStats({ range: 'custom', from: '2026-01-01', to: '2026-08-31', now: NOW }).bucket, 'month');
  for (const [from, to] of [['2026-08-07', '2026-08-05'], ['2026-02-30', '2026-03-01'], [null, '2026-08-01'], ['2010-01-01', '2026-08-01']]) {
    assert.throws(() => getStats({ range: 'custom', from, to, now: NOW }), RangeError);
  }
});

test('a tag filter narrows every tile and series bucket and drops Chat', () => {
  const s = getStats({ range: 'lastMonth', now: NOW, filter: { tags: ['client:acme'] } });
  assert.equal(s.filtered, true);
  assert.deepEqual(s.filter, { tags: ['client:acme'], person: null });
  assert.equal(s.totals.runs, 2);
  assert.equal(s.totals.finished, 2);
  assert.equal(s.totals.failed, 0);
  assert.equal(s.totals.ask.spendUsd, 0);
  assert.equal(roundUsd(s.series.reduce((a, b) => a + b.spentUsd, 0)), 2.25);
  assert.equal(s.series.reduce((a, b) => a + b.failed, 0), 0);
  assert.equal(s.prev.runs, 0);
});

test('several tags combine with AND; a bare key matches any value; person filters by started_by', () => {
  assert.equal(getStats({ range: 'lastMonth', now: NOW, filter: { tags: ['client:acme', 'spike'] } }).totals.runs, 1);
  assert.equal(getStats({ range: 'lastMonth', now: NOW, filter: { tags: ['client'] } }).totals.runs, 3);
  const bob = getStats({ range: 'lastMonth', now: NOW, filter: { person: 'bob' } });
  assert.equal(bob.totals.runs, 1);
  assert.equal(bob.totals.spentUsd, 2);
  assert.throws(() => getStats({ filter: { tags: ['client:'] }, now: NOW }), RangeError);
});

test('an unfiltered call is unchanged and lists people', () => {
  const s = getStats({ range: 'lastMonth', now: NOW });
  assert.equal(s.filtered, false);
  assert.equal(s.groups, null);
  assert.deepEqual(s.people, ['alice', 'bob']);
});

test('lastMonth grouped by tag:client: one row per client, (no client), Chat, summing to the total', () => {
  const s = getStats({ range: 'lastMonth', now: NOW, groupBy: 'tag:client' });
  assert.equal(s.groups.label, 'client');
  assert.deepEqual(s.groups.rows.map((r) => [r.label, r.kind, r.spentUsd, r.runs]), [
    ['acme', 'value', 2.25, 2],
    ['globex', 'value', 2, 1],
    ['(no client)', 'none', 0.5, 1],
    ['Chat', 'ask', 0.75, 0],
  ]);
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
});

test('grouped by person: named rows, (unknown person), Chat, same total', () => {
  getDb().prepare("UPDATE pipelines SET started_by = 'local' WHERE id = ?").run(untagged);
  const s = getStats({ range: 'lastMonth', now: NOW, groupBy: 'person' });
  assert.deepEqual(s.groups.rows.map((r) => r.label), ['alice', 'bob', '(unknown person)', 'Chat']);
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
  assert.equal(sum(getStats({ range: 'lastMonth', now: NOW, groupBy: 'tag:client' }).groups.rows), s.totals.spentUsd);
});

test('a plain tag groups as its own row; all-time grouping reconciles with fallback totals', () => {
  const plain = getStats({ range: 'lastMonth', now: NOW, groupBy: 'tag:spike' });
  assert.deepEqual(plain.groups.rows.map((r) => [r.label, r.spentUsd, r.runs]),
    [['spike', 1.25, 1], ['(no spike)', 3.5, 3], ['Chat', 0.75, 0]]);   // kind order first, then spend
  const all = getStats({ range: 'all', now: NOW, groupBy: 'tag:client' });
  assert.equal(sum(all.groups.rows), all.totals.spentUsd);
});

test('filter + group: rows sum to the filtered total and carry no Chat row', () => {
  const s = getStats({ range: 'lastMonth', now: NOW, groupBy: 'person', filter: { tags: ['client'] } });
  assert.ok(!s.groups.rows.some((r) => r.kind === 'ask'));
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
});

test('a straddling run shows September spend with 0 runs in this month', () => {
  const s = getStats({ range: 'month', now: NOW, groupBy: 'tag:client' });
  assert.deepEqual(s.groups.rows.map((r) => [r.label, r.spentUsd, r.runs]), [['acme', 3, 0]]);
});

test('retagging a finished run moves its spend to the new row on the next call', () => {
  editRunTags(globex, ['client:acme'], { actor: 'alice' });
  editRunTags(acme, ['client:globex', 'spike'], { actor: 'alice' });
  const s = getStats({ range: 'lastMonth', now: NOW, groupBy: 'tag:client' });
  const row = (l) => s.groups.rows.find((r) => r.label === l);
  assert.equal(row('globex').spentUsd, 1.25);
  assert.equal(row('acme').spentUsd, 3);                 // globex's old run (2) + straddle (1)
  editRunTags(globex, ['client:globex']); editRunTags(acme, ['client:acme', 'spike']);   // restore
});

test('malformed groupBy throws RangeError', () => {
  for (const g of ['tag:', 'tag:Client', 'project', 'tag:a b']) {
    assert.throws(() => getStats({ range: 'month', now: NOW, groupBy: g }), RangeError);
  }
});

test('tagKeys: configured keys first (even untagged), then keys carried in range by value spend; rows match groupBy', () => {
  const s = getStats({ range: 'lastMonth', now: NOW, tagKeys: ['cc'] });
  assert.equal(s.tagGroups[0].key, 'cc');
  assert.equal(s.tagGroups[0].configured, true);
  assert.ok(!s.tagGroups[0].rows.some((r) => r.kind === 'value'), 'no run carries cc');
  assert.equal(sum(s.tagGroups[0].rows), s.totals.spentUsd);
  const others = s.tagGroups.slice(1);
  assert.deepEqual(new Set(others.map((t) => t.key)), new Set(['client', 'spike']));
  const valueUsd = (t) => t.rows.filter((r) => r.kind === 'value').reduce((a, r) => a + r.spentUsd, 0);
  assert.ok(valueUsd(others[0]) >= valueUsd(others[1]), 'other keys by value spend');
  for (const t of others) {
    assert.equal(t.configured, false);
    assert.deepEqual(t.rows, getStats({ range: 'lastMonth', now: NOW, groupBy: `tag:${t.key}` }).groups.rows);
  }
});

test('tagKeys: null = no tables; a bad or duplicate key', () => {
  assert.equal(getStats({ range: 'lastMonth', now: NOW }).tagGroups, null);
  assert.throws(() => getStats({ range: 'lastMonth', now: NOW, tagKeys: ['Bad key'] }), RangeError);
  assert.deepEqual(getStats({ range: 'lastMonth', now: NOW, tagKeys: ['cc', 'cc'] }).tagGroups.filter((t) => t.key === 'cc').length, 1);
  assert.throws(() => getStats({ range: 'lastMonth', now: NOW, tagKeys: Array.from({ length: 51 }, (_, i) => `k${i}`) }), RangeError);
});

test('report facts: every run the window counts, money reconciles with the Spent tile', () => {
  const s = getStats({ range: 'lastMonth', now: NOW, report: true });
  const f = s.report;
  assert.equal(f.buckets.length, 31);
  const byId = new Map(f.runs.map((x) => [x.id, x]));
  assert.deepEqual(byId.get(acme).tags, { client: 'acme', spike: '' });
  assert.equal(byId.get(acme).person, 'alice');
  assert.equal(byId.get(acme).project, 'p', 'no projects row: the key p-xxxxxxxx reads as its slug');
  assert.equal(byId.get(globex).status, 'failed');
  assert.equal(byId.get(untagged).person, null);
  assert.equal(roundUsd(f.runs.reduce((a, x) => a + x.usd, 0)), s.totals.pipelineSpendUsd);
  // Σ is true by construction (drift step); per-run money catches an attribution bug.
  assert.deepEqual([acme, globex, untagged, straddle].map((id) => byId.get(id).usd), [1.25, 2, 0.5, 1]);
  assert.equal(roundUsd(s.totals.pipelineSpendUsd + f.ask.spentUsd), s.totals.spentUsd);
  assert.deepEqual(byId.get(straddle).spend, [[30, 1]], 'only the August part, in the 31 August bucket');
});

test('report facts: a run that only spent in the window carries money but no run and no hours', () => {
  const s = getStats({ range: 'month', now: NOW, report: true });
  const x = s.report.runs.find((r) => r.id === straddle);
  assert.equal(x.usd, 3);
  assert.equal(x.inCohort, false);
  assert.equal(x.hours, 0);
});

test('report facts honour a tag filter and drop Ask Worca; no report key without the option', () => {
  const s = getStats({ range: 'lastMonth', now: NOW, report: true, filter: { tags: ['client:acme'] } });
  assert.deepEqual(s.report.runs.map((x) => x.id).sort(), [acme, straddle].sort());
  assert.equal(s.report.ask, null);
  assert.equal('report' in getStats({ range: 'lastMonth', now: NOW }), false);
});
