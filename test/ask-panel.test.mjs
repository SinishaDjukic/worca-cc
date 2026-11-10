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
      assert.equal(newBtn.previousElementSibling, head.querySelector('[data-ask-threads-btn]'), 'the + right after the list toggle');
      assert.match(newBtn.getAttribute('aria-label'), /^New chat /, 'an icon button named New chat, with its key');
      assert.equal(newBtn.querySelector('svg').getAttribute('aria-hidden'), 'true', 'the plus glyph is decoration');
      assert.ok(newBtn.classList.contains('chat-head-btn') && newBtn.classList.contains('chat-new-plus'));
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

// ── cross-chat messaging slice 1 (Q22): a system row holding a chat-message block, in the real panel ─────────────────
test('Q22 a chat-message system row renders through buildChatMessage; an unknown chat keeps its id; a patched block shows Replied live', async () => {
  const TID = 'ask_00000001';
  const BLOCK = { kind: 'chat-message', id: 'cmsg_0000abcd', direction: 'in', intent: 'question', text: 'please look', conversationId: 'cxm_0000abcd',
    hop: 1, maxHops: 6, replyTo: null, repliedWith: null,
    from: { kind: 'chat', chatId: 'ask_1234abcd', title: 'Other', scope: { kind: 'none', key: null, label: 'No project' }, owner: 'local' },
    to: { chatId: TID, title: 'T' }, sentAt: 't' };
  const row = (b) => ({ id: 'askm_s0000001', threadId: TID, seq: 1, role: 'system', text: 'Message from ask_1234abcd (Question, untrusted)', blocks: [b], status: null, createdAt: 't' });
  const resolves = [];
  const ctx = makePanel({ fetchHandler: (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
        messages: [row(BLOCK)], attachments: [], runLinks: [], worktrees: [], inFlight: null }) };
    }
    if (url === '/api/ask/refs/resolve') { resolves.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ refs: {} }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  for (let i = 0; i < 8; i++) await ctx.tick();
  ctx.flush();
  const rec = ctx.doc.querySelector('.ask-msg-system .ask-chat-msg.ask-chat-msg-in');
  assert.ok(rec, 'the record is built by buildChatMessage');
  assert.equal(rec.querySelector('.ask-chat-msg-untrusted'), null);
  assert.equal(rec.querySelector('.ask-chat-msg-hint'), null);
  assert.doesNotMatch(rec.querySelector('.ask-chat-msg-head').textContent, /Untrusted/);
  assert.equal(ctx.doc.querySelector('.ask-msg-system .ask-notice'), null, 'no notice fallback for that row');
  assert.match(rec.querySelector('.ask-chat-msg-head').textContent, /ask_1234abcd/, 'an unresolved chat keeps its plain id');
  assert.ok(resolves.some((b) => b.refs.includes('chat:ask_1234abcd')), 'the ref chips were asked to resolve the sender');
  assert.ok(!rec.querySelector('.ask-chat-msg-foot').textContent.includes('Replied'));
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: row({ ...BLOCK, repliedWith: 'cmsg_0000ffff' }) });
  ctx.flush();
  await ctx.tick();
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-msg-system .ask-chat-msg-foot').textContent, /Replied/, 'the patched row rebuilt with no reload');
  ctx.panel.destroy();
});

// The record's chat chip: the other chat's stored title from the resolver (its id while untitled or gone), following
// title frames. `state.refs` is what the resolve stub answers now; `state.asked` counts the POSTs naming the sender.
function chatRecordPanel(state) {
  const TID = 'ask_00000001';
  const BLOCK = { kind: 'chat-message', id: 'cmsg_0000abcd', direction: 'in', intent: 'question', text: 'please look', conversationId: 'cxm_0000abcd',
    hop: 1, maxHops: 6, replyTo: null, repliedWith: null,
    from: { kind: 'chat', chatId: 'ask_1234abcd', title: 'Active Chats About README', scope: { kind: 'none', key: null, label: 'No project' }, owner: 'local' },
    to: { chatId: TID, title: 'T' }, sentAt: 't' };
  const row = { id: 'askm_s0000001', threadId: TID, seq: 1, role: 'system', text: 'Message from ask_1234abcd (Question, untrusted)', blocks: [BLOCK], status: null, createdAt: 't' };
  state.asked = 0;
  const ctx = makePanel({ fetchHandler: (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
        messages: [row], attachments: [], runLinks: [], worktrees: [], inFlight: null }) };
    }
    if (url === '/api/ask/refs/resolve') {
      const body = JSON.parse(opts.body);
      if (body.refs.includes('chat:ask_1234abcd')) state.asked++;
      return { ok: true, status: 200, json: async () => ({ refs: Object.fromEntries(body.refs.filter((k) => k in state.refs).map((k) => [k, state.refs[k]])) }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  const head = () => ctx.doc.querySelector('.ask-msg-system .ask-chat-msg-head');
  const title = () => head().querySelector('.ask-ref-chip-chat .ask-ref-title')?.textContent;
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) await ctx.tick(); ctx.flush(); };
  return { ctx, head, title, settle };
}

test("a chat-message record's chip shows the other chat's stored title, never the block's send-time title, and follows a rename", async () => {
  const state = { refs: { 'chat:ask_1234abcd': { ok: true, kind: 'chat', title: 'Release notes' } } };
  const { ctx, head, title, settle } = chatRecordPanel(state);
  ctx.panel.open();
  await settle();
  assert.equal(title(), 'Release notes');
  assert.equal(head().querySelector('a.ask-ref-chip-chat').getAttribute('href'), '#chat/ask_1234abcd');
  assert.ok(!head().textContent.includes('Active Chats About README'));
  const before = state.asked;
  state.refs['chat:ask_1234abcd'] = { ok: true, kind: 'chat', title: 'Renamed' };
  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: 'ask_1234abcd', title: 'Renamed' });
  await settle();
  assert.equal(title(), 'Renamed');
  assert.equal(state.asked, before + 1, 'exactly one more lookup of that chat');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'T', "another chat's title frame never re-titles the open chat");
  ctx.panel.destroy();
});

