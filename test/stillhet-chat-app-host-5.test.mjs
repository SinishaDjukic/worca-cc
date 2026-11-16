// test/stillhet-chat-app-host-5.test.mjs — Chat in the app host, live kind, part 5 of 5 (jsdom, the app's scripts in
// boot.js's order, data-adapter="live"); the host and its helpers are test/helpers/stillhet-chat-live-host.mjs.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, THREAD, blurOnDisable, cardItems, clone, go, liveHost, menuPick, posts, savedRun, saidText, settle, store, toastText, withRun, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
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

// ---- slice 4: chat polish from the feature 1 real test ----
const withBlocks = (blocks, more = []) => ({ ...THREAD, messages: [...THREAD.messages.slice(0, 1), { id: 'mx', role: 'assistant', text: '', status: 'done', createdAt: THREAD.messages[0].createdAt, blocks }, ...more] });
const WF = (over = {}) => ({ kind: 'card', id: 'cw', state: 'proposed', card: { type: 'workflow', thenRun: false, name: 'Quick fix', projectKey: 'web', shape: { stages: [{ key: 'fix' }] }, manifest: { steps: [{ kind: 'agents', nodes: [{ key: 'fix', label: 'Fix' }] }] }, ...over } });
const RUNP = { kind: 'card', id: 'cp', state: 'proposed', card: { title: 'Fix it', workflowId: 'wf_x', target: 'project', projectKey: 'web', projectDir: '/p', brief: 'b', guardrailsId: 'normal' } };

test('workflow card: the primary reads Save workflow', async () => {
  const { w, d } = await liveHost({ thread: () => [200, withBlocks([WF()])] });
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelector('#route-chat [data-cp-apply="cw"]').textContent, 'Save workflow');
});

test('workflow cards never read Apply', async () => {
  const build = { kind: 'card', id: 'cb', state: 'proposed', card: { type: 'workflow-build', name: 'Build', workflow: { nodes: [{ id: 'n1', label: 'Plan' }] } } };
  const { w, d } = await liveHost({ thread: () => [200, withBlocks([WF(), build])] });
  await go(w, '#chat/ask_1');
  for (const id of ['cw', 'cb']) {
    const card = d.querySelector(`#route-chat [data-anchor="${id}"]`);
    assert.ok(card, id);
    assert.ok(![...card.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Apply'), id);
  }
});

function runWithHost({ save = () => [200, { block: { state: 'saved', workflowId: 'wf_x' }, turn: { assistantMessageId: 'm9' } }], start = () => [200, { runId: 'r9' }] } = {}) {
  let saved = false;
  const after = () => withBlocks([{ ...WF({ thenRun: true }), state: 'saved' }], [{ id: 'm9', role: 'assistant', text: 'Here is the task.', status: 'done', createdAt: THREAD.messages[0].createdAt, blocks: [RUNP] }]);
  return liveHost({ thread: () => [200, saved ? after() : withBlocks([WF({ thenRun: true })])], write: async (url, body) => {
    if (url === '/api/ask/threads/ask_1/cards/cw') { const r = await save(); if (r[0] < 300) saved = true; return r; }
    if (url === '/api/run') return start();
    return [200, {}];
  } });
}

test('one-stage workflow: one Run with card that saves then starts', async () => {
  const { w, d, calls } = await runWithHost();
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelectorAll('#route-chat [data-anchor="cw"]').length, 1, 'exactly one card for the workflow');
  assert.equal(d.querySelector('#route-chat [data-anchor="cp"]'), null);
  const card = d.querySelector('#route-chat article[data-anchor="cw"]');
  assert.equal(card.querySelector('[data-rw-start]').textContent, 'Run with Quick fix');
  assert.ok([...card.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Customise'));
  card.querySelector('[data-rw-start]').click(); await settle(200);
  const order = posts(calls).map(([m, u]) => `${m} ${u}`);
  assert.deepEqual(order, ['POST /api/ask/threads/ask_1/cards/cw', 'POST /api/run']);
  const run = posts(calls)[1][2];
  assert.equal(run.workflowId, 'wf_x'); assert.equal(run.askThreadId, 'ask_1'); assert.equal(run.askCardId, 'cp');
});

test('one-stage workflow: the event turn\'s proposal is not drawn as a second card while it starts', async () => {
  let release; const held = new Promise((ok) => { release = ok; });
  const before = (d) => [...d.querySelectorAll('#route-chat article.tp')].map((a) => a.getAttribute('data-anchor'));
  const { w, d, calls } = await runWithHost({ start: async () => { await held; return [200, { runId: 'r9' }]; } });
  await go(w, '#chat/ask_1');
  const was = before(d).filter((a) => a !== 'cw').length;
  d.querySelector('#route-chat [data-rw-start="cw"]').click(); await settle(200);
  assert.ok(calls.some((c) => c.url === '/api/run'), 'the start is out');
  assert.deepEqual(before(d).filter((a) => a === 'cw' || a === 'cp'), ['cw'], 'one card: Run with, never the proposal beside it');
  assert.equal(before(d).length, was + 1);
  release(); await settle(60);
});

test('one-stage workflow: a refused save leaves Run with enabled', async () => {
  const { w, d, calls } = await runWithHost({ save: () => [409, { error: 'name taken' }] });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-rw-start="cw"]').click(); await settle(80);
  assert.equal(d.querySelector('#route-chat [data-rw-start="cw"]').disabled, false);
  assert.ok(!calls.some((c) => c.url === '/api/run'));
  assert.equal(toastText(d), 'Could not save the workflow: name taken');
});

const READY = () => savedRun({ status: 'done', branch: 'feat/x', sourceBranch: 'main', survived: true, projectKey: 'web-1a2b3c4d', projectDir: '/src/web' });
async function createPr(pr) {
  const h = await liveHost({ sources: READY(), write: (url) => (url === '/api/pr' ? pr() : [200, {}]), beforeScripts: blurOnDisable });
  await go(h.w, '#chat/ask_1');
  h.d.querySelector('#route-chat [data-card-act="pa|Create PR"]').click(); await settle(5);
  h.d.querySelector('#route-chat [data-card-form="pa"] [data-confirm]').click(); await settle(60);
  return h;
}
const mainBtn = (d) => d.querySelector('#route-chat [data-anchor="card_run"] [data-card-act^="pa|Create PR"]');
const prFrame = (sockets, f) => sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'history-pr', ...f }) });

