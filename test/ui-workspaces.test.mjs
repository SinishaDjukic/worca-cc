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
    { id: 'wks-alpha-00000001', name: 'Alpha WS', projectPaths: WS[0].projectPaths, home: { state: 'ok', slug: 'acme/gateway', runs: 12 },
      // The route button only renders for a member with no worca-metrics branch (the API always sends members).
      members: [{ path: WS[0].projectPaths[0], slug: 'acme/gateway', state: 'home', reason: null }, { path: WS[0].projectPaths[1], slug: 'acme/console', state: 'not-recording', reason: 'no worca-metrics branch' }],
      counts: { recordsHere: 1, routed: 0, notRecording: 1 } },
    { id: 'wks-beta-00000002', name: 'Beta WS', projectPaths: WS[1].projectPaths, home: { state: 'unset' }, members: [], counts: {} },
  ],
  scopes: { projects: [], workspaces: [] },
  anyEnabled: true,
};

async function boot({ fetchHandler, workspaces = WS, hooks } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  if (hooks) window.__worcaTestHooks = hooks;   // e.g. the real marked + DOMPurify for the markdown tests
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
  assert.equal(cards[0].querySelector('.ws-projects').textContent, '2 projects · no metrics home', 'a summary, not the member list — the projects table inside the card names every member');
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
  // Without the markdown bundle (jsdom cannot import the vendor routes) the description
  // is the same words as plain text — no document class, no elements.
  const view = card.querySelector('.ws-desc-view');
  assert.equal(view.tagName, 'DIV');
  assert.equal(view.classList.contains('artifact-markdown'), false);
  assert.match(view.textContent, /two svcs/);
  assert.equal(view.querySelector('h1'), null);
});

// The real pinned packages, the way the Ask panel loads them in the browser.
const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

test('description renders as sanitized markdown once the bundle is ready; raw HTML is stripped, the empty one stays a plain hint', async () => {
  const { window, show } = await boot({
    hooks: { askMarkdown: realMarkdown },
    workspaces: [{ ...WS[0], description: '# Workspace: Alpha\n## Overview\ntwo svcs <b>raw</b> *em* [x](https://e.x) <script>bad()</script>' }, WS[1]],
  });
  show();
  await settle();
  const doc = window.document;
  const cards = doc.querySelectorAll('#ws-list .ws-card');
  const view = cards[0].querySelector('.ws-desc-view');
  assert.equal(view.classList.contains('artifact-markdown'), true, 'rendered → the document class');
  assert.equal(view.querySelector('h1').textContent, 'Workspace: Alpha');
  assert.equal(view.querySelector('h2').textContent, 'Overview');
  assert.ok(view.querySelector('em'), 'markdown emphasis rendered');
  assert.equal(view.querySelector('b'), null, 'raw HTML is stripped by the allowlist');
  assert.equal(view.querySelector('script'), null);
  assert.match(view.textContent, /raw/, '…but its words are kept');
  assert.doesNotMatch(view.textContent, /bad\(\)/, 'script content is dropped entirely');
  const a = view.querySelector('a');
  assert.equal(a.getAttribute('target'), '_blank'); assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  const empty = cards[1].querySelector('.ws-desc-view');
  assert.equal(empty.classList.contains('artifact-markdown'), false);
  assert.match(empty.textContent, /no description yet/);
});

test('edit pane: Preview renders the current draft through the same pipeline, Text keeps the raw markdown; save re-renders', async () => {
  const { window, show } = await boot({
    hooks: { askMarkdown: realMarkdown },
    fetchHandler: (u, opts) => {
      if (/\/api\/workspaces\/wks-alpha-00000001$/.test(u) && opts.method === 'PATCH') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: { ...WS[0], description: JSON.parse(opts.body).description } }) });
      }
      return null;
    },
  });
  show();
  await settle();
  const doc = window.document;
  const card = doc.querySelector('#ws-list .ws-card');
  click(window, card.querySelector('.ws-edit'));
  const pane = card.querySelector('.ws-desc-edit');
  const input = card.querySelector('.ws-desc-input');
  const pv = card.querySelector('.ws-desc-preview');
  const tabs = [...pane.querySelectorAll('.ws-desc-tab')];
  assert.equal(pane.hidden, false);
  assert.deepEqual(tabs.map((t) => t.getAttribute('aria-selected')), ['true', 'false'], 'opens on Text');
  assert.equal(input.hidden, false); assert.equal(pv.hidden, true);
  input.value = '# Draft\n<b>raw</b> **bold**';
  click(window, tabs[1]);
  assert.deepEqual(tabs.map((t) => t.getAttribute('aria-selected')), ['false', 'true']);
  assert.equal(input.hidden, true); assert.equal(pv.hidden, false);
  assert.equal(pv.querySelector('h1').textContent, 'Draft');
  assert.ok(pv.querySelector('strong')); assert.equal(pv.querySelector('b'), null);
  click(window, tabs[0]);
  assert.equal(input.hidden, false); assert.equal(pv.hidden, true);
  assert.equal(input.value, '# Draft\n<b>raw</b> **bold**', 'Text loses nothing');
  click(window, card.querySelector('.ws-desc-save'));
  await settle();
  const view = doc.querySelector('#ws-list .ws-card .ws-desc-view');
  assert.equal(view.querySelector('h1').textContent, 'Draft', 'the saved description re-renders');
  assert.equal(view.querySelector('b'), null);
  // Re-opening the editor starts on Text again.
  click(window, doc.querySelector('#ws-list .ws-card .ws-edit'));
  assert.equal(doc.querySelector('#ws-list .ws-card .ws-desc-input').hidden, false);
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
  // The card re-rendered with the new text — with no markdown bundle it is bound as
  // text, not parsed as HTML (the rendered path strips the tag instead: see below).
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

