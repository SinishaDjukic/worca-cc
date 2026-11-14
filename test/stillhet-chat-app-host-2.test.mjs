// test/stillhet-chat-app-host-2.test.mjs — Chat in the app host, live kind, part 2 of 4 (jsdom, the app's scripts in
// boot.js's order, data-adapter="live"); the host and its helpers are test/helpers/stillhet-chat-live-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LISTS, SOURCES, THREAD, blurOnDisable, clone, go, liveHost, menuPick, posts, settle, toastText, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('a pending control is drawn disabled until dev answers, then enabled with its focus back (focus-after-disable)', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d, calls } = await liveHost({ beforeScripts: blurOnDisable, write: async (url) => { if (url === '/api/run') await gate; return [200, {}]; } });
  await go(w, '#chat/ask_1');
  const start = d.querySelector('#route-chat [data-pp-start="card_prop"]');
  start.focus(); start.click(); await settle(30);
  assert.equal(d.querySelector('#route-chat [data-pp-start="card_prop"]').disabled, true, 'disabled while out, also after a repaint');
  release(); await settle(40);
  const again = d.querySelector('#route-chat [data-pp-start="card_prop"]');
  assert.equal(again.disabled, false);
  assert.equal(d.activeElement, again, 'the focus comes back');
  assert.equal(calls.filter((c) => c.url === '/api/run').length, 1);
});

test('Start sends the person\'s picks: a stricter guardrail set reaches POST /api/run; permissive is never offered', async () => {
  const { w, d, calls } = await liveHost();
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-pp-more="card_prop"]').click(); await settle(30);
  d.querySelector('#route-chat [data-menu="pp-card_prop-guard"]').click(); await settle(5);
  assert.equal(d.querySelector('#route-chat [data-menu-pick="pp-card_prop-guard|permissive"]'), null);
  d.querySelector('#route-chat [data-menu-pick="pp-card_prop-guard|strict"]').click(); await settle(10);
  d.querySelector('#route-chat [data-pp-start="card_prop"]').click(); await settle(40);
  const run = calls.find((c) => c.url === '/api/run');
  assert.equal(run.body.guardrailsId, 'strict');
  assert.deepEqual([run.body.askThreadId, run.body.askCardId], ['ask_1', 'card_prop']);
});

test('the composer\'s model picker is dev\'s catalog; a pick in a chat is dev\'s PATCH, refused it changes nothing; a Chat home send carries the model and effort', async () => {
  let ok = false;
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (method === 'PATCH') return ok ? [200, {}] : [409, { error: 'turn in flight' }];
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    return [202, { userMessageId: 'u1' }];
  } });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="cp-engine"]').click(); await settle(5);
  const openers = [...d.querySelectorAll('#route-chat .spick [data-menu-sub]')].map((e) => e.textContent.trim());
  assert.deepEqual(openers, ['Anthropic', 'OpenAI'], 'the makers first (comp.menu-sub)');
  const labels = () => [...d.querySelectorAll('#route-chat [data-menu-pick^="cp-engine|"]')].map((e) => e.textContent.trim());
  d.querySelector('#route-chat [data-menu-sub="anthropic"]').click(); await settle(5);
  assert.ok(labels().includes('Opus 5.5'), labels().join(', '));
  d.querySelector('#route-chat .menu-back').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-sub="openai"]').click(); await settle(5);
  assert.ok(labels().includes('Codex 5'), labels().join(', '));
  d.querySelector('#route-chat .menu-back').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-sub="anthropic"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-engine|sonnet"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { model: 'sonnet', effort: 'high' }]]);
  assert.equal(toastText(d), 'Could not switch the model: turn in flight');
  assert.ok(!d.querySelector('#route-chat [data-menu="cp-engine"]').textContent.includes('Sonnet'), 'refused: the picker still says the chat\'s own model');
  calls.length = 0;
  await go(w, '#chat');
  const t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(80);
  const msg = calls.find((c) => c.url.endsWith('/messages'));
  assert.deepEqual([msg.body.model, msg.body.effort], ['opus', 'high']);
});

