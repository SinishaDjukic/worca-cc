// test/requirements-attach-gate.test.mjs — the pure agreement gate for attached Requirements features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingAgreement, applyAgreement, validateAgreement } from '../src/core/requirements/attached-gate.mjs';

const item = (seq, ready, agreed = ready) => ({
  seq, id: `f${seq}`, title: `Feature ${seq}`, version: 1, ready, criteriaCount: 2, agreed,
});

test('all ready: no ask', () => {
  assert.deepEqual(pendingAgreement([item(1, true), item(2, true)]), []);
});

test('not-Ready items are returned until agreed', () => {
  const attached = [item(1, true), item(2, false), item(3, false)];
  assert.deepEqual(pendingAgreement(attached).map((i) => i.seq), [2, 3]);
  const after = applyAgreement(attached, [2]);
  assert.deepEqual(pendingAgreement(after).map((i) => i.seq), [3]);
});

test('empty or missing attached has nothing pending', () => {
  assert.deepEqual(pendingAgreement([]), []);
  assert.deepEqual(pendingAgreement(undefined), []);
});

test('applyAgreement returns a new array and leaves the input untouched', () => {
  const attached = [item(1, true), item(2, false)];
  const snapshot = structuredClone(attached);
  for (const a of attached) Object.freeze(a);
  Object.freeze(attached);
  const out = applyAgreement(attached, [2]);
  assert.notEqual(out, attached);
  assert.deepEqual(attached, snapshot);
  assert.equal(out[1].agreed, true);
  assert.equal(out[0], attached[0]);
});

test('validateAgreement requires every pending seq', () => {
  const attached = [item(1, true), item(2, false), item(3, false)];
  const bad = validateAgreement(attached, { decision: 'approve', agreedSeqs: [2] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.map((e) => e.message).join(' '), /3/);
  assert.equal(validateAgreement(attached, { decision: 'approve' }).ok, false);
  assert.equal(validateAgreement(attached, { decision: 'approve', agreedSeqs: [2, 3] }).ok, true);
});

test('approve with nothing pending is ok without agreedSeqs', () => {
  assert.equal(validateAgreement([item(1, true)], { decision: 'approve' }).ok, true);
});

test('stop is always ok; other decisions are not', () => {
  const attached = [item(1, false)];
  assert.deepEqual(validateAgreement(attached, { decision: 'stop' }), { ok: true, errors: [] });
  assert.equal(validateAgreement(attached, { decision: 'revise' }).ok, false);
  assert.equal(validateAgreement(attached, null).ok, false);
});
