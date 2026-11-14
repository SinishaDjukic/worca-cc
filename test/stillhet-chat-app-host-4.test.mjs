// test/stillhet-chat-app-host-4.test.mjs — Chat in the app host, live kind, part 4 of 4 (jsdom, the app's scripts in
// boot.js's order, data-adapter="live"); the host and its helpers are test/helpers/stillhet-chat-live-host.mjs.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, THREAD, cardItems, clone, go, liveHost, posts, saidText, savedRun, settle, store, toastText, withRun, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('Follow a task: a new chat asks Worca to follow the run by its id (dev\'s track_run); the toast and the chat wait for dev\'s ok', async () => {
  let msg = 409;
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_fol' } }];
    if (url.endsWith('/messages')) return msg < 300 ? [202, { userMessageId: 'u1' }] : [409, { error: 'turn in flight' }];
    return [200, {}];
  } });
  const follow = async () => { d.querySelector('#route-chat [data-starter="track"]').click(); await settle(5); const item = d.querySelector('#route-chat [data-menu-pick^="starter-track|"]'); assert.ok(item, 'a running task to follow'); item.click(); await settle(80); return item; };
  await follow();
  assert.deepEqual(posts(calls).map(([m, u]) => `${m} ${u}`), ['POST /api/ask/threads', 'POST /api/ask/threads/ask_fol/messages', 'DELETE /api/ask/threads/ask_fol']);
  assert.equal(toastText(d), 'Could not send your message: turn in flight', 'refused: the send\'s one toast, no "Following"');
  assert.equal(w.location.hash, '#chat');
  assert.ok(!w.RailChats.data().chats.some((c) => /^Follow /.test(c.title)), 'no local-only chat');
  msg = 202; calls.length = 0;
  await follow();
  const sent = posts(calls).find(([, u]) => u.endsWith('/messages'));
  assert.equal(sent[2].text, 'Follow run run-a and tell me when it needs me.', 'the run id alone, never its title');
  assert.match(saidText(d), /Asked Worca to follow /);
  assert.equal(w.location.hash, '#chat/ask_fol');
});

test('Archive from a chat row: dev\'s PATCH, its toast has Undo, and Undo is dev\'s PATCH {archived:false}', async () => {
  const { w, d, calls } = await liveHost({ write: () => [200, {}] });
  d.querySelector('#bar-chat [data-menu="row:chat:ask_1"]').click();   // ask_2 is replying: dev refuses a busy chat
  d.querySelector('#bar-chat [data-menu-pick="row:chat:ask_1|archive"]').click();
  await settle(60);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { archived: true }]]);
  assert.match(saidText(d), /Archived 1 chat/);
  const undo = d.querySelector('body > .rc-toast [data-undo]');
  assert.ok(undo, 'the toast offers Undo');
  calls.length = 0;
  undo.click(); await settle(60);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { archived: false }]]);
});

test('a chat\'s project is dev\'s thread context: the composer and head name it once dev has it', async () => {
  const src = clone(SOURCES);
  src.threads.threads = src.threads.threads.map((t) => (t.id === 'ask_1' ? { ...t, context: { pinned: true, projectKey: 'web-1' } } : t));
  const th = clone(THREAD); th.thread.context = { pinned: true, projectKey: 'web-1' };
  const { w, d } = await liveHost({ sources: src, thread: () => [200, th] });
  const name = src.projects.projects.find((p) => p.key === 'web-1').name;
  assert.equal(w.RailChats.data().chats.find((c) => c.id === 'ask_1').project, name);
  await go(w, '#chat/ask_1');
  assert.match(d.querySelector('#route-chat .convo-head').textContent, new RegExp(name));
  assert.match(d.querySelector('#route-chat [data-cp-project], #route-chat [data-menu="cp-project"]')?.textContent || d.querySelector('#route-chat .convo-dock').textContent, new RegExp(name));
});


test('a chat opened by its address draws its project and its cards once the store loads, with no hash change', async () => {
  // the thread is drawn first; the chat's project (threads) and its run link (run-links) reach the store after it
  const src = clone(SOURCES), links = src.runLinks.links;
  src.projects = { projects: [{ key: 'web', name: 'web', path: '/src/web' }] }; src.runLinks = { links: [] };
  const { w, d, sockets } = await liveHost({ hash: '#chat/ask_1', sources: src });
  await settle(60);
  assert.equal(d.querySelector('#route-chat [data-anchor="card_run"]'), null, 'the run links are not in yet');
  assert.match(d.querySelector('#route-chat .convo-head').textContent, /No project/);
  src.runLinks = { links }; src.threads.threads = src.threads.threads.map((t) => (t.id === 'ask_1' ? { ...t, context: { projectKey: 'web' } } : t));
  for (const type of ['ask-run-status', 'ask-labels-changed']) sockets.at(-1).onmessage({ data: JSON.stringify({ type }) });
  await settle(400);
  assert.equal(w.location.hash, '#chat/ask_1');
  assert.ok(d.querySelector('#route-chat [data-anchor="card_run"]'), 'the TaskCard is drawn');
  assert.match(d.querySelector('#route-chat .convo-head').textContent, /^web/);
});

test('a live TaskCard says its state once: the line under the head never repeats the word', async () => {
  const { w, d } = await liveHost({ sources: withRun({ pendingQuestion: null }) });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.equal(card.textContent.match(/Working/g)?.length, 1, card.textContent);
});

