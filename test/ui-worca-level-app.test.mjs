// test/ui-worca-level-app.test.mjs
// The worca level wiring in app.js: the corner shows the level avatar after boot, the dialogs open in
// order (and never over the first-run welcome or setup), a payload-free poke refetches once (debounced)
// and repaints, showView posts the page-viewed event per view (stats; team-metrics then refetches; team-policy
// posts discovery then refetches), a level dialog waits behind any open modal (D-14), the shelf carries the level line, and a
// level-up never touches the interface mode (I-6, R-po-2).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { WORCA_LEVELS } from '../src/shared/worca-levels.mjs';
import { SESSION_SHOWN_KEY } from '../ui/public/worca-level/model.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';
import { WORCA_REFRESH_EVENTS, WORCA_RETRY_MS } from '../ui/public/worca-level/app-wiring.mjs';

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

const LADDER = WORCA_LEVELS.map(({ index, key, name, avatar }) => ({ index, key, name, avatar }));
const TOP = LADDER.length;
/** A WorcaLevelView at `level` (1..5). `extra` overrides welcome / celebration / etc. */
const viewAt = (level, extra = {}) => {
  const cur = WORCA_LEVELS[level - 1];
  const upcoming = LADDER[level] || null;
  const top = level === TOP;
  return {
    level: { index: cur.index, key: cur.key, name: cur.name, tagline: cur.tagline, description: cur.description, avatar: cur.avatar },
    nextLevel: upcoming,
    progress: top ? null : { done: 1, total: 3 },
    next: top ? [] : [{ id: 'a', label: 'Do thing A', hint: 'Hint A', href: '#chat', done: true }, { id: 'b', label: 'Do thing B', hint: 'Hint B', href: '#runs', done: false }],
    top,
    ladder: LADDER.map((l) => ({ ...l, state: l.index < level ? 'reached' : l.index === level ? 'current' : l.index === level + 1 ? 'next' : 'later' })),
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
  const ctl = { view, onb, levelGets: 0, eventPosts: [], acks: [], ackBodies: [], failView, settingsFail: false };
  const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u, init = {}) => {
    const url = String(u);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.includes('/discover') && ctl.discover) return ctl.discover(url);
    if (url.includes('/api/worca-level/events')) { ctl.eventPosts.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, status: 204, json: async () => ({}) }); }
    if (url.includes('/api/worca-level/ack')) { const body = JSON.parse(init.body); ctl.acks.push(body.what); ctl.ackBodies.push(body); return json(ctl.view); }
    if (url.includes('/api/settings') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      return ctl.settingsFail ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'disk full' }) }) : json({ uiLevel: body.uiLevel });
    }
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
  const levelPosts = () => ctl.eventPosts.map((p) => p.type);
  const poke = (type) => {
    for (const s of sockets) for (const fn of s.listeners.message || []) fn({ data: JSON.stringify({ type }) });
  };
  const recv = (obj) => { for (const s of sockets) for (const fn of s.listeners.message || []) fn({ data: JSON.stringify(obj) }); };
  return { window, doc: window.document, ctl, calls, poke, recv, levelPosts };
}

const corner = (doc) => doc.getElementById('side-acct');
const cornerImg = (doc) => corner(doc).querySelector('.acct-ava img');
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

test('boot: the corner shows the level avatar as an <img> after the view loads', async () => {
  const { doc, ctl } = await boot({ view: viewAt(2) });
  const img = await until(() => cornerImg(doc));
  assert.ok(img, 'the corner paints an <img>');
  assert.equal(img.getAttribute('src'), '/assets/worca-levels/runner.svg');
  assert.equal(img.getAttribute('alt'), 'Runner');
  assert.ok(ctl.levelGets >= 1);
});

/** Hold back every 5 s timer (the level retry) so a test can fire it by hand; other timers run as usual. */
function captureRetryTimers() {
  const real = globalThis.setTimeout;
  const held = [];
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms === WORCA_RETRY_MS) { held.push(fn); return 0; }
    return real(fn, ms, ...rest);
  };
  return { held, restore: () => { globalThis.setTimeout = real; } };
}

