// test/ui-history-graph-log-link.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for the History DETAIL run-graph -> Logs tab link: clicking a
// workflow node activates the Logs tab and narrows its `source` filter to that
// node's agent.
//
// boot()/settle()/go() are a deliberate local copy of
// test/ui-history-detail.test.mjs:25-93 — the suites do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases. ONE boot per test: booting twice in
// one case would rebind globalThis.window under the first context's handlers.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  // jsdom does not implement scrollIntoView, and the graph link calls it on the
  // Logs panel. That is the ONLY jsdom gap this screen hits: navigator.clipboard
  // is needed only by a .log-copy CLICK (app.js:9041-9043 -> copyLogToClipboard),
  // which no test here performs, so it is deliberately not stubbed — the same
  // split test/ui-history-detail.test.mjs makes (stub at :30, clipboard per-case
  // at :1655 / :1667).
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };

  window.fetch = (u, opts) => {
    if (fetchHandler) {
      const r = fetchHandler(String(u), opts || {});
      if (r) return r;
    }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, wsBox };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

// --- fixtures ---------------------------------------------------------------

const KEY = 'proj-alpha-abcd1234';
const ID = 'fcec04e8';
const DETAIL_URL = `/api/history/${KEY}/${ID}`;
const detailHash = `history/${KEY}/${ID}`;

const ROW = {
  id: ID, projectKey: KEY, projectName: 'Alpha', projectDir: PROJECT,
  title: 'Add the thing', status: 'done', startedAt: '2026-08-18T10:00:00Z',
  branch: 'worca-cc/thing-fcec04e8', sourceBranch: 'master', mtime: 1,
  pauseReason: null, retainedWork: null,
};

// A server-built manifest: bookends + one solo cell + one PARALLEL cell, so the
// two-nodes-one-step case is covered by construction. Node shape mirrors
// buildStepperManifest (src/core/workflows.mjs:479-489), which is the ONLY
// vintage that carries `key`.
const STEPPER = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false }] },
    { kind: 'agents', nodes: [
      { id: 's1_0', key: 'implementer', uiPhase: 'implement', label: 'Implementation', color: 'peach', cycles: false },
      { id: 's1_1', key: 'reviewer', uiPhase: 'review', label: 'Review', color: 'blue', cycles: true },
    ] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ],
  feedbacks: [],
};



// SCOPE BOUNDARY. buildRunGraph is the SHARED builder: the live Running card
// (app.js:10805, and the mid-run manifest swap at :777) renders the exact markup
// asserted here. The stamp must be pure data — every interactive attribute is
// added later, and only by wireHdGraphLogLinks on the History detail. If this
// test ever goes red, the live card has silently grown behavior it was never
// meant to have.

// --- detail-screen harness --------------------------------------------------

// The persisted NDJSON the Logs tab fetches. Covers: a source with NO stepIndex
// and no cycle (preflight — orchestrator.mjs:518 logs it with no attr, which is
// the ONLY preflight log line in the codebase), a parallel pair sharing a step,
// and a sub-agent line whose source is "role ▸ label" (U+25B8) — which must ride
// along with its parent's filter. No "── Cycle N ──" separator is drawn here:
// cycleSeparatorBefore returns null while prevCycle is still null (log-line.mjs:83)
// and appendLogRec carries prevCycle past the cycle-less preflight record, so the
// first cycled line never gets a leading rule and every later line stays at
// cycle 1. srcTexts therefore reads as a clean list.
const LOG_NDJSON = [
  { ts: '2026-08-18T10:00:00Z', source: 'preflight', level: 'info', text: 'Detected tool: graphify' },
  { ts: '2026-08-18T10:00:01Z', source: 'planner', level: 'info', text: 'planning the work', stepIndex: 0, cycle: 1 },
  { ts: '2026-08-18T10:00:02Z', source: 'implementer', level: 'info', text: 'writing code', stepIndex: 1, cycle: 1 },
  { ts: '2026-08-18T10:00:03Z', source: 'implementer ▸ research auth', level: 'info', text: 'sub-agent line', stepIndex: 1, cycle: 1, sub: true },
  { ts: '2026-08-18T10:00:04Z', source: 'reviewer', level: 'warn', text: 'one nitpick', stepIndex: 1, cycle: 1 },
].map((r) => JSON.stringify(r)).join('\n');