test('Create PR: the card reads Opening the PR… until the PR frame', async () => {
  const url = 'https://github.com/acme/web/pull/42';
  const { w, d, sockets } = await createPr(() => [200, { ok: true, url }]);
  assert.equal(mainBtn(d).textContent, 'Opening the PR…');
  assert.equal(mainBtn(d).disabled, true);
  assert.equal(w.RailTaskLive.card('pa').prUrl, undefined, 'never the POST\'s url as the PR');
  assert.equal(d.querySelector('#route-chat [data-card-act="pa|View PR"]'), null);
  const token = w.RailTaskLive.prLookup().token;
  assert.ok(token > 0, 'afterPr asked the PR lookup');
  prFrame(sockets, { token, items: [{ id: 'pa', projectKey: 'web-1a2b3c4d', pr: { url, state: 'OPEN' } }] });
  await settle(120);
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.doesNotMatch(card.textContent, /Opening the PR…/);
  assert.ok(card.querySelector('[data-card-act="pa|View PR"]'), 'its PR is open: View PR');
  assert.equal(w.RailTaskLive.card('pa').prUrl, url, 'the PR is the frame\'s');
});

test('Create PR: a failed create clears Opening and shows the error', async () => {
  const { d } = await createPr(() => [409, { error: 'no commits' }]);
  assert.equal(mainBtn(d).textContent, 'Create PR');
  assert.equal(mainBtn(d).disabled, false);
  assert.match(d.querySelector('#route-chat [data-anchor="card_run"]').textContent, /Could not create the PR: no commits/i);
  assert.equal(d.body.textContent.split(/Could not create the PR: no commits/i).length - 1, 1, 'said once, on the card');
});

test('Create PR: a lookup that ends without the PR clears Opening', async () => {
  const { w, d, sockets } = await createPr(() => [200, { ok: true, url: 'https://github.com/acme/web/pull/42' }]);
  assert.equal(mainBtn(d).textContent, 'Opening the PR…');
  const token = w.RailTaskLive.prLookup().token;
  prFrame(sockets, { token, done: true, items: [] });
  await settle(60);
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.doesNotMatch(card.textContent, /Opening the PR…/);
  assert.match(card.textContent, /Could not read the PR back/);
});

test('first send: the composer project chip shows the chat\'s project', async () => {
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    if (method === 'PATCH' && url === '/api/ask/threads/ask_new') return [200, { thread: { id: 'ask_new', context: { pinned: true, projectKey: 'web-1' } } }];
    if (url.endsWith('/messages')) return [202, { userMessageId: 'u1' }];
    return [200, {}];
  } });
  await go(w, '#chat');
  await menuPick(d, 'cp-project', 'web');
  d.querySelector('#route-chat [data-composer-t]').value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(120);
  assert.equal(w.location.hash, '#chat/ask_new');
  assert.equal(d.querySelector('#route-chat [data-menu="cp-project"]').textContent.trim(), 'web');
  assert.ok(!calls.some((c) => c.method === 'GET' && c.url === '/api/ask/threads/ask_new'), 'no thread GET');
});

test('F-a4-11: a failed task\'s card with no plan: Restart Build is off with its reason; its ⋯ leads with Ask Worca to fix it and holds no Restart Build; nothing is posted', async () => {
  const { w, d, calls } = await liveHost({ sources: savedRun({ status: 'error' }), read: (u) => (u === '/api/runs/pa/artifacts' ? [200, { runId: 'pa', artifacts: [{ kind: 'prompt', relPath: 'prompt.md' }], truncated: false }] : null) });
  await go(w, '#chat/ask_1', 80); await settle(80);
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  const b = card.querySelector('[data-card-act="pa|Restart Build"]');
  assert.ok(b, 'Restart Build is still its action');
  assert.ok(b.disabled, 'off');
  assert.equal(b.title, 'Needs a plan: this task saved none to build from');
  const before = posts(calls).filter(([m]) => m !== 'GET').length;
  b.click(); await settle(40);
  // live, a failed card's retry is its main button and Ask Worca to fix it heads the ⋯ (fixFirst): no second Restart Build there
  const items = await cardItems(d, 'pa');
  assert.equal(items[0], 'Ask Worca to fix it');
  assert.ok(!items.includes('Restart Build'), items.join(', '));
  assert.equal(posts(calls).filter(([m]) => m !== 'GET').length, before, 'a disabled Restart Build posts nothing');
  assert.ok(!posts(calls).some(([, u]) => /restart-build/.test(u)));
});

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
