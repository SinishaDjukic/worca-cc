// test/ui-marketplace-marketplaces.test.mjs — P7: the Marketplaces tab, the Add marketplace dialog and U5, on the booted app.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { OFFICIAL, EXAMPLE, LOCAL, NOTE0, row } from './helpers/mk-marketplaces-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
class WSStub {
  constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; }
  send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  _open() { (this._l.open || []).forEach((fn) => fn({})); }
  frame(msg) { (this._l.message || []).forEach((fn) => fn({ data: JSON.stringify(msg) })); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
const POLICY = { projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false };

// `api(method, path, body, state)` answers what a test cares about ({status, body}); undefined → the defaults below.
async function boot({ level = null, api = () => undefined, marketplaces = [OFFICIAL, EXAMPLE], plugins = [], orphans = [] } = {}) {
  const page = level ? html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`) : html;
  const { window } = trackDom(new JSDOM(page, { url: 'http://localhost:4319/' }));
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.open = (...a) => { window.__opened = a; return null; };
  const calls = [];
  const state = { marketplaces, plugins, orphans };
  const dflt = (method, path) => {
    const ok = (body) => ({ status: 200, body });
    if (method === 'POST' && path === '/api/marketplaces/refresh') return ok({ ok: true, marketplaces: state.marketplaces });
    if (method === 'POST' && /^\/api\/marketplaces\/[^/]+\/refresh$/.test(path)) return ok({ ok: true, marketplace: state.marketplaces[0] });
    if (method === 'GET' && path === '/api/marketplaces') return ok({ marketplaces: state.marketplaces });
    if (method === 'GET' && path === '/api/plugins') return ok({ plugins: state.plugins, orphans: state.orphans });
    if (path.startsWith('/api/chat/status')) return ok({ channels: [] });
    if (path.startsWith('/api/policy/scopes')) return ok(POLICY);
    if (path.startsWith('/api/projects')) return ok({ projects: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  window.fetch = (u, opts = {}) => {
    const path = String(u).replace(/^https?:\/\/[^/]+/, '');
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, body });
    const r = api(method, path, body, state) || dflt(method, path);
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: async () => r.body });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  await settle();
  return { window, doc: window.document, calls, state };
}
async function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); }
const count = (calls, method, path) => calls.filter((c) => c.method === method && c.path === path).length;
const dialog = (d) => d.querySelector('#mk-dialog-host #mk-dialog');
const head = (d) => d.querySelector('#mk-root .mk-head-actions[data-tab="marketplaces"]');
const menuLabels = (d) => [...d.querySelectorAll('.wfv-menu [role^="menuitem"] .wfv-menu-l')].map((l) => l.textContent);
const pick = (d, label) => [...d.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === label).click();
const mjob = (o = {}) => ({ id: 'mkt_0a1b2c3d', url: 'example/worca-marketplace', state: 'running', phase: 'resolving', resolvedUrl: EXAMPLE.url,
  sha: null, done: 0, total: null, plugin: null, error: null, code: null, existing: null, marketplace: null,
  startedAt: '2026-10-20T12:00:00Z', endedAt: null, ...o });

test('Marketplaces tab: one card per marketplace, its count and header; switching to it loads nothing', async () => {
  const { window, doc, calls } = await boot();
  await go(window, 'marketplace');
  const before = [count(calls, 'POST', '/api/marketplaces/refresh'), count(calls, 'GET', '/api/marketplaces')];
  await go(window, 'marketplace/marketplaces');
  assert.deepEqual([count(calls, 'POST', '/api/marketplaces/refresh'), count(calls, 'GET', '/api/marketplaces')], before, 'CONTRACT §4');
  const tab = doc.querySelector('a.mk-tab[data-tab="marketplaces"]');
  assert.deepEqual([tab.getAttribute('aria-current'), tab.querySelector('.mk-count').textContent], ['page', '2']);
  assert.deepEqual([...doc.querySelectorAll('.mk-panel[data-tab="marketplaces"] section.mk-mkt')].map((s) => s.dataset.id), [EXAMPLE.id, OFFICIAL.id],
    'name order: the entry refresh sorts as GET /api/marketplaces does');
  assert.deepEqual([...head(doc).querySelectorAll('button')].map((b) => [b.className, b.textContent.trim()]),
    [['btn mk-refresh-all', 'Refresh all'], ['btn btn-primary mk-add-mkt', 'Add marketplace']]);
  assert.equal(doc.getElementById('mk-legacy'), null, 'no temporary host is left (SM45)');
});

test('Marketplaces tab: refresh one, Retry, Refresh all; each one POST, then a reload; Browse n opens Browse filtered', async () => {
  const { window, doc, calls } = await boot();
  await go(window, 'marketplace/marketplaces');
  const gets = () => count(calls, 'GET', '/api/marketplaces');
  const g = gets();
  doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`).click(); await settle();
  assert.equal(count(calls, 'POST', `/api/marketplaces/${OFFICIAL.id}/refresh`), 1);
  assert.ok(gets() > g, 'reloads after a good refresh');
  doc.querySelector(`.mk-mkt-retry[data-id="${EXAMPLE.id}"]`).click(); await settle();
  assert.equal(count(calls, 'POST', `/api/marketplaces/${EXAMPLE.id}/refresh`), 1);
  const all = count(calls, 'POST', '/api/marketplaces/refresh');
  head(doc).querySelector('.mk-refresh-all').click(); await settle();
  assert.equal(count(calls, 'POST', '/api/marketplaces/refresh'), all + 1);
  doc.querySelector(`.mk-mkt-browse[data-id="${EXAMPLE.id}"]`).click(); await settle();
  assert.equal(doc.querySelector('a.mk-tab[data-tab="browse"]').getAttribute('aria-current'), 'page');
  assert.equal(doc.querySelector(`button.mk-facet[data-from="${EXAMPLE.id}"]`).getAttribute('aria-pressed'), 'true');
});

