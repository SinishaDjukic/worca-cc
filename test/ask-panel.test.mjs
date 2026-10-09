// test/ask-panel.test.mjs — shell, keyboard, pointerdown routing and the
// popover primitive (spec §10.4, §10.6). No app boot; see the harness header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { makePanel, key, pointerdown, pointer, sizeDock } from './helpers/ask-panel-harness.mjs';
import { ASK_SHEET_SIZE } from '../ui/public/ask-panel.mjs';

const THREADS = {
  threads: [
    { id: 'ask_00000001', title: 'Fix the login bug', updatedAt: 't2', createdAt: 't1', model: 'claude-opus-5-5', effort: 'high', sessionId: null, context: null, totals: { costUsd: 0.21, input: 9200, output: 9200, cacheRead: 0, cacheCreation: 0, ctx: 68400, turns: 3, agents: 3 }, runLinks: 0, inFlight: true, tracking: false },
    { id: 'ask_00000002', title: 'Explain run 4e1f', updatedAt: 't1', createdAt: 't0', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, tracking: false },
  ],
};

const threadsHandler = (url) => (url.startsWith('/api/ask/threads')
  ? { ok: true, status: 200, json: async () => THREADS }
  : { ok: true, status: 200, json: async () => ({}) });

test('ask-panel: shell — root structure, pill open-close with focus restore, ⌘K/Ctrl+K left to the search, the ownsKey truth table', async () => {
  await checkRows([
    { name: 'ask-panel: root structure — dock, pill, hidden sheet, dialog semantics, no data-view/data-nav', run: async () => {
      const { panel, doc } = makePanel();
      const dock = panel.root;
      assert.ok(dock.classList.contains('ask-dock'));
      const pill = dock.querySelector('.ask-pill');
      const sheet = dock.querySelector('.ask-sheet');
      assert.ok(pill && sheet);
      assert.equal(sheet.hidden, true);
      assert.equal(pill.hidden, false);
      assert.equal(sheet.getAttribute('role'), 'dialog');
      assert.equal(sheet.getAttribute('aria-label'), 'Ask Worca');
      // documentary fence — cannot fail unless the builder grows the feature
      assert.equal(sheet.getAttribute('aria-modal'), null, 'no aria-modal (spec §10.4)');
      assert.ok(sheet.hasAttribute('data-ask-sheet'));
      assert.equal(dock.querySelector('[data-view],[data-nav]'), null);
      assert.ok(dock.querySelector('.sr-only[aria-live="polite"]'), 'the announcement line exists');
      assert.equal(panel.isOpen(), false);
    } },
    { name: 'ask-panel: pill click opens; the composer textarea gets focus; close restores it', run: async () => {
      const { panel, doc } = makePanel();
      const outside = doc.createElement('button');
      doc.body.appendChild(outside);
      outside.focus();
      panel.root.querySelector('.ask-pill').click();
      assert.equal(panel.isOpen(), true);
      assert.equal(panel.root.querySelector('.ask-sheet').hidden, false);
      assert.equal(panel.root.querySelector('.ask-pill').hidden, true);
      assert.equal(doc.activeElement, panel.root.querySelector('textarea.ask-input'));
      panel.close();
      assert.equal(panel.isOpen(), false);
      assert.equal(doc.activeElement, outside, 'previous focus restored when still connected');
    } },
    { name: 'ask-panel: ⌘K and Ctrl+K neither open nor close the sheet, nor claim the key (the top bar search owns them)', run: async () => {
      const { panel, window } = makePanel();
      const e1 = key(window, null, 'k', { metaKey: true });
      assert.equal(e1.defaultPrevented, false);
      assert.equal(panel.isOpen(), false);
      const e2 = key(window, null, 'k', { ctrlKey: true });
      assert.equal(e2.defaultPrevented, false);
      assert.equal(panel.isOpen(), false);
      panel.open();
      const e3 = key(window, null, 'k', { metaKey: true });
      assert.equal(e3.defaultPrevented, false);
      assert.equal(panel.isOpen(), true, 'an open sheet stays open');
    } },
    { name: 'ask-panel: ownsKey truth table', run: async () => {
      const { panel, window, doc } = makePanel();
      const mk = (target) => new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      // closed → never owns
      assert.equal(panel.ownsKey(Object.assign(mk(), {})), false);
      panel.open();
      const input = panel.root.querySelector('textarea.ask-input');
      input.focus();
      // focus inside → owns even though the event target is the document
      const eDoc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      Object.defineProperty(eDoc, 'target', { value: doc.body });
      assert.equal(panel.ownsKey(eDoc), true);
      // target inside → owns
      const eIn = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      Object.defineProperty(eIn, 'target', { value: input });
      assert.equal(panel.ownsKey(eIn), true);
      // non-Escape never owned
      const eK = new window.KeyboardEvent('keydown', { key: 'k', bubbles: true });
      Object.defineProperty(eK, 'target', { value: input });
      assert.equal(panel.ownsKey(eK), false);
      // focus + target both outside → not owned
      const out = doc.createElement('button');
      doc.body.appendChild(out);
      out.focus();
      const eOut = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      Object.defineProperty(eOut, 'target', { value: out });
      assert.equal(panel.ownsKey(eOut), false);
    } },
  ]);
});

