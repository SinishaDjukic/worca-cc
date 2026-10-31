// test/ui-chat-page-app.test.mjs — worca Chat P1 inside the real app (app.js boots in jsdom): the panel is mounted in the
// Chat section and opened by the boot route, a boot elsewhere fetches nothing from /api/ask, a boot survives every
// /api/ask endpoint failing, the address follows the chat (a first send replaces #chat, the Chat row reopens the chat
// you left, New chat is home), and leaving Chat hides the page while a reply that lands meanwhile lights the row's dot.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const TID = 'ask_00000001';
const MID = 'askm_00000001';
const THREAD = { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };
const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function boot({ hash = '', askDown = false, stored = null, onboarding = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = [];
  const NEW_IDS = [TID, 'ask_00000002'];                                // the chats a POST /api/ask/threads creates, in order
  let nextId = 0;
  window.fetch = (u, opts) => {
    const url = String(u);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    calls.push({ url, opts: opts || {} });
    const ok = (body, status = 200) => Promise.resolve({ ok: true, status, json: async () => body });
    if (askDown && url.includes('/api/ask/')) return Promise.reject(new TypeError('Failed to fetch'));
    if (onboarding && url.startsWith('/api/onboarding')) return ok(onboarding);   // the welcome's status (getting started)
    if (url === '/api/ask/threads' && method === 'POST') return ok({ thread: { ...THREAD, id: NEW_IDS[nextId++] || 'ask_0000ffff', title: null } }, 201);
    if (/^\/api\/ask\/threads\/ask_[0-9a-f]{8}\/messages$/.test(url) && method === 'POST') return ok({ userMessageId: `askm_u000000${nextId}`, attachments: [], contexts: [] }, 202);
    const one = url.match(/^\/api\/ask\/threads\/(ask_[0-9a-f]{8})/);
    if (one) return ok({ thread: { ...THREAD, id: one[1] }, messages: [], attachments: [], runLinks: [], inFlight: null });
    if (url.startsWith('/api/ask/threads')) return ok({ threads: [], total: 0 });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  if (stored) window.localStorage.setItem('worca-cc.ask.thread', stored);   // a chat left open in an earlier session
  window.__worcaTestHooks = { askMarkdown: async () => { throw new Error('markdown disabled here'); } };
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, doc: window.document, calls, recv };
}
async function send(doc, text) {
  doc.querySelector('textarea.ask-input').value = text;
  doc.querySelector('[data-ask-send]').click();
  await settle(8);
}

test('the panel lives in the Chat section and the boot route opens it: no floating dock; the catalog and the MCP preview load', async () => {
  const { doc, calls } = await boot();
  const page = doc.querySelector('section.view[data-view="chat"] > div.chat-page[data-chat-page]');
  assert.ok(page, 'mounted into the Chat section');
  assert.equal(page.dataset.view, 'home');
  assert.ok(page.querySelector('[data-chat-hero-slot] textarea.ask-input'));
  assert.equal(doc.querySelector('.ask-dock, .ask-pill, .ask-sheet, [data-ask-sheet]'), null);
  const urls = calls.map((c) => `${(c.opts.method || 'GET').toUpperCase()} ${c.url}`);
  for (const u of ['GET /api/ask/models', 'POST /api/ask/mcp-preview']) assert.ok(urls.includes(u), u);
});

test('a boot on another page fetches nothing from /api/ask until Chat shows', async () => {
  const { window, calls } = await boot({ hash: '#runs' });
  assert.ok(calls.every((c) => !c.url.includes('/api/ask')), 'the repo-wide fence holds off Chat');
  window.location.hash = '#chat';
  await settle();
  assert.ok(calls.some((c) => c.url === '/api/ask/models'));
});

test('a boot on Chat survives every /api/ask endpoint failing: no unhandled rejection, a working home page', async () => {
  const unhandled = [];
  const onRej = (e) => unhandled.push(e);
  process.on('unhandledRejection', onRej);
  try {
    const { doc } = await boot({ askDown: true });
    await settle(10);
    await new Promise((r) => setImmediate(r));
    assert.ok(doc.querySelector('section[data-view="chat"] > .chat-page[data-view="home"] [data-chat-hero-slot] textarea.ask-input'));
    assert.deepEqual(unhandled.map((e) => String(e && e.message)), []);
  } finally {
    process.off('unhandledRejection', onRej);
  }
});

test('the address follows the chat: a first send replaces #chat with #chat/<id>; the Chat row reopens the chat you left; New chat is home; a pasted address opens that chat', async () => {
  const { window, doc } = await boot();
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}`, 'replaced, not pushed');
  doc.querySelector('.nav button[data-nav="runs"]').click();
  await settle();
  assert.equal(window.location.hash, '#runs');
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.equal(window.location.hash, `#chat/${TID}`, 'the chat you left');
  assert.ok(doc.querySelector('.nav button[data-nav="chat"]').classList.contains('active'));
  doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'home');
  window.location.hash = `#chat/${TID}`;                                // Back / Forward / a pasted link
  await settle(8);
  assert.equal(doc.querySelector('.ask-title').textContent, 'T');
});

