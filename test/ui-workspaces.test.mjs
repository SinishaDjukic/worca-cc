// test/ui-workspaces.test.mjs — jsdom boot tests for the Workspaces view: the list (one row per
// workspace, the Projects list's shape), the empty placeholder, the stale badge, and the workspace
// page (#workspaces/<id>[/team]) where all editing happens: the description editor and PATCH,
// delete (200 + 409-keep), re-scan, the metrics home block and routing, and the
// no-add/remove-project invariant (read-only set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const WS = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# Workspace: Alpha\n## Overview\ntwo svcs', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z' },
  { id: 'wks-beta-00000002', name: 'Beta WS', description: '', projectPaths: ['/b/api', '/b/web'], projectKeys: ['k3', 'k4'], exists: [true, false], createdAt: 'x', updatedAt: 'x' },
];
const PROJECTS = [
  { name: 'svc-iam', path: '/a/svc-iam', exists: true, key: 'k1' },
  { name: 'svc-ui', path: '/a/svc-ui', exists: true, key: 'k2' },
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
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const show = (hash = 'workspaces') => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, show, ws: () => WSStub.last };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const rowOf = (doc, id) => [...doc.querySelectorAll('#ws-list .ws-item')].find((c) => c.dataset.workspaceId === id);
// Open a page: set the hash and let jsdom deliver the hashchange.
async function open(window, id, tab = '') {
  window.location.hash = `workspaces/${id}${tab ? `/${tab}` : ''}`;
  await settle();
}

test('the list: one card headed "Workspaces · N", one row per workspace with name + summary + chevron; no add/remove-project control', async () => {
  const { window, show } = await boot();
  show();
  await settle(3);
  const doc = window.document;
  const head = doc.querySelector('#ws-list .saved-card .saved-head');
  assert.equal(head.querySelector('b').textContent, 'Workspaces');
  assert.equal(head.querySelector('.cnt').textContent, '2');
  const rows = [...doc.querySelectorAll('#ws-list .ws-item')];
  assert.equal(rows.length, 2);
  const row = rows[0].querySelector('.ws-row');
  assert.equal(row.getAttribute('role'), 'button');
  assert.equal(row.tabIndex, 0);
  assert.equal(rows[0].querySelector('.ws-name').textContent, 'Alpha WS');
  assert.equal(rows[0].querySelector('.ws-projects').textContent, '2 projects · no metrics home', 'a summary, not the member list');
  assert.ok(rows[0].querySelector('.proj-open.ws-open'), 'the chevron');
  assert.equal(rows[0].querySelectorAll('button').length, 1, 'the chevron is the only button on a row: nothing on the list edits');
  assert.equal(doc.querySelector('#ws-list .ws-card'), null, 'no expandable cards any more');
  // Invariant (a): NO add/remove-project control anywhere on the view.
  assert.equal(doc.querySelector('.view[data-view="workspaces"] [class*="add-project"]'), null);
});

test('empty state renders the histEmpty placeholder', async () => {
  const { window, show } = await boot({ workspaces: [] });
  show();
  await settle(3);
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#ws-list .ws-item').length, 0);
  assert.equal(doc.querySelectorAll('#ws-list .hist-empty').length, 1);
});

test('the stale badge shows on the row and on the page header when any member is missing', async () => {
  const { window, show } = await boot();
  show();
  await settle(3);
  const doc = window.document;
  assert.equal(rowOf(doc, 'wks-alpha-00000001').querySelector('.ws-stale'), null, 'Alpha (all present) → no badge');
  assert.ok(rowOf(doc, 'wks-beta-00000002').querySelector('.ws-stale'), 'Beta (a member missing) → badge shown');
  await open(window, 'wks-beta-00000002');
  assert.equal(doc.querySelector('#ws-detail .pd-row1 .ws-stale').hidden, false);
  const projCard = doc.querySelector('#ws-detail .pd-ov-card-projects');
  assert.equal(projCard.querySelector('.pd-ov-value').textContent, '2');
  assert.equal(projCard.querySelector('.pd-ov-sub').textContent, '1 missing on disk');
});

