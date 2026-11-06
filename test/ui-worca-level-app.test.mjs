// test/ui-worca-level-app.test.mjs
// The worca level wiring in app.js: the corner shows the level avatar after boot, the dialogs open in
// order (and never over the first-run welcome or setup), a payload-free poke refetches once (debounced)
// and repaints, showView('stats') posts stats-viewed once per navigation, the shelf carries the next-level
// line, and a level-up never touches the interface mode (I-6).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dir, '..', 'ui', 'public', 'app.js');
const html = readIndexHtml();
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return fn(); await new Promise((r) => setTimeout(r, 20)); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const STEPS = ['claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace', 'teamMetrics', 'teamPolicy'];
const onboarding = (flags = {}) => ({
  steps: Object.fromEntries(STEPS.map((id) => [id, id === 'claude'])),
  done: 1, total: 9, claude: { bin: 'claude', hint: null }, hidden: false, welcomeSeen: true, ...flags,
});

const LADDER = [
  { index: 1, key: 'calf', name: 'Calf', avatar: '/assets/worca-levels/calf.svg' },
  { index: 2, key: 'swimmer', name: 'Swimmer', avatar: '/assets/worca-levels/swimmer.svg' },
  { index: 3, key: 'hunter', name: 'Hunter', avatar: '/assets/worca-levels/hunter.svg' },
  { index: 4, key: 'pod-leader', name: 'Pod Leader', avatar: '/assets/worca-levels/pod-leader.svg' },
];
/** An WorcaLevelView at `level` (1..4). `extra` overrides welcome / celebration / etc. */
const viewAt = (level, extra = {}) => {
  const cur = LADDER[level - 1];
  const top = level === 4;
  return {
    level: { ...cur, description: `${cur.name} description` },
    progress: top ? null : { done: 1, total: 3 },
    next: top ? null : [{ id: 'a', label: 'Do thing A', href: '#chat', done: true }, { id: 'b', label: 'Do thing B', href: '#runs', done: false }],
    top,
    ladder: LADDER.map((l) => ({ ...l, reached: l.index <= level })),
    welcome: null,
    celebration: null,
    ...extra,
  };
};

async function boot({ view = viewAt(1), onb = onboarding(), initialHash = '', failView = false } = {}) {
  const dom = trackDom(new JSDOM(html, { url: `http://localhost:4317/${initialHash}`, pretendToBeVisual: true }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const sockets = [];
  window.WebSocket = class {
    constructor() { this.readyState = 1; this.listeners = {}; sockets.push(this); }
    send() {} close() {}
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  };
  const calls = [];
  const ctl = { view, onb, levelGets: 0, eventPosts: [], acks: [], failView };
  const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u, init = {}) => {
    const url = String(u);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.includes('/api/worca-level/events')) { ctl.eventPosts.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, status: 204, json: async () => ({}) }); }
    if (url.includes('/api/worca-level/ack')) { ctl.acks.push(JSON.parse(init.body).what); return json(ctl.view); }
    if (url.includes('/api/worca-level')) {
      ctl.levelGets += 1;
      if (ctl.failView) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      if (ctl.gate) { const snap = ctl.view; return new Promise((release) => ctl.gate.push(() => release({ ok: true, status: 200, json: async () => snap }))); }
      return json(ctl.view);
    }
    if (url.includes('/api/stats')) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'no stats in this test' }) });
    if (url.includes('/api/whoami')) return json({ name: 'Ada', shared: false });
    if (url.includes('/api/onboarding')) return json(ctl.onb);
    if (url.includes('/api/projects')) return json({ projects: [] });
    if (url.includes('/api/setup/detect')) return json({ checks: [{ id: 'claude', label: 'Claude Code', state: 'ok', line: 'Signed in.' }] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  const poke = (type) => {
    for (const s of sockets) for (const fn of s.listeners.message || []) fn({ data: JSON.stringify({ type }) });
  };
  return { window, doc: window.document, ctl, calls, poke };
}

const corner = (doc) => doc.getElementById('side-acct');
const cornerImg = (doc) => corner(doc).querySelector('.acct-ava img');
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

test('boot: the corner shows the level avatar as an <img> after the view loads', async () => {
  const { doc, ctl } = await boot({ view: viewAt(2) });
  const img = await until(() => cornerImg(doc));
  assert.ok(img, 'the corner paints an <img>');
  assert.equal(img.getAttribute('src'), '/assets/worca-levels/swimmer.svg');
  assert.equal(img.getAttribute('alt'), 'Swimmer');
  assert.ok(ctl.levelGets >= 1);
});

test('a failed level fetch leaves the initials in the corner and throws nothing', async () => {
  const { doc, ctl } = await boot({ failView: true });
  assert.ok(ctl.levelGets >= 1, 'it tried');
  assert.equal(cornerImg(doc), null, 'no view: no image');
  assert.ok(corner(doc).querySelector('.acct-ava'));
  assert.equal(doc.querySelector('#acct-level'), null, 'no view: no menu row');
  assert.ok(corner(doc).querySelector('.acct-ava').textContent.trim().length > 0, 'the initials stay');
});

test('dialogs: welcome comes before celebration; closing each acknowledges it once', async () => {
  const { doc, window, ctl } = await boot({ view: viewAt(1, { welcome: { kind: 'new' }, celebration: LADDER[1] }) });
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'welcome-new', 'welcome comes before celebration');
  click(window, dlg.querySelector('.worca-dlg-close'));
  await settle();
  assert.deepEqual(ctl.acks, ['welcome']);
  const next = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(next.dataset.dialog, 'celebration', 'then the celebration, never both at once');
  click(window, next.querySelector('.worca-dlg-close'));
  await settle();
  assert.deepEqual(ctl.acks, ['welcome', 'celebration']);
  assert.equal(doc.querySelector('.worca-dlg'), null);
});