test('a failed level fetch leaves the initials in the corner and throws nothing', async () => {
  const { doc, ctl } = await boot({ failView: true });
  assert.ok(ctl.levelGets >= 1, 'it tried');
  assert.equal(cornerImg(doc), null, 'no view: no image');
  assert.ok(corner(doc).querySelector('.acct-ava'));
  assert.equal(doc.querySelector('#acct-level-card'), null, 'no view: no menu row');
  assert.ok(corner(doc).querySelector('.acct-ava').textContent.trim().length > 0, 'the initials stay');
});

test('a failed GET hides the badge and the menu level element; account options still route', async () => {
  const timers = captureRetryTimers();
  try {
    const { doc, window, ctl } = await boot({ failView: true });
    assert.ok(ctl.levelGets >= 1, 'it tried');
    assert.equal(cornerImg(doc), null, 'no badge image');
    assert.equal(corner(doc).querySelector('.acct-dot[data-no-level]'), null, 'no no-level dot');
    assert.equal(doc.querySelector('#acct-level-card'), null, 'no level element in the menu');
    click(window, doc.getElementById('acct-settings'));
    await settle();
    assert.equal(window.location.hash, '#settings', 'an account option still routes');
  } finally { timers.restore(); }
});

test('a failed GET schedules exactly one retry after WORCA_RETRY_MS, which paints the level on success', async () => {
  assert.equal(WORCA_RETRY_MS, 5000);
  const timers = captureRetryTimers();
  try {
    const { doc, ctl } = await boot({ view: viewAt(2), failView: true });
    assert.equal(timers.held.length, 1, 'one retry is waiting');
    const before = ctl.levelGets;
    ctl.failView = false;
    timers.held[0]();
    await until(() => cornerImg(doc));
    assert.equal(ctl.levelGets, before + 1);
    assert.equal(cornerImg(doc).getAttribute('alt'), 'Runner');
    assert.equal(timers.held.length, 1, 'a success schedules no further retry');
  } finally { timers.restore(); }
});

const NO_LEVEL_VIEW = (missing = ['setup', 'provider']) => ({
  count: 5, level: null, setup: { finished: !missing.includes('setup'), providerSignedIn: !missing.includes('provider'), missing },
  progress: { done: 0, total: 2, unit: 'items' }, next: [], nextLevel: LADDER[0], top: false,
  ladder: LADDER.map((l) => ({ ...l, state: l.index === 1 ? 'next' : 'later', reachedAt: null, items: [] })),
  celebration: null, summary: null, nudge: null, modeSuggestion: null,
});

test('a view that fails the shape check counts as a failure and retries once, then waits for a poke', async () => {
  const timers = captureRetryTimers();
  try {
    const { doc, ctl, poke } = await boot({ view: { level: 'nonsense' } });
    assert.equal(cornerImg(doc), null);
    assert.equal(timers.held.length, 1, 'the malformed view schedules the retry');
    timers.held[0]();
    await settle();
    assert.equal(timers.held.length, 1, 'a second failure schedules nothing more');
    const before = ctl.levelGets;
    ctl.view = viewAt(2);
    poke('hello');
    await until(() => cornerImg(doc));
    assert.equal(ctl.levelGets, before + 1, 'a reconnect hello refetches');
  } finally { timers.restore(); }
});

test('a hello after a failure refetches and paints the level', async () => {
  const timers = captureRetryTimers();
  try {
    const { doc, ctl, poke } = await boot({ view: viewAt(2), failView: true });
    assert.equal(cornerImg(doc), null);
    const before = ctl.levelGets;
    ctl.failView = false;
    poke('hello');
    const img = await until(() => cornerImg(doc));
    assert.ok(img, 'the level is painted');
    assert.equal(ctl.levelGets, before + 1);
  } finally { timers.restore(); }
});

test('WORCA_REFRESH_EVENTS contains hello so a reconnect refetches', () => {
  assert.ok(WORCA_REFRESH_EVENTS.has('hello'));
});

