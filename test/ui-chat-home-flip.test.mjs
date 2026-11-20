// test/ui-chat-home-flip.test.mjs — worca Chat P6: the composer's glide between the home's hero slot and the thread
// dock. P1 re-parents the composer; this records the box's rect before the switch and plays a 460 ms spring after
// chat-page[data-view] flips. Reduced motion, an unarmed change and a stale arm never animate.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createHeroFlip, prefersReducedMotion, FLIP_MS, FLIP_EASE, ARM_TTL_MS, PART_DELAYS } from '../ui/public/chat/home-flip.mjs';

const trackDom = useDomRelease(afterEach);

function setup({ reduce = false, view = 'home', animate = true } = {}) {
  const dom = trackDom(new JSDOM(`<!doctype html><body><div class="chat-page" data-chat-page data-view="${view}">
    <header class="chat-head"><button type="button" data-ask-new-btn>+</button></header>
    <div class="chat-home" data-chat-home><h1 class="t">What should worca do?</h1><div class="chat-home-actions"></div>
      <div class="chat-hero-slot" data-chat-hero-slot><div class="ask-composer"><div class="ask-composer-box"></div></div></div></div>
    <div class="ask-transcript"></div><div class="chat-dock" data-chat-dock></div></div></body>`));
  const { window } = dom;
  const doc = window.document;
  window.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const calls = [];
  if (animate) {
    window.HTMLElement.prototype.animate = function (keyframes, opts) { calls.push({ el: this, keyframes, opts }); return { cancel() {}, finished: Promise.resolve() }; };
  }
  const box = doc.querySelector('.ask-composer-box');
  let rect = { left: 100, top: 300, width: 720, height: 56 };
  box.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top });
  let t = 1000;
  const page = doc.querySelector('[data-chat-page]');
  const parts = [doc.querySelector('h1.t'), doc.querySelector('.chat-home-actions')];
  const flip = createHeroFlip({ doc, win: window, page, parts: () => parts, now: () => t });
  return { window, doc, page, box, calls, flip, parts, setRect: (r) => { rect = r; }, setNow: (n) => { t = n; } };
}
const tick = (window) => new Promise((r) => window.setTimeout(r, 0));

