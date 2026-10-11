// test/ui-workflows-chat.test.mjs — the Workflows chat: its client, its cards, its dock.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const imp = (p) => import(new URL(`../ui/public/workflows/${p}`, import.meta.url).href);
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes.find(([m, re]) => (opts.method || 'GET') === m && re.test(url));
    const [status, body] = hit ? hit[2](url, opts) : [404, { error: 'no route' }];
    return { ok: status < 400, status, json: async () => body };
  };
  return { fn, calls };
}
const THREAD = { id: 'ask_0000abcd', mode: 'composer', title: null };
const CANVAS = { sessionId: 'cs_ab12cd34', docToken: 'd_ab12cd34', graph: { name: '', nodes: [], wires: [] }, selection: null, drafts: [] };

test('the first send creates a composer thread, then posts the message WITH the canvas and the catalog default', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const storage = memStore();
  const ws = [];
  const f = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]],
  ]);
  const c = createComposerChatClient({ fetch: f.fn, sendWs: (o) => ws.push(o), storage });
  const r = await c.send('Add a security review', { context: { view: 'workflows', pinned: false }, composer: CANVAS });
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls[1].body, { mode: 'composer' });
  assert.deepEqual(f.calls[2].body, { text: 'Add a security review', model: 'claude-opus-5-5', effort: 'high',
    context: { view: 'workflows', pinned: false }, composer: CANVAS });
  assert.equal(storage.getItem(THREAD_KEY), 'ask_0000abcd');
  assert.deepEqual(ws.at(-1), { type: 'subscribe', threadId: 'ask_0000abcd' });
  c.newChat();
  assert.equal(c.threadId(), null);
  assert.equal(storage.getItem(THREAD_KEY), null);
});

test('frames of other threads are dropped; a stored non-composer thread is forgotten on open', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const changes = [];
  const live = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]],
  ]);
  const b = createComposerChatClient({ fetch: live.fn, storage: memStore(), onChange: (k) => changes.push(k) });
  assert.equal((await b.send('one', { composer: CANVAS })).ok, true);
  changes.length = 0;
  // An Ask chat's frame — even one naming the message this dock waits for — never reaches the composer thread.
  b.pushFrame({ type: 'ask-start', threadId: 'ask_0000ffff', messageId: 'msg_0000bbbb', userMessageId: 'msg_0000aaaa', seq: 1 });
  assert.deepEqual(changes, [], 'no repaint');
  assert.equal(b.model().live(), null);
  assert.equal(b.busy(), true, 'still waiting for this thread\'s own turn');
  const storage = memStore();
  storage.setItem(THREAD_KEY, 'ask_0000ffff');
  const f = fakeFetch([['GET', /\/api\/ask\/threads\/ask_0000ffff$/, () => [200, { thread: { id: 'ask_0000ffff' }, messages: [], attachments: [], runLinks: [], inFlight: null }]]]);
  const c = createComposerChatClient({ fetch: f.fn, storage });
  await c.open();
  assert.equal(c.threadId(), null, 'an Ask chat is never adopted by the composer');
});

test('Settings › "Delete all chat history" (ask-history-cleared) drops the dock\'s thread, as the Ask panel does; a shared clear of other threads keeps it', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const f = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]],
  ]);
  const storage = memStore();
  const changes = [];
  const c = createComposerChatClient({ fetch: f.fn, storage, onChange: (k) => changes.push(k) });
  assert.equal((await c.send('one', { composer: CANVAS })).ok, true);
  // A shared deployment's clear names the threads it removed: someone else's never resets this dock.
  c.pushFrame({ type: 'ask-history-cleared', threadIds: ['ask_0000ffff'] });
  assert.equal(c.threadId(), THREAD.id, 'another person\'s clear keeps this chat');
  changes.length = 0;
  // The bulk delete removes composer chats too (D1: listThreadIds is unfiltered): the dock must not keep a dead thread.
  c.pushFrame({ type: 'ask-history-cleared', threadIds: [THREAD.id] });
  assert.equal(c.threadId(), null, 'the deleted thread is dropped');
  assert.equal(c.model(), null);
  assert.equal(storage.getItem(THREAD_KEY), null, 'and forgotten across reloads');
  assert.equal(c.busy(), false, 'the 202 it waited for belongs to the deleted thread');
  assert.deepEqual(changes, ['structure'], 'the dock repaints empty once');
  // The next message starts a NEW composer thread instead of posting to the deleted one (a sticky 404 "thread not found").
  assert.equal((await c.send('two', { composer: CANVAS })).ok, true);
  assert.equal(f.calls.filter((x) => x.method === 'POST' && /\/api\/ask\/threads$/.test(x.url)).length, 2);
  // A single-user clear carries no list: it resets too.
  c.pushFrame({ type: 'ask-history-cleared' });
  assert.equal(c.threadId(), null);
});

test('busy() holds from the 202 until the turn ends; New chat during the POST never writes into the new chat', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const MODELS = ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] }]];
  const f = fakeFetch([MODELS, ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]]]);
  const c = createComposerChatClient({ fetch: f.fn, storage: memStore() });
  assert.equal((await c.send('one', { composer: CANVAS })).ok, true);
  assert.equal(c.busy(), true, 'the 202 promised a turn: a second Enter would get a 409');
  c.pushFrame({ type: 'ask-start', threadId: THREAD.id, messageId: 'msg_0000bbbb', userMessageId: 'msg_0000aaaa', seq: 1 });
  assert.equal(c.busy(), true);
  c.pushFrame({ type: 'ask-done', threadId: THREAD.id, messageId: 'msg_0000bbbb', seq: 2, text: 'ok', blocks: [] });
  assert.equal(c.busy(), false);
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const g = fakeFetch([MODELS, ['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, { thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null }]]]);
  const slow = async (url, opts = {}) => (/\/messages$/.test(url)
    ? (await gate, { ok: true, status: 202, json: async () => ({ userMessageId: 'msg_0000cccc', assistantMessageId: 'msg_0000dddd' }) })
    : g.fn(url, opts));
  const storage = memStore();
  storage.setItem(THREAD_KEY, THREAD.id);
  const d = createComposerChatClient({ fetch: slow, storage });
  const p = d.send('two', { composer: CANVAS });
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  const before = d.model();
  d.newChat();
  release();
  assert.equal((await p).ok, true);
  assert.equal(d.threadId(), null);
  assert.equal(d.model(), null);
  assert.equal(before.messages().length, 0, 'the reply belongs to the chat it was sent to; its rows arrive over the socket');
  assert.equal(d.busy(), false, 'a New chat never inherits the old turn\'s wait');
});

test('a seq gap reloads the thread ONCE, however many frames arrive before the reload lands', async () => {
  const { createComposerChatClient } = await imp('chat-client.mjs');
  const f = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]],
    ['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, { thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null }]],
  ]);
  let gets = 0;
  let release = null;
  let gate = new Promise((r) => { release = r; });
  const slow = async (url, opts) => { if (/\/api\/ask\/threads\/ask_0000abcd$/.test(url)) { gets += 1; await gate; } return f.fn(url, opts); };
  const c = createComposerChatClient({ fetch: slow, storage: memStore() });
  assert.equal((await c.send('one', { composer: CANVAS })).ok, true);
  c.pushFrame({ type: 'ask-start', threadId: THREAD.id, messageId: 'msg_0000bbbb', userMessageId: 'msg_0000aaaa', seq: 1 });
  for (let s = 5; s < 25; s += 1) c.pushFrame({ type: 'ask-delta', threadId: THREAD.id, messageId: 'msg_0000bbbb', seq: s, text: 'x' });
  assert.equal(gets, 1, 'every frame after a gap gaps too: one GET per frame would flood the server');
  release();
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  // The reload landed: the next gap may reload again.
  gate = Promise.resolve();
  c.pushFrame({ type: 'ask-start', threadId: THREAD.id, messageId: 'msg_0000dddd', userMessageId: 'msg_0000cccc', seq: 1 });
  c.pushFrame({ type: 'ask-delta', threadId: THREAD.id, messageId: 'msg_0000dddd', seq: 9, text: 'x' });
  assert.equal(gets, 2);
});

test('a chat the server locked to an engine keeps sending that engine\'s default after the Ask engine changes; a fresh chat takes the Ask default', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const storage = memStore();
  storage.setItem(THREAD_KEY, 'ask_0000c0de');
  const f = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, defaults: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-5.5', effort: 'low' } }, askEngine: 'claude', models: [] }]],
    ['GET', /\/api\/ask\/threads\/ask_0000c0de$/, () => [200, { thread: { id: 'ask_0000c0de', mode: 'composer', engine: 'codex', model: 'gpt-5.5', effort: 'low' }, messages: [], attachments: [], runLinks: [], inFlight: null }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]],
  ]);
  const c = createComposerChatClient({ fetch: f.fn, storage });
  // No open(): send loads the stored chat itself (offline at open), and picks only after that load.
  assert.equal((await c.send('one', { composer: CANVAS })).ok, true);
  const posted = f.calls.filter((x) => /\/messages$/.test(x.url)).map((x) => [x.body.model, x.body.effort]);
  assert.deepEqual(posted, [['gpt-5.5', 'low']], 'the Codex chat keeps Codex (the server refuses another engine: "this chat runs on Codex")');
  c.newChat();
  c.pushFrame({ type: 'ask-done', threadId: 'ask_0000abcd' });
  assert.equal((await c.send('two', { composer: CANVAS })).ok, true);
  const again = f.calls.filter((x) => /\/messages$/.test(x.url)).map((x) => [x.body.model, x.body.effort]);
  assert.deepEqual(again.at(-1), ['claude-opus-5-5', 'high'], 'New chat: the Ask default');
});

function fakeComposer() {
  let depth = 0; let token = 'd_ab12cd34'; const log = [];
  return {
    log,
    docToken: () => token, undoDepth: () => depth, gesture: () => null, isDirty: () => false, origin: () => '',
    template: () => ({ id: 'wf_x', name: 'Mine', nodes: [], wires: [] }),
    applyOps: (ops, label) => { log.push(['applyOps', ops.length, label]); depth += 1; return { ok: true, depth }; },
    undo: () => { log.push(['undo']); depth -= 1; },
    guardDiscard: async () => true,
    loadDraft: (d) => { log.push(['loadDraft', d.name]); token = 'd_newdoc01'; depth = 0; },
    loadTemplate: (t) => { log.push(['loadTemplate', t.id]); token = 'd_back0001'; },
    setName: () => {}, fit: () => {}, openSaveDialog: () => log.push(['save']),
    serialize: () => ({ id: 'wf_x', nodes: [], wires: [] }),
    view: { world: null }, setTok: (t) => { token = t; },
  };
}
const card = (id, state, c) => ({ kind: 'card', id, state, card: { sessionId: 'cs_ab12cd34', docToken: 'd_ab12cd34', ...c } });

test('a canvas edit of THIS session and document applies once, posts applied, and offers Undo while it is the last step', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  const posts = [];
  let blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'layout', positions: {} }] })];
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks,
    client: { postCard: async (id, body) => { posts.push([id, body]); return { ok: true }; } } });
  await cc.sweep();
  await cc.sweep();
  assert.deepEqual(composer.log, [['applyOps', 1, 'chat: Add Plan']]);
  assert.deepEqual(posts, [['card_0000aaaa', { state: 'applied' }]]);
  blocks = [{ ...blocks[0], state: 'applied' }];
  const el = cc.render(blocks[0]);
  const undo = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
  assert.equal(undo.disabled, false);
  undo.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(composer.log.at(-1), ['undo']);
  assert.deepEqual(posts.at(-1), ['card_0000aaaa', { state: 'undone' }]);
});

test('inline Undo stands down once the canvas moved on, even when the undo depth matches again', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  let graph = 'A';
  composer.serialize = () => ({ graph });
  const blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'layout', positions: {} }] })];
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks,
    client: { postCard: async () => ({ ok: true }) } });
  await cc.sweep();
  graph = 'B';               // ⌘Z on the chat edit, then an edit of the user's own: the SAME depth, another graph
  const undo = [...cc.render({ ...blocks[0], state: 'applied' }).querySelectorAll('button')].find((b) => b.textContent === 'Undo');
  assert.equal(undo.disabled, true, 'Undo would revert the user\'s own edit');
});

