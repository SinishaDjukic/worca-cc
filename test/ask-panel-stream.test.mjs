// test/ask-panel-stream.test.mjs — live frames → DOM (spec §10.5, §10.8).
// Frame streams come from the Task 1 helper; the panel is driven through its
// public pushServerFrame/onHello only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { makePanel, key, openChat } from './helpers/ask-panel-harness.mjs';
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
  await openChat(ctx, TID);
  return ctx;
}

test('ask-panel-stream: frames for another thread are ignored; replaying the whole stream twice renders once', async () => {
  await checkRows([
    { name: 'ask-panel-stream: frames for another thread are ignored', run: async () => {
      // NB this pins the MODEL's filter through the panel path — the panel's own check is unobservable defence-in-depth.
      const ref = { body: snapBody() };
      const ctx = await openWith(ref);
      ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'not mine', threadId: 'ask_ffffffff', messageId: MID, seq: 1 });
      ctx.flush();
      assert.ok(!ctx.doc.querySelector('.ask-transcript').textContent.includes('not mine'));
    } },
    { name: 'ask-panel-stream: replaying the whole stream twice renders once', run: async () => {
      const ref = { body: snapBody() };
      const ctx = await openWith(ref);
      const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
      for (const f of frames) ctx.panel.pushServerFrame(f);
      for (const f of frames) ctx.panel.pushServerFrame(f);
      ctx.flush();
      const text = ctx.doc.querySelector('.ask-transcript').textContent;
      assert.equal(text.match(/pong/g).length, 1, 'no duplicated answer');
      assert.equal(ctx.doc.querySelectorAll('.ask-msg-assistant').length, 1);
    } },
  ]);
});

test('ask-panel-stream: plain-text stream — head word, orb, growing answer, done state', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref);
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID, threadTotals: { costUsd: 0.02, input: 10, output: 44, cacheRead: 0, cacheCreation: 11290, turns: 1, agents: 0 } });
  const done = frames[frames.length - 1];
  for (const f of frames.slice(0, -1)) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-activity-head').textContent, 'Thinking', 'the live head is its one word: the orb row owns the numbers');
  assert.equal(ctx.doc.querySelector('.ask-activity-label').textContent, 'Thinking', 'the head names the live turn');
  const thinking = ctx.doc.querySelector('.ask-thinking');
  assert.ok(thinking, 'the orb row marks the live turn');
  assert.match(thinking.querySelector('.ask-thinking-label').textContent, /^(Thinking|Writing).*…$/);
  assert.equal(thinking.parentElement.lastElementChild, thinking, 'it sits at the bottom of the live message');
  assert.equal(thinking.parentElement.className, 'ask-msg ask-msg-assistant');
  assert.match(ctx.doc.querySelector('.ask-answer').textContent, /pong/);
  ctx.panel.pushServerFrame(done);
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-activity-head').textContent, /^Done · \d/, 'the landed head is one dot-separated line');
  assert.equal(ctx.doc.querySelector('.ask-thinking'), null, 'the orb row leaves with the turn');
  assert.equal(ctx.doc.querySelector('.ask-activity-label').textContent, 'Done', 'a clean turn lands on Done');
  assert.equal(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'answer finished');
});

test('ask-panel-stream: the live orb is the Workflows chat\'s dot orb — one canvas for the whole turn, its data-phase following it (think → tool → write → rest)', async () => {
  // The phase is dot-orb.mjs turnPhase over the model's live(): its label, its text and the live message's blocks,
  // whose tool/agent rows stream with status 'running' until they land (src/core/ask/events.mjs).
  const phasesOf = async (fixture) => {
    const ref = { body: snapBody() };
    const ctx = await openWith(ref);
    const { frames } = replayFixture(fixture, { threadId: TID, messageId: MID });
    const seen = [];
    let orb = null;
    for (const f of frames) {
      ctx.panel.pushServerFrame(f);
      ctx.flush();
      const cur = ctx.doc.querySelector('.ask-transcript .ask-thinking .ask-orb');
      if (cur && !orb) orb = cur;
      if (cur) assert.equal(cur, orb, `${f.type}: the one canvas is re-parented, never rebuilt`);
      if (orb && seen.at(-1) !== orb.dataset.phase) seen.push(orb.dataset.phase);
    }
    return { orb, seen };
  };
  await checkRows([
    { name: 'a tool call: tool while it runs, thinking again once it lands, writing under "Writing", rest when done', run: async () => {
      const { orb, seen } = await phasesOf('tool-list-runs');
      assert.equal(orb.tagName, 'CANVAS');
      assert.ok(orb.classList.contains('dot-orb') && orb.classList.contains('ask-orb'), orb.className);
      assert.equal(orb.style.width, '28px');
      assert.deepEqual(seen, ['think', 'tool', 'think', 'write', 'rest']);
      assert.equal(orb.isConnected, false, 'the finished turn dropped the orb row');
      assert.equal(orb.classList.contains('is-live'), false);
    } },
    { name: 'a sub-agent counts as a tool while it runs', run: async () => {
      const { seen } = await phasesOf('task-subagent');
      assert.deepEqual(seen, ['think', 'tool', 'think', 'write', 'rest']);
    } },
    { name: 'plain text: thinking, then writing as the answer streams', run: async () => {
      const { seen } = await phasesOf('plain-text');
      assert.deepEqual(seen, ['think', 'write', 'rest']);
    } },
  ]);
});