test('a row click opens the workspace page: slide, header, tabs, focus on Back, hash #workspaces/<id>; Back returns to the list and the row', async () => {
  const { window, show } = await boot();
  show();
  await settle(3);
  const doc = window.document;
  const item = rowOf(doc, 'wks-alpha-00000001');
  click(window, item.querySelector('.ws-row'));
  await settle();
  assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001');
  const shell = doc.getElementById('ws-shell');
  assert.ok(shell.classList.contains('detail-open'), 'the track slid to the page');
  const page = doc.querySelector('#ws-detail .pd.wd');
  assert.ok(page, 'the page rides the project page\'s pd- shell');
  assert.equal(page.querySelector('.pd-title').textContent, 'Alpha WS');
  assert.deepEqual([...page.querySelectorAll('.pd-tab')].map((b) => b.dataset.sec), ['overview', 'team']);
  assert.equal(page.querySelector('.pd-tab[data-sec="team"]').dataset.minLevel, 'expert');
  assert.equal(doc.activeElement, page.querySelector('.pd-back'), 'focus lands on Back');
  assert.equal(doc.querySelector('#ws-shell .ws-screen-list').getAttribute('inert'), '', 'the list is inert behind the page');
  // The description is on the Overview, verbatim without the markdown bundle.
  const view = page.querySelector('.ws-desc-view');
  assert.equal(view.classList.contains('artifact-markdown'), false);
  assert.match(view.textContent, /two svcs/);
  assert.equal(view.querySelector('h1'), null);
  // The members: one row each, a registered one opens its project page.
  const members = [...page.querySelectorAll('.wd-member')];
  assert.equal(members.length, 2);
  assert.equal(members[0].tagName, 'BUTTON');
  assert.equal(members[0].dataset.key, 'k1');
  assert.equal(members[0].querySelector('.wd-member-name').textContent, 'svc-iam');
  assert.equal(members[0].querySelector('.proj-path').textContent, '/a/svc-iam');
  click(window, page.querySelector('.pd-back'));
  await settle();
  assert.equal(window.location.hash, '#workspaces');
  assert.equal(shell.classList.contains('detail-open'), false);
  assert.equal(doc.activeElement, rowOf(doc, 'wks-alpha-00000001').querySelector('.ws-row'), 'focus comes home to the row');
});

test('Enter on a focused row opens the page; a member row opens its project page', async () => {
  const { window, show } = await boot();
  show();
  await settle(3);
  const doc = window.document;
  const row = rowOf(doc, 'wks-alpha-00000001').querySelector('.ws-row');
  row.focus();
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001');
  click(window, doc.querySelector('#ws-detail .wd-member[data-key="k2"]'));
  await settle();
  assert.equal(window.location.hash, '#projects/k2');
});

// The real pinned packages, the way the Ask panel loads them in the browser.
const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });

test('description renders as sanitized markdown once the bundle is ready; raw HTML is stripped, the empty one stays a plain hint', async () => {
  const { window, show } = await boot({
    hooks: { askMarkdown: realMarkdown },
    workspaces: [{ ...WS[0], description: '# Workspace: Alpha\n## Overview\ntwo svcs <b>raw</b> *em* [x](https://e.x) <script>bad()</script>' }, WS[1]],
  });
  show('workspaces/wks-alpha-00000001');
  await settle(8);
  const doc = window.document;
  const view = doc.querySelector('#ws-detail .ws-desc-view');
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
  await open(window, 'wks-beta-00000002');
  const empty = doc.querySelector('#ws-detail .ws-desc-view');
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
  show('workspaces/wks-alpha-00000001');
  await settle(8);
  const doc = window.document;
  const page = doc.querySelector('#ws-detail .pd');
  click(window, page.querySelector('.ws-edit'));
  const pane = page.querySelector('.ws-desc-edit');
  const input = page.querySelector('.ws-desc-input');
  const pv = page.querySelector('.ws-desc-preview');
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
  click(window, page.querySelector('.ws-desc-save'));
  await settle(8);
  const view = doc.querySelector('#ws-detail .ws-desc-view');
  assert.equal(view.querySelector('h1').textContent, 'Draft', 'the saved description re-renders');
  assert.equal(view.querySelector('b'), null);
  // Re-opening the editor starts on Text again.
  click(window, doc.querySelector('#ws-detail .ws-edit'));
  assert.equal(doc.querySelector('#ws-detail .ws-desc-input').hidden, false);
});

