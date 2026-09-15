// test/report-reasons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_REASONS, REPORT_REASON_IDS, OPT_IN_KEYS, OPT_IN_CLASSES,
  reasonById, normalizeInclude,
} from '../src/shared/report-reasons.mjs';

test('the six reasons are fixed, ordered and frozen', () => {
  assert.deepEqual(REPORT_REASON_IDS, [
    'poor-quality', 'too-expensive', 'too-slow',
    'wrong-or-unsafe', 'failed-or-stuck', 'something-else',
  ], 'the taxonomy is the six the user approved, in menu order');
  assert.equal(Object.isFrozen(REPORT_REASONS), true, 'the vocabulary cannot be mutated by a caller');
  for (const r of REPORT_REASONS) {
    assert.equal(typeof r.label, 'string', `${r.id} has a human label`);
    assert.ok(r.label.length > 0, `${r.id} label is not empty`);
  }
});

test('exactly three opt-in classes; the diff and log lines are not among them', () => {
  assert.deepEqual(OPT_IN_KEYS, ['paths', 'prompt', 'names'], 'three classes, in modal order');
  for (const forbidden of ['diff', 'logs', 'log', 'patch']) {
    assert.equal(OPT_IN_KEYS.includes(forbidden), false, `"${forbidden}" must never be offerable`);
  }
  assert.equal(OPT_IN_CLASSES.length, 3, 'one descriptor per class');
});

test('reasonById resolves a known id and rejects an unknown one', () => {
  assert.equal(reasonById('too-slow').label, 'Too slow');
  assert.equal(reasonById('nope'), null, 'an unknown id resolves to null, never a default');
});

test('normalizeInclude coerces an untrusted bag to exactly the three booleans', () => {
  assert.deepEqual(normalizeInclude({ paths: 'yes', names: true, diff: true }),
    { paths: false, prompt: false, names: true },
    'only a literal true opts in, and an unknown key cannot smuggle a class');
  for (const junk of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(normalizeInclude(junk), { paths: false, prompt: false, names: false },
      `${JSON.stringify(junk)} defaults to metadata-only`);
  }
});
