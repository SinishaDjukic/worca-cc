// test/ask-panel-live-meters.test.mjs — the footer moves WHILE a turn streams:
// agent blocks bump "N agents", ask-usage's estimate shows "≈$", the run-info
// popover re-renders in place, and an out-of-turn frame never resets the clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';

const snap = (totals = {}) => ({
  thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals },
  messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }],
  attachments: [], runLinks: [], inFlight: null, worktrees: [],
});
const handler = (body) => (url, opts) => {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => body };
  return { ok: true, status: 200, json: async () => ({ threads: [] }) };
};
const agent = (id, status) => ({ kind: 'agent', id, label: 'count runs', type: 'general-purpose', model: null, tokens: null, ctx: null, usage: null, costUsd: null, estimated: true, status, durationMs: null, log: [] });
const start = { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' };

async function openLoaded(body, overrides = {}) {
  const ctx = makePanel({ fetchHandler: handler(body), ...overrides });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush();
  return ctx;
}

test('ask-panel-live-meters: an agent ask-block bumps "N agents" before ask-done; ask-done does not double count', async () => {
  const ctx = await openLoaded(snap({ costUsd: 0.5, turns: 1, agents: 1 }));
  const label = () => ctx.doc.querySelector('[data-ask-agents-btn]').textContent;
  assert.match(label(), /1 agent\b/);
  const frames = stampFrames([
    start,
    { type: 'ask-block', block: agent('toolu_a1', 'running') },
    { type: 'ask-block', block: agent('toolu_a1', 'running') },
    { type: 'ask-block', block: agent('toolu_a2', 'running') },
    { type: 'ask-done', text: 'ok', blocks: [agent('toolu_a1', 'done'), agent('toolu_a2', 'done')], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.1, durationMs: 5, model: 'm', status: 'done',
      threadTotals: { costUsd: 0.6, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 2, agents: 3 } },
  ], { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(frames[0]); ctx.panel.pushServerFrame(frames[1]); ctx.flush();
  assert.match(label(), /2 agents/, 'counted the moment its block streams');
  ctx.panel.pushServerFrame(frames[2]); ctx.panel.pushServerFrame(frames[3]); ctx.flush();
  assert.match(label(), /3 agents/, 'a re-emitted block counts once');
  ctx.panel.pushServerFrame(frames[4]); ctx.flush();
  assert.match(label(), /3 agents/, 'the server total replaces the live sum — no double count');
});

test('ask-panel-live-meters: the cost meter shows "≈" total+estimate while streaming, then the authoritative figure', async () => {
  const ctx = await openLoaded(snap({ costUsd: 0.25, turns: 1, agents: 0 }));
  const cost = () => ctx.doc.querySelector('.ask-meter-cost').textContent;
  assert.equal(cost(), '$0.25');
  const u = (output) => ({ input: 12, output, cacheRead: 0, cacheCreation: 0, ctx: 12 + output });
  const frames = stampFrames([
    start,
    { type: 'ask-usage', usage: u(300), costUsd: null, estimatedCostUsd: null },
    { type: 'ask-usage', usage: u(600), costUsd: null, estimatedCostUsd: 0.0151 },
    { type: 'ask-usage', usage: u(600), costUsd: 0.02, estimatedCostUsd: null },
    { type: 'ask-done', text: 'ok', blocks: [], usage: u(600), costUsd: 0.02, durationMs: 5, model: 'm', status: 'done',
      threadTotals: { costUsd: 0.27, input: 12, output: 600, cacheRead: 0, cacheCreation: 0, ctx: 612, turns: 2, agents: 0 } },
  ], { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(frames[0]); ctx.panel.pushServerFrame(frames[1]); ctx.flush();
  assert.equal(cost(), '$0.25', 'no estimate yet (unknown model) → the stored total, no ≈');
  ctx.panel.pushServerFrame(frames[2]); ctx.flush();
  assert.equal(cost(), '≈$0.27', 'stored total + live estimate, marked approximate');
  ctx.panel.pushServerFrame(frames[3]); ctx.flush();
  assert.equal(cost(), '≈$0.27', 'the CLI figure for the turn — still an in-progress total');
  ctx.panel.pushServerFrame(frames[4]); ctx.flush();
  assert.equal(cost(), '$0.27', 'ask-done: the authoritative thread total, no ≈');
});

test('ask-panel-live-meters: an open "Agents this chat" popover follows agent blocks in place', async () => {
  const ctx = await openLoaded(snap({ costUsd: 0, turns: 0, agents: 0 }));
  ctx.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-runinfo');
  assert.match(pop.textContent, /No agents spawned yet\./);
  const frames = stampFrames([
    start,
    { type: 'ask-block', block: agent('toolu_a1', 'running') },
    { type: 'ask-block', block: { ...agent('toolu_a1', 'done'), costUsd: 0.62, ctx: 11600 } },
  ], { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(frames[0]); ctx.panel.pushServerFrame(frames[1]); ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-pop-runinfo'), pop, 'same panel — rebuilt in place, not reopened');
  assert.match(pop.textContent, /count runs/);
  assert.ok(pop.querySelector('.ask-dot-run'), 'running dot');
  ctx.panel.pushServerFrame(frames[2]); ctx.flush();
  assert.ok(pop.querySelector('.ask-dot-done'), 'done dot');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '≈$0.62');
});

test('ask-panel-live-meters: an out-of-turn frame mid-turn (ask-title arrives early now) never resets the elapsed clock', async () => {
  let t = 1_000_000;
  const ctx = await openLoaded(snap(), { now: () => t });
  ctx.panel.pushServerFrame({ ...start, startedAt: new Date(t).toISOString(), threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  t += 6400;
  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: TID, title: 'Early Title' });
  ctx.panel.pushServerFrame({ type: 'ask-worktrees', threadId: TID, worktrees: [] });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Early Title');
  assert.match(ctx.doc.querySelector('.ask-thinking-meter').textContent, /^6\.4s/, 'the clock kept counting from ask-start');
});
