import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { stepCostHistory } from '../src/core/stats.mjs';

useTempHome(after);

test('finished runs from the last N days, by phase; failed, old and zero rows are left out', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const step = (key, phase, costUsd, activeMs) => ({ key, nodeId: key, phase, cycle: 0, status: 'done', costUsd, activeMs });
  seedPipelineRow({ id: 'p-ok', status: 'done', updatedAt: '2026-10-01T00:00:00Z', steps: [step('0:a', 'implementer', 1.5, 60000), step('1:b', 'reviewer', 0.4, 20000), step('2:c', 'reviewer', 0, 0)] });
  seedPipelineRow({ id: 'p-failed', status: 'failed', updatedAt: '2026-10-02T00:00:00Z', steps: [step('0:a', 'implementer', 9, 1)] });
  seedPipelineRow({ id: 'p-old', status: 'done', updatedAt: '2026-05-01T00:00:00Z', steps: [step('0:a', 'implementer', 9, 1)] });
  seedPipelineRow({ id: 'p-ok2', status: 'done', updatedAt: '2026-10-03T00:00:00Z', steps: [step('0:a', 'implementer', 2, 1000), step('0:a#1', 'implementer', 1, 500)] });
  assert.deepEqual(stepCostHistory({ sinceDays: 90, now }), {
    implementer: { costs: [1.5, 2, 1], ms: [60000, 1000, 500], runs: 2 },   // 3 rows, but 2 runs
    reviewer: { costs: [0.4], ms: [20000], runs: 1 },
  });
});