test('Marketplaces tab: the ⋯ menu (Copy URL, Open repository only with a web URL, Remove… in its own dialog)', async () => {
  const deleted = [];
  const { window, doc } = await boot({ marketplaces: [OFFICIAL, EXAMPLE, LOCAL], api: (m, p) => {
    if (m !== 'DELETE') return undefined;
    if (p === `/api/marketplaces/${LOCAL.id}`) return { status: 500, body: { error: 'marketplaces.json is locked' } };
    deleted.push(p); return { status: 200, body: { ok: true, id: EXAMPLE.id } };
  } });
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { copied.push(t); } } });
  await go(window, 'marketplace/marketplaces');
  await checkRows([
    { name: 'a GitHub marketplace: Copy URL, Open repository, Remove… (icons, the last one red)', run: async () => {
      const more = doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`);
      more.click();
      assert.deepEqual([menuLabels(doc), doc.querySelector('.wfv-menu').getAttribute('aria-label')], [['Copy URL', 'Open repository', 'Remove…'], EXAMPLE.name]);
      assert.deepEqual([doc.querySelectorAll('.wfv-menu .wfv-menu-ic').length, doc.querySelector('.wfv-menu .is-danger .wfv-menu-l').textContent], [3, 'Remove…']);
      pick(doc, 'Copy URL'); await settle();
      assert.deepEqual([copied, lastToast(doc).title], [[EXAMPLE.url], 'URL copied.']);
      more.click(); pick(doc, 'Open repository');
      assert.deepEqual(window.__opened, ['https://github.com/example/worca-marketplace', '_blank', 'noopener']);
    } },
    { name: 'a folder marketplace has no Open repository', run: async () => {
      doc.querySelector(`.mk-mkt-more[data-id="${LOCAL.id}"]`).click();
      assert.deepEqual(menuLabels(doc), ['Copy URL', 'Remove…']);
      doc.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    } },
    { name: 'Remove… asks in its own md dialog, deletes from it, and confirms with a toast', run: async () => {
      doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
      const dlg = dialog(doc);
      assert.deepEqual([dlg.dataset.kind, dlg.dataset.width, dlg.getAttribute('aria-labelledby'), dlg.querySelector('h2#mk-rm-title').textContent, dlg.querySelector('.mk-consequence').textContent],
        ['remove-marketplace', 'md', 'mk-rm-title', 'Remove example/worca-marketplace?', 'Installed plugins keep working.']);
      assert.equal(dlg.querySelector('button.mk-dlg-close').getAttribute('aria-label'), 'Close');
      assert.deepEqual([...dlg.querySelectorAll('.mk-dialog-foot button')].map((b) => [b.textContent, b.className]),
        [['Cancel', 'btn btn-quiet'], ['Remove', 'btn btn-danger mk-confirm']]);
      dlg.querySelector('.mk-confirm').click(); await settle();
      assert.deepEqual([deleted, dialog(doc), lastToast(doc).title],
        [[`/api/marketplaces/${EXAMPLE.id}`], null, 'Marketplace removed. Installed plugins remain.']);
    } },
    { name: 'a failed remove stays inside its dialog', run: async () => {
      doc.querySelector(`.mk-mkt-more[data-id="${LOCAL.id}"]`).click(); pick(doc, 'Remove…'); await settle();
      dialog(doc).querySelector('.mk-confirm').click(); await settle();
      const dlg = dialog(doc);
      assert.ok(dlg, 'still open');
      assert.deepEqual([dlg.querySelector('.mk-dlg-err').textContent, dlg.querySelector('.mk-dlg-err').hidden, dlg.querySelector('.mk-confirm').disabled],
        ['marketplaces.json is locked', false, false]);
      assert.notEqual(lastToast(doc).tone, 'err', 'no toast for an error the dialog shows');
      dlg.querySelector('.mk-dlg-close').click(); await settle();
    } },
  ]);
});

test('Add marketplace: the header button opens the dialog; progress arrives over the socket; Install hands over to the plugin sheet', async () => {
  const ADDED = { ...EXAMPLE, lastError: null, warnings: [NOTE0], lastSync: { sha: EXAMPLE.lastSync.sha, at: '2026-10-20T12:00:00Z' } };
  const { window, doc, calls, state } = await boot({ marketplaces: [OFFICIAL], api: (m, p, b, st) => {
    if (m === 'POST' && p === '/api/marketplaces') { st.marketplaces = [OFFICIAL, ADDED]; return { status: 202, body: { jobId: 'mkt_0a1b2c3d', job: mjob() } }; }
    return undefined;
  } });
  await go(window, 'marketplace/marketplaces');
  head(doc).querySelector('.mk-add-mkt').click(); await settle();
  assert.deepEqual([dialog(doc).dataset.kind, doc.activeElement.id], ['add-marketplace', 'mk-add-url']);
  const url = doc.getElementById('mk-add-url');
  url.value = 'example/worca-marketplace'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.deepEqual(calls.filter((c) => c.method === 'POST' && c.path === '/api/marketplaces').map((c) => c.body), [{ url: 'example/worca-marketplace', progress: true }]);
  WSStub.last.frame({ type: 'marketplace-add-changed', job: mjob({ phase: 'reading', sha: EXAMPLE.lastSync.sha }) }); await settle();
  assert.deepEqual([...dialog(doc).querySelectorAll('ol.mk-progress > li')].map((l) => [l.dataset.state, l.textContent]), [
    ['done', 'Found github.com/example/worca-marketplace'], ['done', 'Fetched 16b6363'], ['current', 'Reading plugins…'], ['pending', 'Checking what each plugin asks for']]);
  WSStub.last.frame({ type: 'marketplace-add-changed', job: mjob({ state: 'done', phase: 'saved', sha: EXAMPLE.lastSync.sha, marketplace: ADDED }) }); await settle();
  assert.equal(dialog(doc).querySelector('h2').textContent, 'Added example/worca-marketplace');
  assert.deepEqual([doc.querySelector('a.mk-tab[data-tab="marketplaces"] .mk-count').textContent, state.marketplaces.length], ['2', 2], 'the page behind is already updated');
  dialog(doc).querySelector('button[aria-label="Install jira-source"]').click(); await settle();
  assert.equal(dialog(doc), null, 'Install closes the dialog first');
  assert.equal(doc.querySelector('#mk-sheet-host:not(.hidden) #mk-sheet').dataset.mode, 'install');
});

test('No marketplaces yet on the Marketplaces tab: the inline field adds through the same dialog', async () => {
  const { window, doc, calls } = await boot({ marketplaces: [], api: (m, p) => (m === 'POST' && p === '/api/marketplaces'
    ? { status: 202, body: { jobId: 'mkt_0a1b2c3d', job: mjob({ url: 'acme/worca-plugins', resolvedUrl: 'https://github.com/acme/worca-plugins' }) } } : undefined) });
  await go(window, 'marketplace/marketplaces');
  const form = doc.querySelector('.mk-panel[data-tab="marketplaces"] form.mk-empty-add');
  assert.equal(doc.querySelector('.mk-panel[data-tab="marketplaces"] h3.mk-empty-title').textContent, 'No marketplaces yet');
  form.querySelector('input').value = 'acme/worca-plugins';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.deepEqual(calls.filter((c) => c.method === 'POST' && c.path === '/api/marketplaces').map((c) => c.body), [{ url: 'acme/worca-plugins', progress: true }]);
  assert.deepEqual([doc.getElementById('mk-add-url').value, !!dialog(doc).querySelector('ol.mk-progress'), form.querySelector('.field-error, .pl-needs-git')],
    ['acme/worca-plugins', true, null]);
});

test('Already added: Open it lands on the Marketplaces tab (the address follows, SM63) with that card focused', async () => {
  const { window, doc } = await boot({ api: (m, p) => (m === 'POST' && p === '/api/marketplaces'
    ? { status: 409, body: { error: `marketplace already added: ${OFFICIAL.url}`, code: 'EXISTS', existing: { id: OFFICIAL.id, name: OFFICIAL.name } } } : undefined) });
  await go(window, 'marketplace');
  doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt').click(); await settle();
  const url = doc.getElementById('mk-add-url');
  url.value = 'SinishaDjukic/worca-cc'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.equal(dialog(doc).querySelector('.mk-add-msg .mk-chip-built').textContent, 'Built-in');
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.deepEqual([dialog(doc), window.location.hash, doc.querySelector('a.mk-tab[aria-current="page"]').dataset.tab, doc.activeElement.dataset.id],
    [null, '#marketplace/marketplaces', 'marketplaces', OFFICIAL.id]);
});

test('Open it rings the card it found, even after a mouse click (focusVisible; cycle 5)', async () => {
  const { window, doc } = await boot({ api: (m, p) => (m === 'POST' && p === '/api/marketplaces'
    ? { status: 409, body: { error: `marketplace already added: ${EXAMPLE.url}`, code: 'EXISTS', existing: { id: EXAMPLE.id, name: EXAMPLE.name } } } : undefined) });
  await go(window, 'marketplace');
  const seen = [];
  const focus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function (o) { if (this.matches('section.mk-mkt')) seen.push([this.dataset.id, o?.focusVisible ?? null]); return focus.call(this, o); };
  doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt').click(); await settle();
  const url = doc.getElementById('mk-add-url');
  url.value = 'example/worca-marketplace'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.deepEqual([seen, doc.activeElement.dataset.id], [[[EXAMPLE.id, true]], EXAMPLE.id]);
});

test('Browse n, then Remove… of that marketplace: Browse drops the From filter it set, never an empty grid with no facet to undo it (cycle 5)', async () => {
  const { window, doc } = await boot({ api: (m, p, b, st) => {
    if (m !== 'DELETE') return undefined;
    st.marketplaces = st.marketplaces.filter((x) => `/api/marketplaces/${x.id}` !== p);
    return { status: 200, body: { ok: true, id: EXAMPLE.id } };
  } });
  await go(window, 'marketplace/marketplaces');
  doc.querySelector(`.mk-mkt-browse[data-id="${EXAMPLE.id}"]`).click(); await settle();
  doc.querySelector('a.mk-tab[data-tab="marketplaces"]').click(); await settle();
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-confirm').click(); await settle();
  doc.querySelector('a.mk-tab[data-tab="browse"]').click(); await settle();
  const panel = doc.querySelector('.mk-panel[data-tab="browse"]');
  assert.deepEqual([panel.querySelectorAll('.mk-tile').length, !!panel.querySelector('.mk-clear-filters'), doc.querySelector('a.mk-tab[data-tab="browse"] .mk-count').textContent],
    [OFFICIAL.plugins.length, false, String(OFFICIAL.plugins.length)]);
});

// ── Killers: the busy, focus and SM70 rules the rows above leave unpinned ──
// Hold every (method, path) request until release(status, body): app.js calls the global fetch.
function hold(window, method, path) {
  const orig = globalThis.fetch;
  const h = { n: 0, waiters: [] };
  globalThis.fetch = window.fetch = (u, opts = {}) => {
    if ((opts.method || 'GET') !== method || String(u).replace(/^https?:\/\/[^/]+/, '') !== path) return orig(u, opts);
    h.n += 1;
    return new Promise((res) => h.waiters.push((status, body) => res({ ok: status < 400, status, json: async () => body })));
  };
  h.release = (status = 200, body = { ok: true }) => { for (const w of h.waiters.splice(0)) w(status, body); };
  return h;
}

test('Marketplaces tab: a refresh in flight is one POST, busy through a re-render and focused; a failure says why and never strands it busy', async () => {
  let failGet = false;
  const { window, doc } = await boot({ api: (m, p) => (failGet && m === 'GET' && p === '/api/plugins' ? { status: 500, body: { error: 'db locked' } } : undefined) });
  await go(window, 'marketplace/marketplaces');
  const btn = () => doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`);
  const h = hold(window, 'POST', `/api/marketplaces/${OFFICIAL.id}/refresh`);
  btn().focus();
  btn().click(); btn().click(); await settle();
  assert.deepEqual([h.n, btn().getAttribute('aria-disabled'), btn().getAttribute('aria-busy'), btn().disabled], [1, 'true', 'true', false]);
  WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-refresh' }); await settle();
  assert.deepEqual([btn().getAttribute('aria-disabled'), doc.activeElement === btn()], ['true', true], 'the rebuilt button is busy and keeps the focus');
  btn().click(); await settle();
  assert.equal(h.n, 1);
  failGet = true;   // the reload after it fails: nothing repaints the card
  h.release(500, { error: 'git fetch failed' }); await settle();
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title, btn().getAttribute('aria-disabled'), btn().getAttribute('aria-busy')],
    ['err', 'git fetch failed', null, null]);
});

