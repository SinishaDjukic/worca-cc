// test/stillhet-chat-app-host-1.test.mjs — Chat in the app host, live kind, part 1 of 4 (jsdom, the app's scripts in
// boot.js's order, data-adapter="live"); the host and its helpers are test/helpers/stillhet-chat-live-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DISABLED_OK, RUN_STATE, SOURCES, THREAD, clone, go, liveHost, menuPick, posts, settle, stoppedRun, store, toastText, walk, withRun, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('chatOfTask: the starting chat for a started run, none for a run a chat only follows (R-qa-9)', async () => {
  const { w } = await liveHost();
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-a' }), 'ask_1');
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-b' }), '', 'ask_2 only follows run-b');
  assert.equal(typeof w.RailChatLive.act, 'function');
});

test('a conversation: loading until the thread answers, then its turns; a 404 is gone; a 500 failed with Try again', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let answer = [200, THREAD];
  const { w, d } = await liveHost({ thread: async () => { await gate; return answer; } });
  await go(w, '#chat/ask_1', 10);
  assert.match(d.getElementById('route-chat').textContent, /Loading this chat…/);
  release(); await settle(60);
  const text = d.getElementById('route-chat').textContent;
  assert.match(text, /Add a CSV export/);
  assert.match(text, /Worca could not answer this time\./);
  answer = [404, { error: 'thread not found' }];
  await go(w, '#chat/ask_2');
  assert.match(d.getElementById('route-chat').textContent, /This chat no longer exists/);
  assert.equal(d.querySelector('#route-chat [data-thread-retry]'), null, 'gone: no Try again');
});

test('a failed load says so with Try again, and Try again shows the turns', async () => {
  let answer = [500, { error: 'boom' }];
  const { w, d } = await liveHost({ thread: () => answer });
  await go(w, '#chat/ask_1');
  assert.match(d.getElementById('route-chat').textContent, /Could not load this chat/);
  answer = [200, THREAD];
  d.querySelector('#route-chat [data-thread-retry]').click();
  await settle(60);
  assert.match(d.getElementById('route-chat').textContent, /Add a CSV export/);
});

test('send: dev\'s message route; refused, one toast with its words, the text kept, nothing written', async () => {
  const { w, d, calls } = await liveHost({ write: (url) => (url.endsWith('/messages') ? [409, { error: 'turn in flight' }] : [200, {}]) });
  await go(w, '#chat/ask_1');
  const before = store(w);
  const t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'And the dates?';
  d.querySelector('#route-chat [data-cp-send]').click();
  await settle(60);
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => [c.url, c.body?.text]), [['/api/ask/threads/ask_1/messages', 'And the dates?']]);
  assert.equal(toastText(d), 'Could not send your message: turn in flight');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, 'And the dates?', 'the text is kept');
  assert.deepEqual(store(w), before);
});

test('a row action refused (pin): one toast naming it, the list and store unchanged', async () => {
  const { w, d, calls } = await liveHost({ write: () => [409, { error: 'chat is busy' }] });
  const before = store(w);
  d.querySelector('#bar-chat [data-menu="row:chat:ask_1"]').click();
  d.querySelector('#bar-chat [data-menu-pick="row:chat:ask_1|pin"]').click();
  await settle(60);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]), [['PATCH', '/api/ask/threads/ask_1', { pinned: false }]], 'ask_1 is pinned: the action unpins it');
  assert.equal(toastText(d), 'Could not pin the chat: chat is busy');
  assert.deepEqual(store(w), before);
  assert.ok(!toastText(d).includes(w.RailAdapter.NOT_CONNECTED));
});

test('the walk over the Chat control set (conversation, Chat home, the bar\'s chat column and their open menus) never says "Not connected" or "Would", and no control is disabled outside DISABLED_OK (R-qa-11)', async () => {
  const { w, d } = await liveHost({ write: () => [200, {}] });
  for (const [hash, root] of [['#chat/ask_1', '#route-chat'], ['#chat', '#route-chat'], ['#chat', '#bar-chat']]) {
    await go(w, hash);
    const { n, seen, disabled } = await walk(w, d, root);
    assert.ok(n > 3, `${hash} ${root}: ${n} controls`);
    assert.ok(!seen.some((t) => t.includes(w.RailAdapter.NOT_CONNECTED)), `${hash} ${root}: no Not connected`);
    assert.ok(!seen.some((t) => /^Would/.test(t)), `${hash} ${root}: no Would`);
    const stray = disabled.filter((html) => !Object.keys(DISABLED_OK).some((sel) => { const box = d.createElement('div'); box.innerHTML = html.replace(/>.*$/s, '>') + '</button>'; return box.firstElementChild?.matches(sel); }));
    assert.deepEqual(stray, [], `${hash} ${root}: disabled outside DISABLED_OK`);
    assert.equal(d.querySelector(`${root} [data-say]`), null, `${root}: no demo sentence hook in the live kind`);
  }
});