test('ask-panel: dismissal — Escape with no popover is an owned no-op, pointerdown outside closes (exempt overlays do not), click-away inside closes only the popover', async () => {
  await checkRows([
    { name: 'ask-panel: Escape with the sheet open and no popover is an owned no-op', run: async () => {
      const { panel, window } = makePanel();
      panel.open();
      panel.root.querySelector('textarea.ask-input').focus();
      key(window, panel.root.querySelector('textarea.ask-input'), 'Escape');
      assert.equal(panel.isOpen(), true, 'the sheet does not close on Escape (mockup rule)');
    } },
    { name: 'ask-panel: pointerdown outside closes; exempt overlays do not', run: async () => {
      const { panel, window, doc } = makePanel();
      for (const cls of ['viewer-modal', 'info-bubble', 'mention-popup']) {
        const n = doc.createElement('div');
        n.className = cls;
        doc.body.appendChild(n);
      }
      const confirmModal = doc.createElement('div');
      confirmModal.id = 'confirm-modal';
      doc.body.appendChild(confirmModal);
      panel.open();
      pointerdown(window, doc.querySelector('.viewer-modal'));
      pointerdown(window, doc.querySelector('.info-bubble'));
      pointerdown(window, doc.querySelector('.mention-popup'));
      pointerdown(window, confirmModal);
      assert.equal(panel.isOpen(), true, 'exempt overlays never close the sheet');
      pointerdown(window, panel.root.querySelector('.ask-sheet'));
      assert.equal(panel.isOpen(), true, 'inside the sheet stays open');
      pointerdown(window, doc.body);
      assert.equal(panel.isOpen(), false, 'outside closes');
    } },
    { name: 'ask-panel: a press in the top bar search (.tsearch) leaves the sheet open, so focus stays put and the pressed row gets its click', run: async () => {
      const { panel, window, doc } = makePanel();
      const search = doc.createElement('div');
      search.className = 'tsearch';
      const row = doc.createElement('div');
      row.setAttribute('role', 'option');
      search.appendChild(row);
      doc.body.appendChild(search);
      panel.open();
      pointerdown(window, row);
      assert.equal(panel.isOpen(), true);
      pointerdown(window, doc.body);
      assert.equal(panel.isOpen(), false, 'elsewhere still closes it');
    } },
    { name: 'ask-panel: click-away inside the sheet closes the popover, not the sheet; reopening is a toggle', run: async () => {
      const { panel, window, doc, tick } = makePanel({ fetchHandler: threadsHandler });
      panel.open();
      const trigger = doc.querySelector('[data-ask-threads-btn]');
      trigger.click();
      await tick();
      assert.ok(doc.querySelector('.ask-pop'));
      pointerdown(window, panel.root.querySelector('textarea.ask-input'));
      assert.equal(doc.querySelector('.ask-pop'), null);
      assert.equal(panel.isOpen(), true);
      trigger.click();
      await tick();
      assert.ok(doc.querySelector('.ask-pop'));
      trigger.click();
      assert.equal(doc.querySelector('.ask-pop'), null, 'the trigger toggles');
    } },
  ]);
});

