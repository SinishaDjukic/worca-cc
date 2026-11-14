import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBridge, overrideByControl, FORM_MEMBERS, SLOT_HERO } from './helpers/design-bridge.mjs';

const RUN = '<!doctype html><html><head></head><body><section data-section="hero" data-r="1,2,3,4"><div>a</div><div><h1 id="x" data-r="5,6,7,8">Ship   it</h1></div></section><p id="out">o</p></body></html>';
test('pick on: a click is swallowed and reported, capped', () => {
  const b = bootBridge({ mode: 'run', html: RUN });
  b.send('pick', { on: true });
  const ev = new b.win.MouseEvent('click', { bubbles: true, cancelable: true });
  b.doc.getElementById('x').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  const { ns, v, n, t, ...p } = b.of('picked')[0];
  assert.deepEqual(p, { id: 'hero', path: '[data-section="hero"] > div:nth-of-type(2) > h1:nth-of-type(1)', tag: 'h1', text: 'Ship it',
    html: '<h1 id="x" data-r="5,6,7,8">Ship   it</h1>', rect: [5, 6, 7, 8] });
});
test('pick caps text at 200 and html at 2048', () => {
  const long = 'x'.repeat(5000);
  const b = bootBridge({ mode: 'run', html: `<!doctype html><html><head></head><body><section data-section="hero"><p id="p">${long}</p></section></body></html>` });
  b.send('pick', { on: true });
  b.doc.getElementById('p').click();
  const p = b.of('picked')[0];
  assert.equal(p.text.length, 200); assert.equal(p.html.length, 2048);
});
test('pick off and outside any section', () => {
  const b = bootBridge({ mode: 'run', html: RUN });
  b.doc.getElementById('x').click();
  assert.deepEqual(b.of('picked'), []);
  b.send('pick', { on: true });
  const ev = new b.win.MouseEvent('click', { bubbles: true, cancelable: true });
  b.doc.getElementById('out').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(b.of('picked'), []);
  b.send('pick', { on: false });
  const ev2 = new b.win.MouseEvent('click', { bubbles: true, cancelable: true });
  b.doc.getElementById('x').dispatchEvent(ev2);
  assert.equal(ev2.defaultPrevented, false);
});
test('Review Focus: build mode cancels a navigating click and keeps a same-doc one', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><a id="out" href="https://example.com/">o</a><a id="in" href="#top">i</a><svg><a id="s" href="https://example.com/"><text>t</text></a><a id="sx" xlink:href="https://example.com/"><text>u</text></a></svg></body></html>' });
  const click = (id) => { const e = new b.win.MouseEvent('click', { bubbles: true, cancelable: true }); b.doc.getElementById(id).dispatchEvent(e); return e.defaultPrevented; };
  assert.equal(click('out'), true);
  assert.equal(click('s'), true);
  assert.equal(click('sx'), true, 'an SVG link with only xlink:href navigates too');
  assert.equal(click('in'), false);
  const r = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><a id="out" href="https://example.com/">o</a></body></html>' });
  const e = new r.win.MouseEvent('click', { bubbles: true, cancelable: true });
  r.doc.getElementById('out').dispatchEvent(e);
  assert.equal(e.defaultPrevented, false, 'the run doc is the artifact itself');
});
test('build mode: an empty or bare href, a lone #, a link in an open shadow root, an area and an animated SVG href all navigate', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><a id="e" href="">e</a><a id="bare" href>b</a><a id="hash" href="#">h</a><a id="none"><input id="box" type="checkbox"></a><div id="host"></div><svg><a id="xe" xlink:href=""><text>x</text></a><a id="anim" href="#ok"><text>t</text></a><a id="still" href="#ok"><text>s</text></a><a id="bareanim"><text>u</text></a></svg><map name="m"><area id="ar" href="/x"></map></body></html>' });
  const click = (el) => { const e = new b.win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }); el.dispatchEvent(e); return e.defaultPrevented; };
  const $ = (id) => b.doc.getElementById(id);
  assert.equal(click($('e')), true, 'href="" reloads the frame without its #n=');
  assert.equal(click($('bare')), true, 'a bare href is href=""');
  assert.equal(click($('hash')), true, 'a lone # is cancelled too');
  assert.equal(click($('xe')), true, 'an empty xlink:href');
  assert.equal(click($('ar')), true, 'an area link');
  assert.equal(click($('box')), false, 'an a with no href is no link');
  // At the window a click inside a shadow root targets its host: the link is found on the composed path.
  const shadow = $('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<a id="in" href="/elsewhere"><b>s</b></a><a id="frag" href="#top">f</a>';
  assert.equal(click(shadow.getElementById('in').firstChild), true, 'a link inside an open shadow root');
  assert.equal(click(shadow.getElementById('frag')), false, 'a same-doc link inside a shadow root stays');
  // An SVG link follows its animated href (SMIL set/animate), which no attribute shows. jsdom has no
  // SVGAnimatedString, so each link is given the one a browser would hold.
  Object.defineProperty($('anim'), 'href', { value: { baseVal: '#ok', animVal: '/elsewhere' } });
  Object.defineProperty($('still'), 'href', { value: { baseVal: '#ok', animVal: '#ok' } });
  Object.defineProperty($('bareanim'), 'href', { value: { baseVal: '', animVal: '/elsewhere' } });
  assert.equal(click($('anim')), true, 'an animated href');
  assert.equal(click($('still')), false, 'an SVG link whose animated href is still #ok');
  assert.equal(click($('bareanim')), true, 'an SVG link with no href attribute and an animated one');
  Object.defineProperty($('xe'), 'href', { value: { baseVal: '', animVal: '' } });
  $('xe').removeAttribute('xlink:href');
  assert.equal(click($('xe')), false, 'an SVG a with no href at all and nothing animated is no link');
});
test('build mode: the whole path counts — a link inside a link, a use copy, a MathML href and a middle click navigate', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body>'
    + '<a href="/x"><svg><a id="inner"><text id="t">t</text></a></svg></a>'
    + '<svg><a href="/x"><foreignObject><a id="fo">f</a></foreignObject></a></svg>'
    + '<a href="/x"><svg><a href="#ok"><text id="frag">g</text></a></svg></a>'
    + '<a href="/x"><span id="host"></span></a>'
    + '<svg><defs><a id="L" href="/x"><rect></rect></a></defs><use id="u" href="#L"></use><g><use id="u2" href="#icon"></use></g><rect id="r"></rect></svg>'
    + '<math><mi id="mi" href="/x">x</mi></math><math href="/x"><mi id="inmath">y</mi></math><math><mi id="plain">z</mi></math>'
    + '<a id="out" href="/x">o</a><a id="same" href="#top">s</a></body></html>' });
  const click = (el, type = 'click', button = 0) => { const e = new b.win.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button }); el.dispatchEvent(e); return e.defaultPrevented; };
  const $ = (id) => b.doc.getElementById(id);
  assert.equal(click($('t')), true, 'an SVG a with no href inside a link: the browser follows the outer one');
  assert.equal(click($('fo')), true, 'an a with no href in a foreignObject inside an SVG link');
  assert.equal(click($('frag')), true, 'a same-doc link inside a link that leaves');
  const shadow = $('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<a id="sa">s</a>';
  assert.equal(click(shadow.getElementById('sa')), true, 'an a with no href in a shadow root inside a link');
  // A use element's copy of a link lives in a closed UA shadow tree, which the composed path never shows.
  assert.equal(click($('u')), true, 'a use copy of a link');
  assert.equal(click($('u2')), true, 'any use');
  assert.equal(click($('r')), false, 'a plain shape');
  assert.equal(click($('mi')), true, 'a MathML element with an href');
  assert.equal(click($('inmath')), true, 'inside a MathML element with an href');
  assert.equal(click($('plain')), false, 'MathML with no href');
  assert.equal(click($('out'), 'auxclick', 1), true, 'a middle click fires auxclick, not click');
  assert.equal(click($('same'), 'auxclick', 1), false, 'a same-doc link stays for a middle click too');
  const r = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><section data-section="s"><a id="out" href="/x">o</a></section></body></html>' });
  r.send('pick', { on: true });
  const e = new r.win.MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
  r.doc.getElementById('out').dispatchEvent(e);
  assert.deepEqual([e.defaultPrevented, r.of('picked')], [false, []], 'the run doc listens to click only');
});
test('run doc: a form whose controls override its members is picked, shown and scrolled to as any element', () => {
  const b = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><deck-stage>'
    + '<form data-section="s1" data-r="1,2,3,4">Ship <input name="m"></form>'
    + '<section data-section="s2"><form></form><form id="f2"><input name="m"><p id="pp" data-r="5,6,7,8">x</p></form></section></deck-stage></body></html>' });
  const f1 = overrideByControl(b.doc.querySelector('form'), [...FORM_MEMBERS, 'scrollIntoView']);
  const f2 = overrideByControl(b.doc.getElementById('f2'));
  b.send('pick', { on: true });
  const pick = (el) => el.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  pick(f1);
  assert.equal(b.of('picked').length, 1, 'the form itself is picked');
  pick(b.doc.getElementById('pp'));
  assert.deepEqual(b.of('picked').map(({ id, path, tag, text, html, rect }) => [id, path, tag, text, html, rect]), [
    ['s1', '[data-section="s1"]', 'form', 'Ship', '<form data-section="s1" data-r="1,2,3,4">Ship <input name="m"></form>', [1, 2, 3, 4]],
    ['s2', '[data-section="s2"] > form:nth-of-type(2) > p:nth-of-type(1)', 'p', 'x', '<p id="pp" data-r="5,6,7,8">x</p>', [5, 6, 7, 8]],
  ]);
  assert.equal(f2.parentElement, f2.querySelector('input'), 'the override is in place');
  b.doc.querySelector('deck-stage').dispatchEvent(new b.win.CustomEvent('slidechange', { bubbles: true, detail: { slide: f1 } }));
  assert.deepEqual(b.of('visible').map((m) => m.id), ['s1']);
  const seen = [];
  b.win.Element.prototype.scrollIntoView = function () { seen.push(this); };
  b.send('scroll', { id: 's1', behavior: 'auto' });
  assert.deepEqual([seen.length, seen[0] === f1, b.of('err')], [1, true, []]);
});
test('scroll: valid behaviour passes, anything else becomes auto', () => {
  const b = bootBridge({ mode: 'run', html: RUN });
  const calls = []; b.win.Element.prototype.scrollIntoView = function (o) { calls.push([this.getAttribute('data-section'), o]); };
  b.send('scroll', { id: 'hero', behavior: 'smooth' });
  b.send('scroll', { id: 'hero', behavior: 'evil' });
  b.send('scroll', { id: 'nope', behavior: 'auto' });
  assert.deepEqual(calls, [['hero', { behavior: 'smooth', block: 'start' }], ['hero', { behavior: 'auto', block: 'start' }]]);
  // A section that has only a slot yet is scrolled to by its slot.
  const s = bootBridge({ html: SLOT_HERO });
  const seen = []; s.win.Element.prototype.scrollIntoView = function () { seen.push(this.getAttribute('data-worca-slot')); };
  s.send('scroll', { id: 'hero', behavior: 'auto' });
  assert.deepEqual([seen, s.of('err')], [['hero'], []]);
});
test('goto calls deck-stage in run mode only; slidechange becomes visible', () => {
  const DECK = '<!doctype html><html><head></head><body><deck-stage><section data-section="s1"></section><section data-section="s2"></section></deck-stage></body></html>';
  const b = bootBridge({ mode: 'run', html: DECK });
  const stage = b.doc.querySelector('deck-stage'); const seen = []; stage.goTo = (i) => seen.push(i);
  b.send('goto', { index: 2 }); b.send('goto', { index: -1 }); b.send('goto', { index: 1.5 });
  assert.deepEqual(seen, [2]);
  stage.dispatchEvent(new b.win.CustomEvent('slidechange', { bubbles: true, detail: { slide: b.doc.querySelector('[data-section="s2"]') } }));
  assert.equal(b.of('visible')[0].id, 's2');
  const bb = bootBridge({ html: DECK }); const none = []; bb.doc.querySelector('deck-stage').goTo = (i) => none.push(i);
  bb.send('goto', { index: 1 }); assert.deepEqual(none, [], 'M9: no deck navigation before round end');
});
test('run doc: markup that clobbers document.addEventListener before the bridge runs stops neither ready nor visible', () => {
  // An own property while the bridge boots, as a shell `<img name="addEventListener">` before <head> would be; removed
  // at once, since jsdom reads document.addEventListener itself once the constructor returns.
  const DECK = '<!doctype html><html><head></head><body><deck-stage><section data-section="s1"></section></deck-stage></body></html>';
  const b = bootBridge({ mode: 'run', html: DECK, before(win) {
    Object.defineProperty(win.document, 'addEventListener', { configurable: true, value: win.document.createElement('img') });
  } });
  delete b.doc.addEventListener;
  assert.equal(b.of('ready').length, 1);
  b.doc.querySelector('deck-stage').dispatchEvent(new b.win.CustomEvent('slidechange', { bubbles: true, detail: { slide: b.doc.querySelector('[data-section="s1"]') } }));
  assert.deepEqual([b.of('visible').map((v) => v.id), b.of('err')], [['s1'], []]);
});
test('run mode ignores plan, section and css, and needs no morphdom', () => {
  const b = bootBridge({ mode: 'run', html: RUN, morphdom: false });
  const before = b.doc.documentElement.outerHTML; b.sent.length = 0;
  b.send('plan', { sections: [{ id: 'zed', estHeight: 10 }] });
  b.send('section', { id: 'hero', rev: 1, html: '<section>x</section>', final: true });
  b.send('css', { file: 'hero', rev: 1, text: '.a{}', final: true });
  b.clock.tick(200);
  assert.equal(b.doc.documentElement.outerHTML, before);
  assert.deepEqual(b.sent.filter(({ m }) => m.t !== 'rects'), []);
});
test('build mode ignores pick', () => {
  const b = bootBridge({ html: RUN }); b.send('pick', { on: true });
  b.doc.getElementById('x').click();
  assert.deepEqual(b.of('picked'), []);
});
test('pick on: the window capture listener swallows the click before the doc\'s own listeners', () => {
  const b = bootBridge({ mode: 'run', html: RUN });
  const seen = [];
  b.doc.getElementById('x').addEventListener('click', (e) => { seen.push(e.type); e.stopPropagation(); });
  b.send('pick', { on: true });
  b.doc.getElementById('x').click();
  assert.deepEqual(seen, [], 'the model listener never runs');
  assert.equal(b.of('picked').length, 1);
});
test('pick caps a deep path at 512 and never splits a surrogate pair', () => {
  const deep = '<div>'.repeat(60) + '<b id="b">' + 'x'.repeat(199) + String.fromCodePoint(0x1f600) + '</b>' + '</div>'.repeat(60);
  const b = bootBridge({ mode: 'run', html: `<!doctype html><html><head></head><body><section data-section="hero"><p></p>${deep}</section></body></html>` });
  b.send('pick', { on: true });
  b.doc.getElementById('b').click();
  const p = b.of('picked')[0];
  assert.equal(p.path.length, 512);
  // The `<p>` before the first div: nth-of-type counts same-tag siblings only.
  assert.ok(p.path.startsWith('[data-section="hero"] > div:nth-of-type(1) > div:nth-of-type(1)'));
  assert.equal(p.text, 'x'.repeat(199));
});
test('visible: only a slide that is a section, captured, and only in the run doc', () => {
  const DECK = '<!doctype html><html><head></head><body><deck-stage><section data-section="s1"></section><section id="bare"></section></deck-stage></body></html>';
  const fire = (b, sel) => b.doc.querySelector('deck-stage').dispatchEvent(new b.win.CustomEvent('slidechange', { bubbles: true, composed: true, detail: { slide: b.doc.querySelector(sel) } }));
  const r = bootBridge({ mode: 'run', html: DECK });
  r.doc.querySelector('deck-stage').addEventListener('slidechange', (e) => e.stopPropagation());
  fire(r, '#bare'); fire(r, '[data-section="s1"]');
  assert.deepEqual(r.of('visible').map((m) => m.id), ['s1']);
  assert.deepEqual(r.of('err'), []);
  const b = bootBridge({ html: DECK });
  fire(b, '[data-section="s1"]');
  assert.deepEqual(b.of('visible'), []);
});
test('scroll, goto and pick are quiet no-ops with nothing to act on', () => {
  const b = bootBridge({ mode: 'run', html: RUN });
  b.send('scroll', { id: 'hero', behavior: 'auto' });
  b.send('scroll', { id: 'nope', behavior: 'auto' });
  b.send('goto', { index: 0 });
  b.send('pick', { on: true });
  const ev = new b.win.MouseEvent('click', { bubbles: true, cancelable: true });
  b.doc.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  const d = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><deck-stage></deck-stage></body></html>' });
  d.send('goto', { index: 0 });
  assert.deepEqual([...b.of('err'), ...b.of('picked'), ...d.of('err')], []);
});
