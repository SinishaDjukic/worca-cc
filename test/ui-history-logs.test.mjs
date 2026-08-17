import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for the History live-logs + clarify dropdowns. We boot the REAL
// app.js against the REAL index.html under jsdom (same harness as
// test/ui-history.test.mjs — the boot() helper there is private, so it is copied
// verbatim below), drive the History load, expand a card, and assert the
// Sub-agents -> Clarify -> Live-logs dropdown order, the clarify Q&A render, and
// the lazy NDJSON replay.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

// Boot app.js into a fresh jsdom window. `fetchHandler(url, opts)` may return a
// Promise to override a request; returning null falls through to the defaults.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the viewer modal calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    // Default boot fetches: /api/projects returns our one project so the select
    // can be populated; /api/config benign.
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  // Select our project the way a user would: set the <select> value + dispatch
  // change. This triggers onProjectChanged -> loadHistory(PROJECT).
  function selectProject() {
    const sel = window.document.querySelector('#projectSelect');
    sel.value = PROJECT;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  function showHistory() {
    window.location.hash = 'history';
    window.dispatchEvent(new window.Event('hashchange'));
  }

  return { window, calls, wsBox, selectProject, showHistory };
}

// Clarify now precedes Sub-agents: tab order is read as priority, and the answered
// Q&A is provenance (what the run was told to do) rather than a debugging tool.
// Live logs stay last, the deepest thing on the page.
test('expanded card shows Clarify, then Sub-agents, then Live-logs; logs render on open', async () => {
  const NDJSON =
    '{"source":"preflight","level":"info","text":"No knowledge-graph tooling detected","ts":"2026-06-20T00:00:00Z"}\n' +
    '{"source":"planner","level":"info","text":"Planning…","ts":"2026-06-20T00:00:01Z"}\n';

  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history/') && url.endsWith('/log')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => NDJSON });
      }
      if (url.includes('/api/history/') ) { // detail
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          state: { phase: 'done', status: 'done', cycle: 1, subAgents: [], steps: [], stepper: null },
          auditMarkdown: '',
          clarify: { questions: [{ id: 'q1', question: 'Where do logs live?', options: ['file','db'], allowFreeText: true }],
                     answers: [{ id: 'q1', question: 'Where do logs live?', choice: 'file' }] },
          reviews: [],
          artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],
        }) });
      }
      if (url.includes('/api/history')) { // list
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          pipelines: [{ id: 'p-1', projectKey: 'proj-00000001', title: 'Run', status: 'done', startedAt: '2026-06-20T00:00:00Z' }] }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const card = doc.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const detail = card.querySelector('.hist-detail');
  const clarifyBar = detail.querySelector('.clarify-bar');
  const logsBar = detail.querySelector('.logs-bar');
  assert.equal(clarifyBar, detail.querySelectorAll('.subs-bar,.clarify-bar,.logs-bar')[0],
    'clarify first — the decisions outrank the mechanics');
  assert.ok(!clarifyBar.hidden, 'clarify dropdown visible (Q&A present)');
  assert.ok(!logsBar.hidden, 'live-logs dropdown visible (artifact present)');
  // DOM order: clarify-bar precedes subs-bar precedes logs-bar
  const FOLLOWS = ctx.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(clarifyBar.compareDocumentPosition(detail.querySelector('.subs-bar')) & FOLLOWS, 'agents after clarify');
  assert.ok(clarifyBar.compareDocumentPosition(logsBar) & FOLLOWS, 'logs after clarify');

  // Open clarify -> question text appears
  clarifyBar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.match(clarifyBar.textContent, /Where do logs live\?/);
  assert.match(clarifyBar.textContent, /file/);

  // Open live-logs -> lazy fetch + render real log lines
  logsBar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const lines = logsBar.querySelectorAll('.logs-panel .log .log-line');
  assert.equal(lines.length, 2, 'two persisted lines rendered');
  assert.match(lines[0].textContent, /No knowledge-graph tooling detected/);
});

// The History replay rebuilds records from the NDJSON. `cycle` must survive that
// projection or the cycle picker and the separators are dead here while working
// on the live card.
test('replayed logs keep their cycle: picker, separator, search and copy all work', async () => {
  const NDJSON =
    '{"source":"planner","level":"info","text":"Planning…","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n' +
    '{"source":"reviewer","level":"info","text":"Blocking issue found","ts":"2026-06-20T00:00:02Z","stepIndex":1,"cycle":1}\n' +
    '{"source":"implementer","level":"info","text":"Fixing the issue","ts":"2026-06-20T00:00:03Z","stepIndex":1,"cycle":2}\n';

  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history/') && url.endsWith('/log')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => NDJSON });
      }
      if (url.includes('/api/history/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          state: { phase: 'done', status: 'done', cycle: 2, subAgents: [], steps: [], stepper: null },
          auditMarkdown: '', clarify: null, reviews: [],
          artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],
        }) });
      }
      if (url.includes('/api/history')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          pipelines: [{ id: 'p-1', projectKey: 'proj-00000001', title: 'Run', status: 'done', startedAt: '2026-06-20T00:00:00Z' }] }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const card = doc.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const logsBar = card.querySelector('.hist-detail .logs-bar');
  logsBar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const panel = logsBar.querySelector('.logs-panel');
  const cycleSel = panel.querySelector('.log-f-cycle');
  assert.ok(cycleSel, 'the cycle picker exists in History');
  assert.deepEqual([...cycleSel.options].map((o) => o.textContent), ['all cycles', 'cycle 1', 'cycle 2'],
    'cycles are NOT shifted for display (unlike steps, the loop counter is already 1-based)');

  assert.ok(panel.querySelector('.log-search'), 'search box present');
  assert.ok(panel.querySelector('.log-copy'), 'copy button present');

  const seps = panel.querySelectorAll('.log .log-sep');
  assert.equal(seps.length, 1, 'exactly one boundary among cycles 1,1,2');
  assert.equal(seps[0].textContent, 'Cycle 2');
  assert.equal(panel.querySelectorAll('.log .log-line').length, 3, 'separators are not log lines');

  // Narrowing to cycle 2 leaves one line and NO separator: it is the first
  // rendered record, so there is nothing above it to separate from.
  cycleSel.value = '2';
  cycleSel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(panel.querySelectorAll('.log .log-line').length, 1);
  assert.equal(panel.querySelectorAll('.log .log-sep').length, 0, 'no orphan separator');
  assert.match(panel.querySelector('.log .log-line').textContent, /Fixing the issue/);
});

test('dropdowns stay hidden when there is no clarify and no log artifact', async () => {
  const ctx = await boot({ fetchHandler: (url) => {
    if (url.includes('/api/history/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({
      state: { status: 'done', subAgents: [], steps: [], stepper: null }, auditMarkdown: '',
      clarify: { questions: [], answers: [] }, reviews: [], artifacts: [] }) });
    if (url.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({
      pipelines: [{ id: 'p-2', projectKey: 'proj-00000001', title: 'Run', status: 'done', startedAt: '2026-06-20T00:00:00Z' }] }) });
    return null;
  } });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const detail = card.querySelector('.hist-detail');
  assert.ok(detail.querySelector('.clarify-bar').hidden, 'no clarify -> hidden');
  assert.ok(detail.querySelector('.logs-bar').hidden, 'no log artifact -> hidden');
});
