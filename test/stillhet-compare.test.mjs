// test/stillhet-compare.test.mjs — the pure parts of tools/stillhet-compare.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDiffPixels, PARTS, report } from '../tools/stillhet-compare.mjs';

test('countDiffPixels: 0 for equal buffers, 1 for one changed channel, w*h for a size mismatch', () => {
  const a = new Uint8ClampedArray(2 * 2 * 4).fill(7), b = new Uint8ClampedArray(a);
  assert.equal(countDiffPixels(a, b, 2, 2), 0);
  b[5] = 8;
  assert.equal(countDiffPixels(a, b, 2, 2), 1);
  assert.equal(countDiffPixels(a, new Uint8ClampedArray(8), 2, 2), 4);
});

test('PARTS lists the invitation and the design switch', () => {
  assert.deepEqual(PARTS.map((p) => p.id), ['invitation', 'design-switch']);
});

test('report: exit 1 on a box-size mismatch or any differing pixel, 0 otherwise', () => {
  const cell = (o) => ({ part: 'invitation', theme: 'dark', width: 1280, appBox: { w: 10, h: 5 }, protoBox: { w: 10, h: 5 }, diff: 0, ...o });
  assert.equal(report([cell({})]).code, 0);
  assert.equal(report([cell({ diff: 1 })]).code, 1);
  const r = report([cell({ protoBox: { w: 11, h: 5 } })]);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /app 10x5, prototype 11x5/);
});
