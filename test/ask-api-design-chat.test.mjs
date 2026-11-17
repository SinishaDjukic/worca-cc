// test/ask-api-design-chat.test.mjs
// Design P5 Task 6: a design chat's message route and turn starter. The `design` payload is required and checked,
// its pins are stored on the thread, the [design chat] block reaches the mock's design arm, no title or suggestion
// call ever fires, and the scope comes from the design row. Task 7 Step 5: a "Build it" turn hands over to the
// engine and lands a design-round card. One in-process server on the mock engine (test/helpers/design-chat-boot.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, openWs, waitFor, settled, mod } = await bootDesignChat(after);
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
const designThread = async (title = 'ShipRadar') => (await call('POST', '/api/design', { kind: 'web', title })).body;
const replyOf = settled;

test('the design payload is required, checked and stored; the block reaches the prompt', async () => {
  const d = await designThread();
  const tid = d.threadId;
  const post = (body) => call('POST', `/api/ask/threads/${tid}/messages`, { text: 'MOCK_DESIGN_CHAT hello', ...MODEL, ...body });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ design: { designId: 'd_ffffffffffff', pins: [] } })).body.error, 'design.designId does not match this chat');
  const pin = { id: 'hero', path: 'main > h1', tag: 'h1', text: 'Ship', html: '<h1>Ship</h1>', rect: [1, 2, 3, 4] };
  assert.equal((await post({ design: { designId: d.design.id, pins: [pin] } })).status, 202);
  const snap = await replyOf(tid);
  assert.deepEqual(snap.thread.composer.pins, [{ id: 'hero', path: 'main > h1', tag: 'h1', text: 'Ship', html: '<h1>Ship</h1>' }]);
  assert.match(snap.messages.at(-1).text, /^\[mock\] design status=empty pins=1$/);
  assert.deepEqual(snap.messages.at(-1).blocks.filter((b) => b.kind === 'tool'), []);
});
test('no title call and no suggestion, even on a thread with no title', async () => {
  const frames = [];
  const ws = await openWs((f) => frames.push(f));
  const d = await designThread();
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const naked = createThread({ mode: 'design' });
  getDb().prepare('UPDATE designs SET thread_id = ? WHERE id = ?').run(naked.id, d.design.id);
  assert.equal((await call('POST', `/api/ask/threads/${naked.id}/messages`, { text: 'MOCK_DESIGN_CHAT hi', ...MODEL, design: { designId: d.design.id, pins: [] } })).status, 202);
  const snap = await replyOf(naked.id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(snap.thread.title, null);
  assert.equal(frames.some((f) => f.threadId === naked.id && (f.type === 'ask-title' || f.type === 'ask-suggestion')), false);
  ws.close();
});
test('the scope comes from the design row, not the client', async () => {
  const d = await designThread();
  const r = await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_CHAT x', ...MODEL, design: { designId: d.design.id, pins: [] }, context: { view: 'design', pinned: true, projectKey: 'other-00000001' } });
  assert.equal(r.status, 202, 'a valid client context, ignored');
  const snap = await replyOf(d.threadId);
  assert.equal(snap.thread.context.pinned, false);
  assert.equal(snap.thread.context.projectKey, undefined);
});
test('a "Build it" message on a fresh design hands over to the engine and lands a design-round card', async () => {
  const d = await designThread('Handoff');
  const r = await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'Build it', ...MODEL, design: { designId: d.design.id, pins: [] } });
  assert.equal(r.status, 202);
  const snap = await replyOf(d.threadId);
  const cards = snap.messages.flatMap((m) => m.blocks || []).filter((b) => b.kind === 'card' && b.card?.type === 'design-round');
  assert.equal(cards.length, 1, 'one design-round card');
  assert.match(cards[0].card.buildId, /^b_[0-9a-f]{12}$/);
  assert.equal(cards[0].card.designId, d.design.id);
  const { getBuild } = await import('../src/core/design/store.mjs');
  assert.equal(getBuild(cards[0].card.buildId).createdBy, 'local', 'billed to the chat\'s person: local on a single-person install');
  await mod.designBuilds.settled();
});
test('the turn runs as a design chat: its own system prompt, no MCP servers, no agent mode, no title, no suggestion', async () => {
  const { DESIGN_SYSTEM_RULES } = await import('../src/core/ask/prompt.mjs');
  // A General server every Ask turn gets (test/ask-api-mcp.test.mjs): a design chat still gets none.
  const { addManualServer, putMember } = await import('../src/core/mcp/store.mjs');
  const def = await addManualServer('docs', { type: 'http', url: 'https://docs.example.com/mcp', fields: [], description: 'Team docs' });
  await putMember('general', 'manual:docs', { enabled: true, values: {} }, { def });
  const d = await designThread('Turn');
  assert.equal((await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_CHAT hi', ...MODEL, design: { designId: d.design.id, pins: [] } })).status, 202);
  await replyOf(d.threadId);
  const turn = mod._testing.askJobs.get(d.threadId)?.turn;
  assert.ok(turn, 'the finished job is kept for its grace period');
  assert.ok(turn.systemPrompt.startsWith(DESIGN_SYSTEM_RULES), 'the design rules lead the system prompt');
  assert.deepEqual([turn.design, turn.mcp, turn.skills, turn.agentMode, turn.firstTurn, turn.suggest], [true, null, null, false, false, false]);
  assert.match(turn.prompt, /^\[design chat\]$/m);
});
test('a design chat whose design is gone answers 409 before anything is stored', async () => {
  const { createThread } = await import('../src/core/ask/store.mjs');
  const orphan = createThread({ mode: 'design', title: 'Orphan' });
  const r = await call('POST', `/api/ask/threads/${orphan.id}/messages`, { text: 'MOCK_DESIGN_CHAT hi', ...MODEL, design: { designId: 'd_ffffffffffff', pins: [] } });
  assert.deepEqual([r.status, r.body], [409, { error: 'this chat has no design', code: 'no-design' }]);
  assert.deepEqual((await call('GET', `/api/ask/threads/${orphan.id}`)).body.messages, []);
});
test('a typed message closes the open clarifying cards, and only those', async () => {
  const d = await designThread('Questions');
  const { appendMessage } = await import('../src/core/ask/store.mjs');
  const card = (id, type, state) => ({ kind: 'card', id, state, card: { type, heading: 'Pick', questions: [], summary: 'Pick' } });
  appendMessage(d.threadId, { role: 'assistant', text: '', status: 'done', blocks: [
    card('card_0000000a', 'design-questions', 'asking'), card('card_0000000b', 'design-questions', 'answered'), card('card_0000000c', 'question', 'asking')] });
  assert.equal((await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_CHAT go on', ...MODEL, design: { designId: d.design.id, pins: [] } })).status, 202);
  const snap = await replyOf(d.threadId);
  const states = Object.fromEntries(snap.messages.flatMap((m) => m.blocks || []).filter((b) => b.kind === 'card').map((b) => [b.id, b.state]));
  assert.deepEqual(states, { card_0000000a: 'closed', card_0000000b: 'answered', card_0000000c: 'asking' });
});
test('M6: a refusal that lands after the route\'s awaits leaves the pins and the open clarifying card as they were', async () => {
  const d = await designThread('Late refusal');
  const tid = d.threadId;
  const { appendMessage, getThread, listMessages } = await import('../src/core/ask/store.mjs');
  const pin = (text) => ({ id: 'hero', path: 'main > h1', tag: 'h1', text, html: `<h1>${text}</h1>` });
  assert.equal((await call('POST', `/api/ask/threads/${tid}/messages`, { text: 'MOCK_DESIGN_CHAT one', ...MODEL, design: { designId: d.design.id, pins: [pin('P1')] } })).status, 202);
  await replyOf(tid);
  appendMessage(tid, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_0000a001', state: 'asking', card: { type: 'design-questions', heading: 'Pick', questions: [], summary: 'Pick' } }] });
  const stateOf = (id) => listMessages(tid).flatMap((m) => m.blocks || []).find((b) => b.id === id)?.state;
  const pinsNow = () => getThread(tid).composer.pins.map((p) => p.text);
  const post = () => call('POST', `/api/ask/threads/${tid}/messages`, { text: 'MOCK_DESIGN_CHAT two', ...MODEL, design: { designId: d.design.id, pins: [pin('P2')] } });
  // A job that reads as done at the route's first check and running after: another tab's turn started during the awaits.
  const lateJob = () => { let reads = 0; return { turn: null, messageId: null, get status() { reads += 1; return reads === 1 ? 'done' : 'running'; } }; };
  const jobs = mod._testing.askJobs;
  const planted = [[tid, lateJob()]];
  for (const [k, v] of planted) jobs.set(k, v);
  try {
    assert.deepEqual(await post(), { status: 409, body: { error: 'turn in flight' } });
  } finally { for (const [k, v] of planted) if (jobs.get(k) === v) jobs.delete(k); }
  assert.deepEqual([pinsNow(), stateOf('card_0000a001')], [['P1'], 'asking'], 'a turn in flight: nothing written');
  const others = [1, 2, 3].map((n) => [`ask_f000000${n}`, lateJob()]);
  for (const [k, v] of others) jobs.set(k, v);
  try {
    const r = await post();
    assert.equal(r.status, 429, JSON.stringify(r.body));
  } finally { for (const [k, v] of others) if (jobs.get(k) === v) jobs.delete(k); }
  assert.deepEqual([pinsNow(), stateOf('card_0000a001')], [['P1'], 'asking'], 'the cap filled meanwhile: nothing written');
});
test('the [worca context] cards of a design chat carry a design card\'s type, state and summary', async () => {
  const d = await designThread('Header');
  const { appendMessage } = await import('../src/core/ask/store.mjs');
  appendMessage(d.threadId, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_0000001a', state: 'running',
    card: { type: 'design-round', designId: d.design.id, buildId: 'b_0123456789ab', round: 1, kind: 'first', summary: 'Round 1 (first): x', baseVersion: 0 } }] });
  const ctx = await mod._testing.resolveAskContext(d.threadId, { view: 'design' });
  assert.deepEqual(ctx.cards, [{ id: 'card_0000001a', type: 'design-round', state: 'running', summary: 'Round 1 (first): x' }]);
});
test('the server hand-off: a build that ends before its card is stored still lands on the card, in a row of its own', async () => {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { designWorkDir } = await import('../src/core/design/paths.mjs');
  const d = await designThread('Direct');
  const r = await mod.designChatActions.apply({ kind: 'design-start', brief: 'A landing page' }, { threadId: d.threadId, by: 'local' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.block.id, /^card_[0-9a-f]{8}$/);
  assert.equal(existsSync(join(designWorkDir(d.design.id), '.kit', 'CONTRACT.md')), true, 'the web kit is staged before the build');
  await mod.designBuilds.settled();
  r.posted(false);
  const snap = (await call('GET', `/api/ask/threads/${d.threadId}`)).body;
  const row = snap.messages.find((m) => (m.blocks || []).some((b) => b.id === r.block.id));
  assert.deepEqual([row.role, row.status, row.blocks.length, row.blocks[0].kind, row.blocks[0].card.buildId], ['assistant', 'done', 1, 'card', r.block.card.buildId]);
  assert.notEqual(row.blocks[0].state, 'running', 'the terminal frame waited for posted()');
});
test('a design chat message answers 404 while the design flag is off', async () => {
  const d = await designThread('Off');
  process.env.WORCA_FLAGS = '-design';
  try {
    const r = await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_CHAT hi', ...MODEL, design: { designId: d.design.id, pins: [] } });
    assert.deepEqual([r.status, r.body], [404, { error: 'not found' }]);
    assert.deepEqual(await mod.designChatActions.apply({ kind: 'design-start', brief: 'x' }, { threadId: d.threadId, by: 'local' }),
      { ok: false, notice: 'Design is switched off.' }, 'an event turn\'s hand-off reads the flag too');
  } finally {
    process.env.WORCA_FLAGS = 'design';
    await replyOf(d.threadId);
  }
});
