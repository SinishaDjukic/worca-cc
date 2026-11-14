import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBridge, overrideByControl, overrideOnFormPrototype, SLOTS, SLOT_HERO, BAND, FINISHED_HERO } from './helpers/design-bridge.mjs';

test('the slot stays until the first start tag is complete, then the root replaces it', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: '<section class="a', final: false });
  assert.ok(b.doc.querySelector('[data-worca-slot="hero"]'));
  assert.deepEqual(b.of('applied'), []);
  b.clock.tick(125);
  b.send('section', { id: 'hero', rev: 2, html: '<section class="a"><h1>Ship', final: false });
  assert.equal(b.doc.querySelector('[data-worca-slot="hero"]'), null);
  assert.equal(b.doc.querySelector('[data-section="hero"]').outerHTML, '<section class="a" data-section="hero"><h1>Ship</h1></section>');
  const a = b.of('applied').at(-1);
  assert.deepEqual([a.id, a.rev, a.added, a.layers], ['hero', 2, 2, 2]);
});
test('later revs morph the same root and count only new elements', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>Ship', final: false }); b.clock.tick(125);
  const root = b.doc.querySelector('[data-section="hero"]'); const h1 = root.querySelector('h1');
  b.send('section', { id: 'hero', rev: 2, html: '<section><h1>Ship it</h1><p>Two', final: false }); b.clock.tick(125);
  assert.equal(b.doc.querySelector('[data-section="hero"]'), root);
  assert.equal(root.querySelector('h1'), h1);
  const a = b.of('applied').at(-1);
  assert.deepEqual([a.added, a.layers], [1, 3]);
});
test('Review Focus: a shrinking section, a new root tag, text first, two roots', () => {
  const b = bootBridge({ html: SLOTS });
  const put = (rev, html) => { b.send('section', { id: 'hero', rev, html, final: false }); b.clock.tick(125); };
  put(1, '<section><h1>a</h1><p>b</p></section>');
  put(2, '<section><h1>a</h1></section>');
  assert.equal(b.doc.querySelector('[data-section="hero"] p'), null);
  assert.equal(b.of('applied').at(-1).layers, 2);
  const h1 = b.doc.querySelector('[data-section="hero"] h1');
  put(3, '<div><h1>a</h1></div>');
  assert.equal(b.doc.querySelector('[data-section="hero"]').tagName, 'DIV');
  assert.equal(b.doc.querySelector('[data-section="hero"] h1'), h1, 'a new root tag keeps the children (a video would not restart)');
  put(4, '<div><h1>c</h1></div>');
  assert.equal(b.doc.querySelector('[data-section="hero"] h1').textContent, 'c');
  put(5, 'stray text <div><h1>d</h1></div><div>second</div>');
  assert.equal(b.doc.querySelector('[data-section="hero"] h1').textContent, 'd');
  assert.ok(!b.doc.body.textContent.includes('second'));
  assert.ok(!b.doc.body.textContent.includes('stray'));
});
test('no element yet: nothing applied; stale rev dropped; final parses the text uncut', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 5, html: 'only text', final: false });
  assert.deepEqual(b.of('applied'), []);
  b.send('section', { id: 'hero', rev: 6, html: '<section>one</section>', final: false }); b.clock.tick(125);
  b.send('section', { id: 'hero', rev: 6, html: '<section>dup</section>', final: false }); b.clock.tick(125);
  assert.equal(b.doc.querySelector('[data-section="hero"]').textContent, 'one');
  b.send('section', { id: 'hero', rev: 7, html: '<section>a &am', final: true }); b.clock.tick(0);
  assert.equal(b.doc.querySelector('[data-section="hero"]').textContent, 'a &am');
});
test('a finished section already in the doc is morphed, and a section with no place is an err', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero">old</section></body></html>' });
  const root = b.doc.querySelector('[data-section="hero"]');
  b.send('section', { id: 'hero', rev: 1, html: '<section>new</section>', final: false });
  assert.equal(b.doc.querySelector('[data-section="hero"]'), root);
  assert.equal(root.textContent, 'new');
  b.clock.tick(125);
  b.send('section', { id: 'nowhere', rev: 1, html: '<p>x</p>', final: false });
  assert.equal(b.of('err').at(-1).code, 'no-slot');
});
test("M5: applying one section does not recount the others", () => {
  let calls = 0;
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="price"><p>p</p></section><div data-worca-slot="hero"></div></body></html>', before(win) {
    const all = win.Element.prototype.querySelectorAll;
    // The count is a query of every element under the root ('*').
    win.Element.prototype.querySelectorAll = function (s) { if (this.getAttribute('data-section') === 'price' && s === '*') calls++; return all.call(this, s); };
  } });
  b.send('hello', { mode: 'build', kind: 'web', canvas: { w: 1440 } });
  assert.equal(calls, 1, 'hello counts it');
  calls = 0;
  b.send('section', { id: 'hero', rev: 1, html: '<section><b>x</b></section>', final: false });
  assert.equal(calls, 0);
  assert.equal(b.of('applied').at(-1).layers, 4);
});
test("a later rev merges into the root it applied without reading the doc's roots and slots again", () => {
  let reads = 0;
  const b = bootBridge({ html: SLOT_HERO, before(win) {
    const all = win.Document.prototype.querySelectorAll;
    win.Document.prototype.querySelectorAll = function (s) { reads++; return all.call(this, s); };
  } });
  b.send('section', { id: 'hero', rev: 1, html: '<section><b>x</b></section>', final: false });
  reads = 0;
  b.send('section', { id: 'hero', rev: 2, html: '<section><b>x</b><i>y</i></section>', final: false });
  b.clock.tick(125);
  assert.deepEqual([b.of('applied').at(-1).rev, reads], [2, 0]);
});
test("M5: a slot nested in the lead's markup is replaced where it stands", () => {
  const b = bootBridge({ html: BAND });
  const row = b.doc.querySelector('.row');
  b.send('section', { id: 'b', rev: 1, html: '<article>B</article>', final: true });
  assert.equal(row.innerHTML, '<div data-worca-slot="a"></div><article data-section="b">B</article>');
  b.clock.tick(125);
  b.send('section', { id: 'a', rev: 1, html: '<article>A</article>', final: true });
  assert.equal(row.innerHTML, '<article data-section="a">A</article><article data-section="b">B</article>');
});
test('M5: plan creates only missing slots, in the sections container, in plan order, and never moves or duplicates one', () => {
  const b = bootBridge({ html: BAND });
  const slot = (id) => b.doc.querySelector(`[data-worca-slot="${id}"]`);
  const row = b.doc.querySelector('.row'); const main = b.doc.querySelector('main');
  const [a, bb, c] = ['a', 'b', 'c'].map(slot);
  const sections = ['a', 'b', 'd', 'c', 'e'].map((id) => ({ id, estHeight: 100 }));
  b.send('plan', { sections });
  assert.equal(slot('a'), a); assert.equal(slot('b'), bb); assert.equal(slot('c'), c);
  assert.equal(a.parentNode, row); assert.equal(row.children.length, 2);
  assert.deepEqual([...main.children].map((e) => e.getAttribute('data-worca-slot')), ['d', 'c', 'e']);
  assert.equal(main.lastChild.nodeType, 8, 'the marker comment stays last');
  for (const id of ['a', 'b', 'c', 'd', 'e']) assert.equal(b.doc.querySelectorAll(`[data-worca-slot="${id}"]`).length, 1);
  const mo = new b.win.MutationObserver(() => {}); mo.observe(b.doc.body, { childList: true, subtree: true });
  b.send('plan', { sections });
  assert.deepEqual(mo.takeRecords(), []);
  mo.disconnect();
});
test('plan: a finished root counts as present and as a neighbour', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main><section data-section="a">A</section><!--worca:sections--></main></body></html>' });
  b.send('plan', { sections: [{ id: 'a' }, { id: 'b' }] });
  const main = b.doc.querySelector('main');
  assert.deepEqual([...main.children].map((e) => e.getAttribute('data-section') || e.getAttribute('data-worca-slot')), ['a', 'b']);
});
test('plan: estHeight sizes every slot, shell or new; no estHeight leaves it unsized', () => {
  const b = bootBridge({ html: BAND });
  b.send('plan', { sections: [{ id: 'a', estHeight: 300 }, { id: 'b' }, { id: 'c', estHeight: 90000 }, { id: 'd', estHeight: 50 }] });
  const s = (id) => b.doc.querySelector(`[data-worca-slot="${id}"]`);
  assert.equal(s('a').style.minHeight, '300px');
  assert.equal(s('b').getAttribute('style'), null);
  assert.equal(s('c').style.minHeight, '20000px');
  assert.equal(s('d').style.minHeight, '50px');
});
test('plan: a form slot whose control is named style is still sized', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><form data-worca-slot="w"><input name="style"></form></body></html>' });
  const form = overrideByControl(b.win.Document.prototype.querySelector.call(b.doc, 'form'), ['style']);
  assert.equal(form.style.localName, 'input', 'the override is in place');
  b.send('plan', { sections: [{ id: 'w', estHeight: 300 }] });
  assert.deepEqual([b.win.Element.prototype.getAttribute.call(form, 'style'), b.of('err')], ['min-height: 300px;', []]);
});
test('plan removes only what left an earlier plan; a first plan removes nothing', () => {
  const b = bootBridge({ html: BAND });
  b.send('plan', { sections: [{ id: 'a' }] });
  for (const id of ['a', 'b', 'c']) assert.ok(b.doc.querySelector(`[data-worca-slot="${id}"]`), id);
  b.send('plan', { sections: [{ id: 'a' }, { id: 'b' }] });
  b.send('section', { id: 'b', rev: 1, html: '<p>x</p>', final: true });
  b.send('plan', { sections: [{ id: 'a' }] });
  assert.equal(b.doc.querySelector('[data-section="b"]'), null);
  assert.ok(b.doc.querySelector('[data-worca-slot="c"]'));
});
test('plan removal reads every dropped section\'s place once, under the plan it leaves, before removing any', () => {
  const shell = (tail) => `<!doctype html><html><head></head><body><main data-section="price"><div data-worca-slot="hero"></div></main>${tail}</body></html>`;
  // Dropping both: hero's slot goes, and price's place is still its own slot, never the wrapper hero's removal frees.
  const b = bootBridge({ html: shell('<div data-worca-slot="price"></div>') });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.send('plan', { sections: [] });
  assert.deepEqual([b.of('err'), b.doc.body.innerHTML], [[], '<main data-section="price"></main>']);
  // Dropping hero only: under the plan that leaves, the wrapper is no root, so hero's slot in it is hero's place.
  const c = bootBridge({ html: shell('') });
  c.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  c.send('plan', { sections: [{ id: 'price' }] });
  assert.deepEqual([c.of('err'), c.doc.body.innerHTML], [[], '<main data-section="price"></main><div data-worca-slot="price"></div>']);
});
test('after a plan only planned ids are guarded, and an empty plan guards none: a wrapper around an unplanned slot is a root', () => {
  // Text arrived for hero before the first plan, and an empty plan: either way price's rev merges into the wrapper.
  const text = (b) => b.send('section', { id: 'hero', rev: 1, html: 'just text', final: false });
  for (const [shape, first, sections] of [['text first', text, [{ id: 'price' }]], ['empty plan', () => {}, []]]) {
    const b = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price"><div data-worca-slot="hero"></div></main></body></html>' });
    first(b);
    b.send('plan', { sections });
    b.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
    b.clock.frame();
    assert.deepEqual([b.of('err'), b.doc.body.innerHTML, b.of('rects').at(-1).sections.map((s) => s.id)],
      [[], '<section data-section="price"><p>price</p></section>', ['price']], shape);
  }
});
test('a planned section with no node of its own, linked from two planned navs, gets a slot, and both navs stay roots', () => {
  const nav = (id) => `<nav data-section="${id}"><a href="#hero" data-section="hero">H</a></nav>`;
  const b = bootBridge({ html: `<!doctype html><html><head></head><body>${nav('top')}${nav('foot')}</body></html>` });
  b.send('hello', { mode: 'build', kind: 'web' });
  b.send('plan', { sections: [{ id: 'top' }, { id: 'hero' }, { id: 'foot' }] });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>hero</h1></section>', final: true });
  b.clock.frame();
  assert.deepEqual([b.of('err'), b.doc.body.innerHTML, b.of('rects').at(-1).sections.map((s) => s.id)],
    [[], `${nav('top')}<section data-section="hero"><h1>hero</h1></section>${nav('foot')}`, ['top', 'hero', 'foot']]);
});
test('plan on a doc with no marker and no neighbour puts slots in body; over 40 is an err', () => {
  const b = bootBridge();
  b.send('plan', { sections: [{ id: 'hero', estHeight: 100 }] });
  assert.equal(b.doc.body.firstElementChild.getAttribute('data-worca-slot'), 'hero');
  b.send('plan', { sections: Array.from({ length: 41 }, (_, i) => ({ id: `s${i}` })) });
  assert.equal(b.of('err').at(-1).code, 'bad-message');
  assert.equal(b.doc.querySelector('[data-worca-slot="s0"]'), null);
});
const HOSTILE = [
  '<script>x()</script>', '<svg><script>x()</script></svg>', '<iframe srcdoc="y"></iframe>', '<frame>', '<object data="y"></object>',
  '<embed src="y">', '<applet></applet>', '<base href="https://e.invalid/">', '<meta http-equiv="refresh" content="0;url=https://e.invalid/">',
];
test('strip: nothing executable or navigating lands', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: `<section><p>keep</p>${HOSTILE.join('')}</section>`, final: true });
  const root = b.doc.querySelector('[data-section="hero"]');
  assert.equal(root.querySelector('script,iframe,frame,object,embed,applet,base,meta'), null);
  assert.equal(root.querySelector('p').textContent, 'keep');
});
test('strip: handlers and script URLs are removed, and the rest of the element stays', () => {
  const b = bootBridge({ html: SLOTS });
  const html = `<section onclick="x()">
    <img id="i" src="a.png" onerror="x()" ONLOAD="x()"><a id="a" class="c" href="javascript:x()">a</a>
    <a id="t" href=" JaVa&#9;ScRiPt:x()">b</a><a id="v" href="vbscript:x()">c</a><a id="ok" href="#top">d</a>
    <svg><a id="s" xlink:href="javascript:x()"><text>e</text></a></svg>
    <form id="f" action="javascript:x()"><button id="fb" formaction="javascript:x()">f</button></form>
    <details id="d" ontoggle="x()"></details></section>`;
  b.send('section', { id: 'hero', rev: 1, html, final: true });
  const $ = (id) => b.doc.getElementById(id);
  assert.equal(b.doc.querySelector('[data-section="hero"]').hasAttribute('onclick'), false);
  assert.deepEqual([...$('i').attributes].map((x) => x.name), ['id', 'src']);
  assert.deepEqual([...$('a').attributes].map((x) => x.name), ['id', 'class']);
  for (const id of ['t', 'v']) assert.equal($(id).hasAttribute('href'), false);
  assert.equal($('ok').getAttribute('href'), '#top');
  assert.equal($('s').hasAttribute('xlink:href'), false);
  assert.equal($('f').hasAttribute('action'), false);
  assert.equal($('fb').hasAttribute('formaction'), false);
  assert.equal($('d').hasAttribute('ontoggle'), false);
});
test('strip: a script URL in src or data goes too', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: '<section><img id="i" alt="x" src="javascript:x()"><div id="d" data=" vbscript:x()">d</div></section>', final: true });
  assert.deepEqual([...b.doc.getElementById('i').attributes].map((x) => x.name), ['id', 'alt']);
  assert.deepEqual([...b.doc.getElementById('d').attributes].map((x) => x.name), ['id']);
});
test('strip: an SVG set or animate of href goes, under any prefix or case, and every other animation stays', () => {
  const b = bootBridge({ html: SLOTS });
  const html = '<section><svg><a id="a"><set attributeName="href" to="/x" begin="0s" fill="freeze"/><text>t</text></a>'
    + '<a id="b" href="#ok"><animate attributeName=" XLink:HREF " values="/x" dur="1s"></animate><text>u</text></a>'
    + '<a id="c" href="#ok"><animate attributeName="foo:href" values="/x" dur="1s"/><text>v</text></a>'
    + '<rect id="r"><animate attributeName="width" values="1;2" dur="1s"/><set attributeName="fill" to="red"/></rect></svg></section>';
  b.send('section', { id: 'hero', rev: 1, html, final: true });
  const root = b.doc.querySelector('[data-section="hero"]');
  assert.equal(root.querySelectorAll('set,animate').length, 2);
  assert.equal(root.querySelectorAll('#r animate, #r set').length, 2);
  assert.equal(root.querySelector('#a text').textContent, 't');
});
test('a section whose markup clobbers document methods breaks no later section, css, plan, hello or rects', () => {
  const b = bootBridge({ html: SLOTS, resizeObserver: true });
  const html = b.doc.documentElement;
  html.setAttribute('data-scroll', '0,777,0,0');
  const names = ['createElement', 'createElementNS', 'querySelector', 'querySelectorAll', 'createRange', 'head', 'body', 'documentElement'];
  // jsdom's own selector engine walks elements with document.createTreeWalker(node, SHOW_CONTAINER), so markup
  // that clobbers it would break jsdom, not just the bridge. Modelled instead: a walk over text or comments, or
  // with a filter (the bridge's tail and marker walks), fails as it would on an img.
  const { SHOW_TEXT, SHOW_COMMENT } = b.win.NodeFilter;
  Object.defineProperty(b.doc, 'createTreeWalker', { configurable: true, value(node, show, filter) {
    if (filter !== undefined || show & (SHOW_TEXT | SHOW_COMMENT)) throw new TypeError('document.createTreeWalker is not a function');
    return b.win.Document.prototype.createTreeWalker.call(this, node, show);
  } });
  b.send('section',{ id: 'hero', rev: 1, html: `<section><p>A</p>${names.map((n) => `<img name="${n}" alt="">`).join('')}</section>`, final: true });
  assert.equal(b.doc.createElement.localName, 'img', 'named properties override built-ins on Document');
  b.send('section', { id: 'price', rev: 1, html: '<section><p>B</p></section>', final: true });
  b.send('css', { file: 'global', rev: 1, text: 'p{color:red}', final: true });
  // A new root tag: morphdom would make the new root with document.createElement.
  b.send('section', { id: 'price', rev: 2, html: '<div><p>B2</p></div>', final: true });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }, { id: 'faq' }] });
  b.send('hello', { mode: 'build', kind: 'web' });
  b.clock.frame();
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.rev]), [['hero', 1], ['price', 1], ['price', 2], ['hero', 0], ['price', 0]]);
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  assert.equal(q('[data-section="price"]').outerHTML, '<div data-section="price"><p>B2</p></div>');
  assert.equal(q('style[data-worca-css="global"]').parentNode.localName, 'head');
  assert.equal(q('[data-worca-slot="faq"]').previousElementSibling, q('[data-section="price"]'), 'body is the container: after its neighbour');
  const rects = b.of('rects').at(-1);
  assert.deepEqual([rects.docH, rects.sections.map((s) => s.id)], [777, ['hero', 'price', 'faq']]);
  assert.ok(b.observed.has(html), 'the observer watches the real documentElement');
});
test('form controls that override form members break no hello, rects, css, plan or apply', () => {
  const b = bootBridge({ resizeObserver: true, html: '<!doctype html><html><head></head><body>'
    + '<form data-section="a" data-r="0,10,100,50" data-scroll="2000,0,0,0"><div><input name="m"></div><b data-r="1,2,3,4"></b><style data-worca-css="zz"></style></form>'
    + '<form data-section="f"><input name="m"></form><form id="wrap"><input name="m"><div data-worca-slot="w"></div></form>'
    + '<form data-worca-slot="v"><input name="m"></form><div data-worca-slot="b"></div></body></html>' });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const attr = (el, name) => b.win.Element.prototype.getAttribute.call(el, name);
  for (const form of b.doc.querySelectorAll('form')) overrideByControl(form);
  assert.equal(q('form').getAttribute, q('form input'), 'the override is in place');
  b.send('hello', { mode: 'build', kind: 'web', canvas: { w: 1440 } });
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.added, a.rect, a.tail.tag, a.overflow]),
    [['a', 5, [0, 10, 100, 50], 'b', true], ['f', 2, [0, 0, 0, 0], 'input', false]]);
  b.clock.frame();
  // a slot inside a form is no nested section, and a form slot is a slot
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => [s.id, s.rect]),
    [['a', [0, 10, 100, 50]], ['f', [0, 0, 0, 0]], ['w', [0, 0, 0, 0]], ['v', [0, 0, 0, 0]], ['b', [0, 0, 0, 0]]]);
  assert.ok(b.observed.has(q('form')), 'the form root is watched');
  // tokens goes before every other style, here one inside the form
  b.send('css', { file: 'tokens', rev: 1, text: ':root{--a:1}', final: true });
  assert.equal(q('style[data-worca-css="tokens"]').nextElementSibling, q('style[data-worca-css="zz"]'));
  // the second plan removes f, a form, and puts n after a, a form
  const ALL = [{ id: 'w' }, { id: 'v' }, { id: 'b' }];
  b.send('plan', { sections: [{ id: 'a' }, { id: 'f' }, ...ALL] });
  b.send('plan', { sections: [{ id: 'a' }, { id: 'n' }, ...ALL] });
  assert.deepEqual([...b.doc.body.children].map((e) => attr(e, 'data-section') ?? attr(e, 'data-worca-slot') ?? e.id), ['a', 'n', 'wrap', 'v', 'b']);
  // a form slot is replaced where it stands
  b.send('section', { id: 'v', rev: 1, html: '<section>V</section>', final: true });
  assert.equal(q('[data-section="v"]').outerHTML, '<section data-section="v">V</section>');
  // b's root is a form, kept as its root; once it leaves the doc, the next apply goes to b's new slot
  b.send('section', { id: 'b', rev: 1, html: '<form><input name="m"><p>B</p></form>', final: true });
  const fb = overrideByControl(q('[data-section="b"]'));
  const slot = b.doc.createElement('div');
  slot.setAttribute('data-worca-slot', 'b');
  b.win.Element.prototype.replaceWith.call(fb, slot);
  b.send('section', { id: 'b', rev: 2, html: '<section>B2</section>', final: true });
  assert.equal(q('[data-section="b"]').outerHTML, '<section data-section="b">B2</section>');
  // a new root tag: a's children move to the new root in their order, the same nodes
  const kept = q('[data-section="a"] input');
  b.send('section', { id: 'a', rev: 1, html: '<div><div><input name="m"></div><b>A</b></div>', final: true });
  assert.equal(q('[data-section="a"]').outerHTML, '<div data-section="a"><div><input name="m"></div><b>A</b></div>');
  assert.equal(q('[data-section="a"] input'), kept);
  // morphdom asks the bridge whether a nested form is unchanged
  b.send('section', { id: 'n', rev: 1, html: '<section><form><input name="isEqualNode"><p>1</p></form></section>', final: true });
  overrideByControl(q('[data-section="n"] form'), ['isEqualNode']);
  b.send('section', { id: 'n', rev: 2, html: '<section><form><input name="isEqualNode"><p>2</p></form></section>', final: true });
  assert.equal(q('[data-section="n"] p').textContent, '2');
  assert.deepEqual(b.of('err'), []);
});
test('a form a live apply makes: controls named after its members change nothing the bridge strips, marks or settles', () => {
  // The form is made by the apply's own parse, so the override is modelled on HTMLFormElement.prototype.
  const NAMES = ['attributes', 'setAttribute', 'getBoundingClientRect', 'parentNode'];
  const b = bootBridge({ html: SLOT_HERO, animate: true, before: (win) => overrideOnFormPrototype(win, NAMES) });
  b.send('section', { id: 'hero', rev: 1, final: true,
    html: `<form data-r="1,2,3,4" onclick="x()" action="javascript:y()">${NAMES.map((n) => `<input name="${n}">`).join('')}</form>` });
  const form = b.win.Document.prototype.querySelector.call(b.doc, 'form');
  assert.equal(form.setAttribute.localName, 'input', 'the override is in place');
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(b.win.Element.prototype.getAttributeNames.call(form), ['data-r', 'data-section'], 'the handler and the script URL went');
  const a = b.of('applied')[0];
  assert.deepEqual([a.rect, a.marks.map((m) => [m.tag, m.rect])], [[1, 2, 3, 4], [['form', [1, 2, 3, 4]], ...NAMES.map(() => ['input', [0, 0, 0, 0]])]]);
  assert.deepEqual(b.animated.map((x) => x.el), [form], 'the form is the one top-most element the apply added');
  // the same root tag again: merged into the form where it stands
  const n = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['namespaceURI']) });
  n.send('section', { id: 'hero', rev: 1, final: true, html: '<form><input name="namespaceURI"><p>1</p></form>' });
  const root = n.win.Document.prototype.querySelector.call(n.doc, 'form');
  assert.equal(root.namespaceURI.localName, 'input', 'the override is in place');
  n.send('section', { id: 'hero', rev: 2, final: true, html: '<form><input name="namespaceURI"><p>2</p></form>' });
  assert.deepEqual([n.win.Document.prototype.querySelector.call(n.doc, 'form'), root.textContent, n.of('err')], [root, '2', []]);
});
test('morphdom reading a control that overrides a form member leaves no section stuck: a new root tag, then each corrected rev', () => {
  // morphdom compares node names before it merges a root: with `<input name="nodeName">` it throws there.
  const b = bootBridge({ html: FINISHED_HERO, before: (win) => overrideOnFormPrototype(win, ['nodeName']) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  b.send('section', { id: 'hero', rev: 1, final: true, html: '<form><input name="nodeName"><p>1</p></form>' });
  assert.equal(q('[data-section="hero"]').outerHTML, '<form data-section="hero"><input name="nodeName"><p>1</p></form>');
  assert.equal(q('form').nodeName.localName, 'input', 'the override is in place');
  // the live form now holds the control, and the correction drops it
  b.send('section', { id: 'hero', rev: 2, final: true, html: '<form><p>2</p></form>' });
  const root = q('[data-section="hero"]');
  assert.equal(root.outerHTML, '<form data-section="hero"><p>2</p></form>');
  b.send('section', { id: 'hero', rev: 3, final: true, html: '<form><p>3</p></form>' });
  assert.deepEqual([q('[data-section="hero"]'), root.textContent, b.doc.querySelectorAll('[data-section]').length], [root, '3', 1], 'merged in place, no stale root');
  b.send('hello', { mode: 'build', kind: 'web' });
  b.clock.frame();
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.rev, a.added]), [['hero', 1, 3], ['hero', 2, 2], ['hero', 3, 0], ['hero', 0, 2]]);
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => s.id), ['hero']);
});
test('morphdom writing through a live form whose controls override removeChild or appendChild leaves no section stuck', () => {
  const b = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['removeChild', 'appendChild']) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  b.send('section', { id: 'hero', rev: 1, final: true, html: '<form><input name="removeChild"><p>1</p></form>' });
  assert.equal(q('form').removeChild.localName, 'input', 'the override is in place');
  // morphdom removes the control with form.removeChild
  b.send('section', { id: 'hero', rev: 2, final: true, html: '<form><p>2</p></form>' });
  assert.equal(q('[data-section="hero"]').outerHTML, '<form data-section="hero"><p>2</p></form>');
  b.send('section', { id: 'hero', rev: 3, final: true, html: '<form><input name="appendChild"><p>3</p></form>' });
  // morphdom adds a child with form.appendChild
  b.send('section', { id: 'hero', rev: 4, final: true, html: '<form><input name="appendChild"><p>4</p><p>more</p></form>' });
  assert.equal(q('[data-section="hero"]').outerHTML, '<form data-section="hero"><input name="appendChild"><p>4</p><p>more</p></form>');
  b.send('section', { id: 'hero', rev: 5, final: true, html: '<form><p>5</p></form>' });
  assert.equal(q('[data-section="hero"]').outerHTML, '<form data-section="hero"><p>5</p></form>');
  // A keyed control is removed last, after morphdom has moved the new `b` out of the parsed markup: the section is
  // parsed again, never rebuilt from what morphdom left of it.
  b.send('section', { id: 'hero', rev: 6, final: true, html: '<form><input id="k" name="removeChild"><p>6</p></form>' });
  b.send('section', { id: 'hero', rev: 7, final: true, html: '<form><p>7</p><b>new</b></form>' });
  assert.equal(q('[data-section="hero"]').outerHTML, '<form data-section="hero"><p>7</p><b>new</b></form>');
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(b.of('applied').map((a) => [a.rev, a.layers]), [[1, 3], [2, 2], [3, 3], [4, 4], [5, 2], [6, 3], [7, 3]]);
});
test('a new root tag the parser takes but createElementNS refuses goes in whole, and later revs merge into it', () => {
  const b = bootBridge({ html: FINISHED_HERO });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  assert.throws(() => b.doc.createElementNS('http://www.w3.org/1999/xhtml', 'x:'), 'createElementNS refuses the name');
  b.send('section', { id: 'hero', rev: 1, final: true, html: '<x:><p>1</p></x:>' });
  const root = q('[data-section="hero"]');
  assert.equal(root.outerHTML, '<x: data-section="hero"><p>1</p></x:>');
  b.send('section', { id: 'hero', rev: 2, final: true, html: '<x:><p>2</p></x:>' });
  assert.deepEqual([q('[data-section="hero"]'), root.textContent, b.of('err')], [root, '2', []]);
});
test('a merge that throws after moving parsed nodes still puts the whole section in, parsed again', () => {
  const b = bootBridge({ html: FINISHED_HERO });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const real = b.win.morphdom;
  b.win.morphdom = (from, to) => { from.appendChild(to.lastChild); throw new Error('mid-merge'); };
  b.send('section', { id: 'hero', rev: 1, final: true, html: '<section><h1>b</h1><p>c</p></section>' });
  assert.equal(q('[data-section="hero"]').outerHTML, '<section data-section="hero"><h1>b</h1><p>c</p></section>');
  b.win.morphdom = real;
  b.send('section', { id: 'hero', rev: 2, final: true, html: '<section><h1>d</h1></section>' });
  assert.deepEqual([q('[data-section="hero"]').outerHTML, b.of('err'), b.of('applied').map((a) => [a.rev, a.added])],
    ['<section data-section="hero"><h1>d</h1></section>', [], [[1, 3], [2, 0]]]);
});
/**
 * A form's named properties include every control whose form owner it is, a `form=` control placed elsewhere too, as
 * form.elements does: modelled for `names` on HTMLFormElement.prototype (jsdom has none), counting the overridden reads
 * in `reads.n`, so an endless walk shows as a count rather than a hang. Pass it as `bootBridge`'s `before`.
 */