test('a paused task offers Stop and Resume, never the fixes of a failure; Resume posts dev\'s pipeline id', async () => {
  const { w, d, calls } = await liveHost({ sources: withRun({ status: 'paused', pendingQuestion: null }) });
  await go(w, '#chat/ask_1');
  const items = await cardItems(d, 'run-a');
  assert.ok(items.includes('Stop'), items.join(', '));
  for (const no of ['Ask Worca to fix it', 'Tell Worca how to fix it']) assert.ok(!items.includes(no), `${no} is for a failure`);
  d.querySelector('#route-chat [data-card-act="run-a|Resume now"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/resume', { pipelineId: 'pa' }]);
});

test('a task waiting on its question can be stopped from its card', async () => {
  const { w, d, calls } = await liveHost();
  await go(w, '#chat/ask_1');
  assert.ok((await cardItems(d, 'run-a')).includes('Stop'));
  d.querySelector('#route-chat [data-menu-pick="card:run-a|Stop"]').click(); await settle(10);
  d.querySelector('#route-chat [data-card-yes="run-a"]')?.click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/stop', { runId: 'run-a' }]);
});

test('a failed run reads Failed on its card, never Stopped', async () => {
  const { w, d } = await liveHost({ sources: savedRun({ status: 'error' }) });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.match(card.textContent, /Failed/);
  assert.doesNotMatch(card.textContent, /Stopped/);
});

test('a finished task with its branch is Ready: Create PR and View changes, and its stage bar stops at PR', async () => {
  const { w, d, calls } = await liveHost({ sources: savedRun({ status: 'done', branch: 'feat/x', survived: true, projectKey: 'web-1a2b3c4d', projectDir: '/src/web' }) });
  const opened = [], was = globalThis.open;
  globalThis.open = (u) => { opened.push(u); return {}; };   // chat-live.mjs openTab: the page's window.open (set once the host is up)
  after(() => { globalThis.open = was; });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.ok(card.querySelector('[data-card-act="pa|Create PR"]'), 'Create PR is its one action');
  assert.ok(!card.querySelectorAll('.sl-knot')[4].classList.contains('is-done'), 'Merged is not lit');
  assert.ok((await cardItems(d, 'pa')).includes('View changes'));
  d.querySelector('#route-chat [data-menu-pick="card:pa|View changes"]').click(); await settle(20);
  // a branch run's changes are dev's recovery-patch (changes/patch is folder-only and answers 409 NOT_FOLDER_RUN)
  assert.deepEqual(opened, ['/api/runs/pa/recovery-patch?projectKey=web-1a2b3c4d']);
  // Create PR carries the run's store key: POST /api/pr refuses a body with neither it nor the project folder
  d.querySelector('#route-chat [data-card-act="pa|Create PR"]').click(); await settle(5);
  d.querySelector('#route-chat [data-card-form="pa"] [data-confirm]')?.click(); await settle(20);
  const pr = calls.find((c) => c.url === '/api/pr');
  assert.ok(pr, 'Create PR reaches POST /api/pr');
  assert.equal(pr.body.id, 'pa');
  assert.equal(pr.body.projectKey, 'web-1a2b3c4d');
});

test('an applied change dev cannot undo has no Revert; a revertible receipt keeps it', async () => {
  const blocks = [{ kind: 'card', id: 'cm', state: 'applied', card: { type: 'model', summary: 'Use Sonnet' } }, { kind: 'card', id: 'cr', state: 'applied', card: { type: 'receipt', label: 'Theme', before: 'light', after: 'dark', revertible: true } }];
  const th = { ...THREAD, messages: [...THREAD.messages.slice(0, 1), { id: 'mx', role: 'assistant', text: '', status: 'done', createdAt: THREAD.messages[0].createdAt, blocks }] };
  const { w, d } = await liveHost({ thread: () => [200, th] });
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelector('#route-chat [data-cp-revert="cm"]'), null);
  assert.ok(d.querySelector('#route-chat [data-cp-revert="cr"]'));
});

test('Pulse and search open a live task at its card in its starting chat; a task no chat started opens its page', async () => {
  const { w, d } = await liveHost();
  w.RailShell.openRun('run/question', 'A task', 'run-a');   // what a Pulse row does: its case, its title, its run id
  await settle(80);
  assert.equal(w.location.hash, '#chat/ask_1');
  assert.ok(d.querySelector('#route-chat [data-anchor="card_run"]'), 'the TaskCard is drawn');
  w.RailShell.openRun('run/question', 'B task', 'run-b');   // ask_2 only follows run-b: no starting chat
  await settle(40);
  assert.equal(w.location.hash, '#run/run-b', 'its own page, by its id, never the case (#1266)');
});

test('Show its stages opens the live TaskCard in place, and Hide its stages folds it', async () => {
  const { w, d } = await liveHost();
  await go(w, '#chat/ask_1', 80);
  const btn = () => d.querySelector('#route-chat [data-anchor="card_run"] [data-open-task]');
  assert.equal(btn().getAttribute('aria-expanded'), 'false');
  btn().click(); await settle(20);
  assert.equal(btn().getAttribute('aria-expanded'), 'true', 'Show its stages opens it');
  assert.match(btn().textContent, /Hide its stages/);
  btn().click(); await settle(20);
  assert.equal(btn().getAttribute('aria-expanded'), 'false', 'Hide its stages folds it');
});
