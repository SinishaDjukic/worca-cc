// test/ui-engine-setup-app.test.mjs — Connect <engine> inside the real app (app.js boots in jsdom): Chat's model picker
// opens the setup dialog for an engine that is not installed, whichever engine it is; the dialog asks
// GET /api/engines/<engine>/setup on open and again (past the cache) on Check again; and the same dialog still opens on
// Claude Code with Getting started's status. One boot for the file (tools/suite-guard.mjs): each test sets the
// engine answers it needs and starts with the dialog and the menu closed.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { CHAT_ENGINE_NAMES } from '../src/shared/engine-switch.mjs';

const trackDom = useDomRelease(after);
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const NOT_READY = Object.fromEntries(CHAT_ENGINE_NAMES.map((e) => [e, `${e} is not installed: ${e} was not found.`]));
const CATALOG = { models: [], efforts: ['low', 'medium', 'high'], default: null, defaults: {}, askEngine: 'claude', notReady: NOT_READY,
  setupDocs: Object.fromEntries(CHAT_ENGINE_NAMES.map((e) => [e, `https://docs.example.test/${e}`])) };
const ONBOARDING = { steps: { claude: false }, done: 0, total: 9, hidden: false, welcomeSeen: true, setupFinished: true,
  claude: { bin: 'claude', hint: null, auth: null } };

// The file's one app: `answers.setup` is the current test's GET /api/engines/<engine>/setup answer (an object by engine,
// or (engine, recheck) => answer); `calls` is emptied before each test.
const answers = { setup: {} };
let app = null;
async function boot() {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
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
  const opened = [];
  window.open = (...a) => { opened.push(a); return null; };
  window.fetch = (u, opts) => {
    const url = String(u);
    calls.push(url);
    const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url === '/api/ask/models') return ok(CATALOG);
    if (url.startsWith('/api/onboarding')) return ok(ONBOARDING);
    const m = url.match(/^\/api\/engines\/([a-z]+)\/setup(\?recheck=1)?$/);
    if (m) {
      const s = typeof answers.setup === 'function' ? answers.setup(m[1], !!m[2]) : answers.setup[m[1]];
      return s ? ok(s) : ok({ error: 'not a chat engine' }, 404);
    }
    if (url.startsWith('/api/ask/threads')) return ok({ threads: [], total: 0 });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  window.__worcaTestHooks = { askMarkdown: async () => { throw new Error('markdown disabled here'); } };
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  lastWs._l.open?.forEach((fn) => fn());
  await settle();
  return { window, doc: window.document, calls, opened };
}
before(async () => { app = await boot(); });
beforeEach(() => {
  const { doc } = app;
  if (!modal(doc).classList.contains('hidden')) doc.getElementById('engine-setup-close').click();
  if (doc.querySelector('.ask-pop-model')) doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  app.calls.length = 0;
  app.opened.length = 0;
});
const page = (doc) => doc.querySelector('[data-chat-page]');
async function openRow(doc, engine) {
  page(doc).querySelector('[data-ask-model-btn]').click();
  await settle();
  const row = doc.querySelector(`.ask-pop-model [data-ask-harness="${engine}"]`);
  assert.ok(row, `a setup row for ${engine}`);
  row.click();
  await settle();
}
const modal = (doc) => doc.getElementById('engine-setup-modal');

test('Chat with no harness installed: each engine\'s row opens Connect <engine>, never the docs', async () => {
  answers.setup = Object.fromEntries(CHAT_ENGINE_NAMES.map((e) => [e, { name: e, bin: e, installed: false, missing: NOT_READY[e], ready: false, reason: null }]));
  const { doc, opened } = app;
  assert.equal(page(doc).querySelector('.ask-model-btn-label').textContent, 'Set up a harness');
  for (const e of CHAT_ENGINE_NAMES) {
    await openRow(doc, e);
    assert.equal(modal(doc).classList.contains('hidden'), false, `${e}: the dialog is open`);
    assert.match(doc.getElementById('engine-setup-title').textContent, /^Connect /);
    doc.getElementById('engine-setup-close').click();
    assert.equal(modal(doc).classList.contains('hidden'), true);
  }
  assert.deepEqual(opened, [], 'no docs tab');
});