test('dialogs: a view that still carries a welcome opens nothing; the celebration alone opens and is acknowledged once', async () => {
  const { doc, window, ctl } = await boot({ view: viewAt(1, { welcome: { kind: 'new' }, celebration: LADDER[2] }) });
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'celebration', 'there is no levels welcome');
  click(window, dlg.querySelector('.worca-dlg-close'));
  await settle();
  assert.deepEqual(ctl.acks, ['celebration']);
  assert.equal(doc.querySelector('.worca-dlg'), null);
});

test('dialogs: a celebration opens when the view carries one and there is no welcome', async () => {
  const { doc, window, ctl } = await boot({ view: viewAt(3, { celebration: LADDER[2] }) });
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'celebration');
  click(window, dlg.querySelector('.worca-dlg-close'));
  await settle();
  assert.deepEqual(ctl.acks, ['celebration']);
  assert.equal(doc.querySelector('.worca-dlg'), null, 'a closed dialog does not reopen from the same view');
});

test('dialogs: nothing opens while the first-run welcome is up; the celebration opens once that is dismissed', async () => {
  const { doc, window, ctl } = await boot({
    view: viewAt(1, { welcome: { kind: 'new' }, celebration: LADDER[0] }),
    onb: onboarding({ welcomeSeen: false }),
  });
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), false, 'precondition: the first-run welcome is up');
  assert.equal(doc.querySelector('.worca-dlg'), null, 'the worca dialog waits');
  click(window, doc.querySelector('#welcome-modal .ob-skip'));
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.ok(dlg, 'and follows the welcome');
  assert.equal(dlg.dataset.dialog, 'celebration');
  assert.deepEqual(ctl.acks, []);
});

test('dialogs: nothing opens while the setup assistant is up; the celebration opens once that closes', async () => {
  const { doc, window } = await boot({
    view: viewAt(1, { celebration: LADDER[0] }),
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
  assert.equal(dlg.dataset.dialog, 'celebration');
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
  await until(() => cornerImg(doc)?.getAttribute('src') === '/assets/worca-levels/runner.svg');
  await wait(400);
  assert.equal(ctl.levelGets - before, 1, 'one refetch for the whole burst');
  assert.equal(cornerImg(doc).getAttribute('alt'), 'Runner');
});

test('refresh: each of the seven events alone triggers a refetch', async () => {
  const { ctl, poke } = await boot({ view: viewAt(1) });
  for (const type of ['worca-level-changed', 'pipelines-changed', 'plugins-changed', 'workspaces-changed', 'schedules-changed', 'team-policy-changed', 'team-metrics-changed']) {
    await wait(400);
    const before = ctl.levelGets;
    poke(type);
    await until(() => ctl.levelGets === before + 1);
    assert.equal(ctl.levelGets, before + 1, type);
  }
});

test('WORCA_REFRESH_EVENTS contains team-policy-changed and team-metrics-changed', () => {
  assert.ok(WORCA_REFRESH_EVENTS.has('team-policy-changed'));
  assert.ok(WORCA_REFRESH_EVENTS.has('team-metrics-changed'));
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
  await until(() => cornerImg(doc)?.getAttribute('src') === '/assets/worca-levels/hooked.svg');
  ctl.gate[0]();                       // then the older one, late
  await settle();
  assert.equal(cornerImg(doc).getAttribute('src'), '/assets/worca-levels/hooked.svg');
});

test('account menu: the level card links to #profile/level, is the menu\'s first item and follows the level', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(2) });
  const card = await until(() => doc.querySelector('#acct-menu #acct-level-card'));
  assert.ok(card, 'the card is mounted in the account menu');
  assert.equal(card.dataset.hash, 'profile/level');
  assert.equal(card.dataset.nav, 'profile');
  assert.match(card.textContent, /Runner/);
  assert.match(card.textContent, /To Hooked/);
  assert.match(card.textContent, /View level/);
  assert.equal(card, doc.getElementById('acct-menu').firstElementChild, 'the first item of the account menu');
  assert.equal(card.nextElementSibling?.id, 'acct-id', '"Signed in as" follows it');
  ctl.view = viewAt(3);
  poke('worca-level-changed');
  await until(() => /Hooked/.test(doc.querySelector('#acct-level-card .wl-card-name')?.textContent || ''));
  assert.equal(doc.querySelectorAll('#acct-level-card').length, 1, 'repainted in place, never duplicated');
});