test('ask-panel: popover menu keyboard — roving focus, wrap, Home/End, Enter, Escape to trigger', async () => {
  const { panel, window, doc, tick } = makePanel({ fetchHandler: threadsHandler });
  panel.open();
  const trigger = doc.querySelector('[data-ask-threads-btn]');
  trigger.click();
  await tick();
  const pop = doc.querySelector('.ask-pop');
  const items = [...pop.querySelectorAll('[role="menuitem"]')];
  assert.equal(doc.activeElement, items[0], 'first item focused on open');
  key(window, items[0], 'ArrowDown');
  assert.equal(doc.activeElement, items[1]);
  key(window, items[1], 'ArrowDown');
  assert.equal(doc.activeElement, items[0], 'wraps');
  key(window, items[0], 'ArrowUp');
  assert.equal(doc.activeElement, items[1], 'wraps up');
  key(window, items[1], 'Home');
  assert.equal(doc.activeElement, items[0]);
  key(window, items[0], 'End');
  assert.equal(doc.activeElement, items[1]);
  key(window, items[1], 'Escape');
  assert.equal(doc.querySelector('.ask-pop'), null, 'Escape closes the popover');
  assert.equal(doc.activeElement, trigger, 'focus returns to the trigger');
  assert.equal(panel.isOpen(), true, 'the sheet stays open');
});

test('ask-panel: destroy removes the root and unbinds the document listeners', () => {
  const { panel, doc } = makePanel();
  const removed = [];
  const off = doc.removeEventListener.bind(doc);
  doc.removeEventListener = (type, fn, opts) => { removed.push(`${type}:${opts === true}`); return off(type, fn, opts); };
  panel.destroy();
  assert.equal(doc.querySelector('.ask-dock'), null);
  assert.ok(removed.includes('keydown:true') && removed.includes('pointerdown:true'), 'no capture listener left behind');
});