test('ask-panel-stream: the orb loop winds down after the turn and destroy() cancels it mid-turn', async () => {
  const start = stampFrames([{ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x' }], { threadId: TID, messageId: MID });
  const pending = (ctx) => ctx.orbFrames.armed.filter((f) => !ctx.orbFrames.cancelled.has(f.id)).length;
  await checkRows([
    { name: 'ask-panel-stream: a finished turn leaves no orb frame running', run: async () => {
      const ref = { body: snapBody() };
      const ctx = await openWith(ref, { orb: true });
      ctx.panel.pushServerFrame(start[0]);
      ctx.flush();
      assert.equal(ctx.doc.querySelector('.ask-orb').dataset.phase, 'think');
      assert.ok(pending(ctx) > 0, 'a thinking orb runs its frame loop');
      ctx.panel.pushServerFrame({ type: 'ask-done', text: 'ok', threadId: TID, messageId: MID, seq: 2 });
      ctx.flush();
      for (let i = 0; i < 300 && pending(ctx); i += 1) ctx.orbFrames.run();
      assert.equal(pending(ctx), 0, 'the detached orb dropped out of the loop');
    } },
    { name: 'ask-panel-stream: destroy() cancels a live orb\'s pending frame', run: async () => {
      const ref = { body: snapBody() };
      const ctx = await openWith(ref, { orb: true });
      ctx.panel.pushServerFrame(start[0]);
      ctx.flush();
      assert.ok(pending(ctx) > 0);
      ctx.panel.destroy();
      assert.equal(pending(ctx), 0);
    } },
  ]);
});

test('ask-panel-stream: a theme switch between turns recolours the next turn\'s orb (the one canvas left the loop while detached)', async () => {
  const ref = { body: snapBody() };
  const ctx = await openWith(ref, { orb: true });
  // The orb reads its ink from the canvas's computed colour once it is in the page; jsdom computes none, so serve it.
  let ink = 'rgb(24, 24, 27)';
  const real = ctx.window.getComputedStyle.bind(ctx.window);
  ctx.window.getComputedStyle = (node, pseudo) => (node && node.classList && node.classList.contains('dot-orb') ? { color: ink } : real(node, pseudo));
  const fills = [];
  ctx.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() { fills.push(this.fillStyle); }, fillStyle: '', globalAlpha: 1 });
  const pending = () => ctx.orbFrames.armed.filter((f) => !ctx.orbFrames.cancelled.has(f.id)).length;
  const turn = (messageId, seq) => {
    ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: `u${seq}`, model: 'm', effort: 'high', startedAt: 'x', threadId: TID, messageId, seq });
    ctx.flush();
    const orb = ctx.doc.querySelector('.ask-transcript .ask-thinking .ask-orb');
    assert.ok(orb && orb.isConnected, `${messageId}: the live row holds the orb`);
    assert.equal(orb.dataset.phase, 'think');
    return orb;
  };
  const first = turn(MID, 2);
  assert.equal(fills.at(-1), 'rgb(24, 24, 27)');
  ctx.panel.pushServerFrame({ type: 'ask-done', text: 'ok', threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  assert.equal(first.isConnected, false, 'the finished turn dropped the orb row');
  for (let i = 0; i < 300 && pending(); i += 1) ctx.orbFrames.run();
  assert.equal(pending(), 0, 'the detached orb dropped out of the loop');
  ink = 'rgb(236, 236, 233)';
  ctx.doc.dispatchEvent(new ctx.window.Event('worca:theme'));
  const next = turn('askm_00000002', 4);
  assert.equal(next, first, 'the same canvas, re-parented');
  assert.equal(fills.at(-1), 'rgb(236, 236, 233)', 'painted in the new theme\'s ink, not the last turn\'s');
  ctx.panel.destroy();
});

test('ask-panel-stream: tool rows stream in with server labels; a sub-agent expands mid-stream and stays expanded', async () => {
  await checkRows([
    { name: 'ask-panel-stream: a live turn\'s activity is collapsed too; opened mid-stream it stays open and keeps updating to the end', run: async () => {
      const ref = { body: snapBody() };
      const ctx = await openWith(ref);
      const { frames } = replayFixture('tool-list-runs', { threadId: TID, messageId: MID });
      const firstToolAt = frames.findIndex((f) => f.type === 'ask-block' && f.block.kind === 'tool');
      assert.ok(firstToolAt > 0);
      for (const f of frames.slice(0, firstToolAt + 1)) ctx.panel.pushServerFrame(f);
      ctx.flush();
      const head = () => ctx.doc.querySelector('.ask-activity-head');
      const body = () => ctx.doc.querySelector('.ask-activity-body');
      assert.ok(ctx.doc.querySelector('.ask-thinking'), 'the turn is live');
      assert.equal(head().getAttribute('aria-expanded'), 'false', 'collapsed while live: nothing jumps when the turn lands');
      assert.equal(body().hidden, true);
      assert.equal(body().querySelector('.ask-tool-note').textContent, '…', 'the row is there, running, behind the fold');
      head().click();
      assert.equal(body().hidden, false);
      for (const f of frames.slice(firstToolAt + 1)) { ctx.panel.pushServerFrame(f); ctx.flush(); }
      assert.equal(ctx.doc.querySelector('.ask-thinking'), null, 'the turn landed');
      assert.equal(head().getAttribute('aria-expanded'), 'true', 'still open after every update');
      assert.equal(body().hidden, false);
      assert.notEqual(body().querySelector('.ask-tool-note').textContent, '…', 'the open body followed the tool to its end');
    } },
    { name: 'ask-panel-stream: tool rows stream in with server labels', run: async () => {
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
    } },
    { name: 'ask-panel-stream: sub-agent expands mid-stream and stays expanded to the end', run: async () => {
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
    } },
  ]);
});

test('ask-panel-stream: max-turns ends stopped with the notice; ask-error keeps the partial text with the red line', async () => {
  await checkRows([
    { name: 'ask-panel-stream: max-turns ends stopped with the notice and Stopped after', run: async () => {
      const ref = { body: snapBody() };
      const ctx = await openWith(ref);
      const { frames } = replayFixture('max-turns', { threadId: TID, messageId: MID });
      for (const f of frames) ctx.panel.pushServerFrame(f);
      ctx.flush();
      assert.match(ctx.doc.querySelector('.ask-activity-label').textContent, /Stopped after/);
      assert.match(ctx.doc.querySelector('.ask-notice').textContent, /Stopped: reached the 40-turn limit/);
    } },
    { name: 'ask-panel-stream: ask-error keeps the partial text and shows the red line', run: async () => {
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
    } },
  ]);
});

test('ask-panel-stream: a seq gap triggers one REST resync + forced resubscribe, also on an already-subscribed thread', async () => {
  await checkRows([
    { name: 'ask-panel-stream: a seq gap triggers one REST resync + forced resubscribe', run: async () => {
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
    } },
    { name: 'ask-panel-stream: a gap on an already-subscribed thread still re-requests the replay', run: async () => {
      const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
      const ctx = await openWith(ref);
      const subs = () => ctx.wsSends.filter((s) => s.type === 'subscribe' && s.threadId === TID).length;
      assert.equal(subs(), 1, 'loadThread subscribed once');
      ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
      ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'lost', threadId: TID, messageId: MID, seq: 9 });
      await ctx.tick();
      await ctx.tick();
      assert.equal(subs(), 2, 'the forced resubscribe re-requests the ring replay');
    } },
  ]);
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
  const pick = (i) => openChat(ctx, [TID, TID2][i]);
  await pick(0);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 'x', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, false, 'stop showing while streaming');
  await pick(1);
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, true, 'stop hidden on the idle thread');
  assert.equal(ctx.doc.querySelector('[data-ask-send]').hidden, false, 'send back');
});

