// test/ask-panel.test.mjs — shell, keyboard, pointerdown routing and the
// popover primitive (spec §10.4, §10.6). No app boot; see the harness header.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key, pointerdown, pointer, sizeDock } from './helpers/ask-panel-harness.mjs';
import { fmtStarted, shortcutLabel, ASK_SHEET_SIZE } from '../ui/public/ask-panel.mjs';

const THREADS = {
  threads: [
    { id: 'ask_00000001', title: 'Fix the login bug', updatedAt: 't2', createdAt: 't1', model: 'claude-opus-5', effort: 'high', sessionId: null, context: null, totals: { costUsd: 0.21, input: 9200, output: 9200, cacheRead: 0, cacheCreation: 0, ctx: 68400, turns: 3, agents: 3 }, runLinks: 0, inFlight: true },
    { id: 'ask_00000002', title: 'Explain run 4e1f', updatedAt: 't1', createdAt: 't0', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false },
  ],
};

const threadsHandler = (url) => (url.startsWith('/api/ask/threads')
  ? { ok: true, status: 200, json: async () => THREADS }
  : { ok: true, status: 200, json: async () => ({}) });

test('ask-panel: root structure — dock, pill, hidden sheet, dialog semantics, no data-view/data-nav', () => {
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
});

test('ask-panel: pill click opens; the composer textarea gets focus; close restores it', () => {
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
});

test('ask-panel: ⌘K and Ctrl+K toggle with preventDefault; repeat and composing are ignored', () => {
  const { panel, window } = makePanel();
  const e1 = key(window, null, 'k', { metaKey: true });
  assert.equal(e1.defaultPrevented, true);
  assert.equal(panel.isOpen(), true);
  const e2 = key(window, null, 'k', { ctrlKey: true });
  assert.equal(panel.isOpen(), false);
  assert.equal(e2.defaultPrevented, true);
  key(window, null, 'k', { metaKey: true, repeat: true });
  assert.equal(panel.isOpen(), false, 'e.repeat ignored');
  key(window, null, 'k', { metaKey: true, isComposing: true });
  assert.equal(panel.isOpen(), false, 'e.isComposing ignored');
  key(window, null, 'k', {});
  assert.equal(panel.isOpen(), false, 'bare k does nothing');
});

test('ask-panel: ownsKey truth table', () => {
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
});

test('ask-panel: Escape with the sheet open and no popover is an owned no-op', () => {
  const { panel, window } = makePanel();
  panel.open();
  panel.root.querySelector('textarea.ask-input').focus();
  key(window, panel.root.querySelector('textarea.ask-input'), 'Escape');
  assert.equal(panel.isOpen(), true, 'the sheet does not close on Escape (mockup rule)');
});

test('ask-panel: pointerdown outside closes; exempt overlays do not', () => {
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
});

test('ask-panel: threads popover lists rows with meter and live dot; empty state', async () => {
  const { panel, doc, tick, fetchCalls } = makePanel({ fetchHandler: threadsHandler });
  panel.open();
  doc.querySelector('[data-ask-threads-btn]').click();
  await tick();
  assert.ok(fetchCalls.some((c) => c.url.startsWith('/api/ask/threads')), 'list fetched on open');
  const pop = doc.querySelector('.ask-pop');
  assert.ok(pop);
  assert.equal(pop.getAttribute('role'), 'menu');
  const items = [...pop.querySelectorAll('[role="menuitem"]')];
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Fix the login bug/);
  assert.match(items[0].textContent, /68\.4k ctx · \$0\.21 · 3 agents/, 'the row shows context fill, not cumulative tokens');
  assert.ok(items[0].querySelector('.ask-dot-live'), 'in-flight thread shows the live dot');
  assert.equal(items[1].querySelector('.ask-dot-live'), null);
  // The idle row still emits the span, but the CSS collapses .ask-thread-dot
  // (display:none) unless the live arm joins it, so no empty gutter is left.
  const idleDot = items[1].querySelector('.ask-dot');
  assert.ok(idleDot, 'the idle row still emits the dot span');
  assert.ok(idleDot.classList.contains('ask-thread-dot'), 'the span carries the threads-only class that collapses it');
  assert.equal(idleDot.classList.contains('ask-dot-live'), false, 'nothing green shows for an idle chat');
  // empty state
  const empty = makePanel({ fetchHandler: () => ({ ok: true, status: 200, json: async () => ({ threads: [] }) }) });
  empty.panel.open();
  empty.doc.querySelector('[data-ask-threads-btn]').click();
  await empty.tick();
  assert.match(empty.doc.querySelector('.ask-pop').textContent, /No saved chats\./);
});