test('an untitled other chat shows its ask_ id, not New chat', async () => {
  const state = { refs: { 'chat:ask_1234abcd': { ok: true, kind: 'chat', title: '' } } };
  const { ctx, head, title, settle } = chatRecordPanel(state);
  ctx.panel.open();
  await settle();
  assert.equal(title(), 'ask_1234abcd');
  assert.ok(!head().closest('.ask-chat-msg').textContent.includes('New chat'));
  ctx.panel.destroy();
});

test('a history clear naming the other chat turns its chip back into its id', async () => {
  const state = { refs: { 'chat:ask_1234abcd': { ok: true, kind: 'chat', title: 'Release notes' } } };
  const { ctx, head, title, settle } = chatRecordPanel(state);
  ctx.panel.open();
  await settle();
  assert.equal(title(), 'Release notes');
  const before = state.asked;
  state.refs = {};
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared', threadIds: ['ask_1234abcd'] });
  await settle();
  assert.equal(state.asked, before + 1);
  const text = head().textContent;
  assert.match(text, /ask_1234abcd/);
  assert.doesNotMatch(text, /Release notes|\bChat\b|New chat/);
  assert.ok(ctx.doc.querySelector('.ask-msg-system .ask-chat-msg'), 'the open chat (another id) did not reset');
  ctx.panel.destroy();
});

// ── cross-chat messaging slice 2: a run's record in the real panel (the run chip, the forwarded painter, U7) ─────────
test('a run record decorates its chip into a run chip and forwards paintRunQuestion; U7 a typed draft survives a row rebuild while the question stays open', async () => {
  const TID = 'ask_00000002';
  const Q = { askId: 'questions-x:n_plan:1-r1', kind: 'questions', questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'], allowFreeText: true }], state: 'open', answer: null };
  const BLOCK = { kind: 'chat-message', id: 'cmsg_0000beef', direction: 'in', intent: 'question', text: '1. Which storage?', conversationId: 'cxm_0000beef',
    hop: 1, maxHops: 6, replyTo: null, repliedWith: null,
    from: { kind: 'run', runId: 'aaaaaaaa', liveRunId: '11111111-2222-3333-4444-555555555555', title: 'Fix login', scope: { kind: 'project', key: 'k1', label: 'worca-cc' }, owner: null },
    to: { chatId: TID, title: 'T' }, sentAt: 't', question: Q };
  const row = (b, createdAt = 't') => ({ id: 'askm_s0000002', threadId: TID, seq: 1, role: 'system', text: 'Message from run aaaaaaaa (Question, untrusted)', blocks: [b], status: null, createdAt });
  const resolves = [];
  const painted = [];
  const paintRunQuestion = (ref, host) => {
    painted.push(ref);
    const panel = host.querySelector('.qpanel');
    if (!panel.querySelector('textarea')) { panel.classList.remove('hidden'); panel.appendChild(host.ownerDocument.createElement('textarea')); }
    return true;
  };
  const ctx = makePanel({ deps: { paintRunQuestion }, fetchHandler: (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
        messages: [row(BLOCK)], attachments: [], runLinks: [], worktrees: [], inFlight: null }) };
    }
    if (url === '/api/ask/refs/resolve') {
      const body = JSON.parse(opts.body);
      resolves.push(body);
      return { ok: true, status: 200, json: async () => ({ refs: Object.fromEntries(body.refs.filter((r) => r === 'run:aaaaaaaa').map((r) => [r, { ok: true, kind: 'run', id: 'aaaaaaaa', runId: null, title: 'Fix login', status: 'running', home: 'k1' }])) }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  for (let i = 0; i < 8; i++) await ctx.tick();
  ctx.flush();
  const rec = ctx.doc.querySelector('.ask-msg-system .ask-chat-msg.ask-chat-msg-in');
  assert.ok(rec);
  assert.ok(resolves.some((b) => b.refs.includes('run:aaaaaaaa')), 'the bare run id went to the ref chips');
  for (let i = 0; i < 4; i++) await ctx.tick();
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-msg-system .ask-chat-msg-head a.ask-ref-chip-run'), 'decorated into a run chip');
  assert.deepEqual(painted[0], { runId: BLOCK.from.liveRunId, pipelineId: 'aaaaaaaa', askId: Q.askId }, 'the panel forwards its painter');
  ctx.doc.querySelector('.ask-chat-msg-q .qpanel textarea').value = 'my draft';

  // U7: the same row comes again with the question still open (another field changed, so the row itself rebuilds).
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: row(BLOCK, 't2') });
  ctx.flush(); await ctx.tick(); ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-chat-msg-q .qpanel textarea')?.value, 'my draft', 'the draft survives');

  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: row({ ...BLOCK, question: { ...Q, state: 'answered', answer: { actedBy: { kind: 'person', label: 'ada@x' }, answers: [], at: 't' } } }, 't3') });
  ctx.flush(); await ctx.tick(); ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-chat-msg-q .qpanel'), null, 'the form is gone');
  assert.equal(ctx.doc.querySelector('.ask-chat-msg-q [role="status"]').textContent, 'Answered by ada@x');
  ctx.panel.destroy();
});
