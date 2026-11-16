// test/stillhet-chat-live-reload.test.mjs — F-a1-05: a live chat's reply (ui/public/stillhet/live/chat-live.mjs) grows frame
// by frame, and keeps growing after a reload, a socket reconnect and a switch back, ending once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startChatLive } from '../ui/public/stillhet/live/chat-live.mjs';
import { THREAD } from './helpers/stillhet-live-fixture.mjs';

const tick = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const URL1 = '/api/ask/threads/ask_1';
// the GET of a chat whose reply runs (ui/routes/chat/threads.mjs): the assistant row streams, `inFlight` names it
const streaming = (text = '', id = 'ask_1') => ({ ...THREAD, thread: { ...THREAD.thread, id }, messages: [THREAD.messages[0], { id: 'a9', role: 'assistant', text, status: 'streaming', blocks: [], createdAt: '2026-11-12T13:01:00Z' }], inFlight: { messageId: 'a9' } });
// `held(url)`: that GET waits until `release(url)`; `body(url, n)` answers the n-th GET of it
function rig({ body = () => streaming(), held = () => false } = {}) {
  const calls = [], sent = [], gates = new Map();
  const fetch = async (url, o = {}) => {
    const method = o.method || 'GET';
    calls.push({ url, method, body: o.body ? JSON.parse(o.body) : undefined });
    if (method === 'GET' && url.startsWith('/api/ask/threads/')) {
      const n = calls.filter((c) => c.url === url && c.method === 'GET').length;
      if (held(url, n)) await new Promise((res) => gates.set(url, res));
      return { ok: true, status: 200, json: async () => body(url, n) };
    }
    if (url.endsWith('/messages')) return { ok: true, status: 202, json: async () => ({ userMessageId: 'u5' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const live = startChatLive({ fetch, send: (m) => sent.push(m), now: () => 0 });
  const release = (url = URL1) => { const g = gates.get(url); gates.delete(url); g(); };
  return { live, calls, sent, release, gets: (url = URL1) => calls.filter((c) => c.url === url && c.method === 'GET').length };
}
const F = (type, seq, over = {}) => ({ type, threadId: 'ask_1', messageId: 'a9', seq, ...over });
const START = (seq = 1) => F('ask-start', seq, { userMessageId: 'm1', startedAt: '2026-11-12T13:01:00Z' });
const DELTA = (seq, text) => F('ask-delta', seq, { text });
const DONE = (seq) => F('ask-done', seq, { status: 'done', text: 'Hello world', blocks: [] });
const REPLAY = [START(1), DELTA(2, 'Hel'), DELTA(3, 'lo')];
const wordsOf = (turns) => turns.filter((x) => x.t === 'words').map((x) => x.html).join('|');
const SUB = { type: 'subscribe', threadId: 'ask_1' };
// one end: one finished words turn with its markdown, nothing still working
function endedOnce(live) {
  const turns = live.turns('ask_1'), words = turns.filter((x) => x.t === 'words');
  assert.deepEqual(words.map((x) => [x.html, x.md]), [['Hello world', 'Hello world']]);
  assert.equal(turns.filter((x) => x.t === 'working').length, 0);
}

test('F-a1-05: an open chat\'s reply grows with each delta and ends once', async () => {
  const r = rig({ body: () => ({ ...THREAD, messages: THREAD.messages.slice(0, 1) }) });
  await r.live.open('ask_1');
  r.live.frame(START());
  const seen = [];
  for (const [i, t] of ['Hel', 'lo', ' world'].entries()) { r.live.frame(DELTA(i + 2, t)); seen.push(wordsOf(r.live.turns('ask_1'))); }
  assert.deepEqual(seen, ['Hel', 'Hello', 'Hello world']);
  assert.equal(r.live.turns('ask_1').filter((x) => x.t === 'working').length, 1, 'still working while it streams');
  r.live.frame(DONE(5));
  endedOnce(r.live);
  r.live.frame(DONE(5));
  endedOnce(r.live);
});

test('F-a1-05: drawing the live text leaves the model\'s row alone', async () => {
  const r = rig();
  await r.live.open('ask_1');
  for (const f of REPLAY) r.live.frame(f);
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello');
  assert.equal(r.live.model('ask_1').messages().find((m) => m.id === 'a9').text, '', 'the model row keeps its own text');
});

test('F-a1-05 reload: frames replayed while the GET is out are applied once, then live deltas keep it growing', async () => {
  const r = rig({ body: () => streaming('Hel'), held: () => true });
  const p = r.live.open('ask_1');
  await tick();
  for (const f of [...REPLAY, DELTA(3, 'lo')]) r.live.frame(f);
  r.release(); await p;
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello');
  r.live.frame(DELTA(4, ' wor'));
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello wor');
  r.live.frame(DELTA(2, 'Hel'));
  r.live.frame(DELTA(5, 'ld'));
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world', 'no piece repeated');
  r.live.frame(DONE(6));
  endedOnce(r.live);
});

test('F-a1-05 reload: the replay that comes after the load is asked for again and makes the row grow', async () => {
  const r = rig();
  await r.live.open('ask_1');
  assert.deepEqual(r.sent, [SUB, SUB], 'subscribed again after the read that found a reply running');
  for (const f of REPLAY) r.live.frame(f);
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello');
  r.live.frame(DELTA(4, ' world'));
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world');
  r.live.frame(DONE(5));
  endedOnce(r.live);
  const idle = rig({ body: () => ({ ...THREAD, messages: THREAD.messages.slice(0, 1) }) });
  await idle.live.open('ask_1');
  assert.deepEqual(idle.sent, [SUB], 'a chat with no reply running is not subscribed twice');
});

test('F-a1-05 reload: a subscribe the socket dropped is sent again once a broadcast frame is adopted, and the full text comes back', async () => {
  const r = rig();
  await r.live.open('ask_1');
  const before = r.sent.length;
  r.live.frame(DELTA(7, '!'));
  assert.deepEqual(r.sent.slice(before), [SUB], 'one catch-up subscribe');
  for (const f of [START(1), DELTA(2, 'He'), DELTA(3, 'l'), DELTA(4, 'lo'), DELTA(5, ' wor'), DELTA(6, 'ld'), DELTA(7, '!')]) r.live.frame(f);
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world!', 'the whole text, not only the tail');
  r.live.frame(DELTA(8, '?'));
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world!?');
  assert.deepEqual(r.sent.slice(before), [SUB], 'nothing more is sent');
});

test('F-a1-05 reconnect: a dropped socket\'s re-read keeps the reply growing and never shows less than before', async () => {
  const r = rig({ held: (url, n) => n === 2 });
  await r.live.open('ask_1');
  for (const f of REPLAY) r.live.frame(f);
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello');
  r.live.reconnect();
  await tick();
  for (const f of REPLAY) r.live.frame(f);
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello', 'shown while the re-read is out');
  r.release(); await tick();
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello', 'never less than before');
  r.live.frame(DELTA(4, ' world'));
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world');
  r.live.frame(DONE(5)); r.live.frame(DONE(5));
  endedOnce(r.live);
});

test('F-a1-05 switch back: a chat left mid-reply shows the text it grew meanwhile, with no new read', async () => {
  const r = rig({ body: (url) => (url === URL1 ? streaming() : { ...THREAD, thread: { ...THREAD.thread, id: 'ask_2' }, messages: [] }) });
  await r.live.open('ask_1');
  for (const f of REPLAY) r.live.frame(f);
  await r.live.open('ask_2');
  r.live.frame(DELTA(4, ' world'));
  await r.live.open('ask_1');
  assert.equal(r.gets(), 1, 'no new read');
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world');
  r.live.frame(DONE(5));
  endedOnce(r.live);
});

test('F-a1-05: a queued message waits for the caught-up reply\'s one end', async () => {
  const r = rig();
  await r.live.open('ask_1');
  r.live.look({}, 'ask_1');
  const res = await r.live.act('send', { threadId: 'ask_1', text: 'next', queue: true });
  assert.equal(res.queued, true);
  for (const f of [...REPLAY, DELTA(4, ' world')]) r.live.frame(f);
  const posts = () => r.calls.filter((c) => c.method === 'POST' && c.url === `${URL1}/messages`);
  assert.equal(posts().length, 0, 'waits while the reply runs');
  r.live.frame(DONE(5)); await tick();
  r.live.frame(DONE(5)); await tick();
  assert.equal(posts().length, 1, 'sent exactly once');
  assert.equal(posts()[0].body.text, 'next');
});

test('F-a1-05 reload: a read that finds a reply running and adopted a waiting frame subscribes once more, not twice', async () => {
  const r = rig({ body: () => streaming('Hel'), held: () => true });
  const p = r.live.open('ask_1');
  await tick();
  r.live.frame(DELTA(7, '!'));
  r.release(); await p;
  assert.deepEqual(r.sent, [SUB, SUB], 'the subscribe before the read and one after it');
  r.live.frame(DELTA(8, '?'));
  assert.deepEqual(r.sent, [SUB, SUB], 'the next broadcast frame asks for nothing more');
  for (const f of [START(1), DELTA(2, 'Hel'), DELTA(3, 'lo'), DELTA(4, ' wor'), DELTA(5, 'ld')]) r.live.frame(f);
  assert.equal(wordsOf(r.live.turns('ask_1')), 'Hello world');
});
