// test/ask-panel-ctx-popover.test.mjs — the composer's context popover: window fill + the chat's topics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtShare, ctxBreakdown, groupContexts } from '../ui/public/ask-panel.mjs';
import { makePanel, openChat } from './helpers/ask-panel-harness.mjs';
import { checkRows } from './helpers/rows.mjs';

test('pure: groupContexts, fmtShare and ctxBreakdown', async () => {
  await checkRows([
    { name: 'fmtShare: one decimal of the window; null without a window', run: async () => {
      assert.equal(fmtShare(120400, 1000000), '12.0%');
      assert.equal(fmtShare(33000, 1000000), '3.3%');
      assert.equal(fmtShare(0, 200000), '0.0%');
      assert.equal(fmtShare(230000, 200000), '115.0%', 'not clamped');
      assert.equal(fmtShare(1000, null), null);
      assert.equal(fmtShare(NaN, 200000), null);
    } },
    { name: 'ctxBreakdown: used / buffer / free / until compaction, with level and percent', run: async () => {
      assert.deepEqual(ctxBreakdown(120400, 1000000),
        { used: 120400, buffer: 33000, free: 846600, untilCompact: 846600, pct: 12, level: 'ok' });
      assert.deepEqual(ctxBreakdown(76200, 200000),
        { used: 76200, buffer: 33000, free: 90800, untilCompact: 90800, pct: 38, level: 'ok' });
      assert.deepEqual(ctxBreakdown(230000, 200000),
        { used: 230000, buffer: 33000, free: 0, untilCompact: 0, pct: 115, level: 'high' }, 'over the window: nothing free');
      assert.equal(ctxBreakdown(40000, 50000).buffer, 0, 'a window too small for the buffer has none');
      assert.equal(ctxBreakdown(68400, null), null, 'unknown window');
      assert.equal(ctxBreakdown(0, 200000), null, 'no fill');
    } },
    { name: 'groupContexts: page topics vs mentioned, order kept, junk dropped', run: async () => {
      const p = { kind: 'project', id: 'p1', label: 'P' };
      const m = { kind: 'run', id: 'r1', label: 'R', home: 'p1', source: 'chat' };
      const w = { kind: 'workspace', id: 'w1', label: 'W', pinned: true };
      assert.deepEqual(groupContexts([p, m, null, { kind: 'run' }, w]), { asked: [p, w], mentioned: [m] });
      assert.deepEqual(groupContexts(undefined), { asked: [], mentioned: [] });
    } },
  ]);
});

// ── the trigger and the popover ──────────────────────────────────────────────
const TID = 'ask_0000c0de';
const T = (over) => ({ costUsd: 0.1, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0, ...over });
const thread = (over = {}) => ({
  id: TID, title: 'A chat', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  model: null, effort: null, sessionId: null, context: null, contexts: [], totals: T({ ctx: 120400, ctxWindow: 1000000 }), createdBy: null, ...over,
});
const ok = (body, status = 200) => ({ ok: true, status, json: async () => body });
function handler(state) {
  return (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (url === '/api/ask/threads?limit=50') return ok({ threads: [state.thread], total: 1 });
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return ok({ thread: state.thread, messages: [], attachments: [], runLinks: [], worktrees: { items: [] }, inFlight: null });
    }
    return ok({});
  };
}
async function openThread(ctx) {
  await openChat(ctx, TID);
  await ctx.tick();
}

const arc = (btn) => btn.querySelector('.ask-ctx-ring-arc').getAttribute('stroke-dasharray');

const openCtx = (ctx) => { ctx.doc.querySelector('[data-ask-ctx-btn]').click(); return ctx.doc.querySelector('.ask-pop-ctx'); };
const stats = (pop) => [...pop.querySelectorAll('.ask-ctx-stat')].map((r) => [
  r.dataset.stat, r.querySelector('.ask-ctx-stat-name').textContent,
  r.querySelector('.ask-ctx-stat-tokens').textContent, r.querySelector('.ask-ctx-stat-share').textContent]);

