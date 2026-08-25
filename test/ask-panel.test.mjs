// test/ask-panel.test.mjs — shell, keyboard, pointerdown routing and the
// popover primitive (spec §10.4, §10.6). No app boot; see the harness header.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key, pointerdown } from './helpers/ask-panel-harness.mjs';
import { fmtStarted } from '../ui/public/ask-panel.mjs';

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
  assert.equal(pop.querySelector('.ask-pop-caption').parentNode, pop, 'the caption sits outside the scroller');
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
  // echoing the raw value: threadMeter drops it via filter(Boolean), so the row
  // shows nothing instead of "t1" or "Invalid Date".
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
  const meters = [...doc.querySelectorAll('.ask-thread-meter')].map((m) => m.textContent);
  assert.equal(meters.length, 6);
  assert.equal(meters[0], '1.0k ctx · $0.50 · 2 agents · 2m ago', 'the start date joins the existing meter parts');
  assert.equal(meters[1], '3h ago', 'a thread with no totals still reports when it started');
  assert.equal(meters[2], '4d ago');
  assert.equal(meters[3], '2026-01-05');
  assert.equal(meters[4], '', 'an unparsable createdAt renders no date at all');
  assert.equal(meters[5], '', 'a missing createdAt renders no date at all');
  for (const m of meters) assert.ok(!/Invalid Date|NaN/.test(m), `never surfaces a broken date: ${m}`);
  // The date rides the existing meter line, so no new element competes with the
  // title clamp for the popover's capped width.
  assert.equal(doc.querySelectorAll('.ask-thread-row .ask-thread-col > span').length, 12, 'still just title + meter per row');
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