test('Marketplaces tab: Refresh all while the refresh runs is busy and ignores the click (no read, no POST)', async () => {
  const { window, doc, calls } = await boot();
  await go(window, 'marketplace/marketplaces');
  const h = hold(window, 'POST', '/api/marketplaces/refresh');
  head(doc).querySelector('.mk-refresh-all').click(); await settle();
  const all = head(doc).querySelector('.mk-refresh-all');
  const gets = count(calls, 'GET', '/api/marketplaces');
  assert.deepEqual([h.n, all.getAttribute('aria-disabled'), all.getAttribute('aria-busy'), all.disabled], [1, 'true', 'true', false]);
  all.click(); await settle();
  assert.deepEqual([h.n, count(calls, 'GET', '/api/marketplaces')], [1, gets]);
  h.release(200, { ok: true, marketplaces: [OFFICIAL, EXAMPLE] }); await settle();
  assert.equal(head(doc).querySelector('.mk-refresh-all').getAttribute('aria-disabled'), null);
});

test('Marketplaces tab: closing the Add dialog returns focus to the header button; Copy URL without a clipboard says so', async () => {
  const { window, doc } = await boot();
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  await go(window, 'marketplace/marketplaces');
  head(doc).querySelector('.mk-add-mkt').click(); await settle();
  dialog(doc).querySelector('.mk-dlg-close').click(); await settle();
  assert.equal(doc.activeElement, head(doc).querySelector('.mk-add-mkt'));
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Copy URL'); await settle();
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['err', 'Could not copy the URL.']);
});

test('Remove…: the request holds Close, Cancel and Escape', async () => {
  const { window, doc } = await boot();
  await go(window, 'marketplace/marketplaces');
  const h = hold(window, 'DELETE', `/api/marketplaces/${EXAMPLE.id}`);
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-confirm').click(); await settle();
  const dlg = dialog(doc);
  assert.deepEqual([...dlg.querySelectorAll('button')].map((b) => b.disabled), [true, true, true], 'Close, Cancel, Remove');
  (doc.activeElement || doc).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
  assert.equal(dialog(doc), dlg, 'Escape waits for the answer');
  h.release(200, { ok: true, id: EXAMPLE.id }); await settle();
  assert.equal(dialog(doc), null);
});

test('Remove…: after the reload drops the card, focus is on Add marketplace, never <body>', async () => {
  const { window, doc } = await boot({ api: (m, p, b, st) => {
    if (m !== 'DELETE') return undefined;
    st.marketplaces = [OFFICIAL];
    return { status: 200, body: { ok: true, id: EXAMPLE.id } };
  } });
  await go(window, 'marketplace/marketplaces');
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-confirm').click(); await settle();
  assert.deepEqual([doc.querySelector(`#mk-root section.mk-mkt[data-id="${EXAMPLE.id}"]`), doc.activeElement === head(doc).querySelector('.mk-add-mkt')], [null, true]);
});

test('Remove…: leaving #marketplace closes it (SM70); a failure that answers later is a toast', async () => {
  const { window, doc } = await boot();
  await go(window, 'marketplace/marketplaces');
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  await go(window, 'runs');
  assert.equal(doc.getElementById('mk-dialog-host'), null);
  await go(window, 'marketplace/marketplaces');
  const h = hold(window, 'DELETE', `/api/marketplaces/${EXAMPLE.id}`);
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-confirm').click(); await settle();
  await go(window, 'runs');
  assert.equal(doc.getElementById('mk-dialog-host'), null);
  h.release(500, { error: 'marketplaces.json is locked' }); await settle();
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['err', 'marketplaces.json is locked']);
});

