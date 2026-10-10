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

test('collapsed pill: sparkle, one-line input with a rotating example, scope "Auto", send — no attach', async () => {
  const s = await bootDock();
  const root = s.g('wfc');
  assert.equal(root.querySelector('.wfc-shell').dataset.open, 'false');
  assert.ok(root.querySelector('.wfc-spark svg'));
  assert.equal(root.querySelector('#wfc-input').placeholder, 'Add a security review after Implementation…');
  assert.equal(root.querySelector('#wfc-scope').textContent.trim(), 'Auto');
  assert.equal(root.querySelector('[aria-label="Attach files"], input[type="file"]'), null);
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