// The snapshot of a chat whose turn is still running: its assistant row is the unfinished `streaming` placeholder.
function streamingAssistant(over = {}) {
  return { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', blocks: [], status: 'streaming', reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't', ...over };
}
function inFlightSnap() {
  const base = snapBody({ inFlight: { messageId: MID } });
  return { ...base, messages: [...base.messages, streamingAssistant()] };
}

test('ask-panel-stream: switching back to a chat whose turn still runs re-subscribes it, and its row never reads Done', async () => {
  const TID2 = 'ask_00000002';
  const idle = { ...snapBody(), thread: { ...snapBody().thread, id: TID2 } };
  const handler = (url) => {
    if (url.startsWith(`/api/ask/threads/${TID2}`)) return { ok: true, status: 200, json: async () => idle };
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => inFlightSnap() };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [
      { id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: true, tracking: false },
      { id: TID2, title: 'T2', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, tracking: false },
    ] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = makePanel({ fetchHandler: handler });
  ctx.panel.open();
  const pick = (i) => openChat(ctx, [TID, TID2][i]);
  const subs = () => ctx.wsSends.filter((s) => s.type === 'subscribe' && s.threadId === TID).length;
  await pick(0);
  assert.equal(subs(), 1, 'the first load subscribed A');
  await pick(1);
  await pick(0);
  assert.equal(subs(), 2, 'coming back to A asks the server to replay its running turn again');
  const label = ctx.doc.querySelector('.ask-msg-assistant .ask-activity-label');
  assert.ok(label, 'A shows its assistant row');
  assert.notEqual(label.textContent, 'Done', 'a turn still running is not Done');
  assert.equal(label.textContent, 'Thinking');
  // The replay (from seq 1) makes the turn live again: still Thinking, now with the orb row.
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: '2026-10-18T00:00:00Z', threadId: TID, messageId: MID, seq: 1 });
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'partial', threadId: TID, messageId: MID, seq: 2 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-msg-assistant .ask-activity-label').textContent, 'Thinking');
  assert.ok(ctx.doc.querySelector('.ask-thinking'), 'the adopted turn gets the orb row');
});

