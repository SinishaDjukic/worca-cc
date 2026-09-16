// test/ui-workspaces.test.mjs — jsdom boot tests for the Workspaces management
// view: render, the empty placeholder, stale-member badge, edit-description PATCH,
// delete (200 + 409-keep), and the no-add/remove-project invariant (read-only set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const WS = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# Workspace: Alpha\n## Overview\ntwo svcs', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
  { id: 'wks-beta-00000002', name: 'Beta WS', description: '', projectPaths: ['/b/api', '/b/web'], projectKeys: ['k3', 'k4'], exists: [true, false], createdAt: 'x', updatedAt: 'x' },
];

// A WebSocket stub that actually stores listeners (unlike the bare no-op below), so a test
// can deliver a 'team-metrics-changed' server frame into app.js's 'message' listener.
class WSStub {
  constructor() { this.readyState = 1; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

const TM_SCOPES = {
  projects: [],
  workspaces: [
    { id: 'wks-alpha-00000001', name: 'Alpha WS', projectPaths: WS[0].projectPaths, home: { state: 'ok', slug: 'acme/gateway', runs: 12 }, members: [], counts: { recordsHere: 1, routed: 0, notRecording: 1 } },
    { id: 'wks-beta-00000002', name: 'Beta WS', projectPaths: WS[1].projectPaths, home: { state: 'unset' }, members: [], counts: {} },
  ],
  scopes: { projects: [], workspaces: [] },
  anyEnabled: true,
};

async function boot({ fetchHandler, workspaces = WS } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const show = () => { window.location.hash = 'workspaces'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, show, ws: () => WSStub.last };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

test('renders one card per workspace + the nav count, with read-only projectPaths', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const cards = [...doc.querySelectorAll('#ws-list .ws-card')];
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('.ws-name').textContent, 'Alpha WS');
  assert.equal(cards[0].querySelector('.ws-projects').textContent, 'svc-iam · svc-ui', 'basenames joined by " · "');
  assert.equal(doc.querySelector('#nav-workspaces-count').textContent, '2');
  // Invariant (a): NO add/remove-project control on the card.
  assert.equal(cards[0].querySelector('[class*="add-project"]'), null, 'no add-project UI on a workspace card');
});

test('empty state renders the histEmpty placeholder', async () => {
  const { window, show } = await boot({ workspaces: [] });
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#ws-list .ws-card').length, 0);
  assert.equal(doc.querySelectorAll('#ws-list .hist-empty').length, 1);
  assert.equal(doc.querySelector('#nav-workspaces-count').textContent, '0');
});

test('stale-member badge shows when any member is missing', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const cards = [...doc.querySelectorAll('#ws-list .ws-card')];
  assert.equal(cards[0].querySelector('.ws-stale').hidden, true, 'Alpha (all present) → no badge');
  assert.equal(cards[1].querySelector('.ws-stale').hidden, false, 'Beta (a member missing) → badge shown');
});

test('header click toggles the detail pane (description shown verbatim in <pre>)', async () => {
  const { window, show } = await boot();
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const card = doc.querySelector('#ws-list .ws-card');
  const detail = card.querySelector('.ws-detail');
  assert.equal(detail.hidden, true, 'collapsed initially');
  click(window, card.querySelector('.ws-head'));
  assert.equal(detail.hidden, false, 'expanded after header click');
  assert.equal(card.querySelector('.ws-head').getAttribute('aria-expanded'), 'true');
  assert.equal(card.querySelector('.ws-desc-view').tagName, 'PRE');
  assert.match(card.querySelector('.ws-desc-view').textContent, /two svcs/);
});

