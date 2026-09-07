// test/ask-panel-column.test.mjs — the content cap: every message lands in the
// centred .ask-transcript-col (the scrollport stays .ask-transcript), the
// composer controls sit inside the rounded .ask-composer-box, and the composer
// popovers stay children of the sheet, CSS-anchored to the box's inset.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

const userRow = (id, seq, text) => ({ id, threadId: TID, seq, role: 'user', text, blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const asstRow = (id, seq, over = {}) => ({ id, threadId: TID, seq, role: 'assistant', text: 'the answer', blocks: [], status: 'done', reason: null, model: 'claude-opus-5', effort: 'high', usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0, ctx: 2000 }, costUsd: 0.14, durationMs: 6400, createdAt: 't', ...over });

const CARD = { target: 'project', projectKey: 'demo-00000001', projectName: 'Demo', projectDir: '/p/demo', workspaceId: null, workspaceName: null, members: null, workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'do it', title: 'Do it', sourceBranch: null, featureBranch: 'x/do-it-00000001', sourceBranchByKey: null };

function snapBody(messages) {
  return {
    thread: { id: TID, title: 'My thread', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages, attachments: [], runLinks: [], worktrees: [], inFlight: null,
  };
}

function handler(state) {
  return (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true }] }) };
    if (url === '/api/workflows' || url === '/api/guardrails' || url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workflows: [], guardrails: [], workspaces: [] }) };
    if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => state.snap };
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      state.bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

function openStored(state) {
  const ctx = makePanel({ fetchHandler: handler(state) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  return ctx;
}

test('ask-panel-column: every rendered row lands in .ask-transcript-col; .ask-transcript stays the scrollport', async () => {
  const state = { bodies: [], snap: snapBody([
    userRow('askm_u0000001', 1, 'hello'),
    asstRow('askm_00000001', 2, { blocks: [
      { kind: 'tool', id: 'toolu_1', name: 'Read', input: { file_path: '/p/demo/a.js' }, status: 'done', durationMs: 10 },
      { kind: 'card', id: 'card_00000001', state: 'proposed', card: CARD },
    ] }),
    asstRow('askm_00000002', 3, { text: '', status: 'error', reason: 'boom' }),
  ]) };
  const ctx = openStored(state);
  await ctx.tick(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  const t = ctx.doc.querySelector('.ask-transcript');
  assert.ok(t.hasAttribute('data-ask-scroll'), 'the scroll hook stays on the scrollport');
  const col = t.querySelector(':scope > .ask-transcript-col');
  assert.ok(col, 'the column is a direct child of the scrollport');
  assert.equal(t.children.length, 1, 'and its only child — nothing renders beside it');
  const rows = [...ctx.doc.querySelectorAll('.ask-msg')];
  assert.equal(rows.length, 3, 'three rows rendered');
  for (const r of rows) assert.equal(r.parentElement, col, 'each row is a direct child of the column');
  assert.ok(ctx.doc.querySelector('.ask-msg-user .ask-user-bubble'), 'the user bubble is inside its row (align-self:flex-end → the column\'s right edge)');
  assert.ok(col.contains(ctx.doc.querySelector('.ask-card.ask-rp')), 'the run-proposal card is inside the column');
  assert.ok(col.contains(ctx.doc.querySelector('.ask-activity')), 'the activity block is inside the column');
  // the scroll-pin logic still reads the scrollport, not the column
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  t.scrollTop = 0;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false, 'scrolling the scrollport still drives the jump pill');
  assert.equal(ctx.doc.querySelector('.ask-jump').parentElement, ctx.doc.querySelector('.ask-sheet'), 'the pill stays a sheet child (CSS-anchored above the box)');
  ctx.panel.destroy();
});

test('ask-panel-column: a message sent from the composer renders into the column, not beside it', async () => {
  const state = { bodies: [], snap: snapBody([asstRow('askm_00000001', 1)]) };
  const ctx = openStored(state);
  await ctx.tick(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  ctx.doc.querySelector('textarea.ask-input').value = 'follow-up';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  assert.equal(state.bodies.length, 1, 'the message was posted');
  const col = ctx.doc.querySelector('.ask-transcript > .ask-transcript-col');
  const sent = [...ctx.doc.querySelectorAll('.ask-msg-user')].find((r) => /follow-up/.test(r.textContent));
  assert.ok(sent, 'the typed row rendered');
  assert.equal(sent.parentElement, col, 'inside the column');
  assert.equal(ctx.doc.querySelector('.ask-transcript').children.length, 1, 'still nothing beside the column');
  ctx.panel.destroy();
});

test('ask-panel-column: the composer controls live inside .ask-composer-box, in the old order, with their data-ask hooks', () => {
  const ctx = makePanel();
  ctx.panel.open();
  const composer = ctx.doc.querySelector('.ask-composer');
  const box = composer.querySelector(':scope > .ask-composer-box');
  assert.ok(box, 'the box is a direct child of the band');
  assert.equal(composer.children.length, 1, 'and its only child');
  assert.deepEqual([...box.children].map((c) => c.className), ['ask-chips', 'ask-input', 'ask-composer-msg', 'ask-composer-row'], 'chips → textarea → msg → row, all direct children of the box');
  for (const sel of ['[data-ask-attach-btn]', '[data-ask-scope-btn]', '[data-ask-meter]', '[data-ask-wt-btn]', '[data-ask-agents-btn]', '[data-ask-model-btn]', '[data-ask-send]', '[data-ask-stop]']) {
    const n = ctx.doc.querySelector(sel);
    assert.ok(n, `${sel} still exists`);
    assert.equal(n.closest('.ask-composer-box'), box, `${sel} is inside the box`);
    assert.equal(n.closest('.ask-composer-row'), box.lastElementChild, `${sel} is in the footer row`);
  }
  ctx.panel.destroy();
});

test('ask-panel-column: the composer popovers stay children of the sheet (CSS-anchored to the box inset), like the threads popover', async () => {
  const ctx = makePanel({ fetchHandler: handler({ bodies: [], snap: null }) });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  const sheet = ctx.doc.querySelector('.ask-sheet');
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await ctx.tick(); await ctx.tick();
  const scope = ctx.doc.querySelector('.ask-pop-scope');
  assert.ok(scope, 'scope popover opened');
  assert.equal(scope.parentElement, sheet, 'scope popover is a sheet child (max-height:70% = the sheet)');
  assert.equal(scope.closest('.ask-composer'), null, 'not inside the composer band');
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-pop-scope'), null, 'opening another popover closed the first');
  const model = ctx.doc.querySelector('.ask-pop-model');
  assert.ok(model, 'model popover opened');
  assert.equal(model.parentElement, sheet);
  ctx.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx.tick();
  const runinfo = ctx.doc.querySelector('.ask-pop-runinfo');
  assert.ok(runinfo, 'agents popover opened');
  assert.equal(runinfo.parentElement, sheet);
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-pop-threads').parentElement, sheet, 'the threads popover is untouched');
  ctx.panel.destroy();
});
