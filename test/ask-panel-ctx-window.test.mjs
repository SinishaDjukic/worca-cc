// test/ask-panel-ctx-window.test.mjs — the context meter against the model's window: text, level, hover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { fmtCtx, fmtWindow, ctxTrigger, ctxLevel, ctxPercent, ctxTitle } from '../ui/public/ask-panel.mjs';
import { checkRows } from './helpers/rows.mjs';

test('ctx formatting: fmtCtx/fmtWindow/ctxTrigger/ctxPercent, ctxLevel thresholds and ctxTitle', async () => {
  await checkRows([
    { name: 'fmtCtx: one argument is unchanged; a window adds "/ <window>"', run: async () => {
      assert.equal(fmtCtx(61212), '61.2k ctx');
      assert.equal(fmtCtx(313), '313 ctx');
      assert.equal(fmtCtx(0), null);
      assert.equal(fmtCtx(214400, 1000000), '214.4k / 1M ctx');
      assert.equal(fmtCtx(76200, 200000), '76.2k / 200k ctx');
      assert.equal(fmtCtx(76200, 0), '76.2k ctx', 'a garbage window is unknown');
      assert.equal(fmtCtx(76200, '200000'), '76.2k ctx');
    } },
    { name: 'fmtWindow / ctxTrigger / ctxPercent', run: async () => {
      assert.equal(fmtWindow(1000000), '1M');
      assert.equal(fmtWindow(1500000), '1.5M');
      assert.equal(fmtWindow(200000), '200k');
      assert.equal(fmtWindow(-1), null);
      assert.equal(ctxTrigger(1000000), 967000);
      assert.equal(ctxTrigger(200000), 167000);
      assert.equal(ctxTrigger(50000), 50000, 'a window too small for the buffer: the window itself');
      assert.equal(ctxPercent(214400, 1000000), 21);
      assert.equal(ctxPercent(230000, 200000), 115, 'past the window after a model switch: no clamp');
      assert.equal(ctxPercent(214400, null), null);
    } },
    { name: 'ctxLevel: 75% / 90% of the compaction trigger, for both window sizes', run: async () => {
      assert.equal(ctxLevel(125000, 200000), 'ok', '125k / 167k = 74.9%: just under amber');
      assert.equal(ctxLevel(124000, 200000), 'ok');
      assert.equal(ctxLevel(126000, 200000), 'warn');
      assert.equal(ctxLevel(151000, 200000), 'high');
      assert.equal(ctxLevel(214400, 1000000), 'ok', 'the screenshot case: 21% of 1M is fine');
      assert.equal(ctxLevel(724000, 1000000), 'ok');
      assert.equal(ctxLevel(726000, 1000000), 'warn');
      assert.equal(ctxLevel(871000, 1000000), 'high');
      assert.equal(ctxLevel(230000, 200000), 'high', 'past the window');
      assert.equal(ctxLevel(100000, null), null, 'unknown window: no level');
      assert.equal(ctxLevel(0, 200000), null);
    } },
    { name: 'ctxTitle: share + trigger; red says compaction soon; the re-send hint from 200k with or without a window', run: async () => {
      assert.equal(ctxTitle(214400, 1000000), '21% of the 1M context window. Automatic compaction starts around 967k. Each message re-sends about 214.4k tokens.');
      assert.equal(ctxTitle(76200, 200000), '38% of the 200k context window. Automatic compaction starts around 167k.');
      assert.match(ctxTitle(155000, 200000), /^Compaction soon\. 78% of the 200k/);
      assert.equal(ctxTitle(250000, null), 'Each message re-sends about 250.0k tokens.');
      assert.equal(ctxTitle(61212, null), null, 'legacy, small: no title at all');
    } },
  ]);
});

// ── rendering ────────────────────────────────────────────────────────────────
const TID = 'ask_00000001';
const MID = 'askm_00000001';
function apiHandler() {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    }
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
async function sendAndFinish(ctx, done) {
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'meter me';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-done', text: 'ok', blocks: [], usage: done.usage, costUsd: 0.1, durationMs: 5, model: 'm', status: 'done', threadTotals: done.totals },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  return ctx.doc.querySelector('[data-ask-ctx-btn]');
}
const arc = (m) => m.querySelector('.ask-ctx-ring-arc').getAttribute('stroke-dasharray');
const T = (over) => ({ costUsd: 0.1, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0, ...over });

test('composer ring: arc = fill / window with the hover text, amber at 75% and red at 90% of the trigger, empty without a window', async () => {
  await checkRows([
    { name: 'composer ring: arc = fill / window, "fill / window ctx · N%" in the hover, coloured by level', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      const m = await sendAndFinish(ctx, { usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 214400, ctxWindow: 1000000 }, totals: T({ ctx: 214400, ctxWindow: 1000000 }) });
      assert.equal(m.title, '214.4k / 1M ctx · 21%');
      assert.equal(arc(m), '21.44 100');
      assert.ok(!m.classList.contains('is-ctx-warn') && !m.classList.contains('is-ctx-high'));
      assert.equal(m.getAttribute('aria-label'), 'Context window, 21% full');
      ctx.panel.destroy();
    } },
    { name: 'composer ring: amber at 75% and red at 90% of the trigger on a 200k window', run: async () => {
      let ctx = makePanel({ fetchHandler: apiHandler() });
      let m = await sendAndFinish(ctx, { usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 130000, ctxWindow: 200000 }, totals: T({ ctx: 130000, ctxWindow: 200000 }) });
      assert.ok(m.classList.contains('is-ctx-warn'));
      ctx.panel.destroy();
      ctx = makePanel({ fetchHandler: apiHandler() });
      m = await sendAndFinish(ctx, { usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 230000, ctxWindow: 200000 }, totals: T({ ctx: 230000, ctxWindow: 200000 }) });
      assert.ok(m.classList.contains('is-ctx-high') && !m.classList.contains('is-ctx-warn'));
      assert.equal(m.title, '230.0k / 200k ctx · 115%', 'past the window after a model switch: shown, not clamped');
      assert.equal(arc(m), '100 100', 'the ring itself stops at full');
      ctx.panel.destroy();
    } },
    { name: 'composer ring: a thread with no window keeps an empty ring (no %, no level class)', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      const m = await sendAndFinish(ctx, { usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 68400 }, totals: T({ ctx: 68400 }) });
      assert.equal(m.title, '68.4k ctx');
      assert.equal(m.className, 'btn btn-sm btn-quiet btn-icon ask-ctx-ring');
      assert.equal(arc(m), '0 100');
      ctx.panel.destroy();
    } },
  ]);
});