// Review of PR #376: loadThread() had no request-generation guard, so whichever
// GET resolved LAST overwrote st.threadId/st.model — a slow old thread load
// flipped the panel back after the user had switched.
test('ask-panel: a slower, older thread load cannot overwrite a newer switch', async () => {
  const snap = (id, title) => ({ thread: { id, title, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null, worktrees: [] });
  let releaseA = null;
  const fetchHandler = (url) => {
    if (url.startsWith('/api/ask/threads/ask_00000001')) return new Promise((r) => { releaseA = () => r({ ok: true, status: 200, json: async () => snap('ask_00000001', 'Slow A') }); });
    if (url.startsWith('/api/ask/threads/ask_00000002')) return { ok: true, status: 200, json: async () => snap('ask_00000002', 'Fast B') };
    return threadsHandler(url);
  };
  const ctx = makePanel({ fetchHandler });
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelectorAll('.ask-pop [role="menuitem"]')[0].click();   // A: its GET hangs
  await ctx.tick();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelectorAll('.ask-pop [role="menuitem"]')[1].click();   // B: resolves at once
  await ctx.tick(); await ctx.tick();
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Fast B');
  releaseA();                                                          // A's late response
  await ctx.tick(); await ctx.tick();
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Fast B', 'the stale load lost');
  assert.equal(ctx.storage.getItem('worca:ask:thread') ?? [...ctx.storage._map.values()].find((v) => /^ask_/.test(v)), 'ask_00000002');
});

// Review of PR #376: sendMessage read st.model after its awaits with no re-check
// while "New chat" was never disabled — clicking it mid-POST set st.model = null
// and the send threw a TypeError as an unhandled rejection.
test('ask-panel: New chat clicked while a send is in flight neither throws nor touches the new composer', async () => {
  let releasePost = null;
  const fetchHandler = (url, opts) => {
    if (url === '/api/ask/threads' && opts.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ thread: { id: 'ask_00000009', title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    }
    if (url.startsWith('/api/ask/threads/ask_00000009/messages')) {
      return new Promise((r) => { releasePost = () => r({ ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009' }) }); });
    }
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = makePanel({ fetchHandler });
  const unhandled = [];
  const onRej = (e) => unhandled.push(e);
  process.on('unhandledRejection', onRej);
  try {
    ctx.panel.open();
    ctx.doc.querySelector('textarea.ask-input').value = 'hello';
    ctx.doc.querySelector('[data-ask-send]').click();
    for (let i = 0; i < 4; i++) await ctx.tick();                     // thread created, POST in flight
    assert.ok(releasePost, 'the message POST is in flight');
    [...ctx.panel.root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'New chat').click();
    ctx.doc.querySelector('textarea.ask-input').value = 'draft for the new chat';
    releasePost();
    for (let i = 0; i < 4; i++) await ctx.tick();
    ctx.flush();
    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled.length, 0, `no unhandled rejection: ${unhandled.map((e) => e && e.message).join(', ')}`);
    assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'draft for the new chat', 'the finished send did not clear the NEW composer');
    assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Ask Worca', 'still on the new chat');
  } finally {
    process.off('unhandledRejection', onRej);
  }
});

// ---- resize: drag the top / side edges; persisted in worca-cc.ask.size ----
const SIZE_KEY = 'worca-cc.ask.size';

/** pointerdown on a grip, one move, and a thunk that ends the drag. */
function drag(ctx, edge, from, to) {
  const grip = ctx.doc.querySelector(`[data-ask-resize="${edge}"]`);
  grip.dispatchEvent(pointer(ctx.window, 'pointerdown', { clientX: from.x, clientY: from.y }));
  ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: to.x, clientY: to.y }));
  return () => ctx.doc.dispatchEvent(pointer(ctx.window, 'pointerup', { clientX: to.x, clientY: to.y }));
}

test('ask-panel: resize — a stored size is restored and re-clamped by a fresh panel; garbage/undersized/throwing storage never breaks the sheet', async () => {
  await checkRows([
    { name: 'ask-panel: resize — a stored size is restored on open by a fresh panel, re-clamped to its dock', run: async () => {
      const ctx = makePanel();
      ctx.storage.setItem(SIZE_KEY, JSON.stringify({ w: 900, h: 700 }));
      const ctx2 = makePanel({ storage: ctx.storage });
      const sheet = ctx2.doc.querySelector('.ask-sheet');
      assert.equal(sheet.style.width, '', 'nothing applied while the sheet is hidden (no layout to clamp against)');
      sizeDock(ctx2.doc, 1200, 900);                       // inner 1144 × 854
      ctx2.panel.open();
      assert.equal(sheet.style.width, '900px');
      assert.equal(sheet.style.height, '700px');
      // a smaller dock on a third panel clamps what is applied but keeps the preference
      const ctx3 = makePanel({ storage: ctx.storage });
      sizeDock(ctx3.doc, 800, 600);                        // inner 744 × 554
      ctx3.panel.open();
      assert.equal(ctx3.doc.querySelector('.ask-sheet').style.width, '744px');
      assert.equal(ctx3.doc.querySelector('.ask-sheet').style.height, '554px');
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 900, h: 700 }, 'a clamp never overwrites the preference');
    } },
    { name: 'ask-panel: resize — garbage, undersized or throwing storage never breaks the sheet', run: async () => {
      const ctx = makePanel();
      ctx.storage.setItem(SIZE_KEY, '{"w":"wide","h":null}');
      const a = makePanel({ storage: ctx.storage });
      a.panel.open();
      assert.equal(a.doc.querySelector('.ask-sheet').style.width, '', 'unusable record → stylesheet default');
      ctx.storage.setItem(SIZE_KEY, JSON.stringify({ w: 10, h: -5 }));
      const b = makePanel({ storage: ctx.storage });
      b.panel.open();
      assert.equal(b.doc.querySelector('.ask-sheet').style.width, `${ASK_SHEET_SIZE.minW}px`, 'undersized record → floor');
      assert.equal(b.doc.querySelector('.ask-sheet').style.height, `${ASK_SHEET_SIZE.minH}px`);
      const boom = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); }, removeItem: () => { throw new Error('nope'); } };
      const c = makePanel({ storage: boom });
      c.panel.open();
      assert.doesNotThrow(() => drag(c, 'n', { x: 0, y: 100 }, { x: 0, y: 50 })());
      assert.equal(c.doc.querySelector('.ask-sheet').style.height, '719px', 'the drag still works when storage throws');
    } },
  ]);
});

