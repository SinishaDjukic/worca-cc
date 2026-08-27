# History Graph → Logs Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the History detail screen, clicking a node in the workflow graph opens the Logs tab and narrows its `source` filter to that node's agent.

**Architecture:** `runNode()` stamps each graph node with the log `source` its lines carry (`data-log-source`), so the mapping lives in one place and is shared by both graphs. `loadLiveLogs()` — which owns the Logs tab's filter state in a closure — exposes a single narrow setter on the panel element (`panel.__setLogSource`) plus an element-scoped pending slot (`panel.__pendingLogSource`) for a click that *opens* a not-yet-fetched tab. A new `wireHdGraphLogLinks(screen)` runs after `initHdTabs` and binds one delegated click/keydown handler on `.hd-graph`, using a hoisted `hdActivateTab` to switch tabs. No new module-level globals with a lifetime longer than the open detail screen.

**Tech Stack:** Plain browser ES modules (`ui/public/app.js`, no build step), `ui/public/style.css`, `node --test` + `jsdom` for tests.

**Spec:** None — bounded change; the design was agreed in-session and is restated verbatim in **Design Contract** below. That section is the spec this plan argues from.

## Global Constraints

- No new dependencies. `ui/public/app.js` is a browser module served as-is; no transpilation, no bundler.
- Node engine floor `>=22.13.0`. Full suite: `npm test`. Single file: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.test.mjs`.
- Baseline is green (2705/2705 as of 2026-08-19). A red test at the end of any task is that task's bug.
- The **live Running-view card is out of scope**. Its graph renders the same `runNode()` markup and therefore inherits the `data-log-source` attribute, but binds no handler and gets no CSS. `test/ui-run-graph*.test.mjs`, `test/ui-stepper.test.mjs` and `test/ui-live-log-dom.test.mjs` must stay green untouched.
- Match the surrounding file's comment density: this codebase explains *why* above non-obvious code. Every snippet below ships with its comment — keep them.
- U+25B8 (`▸`) is the sub-agent separator and U+00B7 (`·`) the model separator. Copy them verbatim; never substitute ASCII.

---

## Design Contract

The behavior this plan implements, decided and locked:

1. **Filter axis: `source` only.** A click sets the Logs bar's `source` select and nothing else. `level`, `step`, `cycle` and `search` are left exactly as the user had them. Consequence, accepted: clicking a node in a looped step shows that agent across **all** cycles and **all** steps it ran in.
2. **Navigation: switch + scroll.** The click activates the Logs tab (building it if it was never opened) and scrolls the panel into view.
3. **No toggle.** Clicking the same node again re-applies the same filter. Nothing clears it but the dropdown. No persistent "selected" ring on the node — there is no state to keep in sync.
4. **Bookends: Preflight yes, Done no.** `preflight` is a real log source (`orchestrator.mjs:517` logs under it, with no `stepIndex`). The Done bookend emits nothing, carries no `data-log-source`, gets no pointer, and clicking it does nothing.
5. **Sub-agents ride along.** `compileLogFilter` matches a source prefix, so filtering by `implementer` keeps `implementer ▸ research auth` (`ui/public/log-filter.mjs:38-41`). This is inherited, not implemented.
6. **A source with zero lines is shown honestly.** If the run never logged under a node's source, the option is injected into the dropdown and the box reads `(no lines match the filter)` — never a silent no-op.
7. **A run with no logs never invites a click.** When `initHdTabs` renders no Logs tab (no `live-log` artifact), `.hd-graph` gets no `linked` class, nodes get no `role`/`tabindex`/pointer, and the handler no-ops.

### Why `data-log-source` is not `stepIndex`

Log records carry **no `nodeId`** — `projectLogRecord` (`ui/public/log-line.mjs:57-64`) keeps only `source`, `level`, `text`, `ts`, `sub`, `stepIndex`, `cycle`, `stream`. `source` is the agent key: `_onAgentEvent(node.key, …)` at `src/core/orchestrator.mjs:2953`. So the node → log mapping is by key, and the value differs by manifest vintage:

| Manifest | Node shape | Value to use |
|---|---|---|
| v2 (`buildStepperManifest`, `src/core/workflows.mjs:470`) | `{id, key, uiPhase, …}` | `node.key` (e.g. `implementer`) |
| Legacy default (`CLIENT_DEFAULT_STEPPER`, `ui/public/app.js:696`) | `{id, uiPhase}`, **no `key`** | `node.uiPhase` (e.g. `implement`) |
| Preflight bookend | `{id:'preflight'}`, no key, no uiPhase | `'preflight'` |
| Done bookend | `{id:'done'}`, no key, no uiPhase | *(none — inert)* |

`UI_PHASE` (`src/core/workflows.mjs:387-392`) maps key → phase (`planner`→`plan`), so the two vintages genuinely differ. Task 4 resolves this by handing the setter an ordered **candidate list** and letting the facets of the run's actual log decide which spelling won.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `ui/public/app.js` | Modify (4 sites) | `runNode` stamp · `loadLiveLogs` setter + pending slot · `initHdTabs` hoists `activate` · new `wireHdGraphLogLinks` + `LEGACY_PHASE_SOURCE` + `logSourceCandidates` |
| `ui/public/style.css` | Modify (1 block, after `.hd-graph`) | Pointer + focus ring for linked nodes, scoped to `.hd-graph.linked` |
| `test/ui-history-graph-log-link.test.mjs` | Create | Every behavior in the Design Contract |

No file split. `app.js` is 11.6k lines and this change is ~60 lines across four existing seams; unilaterally restructuring it is out of scope.

---

### Task 1: Stamp `data-log-source` on run-graph nodes

**Files:**
- Modify: `ui/public/app.js:859` (inside `runNode`, right after `d.dataset.id = node.id;`)
- Test: `test/ui-history-graph-log-link.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: every `.run-node` element built by `buildRunGraph` carries `dataset.logSource` = the log `source` string for that node, or no attribute at all when the node emits no logs. `runNode` and `buildRunGraph` are already on the `window.__np` test surface (`ui/public/app.js:2702-2703`).

