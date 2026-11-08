import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBridge, SLOT_HERO, SLOTS } from './helpers/design-bridge.mjs';
function scrolled(b) { Object.defineProperty(b.win, 'scrollX', { value: 100, configurable: true }); Object.defineProperty(b.win, 'scrollY', { value: 1000, configurable: true }); return b; }
test('applied is in document coordinates, with the tail on the last character', () => {
  const b = scrolled(bootBridge({ html: SLOT_HERO }));
  b.send('section', { id: 'hero', rev: 1, final: false,
    html: '<section data-r="10,20,500,300"><h1 data-r="10,20,400,40" data-tr="300,30,8,20">Ship</h1></section>' });
  const a = b.of('applied')[0];
  assert.deepEqual(a.rect, [110, 1020, 500, 300]);
  assert.deepEqual(a.tail, { rect: [400, 1030, 8, 20], tag: 'h1' });
});
test('no text: the tail is the deepest last element, and media marks say media', () => {
  const b = scrolled(bootBridge({ html: SLOT_HERO }));
  b.send('section', { id: 'hero', rev: 1, final: false,
    html: '<section data-r="0,0,10,10"><div data-r="1,2,3,4"><img data-r="5,6,7,8"></div></section>' });
  const a = b.of('applied')[0];
  assert.deepEqual(a.tail, { rect: [105, 1006, 7, 8], tag: 'img' });
  assert.deepEqual(a.marks.map((m) => [m.tag, m.kind]), [['section', 'el'], ['div', 'el'], ['img', 'media']]);
});
test('marks hold at most 24, the newest ones, with no style elements', () => {
  const b = bootBridge({ html: SLOT_HERO });
  b.send('section', { id: 'hero', rev: 1, final: false, html: `<section><style>.a{}</style>${'<p>x</p>'.repeat(40)}<b>last</b></section>` });
  const m = b.of('applied')[0].marks;
  assert.equal(m.length, 24);
  assert.equal(m.at(-1).tag, 'b');
  assert.ok(!m.some((x) => x.tag === 'style'));
});
test('rect values are finite and clamped to 2e5', () => {
  const b = scrolled(bootBridge({ html: SLOT_HERO }));
  b.send('section', { id: 'hero', rev: 1, final: false, html: '<section data-r="NaN,1e9,10,-1e9">a</section>' });
  assert.deepEqual(b.of('applied')[0].rect, [0, 200000, 10, -200000]);
});
test('M5: overflow on web is the right edge past the canvas, even for a section narrower than the canvas', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('hello', { mode: 'build', kind: 'web', canvas: { w: 1440 } });
  b.send('section', { id: 'hero', rev: 1, final: false, html: '<section data-r="1000,0,500,10">a</section>' });
  b.send('section', { id: 'price', rev: 1, final: false, html: '<section data-r="940,0,500,10">a</section>' });
  b.clock.tick(125);
  assert.deepEqual(b.of('applied').map((a) => a.overflow), [true, false]);
});
test('M9: overflow on a deck or video tile compares the tile with itself, so a board scale cannot hide it', () => {
  const d = bootBridge({ html: SLOTS });
  d.send('hello', { mode: 'build', kind: 'pitch', canvas: { w: 1920, h: 1080 } });
  d.send('section', { id: 'hero', rev: 1, final: false, html: '<section data-r="0,0,480,270" data-scroll="1920,1400,1920,1080">a</section>' });
  d.send('section', { id: 'price', rev: 1, final: false, html: '<section data-r="480,0,480,270" data-scroll="1920,1080,1920,1080">a</section>' });
  d.clock.tick(125);
  assert.deepEqual(d.of('applied').map((a) => a.overflow), [true, false]);
});
test('M9: nothing assumes one section on screen, and the page and tiles are left for the board style', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main><div data-worca-slot="s1"></div><div data-worca-slot="s2"></div><!--worca:sections--></main></body></html>' });
  b.send('hello', { mode: 'build', kind: 'video', canvas: { w: 1920, h: 1080, fps: 60 } });
  b.send('plan', { sections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
  b.send('section', { id: 's1', rev: 1, html: '<div data-scene="1">a</div>', final: false });
  b.send('section', { id: 's2', rev: 1, html: '<div data-scene="2">b</div>', final: false });
  b.clock.tick(125); b.clock.frame();
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => s.id), ['s1', 's2', 's3']);
  assert.deepEqual(b.of('applied').map((a) => a.id), ['s1', 's2']);
  assert.equal(b.doc.querySelector('[data-worca-slot="s3"]').getAttribute('style'), null);
  assert.equal(b.doc.documentElement.getAttribute('style'), null);
  assert.equal(b.doc.body.getAttribute('style'), null);
});
test('the rev 0 answer to hello carries the same geometry as any applied', () => {
  const b = scrolled(bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero" data-r="0,10,500,300"><h1 data-r="0,10,400,40" data-tr="300,20,8,20">Ship</h1></section></body></html>' }));
  b.send('hello', { mode: 'build', kind: 'web', canvas: { w: 1440 } });
  const a = b.of('applied')[0];
  assert.deepEqual([a.rev, a.rect, a.tail.rect, a.tail.tag, a.marks, a.overflow], [0, [100, 1010, 500, 300], [400, 1020, 8, 20], 'h1', [], false]);
});
test('a flush writes every section first and reads geometry after, so one flush forces one layout', () => {
  const b = bootBridge({ html: SLOTS, trackWrites: true });
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  b.send('section', { id: 'hero', rev: 2, html: '<section>a<p>b</p></section>', final: false });
  b.send('section', { id: 'price', rev: 1, html: '<section>c<p>d</p></section>', final: false });
  b.writesSeenAtRead.length = 0;
  b.clock.tick(125);
  assert.ok(b.writesSeenAtRead[0] > 0);
  assert.ok(b.writesSeenAtRead.slice(1).every((n) => n === 0), String(b.writesSeenAtRead));
});
test('rects: coalesced to one per frame, listing slots and roots in doc order', () => {
  const b = scrolled(bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero" data-r="0,0,10,10"></section><div data-worca-slot="price" data-r="0,10,10,10"></div></body></html>' }));
  b.sent.length = 0;
  for (let i = 0; i < 5; i++) b.doc.dispatchEvent(new b.win.Event('scroll'));
  b.win.dispatchEvent(new b.win.Event('resize'));
  b.clock.frame();
  const r = b.of('rects');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sections, [{ id: 'hero', rect: [100, 1000, 10, 10] }, { id: 'price', rect: [100, 1010, 10, 10] }]);
  assert.deepEqual([r[0].scrollX, r[0].scrollY, r[0].vw, r[0].vh], [100, 1000, 1024, 768]);
  b.clock.frame();
  assert.equal(b.of('rects').length, 1);
});
test('M5: rects report each of 40 side-by-side sections, and a layout change in any of them is observed', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const cells = ids.map((id, i) => `<div data-worca-slot="${id}" data-r="${(i % 4) * 300},${Math.floor(i / 4) * 100},300,100"></div>`).join('');
  const b = bootBridge({ html: `<!doctype html><html><head></head><body><div class="grid">${cells}</div></body></html>`, resizeObserver: true });
  b.send('plan', { sections: ids.map((id) => ({ id })) });
  b.clock.frame();
  const s = b.of('rects').at(-1).sections;
  assert.equal(s.length, 40);
  assert.deepEqual(s.find((x) => x.id === 's5').rect, [300, 100, 300, 100]);
  assert.equal(b.observed.size, 41, 'each section plus the document');
  const old = b.doc.querySelector('[data-worca-slot="s0"]');
  b.send('section', { id: 's0', rev: 1, html: '<section>a</section>', final: false });
  assert.equal(b.observed.size, 41);
  assert.ok(!b.observed.has(old));
  assert.ok(b.observed.has(b.doc.querySelector('[data-section="s0"]')));
});