test('edit → PATCH /api/workspaces/:id { description }; state + DOM update, JSON-safe; the page stays open', async () => {
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
  show('workspaces/wks-alpha-00000001');
  await settle();
  const doc = window.document;
  const page = doc.querySelector('#ws-detail .pd');
  click(window, page.querySelector('.ws-edit'));
  const input = page.querySelector('.ws-desc-input');
  assert.equal(input.value, WS[0].description, 'edit pane seeded with current text');
  const next = '# Workspace: Alpha\nedited <b>not html</b>';
  input.value = next;
  click(window, page.querySelector('.ws-desc-save'));
  await settle();
  assert.equal(patches.length, 1, 'one PATCH');
  assert.equal(patches[0].body.description, next, 'description sent (JSON.stringify) verbatim');
  assert.equal('projectPaths' in patches[0].body, false, 'PATCH never sends projectPaths (immutable set)');
  assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001', 'still on the page');
  // The page re-rendered with the new text — with no markdown bundle it is bound as text.
  const view = doc.querySelector('#ws-detail .ws-desc-view');
  assert.match(view.textContent, /edited <b>not html<\/b>/, 'new description shown verbatim');
  assert.equal(view.querySelector('b'), null, 'no element parsed from the description');
  assert.equal(doc.querySelector('#ws-detail .ws-desc-edit').hidden, true, 'the editor closed');
});

test('a scan replaces the description while the editor is open: the draft stays, the page says so, Cancel shows the new text', async () => {
  let list = WS;
  const { window, show, ws } = await boot({
    fetchHandler: (u) => ((u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) ? Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: list }) }) : null),
  });
  show('workspaces/wks-alpha-00000001');
  await settle();
  const doc = window.document;
  const page = doc.querySelector('#ws-detail .pd');
  click(window, page.querySelector('.ws-edit'));
  const input = page.querySelector('.ws-desc-input');
  input.value = 'my draft';
  list = [{ ...WS[0], description: '# Workspace: Alpha\nSCANNED' }, WS[1]];
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated' });
  await settle();
  assert.equal(input.value, 'my draft', 'the open draft is never overwritten');
  assert.equal(page.querySelector('.ws-desc-edit').hidden, false, 'the editor stays open');
  assert.match(doc.querySelector('#ws-detail .pd-error').textContent, /changed while you were editing/);
  click(window, page.querySelector('.ws-desc-cancel'));
  await settle();
  assert.match(doc.querySelector('#ws-detail .ws-desc-view').textContent, /SCANNED/, 'Cancel shows the scan\'s text');
  assert.equal(doc.querySelector('#ws-detail .pd-error').textContent, '', 'the notice is gone');
});

test('delete 200 from the page: confirm → DELETE → back on the list without the row, count decremented', async () => {
  const { window, show } = await boot({
    fetchHandler: (u, opts) => /\/api\/workspaces\/wks-beta-00000002$/.test(u) && opts.method === 'DELETE'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, warnings: [] }) }) : null,
  });
  show('workspaces/wks-beta-00000002');
  await settle();
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .ws-delete'));
  await confirmDialog(window);
  await settle();
  assert.equal(window.location.hash, '#workspaces');
  assert.equal(doc.querySelectorAll('#ws-list .ws-item').length, 1, 'Beta removed');
  assert.equal(doc.querySelector('#ws-list .saved-head .cnt').textContent, '1');
  assert.match(doc.querySelector('#ws-msg').textContent, /Workspace deleted/);
});

test('delete 409 (live run) keeps the page open + surfaces the error on its header', async () => {
  const { window, show } = await boot({
    fetchHandler: (u, opts) => /\/api\/workspaces\/wks-alpha-00000001$/.test(u) && opts.method === 'DELETE'
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'a run is in progress for this workspace' }) }) : null,
  });
  show('workspaces/wks-alpha-00000001');
  await settle();
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .ws-delete'));
  await confirmDialog(window);
  await settle();
  assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001', 'still on the page');
  assert.equal(doc.getElementById('ws-shell').classList.contains('detail-open'), true);
  const err = doc.querySelector('#ws-detail .pd-error');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /run is in progress/, 'verbatim 409 error');
  assert.equal(doc.querySelector('#ws-detail .ws-delete').disabled, false, 'the button is live again');
});

