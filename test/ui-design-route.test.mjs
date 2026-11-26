// test/ui-design-route.test.mjs — app.js wiring of the Design page: flag gate, nav row, live count, parts.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { createDesignLive } from '../ui/public/design/view.mjs';

const trackDom = useDomRelease(afterEach);
// boot() points globalThis.fetch at the test window's fake; put Node's own back after each test.
const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
afterEach(() => {
  if (realFetch) Object.defineProperty(globalThis, 'fetch', realFetch);
  else delete globalThis.fetch;
});
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public');
const html = readIndexHtml();
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const hidden = (doc, view) => doc.querySelector(`section.view[data-view="${view}"]`).classList.contains('hidden');

// A local copy of test/requirements-app.test.mjs's boot: GET /api/design answers [], and `extra` rides the hello frame.
// `answer(url, init)` answers a request before the defaults (a reply, or nothing); `sent` holds every socket send and
// `calls` every request. `raf` gives the window animation frames on its own timers (the stage paints per frame).
// `hooks` becomes window.__worcaTestHooks before app.js loads (askMarkdown: the page's markdown loader).
async function boot(flags, extra = {}, { answer = null, raf = false, hooks = null } = {}) {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  if (hooks) window.__worcaTestHooks = hooks;
  if (raf) {
    window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(window.performance.now()), 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  let ws = null;
  const sent = [];
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; ws = this; }
    send(d) { sent.push(JSON.parse(d)); } close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  const urls = [];
  const calls = [];
  window.fetch = (u, init = {}) => {
    urls.push(String(u));
    calls.push({ url: String(u), method: String(init.method ?? 'GET').toUpperCase() });
    const own = answer?.(String(u), init);
    if (own) return Promise.resolve(own);
    const body = String(u).includes('/api/requirements') ? { features: [] }
      : String(u).includes('/api/design') ? []
        : { config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [], pipelines: 0, workspaces: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(join(root, 'app.js')).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  ws._l.open?.forEach((fn) => fn());
  const recv = (obj) => ws._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  recv({ type: 'hello', bootId: 'b', runs: [], flags, ...extra });
  await settle();
  return { window, doc: window.document, recv, urls, calls, sent };
}

test('flag off: a deep link lands on Chat', async () => {
  const { window, doc } = await boot({ design: false });
  window.location.hash = 'design/d_000000000001';
  await settle();
  assert.equal(hidden(doc, 'design'), true);
  assert.equal(hidden(doc, 'chat'), false);
});
test('Design sits directly under Chat, Simple level, behind its flag, with a hidden grey count', () => {
  const doc = new JSDOM(readIndexHtml()).window.document;
  const row = doc.querySelector('.nav > button[data-nav="design"]');
  assert.equal(row.previousElementSibling.dataset.nav, 'chat');
  assert.equal(row.nextElementSibling.dataset.nav, 'runs');
  assert.deepEqual([row.dataset.minLevel, row.dataset.flag, row.hasAttribute('data-flag-chip')], ['simple', 'design', true]);
  const n = row.querySelector('#nav-design-count');
  assert.deepEqual([n.className, n.hidden], ['nav-count n-grey', true]);
  assert.equal(doc.querySelectorAll('section.view[data-view="design"] #design-host').length, 1);
});
test('the grey count: hello sets it, design-build moves it, zero hides it, the name says it', async () => {
  const { doc, recv } = await boot({ design: true }, { design: [{ designId: 'd_a', buildId: 'b_a', title: 'A', status: 'building', waiting: 0 }] });
  const n = doc.getElementById('nav-design-count');
  const row = doc.querySelector('.nav button[data-nav="design"]');
  assert.deepEqual([n.textContent, n.hidden, row.getAttribute('aria-label')], ['1', false, 'Design: 1 live']);
  recv({ type: 'design-build', designId: 'd_b', buildId: 'b_b', seq: 1, ts: 1, status: 'planning', stats: {} });
  assert.equal(n.textContent, '2');
  recv({ type: 'design-build', designId: 'd_a', buildId: 'b_a', seq: 2, ts: 1, status: 'done', stats: {} });
  recv({ type: 'design-build', designId: 'd_b', buildId: 'b_b', seq: 2, ts: 1, status: 'paused', stats: {} });
  assert.deepEqual([n.hidden, row.getAttribute('aria-label')], [true, null]);
});
test('a design-delta frame (no status) leaves the count unchanged', async () => {
  const { doc, recv } = await boot({ design: true }, { design: [{ designId: 'd_a', buildId: 'b_a', title: 'A', status: 'building', waiting: 0 }] });
  const n = doc.getElementById('nav-design-count');
  recv({ type: 'design-delta', designId: 'd_a', buildId: 'b_a', seq: 3, ts: 1, agentId: 'a1', path: 'sections/hero.html', sectionId: 'hero', part: 'html', rev: 1, splice: { at: 0, del: 0, text: '<h1>' } });
  assert.deepEqual([n.textContent, n.hidden], ['1', false]);
});
test('createDesignLive counts planning, building and integrating only', () => {
  const live = createDesignLive();
  live.hello(['planning', 'building', 'integrating', 'paused'].map((status, i) => ({ designId: `d${i}`, status })));
  assert.equal(live.count(), 3);
  live.hello([]);
  assert.equal(live.count(), 0);
});
test('parts: design.css, then the compact composer bar, then the last-in-file card nesting; design has no dirs entry', () => {
  const parts = JSON.parse(readFileSync(new URL('../ui/public/parts.json', import.meta.url), 'utf8'));
  assert.deepEqual(parts.css.slice(-3), ['design/design.css', 'chat/composer-bar.css', 'chat/card-nesting.css']);
  assert.equal(parts.css.at(-1), 'chat/card-nesting.css');
  assert.equal(parts.html[parts.html.indexOf('chat/chat.html') + 1], 'design/design.html');
  assert.equal(parts.dirs.includes('design'), false);
});

// In the real app (review M8): app.js's Design wiring lines (show(param), leave(), the mount's route and openDesign,
// sendWs, and hello's { rebooted }) are what this row pins; test/ui-design-view.test.mjs injects every one of them.
const APP_DID = 'd_0000000000a1';
const TEN = Array.from({ length: 10 }, (_, i) => ({ id: i ? `d_${String(i + 1).padStart(12, '0')}` : APP_DID, title: `Design ${i + 1}`, kind: 'web', status: 'done', updatedAt: '2026-11-05T10:00:00Z', costUsd: 0, thumb: null }));
const tenDesigns = (url, init = {}) => (String(init.method ?? 'GET').toUpperCase() === 'GET' && url === '/api/design'
  ? { ok: true, status: 200, json: async () => TEN, text: async () => JSON.stringify(TEN) } : undefined);

test('flag on: #design is the design start with every design shown, swapped in place', async () => {
  const { window, doc } = await boot({ design: true }, {}, { answer: tenDesigns });
  const depth = window.history.length;
  window.location.hash = 'design';
  await settle();
  assert.equal(window.location.hash, '#chat/new/design/all');
  assert.equal(window.history.length, depth + 1, 'the redirect replaces #design: one entry, not two');
  assert.deepEqual([hidden(doc, 'design'), hidden(doc, 'chat')], [true, false]);
  assert.equal(doc.getElementById('topnav-title').textContent, 'Design');
  assert.equal(doc.querySelector('.nav button[data-nav="design"]').getAttribute('aria-current'), 'page');
  const slot = doc.querySelector('.chat-page[data-view="design"] [data-chat-design]');
  assert.deepEqual([slot.querySelectorAll('.dz-designs a.dz-tile').length, slot.querySelector('[data-dz-show-all]').textContent], [10, 'Show fewer'], 'all reaches the grid');
});
test('turning the flag off while the design start is open leaves it for the Chat home', async () => {
  const { window, doc, recv } = await boot({ design: true });
  window.location.hash = 'design';
  await settle();
  recv({ type: 'flags', flags: { design: false } });
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'home');
  assert.equal(doc.querySelector('[data-chat-design]').hidden, true);
});
const APP_BID = 'b_0000000000a1';
function designAnswer(url, init = {}) {
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const method = String(init.method ?? 'GET').toUpperCase();
  if (method === 'GET' && url === '/api/design') {
    return reply([{ id: APP_DID, title: 'Apsida landing page', kind: 'web', status: 'building', updatedAt: '2026-11-05T10:00:00Z', costUsd: 0, thumb: null }]);
  }
  if (method === 'GET' && url === `/api/design/${APP_DID}`) {
    return reply({
      design: { id: APP_DID, kind: 'web', title: 'Apsida landing page', version: 0, threadId: null },
      plan: null, sections: [], versions: [],
      build: { id: APP_BID, designId: APP_DID, round: 1, kind: 'first', status: 'building', reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null },
    });
  }
  if (method === 'POST' && url === `/api/design/${APP_DID}/preview-token`) {
    return reply({ base: '/design-preview/TOK', expiresAt: Date.now() + 43200000 });
  }
  return null;
}
// The same studio, with the design's titled thread: the mount passes the real dock (createChat), app.js forwards
// ask-* frames to it, and hello reaches it through the view. The dock's own tests inject all three.
const APP_TID = 'ask_00000001';
const designChatAnswer = (messages = []) => (url, init = {}) => {
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const method = String(init.method ?? 'GET').toUpperCase();
  if (method === 'GET' && url === `/api/design/${APP_DID}`) {
    return reply({
      design: { id: APP_DID, kind: 'web', title: 'Apsida landing page', version: 0, threadId: APP_TID },
      plan: null, sections: [], versions: [],
      build: { id: APP_BID, designId: APP_DID, round: 1, kind: 'first', status: 'building', reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null },
    });
  }
  if (method === 'GET' && url === '/api/ask/models') return reply({ default: { model: 'm', effort: 'e' }, models: [] });
  if (method === 'POST' && url === '/api/ask/threads') return { ok: false, status: 409, json: async () => ({ error: 'this design already has its chat', threadId: APP_TID }), text: async () => '' };
  if (method === 'GET' && url === `/api/ask/threads/${APP_TID}`) {
    return reply({ thread: { id: APP_TID, mode: 'design', title: 'Apsida landing page', designId: APP_DID }, messages, attachments: [], runLinks: [], inFlight: null });
  }
  return designAnswer(url, init);
};
/** `#design` (the design start with every design shown) → a tile → its chat (#chat/<thread>): the dock in the Chat
 *  page's design slot, the stage in the tool panel's Design tab. */
async function openFromLibrary(window, doc) {
  window.location.hash = 'design';
  await settle();
  doc.querySelector('[data-chat-design] .dz-designs a.dz-tile').click();
  await settle(); await settle();
}
test('in the real app: a design start\'s tile opens the design\'s chat, a chat like any: its design above the composer, the Design tab beside it, which subscribes; hello re-mints; New chat gives the column back', async () => {
  const { window, doc, recv, calls, sent } = await boot({ design: true }, {}, { answer: designChatAnswer(), raf: true });
  const errors = [];
  window.addEventListener('error', (e) => { errors.push(String(e.error?.stack ?? e.message)); });
  await openFromLibrary(window, doc);
  assert.equal(window.location.hash, `#chat/${APP_TID}`, '#design/<id> is swapped for its chat');
  assert.ok(calls.some((c) => c.method === 'POST' && c.url === '/api/ask/threads'), 'a chat that is gone would be made again');
  const page = doc.querySelector('.chat-page');
  assert.equal(page.dataset.view, 'thread', 'a chat with a design is a chat: its transcript shows');
  assert.ok(page.querySelector('[data-chat-design][data-inline] .dz-chat-slot .dsc-thread'), 'the design is open in the chat');
  const tr = page.querySelector('.chat-convo > .ask-transcript');
  assert.equal(page.querySelector('[data-chat-design]').parentElement, tr, 'with no round card yet, it waits at the end of the transcript');
  assert.equal(tr.lastElementChild, page.querySelector('[data-chat-design]'), 'after the message column');
  // One composer: the chat's own, with the design's Point and gear in its row and no input of the dock's.
  assert.equal(page.querySelector('[data-chat-design] .dsc-input'), null, 'the dock draws no composer of its own');
  const row = page.querySelector('.chat-dock .ask-composer .ask-composer-row');
  assert.ok(row && row.querySelector('[data-ask-composer-ext] .dsc-point') && row.querySelector('[data-ask-composer-ext-end] .dz-set'), 'Point stays left; the gear sits after the model');
  assert.equal(row.querySelector('[data-ask-scope-btn]').disabled, false, 'the chat keeps its own scope pill');
  assert.ok(doc.querySelector('.tool-panel:not([hidden]) .tool-body[data-kind="design"] .dz-stage'), 'the Design tab shows the stage');
  assert.ok([...doc.querySelectorAll('.tool-icon[data-tool-kind="design"]')].some((b) => !b.hidden), 'its icon shows');
  assert.ok([...doc.querySelectorAll('.tool-icon[data-tool-kind="terminal"]')].every((b) => !b.hidden && b.disabled), 'a tool that cannot open here shows greyed');
  assert.equal(doc.querySelector('.chat-head .chat-head-design .chat-head-kind').textContent, 'Web page', 'one head row: the kind beside the title');
  assert.deepEqual([doc.querySelector('.tool-panel .tool-tabs').hidden, doc.querySelector('.tool-panel .tool-new').hidden], [false, false],
    'Design is a tab like the others: the row shows it, and + opens more');
  assert.deepEqual([...doc.querySelectorAll('.tool-panel .tool-tab-text')].map((n) => n.textContent), ['Design']);
  assert.ok(sent.some((m) => m.type === 'subscribe' && m.designBuildId === APP_BID), 'the open build subscribes over the real socket');
  const mints = () => calls.filter((c) => c.method === 'POST' && c.url === `/api/design/${APP_DID}/preview-token`).length;
  const before = mints();
  assert.ok(before >= 1, 'the build doc minted a preview token');
  recv({ type: 'hello', bootId: 'b2', runs: [], flags: { design: true } });
  await settle();
  assert.equal(mints(), before + 1, 'a hello with a new bootId is a rebooted server: the frame re-mints');
  window.location.hash = 'chat/new';
  await settle();
  assert.equal(page.dataset.view, 'home');
  assert.equal(page.querySelector('[data-chat-design]').hidden, true, 'another chat gives the column back');
  assert.equal(doc.querySelector('.dz-stage'), null, 'and the stage goes');
  const icons = [...doc.querySelectorAll('.tool-icon[data-tool-kind="design"]')];
  assert.ok(icons.length && icons.every((b) => b.hidden), 'the Design icon shows on a design chat only');
  assert.equal(doc.querySelector('.tool-panel .tool-new').hidden, false, 'and another chat keeps its tab row');
  assert.deepEqual(errors, [], 'no listener threw');
});
test('in the real app: the sidebar\'s Design starts a new design with its kind buttons and its designs; Show all designs keeps what was typed and the address in step', async () => {
  const chat = designChatAnswer();
  const answer = (url, init = {}) => tenDesigns(url, init) ?? chat(url, init);
  const { window, doc } = await boot({ design: true }, {}, { answer, raf: true });
  doc.querySelector('.nav button[data-nav="design"]').click();
  await settle();
  assert.equal(window.location.hash, '#chat/new/design');
  const slot = doc.querySelector('.chat-page[data-view="design"] [data-chat-design]');
  assert.ok(slot.querySelector('.dz-start-composer .ask-composer textarea.ask-input'), 'the design start holds the chat composer');
  assert.equal(slot.querySelector('.dz-input'), null, 'no composer of its own');
  assert.equal(slot.querySelector('[data-ask-ext-pill="kind"]'), null, 'no Kind pill in the composer');
  assert.equal(slot.querySelector('.dz-kinds .dz-kind-btn.is-on').textContent, 'Web page', 'the kind is the Design page\'s row of buttons, Web page first');
  const kinds = [...slot.querySelectorAll('.dz-kinds .dz-kind-btn')];
  assert.ok(kinds.every((b) => b.classList.contains('btn') && b.classList.contains('btn-lg')), 'the kind buttons are the Chat home quick actions\' size (btn btn-lg)');
  assert.deepEqual(kinds.filter((b) => b.classList.contains('btn-primary')).map((b) => b.dataset.kind), ['web'], 'only the pressed kind is the dark button');
  kinds[1].click();
  assert.deepEqual(kinds.filter((b) => b.classList.contains('btn-primary')).map((b) => b.dataset.kind), ['presentation'], 'the dark one follows the pick');
  assert.equal(slot.querySelector('[data-dz-all]'), null, 'no All designs button');
  assert.equal(slot.querySelectorAll('.dz-designs a.dz-tile').length, 9);
  const page = slot.querySelector('.dz-start-in-chat');
  const input = slot.querySelector('.dz-start-composer textarea.ask-input');
  input.value = 'A launch page';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const depth = window.history.length;
  slot.querySelector('[data-dz-show-all]').click();
  await settle();
  assert.equal(window.location.hash, '#chat/new/design/all');
  assert.equal(window.history.length, depth, 'the address is swapped, not pushed');
  assert.equal(slot.querySelectorAll('.dz-designs a.dz-tile').length, 10);
  assert.equal(slot.querySelector('.dz-start-in-chat'), page, 'the start was not made again');
  assert.equal(input.value, 'A launch page');
  const find = slot.querySelector('input.dz-find');
  find.value = 'design 10';
  find.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual([slot.querySelectorAll('.dz-designs a.dz-tile').length, input.value], [1, 'A launch page']);
  find.value = '';
  find.dispatchEvent(new window.Event('input', { bubbles: true }));
  slot.querySelector('[data-dz-show-all]').click();
  await settle();
  assert.deepEqual([window.location.hash, input.value], ['#chat/new/design', 'A launch page']);
});
test('in the real app: a design that cannot be read leaves the start as it was; Show all designs while a design chat loads leaves its address alone', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const chat = designChatAnswer();
  const answer = (url, init = {}) => {
    if (url === `/api/design/${TEN[1].id}`) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    if (url === `/api/ask/threads/${APP_TID}`) return gate.then(() => chat(url, init));   // the chat loads when the test says
    return tenDesigns(url, init) ?? chat(url, init);
  };
  const { window, doc } = await boot({ design: true }, {}, { answer, raf: true });
  doc.querySelector('.nav button[data-nav="design"]').click();
  await settle();
  const slot = doc.querySelector('.chat-page[data-view="design"] [data-chat-design]');
  const page = slot.querySelector('.dz-start-in-chat');
  const tiles = () => slot.querySelectorAll('.dz-designs a.dz-tile');
  tiles()[1].click(); await settle(); await settle();
  assert.deepEqual([window.location.hash, slot.querySelector('.dz-start-in-chat') === page], ['#chat/new/design', true]);
  tiles()[0].click(); await settle(); await settle();
  assert.equal(window.location.hash, `#chat/${APP_TID}`);
  const depth = window.history.length;
  slot.querySelector('[data-dz-show-all]').click();
  assert.deepEqual([window.location.hash, window.history.length], [`#chat/${APP_TID}`, depth]);
  release(); await settle();
});
test('in the real app: a chat with a design takes its Ask frames in its own transcript; hello reloads it', async () => {
  const { window, doc, recv, calls } = await boot({ design: true }, {}, { answer: designChatAnswer(), raf: true });
  const errors = [];
  window.addEventListener('error', (e) => { errors.push(String(e.error?.stack ?? e.message)); });
  await openFromLibrary(window, doc);
  const host = doc.querySelector('[data-chat-design]');
  assert.ok(host.querySelector('.dz-chat-slot .dsc-thread'), 'the design is open above the composer');
  const threadGets = () => calls.filter((c) => c.method === 'GET' && c.url === `/api/ask/threads/${APP_TID}`).length;
  assert.ok(threadGets() >= 1, 'the chat loaded its thread');
  recv({ type: 'ask-message', threadId: APP_TID, message: { id: 'msg_00000001', seq: 1, role: 'assistant', text: 'from the socket', blocks: [], status: 'done' } });
  await settle();
  assert.match(doc.querySelector('.chat-convo > .ask-transcript').textContent, /from the socket/, 'the chat\'s own transcript draws it');
  assert.doesNotMatch(host.textContent, /from the socket/, 'the design draws no message');
  const before = threadGets();
  recv({ type: 'hello', bootId: 'b', runs: [], flags: { design: true } });
  await settle();
  assert.equal(threadGets(), before + 1, 'hello reaches the chat: it reloads its thread');
  assert.deepEqual(errors, [], 'no listener threw');
});
test('in the real app: a chat with a design draws its replies and its round cards in its own transcript; Back to before this asks through the app\'s confirm', async () => {
  let release = null;
  const loaded = new Promise((r) => { release = r; });
  const askMarkdown = () => loaded.then(async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default }));
  const messages = [
    { id: 'msg_00000001', seq: 1, role: 'assistant', text: 'Built the **hero**', blocks: [], status: 'done' },
    { id: 'msg_00000002', seq: 2, role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_00000002', state: 'done', card: { type: 'design-round', round: 2, baseVersion: 1, agents: 1, elapsedMs: 1000, costUsd: 0, costKnown: true, summary: 's' } }] },
  ];
  const { window, doc, calls } = await boot({ design: true }, {}, { answer: designChatAnswer(messages), raf: true, hooks: { askMarkdown } });
  const errors = [];
  window.addEventListener('error', (e) => { errors.push(String(e.error?.stack ?? e.message)); });
  await openFromLibrary(window, doc);
  release();
  await settle(); await settle();
  const transcript = doc.querySelector('.chat-convo > .ask-transcript');
  assert.match(transcript.textContent, /hero/, 'the reply is the chat\'s');
  const card = transcript.querySelector('.dsc-card-host[data-design-card="card_00000002"]');
  assert.ok(card, 'the round card is a card of the chat\'s transcript');
  assert.match(card.textContent, /Built by 1 agent/, 'drawn by the open design, with its receipt line');
  assert.ok(card.querySelector('.dsc-root .dsc-thread'), 'the plan and the build sit under the newest round\'s card');
  assert.equal(doc.querySelector('[data-chat-design] .dsc-root'), null, 'not at the end of the chat, where later messages would pass under it');
  const restores = () => calls.filter((c) => c.method === 'POST' && c.url === `/api/design/${APP_DID}/versions/1/restore`).length;
  card.querySelector('.dsc-round button').click();
  await settle();
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), false, 'the app\'s confirm opened');
  assert.deepEqual([doc.getElementById('confirm-title').textContent, doc.getElementById('confirm-ok').textContent, doc.getElementById('confirm-cancel').textContent],
    ['Go back to before this round?', 'Go back', 'Stay']);
  assert.equal(restores(), 0, 'nothing restores before the answer');
  doc.getElementById('confirm-cancel').click();
  await settle();
  assert.equal(restores(), 0, 'Stay restores nothing');
  assert.deepEqual(errors, [], 'no listener threw');
});

