// test/ui-dot-orb.test.mjs — the worca orb (ui/public/dot-orb.mjs): phases, the shared frame loop, the jsdom-safe path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDotOrbs, orbSphere, ORB_PHASES } from '../ui/public/dot-orb.mjs';

/** A window with a hand-cranked rAF and a 2d context that counts its dots. */
function rig({ reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const win = dom.window;
  const frames = [];
  win.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  win.cancelAnimationFrame = (id) => { frames[id - 1] = null; };
  win.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  const ctx = { arcs: 0, clears: 0, clearRect() { this.clears += 1; }, beginPath() {}, arc() { this.arcs += 1; }, fill() {}, set fillStyle(v) { this.fill_ = v; }, get fillStyle() { return this.fill_; }, globalAlpha: 1 };
  win.HTMLCanvasElement.prototype.getContext = () => ctx;
  let t = 0;
  const crank = (n = 1) => { for (let i = 0; i < n; i += 1) { const cb = frames.splice(0).filter(Boolean)[0]; if (!cb) return false; t += 16; cb(t); } return true; };
  const pending = () => frames.some(Boolean);
  const place = (el) => { win.document.body.appendChild(el); Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => win.document.body }); return el; };
  return { win, doc: win.document, ctx, crank, pending, place };
}

test('orbSphere: n unit points, cached', () => {
  const a = orbSphere(110);
  assert.equal(a.length, 330);
  for (let i = 0; i < 110; i += 1) assert.ok(Math.abs(Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]) - 1) < 1e-5);
  assert.equal(orbSphere(110), a);
  assert.deepEqual(Object.keys(ORB_PHASES), ['rest', 'think', 'tool', 'write']);
  assert.equal(ORB_PHASES.rest.spin, 0, 'rest never turns');
});

test('no requestAnimationFrame (jsdom): phases still mark the canvas, and no 2d context is ever asked for', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  let asked = 0;
  dom.window.HTMLCanvasElement.prototype.getContext = () => { asked += 1; return null; };
  const orbs = createDotOrbs({ doc: dom.window.document, win: dom.window });
  const el = orbs.create(22, 'x');
  assert.deepEqual([el.tagName, el.className, el.dataset.phase, el.getAttribute('aria-hidden'), el.style.width], ['CANVAS', 'dot-orb x', 'rest', 'true', '22px']);
  dom.window.document.body.appendChild(el);
  orbs.set(el, 'tool');
  assert.deepEqual([el.dataset.phase, el.classList.contains('is-live'), orbs.phase(el)], ['tool', true, 'tool']);
  orbs.set(el, 'nonsense');
  assert.deepEqual([el.dataset.phase, el.classList.contains('is-live')], ['rest', false], 'an unknown phase rests');
  assert.equal(asked, 0);
  orbs.destroy();
  dom.window.close();
});

test('a live orb animates on the shared loop; back at rest it eases to a stop and the loop ends', () => {
  const r = rig();
  const orbs = createDotOrbs({ doc: r.doc, win: r.win });
  const el = r.place(orbs.create(22));
  orbs.set(el, 'rest');
  const still = r.ctx.arcs;
  assert.ok(still > 0, 'a resting orb draws one still frame');
  assert.equal(r.pending(), false, 'and schedules nothing');
  orbs.set(el, 'rest');
  assert.equal(r.ctx.arcs, still, 'a repaint of a still orb redraws nothing');
  orbs.set(el, 'think');
  assert.equal(r.pending(), true);
  r.crank(30);
  assert.equal(r.pending(), true, 'thinking keeps moving');
  orbs.set(el, 'rest');
  let n = 0;
  while (r.pending() && n < 2000) { r.crank(); n += 1; }
  assert.ok(n > 5 && n < 2000, `eased to a stop over ${n} frames`);
  orbs.destroy();
  r.win.close();
});

test('two orbs share one loop; a hidden live orb keeps the loop but draws nothing', () => {
  const r = rig();
  const orbs = createDotOrbs({ doc: r.doc, win: r.win });
  const a = r.place(orbs.create(22));
  const b = orbs.create(16);
  r.doc.body.appendChild(b);                       // connected, offsetParent null: out of sight
  orbs.set(a, 'tool'); orbs.set(b, 'write');
  r.crank();
  const before = r.ctx.arcs;
  orbs.set(a, 'rest');
  r.crank(400);
  const after = r.ctx.arcs;
  assert.equal(r.pending(), true, 'b is still live');
  r.crank(5);
  assert.equal(r.ctx.arcs, after, 'hidden b draws nothing');
  assert.ok(after > before);
  orbs.set(b, 'rest');
  r.crank(2);
  assert.equal(r.pending(), false, 'hidden and resting: snapped still, the loop ends');
  orbs.destroy();
  r.win.close();
});

test('reduced motion: every phase is one still frame, nothing scheduled; destroy cancels a pending frame', () => {
  const r = rig({ reduced: true });
  const orbs = createDotOrbs({ doc: r.doc, win: r.win });
  const el = r.place(orbs.create(22));
  orbs.set(el, 'write');
  assert.ok(r.ctx.arcs > 0);
  assert.equal(r.pending(), false);
  assert.equal(el.dataset.phase, 'write');
  orbs.destroy();
  const r2 = rig();
  const o2 = createDotOrbs({ doc: r2.doc, win: r2.win });
  o2.set(r2.place(o2.create(22)), 'think');
  assert.equal(r2.pending(), true);
  o2.destroy();
  assert.equal(r2.pending(), false);
  r.win.close(); r2.win.close();
});
