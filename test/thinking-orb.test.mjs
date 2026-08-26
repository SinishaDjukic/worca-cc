// test/thinking-orb.test.mjs — the Ask Worca thinking orb (spec §10.5).
// The geometry is pure and tested directly; the element factory takes doc/win
// through its arguments (never globals), so jsdom drives it with a stubbed 2d
// context and no `canvas` npm package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createThinkingOrb, orbPoints, orbFrame, ORB_DOTS, ORB_TILT, ORB_SPEED } from '../ui/public/thinking-orb.mjs';

/** jsdom document whose canvases hand back a recording 2d context. */
function makeDoc({ context = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const rec = { scale: [], arcs: [], fills: [], clears: 0 };
  dom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!context) return null;
    return {
      scale: (a, b) => rec.scale.push([a, b]),
      clearRect: () => { rec.clears++; },
      beginPath: () => {},
      arc: (x, y, r) => rec.arcs.push([x, y, r]),
      fill: () => {},
      set fillStyle(v) { rec.fills.push(v); },
      get fillStyle() { return rec.fills[rec.fills.length - 1]; },
    };
  };
  Object.defineProperty(dom.window.document, 'hidden', { value: false, configurable: true });
  return { doc: dom.window.document, rec };
}

function makeWin({ raf = true } = {}) {
  const calls = { raf: [], cancelled: [] };
  let id = 0;
  const win = {
    devicePixelRatio: 2,
    performance: { now: () => win._t },
    _t: 0,
  };
  if (raf) {
    win.requestAnimationFrame = (fn) => { calls.raf.push(fn); return ++id; };
    win.cancelAnimationFrame = (n) => { calls.cancelled.push(n); };
  }
  return { win, calls };
}

test('thinking-orb: orbPoints is a unit Fibonacci sphere of ORB_DOTS points', () => {
  const pts = orbPoints();
  assert.equal(pts.length, ORB_DOTS);
  assert.equal(ORB_DOTS, 46);
  for (const [x, y, z] of pts) {
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9, 'every point sits on the unit sphere');
  }
  // y walks top → bottom, one even band per dot
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][1] < pts[i - 1][1], 'y descends monotonically');
});

test('thinking-orb: orbFrame sorts back-to-front so near dots paint last', () => {
  const pts = orbPoints();
  const out = orbFrame(pts, 1.7, { speed: ORB_SPEED, tilt: ORB_TILT });
  assert.equal(out.length, ORB_DOTS);
  for (let i = 1; i < out.length; i++) assert.ok(out[i][2] >= out[i - 1][2], 'z ascends: painter order');
  for (const [x, y, z] of out) assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9, 'rotation is rigid');
});

test('thinking-orb: orbFrame at t=0 with no tilt is the identity rotation', () => {
  const pts = orbPoints();
  const out = orbFrame(pts, 0, { speed: ORB_SPEED, tilt: 0 });
  const expect = [...pts].sort((a, b) => a[2] - b[2]);
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[i][k] - expect[i][k]) < 1e-9);
  }
});

test('thinking-orb: the element is sized in CSS px and its canvas in device px', () => {
  const { doc, rec } = makeDoc();
  const { win } = makeWin();
  const orb = createThinkingOrb({ doc, win, size: 30 });
  assert.match(orb.el.style.width, /^30px$/);
  assert.match(orb.el.style.height, /^30px$/);
  assert.equal(orb.el.getAttribute('aria-hidden'), 'true', 'decorative: never announced');
  const cv = orb.el.querySelector('canvas');
  assert.ok(cv, 'canvas mounted');
  assert.equal(cv.width, 60, '30 css px at dpr 2');
  assert.equal(cv.height, 60);
  assert.deepEqual(rec.scale, [[2, 2]], 'drawing stays in CSS px');
  orb.stop();
});

test('thinking-orb: the default size is 28.5 CSS px', () => {
  const { doc } = makeDoc();
  const { win } = makeWin();
  const orb = createThinkingOrb({ doc, win });
  assert.equal(orb.el.style.width, '28.5px');
  assert.equal(orb.el.style.height, '28.5px');
  assert.equal(orb.el.querySelector('canvas').width, 57, '28.5 css px at dpr 2, rounded');
  orb.stop();
});