test('account menu: clicking the compact level card goes straight to #profile/level and closes the menu, opening nothing else', async () => {
  const { doc, window } = await boot({ view: viewAt(2) });
  const card = await until(() => doc.querySelector('#acct-menu #acct-level-card'));
  const menu = doc.getElementById('acct-menu');
  doc.getElementById('side-acct').click();
  await settle();
  assert.equal(menu.hidden, false, 'the menu is open');
  const OVERLAYS = '.worca-hover-card, .worca-dlg, .viewer-modal:not(.hidden):not([hidden]), [role="dialog"]:not([hidden]):not(.hidden), [role="group"][aria-label="Your worca level"]';
  const before = doc.querySelectorAll(OVERLAYS).length;
  click(window, card);
  await settle();
  assert.equal(window.location.hash, '#profile/level');
  assert.equal(menu.hidden, true, 'the menu closed');
  assert.equal(doc.querySelectorAll(OVERLAYS).length, before, 'no popover, dialog or card opened');
  assert.equal(doc.body.querySelector('.wl-hc-head, .wl-try, .wl-profile-link'), null, 'no expanded card content anywhere');
});

test('refresh: a failed refetch keeps the last view in the corner', async () => {
  const { doc, ctl, poke } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  ctl.failView = true;
  const before = ctl.levelGets;
  poke('worca-level-changed');
  await until(() => ctl.levelGets === before + 1);
  await settle();
  assert.equal(cornerImg(doc).getAttribute('src'), '/assets/worca-levels/runner.svg');
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

test('stats: opening it posts nothing to the level events endpoint and does not refetch (D-19)', async () => {
  const { window, ctl, levelPosts } = await boot({ view: viewAt(1) });
  const before = ctl.levelGets;
  const go = async (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  await go('#stats');
  await go('#chat');
  await go('#stats');
  await wait(400);
  assert.deepEqual(levelPosts(), []);
  assert.equal(ctl.levelGets, before);
});

test('getting started: the shelf carries the level line, looking ahead at Curious and saying where you stand after', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(1) });
  await until(() => cornerImg(doc));
  window.location.hash = '#getting-started';
  window.dispatchEvent(new window.Event('hashchange'));
  const line = await until(() => doc.querySelector('#getting-started-host .gs-level-line'));
  assert.ok(line, 'the line is in the shelf');
  assert.match(line.textContent.replace(/\s+/g, ' '), /toward Runner, your next level/);
  assert.equal(line.querySelector('img').getAttribute('src'), '/assets/worca-levels/runner.svg');

  ctl.view = viewAt(3);
  poke('worca-level-changed');
  await until(() => /You are Hooked, level 3 of 5/.test(doc.querySelector('#getting-started-host .gs-level-line')?.textContent || ''));
  assert.match(doc.querySelector('#getting-started-host .gs-level-line').textContent, /You are Hooked, level 3 of 5/);
});

test('no element with role=group "Your worca level" is ever created', async () => {
  const { doc, window } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  const groups = () => doc.querySelectorAll('[role="group"][aria-label="Your worca level"], .worca-hover-card');
  const mo = new window.MutationObserver(() => {});
  mo.observe(doc.body, { childList: true, subtree: true });
  for (const type of ['mouseenter', 'mouseover', 'focus']) corner(doc).dispatchEvent(new window.Event(type, { bubbles: true }));
  await wait(600);
  assert.equal(groups().length, 0, 'hovering or focusing the corner creates nothing');
  click(window, corner(doc));
  await settle();
  assert.equal(groups().length, 0, 'opening the menu creates no such group either');
  mo.disconnect();
});

