// test/prompt-check-assessment.test.mjs — the shared prompt-check assessment and the kind → Auto taskKind table.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_KINDS, NON_TASK_KINDS, KIND_LABELS, KIND_RUBRICS, GRADES, ASSESS_SIZES, PROMPT_CHECK_WINDOW,
  KIND_TO_TASK_KIND, taskKindFor, normalizeAssessment,
} from '../src/shared/prompt-check/assessment.mjs';
import { TASK_KINDS } from '../src/shared/graph/assemble.mjs';

const SHAPE_KEYS = ['v', 'isTask', 'kind', 'minorKinds', 'confidence', 'grade', 'size', 'openDecisions', 'perspectives',
  'continuesRequirement', 'taskKind', 'source'];

// A plan that passes checkShape with the default (Product) perspective: every always-on section, a testable
// success criterion and a named test file.
const PASSING_PLAN = [
  '## Problem and goal', '- The page returns 200 for `GET /x`.',
  '## Testing', '- `test/x.test.mjs` (new) checks the 200.',
  '## Out of scope', 'Nothing else.',
  '## Open questions', 'None.',
].join('\n');

test('the kind lists, labels, rubrics and constants', () => {
  assert.deepEqual([...PROMPT_KINDS], ['requirement', 'implementation', 'bug', 'plan', 'idea', 'run-change', 'deliverable']);
  assert.deepEqual([...NON_TASK_KINDS], ['conversation', 'question']);
  assert.ok(Object.isFrozen(PROMPT_KINDS) && Object.isFrozen(NON_TASK_KINDS) && Object.isFrozen(KIND_TO_TASK_KIND));
  assert.deepEqual(KIND_LABELS, {
    requirement: 'Requirement', implementation: 'Implementation task', bug: 'Bug report', plan: 'Plan', idea: 'Idea',
    'run-change': 'Change to a run', deliverable: 'Deck, doc or video',
  });
  for (const k of PROMPT_KINDS) assert.ok(Array.isArray(KIND_RUBRICS[k]) && KIND_RUBRICS[k].length > 0, k);
  assert.deepEqual(Object.fromEntries(Object.entries(KIND_RUBRICS).map(([k, v]) => [k, [...v]])), {
    requirement: ['who', 'problem', 'outcome', 'done-when', 'scope', 'constraints'],
    implementation: ['change', 'where', 'tests', 'done-when'],
    bug: ['steps', 'expected', 'actual', 'where', 'logs', 'frequency'],
    plan: ['shape-check'],
    idea: ['goal'],
    'run-change': ['change'],
    deliverable: ['audience', 'purpose', 'length', 'sources'],
  });
  assert.deepEqual([...GRADES], ['clear', 'needs-detail']);
  assert.deepEqual([...ASSESS_SIZES], ['small', 'medium', 'large', 'very-large']);
  assert.equal(PROMPT_CHECK_WINDOW, 3);
});

test('TASK_KINDS is unchanged (the Auto classifier is untouched)', () => {
  assert.deepEqual([...TASK_KINDS], ['prompt', 'plan-partial', 'plan-complete-detailed', 'plan-complete-small']);
});

test('the kind → taskKind table covers every kind and reaches all 4 TASK_KINDS', () => {
  for (const k of PROMPT_KINDS) assert.ok(k in KIND_TO_TASK_KIND, k);
  for (const k of PROMPT_KINDS.filter((x) => x !== 'plan')) {
    assert.equal(KIND_TO_TASK_KIND[k], 'prompt', k);
    assert.equal(taskKindFor(k, 'anything'), 'prompt', k);
  }
  assert.equal(taskKindFor('plan', 'a short note'), 'plan-partial');
  assert.equal(taskKindFor('plan', PASSING_PLAN, { size: 'small' }), 'plan-complete-small');
  assert.equal(taskKindFor('plan', PASSING_PLAN, { size: 'medium' }), 'plan-complete-detailed');
  assert.equal(taskKindFor('plan', PASSING_PLAN), 'plan-complete-detailed');
  assert.equal(taskKindFor('plan', PASSING_PLAN, { size: 'very-large' }), 'plan-complete-detailed');
  for (const k of [...NON_TASK_KINDS, 'nope', null]) assert.equal(taskKindFor(k, 'x'), null, String(k));
  const reached = new Set([
    ...PROMPT_KINDS.filter((k) => k !== 'plan').map((k) => taskKindFor(k, '')),
    taskKindFor('plan', 'x'), taskKindFor('plan', PASSING_PLAN, { size: 'small' }), taskKindFor('plan', PASSING_PLAN),
  ]);
  assert.deepEqual([...reached].sort(), [...TASK_KINDS].sort());
});

