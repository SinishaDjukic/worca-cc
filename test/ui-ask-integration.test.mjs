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
const FIX = { projects: null, workspaces: null };   // a test swaps the /api/projects and /api/workspaces rows; reset after each test
afterEach(() => { FIX.projects = null; FIX.workspaces = null; });

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
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: FIX.workspaces || [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: [], projectPaths: [] }] }) });
    }
    if (url2.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: FIX.projects || [{ name: 'proj', path: '/repos/proj', exists: true }] }) });
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

async function openChat(window) {
  go(window, 'chat');
  await settle(window);
}
async function sendText(window, text) {
  const input = window.document.querySelector('textarea.ask-input');
  input.value = text;
  window.document.querySelector('[data-ask-send]').click();
  await settle(window, 6);
}

test('ui-ask-integration: the boot opens Chat with the panel inside its section; a boot on #new fetches no /api/ask', async () => {
  await checkRows([
    { name: 'a bare boot lands on Chat: the panel root is a child of section[data-view="chat"]; no floating launcher', run: async () => {
      const { window } = await boot();
      const doc = window.document;
      assert.equal(window.location.hash, '#chat');
      const section = doc.querySelector('section.view[data-view="chat"]');
      assert.equal(section.classList.contains('hidden'), false);
      assert.ok(section.querySelector(':scope > .chat-page[data-chat-page]'), 'the panel root is mounted into the Chat section');
      assert.equal(doc.querySelector('.ask-dock, .ask-pill, .ask-tip, .ask-sheet, [data-ask-sheet]'), null);
    } },
    { name: 'a boot on #new: zero /api/ask fetches — the panel loads when Chat first shows', run: async () => {
      const { calls } = await boot({ url: 'http://localhost:4317/#new' });
      assert.ok(calls.every((c) => !c.url.includes('/api/ask')), 'no ask fetch at boot — the repo-wide fence');
    } },
  ]);
});

test('ui-ask-integration: on Chat, Escape closes a popover and routes nowhere; off Chat the panel never owns Escape — the Running page still steps back', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
  await settle(window);
  await openChat(window);
  window.document.querySelector('[data-ask-model-btn]').click();
  keydown(window, window.document.querySelector('textarea.ask-input'), { key: 'Escape' });
  await settle(window);
  assert.equal(window.document.querySelector('.ask-pop'), null, 'Escape closed the popover');
  assert.equal(window.location.hash, '#chat', 'and routed nowhere');
  window.document.querySelector('textarea.ask-input').focus();      // focus stays in the hidden composer as the user leaves
  go(window, 'running/r1');
  await settle(window);
  assert.ok(window.document.querySelector('.run-shell').classList.contains('detail-open'), 'running detail open');
  window.document.getElementById('runs-shell').dataset.layout = 'slide';
  keydown(window, window.document.body, { key: 'Escape' });
  await settle(window);
  assert.equal(window.location.hash, '#runs', 'slide: document Escape routes the detail back to the list');
});


test('ui-ask-integration: ask frames reach the panel, runId frames and an ask-less hello are ignored safely', async () => {
  const { window, recv } = await boot();
  await checkRows([
    { name: 'ui-ask-integration: ask frames reach the panel; runId frames do not', run: async () => {
      await openChat(window);
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
      assert.ok(window.document.querySelector('[data-view="chat"] > [data-chat-page]'), 'still alive');
    } },
  ]);
});

test('ui-ask-integration: delete flows through confirmModal and focus stays in the History column', async () => {
  const { window, calls } = await boot();
  await openChat(window);
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
  // jsdom is 1024px wide: the History column is an overlay over the chat, so focus stays in it, never under its scrim.
  assert.ok(window.document.querySelector('[data-chat-history]').contains(window.document.activeElement), 'focus stays in the History overlay');
});

