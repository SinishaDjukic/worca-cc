// test/ui-workspaces.test.mjs — jsdom boot tests for the Workspaces view: the list (one row per
// workspace, the Projects list's shape), the empty placeholder, the stale badge, and the workspace
// page (#workspaces/<id>[/team]) where all editing happens: the description editor and PATCH,
// delete (200 + 409-keep), re-scan, the metrics home block and routing, adding / removing
// member projects on the page (never from the list), and the list's no-add/remove invariant.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { pressEscape } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
  constructor() { this.readyState = 1; this._listeners = {}; this.sent = []; WSStub.last = this; }
  send(t) { this.sent.push(t); } close() {}
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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  if (hooks) window.__worcaTestHooks = hooks;   // e.g. the real marked + DOMPurify for the markdown tests
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    // A copy, as a real response is: the app replaces entries of its list in place.
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: structuredClone(workspaces) }) });
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

test('a row opens the workspace page by click or Enter (hash, header, tabs, focus on Back; Back returns to the row); a member row opens its project page', async () => {
  const { window, show } = await boot();
  show();
  await settle(3);
  const doc = window.document;
  await checkRows([
    { name: 'a row click opens the workspace page: slide, header, tabs, focus on Back, hash #workspaces/<id>; Back returns to the list and the row', run: async () => {
      const item = rowOf(doc, 'wks-alpha-00000001');
      click(window, item.querySelector('.ws-row'));
      await settle();
      assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001');
      const shell = doc.getElementById('ws-shell');
      assert.ok(shell.classList.contains('detail-open'), 'the track slid to the page');
      const page = doc.querySelector('#ws-detail .pd.wd');
      assert.ok(page, 'the page rides the project page\'s pd- shell');
      assert.equal(page.querySelector('.pd-title').textContent, 'Alpha WS');
      assert.deepEqual([...page.querySelectorAll('.pd-tab')].map((b) => b.dataset.sec), ['overview', 'map', 'team', 'actions']);
      assert.equal(page.querySelector('.pd-tab[data-sec="actions"]').dataset.minLevel, 'advanced');
      assert.equal(page.querySelector('.pd-tab[data-sec="map"]').dataset.minLevel, 'advanced');
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
    } },
    { name: 'Enter on a focused row opens the page; a member row opens its project page', run: async () => {
      // Back on the list (the first row ended there): Enter opens the page again.
      show();
      await settle(3);
      const row = rowOf(doc, 'wks-alpha-00000001').querySelector('.ws-row');
      row.focus();
      row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      assert.equal(window.location.hash, '#workspaces/wks-alpha-00000001');
      click(window, doc.querySelector('#ws-detail .wd-member[data-key="k2"]'));
      await settle();
      assert.equal(window.location.hash, '#projects/k2');
    } },
  ]);
});

// The real pinned packages, the way the Ask panel loads them in the browser.
const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });

test('the description renders as sanitized markdown (raw HTML stripped, empty is a plain hint) and the edit pane Preview uses the same pipeline; save re-renders', async () => {
  const { window, show } = await boot({
    hooks: { askMarkdown: realMarkdown },
    workspaces: [{ ...WS[0], description: '# Workspace: Alpha\n## Overview\ntwo svcs <b>raw</b> *em* [x](https://e.x) <script>bad()</script>' }, WS[1]],
    fetchHandler: (u, opts) => {
      if (/\/api\/workspaces\/wks-alpha-00000001$/.test(u) && opts.method === 'PATCH') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: { ...WS[0], description: JSON.parse(opts.body).description } }) });
      }
      return null;
    },
  });
  const doc = window.document;
  await checkRows([
    { name: 'description renders as sanitized markdown once the bundle is ready; raw HTML is stripped, the empty one stays a plain hint', run: async () => {
      show('workspaces/wks-alpha-00000001');
      await settle(8);
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
    } },
    { name: 'edit pane: Preview renders the current draft through the same pipeline, Text keeps the raw markdown; save re-renders', run: async () => {
      show('workspaces/wks-alpha-00000001');
      await settle(8);
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
    } },
  ]);
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
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Workspace deleted.', detail: '', action: '' });
  assert.equal(doc.querySelector('#ws-msg').textContent, '');
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

