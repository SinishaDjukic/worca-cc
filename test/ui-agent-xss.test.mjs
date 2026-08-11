// test/ui-agent-xss.test.mjs — agent metadata is user-writable (POST /api/agents,
// wizard Mode B), so the composer must never inject displayName/description/icon
// raw into innerHTML. Built-in icons stay trusted repo-shipped SVG fragments.
//
// Ported to the v2 node composer: the sinks moved (palette pill .ap, node card
// header, saved-pipeline row, mini-SVG thumbnail) but the rule did not — every
// user-authored string is textContent, and only `origin !== 'user'` icons are
// injected as markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const EVIL_NAME = '<img src=x onerror=boom()>';
const EVIL_DESC = '<b>d</b>';
const EVIL_ICON = '<image href=x onerror=boom()>';
const PLANNER_ICON = '<path d="M8 6h11M8 12h11M8 18h8" stroke-linecap="round"/><circle cx="4" cy="6" r="1.1"/><circle cx="4" cy="12" r="1.1"/><circle cx="4" cy="18" r="1.1"/>';

const AGENTS = [
  {
    key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet',
    runnerType: 'producer', order: 1, origin: 'builtin', icon: PLANNER_ICON, metaVersion: 2, domain: 'coding',
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}.md', store: 'project' }],
  },
  {
    key: 'evil', displayName: EVIL_NAME, description: EVIL_DESC, color: 'green',
    runnerType: 'producer', order: 50, origin: 'user', icon: EVIL_ICON, metaVersion: 2, domain: 'coding',
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'review', type: 'md', when: 'always', filename: 'r.md', store: 'run' }],
  },
];

/** A v2 template that PLACES the hostile agent, so the canvas renders its card. */
const EVIL_TEMPLATE = {
  id: 'wf_evil', name: 'Has Evil', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 200, config: {} },
    { id: 'n_evil', kind: 'agent', key: 'evil', x: 660, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_evil', port: 'plan' } },
    { id: 'w3', from: { node: 'n_evil', port: 'review' }, to: { node: 'n_end', port: 'result' } },
  ],
};

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
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
      return json({ workflows: [EVIL_TEMPLATE] });
    }
    if (u.includes('/api/workflows/')) return json(EVIL_TEMPLATE);
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

test('the palette rail renders hostile agent meta as text, never markup', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const pill = doc.querySelector('#composer-palette .ap[data-key="evil"]');
  assert.ok(pill, 'user agent pill present');
  assert.equal(pill.querySelector('img'), null, 'no <img> parsed from displayName');
  assert.equal(pill.querySelector('b'), null, 'no markup parsed from description');
  assert.equal(pill.querySelector('.n').textContent, EVIL_NAME, 'displayName renders as literal text');
  assert.equal(pill.title, EVIL_DESC, 'the description rides in title — an attribute, not markup');
});

test('a canvas card gives a user agent the fixed glyph and a literal title', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();

  const canvas = doc.querySelector('#composer-canvas');
  assert.equal(canvas.querySelector('img'), null, 'no <img> anywhere on the canvas');
  assert.equal(canvas.querySelector('image'), null, 'no SVG <image> either');

  const evilCard = canvas.querySelector('.node[data-node-id="n_evil"]');
  assert.ok(evilCard, 'the hostile agent has a card');
  assert.equal(evilCard.querySelector('.nhead .tt').textContent, EVIL_NAME, 'displayName literal');
  const evilSvg = evilCard.querySelector('.nhead svg');
  assert.ok(!evilSvg.innerHTML.includes('onerror'), 'user icon markup never injected');
  assert.ok(evilSvg.querySelector('circle'), 'user agent gets the fixed default glyph');

  // Builtin regression guard: planner keeps its real repo-shipped icon.
  const planCard = canvas.querySelector('.node[data-node-id="n_plan"]');
  assert.equal(planCard.querySelector('.nhead .tt').textContent, 'Plan');
  assert.ok(planCard.querySelector('.nhead svg').innerHTML.includes('M8 6h11'), 'builtin icon still raw-rendered');
});

test('the saved-pipeline row and its thumbnail carry no author-controlled markup', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const row = doc.querySelector('#composer-saved-list .pl-item[data-id="wf_evil"]');
  assert.ok(row, 'saved pipeline listed');
  assert.equal(row.querySelector('.pl-name').textContent, 'Has Evil');
  assert.equal(row.querySelector('img'), null, 'no <img> in the row');
  // thumbnail() emits NUMBERS ONLY — that is why it is safe as innerHTML.
  const thumb = row.querySelector('.pl-thumb');
  assert.ok(thumb.querySelector('svg'), 'a mini-SVG thumbnail renders');
  assert.equal(thumb.querySelector('image'), null, 'no SVG <image> in the thumbnail');
  assert.ok(!thumb.innerHTML.includes('onerror'));
  assert.ok(!thumb.innerHTML.includes('evil'), 'the thumbnail names nothing');
});
