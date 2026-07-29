// test/ui-agent-xss.test.mjs — agent metadata is user-writable (POST /api/agents,
// wizard Mode B), so the composer must never inject displayName/description/icon
// raw into innerHTML. Built-in icons stay trusted repo-shipped SVG fragments.
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
  { key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet', runnerType: 'producer', consumes: ['userPrompt'], produces: ['plan'], order: 1, origin: 'builtin', connectsTo: '*', icon: PLANNER_ICON },
  { key: 'evil', displayName: EVIL_NAME, description: EVIL_DESC, color: 'green', runnerType: 'producer', consumes: ['plan'], produces: ['review'], order: 50, origin: 'user', connectsTo: '*', icon: EVIL_ICON },
];
const CHANNELS = ['userPrompt', 'plan', 'review', 'checklist', 'code', 'workspace', 'clarify', 'decomposition'];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0); // composer paints via rAF (same stub as ui-composer.test.mjs)
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, channels: CHANNELS }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window, ws: () => WSStub.last };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const goComposer = async (window) => {
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 4; i++) await tick();
};

// Stub the workflows API so the default canvas + saved list both reference the
// user agent (covers the canvas node, palette pill, pl-chip and RO-preview sinks).
const workflowsHandler = (u, opts) => {
  if (u.endsWith('/api/workflows') && (!opts.method || opts.method === 'GET')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      workflows: [{ id: 'wf_evil', name: 'Has Evil', steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'evil' }]], feedbacks: [] }],
    }) });
  }
  if (u.includes('/api/workflows/')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      id: 'wf_default', name: 'Default', steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'evil' }]], feedbacks: [],
    }) });
  }
  return null;
};

test('composer never injects user-agent meta as markup: palette, canvas, saved chips, RO preview', async () => {
  const { window } = await boot({ fetchHandler: workflowsHandler });
  await goComposer(window);
  const doc = window.document;

  // palette pill: displayName renders literally, no <img> parsed from it
  const pill = doc.querySelector('#composer-palette .agent-pill[data-key="evil"]');
  assert.ok(pill, 'user agent pill present');
  assert.equal(pill.querySelector('img'), null, 'no <img> parsed from displayName');
  assert.ok(pill.textContent.includes(EVIL_NAME), 'displayName renders as literal text');

  // canvas node: no <img>/<image> anywhere; name + description are literal text
  const flow = doc.querySelector('#composer-flow');
  assert.equal(flow.querySelector('img'), null, 'no <img> in the canvas');
  assert.equal(flow.querySelector('image'), null, 'no SVG <image> in the canvas');
  const evilNode = [...flow.querySelectorAll('.node')].find((n) => (n.querySelector('.nmeta b') || {}).textContent === EVIL_NAME);
  assert.ok(evilNode, 'user agent node renders its displayName literally');
  assert.equal(evilNode.querySelector('.nmeta small').textContent, EVIL_DESC, 'description literal');
  assert.equal(evilNode.querySelector('.nmeta small b'), null, 'description markup inert');
  const evilSvg = evilNode.querySelector('.nic svg');
  assert.ok(!evilSvg.innerHTML.includes('onerror'), 'user icon markup never injected');
  assert.ok(evilSvg.querySelector('circle'), 'user agent gets the fixed default glyph');

  // builtin regression guard: planner keeps its real repo-shipped icon
  const planNode = [...flow.querySelectorAll('.node')].find((n) => (n.querySelector('.nmeta b') || {}).textContent === 'Plan');
  assert.ok(planNode, 'builtin node present');
  assert.ok(planNode.querySelector('.nic svg').innerHTML.includes('M8 6h11'), 'builtin icon still raw-rendered');

  // saved-pipelines chip row: displayName escaped there too
  const item = doc.querySelector('.pl-item[data-id="wf_evil"]');
  assert.ok(item, 'saved pipeline listed');
  const chips = [...item.querySelectorAll('.pl-chip')];
  assert.ok(chips.some((c) => c.textContent.includes(EVIL_NAME)), 'chip shows literal displayName');
  assert.equal(item.querySelector('.pl-chips img'), null, 'no <img> parsed in chips');

  // read-only preview: same pair + icon via composerRoNode
  click(window, item.querySelector('.pl-row'));
  for (let i = 0; i < 3; i++) await tick();
  const body = item.querySelector('.pl-body');
  const roEvil = [...body.querySelectorAll('.node')].find((n) => (n.querySelector('.nmeta b') || {}).textContent === EVIL_NAME);
  assert.ok(roEvil, 'RO preview renders the displayName literally');
  assert.equal(body.querySelector('img'), null, 'no <img> in RO preview');
  assert.equal(body.querySelector('image'), null, 'no SVG <image> in RO preview');
  assert.equal(roEvil.querySelector('.nmeta small b'), null, 'RO description markup inert');
  assert.ok(!roEvil.querySelector('.nic svg').innerHTML.includes('onerror'), 'RO icon never injected');
});