test('ask-panel: resize — corner and edge grips move their own axes (symmetric), clamped to [default, dock]; a secondary-button pointerdown neither closes nor drags', async () => {
  await checkRows([
    { name: 'ask-panel: resize — dragging the top-left corner grows both axes symmetrically and persists on pointerup', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      const grip = ctx.doc.querySelector('[data-ask-resize="nw"]');
      const up = drag(ctx, 'nw', { x: 300, y: 200 }, { x: 250, y: 150 });
      // width 821 + 2×50 (the centred sheet grows on both sides); height 669 + 50
      assert.equal(sheet.style.width, '921px');
      assert.equal(sheet.style.height, '719px');
      assert.ok(sheet.classList.contains('is-resizing'));
      assert.ok(grip.classList.contains('is-active'), 'the grabbed grip shows the highlight while dragging');
      assert.equal(ctx.storage.getItem(SIZE_KEY), null, 'nothing is written mid-drag');
      up();
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 921, h: 719 });
      assert.ok(!sheet.classList.contains('is-resizing'));
      assert.ok(!grip.classList.contains('is-active'));
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: 0, clientY: 0 }));
      assert.equal(sheet.style.width, '921px', 'after pointerup a stray move no longer resizes');
    } },
    { name: 'ask-panel: resize — each grip moves only its own axis, in the right direction', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      drag(ctx, 'n', { x: 0, y: 200 }, { x: 40, y: 170 })();        // up 30 → taller; x ignored
      assert.equal(sheet.style.height, '699px');
      assert.equal(sheet.style.width, '821px', 'the top grip carries the width through unchanged');
      drag(ctx, 'e', { x: 300, y: 0 }, { x: 340, y: 60 })();        // right 40 → 2×40 wider; y ignored
      assert.equal(sheet.style.width, '901px');
      assert.equal(sheet.style.height, '699px');
      drag(ctx, 'w', { x: 300, y: 0 }, { x: 340, y: 0 })();         // left grip moved right 40 → 2×40 narrower
      assert.equal(sheet.style.width, '821px');
      drag(ctx, 'ne', { x: 300, y: 200 }, { x: 350, y: 220 })();    // right 50 & down 20 → wider and shorter (699 → 679, still above the floor)
      assert.equal(sheet.style.width, '921px');
      assert.equal(sheet.style.height, '679px');
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 921, h: 679 });
      drag(ctx, 'ne', { x: 300, y: 200 }, { x: 300, y: 260 })();    // down 60 would be 619 → floored at the default
      assert.equal(sheet.style.height, '669px', 'the sheet never gets shorter than it opened');
    } },
    { name: 'ask-panel: resize — the size is clamped to [821×669 default, dock inner box] whatever the pointer does', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);                        // inner 1200−2×28 = 1144 wide, 900−26−20 = 854 tall
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      drag(ctx, 'nw', { x: 300, y: 200 }, { x: -5000, y: -5000 })();
      assert.equal(sheet.style.width, '1144px', 'never wider than the dock minus its 28px side padding');
      assert.equal(sheet.style.height, '854px', 'never taller than the dock minus 26px bottom padding and the 20px top gap');
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 1144, h: 854 });
      drag(ctx, 'nw', { x: 0, y: 0 }, { x: 5000, y: 5000 })();
      assert.equal(sheet.style.width, '821px', 'never narrower than the default the sheet opened at');
      assert.equal(sheet.style.height, '669px', 'never shorter either — the composer row and the popovers assume it');
      // a dock narrower than the floor: the dock wins, the sheet never overflows the viewport
      sizeDock(ctx.doc, 500, 400);                         // inner 444 × 354
      drag(ctx, 'e', { x: 0, y: 0 }, { x: 1, y: 0 })();
      assert.equal(sheet.style.width, '444px');
      assert.equal(sheet.style.height, '354px');
    } },
    { name: 'ask-panel: resize — a grip pointerdown neither closes the sheet nor starts a drag for a secondary button', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      const grip = ctx.doc.querySelector('[data-ask-resize="n"]');
      grip.dispatchEvent(pointer(ctx.window, 'pointerdown', { button: 2, clientX: 0, clientY: 100 }));
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: 0, clientY: 50 }));
      assert.equal(sheet.style.height, '', 'the secondary button does not resize');
      assert.equal(ctx.panel.isOpen(), true);
      const e = pointer(ctx.window, 'pointerdown', { clientX: 0, clientY: 100 });
      grip.dispatchEvent(e);
      assert.equal(e.defaultPrevented, true, 'no text selection while dragging');
      assert.equal(ctx.panel.isOpen(), true, 'a grip lives inside [data-ask-sheet], so the outside-click router ignores it');
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointerup', { pointerId: 7, clientX: 0, clientY: 100 }));
      assert.ok(sheet.classList.contains('is-resizing'), 'another pointer\'s up does not end this drag');
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointercancel', { clientX: 0, clientY: 100 }));
      assert.ok(!sheet.classList.contains('is-resizing'), 'pointercancel ends it');
    } },
  ]);
});

