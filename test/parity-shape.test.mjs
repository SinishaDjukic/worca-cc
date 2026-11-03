// test/parity-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, shapeKey } from '../tools/parity/shape.mjs';

test('shapeOf keeps types and sorted keys, drops values', () => {
  assert.deepEqual(shapeOf({ b: 1, a: 'x', c: null }), { a: 'string', b: 'number', c: 'null' });
  assert.equal(shapeKey({ id: 'r1', n: 3 }), shapeKey({ n: 99, id: 'zz' }));
});

test('array elements merge into one shape; optional keys stay visible', () => {
  assert.deepEqual(shapeOf([{ a: 1 }, { a: 2, b: true }]), ['array', { a: 'number', b: 'absent|boolean' }]);
  assert.deepEqual(shapeOf([]), ['array', 'empty']);
  assert.deepEqual(shapeOf([1, 'x']), ['array', 'number|string']);
});

test('data-keyed maps collapse so keys (paths, ids) never reach a snapshot', () => {
  assert.deepEqual(shapeOf({ '/Users/x/secret-project': 1, '/tmp/y': 2 }), { '*': 'number' });
  const big = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
  assert.deepEqual(shapeOf(big), { '*': 'number' });
  assert.equal(JSON.stringify(shapeOf({ 'secret-canary-123': 'v' })).includes('secret-canary'), false);
});

test('id-like keys collapse too (hex runs, uuid tails), field names do not', () => {
  assert.deepEqual(shapeOf({ r_1a2b3c4d5e: 1 }), { '*': 'number' });
  assert.deepEqual(shapeOf({ run_0f8e2c1a_4b3d_4e5f_9a8b_7c6d5e4f3a2b: 'x' }), { '*': 'string' });
  assert.deepEqual(shapeOf({ createdAt: 1, defragRunId: null }), { createdAt: 'number', defragRunId: 'null' });
});

test('a non-JSON body is shaped by its content type', () => {
  assert.equal(shapeOf(undefined, 'text/html; charset=utf-8'), 'body:text/html');
});
