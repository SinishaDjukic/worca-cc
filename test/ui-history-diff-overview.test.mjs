// test/ui-history-diff-overview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// --- boot(): adapted from test/ui-history-logs.test.mjs:21‑94 (private helper) ---
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  function showHistory() { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); }
  return { window, calls, wsBox, showHistory };
}

// --- fixtures ---
function listResponse(id = 'p-1') {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({
    pipelines: [{ id, projectKey: 'proj-00000001', title: 'Run', status: 'done', startedAt: '2026-06-20T00:00:00Z' }],
  }) });
}
function detailResponse({ results, overview = null }) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({
    state: { phase: 'done', status: 'done', cycle: 1, subAgents: [], steps: [], stepper: null },
    auditMarkdown: '', clarify: { questions: [], answers: [] }, reviews: [],
    results, overview, artifacts: [],
  }) });
}
const RESULTS = {
  summary: { filesNew: 0, filesChanged: 1, filesDeleted: 0, linesAdded: 2, linesRemoved: 0, blockingIssues: 0 },
  newFiles: [],
  changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 0 }],
  keyThingsToCheck: [],
};

async function openCard(fetchHandler) {
  const ctx = await boot({ fetchHandler });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // resolve lazy detail fetch
  return { ctx, card, detail: card.querySelector('.hist-detail') };
}

test('header keeps ONLY the status pill (no "N changed", no "+X / −Y")', async () => {
  const { detail } = await openCard((url) => {
    if (url.includes('/api/history/')) return detailResponse({ results: RESULTS });
    if (url.includes('/api/history')) return listResponse();
    return null;
  });
  const chips = detail.querySelectorAll('.results-section .results-chips .results-chip');
  assert.equal(chips.length, 1, 'exactly one chip remains');
  assert.equal(chips[0].textContent, 'Clean');
  const text = detail.querySelector('.results-section .results-chips').textContent;
  assert.doesNotMatch(text, /changed/, 'no "N changed" pill');
  assert.doesNotMatch(text, /[+−]/, 'no "+X / −Y" pill');
});

test('Diff dropdown: collapsed, always-on badges, lists render on open', async () => {
  const { ctx, detail } = await openCard((url) => {
    if (url.includes('/api/history/')) return detailResponse({ results: RESULTS });
    if (url.includes('/api/history')) return listResponse();
    return null;
  });
  const diff = detail.querySelector('.diff-bar');
  assert.ok(diff && !diff.hidden, 'Diff dropdown visible');
  const btn = diff.querySelector('.btn-subs');
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'collapsed by default');
  assert.equal(diff.querySelector('.diff-panel').hidden, true, 'panel hidden by default');

  // Always-on badges (even the zero one), with grey applied at zero.
  const changed = diff.querySelector('.diff-changed');
  const removed = diff.querySelector('.diff-removed');
  assert.equal(changed.textContent, '1 changed');
  assert.equal(removed.textContent, '0 removed');
  assert.ok(!changed.classList.contains('grey'), 'non-zero badge not greyed');
  assert.ok(removed.classList.contains('grey'), 'zero badge greyed');

  // Open -> file lists render inside the panel.
  btn.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const panel = diff.querySelector('.diff-panel');
  assert.equal(panel.hidden, false);
  const heads = [...panel.querySelectorAll('.results-files-h')].map((h) => h.textContent);
  assert.deepEqual(heads, ['New files (0)', 'Changed files (1)']);
  assert.match(panel.textContent, /src\/a\.js/);
});

test('Overview dropdown: button only appears after expanding', async () => {
  const { ctx, detail } = await openCard((url) => {
    if (url.includes('/api/history/')) return detailResponse({ results: { ...RESULTS, summary: { ...RESULTS.summary, filesChanged: 1 } } });
    if (url.includes('/api/history')) return listResponse();
    return null;
  });
  const ov = detail.querySelector('.overview-bar');
  assert.ok(ov && !ov.hidden, 'Overview dropdown visible');
  assert.equal(ov.querySelector('.btn-subs').getAttribute('aria-expanded'), 'false', 'collapsed');
  assert.equal(ov.querySelector('.results-overview-btn'), null, 'no Generate button before expand');

  ov.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const genBtn = ov.querySelector('.overview-panel .results-overview-btn');
  assert.ok(genBtn, 'Generate button appears after expand');
  assert.equal(genBtn.textContent, 'Generate overview');
  assert.equal(genBtn.disabled, false, 'enabled because there is a diff to summarize');
});

test('Overview dropdown: pre-generated overview paints on first open', async () => {
  const { ctx, detail } = await openCard((url) => {
    if (url.includes('/api/history/')) return detailResponse({
      results: RESULTS, overview: { narrative: 'Refactored the widget.', diffFindings: [] },
    });
    if (url.includes('/api/history')) return listResponse();
    return null;
  });
  const ov = detail.querySelector('.overview-bar');
  ov.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ov.querySelector('.results-overview-btn').textContent, 'Regenerate overview');
  assert.match(ov.querySelector('.overview-panel').textContent, /Refactored the widget\./);
});
