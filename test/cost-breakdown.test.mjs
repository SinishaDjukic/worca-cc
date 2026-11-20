// test/cost-breakdown.test.mjs — the pure run cost breakdown every surface reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { runCostBreakdown, stepAux, floorText, auxLabelForSubagent, fmtAuxCalls, AUX_ORDER } from '../src/shared/cost/breakdown.mjs';

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const usd = (n) => `$${n.toFixed(2)}`;
// Shares ride inside step.costUsd (Task 1). A stopped review (Task 2) and agent turns cut before their
// result (Task 3) carry a lower bound apart, never in costUsd.
const steps = [
  { key: 'x:preflight:1', executionId: 'x:preflight:1', costUsd: 0.0419, auxCosts: { auto: { usd: 0.0398, calls: 1 }, title: { usd: 0.0021, calls: 1 } } },
  { key: 'n_plan:1', executionId: 'n_plan:1', costUsd: 0.67, auxCosts: { away: { usd: 0.05, calls: 1 } } },
  { key: 'n_impl:1', executionId: 'n_impl:1', costUsd: 1.91, auxCosts: { away: { usd: 0.07, calls: 1, floorUsd: 0.0234, stopped: 1 } } },
  { key: 'n_impl:2', executionId: 'n_impl:2', costUsd: 0.71, stoppedTurns: { turns: 2, tokens: 21000, floorUsd: 0.31 } },
];

test('lines per aux kind in fixed order, agents = total − Σ aux, lower bounds apart', () => {
  const b = runCostBreakdown(steps, 3.3319);
  assert.equal(b.total, 3.3319);
  assert.deepEqual(b.lines.map((l) => [l.kind, l.label, r4(l.usd), l.calls]),
    [['away', 'Away mode', 0.12, 2], ['auto', 'Auto workflow', 0.0398, 1], ['title', 'Run title', 0.0021, 1]]);
  assert.equal(r4(b.agents), 3.17);
  assert.equal(b.floorUsd, 0.0234);
  assert.equal(b.stopped, 1);
  assert.deepEqual(b.cut, { turns: 2, tokens: 21000, floorUsd: 0.31 });
  assert.deepEqual([...AUX_ORDER], ['away', 'auto', 'title', 'session']);
});

test('the total is the run total the header shows (not Σ steps); a missing or null total falls back to Σ steps', () => {
  // A finished run's total is the stored pipelines.total_cost_usd: the panel must agree with the header.
  assert.equal(runCostBreakdown([{ key: 'a', costUsd: 1 }], 1.5).total, 1.5);
  for (const t of [undefined, null, '', NaN, '3']) {
    const b = runCostBreakdown([{ key: 'a', costUsd: 1, auxCosts: { away: { usd: 0.2, calls: 1 } } }], t);
    assert.equal(b.total, 1, `total ${String(t)} → Σ steps`);
    assert.equal(r4(b.agents), 0.8);
  }
});

test('a lower bound: absent → null (not priced), 0 → 0 ({free}), summed over the parts that have one, never in a total', () => {
  assert.equal(stepAux({ auxCosts: { away: { usd: 0, calls: 0, stopped: 1 } } }).away.floorUsd, null);
  assert.equal(stepAux({ auxCosts: { away: { usd: 0, calls: 0, stopped: 1, floorUsd: 0 } } }).away.floorUsd, 0);
  for (const junk of ['0.02', -1, NaN, null, {}]) {
    assert.equal(stepAux({ auxCosts: { away: { stopped: 1, floorUsd: junk } } }).away.floorUsd, null, `floorUsd ${String(junk)}`);
  }
  const b = runCostBreakdown([
    { key: 'a', costUsd: 1, auxCosts: { away: { usd: 0, calls: 0, stopped: 1 } }, stoppedTurns: { turns: 1, tokens: 900, floorUsd: null } },
    { key: 'b', costUsd: 1, auxCosts: { away: { usd: 0, calls: 0, stopped: 1, floorUsd: 0.03 } }, stoppedTurns: { turns: 3, tokens: 5000, floorUsd: 0.2 } },
  ]);
  assert.deepEqual([b.lines[0].floorUsd, b.floorUsd, b.stopped], [0.03, 0.03, 2]);
  assert.deepEqual(b.cut, { turns: 4, tokens: 5900, floorUsd: 0.2 });
  assert.deepEqual([b.total, b.agents], [2, 2], 'lower bounds are never in the total or the agents');
  const none = runCostBreakdown([{ key: 'a', costUsd: 1, auxCosts: { away: { stopped: 1 } }, stoppedTurns: { turns: 1, tokens: 10, floorUsd: null } }]);
  assert.deepEqual([none.floorUsd, none.cut.floorUsd], [null, null], 'nothing priced stays null, never 0');
  const free = runCostBreakdown([{ key: 'a', costUsd: 0, auxCosts: { away: { usd: 0, calls: 0, stopped: 1, floorUsd: 0 } } }]);
  assert.equal(free.floorUsd, 0, 'a {free} model: priced at 0');
});

