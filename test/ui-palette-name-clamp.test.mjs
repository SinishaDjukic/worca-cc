// test/ui-palette-name-clamp.test.mjs — the palette card budgets 3 text lines:
// a name that wraps to 2 lines leaves 1 for the description, a 1-line name
// leaves 2. Wrapping depends on rendered width, so app.js measures the .pname
// height with a ResizeObserver and toggles .name-2l on the card; the CSS side
// (clamp values) is asserted in test/ui-palette-layout.test.mjs.
// Harness copied from test/ui-composer-palette-desc.test.mjs with a fake
// ResizeObserver injected BEFORE app.js loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'shortname', displayName: 'Planner', color: 'blue', domain: 'coding', order: 1,
    description: 'Writes the implementation plan.', consumes: [], produces: ['plan'] },
  { key: 'longname', displayName: 'Manual Web UI Testing Checklist Author', color: 'green',
    domain: 'coding', order: 2, description: 'Writes the manual checklist.', consumes: ['plan'], produces: ['checklist'] },
];

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  // Fake RO, injected before app.js loads: records instances + observed targets
  // and lets a test drive the callback with hand-built entries.
  const ros = [];
  window.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); ros.push(this); }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/workflows')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 10));
  return { window, ros };
}

// The RO instance that watches pill names (others watch .flow / toolbars).
function nameRO(window, ros) {
  const pnames = [...window.document.querySelectorAll('#composer-palette .pname')];
  assert.ok(pnames.length >= 2, 'pills render a .pname element inside .phead');
  const ro = ros.find((r) => pnames.some((el) => r.targets.has(el)));
  assert.ok(ro, 'a ResizeObserver watches the pill name elements');
  for (const el of pnames) assert.ok(ro.targets.has(el), `every .pname is observed (missing: ${el.textContent})`);
  return ro;
}

test('the name renders in its own .pname element inside the header row', async () => {
  const { window } = await boot();
  const pill = window.document.querySelector('#composer-palette .agent-pill[data-key="longname"]');
  assert.ok(pill, 'card present');
  const pname = pill.querySelector('.phead .pname');
  assert.ok(pname, '.pname lives inside .phead');
  assert.equal(pname.textContent, 'Manual Web UI Testing Checklist Author');
});

test('a 2-line name flags the card .name-2l; a 1-line name clears it; height 0 is a no-op', async () => {
  const { window, ros } = await boot();
  const ro = nameRO(window, ros);
  const pname = window.document.querySelector('.agent-pill[data-key="longname"] .pname');
  const pill = pname.closest('.agent-pill');

  // jsdom computes no layout: line-height resolves non-numeric → 16px fallback,
  // so 2 lines ≈ 32px (> 24 threshold) and 1 line ≈ 16px.
  pname.getBoundingClientRect = () => ({ height: 32 });
  ro.cb([{ target: pname }]);
  assert.equal(pill.classList.contains('name-2l'), true, 'wrapped name → 1-line description budget');

  pname.getBoundingClientRect = () => ({ height: 16 });
  ro.cb([{ target: pname }]);
  assert.equal(pill.classList.contains('name-2l'), false, 'single-line name → 2-line description budget');

  pill.classList.add('name-2l');
  pname.getBoundingClientRect = () => ({ height: 0 });
  ro.cb([{ target: pname }]);
  assert.equal(pill.classList.contains('name-2l'), true, 'hidden palette (height 0) must not clobber the class');
});

test('rebuilding the palette re-observes the fresh .pname elements', async () => {
  const { window, ros } = await boot();
  nameRO(window, ros);
  // Chip toggle rebuilds the palette with brand-new pill elements.
  const chip = window.document.querySelector('#composer-palette .pal-chip');
  assert.ok(chip, 'domain chip present');
  chip.click();
  chip.click();
  await new Promise((r) => setTimeout(r, 0));
  nameRO(window, ros);   // fresh elements are observed again
});
