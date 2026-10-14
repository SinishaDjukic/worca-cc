// The ONE Shape-it-first gate (server + client): env switch until #675, hello-fed flag on the client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeFirstEnabled, requireShapeFirst } from '../src/core/shape/gate.mjs';
import { applyShapeFirstHello, shapeFirstOn } from '../ui/public/chat/shape-gate.mjs';

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

test('shapeFirstEnabled is off unless WORCA_SHAPE_FIRST is truthy', () => {
  assert.equal(shapeFirstEnabled({}), false);
  assert.equal(shapeFirstEnabled({ WORCA_SHAPE_FIRST: '1' }), true);
  assert.equal(shapeFirstEnabled({ WORCA_SHAPE_FIRST: '0' }), false);
  assert.equal(shapeFirstEnabled({ WORCA_SHAPE_FIRST: '' }), false);
});

test('requireShapeFirst answers 404 and returns false while the gate is off', () => {
  const res = stubRes();
  assert.equal(requireShapeFirst({}, res, {}), false);
  assert.equal(res.code, 404);
  assert.deepEqual(res.body, { error: 'not found' });
});

test('requireShapeFirst returns true and sends nothing while the gate is on', () => {
  const res = stubRes();
  assert.equal(requireShapeFirst({}, res, { WORCA_SHAPE_FIRST: '1' }), true);
  assert.equal(res.code, null);
  assert.equal(res.body, null);
});

test('client gate follows every hello frame', () => {
  assert.equal(shapeFirstOn(), false);
  applyShapeFirstHello({ features: { shapeFirst: true } });
  assert.equal(shapeFirstOn(), true);
  applyShapeFirstHello({});
  assert.equal(shapeFirstOn(), false);
});