test('Connect OpenAI Codex: its install and sign-in, asked on open, Check again past the cache, a line every time', async () => {
  let installed = false;
  answers.setup = (e) => (e === 'codex'
    ? (installed ? { name: 'codex', bin: 'codex', installed: true, missing: null, ready: false, reason: 'Codex is not signed in — run codex login' }
      : { name: 'codex', bin: 'codex', installed: false, missing: NOT_READY.codex, ready: false, reason: null })
    : null);
  const { doc, calls } = app;
  await openRow(doc, 'codex');
  assert.equal(doc.getElementById('engine-setup-title').textContent, 'Connect OpenAI Codex');
  const cmds = [...doc.querySelectorAll('#engine-setup-guide pre code')].map((n) => n.textContent);
  assert.deepEqual(cmds, ['npm install -g @openai/codex', 'codex login']);
  assert.ok([...doc.querySelectorAll('#engine-setup-guide code')].some((c) => c.textContent === 'WORCA_CODEX_BIN'));
  assert.equal(doc.querySelector('#engine-setup-guide a[href*="docs/models.md"]'), null, 'no docs sentence in the body');
  const docs = doc.getElementById('engine-setup-docs');
  assert.ok(docs.closest('.dlg-foot .stop-actions'), 'the docs link sits in the foot, beside Check again');
  assert.equal(docs.nextElementSibling, doc.getElementById('engine-setup-check'), 'at its start, opposite Check again');
  assert.deepEqual([docs.textContent, docs.getAttribute('href'), docs.target, docs.rel, docs.getAttribute('aria-label')],
    ['Docs ↗', 'https://github.com/worca-org/worca/blob/dev/docs/models.md#codex', '_blank', 'noopener noreferrer', 'OpenAI Codex setup in the docs']);
  assert.deepEqual(calls.filter((u) => u.startsWith('/api/engines/')), ['/api/engines/codex/setup'], 'asked on open, from the cache');
  const box = doc.getElementById('engine-setup-status');
  assert.match(box.className, /\berr\b/);
  assert.match(box.textContent, /^codex is not installed: codex was not found\. Then check again \(restart the UI if PATH changed\)\./);
  assert.equal(box.querySelector('.ob-setup-checked'), null, 'the check on open leaves no "Checked just now" line');
  installed = true;
  doc.getElementById('engine-setup-check').click();
  await settle();
  assert.equal(calls.at(-1), '/api/engines/codex/setup?recheck=1', 'Check again asks anew');
  assert.match(box.textContent, /^Found codex, but it is not ready yet: Codex is not signed in — run codex login\. Sign it in, then check again\./);
  assert.equal(box.querySelector('.ob-setup-checked').textContent, 'Checked just now: still not ready.');
  assert.equal(doc.getElementById('engine-setup-check').disabled, false);
});

test('a failed check says so; the dialog then opens on Claude Code with Getting started\'s status', async () => {
  answers.setup = {};
  const { doc, calls } = app;
  await openRow(doc, 'goose');
  assert.equal(doc.getElementById('engine-setup-title').textContent, 'Connect Goose');
  doc.getElementById('engine-setup-check').click();
  await settle();
  assert.equal(doc.querySelector('#engine-setup-status .ob-setup-checked').textContent, "Couldn't check just now: not a chat engine");
  doc.getElementById('engine-setup-close').click();
  await openRow(doc, 'claude');
  assert.equal(doc.getElementById('engine-setup-title').textContent, 'Connect Claude Code');
  assert.deepEqual([...doc.querySelectorAll('#engine-setup-guide pre code')].map((n) => n.textContent), ['npm install -g @anthropic-ai/claude-code', 'claude']);
  const docs = doc.getElementById('engine-setup-docs');
  assert.deepEqual([docs.getAttribute('href'), docs.getAttribute('aria-label')],
    ['https://github.com/worca-org/worca/blob/dev/docs/models.md#claude-code', 'Claude Code setup in the docs'], 'Claude\'s dialog has the same link');
  assert.ok(calls.includes('/api/onboarding?recheck=1'), 'Claude asks Getting started, not the engine route');
  assert.ok(!calls.includes('/api/engines/claude/setup'));
  assert.match(doc.getElementById('engine-setup-status').textContent, /"claude" is not on the PATH of the Worca server/);
  assert.equal(doc.querySelector('#engine-setup-status .ob-setup-checked'), null, 'no line left over from Goose');
});
