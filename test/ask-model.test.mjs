// test/ask-model.test.mjs — DOM-free thread model (spec §10.1 ask-model, §10.8
// replay rules). Frames come from test/helpers/ask-frames.mjs; no jsdom needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createThreadModel } from '../ui/public/ask-model.mjs';
import { replayFixture, stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_11111111';
const MID = 'askm_00000001';

function snapshot({ inFlight = null, messages = [], title = null, totals = {} } = {}) {
  return {
    thread: { id: TID, title, createdAt: 't0', updatedAt: 't0', model: null, effort: null, sessionId: null, context: null, totals },
    messages,
    attachments: [],
    runLinks: [],
    inFlight,
  };
}

function doneRow(id, seq, text = 'earlier answer') {
  return { id, threadId: TID, seq, role: 'assistant', text, blocks: [], status: 'done', reason: null, model: 'm', effort: 'high', usage: null, costUsd: 0, durationMs: 5, createdAt: 't1' };
}

test('ask-model: frames for another thread are dropped', () => {
  const m = createThreadModel({ threadId: TID });
  const r = m.apply({ type: 'ask-delta', text: 'x', threadId: 'ask_ffffffff', messageId: MID, seq: 1 });
  assert.deepEqual(r, { dropped: 'other-thread' });
  assert.equal(m.messages().length, 0);
});

test('ask-model: plain-text fixture replay builds one done assistant row', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) assert.deepEqual(m.apply(f), { ok: true });
  const rows = m.messages();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, MID);
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[0].text, 'pong');
  assert.equal(m.live(), null);
  assert.equal(m.inFlight(), null);
});

test('ask-model: replaying the same stamped frames is a no-op (seq dedupe)', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  const before = JSON.stringify(m.messages());
  const results = frames.map((f) => m.apply(f));
  // every replayed frame is dropped — stale seq or terminal row, never applied
  assert.ok(results.every((r) => r.dropped));
  assert.equal(JSON.stringify(m.messages()), before);
});

test('ask-model: job frames for a terminal message are ignored', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ messages: [doneRow(MID, 2)] }));
  const r = m.apply({ type: 'ask-delta', text: 'late', threadId: TID, messageId: MID, seq: 9 });
  assert.deepEqual(r, { dropped: 'terminal-message' });
  assert.equal(m.messages()[0].text, 'earlier answer');
});

test('ask-model: a seq gap is reported and the frame is not applied', () => {
  const m = createThreadModel({ threadId: TID });
  const [start] = stampFrames([{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' }], { threadId: TID, messageId: MID });
  assert.deepEqual(m.apply(start), { ok: true });
  const r = m.apply({ type: 'ask-delta', text: 'skipped ahead', threadId: TID, messageId: MID, seq: 3 });
  assert.deepEqual(r, { gap: true });
  assert.equal(m.live().text, '');
  // seq 2 still applies afterwards — the gap report did not consume the counter
  assert.deepEqual(m.apply({ type: 'ask-delta', text: 'ok', threadId: TID, messageId: MID, seq: 2 }), { ok: true });
  assert.equal(m.live().text, 'ok');
});

test('ask-model: adoption — after load(inFlight) the first frame is accepted at any seq', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ inFlight: { messageId: MID } }));
  const r = m.apply({ type: 'ask-delta', text: 'tail of the answer', threadId: TID, messageId: MID, seq: 41 });
  assert.deepEqual(r, { ok: true });
  assert.equal(m.live().text, 'tail of the answer');
  // ask-done heals the missing prefix: payload text replaces the accumulation
  m.apply({ type: 'ask-done', text: 'the whole answer', blocks: [], usage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.01, durationMs: 9, model: 'm', status: 'done', threadTotals: { costUsd: 0.01, turns: 1 }, threadId: TID, messageId: MID, seq: 42 });
  assert.equal(m.messages()[0].text, 'the whole answer');
  assert.deepEqual(m.thread().totals, { costUsd: 0.01, turns: 1 });
});

