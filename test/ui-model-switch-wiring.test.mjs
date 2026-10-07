// test/ui-model-switch-wiring.test.mjs — a running or paused run's "Models" button + panel on both detail
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

async function bootLive({ historyRow = null, payload = PAYLOAD, postReply = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  const fetchCalls = [];
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (url, opts) => {
    const u = String(url);
    fetchCalls.push({ url: u, opts });
    if (u.includes('/api/pipelines/p1/models')) {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: postReply?.status ? postReply.status < 400 : true,
          status: postReply?.status ?? 200,
          json: async () => postReply?.body ?? { ok: true, changed: [{ nodeId: 'n_refine' }], skipped: [], stepper: null, warnings: [] },
        });
      }
      return ok(payload);
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
  // A server frame, through the app's own socket listener (handleServerMessage).
  const recv = (msg) => (wsBox.ws._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(msg) }));
  return { window, go, settle, fetchCalls, recv };
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

test('a running run offers "Models" with Save only; pausing hides it and closes the panel', async () => {
  const RUN = { ...PAYLOAD, status: 'running', stages: PAYLOAD.stages.map((s) => ({ ...s, state: s.switchable ? 'pending' : 'running' })) };
  const { window, go, settle, fetchCalls } = await bootLive({ payload: RUN });
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r2', title: 't', projectDir: PROJECT, status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  go('running/r2'); await settle();
  const btn = window.document.querySelector('#run-detail .rd-models');
  assert.equal(btn.hidden, false, 'running → Models offered');
  btn.click(); await settle();
  const host = window.document.querySelector('#run-detail .rd-model-switch');
  assert.equal(host.hidden, false, 'the click opens the panel');
  assert.equal(host.querySelector('.msw-save-resume'), null);
  const sel = host.querySelector('tr[data-node="n_refine"] select[data-field="model"]');
  sel.value = 'claude-opus-5-5'; sel.dispatchEvent(new window.Event('change'));
  host.querySelector('.msw-save').click(); await settle();
  assert.deepEqual(JSON.parse(posts(fetchCalls)[0].opts.body), { changes: { n_refine: { model: 'claude-opus-5-5', effort: 'xhigh' } } });
  assert.equal(host.hidden, true, 'saved → closed');
  assert.ok(!fetchCalls.some((c) => c.url.includes('/api/resume')), 'nothing to resume');
  btn.click(); await settle();
  assert.equal(host.hidden, false, 'reopened');
  // onState only mutates `r`; the screen repaints on the WS frame (renderRunningView → repaintRunDetail).
  onState(r, { status: 'pausing' }); window.__np.repaintRunDetail(r); await settle();
  assert.equal(btn.hidden, true); assert.equal(host.hidden, true, 'running → pausing closes the panel');
});

// Archive lets a paused pipeline through and the server keeps its entry, so the run page still draws a
// paused bar from it. The server refuses the switch (409 ARCHIVED), so the page must not offer it.
test('an archived paused run offers no "Models" on the run page: the archived frame hides it and closes the panel', async () => {
  const { window, go, settle, recv } = await bootLive();
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r6', title: 't', projectDir: PROJECT, status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  onState(r, { status: 'paused' });
  go('running/r6'); await settle();
  const btn = window.document.querySelector('#run-detail .rd-models');
  assert.equal(btn.hidden, false, 'paused → Models offered');
  btn.click(); await settle();
  const host = window.document.querySelector('#run-detail .rd-model-switch');
  assert.equal(host.hidden, false, 'the panel is open');
  recv({ type: 'archived', runId: 'r6', archivedAt: '2026-10-07T10:00:00.000Z', seq: 1 }); await settle();
  assert.equal(btn.hidden, true, 'archived → no Models');
  assert.equal(host.hidden, true, 'the open panel closes');
  btn.click(); await settle();
  assert.equal(host.hidden, true, 'a click on the hidden button opens nothing');
  recv({ type: 'archived', runId: 'r-gone', archivedAt: '2026-10-07T10:00:00.000Z', seq: 1 }); await settle();
  assert.equal(window.__np.getRun('r-gone'), undefined, 'an archived frame never materializes a run');
});

