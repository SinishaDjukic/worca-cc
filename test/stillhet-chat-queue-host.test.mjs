// test/stillhet-chat-queue-host.test.mjs — Chat in the app host, live kind: the composer's queue (form.composer-queue)
// (jsdom, the app's scripts in boot.js's order, data-adapter="live"); the host and its helpers are
// test/helpers/stillhet-chat-live-host.mjs. The rail's CSS cascade is read with test/helpers/css-rules.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THREAD, go, liveHost, posts, saidText, settle, toastText, closeHosts } from './helpers/stillhet-chat-live-host.mjs';
import { cssRules } from './helpers/css-rules.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends

// ---- F-a2-01: a send while a reply streams is queued (form.composer-queue) ----
const ask = (sockets, f) => sockets.at(-1).onmessage({ data: JSON.stringify({ threadId: 'ask_1', ...f }) });
const START = (id = 'a9') => ({ type: 'ask-start', messageId: id, userMessageId: `u${id}`, seq: 1, startedAt: THREAD.messages[0].createdAt });
const DONE = (id = 'a9', status = 'done', seq = 2) => ({ type: 'ask-done', messageId: id, seq, status, text: 'ok' });
const enter = (w, text) => { const t = w.document.querySelector('#route-chat [data-composer-t]'); t.value = text; t.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return settle(60); };
const sent = (calls) => posts(calls).filter(([m, u]) => m === 'POST' && u === '/api/ask/threads/ask_1/messages').map(([, , b]) => b.text);
const note = (d) => d.querySelector('#route-chat [data-q-note]');
const rowsOf = (d) => [...d.querySelectorAll('#route-chat .composer-queue .tr-text')].map((e) => e.textContent);
const accept = (url) => (url.endsWith('/messages') ? [202, { userMessageId: 'u5' }] : [200, {}]);

test('F-a2-01: Enter while the reply streams posts nothing, empties the box and shows "Sends when the reply finishes"; ask-done sends one POST with the text and the line goes', async () => {
  const { w, d, calls, sockets } = await liveHost({ write: accept });
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  assert.ok(d.querySelector('#route-chat [data-cp-stop]'), 'the reply runs: Stop');
  await enter(w, 'and the totals');
  assert.deepEqual(sent(calls), [], 'no POST while the reply runs');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, '');
  assert.deepEqual(rowsOf(d), ['Queued and the totals']);
  assert.equal(note(d).textContent, 'Sends when the reply finishes');
  ask(sockets, DONE()); await settle(80);
  assert.deepEqual(sent(calls), ['and the totals'], 'one POST with the text');
  assert.equal(note(d), null, 'the line goes');
});

test('F-a2-01: a redraw between (a delta frame, and going to another chat and back) keeps the queued row and its line; the turn\'s end still sends it once', async () => {
  const { w, d, calls, sockets } = await liveHost({ write: accept });
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  await enter(w, 'kept');
  ask(sockets, { type: 'ask-delta', messageId: 'a9', seq: 2, text: 'Writing' }); await settle(40);
  assert.deepEqual(rowsOf(d), ['Queued kept'], 'after a delta frame');
  await go(w, '#chat/ask_2'); await go(w, '#chat/ask_1');
  assert.deepEqual(rowsOf(d), ['Queued kept'], 'after another chat and back');
  assert.equal(note(d).textContent, 'Sends when the reply finishes');
  ask(sockets, DONE('a9', 'done', 3)); await settle(80);
  ask(sockets, DONE('a9', 'done', 3)); await settle(40);
  assert.deepEqual(sent(calls), ['kept'], 'sent once');
});

test('F-a2-01: a 409 turn in flight on a send is not lost: no "Could not send" toast, the row shows, and after the event turn\'s ask-start and ask-done one more POST carries the text', async () => {
  let busy = false;
  const { w, d, calls, sockets } = await liveHost({
    thread: () => [200, busy ? { ...THREAD, inFlight: { messageId: 'a9' } } : THREAD],   // the re-read learns dev's turn
    write: (url) => { if (!url.endsWith('/messages')) return [200, {}]; if (!busy) { busy = true; return [409, { error: 'turn in flight' }]; } return [202, { userMessageId: 'u5' }]; },
  });
  await go(w, '#chat/ask_1');
  await enter(w, 'raced'); await settle(40);
  assert.doesNotMatch(toastText(d), /Could not send/);
  assert.deepEqual(rowsOf(d), ['Queued raced']);
  assert.deepEqual(sent(calls), ['raced'], 'the refused one only');
  ask(sockets, START()); await settle(40);
  ask(sockets, DONE()); await settle(80);
  assert.deepEqual(sent(calls), ['raced', 'raced'], 'one more POST carries it');
  assert.deepEqual(rowsOf(d), []);
});