function byFormOwner(names, reads) {
  return (win) => {
    const elements = Object.getOwnPropertyDescriptor(win.HTMLFormElement.prototype, 'elements').get;
    for (const name of names) {
      const desc = Object.getOwnPropertyDescriptor(win.Element.prototype, name) ?? Object.getOwnPropertyDescriptor(win.Node.prototype, name);
      Object.defineProperty(win.HTMLFormElement.prototype, name, { configurable: true, get() {
        const control = elements.call(this).namedItem(name);
        if (control && ++reads.n <= 10000) return control;
        return desc.get ? desc.get.call(this) : desc.value;
      } });
    }
  };
}
test('strip: no element keeps a form attribute, so a control joins only its ancestor form and morphdom never walks for ever', () => {
  const reads = { n: 0 };
  const b = bootBridge({ html: SLOT_HERO, before: byFormOwner(['nextSibling', 'firstChild'], reads) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const hero = () => q('[data-section="hero"]').outerHTML;
  const put = (rev, html) => b.send('section', { id: 'hero', rev, final: true, html });
  put(1, '<section><input form="f" name="nextSibling"><form id="f"></form><p>1</p></section>');
  assert.deepEqual([hero(), q('form').nextSibling], ['<section data-section="hero"><input name="nextSibling"><form id="f"></form><p>1</p></section>', q('p')]);
  // an edit that joins a control to a form in the same section: the form and its control would name each other
  put(2, '<section><input id="k2" name="a"><form id="g"></form><p>2</p></section>');
  put(3, '<section><input id="k2" form="g" name="nextSibling"><form id="g"></form><p>3</p></section>');
  assert.equal(hero(), '<section data-section="hero"><input id="k2" name="nextSibling"><form id="g"></form><p>3</p></section>');
  // the same rev again and again: never one more copy
  put(4, '<section><div><input name="firstChild"></div><form id="f"><p>OLD</p></form></section>');
  for (const rev of [5, 6, 7]) put(rev, '<section><div><input form="f" name="firstChild"></div><form id="f"><input name="z"><p>NEW</p></form></section>');
  assert.equal(hero(), '<section data-section="hero"><div><input name="firstChild"></div><form id="f"><input name="z"><p>NEW</p></form></section>');
  assert.deepEqual([reads.n, b.of('err')], [0, []]);
});
test('the doc is checked before a merge: a form root, or a form in the root, whose controls override what morphdom reads goes in whole', () => {
  // Only the live form holds the control: the parse of the next rev is clean.
  const b = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['firstChild']) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const put = (rev, html) => b.send('section', { id: 'hero', rev, final: true, html });
  put(1, '<form><p>1</p><input name="firstChild"></form>');
  assert.equal(q('form').firstChild.localName, 'input', 'the override is in place');
  put(2, '<form><p>2</p></form>');
  assert.equal(q('[data-section="hero"]').outerHTML, '<form data-section="hero"><p>2</p></form>');
  put(3, '<section><form><p>3</p><input name="firstChild"></form></section>');
  put(4, '<section><form><p>4</p></form></section>');
  assert.equal(q('[data-section="hero"]').outerHTML, '<section data-section="hero"><form><p>4</p></form></section>');
  assert.deepEqual(b.of('err'), []);
  // A new root tag: morphdom merges into a new root, never into the form, so the form root is merged in place.
  const c = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['firstChild']) });
  const cq = (s) => c.win.Document.prototype.querySelector.call(c.doc, s);
  c.send('section', { id: 'hero', rev: 1, final: true, html: '<form><p>1</p><input name="firstChild"></form>' });
  const p = cq('p');
  c.send('section', { id: 'hero', rev: 2, final: true, html: '<div><p>2</p></div>' });
  assert.deepEqual([cq('[data-section="hero"]').outerHTML, cq('p'), c.of('applied').map((a) => a.added), c.of('err')],
    ['<div data-section="hero"><p>2</p></div>', p, [3, 0], []]);
});
test('a new root tag that makes the root a form, holding a control that overrides what morphdom reads, goes in whole', () => {
  const b = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['firstChild']) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  b.send('section', { id: 'hero', rev: 1, final: true, html: '<div class="old"><p>OLD</p><input name="firstChild"></div>' });
  b.send('section', { id: 'hero', rev: 2, final: true, html: '<form class="new"><p>NEW</p></form>' });
  assert.deepEqual([q('[data-section="hero"]').outerHTML, b.of('err')], ['<form class="new" data-section="hero"><p>NEW</p></form>', []]);
});
test('a shell body or wrapper carrying data-section is no section root: the slot takes the section and nothing else is touched', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body data-section="price"><header>H</header><main>'
    + '<section data-section="hero"><h1>a</h1></section><div data-worca-slot="price"></div></main></body></html>' });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  b.send('hello', { mode: 'build', kind: 'web' });
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.rev, a.added]), [['hero', 0, 2]], 'the body is no root of price');
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>b</h1></section>', final: true });
  b.send('section', { id: 'price', rev: 2, html: '<section><p>price 2</p></section>', final: true });
  b.clock.frame();
  assert.deepEqual(b.of('err'), []);
  assert.equal(b.doc.body.innerHTML,
    '<header>H</header><main><section data-section="hero"><h1>b</h1></section><section data-section="price"><p>price 2</p></section></main>');
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => s.id), ['hero', 'price']);
  // A wrapper around finished sections holds another planned section's root: the plan gives price a slot of its own.
  const w = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price"><section data-section="hero"><h1>a</h1></section></main></body></html>' });
  w.send('hello', { mode: 'build', kind: 'web' });
  w.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  w.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
  w.send('section', { id: 'hero', rev: 1, html: '<section><h1>b</h1></section>', final: true });
  w.clock.frame();
  assert.deepEqual(w.of('err'), []);
  assert.equal(w.doc.body.innerHTML, '<main data-section="price"><section data-section="hero"><h1>b</h1></section></main><section data-section="price"><p>price</p></section>');
  assert.deepEqual(w.of('rects').at(-1).sections.map((s) => s.id), ['hero', 'price']);
  // The same wrapper with another marked element before hero's root: it still holds hero's every node, so price's
  // rev never wipes hero.
  const v = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price"><div data-section="intro"></div><section data-section="hero"><h1>a</h1></section></main></body></html>' });
  v.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  v.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
  v.send('section', { id: 'hero', rev: 1, html: '<section><h1>b</h1></section>', final: true });
  v.clock.frame();
  assert.deepEqual([v.of('err'), v.doc.body.innerHTML, v.of('rects').at(-1).sections.map((s) => s.id)], [[],
    '<main data-section="price"><div data-section="intro"></div><section data-section="hero"><h1>b</h1></section></main><section data-section="price"><p>price</p></section>',
    ['intro', 'hero', 'price']]);
});
test("a section's own markup may name its parts with data-section: once planned, only another planned section's root counts", () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero"><div data-section="hero-cta">c</div>'
    + '<i data-section="hero">i</i></section><div data-worca-slot="price"></div></body></html>' });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const root = q('[data-section="hero"]');
  b.send('hello', { mode: 'build', kind: 'web' });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.send('section', { id: 'hero', rev: 1, html: '<section><div data-section="hero-cta">d</div></section>', final: true });
  b.clock.frame();
  assert.deepEqual([q('[data-section="hero"]'), root.textContent, b.of('err')], [root, 'd', []]);
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => s.id), ['hero', 'price']);
});
test("the doc's own html, head and body are never a section's root", () => {
  for (const [html, where] of [
    ['<!doctype html><html data-section="price"><head></head><body><div data-worca-slot="price"></div></body></html>', 'html'],
    ['<!doctype html><html><head data-section="price"></head><body><div data-worca-slot="price"></div></body></html>', 'head'],
    ['<!doctype html><html><head></head><body data-section="price"><div data-worca-slot="price"></div></body></html>', 'body'],
  ]) {
    const b = bootBridge({ html });
    b.send('hello', { mode: 'build', kind: 'web' });
    b.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
    assert.deepEqual([b.of('applied').map((a) => [a.id, a.rev]), b.doc.body.innerHTML, b.doc.head.innerHTML, b.of('err')],
      [[['price', 1]], '<section data-section="price"><p>price</p></section>', '', []], where);
  }
});
test('before the first plan, an element holding another section\'s slot is no root either', () => {
  // A slot whose id is no section id stands for no section: `cta` stays a root.
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price"><div data-worca-slot="hero"></div></main><div data-worca-slot="price"></div>'
    + '<section data-section="cta"><div data-worca-slot="Not An Id"></div></section></body></html>' });
  b.send('hello', { mode: 'build', kind: 'web' });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>a</h1></section>', final: true });
  b.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
  assert.deepEqual([b.of('applied').map((a) => [a.id, a.rev]), b.of('err')], [[['cta', 0], ['hero', 1], ['price', 1]], []]);
  assert.equal(b.doc.body.innerHTML, '<main data-section="price"><section data-section="hero"><h1>a</h1></section></main><section data-section="price"><p>price</p></section>'
    + '<section data-section="cta"><div data-worca-slot="Not An Id"></div></section>');
});
test('before the first plan, a section whose text has arrived is guarded too: a wrapper around its served root is no root', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price"><section data-section="hero"><h1>a</h1></section></main></body></html>' });
  b.send('hello', { mode: 'build', kind: 'web' });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>b</h1></section>', final: true });
  b.send('section', { id: 'price', rev: 1, html: '<section><p>price</p></section>', final: true });
  assert.deepEqual([b.of('applied').filter((a) => a.rev > 0).map((a) => a.id), b.of('err').map((e) => e.code), b.doc.body.innerHTML],
    [['hero'], ['no-slot'], '<main data-section="price"><section data-section="hero"><h1>b</h1></section></main>']);
});
test('a footer linking to other planned sections with data-section stays a root, live: its links never take their place', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><div data-worca-slot="hero"></div><div data-worca-slot="price"></div><div data-worca-slot="footer"></div></body></html>' });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const links = '<a href="#hero" data-section="hero" data-r="10,810,40,20">Top</a><a href="#price" data-section="price" data-r="60,810,40,20">Plans</a>';
  b.send('hello', { mode: 'build', kind: 'web' });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }, { id: 'footer' }] });
  b.send('section', { id: 'hero', rev: 1, final: true, html: '<section data-r="0,0,1000,400"><h1>Hi</h1></section>' });
  b.send('section', { id: 'price', rev: 1, final: true, html: '<section data-r="0,400,1000,400"><h2>Plans</h2></section>' });
  b.send('section', { id: 'footer', rev: 1, final: true, html: `<footer data-r="0,800,1000,100">${links}</footer>` });
  const footer = q('footer');
  b.send('section', { id: 'footer', rev: 2, final: true, html: `<footer data-r="0,800,1000,100">${links}<p>2</p></footer>` });
  b.send('section', { id: 'hero', rev: 2, final: true, html: '<section data-r="0,0,1000,400"><h1>Hi 2</h1></section>' });
  b.send('section', { id: 'price', rev: 2, final: true, html: '<section data-r="0,400,1000,400"><h2>Plans 2</h2></section>' });
  b.clock.frame();
  assert.deepEqual([b.of('err'), q('footer'), q('footer p').textContent, q('h1').textContent, q('h2').textContent, b.doc.querySelectorAll('a').length],
    [[], footer, '2', 'Hi 2', 'Plans 2', 2]);
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => [s.id, s.rect]),
    [['hero', [0, 0, 1000, 400]], ['price', [0, 400, 1000, 400]], ['footer', [0, 800, 1000, 100]]]);
});
test('after a reload, a section whose markup names another planned section is merged in place, and that section keeps its own root', () => {
  // Each section's markup at a rev; the served doc holds them at rev 0, as a reload of a finished build does.
  const shapes = {
    'a nav linking to price': {
      nav: (r) => `<nav data-section="nav" data-r="0,0,1000,50"><a href="#price" data-section="price" data-r="500,10,60,20">Pricing ${r}</a></nav>`,
      price: (r) => `<section data-section="price" data-r="0,800,1000,400"><h2>Plans ${r}</h2></section>`,
    },
    'a table of contents': {
      toc: (r) => `<nav data-section="toc" data-r="0,0,200,800"><a href="#hero" data-section="hero" data-r="0,0,200,20">Hero ${r}</a>`
        + '<a href="#price" data-section="price" data-r="0,20,200,20">Price</a></nav>',
      hero: (r) => `<section data-section="hero" data-r="200,0,800,400"><h1>a ${r}</h1></section>`,
      price: (r) => `<section data-section="price" data-r="200,400,800,400"><h2>b ${r}</h2></section>`,
    },
    'a part named like another section, inside a part': {
      hero: (r) => `<section data-section="hero" data-r="0,0,1000,400"><div data-section="hero-cta"><div data-section="cta" data-r="10,10,100,40">Buy ${r}</div></div></section>`,
      cta: (r) => `<section data-section="cta" data-r="0,400,1000,200"><p>real ${r}</p></section>`,
    },
  };
  for (const [shape, sections] of Object.entries(shapes)) {
    const ids = Object.keys(sections);
    const doc = (rev) => ids.map((id) => sections[id](rev)).join('');
    const b = bootBridge({ html: `<!doctype html><html><head></head><body>${doc(0)}</body></html>` });
    b.send('hello', { mode: 'build', kind: 'web' });
    b.send('plan', { sections: ids.map((id) => ({ id })) });
    for (const rev of [1, 2]) for (const id of ids) b.send('section', { id, rev, final: true, html: sections[id](rev) });
    b.clock.frame();
    const rect = (id) => sections[id](0).match(/ data-r="([^"]+)"/)[1].split(',').map(Number);
    assert.deepEqual([b.of('applied').filter((a) => a.rev === 0).map((a) => a.id), b.of('err'), b.doc.body.innerHTML], [ids, [], doc(2)], shape);
    assert.deepEqual(b.of('rects').at(-1).sections.map((s) => [s.id, s.rect]), ids.map((id) => [id, rect(id)]), shape);
  }
});
test('a wrapper is still no root once the section it held leaves the plan: rects and revs both keep the applied root', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price" data-r="0,0,1000,10">'
    + '<section data-section="hero"><h1>a</h1></section></main></body></html>' });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  b.send('hello', { mode: 'build', kind: 'web' });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.send('section', { id: 'price', rev: 1, html: '<section data-r="0,500,1000,300"><p>1</p></section>', final: true });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>b</h1></section>', final: true });
  b.send('plan', { sections: [{ id: 'price' }] });
  b.send('section', { id: 'price', rev: 2, html: '<section data-r="0,500,1000,300"><p>2</p></section>', final: true });
  b.clock.frame();
  assert.deepEqual([b.of('err'), q('main').outerHTML, q('p').textContent], [[], '<main data-section="price" data-r="0,0,1000,10"></main>', '2']);
  assert.deepEqual(b.of('rects').at(-1).sections.map((s) => [s.id, s.rect]), [['price', [0, 500, 1000, 300]]]);
});
test("a wrapper around another section's slot or applied root stays no root, once a link elsewhere names that section and once the plan omits it", () => {
  const html = { hero: '<section><h1>a</h1></section>', nav: '<nav><a href="#hero" data-section="hero">Hero</a></nav>', price: '<section><p>price</p></section>' };
  // hero first: its applied root is in the wrapper; hero last: its slot still is.
  for (const order of [['hero', 'nav', 'price'], ['nav', 'price', 'hero']]) {
    const b = bootBridge({ html: '<!doctype html><html><head></head><body><div data-worca-slot="nav"></div><main data-section="price"><div data-worca-slot="hero"></div></main></body></html>' });
    b.send('plan', { sections: [{ id: 'nav' }, { id: 'hero' }, { id: 'price' }] });
    for (const id of order) b.send('section', { id, rev: 1, html: html[id], final: true });
    assert.deepEqual([b.of('err'), b.doc.body.innerHTML], [[], '<nav data-section="nav"><a href="#hero" data-section="hero">Hero</a></nav>'
      + '<section data-section="price"><p>price</p></section><main data-section="price"><section data-section="hero"><h1>a</h1></section></main>'], order.join());
  }
  // Applied before the first plan, which omits it (a first plan removes nothing).
  const c = bootBridge({ html: '<!doctype html><html><head></head><body><main data-section="price"><div data-worca-slot="x"></div></main><div data-worca-slot="price"></div></body></html>' });
  c.send('section', { id: 'x', rev: 1, html: '<section>x</section>', final: true });
  c.send('plan', { sections: [{ id: 'price' }] });
  c.send('section', { id: 'price', rev: 1, html: '<section>p</section>', final: true });
  assert.deepEqual([c.of('err'), c.doc.body.innerHTML],
    [[], '<main data-section="price"><section data-section="x">x</section></main><section data-section="price">p</section>']);
});
test("a shell band carrying data-section around a section is no root, though another section's link names that section", () => {
  const body = (hero, footer, tail = '') => `<header>H</header><div data-section="band" data-r="0,50,1000,400">${hero}</div>${footer}${tail}`;
  const hero = (r) => `<section data-section="hero" data-r="0,50,1000,400"><h1>Hi ${r}</h1></section>`;
  // The link sits in a part of the footer.
  const footer = (r) => `<footer data-section="footer" data-r="0,900,1000,100"><nav data-section="footer-nav"><a href="#hero" data-section="hero" data-r="10,910,40,20">Top ${r}</a></nav></footer>`;
  const ids = [['hero', 0, 50, 1000, 400], ['footer', 0, 900, 1000, 100]];
  const slot = '<div data-worca-slot="price" data-r="0,1000,1000,10"></div>';
  // After a reload, both finished; live, the footer landing first; and a shell body that names a planned section.
  for (const [shape, open, served, order, tail, rects] of [
    ['reload', '<body>', body(hero(0), footer(0)), ['hero', 'footer'], '', ids],
    ['live', '<body>', body('<div data-worca-slot="hero"></div>', '<div data-worca-slot="footer"></div>'), ['footer', 'hero'], '', ids],
    ['body', '<body data-section="price">', body(hero(0), footer(0), slot), ['hero', 'footer'], slot, [...ids, ['price', 0, 1000, 1000, 10]]],
  ]) {
    const b = bootBridge({ html: `<!doctype html><html><head></head>${open}${served}</body></html>` });
    b.send('hello', { mode: 'build', kind: 'web' });
    b.send('plan', { sections: rects.map(([id]) => ({ id })) });
    for (const id of order) b.send('section', { id, rev: 1, final: true, html: { hero, footer }[id](1) });
    b.clock.frame();
    assert.deepEqual([b.of('err'), b.doc.body.innerHTML, b.of('rects').at(-1).sections.map((s) => [s.id, ...s.rect])],
      [[], body(hero(1), footer(1), tail), rects], shape);
  }
});
test('a root comes before a slot wherever the slot stands, and only every node of a section makes a wrapper', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><div data-worca-slot="hero"></div><section data-section="hero" data-r="0,9,9,9"><h1>a</h1></section></body></html>' });
  b.send('plan', { sections: [{ id: 'hero' }] });
  b.send('section', { id: 'hero', rev: 1, html: '<section data-r="0,9,9,9"><h1>b</h1></section>', final: true });
  b.clock.frame();
  assert.deepEqual([b.of('err'), b.doc.body.innerHTML, b.of('rects').at(-1).sections],
    [[], '<div data-worca-slot="hero"></div><section data-section="hero" data-r="0,9,9,9"><h1>b</h1></section>', [{ id: 'hero', rect: [0, 9, 9, 9] }]]);
  // Hero has two slots and the wrapper holds one: a merge into it leaves hero a slot, so it is price's root.
  const c = bootBridge({ html: '<!doctype html><html><head></head><body><div data-worca-slot="hero"></div><main data-section="price"><div data-worca-slot="hero"></div></main></body></html>' });
  c.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  c.send('section', { id: 'price', rev: 1, html: '<main><p>price</p></main>', final: true });
  c.send('section', { id: 'hero', rev: 1, html: '<section>h</section>', final: true });
  assert.deepEqual([c.of('err'), c.doc.body.innerHTML], [[], '<section data-section="hero">h</section><main data-section="price"><p>price</p></main>']);
});
test("a slot inside another section's root is that section's markup: the section fills its own slot", () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero"><div data-worca-slot="price"></div></section><div data-worca-slot="price"></div></body></html>' });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.send('section', { id: 'price', rev: 1, html: '<section>p</section>', final: true });
  b.clock.frame();
  assert.deepEqual([b.of('err'), b.doc.body.innerHTML, b.of('rects').at(-1).sections.map((s) => s.id)],
    [[], '<section data-section="hero"><div data-worca-slot="price"></div></section><section data-section="price">p</section>', ['hero', 'price']]);
});
test('a form whose controls override its attributes or firstChild is put in whole, never merged stale', () => {
  const b = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['attributes', 'firstChild']) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const markup = (c, h) => `<form class="${c}"><h1>${h}</h1><input name="firstChild"><input name="attributes"></form>`;
  b.send('section', { id: 'hero', rev: 1, final: true, html: markup('a', 'Old') });
  assert.equal(q('form').firstChild.localName, 'input', 'the override is in place');
  b.send('section', { id: 'hero', rev: 2, final: true, html: markup('b', 'New') });
  assert.equal(q('[data-section="hero"]').outerHTML, '<form class="b" data-section="hero"><h1>New</h1><input name="firstChild"><input name="attributes"></form>');
  assert.deepEqual(b.of('err'), []);
  // only the parse holds the control: morphdom would read the new form's attributes through it
  const c = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['attributes']) });
  c.send('section', { id: 'hero', rev: 1, final: true, html: '<section><form class="a"><p>1</p></form></section>' });
  c.send('section', { id: 'hero', rev: 2, final: true, html: '<section><form class="b"><input name="attributes"><p>2</p></form></section>' });
  assert.deepEqual([c.win.Document.prototype.querySelector.call(c.doc, 'form').outerHTML, c.of('err')], ['<form class="b"><input name="attributes"><p>2</p></form>', []]);
});
test('forms whose controls are named id are merged in place by their real id attribute, never duplicated', () => {
  const b = bootBridge({ html: SLOT_HERO, before: (win) => overrideOnFormPrototype(win, ['id']) });
  const q = (s) => b.win.Document.prototype.querySelector.call(b.doc, s);
  const forms = () => [...b.win.Element.prototype.querySelectorAll.call(b.doc.body, 'form')];
  const markup = (p) => `<section><form><input name="id"><p>${p}</p></form><form><input name="id"><p>${p}</p></form></section>`;
  b.send('section', { id: 'hero', rev: 1, final: true, html: markup(1) });
  assert.equal(q('form').id.localName, 'input', 'the override is in place');
  const first = forms();
  for (const rev of [2, 3]) b.send('section', { id: 'hero', rev, final: true, html: markup(rev) });
  assert.deepEqual([forms(), q('[data-section="hero"]').textContent, b.of('err')], [first, '33', []]);
});
test('with document.body clobbered, a new slot with no neighbour still goes at the end of the real body', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main><div data-worca-slot="hero"></div></main></body></html>' });
  b.send('section', { id: 'hero', rev: 1, html: '<section><img name="body" alt=""></section>', final: true });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'solo' }] });
  const solo = b.win.Document.prototype.querySelector.call(b.doc, '[data-worca-slot="solo"]');
  assert.deepEqual([solo.parentNode.localName, b.of('err')], ['body', []]);
});
test('run doc: markup that clobbers document.querySelector does not stop goto', () => {
  const b = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><deck-stage><section data-section="s1"><img name="querySelector" alt=""></section></deck-stage></body></html>' });
  const seen = [];
  b.win.Document.prototype.querySelector.call(b.doc, 'deck-stage').goTo = (i) => seen.push(i);
  b.send('goto', { index: 1 });
  assert.deepEqual([seen, b.of('err')], [[1], []]);
});
test('a non-final prefix is cut before the parse, and text with no element yet posts no err', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: 'only text', final: false });
  b.send('section', { id: 'hero', rev: 2, html: '<section>a &am', final: false });
  assert.equal(b.doc.querySelector('[data-section="hero"]').textContent, 'a ');
  assert.deepEqual(b.of('err'), []);
});
test('layers follow a new root tag and a section the plan removed', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('plan', { sections: [{ id: 'hero' }, { id: 'price' }] });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>a</h1></section>', final: true });
  b.send('section', { id: 'hero', rev: 2, html: '<div><h1>a</h1><p>b</p></div>', final: true });
  assert.equal(b.of('applied').at(-1).layers, 3);
  b.send('section', { id: 'price', rev: 1, html: '<section><b>p</b></section>', final: true });
  assert.equal(b.of('applied').at(-1).layers, 5);
  b.send('plan', { sections: [{ id: 'price' }] });
  b.send('section', { id: 'price', rev: 2, html: '<section><b>p</b><i>q</i></section>', final: true });
  assert.equal(b.of('applied').at(-1).layers, 3);
});
test('plan: a new slot follows its earlier neighbour, a new slot is a neighbour too, and a repeated id is one slot', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><main><div data-worca-slot="x"></div><p>z</p><!--worca:sections--></main><footer>F</footer></body></html>' });
  b.send('plan', { sections: [{ id: 'x' }, { id: 'n1' }, { id: 'n2' }, { id: 'n1' }] });
  const main = b.doc.querySelector('main');
  assert.deepEqual([...main.children].map((e) => e.getAttribute('data-worca-slot') || e.tagName), ['x', 'n1', 'n2', 'P']);
});
test('plan: with no neighbour in the container a slot goes before the marker; only a finite estHeight sizes a slot, never a root, and a repeated plan changes nothing', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><div class="row"><section data-section="a">A</section></div><main><!--worca:sections--></main><footer>F</footer></body></html>' });
  const sections = [{ id: 'a', estHeight: 300 }, { id: 'n', estHeight: -5 }, { id: 'p', estHeight: Infinity }, { id: 'q', estHeight: '300' }, { id: 'r', estHeight: 120 }];
  b.send('plan', { sections });
  const main = b.doc.querySelector('main');
  assert.deepEqual([...main.children].map((e) => e.getAttribute('data-worca-slot')), ['n', 'p', 'q', 'r']);
  assert.equal(main.lastChild.nodeType, 8);
  assert.equal(b.doc.querySelector('[data-section="a"]').getAttribute('style'), null);
  const s = (id) => b.doc.querySelector(`[data-worca-slot="${id}"]`);
  assert.equal(s('n').style.minHeight, '0px');
  for (const id of ['p', 'q']) assert.equal(s(id).getAttribute('style'), null, id);
  assert.equal(s('r').style.minHeight, '120px');
  const mo = new b.win.MutationObserver(() => {}); mo.observe(b.doc.body, { attributes: true, childList: true, subtree: true });
  b.send('plan', { sections });
  assert.deepEqual(mo.takeRecords(), []);
  mo.disconnect();
});
