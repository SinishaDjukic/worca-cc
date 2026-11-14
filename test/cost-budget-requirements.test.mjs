// test/cost-budget-requirements.test.mjs — requirements spend is counted toward the limit (design D9).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { prepare } from '../src/core/db.mjs';
import {
  recordRequirementsCostDelta, requirementsWindowedSpendUsd, totalWindowSpendUsd, recordAskCostDelta,
} from '../src/core/cost-budget.mjs';

useTempHome(after);

test('requirements spend is summed per window and joins the enforcement total', () => {
  const t0 = Date.UTC(2026, 9, 1);
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 3, amountUsd: 0.25, model: 'claude-opus-5-5', tsMs: t0 + 1000 });
  recordRequirementsCostDelta({ featureSeq: 2, amountUsd: 0.5, tsMs: t0 + 2000 });
  recordRequirementsCostDelta({ featureSeq: 2, amountUsd: 9, tsMs: t0 - 1 });         // before the window
  recordRequirementsCostDelta({ featureSeq: 2, amountUsd: 0, tsMs: t0 + 3000 });       // $0 (mock): no row
  recordRequirementsCostDelta({ featureSeq: null, amountUsd: 1, tsMs: t0 + 3000 });    // no feature: no row
  assert.equal(requirementsWindowedSpendUsd(t0), 0.75);
  assert.equal(requirementsWindowedSpendUsd(t0, t0 + 1500), 0.25);
  recordAskCostDelta({ threadId: 't', messageId: 'm', amountUsd: 1, tsMs: t0 + 10 });
  assert.equal(totalWindowSpendUsd(t0), 1.75);
});

test('a brief look books feature_seq 0 with its brief id and counts toward the window', () => {
  const t0 = Date.UTC(2027, 0, 1);
  recordRequirementsCostDelta({ briefId: 4, amountUsd: 0.4, model: 'm', tsMs: t0 + 1 });
  recordRequirementsCostDelta({ briefId: 4, amountUsd: 0, tsMs: t0 + 2 });          // $0: no row
  recordRequirementsCostDelta({ amountUsd: 1, tsMs: t0 + 3 });                       // neither: no row
  assert.equal(requirementsWindowedSpendUsd(t0), 0.4);
  const row = prepare('SELECT feature_seq, brief_id FROM req_cost_ledger WHERE ts = ?').get(t0 + 1);
  assert.deepEqual({ ...row }, { feature_seq: 0, brief_id: 4 });
});

test("9c: an 'unknown' cost kind books a $0 row that leaves the window spend unchanged; a billed $0 still books nothing", () => {
  const t0 = Date.UTC(2027, 2, 1);
  recordRequirementsCostDelta({ featureSeq: 5, amountUsd: 0.25, model: 'm', engine: 'claude', step: 'round', tsMs: t0 + 1 });
  const before = requirementsWindowedSpendUsd(t0);
  recordRequirementsCostDelta({ featureSeq: 5, amountUsd: 0, model: 'm', engine: 'gemini', step: 'look', costKind: 'unknown',
    inputTokens: 12, outputTokens: 5, tsMs: t0 + 2 });
  recordRequirementsCostDelta({ featureSeq: 5, amountUsd: 0, costKind: 'billed', tsMs: t0 + 3 });
  recordRequirementsCostDelta({ featureSeq: 5, amountUsd: 0, costKind: 'estimated', tsMs: t0 + 4 });
  assert.equal(requirementsWindowedSpendUsd(t0), before);
  const rows = prepare('SELECT amount_usd, engine, step, cost_kind, input_tokens, output_tokens FROM req_cost_ledger WHERE ts >= ? AND ts < ? ORDER BY ts')
    .all(t0, t0 + 10);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { amount_usd: 0.25, engine: 'claude', step: 'round', cost_kind: 'billed', input_tokens: null, output_tokens: null });
  assert.deepEqual({ ...rows[1] }, { amount_usd: 0, engine: 'gemini', step: 'look', cost_kind: 'unknown', input_tokens: 12, output_tokens: 5 });
});

test('9c: an estimated row counts toward the window like a billed one', () => {
  const t0 = Date.UTC(2027, 3, 1);
  recordRequirementsCostDelta({ featureSeq: 6, amountUsd: 0.04, costKind: 'estimated', tsMs: t0 + 1 });
  assert.equal(requirementsWindowedSpendUsd(t0, t0 + 10), 0.04);
});