test('an unknown id shows the list with the not-registered message; a workspaces-changed frame that dropped the open one closes it', async () => {
  let list = WS;
  const { window, show, ws } = await boot({
    fetchHandler: (u) => ((u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) ? Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: list }) }) : null),
  });
  show('workspaces/wks-nope-00000009');
  await settle();
  const doc = window.document;
  assert.equal(doc.getElementById('ws-shell').classList.contains('detail-open'), false);
  assert.match(doc.querySelector('#ws-msg').textContent, /not registered here/);
  await open(window, 'wks-beta-00000002');
  assert.equal(doc.getElementById('ws-shell').classList.contains('detail-open'), true);
  list = [WS[0]];
  ws().deliver({ type: 'workspaces-changed' });
  await settle();
  assert.equal(window.location.hash, '#workspaces');
  assert.equal(doc.querySelectorAll('#ws-list .ws-item').length, 1);
  assert.match(doc.querySelector('#ws-msg').textContent, /"Beta WS" was removed/);
});

test('Create workspace button routes to the wizard (#workspace-create)', async () => {
  const { window, show } = await boot({ workspaces: [] });
  show();
  await settle(3);
  const doc = window.document;
  click(window, doc.querySelector('#ws-create-btn'));
  await tick();
  assert.equal(window.location.hash, '#workspace-create');
  assert.equal(doc.querySelector('.view[data-view="workspace-create"]').classList.contains('hidden'), false);
});

test('Re-scan from the page starts the scan run and follows it on Running', async () => {
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
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          runId: 'run-rescan', workspaceId: 'wks-alpha-00000001', title: 'Workspace scan: Alpha WS',
          projectDir: WS[0].projectPaths[0], projectNames: ['a', 'b'],
        }) });
      }
      return null;
    },
  });
  show('workspaces/wks-alpha-00000001');
  await settle();
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .ws-rescan'));
  await settle();
  assert.equal(posts.length, 1, 're-scan POSTed to :id/scan');
  assert.deepEqual(posts[0], {}, 'the server reads the persisted set');
  assert.equal(metricsScans.length, 1, 're-scan also refreshes member discovery');
  assert.deepEqual(metricsScans[0], { projectPaths: WS[0].projectPaths });
  assert.equal(doc.querySelector('.view[data-view="running"]').classList.contains('hidden'), false, 'on Running');
  assert.ok(doc.querySelector('#run-list [data-run-id="run-rescan"]'), 'the scan run has a card');
});

test('Re-scan refused (409) stays on the workspace page with the error', async () => {
  const { window, show } = await boot({
    fetchHandler: (u, opts) => (/\/wks-alpha-00000001\/scan$/.test(u) && opts.method === 'POST'
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'a live run exists for this workspace' }) }) : null),
  });
  show('workspaces/wks-alpha-00000001');
  await settle();
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .ws-rescan'));
  await settle();
  assert.equal(doc.querySelector('.view[data-view="workspaces"]').classList.contains('hidden'), false);
  assert.match(doc.querySelector('#ws-detail .pd-error').textContent, /live run/);
});

test('the Team tab: the metrics block shows the home and the members table; the METRICS HOME card on the Overview reads it', async () => {
  const { window, show } = await boot({
    fetchHandler: (u) => (u.includes('/api/team-metrics/scopes') ? Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES }) : null),
  });
  show('workspaces/wks-alpha-00000001');
  await settle();
  const doc = window.document;
  const card = doc.querySelector('#ws-detail .pd-ov-card-metrics');
  assert.equal(card.dataset.minLevel, 'expert');
  assert.equal(card.querySelector('.pd-ov-value').textContent, 'acme/gateway');
  assert.equal(card.querySelector('.pd-ov-sub').textContent, '12 workspace runs · 1 not recording');
  assert.match(doc.querySelector('#ws-detail .pd-meta .ws-projects').textContent, /2 projects · acme\/gateway · 12 workspace runs · 1 not recording/);
  click(window, card);
  await settle();
  assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001/team');
  const block = doc.querySelector('#ws-detail .wd-team-metrics .ws-home-inner');
  assert.ok(block, 'the members table block');
  assert.deepEqual([...block.querySelectorAll('.ws-member-slug')].map((s) => s.textContent), ['acme/gateway', 'acme/console']);
  assert.ok(block.querySelector('.ws-home-change'), 'Change metrics home… lives here');
  assert.ok(block.querySelector('.ws-route'), 'Route all to metrics home lives here');
  assert.equal(doc.querySelector('#ws-list .ws-home-change'), null, 'and nowhere on the list');
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
  show('workspaces/wks-alpha-00000001/team');
  await settle();
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .ws-route'));
  await settle();
  assert.equal(routePosts.length, 1);
  assert.equal([...doc.querySelectorAll('#ws-detail .ws-route-results li')].length, 2, 'route results rendered');
  // A subsequent team-metrics-changed frame (any action, including flush-failed) repaints the
  // block in place — the saved result list must survive that repaint.
  ws().deliver({ type: 'team-metrics-changed', action: 'flush-failed' });
  await settle();
  assert.equal([...doc.querySelectorAll('#ws-detail .ws-route-results li')].length, 2, 'route results survive the repaint');
});