test('a level-0 view shows initials with the dot, the no-level menu card, and polls nothing (R-po-1, R-po-25, R-po-27)', async () => {
  const timers = captureRetryTimers();
  try {
    const { doc, window, ctl } = await boot({ view: NO_LEVEL_VIEW(['provider']) });
    await settle();
    assert.equal(cornerImg(doc), null, 'no avatar image');
    assert.ok(corner(doc).querySelector('.acct-ava').textContent.trim().length > 0, 'the initials show');
    assert.ok(corner(doc).querySelector('.acct-dot[data-no-level]'), 'the no-level dot');
    assert.equal(doc.querySelectorAll('[aria-label="Your worca level"], .worca-hover-card').length, 0);
    const card = doc.querySelector('#acct-menu #acct-level-card');
    assert.ok(card, 'the menu carries the no-level card');
    assert.match(card.textContent, /Sign in to a model provider/);
    click(window, card.querySelector('.wl-menu-act'));
    await settle();
    assert.equal(timers.held.length, 0, 'a level-0 view is a good view: no retry is armed');
    const gets = ctl.levelGets;
    await wait(300);
    assert.equal(ctl.levelGets, gets, 'and nothing polls');
  } finally { timers.restore(); }
});

test('the corner dot goes away once a level is held, and a null view never shows it (I-7)', async () => {
  const { doc, ctl, poke } = await boot({ view: NO_LEVEL_VIEW() });
  await until(() => corner(doc).querySelector('.acct-dot[data-no-level]'));
  ctl.view = viewAt(1);
  poke('onboarding-changed');
  await until(() => cornerImg(doc));
  assert.equal(corner(doc).querySelector('.acct-dot[data-no-level]'), null, 'a level is held: no dot');
  const failed = await boot({ failView: true });
  assert.equal(corner(failed.doc).querySelector('.acct-dot[data-no-level]'), null, 'no view: no dot');
});

test('the Getting started pill repaints from the level view once it arrives and after each real run (M4)', async () => {
  const withRuns = (n) => viewAt(1, { runner: { realRuns: n, of: 3, stepsDone: 4, stepsOf: 6 } });
  const { doc, ctl, poke } = await boot({ view: withRuns(0), onb: onboarding({ setupFinished: true }) });
  const text = () => doc.querySelector('.gs-pill')?.textContent || '';
  await until(() => /Runner · \d of 7/.test(text()));
  assert.match(text(), /Runner · 1 of 7/, 'the level view reached the pill, not the old "Getting started 1/9"');
  ctl.view = withRuns(3);
  poke('pipelines-changed');
  await until(() => /Runner · 2 of 7/.test(text()));
  assert.match(text(), /Runner · 2 of 7/, 'the third real run moves it');
});

const suggestion = (doc) => doc.querySelector('#mode-suggest-banner');
/** Boot with the interface mode at Simple, so the suggestion has somewhere to go, and repaint once. */
async function bootSimple(opts) {
  const b = await boot(opts);
  b.doc.documentElement.dataset.level = 'simple';
  b.poke('onboarding-changed');
  return b;
}
const tryButton = (doc) => [...doc.querySelectorAll('#mode-suggest-banner button')].find((b) => /^Try /.test(b.textContent));

test('accepting the mode suggestion acks "accepted" only after the mode saved; a refused save acks nothing (R-po-15, I-10)', async () => {
  const failing = await bootSimple({ view: viewAt(3, { modeSuggestion: 'advanced' }) });
  failing.ctl.settingsFail = true;
  await until(() => tryButton(failing.doc));
  click(failing.window, tryButton(failing.doc));
  await settle(12);
  assert.deepEqual(failing.ctl.ackBodies.filter((b) => b.what === 'mode-suggestion'), [], 'the mode was not changed, so nothing is recorded');
  const ok = await bootSimple({ view: viewAt(3, { modeSuggestion: 'advanced' }) });
  await until(() => tryButton(ok.doc));
  click(ok.window, tryButton(ok.doc));
  await until(() => ok.ctl.ackBodies.some((b) => b.what === 'mode-suggestion'));
  assert.deepEqual(ok.ctl.ackBodies.find((b) => b.what === 'mode-suggestion'), { what: 'mode-suggestion', mode: 'advanced', answer: 'accepted' });
});

