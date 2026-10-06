// test/ui-model-switch-wiring.test.mjs — the paused run's "Models" button + panel on both detail
// screens (live #running/<runId>, saved #history/<key>/<id>). Harness mirrors the bootLive of
// test/ui-pause-resume.test.mjs, with the two /api/pipelines/:id/models routes stubbed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const PAYLOAD = {
  pipelineId: 'p1', title: 't', runDefault: '', pauseReason: 'error', pauseDetail: 'out of usage credits',
  models: [
    { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
  subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'],
  stages: [
    { nodeId: 'n_plan', key: 'planner', label: 'Planner', state: 'completed', switchable: false, model: '', effort: '', subagentModel: '', subagentEffort: '', fanOut: true },
    { nodeId: 'n_refine', key: 'refiner', label: 'Refiner', state: 'paused', switchable: true, model: 'claude-fable-5-1', effort: 'xhigh', subagentModel: '', subagentEffort: '', fanOut: true },
  ],
};

async function bootLive({ historyRow = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  const fetchCalls = [];
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (url, opts) => {
    const u = String(url);
    fetchCalls.push({ url: u, opts });
    if (u.includes('/api/pipelines/p1/models')) {
      if (opts?.method === 'POST') return ok({ ok: true, changed: [{ nodeId: 'n_refine' }], stepper: null, warnings: [] });
      return ok(PAYLOAD);
    }
    if (historyRow && u.endsWith(`/api/history/k/${historyRow.id}`)) {
      return ok({ state: { id: historyRow.id, title: historyRow.title, status: historyRow.status, steps: [] } });
    }
    if (historyRow && u.endsWith('/api/history')) return ok({ pipelines: [historyRow], live: [] });
    if (u.includes('/api/resume')) return ok({ ok: true, runId: 'r-new', pipelineId: 'p1' });
    if (u.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, go, settle, fetchCalls };
}

const posts = (fetchCalls) => fetchCalls.filter((c) => c.url.includes('/api/pipelines/p1/models') && c.opts?.method === 'POST');

test('a paused live run shows "Models"; Save & resume posts the switch, then resumes', async () => {
  const { window, go, settle, fetchCalls } = await bootLive();
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  onState(r, { status: 'paused' });
  go('running/r1'); await settle();
  const btn = window.document.querySelector('#run-detail .rd-models');
  assert.equal(btn.hidden, false, 'paused → Models offered');
  btn.click(); await settle();
  const host = window.document.querySelector('#run-detail .rd-model-switch');
  assert.equal(host.hidden, false);
  const sel = host.querySelector('tr[data-node="n_refine"] select[data-field="model"]');
  sel.value = 'claude-opus-5-5'; sel.dispatchEvent(new window.Event('change'));
  host.querySelector('.msw-save-resume').click(); await settle();
  assert.deepEqual(JSON.parse(posts(fetchCalls)[0].opts.body), { changes: { n_refine: { model: 'claude-opus-5-5', effort: 'xhigh' } } });
  assert.ok(fetchCalls.some((c) => c.url.includes('/api/resume')), 'Save & resume chains into the normal resume');
});

test('a running run hides "Models"', async () => {
  const { window, go, settle } = await bootLive();
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r2', title: 't', projectDir: PROJECT, status: 'running' });
  onState(r, { status: 'running', id: 'p2' });
  go('running/r2'); await settle();
  assert.equal(window.document.querySelector('#run-detail .rd-models').hidden, true);
});

test('onState adopts a model-only manifest change', async () => {
  const { window } = await bootLive();
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r3', title: 't', projectDir: PROJECT, status: 'paused' });
  const m1 = { version: 2, graph: { nodes: [{ id: 'n_a', kind: 'agent', model: 'claude-fable-5-1' }], wires: [] }, steps: [{ kind: 'agents', nodes: [{ id: 'n_a' }] }] };
  const m2 = structuredClone(m1); m2.graph.nodes[0].model = 'claude-opus-5-5';
  onState(r, { stepper: m1 }); onState(r, { stepper: m2 });
  assert.equal(r.stepper.graph.nodes[0].model, 'claude-opus-5-5');
});

test('the saved screen offers "Models" for a paused record only; Save & resume posts then resumes', async () => {
  const row = { id: 'p1', title: 't', status: 'paused', projectKey: 'k' };
  const { window, go, settle, fetchCalls } = await bootLive({ historyRow: row });
  go('history'); await settle();
  go('history/k/p1'); await settle();
  const btn = window.document.querySelector('#hist-detail .hd-models');
  assert.equal(btn.hidden, false, 'paused → Models offered');
  btn.click(); await settle();
  const host = window.document.querySelector('#hist-detail .hd-model-switch');
  assert.equal(host.hidden, false);
  const sel = host.querySelector('tr[data-node="n_refine"] select[data-field="model"]');
  sel.value = 'claude-opus-5-5'; sel.dispatchEvent(new window.Event('change'));
  host.querySelector('.msw-save-resume').click(); await settle(8);
  assert.deepEqual(JSON.parse(posts(fetchCalls)[0].opts.body), { changes: { n_refine: { model: 'claude-opus-5-5', effort: 'xhigh' } } });
  assert.ok(fetchCalls.some((c) => c.url.includes('/api/resume')), 'Save & resume chains into resume');
});

test('the saved screen hides "Models" for an interrupted record', async () => {
  const row = { id: 'p1', title: 't', status: 'interrupted', projectKey: 'k' };
  const { window, go, settle } = await bootLive({ historyRow: row });
  go('history'); await settle();
  go('history/k/p1'); await settle();
  assert.equal(window.document.querySelector('#hist-detail .hd-models').hidden, true);
});
