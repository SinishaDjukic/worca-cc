// test/ui-newpipeline-picker-refresh.test.mjs
// Re-entering the New Pipeline view must re-fill the workflow + guardrail
// pickers: a workflow saved in Composer (or a guardrail set created in
// Guardrails) only appeared after a full page reload, and a workflow re-saved
// with a new topology kept painting the cached one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const tick = (n = 3) => new Promise((r) => setTimeout(r, n));
const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

const WF_A = { id: 'wf_a', name: 'Alpha', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] };
const WF_A2 = { ...WF_A, steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'reviewer' }]] };
// The server's list carries the FULL built-in template first (Composer's list
// renders its topology too).
const WF_DEFAULT = {
  id: 'wf_default', name: 'Default',
  steps: [[{ id: 's_clarify', key: 'clarify' }], [{ id: 's0_0', key: 'planner' }], [{ id: 's3_0', key: 'reviewer' }]],
  feedbacks: [],
};
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', order: 1 },
  { key: 'reviewer', displayName: 'Review', color: 'blue', order: 4 },
];

async function boot() {
  const server = { workflows: [], guardrails: [{ id: 'permissive', name: 'Permissive', settings: null }], calls: [] };
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  // Composer's paintWires schedules through rAF; jsdom has none.
  window.requestAnimationFrame = globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = (url) => {
    const u = String(url);
    server.calls.push(u);
    if (u.includes('/api/projects')) return json({ projects: [{ name: 'proj', path: '/tmp/proj', exists: true }] });
    if (u.endsWith('/api/workflows')) return json({ workflows: [WF_DEFAULT, ...server.workflows] });
    const m = u.match(/\/api\/workflows\/([^/?]+)$/);
    if (m) {
      const wf = server.workflows.find((w) => w.id === decodeURIComponent(m[1]));
      if (m[1] === 'wf_default') return json(WF_DEFAULT);
      return wf ? json(wf) : Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'nf' }) });
    }
    if (u.includes('/api/guardrails')) return json({ guardrails: server.guardrails });
    if (u.includes('/api/agents')) return json({ agents: AGENTS, channels: [] });
    if (u.includes('/api/plugins')) return json({ plugins: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await tick(10);
  return { window, server };
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  return tick(10);
}

const optionIds = (sel) => [...sel.options].map((o) => o.value);

test('a workflow saved while away shows in the picker on returning to New Pipeline (no reload)', async () => {
  const { window, server } = await boot();
  const sel = window.document.getElementById('workflowSelect');
  assert.deepEqual(optionIds(sel), ['wf_default'], 'boot: Default only');

  await go(window, 'composer');
  server.workflows.push(WF_A);                       // what Composer's save does server-side
  await go(window, 'new');
  assert.deepEqual(optionIds(sel), ['wf_default', 'wf_a'], 'picker re-fetched on re-entry');
  assert.equal(sel.value, 'wf_default', 'active selection preserved');
});

test('re-entry drops the per-id memo so a re-saved workflow repaints with its new topology', async () => {
  const { window, server } = await boot();
  server.workflows.push(WF_A);
  await go(window, 'history');
  await go(window, 'new');
  const sel = window.document.getElementById('workflowSelect');
  sel.value = 'wf_a';
  sel.dispatchEvent(new window.Event('change'));
  await tick(10);
  const rows = () => [...window.document.querySelectorAll('#agents-rows .agent-row')].map((r) => r.dataset.nodeId);
  assert.deepEqual(rows(), ['s0_0'], 'one node before the re-save');

  await go(window, 'composer');
  server.workflows.splice(0, 1, WF_A2);              // same id, new topology
  await go(window, 'new');
  assert.equal(sel.value, 'wf_a', 'selection kept across the refresh');
  assert.deepEqual(rows(), ['s0_0', 's1_0'], 'accordion painted from the re-fetched topology');
});

test('a guardrail set created while away shows in the picker on returning', async () => {
  const { window, server } = await boot();
  const sel = window.document.getElementById('guardrailsSelect');
  assert.deepEqual(optionIds(sel), ['permissive']);
  await go(window, 'guardrails');
  server.guardrails.push({ id: 'gs_strict', name: 'Strict-ish', settings: {} });
  await go(window, 'new');
  assert.deepEqual(optionIds(sel), ['permissive', 'gs_strict']);
});

test('boot itself does not double-fetch the workflow list (loadConfig owns the first fill)', async () => {
  const { server } = await boot();
  const listCalls = server.calls.filter((u) => u.endsWith('/api/workflows')).length;
  assert.equal(listCalls, 1);
});
