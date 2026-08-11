// test/ui-composer-chrome-app.test.mjs — the drawer against the REAL index.html
// and the REAL app.js. The chrome's unit tests drive the factory directly, so
// they cannot see a wiring mistake: a missing createComposerChrome() call, a
// syncDefault() that never runs against a real template, or a chrome that gets
// constructed twice and double-binds its toggle.
//
// The harness is the one test/ui-agent-xss.test.mjs uses (jsdom + a stubbed
// fetch + a WebSocket stub), trimmed to what the composer needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [{
  key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet',
  runnerType: 'producer', order: 1, origin: 'builtin', icon: '<circle cx="4" cy="6" r="1.1"/>',
  metaVersion: 2, domain: 'coding',
  inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}.md', store: 'project' }],
}];

/** A saved pipeline that PLACES an agent — the state D5 collapses the drawer on. */
const SAVED_TEMPLATE = {
  id: 'wf_demo', name: 'Demo', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
};

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send() {}
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
}

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (u.endsWith('/api/workflows') && (!opts || !opts.method || opts.method === 'GET')) {
      return json({ workflows: [SAVED_TEMPLATE] });
    }
    if (u.includes('/api/workflows/')) return json(SAVED_TEMPLATE);
    if (u.includes('/api/agents')) return json({ agents: AGENTS, channels: [], mockWriterRoles: [] });
    if (u.includes('/api/projects')) return json({ projects: [] });
    if (u.includes('/api/workspaces')) return json({ workspaces: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* jsdom-only key */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return window;
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const goComposer = async (window) => {
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 4; i += 1) await tick();
};

test('the chrome is constructed and the blank first-visit canvas opens the drawer', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const drawer = doc.querySelector('#composer-drawer');

  assert.ok(doc.querySelector('#composer-palette .ap'),
    'guard: the palette actually rendered, so the composer really booted');
  assert.equal(drawer.dataset.open, 'true', 'a new canvas has no agents (D5)');
  assert.equal(doc.querySelector('#composer-drawer-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), null,
    'a first-visit default is not a stored preference');
});

test('opening a saved pipeline re-runs the default against the loaded template', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();

  assert.ok(doc.querySelector('#composer-canvas .node[data-node-id="n_plan"]'),
    'guard: the template really loaded');
  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'false',
    'composerLoadTemplate() re-ran syncDefault() and the graph has an agent');
});

test('the chrome outlives the editor swap and is bound exactly once', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const drawer = doc.querySelector('#composer-drawer');

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(drawer.dataset.open, 'false');

  // ONE construction means ONE listener: a single click must flip the state
  // exactly once. A second binding would flip it twice and leave it collapsed.
  click(window, doc.querySelector('#composer-drawer-toggle'));
  assert.equal(drawer.dataset.open, 'true', 'the toggle still works after the editor was rebuilt');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), 'open',
    'and a manual toggle persists');
});

test('re-entering the composer re-syncs the default against the LIVE editor', async () => {
  // The bug this pins is B1: composerLoadTemplate() has two callers, both bound
  // inside the `if (!_composerReady)` block, so it never runs on the initial view
  // entry; and the factory's own syncDefault() runs BEFORE composer.editor
  // exists, so hasAgents() is false by accident rather than by fact. Only the
  // syncDefault() call at the END of initComposer() ever reads a real template.
  //
  // The drawer is first re-opened by a NON-persisting gesture (the filter
  // auto-open) while the loaded graph HAS an agent, so a missing re-sync is
  // visible: with the call the re-entry collapses it, without it nothing moves.
  const window = await boot();
  const doc = window.document;
  await goComposer(window);

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'false',
    'guard: the agent-bearing template collapsed it');

  const filter = doc.querySelector('#composer-agent-filter');
  filter.value = 'pl';
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'true',
    'guard: the filter auto-open reveals it WITHOUT persisting');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), null,
    'guard: still no stored preference, so the default is still live');

  window.location.hash = 'overview';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  await goComposer(window);

  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'false',
    'initComposer() re-ran syncDefault() against the editor that is actually loaded');
});

test('app.js hands canvasInsetRight to BOTH createComposerEditor call sites', () => {
  // composerLoadTemplate() destroys the editor and builds a fresh one on every
  // "New canvas" and every saved-pipeline open. Miss it and the fix silently
  // stops applying — and no DOM assertion can see it, because jsdom reports a
  // zero-width rail, which clamps the inset to 0. Source text is the house
  // pattern for exactly this (test/ui-run-flow-css.test.mjs).
  const APP = readFileSync(appPath, 'utf8');
  const sites = APP.match(/createComposerEditor\(\{/g) || [];
  assert.equal(sites.length, 2, 'initComposer() and composerLoadTemplate()');
  const wired = APP.match(/canvasInsetRight: \(\) => \(composer\.chrome \? composer\.chrome\.canvasInsetRight\(\) : 0\)/g) || [];
  assert.equal(wired.length, 2, 'both sites, or the fix stops applying after a template load');
  assert.match(APP, /import \{ createComposerChrome \} from '\.\/graph\/composer-chrome\.mjs';/);
  assert.match(APP, /insRail: composer\.els\.insRail/, 'and the chrome can measure the rail');
});

test('app.js no longer corrects for a top overlay', () => {
  // The palette moved into its own in-flow card, so there is no overlay left to
  // clear. A returning `canvasInsetTop:` here would mean the drawer came back.
  const APP = readFileSync(appPath, 'utf8');
  assert.equal(/canvasInsetTop/.test(APP), false, 'nothing covers the canvas from above');
});