test('a double-click on Delete stacks two confirms on the one shell: Escape answers both No, and a later, unrelated OK deletes nothing', async () => {
  const deletes = [];
  const { window, show } = await boot({
    fetchHandler: (u, opts) => {
      if (!/\/api\/workspaces\/wks-beta-00000002$/.test(u) || opts.method !== 'DELETE') return null;
      deletes.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, warnings: [] }) });
    },
  });
  show('workspaces/wks-beta-00000002');
  await settle();
  const doc = window.document;
  const del = doc.querySelector('#ws-detail .ws-delete');
  click(window, del);
  click(window, del);                    // live until the confirm: each click awaits the dependents note first
  await settle();
  const modal = doc.getElementById('confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  pressEscape(window);
  await settle();
  assert.equal(modal.classList.contains('hidden'), true, 'Escape answered No');
  const other = window.__projects.confirmModal({ title: 'Something else?' });
  doc.getElementById('confirm-ok').click();
  assert.equal(await other, true);
  await settle();
  assert.deepEqual(deletes, [], 'the delete the user cancelled never runs');
  assert.equal(window.location.hash, '#workspaces/wks-beta-00000002');
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
  assert.match(lastToast(doc).title, /not registered here/);
  await open(window, 'wks-beta-00000002');
  assert.equal(doc.getElementById('ws-shell').classList.contains('detail-open'), true);
  list = [WS[0]];
  ws().deliver({ type: 'workspaces-changed' });
  await settle();
  assert.equal(window.location.hash, '#workspaces');
  assert.equal(doc.querySelectorAll('#ws-list .ws-item').length, 1);
  assert.match(lastToast(doc).title, /"Beta WS" was removed/);
});

test('Re-scan from the page starts the scan run and follows it on Runs', async () => {
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
  assert.equal(doc.querySelector('.view[data-view="runs"]').classList.contains('hidden'), false, 'on Runs');
  assert.ok(doc.querySelector('#runs-list [data-run-id="run-rescan"]'), 'the scan run has a row');
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

// ---- member changes on the page: Add projects (registered non-members) and a Remove per member ----

const THIRD = { name: 'svc-api', path: '/a/svc-api', exists: true, key: 'k5' };
const withThird = (u) => (u.includes('/api/projects') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [...PROJECTS, THIRD] }) }) : null);

test('the Projects card offers Add projects and a Remove per member; Remove is disabled at two members', async () => {
  const { window, show } = await boot({ fetchHandler: withThird });
  show('workspaces/wks-alpha-00000001');
  await settle(8);
  const card = window.document.querySelector('#ws-detail .wd-members');
  assert.ok(card.querySelector('.wd-members-add'), 'Add projects');
  const removes = [...card.querySelectorAll('.wd-member-remove')];
  assert.equal(removes.length, 2, 'one Remove per member');
  assert.ok(removes.every((b) => b.disabled), 'a workspace keeps at least two members');
  assert.equal(card.querySelector('.wd-member .wd-member-remove'), null, 'never nested in the member row button');
});

test('Add projects lists registered non-members; Save posts {add} and the page shows the new member', async () => {
  const posts = [];
  const grown = { ...WS[0], projectPaths: [...WS[0].projectPaths, THIRD.path], projectKeys: ['k1', 'k2', 'k5'], exists: [true, true, true] };
  const { window, show } = await boot({ fetchHandler: (u, opts) => {
    if (/\/api\/workspaces\/wks-alpha-00000001\/members$/.test(u) && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: grown, clearedHomes: [], rescan: { runId: 'run_a' } }) });
    }
    return withThird(u);
  } });
  show('workspaces/wks-alpha-00000001');
  await settle(8);
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .wd-members-add'));
  await settle();
  const boxes = [...doc.querySelectorAll('#plugin-modal .wd-add-row input[type="checkbox"]')];
  assert.deepEqual(boxes.map((b) => b.value), [THIRD.path], 'only projects that are not members yet');
  const addBtn = () => [...doc.querySelectorAll('#plugin-modal button')].find((b) => b.textContent === 'Add');
  assert.equal(addBtn().disabled, true, 'Add waits for a pick');
  assert.deepEqual([...doc.querySelectorAll('#plugin-modal-actions button')].map((b) => b.textContent), ['Cancel', 'Add'], 'Cancel sits next to Add');
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(addBtn().disabled, false);
  click(window, addBtn());
  await settle(8);
  assert.deepEqual(posts, [{ add: [THIRD.path] }]);
  assert.equal(doc.querySelectorAll('#ws-detail .wd-member').length, 3, 'the page shows the new member');
  assert.ok(doc.querySelector('#ws-detail .wd-members .wd-rescan.is-running'), 'the re-scan loader shows');
});

