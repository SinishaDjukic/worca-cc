// test/ui-chat-route.test.mjs — worca Chat P1 routing inside the real app (app.js boots in jsdom): the Chat row leads the
// sidebar, Chat is the boot page and the logo's target, #chat[/<thread>[/run/<run>[/<tab>]]] reaches enterChatView and
// P4's chatPanelRouter, getPageContext on Chat carries only the panel's run, chatDeps.openRunPanel opens P4's run panel,
// and openChat routes to Chat and stacks text in the composer.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { pageTitle } from '../ui/public/topnav.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const THREAD_URL = /^\/api\/ask\/threads\/(ask_[0-9a-f]{8})$/;

const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const shown = (doc, view) => !doc.querySelector(`section.view[data-view="${view}"]`).classList.contains('hidden');

async function boot(hash = '') {
  const dom = trackDom(new JSDOM(html, { url: `http://localhost:4317/${hash}` }));
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
  window.fetch = (u, opts) => {
    const url = String(u);
    calls.push({ url, opts: opts || {} });
    const ok = (body, status = 200) => Promise.resolve({ ok: true, status, json: async () => body });
    const m = url.match(THREAD_URL);
    if (m) return ok({ thread: { id: m[1], title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null });
    if (url.startsWith('/api/ask/threads')) return ok({ threads: [], total: 0 });
    if (url.startsWith('/api/projects')) return ok({ projects: [{ key: 'proj-0000beef', name: 'proj', path: '/repos/proj', exists: true }] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.lastProject', 'proj');   // a dropdown project the Chat context must NOT carry
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, doc: window.document, calls, recv, chat: window.__np.chat };
}

test('the Chat row leads the sidebar (simple, "Chat", an unread dot that starts hidden); the logo links go to Chat; the chat view exists', () => {
  const doc = new JSDOM(html).window.document;
  const first = doc.querySelector('.nav').firstElementChild;
  assert.equal(first.dataset.nav, 'chat');
  assert.equal(first.dataset.minLevel, 'simple');
  assert.equal(first.querySelector(':scope > span:not(.nav-count)').textContent, 'Chat');
  assert.equal(first.nextElementSibling.dataset.nav, 'runs', 'right above Runs');
  const dot = first.querySelector('#nav-chat-unread');
  assert.ok(dot && dot.hidden, 'the unread dot starts hidden');
  assert.ok(dot.classList.contains('nav-count') && dot.classList.contains('nav-dot'), 'a nav-count: never the row label, rides the rail corner');
  const sec = doc.querySelector('section.view[data-view="chat"]');
  assert.ok(sec && sec.classList.contains('hidden'), 'hidden like every view until the boot route shows one');
  assert.ok(doc.querySelector('section.view[data-view="new"]').classList.contains('hidden'), 'New run no longer flashes first');
  assert.deepEqual([...doc.querySelectorAll('section.view:not(.hidden)')].map((s) => s.dataset.view), [], 'no view shows before app.js runs (work mounted above the boot route starts hidden)');
  assert.equal(sec.getAttribute('aria-label'), 'Chat');
  for (const sel of ['.brand a.logo', '.brand a.logo-mark']) {
    const a = doc.querySelector(sel);
    assert.ok(a, sel);
    assert.equal(a.getAttribute('href'), '#chat/new', sel);   // home: a new chat, never a restored one
    assert.equal(a.getAttribute('aria-label'), 'worca: Chat', sel);
  }
  assert.equal(pageTitle('chat'), 'Chat');
});

test('an empty or unknown hash boots on Chat: the view, the title, the lit row, the body flag, the address', async () => {
  for (const hash of ['', '#bogus']) {
    const { window, doc } = await boot(hash);
    const label = hash || '(empty)';
    assert.equal(shown(doc, 'chat'), true, `${label}: chat shown`);
    assert.equal(shown(doc, 'new'), false, `${label}: New run hidden`);
    assert.equal(doc.getElementById('topnav-title').textContent, 'Chat', label);
    const row = doc.querySelector('.nav button[data-nav="chat"]');
    assert.ok(row.classList.contains('active'), label);
    assert.equal(row.getAttribute('aria-current'), 'page', label);
    assert.ok(doc.body.classList.contains('view-chat'), label);
    assert.equal(window.location.hash, '#chat', label);
  }
});

test('the Workflows view\'s Back with no page before it goes to Chat, the home', async () => {
  const { window, doc } = await boot('#workflows');
  await settle(8);
  doc.getElementById('wfv-back').click();
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(shown(doc, 'chat'), true);
});

test('leaving Chat drops the body flag; #new still opens New run', async () => {
  const { window, doc } = await boot();
  window.location.hash = '#new';
  await settle();
  assert.equal(shown(doc, 'new'), true);
  assert.equal(shown(doc, 'chat'), false);
  assert.equal(doc.body.classList.contains('view-chat'), false);
});

test('the route reaches enterChatView: run segments go to chatPanelRouter, anything else closes the panel route, a bad chat id is home', async () => {
  const { window, chat } = await boot();
  const seen = [];
  chat.setPanelRouter((segs) => seen.push(segs));
  window.location.hash = '#chat/ask_0000000a/run/aaaa1111/logs';
  await settle();
  assert.deepEqual(seen.at(-1), ['aaaa1111', 'logs']);
  window.location.hash = '#chat/new/run/aaaa1111';
  await settle();
  assert.deepEqual(seen.at(-1), ['aaaa1111'], '"new" is the thread placeholder P4 uses before a chat exists');
  window.location.hash = '#chat/ask_0000000a';
  await settle();
  assert.deepEqual(seen.at(-1), [], 'no run segment: the panel route closes');
  window.location.hash = '#chat/not-a-chat';
  await settle();
  assert.equal(window.location.hash, '#chat', 'a first segment that is no chat id lands on home');
  window.location.hash = '#chat/new';                                  // the worca logo
  await settle();
  assert.equal(window.location.hash, '#chat', 'home\'s own address');
  assert.deepEqual(seen.at(-1), []);
  chat.setPanelRouter(null);
});

test('getPageContext on Chat: { view: "chat" } alone (never the dropdown fallback), merged with the run the panel shows', async () => {
  const { chat } = await boot();
  assert.deepEqual(chat.getPageContext(), { view: 'chat' });
  const run = { runId: '0f0f0f0f-0000-4000-8000-000000000001', pipelineId: 'aaaa1111', runPage: 'logs' };
  chat.setPanelContext(() => run);
  assert.deepEqual(chat.getPageContext(), { view: 'chat', ...run });
  chat.setPanelContext(() => { throw new Error('panel gone'); });
  assert.deepEqual(chat.getPageContext(), { view: 'chat' }, 'a failing panel hook is no context');
  chat.setPanelContext(null);
});

test('chatDeps.openRunPanel is the Chat run panel (P4): a saved run by its pipeline id, a live run by its run id, the tab as asked; openArtifact opens the artifact popup (P5)', async () => {
  const { window, chat, recv } = await boot();
  chat.deps.openRunPanel({ pipelineId: 'aaaa1111', projectKey: 'proj-0000beef' }, { tab: 'artifacts' });
  assert.equal(window.location.hash, '#chat/new/run/aaaa1111/artifacts');
  chat.deps.openRunPanel({ pipelineId: 'aaaa1111', projectKey: 'proj-0000beef' }, { tab: 'qa' });
  assert.equal(window.location.hash, '#chat/new/run/aaaa1111/qa', 'the address keeps the key; the saved screen maps qa to clarify');
  chat.deps.openRunPanel({ pipelineId: 'bbbb2222', workspaceId: 'wks-team-0000abcd' }, {});
  assert.equal(window.location.hash, '#chat/new/run/bbbb2222');
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'a run', projectDir: '/repos/proj', status: 'running', startedAt: '10:00:00', kind: 'run', pipelineId: 'cccc3333', pendingQuestion: null, pauseReason: null }], ask: [] });
  await settle();
  chat.deps.openRunPanel({ pipelineId: 'cccc3333', projectKey: 'proj-0000beef' }, { tab: 'clarify' });
  assert.equal(window.location.hash, '#chat/new/run/r1/clarify', 'a live run opens by its run id; the live screen maps clarify to qa');
  // P5 points openArtifact at the popup viewer (its test: ui-run-artifacts "the Chat opens an artifact…").
  chat.deps.openArtifact({ pipelineId: 'cccc3333' }, { relPath: 'plan.md' });
  assert.equal(window.location.hash, '#chat/new/run/r1/clarify', 'openArtifact opens the popup, it does not navigate');
  assert.ok(window.document.querySelector('.apv'), 'the popup viewer');
});

test('openChat routes to Chat and stacks text in the composer without sending; a thread id opens that chat', async () => {
  const { window, doc, chat, calls } = await boot('#runs');
  chat.openChat({ text: '[diff comment dc_1 — a.js:3 (new)] "why?"' });
  await settle();
  assert.equal(window.location.hash, '#chat');
  assert.equal(shown(doc, 'chat'), true);
  chat.openChat({ text: 'and this one' });
  await settle();
  assert.equal(doc.querySelector('textarea.ask-input').value, '[diff comment dc_1 — a.js:3 (new)] "why?"\nand this one');
  assert.ok(!calls.some((c) => c.url.endsWith('/messages')), 'nothing is sent');
  window.location.hash = '#chat/ask_0000000a/run/aaaa1111/logs';
  await settle();
  chat.openChat({ text: 'from the run panel' });
  await settle();
  assert.equal(window.location.hash, '#chat/ask_0000000a/run/aaaa1111/logs', 'already on Chat: the address (and a run panel) stay');
  assert.match(doc.querySelector('textarea.ask-input').value, /from the run panel$/);
  chat.openChat({ threadId: 'ask_0000000b' });
  await settle();
  assert.equal(window.location.hash, '#chat/ask_0000000b');
});
