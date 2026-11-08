// test/ui-design-chat-client.test.mjs — the Design chat's thin client (ui/public/design/chat.mjs, no DOM): the design's
// thread over the Ask thread model, its recovery after a delete, the card and build answers, the question state from
// C-5 frames, and the receipt row's fixed copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignChatClient, createQuestionState, answerBuildQuestion, roundRowText, canGoBack } from '../ui/public/design/chat.mjs';

const DID = 'd_00000000a001';
// A pin as P4's stage hands it over: `label` and the box are the dock's, never sent.
const PIN = { id: 'hero', path: 'main > h1', tag: 'h1', text: 'Ship', html: '<h1>', label: 'Hero · h1', rect: { x: 0, y: 0, w: 320, h: 48 } };
const MODELS = { default: { model: 'm', effort: 'e' }, models: [] };

/** A fake fetch by route table, recording `{url, body}` for each POST, and the client over it. `mode: null` serves a
 *  thread that is not a design thread; `get404` answers 404 for the design's own thread only; `recreate409` answers the
 *  thread create with 409 naming that thread; `engine` locks the served thread; `catalog` replaces the models answer;
 *  `createError` refuses the create (404) and `messageError` the message (409) with those words; `wrap` wraps the fake
 *  (a GET gate). */
function rig({ threadId = null, get404 = false, makes = 'ask_00000002', recreate409 = null, mode = 'design', cardStatus = 200, cardError = '', engine = null, catalog = MODELS, createError = null, messageError = null, wrap = (f) => f } = {}) {
  const posts = [];
  const changes = [];
  const ws = [];
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const thread = (id, m = mode) => ({ id, mode: m, title: 'Landing page', designId: DID, ...(engine ? { engine } : {}) });
  const fake = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'POST') posts.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET' && url === '/api/ask/models') return reply(200, catalog);
    const get = /^\/api\/ask\/threads\/([^/]+)$/.exec(url);
    if (method === 'GET' && get) {
      if (get404 && get[1] === threadId) return reply(404, { error: 'thread not found' });
      return reply(200, { thread: thread(get[1]), messages: [], attachments: [], runLinks: [], inFlight: null });
    }
    if (method === 'POST' && url === '/api/ask/threads') {
      if (recreate409) return reply(409, { error: 'this design already has its chat', threadId: recreate409 });
      return createError ? reply(404, { error: createError }) : reply(201, { thread: thread(makes, 'design') });
    }
    if (method === 'POST' && /\/messages$/.test(url)) {
      return messageError ? reply(409, { error: messageError }) : reply(202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' });
    }
    if (method === 'POST' && /\/cards\/[^/]+$/.test(url)) return reply(cardStatus, cardStatus < 300 ? { ok: true } : { error: cardError });
    if (method === 'POST' && /\/stop$/.test(url)) return reply(200, { ok: true });
    return reply(404, { error: 'no route' });
  };
  const client = createDesignChatClient({ designId: DID, threadId, fetch: wrap(fake), sendWs: (o) => ws.push(o), onChange: (k) => changes.push(k) });
  return { client, posts, changes, ws };
}
const ticks = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