test('thinking-orb: dpr is clamped at 2 so a 3x display does not paint 90px', () => {
  const { doc } = makeDoc();
  const { win } = makeWin();
  win.devicePixelRatio = 3;
  const orb = createThinkingOrb({ doc, win, size: 30 });
  assert.equal(orb.el.querySelector('canvas').width, 60);
  orb.stop();
});

test('thinking-orb: one frame paints every dot, nearest last and most opaque', () => {
  const { doc, rec } = makeDoc();
  const { win, calls } = makeWin();
  const orb = createThinkingOrb({ doc, win, size: 30 });
  win._t = 1700;
  calls.raf.shift()();                       // run exactly one frame
  assert.equal(rec.clears, 1, 'the frame is cleared before painting');
  assert.equal(rec.arcs.length, ORB_DOTS);
  const alpha = (s) => Number(/,([\d.]+)\)$/.exec(s)[1]);
  for (let i = 1; i < rec.fills.length; i++) {
    assert.ok(alpha(rec.fills[i]) >= alpha(rec.fills[i - 1]), 'alpha rises with depth');
  }
  assert.ok(alpha(rec.fills[0]) >= 0.08 && alpha(rec.fills[rec.fills.length - 1]) <= 0.9);
  for (const [x, y, r] of rec.arcs) {
    assert.ok(x >= 3 && x <= 27 && y >= 3 && y <= 27, 'every dot lands inside the 30px box');
    assert.ok(r >= 0.5 && r <= 1.55);
  }
  orb.stop();
});

test('thinking-orb: without requestAnimationFrame it stays inert and paints no canvas', () => {
  const { doc } = makeDoc();
  const { win } = makeWin({ raf: false });
  // Guarding here is what keeps jsdom's "getContext without the canvas npm
  // package" warning out of every ask-panel suite: no rAF, no canvas, no call.
  const orb = createThinkingOrb({ doc, win, size: 30 });
  assert.equal(orb.el.querySelector('canvas'), null);
  assert.doesNotThrow(() => orb.stop());
});

test('thinking-orb: start is idempotent and stop cancels the pending frame', () => {
  const { doc } = makeDoc();
  const { win, calls } = makeWin();
  const orb = createThinkingOrb({ doc, win, size: 30 });
  const after = calls.raf.length;
  assert.equal(after, 1, 'the factory arms the loop itself');
  orb.start();
  orb.start();
  assert.equal(calls.raf.length, after, 'a running loop is never double-armed');
  orb.stop();
  assert.equal(calls.cancelled.length, 1);
  orb.start();
  assert.equal(calls.raf.length, after + 1, 'stop then start re-arms');
  orb.stop();
});

test('thinking-orb: a null 2d context degrades to an inert element', () => {
  const { doc } = makeDoc({ context: false });
  const { win, calls } = makeWin();
  const orb = createThinkingOrb({ doc, win, size: 30 });
  assert.equal(calls.raf.length, 0, 'nothing to paint, nothing scheduled');
  assert.doesNotThrow(() => orb.start());
  assert.doesNotThrow(() => orb.stop());
});

test('thinking-orb: the phase is wall-clock, so re-parenting never rewinds the spin', () => {
  const { doc, rec } = makeDoc();
  const { win, calls } = makeWin();
  const orb = createThinkingOrb({ doc, win, size: 30 });
  win._t = 900;
  calls.raf.shift()();
  assert.equal(rec.arcs.length, ORB_DOTS);
  const before = rec.arcs.slice(-ORB_DOTS);
  // The panel moves the one orb into each rebuilt live row; a move stops and
  // restarts the loop, which must not reset t0.
  doc.body.appendChild(orb.el);
  orb.stop();
  orb.start();
  calls.raf.pop()();
  assert.equal(rec.arcs.length, ORB_DOTS * 2);
  const after = rec.arcs.slice(-ORB_DOTS);
  assert.deepEqual(after, before, 'same wall-clock t → same frame');
  orb.stop();
});