test('a hello that lists an archived paused run offers no "Models" on its run page', async () => {
  const { window, go, settle, recv } = await bootLive();
  recv({ type: 'hello', runs: [{ runId: 'r7', title: 't', projectDir: PROJECT, status: 'paused', kind: 'run',
    pipelineId: 'p1', archivedAt: '2026-10-07T10:00:00.000Z', startedAt: '2026-10-07T09:00:00.000Z' }] });
  go('running/r7'); await settle();
  assert.equal(window.document.querySelector('#run-detail .rd-models').hidden, true);
});

// Restore clears the row's archive mark (the row reads interrupted), but the server's lingering paused entry
// keeps its one-way `archivedAt`. The saved screen must not take "paused" from that entry (409 on the GET).
test('a restored archived paused run offers no "Models" on its saved screen: the lingering entry stays archived', async () => {
  const row = { id: 'p1', title: 't', status: 'interrupted', projectKey: 'k' };
  const { window, go, settle, recv, fetchCalls } = await bootLive({ historyRow: row });
  recv({ type: 'hello', runs: [{ runId: 'r8', title: 't', projectDir: PROJECT, status: 'paused', kind: 'run',
    pipelineId: 'p1', archivedAt: '2026-10-07T10:00:00.000Z', startedAt: '2026-10-07T09:00:00.000Z' }] });
  go('history'); await settle();
  go('history/k/p1'); await settle();
  const btn = window.document.querySelector('#hist-detail .hd-models');
  assert.equal(btn.hidden, true, 'the archived entry is no live paused run');
  btn.click(); await settle();
  assert.equal(window.document.querySelector('#hist-detail .hd-model-switch').hidden, true, 'a forced click opens nothing');
  assert.ok(!fetchCalls.some((c) => c.url.includes('/api/pipelines/p1/models')), 'and sends no request');
});

test('a 202 (the owner has not answered) closes the panel without an error', async () => {
  const RUN = { ...PAYLOAD, status: 'running' };
  const { window, go, settle } = await bootLive({ payload: RUN, postReply: { status: 202, body: { ok: false, outcome: 'enqueued' } } });
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r4', title: 't', projectDir: PROJECT, status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  go('running/r4'); await settle();
  window.document.querySelector('#run-detail .rd-models').click(); await settle();
  const host = window.document.querySelector('#run-detail .rd-model-switch');
  const sel = host.querySelector('tr[data-node="n_refine"] select[data-field="model"]');
  sel.value = 'claude-opus-5-5'; sel.dispatchEvent(new window.Event('change'));
  host.querySelector('.msw-save').click(); await settle();
  assert.equal(host.hidden, true);
  // The 202 branch's own toast: without these lines the test also passes with the branch deleted
  // (switchNotice tolerates a missing `changed`, so the normal path closes the panel too).
  const toast = window.document.querySelector('.toast[data-key="msw-p1"]');
  assert.ok(toast?.classList.contains('info'), 'an info toast, not the "Switched" one');
  assert.match(toast.querySelector('.tt').textContent, /has not confirmed it yet/);
});

test('a host last opened for a paused run does not close a running run\'s panel while it loads', async () => {
  const RUN = { ...PAYLOAD, status: 'running' };
  const { window, go, settle } = await bootLive({ payload: RUN });
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r5', title: 't', projectDir: PROJECT, status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  go('running/r5'); await settle();
  const host = window.document.querySelector('#run-detail .rd-model-switch');
  host.dataset.mode = 'paused';   // what an earlier paused-run panel left on the shared host
  window.document.querySelector('#run-detail .rd-models').click();
  window.__np.repaintRunDetail(r);   // a run frame lands while "Loading models…" shows
  await settle();
  assert.equal(host.hidden, false, 'still open');
  assert.equal(host.dataset.mode, 'running');
  assert.ok(host.querySelector('.msw-save'), 'the panel rendered into a visible host');
});

test('the saved screen offers "Models" for a running record (another process drives it)', async () => {
  const row = { id: 'p1', title: 't', status: 'running', projectKey: 'k' };
  const { window, go, settle } = await bootLive({ historyRow: row, payload: { ...PAYLOAD, status: 'running' } });
  go('history'); await settle();
  go('history/k/p1'); await settle();
  assert.equal(window.document.querySelector('#hist-detail .hd-models').hidden, false);
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
  const row2 = { id: 'p1', title: 't', status: 'pausing', projectKey: 'k' };
  const b = await bootLive({ historyRow: row2 });
  b.go('history'); await b.settle();
  b.go('history/k/p1'); await b.settle();
  assert.equal(b.window.document.querySelector('#hist-detail .hd-models').hidden, true, 'pausing → hidden');
});