test('a dismissed mode banner stays dismissed on the next repaint of the same session (m1)', async () => {
  const { doc, window, ctl } = await bootSimple({ view: viewAt(3, { modeSuggestion: 'advanced' }) });
  const dismiss = await until(() => doc.querySelector('#mode-suggest-banner .btn-icon'));
  ctl.view = viewAt(3, { modeSuggestion: null });   // what the server answers once the dismissal is stored
  click(window, dismiss);
  await until(() => ctl.ackBodies.some((b) => b.what === 'mode-suggestion'));
  await settle(12);
  ctl.view = viewAt(3, { modeSuggestion: 'advanced' });   // a stale read, as if no change event had come
  window.dispatchEvent(new window.Event('worca:level'));
  await settle(8);
  assert.equal(suggestion(doc), null, 'it does not come back');
});

const goTo = async (window, hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };

test('opening team-metrics runs discovery then refetches the level (once per 60 s), and posts no page view', async () => {
  const { window, ctl, calls, levelPosts } = await boot({ view: viewAt(3) });
  const before = ctl.levelGets;
  const discovers = () => calls.filter((c) => c.url.includes('/api/team-metrics/discover') && c.method === 'POST');
  await goTo(window, '#team-metrics');
  await until(() => ctl.levelGets === before + 1);
  assert.equal(discovers().length, 1);
  assert.match(discovers()[0].url, /\?source=page$/, 'a page open says so, so the server may reuse a recent result');
  await goTo(window, '#team-policy');
  await goTo(window, '#team-metrics');
  await wait(300);
  assert.equal(discovers().length, 1, 'a second open inside 60 s does not post again');
  assert.deepEqual(levelPosts(), []);
});

test('the level is re-read only after discovery answers', async () => {
  const { window, ctl } = await boot({ view: viewAt(3) });
  let release;
  ctl.discover = () => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({}) }); });
  const before = ctl.levelGets;
  await goTo(window, '#team-metrics');
  await wait(300);
  assert.equal(ctl.levelGets, before, 'no level read while discovery is pending');
  release();
  await until(() => ctl.levelGets === before + 1);
});

test('opening team-metrics still re-reads the level when discovery fails', async () => {
  const { window, ctl } = await boot({ view: viewAt(3) });
  let rejected = 0;
  ctl.discover = () => { rejected += 1; return Promise.reject(new Error('offline')); };
  const before = ctl.levelGets;
  await goTo(window, '#team-metrics');
  await until(() => ctl.levelGets === before + 1);
  assert.equal(rejected, 1, 'the rejecting stub was reached');
  assert.equal(ctl.levelGets, before + 1);
});

test('a live level-up is celebrated after an earlier dialog this session', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(3, { celebration: LADDER[2] }) });
  click(window, (await until(() => doc.querySelector('.worca-dlg'))).querySelector('.worca-dlg-close'));
  await settle();
  assert.equal(doc.querySelector('.worca-dlg'), null);
  ctl.view = viewAt(4, { celebration: LADDER[3] });
  poke('worca-level-changed');
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg.dataset.dialog, 'celebration');
});

test('a backlog celebration at boot still waits for a new session', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(3) });
  window.sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
  ctl.view = viewAt(3, { celebration: LADDER[2] });
  poke('worca-level-changed');
  await until(() => ctl.levelGets >= 2);
  await wait(400);
  assert.equal(doc.querySelector('.worca-dlg'), null);
});

test('a hidden tab refetches when it becomes visible', async () => {
  const { doc, window, ctl } = await boot({ view: viewAt(3) });
  const before = ctl.levelGets;
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  doc.dispatchEvent(new window.Event('visibilitychange'));
  await wait(400);
  assert.equal(ctl.levelGets, before, 'hiding refetches nothing');
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
  doc.dispatchEvent(new window.Event('visibilitychange'));
  await until(() => ctl.levelGets === before + 1);
});