test('ask-panel: threads rows live in a scroller; the caption stays pinned; empty state has none', async () => {
  const { panel, doc, tick } = makePanel({ fetchHandler: threadsHandler });
  panel.open();
  doc.querySelector('[data-ask-threads-btn]').click();
  await tick();
  const pop = doc.querySelector('.ask-pop-threads');
  assert.ok(pop);
  const list = pop.querySelector('.ask-threads-list');
  assert.ok(list, 'the rows are wrapped in a scroller');
  assert.equal(list.parentNode, pop, 'the scroller is the popover own child (menuItems/panel guard)');
  // The caption rides the History caption-row (caption + total meter); the ROW is
  // the popover's own child, so the caption stays pinned above the scroller.
  const captionRow = pop.querySelector('.ask-pop-caption-row');
  assert.equal(captionRow.parentNode, pop, 'the caption row sits outside the scroller');
  assert.equal(pop.querySelector('.ask-pop-caption').parentNode, captionRow, 'the caption lives in its row');
  assert.equal(pop.querySelector('.ask-pop-caption').textContent, 'History');
  assert.equal(pop.querySelectorAll(':scope > .ask-thread-row').length, 0, 'no row hangs off the panel itself');
  assert.equal(list.querySelectorAll('.ask-thread-row').length, 2, 'every row went into the scroller');
  assert.equal(pop.querySelectorAll('[role="menuitem"]').length, 2, 'arrow-key navigation still sees them');

  const empty = makePanel({ fetchHandler: () => ({ ok: true, status: 200, json: async () => ({ threads: [] }) }) });
  empty.panel.open();
  empty.doc.querySelector('[data-ask-threads-btn]').click();
  await empty.tick();
  const emptyPop = empty.doc.querySelector('.ask-pop-threads');
  assert.equal(emptyPop.querySelector('.ask-threads-list'), null, 'nothing to scroll, no scroller');
  assert.match(emptyPop.querySelector('.ask-pop-empty').textContent, /No saved chats\./);
});

test('ask-panel: fmtStarted — relative while recent, short ISO once old, null when unusable', () => {
  const NOW = Date.parse('2026-08-25T12:00:00.000Z');
  assert.equal(fmtStarted('2026-08-25T11:59:30.000Z', NOW), 'just now');
  assert.equal(fmtStarted('2026-08-25T11:30:00.000Z', NOW), '30m ago');
  assert.equal(fmtStarted('2026-08-25T07:00:00.000Z', NOW), '5h ago');
  assert.equal(fmtStarted('2026-08-18T12:00:00.000Z', NOW), '7d ago');
  assert.equal(fmtStarted('2026-01-05T12:00:00.000Z', NOW), '2026-01-05', 'past 30d falls back to a short absolute date');
  assert.equal(fmtStarted('2026-08-25T12:00:10.000Z', NOW), 'just now', 'clock skew never yields a negative age');
  // Unlike plugins-view's relTime, an unusable stamp yields null rather than
  // echoing the raw value: renderThreadRows skips the date element entirely, so
  // the row shows nothing instead of "t1" or "Invalid Date".
  for (const bad of [undefined, null, '', 'not-a-date', 't1', NaN]) {
    assert.equal(fmtStarted(bad, NOW), null, `no date for ${String(bad)}`);
  }
});