// ---- resize: what persists, and how a drag ends when the pointerup never comes ----

test('ask-panel: resize — a drag ends on blur, Escape (restores start size, stores nothing), a buttonless pointermove and lostpointercapture', async () => {
  await checkRows([
    { name: 'ask-panel: resize — losing window focus mid-drag ends the drag where it is and persists it', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      const grip = ctx.doc.querySelector('[data-ask-resize="n"]');
      drag(ctx, 'n', { x: 0, y: 200 }, { x: 0, y: 150 });     // up 50 → 719; the pointerup lands in another app
      assert.equal(sheet.style.height, '719px');
      ctx.window.dispatchEvent(new ctx.window.Event('blur'));
      assert.ok(!sheet.classList.contains('is-resizing'), 'the gesture is over');
      assert.ok(!grip.classList.contains('is-active'));
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 821, h: 719 }, 'a half-done resize is still a size');
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: 0, clientY: 0 }));
      assert.equal(sheet.style.height, '719px', 'the sheet no longer follows a mouse with no button held');
    } },
    { name: 'ask-panel: resize — Escape mid-drag cancels: the start size comes back and nothing is stored', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      drag(ctx, 'e', { x: 300, y: 0 }, { x: 350, y: 0 })();   // 921 wide, stored
      drag(ctx, 'e', { x: 350, y: 0 }, { x: 400, y: 0 });     // 1021 wide, still held
      assert.equal(sheet.style.width, '1021px');
      const e = key(ctx.window, ctx.doc.body, 'Escape');
      assert.equal(sheet.style.width, '921px', 'back to where this drag started');
      assert.ok(!sheet.classList.contains('is-resizing'));
      assert.equal(e.defaultPrevented, true, 'the drag owned that Escape');
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 921, h: 669 }, 'the cancelled drag wrote nothing');
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointerup', { clientX: 400, clientY: 0 }));
      assert.equal(sheet.style.width, '921px', 'a late pointerup does not resurrect the cancelled size');
      assert.equal(ctx.panel.isOpen(), true, 'Escape mid-drag does not close the sheet');
    } },
    { name: 'ask-panel: resize — a pointermove with no button held means the release was missed: the drag ends there', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      drag(ctx, 'n', { x: 0, y: 200 }, { x: 0, y: 150 });     // 719 tall, held
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: 0, clientY: 100, buttons: 0 }));
      assert.equal(sheet.style.height, '719px', 'the button-less move does not resize');
      assert.ok(!sheet.classList.contains('is-resizing'));
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 821, h: 719 });
    } },
    { name: 'ask-panel: resize — lostpointercapture on the grip ends the drag (the sheet went away or the capture was taken)', run: async () => {
      const ctx = makePanel();
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      const grip = ctx.doc.querySelector('[data-ask-resize="w"]');
      drag(ctx, 'w', { x: 300, y: 0 }, { x: 250, y: 0 });     // 921 wide, held
      grip.dispatchEvent(new ctx.window.Event('lostpointercapture'));
      assert.ok(!sheet.classList.contains('is-resizing'));
      assert.ok(!grip.classList.contains('is-active'));
      assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 921, h: 669 });
      ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: 0, clientY: 0 }));
      assert.equal(sheet.style.width, '921px', 'nothing follows the pointer any more');
    } },
  ]);
});

