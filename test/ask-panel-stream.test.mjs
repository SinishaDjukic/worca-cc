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

test('ask-panel-stream: plain-text stream — dot, orb, growing answer, done state', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID, threadTotals: { costUsd: 0.02, input: 10, output: 44, cacheRead: 0, cacheCreation: 11290, turns: 1, agents: 0 } });
  const done = frames[frames.length - 1];
  for (const f of frames.slice(0, -1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-dot-run'), 'green running dot while streaming');
  assert.equal(ctx.doc.querySelector('.ask-activity-label').textContent, 'Thinking', 'the head names the live turn');
  const thinking = ctx.doc.querySelector('.ask-thinking');
  assert.ok(thinking, 'the orb row marks the live turn');
  assert.match(thinking.querySelector('.ask-thinking-label').textContent, /^(Thinking|Writing).*…$/);
  assert.equal(thinking.parentElement.lastElementChild, thinking, 'it sits at the bottom of the live message');
  assert.equal(thinking.parentElement.className, 'ask-msg ask-msg-assistant');
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /pong/);
  ctx.panel.pushServerFrame(done);
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-dot-done'), 'grey dot after done');
  assert.equal(ctx.doc.querySelector('.ask-thinking'), null, 'the orb row leaves with the turn');
  assert.equal(ctx.doc.querySelector('.ask-activity-label').textContent, 'Done', 'a clean turn lands on Done');
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
    const label = ctx.doc.querySelector('.ask-thinking-label');
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
  assert.match(ctx.doc.querySelector('.ask-thinking-elapsed').textContent, /6\.4s/);
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
  assert.equal(ctx.doc.querySelector('.ask-thinking-elapsed').textContent, '1m 00s', 'seeded from startedAt, not reset to zero');
});

