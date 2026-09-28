// test/wsmap-order.test.mjs — suggested change order: providers first, cycles grouped (wsmap P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changeOrder } from '../src/shared/workspace-map/order.mjs';

test('providers first, one layer per dependency depth, keys sorted inside a layer (killer: change order)', () => {
  const r = changeOrder(['web', 'billing', 'shared', 'users'], [
    { from: 'web', to: 'billing' }, { from: 'billing', to: 'shared' }, { from: 'users', to: 'shared' }, { from: 'web', to: 'users' },
  ]);
  assert.deepEqual(r.order, [['shared'], ['billing', 'users'], ['web']]);
  assert.deepEqual(r.cycles, []);
});

test('a cycle is one group in one layer and is reported (killer: cycle grouped)', () => {
  const r = changeOrder(['c', 'a', 'b', 'd'], [
    { from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'c', to: 'a' }, { from: 'a', to: 'd' },
  ]);
  assert.deepEqual(r.order, [['d'], ['a', 'b'], ['c']]);
  assert.deepEqual(r.cycles, [['a', 'b']]);
});

test('no edges → one layer; self loops, duplicates and unknown members are ignored', () => {
  assert.deepEqual(changeOrder(['b', 'a', 'a'], []), { order: [['a', 'b']], cycles: [] });
  assert.deepEqual(changeOrder(['a', 'b'], [{ from: 'a', to: 'a' }, { from: 'a', to: 'zz' }, null, { from: 'a', to: 'b' }, { from: 'a', to: 'b' }]).order, [['b'], ['a']]);
  assert.deepEqual(changeOrder(null, null), { order: [], cycles: [] });
});

test('deterministic: edge order does not change the result; two cycles sorted', () => {
  const edges = [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }, { from: 'p', to: 'q' }, { from: 'q', to: 'p' }, { from: 'x', to: 'p' }];
  const a = changeOrder(['x', 'y', 'p', 'q'], edges);
  const b = changeOrder(['q', 'p', 'y', 'x'], [...edges].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.cycles, [['p', 'q'], ['x', 'y']]);
  assert.deepEqual(a.order, [['p', 'q'], ['x', 'y']]);
});

test('40-member chain: every member placed exactly once', () => {
  const keys = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}`);
  const edges = keys.slice(1).map((k, i) => ({ from: k, to: keys[i] }));
  const r = changeOrder(keys, edges);
  assert.equal(r.order.length, 40);
  assert.deepEqual(r.order.flat().sort(), keys);
  assert.deepEqual(r.order[0], ['m00']);
});
