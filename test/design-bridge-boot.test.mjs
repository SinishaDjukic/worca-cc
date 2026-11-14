import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SECTION_ID_RE } from '../src/core/design/ids.mjs';
import { bootBridge, BRIDGE_SRC, FINISHED_HERO } from './helpers/design-bridge.mjs';

const WRONG = { mode: 'run', kind: 'web', canvas: { w: 1440 } };   // accepted, this answers err
test('morphdom is an exact pin', () => {
  const v = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).dependencies.morphdom;
  assert.match(v, /^\d+\.\d+\.\d+$/);
});
test("the bridge's section id rule is P1's", () => { assert.ok(BRIDGE_SRC.includes(SECTION_ID_RE.source)); });
test('ready once, with the envelope, posted to *', async () => {
  const b = bootBridge();
  assert.deepEqual(b.sent, [{ m: { ns: 'worca-design', v: 1, n: 'n1', t: 'ready', mode: 'build', vw: 1024, vh: 768, dpr: 1 }, o: '*' }]);
});
test('mode comes from the path', () => { assert.equal(bootBridge({ mode: 'run' }).of('ready')[0].mode, 'run'); });
test('no #n= means an inert bridge: nothing sent, nothing obeyed', () => {
  const b = bootBridge({ hash: '' });
  b.send('hello', WRONG);
  assert.deepEqual(b.sent, []);
});
test('foreign messages are ignored with no reply', () => {
  const b = bootBridge(); b.sent.length = 0;
  b.send('hello', WRONG, { n: 'wrong' });
  b.send('hello', WRONG, { ns: 'other' });
  b.send('hello', WRONG, { v: 2 });
  b.send('hello', WRONG, { source: {} });
  b.send('hello', WRONG, { source: null });
  b.send('nope', {});
  b.win.dispatchEvent(new b.win.MessageEvent('message', { data: 'junk', source: b.win.parent }));
  assert.deepEqual(b.sent, []);
});
test('hello in the wrong mode is an err, capped at 300', () => {
  const b = bootBridge();
  b.send('hello', WRONG);
  const e = b.of('err')[0];
  assert.equal(e.code, 'mode-mismatch');
  assert.ok(e.message.length <= 300);
});
test('hello reports sections already in the doc, as rev 0 with no marks, once', () => {
  const b = bootBridge({ html: FINISHED_HERO });
  const hello = { mode: 'build', kind: 'web', canvas: { w: 1440 } };
  b.send('hello', hello); b.send('hello', hello);
  const a = b.of('applied');
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].id, a[0].rev, a[0].added, a[0].layers, a[0].marks], ['hero', 0, 2, 2, []]);
});
test('a bad body from the real parent is an err, not a throw', () => {
  const b = bootBridge();
  b.send('section', { id: 'BAD ID', rev: 1, html: '<p>' });
  b.send('section', { id: 'hero', rev: 'x', html: '<p>' });
  assert.deepEqual(b.of('err').map((e) => e.code), ['bad-message', 'bad-message']);
});

// Beyond the plan's cases: the slice's other rules, and the harness fakes Tasks 5-9 build on.
// Later handlers may answer other errors or `rects`, so these assert only what this slice decides.
const notRects = (b) => b.sent.filter(({ m }) => m.t !== 'rects');

test('only a /build/ or /run/ leaf path boots the bridge, and only parent-to-frame types are obeyed', () => {
  assert.deepEqual([bootBridge({ mode: 'build/assets' }).sent, bootBridge({ mode: 'preview' }).sent], [[], []]);
  const b = bootBridge(); b.sent.length = 0;
  for (const t of ['ready', 'applied', '__proto__', 'constructor']) b.send(t, { mode: 'build' });
  assert.deepEqual(b.sent, []);
});

test("each doc drops the other doc's types silently, before any body check", () => {
  const b = bootBridge(); b.sent.length = 0;
  b.send('pick', { on: 'x' });
  b.send('goto', { index: -1 });
  const r = bootBridge({ mode: 'run' }); r.sent.length = 0;
  r.send('plan', { sections: 'x' });
  r.send('section', { id: 'BAD ID', rev: 1, html: '', final: false });
  r.send('css', { file: '../x', rev: 1, text: '', final: false });
  assert.deepEqual([notRects(b), notRects(r)], [[], []]);
});

