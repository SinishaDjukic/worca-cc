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

test('B1 marker: shapeRecordFrom and buildShapeStats keep smallRuns only when it is true, last, and change no other key', () => {
  const stored = { questions: { asked: 1, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true };
  const rec = shapeRecordFrom(stored);
  assert.deepEqual(rec, { questions: { asked: 1, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true });
  const out = buildShapeStats(rec, []);
  assert.equal(out.smallRuns, true);
  assert.equal(Object.keys(out).at(-1), 'smallRuns');
  for (const v of [false, 'true', 1, null]) {
    const r = shapeRecordFrom({ ...stored, smallRuns: v });
    assert.equal('smallRuns' in r, false, `stored ${JSON.stringify(v)}`);
    assert.equal('smallRuns' in buildShapeStats(r, []), false);
  }
  const { smallRuns, ...rest } = out;
  assert.deepEqual(rest, buildShapeStats(shapeRecordFrom({ ...stored, smallRuns: undefined }), []), 'no other key moves');
  // A round trip (a resume reads the stored stats back) keeps the stamp.
  assert.equal(shapeRecordFrom(JSON.parse(JSON.stringify(out))).smallRuns, true);
});

test('B2 Care: shapeRecordFrom and buildShapeStats keep a valid care, drop an invalid one, and change no other key', () => {
  const care = { position: 'lean', chosenBy: 'person', worcaPick: 'thorough', reason: 'Worca picks Thorough: it touches payments',
    facts: { touches: ['payments'], requirements: 3, subsystems: [], screens: false, size: 'small' }, at: '2026-11-21T10:00:00.000Z' };
  const stored = { questions: { asked: 1, skipped: 0 }, revises: [], shapeScore: null, smallRuns: true };
  const rec = shapeRecordFrom({ ...stored, care });
  assert.deepEqual(rec.care, care);
  const out = buildShapeStats(rec, steps);
  assert.deepEqual(out.care, care);
  const { care: _c, ...rest } = out;
  assert.deepEqual(rest, buildShapeStats(shapeRecordFrom(stored), steps), 'no other key moves');
  assert.deepEqual(shapeRecordFrom(JSON.parse(JSON.stringify(out))).care, care, 'a round trip keeps it');
  for (const bad of [{ ...care, position: 'max' }, { ...care, facts: null }, 'lean', null]) {
    const r = shapeRecordFrom({ ...stored, care: bad });
    assert.equal('care' in r, false, JSON.stringify(bad));
    assert.equal('care' in buildShapeStats(r, []), false);
  }
  rec.care = { ...care, position: 'max' };
  assert.equal('care' in buildShapeStats(rec, []), false, 'buildShapeStats checks it too');
});

test('C1 prototype: shapeRecordFrom and buildShapeStats carry a valid prototype record, drop junk, and stay byte-identical without one', () => {
  const proto = { v: 1, state: 'built', screenIds: ['R-ux-1'], round: 1, screens: [], costUsd: 1.2, findings: [], reviewRounds: 0,
    remarks: 0, rebuilt: false, at: '2026-11-21T10:00:00.000Z' };
  const rec = shapeRecordFrom({ smallRuns: true, prototype: proto });
  assert.deepEqual(rec.prototype, proto);
  assert.deepEqual(buildShapeStats(rec, []).prototype, proto);
  assert.equal('prototype' in shapeRecordFrom({ smallRuns: true, prototype: { v: 9 } }), false);
  const plain = shapeRecordFrom({ smallRuns: true });
  assert.equal(JSON.stringify(buildShapeStats(plain, [])), JSON.stringify(buildShapeStats({ ...plain, prototype: null }, [])));
  assert.equal('prototype' in buildShapeStats(plain, []), false);
});
