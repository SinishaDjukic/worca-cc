// aggregate(): humanHours and savedUsd (money-saved design §9.2). Records without `human` count 0 h.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/shared/team-metrics/aggregate.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const NOW = Date.parse('2026-09-16T12:00:00Z');
const withHuman = (rec, hours) => ({ ...rec, human: { hours, byPhase: {} } });
const recs = [
  withHuman(makeRecord({ id: '1', startedAt: '2026-09-07T10:00:00Z', usd: 96.51 }), 74.2),
  withHuman(makeRecord({ id: '2', startedAt: '2026-09-08T10:00:00Z', usd: 51.15, result: 'stopped' }), 21.4),
  makeRecord({ id: '3', startedAt: '2026-09-09T10:00:00Z', usd: 6.12 }),                     // no human block
  withHuman(makeRecord({ id: '4', startedAt: '2026-08-05T10:00:00Z', usd: 10 }), 5),           // like-for-like previous window (Aug 1–16)
];

test('kpis: humanHours = Σ human.hours, savedUsd = hours × rate − spend; deltas vs prev', () => {
  const agg = aggregate(recs, { range: 'this-month', now: NOW, humanRateUsd: 35 });
  assert.equal(agg.kpis.humanHours, 95.6);
  assert.equal(agg.kpis.humanRuns, 2);
  assert.equal(agg.kpis.spendUsd, 153.78);
  assert.equal(agg.kpis.savedUsd, Math.round((95.6 * 35 - 153.78) * 100) / 100);
  assert.equal(agg.prev.humanHours, 5);
  assert.equal(agg.prev.humanRuns, 1);
  assert.equal(agg.prev.savedUsd, 165);                                    // 5×35 − 10
  assert.equal(agg.deltas.humanHoursPct, (95.6 - 5) / 5);
  assert.equal(agg.deltas.savedPct, (agg.kpis.savedUsd - 165) / 165);
});

test('rate 0 (default) prices nothing: savedUsd = −spend; a non-positive prev delta is null', () => {
  const agg = aggregate(recs, { range: 'this-month', now: NOW });
  assert.equal(agg.kpis.humanHours, 95.6);
  assert.equal(agg.kpis.savedUsd, -153.78);
  assert.equal(agg.deltas.savedPct, null);
});