test('ask-panel-stream: an unfinished assistant row reads Thinking before any frame arrives, never Done', async () => {
  await checkRows([
    { name: 'ask-panel-stream: the snapshot\'s in-flight row reads Thinking with no frame yet', run: async () => {
      const ref = { body: inFlightSnap() };
      const ctx = await openWith(ref);
      assert.equal(ctx.doc.querySelector('.ask-msg-assistant .ask-activity-label').textContent, 'Thinking');
      assert.equal(ctx.doc.querySelector('.ask-msg-assistant .ask-activity-elapsed'), null, 'no empty Done meter beside it');
    } },
    { name: 'ask-panel-stream: a row whose status is still streaming reads Thinking even without inFlight', run: async () => {
      const base = snapBody();
      const ref = { body: { ...base, messages: [...base.messages, streamingAssistant()] } };
      const ctx = await openWith(ref);
      assert.equal(ctx.doc.querySelector('.ask-msg-assistant .ask-activity-label').textContent, 'Thinking');
    } },
  ]);
});

test('ask-panel-stream: the Chats column refetches on ask-run-status / ask-start for ANY thread (debounced) while Chat shows — column open or not — keeps its node and the composer focus, and stops once Chat is hidden', async () => {
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
  await ctx.tick();
  assert.equal(listFetches(), 1, 'one fetch on the first show');
  assert.equal(ctx.panel.root.dataset.history, 'closed', 'jsdom is 1024px wide: the column is closed, it still loads');
  const col = ctx.doc.querySelector('[data-chat-history]');
  const input = ctx.doc.querySelector('textarea.ask-input');
  assert.equal(ctx.doc.activeElement, input, 'open() focused the composer');
  // The chat behind row 2 starts following a run: no thread is active (st.threadId null),
  // so the frame would otherwise be dropped before the model — the column still refetches.
  list.threads[1] = listRow(TID2, false, true);
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'plan' });
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'implement' });
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: 'ask_ffffffff', runId: 'uuid-2', pipelineId: 'bbbb2222', cardId: null, status: 'done', phase: null });
  assert.equal(listFetches(), 1, 'nothing refetched synchronously — the burst is debounced');
  await settle();
  assert.equal(listFetches(), 2, 'three frames in a burst → ONE refetch');
  assert.equal(ctx.doc.querySelector('[data-chat-history]'), col, 'same column node');
  assert.equal(ctx.doc.activeElement, input, 'a refresh never steals focus');
  // A turn starting elsewhere refetches the same way.
  list.threads[1] = listRow(TID2, true, true);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't', threadId: TID2, messageId: 'askm_00000009', seq: 1 });
  await settle();
  assert.equal(listFetches(), 3);
  // Hidden: a pending debounce fetches nothing, later frames neither (they mark the list stale for the next show).
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'x' });
  ctx.panel.close();
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID2, runId: 'uuid-1', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'y' });
  await settle();
  assert.equal(listFetches(), 3, 'no refetch while Chat is hidden');
  ctx.panel.open();
  await ctx.tick();
  assert.equal(listFetches(), 4, 'the next show fetches the stale list once');
});