test('team-policy: opening it posts policy discovery, re-fetches the level and posts no page view', async () => {
  const { window, ctl, calls, levelPosts } = await boot({ view: viewAt(3) });
  const before = ctl.levelGets;
  await goTo(window, '#team-policy');
  await until(() => ctl.levelGets === before + 1);
  assert.equal(ctl.levelGets, before + 1);
  assert.equal(calls.filter((c) => c.url.includes('/api/policy/discover') && c.method === 'POST').length, 1);
  await wait(300);
  assert.deepEqual(levelPosts(), []);
});

test('R-po-6, D-14: a level dialog waits while a prompt modal is open, and the prompt is left alone', async () => {
  const { doc, ctl, poke } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  const prompt = doc.getElementById('confirm-modal');
  prompt.classList.remove('hidden');
  const parent = prompt.parentNode;
  const next = prompt.nextSibling;
  const classes = prompt.className;
  ctl.view = viewAt(3, { celebration: LADDER[2] });
  poke('worca-level-changed');
  await until(() => /Hooked/.test(doc.querySelector('#acct-level-card .wl-card-name')?.textContent || ''));
  await settle();
  assert.equal(doc.querySelector('.worca-dlg'), null, 'the dialog waits');
  assert.equal(prompt.className, classes, 'the prompt is not hidden or changed');
  assert.equal(prompt.parentNode, parent);
  assert.equal(prompt.nextSibling, next, 'the prompt is not re-ordered');
  prompt.classList.add('hidden');
  poke('worca-level-changed');
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg?.dataset.dialog, 'celebration', 'it follows on the next poke');
});

test('R-po-2: a mode switch does not refetch or repaint the level; a level poke keeps data-level', async () => {
  const { doc, ctl, poke } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  await wait(400);
  const before = ctl.levelGets;
  const avatar = cornerImg(doc);
  for (const mode of ['advanced', 'expert', 'simple']) {
    applyLevel(mode, doc);
    await wait(300);
    assert.equal(doc.documentElement.dataset.level, mode);
  }
  assert.equal(ctl.levelGets, before, 'no refetch on a mode change');
  assert.equal(cornerImg(doc), avatar, 'the same avatar node');
  applyLevel('advanced', doc);
  ctl.view = viewAt(3, { celebration: LADDER[2] });
  poke('worca-level-changed');
  await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(doc.documentElement.dataset.level, 'advanced', 'a level-up leaves the mode alone');
});

test('R-po-3: level elements are present and identical at simple, advanced and expert, and carry no data-min-level', async () => {
  const { doc } = await boot({ view: viewAt(2) });
  await until(() => doc.querySelector('#acct-level-card'));
  const snap = () => ({
    ava: corner(doc).querySelector('.acct-ava').outerHTML,
    card: doc.getElementById('acct-level-card').outerHTML,
  });
  const seen = {};
  for (const mode of ['simple', 'advanced', 'expert']) {
    applyLevel(mode, doc);
    await settle(2);
    seen[mode] = snap();
    for (const n of [corner(doc).querySelector('.acct-ava'), doc.getElementById('acct-level-card')]) {
      assert.equal(n.hasAttribute('data-min-level'), false, `${mode}: the level element itself carries no gate`);
      assert.equal(n.querySelector('[data-min-level]'), null);
      // the shell parts around it (the corner button, the account menu) are shown at every mode
      for (let up = n.parentElement; up; up = up.parentElement) assert.ok([null, 'simple'].includes(up.getAttribute('data-min-level')), `${mode}: an ancestor gates the level element`);
    }
  }
  assert.deepEqual(seen.advanced, seen.simple);
  assert.deepEqual(seen.expert, seen.simple);
});

test('R-po-5: Open Team policy at Simple shows the page plus #level-banner', async () => {
  const { doc, window } = await boot({ view: viewAt(3) });
  applyLevel('simple', doc);
  await goTo(window, '#team-metrics');
  assert.equal(doc.querySelector('.view[data-view="team-metrics"]').classList.contains('hidden'), false, 'the page opens');
  const banner = doc.getElementById('level-banner');
  assert.equal(banner.hidden, false, 'the banner shows');
  assert.match(banner.textContent, /Team metrics is part of Expert mode/);
});