test('before /scopes answers: the pending block, "checking metrics…" and aria-busy; then the real block; a workspace the payload lacks gets the plain summary', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { window, show } = await boot({
    fetchHandler: (u) => (u.includes('/api/team-metrics/scopes') ? gate.then(() => ({ ok: true, status: 200, json: async () => TM_SCOPES })) : null),
  });
  show(); await tick();
  const doc = window.document;
  const card = (id) => [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === id);
  const alpha = card('wks-alpha-00000001');
  assert.equal(alpha.getAttribute('aria-busy'), 'true');
  assert.equal(alpha.querySelector('.ws-projects').textContent, '2 projects · checking metrics…');
  assert.equal(alpha.querySelector('.ws-home').hidden, false);
  assert.ok(alpha.querySelector('.ws-home .is-pending'));
  assert.deepEqual([...alpha.querySelectorAll('.ws-home .ws-member-slug')].map((s) => s.textContent), ['svc-iam', 'svc-ui']);
  assert.ok(alpha.querySelectorAll('.ws-home .skel').length >= 6);
  release(); await tick(); await tick(); await tick();
  assert.equal(alpha.getAttribute('aria-busy'), null);
  assert.equal(alpha.querySelector('.ws-home .is-pending'), null);
  assert.match(alpha.querySelector('.ws-home').textContent, /acme\/gateway/);
  const beta = card('wks-beta-00000002');
  if (!TM_SCOPES.workspaces.some((w) => w.id === 'wks-beta-00000002')) {
    assert.equal(beta.getAttribute('aria-busy'), null);
    assert.equal(beta.querySelector('.ws-home').hidden, true);
    assert.equal(beta.querySelector('.ws-projects').textContent, '2 projects · no metrics home');
  }
});

test('the persisted /scopes copy paints the block at once (stale) and is revalidated; the fresh payload is persisted', async () => {
  const scopeCalls = [];
  let release; const gate = new Promise((r) => { release = r; });
  const { window, show } = await boot({
    fetchHandler: (u) => { if (u.includes('/api/team-metrics/scopes')) { scopeCalls.push(u); return gate.then(() => ({ ok: true, status: 200, json: async () => TM_SCOPES })); } return null; },
  });
  const cached = { ...TM_SCOPES, workspaces: TM_SCOPES.workspaces.map((w) => (w.id === 'wks-alpha-00000001' ? { ...w, home: { ...w.home, slug: 'acme/cached-home' } } : w)) };
  window.localStorage.setItem('worca-cc.tm.scopes.v1', JSON.stringify({ v: 1, ts: Date.now(), data: cached }));
  show(); await tick();
  const doc = window.document;
  const alpha = [...doc.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-alpha-00000001');
  assert.equal(alpha.querySelector('.ws-home').hidden, false, 'painted from the persisted copy before /scopes answers');
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/cached-home/, 'the home slug in the summary comes from the copy');
  assert.equal(alpha.querySelector('.ws-home .is-pending'), null, 'known data, not the pending block');
  assert.equal(alpha.getAttribute('aria-busy'), 'true', 'still revalidating');
  release(); await tick(); await tick(); await tick();
  assert.equal(scopeCalls.length, 1, 'the persisted copy is stale by definition: one revalidation');
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/gateway/);
  assert.doesNotMatch(alpha.querySelector('.ws-projects').textContent, /cached-home/);
  assert.equal(alpha.getAttribute('aria-busy'), null);
  assert.match(window.localStorage.getItem('worca-cc.tm.scopes.v1'), /acme\/gateway/, 'the fresh payload replaced the copy');
});

test('a broken persisted /scopes copy is forgotten, never thrown on: the cards get the pending block and the live payload', async () => {
  const { window, show } = await boot({
    fetchHandler: (u) => (u.includes('/api/team-metrics/scopes') ? Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES }) : null),
  });
  window.localStorage.setItem('worca-cc.tm.scopes.v1', '{not json');
  show(); await tick(); await tick(); await tick();
  assert.equal(window.localStorage.getItem('worca-cc.tm.scopes.v1') === '{not json', false, 'the blob is dropped on first read');
  const alpha = [...window.document.querySelectorAll('#ws-list .ws-card')].find((c) => c.dataset.workspaceId === 'wks-alpha-00000001');
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/gateway/);
});