test('the boot is Chat home, never a restored chat — with a stored chat and an empty or unknown hash', async () => {
  for (const hash of ['', '#bogus']) {
    const { window, doc, calls } = await boot({ hash, stored: TID });
    const label = hash || '(empty)';
    assert.equal(window.location.hash, '#chat', label);
    assert.equal(doc.querySelector('.chat-page').dataset.view, 'home', label);
    assert.equal(doc.querySelector('.ask-title').textContent, 'New chat', label);
    assert.ok(!calls.some((c) => c.url === `/api/ask/threads/${TID}`), `${label}: the stored chat is not loaded`);
  }
});

test('the worca logo is Chat home (a new chat) even after a chat was left on another page', async () => {
  const { window, doc } = await boot();
  assert.equal(doc.querySelector('.brand a.logo').getAttribute('href'), '#chat/new');
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}`);
  window.location.hash = '#runs';
  await settle();
  window.location.hash = '#chat/new';                                   // what the logo link does
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'home');
  assert.equal(doc.querySelector('.ask-title').textContent, 'New chat');
});

test('the Workflows view\'s Back returns to the address Chat swapped to (the logo\'s #chat/new became #chat, a first send #chat/<id>)', async () => {
  const { window, doc } = await boot();
  window.location.hash = '#chat/new';                                   // the worca logo
  await settle();
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}`);
  window.location.hash = '#workflows';
  await settle(8);
  doc.getElementById('wfv-back').click();
  await settle();
  assert.equal(window.location.hash, `#chat/${TID}`, 'the chat, not #chat/new (a new chat)');
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'thread');
});

test('an entry point with text (openChat) from another page reopens the chat you left and adds the text, unsent', async () => {
  const { window, doc, calls } = await boot();
  await send(doc, 'hello');
  window.location.hash = '#workflows';                // Ask worca beside the page (L7): a page with the side column opens it instead
  await settle(8);
  window.__np.chat.openChat({ text: '[diff comment dc_1 — a.js:3 (new)] "why?"' });
  await settle();
  assert.equal(window.location.hash, `#chat/${TID}`);
  assert.equal(doc.querySelector('textarea.ask-input').value, '[diff comment dc_1 — a.js:3 (new)] "why?"');
  assert.equal(calls.filter((c) => c.url.endsWith('/messages')).length, 1, 'only the first message was ever sent');
});

