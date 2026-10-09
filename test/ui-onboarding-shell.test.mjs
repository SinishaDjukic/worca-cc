// test/ui-onboarding-shell.test.mjs
// The Getting-started wiring in app.js: the pill mounted (not shipped) under the CTA,
// the one-time welcome, Hide → POST, Show again, and the guides: nav hops across views,
// a replay that walks every stop again, where the run and Ask tours end, and the
// interface-mode switch (asked up front, or raised mid-tour). That every guide's hops
// ring a control that exists is test/ui-guide-hops.test.mjs's job.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs). That
// also clears the poll of a guide a failed assertion left mid-tour, so it cannot cascade.
const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const appPath = join(root, 'app.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
/** Wait for a page condition (a guide re-lights on a tick, or on its 500 ms poll) — bounded,
 *  so a loaded machine cannot fail a step that has merely not painted yet. */
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return fn(); await new Promise((r) => setTimeout(r, 20)); }
};
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

const STEPS = ['claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace', 'teamMetrics', 'teamPolicy'];
const status = (done = [], flags = {}) => ({
  steps: Object.fromEntries(STEPS.map((id) => [id, done.includes(id)])),
  done: done.length, total: 9, claude: { bin: 'claude', hint: null }, hidden: false, welcomeSeen: false, ...flags,
});