test('ask-model: frames with no live turn and no inFlight are dropped', () => {
  const m = createThreadModel({ threadId: TID });
  const r = m.apply({ type: 'ask-delta', text: 'orphan', threadId: TID, messageId: MID, seq: 7 });
  assert.deepEqual(r, { dropped: 'no-live' });
});

test('ask-model: out-of-turn ask-message upserts by id and replaces the optimistic row', () => {
  const m = createThreadModel({ threadId: TID });
  m.noteLocalUserMessage({ id: 'askm_u0000001', text: 'hello', attachments: [{ name: 'a.md', bytes: 10 }] });
  assert.equal(m.messages().length, 1);
  assert.equal(m.messages()[0].blocks[0].kind, 'attachment');
  const persisted = { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hello', blocks: [{ kind: 'attachment', id: 'att_00000001', name: 'a.md', bytes: 10 }], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't1' };
  assert.deepEqual(m.apply({ type: 'ask-message', threadId: TID, message: persisted }), { ok: true });
  assert.equal(m.messages().length, 1);
  assert.equal(m.messages()[0].seq, 1);
  assert.equal(m.messages()[0].blocks[0].id, 'att_00000001');
});

test('ask-model: ask-message inserts new rows in seq order', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ messages: [doneRow('askm_00000002', 2)] }));
  m.apply({ type: 'ask-message', threadId: TID, message: { ...doneRow('askm_00000001', 1), role: 'user' } });
  assert.deepEqual(m.messages().map((r) => r.id), ['askm_00000001', 'askm_00000002']);
});

test('ask-model: ask-title and ask-run-status upsert; null run-status fields mean no change', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ title: 'first title' }));
  m.apply({ type: 'ask-title', threadId: TID, title: 'A better title' });
  assert.equal(m.thread().title, 'A better title');
  m.apply({ type: 'ask-run-status', threadId: TID, runId: 'r1', pipelineId: 'abcd1234', cardId: 'card_00000001', status: 'running', phase: 'plan' });
  m.apply({ type: 'ask-run-status', threadId: TID, runId: 'r1', pipelineId: null, cardId: null, status: null, phase: null });
  assert.deepEqual(m.runLinks().get('r1'), { pipelineId: 'abcd1234', cardId: 'card_00000001', status: 'running', phase: 'plan' });
});

test('ask-model: load() round-trips the snapshot', () => {
  const m = createThreadModel({ threadId: TID });
  const rows = [doneRow('askm_00000001', 1), doneRow('askm_00000002', 2)];
  m.load(snapshot({ messages: rows, title: 'T', totals: { costUsd: 1, turns: 2 } }));
  assert.deepEqual(m.messages(), rows);
  assert.equal(m.thread().title, 'T');
  assert.deepEqual(m.totals(), { costUsd: 1, turns: 2, live: null });
});

test('ask-model: totals() overlays the live turn usage', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-usage', usage: { input: 5, output: 7, cacheRead: 0, cacheCreation: 0 }, costUsd: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) m.apply(f);
  const t = m.totals();
  assert.deepEqual(t.live, { usage: { input: 5, output: 7, cacheRead: 0, cacheCreation: 0 }, costUsd: null });
});

test('ask-model: tool blocks upsert in place through the tool-list-runs fixture', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('tool-list-runs', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  const row = m.messages()[0];
  const tools = row.blocks.filter((b) => b.kind === 'tool');
  assert.ok(tools.length >= 1);
  assert.equal(tools[0].status, 'done');
  assert.equal(tools[0].name, 'mcp__worca__list_runs');
});

test('ask-model: agent block hydrates by id through the task-subagent fixture', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('task-subagent', { threadId: TID, messageId: MID });
  let sawRunningAgent = false;
  for (const f of frames) {
    m.apply(f);
    const row = m.messages()[0];
    const agent = row && (row.blocks || []).find((b) => b.kind === 'agent');
    if (agent && agent.status === 'running') sawRunningAgent = true;
  }
  const agent = m.messages()[0].blocks.find((b) => b.kind === 'agent');
  assert.ok(sawRunningAgent, 'agent block streamed as running before finishing');
  assert.equal(agent.status, 'done');
  assert.equal(agent.tokens, 5321);
  assert.equal(agent.estimated, true);
  assert.ok(Array.isArray(agent.log) && agent.log.length >= 2);
});