test('before /scopes answers: the row says "checking metrics…" and is aria-busy, the Team tab shows the pending table; then the real summary; a workspace the payload lacks gets the plain summary', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { window, show } = await boot({
    fetchHandler: (u) => (u.includes('/api/team-metrics/scopes') ? gate.then(() => ({ ok: true, status: 200, json: async () => TM_SCOPES })) : null),
  });
  show(); await settle(2);
  const doc = window.document;
  const alpha = rowOf(doc, 'wks-alpha-00000001');
  assert.equal(alpha.getAttribute('aria-busy'), 'true');
  assert.equal(alpha.querySelector('.ws-projects').textContent, '2 projects · checking metrics…');
  await open(window, 'wks-alpha-00000001', 'team');
  const pending = doc.querySelector('#ws-detail .wd-team-metrics .is-pending');
  assert.ok(pending, 'the pending table');
  assert.deepEqual([...pending.querySelectorAll('.ws-member-slug')].map((s) => s.textContent), ['svc-iam', 'svc-ui']);
  assert.ok(pending.querySelectorAll('.skel').length >= 6);
  release(); await settle();
  assert.equal(doc.querySelector('#ws-detail .wd-team-metrics .is-pending'), null);
  assert.match(doc.querySelector('#ws-detail .wd-team-metrics').textContent, /acme\/gateway/);
  assert.equal(alpha.getAttribute('aria-busy'), null);
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/gateway/);
  const beta = rowOf(doc, 'wks-beta-00000002');
  assert.equal(beta.getAttribute('aria-busy'), null);
  assert.equal(beta.querySelector('.ws-projects').textContent, '2 projects · no metrics home');
});

test('the persisted /scopes copy paints the summary at once (stale) and is revalidated; the fresh payload is persisted', async () => {
  const scopeCalls = [];
  let release; const gate = new Promise((r) => { release = r; });
  const { window, show } = await boot({
    fetchHandler: (u) => { if (u.includes('/api/team-metrics/scopes')) { scopeCalls.push(u); return gate.then(() => ({ ok: true, status: 200, json: async () => TM_SCOPES })); } return null; },
  });
  const cached = { ...TM_SCOPES, workspaces: TM_SCOPES.workspaces.map((w) => (w.id === 'wks-alpha-00000001' ? { ...w, home: { ...w.home, slug: 'acme/cached-home' } } : w)) };
  window.localStorage.setItem('worca-cc.tm.scopes.v1', JSON.stringify({ v: 1, ts: Date.now(), data: cached }));
  show(); await settle(2);
  const doc = window.document;
  const alpha = rowOf(doc, 'wks-alpha-00000001');
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/cached-home/, 'the home slug in the summary comes from the copy');
  assert.equal(alpha.getAttribute('aria-busy'), null, 'known data, not pending');
  release(); await settle();
  assert.equal(scopeCalls.length, 1, 'the persisted copy is stale by definition: one revalidation');
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/gateway/);
  assert.doesNotMatch(alpha.querySelector('.ws-projects').textContent, /cached-home/);
  assert.match(window.localStorage.getItem('worca-cc.tm.scopes.v1'), /acme\/gateway/, 'the fresh payload replaced the copy');
});

test('a broken persisted /scopes copy is forgotten, never thrown on: the rows get the pending summary and the live payload', async () => {
  const { window, show } = await boot({
    fetchHandler: (u) => (u.includes('/api/team-metrics/scopes') ? Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES }) : null),
  });
  window.localStorage.setItem('worca-cc.tm.scopes.v1', '{not json');
  show(); await settle();
  assert.equal(window.localStorage.getItem('worca-cc.tm.scopes.v1') === '{not json', false, 'the blob is dropped on first read');
  const alpha = rowOf(window.document, 'wks-alpha-00000001');
  assert.match(alpha.querySelector('.ws-projects').textContent, /acme\/gateway/);
});