test('an edit for another document fails without touching the canvas; another session is inert', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  composer.setTok('d_other001');
  const posts = [];
  const blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'x', ops: [] }),
    { kind: 'card', id: 'card_0000bbbb', state: 'proposed', card: { type: 'canvas-edit', sessionId: 'cs_zzzzzzzz', docToken: 'd_other001', summary: 'old', ops: [] } }];
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks,
    client: { postCard: async (id, body) => { posts.push([id, body.state]); return { ok: true }; } } });
  await cc.sweep();
  assert.deepEqual(composer.log, []);
  assert.deepEqual(posts, [['card_0000aaaa', 'failed']]);
  assert.match(cc.render(blocks[1]).textContent, /Not applied — made for an earlier visit/);
});

test('a built workflow waits for Apply; Apply asks to discard, saves its drafts, opens a NEW unsaved workflow', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  const posts = [];
  const saved = [];
  const draft = card('card_0000dddd', 'proposed', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes' }, markdown: '# x' }, then: null });
  const build = card('card_0000eeee', 'proposed', { type: 'workflow-build', name: 'Bug fix', reasoning: 'Small.', counts: { agents: 2, scripts: 1, loops: 1 },
    workflow: { nodes: [{ id: 'n_a', kind: 'task' }], wires: [] }, drafts: ['releaseNotes'], loops: [] });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [draft, build],
    client: { postCard: async (id, body) => { posts.push([id, body]); return { ok: true }; } },
    actions: { saveAgentDraft: async (d) => { saved.push(d.key); return { ok: true, key: d.key }; }, reloadRegistry: async () => {} } });
  await cc.sweep();
  assert.deepEqual(composer.log, [], 'a build never applies by itself');
  const el = cc.render(build);
  assert.equal(el.querySelector('.wfc-graph'), null, 'no mini graph: the canvas is the preview');
  assert.match(el.textContent, /2 agents · 1 script · 1 loop/);
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas').click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved, ['releaseNotes']);
  assert.deepEqual(composer.log.map((l) => l[0]), ['loadDraft']);
  assert.deepEqual(posts.map((p) => [p[0], p[1].state]), [['card_0000dddd', 'saved'], ['card_0000eeee', 'applied']]);
});

test('an agent draft: Save posts saved+savedKey; Save & add applies its then-ops and posts added', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  const posts = [];
  const b = card('card_0000ffff', 'proposed', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes', runnerType: 'producer', inputs: [{ id: 'plan', type: 'md' }], outputs: [] }, markdown: '---\n---\nx' },
    then: { ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'releaseNotes', x: 0, y: 0 }] } });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [b],
    client: { postCard: async (id, body) => { posts.push(body); return { ok: true }; } },
    actions: { saveAgentDraft: async (d) => ({ ok: true, key: d.key }), reloadRegistry: async () => {} } });
  const el = cc.render(b);
  assert.deepEqual([...el.querySelectorAll('.wfc-actions button')].map((x) => x.textContent), ['Edit…', 'Decline', 'Save agent', 'Save & add to canvas']);
  [...el.querySelectorAll('button')].find((x) => x.textContent === 'Save & add to canvas').click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(composer.log.map((l) => l[0]), ['applyOps']);
  assert.deepEqual(posts.at(-1), { state: 'added', card: { savedKey: 'releaseNotes', added: true } });
});

test('a canvas edit never lands under a live drag: it waits for the gesture to end', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  let g = { type: 'node' };
  composer.gesture = () => g;
  const blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'layout', positions: {} }] })];
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks,
    client: { postCard: async () => ({ ok: true }) } });
  await cc.sweep(); await cc.sweep();
  assert.deepEqual(composer.log, []);
  g = null;
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(composer.log, [['applyOps', 1, 'chat: Add Plan']]);
  dom.window.close();
});

test('Apply to canvas does nothing when the discard question is answered No', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  composer.guardDiscard = async () => false;
  const posts = [];
  const build = card('card_0000eeee', 'proposed', { type: 'workflow-build', name: 'Bug fix', counts: {}, workflow: { nodes: [], wires: [] }, drafts: [], loops: [] });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [build],
    client: { postCard: async (id, body) => { posts.push(body); return { ok: true }; } } });
  [...cc.render(build).querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas').click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(composer.log, []);
  assert.deepEqual(posts, []);
});

test('a draft already in the library (saved through Edit…) counts as saved: Apply posts nothing to the store and opens the build', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  const posts = [];
  const saved = [];
  const draft = card('card_0000dddd', 'proposed', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes' }, markdown: '# x' }, then: null });
  const build = card('card_0000eeee', 'proposed', { type: 'workflow-build', name: 'Bug fix', counts: {}, workflow: { nodes: [], wires: [] }, drafts: ['releaseNotes'], loops: [] });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [draft, build],
    client: { postCard: async (id, body) => { posts.push([id, body]); return { ok: true }; } },
    actions: { libraryHas: (key, kind) => key === 'releaseNotes' && kind === 'agent', reloadRegistry: async () => {},
      saveAgentDraft: async (d) => { saved.push(d.key); return { ok: false, error: 'An agent with this key already exists.' }; } } });
  assert.deepEqual(cc.pendingDrafts(), [], 'the tools read the saved agent, not the stale draft');
  [...cc.render(build).querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas').click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved, [], 'a second POST /api/agents would be the store\'s 409');
  assert.deepEqual(composer.log.map((l) => l[0]), ['loadDraft']);
  assert.deepEqual(posts, [['card_0000dddd', { state: 'saved', card: { savedKey: 'releaseNotes' } }], ['card_0000eeee', { state: 'applied' }]]);
});

test('a build whose draft was declined is not applied: one toast, no discard question, nothing loads', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  let asked = 0;
  composer.guardDiscard = async () => { asked += 1; return true; };
  const posts = [];
  const notes = [];
  const draft = card('card_0000dddd', 'declined', { type: 'script-draft', draft: { key: 'lintAll', meta: { displayName: 'Lint all', runtime: 'shell' }, source: 'npm run lint' }, then: null });
  const build = card('card_0000eeee', 'proposed', { type: 'workflow-build', name: 'Bug fix', counts: {}, workflow: { nodes: [], wires: [] }, drafts: ['lintAll'], loops: [] });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [draft, build],
    client: { postCard: async (id, body) => { posts.push(body); return { ok: true }; } },
    actions: { notify: (o) => notes.push(o.title), reloadRegistry: async () => {} } });
  [...cc.render(build).querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas').click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(composer.log, [], 'loadDraft would place a script no library has');
  assert.deepEqual(posts, []);
  assert.equal(asked, 0);
  assert.deepEqual(notes, ['Not applied — this workflow needs "lintAll", which was declined.']);
});

test('a canvas edit waits while a popover field has focus and lands once it blurs; after dispose() a waiting edit never lands', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  let typing = true;
  composer.inspectorFocused = () => typing;
  const edit = (id) => [card(id, 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'layout', positions: {} }] })];
  const make = (blocks) => createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks,
    client: { postCard: async () => ({ ok: true }) } });
  await make(edit('card_0000aaaa')).sweep();
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(composer.log, [], 'a commit repaints the popover: the half-typed value and the focus would be lost');
  typing = false;
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(composer.log, [['applyOps', 1, 'chat: Add Plan']], 'the retry keeps polling: no new frame is needed');
  typing = true;
  const gone = make(edit('card_0000bbbb'));
  await gone.sweep();
  gone.dispose();
  typing = false;
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(composer.log.length, 1, 'the dock is gone: its waiting edit stands down');
  dom.window.close();
});

test('a failed "applied" POST still shows the edit applied with its Undo, and the next sweep retries the POST once', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  const posts = [];
  let up = false;
  const blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'layout', positions: {} }] })];
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks,
    client: { postCard: async (id, body) => { posts.push(body.state); return { ok: up }; } } });
  const before = cc.sig(blocks[0]);
  await cc.sweep();
  const el = cc.render(blocks[0]);                                       // the server still says proposed
  assert.doesNotMatch(el.textContent, /Applying/);
  assert.equal([...el.querySelectorAll('button')].find((b) => b.textContent === 'Undo').disabled, false);
  up = true;
  await cc.sweep();
  await cc.sweep();
  assert.deepEqual(posts, ['applied', 'applied'], 'one retry, then nothing');
  assert.equal(composer.log.length, 1, 'never applied twice');
  composer.undo();                                                       // ⌘Z: the inline Undo stands down
  assert.notEqual(cc.sig(blocks[0]), before, 'the dock must not keep the "Applying…" element');
});

test('an applied edit reveals what it added: only the new cards fade in, and the view fits only when one landed outside it', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  async function run(x, reduced = false) {
    const composer = fakeComposer();
    const world = doc.createElement('div');
    world.innerHTML = '<div class="node" data-node-id="n_old00001"></div><div class="node" data-node-id="n_new00001"></div>';
    composer.view = { world, readRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }), toScreen: (wx, wy) => ({ x: wx, y: wy }),
      bounds: (pad, ids) => (ids && ids.join() === 'n_new00001' ? { x, y: 100, w: 200, h: 80 } : null) };
    composer.applyOps = (ops, label) => { composer.log.push(['applyOps', ops.length, label]); return { ok: true, depth: 1, added: ['n_new00001'] }; };
    composer.fit = () => composer.log.push(['fit']);
    const blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'add_node' }] })];
    await createCardController({ doc, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks, reducedMotion: () => reduced,
      client: { postCard: async () => ({ ok: true }) } }).sweep();
    const cls = (id) => world.querySelector(`[data-node-id="${id}"]`).classList.contains('wfc-enter');
    return { fit: composer.log.some((l) => l[0] === 'fit'), fresh: cls('n_new00001'), old: cls('n_old00001') };
  }
  assert.deepEqual(await run(1100), { fit: true, fresh: true, old: false }, 'placed right of the right-most card: off screen');
  assert.deepEqual(await run(300), { fit: false, fresh: true, old: false });
  assert.deepEqual(await run(300, true), { fit: false, fresh: false, old: false }, 'reduced motion: no entry animation');
  dom.window.close();
});

test('an edit under the open chat counts as off screen: the view fits into the band above the dock; one clear of it stays put', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  // The stage sits at (100, 50) in the page, 1000 × 600; the open dock covers its lower middle (stage y 300 → 590).
  const STAGE = { left: 100, top: 50, width: 1000, height: 600 };
  const DOCK = { left: 400, top: 350, width: 500, height: 290, right: 900, bottom: 640 };
  async function run(box, dock = DOCK) {
    const composer = fakeComposer();
    const fits = [];
    composer.view = { world: doc.createElement('div'), readRect: () => ({ ...STAGE }), toScreen: (wx, wy) => ({ x: wx, y: wy }),
      bounds: (pad, ids) => (ids && ids.join() === 'n_new00001' ? { ...box } : null) };
    composer.applyOps = () => ({ ok: true, depth: 1, added: ['n_new00001'] });
    composer.fit = (o) => fits.push(o || {});
    const blocks = [card('card_0000aaaa', 'proposed', { type: 'canvas-edit', summary: 'Add Plan', ops: [{ op: 'add_node' }] })];
    await createCardController({ doc, composer, sessionId: 'cs_ab12cd34', blocks: () => blocks, occluder: () => dock,
      client: { postCard: async () => ({ ok: true }) } }).sweep();
    return fits.map((o) => o.insetBottom || 0);
  }
  assert.deepEqual(await run({ x: 350, y: 350, w: 200, h: 80 }), [316], 'under the dock: fit into the 284 px above it (stage 600 − dock top 300 + 16)');
  assert.deepEqual(await run({ x: 50, y: 350, w: 200, h: 80 }), [], 'beside the dock, inside the stage: no fit');
  assert.deepEqual(await run({ x: 350, y: 100, w: 200, h: 80 }), [], 'above the dock: no fit');
  assert.deepEqual(await run({ x: 1100, y: 100, w: 200, h: 80 }), [316], 'off screen with the dock open: the fit still frames above it');
  assert.deepEqual(await run({ x: 1100, y: 100, w: 200, h: 80 }, null), [0], 'no dock: the plain fit');
  assert.deepEqual(await run({ x: 1100, y: 100, w: 200, h: 80 }, { left: 500, top: 300, width: 0, height: 0, right: 500, bottom: 300 }), [0], 'a hidden dock (zero rect) covers nothing');
  assert.deepEqual(await run({ x: 1100, y: 100, w: 200, h: 80 }, { ...DOCK, top: 660, bottom: 950 }), [0], 'a dock below the stage covers nothing');
  assert.deepEqual(await run({ x: 350, y: 350, w: 200, h: 80 }, { ...DOCK, top: 60, height: 580 }), [480], 'a dock over nearly the whole stage still leaves a 120 px band');
  dom.window.close();
});