test('a model reply and the deterministic input of the same prompt normalize to the same shape', () => {
  const text = 'Add a CSV export to the Insights page';
  const fromModel = normalizeAssessment({
    isTask: true, kind: 'implementation', minorKinds: ['requirement'], confidence: 0.83, grade: 'needs-detail',
    size: 'medium', openDecisions: ['Which columns?'], continuesRequirement: true, source: 'model',
  }, { text });
  const fromBrowser = normalizeAssessment({
    isTask: true, kind: 'implementation', minorKinds: [], confidence: 0.5, grade: null, size: null, openDecisions: [],
    perspectives: [], continuesRequirement: null, source: 'deterministic',
  }, { text });
  assert.deepEqual(Object.keys(fromModel), SHAPE_KEYS);
  assert.deepEqual(Object.keys(fromBrowser), SHAPE_KEYS);
  const shapeOf = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === null ? 'nullable' : Array.isArray(v) ? 'array' : typeof v]));
  const nullable = (s) => Object.fromEntries(Object.entries(s).map(([k, t]) => [k, ['grade', 'size', 'continuesRequirement'].includes(k) ? 'nullable' : t]));
  assert.deepEqual(nullable(shapeOf(fromModel)), nullable(shapeOf(fromBrowser)));
  assert.equal(fromModel.taskKind, 'prompt');
  assert.equal(fromModel.v, 1);
  assert.equal(fromModel.confidence, 0.83);
});

test('malformed input normalizes to the full shape without a throw', () => {
  const bad = [
    null, undefined, [], 'requirement', 42,
    { kind: 7, isTask: 'yes', confidence: 'high', grade: 1, size: [], openDecisions: 'a,b', perspectives: {} },
    { kind: 'nope' },
    { kind: 'bug', confidence: 7 },
    { kind: 'bug', confidence: -3 },
    { kind: 'bug', openDecisions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    { kind: 'bug', perspectives: ['ux'] },
    { kind: 'bug', extra: 1, __proto__x: 2, html: '<b>x</b>' },
    { kind: 'bug', perspectives: [{ id: 'security', reason: 'r'.repeat(10_000) }] },
  ];
  for (const raw of bad) {
    const a = normalizeAssessment(raw);
    assert.deepEqual(Object.keys(a), SHAPE_KEYS, JSON.stringify(raw));
  }
  assert.equal(normalizeAssessment({ kind: 'nope' }).kind, null);
  assert.equal(normalizeAssessment({ kind: 'bug', confidence: 7 }).confidence, 1);
  assert.equal(normalizeAssessment({ kind: 'bug', confidence: -3 }).confidence, 0);
  assert.equal(normalizeAssessment({ kind: 'bug', confidence: 0.12345 }).confidence, 0.12);
  assert.equal(normalizeAssessment({ kind: 'bug', openDecisions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).openDecisions.length, 6);
  assert.equal(normalizeAssessment({ kind: 'bug', openDecisions: [' x '.repeat(1), 'y'.repeat(300)] }).openDecisions[1].length, 160);
  assert.deepEqual(normalizeAssessment({ kind: 'bug', perspectives: ['ux', 'nope', 'ux'] }).perspectives, [{ id: 'ux', reason: '' }]);
  assert.equal(normalizeAssessment({ kind: 'bug', perspectives: [{ id: 'security', reason: 'r'.repeat(10_000) }] }).perspectives[0].reason.length, 160);
  assert.equal(normalizeAssessment({ kind: 'bug', grade: 'great' }).grade, null);
  assert.equal(normalizeAssessment({ kind: 'bug', size: 'huge' }).size, null);
  assert.equal(normalizeAssessment({ kind: 'bug', size: 'very-large' }).size, 'very-large');
  assert.equal(normalizeAssessment({ kind: 'bug', source: 'hacker' }).source, 'deterministic');
  assert.equal(normalizeAssessment({ kind: 'bug', continuesRequirement: 'no' }).continuesRequirement, null);
});

test('minorKinds: known task kinds only, never the kind itself, at most 2', () => {
  const a = normalizeAssessment({ kind: 'bug', minorKinds: ['bug', 'plan', 'nope', 'question', 'idea', 'requirement'] });
  assert.deepEqual(a.minorKinds, ['plan', 'idea']);
});

test('conversation and question are not tasks, unless forced (then a requirement)', () => {
  for (const kind of NON_TASK_KINDS) {
    const a = normalizeAssessment({ kind, isTask: true, grade: 'clear' });
    assert.equal(a.isTask, false);
    assert.equal(a.grade, null);
    assert.equal(a.taskKind, null);
    const f = normalizeAssessment({ kind, grade: 'clear' }, { forceTask: true });
    assert.equal(f.kind, 'requirement');
    assert.equal(f.isTask, true);
    assert.equal(f.grade, 'clear');
    assert.equal(f.taskKind, 'prompt');
  }
});

test('taskKind is recomputed, never taken from the input; string fields stay plain text', () => {
  const a = normalizeAssessment({ kind: 'plan', taskKind: 'plan-complete-small', openDecisions: ['<img src=x onerror=alert(1)>'] }, { text: 'x' });
  assert.equal(a.taskKind, 'plan-partial');
  assert.deepEqual(a.openDecisions, ['<img src=x onerror=alert(1)>']);
});