test('F-a2-01: a Stop pauses it: "Queue paused: the reply was stopped" and Send now; Send now posts it once; Remove takes a row out', async () => {
  let h;
  h = await liveHost({ write: (url) => { if (url.endsWith('/stop')) ask(h.sockets, DONE('a9', 'stopped')); return accept(url); } });
  const { w, d, calls, sockets } = h;
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  await enter(w, 'one'); await enter(w, 'two');
  d.querySelector('#route-chat [data-cp-stop]').click(); await settle(80);
  assert.deepEqual(sent(calls), [], 'a stop sends nothing');
  assert.match(note(d).textContent, /^Queue paused: the reply was stopped/);
  const now = d.querySelector('#route-chat [data-q-send]');
  assert.equal(now.textContent, 'Send now');
  now.click(); await settle(80);
  assert.deepEqual(sent(calls), ['one'], 'Send now posts it once');
  assert.deepEqual(rowsOf(d), ['Queued two']);
  assert.equal(note(d).textContent, 'Sends when the reply finishes', 'the rest waits for the reply');
  assert.equal(d.querySelector('#route-chat [data-q-edit]'), null, 'removable only');
  d.querySelector('#route-chat [data-q-drop]').click(); await settle(40);
  assert.deepEqual(rowsOf(d), []);
  assert.equal(note(d), null);
  assert.deepEqual(sent(calls), ['one']);
});

test('F-a2-01 review: the queued toast says only "Queued: 1 of 3" (the line says when it goes); Remove on the one being sent says it was already sent', async () => {
  let release; const gate = new Promise((ok) => { release = ok; });
  const { w, d, sockets } = await liveHost({ write: async (url) => { if (url.endsWith('/messages')) { await gate; return [202, { userMessageId: 'u5' }]; } return [200, {}]; } });
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  await enter(w, 'one');
  assert.match(saidText(d), /(^| \| )Queued: 1 of 3($| \| )/);
  await enter(w, 'two');
  ask(sockets, DONE()); await settle(60);
  d.querySelector('#route-chat [data-q-drop]').click(); await settle(40);
  assert.match(saidText(d), /Already sent: it can no longer be removed/);
  assert.deepEqual(rowsOf(d), ['Queued one', 'Queued two'], 'nothing is taken out');
  release(); await settle(60);
  assert.deepEqual(rowsOf(d), ['Queued two']);
});

test('F-a2-01 review: a reply that ends after you left Chat for another page sends nothing; back in the chat it waits paused with Send now', async () => {
  const { w, d, calls, sockets } = await liveHost({ write: accept });
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  await enter(w, 'later');
  await go(w, '#today');
  ask(sockets, DONE()); await settle(80);
  assert.deepEqual(sent(calls), [], 'not sent while Chat is not on screen');
  await go(w, '#chat/ask_1');
  assert.match(note(d).textContent, /^Queue paused: the reply ended while this chat was closed/);
  assert.ok(d.querySelector('#route-chat [data-q-send]'));
});