test('fit({ insetBottom }) frames the whole graph inside the band above the dock (composer → view → fitBounds)', async () => {
  const { fixture, portsFn } = await import('./helpers/graph-view-fixture.mjs');
  const { fitBounds } = await import(new URL('../src/shared/graph/geometry.mjs', import.meta.url).href);
  const { createComposer } = await import(new URL('../ui/public/graph/composer.mjs', import.meta.url).href);
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const el = (tag, id) => { const n = doc.createElement(tag); n.id = id; doc.body.appendChild(n); return n; };
  const hostEls = { canvas: el('div', 'gv-canvas'), chip: el('div', 'gv-chip'), name: el('input', 'gv-name'), errors: el('button', 'gv-errors'),
    autoBtn: el('button', 'gv-autolayout'), saveBtn: el('button', 'gv-save'), insBody: el('div', 'gv-ins-body'), dialogHost: el('div', 'gv-dialog-host') };
  const api = { agents: async () => [], agentsAll: async () => [], config: async () => ({ models: [], efforts: [] }), listWorkflows: async () => [],
    listArchived: async () => [], readWorkflow: async () => null, saveWorkflow: async () => ({ ok: true }), deleteWorkflow: async () => ({ ok: true }) };
  const c = createComposer(hostEls, { doc, api, raf: (fn) => { fn(); return 1; }, viewport: () => ({ left: 0, top: 0, width: 1280, height: 560 }), portsFn });
  c.mount();
  c.loadTemplate(fixture());
  c.fit({ insetBottom: 360 });                                           // a 200 px band above the dock
  const f = fitBounds(c.view.bounds(60), { width: 1280, height: 200 }, { zoomMin: 0.4, zoomMax: 1 });
  const t = c.view.getTransform();
  assert.ok(Math.abs(t.z - f.z) < 1e-9 && Math.abs(t.x - f.tx) < 1e-6 && Math.abs(t.y - f.ty) < 1e-6, JSON.stringify([t, f]));
  const b = c.view.bounds(0);
  const top = c.view.toScreen(b.x, b.y).y;
  const bottom = c.view.toScreen(b.x + b.w, b.y + b.h).y;
  assert.ok(top >= 0 && bottom <= 200, `the graph sits in the band: ${top}..${bottom}`);
  c.fit();
  assert.ok(c.view.toScreen(b.x + b.w, b.y + b.h).y > 200, 'without the inset the graph is centred in the whole stage');
  dom.window.close();
});

test('an applied edit from another tab or visit has no ⌘Z here: its disabled Undo says where to undo it', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const cc = createCardController({ doc: dom.window.document, composer: fakeComposer(), sessionId: 'cs_ab12cd34', client: { postCard: async () => ({ ok: true }) } });
  const undoOf = (b) => [...cc.render(b).querySelectorAll('button')].find((x) => x.textContent === 'Undo');
  const theirs = undoOf({ kind: 'card', id: 'card_0000bbbb', state: 'applied', card: { type: 'canvas-edit', sessionId: 'cs_zzzzzzzz', docToken: 'd_ab12cd34', summary: 'old', ops: [] } });
  assert.equal(theirs.disabled, true);
  assert.equal(theirs.title, 'Applied in another tab or visit — undo it there');
  assert.equal(undoOf(card('card_0000aaaa', 'applied', { type: 'canvas-edit', summary: 'x', ops: [] })).title, 'Use Ctrl+Z on the canvas', 'jsdom names no platform: not a Mac');
  // The title names the chord this keyboard has: ⌘Z on a Mac, Ctrl+Z on Windows and Linux (the platform check of global-search.mjs shortcutLabel).
  for (const [platform, chord] of [['MacIntel', '⌘Z'], ['iPad', '⌘Z'], ['Win32', 'Ctrl+Z'], ['Linux x86_64', 'Ctrl+Z']]) {
    const host = new JSDOM('<!doctype html><body></body>');
    Object.defineProperty(host.window.navigator, 'platform', { value: platform, configurable: true });
    const here = createCardController({ doc: host.window.document, composer: fakeComposer(), sessionId: 'cs_ab12cd34', client: { postCard: async () => ({ ok: true }) } });
    const undo = [...here.render(card('card_0000aaaa', 'applied', { type: 'canvas-edit', summary: 'x', ops: [] })).querySelectorAll('button')].find((x) => x.textContent === 'Undo');
    assert.equal(undo.title, `Use ${chord} on the canvas`, platform);
    host.window.close();
  }
  dom.window.close();
});

test('sig() holds while nothing a card shows changed and moves when something does', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  let graph = 'A';
  composer.serialize = () => ({ graph });
  const draft = card('card_0000dddd', 'proposed', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes' }, markdown: '# x' }, then: null });
  const build = card('card_0000eeee', 'proposed', { type: 'workflow-build', name: 'Bug fix', counts: {}, workflow: { nodes: [], wires: [] }, drafts: [], loops: [] });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [draft, build],
    client: { postCard: async () => ({ ok: true }) }, actions: { saveAgentDraft: async () => ({ ok: false, error: 'offline' }), notify: () => {} } });
  const save = [...cc.render(draft).querySelectorAll('button')].find((b) => b.textContent === 'Save agent');
  save.click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.equal(save.disabled, false, 'the card did not change, so the dock keeps this button: it must not stay disabled');
  assert.equal(cc.sig(JSON.parse(JSON.stringify(draft))), cc.sig(draft), 'a frame re-delivers an equal block: same sig');
  assert.notEqual(cc.sig({ ...draft, state: 'declined' }), cc.sig(draft));
  assert.notEqual(cc.sig({ ...draft, card: { ...draft.card, draft: { ...draft.card.draft, markdown: '# y' } } }), cc.sig(draft), 'the card body is part of it');
  [...cc.render(build).querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas').click();
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const applied = { ...build, state: 'applied' };
  graph = 'B';                                                           // an own edit: Undo stands down, Save stays
  const edited = cc.sig(applied);
  assert.ok([...cc.render(applied).querySelectorAll('button')].some((b) => b.textContent === 'Save as workflow'));
  composer.setTok('d_other001');                                         // another workflow opened: Save must go
  assert.notEqual(cc.sig(applied), edited);
  assert.ok(![...cc.render(applied).querySelectorAll('button')].some((b) => b.textContent === 'Save as workflow'));
});

test('Apply to canvas and the build\'s Undo frame the workflow in the band above the open dock, as a reveal does', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  async function run(dock, rect = { left: 0, top: 0, width: 1000, height: 600 }) {
    const composer = fakeComposer();
    const fits = [];
    composer.view = { world: null, readRect: () => ({ ...rect }) };
    composer.fit = (o) => fits.push(o ? o.insetBottom : 'bare');
    const build = card('card_0000eeee', 'proposed', { type: 'workflow-build', name: 'Bug fix', counts: {}, workflow: { nodes: [{ id: 'n_a', kind: 'task' }], wires: [] }, drafts: [], loops: [] });
    const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [build], occluder: () => dock,
      client: { postCard: async () => ({ ok: true }) } });
    [...cc.render(build).querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas').click();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    [...cc.render({ ...build, state: 'applied' }).querySelectorAll('button')].find((b) => b.textContent === 'Undo').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(composer.log.map((l) => l[0]), ['loadDraft', 'loadTemplate'], 'precondition: Apply opened the build, Undo brought the canvas back');
    return fits;
  }
  // The open dock covers the stage's lower half (stage y 300 → 600): both fits frame the graph in the 284 px above it.
  assert.deepEqual(await run({ left: 250, top: 300, width: 500, height: 300 }), [316, 316], '600 − dock top 300 + 16');
  assert.deepEqual(await run(null), [0, 0], 'no dock: the whole stage');
  assert.deepEqual(await run({ left: 250, top: 300, width: 500, height: 300 }, { left: 0, top: 0, width: 0, height: 0 }), [0, 0], 'a hidden stage measures nothing: the whole stage');
  dom.window.close();
});

test('a "Save & add" whose add the canvas refuses still saves, and the card says why the draft is not on the canvas', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  async function run(result) {
    const composer = fakeComposer();
    composer.applyOps = (ops, label) => { composer.log.push(['applyOps', ops.length, label]); return result; };
    const posts = [];
    const b = card('card_0000ffff', 'proposed', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes' }, markdown: '# x' },
      then: { ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'releaseNotes', x: 0, y: 0 }] } });
    const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [b],
      client: { postCard: async (id, body) => { posts.push(body); return { ok: true }; } },
      actions: { saveAgentDraft: async (d) => ({ ok: true, key: d.key }), reloadRegistry: async () => {} } });
    [...cc.render(b).querySelectorAll('button')].find((x) => x.textContent === 'Save & add to canvas').click();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(composer.log.map((l) => l[0]), ['applyOps']);
    const el = cc.render({ ...b, state: posts.at(-1).state });
    return { post: posts.at(-1), why: () => cc.notAdded(b.id), err: [...el.querySelectorAll('.wfc-err')].map((x) => x.textContent), text: el.textContent };
  }
  const refused = await run({ ok: false, error: 'x' });
  assert.deepEqual(refused.post, { state: 'saved', card: { savedKey: 'releaseNotes' } }, 'saved all the same');
  assert.deepEqual(refused.err, ['Not added to the canvas — x']);
  assert.match(refused.text, /✓ Saved to your agents/);
  assert.equal(refused.why(), 'x', 'the dock\'s live region reads it');
  assert.deepEqual((await run({ ok: false })).err, ['Not added to the canvas — the canvas refused it'], 'a refusal with no reason still says so');
  const took = await run({ ok: true, depth: 1 });
  assert.deepEqual([took.post.state, took.err, took.why()], ['added', [], '']);
  const plain = createCardController({ doc: dom.window.document, composer: fakeComposer(), sessionId: 'cs_ab12cd34', client: { postCard: async () => ({ ok: true }) } });
  assert.equal(plain.render(card('card_0000dddd', 'saved', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: {} }, then: null })).querySelector('.wfc-err'), null,
    'a plain Save says nothing of the kind');
  dom.window.close();
});

// The dock starts a 4.2 s placeholder interval on the jsdom window: a window left open keeps `node --test` (and
// `npm test`, which runs without forceExit) alive forever. Destroy every dock and close its window after each test.
const docks = [];
afterEach(() => { for (const x of docks.splice(0)) { x.dock.destroy(); x.win.close(); } });

/** `opts` (or `opts(shell)`) overrides createChatDock's arguments: storage, projects, the stage/cluster/plus. */
async function bootDock(routes = [], opts = {}) {
  const { bootShell } = await import('./helpers/workflows-shell.mjs');
  const s = await bootShell();
  const { createChatDock } = await imp('chat-dock.mjs');
  const f = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' } }]],
    ['GET', /\/api\/projects$/, () => [200, { projects: [{ key: 'worca-1a2b3c4d', name: 'worca' }] }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa' }]],
    ...routes,
  ]);
  const dock = createChatDock({ doc: s.doc, host: s.g('wfc'), composer: s.c, sessionId: 'cs_ab12cd34', fetch: f.fn, sendWs: () => {},
    storage: memStore(), canvas: () => ({ ...CANVAS, docToken: s.c.docToken() }),
    projects: async () => [{ key: 'worca-1a2b3c4d', name: 'worca' }], ...(typeof opts === 'function' ? opts(s) : opts) });
  docks.push({ dock, win: s.win });
  return { ...s, dock, f };
}