// Beyond the plan's cases: the rules above that its rows leave unpinned. P4 Task 16 adds `tail.box`,
// so these read `tail.rect` and `tail.tag` one by one.
test('rect values round to 0.1, never read -0, and an infinite one reads 0', () => {
  const b = bootBridge({ html: SLOT_HERO });
  b.send('section', { id: 'hero', rev: 1, final: false, html: '<section data-r="1.04,-0.04,2.06,Infinity">a</section>' });
  assert.deepEqual(b.of('applied')[0].rect, [1, 0, 2.1, 0]);
});

test('marks skip style, link, title and template even among the newest', () => {
  const b = bootBridge({ html: SLOT_HERO });
  b.send('section', { id: 'hero', rev: 1, final: false, html: '<section><p>a</p><style>.a{}</style><link rel="x"><title>t</title><template><i>x</i></template></section>' });
  assert.deepEqual(b.of('applied')[0].marks.map((m) => m.tag), ['section', 'p']);
});

test('the tail takes the last character with ink, a whole surrogate pair, never text in style, noscript or template', () => {
  const b = bootBridge({ html: SLOT_HERO });
  const seen = [];
  b.win.Range.prototype.getBoundingClientRect = function () { seen.push(this.toString()); return new b.win.DOMRect(1, 2, 3, 4); };
  const face = String.fromCodePoint(0x1f600);
  b.send('section', { id: 'hero', rev: 1, final: false, html: `<section><p>Ship ${face} \n</p><style>.a{}</style><noscript>n</noscript><template>t</template>\n  </section>` });
  const a = b.of('applied')[0];
  assert.deepEqual([seen, a.tail.rect, a.tail.tag], [[face], [1, 2, 3, 4], 'p']);
});