test('No marketplaces yet on the Marketplaces tab: a background re-read keeps the typed text and the focus', async () => {
  const { window, doc } = await boot({ marketplaces: [] });
  await go(window, 'marketplace/marketplaces');
  const input = doc.querySelector('.mk-panel[data-tab="marketplaces"] form.mk-empty-add input');
  input.focus(); input.value = 'acme/worca-pl';
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  assert.deepEqual([doc.querySelector('.mk-panel[data-tab="marketplaces"] form.mk-empty-add input') === input, input.value, doc.activeElement === input],
    [true, 'acme/worca-pl', true]);
});

// ── Killers (refine cycle 2): busy marks, header focus, the ⋯ menu's shape, the remove dialog's error line, SM70's edge ──
test('Marketplaces tab: a finished refresh frees its button for the next one; Retry frees its rebuilt twin; one refresh never frees another', async () => {
  let failGet = false;
  const { window, doc, calls } = await boot({ api: (m, p) => (failGet && m === 'GET' && p === '/api/plugins' ? { status: 500, body: { error: 'db locked' } } : undefined) });
  await go(window, 'marketplace/marketplaces');
  const OFF = `/api/marketplaces/${OFFICIAL.id}/refresh`;
  const EXAMPLE_R = `/api/marketplaces/${EXAMPLE.id}/refresh`;
  const refresh = () => doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`);
  const retry = () => doc.querySelector(`.mk-mkt-retry[data-id="${EXAMPLE.id}"]`);
  await checkRows([
    { name: 'a refresh that answered and reloaded leaves its button free: the second click POSTs again', run: async () => {
      refresh().click(); await settle();
      assert.equal(refresh().getAttribute('aria-disabled'), null);
      refresh().click(); await settle();
      assert.equal(count(calls, 'POST', OFF), 2);
    } },
    { name: 'Retry rebuilt during its refresh is freed when a failed reload paints nothing', run: async () => {
      const h = hold(window, 'POST', EXAMPLE_R);
      retry().click(); await settle();
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-refresh' }); await settle();
      assert.equal(retry().getAttribute('aria-busy'), 'true', 'the rebuilt Retry is busy');
      failGet = true;
      h.release(500, { error: 'HTTP 403' }); await settle();
      failGet = false;
      assert.deepEqual([retry().getAttribute('aria-disabled'), retry().getAttribute('aria-busy')], [null, null]);
    } },
    { name: 'one refresh ending leaves another marketplace\'s refresh busy', run: async () => {
      const a = hold(window, 'POST', OFF);
      const b = hold(window, 'POST', EXAMPLE_R);
      refresh().click(); retry().click(); await settle();
      failGet = true;
      a.release(200, { ok: true }); await settle();
      failGet = false;
      assert.deepEqual([refresh().getAttribute('aria-busy'), retry().getAttribute('aria-busy'), retry().getAttribute('aria-disabled')], [null, 'true', 'true']);
      b.release(200, { ok: true }); await settle();
    } },
  ]);
});

test('Marketplaces tab: the header keeps the focus through its re-renders; its icons are 16px like Browse\'s header', async () => {
  const { window, doc } = await boot();
  await go(window, 'marketplace/marketplaces');
  assert.deepEqual([...head(doc).querySelectorAll('button .ic')].map((s) => [s.style.width, s.style.height]), [['16px', '16px'], ['16px', '16px']]);
  const h = hold(window, 'POST', '/api/marketplaces/refresh');
  head(doc).querySelector('.mk-refresh-all').focus();
  head(doc).querySelector('.mk-refresh-all').click(); await settle();
  assert.equal(doc.activeElement, head(doc).querySelector('.mk-refresh-all'), 'busy, rebuilt and still focused');
  h.release(200, { ok: true, marketplaces: [OFFICIAL, EXAMPLE] }); await settle();
  assert.equal(doc.activeElement, head(doc).querySelector('.mk-refresh-all'), 'after the refresh');
  head(doc).querySelector('.mk-add-mkt').focus();
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  assert.equal(doc.activeElement, head(doc).querySelector('.mk-add-mkt'), 'a background re-read');
});

test('Marketplaces tab: the ⋯ menu ends at its button with copy / external / trash glyphs and a rule before Remove…; the remove dialog\'s error line waits hidden', async () => {
  const { iconSvg } = await import('../ui/public/icons.mjs');
  const { window, doc } = await boot();
  await go(window, 'marketplace/marketplaces');
  const more = doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`);
  more.getBoundingClientRect = () => ({ left: 600, right: 628, top: 100, bottom: 128, width: 28, height: 28, x: 600, y: 100 });
  more.click();
  const menu = doc.querySelector('.wfv-menu');
  assert.equal(menu.style.left, '628px', 'align: end (SM17, as P5\'s ⋯ menu)');
  assert.deepEqual([...menu.children].map((c) => c.className), ['menu-item wfv-menu-item', 'menu-item wfv-menu-item', 'menu-sep wfv-menu-sep', 'menu-item wfv-menu-item is-danger']);
  assert.deepEqual([...menu.querySelectorAll('.wfv-menu-ic')].map((s) => s.innerHTML), ['copy', 'external', 'trash'].map((n) => iconSvg(n, 16)));
  pick(doc, 'Remove…'); await settle();
  const err = dialog(doc).querySelector('.mk-dlg-err');
  assert.deepEqual([err.hidden, err.getAttribute('role'), err.textContent], [true, 'alert', '']);
  dialog(doc).querySelector('.mk-dlg-close').click(); await settle();
});