test('ask-model: propose-run fixture with a card yields a proposed card block; findCard sees it', () => {
  const m = createThreadModel({ threadId: TID });
  const card = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/tmp/proj', workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'do it', title: 'Do it', sourceBranch: '', featureBranch: 'worca/do-it', sourceBranchByKey: null, workspaceId: null, workspaceName: null, members: null };
  const { frames } = replayFixture('propose-run', { threadId: TID, messageId: MID, card, cardId: 'card_00000001' });
  assert.ok(frames.some((f) => f.type === 'ask-card'));
  for (const f of frames) m.apply(f);
  const found = m.findCard('card_00000001');
  assert.ok(found);
  assert.equal(found.block.state, 'proposed');
  assert.equal(found.block.card.brief, 'do it');
  assert.equal(found.message.id, MID);
});

test('ask-model: max-turns fixture ends stopped with the limit notice appended', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('max-turns', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  const row = m.messages()[0];
  assert.equal(row.status, 'stopped');
  assert.equal(row.reason, 'max_turns');
  const notice = row.blocks.find((b) => b.kind === 'notice');
  assert.match(notice.text, /^Stopped: reached the 40-turn limit/);
});

test('ask-model: ask-error finalizes with the accumulated partial text', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'partial ' },
    { type: 'ask-delta', text: 'answer' },
    { type: 'ask-error', message: 'claude exited with code 1: boom', errorClass: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) m.apply(f);
  const row = m.messages()[0];
  assert.equal(row.status, 'error');
  assert.equal(row.text, 'partial answer');
  assert.equal(row.errorMessage, 'claude exited with code 1: boom');
  assert.equal(m.live(), null);
});

test('ask-model: dirty tracking drains once and is per-kind', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-label', label: 'Finding runs' },
    { type: 'ask-delta', text: 'x' },
    { type: 'ask-block', block: { kind: 'tool', id: 'toolu_1', name: 'mcp__worca__list_runs', input: {}, status: 'running', durationMs: null } },
    { type: 'ask-usage', usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: null },
  ];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) m.apply(f);
  const d = m.takeDirty();
  assert.equal(d.structure, true);           // the streaming row appeared
  assert.equal(d.label, true);
  assert.equal(d.meters, true);
  assert.ok(d.answer.has(MID));
  assert.ok(d.blocks.get(MID).has('toolu_1'));
  const d2 = m.takeDirty();
  assert.equal(d2.structure, false);
  assert.equal(d2.answer.size, 0);
  assert.equal(d2.blocks.size, 0);
});

test('ask-model: a replayed ask-start after progress is stale, not a reset', () => {
  const m = createThreadModel({ threadId: TID });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  // apply everything but the terminal ask-done, then replay ask-start (seq 1)
  const nonTerminal = frames.filter((f) => f.type !== 'ask-done');
  for (const f of nonTerminal) m.apply(f);
  const before = m.live().text;
  assert.deepEqual(m.apply(frames[0]), { dropped: 'stale-seq' });
  assert.equal(m.live().text, before);
});

test('ask-model: unknown ask-* job frame types consume their seq silently', () => {
  const m = createThreadModel({ threadId: TID });
  const bare = [
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-future-frame', payload: 1 },
    { type: 'ask-delta', text: 'still fine' },
  ];
  const stamped = stampFrames(bare, { threadId: TID, messageId: MID });
  assert.deepEqual(m.apply(stamped[0]), { ok: true });
  assert.deepEqual(m.apply(stamped[1]), { ok: true });
  assert.deepEqual(m.apply(stamped[2]), { ok: true });
  assert.equal(m.live().text, 'still fine');
});

function userRow(id, seq, text) {
  return { id, threadId: TID, seq, role: 'user', text, blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't2' };
}