test('an engine switch dev refuses until the dropped turns are confirmed: the confirm names the count, Switch posts dropTurns; Cancel posts nothing', async () => {
  let n = 0;
  const { w, d, calls } = await liveHost({ write: (url, body) => (url.endsWith('/engine') ? (++n === 1 ? [409, { error: 'Codex will not see the 3 oldest turns of this chat: confirm that first', code: 'confirm-dropped-turns', droppedTurns: 3 }] : [200, { ok: true }]) : [200, {}]) });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="cp-engine"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-sub="openai"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-engine|gpt"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['POST', '/api/ask/threads/ask_1/engine', { engine: 'codex', model: 'gpt', effort: 'high' }]], 'a chat that replied switches its engine; never a fallback PATCH');
  assert.match(d.getElementById('route-chat').textContent, /Switch to Codex 5\? It will not see the 3 oldest turns of this chat\./);
  assert.ok(!/Could not/.test(toastText(d)), 'the confirm is the answer, not a toast');
  d.querySelector('#route-chat [data-eng-yes]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/ask/threads/ask_1/engine', { engine: 'codex', model: 'gpt', effort: 'high', dropTurns: 3 }]);
  assert.equal(d.querySelector('#route-chat [data-eng-yes]'), null, 'switched: the confirm is gone');
});

test('a chat with no reply yet has no engine: a model on another engine is dev\'s PATCH {model}, not an engine switch', async () => {
  const one = { ...THREAD, messages: THREAD.messages.filter((m) => m.role === 'user') };
  const { w, d, calls } = await liveHost({ thread: () => [200, one] });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="cp-engine"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-sub="openai"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-engine|gpt"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { model: 'gpt', effort: 'high' }]]);
});

test('the live composer\'s + menu has no demo ticket, reuse or presets; the starters draw no pin until dev\'s pins answer', async () => {
  const { '/api/chat-home/pins': _pins, ...noPins } = LISTS;   // dev's pins GET fails (404): the row draws none, never the demo's Shaper
  const { w, d } = await liveHost({ lists: noPins });
  await go(w, '#chat');
  assert.deepEqual([...d.querySelectorAll('#route-chat [data-pin]')].map((e) => e.dataset.pin), [], 'no demo Shaper without dev\'s pins');
  d.querySelector('#route-chat [data-menu="cp-plus"]').click(); await settle(5);
  const items = [...d.querySelectorAll('#route-chat [data-menu-pick^="cp-"]')].map((e) => e.dataset.menuPick);
  assert.ok(items.includes('cp-plus|Files'));
  assert.ok(!items.some((i) => /Ticket|Reuse|cp-preset/.test(i)), items.join(', '));
});

test('a send answered after you moved to another chat lands on the chat it was sent from: this composer keeps its own text', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d } = await liveHost({ write: async (url) => { if (url.endsWith('/messages')) { await gate; return [202, { userMessageId: 'u9' }]; } return [200, {}]; } });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-composer-t]').value = 'For ask_1';
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(10);
  await go(w, '#chat/ask_2');
  const t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Draft in ask_2';
  assert.ok(!d.querySelector('#route-chat [data-cp-send]')?.disabled, 'ask_2 is not sending');
  release(); await settle(60);
  assert.equal(w.location.hash, '#chat/ask_2', 'the page stays where you are');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, 'Draft in ask_2');
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, '', 'ask_1\'s sent text is cleared in its own composer');
});

test('Chat home pins are dev\'s: read from GET, a pin is dev\'s PUT, and a refused pin changes nothing (D19)', async () => {
  let ok = false;
  const { w, d, calls } = await liveHost({ write: (url) => (url === '/api/chat-home/pins' ? (ok ? [200, { pins: ['wf_shape', 'wf_lean'] }] : [409, { error: 'bad pins' }]) : [200, {}]) });
  await go(w, '#chat');
  const pinned = () => [...d.querySelectorAll('#route-chat [data-pin]')].map((e) => e.dataset.pin);
  assert.deepEqual(pinned(), ['Shaper']);
  const pick = async () => { d.querySelector('#route-chat [data-menu="starter-more"]').click(); await settle(5); d.querySelector('#route-chat [data-menu-pick="starter-more|starter-pin|Lean"]').click(); await settle(40); };
  await pick();
  assert.deepEqual(posts(calls), [['PUT', '/api/chat-home/pins', { pins: ['wf_shape', 'wf_lean'] }]]);
  assert.equal(toastText(d), 'Could not pin the starter: bad pins');
  assert.deepEqual(pinned(), ['Shaper'], 'refused: unchanged');
  ok = true; await pick();
  assert.deepEqual(pinned(), ['Shaper', 'Lean']);
});