test('Remove…: Cancel returns focus to the ⋯ button rebuilt while its menu was open; the toast comes before the reload answers', async () => {
  const { window, doc } = await boot();
  await go(window, 'marketplace/marketplaces');
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click();
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-dialog-foot .btn-quiet').click(); await settle();
  assert.equal(doc.activeElement, doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`));
  const h = hold(window, 'GET', '/api/plugins');
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-confirm').click(); await settle();
  assert.deepEqual([h.n, dialog(doc), lastToast(doc)?.title], [1, null, 'Marketplace removed. Installed plugins remain.'], 'the toast never waits for the reload');
  h.release(200, { plugins: [], orphans: [] }); await settle();
});

test('SM70 edges: a move inside #marketplace keeps Remove… open; leaving with no dialog open throws nothing', async () => {
  const { window, doc } = await boot();
  const errors = [];
  window.addEventListener('error', (e) => { errors.push(e.message); });
  await go(window, 'marketplace/marketplaces');
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  await go(window, 'marketplace/installed');
  assert.equal(dialog(doc)?.dataset.kind, 'remove-marketplace', 'still inside #marketplace');
  dialog(doc).querySelector('.mk-dlg-close').click(); await settle();
  await go(window, 'runs');
  assert.deepEqual(errors, []);
});

test('Open it: the card takes focus once; a later re-render leaves the focus where the user moved it', async () => {
  const { window, doc } = await boot({ api: (m, p) => (m === 'POST' && p === '/api/marketplaces'
    ? { status: 409, body: { error: 'x', code: 'EXISTS', existing: { id: OFFICIAL.id, name: OFFICIAL.name } } } : undefined) });
  await go(window, 'marketplace/marketplaces');
  head(doc).querySelector('.mk-add-mkt').click(); await settle();
  const url = doc.getElementById('mk-add-url');
  url.value = 'SinishaDjukic/worca-cc'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.equal(doc.activeElement.dataset.id, OFFICIAL.id);
  doc.querySelector(`.mk-mkt-browse[data-id="${EXAMPLE.id}"]`).focus();
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  assert.equal(doc.activeElement, doc.querySelector(`.mk-mkt-browse[data-id="${EXAMPLE.id}"]`));
});

// ── Refine killers: the first marketplace replaces the empty state, so the opener and the field leave the page ──
test('the first add from "No marketplaces yet": every close of the dialog leaves focus on the header Add, never <body>', async () => {
  const ADDED = { ...EXAMPLE, lastError: null, warnings: [], lastSync: { sha: EXAMPLE.lastSync.sha, at: '2026-10-20T12:00:00Z' } };
  const rows = [];
  for (const tab of ['browse', 'marketplaces']) for (const how of ['primary', 'x', 'esc']) {
    rows.push({ name: `${tab} ${how}`, run: async () => {
      const { window, doc } = await boot({ marketplaces: [], api: (m, p, b, st) => {
        if (m === 'POST' && p === '/api/marketplaces') { st.marketplaces = [ADDED]; return { status: 202, body: { jobId: 'mkt_0a1b2c3d', job: mjob() } }; }
        return undefined;
      } });
      await go(window, tab === 'browse' ? 'marketplace' : 'marketplace/marketplaces');
      const form = doc.querySelector(`.mk-panel[data-tab="${tab}"] form.mk-empty-add`);
      form.querySelector('input').value = 'example/worca-marketplace';
      form.querySelector('button[type="submit"]').focus();
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle();
      WSStub.last.frame({ type: 'marketplace-add-changed', job: mjob({ state: 'done', phase: 'saved', marketplace: ADDED }) }); await settle();
      assert.deepEqual([dialog(doc).dataset.state, form.isConnected], ['result', false]);
      if (how === 'primary') dialog(doc).querySelector('.mk-add-primary').click();
      else if (how === 'x') dialog(doc).querySelector('.mk-dlg-close').click();
      else (doc.activeElement || doc).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle();
      assert.equal(dialog(doc), null);
      assert.equal(doc.activeElement, doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt'));
    } });
  }
  rows.push({ name: 'the address moved to #marketplace/installed under the dialog: focus on the selected tab', run: async () => {
    const { window, doc } = await boot();
    await go(window, 'marketplace');
    doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt').click(); await settle();
    await go(window, 'marketplace/installed');
    dialog(doc).querySelector('.mk-dlg-close').click(); await settle();
    assert.equal(doc.activeElement, doc.querySelector('#mk-root a.mk-tab[data-tab="installed"]'));
  } });
  await checkRows(rows);
});

test('No marketplaces yet, on either tab: when the first marketplace lands under the inline add, focus goes to the header Add', async () => {
  const ADDED = { ...EXAMPLE, lastError: null, warnings: [], lastSync: { sha: EXAMPLE.lastSync.sha, at: '2026-10-20T12:00:00Z' } };
  const headAdd = (doc) => doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt');
  const rows = [];
  for (const tab of ['marketplaces', 'browse']) {
    const hash = tab === 'browse' ? 'marketplace' : 'marketplace/marketplaces';
    rows.push({ name: `${tab}: typing in the field while another tab adds`, run: async () => {
      const { window, doc, state } = await boot({ marketplaces: [] });
      await go(window, hash);
      doc.querySelector(`.mk-panel[data-tab="${tab}"] form.mk-empty-add input`).focus();
      state.marketplaces = [ADDED];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-add' }); await settle();
      assert.deepEqual([doc.querySelector(`.mk-panel[data-tab="${tab}"] form.mk-empty-add`), doc.activeElement === headAdd(doc)], [null, true]);
    } });
    rows.push({ name: `${tab}: Cancel while adding (L6), then the add finishes server-side`, run: async () => {
      const { window, doc, state } = await boot({ marketplaces: [], api: (m, p) => (m === 'POST' && p === '/api/marketplaces' ? { status: 202, body: { jobId: 'mkt_0a1b2c3d', job: mjob() } } : undefined) });
      await go(window, hash);
      const form = doc.querySelector(`.mk-panel[data-tab="${tab}"] form.mk-empty-add`);
      form.querySelector('input').value = 'example/worca-marketplace';
      const add = form.querySelector('button[type="submit"]');
      add.focus();
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle();
      dialog(doc).querySelector('.mk-add-secondary').click(); await settle();
      assert.equal(doc.activeElement, add);
      state.marketplaces = [ADDED];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-add' }); await settle();
      assert.equal(doc.activeElement, headAdd(doc));
    } });
  }
  await checkRows([
    ...rows,
    { name: 'focus elsewhere on the page (the header\'s Refresh all) stays there', run: async () => {
      const { window, doc, state } = await boot({ marketplaces: [] });
      await go(window, 'marketplace/marketplaces');
      head(doc).querySelector('.mk-refresh-all').focus();
      state.marketplaces = [ADDED];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-add' }); await settle();
      assert.deepEqual([doc.querySelector('#mk-root section.mk-mkt') != null, doc.activeElement === head(doc).querySelector('.mk-refresh-all')], [true, true]);
    } },
    { name: 'a card refresh keeps its own focus (the fallback is only for the empty state)', run: async () => {
      const { window, doc } = await boot();
      await go(window, 'marketplace/marketplaces');
      const btn = doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`);
      btn.focus(); btn.click(); await settle();
      assert.equal(doc.activeElement, doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`));
    } },
  ]);
});

test('Remove…: a failed DELETE puts the focus back on Remove (a browser drops it from the disabled button)', async () => {
  const { window, doc } = await boot({ api: (m) => (m === 'DELETE' ? { status: 500, body: { error: 'marketplaces.json is locked' } } : undefined) });
  await go(window, 'marketplace/marketplaces');
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  const confirm = dialog(doc).querySelector('.mk-confirm');
  confirm.focus();
  confirm.click();
  // A browser drops the focus from a button that turns disabled (jsdom keeps it there, and its blur() ignores a
  // disabled button): move it away by hand.
  const away = doc.createElement('button');
  doc.body.append(away);
  away.focus();
  away.remove();
  await settle();
  assert.deepEqual([dialog(doc).querySelector('.mk-dlg-err').hidden, doc.activeElement === confirm, confirm.disabled], [false, true, false]);
  dialog(doc).querySelector('.mk-dlg-close').click(); await settle();
});

test('Open it before the first good read: the card takes focus when the page first paints it', async () => {
  let down = true;
  const { window, doc } = await boot({ api: (m, p) => {
    if (down && m === 'GET' && p === '/api/plugins') return { status: 500, body: { error: 'db locked' } };
    if (m === 'POST' && p === '/api/marketplaces') return { status: 409, body: { error: 'x', code: 'EXISTS', existing: { id: EXAMPLE.id, name: EXAMPLE.name } } };
    return undefined;
  } });
  await go(window, 'marketplace/marketplaces');
  head(doc).querySelector('.mk-add-mkt').click(); await settle();
  const url = doc.getElementById('mk-add-url');
  url.value = 'example/worca-marketplace'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.equal(doc.querySelector('#mk-root section.mk-mkt'), null, 'nothing painted yet');
  down = false;
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  assert.equal(doc.activeElement.dataset.id, EXAMPLE.id);
});

// ── Refine killers (cycle 3): focus with no twin left, and notes the user opened, across a re-render ──
test('a re-render that drops the focused control with no twin puts the focus on the header Add, never <body> (cycle 3)', async () => {
  await checkRows([
    { name: 'Remove…: Cancel after another tab removed that marketplace', run: async () => {
      const { window, doc, state } = await boot();
      await go(window, 'marketplace/marketplaces');
      doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Remove…'); await settle();
      state.marketplaces = [OFFICIAL];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-remove' }); await settle();
      dialog(doc).querySelector('.mk-dialog-foot .btn-quiet').click(); await settle();
      assert.deepEqual([doc.querySelector(`section.mk-mkt[data-id="${EXAMPLE.id}"]`), doc.activeElement === head(doc).querySelector('.mk-add-mkt')], [null, true]);
    } },
    { name: 'Installed has no Add in its header: the selected tab takes the focus', run: async () => {
      const { window, doc, state } = await boot({ plugins: [row('acme')] });
      await go(window, 'marketplace/installed');
      const more = doc.querySelector('button.mk-more[data-name="acme"]');
      more.focus();
      state.plugins = [];
      WSStub.last.frame({ type: 'plugins-changed', action: 'uninstall' }); await settle();
      assert.equal(doc.activeElement, doc.querySelector('#mk-root a.mk-tab[data-tab="installed"]'));
    } },
    { name: 'Browse n: the From facet it set takes the focus (the pressed button stays behind in the hidden panel)', run: async () => {
      const { window, doc } = await boot();
      await go(window, 'marketplace/marketplaces');
      const b = doc.querySelector(`.mk-mkt-browse[data-id="${OFFICIAL.id}"]`);
      b.focus(); b.click(); await settle();
      assert.equal(doc.querySelector('a.mk-tab[aria-current="page"]').dataset.tab, 'browse');
      assert.deepEqual([doc.activeElement.matches('button.mk-facet'), doc.activeElement.dataset.from, doc.activeElement.closest('[hidden]')], [true, OFFICIAL.id, null]);
    } },
    { name: 'nothing focused (<body>): a re-render never takes the focus', run: async () => {
      const { window, doc, state } = await boot();
      await go(window, 'marketplace/marketplaces');
      doc.activeElement?.blur();
      assert.equal(doc.activeElement, doc.body);
      state.marketplaces = [OFFICIAL];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-remove' }); await settle();
      assert.equal(doc.activeElement, doc.body);
    } },
    { name: 'focus outside the page is never moved', run: async () => {
      const { window, doc, state } = await boot();
      await go(window, 'marketplace/marketplaces');
      const outside = doc.createElement('button');
      doc.body.append(outside);
      outside.focus();
      state.marketplaces = [OFFICIAL];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-remove' }); await settle();
      assert.equal(doc.activeElement, outside);
      outside.remove();
    } },
  ]);
});

test('a tab switch never leaves the focus in the panel it hid (a browser drops it to <body>) (cycle 4)', async () => {
  const lost = (doc) => doc.activeElement === doc.body || !!doc.activeElement?.closest('[hidden]');
  await checkRows([
    { name: 'Installed, nothing installed: Browse n plugins', run: async () => {
      const { window, doc } = await boot({ plugins: [] });
      await go(window, 'marketplace/installed');
      const a = doc.querySelector('a.mk-browse-all');
      a.focus();
      a.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); await settle();
      assert.equal(doc.querySelector('a.mk-tab[aria-current="page"]').dataset.tab, 'browse');
      assert.equal(lost(doc), false, `focus on ${doc.activeElement.className}`);
    } },
    { name: 'Install → Skip for now: the Installed tab, focus off the Browse tile', run: async () => {
      const { window, doc } = await boot({ api: (m, p) => {
        if (m === 'POST' && p === '/api/plugins/install') return { status: 200, body: { ok: true } };
        if (m === 'GET' && p === '/api/plugins/slack-chat/config') return { status: 500, body: { error: 'nope' } };
        return undefined;
      } });
      await go(window, 'marketplace');
      const tile = doc.querySelector(`button.mk-tile[data-key="${OFFICIAL.id}/slack-chat"]`);
      tile.focus(); tile.click(); await settle();
      doc.querySelector('#mk-sheet [data-act="install"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 })); await settle(20);
      doc.querySelector('#mk-sheet [data-act="skip"]').click(); await settle();
      assert.equal(doc.querySelector('a.mk-tab[aria-current="page"]').dataset.tab, 'installed');
      assert.equal(lost(doc), false, `focus on ${doc.activeElement.className}`);
    } },
    { name: 'Browse "No marketplaces yet" → Already added → Open it', run: async () => {
      const { window, doc } = await boot({ marketplaces: [], api: (m, p) => (m === 'POST' && p === '/api/marketplaces'
        ? { status: 409, body: { error: 'x', code: 'EXISTS', existing: { id: OFFICIAL.id, name: OFFICIAL.name } } } : undefined) });
      await go(window, 'marketplace');
      const form = doc.querySelector('.mk-panel[data-tab="browse"] form.mk-empty-add');
      form.querySelector('input').value = 'SinishaDjukic/worca-cc';
      form.querySelector('button[type="submit"]').focus();
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle();
      dialog(doc).querySelector('.mk-add-primary').click(); await settle();
      assert.equal(doc.querySelector('a.mk-tab[aria-current="page"]').dataset.tab, 'marketplaces');
      assert.equal(lost(doc), false, `focus on ${doc.activeElement.className}`);
    } },
    { name: 'a card\'s Browse n, then back to the Marketplaces tab: the header\'s Add marketplace', run: async () => {
      const { window, doc } = await boot();
      await go(window, 'marketplace/marketplaces');
      doc.querySelector(`.mk-mkt-browse[data-id="${EXAMPLE.id}"]`).click(); await settle();
      assert.equal(doc.activeElement.dataset.from, EXAMPLE.id, 'the From facet it set (P7-am)');
      await go(window, 'marketplace/marketplaces');
      assert.equal(doc.activeElement, head(doc).querySelector('.mk-add-mkt'));
    } },
  ]);
});

test('Open it on a card not painted yet: once the user acts, a later paint never takes the focus (cycle 4)', async () => {
  const act = {
    pointer: (n, window) => n.dispatchEvent(new window.Event('pointerdown', { bubbles: true })),
    key: (n, window) => n.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })),
  };
  await checkRows(Object.entries(act).map(([how, press]) => ({ name: `the user's ${how} moves on`, run: async () => {
    const { window, doc, state } = await boot({ marketplaces: [OFFICIAL], api: (m, p) => (m === 'POST' && p === '/api/marketplaces'
      ? { status: 409, body: { error: 'x', code: 'EXISTS', existing: { id: EXAMPLE.id, name: EXAMPLE.name } } } : undefined) });
    await go(window, 'marketplace/marketplaces');
    head(doc).querySelector('.mk-add-mkt').click(); await settle();
    const url = doc.getElementById('mk-add-url');
    url.value = 'example/worca-marketplace'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
    dialog(doc).querySelector('.mk-add-primary').click(); await settle();
    dialog(doc).querySelector('.mk-add-primary').click(); await settle();   // Open it: EXAMPLE has no card yet
    const r = doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`);
    press(r, window);
    r.focus();
    state.marketplaces = [OFFICIAL, EXAMPLE];
    r.click(); await settle();
    assert.equal(doc.activeElement, doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`));
  } })));
});

