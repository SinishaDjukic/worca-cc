import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBridge, SLOT_HERO, FINISHED_HERO, FORM_MEMBERS, overrideByControl } from './helpers/design-bridge.mjs';

const GHOSTS = (b) => b.animated.filter((a) => a.options.id === 'worca-ghost');
const held = (a) => a.options.duration === 600000;
const send = (b, html, o = {}) => b.send('section', { id: 'hero', rev: ++b.rev, final: false, html, ...o });

test('the ghost: the text being written holds doubled and dimmed, with no attribute added', () => {
  const b = bootBridge({ html: SLOT_HERO, animate: true }); b.rev = 0;
  send(b, '<section><p>Ship</p></section>');
  const g = GHOSTS(b);
  assert.equal(g.length, 1);
  assert.equal(g[0].el.tagName, 'P');
  assert.ok(held(g[0]));
  assert.equal(g[0].options.fill, 'both');
  assert.match(g[0].keyframes[0].textShadow, /calc\(\.05em \+ 2\.2px\).*rgb\(255 159 10 \/ \.5\).*rgb\(255 255 255 \/ \.34\)/);
  assert.equal(g[0].keyframes[0].opacity, 0.72);
  assert.equal(b.doc.querySelector('[data-section="hero"] p').outerHTML, '<p>Ship</p>');
});
test('text growing in the same element keeps one hold', () => {
  const b = bootBridge({ html: SLOT_HERO, animate: true }); b.rev = 0;
  send(b, '<section><p>Sh</p></section>'); b.clock.tick(125); send(b, '<section><p>Ship</p></section>'); b.clock.tick(125);
  assert.equal(GHOSTS(b).filter(held).length, 1);
});
test('the tail moves on: the old element settles in 550 ms to crisp, the new one holds', () => {
  const b = bootBridge({ html: SLOT_HERO, animate: true }); b.rev = 0;
  send(b, '<section><h1>a</h1></section>'); b.clock.tick(125); send(b, '<section><h1>a</h1><p>b</p></section>'); b.clock.tick(125);
  const settle = GHOSTS(b).find((g) => !held(g));
  assert.equal(settle.el.tagName, 'H1');
  assert.deepEqual([settle.options.duration, settle.options.easing], [550, 'ease-out']);
  assert.match(settle.keyframes[1].textShadow, /^0 0 0 rgb\(255 159 10 \/ 0\), 0 0 0 rgb\(255 255 255 \/ 0\)$/);
  assert.equal(settle.keyframes[1].opacity, 1);
  assert.equal(GHOSTS(b).filter(held).at(-1).el.tagName, 'P');
});
test('final settles the last one; a section with no text gets none; reduced motion gets none; a missing animate does not throw', () => {
  const b = bootBridge({ html: SLOT_HERO, animate: true }); b.rev = 0;
  send(b, '<section><p>x</p></section>', { final: true }); b.clock.tick(0);
  assert.ok(GHOSTS(b).some((g) => !held(g) && g.el.tagName === 'P'));
  const img = bootBridge({ html: SLOT_HERO, animate: true }); img.rev = 0;
  send(img, '<section><img data-r="1,2,3,4"></section>');
  assert.deepEqual(GHOSTS(img), []);
  const r = bootBridge({ html: SLOT_HERO, animate: true, reducedMotion: true }); r.rev = 0;
  send(r, '<section><p>x</p></section>');
  assert.deepEqual(GHOSTS(r), []);
  const n = bootBridge({ html: SLOT_HERO }); n.rev = 0;
  send(n, '<section><p>x</p></section>');
  assert.deepEqual(n.of('err'), []);
});
test('the run doc never ghosts: it never flushes (IGNORED.run, bridge.js:19)', () => {
  const b = bootBridge({ mode: 'run', html: FINISHED_HERO, animate: true });
  b.send('hello', { mode: 'run' });
  assert.equal(b.of('applied').length > 0, true);
  assert.deepEqual(GHOSTS(b), []);
});
test('applied.tail.box is the element around the caret; with no text it equals the tail rect', () => {
  const b = bootBridge({ html: SLOT_HERO }); b.rev = 0;
  send(b, '<section data-r="10,20,500,300"><h1 data-r="10,20,400,40" data-tr="300,30,8,20">Ship</h1></section>');
  assert.deepEqual(b.of('applied')[0].tail, { rect: [300, 30, 8, 20], tag: 'h1', box: [10, 20, 400, 40] });
  const c = bootBridge({ html: SLOT_HERO }); c.rev = 0;
  send(c, '<section data-r="0,0,10,10"><img data-r="5,6,7,8"></section>');
  assert.deepEqual(c.of('applied')[0].tail, { rect: [5, 6, 7, 8], tag: 'img', box: [5, 6, 7, 8] });
});
test('scroll to a number: auto jumps; ms tweens by frames and ends exactly there; a wheel cancels it; ms is capped at 400; no y keeps the old path', () => {
  const b = bootBridge({ html: SLOT_HERO }); const tops = [];
  b.win.scrollTo = (o) => tops.push({ ...o });
  b.send('scroll', { y: 500, behavior: 'auto' });
  assert.deepEqual(tops.at(-1), { top: 500, behavior: 'instant' });
  tops.length = 0;
  b.send('scroll', { y: 1000, behavior: 'smooth', ms: 9999 });
  b.clock.tick(100); b.clock.frame(); b.clock.tick(100); b.clock.frame();
  assert.ok(tops.length >= 1 && tops.at(-1).top < 1000);
  b.clock.tick(250); b.clock.frame();
  assert.equal(tops.at(-1).top, 1000);
  const n = tops.length; b.clock.tick(100); b.clock.frame();
  assert.equal(tops.length, n, 'done');
  b.send('scroll', { y: 0, behavior: 'smooth', ms: 400 });
  b.doc.dispatchEvent(new b.win.Event('wheel', { bubbles: true }));
  const m = tops.length; b.clock.tick(100); b.clock.frame();
  assert.equal(tops.length, m, 'the person took it');
  b.send('scroll', { y: Infinity, behavior: 'auto' });
  assert.equal(tops.length, m, 'not a number');
  assert.equal(b.of('err').at(-1).code, 'bad-message', 'a scroll with neither id nor a finite y is still refused (boot.test:97)');
  const calls = []; b.win.Element.prototype.scrollIntoView = function (o) { calls.push({ ...o }); };
  b.send('scroll', { id: 'hero', behavior: 'smooth' });
  assert.deepEqual(calls, [{ behavior: 'smooth', block: 'start' }]);
});
test('a tween survives a hidden tab: a timer lands the end', () => {
  const b = bootBridge({ html: SLOT_HERO }); const tops = []; b.win.scrollTo = (o) => tops.push({ ...o });
  b.send('scroll', { y: 800, behavior: 'smooth', ms: 400 });
  b.clock.tick(460);
  assert.equal(tops.at(-1).top, 800);
});
test('zoom: a ctrl or meta wheel in the build doc is taken and reported; a plain wheel is left alone; the run doc keeps its own', () => {
  const W = (b, o) => { const e = Object.assign(new b.win.Event('wheel', { bubbles: true, cancelable: true }), { deltaY: 50, clientY: 120, ctrlKey: false, metaKey: false, ...o }); b.doc.dispatchEvent(e); return e; };
  const b = bootBridge({ html: SLOT_HERO });
  assert.equal(W(b, { ctrlKey: true }).defaultPrevented, true);
  assert.equal(W(b, { metaKey: true }).defaultPrevented, true);
  assert.deepEqual(b.of('zoom').map((m) => [m.dy, m.y]), [[50, 120], [50, 120]]);
  assert.equal(W(b, {}).defaultPrevented, false);
  assert.equal(b.of('zoom').length, 2);
  const r = bootBridge({ mode: 'run', html: FINISHED_HERO });
  assert.equal(W(r, { ctrlKey: true }).defaultPrevented, false);
  assert.deepEqual(r.of('zoom'), []);
});

