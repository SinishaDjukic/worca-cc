// test/ui-composer-pointer-capture.test.mjs — MAJ-28.
// The composer's POINTER-CAPTURE contract, which until now lived only in
// tools/verify-composer-cdp.mjs check(4) — a script no automation runs.
// Two production sites are covered: composer.mjs `stage.setPointerCapture`
// (onDown) and `stage.releasePointerCapture` (finish).
//
// WHAT jsdom CAN AND CANNOT DO
// jsdom implements NONE of the three capture methods (they are `undefined` on
// every Element — verified: `typeof el.setPointerCapture === 'undefined'`), so
// at HEAD those lines never execute under test at all: `?.()` short-
// circuits and the whole contract is invisible to the suite. This file stubs
// the three methods onto the exact elements the composer touches and keeps a
// LEDGER of who holds which pointerId.
//
// jsdom also has no capture RETARGETING — the behaviour that actually produced
// the shipped dead-header-buttons regression (a stuck capture swallows the next
// press). The ledger models it explicitly in the test's own event helpers:
// while an element holds pointerId N, a pointer event for N is dispatched to
// THAT element, and a `click` is dispatched on the nearest common ancestor of
// the effective pointerdown/pointerup targets (what a browser does). So the
// last test's two rows pin the set/release PAIRING and its consequence under a
// faithful model — the real retargeting stays proven by the CDP script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { open } from './helpers/composer-shell.mjs';

// ---- the capture ledger -----------------------------------------------------
/** One ledger per test: `held` is pointerId -> capturing element (the browser's
 *  own book-keeping), `calls` is every set/release the composer made. */
function ledger() {
  return { held: new Map(), calls: [] };
}
/** Give ONE element the three capture methods, backed by the shared ledger.
 *  `releasePointerCapture` records the call whether or not it was legal — a
 *  release aimed at the wrong element must be visible, not silently dropped. */
function stub(L, el, name) {
  el.setPointerCapture = (id) => { L.calls.push({ op: 'set', on: name, id }); L.held.set(id, el); };
  el.hasPointerCapture = (id) => L.held.get(id) === el;
  el.releasePointerCapture = (id) => {
    L.calls.push({ op: 'release', on: name, id, held: L.held.get(id) === el });
    if (L.held.get(id) === el) L.held.delete(id);
  };
  return el;
}
const ops = (L) => L.calls.map((c) => `${c.op}:${c.on}#${c.id}`);

/** The browser's retarget rule: while pointerId N is captured, every pointer
 *  event for N goes to the capturing element, whatever is under the cursor. */
const route = (L, id, el) => L.held.get(id) || el;
function commonAncestor(a, b) {
  const up = new Set();
  for (let n = a; n; n = n.parentNode) up.add(n);
  for (let n = b; n; n = n.parentNode) if (up.has(n)) return n;
  return a.ownerDocument;
}

const pev = (s, type, o) => new s.win.PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, ...o });
const down = (s, L, x, y, o = {}) => route(L, o.pointerId ?? 1, s.c.view.stage)
  .dispatchEvent(pev(s, 'pointerdown', { button: 0, clientX: x, clientY: y, ...o }));
const move = (s, L, x, y, o = {}) => route(L, o.pointerId ?? 1, s.c.view.stage)
  .dispatchEvent(pev(s, 'pointermove', { clientX: x, clientY: y, ...o }));
const up = (s, L, x, y, o = {}) => route(L, o.pointerId ?? 1, s.c.view.stage)
  .dispatchEvent(pev(s, 'pointerup', { button: 0, clientX: x, clientY: y, ...o }));

/** A REAL button press: pointerdown, pointerup, then `click` on the nearest
 *  common ancestor of the two effective targets — so a stuck capture eats the
 *  click exactly as it does in Chrome. */
function clickEl(s, L, el, { pointerId = 1, clientX = 0, clientY = 0 } = {}) {
  const dt = route(L, pointerId, el);
  dt.dispatchEvent(pev(s, 'pointerdown', { pointerId, button: 0, clientX, clientY }));
  const ut = route(L, pointerId, el);
  ut.dispatchEvent(pev(s, 'pointerup', { pointerId, button: 0, clientX, clientY }));
  commonAncestor(dt, ut).dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// ---- (a) the stage: set on down, release on up / cancel ---------------------

test('the stage captures the pointerdown id and releases the SAME id on pointerup', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const L = ledger();
  stub(L, s.c.view.stage, 'stage');
  down(s, L, 620, 193, { pointerId: 7 });                 // n_agent.plan output anchor
  assert.equal(s.c.gesture().type, 'wire');
  assert.deepEqual(ops(L), ['set:stage#7'], 'onDown captures on the STAGE with the event id');
  assert.equal(s.c.view.stage.hasPointerCapture(7), true);
  move(s, L, 300, 400, { pointerId: 7 }); s.flush();
  assert.deepEqual(ops(L), ['set:stage#7'], 'a move captures nothing further');
  up(s, L, 300, 400, { pointerId: 7 }); s.flush();
  assert.deepEqual(ops(L), ['set:stage#7', 'release:stage#7'], 'finish() releases the same id on the same element');
  assert.equal(L.calls[1].held, true, 'the release was legal (the stage really held it)');
  assert.equal(L.held.size, 0, 'no capture outlives the gesture');
  assert.equal(s.c.gesture(), null);
});

