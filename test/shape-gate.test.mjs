// The ONE Shape-it-first gate (server + client): the experimental shapeFirst feature flag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeFirstEnabled, requireShapeFirst } from '../src/core/shape/gate.mjs';
import { shapeFirstOn } from '../ui/public/chat/shape-gate.mjs';

function stubRes() {
  const res = { code: null, body: null };
  res.status = (c) => {
    res.code = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

// WORCA_FLAGS locks a flag over settings.json, so the user's own settings never leak into these tests.
function withFlags(value, fn) {
  const saved = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = value;
  try { return fn(); } finally { if (saved === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = saved; }
}

test('shapeFirstEnabled follows the shapeFirst flag, read fresh on every call', () => {
  withFlags('-shapeFirst', () => assert.equal(shapeFirstEnabled(), false));
  withFlags('shapeFirst', () => assert.equal(shapeFirstEnabled(), true));
});

test('requireShapeFirst answers 404 and returns false while the flag is off', () => withFlags('-shapeFirst', () => {
  const res = stubRes();
  assert.equal(requireShapeFirst({}, res), false);
  assert.equal(res.code, 404);
  assert.deepEqual(res.body, { error: 'not found' });
}));

test('requireShapeFirst returns true and sends nothing while the flag is on', () => withFlags('shapeFirst', () => {
  const res = stubRes();
  assert.equal(requireShapeFirst({}, res), true);
  assert.equal(res.code, null);
  assert.equal(res.body, null);
}));

test('the client gate reads <html data-flags>', () => {
  const doc = (flags) => ({ documentElement: { dataset: { flags } } });
  assert.equal(shapeFirstOn(doc('')), false);
  assert.equal(shapeFirstOn(doc('keepAwake shapeFirst')), true);
  assert.equal(shapeFirstOn(doc('keepAwake')), false);
});