test('floorText: a lower bound reads ≥ and rounds DOWN to whole cents; nothing to show under a cent', () => {
  assert.equal(floorText(0.0234, usd), '≥$0.02');
  assert.equal(floorText(0.0189, usd), '≥$0.01', 'never rounded up past what was spent');
  assert.equal(floorText(0.29, usd), '≥$0.29', 'binary 0.29 × 100 is 28.999…');
  assert.equal(floorText(1.5, usd), '≥$1.50');
  for (const v of [0.004, 0, null, undefined, NaN, -1, '0.5']) assert.equal(floorText(v, usd), '', `floorText(${String(v)})`);
});

test('old runs (no auxCosts, no stoppedTurns) → no lines, agents = total; junk never yields NaN', () => {
  assert.deepEqual(runCostBreakdown([{ key: 'a', costUsd: 1 }], 1).lines, []);
  assert.deepEqual(runCostBreakdown(undefined, undefined),
    { total: 0, agents: 0, lines: [], floorUsd: null, stopped: 0, cut: { turns: 0, tokens: 0, floorUsd: null } });
  const b = runCostBreakdown([{ key: 'a', costUsd: 1, auxCosts: { away: { usd: 'x', calls: -1 } } }, null, { auxCosts: 'junk', stoppedTurns: 'junk' }], undefined);
  assert.equal(b.total, 1);
  assert.deepEqual(b.lines, [{ kind: 'away', label: 'Away mode', usd: 0, calls: 0, floorUsd: null, stopped: 0 }]);
  assert.deepEqual(b.cut, { turns: 0, tokens: 0, floorUsd: null });
  const bad = JSON.stringify(b, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NOT-FINITE' : v));
  assert.doesNotMatch(bad, /NOT-FINITE/, 'no NaN anywhere');
});

test('edge lines: aux above its step clamps agents at 0; a $0 review is still a line with its call count', async () => {
  await checkRows([
    { name: 'aux larger than its step (rounding) clamps agents at 0', run: () => {
      assert.equal(runCostBreakdown([{ key: 'a', costUsd: 0.05, auxCosts: { away: { usd: 0.05004, calls: 1 } } }], 0.05).agents, 0);
    } },
    { name: 'a $0 review (mock / free model) is still a line with its call count', run: () => {
      const b = runCostBreakdown([{ key: 'a', costUsd: 0, auxCosts: { away: { usd: 0, calls: 1 } } }], 0);
      assert.deepEqual(b.lines.map((l) => [l.kind, l.usd, l.calls]), [['away', 0, 1]]);
      assert.deepEqual(stepAux({ auxCosts: { away: { usd: 0, calls: 1 } } }).away, { usd: 0, calls: 1, floorUsd: null, stopped: 0 });
    } },
  ]);
});

test('labels for worca-owned sub-agent rows; other types are not relabelled', () => {
  assert.equal(auxLabelForSubagent('night-decider', 'clarify'), 'Away mode review (clarify)');
  assert.equal(auxLabelForSubagent('night-decider'), 'Away mode review');
  assert.equal(auxLabelForSubagent('auto-classify'), 'Auto workflow');
  assert.equal(auxLabelForSubagent('run-title'), 'Run title');
  assert.equal(auxLabelForSubagent('general-purpose'), null);
  for (const t of ['constructor', '__proto__', 'toString']) assert.equal(auxLabelForSubagent(t), null, `${t} is not a worca call`);
  assert.equal(fmtAuxCalls('away', 1), '1 review');
  assert.equal(fmtAuxCalls('away', 2), '2 reviews');
  assert.equal(fmtAuxCalls('auto', 2), '2 calls');
  assert.equal(fmtAuxCalls('title', 1), '1 call');
});