/** Open alpha, add THIRD, and return the page's re-scan loader accessor (the members POST starts run_1). */
async function addWithRescan(extra = {}) {
  const grown = { ...WS[0], projectPaths: [...WS[0].projectPaths, THIRD.path], projectKeys: ['k1', 'k2', 'k5'], exists: [true, true, true] };
  const booted = await boot({ fetchHandler: (u, opts) => {
    if (/\/api\/workspaces\/wks-alpha-00000001\/members$/.test(u) && opts.method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspace: grown, clearedHomes: [], rescan: { runId: 'run_1' }, ...extra }) });
    }
    return withThird(u);
  } });
  const { window, show } = booted;
  show('workspaces/wks-alpha-00000001');
  await settle(8);
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .wd-members-add'));
  await settle();
  const box = doc.querySelector('#plugin-modal .wd-add-row input[type="checkbox"]');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  click(window, [...doc.querySelectorAll('#plugin-modal button')].find((b) => b.textContent === 'Add'));
  await settle(8);
  return { ...booted, doc, loader: () => doc.querySelector('#ws-detail .wd-members .wd-rescan') };
}

test('the re-scan loader ends on its workspace\'s frame: refreshed, failed, stopped or paused; another workspace changes nothing', async () => {
  const { ws, loader } = await addWithRescan();
  ws().deliver({ type: 'workspaces-changed', action: 'rescan-failed', workspaceId: 'wks-other-00000009' });
  await settle(8);
  assert.ok(loader().classList.contains('is-running'), 'another workspace\'s frame changes nothing');
  for (const [action, cls, text] of [
    ['rescan-failed', 'is-failed', /Re-scan failed/], ['rescan-stopped', 'is-stopped', /Re-scan stopped/],
    ['rescan-paused', 'is-paused', /Re-scan paused/], ['description', 'is-done', /map and the description were refreshed/i],
  ]) {
    ws().deliver({ type: 'workspaces-changed', action, workspaceId: 'wks-alpha-00000001', runId: 'run_1' });
    await settle(8);
    assert.ok(loader().classList.contains(cls), action);
    assert.match(loader().textContent, text);
    assert.equal(loader().querySelector('.spinner'), null, 'no spinner once it ended');
  }
});

test('a paused automatic re-scan that is resumed: the loader follows the new run again', async () => {
  const { ws, loader } = await addWithRescan();
  ws().deliver({ type: 'workspaces-changed', action: 'rescan-paused', workspaceId: 'wks-alpha-00000001', runId: 'run_1' });
  await settle(8);
  assert.ok(loader().classList.contains('is-paused'));
  ws().deliver({ type: 'workspaces-changed', action: 'rescan-resumed', workspaceId: 'wks-alpha-00000001', runId: 'run_2' });
  await settle(8);
  assert.ok(loader().classList.contains('is-running'), 'running again');
  assert.equal(loader().querySelector('a.wd-rescan-open').getAttribute('href'), '#running/run_2');
  assert.ok(ws().sent.some((t) => JSON.parse(t).type === 'subscribe' && JSON.parse(t).runId === 'run_2'), 'subscribed to the resumed run');
  ws().deliver({ type: 'workspaces-changed', action: 'description', workspaceId: 'wks-alpha-00000001', runId: 'run_2' });
  await settle(8);
  assert.ok(loader().classList.contains('is-done'), 'the resumed run\'s end is its end');
});