test('ask-panel: thread rows report when the chat was started; unusable createdAt shows nothing', async () => {
  const NOW = Date.parse('2026-08-25T12:00:00.000Z');
  const started = {
    threads: [
      { id: 'ask_1', title: 'Minutes', createdAt: '2026-08-25T11:58:00.000Z', updatedAt: 'x', totals: { ctx: 1000, costUsd: 0.5, agents: 2 }, inFlight: false },
      { id: 'ask_2', title: 'Hours', createdAt: '2026-08-25T09:00:00.000Z', updatedAt: 'x', totals: {}, inFlight: false },
      { id: 'ask_3', title: 'Days', createdAt: '2026-08-21T12:00:00.000Z', updatedAt: 'x', totals: {}, inFlight: false },
      { id: 'ask_4', title: 'Old', createdAt: '2026-01-05T12:00:00.000Z', updatedAt: 'x', totals: {}, inFlight: false },
      { id: 'ask_5', title: 'Broken', createdAt: 'not-a-date', updatedAt: 'x', totals: {}, inFlight: false },
      { id: 'ask_6', title: 'Missing', updatedAt: 'x', totals: {}, inFlight: false },
    ],
  };
  const { panel, doc, tick } = makePanel({
    now: () => NOW,
    fetchHandler: () => ({ ok: true, status: 200, json: async () => started }),
  });
  panel.open();
  doc.querySelector('[data-ask-threads-btn]').click();
  await tick();
  const picks = [...doc.querySelectorAll('.ask-thread-pick')];
  assert.equal(picks.length, 6);
  const whens = picks.map((p) => {
    const w = p.querySelector('.ask-thread-meter .ask-thread-when');
    return w ? w.textContent : null;
  });
  assert.deepEqual(whens, ['2m ago', '3h ago', '4d ago', '2026-01-05', null, null],
    'the date is its own element inside the meter; an unusable createdAt renders none');
  for (const w of whens) assert.ok(!/Invalid Date|NaN/.test(String(w)), `never surfaces a broken date: ${w}`);
  // The date leads the meter line, then the money figures follow it.
  const meterEls = [...doc.querySelectorAll('.ask-thread-meter')];
  const meters = meterEls.map((m) => m.textContent);
  assert.equal(meters.length, 6);
  assert.equal(meters[0], '2m ago · 1.0k ctx · $0.50 · 2 agents', 'the date leads the meter line');
  assert.equal(meters[1], '3h ago', 'a date with no totals brings no trailing separator');
  assert.equal(meters[4], '', 'an unusable createdAt with no totals leaves the meter empty');
  assert.equal(meters[5], '', 'so does a missing one');
  meters.forEach((m, i) => {
    if (whens[i]) assert.ok(m.startsWith(`${whens[i]}`), `the date is the meter's first part: ${m}`);
    else assert.ok(!/ago|\d{4}-\d{2}-\d{2}/.test(m), `no date, so none rides the meter: ${m}`);
  });
  // Row order: [dot slot] [title + meter]. The date is no longer a column of its
  // own, so a dateless row is shaped exactly like a dated one.
  const cls = (n) => (n ? n.className : null);
  assert.deepEqual([...picks[0].children].map(cls), ['ask-dot ask-thread-dot', 'ask-thread-col']);
  assert.deepEqual([...picks[4].children].map(cls), ['ask-dot ask-thread-dot', 'ask-thread-col'],
    'a dateless row keeps the dot slot and nothing else changes');
  // Only the date is an element; the grey figures are plain text beside it.
  assert.deepEqual([...meterEls[0].children].map(cls), ['ask-thread-when']);
  assert.deepEqual([...meterEls[4].children].map(cls), [],
    'no date element, no stray separator, no empty bold blob');
  assert.equal(doc.querySelectorAll('.ask-thread-row .ask-thread-col > span').length, 12, 'the column is still just title + meter');
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

test('ask-panel: click-away inside the sheet closes the popover, not the sheet; reopening is a toggle', async () => {
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
});

test('ask-panel: destroy removes the root and unbinds the document listeners', () => {
  const { panel, window, doc } = makePanel();
  panel.destroy();
  assert.equal(doc.querySelector('.ask-dock'), null);
  const e = key(window, null, 'k', { metaKey: true });
  assert.equal(e.defaultPrevented, false, 'no listener left behind');
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

// The launcher pill's shortcut glyph follows the viewer's OS: the keydown
// handler accepts Meta+K AND Ctrl+K everywhere, but showing '⌘K' on Windows
// (where only Ctrl+K works) told users a chord they cannot press.
test('ask-panel: the pill hint reads ⌘K on macOS and Ctrl K elsewhere', () => {
  assert.equal(shortcutLabel({ navigator: { platform: 'MacIntel' } }), '⌘K');
  assert.equal(shortcutLabel({ navigator: { userAgentData: { platform: 'macOS' }, platform: '' } }), '⌘K');
  assert.equal(shortcutLabel({ navigator: { platform: 'Win32' } }), 'Ctrl K');
  assert.equal(shortcutLabel({ navigator: { platform: 'Linux x86_64' } }), 'Ctrl K');
  assert.equal(shortcutLabel({}), 'Ctrl K', 'no navigator at all falls back to the non-Mac chord');
  // and the mounted pill uses it (jsdom reports an empty platform → Ctrl K)
  const dock = makePanel().panel.root;
  assert.equal(dock.querySelector('.ask-kbd').textContent, 'Ctrl K');
});

// ---- resize: drag the top / side edges; persisted in worca-cc.ask.size ----
const SIZE_KEY = 'worca-cc.ask.size';
const EDGES = ['n', 'e', 'w', 'ne', 'nw'];

/** pointerdown on a grip, one move, and a thunk that ends the drag. */
function drag(ctx, edge, from, to) {
  const grip = ctx.doc.querySelector(`[data-ask-resize="${edge}"]`);
  grip.dispatchEvent(pointer(ctx.window, 'pointerdown', { clientX: from.x, clientY: from.y }));
  ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: to.x, clientY: to.y }));
  return () => ctx.doc.dispatchEvent(pointer(ctx.window, 'pointerup', { clientX: to.x, clientY: to.y }));
}

test('ask-panel: resize — five invisible grips inside the sheet, decorative and non-navigational', () => {
  const { panel, doc } = makePanel();
  const sheet = doc.querySelector('.ask-sheet');
  const grips = [...sheet.querySelectorAll('.ask-resize')];
  assert.deepEqual(grips.map((g) => g.getAttribute('data-ask-resize')), EDGES);
  for (const g of grips) {
    assert.ok(g.classList.contains(`ask-resize-${g.getAttribute('data-ask-resize')}`), 'per-edge class carries the cursor rule');
    assert.equal(g.getAttribute('aria-hidden'), 'true');
    assert.ok(!g.hasAttribute('tabindex'), 'not focusable');
    assert.equal(g.textContent, '');
  }
  assert.equal(panel.root.querySelector('[data-view],[data-nav]'), null, 'still nothing navigational in the dock');
  assert.equal(sheet.style.width, '', 'no inline size until the user drags');
  assert.equal(sheet.style.height, '');
  assert.deepEqual(ASK_SHEET_SIZE, { defaultW: 782, defaultH: 669, minW: 782, minH: 669, dockPadX: 28, dockPadBottom: 26, topGap: 20 },
    'the floor is the stylesheet default: the sheet grows, never shrinks');
});

test('ask-panel: resize — a stored size is restored on open by a fresh panel, re-clamped to its dock', () => {
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
});

test('ask-panel: resize — garbage, undersized or throwing storage never breaks the sheet', () => {
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
});

test('ask-panel: resize — dragging the top-left corner grows both axes symmetrically and persists on pointerup', () => {
  const ctx = makePanel();
  sizeDock(ctx.doc, 1200, 900);
  ctx.panel.open();
  const sheet = ctx.doc.querySelector('.ask-sheet');
  const grip = ctx.doc.querySelector('[data-ask-resize="nw"]');
  const up = drag(ctx, 'nw', { x: 300, y: 200 }, { x: 250, y: 150 });
  // width 782 + 2×50 (the centred sheet grows on both sides); height 669 + 50
  assert.equal(sheet.style.width, '882px');
  assert.equal(sheet.style.height, '719px');
  assert.ok(sheet.classList.contains('is-resizing'));
  assert.ok(grip.classList.contains('is-active'), 'the grabbed grip shows the highlight while dragging');
  assert.equal(ctx.storage.getItem(SIZE_KEY), null, 'nothing is written mid-drag');
  up();
  assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 882, h: 719 });
  assert.ok(!sheet.classList.contains('is-resizing'));
  assert.ok(!grip.classList.contains('is-active'));
  ctx.doc.dispatchEvent(pointer(ctx.window, 'pointermove', { clientX: 0, clientY: 0 }));
  assert.equal(sheet.style.width, '882px', 'after pointerup a stray move no longer resizes');
});