- [ ] **Step 1: Write the failing test**

Create `test/ui-history-graph-log-link.test.mjs` with the harness plus the two Task-1 tests:

```js
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
// test/ui-history-detail.test.mjs:25-96 — the suites do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases. ONE boot per test: booting twice in
// one case would rebind globalThis.window under the first context's handlers.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  // jsdom implements neither scrollIntoView (the graph link calls it on the
  // Logs panel) nor clipboard (the log-copy button binds unconditionally).
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

// A v2 manifest: bookends + one solo cell + one PARALLEL cell, so the
// two-nodes-one-step case is covered by construction.
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

test('runNode stamps data-log-source: agent key on v2 nodes, preflight bookend, nothing on Done', async () => {
  const ctx = await boot();
  const host = ctx.window.document.createElement('div');
  host.className = 'run-flow';
  ctx.window.__np.buildRunGraph(host, STEPPER);

  const src = (id) => host.querySelector(`.run-node[data-id="${id}"]`).dataset.logSource;
  assert.equal(src('preflight'), 'preflight');
  assert.equal(src('s0_0'), 'planner');
  assert.equal(src('s1_0'), 'implementer');
  assert.equal(src('s1_1'), 'reviewer');
  // Done emits no logs -> NO attribute at all (not an empty one).
  assert.equal(host.querySelector('.run-node[data-id="done"]').hasAttribute('data-log-source'), false);
});

test('runNode falls back to uiPhase on the legacy default stepper (nodes carry no key)', async () => {
  const ctx = await boot();
  const host = ctx.window.document.createElement('div');
  host.className = 'run-flow';
  ctx.window.__np.buildRunGraph(host, null); // null -> CLIENT_DEFAULT_STEPPER

  assert.equal(host.querySelector('.run-node[data-id="implement"]').dataset.logSource, 'implement');
  assert.equal(host.querySelector('.run-node[data-id="preflight"]').dataset.logSource, 'preflight');
  assert.equal(host.querySelector('.run-node[data-id="done"]').hasAttribute('data-log-source'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: FAIL — both cases, `Expected values to be strictly equal: undefined !== 'preflight'`.

- [ ] **Step 3: Write minimal implementation**

In `ui/public/app.js`, inside `runNode`, immediately after `d.dataset.id = node.id;`:

```js
  // The History detail wires a click on these nodes to the Logs tab's `source`
  // filter (wireHdGraphLogLinks). The source a node's lines carry is its AGENT
  // KEY on a v2 manifest (orchestrator.mjs logs under node.key) but its uiPhase
  // on the legacy default one, whose nodes have no key at all; `preflight` is a
  // real log source that is neither. The Done bookend emits nothing, so it
  // deliberately gets NO attribute and stays inert. Data-only: the live Running
  // card renders the same markup and binds no handler to it.
  const logSource = node.id === 'preflight' ? 'preflight' : (node.key || node.uiPhase || '');
  if (logSource) d.dataset.logSource = logSource;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: PASS (2 tests).

