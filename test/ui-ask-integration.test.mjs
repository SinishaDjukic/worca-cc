// test/ui-ask-integration.test.mjs — the ask panel inside the real app shell
// (spec §10.2 seams 1-6, §12 ui-ask-integration). Boot preamble copied from
// test/ui-running-routing.test.mjs:34-94 (the house convention: duplicated per
// suite, no shared harness), with /api/ask fetch arms added and the
// __worcaTestHooks.askMarkdown hook set before the import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function askArms(url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  if (url.includes('/api/ask/models')) {
    return { ok: true, status: 200, json: async () => ({ models: [{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false }], efforts: ['medium', 'high', 'xhigh', 'max'] }) };
  }
  if (url.includes(`/api/ask/threads/${TID}/messages`) && method === 'POST') {
    return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) };
  }
  if (url.includes(`/api/ask/threads/${TID}`) && method === 'DELETE') {
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  if (url.includes(`/api/ask/threads/${TID}`)) {
    return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
  }
  if (url.includes('/api/ask/threads') && method === 'POST') {
    return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
  }
  if (url.includes('/api/ask/threads')) {
    return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
  }
  return null;
}

async function boot({ url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
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
    const url2 = String(u);
    calls.push({ url: url2, opts: opts || {} });
    const ask = askArms(url2, opts);
    if (ask) return Promise.resolve(ask);
    if (url2.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  // renderProjectOptions (app.js:5357-5386) restores the selection from
  // worca-cc.lastProject BY NAME and otherwise leaves the disabled placeholder
  // selected — with a cleared store selectedProjectPath() would be '' and the
  // page context would carry no projectDir. Seed the remembered name.
  window.localStorage.setItem('worca-cc.lastProject', 'proj');
  window.__worcaTestHooks = { askMarkdown: async () => { throw new Error('markdown disabled in integration'); } };

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}
function keydown(window, target, init) {
  const e = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function pointerdown(window, target) {
  target.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
}
// hello row: ui-running-routing's 7-key fixture (:91-94) + explicit pipelineId/pauseReason nulls (upsertRun reads both; null is the idle default)
const RUN_ROW = { runId: 'r1', title: 'a run', projectDir: '/p', status: 'running', startedAt: '10:00:00', kind: 'run', pipelineId: null, pendingQuestion: null, pauseReason: null };

async function openSheet(window) {
  window.document.querySelector('.ask-pill').click();
  await settle(window);
}
async function sendText(window, text) {
  const input = window.document.querySelector('textarea.ask-input');
  input.value = text;
  window.document.querySelector('[data-ask-send]').click();
  await settle(window, 6);
}

test('ui-ask-integration: boot mounts a closed dock as a body child; zero /api/ask fetches at boot', async () => {
  const { window, calls } = await boot();
  const dock = window.document.querySelector('body > .ask-dock');
  assert.ok(dock, 'dock is a direct body child');
  assert.equal(dock.querySelector('.ask-sheet').hidden, true);
  assert.equal(dock.querySelector('.ask-pill').hidden, false);
  assert.equal(dock.querySelector('[data-view],[data-nav]'), null);
  assert.ok(calls.every((c) => !c.url.includes('/api/ask')), 'no ask fetch at boot — the repo-wide fence');
});

test('ui-ask-integration: ⌘K and Ctrl+K toggle with preventDefault', async () => {
  const { window } = await boot();
  const e1 = keydown(window, window.document.body, { key: 'k', metaKey: true });
  assert.equal(e1.defaultPrevented, true);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
  keydown(window, window.document.body, { key: 'k', metaKey: true });
  assert.equal(window.document.querySelector('.ask-sheet').hidden, true);
  keydown(window, window.document.body, { key: 'k', ctrlKey: true });
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
});

test('ui-ask-integration: the sheet survives view navigation', async () => {
  const { window } = await boot();
  await openSheet(window);
  go(window, 'running');
  go(window, 'history');
  go(window, 'settings');
  await settle(window);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
  assert.ok(window.document.querySelector('body > .ask-dock'));
});

test('ui-ask-integration: Escape is routed by focus location', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
  await settle(window);
  go(window, 'running/r1');
  await settle(window);
  assert.ok(window.document.querySelector('.run-shell').classList.contains('detail-open'), 'running detail open');
  await openSheet(window);
  const input = window.document.querySelector('textarea.ask-input');
  input.focus();
  keydown(window, input, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#running/r1', 'sheet-owned Escape left the detail alone');
  keydown(window, window.document.body, { key: 'k', metaKey: true }); // ⌘K closes the sheet
  await settle(window);
  keydown(window, window.document.body, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#running', 'document Escape still routes the detail back');
});

test('ui-ask-integration: ask frames reach the panel; runId frames do not', async () => {
  const { window, recv } = await boot();
  await openSheet(window);
  await sendText(window, 'stream something');
  recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'claude-opus-5', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  recv({ type: 'ask-delta', text: 'streamed!', threadId: TID, messageId: MID, seq: 2 });
  await settle(window);
  assert.match(window.document.querySelector('.ask-transcript').textContent, /streamed!/);
  recv({ type: 'state', runId: 'r1', status: 'running' }); // must not throw or touch the panel
  await settle(window);
  assert.match(window.document.querySelector('.ask-transcript').textContent, /streamed!/);
});

test('ui-ask-integration: hello without an ask field is tolerated', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [] });
  recv({ type: 'hello', runs: [], ask: [] });
  await settle(window);
  assert.ok(window.document.querySelector('body > .ask-dock'), 'still alive');
});

test('ui-ask-integration: body.rail-collapsed follows the sidebar toggle', async () => {
  const { window } = await boot();
  assert.equal(window.document.body.classList.contains('rail-collapsed'), false);
  window.document.querySelector('#side-toggle').click();
  assert.equal(window.document.body.classList.contains('rail-collapsed'), true);
  window.document.querySelector('#side-toggle').click();
  assert.equal(window.document.body.classList.contains('rail-collapsed'), false);
});

test('ui-ask-integration: delete flows through confirmModal and focus returns to the textarea', async () => {
  const { window, calls } = await boot();
  await openSheet(window);
  window.document.querySelector('[data-ask-threads-btn]').click();
  await settle(window);
  window.document.querySelector('.ask-thread-trash').click();
  await settle(window);
  const modal = window.document.querySelector('#confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the app confirmModal is up');
  assert.equal(window.document.querySelector('#confirm-title').textContent, 'Delete this chat?');
  window.document.querySelector('#confirm-ok').click();
  await settle(window, 6);
  assert.ok(calls.some((c) => c.url.includes(`/api/ask/threads/${TID}`) && c.opts.method === 'DELETE'));
  assert.equal(window.document.activeElement, window.document.querySelector('textarea.ask-input'));
});

test('ui-ask-integration: pointerdown inside .viewer-modal keeps the sheet open', async () => {
  const { window } = await boot();
  await openSheet(window);
  const viewer = window.document.querySelector('#viewer-card');
  viewer.classList.remove('hidden');
  pointerdown(window, viewer);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false);
  pointerdown(window, window.document.querySelector('.main'));
  assert.equal(window.document.querySelector('.ask-sheet').hidden, true, 'outside still closes');
});

test('ui-ask-integration: the send body carries the resolved page context', async () => {
  const { window, calls, recv } = await boot();
  await openSheet(window);
  await sendText(window, 'context check one');
  const post1 = calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(post1.opts.body).context, { view: 'new', projectDir: '/repos/proj', pinned: false }); // #397: Auto declares itself
  recv({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId: TID, messageId: MID, seq: 1 });
  recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
  await settle(window);
  go(window, 'running/r1');
  await settle(window);
  await sendText(window, 'context check two');
  const post2 = calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(post2.opts.body).context, { view: 'running', runId: 'r1', projectDir: '/p', pinned: false }); // #397
});