test('a task row under a chat in the bar: Archive is dev\'s run archive, never "Not connected"', async () => {
  const { d, calls } = await liveHost();
  const row = d.querySelector('#bar-chat [data-menu^="row:task:"]');
  assert.ok(row, 'the task row has its menu');
  row.click(); await settle(5);
  d.querySelector(`#bar-chat [data-menu-pick="${row.dataset.menu}|archive"]`).click(); await settle(40);
  assert.deepEqual(posts(calls), [['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'run-a' }] }]]);
  assert.ok(!toastText(d).includes('Not connected'));
});

test('a task row with an open PR: Watch toggles from dev\'s own watch state, so a watched PR is unwatched (GET, then POST watch:false)', async () => {
  const src = clone(SOURCES);
  src.history.pipelines.find((p) => p.id === 'h2').pr = { url: 'https://github.com/acme/api/pull/9', state: 'OPEN' };
  src.runLinks.links.push({ threadId: 'ask_1', runId: 'h2', pipelineId: 'h2', started: true });
  const { d, calls } = await liveHost({ sources: src, lists: { ...LISTS, '/api/pr/watch?id=h2': { watching: true } }, write: () => [200, { watching: false }] });
  const row = d.querySelector('#bar-chat [data-menu="row:task:ask_1:h2"]') || [...d.querySelectorAll('#bar-chat [data-menu^="row:task:"]')].find((e) => e.dataset.menu.endsWith('h2'));
  assert.ok(row, 'the PR task row has its menu');
  row.click(); await settle(5);
  d.querySelector(`#bar-chat [data-menu-pick="${row.dataset.menu}|watch"]`).click(); await settle(40);
  assert.deepEqual(calls.filter((c) => c.url.startsWith('/api/pr/watch')).map((c) => [c.method, c.url, c.body]), [['GET', '/api/pr/watch?id=h2', undefined], ['POST', '/api/pr/watch', { watch: false, id: 'h2' }]]);
  assert.ok(!/Could not/.test(toastText(d)), toastText(d));
});

test('a page\'s dock hands over with the page as dev\'s context (D16)', async () => {
  const { w, d, calls } = await liveHost({ write: (url, body, method) => (url === '/api/ask/threads' && method === 'POST' ? [201, { thread: { id: 'ask_new' } }] : [202, { userMessageId: 'u1' }]) });
  const host = d.createElement('div'); d.body.appendChild(host);
  w.RailConversation.dock(host, { kind: 'project', title: 'web', chat: '', ref: { pageProjectKey: 'web-1' } });
  host.querySelector('[data-composer-t]').value = 'What is behind?';
  host.querySelector('[data-dock-send]').click(); await settle(60);
  const msg = calls.find((c) => c.url.endsWith('/messages'));
  assert.deepEqual(msg.body.context, { view: 'project', pageProjectKey: 'web-1' });
});

test('a real page hands over with its own id: a diverged project\'s page sends its project key as dev\'s context (R-req-2-8)', async () => {
  const { w, d, calls } = await liveHost({ write: (url, body, method) => (url === '/api/ask/threads' && method === 'POST' ? [201, { thread: { id: 'ask_new' } }] : [202, { userMessageId: 'u1' }]) });
  await go(w, '#projects/api-2');
  const btn = d.querySelector('[data-pj-act="api-2"]');
  assert.ok(btn, 'the diverged project offers its hand-over');
  btn.click(); await settle(80);
  const t = d.querySelector('#route-chat [data-composer-t]');
  assert.match(t.value, /diverged/);
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(80);
  const msg = calls.find((c) => c.url.endsWith('/messages'));
  assert.deepEqual(msg.body.context, { view: 'project', pageProjectKey: 'api-2' });
});