test('popover body: caption, bar and Used / buffer / Free rows; over the window, a small window (no buffer) and an unknown window (fill only)', async () => {
  await checkRows([
    { name: 'popover: caption, bar, Used / Autocompact buffer / Free space, until auto-compact', run: async () => {
      const ctx = makePanel({ fetchHandler: handler({ thread: thread() }) });
      await openThread(ctx);
      const pop = openCtx(ctx);
      assert.equal(pop.getAttribute('aria-label'), 'Context window');
      assert.equal(pop.querySelector('.ask-pop-caption').textContent, 'Context window');
      assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '120.4k / 1M (12%)');
      const bar = pop.querySelector('.ask-ctx-bar');
      assert.equal(bar.getAttribute('aria-hidden'), 'true');
      assert.equal(bar.querySelector('.ask-ctx-bar-used').style.width, '12.04%');
      assert.equal(bar.querySelector('.ask-ctx-bar-buffer').style.width, '3.3%');
      assert.deepEqual(stats(pop), [
        ['used', 'Used', '120.4k', '12.0%'],
        ['buffer', 'Autocompact buffer', '33.0k', '3.3%'],
        ['free', 'Free space', '846.6k', '84.7%'],
      ]);
      assert.equal(pop.querySelector('.ask-ctx-foot').textContent, '846.6k until auto-compact');
      assert.equal(pop.querySelector('.ask-ctx-hint'), null, 'under 200k: no re-send hint');
      ctx.panel.destroy();
    } },
    { name: 'popover: over the window — Used past 100%, nothing free, bar clamped, compaction soon, re-send hint', run: async () => {
      const ctx = makePanel({ fetchHandler: handler({ thread: thread({ totals: T({ ctx: 230000, ctxWindow: 200000 }) }) }) });
      await openThread(ctx);
      const pop = openCtx(ctx);
      assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '230.0k / 200k (115%)');
      assert.equal(pop.querySelector('.ask-ctx-bar-used').style.width, '100%');
      assert.ok(pop.querySelector('.ask-ctx-bar-used').classList.contains('is-ctx-high'));
      assert.equal(pop.querySelector('.ask-ctx-bar-buffer'), null, 'no window left to hatch: the buffer never draws over the fill');
      assert.deepEqual(stats(pop).map((r) => r[3]), ['115.0%', '16.5%', '0.0%']);
      const foot = pop.querySelector('.ask-ctx-foot');
      assert.equal(foot.textContent, 'Compaction soon');
      assert.ok(foot.classList.contains('is-ctx-high'));
      assert.equal(pop.querySelector('.ask-ctx-hint').textContent, 'Each message re-sends about 230.0k tokens.');
      ctx.panel.destroy();
    } },
    { name: 'popover: a small window has no buffer row', run: async () => {
      const ctx = makePanel({ fetchHandler: handler({ thread: thread({ totals: T({ ctx: 10000, ctxWindow: 50000 }) }) }) });
      await openThread(ctx);
      assert.deepEqual(stats(openCtx(ctx)).map((r) => r[0]), ['used', 'free']);
      ctx.panel.destroy();
    } },
    { name: 'popover: window unknown — fill alone in the caption, one line, no bar or rows', run: async () => {
      for (const [totals, caption] of [[T({ ctx: 68400 }), '68.4k'], [T({}), ''], [{}, '']]) {
        const ctx = makePanel({ fetchHandler: handler({ thread: thread({ totals }) }) });
        await openThread(ctx);
        const pop = openCtx(ctx);
        assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, caption);
        assert.equal(pop.querySelector('.ask-pop-empty').textContent, 'The window shows after the first answer.');
        assert.equal(pop.querySelector('.ask-ctx-bar'), null);
        assert.equal(pop.querySelectorAll('.ask-ctx-stat').length, 0);
        assert.equal(pop.querySelector('.ask-ctx-foot'), null);
        ctx.panel.destroy();
      }
    } },
  ]);
});

test('popover: follows the streaming fill without reopening', async () => {
  const ctx = makePanel({ fetchHandler: handler({ thread: thread() }) });
  await openThread(ctx);
  const pop = openCtx(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-start', threadId: TID, messageId: 'msg_00000002', seq: 1, userMessageId: 'msg_00000001', model: 'm', effort: 'high', startedAt: 't' });
  ctx.panel.pushServerFrame({ type: 'ask-usage', threadId: TID, messageId: 'msg_00000002', seq: 2, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 250000 }, costUsd: null });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-pop-ctx'), pop, 'same node');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '250.0k / 1M (25%)');
  ctx.panel.destroy();
});