// ---- F-gb235-02: the rows and their line sit on the composer's rail ----
test('F-gb235-02: the queue rows and their line sit on the composer\'s rail (same width, max-width, margin-inline and translate as .convo-dock .composer; nothing else widens them)', () => {
  const rules = cssRules(readFileSync(new URL('../ui/public/stillhet/css/rail.css', import.meta.url), 'utf8'));
  const list = (r) => r.sel.split(',').map((s) => s.trim());
  const decls = (r) => Object.fromEntries(r.body.split(';').map((x) => x.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
  const RAIL = ['.convo-dock .composer', '.convo-dock > .composer-queue', '.convo-dock > .composer-queue + .composer-note'];
  const rail = rules.filter((r) => !r.media && list(r).includes(RAIL[0]));
  assert.equal(rail.length, 1, 'one rule holds the composer on the rail');
  for (const s of RAIL) assert.ok(list(rail[0]).includes(s), `${s} shares the composer's rule`);
  const d = decls(rail[0]);
  assert.equal(d.width, 'calc(100% - 32px)');
  assert.equal(d['max-width'], '648px');
  assert.equal(d['margin-inline'], 'auto');
  assert.equal(d.translate, '16px 0');
  assert.equal(d.margin, undefined, 'no margin shorthand: the queue keeps its margin-bottom');
  const BOX = ['width', 'max-width', 'margin-left', 'margin-right', 'margin-inline', 'margin', 'translate'];
  const widens = rules.filter((r) => r !== rail[0] && list(r).some((s) => /\.composer-queue\b/.test(s)) && BOX.some((k) => k in decls(r)));
  assert.deepEqual(widens.map((r) => `${r.line}: ${r.sel}`), [], 'no other rule sets the queue\'s or its line\'s box');
  const moved = rules.filter((r) => r.media && list(r).some((s) => /\.convo-dock\s+(>\s*)?\.composer\b/.test(s)) && BOX.some((k) => k in decls(r)));
  assert.deepEqual(moved.map((r) => `${r.line}: ${r.sel}`), [], 'no media rule moves the composer without its queue');
});

// ---- F-gb235-03: a Queue button beside Stop while a reply streams ----
const box = (d) => d.querySelector('#route-chat [data-composer-t]');
const queue = async (d, text) => { const t = box(d); t.value = text; t.dispatchEvent(new d.defaultView.Event('input', { bubbles: true })); d.querySelector('#route-chat [data-cp-queue]').click(); await settle(60); };

test('F-gb235-03: while a reply streams Queue stands left of Stop, named Queue; idle shows Send and no Queue', async () => {
  const { w, d, sockets } = await liveHost({ write: accept });
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelector('#route-chat [data-cp-queue]'), null, 'idle: no Queue');
  ask(sockets, START()); await settle(40);
  const q = d.querySelector('#route-chat [data-cp-queue]');
  assert.ok(q, 'the reply runs: Queue');
  assert.equal(q.textContent, 'Queue');
  assert.equal(q.getAttribute('aria-label'), null, 'its name is its visible word');
  assert.ok(q.classList.contains('btn-quiet'));
  assert.ok(q.nextElementSibling.matches('[data-cp-stop]'), 'Stop right after it');
  ask(sockets, DONE()); await settle(80);
  assert.equal(d.querySelector('#route-chat [data-cp-queue]'), null, 'the reply ended: no Queue');
  assert.ok(d.querySelector('#route-chat [data-cp-send]'));
});

test('F-gb235-03: Queue with text queues one item, posts nothing, says "Queued: 1 of 3", focus stays in the box; the reply\'s end sends it once', async () => {
  const { w, d, calls, sockets } = await liveHost({ write: accept });
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  d.querySelector('#route-chat [data-cp-queue]').focus();
  await queue(d, 'the totals too');
  assert.deepEqual(sent(calls), [], 'no POST while the reply runs');
  assert.deepEqual(rowsOf(d), ['Queued the totals too']);
  assert.equal(box(d).value, '');
  assert.match(saidText(d), /(^| \| )Queued: 1 of 3($| \| )/);
  assert.ok(d.activeElement?.matches('[data-composer-t]'), 'you keep typing in the box');
  ask(sockets, DONE()); await settle(80);
  assert.deepEqual(sent(calls), ['the totals too'], 'sent once at the reply\'s end');
});

test('F-gb235-03: a full queue and an empty box: Queue says what Enter says and keeps the text', async () => {
  const { w, d, calls, sockets } = await liveHost({ write: accept });
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  await queue(d, 'one'); await queue(d, 'two'); await queue(d, 'three');
  await queue(d, 'four');
  assert.match(saidText(d), /Queue full: 3 messages wait for this reply/);
  assert.equal(box(d).value, 'four', 'a full queue keeps the text');
  assert.deepEqual(rowsOf(d), ['Queued one', 'Queued two', 'Queued three']);
  assert.deepEqual(sent(calls), []);
  await queue(d, '');
  assert.match(saidText(d), /Write something first/);
  assert.equal(rowsOf(d).length, 3);
});

test('F-gb235-03: Stop keeps its place and look beside Queue', async () => {
  let h;
  h = await liveHost({ write: (url) => { if (url.endsWith('/stop')) ask(h.sockets, DONE('a9', 'stopped')); return accept(url); } });
  const { w, d, calls, sockets } = h;
  await go(w, '#chat/ask_1');
  ask(sockets, START()); await settle(40);
  const stop = d.querySelector('#route-chat .composer-send').lastElementChild;
  assert.ok(stop.matches('[data-cp-stop]'), 'Stop is the last button');
  assert.equal(stop.getAttribute('aria-label'), 'Stop');
  assert.equal(stop.getAttribute('title'), 'Stops the reply');
  assert.equal(stop.className, 'btn btn-sm btn-primary btn-icon');
  assert.equal(stop.textContent, '', 'icon only');
  stop.click(); await settle(80);
  assert.equal(posts(calls).filter(([m, u]) => m === 'POST' && u.endsWith('/stop')).length, 1, 'Stop still stops');
});
