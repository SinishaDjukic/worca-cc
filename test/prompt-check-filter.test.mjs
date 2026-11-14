// test/prompt-check-filter.test.mjs — Stage 0 (skip rules) and Stage 1 (signals) of the prompt check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_CHECK_DEBOUNCE_MS, SKIP_MIN_CHANGE, SHORT_QUESTION_WORDS, SKIP_REASONS,
  textHash, changedShare, skipReason, signals, deterministicAssessment,
} from '../src/shared/prompt-check/filter.mjs';
import { normalizeAssessment } from '../src/shared/prompt-check/assessment.mjs';

const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';

test('constants', () => {
  assert.equal(PROMPT_CHECK_DEBOUNCE_MS, 1500);
  assert.equal(SKIP_MIN_CHANGE, 0.15);
  assert.equal(SHORT_QUESTION_WORDS, 25);
  assert.deepEqual([...SKIP_REASONS], ['small-talk', 'emoji', 'answer', 'short-question', 'logs-or-code', 'same-text', 'small-change']);
  assert.ok(Object.isFrozen(SKIP_REASONS));
});

test('textHash: 16 hex chars over trimmed, whitespace-collapsed text', () => {
  assert.match(textHash('a b'), /^[0-9a-f]{16}$/);
  assert.equal(textHash('  a \n\t b '), textHash('a b'));
  assert.notEqual(textHash('a b'), textHash('a c'));
});

test('changedShare: 1 − (common prefix + common suffix) / longer length', () => {
  assert.equal(changedShare('abc', 'abc'), 0);
  assert.equal(changedShare('', ''), 0);
  assert.equal(changedShare('', 'abc'), 1);
  assert.equal(changedShare('aaaa', 'aaaa'), 0);
  assert.equal(changedShare('abcd', 'abXd'), 0.25);
  assert.equal(changedShare(null, 'x'), 1);
});

test('skipReason: one case per reason', () => {
  const cases = [
    ['small-talk', 'Thanks!'],
    ['small-talk', 'ok'],
    ['small-talk', 'Option B.'],
    ['small-talk', '3'],
    ['emoji', '👍 🎉'],
    ['short-question', 'What does the review step do?'],
    ['logs-or-code', '```\nconst x = 1;\nfoo(x);\n```'],
    ['logs-or-code', 'Error: boom\n    at run (src/a.mjs:10:3)\n    at main (src/b.mjs:2:1)\n2026-11-01 12:00:00 INFO started'],
  ];
  for (const [reason, text] of cases) assert.equal(skipReason(text), reason, text);
  assert.equal(skipReason(TASK, { answering: true }), 'answer');
  assert.equal(skipReason(TASK, { last: { hash: textHash(TASK), text: TASK } }), 'same-text');
  assert.equal(skipReason(TASK), null);
  assert.equal(skipReason('thanks for the fix, now add a CSV export to the Insights page'), null);
});

test('skipReason: a 14% change is skipped, a 16% change is not', () => {
  const base = 'x'.repeat(100);
  const at = (n) => 'x'.repeat(40) + 'y'.repeat(n) + 'x'.repeat(60 - n);
  const last = { hash: textHash(base), text: base };
  assert.equal(changedShare(base, at(14)), 0.14);
  assert.equal(skipReason(at(14), { last }), 'small-change');
  assert.equal(changedShare(base, at(16)), 0.16);
  assert.equal(skipReason(at(16), { last }), null);
});

test('skipReason: forceTask keeps only same-text and small-change', () => {
  for (const text of ['Thanks!', '👍', 'What does the review step do?', '```\nconst x = 1;\n```']) {
    assert.equal(skipReason(text, { forceTask: true }), null, text);
  }
  assert.equal(skipReason(TASK, { forceTask: true, answering: true }), null);
  assert.equal(skipReason(TASK, { forceTask: true, last: { hash: textHash(TASK), text: TASK } }), 'same-text');
  const base = 'x'.repeat(100);
  assert.equal(skipReason('x'.repeat(95) + 'yyyyy', { forceTask: true, last: { hash: textHash(base), text: base } }), 'small-change');
});

test('signals: one case per family', () => {
  assert.ok(signals('Add a button\nRemove the old one\nIt must stay fast').task >= 3);
  assert.ok(signals('- first\n- second').task >= 2);
  assert.ok(signals('The app crashes with an error').bug >= 2);
  assert.ok(signals('Expected the list to load, actual: blank page').bug >= 1);
  assert.ok(signals('TypeError: x\n    at run (src/a.mjs:10:3)').bug >= 2);
  assert.ok(signals('As a user I should be able to export, so that I can share').requirement >= 3);
  assert.ok(signals('Edit `src/core/x.mjs` and change the limit to 20').implementation >= 2);
  assert.equal(signals('## A\ntext\n## B\ntext').plan > 0, true);
  assert.equal(signals('## A only').plan, 0);
  assert.equal(signals('1. a\n2. b\n3. c\n4. d\n5. e').plan > 0, true);
  assert.equal(signals('1. a\n2. b\n3. c\n4. d').plan, 0);
  assert.ok(signals('Write a doc').deliverable >= 1);
  assert.ok(signals('write documents for the launch').deliverable >= 1);
  assert.ok(signals('Make a deck and a video').deliverable >= 2);
  assert.deepEqual(signals(''), { task: 0, bug: 0, requirement: 0, implementation: 0, plan: 0, deliverable: 0 });
});

test('kind choice: highest count wins, ties plan > bug > implementation > requirement > deliverable; else idea', () => {
  assert.equal(deterministicAssessment('The export crashes with an error and an exception').kind, 'bug');
  assert.equal(deterministicAssessment('Make a deck for the launch').kind, 'deliverable');
  // one bug hit, one deliverable hit: bug wins the tie
  assert.equal(deterministicAssessment('Fix the error in the deck').kind, 'bug');
  // two headings outweigh one bug hit; bug is the runner-up
  const plan = deterministicAssessment('## Goal\nNo error\n## Steps\nShip it');
  assert.equal(plan.kind, 'plan');
  assert.deepEqual(plan.minorKinds, ['bug']);
  assert.equal(deterministicAssessment('Add dark mode to the settings page').kind, 'idea');
  assert.equal(deterministicAssessment('Change `ui/a.mjs` so the limit goes from 10 to 20, so that admins can see more').kind, 'implementation');
  assert.ok(deterministicAssessment('The app crashes with an error').confidence <= 0.7);
});

test('deterministicAssessment: source deterministic, no model grade (a plan gets the shape check), passes normalize unchanged', () => {
  for (const text of [TASK, 'The app crashes', '## A\n## B', 'Make a deck', 'What now?', 'hello there']) {
    const a = deterministicAssessment(text);
    assert.equal(a.source, 'deterministic');
    assert.deepEqual(normalizeAssessment(a, { text }), a, text);
    if (a.kind !== 'plan') assert.equal(a.grade, null, text);
  }
  assert.equal(deterministicAssessment('## A\n## B').grade, 'needs-detail');
  assert.equal(deterministicAssessment('What now?').isTask, false);
  assert.equal(deterministicAssessment('What now?', { forceTask: true }).kind, 'requirement');
});