test('Remove…: while the DELETE runs the focus stays inside the dialog (a browser drops it from the disabled Remove) (cycle 4)', async () => {
  const { window, doc } = await boot();
  await go(window, 'marketplace/marketplaces');
  const waiters = [];
  const orig = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, opts = {}) => ((opts.method || 'GET') === 'DELETE'
    ? new Promise((res) => waiters.push(() => res({ ok: false, status: 500, json: async () => ({ error: 'locked' }) }))) : orig(u, opts));
  doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click();
  pick(doc, 'Remove…'); await settle();
  const confirm = dialog(doc).querySelector('.mk-confirm');
  confirm.focus(); confirm.click(); await settle();
  const a = doc.activeElement;
  assert.deepEqual([dialog(doc).contains(a), a.disabled === true], [true, false], `focus on ${a.className}`);
  waiters.shift()();
  await settle();
  assert.equal(doc.activeElement, dialog(doc).querySelector('.mk-confirm'), 'a failure puts it back on Remove');
});

test('Marketplaces tab: notes the user opened stay open through a re-render; a card that leaves takes its state with it (cycle 3)', async () => {
  const { window, doc, state } = await boot();
  await go(window, 'marketplace/marketplaces');
  const disc = () => doc.querySelector(`section.mk-mkt[data-id="${EXAMPLE.id}"] button.mk-disc`);
  disc().click();
  doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`).click(); await settle();
  assert.deepEqual([disc().getAttribute('aria-expanded'), doc.getElementById(disc().getAttribute('aria-controls')).hidden], ['true', false]);
  disc().click();
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  assert.equal(disc().getAttribute('aria-expanded'), 'false', 'folded again by the user: it stays folded');
  disc().click();
  state.marketplaces = [OFFICIAL];
  WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-remove' }); await settle();
  state.marketplaces = [OFFICIAL, EXAMPLE];
  WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-add' }); await settle();
  assert.equal(disc().getAttribute('aria-expanded'), 'false', 'a card added again starts folded');
});

test('Remove… open while Back moves the page to Browse: Cancel, Close and Escape leave the focus on a shown control, never <body> (cycle 6)', async () => {
  const lost = (doc) => doc.activeElement === doc.body || !!doc.activeElement?.closest('[hidden], .hidden');
  await checkRows(['Cancel', 'Close', 'Escape'].map((how) => ({ name: how, run: async () => {
    const { window, doc } = await boot();
    const focus = window.HTMLElement.prototype.focus;   // a browser never focuses a control it does not render
    window.HTMLElement.prototype.focus = function (o) { if (this.closest('[hidden], .hidden')) return; return focus.call(this, o); };
    await go(window, 'marketplace/marketplaces');
    const more = doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`);
    more.focus(); more.click(); pick(doc, 'Remove…'); await settle();
    await go(window, 'marketplace');   // Back: Browse shows behind the dialog, which stays open (P7-y); the ⋯ is in a hidden panel
    assert.ok(dialog(doc), 'still open');
    if (how === 'Cancel') dialog(doc).querySelector('.mk-dialog-foot .btn-quiet').click();
    else if (how === 'Close') dialog(doc).querySelector('.mk-dlg-close').click();
    else (doc.activeElement || doc).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    assert.equal(dialog(doc), null);
    assert.equal(lost(doc), false, `focus on ${doc.activeElement.className || doc.activeElement.tagName}`);
  } })));
});