test('ask-panel: resize — a dock resize re-clamps the open sheet, but never during a drag', async () => {
  await checkRows([
    { name: 'ask-panel: resize — the dock changing size with no window resize (the rail toggle) re-clamps the open sheet', run: async () => {
      const store = makePanel().storage;
      store.setItem(SIZE_KEY, JSON.stringify({ w: 900, h: 700 }));
      const ctx = makePanel({ storage: store, resizeObserver: true });
      const [ro] = ctx.resizeObservers;
      assert.ok(ro, 'the panel observes its dock');
      assert.ok(ro.targets.includes(ctx.doc.querySelector('.ask-dock')));
      sizeDock(ctx.doc, 800, 600);                         // inner 744 × 554 — the rail is open
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      assert.equal(sheet.style.width, '744px');
      sizeDock(ctx.doc, 1022, 600);                        // the rail collapsed: 222px more dock, no window event
      ro.cb([{ target: ctx.doc.querySelector('.ask-dock') }], ro);
      assert.equal(sheet.style.width, '900px', 'the stored preference comes back when there is room again');
      assert.equal(sheet.style.height, '554px');
      ctx.panel.destroy();
      assert.ok(ro.disconnected, 'destroy() disconnects the dock observer');
    } },
    { name: 'ask-panel: resize — a dock or window resize during a drag leaves the drag alone', run: async () => {
      const store = makePanel().storage;
      store.setItem(SIZE_KEY, JSON.stringify({ w: 900, h: 700 }));
      const ctx = makePanel({ storage: store, resizeObserver: true });
      sizeDock(ctx.doc, 1200, 900);
      ctx.panel.open();
      const sheet = ctx.doc.querySelector('.ask-sheet');
      const up = drag(ctx, 'e', { x: 300, y: 0 }, { x: 400, y: 0 });   // 1100 wide, held
      assert.equal(sheet.style.width, '1100px');
      ctx.window.dispatchEvent(new ctx.window.Event('resize'));
      ctx.resizeObservers[0].cb([], ctx.resizeObservers[0]);
      assert.equal(sheet.style.width, '1100px', 'no snap back to the stored 900 under the held pointer');
      up();
      assert.deepEqual(JSON.parse(store.getItem(SIZE_KEY)), { w: 1100, h: 700 });
    } },
  ]);
});