test('R-po-14: the Try next link to Schedules opens the page in Simple, with the banner', async () => {
  const { doc, window } = await boot({ view: viewAt(3) });
  applyLevel('simple', doc);
  const a = doc.createElement('a');
  a.setAttribute('href', '#schedules');
  doc.body.append(a);
  a.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  assert.equal(window.location.hash, '#schedules');
  assert.equal(doc.querySelector('.view[data-view="schedules"]').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('level-banner').hidden, false);
});

// ---- the celebration gate (D-13, D-14) ----

const liveRun = (runId, status = 'running') => ({ runId, title: runId, projectDir: '/tmp/p', status, kind: 'run', startedAt: '10:00:00', pendingQuestion: null });

test('D-13: reaching Runner while on #running/<live id> shows nothing; opening #history/<p>/<id> shows the celebration once', async () => {
  const { doc, window, ctl, poke, recv } = await boot({ view: viewAt(1) });
  await until(() => cornerImg(doc));
  recv({ type: 'hello', runs: [liveRun('r1')] });
  await goTo(window, '#running/r1');
  ctl.view = viewAt(2, { celebration: LADDER[1] });
  poke('worca-level-changed');
  await until(() => /Runner/.test(doc.querySelector('#acct-level-card .wl-card-name')?.textContent || ''));
  await settle();
  assert.equal(doc.querySelector('.worca-dlg'), null, 'a live run on screen: nothing');
  await goTo(window, '#history/proj/abc');
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.equal(dlg?.dataset.dialog, 'celebration');
  click(window, dlg.querySelector('.worca-dlg-close'));
  await settle();
  assert.deepEqual(ctl.acks, ['celebration']);
  poke('worca-level-changed');
  await wait(400);
  assert.equal(doc.querySelector('.worca-dlg'), null, 'shown once');
});

test('D-13: Runner also shows once the run on screen has ended', async () => {
  const { doc, ctl, poke, recv, window } = await boot({ view: viewAt(1) });
  await until(() => cornerImg(doc));
  recv({ type: 'hello', runs: [liveRun('r1')] });
  await goTo(window, '#running/r1');
  ctl.view = viewAt(2, { celebration: LADDER[1] });
  poke('worca-level-changed');
  await wait(400);
  assert.equal(doc.querySelector('.worca-dlg'), null);
  recv({ type: 'hello', runs: [liveRun('r1', 'done')] });
  poke('worca-level-changed');
  assert.ok(await until(() => doc.querySelector('.worca-dlg')), 'the finished run is a result route');
});

test('D-14: a guide and the open account menu each hold the dialog back; a second level reached live is still celebrated', async () => {
  const { doc, window, ctl, poke } = await boot({ view: viewAt(2) });
  await until(() => cornerImg(doc));
  const layer = doc.createElement('div');
  layer.className = 'guide-layer spotlight';
  layer.innerHTML = '<div class="guide-scrim"></div>';
  doc.body.append(layer);
  ctl.view = viewAt(3, { celebration: LADDER[2] });
  poke('worca-level-changed');
  await until(() => /Hooked/.test(doc.querySelector('#acct-level-card .wl-card-name')?.textContent || ''));
  await settle();
  assert.equal(doc.querySelector('.worca-dlg'), null, 'a guide is lit');
  layer.remove();
  const menu = doc.getElementById('acct-menu');
  menu.hidden = false;
  poke('worca-level-changed');
  await wait(400);
  assert.equal(doc.querySelector('.worca-dlg'), null, 'the menu is open');
  menu.hidden = true;
  poke('worca-level-changed');
  const dlg = await until(() => doc.querySelector('.worca-dlg'));
  assert.ok(dlg, 'free to show');
  click(window, dlg.querySelector('.worca-dlg-close'));
  await settle();
  assert.equal(window.sessionStorage.getItem('worca-level:shown-in-session'), '1');
  ctl.view = viewAt(4, { celebration: LADDER[3] });
  poke('worca-level-changed');
  assert.ok(await until(() => doc.querySelector('.worca-dlg')), 'a level reached live is celebrated even after one dialog this session');
});