test('ask-panel: resize — each grip moves only its own axis, in the right direction', () => {
  const ctx = makePanel();
  sizeDock(ctx.doc, 1200, 900);
  ctx.panel.open();
  const sheet = ctx.doc.querySelector('.ask-sheet');
  drag(ctx, 'n', { x: 0, y: 200 }, { x: 40, y: 170 })();        // up 30 → taller; x ignored
  assert.equal(sheet.style.height, '699px');
  assert.equal(sheet.style.width, '782px', 'the top grip carries the width through unchanged');
  drag(ctx, 'e', { x: 300, y: 0 }, { x: 340, y: 60 })();        // right 40 → 2×40 wider; y ignored
  assert.equal(sheet.style.width, '862px');
  assert.equal(sheet.style.height, '699px');
  drag(ctx, 'w', { x: 300, y: 0 }, { x: 340, y: 0 })();         // left grip moved right 40 → 2×40 narrower
  assert.equal(sheet.style.width, '782px');
  drag(ctx, 'ne', { x: 300, y: 200 }, { x: 350, y: 220 })();    // right 50 & down 20 → wider and shorter (699 → 679, still above the floor)
  assert.equal(sheet.style.width, '882px');
  assert.equal(sheet.style.height, '679px');
  assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 882, h: 679 });
  drag(ctx, 'ne', { x: 300, y: 200 }, { x: 300, y: 260 })();    // down 60 would be 619 → floored at the default
  assert.equal(sheet.style.height, '669px', 'the sheet never gets shorter than it opened');
});

