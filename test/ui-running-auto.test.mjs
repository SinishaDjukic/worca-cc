// test/ui-running-auto.test.mjs — an Auto run on the Running page: the deciding placeholder
// (spec §7.3), the proposal pill words and the "Auto → ‹name›" header badge (spec §7.5).
// Boot preamble copied from test/ui-question.test.mjs:19-82 (house convention: duplicated per
// suite) + helloRunning/cardOf from test/ui-running-card.test.mjs:76-87.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { proposalFor } from './helpers/auto-proposal-fixture.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const wins = [];
afterEach(() => { for (const w of wins.splice(0)) w.close(); });

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  wins.push(window);

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const dispatch = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  const showRunning = () => { window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-aaa';
const settle = async (window, n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function helloRunning(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra }] });
}
const cardOf = (ctx) => ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

// The bootstrap manifest exactly as buildGraphManifest() emits it for the empty Auto template.
const DECIDING = { version: 2, template: { id: 'wf_auto', name: 'Auto' }, auto: { status: 'deciding', humanInLoop: true }, graph: { nodes: [], wires: [] }, bookends: { preflight: true, done: true }, steps: [{ kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] }, { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }], feedbacks: [] };

test('a deciding Auto run paints the orb placeholder, not an empty graph; the label follows the pending proposal', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const host = cardOf(ctx).querySelector('.run-flow');
  assert.ok(host.classList.contains('auto-deciding-host'));
  assert.ok(!host.classList.contains('gv-host'), 'no run graph mounted on the host');
  assert.equal(host.querySelector('.gv-stage'), null, 'no renderer mounted');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto is deciding the workflow…');
  assert.ok(host.querySelector('.ask-orb'), 'the thinking orb');
  ctx.dispatch({ type: 'question', runId: RUN_ID, id: 'auto-1', kind: 'workflow', workflow: proposalFor() });
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Waiting for your decision');
  assert.equal(cardOf(ctx).querySelector('.rc-qpill').textContent, 'proposal');
  assert.equal(cardOf(ctx).querySelector('.rc-status-word').textContent, 'Paused · your decision');
  assert.equal(cardOf(ctx).querySelector('.rc-prog').hidden, true, 'no 0/0 progress while deciding');
});

test('the real manifest replaces the placeholder with the graph (the orb is stopped, the host class dropped)', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const p = proposalFor();
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', stepper: { ...p.manifest, auto: { status: 'decided', via: 'created', rounds: 1, humanInLoop: true, workflowId: 'wf_x' } }, steps: [], subAgents: [] });
  const host = cardOf(ctx).querySelector('.run-flow');
  assert.ok(!host.classList.contains('auto-deciding-host'));
  assert.equal(host.querySelector('.auto-deciding'), null);
  assert.ok(host.querySelector('.gv-stage'), 'the run graph mounted');
  assert.equal(cardOf(ctx).querySelector('.rc-prog').hidden, false, 'progress is back once there are nodes');
});

// A classifier failure parks the run with auto.status still 'deciding' (spec D17 / §5.6,
// the errors-pause policy) — as does a user pause. isLive(r) is false there, so the SAME
// host that already owns a live orb must give it up, and the copy must not claim the
// decision is gone: resume() re-enters _decideTopology.
test('a run parked while deciding drops the orb and says so; resuming brings the orb back', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  assert.ok(cardOf(ctx).querySelector('.run-flow .ask-orb'), 'live: the thinking orb');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'paused', pauseReason: 'error', steps: [], subAgents: [] });
  let host = cardOf(ctx).querySelector('.run-flow');
  assert.ok(host.classList.contains('auto-deciding-host'), 'still the placeholder, not an empty graph');
  assert.equal(host.querySelector('.ask-orb'), null, 'no orb spinning on a parked run');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Paused before deciding');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', steps: [], subAgents: [] });
  host = cardOf(ctx).querySelector('.run-flow');
  assert.ok(host.querySelector('.ask-orb'), 'the orb is rebuilt when the run goes live again');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto is deciding the workflow…');
});

test('a run STOPPED while deciding is frozen: no orb, and A24’s "did not decide" line', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  // finishRun repaints the stepper one last time while the card still exists; hold the
  // host, because a stopped run leaves the live list on the very next render.
  const host = cardOf(ctx).querySelector('.run-flow');
  ctx.dispatch({ type: 'done', runId: RUN_ID, status: 'stopped' });
  assert.equal(host.querySelector('.ask-orb'), null, 'a stopped run would spin its canvas forever');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto did not decide a workflow');
});

test('compact density releases the placeholder instead of hiding a still-running orb', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const card = cardOf(ctx);
  assert.ok(card.querySelector('.run-flow .ask-orb'), 'detailed density paints the orb');
  ctx.window.__np.setRunDensity('compact');
  const host = cardOf(ctx).querySelector('.run-flow');
  assert.ok(!host.classList.contains('auto-deciding-host'), 'the placeholder is dropped, not stranded');
  assert.equal(host.querySelector('.ask-orb'), null, 'no RAF canvas behind a display:none card body');
});

const DECIDED = (p) => ({ ...p.manifest, template: { id: 'wf_theme', name: 'Theme switch' }, auto: { status: 'decided', via: 'created', rounds: 1, humanInLoop: true, workflowId: 'wf_theme' } });

test('badge: "Auto" while deciding, "Auto → name" after adoption — run card and Running detail', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const badge = cardOf(ctx).querySelector('.rc-acts .auto-badge');
  assert.equal(badge.hidden, false); assert.equal(badge.textContent, 'Auto'); assert.equal(badge.title, 'Auto is deciding the workflow');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', stepper: DECIDED(proposalFor()), steps: [], subAgents: [] });
  assert.equal(badge.textContent, 'Auto → Theme switch'); assert.equal(badge.title, 'Auto created the workflow "Theme switch"');
  ctx.window.location.hash = `running/${RUN_ID}`; ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await settle(ctx.window);
  const rd = ctx.window.document.querySelector('#run-detail .rd-row1 .auto-badge');
  assert.equal(rd.hidden, false); assert.equal(rd.textContent, 'Auto → Theme switch');
});

test('a saved-workflow run shows no badge', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: proposalFor().manifest }); ctx.showRunning();
  assert.equal(cardOf(ctx).querySelector('.rc-acts .auto-badge').hidden, true);
});
