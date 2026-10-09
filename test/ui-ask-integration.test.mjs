// test/ui-ask-integration.test.mjs — the ask panel inside the real app shell
// (spec §10.2 seams 1-6, §12 ui-ask-integration). Boot preamble copied from
// test/ui-running-routing.test.mjs:34-94 (the house convention: duplicated per
// suite, no shared harness), with /api/ask fetch arms added and the
// __worcaTestHooks.askMarkdown hook set before the import.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function askArms(url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  if (url.includes('/api/ask/models')) {
    return { ok: true, status: 200, json: async () => ({ models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false }], efforts: ['medium', 'high', 'xhigh', 'max'] }) };
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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
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
    if (url2.includes('/api/workspaces')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: [], projectPaths: [] }] }) });
    }
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
  window.document.querySelector('.ask-header button[aria-label="Close"]').click();
  await settle(window);
  keydown(window, window.document.body, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#running/r1',
    'side by side, document Escape on the glance keeps the pane (D16): the list is already in view');
  assert.ok(window.document.querySelector('.run-shell').classList.contains('detail-open'));

  // The narrow slide layout, where the glance's Escape DOES route back to the list: there a
  // sheet-owned Escape that leaked to the document would visibly navigate.
  window.document.getElementById('runs-shell').dataset.layout = 'slide';
  await openSheet(window);
  assert.equal(window.document.querySelector('.ask-sheet').hidden, false, 'the sheet is open again');
  const input2 = window.document.querySelector('textarea.ask-input');
  input2.focus();
  keydown(window, input2, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#running/r1', 'slide: sheet-owned Escape still leaves the detail alone');
  window.document.querySelector('.ask-header button[aria-label="Close"]').click();
  await settle(window);
  keydown(window, window.document.body, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#runs', 'slide: document Escape still routes the detail back to the list');
});

test('ui-ask-integration: ask frames reach the panel, runId frames and an ask-less hello are ignored safely', async () => {
  const { window, recv } = await boot();
  await checkRows([
    { name: 'ui-ask-integration: ask frames reach the panel; runId frames do not', run: async () => {
      await openSheet(window);
      await sendText(window, 'stream something');
      recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'claude-opus-5-5', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
      recv({ type: 'ask-delta', text: 'streamed!', threadId: TID, messageId: MID, seq: 2 });
      await settle(window);
      assert.match(window.document.querySelector('.ask-transcript').textContent, /streamed!/);
      recv({ type: 'state', runId: 'r1', status: 'running' }); // must not throw or touch the panel
      await settle(window);
      assert.match(window.document.querySelector('.ask-transcript').textContent, /streamed!/);
    } },
    { name: 'ui-ask-integration: hello without an ask field is tolerated', run: async () => {
      recv({ type: 'hello', runs: [] });
      recv({ type: 'hello', runs: [], ask: [] });
      await settle(window);
      assert.ok(window.document.querySelector('body > .ask-dock'), 'still alive');
    } },
  ]);
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

test('ui-ask-integration: the send body carries the resolved page context (new / running / settings fallback tagged / workspace)', async () => {
  const { window, calls, recv } = await boot();
  // One boot, sequential sends across views.
  await checkRows([
    { name: 'ui-ask-integration: the send body carries the resolved page context', run: async () => {
      await openSheet(window);
      await sendText(window, 'context check one');
      const post1 = calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1);
      assert.deepEqual(JSON.parse(post1.opts.body).context, { view: 'new', projectDir: '/repos/proj', pinned: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); // #397: Auto declares itself
      recv({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId: TID, messageId: MID, seq: 1 });
      recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
      await settle(window);
      go(window, 'running/r1');
      await settle(window);
      await sendText(window, 'context check two');
      const post2 = calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1);
      assert.deepEqual(JSON.parse(post2.opts.body).context, { view: 'running', runId: 'r1', projectDir: '/p', runPage: 'glance', pinned: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); // #397
    } },
    { name: 'MCP registry §9.1: New Pipeline names its project untagged, a workspace page its workspace; the generic fallback is tagged', run: async () => {
      const lastCtx = () => JSON.parse(calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1).opts.body).context;
      const done = () => recv({ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId: TID, messageId: MID, seq: 1 });
      done();                                          // the previous row left its second turn open
      go(window, 'new');                               // back to New Pipeline for this row's first send
      await settle(window);
      await openSheet(window);
      await sendText(window, 'on new pipeline');
      assert.equal(lastCtx().projectDir, '/repos/proj');
      assert.equal(lastCtx().projectSource, undefined, 'the New Pipeline page is ABOUT its project target');
      done();
      go(window, 'settings');
      await settle(window);
      await sendText(window, 'on settings');
      assert.equal(lastCtx().projectDir, '/repos/proj');
      assert.equal(lastCtx().projectSource, 'fallback', 'the dropdown fallback is tagged');
      done();
      go(window, 'workspaces/wks-team-0000abcd');
      await settle(window, 10);
      await sendText(window, 'on a workspace page');
      assert.equal(lastCtx().workspaceId, 'wks-team-0000abcd');
      assert.equal(lastCtx().projectDir, undefined);
      assert.equal(lastCtx().projectSource, undefined);
    } },
  ]);
});
