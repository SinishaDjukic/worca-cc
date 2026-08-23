// test/ask-panel-stream.test.mjs — live frames → DOM (spec §10.5, §10.8).
// Frame streams come from the Task 1 helper; the panel is driven through its
// public pushServerFrame/onHello only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { replayFixture, stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function snapBody(over = {}) {
  return {
    thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null, ...over,
  };
}

function handlerFor(snapshotRef) {
  return (url) => {
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapshotRef.body };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openWith(snapshotRef, overrides = {}) {
  const ctx = makePanel({ fetchHandler: handlerFor(snapshotRef), ...overrides });
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
  return ctx;
}

test('ask-panel-stream: frames for another thread are ignored', async () => {
  // NB this pins the MODEL's filter through the panel path — the panel's own check is unobservable defence-in-depth.
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'not mine', threadId: 'ask_ffffffff', messageId: MID, seq: 1 });
  ctx.flush();
  assert.ok(!ctx.doc.querySelector('.ask-transcript').textContent.includes('not mine'));
});

test('ask-panel-stream: plain-text stream — dot, label, growing answer, done state', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID, threadTotals: { costUsd: 0.02, input: 10, output: 44, cacheRead: 0, cacheCreation: 11290, turns: 1, agents: 0 } });
  const done = frames[frames.length - 1];
  for (const f of frames.slice(0, -1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-dot-run'), 'violet running dot while streaming');
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Thinking|Writing/);
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /pong/);
  ctx.panel.pushServerFrame(done);
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-dot-done'), 'green dot after done');
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Worked for/);
  assert.equal(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'answer finished');
});

test('ask-panel-stream: tool rows stream in with server labels', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('tool-list-runs', { threadId: TID, messageId: MID });
  let sawFindingRuns = false;
  let sawRunningTool = false;
  for (const f of frames) {
    ctx.panel.pushServerFrame(f);
    ctx.flush();
    const label = ctx.doc.querySelector('.ask-activity-label');
    if (label && /Finding runs/.test(label.textContent)) sawFindingRuns = true;
    const note = ctx.doc.querySelector('.ask-tool-note');
    if (note && note.textContent === '…') sawRunningTool = true;
  }
  assert.ok(sawFindingRuns, 'the server label rendered mid-stream');
  assert.ok(sawRunningTool, 'the tool row rendered while running');
  assert.equal(ctx.doc.querySelectorAll('.ask-tool-row').length >= 1, true);
});

test('ask-panel-stream: sub-agent expands mid-stream and stays expanded to the end', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('task-subagent', { threadId: TID, messageId: MID });
  const firstAgentAt = frames.findIndex((f) => f.type === 'ask-block' && f.block.kind === 'agent');
  for (const f of frames.slice(0, firstAgentAt + 1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const row = ctx.doc.querySelector('.ask-agent-row');
  assert.ok(row);
  row.click();
  assert.ok(ctx.doc.querySelector('.ask-agent-log'), 'expanded mid-stream');
  for (const f of frames.slice(firstAgentAt + 1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const log = ctx.doc.querySelector('.ask-agent-log');
  assert.ok(log, 'still expanded after the agent finished');
  assert.match(log.textContent, /→ list_runs/);
  assert.match(ctx.doc.querySelector('.ask-agent-row').textContent, /claude-haiku-4-5/);
});

test('ask-panel-stream: max-turns ends stopped with the notice and Stopped after', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('max-turns', { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Stopped after/);
  assert.match(ctx.doc.querySelector('.ask-notice').textContent, /Stopped: reached the 40-turn limit/);
});

test('ask-panel-stream: ask-error keeps the partial text and shows the red line', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const bare = [
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'partial ' },
    { type: 'ask-delta', text: 'answer' },
    { type: 'ask-error', message: 'claude exited with code 1: boom', errorClass: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /partial answer/);
  assert.match(ctx.doc.querySelector('.ask-error-line').textContent, /claude exited with code 1: boom/);
});

test('ask-panel-stream: a seq gap triggers one REST resync + forced resubscribe', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const getsBefore = ctx.fetchCalls.filter((c) => c.url.startsWith(`/api/ask/threads/${TID}`)).length;
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  // now simulate a mid-stream turn in the snapshot so the resync resubscribes
  ref.body = snapBody({ inFlight: { messageId: MID } });
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'lost', threadId: TID, messageId: MID, seq: 5 });
  await ctx.tick();
  await ctx.tick();
  const getsAfter = ctx.fetchCalls.filter((c) => c.url.startsWith(`/api/ask/threads/${TID}`)).length;
  assert.equal(getsAfter, getsBefore + 1, 'exactly one re-fetch');
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID }, 'resubscribed after the re-fetch');
  // the replay then applies cleanly via adoption
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'recovered', threadId: TID, messageId: MID, seq: 6 });
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /recovered/);
});