test('the Chat row with the unread dot opens the chat whose reply is unread, not the last one; an entry point with text still takes the last one', async () => {
  const { window, doc, recv } = await boot();
  const A = TID;
  const B = 'ask_00000002';
  const done = (threadId) => ({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId, messageId: `askm_${threadId.slice(4)}`, seq: 3 });
  await send(doc, 'first');                                             // chat A
  doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await settle();
  await send(doc, 'second');                                            // chat B, the one Chat shows
  assert.equal(window.location.hash, `#chat/${B}`);
  window.location.hash = '#runs';
  await settle();
  recv(done(A));
  await settle();
  const dot = doc.getElementById('nav-chat-unread');
  assert.equal(dot.hidden, false, 'A replied while Chat was hidden');
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.equal(window.location.hash, `#chat/${A}`, 'the unread chat (A), not the last one (B)');
  assert.equal(dot.hidden, true, 'read');
  window.location.hash = '#workflows';                // L7: from Workflows an entry point still goes to the Chat page
  await settle(8);
  recv(done(B));
  await settle();
  assert.equal(dot.hidden, false, 'B replied');
  window.__np.chat.openChat({ text: 'about this run' });
  await settle();
  assert.equal(window.location.hash, `#chat/${A}`, 'an entry point with text goes to the last chat (A), not the unread one');
  assert.equal(dot.hidden, true, 'Chat on screen: read');
});

test('a first send under an open run panel keeps the panel\'s tail: #chat/new/run/<id>/<tab> → #chat/<thread>/run/<id>/<tab>', async () => {
  const { window, doc } = await boot({ hash: '#chat/new/run/aaaa1111/logs' });
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}/run/aaaa1111/logs`);
});

test('leaving Chat hides the page (an open popover closes); a reply that lands meanwhile lights the Chat row dot; coming back clears it', async () => {
  const { window, doc, recv } = await boot();
  await send(doc, 'hello');
  doc.querySelector('[data-ask-model-btn]').click();
  assert.ok(doc.querySelector('.ask-pop-model'));
  window.location.hash = '#runs';
  await settle();
  assert.equal(doc.querySelector('.ask-pop'), null, 'leaving closed the popover');
  const row = doc.querySelector('.nav button[data-nav="chat"]');
  const dot = doc.getElementById('nav-chat-unread');
  assert.equal(dot.hidden, true);
  recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  recv({ type: 'ask-delta', text: 'done!', threadId: TID, messageId: MID, seq: 2 });
  recv({ type: 'ask-done', text: 'done!', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId: TID, messageId: MID, seq: 3 });
  await settle();
  assert.equal(dot.hidden, false, 'a reply landed while Chat was not on screen');
  assert.equal(row.getAttribute('aria-label'), 'Chat, new reply');
  row.click();
  await settle();
  assert.equal(window.location.hash, `#chat/${TID}`);
  assert.equal(dot.hidden, true, 'Chat on screen: read');
  assert.equal(row.getAttribute('aria-label'), null);
});

test('the first send SWAPS the address (no new history entry): Back never lands on an empty new chat', async () => {
  const { window, doc } = await boot();
  const before = window.history.length;
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}`);
  assert.equal(window.history.length, before, 'replaced, not pushed');
  doc.querySelector('.chat-head [data-ask-new-btn]').click();                      // New chat is pushed
  await settle();
  assert.equal(window.history.length, before + 1);
});

test('going from a chat to a bare #chat (Back to home, a typed #chat) is home, never the chat just left', async () => {
  const { window, doc } = await boot();
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}`);
  window.location.hash = '#chat';
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'home');
});

test('Workflows Back returns to the chat the address was swapped to, even when another chat\'s reply landed meanwhile', async () => {
  const done = (threadId) => ({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId, messageId: `askm_${threadId.slice(4)}`, seq: 3 });
  const A = TID;
  const B = 'ask_00000002';
  {
    // B08: the first send's swap (#chat → #chat/<B>) moves Back's target
    const { window, doc, recv } = await boot();
    await send(doc, 'first');                                           // chat A
    doc.querySelector('.chat-head [data-ask-new-btn]').click();
    await settle();
    await send(doc, 'second');                                          // chat B, swapped in
    assert.equal(window.location.hash, `#chat/${B}`);
    window.location.hash = '#workflows';
    await settle(8);
    recv(done(A));                                                      // A replies while Chat is hidden: unread
    await settle();
    doc.getElementById('wfv-back').click();
    await settle();
    assert.equal(window.location.hash, `#chat/${B}`, 'Back: the chat the address named (B), not the unread one');
  }
  {
    // B06: the Chat row's restore (#chat → #chat/<B>) moves Back's target
    const { window, doc, recv } = await boot();
    await send(doc, 'first');                                           // chat A
    doc.querySelector('.chat-head [data-ask-new-btn]').click();
    await settle();
    await send(doc, 'second');                                          // chat B
    window.location.hash = '#runs';
    await settle();
    doc.querySelector('.nav button[data-nav="chat"]').click();          // restores B: #chat swapped to #chat/<B>
    await settle();
    assert.equal(window.location.hash, `#chat/${B}`);
    window.location.hash = '#workflows';
    await settle(8);
    recv(done(A));
    await settle();
    doc.getElementById('wfv-back').click();
    await settle();
    assert.equal(window.location.hash, `#chat/${B}`, 'Back: the restored chat (B), not the unread one');
  }
});