test('dialogs: a celebration opens when the view carries one and there is no welcome', async () => {
  const { doc, window, ctl } = await boot({ view: viewAt(2, { celebration: LADDER[1] }) });
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'celebration');
  click(window, dlg.querySelector('.worca-dlg-close'));
  await settle();
  assert.deepEqual(ctl.acks, ['celebration']);
  assert.equal(doc.querySelector('.worca-dlg'), null, 'a closed dialog does not reopen from the same view');
});

test('dialogs: nothing opens while the first-run welcome is up; it opens once that is dismissed', async () => {
  const { doc, window, ctl } = await boot({
    view: viewAt(1, { welcome: { kind: 'new' } }),
    onb: onboarding({ welcomeSeen: false }),
  });
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), false, 'precondition: the first-run welcome is up');
  assert.equal(doc.querySelector('.worca-dlg'), null, 'the worca dialog waits');
  click(window, doc.querySelector('#welcome-modal .ob-skip'));
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.ok(dlg, 'and follows the welcome');
  assert.equal(dlg.dataset.dialog, 'welcome-new');
  assert.deepEqual(ctl.acks, []);
});

test('dialogs: nothing opens while the setup assistant is up; it opens once that closes', async () => {
  const { doc, window } = await boot({
    view: viewAt(1, { welcome: { kind: 'existing' } }),
    onb: onboarding({ welcomeSeen: false, fresh: true }),
  });
  assert.ok(doc.getElementById('setup-modal'), 'precondition: the assistant is up');
  assert.equal(doc.querySelector('.worca-dlg'), null);
  await until(() => doc.querySelector('#setup-modal .sa-check'));
  click(window, doc.querySelector('#setup-modal .sa-later'));
  // The first-run welcome follows the assistant; the worca dialog waits for that too.
  assert.equal(doc.querySelector('.worca-dlg'), null);
  click(window, await until(() => doc.querySelector('#welcome-modal:not(.hidden) .ob-skip')));
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'welcome-existing');
});

test('refresh: pokes coalesce into one refetch and the corner repaints with the new level', async () => {
  const { doc, ctl, poke } = await boot({ view: viewAt(1) });
  await until(() => cornerImg(doc));
  const before = ctl.levelGets;
  ctl.view = viewAt(2);
  poke('worca-level-changed');
  poke('pipelines-changed');
  poke('plugins-changed');
  poke('workspaces-changed');
  poke('schedules-changed');
  assert.equal(ctl.levelGets, before, 'debounced: nothing fetched synchronously');
  await until(() => cornerImg(doc)?.getAttribute('src') === '/assets/worca-levels/swimmer.svg');
  await wait(400);
  assert.equal(ctl.levelGets - before, 1, 'one refetch for the whole burst');
  assert.equal(cornerImg(doc).getAttribute('alt'), 'Swimmer');
});

test('refresh: each of the five events alone triggers a refetch', async () => {
  const { ctl, poke } = await boot({ view: viewAt(1) });
  for (const type of ['worca-level-changed', 'pipelines-changed', 'plugins-changed', 'workspaces-changed', 'schedules-changed']) {
    await wait(400);
    const before = ctl.levelGets;
    poke(type);
    await until(() => ctl.levelGets === before + 1);
    assert.equal(ctl.levelGets, before + 1, type);
  }
});

test('refresh: answers that arrive out of order never paint the older level', async () => {
  const { doc, ctl, poke } = await boot({ view: viewAt(1) });
  await until(() => cornerImg(doc));
  ctl.gate = [];
  ctl.view = viewAt(2);
  poke('worca-level-changed');
  await until(() => ctl.gate.length === 1);
  ctl.view = viewAt(3);
  await wait(300);
  poke('worca-level-changed');
  await until(() => ctl.gate.length === 2);
  ctl.gate[1]();                       // the newer request answers first
  await until(() => cornerImg(doc)?.getAttribute('src') === '/assets/worca-levels/hunter.svg');
  ctl.gate[0]();                       // then the older one, late
  await settle();
  assert.equal(cornerImg(doc).getAttribute('src'), '/assets/worca-levels/hunter.svg');
});