test('C-6 body checks: one bad-message per bad body, none for a good one', () => {
  const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
  const bad = [
    ['build', 'hello', { mode: 'other' }],
    ['build', 'plan', { sections: 'x' }],
    ['build', 'plan', { sections: { length: 0 } }],
    ['build', 'plan', { sections: ids(41) }],
    ['build', 'plan', { sections: [{ id: 'ok' }, { id: 'Bad' }] }],
    ['build', 'plan', { sections: [null] }],
    ['build', 'section', { id: 'BAD ID', rev: 1, html: '', final: false }],
    ['build', 'section', { id: 'hero', rev: -1, html: '', final: false }],
    ['build', 'section', { id: 'hero', rev: 1.5, html: '', final: false }],
    ['build', 'section', { id: 'hero', rev: 1, html: 2, final: false }],
    ['build', 'section', { id: 'hero', rev: 1, html: '' }],
    ['build', 'css', { file: '../x', rev: 1, text: '', final: false }],
    ['build', 'css', { file: 'hero', rev: '1', text: '', final: false }],
    ['build', 'css', { file: 'hero', rev: 1, text: null, final: false }],
    ['build', 'css', { file: 'hero', rev: 1, text: '', final: 'yes' }],
    ['build', 'scroll', { behavior: 'smooth' }],
    ['run', 'pick', { on: 'x' }],
    ['run', 'goto', { index: -1 }],
    ['run', 'goto', { index: 1.5 }],
  ];
  const good = [
    ['build', 'hello', { mode: 'build', kind: 'web' }],
    ['build', 'plan', { sections: [...ids(39), { id: 'tall', estHeight: 90000 }] }],
    ['build', 'section', { id: 'hero', rev: 0, html: '<p>', final: true }],
    ['build', 'css', { file: 'tokens', rev: 1, text: '', final: false }],
    ['build', 'css', { file: 'global', rev: 1, text: '', final: false }],
    ['build', 'scroll', { id: 'hero', behavior: 'evil' }],
    ['run', 'pick', { on: false }],
    ['run', 'goto', { index: 0 }],
  ];
  const codes = (list) => {
    const docs = { build: bootBridge(), run: bootBridge({ mode: 'run' }) };
    for (const [mode, t, f] of list) docs[mode].send(t, f);
    return [...docs.build.of('err'), ...docs.run.of('err')].map((e) => e.code).filter((c) => c === 'bad-message');
  };
  assert.equal(codes(bad).length, bad.length);
  assert.deepEqual(codes(good), []);
});

test('a handler that throws answers apply-failed with its message, capped at 300', () => {
  const thrower = (message) => {
    const b = bootBridge({ html: FINISHED_HERO, before(win) {
      const all = win.Element.prototype.querySelectorAll;
      win.Element.prototype.querySelectorAll = function (s) {
        if (this.getAttribute('data-section') === 'hero') throw new Error(message);
        return all.call(this, s);
      };
    } });
    b.send('hello', { mode: 'build', kind: 'web' });
    return b.of('err').map((e) => [e.code, e.message]);
  };
  assert.deepEqual(thrower('boom'), [['apply-failed', 'boom']]);
  assert.deepEqual(thrower('x'.repeat(500)), [['apply-failed', 'x'.repeat(300)]]);
});

test('hello counts each id once, from its outermost root, and layers sums them all', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="a"><div data-section="b"><p>x</p></div></section><section data-section="a"><i></i></section><section data-section="Bad"></section><section data-section="c"><b></b></section></body></html>' });
  b.send('hello', { mode: 'build', kind: 'web' });
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.added, a.layers]), [['a', 3, 5], ['c', 2, 5]]);
});

