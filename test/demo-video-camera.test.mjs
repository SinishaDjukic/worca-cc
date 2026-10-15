// test/demo-video-camera.test.mjs — the demo video's virtual camera (tools/demo/extension-video/lib/camera.mjs): easing,
// keyframe interpolation, crops kept inside the frame at the output's aspect, and the ffmpeg sendcmd script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easeInOut, fitRect, rectAt, deviceCrop, sendcmdScript, cameraFilter, hudCapX, unionBox } from '../tools/demo/extension-video/lib/camera.mjs';

const FRAME = { width: 1920, height: 1080 };
const FULL = { x: 0, y: 0, width: 1920, height: 1080 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('easeInOut: 0 → 1, symmetric, slow at both ends, clamped outside [0,1]', () => {
  assert.equal(easeInOut(0), 0); assert.equal(easeInOut(1), 1); assert.equal(easeInOut(0.5), 0.5);
  assert.ok(near(easeInOut(0.25) + easeInOut(0.75), 1));
  assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9, 'eases in and out');
  assert.equal(easeInOut(-1), 0); assert.equal(easeInOut(2), 1);
  for (let t = 0; t < 1; t += 0.05) assert.ok(easeInOut(t + 0.05) >= easeInOut(t), 'monotonic');
});

test('fitRect: no target is the full frame', () => {
  assert.deepEqual(fitRect(null, { frame: FRAME }), FULL);
});

test('fitRect: a fixed zoom centres on the target at the output aspect', () => {
  const r = fitRect({ x: 900, y: 400, width: 100, height: 100 }, { frame: FRAME, zoom: 2 });
  assert.deepEqual(r, { x: 950 - 480, y: 450 - 270, width: 960, height: 540 });
});

test('fitRect: the crop stays inside the frame (clamped at every edge)', () => {
  const right = fitRect({ x: 1460, y: 16, width: 440, height: 300 }, { frame: FRAME, zoom: 1.5 });
  assert.equal(right.x + right.width, 1920); assert.equal(right.y, 0);
  const bottomLeft = fitRect({ x: 0, y: 1000, width: 50, height: 50 }, { frame: FRAME, zoom: 3 });
  assert.equal(bottomLeft.x, 0); assert.equal(bottomLeft.y + bottomLeft.height, 1080);
});

test('fitRect: without a zoom it fits target + padding, never past maxZoom nor wider than the frame', () => {
  const r = fitRect({ x: 500, y: 300, width: 600, height: 200 }, { frame: FRAME, pad: 20, maxZoom: 2.5 });
  assert.ok(near(r.width / r.height, 16 / 9), 'output aspect');
  assert.ok(r.x <= 480 && r.x + r.width >= 1120 && r.y <= 280 && r.y + r.height >= 520, 'target + pad inside');
  assert.equal(r.width, 768, 'maxZoom 2.5 wins over the 640 px the target needs');
  const tiny = fitRect({ x: 900, y: 500, width: 4, height: 4 }, { frame: FRAME, maxZoom: 2 });
  assert.equal(tiny.width, 960, 'capped at maxZoom');
  const huge = fitRect({ x: 0, y: 0, width: 1900, height: 1070 }, { frame: FRAME, pad: 40 });
  assert.deepEqual(huge, FULL, 'never larger than the frame');
});

test('rectAt: holds before the first key, eases between keys, holds after the move', () => {
  const A = { x: 960, y: 540, width: 960, height: 540 };
  const keys = [{ t: 10, rect: A, ms: 600 }];
  assert.deepEqual(rectAt(keys, 9.9, FULL), FULL);
  assert.deepEqual(rectAt(keys, 10, FULL), FULL);
  const mid = rectAt(keys, 10.3, FULL);
  assert.ok(near(mid.width, 1440) && near(mid.x, 480), 'halfway (ease 0.5) at half the duration');
  const early = rectAt(keys, 10.06, FULL);
  assert.ok(early.width > FULL.width - 0.1 * (FULL.width - A.width), 'slower than linear at the start');
  assert.deepEqual(rectAt(keys, 10.6, FULL), A);
  assert.deepEqual(rectAt(keys, 99, FULL), A);
});