// Files in jsdom: a File, the picker's change, a drag and a paste. jsdom has no DataTransfer: the fakes carry what the
// dock reads (types, files, dropEffect, getData).
const mkFile = (s, name, body, type = 'text/plain') => new s.win.File([body], name, { type });
const pngFile = (s, name = 'flow.png') => new s.win.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
function pickFiles(s, list) {
  const input = s.g('wfc').querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new s.win.Event('change', { bubbles: true }));
}
function fireDrag(s, target, type, dataTransfer) {
  const ev = new s.win.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer, configurable: true });
  target.dispatchEvent(ev);
  return ev;
}
function firePaste(s, target, clipboardData) {
  const ev = new s.win.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: clipboardData, configurable: true });
  target.dispatchEvent(ev);
  return ev;
}
/** The engine lookup, the file reads and the repaint are a few promise hops: let them all land. */
const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const chipNames = (root) => [...root.querySelectorAll('.wfc-file-name')].map((x) => x.textContent);
/** A fetch whose `first` routes win over the defaults (fakeFetch takes the first match), for createChatDock's `fetch`. */
const fetchWith = (first) => fakeFetch([...first,
  ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' } }]],
  ['GET', /\/api\/projects$/, () => [200, { projects: [] }]],
  ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
  ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa' }]]]);

test('collapsed pill: the still orb, one-line input with a rotating example, attach, scope "Auto", send', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'false');
  assert.equal(root.querySelector('.wfc-spark canvas.wfc-orb').dataset.phase, 'rest');
  assert.equal(root.querySelector('.wfc-spark svg'), null, 'the orb took the sparkle\'s slot');
  assert.equal(root.querySelector('#wfc-input').placeholder, 'Add a security review after Implementation…');
  assert.equal(root.querySelector('#wfc-scope').textContent.trim(), 'Auto');
  assert.equal(root.querySelector('#wfc-attach').getAttribute('aria-label'), 'Attach files');
  assert.deepEqual([...root.querySelector('.wfc-row').children].map((e) => e.id || e.className),
    ['wfc-spark', 'wfc-input', 'wfc-attach', 'wfc-file-input', 'wfc-scope', 'wfc-stop', 'wfc-send']);
  const file = root.querySelector('input[type="file"]');
  assert.equal(file.multiple, true);
  assert.equal(file.hidden, true);
  assert.equal(file.accept, '.md,.markdown,.txt,.json,.csv,.log,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.pdf,text/*');
  assert.equal(root.querySelector('.wfc-files').hidden, true, 'no chips until a file is picked');
  assert.equal(root.querySelector('#wfc-send').getAttribute('aria-disabled'), 'true');
});

test('typing expands it upward; Escape collapses; New chat clears the thread', async () => {
  const s = await bootDock();
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(s.g('wfc').querySelector('.wfc-shell').dataset.open, 'true');
  assert.equal(s.g('wfc').querySelector('.wfc-title').textContent, 'Composer chat');
  assert.equal(s.g('wfc').querySelector('#wfc-send').getAttribute('aria-disabled'), 'false');
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(s.g('wfc').querySelector('.wfc-shell').dataset.open, 'false');
  assert.ok(s.g('wfc').querySelector('#wfc-new'), 'New chat lives in the header');
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.dock.client.threadId(), THREAD.id);
  s.g('wfc').querySelector('#wfc-new').click();
  assert.equal(s.dock.client.threadId(), null);
});

test('Enter sends the text with the canvas; the scope pill pins a project', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-scope').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...s.doc.querySelectorAll('.wfv-menu .wfv-menu-l')].map((x) => x.textContent), ['Auto', 'worca']);
  [...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('worca')).click();
  const input = root.querySelector('#wfc-input');
  input.value = 'Add Plan after Task';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const msg = s.f.calls.find((c) => /\/messages$/.test(c.url));
  assert.equal(msg.body.text, 'Add Plan after Task');
  assert.deepEqual(msg.body.context, { view: 'workflows', pinned: true, projectKey: 'worca-1a2b3c4d' });
  assert.equal(msg.body.composer.docToken, s.c.docToken());
  assert.equal(input.value, '');
});
test('a streaming frame rewrites only the answer: the card under the pointer stays the same node', async () => {
  const s = await bootDock();
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Build it';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const T = THREAD.id; const M = 'msg_0000bbbb';
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  s.dock.pushFrame({ type: 'ask-card', threadId: T, messageId: M, seq: 2, block: { kind: 'card', id: 'card_0000aaaa', state: 'proposed',
    card: { type: 'workflow-build', sessionId: 'cs_ab12cd34', docToken: s.c.docToken(), name: 'Bug fix', counts: {}, workflow: { nodes: [], wires: [] }, drafts: [], loops: [] } } });
  await new Promise((r) => setTimeout(r, 0));
  const apply = () => [...s.g('wfc').querySelectorAll('button')].find((b) => b.textContent === 'Apply to canvas');
  const before = apply();
  s.dock.pushFrame({ type: 'ask-delta', threadId: T, messageId: M, seq: 3, text: 'Hello ' });
  s.dock.pushFrame({ type: 'ask-delta', threadId: T, messageId: M, seq: 4, text: 'world' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(apply(), before, 'the Apply button was not rebuilt');
  assert.equal(s.g('wfc').querySelector('.wfc-text').textContent, 'Hello world');
});

test('New chat waits for the reply: disabled while a turn runs (it would keep running and spending), enabled once it ends', async () => {
  const s = await bootDock();
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const T = THREAD.id; const M = 'msg_0000bbbb';
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  await new Promise((r) => setTimeout(r, 0));
  const nb = s.g('wfc').querySelector('#wfc-new');
  assert.equal(nb.disabled, true);
  nb.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(s.dock.client.threadId(), T, 'the click handler stands down too');
  s.dock.pushFrame({ type: 'ask-done', threadId: T, messageId: M, seq: 2, text: 'Done.', blocks: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(nb.disabled, false);
  nb.click();
  assert.equal(s.dock.client.threadId(), null);
});

test('a pinned project that is gone falls back to Auto once the projects load; a live one stays; an unreadable list keeps the pin', async () => {
  const KEY = 'worca-cc.composer.scope';
  const pin = (projectKey, label) => { const m = memStore(); m.setItem(KEY, JSON.stringify({ pinned: true, projectKey, label })); return m; };
  const scopeText = (s) => s.g('wfc').querySelector('#wfc-scope').textContent.trim();
  const gone = pin('gone-0000abcd', 'gone');
  const a = await bootDock([], { storage: gone });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(scopeText(a), 'Auto');
  assert.deepEqual(JSON.parse(gone.getItem(KEY)), { pinned: false });
  const b = await bootDock([], { storage: pin('worca-1a2b3c4d', 'worca') });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(scopeText(b), 'worca');
  const c = await bootDock([], { storage: pin('gone-0000abcd', 'gone'), projects: async () => { throw new Error('offline'); } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(scopeText(c), 'gone');
});

test('a screen reader hears one line per card change and per finished reply; the rebuilt thread itself stays quiet', async () => {
  const s = await bootDock([['POST', /\/cards\//, () => [200, { block: {} }]]]);
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.g('wfc').querySelector('.wfc-thread').getAttribute('aria-live'), 'off', 'role=log alone would read the whole thread again');
  const sr = s.g('wfc').querySelector('.wfc-sr');
  assert.equal(sr.getAttribute('aria-live'), 'polite');
  const T = THREAD.id; const M = 'msg_0000bbbb';
  const edit = { kind: 'card', id: 'card_0000aaaa', state: 'proposed', card: { type: 'canvas-edit', sessionId: 'cs_ab12cd34', docToken: s.c.docToken(), summary: 'Add Plan',
    ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'planner', x: 385, y: 440 }] } };
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  s.dock.pushFrame({ type: 'ask-card', threadId: T, messageId: M, seq: 2, block: edit });
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.equal(sr.textContent, '', 'an edit still applying says nothing yet');
  s.dock.pushFrame({ type: 'ask-card', threadId: T, messageId: M, seq: 3, block: { ...edit, state: 'applied' } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sr.textContent, 'Changed the canvas: Add Plan');
  const build = { kind: 'card', id: 'card_0000eeee', state: 'proposed', card: { type: 'workflow-build', sessionId: 'cs_ab12cd34', docToken: s.c.docToken(), name: 'Bug fix',
    counts: {}, workflow: { nodes: [], wires: [] }, drafts: [], loops: [] } };
  s.dock.pushFrame({ type: 'ask-card', threadId: T, messageId: M, seq: 4, block: build });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sr.textContent, 'Proposed workflow: Bug fix', 'the applied edit is not said twice');
  s.dock.pushFrame({ type: 'ask-done', threadId: T, messageId: M, seq: 5, text: 'Done.', blocks: [{ ...edit, state: 'applied' }, build] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sr.textContent, 'Reply finished.');
});
test('a reopened thread is read silently: its old cards are not announced again', async () => {
  const storage = memStore();
  storage.setItem('worca-cc.composer.thread', THREAD.id);
  const old = { kind: 'card', id: 'card_0000aaaa', state: 'applied', card: { type: 'canvas-edit', sessionId: 'cs_00000000', docToken: 'd_00000000', summary: 'Add Plan', ops: [] } };
  const s = await bootDock([['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, { thread: THREAD,
    messages: [{ id: 'msg_0000bbbb', role: 'assistant', status: 'done', text: 'Added.', blocks: [old] }], attachments: [], runLinks: [], inFlight: null }]]], { storage });
  s.dock.focus();
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.ok(s.g('wfc').querySelector('[data-card-id="card_0000aaaa"]'), 'the thread loaded');
  assert.equal(s.g('wfc').querySelector('.wfc-sr').textContent, '');
});

test('a reader at the bottom follows the streaming text; one who scrolled up stays put', async () => {
  const s = await bootDock();
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Build it';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const thread = s.g('wfc').querySelector('.wfc-thread');
  let top = 0;
  const text = () => (s.g('wfc').querySelector('.wfc-text') || { textContent: '' }).textContent;
  Object.defineProperty(thread, 'scrollHeight', { configurable: true, get: () => 600 + 10 * text().length });   // each char adds 10 px
  Object.defineProperty(thread, 'clientHeight', { configurable: true, get: () => 200 });
  Object.defineProperty(thread, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v; } });
  const T = THREAD.id; const M = 'msg_0000bbbb';
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  await new Promise((r) => setTimeout(r, 0));
  const answer = s.g('wfc').querySelector('.wfc-text');
  top = 400;                                                // at the bottom: 600 - 400 - 200 = 0
  s.dock.pushFrame({ type: 'ask-delta', threadId: T, messageId: M, seq: 2, text: 'Hello ' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.g('wfc').querySelector('.wfc-text'), answer, 'the text-only path ran');
  assert.equal(top, 660, 'followed the six new characters');
  top = 100;                                                // scrolled up to read
  s.dock.pushFrame({ type: 'ask-delta', threadId: T, messageId: M, seq: 3, text: 'world' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(top, 100);
});

test('the dock fits the stage, and lifts the Auto-layout + zoom bars clear of itself whenever the two meet', async () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  const s = await bootDock([], (b) => {
    // 1280 x 900 with the Library open: the stage is 956 px wide; the bars sit at its right edge.
    const stage = b.g('wfv-stage');
    const cluster = b.doc.createElement('div');
    cluster.id = 'wfv-br';
    stage.appendChild(cluster);
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 956 });
    stage.getBoundingClientRect = () => rect(8, 8, 956, 884);
    Object.defineProperty(b.g('wfv-add'), 'offsetWidth', { configurable: true, value: 40 });
    cluster.getBoundingClientRect = () => rect(752, 838, 200, 40);
    const open = () => b.g('wfc').querySelector('.wfc-shell').dataset.open === 'true';
    b.g('wfc').getBoundingClientRect = () => (open() ? rect(220, 500, 580, 377) : rect(290, 837, 440, 40));
    return { stage, cluster, plus: b.g('wfv-add') };
  });
  const shell = s.g('wfc').querySelector('.wfc-shell');
  const cluster = s.g('wfv-br');
  assert.equal(shell.style.getPropertyValue('--wfc-avail'), '884px', '956 - 24 - (40 + 8)');
  assert.equal(cluster.classList.contains('is-up'), false, 'the 440 px pill clears them');
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(cluster.classList.contains('is-up'), true, 'the 580 px chat reaches under them');
  assert.equal(cluster.style.bottom, '404px', 'above the open chat: 892 - 500 + 12');
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(cluster.classList.contains('is-up'), false);
  assert.equal(cluster.style.bottom, '');
  Object.defineProperty(s.g('wfv-stage'), 'clientWidth', { configurable: true, value: 600 });
  s.win.dispatchEvent(new s.win.Event('resize'));
  assert.equal(shell.style.getPropertyValue('--wfc-avail'), '528px');
});

test('the input grows with its text only while open: empty or collapsed it keeps the CSS 30 px', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const input = root.querySelector('#wfc-input');
  let sh = 120;                                              // Chrome counts a wrapping placeholder in scrollHeight
  Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => sh });
  input.dispatchEvent(new s.win.Event('focus'));
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'true');
  assert.equal(input.style.height, '', 'open and empty: the CSS height');
  sh = 70;
  input.value = 'one\ntwo\nthree';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(input.style.height, '70px');
  sh = 300;
  input.value += '\nfour\nfive\nsix';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(input.style.height, '104px', 'capped');
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'false');
  assert.equal(input.style.height, '', 'collapsed: back to the one-line pill');
});

