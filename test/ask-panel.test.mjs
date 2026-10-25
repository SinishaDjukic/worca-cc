// test/ask-panel.test.mjs — shell, keyboard, pointerdown routing and the
// popover primitive (spec §10.4, §10.6). No app boot; see the harness header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { makePanel, key, pointerdown } from './helpers/ask-panel-harness.mjs';

const THREADS = {
  threads: [
    { id: 'ask_00000001', title: 'Fix the login bug', updatedAt: 't2', createdAt: 't1', model: 'claude-opus-5-5', effort: 'high', sessionId: null, context: null, totals: { costUsd: 0.21, input: 9200, output: 9200, cacheRead: 0, cacheCreation: 0, ctx: 68400, turns: 3, agents: 3 }, runLinks: 0, inFlight: true, tracking: false },
    { id: 'ask_00000002', title: 'Explain run 4e1f', updatedAt: 't1', createdAt: 't0', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, tracking: false },
  ],
};

const threadsHandler = (url) => (url.startsWith('/api/ask/threads')
  ? { ok: true, status: 200, json: async () => THREADS }
  : { ok: true, status: 200, json: async () => ({}) });

test('ask-panel: shell — the Chat page, open/close as show/hide, ⌘K/Ctrl+K left to the search, the ownsKey truth table', async () => {
  await checkRows([
    { name: 'ask-panel: root structure — history column, scrim, conversation, hidden panel slot; home with the composer in the hero slot; no dock/pill/sheet/dialog', run: async () => {
      const { panel } = makePanel();
      const page = panel.root;
      assert.ok(page.classList.contains('chat-page') && page.hasAttribute('data-chat-page'));
      assert.deepEqual([...page.children].map((c) => `${c.tagName.toLowerCase()}.${c.classList[0]}`),
        ['aside.chat-history', 'div.chat-scrim', 'div.chat-convo', 'aside.chat-panel']);
      assert.equal(page.dataset.view, 'home', 'a new chat has no messages');
      assert.equal(page.dataset.panel, 'closed');
      assert.equal(page.querySelector(':scope > [data-chat-panel]').hidden, true);
      const head = page.querySelector(':scope > .chat-convo > header.chat-head');
      assert.ok(head.querySelector('button[data-ask-threads-btn][aria-label="History"]'));
      assert.equal(head.querySelector('.ask-title').textContent, 'New chat');
      const newBtn = head.querySelector('button[data-ask-new-btn]');
      assert.ok(newBtn, 'New chat sits in the head');
      assert.equal(newBtn.type, 'button');
      assert.equal(newBtn.textContent, 'New chat', 'a labelled button, not an icon');
      assert.equal(newBtn.getAttribute('aria-label'), null, 'the visible label is its name');
      assert.equal(newBtn.querySelector('svg').getAttribute('aria-hidden'), 'true', 'the plus glyph is decoration');
      assert.ok(newBtn.classList.contains('chat-head-btn') && newBtn.classList.contains('chat-new-btn'));
      assert.ok(page.querySelector('[data-chat-home] > [data-chat-hero-slot] > .ask-composer > .ask-composer-box > [data-chat-composer-lead]:first-child'));
      assert.ok(page.querySelector('.chat-convo > .ask-transcript[data-ask-scroll]'));
      assert.ok(page.querySelector('.chat-convo > [data-chat-dock]'));
      assert.ok(page.querySelector('.sr-only[aria-live="polite"]'), 'the announcement line exists');
      for (const gone of ['.ask-dock', '.ask-pill', '.ask-tip', '.ask-sheet', '[data-ask-sheet]', '[role="dialog"]', '.ask-header', '[data-ask-resize]', '[aria-label="Close"]', '[data-nav]']) {
        assert.equal(page.querySelector(gone), null, `${gone} is gone`);
      }
      assert.equal(panel.isOpen(), false);
    } },
    { name: 'ask-panel: open() focuses the composer; close() leaves focus where it is (there is no pill to return to)', run: async () => {
      const { panel, doc } = makePanel();
      const outside = doc.createElement('button');
      doc.body.appendChild(outside);
      outside.focus();
      panel.open();
      assert.equal(panel.isOpen(), true);
      const input = panel.root.querySelector('textarea.ask-input');
      assert.equal(doc.activeElement, input);
      panel.close();
      assert.equal(panel.isOpen(), false);
      assert.equal(doc.activeElement, input);
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
    { name: 'ask-panel: ownsKey truth table — owned only while a popover is open; never under a dialog, in the terminal or in the run panel', run: async () => {
      const { panel, window, doc } = makePanel();
      const esc = (target, k = 'Escape') => {
        const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true });
        Object.defineProperty(e, 'target', { value: target });
        return e;
      };
      const input = panel.root.querySelector('textarea.ask-input');
      assert.equal(panel.ownsKey(esc(input)), false, 'hidden → never owns');
      panel.open();
      assert.equal(panel.ownsKey(esc(input)), false, 'nothing open → nothing to close');
      panel.root.querySelector('[data-ask-model-btn]').click();
      assert.equal(panel.ownsKey(esc(input)), true, 'a popover → owned');
      assert.equal(panel.ownsKey(esc(doc.body)), true, 'wherever the key lands');
      assert.equal(panel.ownsKey(esc(input, 'k')), false, 'non-Escape never owned');
      const pane = doc.createElement('div');
      pane.className = 'term-pane';
      doc.body.appendChild(pane);
      assert.equal(panel.ownsKey(esc(pane)), false, 'the terminal keeps its Escape');
      const inPanel = doc.createElement('button');
      panel.root.querySelector('[data-chat-panel]').appendChild(inPanel);
      assert.equal(panel.ownsKey(esc(inPanel)), false, 'the run panel keeps its keys');
      const modal = doc.createElement('div');
      modal.className = 'viewer-modal';
      doc.body.appendChild(modal);
      assert.equal(panel.ownsKey(esc(input)), false, 'a dialog over the page owns it');
    } },
  ]);
});

