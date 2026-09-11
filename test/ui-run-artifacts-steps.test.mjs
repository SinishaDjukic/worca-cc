// test/ui-run-artifacts-steps.test.mjs
//
// The run-folder-artifacts UI (spec §7, §6.5) driven through the REAL Running-detail
// DOM: a binary-kind row never fetches, a 413 shows the route's message with the
// size, and the live artifacts list dedupes on (stepKey, path).
//
// The boot/settle/go/frame/secOf/tabOf/click/STEPPER/STEPS/SUBS/ok/PROJECT helpers
// below are a VERBATIM copy of test/ui-run-artifacts.test.mjs:11-79 — the UI suites
// do not import each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(u), opts || {}); if (r) return r; }
    if (String(u).includes('/api/projects')) {
      return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    }
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  lastWs._l.open?.forEach((fn) => fn());
  return { window, calls, recv };
}

async function settle(window, n = 6) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }
const frame = (ctx, msg) => ctx.recv(msg);
const secOf = (window, key) => window.document.querySelector(`#run-detail .rd-sec[data-sec="${key}"]`);
const tabOf = (window, key) => window.document.querySelector(`#run-detail .rd-tab[data-sec="${key}"]`);
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// A v1 manifest whose two agent cells fix the run's node order (plan → implement),
// so the run-level Artifacts view orders its groups by the step ledger.
const STEPPER = () => ({ version: 1, steps: [
  { kind: 'agents', nodes: [{ id: 'plan', key: 'plan', uiPhase: 'plan', label: 'Plan' }] },
  { kind: 'agents', nodes: [{ id: 'implement', key: 'implement', uiPhase: 'implement', label: 'Implementer' }] },
], feedbacks: [] });
const STEPS = () => ([
  { key: 'plan#1', nodeId: 'plan', cycle: 1, status: 'done' },
  { key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start' },
]);
const SUBS = () => ([
  { id: 'a1', label: 'Explore repo', nodeId: 'implement', cycle: 1, status: 'running' },
]);

const ARTIFACTS = [
  { type: 'artifact', kind: 'plan', path: '/run/steps/plan-c1/plan.md', nodeId: 'plan', executionId: 'plan#1', cycle: 1 },
  { type: 'artifact', kind: 'verdict', path: '/run/steps/implement-c1/impl-review-cycle1.json', nodeId: 'implement', executionId: 'implement#1', cycle: 1 },
  { type: 'artifact', kind: 'image', path: '/run/steps/implement-c1/screenshots/one.png', nodeId: 'implement', executionId: 'implement#1', cycle: 1 },
  { type: 'artifact', kind: 'text', path: '/run/steps/implement-c1/big.log', nodeId: 'implement', executionId: 'implement#1', cycle: 1 },
];
async function openRunWithArtifacts(ctx) {
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS(), totalCostUsd: 1.5,
    branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' }, prompt: 'Add a dark mode toggle.' });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  for (const a of ARTIFACTS) frame(ctx, { ...a, runId: 'r1' });
  await settle(ctx.window);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  return ctx;
}
const rowNamed = (window, name) => [...secOf(window, 'artifacts').querySelectorAll('.artifact-row')].find((r) => r.querySelector('.artifact-name').textContent === name);

test('a binary-kind row opens a "not viewable" notice without fetching', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  const png = rowNamed(ctx.window, 'one.png');
  assert.ok(png, 'the image row is listed (with its kind chip)');
  assert.equal(png.querySelector('.artifact-kind').textContent, 'image');
  click(ctx.window, png);
  await settle(ctx.window);
  const host = ctx.window.document.querySelector('#viewer .artifact-view');
  assert.match(host.textContent, /^Binary file.*not viewable$/);
  assert.ok(!ctx.calls.some((c) => c.url.includes('screenshots%2Fone.png')), 'no artifact fetch for a binary row');
});

test('a 413 renders the route message with the size', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') && url.includes('big.log')
      ? Promise.resolve({ ok: false, status: 413, json: async () => ({ error: 'artifact too large to view', rel: 'steps/implement-c1/big.log', bytes: 3 * 1024 * 1024 }) })
      : null),
  });
  await openRunWithArtifacts(ctx);
  click(ctx.window, rowNamed(ctx.window, 'big.log'));
  await settle(ctx.window);
  assert.equal(ctx.window.document.querySelector('#viewer .artifact-view').textContent, 'artifact too large to view (3.0 MB)');
});

test('onArtifact dedupes a re-emitted (stepKey, path) frame', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  frame(ctx, { ...ARTIFACTS[0], runId: 'r1' });                       // a resumed execution re-emits its plan
  frame(ctx, { ...ARTIFACTS[0], runId: 'r1', executionId: 'plan#2', cycle: 2 });   // a NEW execution of the same file is a new row
  await settle(ctx.window);
  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.artifact-row')].map((r) => r.querySelector('.artifact-name').textContent);
  assert.equal(names.filter((n) => n === 'plan.md').length, 2, 'one row per (stepKey, path)');
  assert.equal(names.length, ARTIFACTS.length + 1);
});