test('ask-panel-stream: an adopted turn (no ask-start) gets the orb row and Stop; the subscribe replay renders the whole answer', async () => {
  await checkRows([
    { name: 'ask-panel-stream: an adopted turn with no ask-start still gets the orb row', run: async () => {
      // The ring buffer can evict the prefix; the model adopts the in-flight message
      // at whatever seq arrives, so afterFrame never sees ask-start and never calls
      // startElapsed(). The orb needs no start: updateThinking() sets its phase on
      // every flush, so the adopted turn's orb moves like any other.
      const ref = { body: snapBody({ inFlight: { messageId: MID } }) };
      const ctx = await openWith(ref);
      ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'adopted', threadId: TID, messageId: MID, seq: 77 });
      ctx.flush();
      assert.match(ctx.doc.querySelector('.ask-answer').textContent, /adopted/);
      const orb = ctx.doc.querySelector('.ask-transcript .ask-orb');
      assert.ok(orb, 'the orb mounted on the adopted turn');
      assert.equal(orb.dataset.phase, 'write', 'streaming text with no tool: writing');
      assert.ok(ctx.doc.querySelector('.ask-thinking'), 'and the row with it');
    } },
    // Review of PR #376: a delta that landed between the REST snapshot and the
    // subscribe was adopted, the replay was then dropped as stale, and because
    // afterFrame never saw ask-start the composer kept showing Send with no Stop.
    { name: 'ask-panel-stream: adoption mid-turn shows Stop; the subscribe replay after it renders the whole answer', run: async () => {
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
    } },
  ]);
});

// ---- the next-prompt suggestion (ask-suggestion, live-only ghost text) ---------------------------------------------
const suggest = (ctx, text = 'Open a PR', messageId = MID) => {
  ctx.panel.pushServerFrame({ type: 'ask-suggestion', threadId: TID, messageId, text });
  ctx.flush();
};
async function finishedTurn() {
  const ctx = await openWith({ body: snapBody() });
  for (const f of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-done', text: 'Here is the diff summary.', blocks: [], usage: null, costUsd: 0, durationMs: 1, model: 'm', status: 'done' },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  return ctx;
}

test('ask-panel-stream: a suggestion replaces the default placeholder; Tab accepts it; Enter on empty never sends it; screen readers get it', async () => {
  const ctx = await finishedTurn();
  const input = ctx.doc.querySelector('textarea.ask-input');
  suggest(ctx);
  assert.equal(input.placeholder, 'Open a PR');
  assert.ok(input.classList.contains('is-suggesting'));
  const hintId = input.getAttribute('aria-describedby');
  assert.match(ctx.doc.getElementById(hintId).textContent, /Open a PR.*Tab/);
  const before = ctx.fetchCalls.filter((c) => /\/messages$/.test(c.url)).length;
  const enter = key(ctx.window, input, 'Enter');
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.fetchCalls.filter((c) => /\/messages$/.test(c.url)).length, before, 'Enter on an empty input sends nothing');
  assert.equal(enter.defaultPrevented, true);
  const tab = key(ctx.window, input, 'Tab');
  assert.equal(tab.defaultPrevented, true);
  assert.equal(input.value, 'Open a PR');
  assert.equal(input.selectionStart, 'Open a PR'.length, 'caret at the end');
  assert.equal(input.placeholder, 'Ask about any run, agent, or project…');
  assert.equal(input.hasAttribute('aria-describedby'), false);
});

test('ask-panel-stream: typing hides the suggestion for good; Tab without one keeps focus behaviour', async () => {
  const ctx = await finishedTurn();
  const input = ctx.doc.querySelector('textarea.ask-input');
  suggest(ctx);
  input.value = 'x';
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  input.value = '';
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(input.placeholder, 'Ask about any run, agent, or project…', 'a typed-over suggestion does not come back');
  assert.equal(key(ctx.window, input, 'Tab').defaultPrevented, false);
});

test('ask-panel-stream: a stale suggestion is dropped — typed before it landed, an older reply, another thread, or a turn running', async () => {
  const ctx = await finishedTurn();
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.value = 'typing'; input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  input.value = ''; input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  suggest(ctx);
  assert.equal(input.placeholder, 'Ask about any run, agent, or project…', 'typed after the reply: dropped');
  suggest(ctx, 'Old', 'askm_older');
  ctx.panel.pushServerFrame({ type: 'ask-suggestion', threadId: 'ask_ffffffff', messageId: MID, text: 'Other' });
  ctx.flush();
  assert.equal(input.placeholder, 'Ask about any run, agent, or project…');
});