test('a doc still loading posts ready at DOMContentLoaded, once', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/design-preview/TOK/build/#n=n1', runScripts: 'outside-only' });
  const sent = [];
  dom.window.parent = { postMessage: (m) => sent.push(m.t) };
  dom.window.eval(BRIDGE_SRC);
  assert.equal(dom.window.document.readyState, 'loading');
  assert.deepEqual(sent, []);
  await new Promise((r) => dom.window.document.addEventListener('DOMContentLoaded', r));
  assert.deepEqual(sent, ['ready']);
  dom.window.close();
});

test('harness: the fake clock runs due timers in order, and frames only on frame()', () => {
  const b = bootBridge({ hash: '' });
  const seen = [];
  b.win.setTimeout(() => seen.push('late'), 125);
  b.win.setTimeout(() => { seen.push('now'); b.win.setTimeout(() => seen.push('chained'), 0); });
  b.win.clearTimeout(b.win.setTimeout(() => seen.push('cleared'), 10));
  b.win.setTimeout(() => seen.push('tie 1'), 20);
  b.win.setTimeout(() => seen.push('tie 2'), 20);
  b.win.requestAnimationFrame(() => { seen.push('frame'); b.win.requestAnimationFrame(() => seen.push('next frame')); });
  assert.equal(b.clock.maxPending, 4);
  b.clock.tick(124);
  assert.deepEqual(seen, ['now', 'chained', 'tie 1', 'tie 2']);
  b.clock.tick(1);
  b.clock.frame();
  assert.deepEqual(seen.slice(4), ['late', 'frame']);
  b.clock.frame();
  b.clock.frame();
  assert.deepEqual(seen.slice(6), ['next frame']);
});

test('harness: rects and scroll sizes come from data attributes, and each read sees pending writes', () => {
  const b = bootBridge({ hash: '', trackWrites: true, html: '<!doctype html><html><head></head><body><h1 data-r="1,2,3,4" data-tr="5,6,7,8" data-scroll="9,10,11,12">Ship</h1><p>x</p></body></html>' });
  const box = (r) => [r.x, r.y, r.width, r.height];
  const h1 = b.doc.querySelector('h1');
  const p = b.doc.querySelector('p');
  const range = b.doc.createRange();
  range.setStart(h1.firstChild, 3); range.setEnd(h1.firstChild, 4);
  assert.deepEqual([box(h1.getBoundingClientRect()), box(range.getBoundingClientRect()), box(p.getBoundingClientRect())], [[1, 2, 3, 4], [5, 6, 7, 8], [0, 0, 0, 0]]);
  assert.deepEqual([h1.scrollWidth, h1.scrollHeight, h1.clientWidth, h1.clientHeight, p.scrollHeight], [9, 10, 11, 12, 0]);
  b.writesSeenAtRead.length = 0;
  p.textContent = 'y';
  p.getBoundingClientRect(); range.getBoundingClientRect();
  assert.deepEqual(b.writesSeenAtRead, [1, 0]);
});

test('harness: morphdom, animate, reduced motion and ResizeObserver are there only when asked', () => {
  const plain = bootBridge({ mode: 'run' });
  assert.deepEqual([plain.win.morphdom, plain.win.Element.prototype.animate, plain.win.matchMedia, plain.win.ResizeObserver], [undefined, undefined, undefined, undefined]);
  assert.equal(bootBridge({ morphdom: false }).win.morphdom, undefined);
  const b = bootBridge({ animate: true, reducedMotion: true, resizeObserver: true });
  assert.equal(typeof b.win.morphdom, 'function');
  const p = b.doc.body.appendChild(b.doc.createElement('p'));
  b.win.eval("document.querySelector('p').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 })");
  assert.deepEqual(b.animated, [{ el: p, keyframes: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 250 } }]);
  assert.equal(b.win.matchMedia('(prefers-reduced-motion: reduce)').matches, true);
  const ro = new b.win.ResizeObserver(() => {});
  ro.observe(p); ro.observe(b.doc.body); ro.unobserve(p);
  assert.deepEqual([...b.observed], [b.doc.body]);
  ro.disconnect();
  assert.equal(b.observed.size, 0);
});