test('ask-panel-stream: onHello re-syncs the active running thread on a fresh socket', async () => {
  const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
  const ctx = await openWith(ref);
  const before = ctx.wsSends.length;
  ctx.panel.onHello([{ threadId: TID, messageId: MID }]);
  await ctx.tick();
  await ctx.tick();
  assert.ok(ctx.wsSends.length > before, 'resubscribed');
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID });
  ctx.panel.onHello(undefined); // older server — must not throw
  const gets = ctx.fetchCalls.filter((c) => c.url.startsWith(`/api/ask/threads/${TID}`)).length;
  ctx.panel.onHello([]); // active thread NOT listed (idle) — out-of-turn frames may still be missing
  await ctx.tick();
  await ctx.tick();
  assert.ok(ctx.fetchCalls.filter((c) => c.url.startsWith(`/api/ask/threads/${TID}`)).length > gets, 'an unlisted active thread still re-syncs over REST');
});

test('ask-panel-stream: replaying the whole stream twice renders once', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const text = ctx.doc.querySelector('.ask-transcript').textContent;
  assert.equal(text.match(/pong/g).length, 1, 'no duplicated answer');
  assert.equal(ctx.doc.querySelectorAll('.ask-msg-assistant').length, 1);
});

test('ask-panel-stream: elapsed renders from injected now and ticks via flush', async () => {
  let t = 1_000_000;
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { now: () => t });
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  t += 6400;
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-activity-elapsed').textContent, /6\.4s/);
});

test('ask-panel-stream: big answers re-render at most every 250 ms', async () => {
  let t = 1_000_000;
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { now: () => t });
  const big = 'x'.repeat(40_000);
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x' },
    { type: 'ask-delta', text: big },
  ];
  const stamped = stampFrames(bare, { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(stamped[0]);
  ctx.panel.pushServerFrame(stamped[1]);
  ctx.flush(); // first render always happens
  assert.equal(ctx.doc.querySelector('.ask-answer').textContent.length, 40_000);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'TAIL', threadId: TID, messageId: MID, seq: 3 });
  ctx.flush(); // within 250 ms — throttled
  assert.ok(!ctx.doc.querySelector('.ask-answer').textContent.includes('TAIL'), 'render throttled inside the window');
  t += 300;
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-answer').textContent.includes('TAIL'), 'rendered once the window passed');
});

test('ask-panel-stream: an active selection inside the answer defers the re-render', async (tst) => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x' },
    { type: 'ask-delta', text: 'select me' },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const answer = ctx.doc.querySelector('.ask-answer');
  const sel = ctx.window.getSelection();
  try {
    const range = ctx.doc.createRange();
    range.selectNodeContents(answer);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* jsdom selection quirk */ }
  if (!sel.rangeCount || sel.isCollapsed) { tst.skip('jsdom cannot hold a non-collapsed selection'); return; }
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: ' MORE', threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  assert.ok(!answer.textContent.includes('MORE'), 'deferred while selected');
  sel.removeAllRanges();
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-answer').textContent.includes('MORE'), 'rendered after the selection cleared');
});

test('ask-panel-stream: a gap on an already-subscribed thread still re-requests the replay', async () => {
  const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
  const ctx = await openWith(ref);
  const subs = () => ctx.wsSends.filter((s) => s.type === 'subscribe' && s.threadId === TID).length;
  assert.equal(subs(), 1, 'loadThread subscribed once');
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'lost', threadId: TID, messageId: MID, seq: 9 });
  await ctx.tick();
  await ctx.tick();
  assert.equal(subs(), 2, 'the forced resubscribe re-requests the ring replay');
});

test('ask-panel-stream: a replayed ask-start seeds elapsed from its startedAt stamp', async () => {
  const T = Date.parse('2026-08-23T12:00:00.000Z');
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { now: () => T });
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: new Date(T - 60_000).toISOString(), threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-activity-elapsed').textContent, '1m 00s', 'seeded from startedAt, not reset to zero');
});

test('ask-panel-stream: switching off a streaming thread resets the stop button', async () => {
  const TID2 = 'ask_00000002';
  const idle = { ...snapBody(), thread: { ...snapBody().thread, id: TID2 } };
  const handler = (url) => {
    if (url.startsWith(`/api/ask/threads/${TID2}`)) return { ok: true, status: 200, json: async () => idle };
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapBody({ inFlight: { messageId: MID } }) };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [
      { id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: true },
      { id: TID2, title: 'T2', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false },
    ] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = makePanel({ fetchHandler: handler });
  ctx.panel.open();
  const pick = async (i) => {
    ctx.doc.querySelector('[data-ask-threads-btn]').click();
    await ctx.tick();
    ctx.doc.querySelectorAll('.ask-pop [role="menuitem"]')[i].click();
    await ctx.tick();
    await ctx.tick();
    ctx.flush();
  };
  await pick(0);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, false, 'stop showing while streaming');
  await pick(1);
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, true, 'stop hidden on the idle thread');
  assert.equal(ctx.doc.querySelector('[data-ask-send]').hidden, false, 'send back');
});
