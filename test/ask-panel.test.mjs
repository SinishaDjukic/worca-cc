// test/ask-panel.test.mjs — shell, keyboard, pointerdown routing and the
// popover primitive (spec §10.4, §10.6). No app boot; see the harness header.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key, pointerdown } from './helpers/ask-panel-harness.mjs';

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
