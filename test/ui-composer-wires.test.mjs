// test/ui-composer-wires.test.mjs — direct unit tests for the shared SVG
// renderer composerPaintWires (composer + running + history all use it).
// jsdom has no layout: every getBoundingClientRect() is all-zeros, so a
// single-node fixture gives deterministic path coords (cx=0, by=0, b=40).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  // jsdom has no layout: force offsetParent truthy so paintWires doesn't early-return.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [], agents: [], projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}

// Build a .flow with <svg class="wires"> + one .node per id. Returns {flow, svg, paint}.
function fixture(window, ids) {
  const flow = window.document.createElement('div');
  flow.className = 'flow';
  const svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'wires');
  flow.appendChild(svg);
  for (const id of ids) {
    const n = window.document.createElement('div');
    n.className = 'node'; n.dataset.id = id;
    flow.appendChild(n);
  }
  window.document.body.appendChild(flow);
  const paint = (steps, feedbacks, opts) => window.__np.composerPaintWires(flow, svg, steps, feedbacks, opts);
  return { flow, svg, paint };
}

test('self-loop uses the BIGGER geometry (±26 mouth, ±40 bulge, depth 40)', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['a']);
  const steps = [[{ id: 'a', key: 'refiner' }]];
  const feedbacks = [{ from: 'a', to: 'a' }];
  paint(steps, feedbacks, { ns: 'tst', del: true });
  const html = svg.innerHTML;
  // jsdom rect is all-zeros -> cx=0, by=0, b=40 -> exact path string.
  assert.match(html, /M-26 0 C -40 40, 40 40, 26 0/, 'bigger self-loop control points');
  // The OLD small geometry must be gone (was sx-22 over rail 34 -> "C -37 34").
  assert.doesNotMatch(html, /C -37 34/, 'old small self-loop removed');
  assert.match(html, /marker-end="url\(#arrSelf-tst\)"/, 'self marker still used');
});

test('self-cycle draws an {n}× badge when cycles present and del is off', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['a']);
  const steps = [[{ id: 'a', key: 'refiner' }]];
  const feedbacks = [{ from: 'a', to: 'a' }];
  paint(steps, feedbacks, { ns: 'tst', runMode: true, activeId: null, doneSet: new Set(), cycles: { a: 2 } });
  const html = svg.innerHTML;
  assert.match(html, /<g class="loop-badge">/, 'badge group present');
  assert.match(html, /<title>2 cycles<\/title>/, 'plural title');
  assert.match(html, /2×<\/text>/, 'badge text reads 2×');
  assert.match(html, /<circle cx="0" cy="32.8"/, 'self badge centered under the lobe (by + b*0.82)');
});

test('cross-loop draws an {n}× badge at the wire midpoint', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['x', 'y']);
  const steps = [[{ id: 'x', key: 'implementer' }], [{ id: 'y', key: 'reviewer' }]];
  const feedbacks = [{ from: 'y', to: 'x' }]; // review -> implement
  paint(steps, feedbacks, { ns: 'tst', runMode: true, activeId: null, doneSet: new Set(), cycles: { y: 1 } });
  const html = svg.innerHTML;
  assert.match(html, /<g class="loop-badge">/, 'cross badge present');
  assert.match(html, /<title>1 cycle<\/title>/, 'singular title');
  assert.match(html, /1×<\/text>/, 'badge text reads 1×');
});

test('NO badge in composer del-mode, and NO badge when count < 1', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['a']);
  const steps = [[{ id: 'a', key: 'refiner' }]];
  const feedbacks = [{ from: 'a', to: 'a' }];
  paint(steps, feedbacks, { ns: 'tst', del: true, cycles: { a: 3 } });
  assert.doesNotMatch(svg.innerHTML, /loop-badge/, 'composer del-mode draws no badge');
  paint(steps, feedbacks, { ns: 'tst', runMode: true, cycles: { a: 0 } });
  assert.doesNotMatch(svg.innerHTML, /loop-badge/, 'count<1 draws no badge');
});

test('run-mode adds wire-live to the active originator loop and wire-dim to others', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['x', 'y', 'z']);
  const steps = [[{ id: 'x', key: 'implementer' }], [{ id: 'y', key: 'reviewer' }], [{ id: 'z', key: 'refiner' }]];
  const feedbacks = [{ from: 'y', to: 'x' }, { from: 'z', to: 'z' }];
  paint(steps, feedbacks, { ns: 'tst', runMode: true, activeId: 'y', doneSet: new Set(), cycles: {} });
  const html = svg.innerHTML;
  // Path attr order is: d, class(fbCls), fill, stroke. amber=#E6962A, violet=#8C7FD6.
  assert.match(html, /class="wire-live"[^>]*stroke="#E6962A"/, 'cross loop from active node is wire-live');
  assert.match(html, /class="wire-dim"[^>]*stroke="#8C7FD6"/, 'self loop from inactive node is wire-dim');
});

test('composer (non-runMode) never adds wire-live / wire-dim classes', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['x', 'y']);
  const steps = [[{ id: 'x', key: 'implementer' }], [{ id: 'y', key: 'reviewer' }]];
  const feedbacks = [{ from: 'y', to: 'x' }, { from: 'x', to: 'x' }];
  paint(steps, feedbacks, { ns: 'tst', del: true });
  const html = svg.innerHTML;
  assert.doesNotMatch(html, /wire-live/, 'no wire-live in composer');
  assert.doesNotMatch(html, /wire-dim/, 'no wire-dim in composer');
});

test('sequential wire turns green + uses arrSeqDone marker when BOTH endpoints are done', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['p', 'q']);
  const steps = [[{ id: 'p', key: 'planner' }], [{ id: 'q', key: 'refiner' }]];
  paint(steps, [], { ns: 'tst', runMode: true, doneSet: new Set(['p', 'q']), cycles: {} });
  const html = svg.innerHTML;
  assert.match(html, /<marker id="arrSeqDone-tst"[^>]*>[\s\S]*?fill="#5BAE5B"/, 'green done marker defined');
  assert.match(html, /stroke="#5BAE5B"[^>]*marker-end="url\(#arrSeqDone-tst\)"/, 'done seq wire is green');
});

test('sequential wire stays gray when an endpoint is NOT done', async () => {
  const window = await boot();
  const { svg, paint } = fixture(window, ['p', 'q']);
  const steps = [[{ id: 'p', key: 'planner' }], [{ id: 'q', key: 'refiner' }]];
  paint(steps, [], { ns: 'tst', runMode: true, doneSet: new Set(['p']), cycles: {} });
  const html = svg.innerHTML;
  assert.match(html, /stroke="#B7B7BC"[^>]*marker-end="url\(#arrSeq-tst\)"/, 'partial -> gray seq wire (COMPOSER_SEQ)');
  assert.doesNotMatch(html, /stroke="#5BAE5B"[^>]*marker-end="url\(#arrSeqDone/, 'no green wire when not both done');
});

test('hidden view (offsetParent null) is a no-op — guard preserved', async () => {
  const window = await boot();
  const { flow, svg, paint } = fixture(window, ['a']);
  Object.defineProperty(flow, 'offsetParent', { get() { return null; }, configurable: true });
  paint([[{ id: 'a', key: 'refiner' }]], [{ from: 'a', to: 'a' }], { ns: 'tst', del: true });
  assert.equal(svg.innerHTML, '', 'hidden flow paints nothing');
});