test('on page load a running re-scan shows its loader and resubscribes; a paused one shows the paused box, not a spinner', async () => {
  await checkRows([
    { name: 'a re-scan still running when the page loads shows its loader and resubscribes', run: async () => {
      const { window, show, ws } = await boot({ workspaces: [{ ...WS[0], rescan: { runId: 'run_live', pipelineId: 'abcd1234' } }, WS[1]] });
      show('workspaces/wks-alpha-00000001');
      await settle(8);
      const el = window.document.querySelector('#ws-detail .wd-rescan.is-running');
      assert.ok(el, 'the loader is back after a reload');
      assert.equal(el.querySelector('a.wd-rescan-open').getAttribute('href'), '#running/run_live');
      assert.ok(ws().sent.some((t) => JSON.parse(t).runId === 'run_live'));
    } },
    { name: 'a re-scan PAUSED when the page loads shows the paused box, not a spinner', run: async () => {
      const { window, show } = await boot({ workspaces: [{ ...WS[0], rescan: { runId: 'run_paused', pipelineId: 'abcd1234', paused: true } }, WS[1]] });
      show('workspaces/wks-alpha-00000001');
      await settle(8);
      const el = window.document.querySelector('#ws-detail .wd-rescan');
      assert.ok(el && el.classList.contains('is-paused'), 'its pause was broadcast before the reload: the list says so');
      assert.equal(el.querySelector('.spinner'), null);
      assert.match(el.textContent, /Re-scan paused/);
      assert.equal(el.querySelector('a.wd-rescan-open').getAttribute('href'), '#running/run_paused');
    } },
  ]);
});

test('Remove confirms, posts {remove}; a 409 (live run) keeps the member and shows the error on the header', async () => {
  const three = { ...WS[0], projectPaths: [...WS[0].projectPaths, THIRD.path], projectKeys: ['k1', 'k2', 'k5'], exists: [true, true, true] };
  const posts = [];
  let status = 409;
  const { window, show } = await boot({ workspaces: [three, WS[1]], fetchHandler: (u, opts) => {
    if (/\/api\/workspaces\/wks-alpha-00000001\/members$/.test(u) && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve(status === 409
        ? { ok: false, status: 409, json: async () => ({ error: 'cannot change the members of a workspace with a live run or scan' }) }
        : { ok: true, status: 200, json: async () => ({ workspace: { ...WS[0] }, clearedHomes: [] }) });
    }
    return withThird(u);
  } });
  show('workspaces/wks-alpha-00000001');
  await settle(8);
  const doc = window.document;
  const removeOf = (path) => [...doc.querySelectorAll('#ws-detail .wd-member-remove')].find((b) => b.dataset.path === path);
  assert.equal(removeOf(THIRD.path).disabled, false);
  click(window, removeOf(THIRD.path));
  await confirmDialog(window);
  await settle(8);
  assert.deepEqual(posts, [{ remove: THIRD.path }]);
  assert.equal(doc.querySelectorAll('#ws-detail .wd-member').length, 3, 'still a member');
  assert.match(doc.querySelector('#ws-detail .pd-error').textContent, /live run/);
  status = 200;
  click(window, removeOf(THIRD.path));
  await confirmDialog(window);
  await settle(8);
  assert.equal(doc.querySelectorAll('#ws-detail .wd-member').length, 2, 'removed');
});

// #555 D10: a failed metrics-home save reuses one error line instead of appending
// a new one per click.
test('#555 D10: two failed metrics-home saves leave exactly one .tm-home-err', async () => {
  const patches = [];
  const { window, show } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/team-metrics/scopes')) return Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES });
      if (/\/api\/workspaces\/metrics-scan$/.test(u) && opts.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ members: [
          { path: WS[0].projectPaths[0], key: 'k1', slug: 'acme/gateway', hasOrigin: true, recordsLocally: true },
        ] }) });
      }
      if (/\/api\/workspaces\/wks-alpha-00000001$/.test(u) && opts.method === 'PATCH') {
        patches.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'disk full' }) });
      }
      return null;
    },
  });
  show('workspaces/wks-alpha-00000001/team');
  await settle();
  const doc = window.document;
  click(window, doc.querySelector('#ws-detail .ws-home-change'));
  await settle();
  assert.equal(doc.getElementById('plugin-modal').classList.contains('hidden'), false, 'the Metrics home sheet is open');
  const save = [...doc.querySelectorAll('#plugin-modal button')].find((b) => b.textContent === 'Save');
  click(window, save); await settle();
  click(window, save); await settle();
  assert.equal(patches.length, 2, 'both saves reached the server');
  const errs = doc.querySelectorAll('#plugin-modal .tm-home-err');
  assert.equal(errs.length, 1, 'one error line, reused');
  assert.equal(errs[0].textContent, 'disk full');
});

