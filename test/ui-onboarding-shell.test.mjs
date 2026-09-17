// test/ui-onboarding-shell.test.mjs
// The Getting-started wiring in the shell + app.js: the shelf host above the New
// pipeline form, the pill mounted (not shipped) under the CTA, the Settings card
// before About, the one-time welcome, Hide → POST, Show again, and a guide that
// navigates to its target's view.
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
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

const STEPS = ['claude', 'project', 'run', 'ask', 'workflows', 'realRun', 'workspace', 'teamMetrics'];
const status = (done = [], flags = {}) => ({
  steps: Object.fromEntries(STEPS.map((id) => [id, done.includes(id)])),
  done: done.length, total: 8, claude: { bin: 'claude', hint: null }, hidden: false, welcomeSeen: false, ...flags,
});

async function boot({ onboarding = status(['claude']), projects = [] } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost:4317/', pretendToBeVisual: true });
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
  assert.equal(doc.querySelectorAll('.nav button[data-nav]').length, 10, 'the nav census is untouched');
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

test('the mock-run guide: nav to New pipeline first, then project → prompt → Advanced → Mock → Start', async () => {
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
  assert.equal(target(), '#advanced-config summary');
  doc.getElementById('advanced-config').open = true;
  doc.getElementById('advanced-config').dispatchEvent(new window.Event('toggle'));
  await settle();
  assert.equal(target(), '#mock-switch');
  click(window, doc.getElementById('mock-switch'));
  await settle();
  assert.equal(target(), '#start-btn');
  // End it: a live guide polls the GLOBAL document, which the next boot replaces.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
});

test('the workflows guide: Composer, open Default, back to New pipeline, pick in the picker (which ends it)', async () => {
  const { doc, window } = await boot({ onboarding: status(['claude', 'project'], { welcomeSeen: true }), projects: [{ name: 'p', path: '/tmp/p', key: 'p-00000001', exists: true }] });
  click(window, doc.querySelector('.gs-pill'));
  await settle();
  click(window, doc.querySelector('.gs-tile[data-step="workflows"]'));
  await settle();
  const target = () => doc.querySelector('.guide-layer')?.dataset.target;
  assert.ok(target().startsWith('.nav button[data-nav="composer"]'));
  click(window, doc.querySelector('.nav button[data-nav="composer"]'));
  await settle();
  assert.ok(target().startsWith('#gv-saved-list .pl-item[data-id="wf_default"] .pl-row'), target());
  // Opening a row fills the name field; the guide then sends the user back to the picker.
  doc.getElementById('gv-name').value = 'Default';
  doc.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  assert.ok(target().startsWith('.nav button[data-nav="new"]'), target());
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await settle();
  assert.equal(target(), '#workflowSelect');
  const sel = doc.getElementById('workflowSelect');
  const opt = doc.createElement('option'); opt.value = 'wf_other'; sel.appendChild(opt);
  sel.value = 'wf_other'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(doc.querySelector('.guide-layer'), null, 'a pick ends the guide');
});