test('ask-panel-stream: switching off a streaming thread resets the stop button', async () => {
  const TID2 = 'ask_00000002';
  const idle = { ...snapBody(), thread: { ...snapBody().thread, id: TID2 } };
  const handler = (url) => {
    if (url.startsWith(`/api/ask/threads/${TID2}`)) return { ok: true, status: 200, json: async () => idle };
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapBody({ inFlight: { messageId: MID } }) };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [
      { id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: true, tracking: false },
      { id: TID2, title: 'T2', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, tracking: false },
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

test('ask-panel-stream: an open History popover refetches its rows on ask-run-status for ANY thread (debounced), keeps its caption, and stops once closed', async () => {
  const TID2 = 'ask_00000002';
  const listRow = (id, inFlight, tracking) => ({ id, title: id, updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight, tracking });
  const list = { threads: [listRow(TID, false, false), listRow(TID2, false, false)], total: 2 };
  const handler = (url) => {
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapBody() };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => list };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = makePanel({ fetchHandler: handler });
  const listFetches = () => ctx.fetchCalls.filter((c) => c.url.startsWith('/api/ask/threads?')).length;
  const settle = () => new Promise((r) => setTimeout(r, 320));   // past the ~250 ms debounce
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  assert.equal(listFetches(), 1, 'one fetch on open');
  const pop = ctx.doc.querySelector('.ask-pop-threads');
  const rows = () => [...pop.querySelectorAll('.ask-thread-pick')];
  assert.equal(rows()[1].querySelector('.ask-dot-track'), null, 'T2 not tracking at open');
  const focused = ctx.doc.activeElement;
  assert.equal(focused, rows()[0], 'the first row holds focus');
  // The chat behind row 2 starts following a run: no thread is active (st.threadId null),
  // so the frame would otherwise be dropped before the model — the popover still refetches.
  list.threads[1] = listRow(TID2, false, true);
  list.total = 3;
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'plan' });
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'implement' });
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: 'ask_ffffffff', runId: 'uuid-2', pipelineId: 'bbbb2222', cardId: null, status: 'done', phase: null });
  assert.equal(listFetches(), 1, 'nothing refetched synchronously — the burst is debounced');
  await settle();
  assert.equal(listFetches(), 2, 'three frames in a burst → ONE refetch');
  assert.ok(rows()[1].querySelector('.ask-dot-track'), 'T2 now shows the violet tracking dot');
  assert.equal(rows()[0].querySelector('.ask-dot-track'), null);
  assert.equal(pop.querySelectorAll('.ask-threads-list').length, 1, 'the rows were replaced, not appended');
  assert.equal(pop.querySelectorAll('.ask-thread-pick').length, 2);
  assert.equal(pop.querySelector('.ask-pop-caption').textContent, 'History', 'the caption survives');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '3 chats', 'the meter follows the fresh total');
  assert.equal(ctx.doc.activeElement, rows()[0], 'focus stays on the same row, not reset by the rebuild');
  assert.equal(ctx.doc.querySelector('.ask-pop-threads'), pop, 'same panel node — never reopened');
  // A turn starting elsewhere arms the thinking dot the same way.
  list.threads[1] = listRow(TID2, true, true);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID2, messageId: 'askm_00000009', seq: 1 });
  await settle();
  assert.equal(listFetches(), 3);
  assert.ok(rows()[1].querySelector('.ask-dot-live'), 'T2 thinking');
  assert.ok(rows()[1].querySelector('.ask-dot-track'), 'and still tracking');
  // The run settles but the chat follows another: the row is re-read, never flipped from the frame's status.
  list.threads[1] = listRow(TID2, true, true);
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'done', phase: null });
  await settle();
  assert.equal(listFetches(), 4);
  assert.ok(rows()[1].querySelector('.ask-dot-track'), 'a terminal status alone does not clear the dot');
  // Closed: a pending debounce is cancelled and later frames fetch nothing.
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'x' });
  ctx.doc.querySelector('[data-ask-threads-btn]').click();   // toggles it closed
  assert.equal(ctx.doc.querySelector('.ask-pop-threads'), null);
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'y' });
  await settle();
  assert.equal(listFetches(), 4, 'no refetch once the popover is gone');
  // Another popover open (agents) is left alone.
  ctx.doc.querySelector('[data-ask-agents-btn]').click();
  assert.ok(ctx.doc.querySelector('.ask-pop'), 'the agents popover is open');
  assert.equal(ctx.doc.querySelector('.ask-pop-threads'), null);
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'z' });
  await settle();
  assert.equal(listFetches(), 4, 'only the History popover refetches');
});

test('ask-panel-stream: the orb node survives live-row rebuilds so the spin never rewinds', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  // Scoped to the transcript: the launcher pill carries its OWN orb from build
  // time (ask-panel-pill-live), so a document-wide count would read two.
  const first = ctx.doc.querySelector('.ask-transcript .ask-orb');
  assert.ok(first, 'the orb mounted with the live turn');
  assert.equal(first.style.width, '28.5px', 'the panel mounts the orb at 28.5 CSS px');
  // A tool block patches the live row in place now, but the ONE orb still has to
  // be the SAME node — a rebuilt canvas restarts the spin, and the structural
  // flush at ask-start/ask-done re-parents it for real.
  ctx.panel.pushServerFrame({ type: 'ask-block', block: { kind: 'tool', id: 't1', name: 'mcp__worca__list_runs', input: {}, status: 'running' }, threadId: TID, messageId: MID, seq: 2 });
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-tool-row'), 'the tool row really did land');
  assert.equal(ctx.doc.querySelector('.ask-transcript .ask-orb'), first, 'same node, moved');
  assert.equal(ctx.doc.querySelectorAll('.ask-transcript .ask-orb').length, 1, 'never two orbs in the transcript');
});