test('rectAt: a move that starts mid-move starts from where the camera is, with no jump', () => {
  const A = { x: 960, y: 540, width: 960, height: 540 };
  const keys = [{ t: 0, rect: A, ms: 1000 }, { t: 0.5, rect: FULL, ms: 1000 }];
  const at = rectAt(keys, 0.5, FULL);
  const before = rectAt(keys, 0.4999, FULL);
  assert.ok(near(at.width, before.width, 1) && near(at.x, before.x, 1), 'continuous at the hand-over');
  assert.deepEqual(rectAt(keys, 1.5, FULL), FULL);
});

test('deviceCrop: device pixels, even and inside the frame, aspect within one even step', () => {
  const c = deviceCrop({ x: 470.3, y: 181.7, width: 960.4, height: 540.2 }, { scale: 2, frame: FRAME });
  for (const k of ['x', 'y', 'w', 'h']) assert.equal(c[k] % 2, 0, k);
  assert.ok(c.x + c.w <= 3840 && c.y + c.h <= 2160 && c.x >= 0 && c.y >= 0);
  assert.ok(Math.abs(c.w / c.h - 16 / 9) < 0.005, `aspect ${c.w}/${c.h}`);
  const edge = deviceCrop({ x: 1919, y: 1079, width: 960, height: 540 }, { scale: 2, frame: FRAME });
  assert.equal(edge.x + edge.w, 3840); assert.equal(edge.y + edge.h, 2160);
  assert.deepEqual(deviceCrop(FULL, { scale: 2, frame: FRAME }), { x: 0, y: 0, w: 3840, h: 2160 });
});

test('sendcmdScript: one crop command per frame while moving, none while holding; times are from the first frame', () => {
  const A = { x: 960, y: 540, width: 960, height: 540 };
  const s = sendcmdScript([{ t: 101, rect: A, ms: 500 }], { t0: 100, durationS: 3, fps: 10, frame: FRAME, scale: 2 });
  const lines = s.trim().split('\n');
  assert.equal(lines.length, 5, s);   // t = 1.1 … 1.5 (1.0 is still the full frame)
  assert.match(lines[0], /^1\.1000 crop x 0, crop y 0, crop w \d+, crop h \d+, crop x \d+, crop y \d+;$/);
  assert.match(lines.at(-1), /^1\.5000 crop x 0, crop y 0, crop w 1920, crop h 1080, crop x 1920, crop y 1080;$/);
  assert.equal(sendcmdScript([], { t0: 0, durationS: 2, fps: 10, frame: FRAME, scale: 2 }), '');
});

test('cameraFilter: sendcmd drives a full-frame crop, then the downscale to the output size', () => {
  assert.equal(cameraFilter('/tmp/w/camera.cmd', { width: 1920, height: 1080 }),
    "sendcmd=f='/tmp/w/camera.cmd',crop=w=iw:h=ih:x=0:y=0,scale=1920:1080:flags=lanczos");
  assert.throws(() => cameraFilter("/tmp/it's/camera.cmd", FRAME), /quote/);
});

test('hudCapX: captions centre on the visible page column left of the sidebar, in output pixels', () => {
  assert.equal(hudCapX(FULL, null, 1920), 960, 'no sidebar: centre');
  assert.equal(hudCapX(FULL, 1464, 1920), 732, 'full stage: centre of the app column');
  const zoomed = { x: 920, y: 400, width: 1000, height: 562.5 };
  assert.ok(near(hudCapX(zoomed, 1464, 1920), (1464 - 920) * 1.92 / 2));
  assert.equal(hudCapX(zoomed, 2500, 1920), 960, 'sidebar off camera: centre');
  assert.equal(hudCapX({ x: 1400, y: 0, width: 400, height: 225 }, 1464, 1920), 400, 'never closer to the edge than the minimum');
});

test('unionBox: the box around several element boxes; missing boxes are skipped', () => {
  assert.deepEqual(unionBox({ x: 10, y: 20, width: 30, height: 40 }, null, { x: 0, y: 50, width: 100, height: 5 }), { x: 0, y: 20, width: 100, height: 40 });
  assert.equal(unionBox(null, undefined), null);
});
