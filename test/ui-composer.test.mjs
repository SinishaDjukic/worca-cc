// test/ui-composer.test.mjs — jsdom boot test: the composer view is wired into
// the SPA router and its DOM shell renders. (Pure logic is in
// test/composer-ui.test.mjs; drag/drop + paintWires are manual-only.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const DEFAULT_WF = {
  id: 'wf_default', name: 'Default', version: 1,
  steps: [
    [{ id: 's_clarify', key: 'clarify' }],
    [{ id: 's0_0', key: 'planner' }],
    [{ id: 's1_0', key: 'refiner' }],
    [{ id: 's2_0', key: 'implementer' }],
    [{ id: 's3_0', key: 'reviewer' }],
  ],
  // CONV-7: mirror DEFAULT_WORKFLOW EXACTLY — refine self-loop + review->implement loop.
  feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }, { id: 'fb_review', from: 's3_0', to: 's2_0' }],
  createdAt: 'x', updatedAt: 'x',
};

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  // jsdom has no layout: force offsetParent truthy so paintWires doesn't early-return on errors.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/workflows/wf_default')) return Promise.resolve({ ok: true, status: 200, json: async () => DEFAULT_WF });
    if (u.includes('/api/workflows')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [DEFAULT_WF] }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [] }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}

test('composer is a router view: hash #composer reveals the canvas section', async () => {
  const window = await boot();
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const view = window.document.querySelector('.view[data-view="composer"]');
  assert.ok(view, 'composer section exists');
  assert.equal(view.classList.contains('hidden'), false, 'composer view is shown');
  const others = [...window.document.querySelectorAll('.view')].filter((v) => v.dataset.view !== 'composer');
  assert.ok(others.every((v) => v.classList.contains('hidden')), 'other views hidden');
});

test('opening the composer builds the palette from the agents/embedded registry', async () => {
  const window = await boot();
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 10));
  const pills = window.document.querySelectorAll('#composer-palette .agent-pill');
  assert.equal(pills.length, 9, 'nine agent pills (embedded fallback)');
  assert.match(pills[0].textContent, /Clarify/);
});

test('Save serializes the canvas to contract topology and POSTs {name,steps,feedbacks}', async () => {
  const posted = [];
  // Re-run boot but intercept POST /api/workflows.
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.prompt = () => 'My Flow';
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/workflows/wf_default')) return Promise.resolve({ ok: true, status: 200, json: async () => DEFAULT_WF });
    if (u.endsWith('/api/workflows') && opts && opts.method === 'POST') {
      posted.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ workflow: { id: 'wf_x', name: JSON.parse(opts.body).name, ...JSON.parse(opts.body), version: 1, createdAt: 'x', updatedAt: 'x' } }) });
    }
    if (u.includes('/api/workflows')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [DEFAULT_WF] }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 20)); // initComposer awaits Reset -> wf_default

  // The default render must produce 5 columns (Clarify/Plan/Refine/Implement/Review).
  const cols = window.document.querySelectorAll('#composer-flow > .col');
  assert.equal(cols.length, 5, 'default = 5 steps');

  window.document.getElementById('composer-save').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posted.length, 1, 'one POST');
  assert.equal(posted[0].name, 'My Flow');
  assert.deepEqual(posted[0].steps.map((c) => c.map((x) => x.key)),
    [['clarify'], ['planner'], ['refiner'], ['implementer'], ['reviewer']]);
  // topology() reindexes node ids on Save, so step-0 member-0 is s0_0 (NOT the
  // stored s_clarify id of the default template).
  assert.equal(posted[0].steps[0][0].id, 's0_0', 'contract instance ids');
  assert.equal(posted[0].feedbacks.length, 2, 'two default feedback loops');
});