test('an empty Range rect, or a doc with no Range rects, falls back to the deepest last element, past trailing style elements', () => {
  const b = bootBridge({ html: SLOT_HERO });
  b.send('section', { id: 'hero', rev: 1, final: false, html: '<section><div data-r="1,2,3,4"><p data-r="5,6,7,8">x</p><style>.a{}</style></div><style>.b{}</style></section>' });
  const a = b.of('applied')[0];
  assert.deepEqual([a.tail.rect, a.tail.tag], [[5, 6, 7, 8], 'p']);
  const n = bootBridge({ html: SLOT_HERO });
  delete n.win.Range.prototype.getBoundingClientRect;
  n.send('section', { id: 'hero', rev: 1, final: false, html: '<section><h1 data-r="1,2,3,4" data-tr="9,9,9,9">Ship</h1></section>' });
  const t = n.of('applied')[0].tail;
  assert.deepEqual([t.rect, t.tag, n.of('err')], [[1, 2, 3, 4], 'h1', []]);
});

test('the rev 0 tail never lands in a script of the run doc', () => {
  const b = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><section data-section="hero"><p data-tr="1,2,3,4">Ship</p><script>var late = 1</script></section></body></html>' });
  b.send('hello', { mode: 'run', kind: 'web' });
  const a = b.of('applied')[0];
  assert.deepEqual([a.tail.rect, a.tail.tag], [[1, 2, 3, 4], 'p']);
});

test('a rev 0 geometry read that throws costs only its own reply', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="a">x</section><section data-section="b">y</section></body></html>', before(win) {
    const read = win.Element.prototype.getBoundingClientRect;
    win.Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('data-section') === 'a') throw new Error('read boom');
      return read.call(this);
    };
  } });
  b.send('hello', { mode: 'build', kind: 'web' });
  assert.deepEqual([b.of('applied').map((a) => a.id), b.of('err').map((e) => e.message)], [['b'], ['read boom']]);
});