test('account menu: a "Your level" row opens #profile/level and follows the level', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(2) });
  const row = await until(() => doc.querySelector('#acct-menu #acct-level'));
  assert.ok(row, 'the row is mounted in the account menu');
  assert.equal(row.dataset.hash, 'profile/level');
  assert.match(row.textContent, /Swimmer · Level 2 of 4/);
  assert.equal(doc.querySelectorAll('#acct-level').length, 1);
  ctl.view = viewAt(3);
  poke('worca-level-changed');
  await until(() => /Hunter/.test(doc.querySelector('#acct-level')?.textContent || ''));
  assert.equal(doc.querySelectorAll('#acct-level').length, 1, 'repainted in place, never duplicated');
  click(window, doc.querySelector('#acct-level'));
  await settle();
  assert.equal(window.location.hash, '#profile/level');
});

test('refresh: a failed refetch keeps the last view in the corner', async () => {
  const { doc, ctl, poke } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  ctl.failView = true;
  const before = ctl.levelGets;
  poke('worca-level-changed');
  await until(() => ctl.levelGets === before + 1);
  await settle();
  assert.equal(cornerImg(doc).getAttribute('src'), '/assets/worca-levels/swimmer.svg');
});

test('I-6: a level-up leaves <html data-level> alone and never writes the interface mode or a flag', async () => {
  const { doc, ctl, calls, poke } = await boot({ view: viewAt(1) });
  doc.documentElement.dataset.level = 'simple';
  await until(() => cornerImg(doc));
  ctl.view = viewAt(3, { celebration: LADDER[2] });
  poke('worca-level-changed');
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'celebration');
  assert.equal(doc.documentElement.dataset.level, 'simple', 'the interface mode is unchanged');
  const writes = calls.filter((c) => c.method !== 'GET' && /\/api\/(settings|flags)/.test(c.url));
  assert.deepEqual(writes, [], 'no settings or flag write');
});

test('stats: showView(stats) posts stats-viewed once per navigation', async () => {
  const { window, ctl } = await boot({ view: viewAt(1) });
  const go = async (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  await go('#stats');
  assert.deepEqual(ctl.eventPosts, [{ type: 'stats-viewed' }]);
  await go('#stats');
  assert.equal(ctl.eventPosts.length, 1, 'staying on the page posts nothing more');
  await go('#chat');
  await go('#stats');
  assert.equal(ctl.eventPosts.length, 2, 'a new navigation posts again');
});

test('stats: a failed event post is logged and never thrown into the view', async () => {
  const { window, ctl } = await boot({ view: viewAt(1) });
  const warns = [];
  const orig = globalThis.console.warn;
  globalThis.console.warn = (...a) => warns.push(a.join(' '));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, init) => (String(u).includes('/api/worca-level/events') ? Promise.reject(new Error('offline')) : realFetch(u, init));
  window.location.hash = '#stats';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  globalThis.console.warn = orig;
  assert.equal(window.document.querySelector('.view[data-view="stats"]').classList.contains('hidden'), false, 'the view still opens');
  assert.ok(warns.some((w) => /offline/.test(w)), 'the error is logged');
  assert.deepEqual(ctl.eventPosts, []);
});

test('getting started: the shelf carries the next-level line, and none at the top level', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(1) });
  await until(() => cornerImg(doc));
  window.location.hash = '#getting-started';
  window.dispatchEvent(new window.Event('hashchange'));
  const line = await until(() => doc.querySelector('#getting-started-host .gs-worca-line'));
  assert.ok(line, 'the line is in the shelf');
  assert.match(line.textContent.replace(/\s+/g, ' '), /toward Swimmer, your next level/);
  assert.equal(line.querySelector('img').getAttribute('src'), '/assets/worca-levels/swimmer.svg');

  ctl.view = viewAt(4);
  poke('worca-level-changed');
  await until(() => doc.querySelector('#getting-started-host .gs-worca-line') === null);
  assert.equal(doc.querySelector('#getting-started-host .gs-worca-line'), null, 'the top level has no next level');
});

test('hover card: hovering the corner shows the level card from the loaded view', async () => {
  const { doc, window } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  corner(doc).dispatchEvent(new window.Event('mouseenter'));
  const card = await until(() => doc.querySelector('.worca-hover-card'), 2000);
  assert.ok(card, 'the card opens');
  assert.equal(card.querySelector('.ohc-name').textContent, 'Swimmer');
});
