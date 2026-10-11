// test/ask-panel-launcher.test.mjs — the collapsed launcher: a round icon button (.ask-pill) with a
// tooltip (role="tooltip") and an unread dot. Look and motion are CSS (pinned by ui-ask-style.test.mjs);
// this suite pins the markup, the accessible names and WHEN the tooltip and the dot show.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { makePanel, key } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function snapBody() {
  return {
    thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null,
  };
}
const listRow = { id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false };
const handler = (url) => {
  if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapBody() };
  if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [listRow] }) };
  return { ok: true, status: 200, json: async () => ({}) };
};

// Open the sheet on the one thread (so frames for it are applied), then collapse it.
async function collapsedOnThread(overrides = {}) {
  const ctx = makePanel({ fetchHandler: handler, ...overrides });
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
  ctx.panel.close();
  ctx.pill = ctx.doc.querySelector('.ask-pill');
  ctx.tip = ctx.doc.querySelector('[role="tooltip"]');
  return ctx;
}
const turn = (end) => [
  { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 },
  { type: 'ask-delta', text: 'partial', threadId: TID, messageId: MID, seq: 2 },
  end,
];
const done = { type: 'ask-done', threadId: TID, messageId: MID, seq: 3 };
const err = { type: 'ask-error', message: 'boom', errorClass: null, threadId: TID, messageId: MID, seq: 3 };
const push = (ctx, frames) => { for (const f of frames) ctx.panel.pushServerFrame(f); ctx.flush(); };
const shown = (tip) => tip.classList.contains('is-shown');

test('launcher: the button is named, keeps its label text and carries no shortcut chip', async () => {
  await checkRows([
    { name: 'launcher: aria-label "Ask Worca", the label text stays in the DOM (visually hidden), the kbd chip is not on the face', run: async () => {
      const { doc } = makePanel();
      const pill = doc.querySelector('.ask-pill');
      assert.equal(pill.getAttribute('aria-label'), 'Ask Worca');
      assert.equal(pill.querySelector('.ask-pill-label').textContent, 'Ask Worca');
      assert.equal(pill.querySelector('.ask-kbd'), null, 'the chip moved into the tooltip');
    } },
  ]);
});

test('launcher: tooltip — role, link, text, platform shortcut, show/hide', async () => {
  await checkRows([
    { name: 'launcher: tooltip is role=tooltip and only names the button — no shortcut chip, no aria-describedby (off Mac)', run: async () => {
      const { doc } = makePanel();
      const pill = doc.querySelector('.ask-pill');
      const tip = doc.querySelector('[role="tooltip"]');
      assert.ok(tip);
      assert.ok(tip.id);
      assert.equal(pill.getAttribute('aria-describedby'), null, 'aria-label already names it');
      assert.ok(!pill.contains(tip), 'a sibling of the button, not inside its face');
      assert.equal(tip.textContent, 'Ask Worca');
      assert.equal(tip.querySelector('.ask-kbd'), null);
      assert.equal(shown(tip), false, 'hidden at rest');
    } },
    { name: 'launcher: no shortcut in the tooltip on a Mac either', run: async () => {
      const { doc } = makePanel({ platform: 'MacIntel' });
      assert.equal(doc.querySelector('[role="tooltip"]').textContent, 'Ask Worca');
      assert.doesNotMatch(doc.querySelector('.ask-dock').textContent, /⌘|Ctrl/);
    } },
    { name: 'launcher: focus shows the tooltip at once; Escape hides it', run: async () => {
      const { doc, window } = makePanel();
      const pill = doc.querySelector('.ask-pill');
      const tip = doc.querySelector('[role="tooltip"]');
      pill.focus();
      assert.equal(shown(tip), true);
      key(window, pill, 'Escape');
      assert.equal(shown(tip), false);
    } },
    { name: 'launcher: blur hides it', run: async () => {
      const { doc } = makePanel();
      const pill = doc.querySelector('.ask-pill');
      const tip = doc.querySelector('[role="tooltip"]');
      pill.focus();
      pill.blur();
      assert.equal(shown(tip), false);
    } },
    { name: 'launcher: hover shows it after 400ms, not before; leaving cancels or hides', run: async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const { doc, window } = makePanel();
        const pill = doc.querySelector('.ask-pill');
        const tip = doc.querySelector('[role="tooltip"]');
        pill.dispatchEvent(new window.Event('pointerenter'));
        mock.timers.tick(399);
        assert.equal(shown(tip), false);
        mock.timers.tick(1);
        assert.equal(shown(tip), true);
        pill.dispatchEvent(new window.Event('pointerleave'));
        assert.equal(shown(tip), false);
        pill.dispatchEvent(new window.Event('pointerenter'));
        mock.timers.tick(200);
        pill.dispatchEvent(new window.Event('pointerleave'));
        mock.timers.tick(1000);
        assert.equal(shown(tip), false, 'leaving before the delay cancels it');
      } finally { mock.timers.reset(); }
    } },
    { name: 'launcher: click hides it and opens the sheet', run: async () => {
      const { doc, panel } = makePanel();
      const pill = doc.querySelector('.ask-pill');
      const tip = doc.querySelector('[role="tooltip"]');
      pill.focus();
      assert.equal(shown(tip), true);
      pill.click();
      assert.equal(shown(tip), false);
      assert.equal(panel.isOpen(), true);
    } },
    { name: 'launcher: ⌘K and Ctrl K no longer open the sheet', run: async () => {
      const { panel, window } = makePanel();
      key(window, null, 'k', { metaKey: true });
      assert.equal(panel.isOpen(), false);
      key(window, null, 'k', { ctrlKey: true });
      assert.equal(panel.isOpen(), false);
    } },
  ]);
});

test('launcher: unread dot — set by a turn that ends while closed, cleared on open', async () => {
  await checkRows([
    { name: 'launcher: ask-done while closed sets .has-unread and "Ask Worca, new reply"; opening clears both', run: async () => {
      const ctx = await collapsedOnThread();
      assert.equal(ctx.pill.classList.contains('has-unread'), false);
      push(ctx, turn(done));
      assert.equal(ctx.pill.classList.contains('has-unread'), true);
      assert.equal(ctx.pill.getAttribute('aria-label'), 'Ask Worca, new reply');
      ctx.pill.click();
      assert.equal(ctx.pill.classList.contains('has-unread'), false);
      assert.equal(ctx.pill.getAttribute('aria-label'), 'Ask Worca');
    } },
    { name: 'launcher: ask-error while closed sets it too', run: async () => {
      const ctx = await collapsedOnThread();
      push(ctx, turn(err));
      assert.equal(ctx.pill.classList.contains('has-unread'), true);
      assert.equal(ctx.pill.getAttribute('aria-label'), 'Ask Worca, new reply');
    } },
    { name: 'launcher: a turn that ends while the sheet is open never sets it', run: async () => {
      const ctx = await collapsedOnThread();
      ctx.panel.open();
      push(ctx, turn(done));
      ctx.panel.close();
      assert.equal(ctx.pill.classList.contains('has-unread'), false);
      assert.equal(ctx.pill.getAttribute('aria-label'), 'Ask Worca');
    } },
    { name: 'launcher: panel.open() clears it too (openSheet is the one place)', run: async () => {
      const ctx = await collapsedOnThread();
      push(ctx, turn(done));
      ctx.panel.open();
      assert.equal(ctx.pill.classList.contains('has-unread'), false);
    } },
  ]);
});