test('the dock\'s textarea opts out of the house textarea box (min-height 120px, focus fill and ring)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.wfc-input\{[^}]*min-height:30px;[^}]*max-height:104px;/);
  assert.match(css, /\.wfc-input:focus,\.wfc-input:focus-visible\{outline:none;background:transparent;\}/);
  assert.match(css, /\.wfc-shell:not\(\[data-open="true"\]\) \.wfc-input\{height:30px;overflow:hidden;white-space:nowrap;cursor:text;\}/);
  assert.match(css, /\.wfc-shell:focus-within\{border-color:var\(--line-2\);\}/);
});

test('a chat card button in flight (aria-disabled, never `disabled`) looks inactive', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.wfc :is\(\.wfv-btn,\.wfc-link\)\[aria-disabled="true"\]\{opacity:\.55;cursor:default;\}/);
});

test('the dock is the card controller\'s occluder: an edit landing under the open panel fits into the band above it', async () => {
  const s = await bootDock([['POST', /\/cards\//, () => [200, { block: {} }]]]);
  const fits = [];
  s.c.fit = (o) => fits.push(o || {});
  // The open panel sits over the stage's lower middle (stage 1280 × 720 at 0,0): x 300 → 800, y 380 → 720.
  s.g('wfc').querySelector('.wfc-shell').getBoundingClientRect = () => ({ left: 300, top: 380, width: 500, height: 340, right: 800, bottom: 720, x: 300, y: 380 });
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const T = THREAD.id; const M = 'msg_0000bbbb';
  const edit = { kind: 'card', id: 'card_0000aaaa', state: 'proposed', card: { type: 'canvas-edit', sessionId: 'cs_ab12cd34', docToken: s.c.docToken(), summary: 'Add Plan',
    ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'planner', x: 385, y: 440 }] } };
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  s.dock.pushFrame({ type: 'ask-card', threadId: T, messageId: M, seq: 2, block: edit });
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const v = s.c.view; const b = v.bounds(0, ['n_abcdefgh']);
  const a = v.toScreen(b.x, b.y); const z = v.toScreen(b.x + b.w, b.y + b.h);
  assert.ok(a.x >= 0 && a.y >= 0 && z.x <= 1280 && z.y <= 720 && a.x < 800 && z.x > 300 && z.y > 380, `on screen, under the panel: ${JSON.stringify([a, z])}`);
  assert.deepEqual(fits.map((o) => o.insetBottom), [356], 'fit into the band above the dock: 720 − 380 + 16');
});

/** Send one message and open its turn, then deliver `blocks` as cards and (unless `live`) end the turn. */
async function draftTurn(s, blocks, { live = false } = {}) {
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = 'Create an agent';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const T = THREAD.id; const M = 'msg_0000bbbb';
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  blocks.forEach((block, i) => s.dock.pushFrame({ type: 'ask-card', threadId: T, messageId: M, seq: 2 + i, block }));
  if (!live) s.dock.pushFrame({ type: 'ask-done', threadId: T, messageId: M, seq: 2 + blocks.length, text: 'Drafted.', blocks });
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
}
const agentDraft = (id, key, name, state = 'proposed', then = null) => ({ kind: 'card', id, state,
  card: { type: 'agent-draft', sessionId: 'cs_ab12cd34', docToken: 'd_ab12cd34', draft: { key, meta: { displayName: name, runnerType: 'producer', inputs: [], outputs: [] }, markdown: '# x' }, then } });

test('New chat asks first while the chat holds an unsaved draft: Cancel keeps the thread, its cards and the focus on New chat', async () => {
  const asked = [];
  let answer = false;
  // The modal takes the focus (confirmModal focuses its OK button) and restores none.
  const s = await bootDock([], { confirm: async (o) => { asked.push(o); s.doc.activeElement.blur(); return answer; } });
  await draftTurn(s, [agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes')]);
  const nb = s.g('wfc').querySelector('#wfc-new');
  nb.focus();
  nb.click();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked.map((o) => [o.title, o.message, o.confirmLabel, o.cancelLabel]), [['Start a new chat?',
    'This chat holds 1 unsaved draft (Release Notes). Start a new chat and leave it? This chat cannot be reopened.', 'Start new chat', 'Keep this chat']]);
  assert.equal(s.dock.client.threadId(), THREAD.id, 'Cancel keeps the thread');
  assert.ok(s.g('wfc').querySelector('[data-card-id="card_0000dddd"]'), '…and its cards');
  assert.equal(s.doc.activeElement, nb, 'the focus is back on New chat, never <body> (the canvas owns its keys)');
  answer = true;
  nb.click();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.dock.client.threadId(), null, 'confirmed: a new chat');
  assert.equal(s.g('wfc').querySelector('[data-card-id]'), null);
  assert.equal(s.doc.activeElement, s.g('wfc').querySelector('#wfc-input'));
});

test('the question names every unsaved draft; with none (saved or declined only) New chat starts at once', async () => {
  const asked = [];
  const a = await bootDock([], { confirm: async (o) => { asked.push(o.message); return false; } });
  await draftTurn(a, [agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes'), agentDraft('card_0000eeee', 'lintFixer', 'Lint Fixer')]);
  a.g('wfc').querySelector('#wfc-new').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ['This chat holds 2 unsaved drafts (Release Notes, Lint Fixer). Start a new chat and leave them? This chat cannot be reopened.']);
  const b = await bootDock([], { confirm: async (o) => { asked.push(o.message); return false; } });
  await draftTurn(b, [agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes', 'saved'), agentDraft('card_0000eeee', 'lintFixer', 'Lint Fixer', 'declined')]);
  b.g('wfc').querySelector('#wfc-new').click();
  assert.equal(b.dock.client.threadId(), null, 'nothing unsaved: no question');
  assert.equal(asked.length, 1);
});

test('a confirm that throws keeps the chat; a dock with no confirm (headless) goes ahead', async () => {
  const a = await bootDock([], { confirm: async () => { throw new Error('modal gone'); } });
  await draftTurn(a, [agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes')]);
  a.g('wfc').querySelector('#wfc-new').click();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(a.dock.client.threadId(), THREAD.id, 'losing the answer never loses the drafts');
  const b = await bootDock();
  await draftTurn(b, [agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes')]);
  b.g('wfc').querySelector('#wfc-new').click();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(b.dock.client.threadId(), null);
});

test('a reply that starts while the New chat question is open holds the chat: Start new chat then does nothing', async () => {
  let yes;
  const s = await bootDock([], { confirm: () => new Promise((r) => { yes = r; }) });
  await draftTurn(s, [agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes')]);
  s.g('wfc').querySelector('#wfc-new').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(typeof yes, 'function', 'New chat asked');
  s.dock.pushFrame({ type: 'ask-start', threadId: THREAD.id, messageId: 'msg_0000ffff', userMessageId: 'msg_0000eeee', seq: 4 });   // another tab sent
  await new Promise((r) => setTimeout(r, 0));
  yes(true);
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.dock.client.threadId(), THREAD.id, 'the running reply would keep spending, its edits never applied');
  assert.equal(s.doc.activeElement, s.g('wfc').querySelector('#wfc-input'), 'New chat is disabled now: the focus goes to the input');
});

test('a refused "Save & add" is said: the card and the live region tell why the saved draft is not on the canvas', async () => {
  const s = await bootDock([['POST', /\/cards\//, () => [200, { block: {} }]]], { actions: { saveAgentDraft: async (d) => ({ ok: true, key: d.key }), reloadRegistry: async () => {} } });
  s.c.applyOps = () => ({ ok: false, error: 'it would add an error: Release Notes needs an input' });
  const draft = agentDraft('card_0000dddd', 'releaseNotes', 'Release Notes', 'proposed', { ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'releaseNotes', x: 400, y: 200 }] });
  draft.card.docToken = s.c.docToken();
  await draftTurn(s, [draft], { live: true });
  [...s.g('wfc').querySelectorAll('button')].find((b) => b.textContent === 'Save & add to canvas').click();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(s.f.calls.filter((c) => /\/cards\//.test(c.url)).at(-1).body, { state: 'saved', card: { savedKey: 'releaseNotes' } }, 'saved all the same');
  s.dock.pushFrame({ type: 'ask-card', threadId: THREAD.id, messageId: 'msg_0000bbbb', seq: 3, block: { ...draft, state: 'saved' } });   // the server's flip
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.g('wfc').querySelector('.wfc-sr').textContent, 'Saved agent: Release Notes — not added to the canvas: it would add an error: Release Notes needs an input');
  assert.equal(s.g('wfc').querySelector('[data-card-id="card_0000dddd"] .wfc-err').textContent, 'Not added to the canvas — it would add an error: Release Notes needs an input');
});

test('a clicked Send or Stop never keeps the focus on a button the turn hides: Send hands it to Stop, Stop back to Send', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const input = root.querySelector('#wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  const send = root.querySelector('#wfc-send');
  const stop = root.querySelector('#wfc-stop');
  send.focus();                                             // Chrome focuses a clicked button
  send.click();
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  const T = THREAD.id; const M = 'msg_0000bbbb';
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(send.hidden, true, 'precondition: the live turn hid Send');
  // A hidden focused button drops the focus to <body> in Chrome, where the canvas takes the next Delete (the selected card).
  assert.equal(s.doc.activeElement, stop, 'the focus is on Stop');
  s.dock.pushFrame({ type: 'ask-done', threadId: T, messageId: M, seq: 2, text: 'Done.', blocks: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(stop.hidden, true, 'precondition: the finished turn hid Stop');
  assert.equal(s.doc.activeElement, send, 'and back on Send');
  // A focus elsewhere is never pulled to the buttons.
  input.focus();
  input.value = 'Again';
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: 'msg_0000dddd', userMessageId: 'msg_0000cccc', seq: 3 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.doc.activeElement, input, 'Enter in the input keeps the caret there');
});

test('another workflow opened while a draft\'s registry reload runs takes none of the draft\'s ops (Save & add, then Add to canvas)', async () => {
  const { createCardController } = await imp('chat-cards.mjs');
  const dom = new JSDOM('<!doctype html><body></body>');
  const composer = fakeComposer();
  const posts = [];
  const notes = [];
  const b = card('card_0000ffff', 'proposed', { type: 'agent-draft', draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes' }, markdown: '# x' },
    then: { ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'releaseNotes', x: 0, y: 0 }] } });
  const cc = createCardController({ doc: dom.window.document, composer, sessionId: 'cs_ab12cd34', blocks: () => [b],
    client: { postCard: async (id, body) => { posts.push(body); return { ok: true }; } },
    actions: { saveAgentDraft: async (d) => ({ ok: true, key: d.key }), notify: (o) => notes.push(o.title),
      reloadRegistry: async () => { composer.setTok('d_other001'); } } });   // the user opened another workflow meanwhile
  [...cc.render(b).querySelectorAll('button')].find((x) => x.textContent === 'Save & add to canvas').click();
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(composer.log, [], 'the other workflow takes no node');
  assert.deepEqual(posts.at(-1), { state: 'saved', card: { savedKey: 'releaseNotes' } }, 'saved all the same');
  assert.equal(cc.notAdded(b.id), 'another workflow was opened meanwhile');
  composer.setTok('d_ab12cd34');                                         // back on the draft's workflow: the saved card offers Add to canvas
  [...cc.render({ ...b, state: 'saved' }).querySelectorAll('button')].find((x) => x.textContent === 'Add to canvas').click();
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(composer.log, [], 'its reload switched documents again: nothing applied');
  assert.deepEqual(notes, ['Not added — another workflow was opened meanwhile.']);
  assert.equal(posts.length, 1, 'no "added" flip');
  dom.window.close();
});

// Review cycle 2 m6 / m7: a focused header control that turns disabled (New chat when a reply starts, from another tab)
// or hides (the @ chip once its card is no longer selected) drops the focus to <body> in Chrome, where the canvas owns
// Delete and the arrows. It goes to Minimize, the header's next control.
test('New chat losing its turn while focused, or the @ chip hiding while focused, hands the focus to Minimize', async () => {
  const s = await bootDock();
  await draftTurn(s, []);                                       // a thread exists, its turn has ended
  const nb = s.g('wfc').querySelector('#wfc-new');
  const min = s.g('wfc').querySelector('#wfc-min');
  assert.equal(nb.disabled, false, 'precondition: New chat is live');
  nb.focus();
  s.dock.pushFrame({ type: 'ask-start', threadId: THREAD.id, messageId: 'msg_0000ffff', userMessageId: 'msg_0000eeee', seq: 4 });   // another tab sent
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(nb.disabled, true);
  assert.equal(s.doc.activeElement, min, 'New chat turned disabled under the focus');
  s.dock.pushFrame({ type: 'ask-done', threadId: THREAD.id, messageId: 'msg_0000ffff', seq: 5, text: 'ok', blocks: [] });
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  s.dock.repaint();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  const chip = s.g('wfc').querySelector('.wfc-sel');
  assert.equal(chip.hidden, false, 'precondition: the @ chip shows the selected card');
  chip.focus();
  s.c.select(null);
  s.dock.repaint();
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(chip.hidden, true);
  assert.equal(s.doc.activeElement, min, 'the @ chip hid under the focus');
});

test('send() posts attachments only when there are some, and notes the user message with the 202\'s stored rows', async () => {
  const { createComposerChatClient } = await imp('chat-client.mjs');
  const f = fakeFetch([
    ['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] }]],
    ['POST', /\/api\/ask\/threads$/, () => [201, { thread: THREAD }]],
    ['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb',
      attachments: [{ id: 'att_00000001', name: 'flow.png', bytes: 4, kind: 'image', mime: 'image/png' }] }]],
  ]);
  const c = createComposerChatClient({ fetch: f.fn, storage: memStore() });
  const files = [{ name: 'flow.png', bytes: 4, dataBase64: 'iVBORw==', attKind: 'image', mime: 'image/png' }];
  assert.equal((await c.send('Build from this', { composer: CANVAS, attachments: files })).ok, true);
  const body = f.calls.find((x) => /\/messages$/.test(x.url)).body;
  assert.deepEqual(body.attachments, [{ name: 'flow.png', dataBase64: 'iVBORw==' }], 'only the name and the bytes go up');
  const user = c.model().messages().find((m) => m.role === 'user');
  assert.deepEqual(user.blocks, [{ kind: 'attachment', id: 'att_00000001', name: 'flow.png', bytes: 4, attKind: 'image', mime: 'image/png' }],
    'the store-minted id keys the thumbnail');
  assert.deepEqual(c.model().attachments().map((a) => a.id), ['att_00000001'], 'the thread ledger learns it (read_attachment lines name it)');
});

test('engine(): the chat\'s lock once it has a reply, else the engine of the model the next message takes; null without a catalog', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const cat = { default: { model: 'gpt-5.5', effort: 'low' }, defaults: { claude: { model: 'claude-opus-5-5', effort: 'high' } },
    models: [{ id: 'claude-opus-5-5' }, { id: 'gpt-5.5', engine: 'codex' }] };
  const fresh = createComposerChatClient({ fetch: fakeFetch([['GET', /\/api\/ask\/models$/, () => [200, cat]]]).fn, storage: memStore() });
  assert.equal(await fresh.engine(), 'codex', 'a fresh chat takes the default (a Codex model here)');
  const storage = memStore();
  storage.setItem(THREAD_KEY, THREAD.id);
  const snap = { thread: { ...THREAD, engine: 'claude' }, attachments: [], runLinks: [], inFlight: null, messages: [
    { id: 'msg_0000a001', threadId: THREAD.id, seq: 1, role: 'user', text: 'hi', blocks: [] },
    { id: 'msg_0000a002', threadId: THREAD.id, seq: 2, role: 'assistant', text: 'hello', blocks: [], status: 'done', model: 'claude-opus-5-5' }] };
  const locked = createComposerChatClient({ storage, fetch: fakeFetch([['GET', /\/api\/ask\/models$/, () => [200, cat]],
    ['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, snap]]]).fn });
  await locked.open();
  assert.equal(await locked.engine(), 'claude', 'the chat\'s lock wins over the Codex default');
  const offline = createComposerChatClient({ fetch: fakeFetch([]).fn, storage: memStore() });
  assert.equal(await offline.engine(), null, 'no catalog: no early refusal (the server still refuses a Codex PDF)');
});

test('engine(): the lock wins even when the catalog has no default for the locked engine (the next message still takes Ask\'s)', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  // No `defaults`: defaultPick() returns the Codex default, so only the chat's own lock can say Claude.
  const cat = { default: { model: 'gpt-5.5', effort: 'low' }, models: [{ id: 'claude-opus-5-5' }, { id: 'gpt-5.5', engine: 'codex' }] };
  const storage = memStore();
  storage.setItem(THREAD_KEY, THREAD.id);
  const snap = { thread: { ...THREAD, engine: 'claude' }, attachments: [], runLinks: [], inFlight: null, messages: [
    { id: 'msg_0000a001', threadId: THREAD.id, seq: 1, role: 'user', text: 'hi', blocks: [] },
    { id: 'msg_0000a002', threadId: THREAD.id, seq: 2, role: 'assistant', text: 'hello', blocks: [], status: 'done', model: 'claude-opus-5-5' }] };
  const locked = createComposerChatClient({ storage, fetch: fakeFetch([['GET', /\/api\/ask\/models$/, () => [200, cat]],
    ['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, snap]]]).fn });
  await locked.open();
  assert.equal(await locked.engine(), 'claude');
});

test('engine() reads a stored chat that is not loaded yet: a file dropped right after a page load meets its Codex lock', async () => {
  const { createComposerChatClient, THREAD_KEY } = await imp('chat-client.mjs');
  const cat = { default: { model: 'claude-opus-5-5', effort: 'high' }, models: [{ id: 'claude-opus-5-5' }, { id: 'gpt-5.5', engine: 'codex' }] };
  const storage = memStore();
  storage.setItem(THREAD_KEY, THREAD.id);
  const snap = { thread: { ...THREAD, engine: 'codex' }, attachments: [], runLinks: [], inFlight: null, messages: [
    { id: 'msg_0000a001', threadId: THREAD.id, seq: 1, role: 'user', text: 'hi', blocks: [] },
    { id: 'msg_0000a002', threadId: THREAD.id, seq: 2, role: 'assistant', text: 'hello', blocks: [], status: 'done', model: 'gpt-5.5' }] };
  const c = createComposerChatClient({ storage, fetch: fakeFetch([['GET', /\/api\/ask\/models$/, () => [200, cat]],
    ['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, snap]]]).fn });
  // No open(): the dock's expand() starts it without waiting, so the drop's engine() may run first.
  assert.equal(await c.engine(), 'codex', 'not Ask\'s Claude default');
});

test('the paperclip opens the picker and the chat; picked files become chips (an image gets a thumbnail); × keeps the focus in the dock', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const fileInput = root.querySelector('input[type="file"]');
  let opened = 0;
  fileInput.click = () => { opened += 1; };
  root.querySelector('#wfc-attach').click();
  assert.equal(opened, 1, 'the paperclip opens the file picker');
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'true', 'and the chat, where the chips show');
  // jsdom's `files` override leaves the element's own list empty, so `value` reads '' whatever the code does: spy the setter.
  const valueSets = [];
  const value = Object.getOwnPropertyDescriptor(s.win.HTMLInputElement.prototype, 'value');
  Object.defineProperty(fileInput, 'value', { configurable: true, get() { return value.get.call(this); },
    set(v) { valueSets.push(v); value.set.call(this, v); } });
  pickFiles(s, [mkFile(s, 'spec.md', '# Spec', 'text/markdown'), pngFile(s), mkFile(s, 'notes.txt', 'n')]);
  assert.deepEqual(valueSets, [''], 'the picker is reset, so the same file can be picked again');
  await settle();
  assert.deepEqual(chipNames(root), ['spec.md', 'flow.png', 'notes.txt']);
  assert.equal(root.querySelector('.wfc-files').hidden, false);
  assert.equal(root.querySelectorAll('.wfc-file-thumb').length, 1, 'only the image has a thumbnail');
  assert.equal(root.querySelector('.wfc-file-thumb').getAttribute('src'), 'data:image/png;base64,iVBORw==');
  assert.equal(root.querySelector('#wfc-attach').dataset.count, '3');
  assert.equal(root.querySelector('.wfc-file-x').getAttribute('aria-label'), 'Remove spec.md');
  // × removes one; the focus goes to the × now in its place, then the one before, then the input — never <body>,
  // where the canvas owns Backspace and Delete.
  const xs = () => [...root.querySelectorAll('.wfc-file-x')];
  xs()[1].focus();
  xs()[1].click();
  assert.deepEqual(chipNames(root), ['spec.md', 'notes.txt']);
  assert.equal(s.doc.activeElement, xs()[1], 'the × of the chip that took its place');
  xs()[1].click();
  assert.equal(s.doc.activeElement, xs()[0], 'the last chip gone: the × before it');
  xs()[0].click();
  assert.deepEqual(chipNames(root), []);
  assert.equal(s.doc.activeElement, root.querySelector('#wfc-input'), 'no chip left: the input');
  assert.equal(root.querySelector('.wfc-files').hidden, true);
  assert.equal(root.querySelector('#wfc-attach').dataset.count, undefined);
});

test('the picker closing (a choice or Cancel) never leaves the focus on <body>', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const fileInput = root.querySelector('input[type="file"]');
  if (s.doc.activeElement && s.doc.activeElement !== s.doc.body) s.doc.activeElement.blur();
  assert.equal(root.contains(s.doc.activeElement), false, 'nothing in the dock holds the focus');
  fileInput.dispatchEvent(new s.win.Event('cancel'));
  assert.equal(s.doc.activeElement, root.querySelector('#wfc-attach'), 'Cancel: back on the paperclip');
  root.querySelector('#wfc-attach').blur();
  pickFiles(s, [mkFile(s, 'spec.md', '# Spec')]);
  assert.equal(s.doc.activeElement, root.querySelector('#wfc-attach'), 'a choice: back on the paperclip');
  await settle();
});

test('Enter sends the chips as base64 with the text; a refused send keeps them, a 202 clears them and the message shows its files', async () => {
  let status = 413;
  const f = fetchWith([['POST', /\/messages$/, () => (status === 202 ? [202, { userMessageId: 'msg_0000aaaa' }] : [413, { error: 'attachments over 50331648 bytes per message' }])]]);
  const s = await bootDock([], { fetch: f.fn });
  const root = s.g('wfc');
  const input = root.querySelector('#wfc-input');
  input.dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'spec.md', '# Spec', 'text/markdown'), pngFile(s)]);
  await settle();
  const enter = async (text) => {
    input.value = text;
    input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
    input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
  };
  await enter('Build a workflow from this spec');
  const sent = () => f.calls.filter((c) => /\/messages$/.test(c.url));
  assert.deepEqual(sent()[0].body.attachments, [
    { name: 'spec.md', dataBase64: Buffer.from('# Spec').toString('base64') },
    { name: 'flow.png', dataBase64: 'iVBORw==' },
  ]);
  assert.deepEqual(chipNames(root), ['spec.md', 'flow.png'], 'refused: the chips stay for the retry');
  assert.equal(root.querySelector('.wfc-err').textContent, 'attachments over 50331648 bytes per message');
  status = 202;
  await enter('Build a workflow from this spec');
  assert.equal(sent().length, 2);
  assert.deepEqual(chipNames(root), [], 'sent: the chips clear');
  assert.equal(input.value, '');
  assert.deepEqual([...root.querySelectorAll('.wfc-uatts > *')].map((p) => [p.className, p.textContent]),
    [['wfc-upill', 'spec.md'], ['wfc-upill', 'flow.png']], 'this stub 202 returns no rows: the echo has no ids, so the image is a name pill');
});

test('Ask\'s early checks and messages in the dock: type, 512 KB text, 8 files; a Codex chat refuses PDFs', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const note = () => root.querySelector('.wfc-note');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'evil.exe', 'x')]);
  await settle();
  assert.equal(note().textContent, 'attachment type not allowed: evil.exe');
  assert.equal(note().hidden, false);
  assert.match(root.querySelector('.wfc-sr').textContent, /attachment type not allowed: evil\.exe/, 'said once to a screen reader');
  pickFiles(s, [mkFile(s, 'big.md', 'x'.repeat(524_289))]);
  await settle();
  assert.equal(note().textContent, 'attachment over 524288 bytes: big.md');
  pickFiles(s, [mkFile(s, 'spec.pdf', '%PDF-1.7', 'application/pdf')]);
  await settle();
  assert.deepEqual(chipNames(root), ['spec.pdf'], 'a Claude chat takes a PDF');
  assert.equal(note().hidden, true, 'a new batch clears the last refusal');
  pickFiles(s, Array.from({ length: 9 }, (_, i) => mkFile(s, `f${i}.md`, 'x')));
  await settle();
  assert.equal(chipNames(root).length, 8);
  assert.equal(note().textContent, 'at most 8 attachments per message');

  const f = fetchWith([['GET', /\/api\/ask\/models$/, () => [200, { default: { model: 'gpt-5.5', effort: 'low' }, models: [{ id: 'gpt-5.5', engine: 'codex' }] }]]]);
  const c = await bootDock([], { fetch: f.fn });
  const croot = c.g('wfc');
  croot.querySelector('#wfc-input').dispatchEvent(new c.win.Event('focus'));
  pickFiles(c, [mkFile(c, 'spec.pdf', '%PDF-1.7', 'application/pdf'), pngFile(c)]);
  await settle();
  assert.equal(croot.querySelector('.wfc-note').textContent, 'PDFs need a Claude chat: spec.pdf');
  assert.deepEqual(chipNames(croot), ['flow.png'], 'an image still attaches on Codex');
});

test('files dropped on the dock attach (an overlay while they hover); a Library card drag over it is left alone', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const shell = root.querySelector('.wfc-shell');
  const overlay = root.querySelector('.wfc-drop');
  const input = root.querySelector('#wfc-input');
  assert.equal(overlay.hidden, true);
  const dt = { types: ['Files'], files: [mkFile(s, 'spec.md', '# Spec')], dropEffect: '' };
  assert.equal(fireDrag(s, shell, 'dragenter', dt).defaultPrevented, true);
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.textContent, 'Drop files to attach');
  fireDrag(s, input, 'dragenter', dt);                    // entering a child lands before leaving its parent
  fireDrag(s, shell, 'dragleave', dt);
  assert.equal(overlay.hidden, false, 'still over the dock');
  const over = fireDrag(s, input, 'dragover', dt);
  assert.equal(over.defaultPrevented, true);
  assert.equal(dt.dropEffect, 'copy');
  if (s.doc.activeElement && s.doc.activeElement !== s.doc.body) s.doc.activeElement.blur();
  assert.equal(root.contains(s.doc.activeElement), false, 'the focus is outside the dock before the drop');
  const drop = fireDrag(s, input, 'drop', dt);
  assert.equal(drop.defaultPrevented, true, 'the browser never opens the file');
  assert.equal(overlay.hidden, true);
  assert.equal(shell.dataset.open, 'true', 'the chat opens to show the chips');
  assert.equal(s.doc.activeElement, input, 'the focus lands in the chat, never <body>');
  await settle();
  assert.deepEqual(chipNames(root), ['spec.md']);
  const card = { types: ['application/x-worca', 'text/plain'], files: [], dropEffect: '', getData: () => '' };
  for (const type of ['dragenter', 'dragover', 'drop']) assert.equal(fireDrag(s, shell, type, card).defaultPrevented, false, type);
  assert.equal(overlay.hidden, true);
  assert.deepEqual(chipNames(root), ['spec.md']);
});

test('a pasted screenshot attaches under a unique name; a copy carrying text plus its rendered image stays a text paste', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const input = root.querySelector('#wfc-input');
  input.dispatchEvent(new s.win.Event('focus'));
  assert.equal(firePaste(s, input, { types: ['Files'], files: [pngFile(s, 'image.png')], getData: () => '' }).defaultPrevented, true);
  firePaste(s, input, { types: ['Files'], files: [pngFile(s, 'image.png')], getData: () => '' });
  await settle();
  const names = chipNames(root);
  assert.equal(names.length, 2, 'two screenshots, two chips (no name clash)');
  for (const n of names) assert.match(n, /^pasted-\d+\.png$/);
  const excel = firePaste(s, input, { types: ['text/plain', 'Files'], files: [pngFile(s, 'image.png')], getData: (t) => (t === 'text/plain' ? 'A1\tB1' : '') });
  assert.equal(excel.defaultPrevented, false, 'Excel/Word copies: the text is what was meant');
  assert.equal(firePaste(s, input, { types: ['text/plain'], files: [], getData: () => 'hello' }).defaultPrevented, false);
  await settle();
  assert.equal(chipNames(root).length, 2);
});

test('a sent message shows its files: a name pill, an image thumbnail linking the download route; read_attachment names the file', async () => {
  const storage = memStore();
  storage.setItem('worca-cc.composer.thread', THREAD.id);
  const atts = [{ id: 'att_00000001', name: 'spec.md', bytes: 6, kind: 'text', mime: 'text/markdown' },
    { id: 'att_00000002', name: 'flow.png', bytes: 4, kind: 'image', mime: 'image/png' }];
  const snap = { thread: THREAD, attachments: atts, runLinks: [], inFlight: null, messages: [
    { id: 'msg_0000a001', threadId: THREAD.id, seq: 1, role: 'user', text: 'Build it from these', status: null,
      blocks: atts.map((a) => ({ kind: 'attachment', id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind, mime: a.mime })) },
    { id: 'msg_0000a002', threadId: THREAD.id, seq: 2, role: 'assistant', text: 'Built it.', status: 'done',
      blocks: [{ kind: 'tool', id: 'toolu_01', name: 'mcp__worca__read_attachment', input: { id: 'att_00000001' }, status: 'done' }] },
  ] };
  const s = await bootDock([['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, snap]]], { storage });
  s.dock.focus();
  await settle();
  const root = s.g('wfc');
  const bubble = root.querySelector('.wfc-u');
  assert.equal(bubble.textContent, 'Build it from these', 'the bubble keeps its text only');
  const row = root.querySelector('.wfc-uatts');
  assert.equal(row.previousElementSibling, bubble, 'under the message they came with');
  assert.equal(row.querySelector('.wfc-upill').textContent, 'spec.md');
  const link = row.querySelector('a.wfc-uthumb-link');
  assert.equal(link.getAttribute('href'), '/api/ask/threads/ask_0000abcd/attachments/att_00000002');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener');
  const img = link.querySelector('img.wfc-uthumb');
  assert.equal(img.getAttribute('src'), link.getAttribute('href'));
  assert.equal(img.alt, 'flow.png');
  assert.equal(root.querySelector('.wfc-tool .mono').textContent, 'read attachment spec.md');
  s.dock.repaint();
  await settle();
  assert.equal(root.querySelector('a.wfc-uthumb-link'), link, 'a repaint reuses the row: the thumbnail is not reloaded');
});

test('pending files survive collapsing (the paperclip shows their count) and clear on New chat', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  const input = root.querySelector('#wfc-input');
  input.dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'spec.md', '# Spec')]);
  await settle();
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'false');
  assert.deepEqual(chipNames(root), ['spec.md'], 'collapsing keeps them');
  assert.equal(root.querySelector('#wfc-attach').dataset.count, '1');
  assert.equal(root.querySelector('#wfc-attach').title, 'Attach files (1 attached)');
  s.dock.focus();
  root.querySelector('#wfc-new').click();
  await settle();
  assert.deepEqual(chipNames(root), []);
  assert.equal(root.querySelector('.wfc-files').hidden, true);
  assert.equal(root.querySelector('#wfc-attach').dataset.count, undefined);
  assert.equal(s.doc.activeElement, input);
});

test('the chips make the open chat taller: the bars above it re-lift at once', async () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  const s = await bootDock([], (b) => {
    const stage = b.g('wfv-stage');
    const cluster = b.doc.createElement('div');
    cluster.id = 'wfv-br';
    stage.appendChild(cluster);
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 956 });
    stage.getBoundingClientRect = () => rect(8, 8, 956, 884);
    cluster.getBoundingClientRect = () => rect(752, 838, 200, 40);
    // 34 px taller with a row of chips. jsdom has no layout and no ResizeObserver: only the dock's own place() re-lifts.
    const chips = () => b.g('wfc').querySelector('.wfc-files');
    b.g('wfc').getBoundingClientRect = () => (chips() && !chips().hidden ? rect(220, 466, 580, 411) : rect(220, 500, 580, 377));
    return { stage, cluster, plus: b.g('wfv-add') };
  });
  const cluster = s.g('wfv-br');
  s.g('wfc').querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  assert.equal(cluster.style.bottom, '404px', '892 - 500 + 12');
  pickFiles(s, [mkFile(s, 'spec.md', '# Spec')]);
  await settle();
  assert.equal(cluster.style.bottom, '438px', 'above the chips: 892 - 466 + 12');
  s.g('wfc').querySelector('.wfc-file-x').click();
  assert.equal(cluster.style.bottom, '404px');
});

test('the attachment UI restates what the house rules would change (focus rings, the drop overlay, collapsed chips)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.wfc-drop\{[^}]*position:absolute;[^}]*pointer-events:none;/);
  assert.match(css, /\.wfc-shell:not\(\[data-open="true"\]\) :is\(\.wfc-files,\.wfc-note\)\{display:none;\}/);
  assert.match(css, /\.wfc-file-x:focus-visible\{outline:2px solid var\(--ink\);outline-offset:-2px;\}/);
  assert.match(css, /\.wfc-file\{[^}]*flex:none;/);
  assert.match(css, /\.wfc-uthumb-link:focus-visible\{outline:2px solid var\(--ink\);outline-offset:2px;\}/);
  // A name pill beside a 110 px thumbnail: the flex default (stretch) draws it as a tall oval with its name cut.
  assert.match(css, /\.wfc-uatts\{[^}]*align-items:flex-end;/);
});

// A read that waits for a gate: jsdom reads a real File within a few promise hops, so the races the dock guards (an Enter
// while a screenshot is still being read, two batches at once, a × mid-read, a file added while the POST is out) only
// show with a read held open.
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const slowFile = (name, text, g) => ({ name, size: Buffer.byteLength(text), type: 'text/plain',
  arrayBuffer: async () => { await g.p; return new Uint8Array(Buffer.from(text)).buffer; } });
function typeEnter(s, text) {
  const input = s.g('wfc').querySelector('#wfc-input');
  input.value = text;
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  input.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
const posts = (f) => f.calls.filter((c) => /\/messages$/.test(c.url));

test('Enter while a file is still being read waits for it: the file rides THIS message, and a second Enter is ignored', async () => {
  const g = gate();
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [slowFile('spec.md', '# S', g)]);
  await settle(2);
  typeEnter(s, 'Build it');
  await settle(2);
  assert.equal(posts(s.f).length, 0, 'nothing goes up while the file is read');
  typeEnter(s, 'Build it');
  await settle(2);
  g.open();
  await settle(16);
  assert.equal(posts(s.f).length, 1, 'one message');
  assert.deepEqual(posts(s.f)[0].body.attachments, [{ name: 'spec.md', dataBase64: Buffer.from('# S').toString('base64') }]);
  assert.equal(root.querySelector('.wfc-err'), null, 'the second Enter never reached the client ("already on its way")');
  assert.deepEqual(chipNames(root), [], 'sent: the chip clears');
});

test('Send clears the last refusal note', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'evil.exe', 'x')]);
  await settle();
  assert.equal(root.querySelector('.wfc-note').hidden, false);
  typeEnter(s, 'Hello');
  await settle();
  assert.equal(posts(s.f).length, 1);
  assert.equal(root.querySelector('.wfc-note').hidden, true);
  assert.equal(root.querySelector('.wfc-note').textContent, '');
});

