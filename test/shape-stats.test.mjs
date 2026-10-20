// test/shape-stats.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShapeStats, clarifyCounts, shapeRecordFrom, shapeScoreOf } from '../src/core/shape/stats.mjs';

const steps = [
  { nodeId: 'preflight', status: 'done' },
  { nodeId: 'n_clarify', status: 'done', costUsd: 1 }, { nodeId: 'n_plan', status: 'done', costUsd: 10 },
  { nodeId: 'n_refine', status: 'done', costUsd: 5 }, { nodeId: 'n_plan', status: 'done', costUsd: 8 },
  { nodeId: 'n_refine', status: 'done', costUsd: 4 }, { nodeId: 'n_impl', status: 'done', costUsd: 20 },
  { nodeId: 'n_review', status: 'done', costUsd: 3 }, { nodeId: 'n_impl', status: 'done', costUsd: 6 },
  { nodeId: 'n_review', status: 'done', costUsd: 2 }, { nodeId: 'n_review', status: 'start' },
];

test('built from a shaped run: questions, one person revise, score, review cycles, null checklist, cost split', () => {
  const rec = shapeRecordFrom(null);
  const q = clarifyCounts([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { answers: [{ id: 'a', choice: 'Yes' }, { id: 'b', choice: '  ' }] });
  rec.questions = { asked: q.asked, skipped: q.skipped };
  rec.revises.push({ round: 1, by: 'person' });
  rec.shapeScore = shapeScoreOf({ passed: 7, total: 8 });
  assert.deepEqual(buildShapeStats(rec, steps), {
    questions: { asked: 3, skipped: 2 },
    revises: [{ round: 1, by: 'person' }],
    shapeScore: 0.875,
    reviewCycles: 2,
    checklist: null,
    cost: { shaping: 28, building: 31 },
  });
});

test('clarifyCounts reads a bare-array payload; shapeScoreOf is null without a check', () => {
  assert.deepEqual(clarifyCounts([{ id: 'a' }, { id: 'b' }], [{ id: 'b', choice: 'No' }]), { asked: 2, skipped: 1 });
  assert.deepEqual(clarifyCounts([{ id: 'a' }], null), { asked: 1, skipped: 1 });
  assert.equal(shapeScoreOf(null), null);
  assert.equal(shapeScoreOf({ passed: 0, total: 0 }), null);
});

test('shapeRecordFrom restores the recorded parts from a stored shapeStats and ignores junk', () => {
  const stored = { questions: { asked: 2, skipped: 1 }, revises: [{ round: 1, by: 'check' }, { round: 'x' }], shapeScore: 0.5, reviewCycles: 9 };
  assert.deepEqual(shapeRecordFrom(stored), { questions: { asked: 2, skipped: 1 }, revises: [{ round: 1, by: 'check' }], shapeScore: 0.5 });
  assert.deepEqual(shapeRecordFrom('nope'), { questions: { asked: 0, skipped: 0 }, revises: [], shapeScore: null });
});

test('role reviews: n_roles slice rows are shaping cost, and shaping + building is the run total', () => {
  const withRoles = [...steps,
    { nodeId: 'n_roles', kind: 'task', status: 'done', costUsd: 0.5 }, { nodeId: 'n_roles', kind: 'task', status: 'done', costUsd: 0.5 }];
  const { cost } = buildShapeStats(shapeRecordFrom(null), withRoles);
  assert.deepEqual(cost, { shaping: 29, building: 31 });
  const total = withRoles.reduce((n, s) => n + (s.costUsd || 0), 0);
  assert.equal(cost.shaping + cost.building, total);
});