// P5: a workspace may hold registered Folder projects (annotated vcs 'none' aligned with projectPaths).
test('a workspace with a Folder member: kind chips on the Projects card and in Add projects; the Branches card counts Git members only and hides with none', async () => {
  const blk = (base, over = {}) => ({ base, remote: 'origin', state: 'up-to-date', ahead: 0, behind: 0, dirty: false, checkedOutHere: true,
    fetchedAt: new Date().toISOString(), stale: false, settings: { beforeRun: true, onDiverged: 'ask' }, ...over });
  const projs = [{ ...PROJECTS[0], vcs: 'git' }, { ...PROJECTS[1], vcs: 'none' }, { ...THIRD, vcs: 'none' }];
  // The server may answer for a Folder project (a folder inside a repo answers for that repo): never counted.
  const handler = (u) => (u.includes('/api/sync/projects') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: { k1: blk('dev'), k2: blk('main', { state: 'behind', behind: 2 }) } }) })
    : u.includes('/api/projects') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: projs }) }) : null);
  const waitSync = () => new Promise((r) => setTimeout(r, 350));   // SYNC_CHIPS_MS (300) + the read
  await checkRows([
    { name: 'the Projects card: each member name carries its kind chip', run: async () => {
      const { window, show } = await boot({ fetchHandler: handler, workspaces: [{ ...WS[0], vcs: ['git', 'none'] }, WS[1]] });
      show('workspaces/wks-alpha-00000001');
      await settle(8);
      const members = [...window.document.querySelectorAll('#ws-detail .wd-member')];
      assert.deepEqual(members.map((m) => [m.querySelector('.wd-member-name').firstChild.textContent, m.querySelector('.wd-member-name .kind-chip').textContent]),
        [['svc-iam', 'Git'], ['svc-ui', 'Folder']]);
    } },
    { name: 'the Branches card counts the Git member only', run: async () => {
      const { window, show } = await boot({ fetchHandler: handler, workspaces: [{ ...WS[0], vcs: ['git', 'none'] }, WS[1]] });
      show('workspaces/wks-alpha-00000001');
      await settle(8);
      await waitSync();
      await settle();
      const card = window.document.querySelector('#ws-detail .pd-ov-card-branches');
      assert.equal(card.hidden, false);
      assert.equal(card.querySelector('.pd-ov-value').textContent, 'All 1 up to date');
      assert.equal(card.querySelector('.pd-ov-act'), null, 'nothing to sync');
    } },
    { name: 'the Branches card hides when every member is a Folder project', run: async () => {
      const { window, show } = await boot({ fetchHandler: handler, workspaces: [{ ...WS[0], vcs: ['none', 'none'] }, WS[1]] });
      show('workspaces/wks-alpha-00000001');
      await settle(8);
      await waitSync();
      await settle();
      assert.equal(window.document.querySelector('#ws-detail .pd-ov-card-branches').hidden, true);
    } },
    { name: 'Add projects: each candidate shows its kind chip after its name', run: async () => {
      const { window, show } = await boot({ fetchHandler: handler, workspaces: [{ ...WS[0], vcs: ['git', 'none'] }, WS[1]] });
      show('workspaces/wks-alpha-00000001');
      await settle(8);
      const doc = window.document;
      click(window, doc.querySelector('#ws-detail .wd-members-add'));
      await settle();
      const rows = [...doc.querySelectorAll('#plugin-modal .wd-add-row')];
      assert.deepEqual(rows.map((r) => [r.querySelector('.wd-member-name').textContent, r.querySelector('.wd-member-name + .kind-chip').textContent]), [['svc-api', 'Folder']]);
    } },
  ]);
});
