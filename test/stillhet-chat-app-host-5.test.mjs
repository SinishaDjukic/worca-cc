// test/stillhet-chat-app-host-5.test.mjs — Chat in the app host, live kind, part 5 of 5 (jsdom, the app's scripts in
// boot.js's order, data-adapter="live"); the host and its helpers are test/helpers/stillhet-chat-live-host.mjs.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, THREAD, blurOnDisable, cardItems, clone, go, liveHost, menuPick, posts, savedRun, settle, store, toastText, withRun, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

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