test('ask-panel-stream: the orb row owns the live meter; the head shows only the word and the dot', async () => {
  let t = 1_000_000;
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { now: () => t });
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 'x', threadId: TID, messageId: MID, seq: 1 });
  ctx.panel.pushServerFrame({ type: 'ask-usage', usage: { ctx: 2000 }, costUsd: 0.14, threadId: TID, messageId: MID, seq: 2 });
  t += 6400;
  ctx.flush();
  const head = ctx.doc.querySelector('.ask-activity-head');
  assert.equal(head.querySelector('.ask-activity-elapsed'), null, 'no duplicate elapsed above');
  assert.equal(head.querySelector('.ask-activity-meter'), null, 'no duplicate meter above');
  assert.equal(head.textContent, 'Thinking', 'the live head is the word and the dot, nothing else');
  assert.equal(head.firstElementChild.className, 'ask-activity-label', 'the word leads, the dot follows');
  const meter = ctx.doc.querySelector('.ask-thinking-meter');
  assert.match(meter.textContent, /^6\.4s · 2\.0k ctx · \$0\.14$/);
});

test('ask-panel-stream: a stopped turn keeps its status word, a clean one does not', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('max-turns', { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-thinking'), null);
  assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Stopped after/);
  assert.equal(ctx.doc.querySelectorAll('.ask-activity-label').length, 1, 'a stopped turn is not also Done');
});

test('ask-panel-stream: an adopted turn with no ask-start still gets the orb row', async () => {
  // The ring buffer can evict the prefix; the model adopts the in-flight message
  // at whatever seq arrives, so afterFrame never sees ask-start and never calls
  // startElapsed(). buildMessage's own el.orb.start() covers the loop — jsdom has
  // no rAF, so only the row is observable here; the re-arm itself is pinned by
  // thinking-orb's "start is idempotent and stop cancels the pending frame".
  const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
  const ctx = await openWith(ref);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'adopted', threadId: TID, messageId: MID, seq: 77 });
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /adopted/);
  assert.ok(ctx.doc.querySelector('.ask-transcript .ask-orb'), 'the orb mounted on the adopted turn');
  assert.ok(ctx.doc.querySelector('.ask-thinking'), 'and the row with it');
});

// Review of PR #376: a delta that landed between the REST snapshot and the
// subscribe was adopted, the replay was then dropped as stale, and because
// afterFrame never saw ask-start the composer kept showing Send with no Stop.
test('ask-panel-stream: adoption mid-turn shows Stop; the subscribe replay after it renders the whole answer', async () => {
  const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
  const ctx = await openWith(ref);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'E', threadId: TID, messageId: MID, seq: 5 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-stop').hidden, false, 'Stop shows as soon as a turn is adopted');
  assert.equal(ctx.doc.querySelector('.ask-send').hidden, true);
  ctx.panel.pushServerFrame({ type: 'ask-start', threadId: TID, messageId: MID, seq: 1, startedAt: '2026-08-25T00:00:00Z', model: 'm', effort: 'high' });
  for (const [seq, text] of [[2, 'A'], [3, 'B'], [4, 'C'], [5, 'E']]) ctx.panel.pushServerFrame({ type: 'ask-delta', text, threadId: TID, messageId: MID, seq });
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-transcript').textContent.includes('ABCE'), 'the replayed prefix renders');
  assert.equal(ctx.doc.querySelector('.ask-stop').hidden, false, 'still streaming');
});

// ---- the transcript must stop jumping while a turn streams -----------------
// The live row used to be REBUILT (buildMessage → wrap.replaceWith) on every
// ask-label and every ask-block frame. Each rebuild handed the column a brand
// new `.ask-msg`, which replayed the `wr-rise` entry animation — a 10px rise and
// a fade — under text the user was already reading.