test('ask-model: a canonical user ask-message lands after seq-less live rows, not at the top', () => {
  const m = createThreadModel({ threadId: TID });
  // Turn 1 in a never-reloaded thread: the echo and the streamed answer carry no seq.
  m.noteLocalUserMessage({ id: 'askm_u0000001', text: 'first question', attachments: [] });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f);
  // Turn 2: the POST-side broadcast delivers the persisted user row BEFORE the local echo runs.
  m.apply({ type: 'ask-message', threadId: TID, message: userRow('askm_u0000002', 3, 'second question') });
  assert.deepEqual(m.messages().map((r) => r.id), ['askm_u0000001', MID, 'askm_u0000002']);
});

test('ask-model: the local echo keeps the seq of an already-received canonical row', () => {
  const m = createThreadModel({ threadId: TID });
  m.apply({ type: 'ask-message', threadId: TID, message: userRow('askm_u0000001', 1, 'hello') });
  m.noteLocalUserMessage({ id: 'askm_u0000001', text: 'hello', attachments: [] });
  assert.equal(m.messages().length, 1);
  assert.equal(m.messages()[0].seq, 1);
});

test('ask-model: a newer canonical user row never slots above the previous seq-less answer', () => {
  const m = createThreadModel({ threadId: TID });
  m.noteLocalUserMessage({ id: 'askm_u0000001', text: 'first question', attachments: [] });
  m.apply({ type: 'ask-message', threadId: TID, message: userRow('askm_u0000001', 1, 'first question') });
  const { frames } = replayFixture('plain-text', { threadId: TID, messageId: MID });
  for (const f of frames) m.apply(f); // assistant row stays seq-less until a reload
  m.apply({ type: 'ask-message', threadId: TID, message: userRow('askm_u0000002', 3, 'second question') });
  assert.deepEqual(m.messages().map((r) => r.id), ['askm_u0000001', MID, 'askm_u0000002']);
});

test('ask-model: a frame re-delivered at the SAME seq is dropped, not applied twice', () => {
  const m = createThreadModel({ threadId: TID });
  const stamped = stampFrames([
    { type: 'ask-start', userMessageId: 'u', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'once' },
  ], { threadId: TID, messageId: MID });
  for (const f of stamped) m.apply(f);
  assert.deepEqual(m.apply(stamped[1]), { dropped: 'stale-seq' }, 'seq === lastSeq is stale');
  assert.equal(m.live().text, 'once');
});

// Review of PR #376: adopting an out-of-turn delta seeded lastSeq to that frame's
// (high) seq, so the forced-subscribe replay (seq 1..N, incl. ask-start) was
// dropped as stale — blank/truncated answer, and no ask-start for the panel.
test('ask-model: a stray delta adopted before the subscribe replay does not make the replayed prefix stale', () => {
  const m = createThreadModel({ threadId: TID });
  m.load(snapshot({ inFlight: { messageId: MID } }));
  assert.deepEqual(m.apply({ type: 'ask-delta', text: 'E', threadId: TID, messageId: MID, seq: 5 }), { ok: true });
  assert.equal(m.live().text, 'E');
  // the forced-subscribe replay after resync(): seq 1..5 again
  assert.deepEqual(m.apply({ type: 'ask-start', threadId: TID, messageId: MID, seq: 1, startedAt: 't', model: 'm', effort: 'high' }), { ok: true }, 'a replayed start REWINDS an adopted turn');
  for (const [seq, text] of [[2, 'A'], [3, 'B'], [4, 'C'], [5, 'E']]) {
    assert.deepEqual(m.apply({ type: 'ask-delta', text, threadId: TID, messageId: MID, seq }), { ok: true }, `seq ${seq}`);
  }
  assert.equal(m.live().text, 'ABCE', 'the prefix is applied once and the adopted tail is not doubled');
  assert.deepEqual(m.apply({ type: 'ask-delta', text: 'F', threadId: TID, messageId: MID, seq: 6 }), { ok: true });
  assert.equal(m.live().text, 'ABCEF');
  // a SECOND replayed start (nothing adopted since) is stale exactly as before
  assert.deepEqual(m.apply({ type: 'ask-start', threadId: TID, messageId: MID, seq: 1 }), { dropped: 'stale-seq' });
  assert.equal(m.live().text, 'ABCEF');
});
