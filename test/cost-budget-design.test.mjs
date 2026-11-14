// test/cost-budget-design.test.mjs — Design spend is booked in its ledger and counted toward worca's limits (M13).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { prepare } from '../src/core/db.mjs';
import {
  recordDesignCostDelta, designWindowedSpendUsd, totalWindowSpendUsd, recordAskCostDelta, budgetStatus, roundUsd,
} from '../src/core/cost-budget.mjs';

useTempHome(after);

test('design spend is summed per window and joins the enforcement total; the no-op gate holds', () => {
  const t0 = Date.UTC(2026, 9, 1);
  recordDesignCostDelta({ designId: 'd_a', buildId: 'b_a', agentId: 'a_a', amountUsd: 0.25, model: 'claude-opus-5-5', tsMs: t0 + 1000 });
  recordDesignCostDelta({ designId: 'd_b', amountUsd: 0.5, tsMs: t0 + 2000 });
  recordDesignCostDelta({ designId: 'd_b', amountUsd: 9, tsMs: t0 - 1 });
  for (const bad of [0, -1, NaN, Infinity, null, undefined]) recordDesignCostDelta({ designId: 'd_b', amountUsd: bad, tsMs: t0 + 3000 });
  recordDesignCostDelta({ designId: null, amountUsd: 1, tsMs: t0 + 3000 });
  assert.equal(designWindowedSpendUsd(t0), 0.75);
  assert.equal(designWindowedSpendUsd(t0, t0 + 1500), 0.25);
  const before = totalWindowSpendUsd(t0);
  recordAskCostDelta({ threadId: 't', messageId: 'm', amountUsd: 1, tsMs: t0 + 10 });
  assert.equal(totalWindowSpendUsd(t0), before + 1);
  assert.equal(before, 0.75);
  const row = prepare('SELECT design_id, build_id, agent_id, model FROM design_cost_ledger WHERE ts = ?').get(t0 + 1000);
  assert.deepEqual({ ...row }, { design_id: 'd_a', build_id: 'b_a', agent_id: 'a_a', model: 'claude-opus-5-5' });
});

test('budgetStatus counts it in the window and the all-time figure', () => {
  const now = new Date(2027, 5, 15, 12);
  const a = budgetStatus(now);
  recordDesignCostDelta({ designId: 'd_c', amountUsd: 2, tsMs: +new Date(2027, 5, 15, 9) });
  const b = budgetStatus(now);
  assert.equal(b.windowSpendUsd, roundUsd(a.windowSpendUsd + 2));
  assert.equal(b.allTimeSpendUsd, roundUsd(a.allTimeSpendUsd + 2));
});