test('a × pressed while another file is read stays pressed', async () => {
  const g = gate();
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'x.md', 'x')]);
  await settle();
  assert.deepEqual(chipNames(root), ['x.md']);
  pickFiles(s, [slowFile('y.md', 'y', g)]);
  await settle(4);
  root.querySelector('.wfc-file-x').click();
  assert.deepEqual(chipNames(root), []);
  g.open();
  await settle(16);
  assert.deepEqual(chipNames(root), ['y.md'], 'x.md is not brought back by the read landing');
});

test('two batches at once never overshoot the 8-file cap: the second waits for the first', async () => {
  const g = gate();
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [slowFile('slow.md', 'a', g)]);
  pickFiles(s, Array.from({ length: 8 }, (_, i) => mkFile(s, `f${i}.md`, 'x')));
  await settle(16);
  assert.deepEqual(chipNames(root), [], 'the second batch is not read before the first one ends');
  g.open();
  await settle(24);
  assert.deepEqual(chipNames(root), ['slow.md', 'f0.md', 'f1.md', 'f2.md', 'f3.md', 'f4.md', 'f5.md', 'f6.md']);
  assert.equal(root.querySelector('.wfc-note').textContent, 'at most 8 attachments per message');
});

test('an unreadable file is noted; the rest of its batch still attaches', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  const gone = { name: 'bad.md', size: 1, type: 'text/plain', arrayBuffer: async () => { throw new Error('gone'); } };
  pickFiles(s, [gone, mkFile(s, 'good.md', 'g')]);
  await settle();
  assert.deepEqual(chipNames(root), ['good.md']);
  assert.equal(root.querySelector('.wfc-note').textContent, 'could not read bad.md');
});