test('saved list renders rows with meta line + chips; expand builds a read-only preview; delete removes the row', async () => {
  const WF_QUICK = {
    id: 'wf_quickfix', name: 'Quick Fix', version: 1,
    steps: [
      [{ id: 's0_0', key: 'planner' }],
      [{ id: 's1_0', key: 'implementer' }],
      [{ id: 's2_0', key: 'reviewer' }],
    ],
    feedbacks: [{ id: 'fb_0', from: 's2_0', to: 's1_0' }],
    createdAt: 'x', updatedAt: 'x',
  };
  const deleted = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.confirm = () => true;
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/workflows/wf_default')) return Promise.resolve({ ok: true, status: 200, json: async () => DEFAULT_WF });
    if (u.match(/\/api\/workflows\/wf_quickfix$/) && opts && opts.method === 'DELETE') { deleted.push('wf_quickfix'); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); }
    // The server reload after a DELETE reflects the deletion (matches the real
    // store: deleteWorkflow → GET returns the remaining workflows).
    if (u.endsWith('/api/workflows')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: deleted.includes('wf_quickfix') ? [DEFAULT_WF] : [DEFAULT_WF, WF_QUICK] }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 30));

  const rows = window.document.querySelectorAll('#composer-saved-list .pl-item');
  assert.equal(rows.length, 2, 'Default + Quick Fix');
  const quick = [...rows].find((r) => r.querySelector('.pl-name').textContent.trim().startsWith('Quick Fix'));
  assert.ok(quick, 'Quick Fix row present');
  assert.equal(quick.querySelector('.pl-domain').textContent, 'general', 'untagged workflow shows the general domain badge');
  assert.equal(quick.querySelector('.pl-meta').textContent.replace(/\s+/g, ' ').trim(), '3 steps · 3 agents · 1 feedback loop');
  assert.equal(quick.querySelectorAll('.pl-chip').length, 3, 'three distinct-agent chips');

  quick.querySelector('.pl-row').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(quick.classList.contains('open'), 'row expands');
  assert.ok(quick.querySelector('.pl-body .ro-flow'), 'read-only preview rendered');
  assert.equal(quick.querySelectorAll('.pl-body .ro-flow .node').length, 3, 'preview has 3 nodes');

  quick.querySelector('.pl-del').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(deleted, ['wf_quickfix'], 'DELETE called for the workflow id');
  assert.equal(window.document.querySelectorAll('#composer-saved-list .pl-item').length, 1, 'row removed after reload');
});

// ---------------------------------------------------------------------------
// Task 10: connectsTo governance — disallowed drops + feedback edges DECLINE.
// Exercises the real DOM drop handlers + composerAddFeedback via the window.__composer*
// test seam (mirrors the window.__np convention).
// ---------------------------------------------------------------------------
async function bootComposer() {
  const window = await boot();                  // existing harness: jsdom + app.js (returns window)
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));   // let the router run initComposer
  return window;
}

test('composer declines a disallowed sequential drop (no node inserted)', async () => {
  const window = await bootComposer();
  const composer = window.__composer;           // seam exposed by app.js (Step 3)
  composer.agents = {
    planner: { key: 'planner', displayName: 'Plan', connectsTo: ['refiner', 'implementer'] },
    reviewer: { key: 'reviewer', displayName: 'Review', connectsTo: ['implementer'] },
  };
  composer.steps = [[{ id: 'n1', key: 'planner' }]];
  composer.feedbacks = [];
  window.__composerRefresh();                    // render strips/columns for the current steps
  composer.dragKey = 'reviewer';
  // A reviewer is illegal adjacent to the planner on BOTH sides, so EVERY .strip
  // must decline -> steps stays length 1 regardless of which gap is hit.
  const strips = window.document.querySelectorAll('.strip');
  assert.ok(strips.length > 0, 'strips render');
  strips.forEach((s) => s.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true })));
  assert.equal(composer.steps.length, 1, 'disallowed drop must not insert a step');
});

test('composer declines a disallowed feedback edge', async () => {
  const window = await bootComposer();
  const composer = window.__composer;
  composer.agents = {
    reviewer: { key: 'reviewer', displayName: 'Review', connectsTo: ['implementer'] },
    planner: { key: 'planner', displayName: 'Plan', connectsTo: ['refiner'] },
  };
  composer.steps = [[{ id: 'a', key: 'reviewer' }], [{ id: 'b', key: 'planner' }]];
  composer.feedbacks = [];
  window.__composerAddFeedback('a', 'b');        // reviewer -> planner is illegal
  assert.equal(composer.feedbacks.length, 0, 'disallowed feedback must not be added');
});
