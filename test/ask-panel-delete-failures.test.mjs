// test/ask-panel-delete-failures.test.mjs
// #555: a failed worktree / chat delete raises one error toast in the panel's OWN
// (injected) document and keeps the item; a successful delete removes it quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, deleteFromList } from './helpers/ask-panel-harness.mjs';
import { checkRows } from './helpers/rows.mjs';

const TID = 'ask_00000001';
const WT = {
  worktreeId: 'wt_00000001', projectKey: 'demo-00000001', ref: 'worca-cc/feat-1',
  commit: 'abcdef1234567890abcdef1234567890abcdef12',
  path: '/home/u/.worca-cc/ask/ask_00000001/wt/wt_00000001', createdAt: '2026-08-24T00:00:00.000Z',
};

// `del` decides the DELETE outcome: 'ok' | 500 | 'throw'.
function handler(state) {
  return (url, opts) => {
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    if (method === 'DELETE') {
      state.deletes += 1;
      if (state.del === 'throw') throw new Error('network down');
      if (state.del !== 'ok') return { ok: false, status: state.del, json: async () => ({ error: 'disk is busy' }) };
      state.deleted = true;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url === `/api/ask/threads/${TID}`) {
      return { ok: true, status: 200, json: async () => ({
        thread: { id: TID, title: 'Stored', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
        messages: [], attachments: [], runLinks: [], inFlight: null,
        worktrees: state.deleted ? [] : [WT],
      }) };
    }
    if (url.startsWith('/api/ask/threads')) {
      return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'Stored', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function settle(ctx) { for (let i = 0; i < 4; i++) await ctx.tick(); ctx.flush(); }

async function boot(state) {
  const ctx = makePanel({ fetchHandler: handler(state), confirm: async () => true });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await settle(ctx);
  return ctx;
}

const errToasts = (ctx) => [...ctx.doc.querySelectorAll('#toasts .toast.err')];

async function trashWorktree(ctx) {
  ctx.doc.querySelector('[data-ask-ctx-btn]').click();
  await settle(ctx);
  ctx.doc.querySelector('.ask-pop-ctx .ask-wt-row .ask-thread-trash').click();
  await settle(ctx);
}

async function wtCount(ctx) {
  ctx.doc.querySelector('[data-ask-ctx-btn]').click();
  await settle(ctx);
  const sec = ctx.doc.querySelector('.ask-pop-ctx .ask-ctx-worktrees');
  return sec ? sec.querySelector('.ask-pop-caption-meter').textContent : null;
}

async function trashThread(ctx) {
  await deleteFromList(ctx, TID);
  await settle(ctx);
}

test('delete worktree: a 500 or a throw keeps the worktree listed with one error toast; a success removes it with none', async () => {
  await checkRows([
    ...[500, 'throw'].map((del) => ({ name: `delete worktree: DELETE ${del} keeps the worktree and raises one error toast in the injected doc`, run: async () => {
      const state = { del, deletes: 0, deleted: false };
      const ctx = await boot(state);
      await trashWorktree(ctx);
      assert.equal(state.deletes, 1);
      const toasts = errToasts(ctx);
      assert.equal(toasts.length, 1, 'one error toast');
      assert.equal(toasts[0].querySelector('.tt').textContent, 'Could not remove the worktree');
      if (del === 500) assert.equal(toasts[0].querySelector('.td').textContent, 'disk is busy');
      assert.equal(await wtCount(ctx), '1', 'worktree still listed');
    } })),
    { name: 'delete worktree: a successful DELETE removes it with no error toast', run: async () => {
      const state = { del: 'ok', deletes: 0, deleted: false };
      const ctx = await boot(state);
      await trashWorktree(ctx);
      assert.equal(errToasts(ctx).length, 0);
      assert.equal(await wtCount(ctx), null, 'no worktrees left');
    } },
  ]);
});

test('delete chat: a 500 or a throw keeps the chat (stored pointer, title) with one error toast; a success clears it with none', async () => {
  await checkRows([
    ...[500, 'throw'].map((del) => ({ name: `delete chat: DELETE ${del} keeps the chat and raises one error toast in the injected doc`, run: async () => {
      const state = { del, deletes: 0, deleted: false };
      const ctx = await boot(state);
      await trashThread(ctx);
      assert.equal(state.deletes, 1);
      const toasts = errToasts(ctx);
      assert.equal(toasts.length, 1, 'one error toast');
      assert.equal(toasts[0].querySelector('.tt').textContent, 'Could not delete the chat');
      assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), TID, 'stored pointer kept');
      assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored', 'still on the chat');
    } })),
    { name: 'delete chat: a successful DELETE clears the chat with no error toast', run: async () => {
      const state = { del: 'ok', deletes: 0, deleted: false };
      const ctx = await boot(state);
      await trashThread(ctx);
      assert.equal(errToasts(ctx).length, 0);
      assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
      assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
    } },
  ]);
});
