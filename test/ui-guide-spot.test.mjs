// test/ui-guide-spot.test.mjs
// ui/public/guide-spot.mjs — the spotlight guide in jsdom: attach + elevation,
// the balloon's copy, every exit (target click, Esc, Skip, vanished target,
// never-found target) and a clean teardown.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createGuideSpot } from '../ui/public/guide-spot.mjs';
import { checkRows } from './helpers/rows.mjs';

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

test('Skip and Esc dismiss exactly once; Next (only with onNext) advances without dismissing', async () => {
  await checkRows([
    { name: 'Skip and Esc each dismiss exactly once; a second exit is a no-op', run: async () => {
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
    } },
    { name: 'Next: present only with onNext, calls it without dismissing; the elevation forces position only on a static control', run: async () => {
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
    } },
  ]);
});

test('target resolution: the first fallback selector that shows wins; hidden counts as absent; never-shows gives up quietly; vanishing mid-guide dismisses', async () => {
  await checkRows([
    { name: 'a target that never shows up gives up quietly (onDismiss, nothing spotlighted)', run: async () => {
      const { window, doc } = page();
      let dismissed = 0;
      createGuideSpot({ doc, win: window, target: '#nope', text: 't', tries: 3, onDismiss: () => dismissed++, onTargetClick() {} });
      await frames(window, 6);
      assert.equal(dismissed, 1);
      assert.equal(doc.querySelector('.guide-layer'), null);
    } },
    { name: 'a hidden target counts as absent until it shows; a target that vanishes mid-guide dismisses', run: async () => {
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
    } },
    { name: 'fallback targets: the first selector that shows wins, with its own text', run: async () => {
      const { window, doc } = page();
      const spot = createGuideSpot({
        doc, win: window, target: ['#missing', '#go'], text: ['first', 'second'], onDismiss() {}, onTargetClick() {},
      });
      await frames(window);
      assert.equal(doc.getElementById('go').classList.contains('guide-target'), true);
      assert.equal(doc.querySelector('.guide-text').textContent, 'second');
      assert.equal(spot.layer.dataset.target, '#go');
      spot.destroy();
    } },
    { name: 'a target whose state class flips off in place (it stays in the page) is re-acquired: the ring moves to the selector that matches now', run: async () => {
      const { window, doc } = page();
      const other = doc.getElementById('other');
      other.classList.add('is-on');
      const spot = createGuideSpot({
        doc, win: window, target: ['#go.is-ready', '#other.is-on'], text: ['ready', 'on'], onDismiss() {}, onTargetClick() {},
      });
      await frames(window);
      assert.equal(spot.layer.dataset.target, '#other.is-on', 'precondition: the fallback');
      doc.getElementById('go').classList.add('is-ready');
      other.classList.remove('is-on');
      await frames(window, 4);
      assert.equal(spot.layer.dataset.target, '#go.is-ready');
      assert.equal(doc.querySelector('.guide-text').textContent, 'ready');
      assert.equal(other.classList.contains('guide-target'), false, 'the ring left the control that no longer matches');
      spot.destroy();
    } },
  ]);
});