test('send posts text, the pick and the design payload; an empty pin list still says the design', async () => {
  const { client, posts } = rig({ threadId: 'ask_00000001' });
  await client.open();
  assert.deepEqual(await client.send('Build it', { pins: [PIN] }), { ok: true });
  assert.deepEqual(posts.at(-1).body, { text: 'Build it', model: 'm', effort: 'e', context: { view: 'design' }, design: { designId: DID, pins: [{ id: 'hero', path: 'main > h1', tag: 'h1', text: 'Ship', html: '<h1>' }] } });
  await client.send('Again', {});
  assert.deepEqual(posts.at(-1).body.design, { designId: DID, pins: [] });
  assert.equal(posts.at(-1).body.attachments, undefined);
});
test('Review Focus 2: a deleted chat recreates its thread on the next send and sends there', async () => {
  const { client, posts } = rig({ threadId: 'ask_00000001', get404: true, makes: 'ask_00000002' });
  await client.open();
  client.pushFrame({ type: 'ask-history-cleared' });
  assert.equal((await client.send('Hello', {})).ok, true);
  assert.deepEqual(posts.find((p) => p.url === '/api/ask/threads').body, { mode: 'design', designId: DID });
  assert.equal(posts.at(-1).url, '/api/ask/threads/ask_00000002/messages');
});
test('a 409 on recreate means another tab made it: load that thread', async () => {
  const { client, posts } = rig({ threadId: 'ask_00000001', get404: true, recreate409: 'ask_00000003' });
  await client.open();
  await client.send('Hello', {});
  assert.equal(posts.at(-1).url, '/api/ask/threads/ask_00000003/messages');
});
test('a thread that is not a design thread is treated as gone', async () => {
  const { client } = rig({ threadId: 'ask_00000001', mode: null });
  assert.equal(await client.open(), false);
  assert.equal(client.model(), null);
});
test('a seq gap reloads once; another thread\'s frames are ignored', async () => {
  let gets = 0;
  let calls = 0;
  let release = null;
  let gate = null;
  const { client, changes } = rig({ threadId: 'ask_00000001', wrap: (f) => async (url, opts) => {
    calls += 1;
    if (/\/api\/ask\/threads\/ask_00000001$/.test(url)) { gets += 1; if (gate) await gate; }
    return f(url, opts);
  } });
  // open() GETs the thread itself: the gate goes in once it resolved.
  assert.equal(await client.open(), true);
  gets = 0;
  gate = new Promise((r) => { release = r; });
  assert.equal((await client.send('one', {})).ok, true);
  client.pushFrame({ type: 'ask-start', threadId: 'ask_00000001', messageId: 'msg_0000bbbb', userMessageId: 'msg_0000aaaa', seq: 1 });
  for (let s = 5; s < 25; s += 1) client.pushFrame({ type: 'ask-delta', threadId: 'ask_00000001', messageId: 'msg_0000bbbb', seq: s, text: 'x' });
  assert.equal(gets, 1, 'every frame after a gap gaps too: one GET per frame would flood the server');
  release();
  await ticks();
  // The reload landed: the next gap may reload again.
  gate = Promise.resolve();
  client.pushFrame({ type: 'ask-start', threadId: 'ask_00000001', messageId: 'msg_0000dddd', userMessageId: 'msg_0000cccc', seq: 1 });
  client.pushFrame({ type: 'ask-delta', threadId: 'ask_00000001', messageId: 'msg_0000dddd', seq: 9, text: 'x' });
  assert.equal(gets, 2);
  await ticks();
  // Another chat's frame: the model stays as it was, nothing repaints and nothing is fetched.
  const before = client.model();
  const rows = JSON.stringify(before.messages());
  const seen = calls;
  changes.length = 0;
  client.pushFrame({ type: 'ask-delta', threadId: 'ask_ffffffff', messageId: 'msg_0000dddd', seq: 2, text: 'y' });
  assert.equal(client.model(), before);
  assert.equal(JSON.stringify(client.model().messages()), rows);
  assert.equal(calls, seen, 'fetches nothing');
  assert.deepEqual(changes, [], 'no repaint');
});
test('answerCard posts answers and throws the server text so the card shows it', async () => {
  const { client, posts } = rig({ threadId: 'ask_00000001', cardStatus: 400, cardError: 'answer every question with one of its options' });
  await client.open();
  await assert.rejects(() => client.answerCard('card_00000001', new Map([['tone', 'nope']])), /answer every question/);
  assert.deepEqual(posts.at(-1).body, { answers: [{ id: 'tone', value: 'nope' }] });
});
test('createQuestionState follows C-5 and nothing else', () => {
  const s = createQuestionState({ designId: DID });
  const q = { type: 'design-question', designId: DID, buildId: 'b_1', agentId: 'a_1', askId: 'as_1', job: 'Hero', heading: 'Hero needs a decision', questions: [] };
  s.push(q); s.push({ ...q, designId: 'd_other', askId: 'as_x' });
  assert.deepEqual(s.list().map((x) => [x.askId, x.state]), [['as_1', 'open']]);
  s.push({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_1', status: 'writing' });
  assert.equal(s.list()[0].state, 'closed');
  s.push({ type: 'design-snapshot', designId: DID, buildId: 'b_2', questions: [{ agentId: 'a_2', askId: 'as_2', job: 'Pricing', heading: 'H', questions: [] }] });
  assert.deepEqual(s.list().map((x) => [x.askId, x.buildId, x.state]), [['as_2', 'b_2', 'open']]);
  s.push({ type: 'design-build', designId: DID, buildId: 'b_2', status: 'done', stats: {} });
  assert.deepEqual(s.list(), []);
  s.push({ ...q, askId: 'as_3' }); s.push({ type: 'design-build', designId: DID, buildId: 'b_1', status: 'building', stats: {} });
  assert.equal(s.list().length, 1, 'a live build keeps its question');
  s.push({ type: 'design-build', designId: DID, buildId: 'b_1', status: 'paused', stats: {} });
  assert.deepEqual(s.list(), [], 'P2 answers 409 for a paused build (routes.mjs:232-234); Resume asks again through a frame or the snapshot');
});
test('answerBuildQuestion: the C-8 body; 200 answered, 409 closed, 422 throws', async () => {
  const q = { buildId: 'b_1', askId: 'as_1' }; const seen = [];
  const f = (status, body = {}) => async (url, o) => { seen.push([url, JSON.parse(o.body)]); return { status, ok: status < 400, json: async () => body }; };
  assert.equal(await answerBuildQuestion({ designId: DID, fetch: f(200) }, q, new Map([['q1', 'a']])), 'answered');
  assert.deepEqual(seen[0], [`/api/design/${DID}/builds/b_1/answer`, { askId: 'as_1', answers: [{ id: 'q1', value: 'a' }] }]);
  assert.equal(await answerBuildQuestion({ designId: DID, fetch: f(409) }, q, new Map()), 'closed');
  await assert.rejects(() => answerBuildQuestion({ designId: DID, fetch: f(422, { error: 'pick one' }) }, q, new Map()), /pick one/);
});
test('roundRowText and canGoBack: the fixed copy; M2 keeps restore on finished rounds with a past', () => {
  const c = { round: 2, kind: 'first', baseVersion: 1, agents: 12, elapsedMs: 374000, costUsd: 4.2, costKnown: true };
  assert.equal(roundRowText(c, 'running'), 'Round 2: building');
  assert.equal(roundRowText(c, 'paused'), 'Round 2: paused · $4.20');
  assert.equal(roundRowText(c, 'done'), 'Built by 12 agents in 6m 14s · $4.20');
  assert.equal(roundRowText({ ...c, kind: 'change' }, 'done'), 'Changed by 12 agents in 6m 14s · $4.20', 'the HUD\'s word (M12)');
  assert.equal(roundRowText({ ...c, agents: 1, elapsedMs: 40000, costKnown: false }, 'done'), 'Built by 1 agent in 40s · cost unknown');
  assert.equal(roundRowText(c, 'stopped'), 'Round 2: stopped · $4.20');
  assert.equal(roundRowText(c, 'failed'), 'Round 2: failed');
  assert.equal(roundRowText(c, 'interrupted'), 'Round 2: interrupted by a restart');
  assert.equal(canGoBack({ state: 'done', card: { baseVersion: 1 } }, { buildLive: false }), true);
  assert.equal(canGoBack({ state: 'stopped', card: { baseVersion: 1 } }, { buildLive: false }), true);
  assert.equal(canGoBack({ state: 'paused', card: { baseVersion: 1 } }, { buildLive: false }), false);
  assert.equal(canGoBack({ state: 'done', card: { baseVersion: 0 } }, { buildLive: false }), false);
  assert.equal(canGoBack({ state: 'running', card: { baseVersion: 1 } }, { buildLive: false }), false);
  assert.equal(canGoBack({ state: 'done', card: { baseVersion: 1 } }, { buildLive: true }), false);
});

test('a design with no thread: open() is false, and stop and answerCard reach no route', async () => {
  let calls = 0;
  const { client } = rig({ wrap: (f) => async (url, opts) => { calls += 1; return f(url, opts); } });
  assert.equal(await client.open(), false);
  await client.stop();
  await assert.rejects(() => client.answerCard('card_00000001', new Map()), /Answer not sent/);
  assert.equal(calls, 0);
});
test('Review Focus 2: Delete all drops a loaded design chat and the next send makes a fresh one; a shared clear of other threads keeps it', async () => {
  let gets = 0;
  const { client, posts, changes } = rig({ threadId: 'ask_00000001', makes: 'ask_00000002', wrap: (f) => async (url, opts) => { if (/\/api\/ask\/threads\/ask_00000001$/.test(url)) gets += 1; return f(url, opts); } });
  assert.equal(await client.open(), true);
  assert.equal(await client.open(), true);
  assert.equal(gets, 1, 'a loaded chat opens without a second GET');
  client.pushFrame({ type: 'ask-history-cleared', threadIds: ['ask_0000ffff'] });
  assert.equal(client.threadId(), 'ask_00000001', 'another person\'s clear keeps this chat');
  changes.length = 0;
  client.pushFrame({ type: 'ask-history-cleared', threadIds: ['ask_00000001'] });
  assert.equal(client.threadId(), null);
  assert.equal(client.model(), null);
  assert.deepEqual(changes, ['structure'], 'the dock repaints empty once');
  assert.equal((await client.send('Hello', {})).ok, true);
  assert.deepEqual(posts.map((p) => p.url), ['/api/ask/threads', '/api/ask/threads/ask_00000002/messages']);
  assert.equal(client.busy(), true);
  // A single-user clear carries no list: it drops too, with the wait for the deleted turn.
  client.pushFrame({ type: 'ask-history-cleared' });
  assert.equal(client.threadId(), null);
  assert.equal(client.busy(), false, 'the 202 it waited for belongs to the deleted thread');
});
test('busy() holds from the 202 until the turn ends; a second send is refused; a clear during the POST never writes into the dropped chat', async () => {
  const { client } = rig({ threadId: 'ask_00000001' });
  await client.open();
  const first = client.send('one', {});
  assert.deepEqual(await client.send('two', {}), { ok: false, error: 'A message is already on its way.' });
  assert.deepEqual(await first, { ok: true });
  assert.equal(client.busy(), true, 'the 202 promised a turn: a second Enter would get a 409');
  client.pushFrame({ type: 'ask-start', threadId: 'ask_00000001', messageId: 'msg_0000bbbb', userMessageId: 'msg_0000aaaa', seq: 1 });
  client.pushFrame({ type: 'ask-done', threadId: 'ask_00000001', messageId: 'msg_0000bbbb', seq: 2, text: 'ok', blocks: [] });
  assert.equal(client.busy(), false);
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const slow = rig({ threadId: 'ask_00000001', wrap: (f) => async (url, opts) => { if (/\/messages$/.test(url)) await gate; return f(url, opts); } });
  await slow.client.open();
  const before = slow.client.model();
  const p = slow.client.send('three', {});
  await ticks();
  slow.client.pushFrame({ type: 'ask-history-cleared' });
  release();
  assert.deepEqual(await p, { ok: true });
  assert.equal(before.messages().length, 0, 'the reply belongs to the chat it was sent to; its rows arrive over the socket');
  assert.equal(slow.client.busy(), false, 'a dropped chat never keeps the old turn\'s wait');
});
test('a chat locked to an engine sends that engine\'s default and engine() names it; a fresh one takes the Ask default', async () => {
  const catalog = { default: { model: 'm', effort: 'e' }, defaults: { codex: { model: 'gpt-x', effort: 'medium' } }, models: [{ id: 'm' }, { id: 'gpt-x', engine: 'codex' }] };
  const locked = rig({ threadId: 'ask_00000001', engine: 'codex', catalog });
  assert.equal(await locked.client.open(), true);
  assert.equal(await locked.client.engine(), 'codex');
  await locked.client.send('Hi', {});
  assert.deepEqual([locked.posts.at(-1).body.model, locked.posts.at(-1).body.effort], ['gpt-x', 'medium']);
  const fresh = rig({ threadId: 'ask_00000001', catalog });
  assert.equal(await fresh.client.open(), true);
  assert.equal(await fresh.client.engine(), 'claude');
  await fresh.client.send('Hi', {});
  assert.equal(fresh.posts.at(-1).body.model, 'm');
});
test('createQuestionState: an agent that moves on closes only its own open question; an answer stays; every end clears', () => {
  const s = createQuestionState({ designId: DID });
  const q = (agentId, askId) => ({ type: 'design-question', designId: DID, buildId: 'b_1', agentId, askId, job: 'Hero', heading: 'Hero needs a decision', questions: [] });
  s.push(q('a_1', 'as_1')); s.push(q('a_2', 'as_2')); s.push(q('a_3', 'as_3'));
  s.push({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_1', status: 'waiting' });
  s.mark('as_2', 'answered', new Map([['q1', 'a']]));
  s.push({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_2', status: 'writing' });
  s.push({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_3', status: 'done' });
  assert.deepEqual(s.list().map((x) => [x.askId, x.state]), [['as_1', 'open'], ['as_2', 'answered'], ['as_3', 'closed']]);
  assert.deepEqual([...s.list()[1].picks], [['q1', 'a']]);
  for (const status of ['stopped', 'error', 'interrupted']) {
    s.push(q('a_1', 'as_1'));
    s.push({ type: 'design-build', designId: DID, buildId: 'b_1', status, stats: {} });
    assert.deepEqual(s.list(), [], status);
  }
});
test('roundRowText and canGoBack: a known cost with no figure reads cost unknown; failed and interrupted rounds keep restore', () => {
  const c = { round: 3, kind: 'first', baseVersion: 2, agents: 2, elapsedMs: 5000, costUsd: null, costKnown: true };
  assert.equal(roundRowText(c, 'stopped'), 'Round 3: stopped · cost unknown');
  assert.equal(canGoBack({ state: 'failed', card: c }, { buildLive: false }), true);
  assert.equal(canGoBack({ state: 'interrupted', card: c }, { buildLive: false }), true);
});
test('send says why it sent nothing: the design refused, no model, the message refused; a sent one subscribes', async () => {
  const gone = rig({ createError: 'design not found' });
  assert.deepEqual(await gone.client.send('Hi', {}), { ok: false, error: 'design not found' });
  assert.deepEqual(gone.posts.map((p) => p.url), ['/api/ask/threads']);
  const none = rig({ threadId: 'ask_00000001', catalog: { models: [] } });
  assert.deepEqual(await none.client.send('Hi', {}), { ok: false, error: 'No model is available for the chat.' });
  assert.deepEqual(none.posts, []);
  const refused = rig({ threadId: 'ask_00000001', messageError: 'a reply is already running' });
  assert.deepEqual(await refused.client.send('Hi', {}), { ok: false, error: 'a reply is already running' });
  assert.equal(refused.client.busy(), false);
  const sent = rig({ threadId: 'ask_00000001' });
  assert.deepEqual(await sent.client.send('Hi', {}), { ok: true });
  assert.deepEqual(sent.ws.at(-1), { type: 'subscribe', threadId: 'ask_00000001' });
});
test('a 409 on recreate loads the other tab\'s thread before sending; a load that a clear overtook never brings the chat back', async () => {
  const { client } = rig({ threadId: 'ask_00000001', get404: true, recreate409: 'ask_00000003' });
  await client.open();
  assert.deepEqual(await client.send('Hello', {}), { ok: true });
  assert.equal(client.threadId(), 'ask_00000003');
  assert.equal(client.model().thread().mode, 'design');
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const slow = rig({ threadId: 'ask_00000001', wrap: (f) => async (url, opts) => { if (/\/api\/ask\/threads\/ask_00000001$/.test(url)) await gate; return f(url, opts); } });
  const opening = slow.client.open();
  await ticks();
  slow.client.pushFrame({ type: 'ask-history-cleared' });
  release();
  assert.equal(await opening, false);
  assert.equal(slow.client.model(), null);
  // A late 404 for the deleted thread never drops the one the next send made meanwhile.
  let let404 = null;
  const held = new Promise((r) => { let404 = r; });
  const late = rig({ threadId: 'ask_00000001', get404: true, makes: 'ask_00000002', wrap: (f) => async (url, opts) => { if (/\/api\/ask\/threads\/ask_00000001$/.test(url)) await held; return f(url, opts); } });
  const stale = late.client.open();
  await ticks();
  late.client.pushFrame({ type: 'ask-history-cleared' });
  assert.deepEqual(await late.client.send('Hello', {}), { ok: true });
  let404();
  assert.equal(await stale, false);
  assert.equal(late.client.threadId(), 'ask_00000002');
});
