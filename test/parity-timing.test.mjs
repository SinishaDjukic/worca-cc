// test/parity-timing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, withinBudget, NOISE_FLOOR_MS } from '../tools/parity/timing.mjs';

test('median of 5', () => assert.equal(median([5, 1, 4, 2, 3]), 3));
test('median of no samples is null, not NaN', () => assert.equal(median([]), null));
test('withinBudget: up to 10% above passes, above 10% and above the floor fails, faster passes', () => {
  assert.deepEqual(withinBudget(1000, 1100, { floorMs: 100 }), { pass: true, deltaPct: 10, deltaMs: 100 });
  assert.equal(withinBudget(2000, 2201, { floorMs: 100 }).pass, false);
  assert.equal(withinBudget(1000, 500, { floorMs: 100 }).pass, true);
});
test('a delta under the noise floor passes even above 10%', () => {
  assert.equal(withinBudget(200, 240, { floorMs: NOISE_FLOOR_MS.page }).pass, true);   // +20%, +40 ms
  assert.equal(withinBudget(200, 260, { floorMs: NOISE_FLOOR_MS.page }).pass, false);  // +30%, +60 ms
});