test('a file attached while the message is on its way stays for the next one; a focused × keeps the focus through the 202', async () => {
  const g = gate();
  const f = fetchWith([]);
  const held = async (url, opts = {}) => { if (opts.method === 'POST' && /\/messages$/.test(url)) await g.p; return f.fn(url, opts); };
  const s = await bootDock([], { fetch: held });
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'a.md', 'a')]);
  await settle();
  typeEnter(s, 'Go');
  await settle();
  pickFiles(s, [mkFile(s, 'b.md', 'b'), mkFile(s, 'c.md', 'c')]);
  await settle();
  assert.deepEqual(chipNames(root), ['a.md', 'b.md', 'c.md']);
  root.querySelectorAll('.wfc-file-x')[1].focus();
  g.open();
  await settle(16);
  assert.deepEqual(posts(f)[0].body.attachments.map((a) => a.name), ['a.md']);
  assert.deepEqual(chipNames(root), ['b.md', 'c.md'], 'only the files sent clear');
  assert.equal(s.doc.activeElement && s.doc.activeElement.getAttribute('aria-label'), 'Remove b.md',
    'the chips were rebuilt under the focus: it stays on b.md\'s ×, never <body>');
});

test('a read landing rebuilds the chips under a focused ×: the focus stays on that ×, never <body>', async () => {
  const g = gate();
  const s = await bootDock();
  const root = s.g('wfc');
  root.querySelector('#wfc-input').dispatchEvent(new s.win.Event('focus'));
  pickFiles(s, [mkFile(s, 'a.md', 'a'), mkFile(s, 'b.md', 'b')]);
  await settle();
  pickFiles(s, [slowFile('big.md', 'x', g)]);
  await settle(4);
  const first = root.querySelector('.wfc-file-x');
  first.focus();
  first.click();
  assert.equal(s.doc.activeElement.getAttribute('aria-label'), 'Remove b.md', 'the × now in its place');
  g.open();
  await settle(16);
  assert.deepEqual(chipNames(root), ['b.md', 'big.md']);
  assert.equal(s.doc.activeElement && s.doc.activeElement.getAttribute('aria-label'), 'Remove b.md');
});

