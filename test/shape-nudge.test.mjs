// test/shape-nudge.test.mjs — when the run card offers Shape it first (nudge.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nudgeFor, NUDGE_MIN_OPEN_DECISIONS, OPEN_DECISIONS_MAX } from '../src/core/shape/nudge.mjs';
import { DEFAULT_PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';

test('nudgeFor: reason by size and open decisions', () => {
  const rows = [
    { name: 'large task', assess: { size: 'large' }, reason: 'large' },
    { name: 'two open decisions', assess: { size: 'medium', openDecisions: ['db?', 'auth?'] }, reason: 'thin' },
    { name: 'large and thin', assess: { size: 'large', openDecisions: ['a', 'b', 'c'] }, reason: 'both' },
    { name: 'one decision on a medium task', assess: { size: 'medium', openDecisions: ['a'] }, reason: null },
    { name: 'small, nothing open', assess: { size: 'small', openDecisions: [] }, reason: null },
    { name: 'blank decisions do not count', assess: { size: 'medium', openDecisions: ['a', '  ', 7] }, reason: null },
  ];
  for (const r of rows) {
    const got = nudgeFor(r.assess);
    assert.equal(got ? got.reason : null, r.reason, r.name);
  }
  assert.equal(NUDGE_MIN_OPEN_DECISIONS, 2);
});

test('nudgeFor: malformed assess is no nudge, never an error', () => {
  for (const bad of [null, undefined, [], ['large'], 'large', 42, { size: 'huge' }, { openDecisions: 'a,b' }]) {
    assert.equal(nudgeFor(bad), null, JSON.stringify(bad));
  }
});

test('nudgeFor: size is kept only when known', () => {
  assert.equal(nudgeFor({ size: 'large' }).size, 'large');
  assert.equal(nudgeFor({ size: 'huge', openDecisions: ['a', 'b'] }).size, null);
});

test('nudgeFor: perspectives fall back to the defaults when missing or invalid', () => {
  assert.deepEqual(nudgeFor({ size: 'large' }).perspectives, [...DEFAULT_PERSPECTIVES]);
  assert.deepEqual(nudgeFor({ size: 'large', perspectives: ['nope'] }).perspectives, [...DEFAULT_PERSPECTIVES]);
  assert.deepEqual(nudgeFor({ size: 'large', perspectives: 'ux' }).perspectives, [...DEFAULT_PERSPECTIVES]);
  assert.deepEqual(nudgeFor({ size: 'large', perspectives: ['ux', 'security'] }).perspectives, ['product', 'ux', 'security']);
});

test('nudgeFor: open decisions are trimmed and capped at 6 items of 160 chars', () => {
  const long = 'x'.repeat(200);
  const got = nudgeFor({ size: 'medium', openDecisions: ['  a  ', long, 'c', 'd', 'e', 'f', 'g', 'h'] });
  assert.equal(OPEN_DECISIONS_MAX, 6);
  assert.equal(got.openDecisions.length, 6);
  assert.equal(got.openDecisions[0], 'a');
  assert.equal(got.openDecisions[1].length, 160);
  assert.deepEqual(got.openDecisions.slice(2), ['c', 'd', 'e', 'f']);
});
