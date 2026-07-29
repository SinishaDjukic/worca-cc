// test/ui-history-sticky-header.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

// Same anchored helper idiom as test/ui-pinned-sidebar.test.mjs: extract a flat
// rule body, anchored on a non-word char (or start) so we don't match a longer
// selector that merely ends with the same suffix.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

// ---------- CSS-string assertions ----------

test('the History filter pills are a persistent sticky toolbar pinned to the top', () => {
  const body = ruleBody('.hist-filter');
  assert.ok(body, '.hist-filter rule must exist');
  assert.match(body, /position:\s*sticky/, 'pills must be a sticky toolbar');
  assert.match(body, /top:\s*0/, 'toolbar pins at the top of the scroll area');
  assert.match(body, /z-index:\s*[5-9]\d*/, 'toolbar must stack above the project header (z-index 3)');
  assert.match(body, /background:\s*var\(--bg\)/, 'opaque background so scrolled cards do not show through');
});

test('the per-project header sticks just below the pinned toolbar, not behind it', () => {
  const body = ruleBody('.hist-group-head');
  assert.ok(body, '.hist-group-head rule must exist');
  assert.match(body, /position:\s*sticky/, 'header stays sticky');
  assert.match(body, /top:\s*var\(--hist-toolbar-h/, 'header offsets by the measured toolbar height');
  assert.match(body, /background:\s*var\(--bg\)/, 'header keeps its opaque background');
});

test('the History scroll area drops its top padding so sticky elements pin flush (kills the peek-through band)', () => {
  const body = ruleBody('body.view-history .main');
  assert.ok(body, 'body.view-history .main rule must exist');
  assert.match(body, /padding-top:\s*0/, 'no top padding for sticky to fight while History is active');
});

test('the History view re-applies the 26px top inset internally so the unscrolled layout is unchanged', () => {
  // matched directly on the stylesheet because attribute selectors are awkward through ruleBody()
  assert.match(
    css,
    /\.view\[data-view="history"\]\s*\{[^}]*padding-top:\s*26px/,
    'the view itself carries the top inset that .main no longer provides',
  );
});

// ---------- DOM behavior (boot the real app under jsdom) ----------
// boot()/HISTORY/histResp copied verbatim from test/ui-history-pills.test.mjs.
// boot() takes { fetchHandler, local }, returns { window, showHistory }, and
// showHistory() navigates to the History view (hash -> hashchange -> showView).

const HISTORY = [
  { id: 'a2', title: 'Alpha two', status: 'done',    startedAt: '2026-06-04T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
  { id: 'b1', title: 'Beta one',  status: 'done',    startedAt: '2026-06-03T00:00:00Z', projectName: 'Beta',  projectKey: 'beta-00000002',  projectDir: '/x/beta' },
  { id: 'a1', title: 'Alpha one', status: 'stopped', startedAt: '2026-06-01T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
];
const histResp = (pipelines, ghAvailable = false) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, ghAvailable }) });

async function boot({ fetchHandler, local } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  // Pre-seed localStorage BEFORE app.js boots so restore-on-load is exercised.
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  function showHistory() { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); }
  return { window, showHistory };
}

test('entering the History view flags <body> so CSS can pin the toolbar flush', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? histResp(HISTORY) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(window.document.body.classList.contains('view-history'),
    'showView("history") must add the view-history body class');
});

test('the History view exposes the toolbar height as --hist-toolbar-h for the sticky header', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? histResp(HISTORY) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const view = window.document.querySelector('.view[data-view="history"]');
  assert.ok(view, 'history view exists');
  // jsdom has no layout (offsetHeight === 0) so the value is "0px", but it must be SET,
  // proving renderHistoryPills() ran the measurement wiring.
  assert.ok(view.style.getPropertyValue('--hist-toolbar-h').endsWith('px'),
    '--hist-toolbar-h must be written onto the history view after pills render');
});
