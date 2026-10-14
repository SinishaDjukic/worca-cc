// test/extension-capture-geometry.test.mjs — the area capture's crop math (extension/src/capture-geometry.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRect, cropPlan, MIN_SIDE, MAX_OUT_SIDE } from '../extension/src/capture-geometry.mjs';

const VP = { width: 1280, height: 720, dpr: 2 };

test('a reversed drag normalizes to the same rectangle', () => {
  assert.deepEqual(normalizeRect({ x: 110, y: 70 }, { x: 10, y: 20 }, VP), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 70 }, VP), { x: 10, y: 20, width: 100, height: 50 });
});

test('a drag past the viewport edges is clamped to it', () => {
  assert.deepEqual(normalizeRect({ x: -40, y: -5 }, { x: 1400, y: 800 }, VP), { x: 0, y: 0, width: 1280, height: 720 });
  assert.deepEqual(normalizeRect({ x: NaN, y: 10 }, { x: 20, y: 30 }, VP), { x: 0, y: 10, width: 20, height: 20 });
});

test('dpr 2: CSS rectangle → image pixels at twice the size', () => {
  const p = cropPlan({ rect: { x: 10, y: 20, width: 100, height: 50 }, viewport: VP, image: { width: 2560, height: 1440 } });
  assert.deepEqual(p, { sx: 20, sy: 40, sw: 200, sh: 100, dw: 200, dh: 100 });
});

test('browser zoom: the scale comes from the image width, not devicePixelRatio (D5)', () => {
  const p = cropPlan({ rect: { x: 100, y: 100, width: 100, height: 100 }, viewport: { width: 1280, height: 720, dpr: 1 }, image: { width: 1920, height: 1080 } });
  assert.deepEqual(p, { sx: 150, sy: 150, sw: 150, sh: 150, dw: 150, dh: 150 });
});

test('an unknown viewport size falls back to the dpr', () => {
  const p = cropPlan({ rect: { x: 10, y: 10, width: 10, height: 10 }, viewport: { dpr: 2 }, image: { width: 400, height: 400 } });
  assert.deepEqual(p, { sx: 20, sy: 20, sw: 20, sh: 20, dw: 20, dh: 20 });
});

test('a too-small rectangle or a missing image → null', () => {
  assert.equal(cropPlan({ rect: { x: 0, y: 0, width: MIN_SIDE - 1, height: 100 }, viewport: VP, image: { width: 2560, height: 1440 } }), null);
  assert.equal(cropPlan({ rect: { x: 0, y: 0, width: 100, height: 100 }, viewport: VP, image: { width: 0, height: 1440 } }), null);
  assert.equal(cropPlan({ rect: null, viewport: VP, image: { width: 10, height: 10 } }), null);
});

test('the output is capped at 2048 px on the longest side (D6)', () => {
  const p = cropPlan({ rect: { x: 0, y: 0, width: 3000, height: 1000 }, viewport: { width: 3000, height: 1000 }, image: { width: 3000, height: 1000 } });
  assert.equal(MAX_OUT_SIDE, 2048);
  assert.equal(p.dw, 2048);
  assert.equal(p.dh, 683);
  assert.equal(p.sw, 3000);
});

test('a rectangle past the image edge is clipped to the image', () => {
  const p = cropPlan({ rect: { x: 1200, y: 700, width: 200, height: 100 }, viewport: VP, image: { width: 2560, height: 1440 } });
  assert.ok(p.sw <= 2560 - p.sx);
  assert.ok(p.sh <= 1440 - p.sy);
  assert.equal(p.sx, 2400);
  assert.equal(p.sw, 160);
});