// The 8 keys the real /api/history/:key/:id payload carries
// (test/ui-history-detail.test.mjs:104-113, matching src/core/artifacts.mjs).
// `artifacts` entries are {kind, relPath} — the field name the server actually
// emits; only `kind` is read by the Logs tab's visibility predicate
// (app.js:9987), but the fixture must not misrepresent the payload.
const DETAIL = {
  state: {
    id: ID, title: ROW.title, status: 'done', startedAt: ROW.startedAt,
    stepper: STEPPER, steps: [], subAgents: [],
    branch: { source: 'master', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'Add the thing.',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [],
  artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],   // <- what makes the Logs tab visible
  auditMarkdown: '# saved',
};

const DAY = 86400000;
const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const okText = (body) => Promise.resolve({ ok: true, status: 200, text: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

// ARM ORDER IS LOAD-BEARING (ui-history-detail.test.mjs:164-167): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call — and `.includes('/api/history/pr')` is
// TRUE for this project key, because it starts with "pr". Most-specific first,
// and every history arm matches with endsWith, never includes.
// The /log arm returns TEXT (NDJSON), never json — loadLiveLogs calls res.text()
// (app.js:8996), which is why the shared ok()/fail() helpers cannot serve it.
function historyArms(box) {
  return (url) => {
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (url.endsWith('/log')) return box.log == null ? fail(404, { error: 'no log' }) : okText(box.log);
    if (url.endsWith('/api/history')) return ok({ pipelines: [ROW], ghAvailable: false });
    if (url.endsWith(DETAIL_URL)) return ok(box.detail);
    if (url.endsWith('/api/budget')) return ok(okBudget());
    return null;
  };
}

// `arms` runs BEFORE the shared base, the same precedence bootDetail uses
// (test/ui-history-detail.test.mjs:186), so a case can override one endpoint.
async function openDetail({ detail = DETAIL, log = LOG_NDJSON, arms = null } = {}) {
  const box = { detail, log };
  const base = historyArms(box);
  const ctx = await boot({ fetchHandler: (url, opts) => (arms && arms(url, opts)) || base(url, opts) });
  go(ctx.window, detailHash);
  await settle(ctx.window, 6);
  return ctx;
}

const $ = (window, sel) => window.document.querySelector(sel);
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const srcTexts = (sec) => [...sec.querySelectorAll('.log .log-src')].map((n) => n.textContent);

async function openLogsTab(window) {
  click(window, $(window, '#hist-detail .hd-tab[data-sec="logs"]'));
  await settle(window, 4);
  return $(window, '#hist-detail .hd-sec[data-sec="logs"]');
}

// --- Task 2 -----------------------------------------------------------------

test('__setLogSource picks the first candidate the run actually logged under, and keeps sub-agent lines', async () => {
  const ctx = await openDetail();
  const sec = await openLogsTab(ctx.window);

  // Legacy spelling first, real one second: the dropdown decides.
  sec.__setLogSource(['implement', 'implementer']);

  assert.equal(sec.querySelector('.log-f-source').value, 'implementer');
  assert.deepEqual(srcTexts(sec), ['[implementer]', '[implementer ▸ research auth]']);
});

test('__setLogSource injects an option for a source the run never logged under', async () => {
  const ctx = await openDetail();
  const sec = await openLogsTab(ctx.window);

  sec.__setLogSource(['refiner']);

  const sel = sec.querySelector('.log-f-source');
  assert.equal(sel.value, 'refiner');
  assert.ok([...sel.options].some((o) => o.value === 'refiner'), 'the absent source is offered, not swallowed');
  assert.equal(sec.querySelector('.log').textContent, '(no lines match the filter)');
});

// Design Contract 3 has no toggle, so re-clicking a node is ROUTINE. Testing
// membership against the run's facets (which never learn about an injection)
// instead of the select's own options appends a duplicate <option> every time.
test('re-applying an absent source does not duplicate its injected option', async () => {
  const ctx = await openDetail();
  const sec = await openLogsTab(ctx.window);
  const sel = sec.querySelector('.log-f-source');
  const before = sel.options.length;

  sec.__setLogSource(['refiner']);
  sec.__setLogSource(['refiner']);
  sec.__setLogSource(['refiner']);

  assert.equal([...sel.options].filter((o) => o.value === 'refiner').length, 1, 'exactly one injected option');
  assert.equal(sel.options.length, before + 1, 'the dropdown does not grow on re-click');
  assert.equal(sel.value, 'refiner');
});

test('a source intent parked BEFORE the fetch resolves is applied once the panel paints', async () => {
  const ctx = await openDetail();
  const w = ctx.window;
  const sec = $(w, '#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.dataset.loaded, undefined, 'the Logs tab starts unbuilt');

  sec.__pendingLogSource = ['planner'];
  click(w, $(w, '#hist-detail .hd-tab[data-sec="logs"]'));
  await settle(w, 4);

  assert.equal(sec.querySelector('.log-f-source').value, 'planner');
  assert.deepEqual(srcTexts(sec), ['[planner]']);
  assert.equal(sec.__pendingLogSource, null, 'the intent is drained exactly once');
});

// The drain lives INSIDE the try on purpose. This is what that buys: a failed
// fetch leaves the slot intact, the catch clears panel.dataset.loaded so the tab
// re-arms (app.js:9048), and the retry honors the intent that started it all.
// The intent is parked BY HAND here: a node click is what parks it in
// production, but this case must be satisfiable by THIS task, so it exercises the
// setter contract alone. Same one-failure-then-success shape — and the same
// overview -> logs re-activation — as test/ui-history-detail.test.mjs:1524-1551.
test('a failed log fetch keeps a parked intent alive for the retry', async () => {
  let attempts = 0;
  const ctx = await openDetail({
    arms: (url) => {
      if (!url.endsWith('/log')) return null;
      attempts += 1;
      return attempts === 1 ? fail(500, { error: 'boom' }) : okText(LOG_NDJSON);
    },
  });
  const w = ctx.window;
  const sec = $(w, '#hist-detail .hd-sec[data-sec="logs"]');

  sec.__pendingLogSource = ['planner'];
  click(w, $(w, '#hist-detail .hd-tab[data-sec="logs"]'));
  await settle(w, 4);

  assert.match(sec.querySelector('.log').textContent, /Could not load logs: HTTP 500/);
  assert.equal(sec.dataset.loaded, '', 'the failed load re-arms the tab');
  assert.deepEqual(sec.__pendingLogSource, ['planner'], 'the intent survives the failure');

  click(w, $(w, '#hist-detail .hd-tab[data-sec="overview"]'));
  click(w, $(w, '#hist-detail .hd-tab[data-sec="logs"]'));   // re-activate -> retry
  await settle(w, 4);

  assert.equal(attempts, 2, 'switching back re-issued the fetch');
  assert.equal(sec.querySelector('.log-f-source').value, 'planner');
  assert.deepEqual(srcTexts(sec), ['[planner]']);
  assert.equal(sec.__pendingLogSource, null);
});

// --- Task 3 -----------------------------------------------------------------


// A real pointer never lands on the .run-node div itself — e.target is always a
// descendant (.nmeta b, .nic svg, .nstat). This is the ONLY case that exercises
// the delegated closest() walk, i.e. the path every real click takes.





// THE RISKIEST INFERENCE IN THE WHOLE DESIGN, end-to-end. A run that predates
// state.stepper renders CLIENT_DEFAULT_STEPPER, whose `implement` node knows
// only its uiPhase — but the lines that run wrote carry the agent ROLE,
// `implementer`. Nothing detects the vintage: logSourceCandidates offers BOTH
// spellings and the log's own dropdown arbitrates. Tasks 1 and 2 each cover one
// half of that; only this test proves the halves meet.

// The stylesheet has no runtime here (jsdom loads no external CSS), so its two
// load-bearing properties — SCOPE and SPECIFICITY — are asserted as text, the
// same way test/ui-run-flow-css.test.mjs locks this file.

// --- Task 4 -----------------------------------------------------------------