// Beyond the plan's Step 1 rows: the ones its Step 3 asks for, and the branches they leave unpinned.
test('tail.box goes through Element\'s own getter: a form whose controls override its members still reports one, with no error', () => {
  const b = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><deck-stage>'
    + '<form data-section="s1" data-r="1,2,3,4" data-tr="9,9,2,2">Ship <input name="m"></form>'
    + '<section data-section="s2"><form></form><form id="f2"><input name="m"><p id="pp" data-r="5,6,7,8">x</p></form></section></deck-stage></body></html>' });
  const f1 = overrideByControl(b.doc.querySelector('form'), [...FORM_MEMBERS, 'scrollIntoView']);
  overrideByControl(b.doc.getElementById('f2'));
  assert.equal(f1.getBoundingClientRect.localName, 'input', 'the override is in place');
  b.send('hello', { mode: 'run' });
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.tail]), [
    ['s1', { rect: [9, 9, 2, 2], tag: 'form', box: [1, 2, 3, 4] }],
    ['s2', { rect: [5, 6, 7, 8], tag: 'p', box: [5, 6, 7, 8] }],
  ]);
});
test('a jump before the doc is complete is repeated once at load, unless the person wheeled, touched, typed or clicked first', () => {
  // The harness pins readyState to 'interactive'.
  const b = bootBridge({ mode: 'run', html: FINISHED_HERO }); const tops = []; b.win.scrollTo = (o) => tops.push(o.top);
  b.send('scroll', { y: 900, behavior: 'auto' });
  b.win.dispatchEvent(new b.win.Event('load'));
  b.win.dispatchEvent(new b.win.Event('load'));
  assert.deepEqual(tops, [900, 900], 'once');
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    const p = bootBridge({ mode: 'run', html: FINISHED_HERO }); const seen = []; p.win.scrollTo = (o) => seen.push(o.top);
    p.send('scroll', { y: 900, behavior: 'auto' });
    p.doc.dispatchEvent(new p.win.Event(ev, { bubbles: true }));
    p.win.dispatchEvent(new p.win.Event('load'));
    assert.deepEqual(seen, [900], ev);
  }
  const later = bootBridge({ mode: 'run', html: FINISHED_HERO }); const at = []; later.win.scrollTo = (o) => at.push(o.top);
  later.send('scroll', { y: 900, behavior: 'auto' });
  later.send('scroll', { y: 300, behavior: 'auto' });
  later.win.dispatchEvent(new later.win.Event('load'));
  assert.deepEqual(at, [900, 300, 300], 'the newest jump is the one repeated');
  const tw = bootBridge({ html: SLOT_HERO }); const tt = []; tw.win.scrollTo = (o) => tt.push(o.top);
  tw.send('scroll', { y: 900, behavior: 'auto' });
  tw.send('scroll', { y: 100, behavior: 'smooth', ms: 400 });
  tw.clock.tick(460);
  tw.win.dispatchEvent(new tw.win.Event('load'));
  assert.deepEqual(tt, [900, 100], 'a newer tween drops the repeat');
  const done = bootBridge({ mode: 'run', html: FINISHED_HERO,
    before: (win) => Object.defineProperty(win.Document.prototype, 'readyState', { configurable: true, get: () => 'complete' }) });
  const once = []; done.win.scrollTo = (o) => once.push(o.top);
  done.send('scroll', { y: 900, behavior: 'auto' });
  done.win.dispatchEvent(new done.win.Event('load'));
  assert.deepEqual(once, [900], 'a complete doc: no repeat');
});
test('scroll {y}: ms must be a finite number of at least 0; reduced motion and a non-smooth behaviour jump', () => {
  const b = bootBridge({ html: SLOT_HERO }); const tops = []; b.win.scrollTo = (o) => tops.push({ ...o });
  for (const ms of [-1, NaN, Infinity, '400', null]) b.send('scroll', { y: 10, behavior: 'smooth', ms });
  for (const y of ['10', null, NaN]) b.send('scroll', { y, behavior: 'auto' });
  assert.equal(b.of('err').filter((e) => e.code === 'bad-message').length, 8);
  assert.deepEqual(tops, []);
  b.send('scroll', { y: 10, behavior: 'auto', ms: 400 });
  b.send('scroll', { y: 20, behavior: 'smooth' });
  assert.deepEqual(tops, [{ top: 10, behavior: 'instant' }, { top: 20, behavior: 'instant' }]);
  const r = bootBridge({ html: SLOT_HERO, reducedMotion: true }); const rt = []; r.win.scrollTo = (o) => rt.push({ ...o });
  r.send('scroll', { y: 30, behavior: 'smooth', ms: 400 });
  assert.deepEqual(rt, [{ top: 30, behavior: 'instant' }]);
  const z = bootBridge({ html: SLOT_HERO }); const zt = []; z.win.scrollTo = (o) => zt.push(o.top);
  z.send('scroll', { y: 40, behavior: 'smooth', ms: 0 });
  z.clock.frame();
  assert.deepEqual(zt, [40], 'ms 0 lands on the first frame');
  z.clock.tick(100);
  assert.deepEqual(zt, [40], 'and its timer is cleared');
});
const pinState = (state) => (win) => Object.defineProperty(win.Document.prototype, 'readyState', { configurable: true, get: () => state });
test('R16 (P4 review M4): the doc reports its own window load as `loaded {mode}`, after `ready`; a doc complete at boot reports it at once', () => {
  // The harness pins readyState to 'interactive': ready at boot, and the load is still to come.
  const b = bootBridge({ mode: 'run', html: FINISHED_HERO });
  assert.deepEqual(b.sent.map(({ m }) => m.t), ['ready']);
  b.load();
  assert.deepEqual(b.sent.map(({ m }) => m.t), ['ready', 'loaded']);
  assert.deepEqual(b.of('loaded'), [{ ns: 'worca-design', v: 1, n: 'n1', t: 'loaded', mode: 'run' }]);
  const build = bootBridge({ html: SLOT_HERO });
  build.load();
  assert.deepEqual(build.of('loaded').map((m) => m.mode), ['build']);
  const done = bootBridge({ mode: 'run', html: FINISHED_HERO, before: pinState('complete') });
  assert.deepEqual(done.sent.map(({ m }) => [m.t, m.mode]), [['ready', 'run'], ['loaded', 'run']]);
});
test('R16 (P4 review cycle 3 M1): `loaded` goes once per doc, and only for a trusted load: a synthetic `load` before `ready` or after the report posts nothing', () => {
  // readyState 'loading' at boot: `ready` waits for DOMContentLoaded.
  const b = bootBridge({ mode: 'run', html: FINISHED_HERO, before: pinState('loading') });
  b.win.dispatchEvent(new b.win.Event('load'));   // a section script's, before `ready`: it must not use up the report
  assert.deepEqual(b.sent.map(({ m }) => m.t), [], 'a synthetic load before ready says nothing');
  b.doc.dispatchEvent(new b.win.Event('DOMContentLoaded'));
  b.load();
  assert.deepEqual(b.sent.map(({ m }) => m.t), ['ready', 'loaded'], 'the real load still reports');
  b.win.dispatchEvent(new b.win.Event('load'));   // a section script re-running its late initialisers
  assert.deepEqual(b.sent.map(({ m }) => m.t), ['ready', 'loaded'], 'a synthetic load after the report posts no second one');
  // A doc complete at boot reported then: a trusted load after it is not a second report.
  const done = bootBridge({ mode: 'run', html: FINISHED_HERO, before: pinState('complete') });
  done.load();
  assert.deepEqual(done.sent.map(({ m }) => m.t), ['ready', 'loaded'], 'once per doc');
});