test('edit → PATCH /api/workspaces/:id { description }; state + DOM update, JSON-safe', async () => {
  const patches = [];
  const { window, show } = await boot({
    fetchHandler: (u, opts) => {
      if (/\/api\/workspaces\/wks-alpha-00000001$/.test(u) && opts.method === 'PATCH') {
        patches.push({ url: u, body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: { ...WS[0], description: JSON.parse(opts.body).description } }) });
      }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const card = doc.querySelector('#ws-list .ws-card');
  click(window, card.querySelector('.ws-edit'));
  const input = card.querySelector('.ws-desc-input');
  assert.equal(input.value, WS[0].description, 'edit pane seeded with current text');
  const next = '# Workspace: Alpha\nedited <b>not html</b>';
  input.value = next;
  click(window, card.querySelector('.ws-desc-save'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(patches.length, 1, 'one PATCH');
  assert.equal(patches[0].body.description, next, 'description sent (JSON.stringify) verbatim');
  assert.equal('projectPaths' in patches[0].body, false, 'PATCH never sends projectPaths (immutable set)');
  // The card re-rendered with the new text — bound as text, not parsed as HTML.
  const view = doc.querySelector('#ws-list .ws-card .ws-desc-view');
  assert.match(view.textContent, /edited <b>not html<\/b>/, 'new description shown verbatim');
  assert.equal(view.querySelector('b'), null, 'no element parsed from the description');
});

test('delete 200 removes the card + decrements the count', async () => {
  const { window, show } = await boot({
    fetchHandler: (u, opts) => /\/api\/workspaces\/wks-beta-00000002$/.test(u) && opts.method === 'DELETE'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, warnings: [] }) }) : null,
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const beta = [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-beta-00000002');
  click(window, beta.querySelector('.ws-delete'));
  await confirmDialog(window);
  assert.equal(doc.querySelectorAll('#ws-list .ws-card').length, 1, 'Beta removed');
  assert.equal(doc.querySelector('#nav-workspaces-count').textContent, '1');
});

test('delete 409 (live run) keeps the card + surfaces the error', async () => {
  const { window, show } = await boot({
    fetchHandler: (u, opts) => /\/api\/workspaces\/wks-alpha-00000001$/.test(u) && opts.method === 'DELETE'
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'a run is in progress for this workspace' }) }) : null,
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const alpha = [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-alpha-00000001');
  click(window, alpha.querySelector('.ws-delete'));
  await confirmDialog(window);
  assert.equal(doc.querySelectorAll('#ws-list .ws-card').length, 2, 'card kept on 409');
  assert.match(doc.querySelector('#ws-msg').textContent, /run is in progress/, 'verbatim 409 error');
});

test('Create workspace button routes to the wizard (#workspace-create)', async () => {
  const { window, show } = await boot({ workspaces: [] });
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  click(window, doc.querySelector('#ws-create-btn'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.location.hash, '#workspace-create');
  assert.equal(doc.querySelector('.view[data-view="workspace-create"]').classList.contains('hidden'), false);
});

test('Re-scan enters the wizard at Step 2 with editingId set (Save will PATCH)', async () => {
  const posts = [];
  const metricsScans = [];
  const { window, show } = await boot({
    fetchHandler: (u, opts) => {
      if (/\/api\/workspaces\/metrics-scan$/.test(u) && opts.method === 'POST') {
        metricsScans.push(JSON.parse(opts.body || '{}'));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ members: [] }) });
      }
      if (/\/api\/workspaces\/wks-alpha-00000001\/scan$/.test(u) && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body || '{}'));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ scanId: 'scan_rescan' }) });
      }
      return null;
    },
  });
  show();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  const alpha = [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-alpha-00000001');
  click(window, alpha.querySelector('.ws-rescan'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.location.hash, '#workspace-create', 'navigated to the wizard');
  assert.equal(doc.querySelector('#wiz-step-2').classList.contains('hidden'), false, 'on Step 2 (scanning)');
  assert.equal(posts.length, 1, 're-scan POSTed to :id/scan');
  assert.deepEqual(posts[0], {}, 're-scan body is empty (server reads the persisted set)');
  assert.equal(metricsScans.length, 1, 're-scan also refreshes member discovery');
  assert.deepEqual(metricsScans[0], { projectPaths: WS[0].projectPaths });
  // Name input is disabled on re-scan (name immutable here; edit name in the card path).
  assert.equal(doc.querySelector('#wiz-name').disabled, true);
});

test('.ws-home shows the metrics home when scopes reports one', async () => {
  const { window, show } = await boot({
    fetchHandler: (u) => (u.includes('/api/team-metrics/scopes') ? Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES }) : null),
  });
  show();
  await tick(); await tick(); await tick();
  const doc = window.document;
  const alpha = [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-alpha-00000001');
  assert.equal(alpha.querySelector('.ws-home').hidden, false, 'the slot is un-hidden');
  assert.match(alpha.querySelector('.ws-home').textContent, /acme\/gateway/);
});

test('.ws-route POSTs /api/workspaces/:id/metrics-route and renders results; they survive a team-metrics-changed repaint', async () => {
  const routePosts = [];
  const { window, show, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/team-metrics/scopes')) return Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES });
      if (/\/api\/workspaces\/wks-alpha-00000001\/metrics-route$/.test(u) && opts.method === 'POST') {
        routePosts.push(u);
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ results: [{ slug: 'acme/svc-iam', result: 'routed' }, { slug: 'acme/svc-ui', result: 'failed', error: 'push rejected' }] }),
        });
      }
      return null;
    },
  });
  show();
  await tick(); await tick(); await tick();
  const doc = window.document;
  const alpha = [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-alpha-00000001');
  click(window, alpha.querySelector('.ws-route'));
  await tick(); await tick(); await tick();
  assert.equal(routePosts.length, 1);
  assert.equal([...alpha.querySelectorAll('.ws-route-results li')].length, 2, 'route results rendered');

  // A subsequent team-metrics-changed frame (any action, including flush-failed) repaints
  // the .ws-home row in place — the saved result list must survive that repaint.
  ws().deliver({ type: 'team-metrics-changed', action: 'flush-failed' });
  await tick(); await tick();
  assert.equal([...alpha.querySelectorAll('.ws-route-results li')].length, 2, 'route results survive the repaint');
});
