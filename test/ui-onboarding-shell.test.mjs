// test/ui-onboarding-shell.test.mjs
// The Getting-started wiring in the shell + app.js: the shelf host above the New
// pipeline form, the pill mounted (not shipped) under the CTA, the Settings card
// before About, the one-time welcome, Hide → POST, Show again, and the guides:
// nav hops across views, a replay that walks every stop again, the Composer tour,
// and the interface-mode switch (asked up front, or raised mid-tour).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
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

const STEPS = ['claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace', 'teamMetrics'];
const status = (done = [], flags = {}) => ({
  steps: Object.fromEntries(STEPS.map((id) => [id, done.includes(id)])),
  done: done.length, total: 8, claude: { bin: 'claude', hint: null }, hidden: false, welcomeSeen: false, ...flags,
});

async function boot({ onboarding = status(['claude']), projects = [], level = null } = {}) {
  // `level`: the server-rendered interface mode (docs/ui-levels.md); null = no attribute (gates nothing).
  const shellHtml = level ? html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`) : html;
  // A guide left running by an earlier test (an assertion failed mid-tour) polls the GLOBAL
  // document, which this boot replaces: end it first so one failure cannot cascade.
  try { globalThis.document?.dispatchEvent(new globalThis.window.KeyboardEvent('keydown', { key: 'Escape' })); } catch { /* no page yet */ }
  const dom = new JSDOM(shellHtml, { url: 'http://localhost:4317/', pretendToBeVisual: true });
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

// ---- static shell ----

test('shell: Getting started is its own view with the shelf host; the Settings card precedes About; both dialogs exist', () => {
  const doc = new JSDOM(html).window.document;
  const view = doc.querySelector('.view[data-view="getting-started"]');
  assert.ok(view, 'a routed view of its own');
  assert.equal(view.querySelector('.topbar h1').textContent, 'Getting started');
  const host = view.querySelector('#getting-started-host');
  assert.ok(host, 'host in the Getting started view');
  assert.equal(host.hidden, true, 'ships hidden: painted only once the status is known');
  assert.equal(doc.querySelector('.view[data-view="new"] #getting-started-host'), null, 'New pipeline is just the form again');
  const settings = doc.querySelector('.view[data-view="settings"]');
  const cards = [...settings.querySelectorAll('section.card.settings-card')];
  const gsIdx = cards.findIndex((c) => c.id === 'getting-started-card');
  assert.ok(gsIdx !== -1, 'a Getting started card');
  assert.equal(cards[gsIdx + 1].id, 'about-card', 'right before About');
  assert.equal(cards[gsIdx].closest('.settings-pane').dataset.tab, 'general', 'on the General tab');
  const btn = cards[gsIdx].querySelector('#gsShowAgain');
  assert.ok(btn && btn.tagName === 'BUTTON' && btn.getAttribute('type') === 'button');
  assert.equal(cards[gsIdx].querySelector('button.info-tip'), null, 'no ⓘ (the tooltip census stays at 14)');
  assert.equal(cards[gsIdx].querySelector('.hint').textContent.trim(), '', 'the status line is painted, never shipped');
  for (const id of ['welcome-modal', 'claude-setup-modal']) {
    const m = doc.getElementById(id);
    assert.ok(m, id);
    assert.ok(m.classList.contains('viewer-modal') && m.classList.contains('hidden'), `${id} is a hidden viewer-modal`);
    assert.equal(m.getAttribute('role'), 'dialog');
  }
  assert.equal(doc.querySelectorAll('#welcome-modal [data-door]').length, 3, 'three doors');
  assert.ok(!/data-nav="getting-started"/.test(html), 'the pill is mounted by app.js, never shipped');
});

test('css: spotlight layers sit above the Ask dock (40) and below the modals (50); pointer rides above them', () => {
  const rule = (sel) => { const i = css.indexOf(`${sel}{`); return i === -1 ? null : css.slice(i, css.indexOf('}', i)); };
  assert.match(rule('.guide-scrim'), /z-index:44/);
  assert.match(rule('.guide-target'), /z-index:45/);
  assert.match(rule('.guide-lift'), /z-index:45 !important/);
  assert.match(rule('.guide-ring'), /z-index:46/);
  assert.match(rule('.guide-balloon'), /z-index:47/);
  assert.match(rule('.guide-layer.pointer .guide-ring'), /z-index:72/);
  assert.match(rule('.ask-dock'), /z-index:40/);
  assert.match(rule('.viewer-modal'), /z-index:50/);
  const reduced = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.match(css.slice(reduced), /\.guide-ring[^{]*\{animation:none/, 'the final reduced-motion block stills the ring');
  assert.match(css.slice(reduced), /\.nav button\.gs-pill[^{]*\{animation:none/, 'and the pill halo');
  assert.ok(css.indexOf('.gs-tile.reveal{animation') < reduced, 'the shelf animations precede that block');
});

// ---- app.js wiring ----

test('boot: the pill mounts under the CTA and routes to the page (where the shelf paints), the welcome shows once', async () => {
  const { doc, window, posts } = await boot();
  const host = doc.getElementById('getting-started-host');
  assert.equal(host.hidden, true, 'not painted while the page is not open');
  const cta = doc.querySelector('.nav button.nav-cta');
  const pillHost = cta.nextElementSibling;
  assert.ok(pillHost && pillHost.classList.contains('gs-pill-host'), 'pill host right under New pipeline');
  assert.equal(pillHost.querySelector('.gs-pill .nav-count').textContent, '1/8');
  assert.equal(doc.querySelectorAll('.nav button[data-nav]').length, 11, 'the nav census is untouched (Schedules included)');
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), false, 'first visit to New pipeline: welcome up');
  assert.deepEqual(posts, [], 'showing the welcome writes nothing until a choice');
  click(window, doc.querySelector('#welcome-modal .ob-skip'));
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  assert.equal(doc.querySelector('.view[data-view="getting-started"]').classList.contains('hidden'), false, 'the pill opens the page');
  assert.ok(doc.querySelector('.gs-pill').classList.contains('active'), 'and reads as the current view');
  assert.equal(host.hidden, false);
  assert.equal(host.querySelectorAll('.gs-tile').length, 8);
  assert.equal(host.querySelector('.gs-progress').textContent, '1 of 8');
  assert.equal(host.querySelector('.gs-hide').textContent, 'Hide from sidebar');
});

test('welcome: Skip marks it seen and never returns; a door marks it seen and starts that guide (navigating to its view)', async () => {
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
  assert.ok(layer.dataset.target.includes('.topnav button[data-nav="projects"]'), 'the compact top-nav twin is the fallback');
  // The user's own click on that entry routes, and the guide re-lights the next control.
  click(window, doc.querySelector('.nav button[data-nav="projects"]'));
  await settle();
  assert.equal(doc.querySelector('.view[data-view="projects"]').classList.contains('hidden'), false);
  layer = doc.querySelector('.guide-layer.spotlight');
  assert.equal(layer.dataset.target, '#project-add-btn');
});

test('welcome: not shown again once seen; not shown when everything is already done (marked seen instead)', async () => {
  let { doc, posts } = await boot({ onboarding: status(['claude'], { welcomeSeen: true }) });
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true);
  assert.deepEqual(posts, []);
  ({ doc, posts } = await boot({ onboarding: status(STEPS) }));
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true);
  assert.deepEqual(posts, [{ welcomeSeen: true }], 'nothing left to teach: silently marked seen');
  assert.equal(doc.querySelector('.gs-pill-host').hidden, true, 'and no pill');
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
  assert.match(doc.getElementById('gsSettingsMsg').textContent, /^Hidden from the sidebar · 1 of 8 done/);
  click(window, btn);
  await settle();
  assert.deepEqual(posts, [{ hidden: true }, { hidden: false }]);
  assert.equal(doc.querySelector('.view[data-view="getting-started"]').classList.contains('hidden'), false, 'opens the page');
  assert.equal(doc.getElementById('getting-started-host').hidden, false, 'shelf painted');
  assert.equal(doc.querySelector('.gs-pill-host').hidden, false);
  assert.equal(doc.getElementById('welcome-modal').classList.contains('hidden'), true, 'ONLY the checklist returns — the welcome stays seen');
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
  click(window, doc.querySelector('.nav button[data-nav="history"]'));
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

test('the mock-run guide: nav to New pipeline first, then project → prompt → Mock → Start', async () => {
  const { doc, window } = await boot({ onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  window.location.hash = 'history';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="run"]'));
  await settle();
  const target = () => doc.querySelector('.guide-layer')?.dataset.target;
  assert.ok(target().startsWith('.nav button[data-nav="new"]'), 'from the page: New pipeline is the first hop');
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await settle();
  const sel = doc.getElementById('projectSelect');
  if (!(sel.value || '').trim()) {
    assert.equal(target(), '#projectSelect');
    sel.value = sel.options[1]?.value || '';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
  }
  assert.equal(target(), '#prompt');
  const prompt = doc.getElementById('prompt');
  prompt.value = 'do it';
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  // Mock mode sits beside Start run now, outside Advanced (docs/ui-levels.md): no disclosure hop.
  assert.equal(target(), '#mock-switch');
  click(window, doc.getElementById('mock-switch'));
  await settle();
  assert.equal(target(), '#start-btn');
  // End it: a live guide polls the GLOBAL document, which the next boot replaces.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('the workflows guide: Composer, open Default, read the canvas (Next), open and read the side panel (Next), New pipeline, pick in the picker (which ends it)', async () => {
  const { doc, window } = await boot({ onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
  await settle();
  const target = () => doc.querySelector('.guide-layer')?.dataset.target;
  const text = () => doc.querySelector('.guide-layer .guide-text')?.textContent || '';
  const next = () => doc.querySelector('.guide-layer .guide-next');
  assert.ok(target().startsWith('.nav button[data-nav="composer"]'));
  click(window, doc.querySelector('.nav button[data-nav="composer"]'));
  await until(() => target().startsWith('#gv-saved-list .pl-item[data-id="wf_default"] .pl-row'));
  assert.ok(target().startsWith('#gv-saved-list .pl-item[data-id="wf_default"] .pl-row'), target());
  assert.equal(next(), null, 'opening a row is an action, not a Next');
  // Opening a row fills the name field: the guide then explains the canvas.
  doc.getElementById('gv-name').value = 'Default';
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#gv-canvas');
  assert.equal(target(), '#gv-canvas');
  assert.match(text(), /whole workflow/);
  assert.ok(next(), 'an explanation hop carries Next');
  // A click on the canvas (a card, a pan) does not pass an explanation.
  click(window, doc.getElementById('gv-canvas'));
  await settle();
  assert.equal(target(), '#gv-canvas', 'still on the canvas');
  // A collapsed side panel is opened first; an open one goes straight to its explanation.
  const rail = doc.getElementById('gv-ins-rail');
  rail.dataset.open = 'collapsed';
  click(window, next());
  await until(() => target() === '#gv-ins-toggle');
  assert.equal(target(), '#gv-ins-toggle');
  assert.match(text(), /Expand the side panel/);
  assert.equal(next(), null, 'expanding is an action');
  click(window, doc.getElementById('gv-ins-toggle'));
  rail.dataset.open = 'open';
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#gv-ins-rail');
  assert.equal(target(), '#gv-ins-rail');
  assert.match(text(), /toolbox/);
  click(window, next());
  await until(() => target().startsWith('.nav button[data-nav="new"]'));
  assert.ok(target().startsWith('.nav button[data-nav="new"]'), target());
  assert.match(text(), /workflow that fits your task/);
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  // The pick is remembered per project, so the project picker comes first (Next when one is picked).
  await until(() => target() === '#projectSelect');
  assert.equal(target(), '#projectSelect');
  assert.match(text(), /remembered for it/);
  const psel = doc.getElementById('projectSelect');
  if (next()) click(window, next());
  else { psel.value = psel.options[1]?.value || ''; psel.dispatchEvent(new window.Event('change', { bubbles: true })); }
  await until(() => target() === '#workflowSelect');
  assert.equal(target(), '#workflowSelect');
  assert.match(text(), /Pick the one that fits your task/);
  const sel = doc.getElementById('workflowSelect');
  const opt = doc.createElement('option'); opt.value = 'wf_other'; sel.appendChild(opt);
  // The page setting the picker itself (a project's remembered workflow arriving) is not a pick.
  sel.value = 'wf_other';
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  assert.equal(target(), '#workflowSelect', 'a value the page set does not end the tour');
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  // The user's own pick moves the tour on to the run itself: task → Start (Mock is only mentioned).
  await until(() => target() === '#prompt');
  assert.equal(target(), '#prompt', 'after the pick, the tour runs the pipeline');
  assert.match(text(), /describe the task for it/);
  const prompt = doc.getElementById('prompt');
  prompt.value = 'try the workflow';
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '#start-btn');
  assert.equal(target(), '#start-btn');
  assert.match(text(), /Mock mode, beside it/);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
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

test('after the mode switch the tour keeps going past its first hop', async () => {
  const { doc, window } = await boot({ level: 'simple', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
  await settle();
  click(window, doc.getElementById('confirm-ok'));
  await settle();
  assert.equal(doc.documentElement.dataset.level, 'advanced');
  const target = () => doc.querySelector('.guide-layer')?.dataset.target || '';
  assert.ok(target().startsWith('.nav button[data-nav="composer"]'), target());
  click(window, doc.querySelector('.nav button[data-nav="composer"]'));
  await until(() => target().startsWith('#gv-saved-list .pl-item[data-id="wf_default"] .pl-row'));
  assert.ok(target().startsWith('#gv-saved-list .pl-item[data-id="wf_default"] .pl-row'), `the second hop: ${target()}`);
  doc.getElementById('gv-name').value = 'Default';
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#gv-canvas');
  assert.equal(target(), '#gv-canvas', 'and the third');
  // The side panel ships open: no expand stop, straight to its explanation — and a skipped
  // stop never drags the user back to the Composer once they have left it.
  click(window, doc.querySelector('.guide-next'));
  await until(() => target() === '#gv-ins-rail');
  assert.equal(target(), '#gv-ins-rail');
  click(window, doc.querySelector('.guide-next'));
  await until(() => target().startsWith('.nav button[data-nav="new"]'));
  assert.ok(target().startsWith('.nav button[data-nav="new"]'), target());
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await until(() => target() === '#projectSelect');
  assert.equal(target(), '#projectSelect', `on New pipeline the walk goes on, never back: ${target()}`);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('a mode lowered mid-tour: the mode switch, then the card, then Done — and the tour resumes', async () => {
  const { doc, window } = await boot({ level: 'advanced', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
  await settle();
  const layer = () => doc.querySelector('.guide-layer');
  const target = () => layer()?.dataset.target || '';
  assert.ok(target().startsWith('.nav button[data-nav="composer"]'));
  doc.documentElement.dataset.level = 'simple';                      // another tab, Settings
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target().startsWith('#nav-mode'));
  assert.ok(target().startsWith('#nav-mode'), target());
  assert.match(layer().querySelector('.guide-text').textContent, /Advanced mode/);
  click(window, doc.getElementById('nav-mode'));
  await until(() => target() === '#mode-cards [data-level-choice="advanced"]');
  const modal = doc.getElementById('mode-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the dialog is up');
  assert.equal(target(), '#mode-cards [data-level-choice="advanced"]');
  assert.ok(layer().classList.contains('pointer'));
  click(window, doc.querySelector('#mode-cards [data-level-choice="advanced"]'));
  await settle();
  assert.equal(doc.documentElement.dataset.level, 'advanced');
  assert.equal(target(), '#mode-done', 'the tour points at Done rather than hiding behind the dialog');
  assert.ok(layer().classList.contains('pointer'));
  click(window, doc.getElementById('mode-done'));
  await until(() => target().startsWith('.nav button[data-nav="composer"]'));
  assert.equal(modal.classList.contains('hidden'), true);
  assert.ok(target().startsWith('.nav button[data-nav="composer"]'), `resumed: ${target()}`);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('the project tour walks the Add project dialog to the new row: button (re-lit if the dialog is closed) → path → name → Add → Done on the row', async () => {
  const { doc, window } = await boot({ onboarding: status(['claude'], { welcomeSeen: true }) });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="project"]'));
  await settle();
  const layer = () => doc.querySelector('.guide-layer');
  const target = () => layer()?.dataset.target || '';
  const next = () => layer()?.querySelector('.guide-next');
  assert.ok(target().startsWith('.nav button[data-nav="projects"]'));
  click(window, doc.querySelector('.nav button[data-nav="projects"]'));
  await until(() => target() === '#project-add-btn');
  const modal = doc.getElementById('project-add-modal');
  click(window, doc.getElementById('project-add-btn'));
  await until(() => target() === '#proj-add-path');
  assert.equal(modal.classList.contains('hidden'), false, 'the dialog opened');
  assert.ok(layer().classList.contains('pointer'), 'inside a dialog: pointer mode');
  // Closing the dialog brings the button back; opening it again resumes at the path.
  click(window, doc.getElementById('proj-add-cancel'));
  await until(() => target() === '#project-add-btn');
  click(window, doc.getElementById('project-add-btn'));
  await until(() => target() === '#proj-add-path');
  const path = doc.getElementById('proj-add-path');
  path.value = '/tmp/new-project'; path.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '#proj-add-name');
  const name = doc.getElementById('proj-add-name');
  name.value = 'new-project'; name.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '#proj-add-save');
  assert.equal(next(), null, 'adding is the action');
  click(window, doc.getElementById('proj-add-save'));
  await until(() => target() === '#projects-list .pl-item');
  assert.equal(modal.classList.contains('hidden'), true, 'saved: the dialog closed');
  assert.equal(next().textContent, 'Done', 'the tour ends on the new row, with Done');
  click(window, next());
  await until(() => !layer());
  assert.equal(layer(), null);
});

test('a run tour ends on the run\'s card under Running, not at the Start click; the Ask tour ends on the answer', async () => {
  const { doc, window } = await boot({ onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="run"]'));
  await settle();
  const layer = () => doc.querySelector('.guide-layer');
  const target = () => layer()?.dataset.target || '';
  const next = () => layer()?.querySelector('.guide-next');
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await until(() => target() === '#projectSelect');
  const sel = doc.getElementById('projectSelect');
  if (next()) click(window, next());
  else { sel.value = sel.options[1]?.value || ''; sel.dispatchEvent(new window.Event('change', { bubbles: true })); }
  await until(() => target() === '#prompt');
  const prompt = doc.getElementById('prompt');
  prompt.value = 'do it'; prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '#mock-switch');
  if (next()) click(window, next()); else click(window, doc.getElementById('mock-switch'));
  await until(() => target() === '#start-btn');
  // The click on Start is noted; the app routes to Running (here: the hash), where the card is the last stop.
  click(window, doc.getElementById('start-btn'));
  doc.getElementById('form-msg').textContent = '';
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  await until(() => target() === '#run-list [data-run-id]');
  assert.equal(target(), '#run-list [data-run-id]');
  assert.equal(next().textContent, 'Done');
  assert.match(layer().querySelector('.guide-text').textContent, /This is your run/);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();

  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="ask"]'));
  await until(() => target() === '.ask-pill');
  const pill = doc.querySelector('.ask-pill'); const input = doc.querySelector('.ask-input');
  pill.hidden = true; pill.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '.ask-input');
  input.value = 'what changed?'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '.ask-send');
  assert.equal(next(), null, 'sending is the action');
  // The app's own send handler needs a live thread (it rejects in jsdom): click a listener-free
  // twin of the button, so only the guide's page watcher sees the click.
  const send = doc.querySelector('.ask-send');
  send.replaceWith(send.cloneNode(true));
  click(window, doc.querySelector('.ask-send'));
  await until(() => target() === '.ask-transcript');
  assert.equal(next().textContent, 'Done', 'the answer is the last stop');
  pill.hidden = false;
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('the workspace tour walks the wizard: Create → name → two projects → Scan → (scanning) → Save; leaving the wizard re-lights Create', async () => {
  const projects = [{ name: 'a', path: '/tmp/a', key: 'a-1', exists: true }, { name: 'b', path: '/tmp/b', key: 'b-2', exists: true }];
  const { doc, window } = await boot({ level: 'advanced', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="workspace"]'));
  await settle();
  const layer = () => doc.querySelector('.guide-layer');
  const target = () => layer()?.dataset.target || '';
  click(window, doc.querySelector('.nav button[data-nav="workspaces"]'));
  await until(() => target() === '#ws-create-btn');
  click(window, doc.getElementById('ws-create-btn'));
  window.dispatchEvent(new window.Event('hashchange'));
  await until(() => target() === '#wiz-name');
  assert.equal(doc.querySelector('.view[data-view="workspace-create"]').classList.contains('hidden'), false, 'in the wizard');
  const name = doc.getElementById('wiz-name');
  name.value = 'Platform'; name.dispatchEvent(new window.Event('input', { bubbles: true }));
  await until(() => target() === '#wiz-projects');
  assert.match(layer().querySelector('.guide-text').textContent, /two or more/);
  for (const cb of doc.querySelectorAll('#wiz-projects input[type="checkbox"]')) { cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true })); }
  await until(() => target() === '#wiz-start-scan');
  // The scan: step 1 gives way to the loader, then the description step.
  doc.getElementById('wiz-step-1').classList.add('hidden'); doc.getElementById('wiz-step-2').classList.remove('hidden');
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#wiz-step-2 .status-label');
  doc.getElementById('wiz-step-2').classList.add('hidden'); doc.getElementById('wiz-step-3').classList.remove('hidden');
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#wiz-save');
  assert.match(layer().querySelector('.guide-text').textContent, /save/);
  // Backing out to Workspaces resets the wizard: Create is the stop again, not the Workspaces nav.
  click(window, doc.querySelector('.nav button[data-nav="workspaces"]'));
  await until(() => target() === '#ws-create-btn');
  assert.equal(target(), '#ws-create-btn');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('the team metrics tour: Set up → the dialog\'s submit; a project without a remote gets the explanation with Done', async () => {
  const { doc, window } = await boot({ level: 'expert', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="teamMetrics"]'));
  await settle();
  const layer = () => doc.querySelector('.guide-layer');
  const target = () => layer()?.dataset.target || '';
  click(window, doc.querySelector('.nav button[data-nav="projects"]'));
  await settle();
  // The list paints its Team metrics cell with the enable control (a project with an origin remote).
  const list = doc.getElementById('projects-list');
  list.innerHTML = '<div class="pl-item"><div class="tm-cell"><button type="button" class="tm-enable">Set up team metrics…</button></div></div>';
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#projects-list .tm-enable');
  assert.match(layer().querySelector('.guide-text').textContent, /Set it up here/);
  // Its click opens the enable dialog: the submit is the last stop, above the dialog.
  const modal = doc.getElementById('plugin-modal');
  modal.classList.remove('hidden');
  modal.insertAdjacentHTML('beforeend', '<button type="button" class="tm-enable-submit">Create branch and enable</button>');
  click(window, list.querySelector('.tm-enable'));
  await until(() => target() === '#plugin-modal .tm-enable-submit');
  assert.ok(layer().classList.contains('pointer'));
  click(window, modal.querySelector('.tm-enable-submit'));
  await until(() => !layer());
  assert.equal(layer(), null, 'enabling ends the tour');
  modal.classList.add('hidden'); modal.querySelector('.tm-enable-submit').remove();

  // No remote: the cell explains why, and Done closes the tour.
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="teamMetrics"]'));
  await settle();
  click(window, doc.querySelector('.nav button[data-nav="projects"]'));
  await settle();
  list.innerHTML = '<div class="pl-item"><div class="tm-cell">Not a git remote</div></div>';   // painted after the view's own load
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await until(() => target() === '#projects-list .tm-cell' && /push it to one/.test(layer()?.querySelector('.guide-text')?.textContent || ''));
  assert.match(layer().querySelector('.guide-text').textContent, /push it to one/);
  assert.equal(layer().querySelector('.guide-next').textContent, 'Done');
  click(window, layer().querySelector('.guide-next'));
  await until(() => !layer());
  assert.equal(layer(), null);
});

test('a step above the interface mode asks to switch first; "Not now" leaves everything as it was', async () => {
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
});

test('confirming switches the mode and starts the tour at its first real hop', async () => {
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
});

test('a step at or below the mode starts with no question', async () => {
  const { doc, window } = await boot({ level: 'advanced', onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
  await settle();
  assert.ok(doc.getElementById('confirm-modal').classList.contains('hidden'));
  assert.ok((doc.querySelector('.guide-layer')?.dataset.target || '').startsWith('.nav button[data-nav="composer"]'));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});