test('turnPhase / activityLabel: what the orb and the live line say', async () => {
  const { turnPhase, activityLabel } = await imp('chat-dock.mjs');
  const tool = (status) => ({ kind: 'tool', id: 'toolu_01', name: 'mcp__worca__get_canvas', status });
  assert.equal(turnPhase(null, []), 'rest', 'no live turn');
  assert.equal(turnPhase({ label: 'Thinking', text: '' }, []), 'think');
  assert.equal(turnPhase({ label: 'Reading the canvas', text: '' }, [tool('running')]), 'tool');
  assert.equal(turnPhase({ label: 'Running 1 sub-agent', text: '' }, [{ kind: 'agent', id: 'toolu_02', status: 'running' }]), 'tool', 'a sub-agent counts');
  assert.equal(turnPhase({ label: 'Reading the canvas', text: 'Let me look.' }, [tool('done')]), 'think', 'tool done: thinking again, whatever text came before');
  assert.equal(turnPhase({ label: 'Writing', text: 'Added.' }, [tool('done')]), 'write');
  assert.equal(turnPhase({ label: 'Thinking', text: 'Sure' }, []), 'write', 'no tool ran: streaming text is writing');
  assert.equal(turnPhase({ label: 'Thinking', text: '' }, [{ kind: 'card', id: 'card_0000aaaa' }]), 'think', 'a card is not a tool');
  assert.equal(activityLabel(null), 'Thinking…');
  assert.equal(activityLabel('Reading the canvas'), 'Reading the canvas…');
  assert.equal(activityLabel('Done…'), 'Done…', 'never two ellipses');
});

test('the input-row orb: thinking from the send, a tool sweeps it, writing spins it, done stills it — collapsed too; no timer', async () => {
  const g = gate();
  const f = fetchWith([['POST', /\/messages$/, () => [202, { userMessageId: 'msg_0000aaaa', assistantMessageId: 'msg_0000bbbb' }]]]);
  const held = async (url, opts = {}) => { if (opts.method === 'POST' && /\/messages$/.test(url)) await g.p; return f.fn(url, opts); };
  const s = await bootDock([], { fetch: held });
  const root = s.g('wfc');
  const orb = root.querySelector('.wfc-row .wfc-spark .wfc-orb');
  const act = () => { const l = root.querySelector('.wfc-act-l'); return l ? l.textContent : null; };
  assert.equal(orb.dataset.phase, 'rest', 'idle: still');
  typeEnter(s, 'Add Plan');
  await settle();
  assert.ok(root.querySelector('.wfc-a.is-wait'), 'the POST is out: the reply\'s place shows already');
  assert.deepEqual([orb.dataset.phase, act()], ['think', 'Thinking…']);
  assert.equal(root.querySelector('.wfc-act').textContent, 'Thinking…', 'the line is the label alone: no timer');
  g.open();
  await settle();
  assert.ok(root.querySelector('.wfc-a.is-wait'), '202 in, no frame yet: still waiting');
  assert.equal(orb.dataset.phase, 'think');
  const T = THREAD.id; const M = 'msg_0000bbbb';
  s.dock.pushFrame({ type: 'ask-start', threadId: T, messageId: M, userMessageId: 'msg_0000aaaa', seq: 1 });
  await settle(2);
  assert.equal(root.querySelector('.wfc-a.is-wait'), null);
  assert.equal(root.querySelector('.wfc-thread canvas'), null, 'the thread carries no orbs');
  s.dock.pushFrame({ type: 'ask-label', threadId: T, messageId: M, seq: 2, label: 'Reading the canvas' });
  s.dock.pushFrame({ type: 'ask-block', threadId: T, messageId: M, seq: 3, block: { kind: 'tool', id: 'toolu_01', name: 'mcp__worca__get_canvas', input: {}, status: 'running' } });
  await settle(2);
  assert.deepEqual([orb.dataset.phase, act()], ['tool', 'Reading the canvas…']);
  assert.equal(root.querySelector('.wfc-a').firstElementChild.className, 'wfc-act', 'the live line leads the reply');
  s.dock.pushFrame({ type: 'ask-block', threadId: T, messageId: M, seq: 4, block: { kind: 'tool', id: 'toolu_01', name: 'mcp__worca__get_canvas', input: {}, status: 'done' } });
  await settle(2);
  assert.equal(orb.dataset.phase, 'think', 'the tool is back: thinking again');
  s.dock.pushFrame({ type: 'ask-label', threadId: T, messageId: M, seq: 5, label: 'Writing' });
  s.dock.pushFrame({ type: 'ask-delta', threadId: T, messageId: M, seq: 6, text: 'Added.' });
  await settle(2);
  assert.deepEqual([orb.dataset.phase, act()], ['write', 'Writing…']);
  s.dock.collapse();
  await settle(2);
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'false');
  assert.equal(root.querySelector('.wfc-row .wfc-orb'), orb, 'collapsed, the same orb stays in the pill');
  assert.equal(orb.dataset.phase, 'write', 'and keeps moving');
  s.dock.pushFrame({ type: 'ask-done', threadId: T, messageId: M, seq: 7, text: 'Added.', blocks: [{ kind: 'tool', id: 'toolu_01', name: 'mcp__worca__get_canvas', input: {}, status: 'done' }] });
  await settle(2);
  assert.deepEqual([orb.dataset.phase, act()], ['rest', null], 'done: still, and no live line');
});

test('once the chat has a message the hint says "Reply" and stops rotating; New chat brings the examples back', async () => {
  const { PLACEHOLDERS } = await imp('chat-dock.mjs');
  let rotate = null;                                               // the dock's 4.2 s placeholder tick, run by hand
  const s = await bootDock([], (b) => { const real = b.win.setInterval.bind(b.win); b.win.setInterval = (fn, ms) => { if (ms === 4200) rotate = fn; return real(() => {}, 1e9); }; return {}; });
  const root = s.g('wfc');
  const input = root.querySelector('#wfc-input');
  assert.equal(input.placeholder, PLACEHOLDERS[0]);
  rotate();
  assert.equal(input.placeholder, PLACEHOLDERS[1], 'an empty chat rotates its examples');
  typeEnter(s, 'Add Plan');
  await settle();
  assert.equal(input.placeholder, 'Reply');
  s.dock.collapse();
  rotate();
  assert.equal(input.placeholder, 'Reply', 'the rotation leaves a chat with messages alone');
  s.dock.focus();
  root.querySelector('#wfc-new').click();
  await settle(2);
  assert.equal(input.placeholder, PLACEHOLDERS[1], 'an example again');
});

test('a reopened thread: the hint is "Reply", the orb is still, no live line', async () => {
  const storage = memStore();
  storage.setItem('worca-cc.composer.thread', THREAD.id);
  const s = await bootDock([['GET', /\/api\/ask\/threads\/ask_0000abcd$/, () => [200, { thread: THREAD, messages: [
    { id: 'msg_0000aaaa', role: 'user', status: 'done', text: 'Add Plan', blocks: [] },
    { id: 'msg_0000bbbb', role: 'assistant', status: 'done', text: 'Added.', blocks: [] },
  ], attachments: [], runLinks: [], inFlight: null }]]], { storage });
  s.dock.focus();
  await settle();
  const root = s.g('wfc');
  assert.equal(root.querySelector('.wfc-row .wfc-orb').dataset.phase, 'rest');
  assert.equal(root.querySelector('.wfc-act'), null);
  assert.equal(root.querySelector('#wfc-input').placeholder, 'Reply');
});