async function boot({ onboarding = status(['claude']), projects = [], level = null } = {}) {
  // `level`: the server-rendered interface mode (docs/ui-levels.md); null = no attribute (gates nothing).
  const shellHtml = level ? html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`) : html;
  const dom = trackDom(new JSDOM(shellHtml, { url: 'http://localhost:4317/', pretendToBeVisual: true }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  let current = onboarding;
  window.fetch = (u, init = {}) => {
    const url = String(u);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/onboarding')) {
      if (init.method === 'POST') { const b = JSON.parse(init.body); posts.push(b); current = { ...current, ...b }; }
      return json(current);
    }
    if (url.includes('/api/projects')) return json({ projects });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  return { window, doc: window.document, posts, setStatus: (s) => { current = s; } };
}

// ---- app.js wiring ----

test('boot: the pill mounts under New pipeline and routes to the page (where the shelf paints), the welcome shows once', async () => {
  const { doc, window, posts } = await boot();
  const host = doc.getElementById('getting-started-host');
  assert.equal(host.hidden, true, 'not painted while the page is not open');
  const newRow = doc.querySelector('.nav button.nav-new[data-nav="new"]');
  const pillHost = newRow.nextElementSibling;
  assert.ok(pillHost && pillHost.classList.contains('gs-pill-host'), 'pill host right under New pipeline');
  assert.equal(pillHost.querySelector('.gs-pill .nav-count').textContent, '1/9');
  assert.equal(doc.querySelectorAll('.nav button[data-nav]').length, 12, 'the nav census is untouched (Schedules, Team policy and Scripts included; Running and History are one Runs item)');
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), false, 'first visit to New pipeline: welcome up');
  assert.deepEqual(posts, [], 'showing the welcome writes nothing until a choice');
  click(window, doc.querySelector('#welcome-modal .ob-skip'));
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  assert.equal(doc.querySelector('.view[data-view="getting-started"]').classList.contains('hidden'), false, 'the pill opens the page');
  assert.ok(doc.querySelector('.gs-pill').classList.contains('active'), 'and reads as the current view');
  assert.equal(host.hidden, false);
  assert.equal(host.querySelectorAll('.gs-tile').length, 9);
  assert.equal(host.querySelector('.gs-progress').textContent, '1 of 9');
  assert.equal(host.querySelector('.gs-hide').textContent, 'Hide from sidebar');
});

test('welcome: shows once; Skip or a door posts {welcomeSeen:true}; never shown when seen, and marked seen when everything is done', async () => {
  // Each row boots as many times as it needs (one boot per onboarding status).
  await checkRows([
    { name: 'welcome: Skip marks it seen and never returns; a door marks it seen and starts that guide (navigating to its view)', run: async () => {
      let { doc, window, posts } = await boot();
      click(window, doc.querySelector('#welcome-modal .ob-skip'));
      await settle();
      assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true);
      assert.deepEqual(posts, [{ welcomeSeen: true }]);

      ({ doc, window, posts } = await boot());
      click(window, doc.querySelector('#welcome-modal [data-door="project"]'));
      await settle();
      assert.deepEqual(posts, [{ welcomeSeen: true }]);
      // Getting to Projects is the FIRST hop: the sidebar entry is ringed, the view stays.
      assert.equal(doc.querySelector('.view[data-view="new"]').classList.contains('hidden'), false, 'no auto-navigation');
      let layer = doc.querySelector('.guide-layer.spotlight');
      assert.ok(layer, 'a spotlight is up');
      assert.ok(layer.dataset.target.startsWith('.nav button[data-nav="projects"]'), layer.dataset.target);
      assert.ok(!layer.dataset.target.includes('topnav'), 'there is no compact twin any more');
      // The user's own click on that entry routes, and the guide re-lights the next control.
      click(window, doc.querySelector('.nav button[data-nav="projects"]'));
      await settle();
      assert.equal(doc.querySelector('.view[data-view="projects"]').classList.contains('hidden'), false);
      layer = doc.querySelector('.guide-layer.spotlight');
      assert.equal(layer.dataset.target, '#project-add-btn');
    } },
    { name: 'welcome: not shown again once seen; not shown when everything is already done (marked seen instead)', run: async () => {
      let { doc, posts } = await boot({ onboarding: status(['claude'], { welcomeSeen: true }) });
      assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true);
      assert.deepEqual(posts, []);
      ({ doc, posts } = await boot({ onboarding: status(STEPS) }));
      assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true);
      assert.deepEqual(posts, [{ welcomeSeen: true }], 'nothing left to teach: silently marked seen');
      assert.equal(doc.querySelector('.gs-pill-host').hidden, true, 'and no pill');
    } },
  ]);
});

test('Hide posts {hidden:true} and removes the pill (the page stays); Settings › Show again posts {hidden:false} and opens the page', async () => {
  const { doc, window, posts } = await boot({ onboarding: status(['claude'], { welcomeSeen: true }) });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('#getting-started-host .gs-hide'));
  await settle();
  assert.deepEqual(posts, [{ hidden: true }]);
  assert.equal(doc.getElementById('getting-started-host').hidden, false, 'this page IS the checklist');
  assert.equal(doc.querySelector('#getting-started-host .gs-hide').textContent, 'Show in sidebar');
  assert.equal(doc.querySelector('.gs-pill-host').hidden, true);

  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  const btn = doc.getElementById('gsShowAgain');
  assert.equal(btn.textContent, 'Show again');
  assert.match(doc.getElementById('gsSettingsMsg').textContent, /^Hidden from the sidebar · 1 of 9 done/);
  click(window, btn);
  await settle();
  assert.deepEqual(posts, [{ hidden: true }, { hidden: false }]);
  assert.equal(doc.querySelector('.view[data-view="getting-started"]').classList.contains('hidden'), false, 'opens the page');
  assert.equal(doc.getElementById('getting-started-host').hidden, false, 'shelf painted');
  assert.equal(doc.querySelector('.gs-pill-host').hidden, false);
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true, 'ONLY the checklist returns — the welcome stays seen');
});

test('Connect Claude Code re-checks on open: a page that loaded while signed out does not keep saying so', async () => {
  const signedOut = status([], { welcomeSeen: true, claude: { bin: 'claude', hint: null, auth: 'signed-out' } });
  const { doc, window, setStatus } = await boot({ onboarding: signedOut });
  setStatus(status(['claude'], { welcomeSeen: true, claude: { bin: 'claude', hint: null, auth: 'signed-in' } }));
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="claude"]'));
  await settle();
  const line = doc.getElementById('claude-setup-status');
  assert.match(line.textContent, /installed and signed in/);
  assert.match(line.className, /\bok\b/);
});

test('a tile guide: "Connect Claude Code" opens the setup dialog; "Ask Worca" rings the dock pill in place; nav hops survive navigation', async () => {
  const { doc, window } = await boot({ onboarding: status([], { welcomeSeen: true }) });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="claude"]'));
  const setup = doc.getElementById('claude-setup-modal');
  assert.equal(setup.classList.contains('hidden'), false);
  assert.match(doc.getElementById('claude-setup-status').textContent, /not on the PATH/);
  click(window, doc.getElementById('claude-setup-close'));
  assert.equal(setup.classList.contains('hidden'), true);

  click(window, doc.querySelector('.gs-tile[data-step="ask"]'));
  await settle();
  let layer = doc.querySelector('.guide-layer');
  assert.ok(layer, 'spotlight up');
  assert.equal(layer.dataset.target, '.ask-pill');
  assert.equal(doc.querySelector('.view[data-view="getting-started"]').classList.contains('hidden'), false, 'stays on the page');
  // Sheet open (the pill hides): the input is next; typed text moves on to Send.
  const pill = doc.querySelector('.ask-pill'); const input = doc.querySelector('.ask-input');
  pill.hidden = true; pill.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  assert.equal(doc.querySelector('.guide-layer').dataset.target, '.ask-input');
  assert.match(doc.querySelector('.guide-text').textContent, /What did my last run change/);
  input.value = 'what changed?'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(doc.querySelector('.guide-layer').dataset.target, '.ask-send');
  pill.hidden = false;

  // The workspace guide with fewer than two projects first sends the user to Projects.
  click(window, doc.querySelector('.gs-tile[data-step="workspace"]'));
  await settle();
  layer = doc.querySelector('.guide-layer');
  assert.ok(layer.dataset.target.startsWith('.nav button[data-nav="projects"]'));
  assert.match(layer.querySelector('.guide-text').textContent, /at least two projects/);
  // Wherever the user goes, the hop is re-derived from the page rather than the guide ending.
  click(window, doc.querySelector('.nav button[data-nav="runs"]'));
  await settle();
  layer = doc.querySelector('.guide-layer');
  assert.ok(layer, 'still guiding');
  assert.ok(layer.dataset.target.startsWith('.nav button[data-nav="projects"]'), 'and still pointing at Projects');
  click(window, doc.querySelector('.nav button[data-nav="projects"]'));
  await settle();
  assert.equal(doc.querySelector('.guide-layer').dataset.target, '#project-add-btn');
  // Esc ends it.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();
  assert.equal(doc.querySelector('.guide-layer'), null);
});

test('a replay walks every stop again: a control whose state is already right is lit with its own copy and Next; a toggle is never passed by its click', async () => {
  const { doc, window } = await boot({ onboarding: status(['claude', 'project', 'run'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  // Left over from an earlier run: a task in the box and Mock on.
  const prompt = doc.getElementById('prompt');
  prompt.value = 'kept from last time';
  click(window, doc.getElementById('mock-switch'));
  assert.equal(doc.getElementById('mock-switch').getAttribute('aria-checked'), 'true');
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="run"]'));
  await settle();
  const target = () => doc.querySelector('.guide-layer')?.dataset.target;
  const text = () => doc.querySelector('.guide-layer .guide-text')?.textContent || '';
  const next = () => doc.querySelector('.guide-layer .guide-next');
  assert.ok(target().startsWith('.nav button[data-nav="new"]'), 'always from the first hop');
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await settle();
  // The project picker is a stop either way: unpicked it asks for a pick, picked it offers Next.
  assert.equal(target(), '#projectSelect');
  const sel = doc.getElementById('projectSelect');
  if (next()) {
    assert.match(text(), /picked here/);
    click(window, next());
  } else {
    sel.value = sel.options[1]?.value || '';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  await until(() => target() === '#prompt');
  assert.equal(target(), '#prompt', 'the filled task box is still a stop');
  assert.match(text(), /what is there will do/, 'with copy that knows it is filled');
  assert.ok(next(), 'and a Next');
  // Editing the box is the user's own "got it".
  prompt.value = 'kept from last time, edited';
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '#mock-switch');
  assert.equal(target(), '#mock-switch');
  assert.match(text(), /Mock mode is on/);
  assert.ok(next());
  // Clicking the switch turns Mock OFF: the hop stays, now asking for it back.
  click(window, doc.getElementById('mock-switch'));
  await until(() => target() === '#mock-switch' && !next());
  assert.equal(target(), '#mock-switch');
  assert.match(text(), /runs the whole pipeline offline/);
  assert.equal(next(), null, 'an unmet hop has no Next');
  click(window, doc.getElementById('mock-switch'));
  await until(() => target() === '#start-btn');
  assert.equal(target(), '#start-btn', 'Mock back on: the state arrived, the hop passed');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();

  // Starting again: Next passes a pre-satisfied stop, and the walk is fresh (the task box is a stop again).
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="run"]'));
  await settle();
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await until(() => target() === '#projectSelect');
  assert.equal(target(), '#projectSelect', 'a fresh walk: nothing passed earlier carries over');
  if (next()) click(window, next());
  else { sel.value = sel.options[1]?.value || ''; sel.dispatchEvent(new window.Event('change', { bubbles: true })); }
  await until(() => target() === '#prompt');
  assert.equal(target(), '#prompt');
  click(window, next());
  await until(() => target() === '#mock-switch');
  assert.equal(target(), '#mock-switch');
  click(window, next());
  await until(() => target() === '#start-btn');
  assert.equal(target(), '#start-btn');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('a step above the interface mode asks to switch first (Not now leaves all as it was; confirm switches and starts at the first real hop); at or below it asks nothing', async () => {
  // A table over level/step: each row boots at its own interface mode and opens its own step.
  await checkRows([
    { name: 'a step above the interface mode asks to switch first; "Not now" leaves everything as it was', run: async () => {
      const { doc, window } = await boot({ level: 'simple', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
      click(window, doc.querySelector('.gs-pill'));
      await settle();
      click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
      await settle();
      const modal = doc.getElementById('confirm-modal');
      assert.ok(!modal.classList.contains('hidden'), 'the confirm opens before any hop');
      assert.equal(doc.getElementById('confirm-title').textContent, 'Switch to Advanced?');
      assert.equal(doc.getElementById('confirm-ok').textContent, 'Switch to Advanced and start');
      assert.equal(doc.querySelector('.guide-layer'), null, 'no ring behind the question');
      click(window, doc.getElementById('confirm-cancel'));
      await settle();
      assert.equal(doc.documentElement.dataset.level, 'simple', 'Not now keeps the mode');
      assert.equal(doc.querySelector('.guide-layer'), null, 'and starts no tour');
    } },
    { name: 'confirming switches the mode and starts the tour at its first real hop', run: async () => {
      const { doc, window } = await boot({ level: 'simple', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
      click(window, doc.querySelector('.gs-pill'));
      await settle();
      click(window, doc.querySelector('.gs-tile[data-step="teamMetrics"]'));
      await settle();
      assert.equal(doc.getElementById('confirm-title').textContent, 'Switch to Expert?');
      click(window, doc.getElementById('confirm-ok'));
      await settle();
      assert.equal(doc.documentElement.dataset.level, 'expert');
      const target = doc.querySelector('.guide-layer')?.dataset.target || '';
      assert.ok(target.startsWith('.nav button[data-nav="projects"]'), `the tour itself, not the mode switch: ${target}`);
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    } },
    { name: 'a step at or below the mode starts with no question', run: async () => {
      const { doc, window } = await boot({ level: 'advanced', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
      click(window, doc.querySelector('.gs-pill'));
      await settle();
      click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
      await settle();
      assert.ok(doc.getElementById('confirm-modal').classList.contains('hidden'));
      assert.ok((doc.querySelector('.guide-layer')?.dataset.target || '').startsWith('.nav button[data-nav="composer"]'));
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    } },
  ]);
});