test('in the real app: the sidebar\'s Design is lit and named in the bar, and the chats list stays as the person left it', async () => {
  const { window, doc } = await boot({ design: true }, {}, { answer: designChatAnswer(), raf: true });
  const page = doc.querySelector('[data-chat-page]');
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });   // a push column, not the overlay
  window.dispatchEvent(new window.Event('resize'));
  window.location.hash = '#chat'; await settle();
  if (page.dataset.history !== 'open') { doc.querySelector('[data-ask-threads-btn]').click(); await settle(); }
  assert.equal(page.dataset.history, 'open', 'precondition: the list is open on Chat');
  doc.querySelector('.nav button[data-nav="design"]').click();
  await settle();
  assert.equal(window.location.hash, '#chat/new/design');
  assert.equal(page.dataset.history, 'open', 'Design keeps the chats list open');
  assert.deepEqual([...doc.querySelectorAll('.nav button.active')].map((x) => x.dataset.nav), ['design'], 'the sidebar lights Design, not Chat');
  assert.equal(doc.querySelector('.nav button[data-nav="design"]').getAttribute('aria-current'), 'page');
  assert.equal(doc.getElementById('topnav-title').textContent, 'Design');
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.deepEqual([...doc.querySelectorAll('.nav button.active')].map((x) => x.dataset.nav), ['chat'], 'back on Chat, Chat is lit');
  assert.equal(page.dataset.history, 'open', 'back on Chat, the list is still open');
});
test('in the real app: a design\'s chat is the sidebar\'s Design too: Design lit and named beside the open chats list; a chat with no design lights Chat', async () => {
  const { window, doc } = await boot({ design: true }, {}, { answer: designChatAnswer(), raf: true });
  const page = doc.querySelector('[data-chat-page]');
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });   // a push column, not the overlay
  window.dispatchEvent(new window.Event('resize'));
  window.location.hash = '#chat'; await settle();
  if (page.dataset.history !== 'open') { doc.querySelector('[data-ask-threads-btn]').click(); await settle(); }
  assert.equal(page.dataset.history, 'open', 'precondition: the list is open on Chat');
  await openFromLibrary(window, doc);
  assert.equal(window.location.hash, `#chat/${APP_TID}`);
  const lit = () => [...doc.querySelectorAll('.nav button.active')].map((x) => x.dataset.nav);
  assert.deepEqual(lit(), ['design'], 'the design\'s chat lights Design, not Chat');
  assert.equal(doc.getElementById('topnav-title').textContent, 'Design');
  assert.equal(page.dataset.history, 'open', 'the chats list stays open beside a design');
  window.location.hash = '#chat/new';                                // a new chat (the worca logo's route)
  await settle();
  assert.deepEqual(lit(), ['chat'], 'a chat with no design: Chat is lit');
  assert.equal(doc.getElementById('topnav-title').textContent, 'Chat');
  assert.equal(page.dataset.history, 'open', 'and the list is still open');
});
test('in the real app: beside Design the chats list holds design chats only; a design chat picked from the list lights Design while it loads', async () => {
  const at = new Date().toISOString();
  const row = (id, o = {}) => ({ id, title: `Chat ${id}`, createdAt: at, updatedAt: at, totals: { costUsd: 0 }, scope: null, inFlight: false,
    waiting: false, tracking: false, trackingRuns: 0, commands: 0, archived: false, ...o });
  const PLAIN = 'ask_00000002';
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const base = designChatAnswer();
  const answer = (url, init = {}) => {
    const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.startsWith('/api/ask/threads?')) {
      const threads = url.includes('designs=1') ? [row(APP_TID, { designId: APP_DID })] : [row(APP_TID, { designId: APP_DID }), row(PLAIN)];
      return reply({ threads, cursor: null, total: threads.length, counts: { all: threads.length, needs: 0, archived: 0 } });
    }
    const own = base(url, init);
    if (own && url === `/api/ask/threads/${APP_TID}`) return gate.then(() => own);   // the design chat loads when the test says
    return own;
  };
  const { window, doc, urls } = await boot({ design: true }, {}, { answer, raf: true });
  const page = doc.querySelector('[data-chat-page]');
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });   // a push column, not the overlay
  window.dispatchEvent(new window.Event('resize'));
  window.location.hash = '#chat'; await settle();
  if (page.dataset.history !== 'open') { doc.querySelector('[data-ask-threads-btn]').click(); await settle(); }
  const title = () => doc.querySelector('[data-chat-history] .runs-head-title').textContent;
  const rows = () => [...doc.querySelectorAll('[data-chat-history] a.runs-row')].map((a) => a.dataset.rowKey);
  const lit = () => [...doc.querySelectorAll('.nav button.active')].map((x) => x.dataset.nav);
  const lastList = () => urls.filter((u) => u.startsWith('/api/ask/threads?')).at(-1);
  assert.equal(title(), 'Chats');
  assert.deepEqual(rows(), [`chat:${APP_TID}`, `chat:${PLAIN}`], 'Chat lists every chat');
  doc.querySelector('.nav button[data-nav="design"]').click();
  await settle();
  assert.equal(window.location.hash, '#chat/new/design');
  assert.match(lastList(), /[?&]designs=1(&|$)/, 'Design asks for design chats only');
  assert.equal(title(), 'Design chats');
  assert.deepEqual(rows(), [`chat:${APP_TID}`], 'the chat with a design, alone');
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.equal(title(), 'Chats', 'back on Chat, every chat');
  assert.doesNotMatch(lastList(), /designs=/);
  doc.querySelector(`[data-chat-history] a.runs-row[data-row-key="chat:${APP_TID}"]`).click();
  await settle();
  assert.equal(window.location.hash, `#chat/${APP_TID}`);
  assert.deepEqual(lit(), ['design'], 'still loading, the design chat\'s row lights Design');
  assert.equal(title(), 'Design chats');
  release();
  await settle(); await settle();
  assert.deepEqual(lit(), ['design'], 'loaded, its design keeps Design lit');
  assert.equal(doc.getElementById('topnav-title').textContent, 'Design');
  assert.equal(title(), 'Design chats');
  window.location.hash = '#chat/new';
  await settle();
  assert.deepEqual(lit(), ['chat']);
  assert.equal(title(), 'Chats', 'a new chat: every chat again');
});
test('in the real app: from a design chat the chats list\'s New starts a new design: the design start, Design still lit, the list still design chats', async () => {
  const { window, doc } = await boot({ design: true }, {}, { answer: designChatAnswer(), raf: true });
  const page = doc.querySelector('[data-chat-page]');
  window.location.hash = '#chat'; await settle();
  await openFromLibrary(window, doc);
  assert.equal(window.location.hash, `#chat/${APP_TID}`, 'precondition: the design\'s chat');
  const btn = doc.querySelector('[data-chat-history] .runs-head > .chat-list-new');
  assert.equal(btn.getAttribute('aria-label'), 'New design');
  btn.click();
  await settle();
  assert.equal(window.location.hash, '#chat/new/design');
  assert.equal(page.dataset.view, 'design', 'the design start shows');
  assert.deepEqual([...doc.querySelectorAll('.nav button.active')].map((x) => x.dataset.nav), ['design']);
  assert.equal(doc.querySelector('[data-chat-history] .runs-head-title').textContent, 'Design chats');
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.match(btn.getAttribute('aria-label'), /^New chat /, 'on Chat it starts a chat again');
});
test('in the real app: the sidebar\'s Chat after Design shows the Chat home, not the design start under Chat\'s name', async () => {
  const { window, doc } = await boot({ design: true }, {}, { answer: designChatAnswer(), raf: true });
  const page = doc.querySelector('[data-chat-page]');
  window.location.hash = '#chat'; await settle();
  doc.querySelector('.nav button[data-nav="design"]').click();
  await settle();
  assert.equal(page.dataset.view, 'design', 'precondition: the design start shows');
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(page.dataset.view, 'home', 'Chat shows its home');
  assert.equal(doc.querySelector('[data-chat-design]').hidden, true, 'the design start is gone');
  assert.equal(doc.querySelector('.chat-convo > .chat-home .ask-composer textarea.ask-input') !== null, true, 'the composer is back in the home\'s hero');
  assert.equal(doc.querySelector('.chat-head').textContent.includes('New design'), false, 'the head no longer says New design');
});
