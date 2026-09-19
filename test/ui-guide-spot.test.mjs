// test/ui-guide-spot.test.mjs
// ui/public/guide-spot.mjs — the spotlight guide in jsdom: attach + elevation,
// the balloon's copy, every exit (target click, scrim, Esc, Skip, vanished
// target, never-found target) and a clean teardown.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createGuideSpot } from '../ui/public/guide-spot.mjs';

const open = [];
after(() => { for (const w of open) { try { w.close(); } catch { /* closed */ } } });

function page() {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="ask-dock"><button id="pill" class="ask-pill">Ask</button></div>
    <main><button id="go" style="border-radius:999px">Start run</button><button id="other">Other</button></main>
  </body>`, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  // jsdom lays nothing out: give the controls a box so `visible()` sees them.
  const box = (el, r) => { el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }); };
  box(doc.getElementById('go'), { left: 300, top: 400, width: 120, height: 44 });
  box(doc.getElementById('pill'), { left: 500, top: 700, width: 90, height: 40 });
  box(doc.getElementById('other'), { left: 0, top: 0, width: 50, height: 20 });
  window.innerWidth = 1200; window.innerHeight = 800;
  open.push(window);
  return { window, doc };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const frames = (window, n = 3) => new Promise((r) => { const step = (k) => (k ? window.requestAnimationFrame(() => step(k - 1)) : r()); step(n); });

test('attaches to the target: layer with scrim + ring + balloon, target elevated, copy and Skip present', async () => {
  const { window, doc } = page();
  const spot = createGuideSpot({ doc, win: window, target: '#go', text: 'Start it here.', onDismiss() {}, onTargetClick() {} });
  await frames(window);
  const layer = doc.body.querySelector('.guide-layer.spotlight');
  assert.ok(layer && layer === spot.layer);
  assert.ok(layer.querySelector('.guide-scrim'), 'spotlight mode dims the page');
  const go = doc.getElementById('go');
  assert.ok(go.classList.contains('guide-target'), 'the real control is elevated above the scrim');
  assert.equal(doc.getElementById('other').classList.contains('guide-target'), false, 'only the one');
  const ring = layer.querySelector('.guide-ring');
  assert.equal(ring.hidden, false);
  assert.equal(ring.style.left, '294px', '6px outside the control');
  assert.equal(ring.style.top, '394px');
  assert.equal(ring.style.width, '132px');
  assert.equal(ring.style.height, '56px');
  const balloon = layer.querySelector('.guide-balloon');
  assert.equal(balloon.hidden, false);
  assert.equal(balloon.querySelector('.guide-text').textContent, 'Start it here.');
  assert.equal(balloon.querySelector('button.guide-skip').textContent, 'Skip');
  assert.equal(balloon.classList.contains('above'), false, 'room below: the balloon hangs under the control');
  assert.equal(balloon.style.top, `${444 + 14}px`);
  spot.destroy();
  assert.equal(doc.body.querySelector('.guide-layer'), null, 'destroy removes the layer');
  assert.equal(go.classList.contains('guide-target'), false, 'and the elevation');
});

test('the balloon flips above a control near the floor', async () => {
  const { window, doc } = page();
  const spot = createGuideSpot({ doc, win: window, target: '#pill', lift: ['.ask-dock'], text: 'Ask.', onDismiss() {}, onTargetClick() {} });
  await frames(window);
  const balloon = doc.querySelector('.guide-balloon');
  // jsdom reports a 0×0 balloon; the flip rule still fires on the control's own floor distance.
  assert.equal(balloon.classList.contains('above'), 700 + 40 + 14 > 800 - 8);
  assert.ok(doc.querySelector('.ask-dock').classList.contains('guide-lift'), 'the dock (its own stacking context) is lifted with the pill');
  spot.destroy();
  assert.equal(doc.querySelector('.ask-dock').classList.contains('guide-lift'), false);
});

test('a target taller than the window pins the balloon inside the viewport (no arrow) instead of parking it off-screen', async () => {
  const { window, doc } = page();
  const go = doc.getElementById('go');
  go.getBoundingClientRect = () => ({ left: 300, top: -400, width: 600, height: 2000, right: 900, bottom: 1600 });
  const spot = createGuideSpot({ doc, win: window, target: '#go', text: 'Your run.', onDismiss() {}, onTargetClick() {} });
  await frames(window);
  const balloon = doc.querySelector('.guide-balloon');
  assert.ok(balloon.classList.contains('pinned'), 'pinned: no room above or below');
  assert.equal(balloon.classList.contains('above'), false);
  const top = parseFloat(balloon.style.top);
  assert.ok(top >= 16 && top <= 800 - 16, `inside the viewport: ${balloon.style.top}`);
  spot.destroy();
});

test('the target\'s real click hands over (after the control\'s own handler) and dismisses nothing by itself', async () => {
  const { window, doc } = page();
  const order = [];
  doc.getElementById('go').addEventListener('click', () => order.push('app'));
  let dismissed = 0;
  const spot = createGuideSpot({ doc, win: window, target: '#go', text: 't', onDismiss: () => dismissed++, onTargetClick: () => order.push('guide') });
  await frames(window);
  click(window, doc.getElementById('go'));
  assert.deepEqual(order, ['app', 'guide'], 'the app\'s handler runs first, then the guide re-reads the page');
  assert.equal(dismissed, 0);
  spot.destroy();
});

test('a scrim click never dismisses: it nudges (ring + balloon pulse once) and the guide stays', async () => {
  const { window, doc } = page();
  let dismissed = 0;
  const spot = createGuideSpot({ doc, win: window, target: '#go', text: 't', onDismiss: () => dismissed++, onTargetClick() {} });
  await frames(window);
  click(window, doc.querySelector('.guide-scrim'));
  assert.equal(dismissed, 0, 'a stray click is not an exit');
  assert.ok(doc.querySelector('.guide-layer'), 'the guide is still up');
  const ring = doc.querySelector('.guide-ring'); const balloon = doc.querySelector('.guide-balloon');
  assert.ok(ring.classList.contains('nudge') && balloon.classList.contains('nudge'), 'both pulse');
  ring.dispatchEvent(new window.Event('animationend'));
  assert.equal(ring.classList.contains('nudge'), false, 'the pulse class clears itself, ready for the next nudge');
  assert.ok(doc.getElementById('go').classList.contains('guide-target'), 'the control stays lit');
  spot.destroy();
});

test('Skip and Esc each dismiss exactly once; a second exit is a no-op', async () => {
  for (const exit of ['skip', 'esc']) {
    const { window, doc } = page();
    let dismissed = 0;
    createGuideSpot({ doc, win: window, target: '#go', text: 't', onDismiss: () => dismissed++, onTargetClick() {} });
    await frames(window);
    if (exit === 'skip') click(window, doc.querySelector('.guide-skip'));
    if (exit === 'esc') doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(dismissed, 1, exit);
    assert.equal(doc.querySelector('.guide-layer'), null, `${exit}: layer gone`);
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(dismissed, 1, `${exit}: Esc after teardown is inert`);
  }
});

test('a target that never shows up gives up quietly (onDismiss, nothing spotlighted)', async () => {
  const { window, doc } = page();
  let dismissed = 0;
  createGuideSpot({ doc, win: window, target: '#nope', text: 't', tries: 3, onDismiss: () => dismissed++, onTargetClick() {} });
  await frames(window, 6);
  assert.equal(dismissed, 1);
  assert.equal(doc.querySelector('.guide-layer'), null);
});

test('a hidden target counts as absent until it shows; a target that vanishes mid-guide dismisses', async () => {
  const { window, doc } = page();
  const go = doc.getElementById('go');
  go.hidden = true;
  let dismissed = 0;
  createGuideSpot({ doc, win: window, target: '#go', text: 't', tries: 5, onDismiss: () => dismissed++, onTargetClick() {} });
  await frames(window, 2);
  assert.equal(go.classList.contains('guide-target'), false, 'waiting');
  go.hidden = false;
  await frames(window, 3);
  assert.equal(go.classList.contains('guide-target'), true, 'attached once visible');
  // A repainted list: the control is replaced by an equivalent one a frame later.
  const twin = go.cloneNode(true);
  twin.getBoundingClientRect = go.getBoundingClientRect;
  go.replaceWith(twin);
  await frames(window, 4);
  assert.equal(dismissed, 0, 'a replacement matching the selector is re-acquired');
  assert.equal(twin.classList.contains('guide-target'), true, 'the ring moved to the replacement');
  assert.equal(go.classList.contains('guide-target'), false, 'and left the old node');
  twin.remove();
  await frames(window, 10);
  assert.equal(dismissed, 1, 'a control that stays gone ends the guide');
  assert.equal(doc.querySelector('.guide-layer'), null);
});

test('fallback targets: the first selector that shows wins, with its own text', async () => {
  const { window, doc } = page();
  const spot = createGuideSpot({
    doc, win: window, target: ['#missing', '#go'], text: ['first', 'second'], onDismiss() {}, onTargetClick() {},
  });
  await frames(window);
  assert.equal(doc.getElementById('go').classList.contains('guide-target'), true);
  assert.equal(doc.querySelector('.guide-text').textContent, 'second');
  assert.equal(spot.layer.dataset.target, '#go');
  spot.destroy();
});

test('pointer mode: no scrim, no elevation class needed to cross a dialog', async () => {
  const { window, doc } = page();
  const spot = createGuideSpot({ doc, win: window, target: '#go', text: 't', mode: 'pointer', onDismiss() {}, onTargetClick() {} });
  await frames(window);
  const layer = doc.querySelector('.guide-layer.pointer');
  assert.ok(layer);
  assert.equal(layer.querySelector('.guide-scrim'), null);
  assert.ok(layer.querySelector('.guide-ring'));
  spot.destroy();
});

test('Next: present only with onNext, calls it without dismissing; the elevation forces position only on a static control', async () => {
  const { window, doc } = page();
  let nexts = 0; let dismissed = 0;
  const spot = createGuideSpot({ doc, win: window, target: '#go', text: 't', nextLabel: 'Got it', onNext: () => nexts++, onDismiss: () => dismissed++, onTargetClick() {} });
  await frames(window);
  const next = doc.querySelector('.guide-balloon .guide-actions .guide-next');
  assert.ok(next, 'a Next button beside Skip');
  assert.equal(next.textContent, 'Got it');
  assert.ok(doc.querySelector('.guide-balloon .guide-actions .guide-skip'), 'Skip still there');
  click(window, next);
  assert.equal(nexts, 1);
  assert.equal(dismissed, 0, 'Next is the caller\'s: nothing is dismissed here');
  assert.ok(doc.querySelector('.guide-layer'), 'the layer stays until the caller replaces it');
  // jsdom computes no position for #go: it counts as static and gets the relative box.
  const go = doc.getElementById('go');
  assert.ok(go.classList.contains('guide-target-static'), 'a static control is positioned for the elevation');
  spot.destroy();
  assert.equal(go.classList.contains('guide-target-static'), false, 'and released');

  const plain = createGuideSpot({ doc, win: window, target: '#go', text: 't', onDismiss() {}, onTargetClick() {} });
  await frames(window);
  assert.equal(doc.querySelector('.guide-next'), null, 'no Next without onNext');
  plain.destroy();

  const pill = doc.getElementById('pill');
  pill.style.position = 'absolute';
  const abs = createGuideSpot({ doc, win: window, target: '#pill', lift: ['.ask-dock'], text: 't', onDismiss() {}, onTargetClick() {} });
  await frames(window);
  assert.ok(pill.classList.contains('guide-target'));
  assert.equal(pill.classList.contains('guide-target-static'), false, 'an absolutely positioned control keeps its own position');
  abs.destroy();
});