test('a bulk archive with 2 of 5 chats refused: one toast with the count and the first reason; the rest are archived', async () => {
  const src = clone(SOURCES);
  src.threads.threads = ['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ id: `ask_${k}`, title: `Chat ${k}`, waiting: false, inFlight: false, pinnedAt: null, archivedAt: null, updatedAt: SOURCES.threads.threads[1].updatedAt, startedRuns: 0, runLinks: 0, rank: i }));
  const busy = new Set(['/api/ask/threads/ask_b', '/api/ask/threads/ask_d']);
  const { w, d, calls } = await liveHost({ sources: src, write: (url) => (busy.has(url) ? [409, { error: 'chat is busy' }] : [200, {}]) });
  for (const k of ['a', 'b', 'c', 'd', 'e']) d.querySelector(`#bar-chat [data-open="chat:ask_${k}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true, ctrlKey: true, metaKey: true }));
  const bar = d.querySelector('#bar-chat [data-bulk="archive"]');
  assert.ok(bar, 'the bulk bar is up');
  bar.click();
  await settle(80);
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').map((c) => c.url).sort(), ['a', 'b', 'c', 'd', 'e'].map((k) => `/api/ask/threads/ask_${k}`));
  assert.ok(calls.filter((c) => c.method === 'PATCH').every((c) => c.body.archived === true));
  assert.equal(toastText(d), 'Could not archive 2 of 5 chats: chat is busy');
});

test('a task opened from the bar lands on its chat with its card focused, also when the thread is still loading', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d } = await liveHost({ thread: async () => { await gate; return [200, THREAD]; } });
  w.RailConversation.openTask('ask_1', 'run-a');
  await settle(20);
  assert.equal(w.location.hash, '#chat/ask_1');
  release(); await settle(80);
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.ok(card, 'the TaskCard is drawn');
  assert.ok(card.contains(d.activeElement), 'its head has the focus');
});

test('Chat home: a send makes the chat, posts the text and opens it with its YouTurn; a refused message deletes the empty chat', async () => {
  let msg = 202;
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    if (url.endsWith('/messages')) return msg < 300 ? [202, { userMessageId: 'u1', assistantMessageId: 'a1' }] : [409, { error: 'turn in flight' }];
    return [200, {}];
  } });
  msg = 409;
  let t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click();
  await settle(60);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`), ['POST /api/ask/threads', 'POST /api/ask/threads/ask_new/messages', 'DELETE /api/ask/threads/ask_new']);
  assert.equal(toastText(d), 'Could not send your message: turn in flight');
  assert.equal(w.location.hash, '#chat', 'the address stays');
  msg = 202; calls.length = 0;
  t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click();
  await settle(80);
  assert.equal(w.location.hash, '#chat/ask_new');
  const text = d.getElementById('route-chat').textContent;
  assert.match(text, /Hello/);
  assert.doesNotMatch(text, /Loading this chat/);
});


test('a live TaskCard draws only its run\'s facts (no demo PR, branch, base or cap) and its step from the run\'s own stages (R-ux-12)', async () => {
  const { w, d, sockets } = await liveHost({ sources: withRun({ pendingQuestion: null }) });
  await go(w, '#chat/ask_1');
  let card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.ok(card, 'the TaskCard is drawn');
  for (const fake of ['#1180', 'feat/billing-csv-export', 'into dev', '$40', '17:00']) assert.ok(!card.textContent.includes(fake), `no demo fact ${fake}`);
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state', runId: 'run-a', ...RUN_STATE() }) });
  await settle(60);
  card = d.querySelector('#route-chat [data-anchor="card_run"]');
  const steps = [...card.querySelectorAll('.sl-step')];
  assert.equal(steps.length, 4, 'Plan, Build, Review, Ready');
  assert.equal(steps.findIndex((e) => e.classList.contains('is-now')), 1, 'on Build: step 2 of 4');
  assert.doesNotMatch(card.textContent, /agents?\b/i, 'never an agents ratio');
});

test('a live card\'s ⋯ offers only what dev can do; Archive asks, then posts dev\'s archive', async () => {
  const { w, d, calls } = await liveHost({ sources: stoppedRun() });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="card:pa"]').click(); await settle(5);
  const items = [...d.querySelectorAll('#route-chat [data-menu-pick^="card:pa|"]')].map((e) => e.dataset.menuPick.split('|')[1]);
  for (const no of ['Report this task', 'Save as preset', 'Run after…', 'Move to group…']) assert.ok(!items.includes(no), `${no} is not offered live`);
  assert.ok(items.includes('Archive') && items.includes('Label…') && items.includes('Start a follow-up'), items.join(', '));
  d.querySelector('#route-chat [data-menu-pick="card:pa|Archive"]').click(); await settle(10);
  d.querySelector('#route-chat [data-card-yes="pa"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'pa' }] }]]);
});

test('Ask for changes under a live card: dev\'s changes route; refused, one toast and the words stay', async () => {
  let status = 409;
  const { w, d, calls } = await liveHost({ sources: stoppedRun(), write: (url) => (url.endsWith('/changes') ? [status, status < 300 ? {} : { error: 'run is busy' }] : [200, {}]) });
  await go(w, '#chat/ask_1');
  await menuPick(d, 'card:pa', 'Start a follow-up');
  const field = d.querySelector('#route-chat [data-ask-changes="card_run"]');
  assert.ok(field, 'the field opens under the card');
  field.value = 'Use ISO dates'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('#route-chat [data-changes-send="card_run"]').click(); await settle(60);
  assert.deepEqual(posts(calls), [['POST', '/api/ask/threads/ask_1/changes', { pipelineId: 'pa', text: 'Use ISO dates' }]]);
  assert.equal(toastText(d), 'Could not send your changes: run is busy');
  assert.equal(d.querySelector('#route-chat [data-ask-changes="card_run"]').value, 'Use ISO dates', 'the words are kept');
  status = 200;
  d.querySelector('#route-chat [data-changes-send="card_run"]').click(); await settle(60);
  assert.equal(d.querySelector('#route-chat [data-ask-changes="card_run"]'), null, 'sent: the field closes');
});