test('pointercancel, lostpointercapture, Escape and window blur each release the capture', async () => {
  for (const endIt of [
    (s, L) => s.c.view.stage.dispatchEvent(pev(s, 'pointercancel', { pointerId: 2 })),
    (s, L) => s.c.view.stage.dispatchEvent(pev(s, 'lostpointercapture', { pointerId: 2 })),
    (s) => s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
    (s) => s.win.dispatchEvent(new s.win.Event('blur')),
  ]) {
    const s = await open();
    s.c.view.setTransform({ x: 0, y: 0, z: 1 });
    const L = ledger();
    stub(L, s.c.view.stage, 'stage');
    down(s, L, 400, 80, { pointerId: 2 });                // the n_agent card => a node drag
    assert.equal(s.c.gesture().type, 'node');
    assert.equal(L.held.get(2), s.c.view.stage);
    endIt(s, L);
    assert.equal(s.c.gesture(), null, 'the gesture ended');
    assert.deepEqual(ops(L), ['set:stage#2', 'release:stage#2'], 'and the capture went with it');
    assert.equal(L.held.size, 0);
  }
});

test('a foreign pointerup never releases the live gesture\'s capture', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const L = ledger();
  stub(L, s.c.view.stage, 'stage');
  down(s, L, 400, 80, { pointerId: 5 });
  // A second finger's up: onUp bails on the id mismatch, so the capture stands.
  s.c.view.stage.dispatchEvent(pev(s, 'pointerup', { pointerId: 6, button: 0, clientX: 400, clientY: 80 }));
  assert.equal(s.c.gesture().type, 'node', 'the gesture survives a foreign id');
  assert.deepEqual(ops(L), ['set:stage#5'], 'and so does its capture');
  up(s, L, 400, 80, { pointerId: 5 }); s.flush();
  assert.deepEqual(ops(L), ['set:stage#5', 'release:stage#5']);
});

// ---- (c)/(d) the consequence: header buttons ---------------------------------

test('after a canvas drag no capture remains: a header click reaches its handler, a press released over a header never fires it', async () => {
  await checkRows([
    { name: 'after a canvas drag the stage holds NO capture and a header click reaches its handler', run: async () => {
      const s = await open();
      s.c.view.setTransform({ x: 0, y: 0, z: 1 });
      const L = ledger();
      stub(L, s.c.view.stage, 'stage');
      let clicks = 0;
      s.el.autolayout.addEventListener('click', () => { clicks += 1; });
      const before = s.c.template().nodes.map((n) => `${n.x},${n.y}`).join('|');

      down(s, L, 120, 500); move(s, L, 180, 470); s.flush(); up(s, L, 180, 470); s.flush();
      assert.equal(s.c.gesture(), null);
      assert.equal(L.held.size, 0, 'the drag released its capture — the retarget window is closed');

      clickEl(s, L, s.el.autolayout, { pointerId: 1, clientX: 900, clientY: 12 });
      assert.equal(clicks, 1, 'the header button received a real click after the drag');
      assert.notEqual(s.c.template().nodes.map((n) => `${n.x},${n.y}`).join('|'), before,
        'and its handler ran: auto-layout moved the cards');
    } },
    { name: 'a press on the canvas released over a header button never fires that button', run: async () => {
      const s = await open();
      s.c.view.setTransform({ x: 0, y: 0, z: 1 });
      const L = ledger();
      stub(L, s.c.view.stage, 'stage');
      let clicks = 0;
      s.el.autolayout.addEventListener('click', () => { clicks += 1; });

      down(s, L, 120, 500);                                  // press on empty canvas
      assert.equal(s.c.gesture().type, 'pan');
      // release OVER the button: the capture retargets the pointerup to the stage,
      // so the gesture closes and the button sees no down/up pair at all.
      const t = route(L, 1, s.el.autolayout);
      assert.equal(t, s.c.view.stage, 'the captured pointer is retargeted to the stage');
      t.dispatchEvent(pev(s, 'pointerup', { pointerId: 1, button: 0, clientX: 900, clientY: 12 }));
      s.flush();
      assert.equal(clicks, 0, 'the cross-release fired no button action');
      assert.equal(s.c.gesture(), null, 'and the gesture still ended');
      assert.equal(L.held.size, 0, 'the capture was released on the way out');
    } },
  ]);
});