Then confirm the shared markup change broke nothing in the live view:

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-run-graph.test.mjs test/ui-run-graph-paint.test.mjs test/ui-stepper.test.mjs test/ui-node-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-history-graph-log-link.test.mjs
git commit -m "feat(ui): stamp run-graph nodes with their log source"
```

---

### Task 2: Expose a `source` setter on the History Logs panel

**Files:**
- Modify: `ui/public/app.js:9045` (tail of `loadLiveLogs`, between the `.log-copy` listener and the closing `paint()`)
- Test: `test/ui-history-graph-log-link.test.mjs` (append)

**Interfaces:**
- Consumes: `data-log-source` from Task 1 (indirectly — the setter takes plain strings).
- Produces, on the Logs `.hd-sec` panel element:
  - `panel.__setLogSource(candidates: string[] | string): void` — picks the first candidate present in the log's `source` facets, else injects `candidates[0]` as an option; sets the select and `filter.source`, then repaints. No-op on an empty list.
  - `panel.__pendingLogSource: string[] | null` — an intent parked by a caller *before* the panel finishes fetching; drained exactly once after the first successful paint. Element-scoped on purpose: it dies with the screen, so no stale intent can leak into a later, unrelated run.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-history-graph-log-link.test.mjs` (after the Task-1 tests) — first the shared detail-screen harness, then the two cases:

```js
// --- detail-screen harness --------------------------------------------------

// The persisted NDJSON the Logs tab fetches. Covers: a source with NO stepIndex
// (preflight), a parallel pair sharing a step, and a sub-agent line whose source
// is "role ▸ label" (U+25B8) — which must ride along with its parent's filter.
const LOG_NDJSON = [
  { ts: 1, source: 'preflight', level: 'info', text: 'Detected tool: graphify' },
  { ts: 2, source: 'planner', level: 'info', text: 'planning the work', stepIndex: 0, cycle: 1 },
  { ts: 3, source: 'implementer', level: 'info', text: 'writing code', stepIndex: 1, cycle: 1 },
  { ts: 4, source: 'implementer ▸ research auth', level: 'info', text: 'sub-agent line', stepIndex: 1, cycle: 1, sub: true },
  { ts: 5, source: 'reviewer', level: 'warn', text: 'one nitpick', stepIndex: 1, cycle: 1 },
].map((r) => JSON.stringify(r)).join('\n');

const DETAIL = {
  state: {
    id: ID, title: ROW.title, status: 'done', startedAt: ROW.startedAt,
    stepper: STEPPER, steps: [], subAgents: [],
    branch: { source: 'master', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'Add the thing.',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [],
  artifacts: [{ kind: 'live-log', name: 'live.ndjson' }],   // <- what makes the Logs tab visible
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

// ARM ORDER IS LOAD-BEARING (ui-history-routing.test.mjs:119-127): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call. Most-specific first, and every history
// arm matches with endsWith, never includes.
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

async function openDetail({ detail = DETAIL, log = LOG_NDJSON } = {}) {
  const box = { detail, log };
  const ctx = await boot({ fetchHandler: historyArms(box) });
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

  // Legacy spelling first, real one second: the facets decide.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: FAIL — `sec.__setLogSource is not a function` on the first two, and the third leaves `.log-f-source` at `''`.

- [ ] **Step 3: Write minimal implementation**

In `ui/public/app.js`, inside `loadLiveLogs`, replace the trailing `paint();` of the `try` block with:

```js
    // The History run-graph's node click drives THIS bar (wireHdGraphLogLinks).
    // It hands over an ORDERED CANDIDATE LIST rather than one string because the
    // source a node's lines carry differs by manifest vintage (agent key on v2,
    // uiPhase on the legacy default): the first candidate this run actually
    // logged under wins. When the run logged under none of them, candidates[0]
    // is injected as an option so the dropdown reads honestly and the box says
    // "(no lines match the filter)" instead of the click silently doing nothing.
    // Only `source` is touched — level/step/cycle/search are the user's.
    const sourceSel = bar.querySelector('.log-f-source');
    panel.__setLogSource = (candidates) => {
      const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean).map(String);
      if (!list.length) return;
      const known = new Set(facets.sources.map(String));
      const pick = list.find((c) => known.has(c)) || list[0];
      if (!known.has(pick)) {
        const opt = document.createElement('option');
        opt.value = pick;
        opt.textContent = pick;
        sourceSel.appendChild(opt);
      }
      sourceSel.value = pick;
      filter.source = pick;
      paint();
    };

    paint();

    // A click that OPENED this tab ran before the fetch above resolved, so its
    // intent was parked on the panel element and is drained here — after the
    // first paint, and exactly once. Element-scoped rather than module-scoped so
    // it cannot outlive the screen. On the error path below the slot is left
    // intact: the tab re-arms itself for a retry, and the intent should survive
    // to that retry.
    const pending = panel.__pendingLogSource;
    if (pending) {
      panel.__pendingLogSource = null;
      panel.__setLogSource(pending);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: PASS (5 tests).

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-detail.test.mjs test/ui-log-filters-row.test.mjs test/log-filter.test.mjs`
Expected: PASS — the Logs panel's existing behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-history-graph-log-link.test.mjs
git commit -m "feat(ui): let a caller set the History Logs panel's source filter"
```

---

### Task 3: Click a graph node to open and filter the Logs tab

**Files:**
- Modify: `ui/public/app.js:9993` (declare `hdActivateTab` beside `hdTabCells`)
- Modify: `ui/public/app.js:10002` (assign `hdActivateTab = activate` inside `initHdTabs`)
- Modify: `ui/public/app.js:9321` (call `wireHdGraphLogLinks(screen)` in `loadHistDetailScreen`, after `initHdTabs`)
- Modify: `ui/public/app.js` (new `LEGACY_PHASE_SOURCE` + `logSourceCandidates` + `wireHdGraphLogLinks`, inserted after `initHdTabs`'s closing brace at :10068)
- Modify: `ui/public/style.css:1621` (new block right after `.hd-graph{…}`)
- Test: `test/ui-history-graph-log-link.test.mjs` (append)

**Interfaces:**
- Consumes: `dataset.logSource` (Task 1); `panel.__setLogSource` / `panel.__pendingLogSource` (Task 2); the existing `hdTabCells: Map<string,{tab,btn,sec}>`.
- Produces:
  - `hdActivateTab: ((key: string) => void) | null` — module-level, same lifetime as `hdTabCells`, reassigned by every `initHdTabs`.
  - `logSourceCandidates(src: string): string[]` — ordered candidates for one stamp.
  - `wireHdGraphLogLinks(screen: HTMLElement): void` — idempotent per screen; called once per detail load.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-history-graph-log-link.test.mjs`:

```js
// --- Task 3 -----------------------------------------------------------------

test('clicking a graph node opens the Logs tab and filters it to that node', async () => {
  const ctx = await openDetail();
  const w = ctx.window;

  // The Logs tab has never been opened: this exercises the parked-intent path.
  click(w, $(w, '#hist-detail .hd-graph .run-node[data-id="s1_0"]'));
  await settle(w, 4);

  const tab = $(w, '#hist-detail .hd-tab[data-sec="logs"]');
  const sec = $(w, '#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(tab.getAttribute('aria-selected'), 'true');
  assert.equal(sec.hidden, false);
  assert.equal(sec.querySelector('.log-f-source').value, 'implementer');
  assert.deepEqual(srcTexts(sec), ['[implementer]', '[implementer ▸ research auth]']);
});

test('a click into an ALREADY-OPEN Logs tab swaps the source and leaves the other axes alone', async () => {
  const ctx = await openDetail();
  const w = ctx.window;
  const sec = await openLogsTab(w);

  const level = sec.querySelector('.log-f-level');
  level.value = 'warn';
  level.dispatchEvent(new w.Event('change', { bubbles: true }));

  // s1_1 is the reviewer, parallel to the implementer in the SAME step — proof
  // that the click resolves per node, not per column.
  click(w, $(w, '#hist-detail .hd-graph .run-node[data-id="s1_1"]'));
  await settle(w, 2);

  assert.equal(sec.querySelector('.log-f-source').value, 'reviewer');
  assert.equal(level.value, 'warn', 'an axis the user set is never reset by a node click');
  assert.deepEqual(srcTexts(sec), ['[reviewer]']);
});

test('the Preflight bookend filters to the preflight source', async () => {
  const ctx = await openDetail();
  const w = ctx.window;

  click(w, $(w, '#hist-detail .hd-graph .run-node[data-id="preflight"]'));
  await settle(w, 4);

  const sec = $(w, '#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.querySelector('.log-f-source').value, 'preflight');
  assert.deepEqual(srcTexts(sec), ['[preflight]']);
});

test('re-clicking the same node re-applies the same filter (no toggle)', async () => {
  const ctx = await openDetail();
  const w = ctx.window;
  const node = $(w, '#hist-detail .hd-graph .run-node[data-id="s0_0"]');

  click(w, node);
  await settle(w, 4);
  click(w, node);
  await settle(w, 2);

  const sec = $(w, '#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.querySelector('.log-f-source').value, 'planner');
  assert.deepEqual(srcTexts(sec), ['[planner]']);
});

test('a run WITH logs marks its graph linked', async () => {
  const ctx = await openDetail();
  assert.equal($(ctx.window, '#hist-detail .hd-graph').classList.contains('linked'), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: FAIL — `aria-selected` is `'false'` (the click does nothing) and `.hd-graph` has no `linked` class.

- [ ] **Step 3: Write minimal implementation**

**3a.** In `ui/public/app.js`, extend the declaration above `initHdTabs`:

```js
// The live tab cells of the OPEN detail, so refreshHdFromRow can repaint the one
// body that reads mutable record fields (Overview). Reset on every initHdTabs.
let hdTabCells = null;
// initHdTabs' own activate(), hoisted out so the run-graph node links can switch
// to the Logs tab. Same lifetime as hdTabCells — both are reassigned by every
// initHdTabs and belong to exactly one open screen.
let hdActivateTab = null;
```

**3b.** Inside `initHdTabs`, next to `hdTabCells = cells;` (the inner `function activate` is a hoisted declaration, so it is already bound here):

```js
  hdTabCells = cells;
  hdActivateTab = activate;
```

**3c.** Directly after `initHdTabs`'s closing brace, add:

```js
// Legacy manifests (CLIENT_DEFAULT_STEPPER — a run that predates state.stepper)
// name their nodes by uiPhase, but the lines those runs logged carry the agent
// ROLE. Map phase -> role so an old run's node still resolves to a real source.
// The candidate list keeps BOTH spellings and the log's own facets pick the
// winner, so neither vintage has to be detected.
const LEGACY_PHASE_SOURCE = {
  plan: 'planner', refine: 'refiner', implement: 'implementer',
  review: 'reviewer', decompose: 'decomposer',
};

/** Ordered log-source candidates for one node's data-log-source stamp. */
function logSourceCandidates(src) {
  const alt = LEGACY_PHASE_SOURCE[src];
  return alt && alt !== src ? [src, alt] : [src];
}

// Make the History detail's run-graph nodes drive the Logs tab's `source` filter:
// click a node -> open Logs, narrow to that agent, scroll the panel into view.
// ONLY `source` is set; level/step/cycle/search stay the user's, and a second
// click on the same node re-applies rather than toggling (there is no selected
// state to keep in sync with a hand-edited dropdown).
//
// No-op when the run has no live-log artifact: initHdTabs then renders no Logs
// tab at all, so the graph stays unlinked, unstyled and inert — nothing invites
// a click that could not do anything. MUST run after initHdTabs (it reads
// hdTabCells) and after paintHistStepper (it reads the built nodes).
function wireHdGraphLogLinks(screen) {
  const graph = screen.querySelector('.hd-graph');
  if (!graph || !hdTabCells || !hdTabCells.has('logs')) return;
  graph.classList.add('linked');

  const open = (node) => {
    const cell = hdTabCells && hdTabCells.get('logs');
    if (!cell) return;
    const list = logSourceCandidates(node.dataset.logSource);
    // Park the intent when the panel has not fetched yet (loadLiveLogs drains it
    // after its first paint); apply it directly when it has. Setting it BEFORE
    // activate() is load-bearing: activate() is what triggers the fetch.
    if (typeof cell.sec.__setLogSource === 'function') cell.sec.__setLogSource(list);
    else cell.sec.__pendingLogSource = list;
    hdActivateTab('logs');
    cell.sec.scrollIntoView({ block: 'nearest' });
  };

  // Delegated: paintRunGraph tints nodes in place but a future rebuild would
  // replace them, and one listener on the graph survives that either way. The
  // Done bookend carries no data-log-source, so the selector skips it.
  graph.addEventListener('click', (e) => {
    const node = e.target.closest && e.target.closest('.run-node[data-log-source]');
    if (node && graph.contains(node)) open(node);
  });
}
```

**3d.** In `loadHistDetailScreen`, after the `initHdTabs(screen, rec, data);` line:

```js
  initHdTabs(screen, rec, data);
  wireHdGraphLogLinks(screen);   // AFTER initHdTabs: it reads hdTabCells
```

**3e.** In `ui/public/style.css`, directly after `.hd-graph{margin-top:18px;}`:

```css
/* History detail only: a run-graph node is a link into the Logs tab's `source`
   filter (wireHdGraphLogLinks). `.linked` is added only when the run HAS a Logs
   tab, so an inert graph never shows a pointer, and the Done bookend carries no
   data-log-source so it stays unstyled. The live Running card renders the same
   markup and is deliberately untouched by this rule. */
.hd-graph.linked .run-node[data-log-source]{cursor:pointer;}
.hd-graph.linked .run-node[data-log-source]:focus-visible{outline:2px solid var(--c,var(--blue));outline-offset:3px;}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: PASS (10 tests).

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-detail.test.mjs test/ui-history-routing.test.mjs test/ui-pipeline-tabs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js ui/public/style.css test/ui-history-graph-log-link.test.mjs
git commit -m "feat(ui): clicking a history graph node filters the Logs tab"
```

---

### Task 4: Keyboard + ARIA, and the inert cases

**Files:**
- Modify: `ui/public/app.js` (`wireHdGraphLogLinks` from Task 3 — add the attribute pass and the `keydown` handler)
- Test: `test/ui-history-graph-log-link.test.mjs` (append)

**Interfaces:**
- Consumes: `wireHdGraphLogLinks` (Task 3).
- Produces: every linked node carries `role="button"`, `tabIndex = 0` and `aria-label="Filter logs by <node label>"`; Enter and Space activate it. Nothing new is exported.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-history-graph-log-link.test.mjs`:

```js
// --- Task 4 -----------------------------------------------------------------

test('linked graph nodes are focusable, labelled, and activate on Enter', async () => {
  const ctx = await openDetail();
  const w = ctx.window;
  const node = $(w, '#hist-detail .hd-graph .run-node[data-id="s0_0"]');

  assert.equal(node.getAttribute('role'), 'button');
  assert.equal(node.tabIndex, 0);
  assert.equal(node.getAttribute('aria-label'), 'Filter logs by Plan');

  node.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle(w, 4);

  const sec = $(w, '#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.hidden, false);
  assert.equal(sec.querySelector('.log-f-source').value, 'planner');
});

test('Space activates a node and does not scroll the page', async () => {
  const ctx = await openDetail();
  const w = ctx.window;
  const node = $(w, '#hist-detail .hd-graph .run-node[data-id="s1_1"]');

  const ev = new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  node.dispatchEvent(ev);
  await settle(w, 4);

  assert.equal(ev.defaultPrevented, true, 'Space must not also scroll the detail body');
  assert.equal($(w, '#hist-detail .hd-sec[data-sec="logs"]').querySelector('.log-f-source').value, 'reviewer');
});

test('the Done bookend is inert: no role, and clicking it changes nothing', async () => {
  const ctx = await openDetail();
  const w = ctx.window;
  const done = $(w, '#hist-detail .hd-graph .run-node[data-id="done"]');

  assert.equal(done.hasAttribute('role'), false);
  assert.equal(done.tabIndex, -1);

  click(w, done);
  await settle(w, 2);
  assert.equal($(w, '#hist-detail .hd-tab[data-sec="logs"]').getAttribute('aria-selected'), 'false');
});

test('a run with no live-log artifact leaves its graph unlinked and its nodes inert', async () => {
  const ctx = await openDetail({ detail: { ...DETAIL, artifacts: [] }, log: null });
  const w = ctx.window;

  assert.equal($(w, '#hist-detail .hd-tab[data-sec="logs"]'), null, 'no Logs tab for a run with no log');
  const graph = $(w, '#hist-detail .hd-graph');
  assert.equal(graph.classList.contains('linked'), false);

  const node = $(w, '#hist-detail .hd-graph .run-node[data-id="s1_0"]');
  assert.equal(node.hasAttribute('role'), false);
  click(w, node);            // must not throw
  await settle(w, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: FAIL — `null !== 'button'` on the first case; Enter/Space do nothing. (The last two already pass — they assert the inert paths Task 3 built.)

- [ ] **Step 3: Write minimal implementation**

In `ui/public/app.js`, inside `wireHdGraphLogLinks`, add the attribute pass immediately after `graph.classList.add('linked');`:

```js
  // A div that behaves like a button must SAY so and be reachable without a
  // mouse. Done gets neither, because it has no data-log-source to match.
  for (const node of graph.querySelectorAll('.run-node[data-log-source]')) {
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    const label = node.querySelector('.nmeta b');
    node.setAttribute('aria-label', `Filter logs by ${label ? label.textContent : node.dataset.logSource}`);
  }
```

…and add the keyboard handler beside the existing delegated `click` listener:

```js
  graph.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const node = e.target.closest && e.target.closest('.run-node[data-log-source]');
    if (!node || !graph.contains(node)) return;
    e.preventDefault();   // Space would otherwise scroll the detail body too
    open(node);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-graph-log-link.test.mjs`
Expected: PASS (14 tests).

Then the whole suite:

Run: `npm test`
Expected: PASS — 2705 baseline plus the 14 new tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-history-graph-log-link.test.mjs
git commit -m "feat(ui): make history graph log links keyboard-operable"
```

---

## Verification

After Task 4, confirm the whole thing by hand as well as by suite:

```bash
npm start
```

Open `http://localhost:4317/#history`, enter any completed run, click a workflow node. Expected: the Logs tab activates, its **source** dropdown reads that agent, the level/step/cycle dropdowns and the search box are untouched, and the panel scrolls into view. Click the Done bookend: nothing happens, and the cursor is not a pointer. Tab to a node and press Enter: same as a click.

## Out of Scope

- The live Running-view card's graph (inherits `data-log-source`, binds nothing).
- Any second filter axis. `step` and `cycle` stay manual — decided, not deferred.
- A persistent "selected node" ring. There is no writer that would keep it in sync with a hand-edited dropdown, so it would go stale.