test('hero → dock: a send armed on the home glides the composer box from its hero rect to its dock rect (460 ms spring)', async () => {
  const s = setup();
  assert.equal(s.flip.arm(), true);
  assert.deepEqual(s.flip.armed().rect, { left: 100, top: 300, width: 720, height: 56 });
  s.setRect({ left: 60, top: 820, width: 760, height: 52 });     // P1 re-parented it into the dock
  s.page.dataset.view = 'thread';
  await tick(s.window);
  const glide = s.calls.find((c) => c.el === s.box);
  assert.ok(glide, 'the composer box animated');
  assert.equal(glide.opts.duration, FLIP_MS);
  assert.equal(FLIP_MS, 460);
  assert.equal(glide.opts.easing, FLIP_EASE);
  assert.equal(FLIP_EASE, 'cubic-bezier(.22,1,.36,1)');
  assert.deepEqual(glide.keyframes[0], { transform: 'translate(40px, -520px)', width: '720px', height: '56px' });
  assert.deepEqual(glide.keyframes[1], { transform: 'translate(0px, 0px)', width: '760px', height: '52px' });
  const fade = s.calls.find((c) => c.el.classList.contains('ask-transcript'));
  assert.ok(fade, 'the thread fades in');
  assert.deepEqual(fade.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(s.flip.armed(), null, 'an arm is spent by the change it animated');
});

test('dock → hero: a click on New chat arms the reverse glide and the hero parts rise in, staggered', async () => {
  const s = setup({ view: 'thread' });
  s.setRect({ left: 60, top: 820, width: 760, height: 52 });
  s.doc.querySelector('[data-ask-new-btn]').dispatchEvent(new s.window.MouseEvent('click', { bubbles: true }));
  assert.ok(s.flip.armed(), 'the capture listener armed before P1 swapped the view');
  s.setRect({ left: 100, top: 300, width: 720, height: 56 });
  s.page.dataset.view = 'home';
  await tick(s.window);
  const glide = s.calls.find((c) => c.el === s.box);
  assert.deepEqual(glide.keyframes[0].transform, 'translate(-40px, 520px)');
  const rises = s.calls.filter((c) => s.parts.includes(c.el));
  assert.deepEqual(rises.map((c) => c.opts.delay), [PART_DELAYS[0], PART_DELAYS[1]]);
  assert.deepEqual([...PART_DELAYS], [30, 150, 210, 260]);
  assert.equal(rises[0].opts.fill, 'backwards');
});

test('prefers-reduced-motion: nothing is armed and nothing animates', async () => {
  const s = setup({ reduce: true });
  assert.equal(prefersReducedMotion(s.window), true);
  assert.equal(s.flip.arm(), false);
  s.page.dataset.view = 'thread';
  await tick(s.window);
  s.doc.querySelector('[data-ask-new-btn]').click();
  assert.equal(s.flip.armed(), null);
  s.page.dataset.view = 'home';
  await tick(s.window);
  assert.equal(s.calls.length, 0);
});

test('an unarmed or stale arm never animates; New chat on the home arms nothing', async () => {
  const s = setup();
  s.page.dataset.view = 'thread';
  await tick(s.window);
  assert.equal(s.calls.length, 0, 'a view change nobody armed (a History pick) is instant');
  s.page.dataset.view = 'home';
  await tick(s.window);
  s.doc.querySelector('[data-ask-new-btn]').click();
  assert.equal(s.flip.armed(), null, 'New chat on the home changes nothing');
  s.flip.arm();
  s.setNow(1000 + ARM_TTL_MS + 1);
  s.page.dataset.view = 'thread';
  await tick(s.window);
  assert.equal(s.calls.length, 0, 'a send that failed long ago does not animate a later change');
});

test('an arm lives ARM_TTL_MS: inside it the change animates; disarm() drops it', async () => {
  const s = setup();
  assert.equal(ARM_TTL_MS, 2000);
  s.flip.arm();
  s.setNow(1000 + ARM_TTL_MS - 1);
  s.setRect({ left: 60, top: 820, width: 760, height: 52 });
  s.page.dataset.view = 'thread';
  await tick(s.window);
  assert.ok(s.calls.some((c) => c.el === s.box), 'inside the TTL: the glide plays');
  const d = setup();
  assert.equal(d.flip.arm(), true);
  d.flip.disarm();
  assert.equal(d.flip.armed(), null);
  d.page.dataset.view = 'thread';
  await tick(d.window);
  assert.equal(d.calls.length, 0, 'a disarmed send never animates');
});

test('no Web Animations, no box, or after destroy: a quiet no-op', async () => {
  const s = setup({ animate: false });
  delete s.window.HTMLElement.prototype.animate;
  s.flip.arm();
  s.page.dataset.view = 'thread';
  await tick(s.window);
  const d = setup();
  d.flip.destroy();
  d.flip.arm();
  d.page.dataset.view = 'thread';
  await tick(d.window);
  assert.equal(d.calls.length, 0);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion(null), false);
});

test('reduced motion switched on after the arm: the change is instant', async () => {
  const s = setup();
  assert.equal(s.flip.arm(), true);
  s.window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  s.setRect({ left: 60, top: 820, width: 760, height: 52 });
  s.page.dataset.view = 'thread';
  await tick(s.window);
  assert.equal(s.calls.length, 0);
});

test('a click after a send that never switched the view drops the arm: what the user opens next does not glide', async () => {
  const s = setup();
  assert.equal(s.flip.arm(), true);                                 // a home send the server refused: no view change
  s.doc.querySelector('.chat-home-actions').dispatchEvent(new s.window.MouseEvent('click', { bubbles: true }));
  assert.equal(s.flip.armed(), null, 'any click in the page but New chat drops it');
  s.page.dataset.view = 'thread';                                   // a Recent chat / History pick loads another chat
  await tick(s.window);
  assert.equal(s.calls.length, 0);
});

test('an arm recorded after the view already changed (its observer not run yet) never plays', async () => {
  const s = setup();
  s.page.dataset.view = 'thread';                                   // P1 switched; the observer runs on the next microtask
  assert.equal(s.flip.arm(), true);                                 // armed in the same tick, from the new view
  await tick(s.window);
  assert.equal(s.calls.length, 0, 'the arm belongs to "thread", not to the home → thread change');
});

test('Ask worca beside the page: arm refuses while the chat page is in the side column (no hero there)', async () => {
  const s = setup({ view: 'thread' });
  s.page.dataset.host = 'dock';
  assert.equal(s.flip.arm(), false);
  assert.equal(s.flip.armed(), null);
  s.doc.querySelector('[data-ask-new-btn]').click();              // the capture-phase New chat arm refuses too
  s.page.dataset.view = 'home';
  await tick(s.window);
  assert.equal(s.calls.length, 0, 'nothing glides in the column');
  s.page.dataset.host = 'page';
  assert.equal(s.flip.arm(), true, 'the Chat page glides as before');
});
