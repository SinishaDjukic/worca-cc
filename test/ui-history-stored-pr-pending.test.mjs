// test/ui-history-stored-pr-pending.test.mjs
// PLAN-Ga pin: GET /api/history's skeleton now carries the RECORDED PR as `storedPr`, but
// classic app.js does not read it yet. `pr` stays absent on the skeleton, and classic keeps
// treating `pr === undefined` as "lookup pending": the Runs list stays busy and the detail's
// Create PR area stays empty until the `history-pr` batch lands. This guards against a
// future change that reads `storedPr` as `pr` (which would settle those waits early).
// Harness copied from test/ui-history-pr-phase.test.mjs (real app.js under jsdom, WS stub).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const prTokens = () => calls.filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body).map((c) => JSON.parse(c.opts.body).token);
  const dispatchPr = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', done: true, items: [], ...msg }) });
  return { window, go, settle, prTokens, dispatchPr };
}

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// A finished run whose PR is recorded: the skeleton carries `storedPr` and no `pr`. Each test uses its own run id:
// an earlier boot's app.js instance stays alive (shared modules) and holds its settled rows by id.
const STORED = { url: 'https://gh/x/pull/4', number: 4, state: 'OPEN' };
const ROW_OF = (id) => ({
  id, title: 'Feat', status: 'done', startedAt: '2026-06-02T00:00:00Z',
  branch: 'worca-cc/feat-1', sourceBranch: 'main', survived: true, added: 3, removed: 1,
  projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj', storedPr: STORED,
});
const detailOf = (p) => ({
  state: { id: p.id, title: p.title, status: p.status, startedAt: p.startedAt, stepper: null, steps: [], subAgents: [],
    branch: { feature: p.branch, source: p.sourceBranch } },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '',
});
// MOST-SPECIFIC FIRST: the keyed detail URL `/api/history/proj-0000abcd/p1` starts with `/api/history/pr`.
const armsFor = (ROW) => (url) => {
  if (url.endsWith('/api/history/pr')) return ok({ ok: true });
  if (url.endsWith(`/api/history/${ROW.projectKey}/${ROW.id}`)) return ok(detailOf(ROW));
  if (url.endsWith('/api/history')) return ok({ pipelines: [ROW], live: [], ghAvailable: true });
  return null;
};

const rowOf = (w) => w.document.querySelector('#runs-list .runs-row[data-kind="hist"][data-pipeline-id="list1"][data-project-key="proj-0000abcd"]');
const busy = (w) => w.document.getElementById('runs-list').getAttribute('aria-busy');

test('PLAN-Ga classic: a skeleton row with storedPr still waits for the history-pr batch', async () => {
  const ROW = ROW_OF('list1');
  const ctx = await boot({ fetchHandler: armsFor(ROW) });
  ctx.go('runs');
  await ctx.settle();
  const w = ctx.window;
  assert.ok(rowOf(w), 'the row is listed');
  assert.equal(busy(w), 'true', 'the PR lookup is still pending');
  assert.notEqual(rowOf(w).dataset.state, 'in-review', 'storedPr alone does not settle the row');
  assert.doesNotMatch(rowOf(w).textContent, /#4\b/, 'no stored PR number before the batch');
  const token = ctx.prTokens().at(-1);
  assert.ok(token != null, 'the client asked for the PR batch');
  ctx.dispatchPr({ token, items: [{ projectKey: ROW.projectKey, id: ROW.id, pr: STORED }] });
  await ctx.settle();
  assert.equal(rowOf(w).dataset.state, 'in-review', 'the batch settles the row');
  assert.equal(busy(w), 'false');
});

test('PLAN-Ga classic: the detail Create PR area waits for history-pr, not storedPr', async () => {
  const ROW = ROW_OF('detail1');
  const ctx = await boot({ fetchHandler: armsFor(ROW) });
  ctx.go('runs');
  await ctx.settle();
  ctx.go(`history/${ROW.projectKey}/${ROW.id}/details`);
  await ctx.settle();
  const doc = ctx.window.document;
  const btn = () => doc.querySelector('#hist-detail .hd-pr');
  const link = () => doc.querySelector('#hist-detail .hd-pr-link');
  assert.ok(btn() && link(), 'the detail header is painted');
  assert.equal(link().hidden, true, 'no PR link from storedPr alone');
  assert.equal(btn().hidden, true, 'no Create PR while the lookup is pending');
  ctx.dispatchPr({ token: ctx.prTokens().at(-1), items: [{ projectKey: ROW.projectKey, id: ROW.id, pr: null }] });
  await ctx.settle();
  assert.equal(btn().hidden, false, 'Create PR paints once gh answered "no PR"');
});
