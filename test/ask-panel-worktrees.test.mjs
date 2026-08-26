// test/ask-panel-worktrees.test.mjs
// P4/T9: the "N worktrees" button + popover — count from the snapshot, rows,
// manual delete round trip. Harness + frame driving as in the other
// ask-panel-*.test.mjs files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';
const WT = {
  worktreeId: 'wt_00000001', projectKey: 'demo-00000001', ref: 'worca-cc/feat-1',
  commit: 'abcdef1234567890abcdef1234567890abcdef12',
  path: '/home/u/.worca-cc/ask/ask_00000001/wt/wt_00000001', createdAt: '2026-08-24T00:00:00.000Z',
};

function snapshotHandler(state) {
  return (url, opts) => {
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({
        thread: { id: TID, title: 'chat', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
        messages: [], attachments: [], runLinks: [], inFlight: null,
        worktrees: state.deleted ? [] : [WT],
      }) };
    }
    if (url === `/api/ask/threads/${TID}/worktrees/${WT.worktreeId}` && method === 'DELETE') {
      state.deleted = true;
      return { ok: true, status: 200, json: async () => ({ ok: true, steps: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ threads: [] }) };
  };
}

// The harness injects `confirm` as a dep (default: resolve true) and `storage`
// for the stored-thread pointer — key 'worca-cc.ask.thread' (ask-panel.mjs:96).
function seededStorage() {
  const map = new Map([['worca-cc.ask.thread', TID]]);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('worktrees button appears with the count after a thread loads; popover lists rows; trash deletes', async () => {
  const state = { deleted: false };
  const confirms = [];
  const ctx = makePanel({
    fetchHandler: snapshotHandler(state),
    storage: seededStorage(),
    confirm: async (opts) => { confirms.push(opts); return true; },
  });
  ctx.panel.open();                       // ensureFirstOpen → switchThread(TID) → snapshot
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  const btn = ctx.doc.querySelector('[data-ask-wt-btn]');
  assert.ok(btn, 'button exists');
  assert.equal(btn.hidden, false);
  assert.match(btn.textContent, /1 worktree\b/);
  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-worktrees');
  assert.ok(pop, 'popover open');
  assert.match(pop.textContent, /demo-00000001 · worca-cc\/feat-1@abcdef1/);
  assert.match(pop.textContent, /\/wt\/wt_00000001/);
  const trash = pop.querySelector('.ask-wt-row .ask-thread-trash');
  assert.ok(trash, 'per-row trash');
  trash.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(confirms.length, 1, 'confirm dialog invoked');
  assert.match(confirms[0].message, /branches are untouched/);
  assert.equal(state.deleted, true, 'DELETE was issued');
  assert.equal(ctx.doc.querySelector('[data-ask-wt-btn]').hidden, true, 'count back to 0 hides the button');
});

test('turn end refetches worktrees (count refresh on ask-done)', async () => {
  // Without the afterFrame hook, a turn that created a worktree leaves a stale
  // count. Drive a CLEAN, stamped ask-start → ask-done turn (NO seq gap) and assert
  // a SECOND snapshot GET. The clean seq is load-bearing: `pushServerFrame` early-
  // returns unless `frame.threadId === st.threadId` and only runs `afterFrame` after
  // a successful `st.model.apply(frame)`, and a seq GAP would trigger resync()→
  // loadThread()→a snapshot GET that satisfies the assertion WITHOUT refreshWorktrees
  // (a vacuous green).
  const state = { deleted: false, snapshots: 0 };
  const inner = snapshotHandler(state);
  const handler = (url, opts) => {
    if (url === `/api/ask/threads/${TID}` && (((opts && opts.method) || 'GET').toUpperCase() === 'GET')) state.snapshots += 1;
    return inner(url, opts);
  };
  const ctx = makePanel({ fetchHandler: handler, storage: seededStorage(), confirm: async () => true });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush();
  const before = state.snapshots;
  const MID = 'askm_00000001';
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.panel.pushServerFrame({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: { costUsd: 0, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0 }, threadId: TID, messageId: MID, seq: 2 });
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(state.snapshots, before + 1, 'exactly one refetch from afterFrame — no resync, no double GET');
});

test('cancel at the confirm dialog issues NO delete and leaves the button visible', async () => {
  // The harness confirm defaults to true, so the destructive path is otherwise
  // untested. A confirm→false must NOT fetch DELETE and must keep the worktree.
  const state = { deleted: false };
  const ctx = makePanel({ fetchHandler: snapshotHandler(state), storage: seededStorage(), confirm: async () => false });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush();
  ctx.doc.querySelector('[data-ask-wt-btn]').click();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('.ask-wt-row .ask-thread-trash').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(state.deleted, false, 'cancelled → no DELETE issued');
  assert.equal(ctx.doc.querySelector('[data-ask-wt-btn]').hidden, false, 'worktree still present, button visible');
});