test('a PUSHED move (New chat) under an open run panel drops the panel tail; only a swap keeps it', async () => {
  const { window, doc } = await boot({ hash: '#chat/new/run/aaaa1111/logs' });
  await send(doc, 'hello');
  assert.equal(window.location.hash, `#chat/${TID}/run/aaaa1111/logs`, 'the swap kept the tail');
  doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await settle();
  assert.equal(window.location.hash, '#chat', 'New chat is home: no run panel route');
});

test('a first send that lands after Chat was left never rewrites the address of the page now shown', async () => {
  const { window, doc } = await boot();
  const real = globalThis.fetch;
  let release;
  const held = new Promise((r) => { release = r; });
  globalThis.fetch = (u, o) => (String(u) === '/api/ask/threads' && ((o && o.method) || 'GET').toUpperCase() === 'POST' ? held.then(() => real(u, o)) : real(u, o));
  try {
    doc.querySelector('textarea.ask-input').value = 'hello';
    doc.querySelector('[data-ask-send]').click();
    await settle();
    window.location.hash = '#runs';
    await settle();
    release();
    await settle(8);
    assert.equal(window.location.hash, '#runs', 'the Runs page keeps its address');
  } finally { globalThis.fetch = real; }
});

test('Chat shown under the welcome (a first visit from another page) leaves focus in the welcome, not in the composer behind it; Skip hands it to the composer', async () => {
  const STEPS = ['claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace', 'teamMetrics', 'teamPolicy'];
  const onboarding = { steps: Object.fromEntries(STEPS.map((id) => [id, id === 'claude'])), done: 1, total: 9, claude: { bin: 'claude', hint: null }, hidden: false, welcomeSeen: false };
  const { doc } = await boot({ hash: '#runs', onboarding });
  const welcome = doc.getElementById('welcome-modal');
  welcome.classList.add('hidden');                     // an earlier test's app instance reads the global document
  doc.querySelector('.nav button[data-nav="chat"]').click();
  await settle();
  assert.equal(welcome.classList.contains('hidden'), false, 'the first visit to Chat: the welcome is up');
  assert.ok(welcome.contains(doc.activeElement), 'focus stays in the welcome dialog');
  welcome.querySelector('.ob-skip').click();
  assert.equal(welcome.classList.contains('hidden'), true);
  assert.equal(doc.activeElement, doc.querySelector('[data-chat-page] textarea.ask-input'), 'Skip hands the focus to the composer');
});

test('openChat with nothing to add while Chat shows puts the caret in the composer (the top bar\'s "Ask in Chat" row blurs the search first)', async () => {
  const { window, doc } = await boot();
  doc.getElementById('tsearch-input').focus();
  doc.activeElement.blur();
  window.__np.chat.openChat({ text: '   ' });
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(doc.activeElement, doc.querySelector('textarea.ask-input'));
});

test('the worca logo on Chat home adds no Back step (it is home already); from a chat it still goes home', async () => {
  const { window, doc } = await boot();
  const before = window.history.length;
  doc.querySelector('.brand a.logo').click();
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(window.history.length, before, 'no #chat/new entry for Back to stall on');
  await send(doc, 'hello');
  doc.querySelector('.brand a.logo-mark').click();
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'home');
});