test('ask-panel: dismissal — Escape with nothing open closes nothing, no press closes the page, a press outside an open popover closes it, click-away inside closes only the popover', async () => {
  await checkRows([
    { name: 'ask-panel: Escape with the page open and nothing open closes nothing', run: async () => {
      const { panel, window } = makePanel();
      panel.open();
      panel.root.querySelector('textarea.ask-input').focus();
      key(window, panel.root.querySelector('textarea.ask-input'), 'Escape');
      assert.equal(panel.isOpen(), true, 'the page never closes on Escape');
    } },
    { name: 'ask-panel: no press closes the page; a press outside an open popover closes it, a dialog, the terminal or the top bar search keep it', run: async () => {
      const { panel, window, doc } = makePanel();
      const keepers = ['viewer-modal', 'info-bubble', 'mention-popup', 'term-pane', 'tsearch'];
      for (const cls of keepers) {
        const n = doc.createElement('div');
        n.className = cls;
        doc.body.appendChild(n);
      }
      panel.open();
      pointerdown(window, doc.body);
      assert.equal(panel.isOpen(), true, 'a press outside never closes the page — the router does');
      panel.root.querySelector('[data-ask-model-btn]').click();
      for (const cls of keepers) {
        pointerdown(window, doc.querySelector(`.${cls}`));
        assert.ok(doc.querySelector('.ask-pop-model'), `a press in .${cls} keeps the popover`);
      }
      pointerdown(window, doc.body);
      assert.equal(doc.querySelector('.ask-pop-model'), null, 'elsewhere closes it');
      assert.equal(panel.isOpen(), true);
    } },
    { name: 'ask-panel: click-away inside the page closes the popover, not the page; reopening is a toggle', run: async () => {
      const { panel, window, doc, tick } = makePanel();
      panel.open();
      const trigger = doc.querySelector('[data-ask-model-btn]');
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
  const CATALOG = { models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['high'], custom: false }], efforts: ['high'] };
  const { panel, window, doc, tick } = makePanel({ fetchHandler: (url) => ({ ok: true, status: 200, json: async () => (url === '/api/ask/models' ? CATALOG : {}) }) });
  panel.open();
  await tick();                                                        // the catalog lands
  const trigger = doc.querySelector('[data-ask-model-btn]');
  trigger.click();
  await tick();
  const pop = doc.querySelector('.ask-pop-model');
  const items = [...pop.querySelectorAll('[role="menuitem"]')];
  assert.equal(items.length, 2, 'the model row and the Effort row');
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
  assert.equal(doc.querySelector('[data-chat-page]'), null);
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
  await ctx.tick();
  ctx.panel.open({ threadId: 'ask_00000001' });                        // A: its GET hangs
  await ctx.tick();
  ctx.panel.open({ threadId: 'ask_00000002' });                        // B: resolves at once
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
    ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
    ctx.doc.querySelector('textarea.ask-input').value = 'draft for the new chat';
    releasePost();
    for (let i = 0; i < 4; i++) await ctx.tick();
    ctx.flush();
    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled.length, 0, `no unhandled rejection: ${unhandled.map((e) => e && e.message).join(', ')}`);
    assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'draft for the new chat', 'the finished send did not clear the NEW composer');
    assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat', 'still on the new chat');
  } finally {
    process.off('unhandledRejection', onRej);
  }
});
