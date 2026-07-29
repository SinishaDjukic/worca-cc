// test/ui-hello-stepper-seed.test.mjs — onHello seeds r.stepper from the summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, selectProject, recv };
}

const STEPPER = { version: 1, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
  { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan' }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
], feedbacks: [] };

test('hello seeds r.stepper so a later subagent paints on the real s0_0 node', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  ctx.recv({ type: 'hello', runs: [{ runId: 'p1', title: 't', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', stepper: STEPPER }] });
  const r = ctx.window.__np.getRun('p1');
  assert.ok(r, 'run model created from hello');
  assert.deepEqual(r.stepper, STEPPER, 'stepper seeded from the hello summary');
  // No 'state' frame at all; a subagent delta must still land on s0_0.
  ctx.recv({ type: 'subagent', runId: 'p1', transition: 'spawn', id: 't1', nodeId: 's0_0', uiPhase: 'plan', cycle: 0, label: 'research', status: 'running' });
  await new Promise((r) => setTimeout(r, 0));
  const node = ctx.window.document.querySelector('[data-run-id="p1"] .run-node[data-id="s0_0"]');
  assert.ok(node, 's0_0 node exists (real stepper)');
  assert.equal(node.querySelectorAll('.fan .sq.on').length, 1, 'running square on s0_0');
});

test('hello does NOT clobber an already-set stepper', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'phase', runId: 'p1', phase: 'plan' }); // create the run model in the map
  ctx.window.__np.getRun('p1').stepper = STEPPER;
  ctx.recv({ type: 'hello', runs: [{ runId: 'p1', status: 'running', stepper: { version: 1, steps: [], feedbacks: [] } }] });
  assert.deepEqual(ctx.window.__np.getRun('p1').stepper, STEPPER, 'guard (rr.stepper == null) prevents clobber');
});