test('web overflow: the left edge and the scroll width count too, each with 1 px of slack; no canvas never overflows', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><div data-worca-slot="a"></div><div data-worca-slot="b"></div><div data-worca-slot="c"></div><div data-worca-slot="d"></div></body></html>' });
  b.send('hello', { mode: 'build', kind: 'web', canvas: { w: 1440 } });
  const put = (id, attrs) => b.send('section', { id, rev: 1, final: false, html: `<section ${attrs}>a</section>` });
  put('a', 'data-r="-2,0,10,10"');
  put('b', 'data-r="-1,0,10,10" data-scroll="1441,0,0,0"');
  put('c', 'data-r="0,0,10,10" data-scroll="1442,0,0,0"');
  put('d', 'data-r="1431,0,10,10"');
  b.clock.tick(125);
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.overflow]), [['a', true], ['b', false], ['c', true], ['d', false]]);
  const n = bootBridge({ html: SLOT_HERO });
  n.send('hello', { mode: 'build', kind: 'web' });
  n.send('section', { id: 'hero', rev: 1, final: false, html: '<section data-r="-5000,0,10,10">a</section>' });
  assert.equal(n.of('applied')[0].overflow, false);
});

test('tile overflow: the width counts too, and a tile far from the origin is judged by itself alone', () => {
  const d = bootBridge({ html: SLOTS });
  d.send('hello', { mode: 'build', kind: 'presentation', canvas: { w: 1920, h: 1080 } });
  d.send('section', { id: 'hero', rev: 1, final: false, html: '<section data-r="0,0,480,270" data-scroll="1922,1080,1920,1080">a</section>' });
  d.send('section', { id: 'price', rev: 1, final: false, html: '<section data-r="5000,0,480,270" data-scroll="1920,1080,1920,1080">a</section>' });
  d.clock.tick(125);
  assert.deepEqual(d.of('applied').map((a) => a.overflow), [true, false]);
});

test('rects also follow a scroll inside any element, a resize, a hello, a section or CSS flush, and nothing else', () => {
  const run = (act) => {
    const b = bootBridge({ html: '<!doctype html><html><head></head><body><div class="pane"><p>x</p></div><div data-worca-slot="hero"></div></body></html>' });
    b.sent.length = 0;
    act(b);
    b.clock.frame();
    return b.of('rects').length;
  };
  assert.deepEqual([
    run((b) => b.doc.querySelector('.pane').dispatchEvent(new b.win.Event('scroll'))),
    run((b) => b.win.dispatchEvent(new b.win.Event('resize'))),
    run((b) => b.send('hello', { mode: 'build', kind: 'web' })),
    run((b) => b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false })),
    run((b) => b.send('css', { file: 'global', rev: 1, text: '.g{}', final: false })),
    run(() => {}),
  ], [1, 1, 1, 1, 1, 0]);
});

test('rects list each id once, from its outermost root, valid ids only', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="a" data-r="0,1,1,1"><div data-section="b"></div></section><div data-worca-slot="a"></div><div data-worca-slot="Bad"></div><div data-worca-slot="c" data-r="0,2,1,1"></div></body></html>' });
  b.send('hello', { mode: 'build', kind: 'web' });
  b.clock.frame();
  assert.deepEqual(b.of('rects').at(-1).sections, [{ id: 'a', rect: [0, 1, 1, 1] }, { id: 'c', rect: [0, 2, 1, 1] }]);
  // Parts sharing a plain parent inside a root are its markup: neither is a section in rects or the hello seed.
  const p = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero"><div><b data-section="x">1</b><b data-section="y">2</b></div></section></body></html>' });
  p.send('hello', { mode: 'build', kind: 'web' });
  p.clock.frame();
  assert.deepEqual([p.of('applied').map((a) => [a.id, a.rev]), p.of('rects').at(-1).sections.map((s) => s.id), p.of('err')], [[['hero', 0]], ['hero'], []]);
});