test('ui-ask-integration: a Chat send carries { view: chat } (plus the run its panel shows); getPageContext still names every other page', async () => {
  const { window, calls, recv } = await boot();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lastCtx = () => JSON.parse(calls.filter((c) => c.url.includes('/messages') && c.opts.method === 'POST').at(-1).opts.body).context;
  await checkRows([
    { name: 'a send from Chat with no run panel: { view: chat } and no project (worca Chat R4)', run: async () => {
      await openChat(window);
      await sendText(window, 'context check one');
      assert.deepEqual(lastCtx(), { view: 'chat', pinned: false, timeZone: tz }); // P4: No project declares itself
    } },
    { name: 'with a run in the panel (P4\'s chatPanelContext) the send carries its ids', run: async () => {
      const run = { runId: '0f0f0f0f-0000-4000-8000-000000000001', pipelineId: 'aaaa1111', projectDir: '/p', runPage: 'logs' };
      window.__np.chat.setPanelContext(() => run);
      await sendText(window, 'context check two');
      const { projectDir, ...kept } = run;   // No project: the run's ids ride, its project folder does not (CONTRACT §4)
      assert.deepEqual(lastCtx(), { view: 'chat', ...kept, pinned: false, timeZone: tz });
      window.__np.chat.setPanelContext(null);
    } },
    { name: 'MCP registry §9.1 still holds for getPageContext: Running names its run, New Pipeline its project untagged, the generic fallback is tagged, a workspace page its workspace', run: async () => {
      const pc = () => window.__np.chat.getPageContext();
      recv({ type: 'hello', runs: [RUN_ROW], ask: [] });
      await settle(window);
      go(window, 'running/r1');
      await settle(window);
      assert.deepEqual(pc(), { view: 'running', runId: 'r1', projectDir: '/p', runPage: 'glance' });
      go(window, 'new');
      await settle(window);
      assert.equal(pc().projectDir, '/repos/proj');
      assert.equal(pc().projectSource, undefined, 'the New Pipeline page is ABOUT its project target');
      go(window, 'settings');
      await settle(window);
      assert.equal(pc().projectDir, '/repos/proj');
      assert.equal(pc().projectSource, 'fallback', 'the dropdown fallback is tagged');
      go(window, 'workspaces/wks-team-0000abcd');
      await settle(window, 10);
      assert.equal(pc().workspaceId, 'wks-team-0000abcd');
      assert.equal(pc().projectDir, undefined);
      assert.equal(pc().projectSource, undefined);
    } },
  ]);
});

test('ui-ask-integration P4: the scope menu\'s Add project… opens the Add project dialog; a projects-changed frame refreshes the menu', async () => {
  const { window, recv } = await boot();
  await openChat(window);
  const doc = window.document;
  const btn = doc.querySelector('[data-ask-scope-btn]');
  const names = () => [...doc.querySelectorAll('.ask-pop-scope .ask-scope-item .ask-model-name')].map((n) => n.textContent);
  btn.click(); await settle(window, 6);
  assert.deepEqual(names(), ['No project', 'Team', 'Add project…'], 'the boot fixture: no keyed project, one workspace; app.js set chatDeps.openAddProject');
  btn.click(); await settle(window);
  FIX.projects = [{ key: 'demo-00000001', name: 'Demo', path: '/repos/demo', exists: true, vcs: 'none' }];
  recv({ type: 'projects-changed', action: 'created' });
  await settle(window);
  btn.click(); await settle(window, 6);
  assert.deepEqual(names(), ['No project', 'Demo', 'Team', 'Add project…'], 'app.js → askPanel.optionsChanged()');
  btn.click(); await settle(window);
  FIX.workspaces = [];
  recv({ type: 'workspaces-changed', action: 'deleted', workspaceId: 'wks-team-0000abcd' });
  await settle(window);
  btn.click(); await settle(window, 6);
  assert.deepEqual(names(), ['No project', 'Demo', 'Add project…'], 'workspaces-changed → askPanel.optionsChanged() too');
  [...doc.querySelectorAll('.ask-pop-scope .ask-scope-item')].find((b) => b.textContent.includes('Add project…')).click();
  await settle(window, 6);
  assert.equal(doc.getElementById('project-add-modal').classList.contains('hidden'), false, 'chatDeps.openAddProject → addProjectFlow');
  assert.equal(doc.querySelector('.ask-pop-scope'), null);
});

test('ui-ask-integration P4: app.js registers the switch card before the chat mounts', async () => {
  const { window, recv } = await boot();
  await openChat(window);
  await sendText(window, 'the room photo is tiny on tablets');
  recv({ type: 'ask-message', threadId: TID, message: { id: 'askm_00000009', threadId: TID, seq: 3, role: 'assistant', text: '', status: 'done', createdAt: 't',
    blocks: [{ kind: 'card', id: 'card_00000009', state: 'proposed', card: { type: 'scope-switch', candidates: [{ projectKey: 'demo-00000001', name: 'Demo', path: '/repos/demo', vcs: 'git' }], reason: '' } }] } });
  await settle(window, 4);
  const card = window.document.querySelector('.ask-msg-assistant section.chat-rc-q.chat-q');
  assert.ok(card, 'the scope-switch type has a builder');
  assert.equal(card.querySelector('.chat-rc-q-head').textContent, 'Your turn: pick a project');
  const src = readFileSync(appPath, 'utf8');
  const at = src.indexOf('\nregisterScopeSwitchCard();\n');
  assert.ok(at > 0 && at < src.indexOf('\naskPanel = createAskPanel({'), 'CONTRACT §2: registered before createAskPanel runs');
});
