// test/workflow-test-judge-spend.test.mjs — D92: Part 4's model calls count in the spending limit, never in Statistics or "Saved".
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import { recordTestJudgeCost, testJudgeWindowedSpendUsd, totalWindowSpendUsd, budgetStatus } from '../src/core/cost-budget.mjs';
import { budgetWindowSavings } from '../src/core/stats.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftjspend-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

test('a judge call is booked once, counted in the window and the limit; a known $0 books nothing, an unknown cost a $0 row', () => {
  recordTestJudgeCost({ workflowId: 'wf_a', exampleId: 1, testRunId: 7, purpose: 'try', model: 'claude-haiku-4-5', amountUsd: 0.02, tsMs: 1000 });
  recordTestJudgeCost({ workflowId: 'wf_a', purpose: 'checker', amountUsd: 0, tsMs: 1000 });
  recordTestJudgeCost({ workflowId: '', purpose: 'try', amountUsd: 1, tsMs: 1000 });
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n, 1);
  // P4-Q17: a reply whose cost Worca could not learn is never silently left out.
  recordTestJudgeCost({ workflowId: 'wf_a', testRunId: 7, purpose: 'try', amountUsd: 0, costKind: 'unknown', tsMs: 1000 });
  assert.deepEqual({ ...prepare("SELECT amount_usd, cost_kind FROM wf_test_judge_ledger WHERE cost_kind = 'unknown'").get() }, { amount_usd: 0, cost_kind: 'unknown' });
  prepare("DELETE FROM wf_test_judge_ledger WHERE cost_kind = 'unknown'").run();
  assert.deepEqual({ ...prepare('SELECT workflow_id, example_id, test_run_id, purpose, model, engine, amount_usd, cost_kind FROM wf_test_judge_ledger').get() },
    { workflow_id: 'wf_a', example_id: 1, test_run_id: 7, purpose: 'try', model: 'claude-haiku-4-5', engine: 'claude', amount_usd: 0.02, cost_kind: 'billed' });
  assert.equal(testJudgeWindowedSpendUsd(0), 0.02);
  assert.equal(testJudgeWindowedSpendUsd(2000), 0);
  assert.equal(testJudgeWindowedSpendUsd(0, 1000), 0, 'toMs is exclusive');
  assert.equal(totalWindowSpendUsd(0), 0.02);
});

test('budgetStatus counts it; "Saved" leaves it out like test tries', () => {
  recordTestJudgeCost({ workflowId: 'wf_a', purpose: 'try', amountUsd: 1.5 });
  const b = budgetStatus();
  assert.equal(b.windowSpendUsd, 1.5);
  assert.equal(b.allTimeSpendUsd, 1.5);
  // No runs, so no hours: Saved is 0 when the judge spend is left out (it was -1.5 before Step 4).
  const { windowSavedUsd } = budgetWindowSavings(b);
  assert.equal(windowSavedUsd, 0, 'judge spend does not lower Saved');
});