test('finding roots and slots is linear in the doc: a deep chain of roots, and roots deep in plain markup, cost no query per element', () => {
  // A chain of nested roots around a planned section (each wraps it, so none is a root), and marked elements at the
  // bottom of a deep chain of plain ones. Counted: every query, closest and parentElement read the bridge can make.
  const depth = 200;
  const chain = '<div data-section="w">'.repeat(depth) + '<i data-section="hero"></i>' + '</div>'.repeat(depth);
  const plain = '<div>'.repeat(depth) + Array.from({ length: depth }, (_, i) => `<b data-section="p${i}"></b>`).join('') + '</div>'.repeat(depth);
  let calls = 0;
  const b = bootBridge({ html: `<!doctype html><html><head></head><body>${chain}${plain}<div data-worca-slot="price"></div></body></html>`, before(win) {
    for (const proto of [win.Element.prototype, win.Document.prototype]) {
      for (const name of ['querySelectorAll', 'querySelector', 'closest']) {
        const fn = proto[name];
        if (fn) proto[name] = function (...args) { calls++; return fn.apply(this, args); };
      }
    }
    const parent = Object.getOwnPropertyDescriptor(win.Node.prototype, 'parentElement');
    Object.defineProperty(win.Node.prototype, 'parentElement', { configurable: true, get() { calls++; return parent.get.call(this); } });
  } });
  const elements = b.win.Document.prototype.getElementsByTagName.call(b.doc, '*').length;
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.clock.frame();
  calls = 0;
  b.win.dispatchEvent(new b.win.Event('resize'));
  b.clock.frame();
  const frame = calls;
  calls = 0;
  b.send('hello', { mode: 'build', kind: 'web' });
  const hello = calls;
  const ids = b.of('rects').at(-1).sections.map((s) => s.id);
  assert.deepEqual([ids[0], ids.length], ['hero', 40], 'the innermost hero is the root; the chain around it is not');
  assert.ok(frame <= 2 * elements, `a rects frame made ${frame} calls for ${elements} elements`);
  assert.ok(hello <= 4 * elements, `hello made ${hello} calls for ${elements} elements`);
});

test('rects and the observer stop at 40 sections, however many slots the doc holds', () => {
  const cells = Array.from({ length: 45 }, (_, i) => `<div data-worca-slot="s${i}"></div>`).join('');
  const b = bootBridge({ html: `<!doctype html><html><head></head><body>${cells}</body></html>`, resizeObserver: true });
  b.send('hello', { mode: 'build', kind: 'web' });
  b.clock.frame();
  assert.equal(b.of('rects').at(-1).sections.length, 40);
  b.send('section', { id: 's44', rev: 1, html: '<section>a</section>', final: false });
  assert.equal(b.observed.size, 41);
  assert.deepEqual([b.of('applied').map((a) => a.id), b.of('err')], [['s44'], []], 'a section past the 40th still has its slot');
});

test('the observer starts with the first rects request, then follows plans and applies', () => {
  const b = bootBridge({ html: SLOTS, resizeObserver: true });
  assert.equal(b.observed.size, 0);
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  assert.deepEqual(new Set(b.observed), new Set([b.doc.documentElement, ...b.doc.querySelectorAll('[data-worca-slot]')]));
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'faq' }] });
  assert.ok(b.observed.has(b.doc.querySelector('[data-worca-slot="faq"]')));
  assert.equal(b.observed.size, 3, 'the removed price slot is no longer observed');
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  const first = b.doc.querySelector('[data-section="hero"]');
  b.clock.tick(125);
  b.send('section', { id: 'hero', rev: 2, html: '<article>b</article>', final: false });
  const second = b.doc.querySelector('[data-section="hero"]');
  assert.equal(second.localName, 'article');
  assert.ok(b.observed.has(second) && !b.observed.has(first));
  assert.equal(b.observed.size, 3);
});

test('a ResizeObserver notice asks for rects', () => {
  const b = bootBridge({ html: SLOT_HERO, resizeObserver: true });
  const made = [];
  const Base = b.win.ResizeObserver;
  b.win.ResizeObserver = class extends Base { constructor(cb) { super(cb); made.push(this); } };
  b.send('hello', { mode: 'build', kind: 'web' });
  b.clock.frame();
  b.sent.length = 0;
  made[0].callback([]);
  b.clock.frame();
  assert.deepEqual([made.length, b.of('rects').length], [1, 1]);
});