test('ask-panel: resize — the size is clamped to [782×669 default, dock inner box] whatever the pointer does', () => {
  const ctx = makePanel();
  sizeDock(ctx.doc, 1200, 900);                        // inner 1200−2×28 = 1144 wide, 900−26−20 = 854 tall
  ctx.panel.open();
  const sheet = ctx.doc.querySelector('.ask-sheet');
  drag(ctx, 'nw', { x: 300, y: 200 }, { x: -5000, y: -5000 })();
  assert.equal(sheet.style.width, '1144px', 'never wider than the dock minus its 28px side padding');
  assert.equal(sheet.style.height, '854px', 'never taller than the dock minus 26px bottom padding and the 20px top gap');
  assert.deepEqual(JSON.parse(ctx.storage.getItem(SIZE_KEY)), { w: 1144, h: 854 });
  drag(ctx, 'nw', { x: 0, y: 0 }, { x: 5000, y: 5000 })();
  assert.equal(sheet.style.width, `${ASK_SHEET_SIZE.minW}px`, '540 — every popover still fits');
  assert.equal(sheet.style.height, `${ASK_SHEET_SIZE.minH}px`);
  // a dock narrower than the floor: the dock wins, the sheet never overflows the viewport
  sizeDock(ctx.doc, 500, 400);                         // inner 444 × 354
  drag(ctx, 'e', { x: 0, y: 0 }, { x: 1, y: 0 })();
  assert.equal(sheet.style.width, '444px');
  assert.equal(sheet.style.height, '354px');
});

test('ask-panel: resize — a grip pointerdown neither closes the sheet nor starts a drag for a secondary button', () => {
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
});

test('ask-panel: resize — double-click on a grip resets to the stylesheet default and forgets the stored size', () => {
  const ctx = makePanel();
  sizeDock(ctx.doc, 1200, 900);
  ctx.panel.open();
  const sheet = ctx.doc.querySelector('.ask-sheet');
  drag(ctx, 'e', { x: 300, y: 0 }, { x: 350, y: 0 })();
  assert.equal(sheet.style.width, '882px');
  assert.ok(ctx.storage.getItem(SIZE_KEY));
  const grip = ctx.doc.querySelector('[data-ask-resize="e"]');
  // a real double-click is two full click sequences and then dblclick
  for (let i = 0; i < 2; i++) {
    grip.dispatchEvent(pointer(ctx.window, 'pointerdown', { clientX: 400, clientY: 0 }));
    ctx.doc.dispatchEvent(pointer(ctx.window, 'pointerup', { clientX: 400, clientY: 0 }));
  }
  grip.dispatchEvent(new ctx.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(sheet.style.width, '', 'inline width gone — min(782px,100%) rules again');
  assert.equal(sheet.style.height, '');
  assert.equal(ctx.storage.getItem(SIZE_KEY), null, 'the stored value is cleared, not zeroed');
  ctx.panel.close();
  ctx.panel.open();
  assert.equal(sheet.style.width, '', 'reopen does not resurrect the old size');
  drag(ctx, 'n', { x: 0, y: 200 }, { x: 0, y: 100 })();
  assert.equal(sheet.style.height, '769px', 'a later drag starts again from the default 669');
});
