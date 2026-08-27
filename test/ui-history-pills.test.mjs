// test/ui-history-pills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

// Newest-first, exactly as listAllPipelines returns it (server sorts by mtime desc).
const HISTORY = [
  { id: 'a2', title: 'Alpha two', status: 'done',    startedAt: '2026-06-04T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
  { id: 'b1', title: 'Beta one',  status: 'done',    startedAt: '2026-06-03T00:00:00Z', projectName: 'Beta',  projectKey: 'beta-00000002',  projectDir: '/x/beta' },
  { id: 'a1', title: 'Alpha one', status: 'stopped', startedAt: '2026-06-01T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
];
const histResp = (pipelines, ghAvailable = false) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, ghAvailable }) });
const norm = (s) => s.replace(/\s+/g, ' ').trim();

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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  function showHistory() { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); }
  return { window, showHistory };
}

test('History shows All Projects + per-project pills and groups sticky sections', async () => {
  const { window, showHistory } = await boot({ fetchHandler: (url) => url.includes('/api/history') ? histResp(HISTORY) : null });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;

  const pills = [...doc.querySelectorAll('#historyFilter .hist-pill')];
  assert.equal(pills.length, 3, 'All Projects + Alpha + Beta');
  assert.equal(norm(pills[0].textContent), 'All Projects 3');
  assert.ok(pills[0].classList.contains('active'), 'All Projects active by default');

  const groups = [...doc.querySelectorAll('#history .hist-group')];
  assert.equal(groups.length, 2, 'one section per project');
  assert.equal(norm(groups[0].querySelector('.hist-group-head').textContent), 'Alpha 2', 'Alpha first (most recent activity)');
  assert.equal(norm(groups[1].querySelector('.hist-group-head').textContent), 'Beta 1');
  assert.equal(doc.querySelectorAll('#history .hist-card').length, 3);
  assert.equal(doc.querySelector('#nav-history-count').textContent, '3');
  // No <li> ever (regression guard kept from ui-history).
  assert.equal(doc.querySelectorAll('#history li').length, 0);
});

test('clicking a project pill filters to that project (flat) and persists the choice', async () => {
  const { window, showHistory } = await boot({ fetchHandler: (url) => url.includes('/api/history') ? histResp(HISTORY) : null });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;

  const beta = [...doc.querySelectorAll('#historyFilter .hist-pill')].find((b) => b.dataset.projectKey === 'beta-00000002');
  beta.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  // The pill row is rebuilt on filter change (host.innerHTML = ''), so the captured
  // `beta` node is now detached — re-query the active pill instead of asserting on it.
  const active = doc.querySelector('#historyFilter .hist-pill.active');
  assert.equal(active.dataset.projectKey, 'beta-00000002', 'Beta pill is active after click');
  assert.equal(doc.querySelectorAll('#history .hist-group').length, 0, 'no grouping for a single project');
  assert.equal(doc.querySelectorAll('#history .hist-card').length, 1, 'only Beta pipelines');
  assert.match(doc.querySelector('#history').textContent, /Beta one/);
  // Sidebar badge stays at the TOTAL across all projects regardless of the active
  // filter (clarification Q4): the Beta pill narrows the list to 1 card, but the badge
  // still reads the full 3.
  assert.equal(doc.querySelector('#nav-history-count').textContent, '3');
  assert.equal(window.localStorage.getItem('worca-cc.history.project'), 'beta-00000002', 'choice persisted');
});

test('restores the remembered project filter on load', async () => {
  const { window, showHistory } = await boot({
    local: { 'worca-cc.history.project': 'beta-00000002' },
    fetchHandler: (url) => url.includes('/api/history') ? histResp(HISTORY) : null,
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const active = window.document.querySelector('#historyFilter .hist-pill.active');
  assert.equal(active.dataset.projectKey, 'beta-00000002');
  assert.equal(window.document.querySelectorAll('#history .hist-card').length, 1);
});

test('a remembered project with no history falls back to All Projects', async () => {
  const { window, showHistory } = await boot({
    local: { 'worca-cc.history.project': 'gone-99999999' },
    fetchHandler: (url) => url.includes('/api/history') ? histResp(HISTORY) : null,
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const active = window.document.querySelector('#historyFilter .hist-pill.active');
  assert.equal(active.dataset.projectKey, '', 'defaults to All Projects');
  assert.equal(window.document.querySelectorAll('#history .hist-group').length, 2);
});

test('Refresh re-fetches /api/history and keeps the active project filter', async () => {
  let hits = 0;
  const { window, showHistory } = await boot({
    local: { 'worca-cc.history.project': 'beta-00000002' },
    // Count only the skeleton GET; the Phase-2 POST /api/history/pr is a separate
    // trigger, not a refetch of the history list.
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return null;
      if (url.includes('/api/history')) { hits++; return histResp(HISTORY); }
      return null;
    },
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  // Don't assume exactly one hit here: setting location.hash can make jsdom fire a
  // native hashchange in addition to our manual dispatch. Assert the refresh adds one.
  const before = hits;
  assert.ok(before >= 1, 'history fetched when the view is shown');
  window.document.querySelector('#refresh-history').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(hits, before + 1, 'refresh refetches exactly once');
  assert.equal(window.document.querySelector('#historyFilter .hist-pill.active').dataset.projectKey, 'beta-00000002');
});