test('ask-panel-stream: a mid-turn label or tool frame patches the live row in place', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const open = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'the first half' },
  ], { threadId: TID, messageId: MID });
  for (const f of open) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const msg = ctx.doc.querySelector('.ask-msg-assistant');
  const answer = msg.querySelector('.ask-answer');
  const activity = msg.querySelector('.ask-activity');
  assert.match(answer.textContent, /the first half/);

  const rest = stampFrames([
    { type: 'ask-label', label: 'Finding runs' },
    { type: 'ask-block', block: { kind: 'tool', id: 't1', name: 'mcp__worca__list_runs', input: {}, status: 'running' } },
    { type: 'ask-block', block: { kind: 'tool', id: 't1', name: 'mcp__worca__list_runs', input: {}, status: 'ok', durationMs: 1200 } },
    { type: 'ask-block', block: { kind: 'tool', id: 't2', name: 'mcp__worca__read_run', input: {}, status: 'running' } },
    { type: 'ask-label', label: 'Writing' },
  ], { threadId: TID, messageId: MID, seqStart: open.length + 1 });
  for (const f of rest) { ctx.panel.pushServerFrame(f); ctx.flush(); }

  assert.equal(ctx.doc.querySelector('.ask-msg-assistant'), msg, 'the live row is the same node — no entry animation can replay');
  assert.equal(msg.querySelector('.ask-answer'), answer, 'the answer the user is reading is never re-created');
  assert.equal(msg.querySelector('.ask-activity'), activity, 'the activity block is patched, not swapped');
  assert.match(answer.textContent, /the first half/, 'and it kept its text');
  const tools = [...msg.querySelectorAll('.ask-tool-row')];
  assert.equal(tools.length, 2, 'a repeated tool id upserts, a new one appends');
  assert.notEqual(tools[0].querySelector('.ask-tool-note').textContent, '…', 'the finished tool row took its duration');
  assert.equal(tools[1].querySelector('.ask-tool-note').textContent, '…', 'the running one is still running');
  assert.equal(msg.querySelector('.ask-activity-label').textContent, 'Thinking');
  assert.equal(ctx.doc.querySelector('.ask-thinking-label').textContent, 'Writing…', 'the label still follows the server');
  assert.equal(msg.lastElementChild, ctx.doc.querySelector('.ask-thinking'), 'the orb row is still the bottom of the message');
});

test('ask-panel-stream: only a message the transcript has never shown carries the entry stamp', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const stamped = () => [...ctx.doc.querySelectorAll('.ask-msg')].filter((m) => m.hasAttribute('data-ask-enter'));
  assert.deepEqual(stamped().map((m) => m.className), ['ask-msg ask-msg-user'], 'the loaded row rises in once');

  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(frames[0]);                      // ask-start → a new row → a structural repaint
  ctx.flush();
  assert.deepEqual(stamped().map((m) => m.className), ['ask-msg ask-msg-assistant'],
    'the new assistant row rises in; the user row above it does NOT rise again');

  for (const f of frames.slice(1, -1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  ctx.panel.pushServerFrame(frames[frames.length - 1]);      // ask-done → another structural repaint
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-msg').length, 2);
  assert.deepEqual(stamped(), [], 'every row was already on screen — none may rise a second time');
});

test('ask-panel-stream: the bottom pin writes scrollTop only when the bottom moved', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const t = ctx.doc.querySelector('.ask-transcript');
  let height = 1000;
  let top = 0;
  const writes = [];
  Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(t, 'clientHeight', { configurable: true, get: () => 200 });
  Object.defineProperty(t, 'scrollTop', { configurable: true, get: () => top, set: (v) => { writes.push(v); top = Math.min(v, height - 200); } });
  ctx.flush();
  assert.deepEqual(writes, [1000], 'the first flush pins to the bottom');
  ctx.flush();
  ctx.flush();
  assert.deepEqual(writes, [1000], 'nothing grew — flush() must not re-snap the scrollport every frame');
  height = 1400;
  ctx.flush();
  assert.deepEqual(writes, [1000, 1400], 'a grown transcript follows the bottom again');
  // the release is untouched: scrolling up unpins and shows the jump pill
  top = 100;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false, 'the 24px threshold still releases the pin');
  ctx.flush();
  assert.deepEqual(writes, [1000, 1400], 'and an unpinned transcript is left where the user put it');
});