test('Remove… while that card\'s refresh runs: the refresh answering 404 after the remove is no error (cycle 6)', async () => {
  const { window, doc } = await boot({ api: (m, p) => (m === 'DELETE' && p === `/api/marketplaces/${OFFICIAL.id}` ? { status: 200, body: { ok: true, id: OFFICIAL.id } } : undefined) });
  await go(window, 'marketplace/marketplaces');
  const h = hold(window, 'POST', `/api/marketplaces/${OFFICIAL.id}/refresh`);
  doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`).click(); await settle();
  doc.querySelector(`.mk-mkt-more[data-id="${OFFICIAL.id}"]`).click(); pick(doc, 'Remove…'); await settle();
  dialog(doc).querySelector('.mk-confirm').click(); await settle();
  assert.equal(lastToast(doc).title, 'Marketplace removed. Installed plugins remain.');
  h.release(404, { error: `marketplace "${OFFICIAL.id}" not found` }); await settle();
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['ok', 'Marketplace removed. Installed plugins remain.'], 'the removed marketplace\'s refresh says nothing');
});

test('Marketplaces tab: Open repository never opens a credential; a clipboard that refuses says so; Remove… keeps another marketplace\'s Browse filter (cycle 6)', async () => {
  const CRED = { ...LOCAL, id: 'github.com-acme-m-0c0ffee0', name: 'acme/m', url: 'https://x-access-token:s3cret@github.com/acme/m.git' };
  const { window, doc } = await boot({ marketplaces: [OFFICIAL, EXAMPLE, CRED], api: (m, p, b, st) => {
    if (m !== 'DELETE') return undefined;
    st.marketplaces = st.marketplaces.filter((x) => `/api/marketplaces/${x.id}` !== p);
    return { status: 200, body: { ok: true } };
  } });
  await go(window, 'marketplace/marketplaces');
  await checkRows([
    { name: 'Open repository: the web address without its credential or .git', run: async () => {
      doc.querySelector(`.mk-mkt-more[data-id="${CRED.id}"]`).click(); pick(doc, 'Open repository');
      assert.deepEqual(window.__opened, ['https://github.com/acme/m', '_blank', 'noopener']);
    } },
    { name: 'a clipboard that refuses: an error toast, never "URL copied."', run: async () => {
      Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Write permission denied.')) } });
      doc.querySelector(`.mk-mkt-more[data-id="${EXAMPLE.id}"]`).click(); pick(doc, 'Copy URL'); await settle();
      assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['err', 'Could not copy the URL.']);
    } },
    { name: 'Remove… of another marketplace keeps the From filter Browse n set', run: async () => {
      doc.querySelector(`.mk-mkt-browse[data-id="${EXAMPLE.id}"]`).click(); await settle();
      doc.querySelector('a.mk-tab[data-tab="marketplaces"]').click(); await settle();
      doc.querySelector(`.mk-mkt-more[data-id="${CRED.id}"]`).click(); pick(doc, 'Remove…'); await settle();
      dialog(doc).querySelector('.mk-confirm').click(); await settle();
      doc.querySelector('a.mk-tab[data-tab="browse"]').click(); await settle();
      const panel = doc.querySelector('.mk-panel[data-tab="browse"]');
      assert.deepEqual([panel.querySelectorAll('.mk-tile').length, panel.querySelector(`button.mk-facet[data-from="${EXAMPLE.id}"]`)?.getAttribute('aria-pressed')],
        [EXAMPLE.plugins.length, 'true']);
    } },
  ]);
});

test('U5: Add marketplace, the Marketplaces tab, Health and Leftover data are not Expert-gated; the page stays Advanced (L8)', async () => {
  await checkRows([
    { name: 'static: no Expert gate in the page markup or in ui/public/marketplace/*.mjs', run: () => {
      const section = new JSDOM(html).window.document.querySelector('section[data-view="marketplace"]');
      assert.deepEqual([...section.querySelectorAll('[data-min-level="expert"]')].map((n) => n.outerHTML.slice(0, 80)), []);
      const dir = fileURLToPath(new URL('../ui/public/marketplace/', import.meta.url));
      const hits = readdirSync(dir).filter((f) => f.endsWith('.mjs'))
        .flatMap((f) => (readFileSync(dir + f, 'utf8').match(/\bexpert\b/gi) || []).map((m) => `${f}: ${m}`));
      assert.deepEqual(hits, []);
      assert.match(readFileSync(appPath, 'utf8'), /marketplace: 'advanced', connectors: 'advanced'/, 'VIEW_MIN_LEVEL keeps the page Advanced');
    } },
    { name: 'at Advanced every U5 item is on screen', run: async () => {
      const gated = (n) => !!n.closest('[data-min-level="expert"]');
      const { window, doc } = await boot({ level: 'advanced', plugins: [row('acme')], orphans: [{ name: 'old-plugin', dataDir: '/x/old-plugin/data' }] });
      await go(window, 'marketplace/marketplaces');
      for (const sel of ['a.mk-tab[data-tab="marketplaces"]', '#mk-root .mk-head-actions .mk-add-mkt', '#mk-root section.mk-mkt']) {
        const n = doc.querySelector(sel);
        assert.ok(n && !gated(n), sel);
      }
      await go(window, 'marketplace/installed');
      const orphan = doc.querySelector('li.mk-orphan[data-name="old-plugin"]');
      assert.ok(orphan && !gated(orphan), 'Leftover data');
      doc.querySelector('button.mk-more[data-name="acme"]').click();
      assert.ok(menuLabels(doc).includes('Check health'), 'Check health');
    } },
  ]);
});

// ── Fix cycle 1 (M1): a trusted policy home's missing plugin installs once the synced marketplaces change under the page ──
test('trusted home: a required plugin a marketplace now offers installs once after a card refresh or a finished Add; an unchanged re-read never retries', async () => {
  const X = { name: 'acme-x', subdir: 'plugins/acme-x', version: '1.0.0', description: 'X', inventory: {}, installed: false, notes: [] };
  const SHA = 'f'.repeat(40);
  const REQ = (marketplace) => ({ name: 'acme-x', marketplace, minVersion: null, state: 'missing', installed: null, homes: ['acme/gateway'] });
  const trustedBoot = async ({ marketplaces, req, installStatus = 200, api = () => undefined }) => {
    let installed = false;
    const b = await boot({ marketplaces, api: (m, p, body, st) => {
      if (p.startsWith('/api/policy/scopes')) return { status: 200, body: { ...POLICY, requirements: [installed ? { ...req, state: 'ok', installed: { version: '1.0.0', enabled: true } } : req] } };
      if (m === 'POST' && p === '/api/plugins/install') {
        if (installStatus >= 400) return { status: installStatus, body: { error: 'install failed' } };
        installed = true; return { status: 200, body: { ok: true, inventory: {}, warnings: [], ignored: [] } };
      }
      return api(m, p, body, st);
    } });
    b.window.localStorage.setItem('worca.policy.trust.acme/gateway', '1');
    await go(b.window, 'marketplace/marketplaces');
    return { ...b, installs: () => b.calls.filter((c) => c.method === 'POST' && c.path === '/api/plugins/install') };
  };
  const OFFICIAL_X = { ...OFFICIAL, lastSync: { sha: SHA, at: '2026-10-22T12:00:00Z' }, plugins: [...OFFICIAL.plugins, X] };
  const refreshGivesX = (m, p, b, st) => {
    if (m === 'POST' && p === `/api/marketplaces/${OFFICIAL.id}/refresh`) { st.marketplaces = [OFFICIAL_X, EXAMPLE]; return { status: 200, body: { ok: true, marketplace: OFFICIAL_X } }; }
    return undefined;
  };
  await checkRows([
    { name: 'a card refresh brings the plugin: one silent install from that snapshot', run: async () => {
      const { doc, installs } = await trustedBoot({ marketplaces: [OFFICIAL, EXAMPLE], req: REQ(OFFICIAL.id), api: refreshGivesX });
      assert.equal(installs().length, 0, 'not offered at entry');
      assert.match(doc.getElementById('plugins-msg')?.textContent || '', /not found in a synced marketplace/);
      doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`).click(); await settle(20);
      assert.deepEqual(installs().map((c) => c.body), [{ repoUrl: OFFICIAL.url, subdir: 'plugins/acme-x', name: 'acme-x', sha: SHA, marketplace: OFFICIAL.id }]);
      assert.equal(lastToast(doc).title, 'Installed acme-x (trusted policy home).');
    } },
    { name: 'a finished Add brings the plugin: one silent install', run: async () => {
      const EXAMPLE_X = { ...EXAMPLE, lastError: null, warnings: [], plugins: [...EXAMPLE.plugins, X] };
      const { window, doc, installs } = await trustedBoot({ marketplaces: [OFFICIAL], req: REQ(EXAMPLE.id), api: (m, p, b, st) => {
        if (m === 'POST' && p === '/api/marketplaces') { st.marketplaces = [OFFICIAL, EXAMPLE_X]; return { status: 202, body: { jobId: 'mkt_0a1b2c3d', job: mjob() } }; }
        return undefined;
      } });
      assert.equal(installs().length, 0);
      head(doc).querySelector('.mk-add-mkt').click(); await settle();
      const url = doc.getElementById('mk-add-url');
      url.value = 'example/worca-marketplace'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
      dialog(doc).querySelector('.mk-add-primary').click(); await settle();
      WSStub.last.frame({ type: 'marketplace-add-changed', job: mjob({ state: 'done', phase: 'saved', sha: EXAMPLE.lastSync.sha, marketplace: EXAMPLE_X }) }); await settle(20);
      assert.deepEqual(installs().map((c) => [c.body.name, c.body.marketplace]), [['acme-x', EXAMPLE.id]]);
    } },
    { name: 'a failing install is not retried by re-reads that change no marketplace (background read, Refresh all)', run: async () => {
      const { doc, installs } = await trustedBoot({ marketplaces: [OFFICIAL, EXAMPLE], req: REQ(OFFICIAL.id), installStatus: 500, api: refreshGivesX });
      doc.querySelector(`.mk-mkt-refresh[data-id="${OFFICIAL.id}"]`).click(); await settle(20);
      assert.equal(installs().length, 1);
      WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle(20);
      head(doc).querySelector('.mk-refresh-all').click(); await settle(20);
      assert.equal(installs().length, 1);
    } },
    { name: 'off the page a marketplace change installs nothing', run: async () => {
      const { window, doc, state, installs } = await trustedBoot({ marketplaces: [OFFICIAL, EXAMPLE], req: REQ(OFFICIAL.id) });
      await go(window, 'runs');
      state.marketplaces = [OFFICIAL_X, EXAMPLE];
      WSStub.last.frame({ type: 'plugins-changed', action: 'marketplace-refresh' }); await settle(20);
      assert.equal(installs().length, 0);
      assert.ok(doc);
    } },
  ]);
});
