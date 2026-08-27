# Node-Graph v2 — P6: Run monitor v2 + CLI Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v2 (graph-engine) runs legible everywhere the v1 runs are: the Running list card at Detailed density, the Running detail page, the History detail page and the CLI. One pure decor reducer turns a run's `state` into one decor bag; one renderer (P5's `view.mjs`) paints it in three hosts; one branch point (`paintGraphFor`) keeps every v1 surface byte-identical.

**Architecture:** `decorFromState(st, {live, now, subsOf})` is a pure, DOM-free reducer over the manifest v2 (`state.stepper`) + the execution ledger (`state.steps[]`) + the run-level outcome fields (`active`, `endReached`, `result`, `warnings`, `wireDeliveries`, `gate`). It returns ONE decor bag: node statuses, per-node footer rows, header totals, ants, loop badges, gate pip, End result chip, progress counts and the active-node list. `applyDecor(view, decor)` maps that bag onto the shared graph view through its fast paths only — `setStatus`, `setFooter`, `setNodeChrome`, `setWireBadge`, `setWireLive` — and never writes a card height (the card grows because `setFooter` re-runs `nodeSize`). `run-hosts.mjs` mounts that pair into the three hosts with per-host mode/zoom/wheel policy. `app.js` gains exactly one branch point, `paintGraphFor(host, stepper, decor)`, plus version arms on four v1 label helpers. The b-half adds the `node`/`execution` log-filter axes, keys sub-agents by `executionId`, and replaces the CLI's `phase` renderer with a pure `src/cli/render.mjs` exec formatter.

**Series position:** P6 of 8; requires P5 landed (sentinels: `export function createGraphView` in `ui/public/graph/view.mjs` AND `class="gv-head"` in `ui/public/index.html`); leaves dev green and shippable; the v1 engine and every v1 painter stay live.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats every rule, shape, message and constant it needs).

## Global Constraints

- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in every user-facing string: **worca** (never "worca-cc").
- Commits: `worca: Node-graph v2 P6 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file). Baseline recorded in Task 0; final total in the last task of each half.
- **Split plan.** P6a = Tasks 0–9 (monitor UI). P6b = Tasks 10–16 (filter + sub-agents + CLI), starting at the literal `### — split point: P6b starts here —` heading. Each half ends green and committed; either half may be executed as its own pipeline run.
- **Locks that BIND (do not re-litigate, do not "improve"):**
  - *Running page redesign D1–D17 + C1–C16.* The Detailed card body is header + graph + live log; density (`compact`/`detailed`) is persisted and **compact density renders NO graph**. `paintRdHeader` C16 rule: on the run-detail header **only the `.rd-meta` segment list changes** — the disabled-rule block and the `.rd-pause` single toggling control (C6: there is no `.rd-resume`) stay untouched. `RD_TERMINAL` (`const RD_TERMINAL = ['done','stopped','error']`, `app.js:14616`) and the `wr-*` keyframes stay declared exactly once.
  - *History detail redesign D1–D8.* Route stays `#history/<projectKey>/<id>`; **D5: History never displays model or effort** (the manifest carries them for Running only). D9: there is ONE log-filter markup, cloned from `#run-card-tpl .log-filters` (`ui/public/index.html:432`). D15: progress is a NUMERIC chip — never a progress bar.
  - *Scope fences.* Running D17 and History D7 are superseded at **exactly two seams**: `paintGraphFor` (the graph host painter) and the log-filter node/execution axes. Every other `.rd-*` / `.hd-*` rule and the density rules `style.css:2376-2377` stay untouched. The 300px `.rc-detailed .run-flow-wrap` rule is **additive** (a new rule, not an edit of `.run-flow-wrap` at `style.css:1264`).
- **Never borrow** `old:ui/public/graph/run-decor.mjs:457-461` (`card.style.height = …`). The card grows only through `view.setFooter(nodeId, rows)` → `nodeSize(node, ports, {footerRows})`.
- v1 runs (`stepper.version` 1 or absent) MUST keep rendering through the untouched v1 painters. `paintLegacyStrip` is P8's — do not build it.
- Every rule/guard gets a test that FAILS when the rule is removed (mutation-proof). jsdom 29: `PointerEvent`/`WheelEvent` exist; `setPointerCapture`/`hasPointerCapture`/`ResizeObserver` do NOT (guard every call); `requestAnimationFrame` only with `pretendToBeVisual` (inject `raf`); `getBoundingClientRect` returns zeros (inject `viewport`). Never wrap a jsdom `dispatchEvent` in `assert.doesNotThrow` (vacuous — listener errors surface as window `error` events).

---

### Task 0: Branch check, deps, predecessor sentinels, baseline

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch. By hand: `git checkout -b worca-cc/node-graph-v2-p6` off dev. NEVER `git checkout dev`; never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: this plan borrows adapted code from the discarded branch. Make it fetchable (reading it is optional — every borrowed line is embedded below): `git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed`
- [ ] Step 4: predecessor sentinels — **STOP if either is absent**:
  ```bash
  grep -q "export function createGraphView" ui/public/graph/view.mjs && \
  grep -q 'class="gv-head"' ui/public/index.html && echo P5-OK
  grep -q "export function buildGraphManifest" src/shared/graph/manifest.mjs && \
  grep -q "export function manifestPortsFn" src/shared/graph/manifest.mjs && \
  grep -q "export function nodeSize" src/shared/graph/geometry.mjs && echo P2-OK
  grep -q "'exec'" ui/server.mjs && echo P4-EVENTS-OK
  ```
- [ ] Step 5: `npm test 2>&1 | tail -5` — record the printed pass count as **BASELINE**; it must be green before any edit.

### Task 1: `decorFromState` — node statuses, progress, active nodes, End result

**Files:** create `ui/public/graph/run-decor.mjs`; create `test/ui-run-decor.test.mjs`.

**Interfaces produced:**
```js
// ui/public/graph/run-decor.mjs  (pure, DOM-free; browser + node --test)
export function decorFromState(st, { live = true, now = Date.now(), subsOf = null } = {}) → Decor
export function statusOf(node, rows, ctx) → NodeStatus          // the precedence rule, exported for tests
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';
export function fmtDur(ms) → string   // '4s' | '2m 10s' | '1h 1m'
export function fmtUsd(n) → string    // '$0.42' | '<$0.01' | '$0.00'
```
**The decor bag (FROZEN SHAPE — every consumer in this plan reads exactly these fields):**
```
NodeStatus = 'pending'|'active'|'done'|'paused'|'stopped'|'error'|'skipped'
FooterRow  = { executionId, nodeId, kind:'cycle'|'task', ordinal, label,
               led:NodeStatus, dur:string, cost:string, durMs:number, costUsd:number, flow:boolean }
Decor = {
  version: 2,
  live: boolean,             // the run may still execute
  resolved: boolean,         // !live || runStatus ∈ {done,stopped,error,paused}
  runStatus: string,
  status:      { [nodeId]: NodeStatus },
  footers:     { [nodeId]: { rows: FooterRow[], summary: string, leds: NodeStatus[],
                             fan: { leds:('run'|'done')[], count:number } | null } },
  totals:      { [nodeId]: { durMs, dur, costUsd, cost, hasStep } },
  colors:      { [nodeId]: string },        // '' for flow cards
  liveWireIds: string[],
  loopBadges:  { [wireId]: { n, max, text, title } },
  gate:        { nodeId, wireId, askId } | null,
  endResult:   { nodeId, path, rel, text, kind:'path'|'void' } | null,
  progress:    { done, total },             // done AGENT nodes / AGENT nodes
  activeNodes: [{ nodeId, executionId, label, color }],   // most-recently-started FIRST
  warnings:    string[],
  quiescent:   boolean,                     // resolved && endReached === false
  executions:  number,                      // ledger rows, bookends excluded
  loopDeliveries: number,                   // Σ wireDeliveries over loop wires
}
```
> `decorFromState` is PURE. The host layer (Task 5/7) shallow-adds `run`, `runId` and `mode` to the returned object; nothing inside this module reads them.

**Status precedence (VERBATIM — this is the rule the tests mutate):**
1. no ledger rows for the node → `runStatus === 'done' ? 'skipped' : 'pending'` (this single rule is what makes the End card `skipped` on a run that finished at quiescence, and what keeps never-fired nodes `pending` on a stopped/error run);
2. the LAST row's step status is `paused` or `stopped` → that status (only the ledger knows a pause: a paused execution completes as `done` on the wire);
3. any row `status === 'error'` → `error`;
4. the node id is in `state.active` → `active`;
5. the last row `status === 'done'` → `done`;
6. otherwise → `resolved ? 'stopped' : 'active'`.

- [ ] Step 1: Write the failing test — `test/ui-run-decor.test.mjs`

```js
// test/ui-run-decor.test.mjs
// P6a — the pure run-decor reducer: state tables in, one decor bag out. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorFromState, statusOf, fmtDur, fmtUsd, QUIESCENCE_WARNING } from '../ui/public/graph/run-decor.mjs';

// ── fixture builders ────────────────────────────────────────────────────────
const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1),
  color: 'violet', ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true },
  ...over,
});
const end = (id = 'n_end') => ({ id, kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '',
  ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } });
const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: {
    nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', {
      ports: { inputs: [{ id: 'fix', type: 'md', loop: true }, { id: 'plan', type: 'md', loop: false }], outputs: [{ id: 'done', type: 'void', when: 'always' }], await: true },
    }), end()],
    wires: [
      { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'plan' }, loop: false },
      { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' }, loop: false },
      { id: 'w3', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
    ],
  },
  bookends: { preflight: true, done: true },
};
const step = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1,
  status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const S = (over = {}) => ({ stepper: MANIFEST, status: 'running', steps: [], active: [],
  endReached: false, result: null, warnings: [], wireDeliveries: {}, tokens: {}, gate: null, ...over });

// ── statuses ────────────────────────────────────────────────────────────────
test('a node with no ledger rows is pending on a live run and skipped on a done run', () => {
  assert.equal(decorFromState(S()).status.n_plan, 'pending');
  assert.equal(decorFromState(S({ status: 'done', endReached: true })).status.n_plan, 'skipped');
  assert.equal(decorFromState(S({ status: 'stopped' })).status.n_plan, 'pending', 'stopped runs keep never-fired nodes pending');
  assert.equal(decorFromState(S({ status: 'error' })).status.n_plan, 'pending');
});

test('End is skipped on a done run that never reached it (quiescence)', () => {
  const d = decorFromState(S({ status: 'done', endReached: false }));
  assert.equal(d.status.n_end, 'skipped');
  assert.equal(d.quiescent, true);
  assert.deepEqual(d.warnings, [QUIESCENCE_WARNING]);
});

test('the step row wins over the exec status for paused and stopped', () => {
  const st = S({ status: 'paused', steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused' })] });
  assert.equal(decorFromState(st).status.n_plan, 'paused');
  const st2 = S({ status: 'stopped', steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'stopped' })] });
  assert.equal(decorFromState(st2).status.n_plan, 'stopped');
});

test('error anywhere in a node\'s rows beats a later done', () => {
  const st = S({ status: 'error', steps: [
    step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'error' }),
    step({ executionId: 'x:n_plan:2', nodeId: 'n_plan', status: 'done' }),
  ] });
  assert.equal(decorFromState(st).status.n_plan, 'error');
});

test('membership in active beats the last row; a started-not-finished row is active live and stopped when resolved', () => {
  const rows = [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start' })];
  assert.equal(decorFromState(S({ steps: rows, active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }] })).status.n_plan, 'active');
  assert.equal(decorFromState(S({ steps: rows })).status.n_plan, 'active', 'live run, no active list → still running');
  assert.equal(decorFromState(S({ steps: rows, status: 'done' })).status.n_plan, 'stopped');
});

test('statusOf is exported and takes (node, rows, ctx)', () => {
  assert.equal(statusOf({ id: 'n', kind: 'agent' }, [], { active: new Set(), stepByExec: new Map(), resolved: false, runStatus: 'running' }), 'pending');
});
```

- [ ] Step 2: `node --test test/ui-run-decor.test.mjs`
  `Expected: Error: Cannot find module '.../ui/public/graph/run-decor.mjs'` (every test fails to even import).

- [ ] Step 3: Append the run-level cases to `test/ui-run-decor.test.mjs`

```js
// ── progress / active nodes / End chip / formatters ─────────────────────────
test('progress counts AGENT nodes only, done over total', () => {
  const st = S({ steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'done' })] });
  assert.deepEqual(decorFromState(st).progress, { done: 1, total: 2 }, 'End is not an agent node');
});

test('activeNodes is most-recently-started first and carries label + colour', () => {
  const st = S({
    steps: [
      step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start', startedAt: '2026-08-26T10:00:00Z' }),
      step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', status: 'start', startedAt: '2026-08-26T10:00:05Z' }),
    ],
    active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }, { nodeId: 'n_impl', executionId: 'x:n_impl:1' }],
  });
  const d = decorFromState(st);
  assert.equal(d.activeNodes.length, 2);
  assert.equal(d.activeNodes[0].nodeId, 'n_impl', 'newest first');
  assert.equal(d.activeNodes[0].label, 'Implementer');
  assert.equal(d.activeNodes[0].color, 'violet');
});

test('the End chip links a path by basename and says "— completed" for a void result', () => {
  const done = { status: 'done', endReached: true,
    steps: [step({ executionId: 'x:n_end:1', nodeId: 'n_end', status: 'done', costUsd: 0 })] };
  const withPath = decorFromState(S({ ...done, result: { type: 'md', path: '/tmp/run/plan-review.md' } }));
  assert.deepEqual(withPath.endResult, { nodeId: 'n_end', path: '/tmp/run/plan-review.md', rel: 'plan-review.md', text: 'plan-review.md', kind: 'path' });
  const voidRes = decorFromState(S({ ...done, result: { type: 'void' } }));
  assert.equal(voidRes.endResult.kind, 'void');
  assert.equal(voidRes.endResult.text, '— completed');
  assert.equal(voidRes.endResult.path, null);
  assert.equal(decorFromState(S()).endResult, null, 'no chip until End binds');
});

test('executions and loopDeliveries exclude bookends and count only loop wires', () => {
  const st = S({
    status: 'done', endReached: true,
    steps: [
      step({ executionId: 'x:preflight:1', nodeId: 'preflight', status: 'done' }),
      step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'done' }),
      step({ executionId: 'x:done:1', nodeId: 'done', status: 'done' }),
    ],
    wireDeliveries: { w1: 4, w3: 2 },
  });
  const d = decorFromState(st);
  assert.equal(d.executions, 1, 'preflight/done bookend rows are not executions');
  assert.equal(d.loopDeliveries, 2, 'only w3 is a loop wire');
});

test('formatters', () => {
  assert.equal(fmtDur(4200), '4s');
  assert.equal(fmtDur(130000), '2m 10s');
  assert.equal(fmtDur(3660000), '1h 1m');
  assert.equal(fmtUsd(0.42), '$0.42');
  assert.equal(fmtUsd(0.004), '<$0.01');
  assert.equal(fmtUsd(0), '$0.00');
});
```

- [ ] Step 4: Implement — create `ui/public/graph/run-decor.mjs` (part 1 of 2; Task 2 appends the footer/badge section BELOW this code, same file)

```js
// ui/public/graph/run-decor.mjs   (depth 3 below the repo root)
//
// Run monitor v2. ONE pure reducer turns a run's `state` into ONE decor bag, and
// ONE DOM pass (applyDecor, Task 4) lays that bag over the shared graph view.
//
// Genericity charter: nothing here keys off an agent key or a phase name. Row
// labels read the manifest's port metadata (`loop: true`), statuses read the
// execution ledger (state.steps[], one row per execution, key === executionId),
// colours read the manifest node. History renders with the registry absent.
import { manifestPortsFn, manifestTemplate } from '../../../src/shared/graph/manifest.mjs';

/** The run-level warning a run that drained without binding End carries. */
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

/** Composite (kind:'task') rows label from the task title; keep the card readable. */
const TITLE_MAX = 40;
/** Squares in a sub-agent fan strip before the count alone carries the tail. */
const SUB_SQUARE_CAP = 24;
/** Run statuses that mean "nothing is running any more". */
const TERMINAL_RUN = new Set(['done', 'stopped', 'error', 'paused']);
/** Ledger keys the bookends own; never executions, never progress (P1's shared
 *  constant — `import { BOOKEND_EXECUTION_IDS } from '../../../src/shared/graph/constants.mjs'`). */
const BOOKEND_EXECS = new Set(BOOKEND_EXECUTION_IDS);
const BOOKEND_NODES = new Set(['preflight', 'done']);

export { manifestPortsFn, manifestTemplate };

// ── formatters ──────────────────────────────────────────────────────────────

/** `4s` / `2m 10s` / `1h 1m`. */
export function fmtDur(ms) {
  const s = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `$0.42`, with a `<$0.01` floor so a real-but-tiny spend never reads as free. */
export function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

// ── manifest readers ────────────────────────────────────────────────────────

export function isGraphManifest(stepper) {
  return !!(stepper && stepper.version === 2 && stepper.graph && Array.isArray(stepper.graph.nodes));
}
export function manifestNodes(stepper) {
  return isGraphManifest(stepper) ? stepper.graph.nodes.filter(Boolean) : [];
}
export function manifestWires(stepper) {
  return isGraphManifest(stepper) && Array.isArray(stepper.graph.wires) ? stepper.graph.wires.filter(Boolean) : [];
}
const nodeById = (stepper, id) => manifestNodes(stepper).find((n) => n.id === id) || null;
```

```js
// ── the execution ledger (state.steps[]) ────────────────────────────────────

/** Ledger rows in arrival order, bookends dropped. `key === executionId`. */
export function ledgerRows(st) {
  const out = [];
  for (const s of Array.isArray(st && st.steps) ? st.steps : []) {
    if (!s) continue;
    const executionId = s.executionId || s.key || null;
    if (executionId && BOOKEND_EXECS.has(executionId)) continue;
    if (s.nodeId != null && BOOKEND_NODES.has(s.nodeId)) continue;
    out.push({ ...s, executionId });
  }
  return out;
}

/** nodeId -> rows, in arrival order. */
function rowsByNode(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.nodeId == null) continue;
    if (!map.has(r.nodeId)) map.set(r.nodeId, []);
    map.get(r.nodeId).push(r);
  }
  return map;
}

/** A row's active ms, extended by the live clock while it is running. */
export function rowMs(row, now, live) {
  if (!row) return 0;
  const base = Number(row.activeMs) || 0;
  if (!live || !row.runningSince) return base;
  return base + Math.max(0, (now || Date.now()) - new Date(row.runningSince).getTime());
}

/**
 * The status precedence (spec §8). `rows` are THIS node's ledger rows in arrival
 * order; `ctx.active` is the Set of node ids in state.active; `ctx.stepByExec`
 * maps executionId -> row (identical to the row here, kept for symmetry with the
 * scheduler's own exec stream); `ctx.resolved` means nothing runs any more.
 */
export function statusOf(node, rows, ctx) {
  const list = Array.isArray(rows) ? rows : [];
  // 1. never fired. A DONE run means the scheduler drained without ever reaching
  //    this node — including End when endReached === false (quiescence). A
  //    stopped/error run stopped early, so its unreached nodes stay `pending`.
  if (!list.length) return ctx.runStatus === 'done' ? 'skipped' : 'pending';
  const last = list[list.length - 1];
  // 2. only the ledger knows a pause/stop: a paused execution completes as `done`
  //    on the wire, so the exec status alone would read it as finished.
  if (last.status === 'paused' || last.status === 'stopped') return last.status;
  // 3. any error in the node's history sticks.
  if (list.some((r) => r.status === 'error')) return 'error';
  // 4. in flight.
  if (ctx.active.has(node.id)) return 'active';
  // 5. finished cleanly.
  if (last.status === 'done') return 'done';
  // 6. started, not in flight, no terminal transition.
  return ctx.resolved ? 'stopped' : 'active';
}

// ── the reducer ─────────────────────────────────────────────────────────────

/**
 * ONE decor bag from ONE state snapshot. `st` is the SAME shape live
 * (orchestrator `state` events) and frozen (`rowToState` off pipelines +
 * pipeline_steps), so both surfaces call this with no adapter.
 * @param {object} st                 { stepper, status, steps, active, endReached, result, warnings, wireDeliveries, tokens, gate }
 * @param {{live?:boolean, now?:number, subsOf?:(nodeId:string)=>Array}} opts
 */
export function decorFromState(st, { live = true, now = Date.now(), subsOf = null } = {}) {
  const state = st || {};
  const stepper = state.stepper || null;
  const nodes = manifestNodes(stepper);
  const wires = manifestWires(stepper);
  const runStatus = String(state.status || '').toLowerCase();
  const resolved = !live || TERMINAL_RUN.has(runStatus);
  const rows = ledgerRows(state);
  const grouped = rowsByNode(rows);
  const activeList = Array.isArray(state.active) ? state.active.filter(Boolean) : [];
  const activeSet = new Set(activeList.map((a) => a.nodeId));
  const stepByExec = new Map(rows.map((r) => [r.executionId, r]));
  const ctx = { active: activeSet, stepByExec, resolved, runStatus };

  const status = {};
  const colors = {};
  for (const node of nodes) {
    status[node.id] = statusOf(node, grouped.get(node.id) || [], ctx);
    colors[node.id] = node.color || '';
  }

  // Progress = done AGENT nodes / AGENT nodes (D15: a number, never a bar).
  const agents = nodes.filter((n) => n.kind === 'agent');
  const progress = { done: agents.filter((n) => status[n.id] === 'done').length, total: agents.length };

  // Active nodes, most recently started FIRST (the compact row and the pill name
  // the newest one; two or more collapse to "N agents running").
  const startedAt = (execId) => {
    const r = stepByExec.get(execId);
    const t = r && r.startedAt ? Date.parse(r.startedAt) : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const activeNodes = activeList
    .map((a) => {
      const node = nodeById(stepper, a.nodeId);
      return { nodeId: a.nodeId, executionId: a.executionId || null,
        label: (node && (node.label || node.id)) || a.nodeId, color: (node && node.color) || '' };
    })
    .sort((x, y) => startedAt(y.executionId) - startedAt(x.executionId));

  const endReached = state.endReached === true;
  const endNode = nodes.find((n) => n.kind === 'end') || null;
  const endResult = endReached && state.result && endNode ? buildEndResult(endNode, state.result) : null;

  const warnings = (Array.isArray(state.warnings) ? state.warnings : []).filter(Boolean);
  const quiescent = resolved && state.endReached === false;
  if (quiescent && !warnings.includes(QUIESCENCE_WARNING)) warnings.push(QUIESCENCE_WARNING);

  const deliveries = state.wireDeliveries && typeof state.wireDeliveries === 'object' ? state.wireDeliveries : {};
  const loopDeliveries = wires.reduce((a, w) => a + (w.loop ? (Number(deliveries[w.id]) || 0) : 0), 0);

  const decor = {
    version: 2, live, resolved, runStatus, status, colors,
    footers: {}, totals: {}, liveWireIds: [], loopBadges: {}, gate: null,
    endResult, progress, activeNodes, warnings, quiescent,
    executions: rows.length, loopDeliveries,
  };
  decorateExecutions(decor, { stepper, nodes, wires, grouped, rows, activeList, stepByExec, state, now, live, subsOf });
  return decor;
}

/** End's result chip: basename link for a path, the void treatment otherwise. */
function buildEndResult(endNode, result) {
  const path = result && result.path ? String(result.path) : null;
  const rel = path ? path.split('/').filter(Boolean).pop() : null;
  return { nodeId: endNode.id, path, rel, text: path ? rel : '— completed', kind: path ? 'path' : 'void' };
}

// Task 2 replaces this stub with the footer/badge/ant/gate pass.
function decorateExecutions() {}
```

- [ ] Step 5: `node --test test/ui-run-decor.test.mjs`
  `Expected: # pass 11 / # fail 0` (11 tests: 6 status + 5 run-level).
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — run-decor reducer: statuses, progress, End result`

### Task 2: `decorFromState` — executions footer, totals, ants, loop badges, gate pip

**Files:** modify `ui/public/graph/run-decor.mjs` (replace the `decorateExecutions` stub); modify `test/ui-run-decor.test.mjs`.

**Rules (VERBATIM):**
- Footer row label: `cycle <ordinal>`, plus ` · <portId>` when a port in `trigger.freshPorts` is a **`loop: true` input of that node** (`await` is never `loop:true`, so a pure-await re-fire labels plainly). A `kind:'task'` row uses the task **title** instead, truncated to 40 chars with `…`.
- Right-hand text: `<dur> · <cost>`; a FLOW node (kind ≠ 'agent') gets **no cost pill at all** (its executions are instant and free) — an agent execution that cost nothing still says `$0.00`, because it ran.
- Collapsed summary: `3 runs · $1.12` (`1 run` singular; the cost half is omitted when the total is 0).
- Ants: the union of `trigger.wireIds` over the executions named in `state.active`. **Nothing marches on a resolved run** (a post-End drain publish routes nowhere, so a recorded-not-routed token can never light an edge).
- Loop badge: amber `N×` on `wire.loop === true` wires with `state.wireDeliveries[wireId] >= 1`; `title` = `"2 of 3 cycles"` from the wire's `maxCycles` (default 3).
- Gate pip: `state.gate.fromNode` (the gate holds at the SOURCE's publish, so the pip belongs on the wire's `from` node).

- [ ] Step 1: Write the failing test — append to `test/ui-run-decor.test.mjs`

```js
// ── executions footer / totals / ants / badges / gate ───────────────────────
const impl = (n, over = {}) => step({ executionId: `x:n_impl:${n}`, nodeId: 'n_impl', ordinal: n, ...over });

test('footer rows label a loop-port re-fire "cycle N · <port>" and a plain re-fire "cycle N"', () => {
  const st = S({ steps: [
    impl(1, { status: 'done', trigger: { wireIds: ['w1'], freshPorts: ['plan'] } }),
    impl(2, { status: 'done', trigger: { wireIds: ['w3'], freshPorts: ['fix'] } }),
  ] });
  const rows = decorFromState(st).footers.n_impl.rows;
  assert.deepEqual(rows.map((r) => r.label), ['cycle 1', 'cycle 2 · fix']);
  assert.deepEqual(rows.map((r) => r.executionId), ['x:n_impl:1', 'x:n_impl:2']);
  assert.equal(rows[1].kind, 'cycle');
});

test('a kind:"task" row is labelled by its title and truncated at 40 chars', () => {
  const long = 'Add the schema migration and every single backfill step';
  const st = S({ steps: [impl(1, { kind: 'task', title: long, status: 'done' })] });
  const row = decorFromState(st).footers.n_impl.rows[0];
  assert.equal(row.kind, 'task');
  assert.equal(row.label.length, 40);
  assert.ok(row.label.endsWith('…'));
});

test('flow nodes get a duration but never a cost pill; agents keep a truthful $0.00', () => {
  const st = S({ status: 'done', endReached: true, result: { type: 'void' }, steps: [
    step({ executionId: 'x:n_end:1', nodeId: 'n_end', status: 'done', costUsd: 0 }),
    impl(1, { status: 'done', costUsd: 0 }),
  ] });
  const d = decorFromState(st);
  assert.equal(d.footers.n_end.rows[0].cost, '', 'flow row has no cost');
  assert.equal(d.footers.n_end.rows[0].flow, true);
  assert.equal(d.footers.n_impl.rows[0].cost, '$0.00', 'an agent that ran shows $0.00');
});

test('the collapsed summary reads "N runs · $X" and drops the cost when it is zero', () => {
  const paid = S({ steps: [impl(1, { costUsd: 0.6 }), impl(2, { costUsd: 0.52 })] });
  assert.equal(decorFromState(paid).footers.n_impl.summary, '2 runs · $1.12');
  const free = S({ steps: [impl(1, { costUsd: 0 })] });
  assert.equal(decorFromState(free).footers.n_impl.summary, '1 run');
});

test('header totals sum the node\'s rows', () => {
  const st = S({ steps: [impl(1, { activeMs: 63000, costUsd: 0.1 }), impl(2, { activeMs: 67000, costUsd: 0.32 })] });
  assert.deepEqual(decorFromState(st).totals.n_impl, { durMs: 130000, dur: '2m 10s', costUsd: 0.42, cost: '$0.42', hasStep: true });
});

test('the sub-agent fan rides the footer when subsOf supplies rows', () => {
  const st = S({ steps: [impl(1, {})] });
  const d = decorFromState(st, { subsOf: (id) => (id === 'n_impl' ? [{ status: 'running' }, { status: 'finished' }] : []) });
  assert.deepEqual(d.footers.n_impl.fan, { leds: ['run', 'done'], count: 2 });
  assert.equal(d.footers.n_plan, undefined, 'no rows and no subs → no footer at all');
});

test('ants light the trigger wires of ACTIVE executions and nothing on a resolved run', () => {
  const live = S({ steps: [impl(2, { status: 'start', trigger: { wireIds: ['w3'], freshPorts: ['fix'] } })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }] });
  assert.deepEqual(decorFromState(live).liveWireIds, ['w3']);
  assert.deepEqual(decorFromState({ ...live, status: 'done' }).liveWireIds, [], 'resolved runs never march');
  assert.deepEqual(decorFromState(live, { live: false }).liveWireIds, []);
});

test('loop badges come from wireDeliveries, on loop wires only', () => {
  const st = S({ wireDeliveries: { w1: 3, w3: 2 } });
  const badges = decorFromState(st).loopBadges;
  assert.deepEqual(Object.keys(badges), ['w3'], 'w1 is not a loop wire');
  assert.deepEqual(badges.w3, { n: 2, max: 3, text: '2×', title: '2 of 3 cycles' });
});

test('the gate pip lands on the wire\'s FROM node', () => {
  const st = S({ gate: { wireId: 'w3', fromNode: 'n_plan', toNode: 'n_impl', askId: 'gate-w3-3' } });
  assert.deepEqual(decorFromState(st).gate, { nodeId: 'n_plan', wireId: 'w3', askId: 'gate-w3-3' });
  assert.equal(decorFromState(S()).gate, null);
});
```

- [ ] Step 2: `node --test test/ui-run-decor.test.mjs`
  `Expected: # fail 9` — every new test throws `TypeError: Cannot read properties of undefined (reading 'rows')` / deep-equal mismatches against the empty `footers/{}`, `liveWireIds: []`, `loopBadges: {}`, `gate: null` the stub leaves.

- [ ] Step 3: Implement — in `ui/public/graph/run-decor.mjs`, replace `function decorateExecutions() {}` with:

```js
/** `cycle 2 · fix` (loop-port re-fire) / `cycle 2` / the task title for slices. */
export function rowLabel(node, row) {
  if (row.kind === 'task') {
    const t = String(row.title || '').trim();
    return truncate(t || `cycle ${row.ordinal}`);
  }
  const base = `cycle ${row.ordinal}`;
  const loopIns = new Set(((node && node.ports && node.ports.inputs) || []).filter((p) => p && p.loop).map((p) => p.id));
  const port = ((row.trigger && row.trigger.freshPorts) || []).find((p) => loopIns.has(p));
  return port ? `${base} · ${port}` : base;
}

function truncate(s) {
  return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;
}

/** `3 runs · $1.12`; the cost half is dropped when the total is zero. */
export function stripText(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const total = list.reduce((a, r) => a + (Number(r.costUsd) || 0), 0);
  const runs = `${list.length} ${list.length === 1 ? 'run' : 'runs'}`;
  return total > 0 ? `${runs} · ${fmtUsd(total)}` : runs;
}

/** The status the 7px leds / row classes use ('start' is the wire's word for active). */
const ledOf = (status) => (status === 'start' ? 'active' : (status || 'pending'));

function decorateExecutions(decor, ctx) {
  const { stepper, nodes, wires, grouped, activeList, stepByExec, state, now, live, subsOf } = ctx;

  for (const node of nodes) {
    const list = grouped.get(node.id) || [];
    const flow = node.kind !== 'agent';
    const rows = list.map((row) => {
      const durMs = rowMs(row, now, live);
      const costUsd = flow ? 0 : (Number(row.costUsd) || 0);
      return {
        executionId: row.executionId, nodeId: node.id,
        kind: row.kind === 'task' ? 'task' : 'cycle',
        ordinal: Number(row.ordinal ?? row.cycle) || 1,
        label: rowLabel(node, row), led: ledOf(row.status),
        dur: row.activeMs != null ? fmtDur(durMs) : '',
        cost: flow ? '' : fmtUsd(costUsd),
        durMs, costUsd, flow,
      };
    });

    const subs = typeof subsOf === 'function' ? (subsOf(node.id) || []) : [];
    const fan = subs.length
      ? { leds: subs.slice(0, SUB_SQUARE_CAP).map((s) => (s && s.status === 'running' ? 'run' : 'done')), count: subs.length }
      : null;

    if (rows.length || fan) {
      decor.footers[node.id] = { rows, summary: stripText(rows), leds: rows.map((r) => r.led), fan };
    }
    if (rows.length) {
      decor.totals[node.id] = {
        durMs: rows.reduce((a, r) => a + r.durMs, 0),
        dur: fmtDur(rows.reduce((a, r) => a + r.durMs, 0)),
        costUsd: rows.reduce((a, r) => a + r.costUsd, 0),
        cost: flow ? '' : fmtUsd(rows.reduce((a, r) => a + r.costUsd, 0)),
        hasStep: rows.some((r) => r.dur !== ''),
      };
    }
  }

  // Ants: the trigger wires of the IN-FLIGHT executions. A resolved run marches
  // nothing — a drain publish after End routes nowhere.
  if (live && !decor.resolved) {
    const ants = new Set();
    for (const a of activeList) {
      const row = stepByExec.get(a.executionId);
      for (const id of (row && row.trigger && row.trigger.wireIds) || []) ants.add(id);
    }
    decor.liveWireIds = [...ants];
  }

  // Loop badges from the scheduler's own delivery counters (authoritative).
  const deliveries = state.wireDeliveries && typeof state.wireDeliveries === 'object' ? state.wireDeliveries : {};
  for (const w of wires) {
    if (!w.loop) continue;
    const n = Number(deliveries[w.id]) || 0;
    if (n < 1) continue;
    const max = Number(w.maxCycles) || 3;
    decor.loopBadges[w.id] = { n, max, text: `${n}×`, title: `${n} of ${max} cycles` };
  }

  // Gate pip: the gate holds at the SOURCE's publish.
  const g = state.gate && typeof state.gate === 'object' ? state.gate : null;
  if (g && g.wireId) {
    const wire = wires.find((w) => w.id === g.wireId) || null;
    const nodeId = g.fromNode || (wire && wire.from && wire.from.node) || null;
    if (nodeId) decor.gate = { nodeId, wireId: g.wireId, askId: g.askId || null };
  }
}
```

- [ ] Step 4: `node --test test/ui-run-decor.test.mjs`
  `Expected: # pass 20 / # fail 0`.
- [ ] Step 5: **Mutation audit** — verify each guard is load-bearing, then restore:
  - delete `if (!list.length) return ctx.runStatus === 'done' ? …` → the skipped/pending tests fail;
  - swap `if (list.some((r) => r.status === 'error'))` below the `active` check → the error test fails;
  - drop `if (live && !decor.resolved)` → "resolved runs never march" fails;
  - drop `if (!w.loop) continue` → the loop-badge key test fails.
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — run-decor executions footer, ants, loop badges, gate`

### Task 3: view fast paths for run decor (`setFooter` band vocabulary, `setNodeChrome`, `setWireBadge`)

**Files:** modify `ui/public/style.css` (append a new block after the v1 run-flow block that ends at `style.css:1373`); create `test/ui-run-hosts.test.mjs`. `ui/public/graph/view.mjs` is NOT modified: P5a Task 2 ships `setFooter(nodeId, bands)`, `setNodeChrome` and `setWireBadge` with exactly the vocabulary below (cross-plan pass 2026-08-27) — the three view tests in this task are consumer-side PINS of that contract.

**Interfaces consumed (P5a Task 2 — the composer never calls them, so `edit` mode is untouched):**
```js
// view.setFooter(nodeId, bands)  — bands = [] | null clears the footer.
// A BAND is one visible 22–26px strip; the card's height is nodeSize(node, ports,
// { footerRows: bands.length }) — 26px for the first, 22px for each extra, which
// is exactly §7.4's  footer = rows ? FOOT_H + (rows-1)*EXEC_ROW_H : 0.
//   { kind:'fan',    leds:('run'|'done')[], count:number }
//   { kind:'strip',  leds:NodeStatus[], summary:string, expanded:boolean }
//   { kind:'exec',   executionId, led:NodeStatus, label:string, right:string }
//   { kind:'result', text:string, path:string|null }
// view.setNodeChrome(nodeId, { color, gate, totals })
//   color  : '' | palette token  -> card.style --c
//   gate   : null | { wireId, title }              -> the amber "?" pip
//   totals : null | { dur, cost }                  -> the header .nrun figures
// view.setWireBadge(wireId, badge)  badge = null | { text, title }
```

- [ ] Step 1: Write the failing test — create `test/ui-run-hosts.test.mjs`

```js
// test/ui-run-hosts.test.mjs
// P6a — the DOM half of the run monitor: the view's decor fast paths, applyDecor,
// the three host adapters and the End-result artifact route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createGraphView } from '../ui/public/graph/view.mjs';
import { manifestPortsFn, manifestTemplate } from '../src/shared/graph/manifest.mjs';

const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');
const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: {
    nodes: [
      { id: 'n_a', kind: 'agent', key: 'planner', x: 0, y: 0, label: 'Planner', color: 'violet',
        ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'plan', type: 'md', when: 'always' }], await: true } },
      { id: 'n_end', kind: 'end', key: null, x: 400, y: 0, label: 'End', color: '',
        ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } },
    ],
    wires: [{ id: 'w1', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' }, loop: true, maxCycles: 3 }],
  },
};

function mountView(mode = 'monitor') {
  const dom = new JSDOM('<!doctype html><div id="h" style="width:800px;height:400px"></div>');
  const { window } = dom;
  const host = window.document.getElementById('h');
  const view = createGraphView(host, {
    mode, doc: window.document, portsFn: manifestPortsFn(MANIFEST), agents: {},
    raf: (fn) => { fn(); return 1; },
    viewport: { left: 0, top: 0, width: 800, height: 400 },
  });
  view.render(manifestTemplate(MANIFEST), {});
  return { window, host, view };
}

test('setFooter builds one band per row and sizes the card from the band count', () => {
  const { view, host } = mountView();
  const card = () => host.querySelector('[data-node-id="n_a"]');
  const h0 = parseFloat(card().style.height);
  view.setFooter('n_a', [{ kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: false }]);
  assert.equal(card().querySelectorAll('.xfoot .xtoggle').length, 1);
  assert.equal(card().querySelector('.xsum').textContent, '2 runs · $1.12');
  assert.equal(card().querySelectorAll('.xsq .xq').length, 2);
  const h1 = parseFloat(card().style.height);
  assert.equal(h1, h0 + 26, 'one band = FOOT_H');
  view.setFooter('n_a', [
    { kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: true },
    { kind: 'exec', executionId: 'x:n_a:1', led: 'done', label: 'cycle 1', right: '1m 3s · $0.12' },
    { kind: 'exec', executionId: 'x:n_a:2', led: 'active', label: 'cycle 2 · fix', right: '4s' },
  ]);
  assert.equal(parseFloat(card().style.height), h0 + 26 + 22 + 22, 'extra bands are EXEC_ROW_H');
  const rows = [...card().querySelectorAll('.xrow')];
  assert.deepEqual(rows.map((r) => r.dataset.executionId), ['x:n_a:1', 'x:n_a:2']);
  assert.equal(rows[1].className, 'xrow is-active');
  view.setFooter('n_a', []);
  assert.equal(card().querySelector('.xfoot'), null, 'clearing removes the footer');
  assert.equal(parseFloat(card().style.height), h0, 'and restores the card height');
});

test('setNodeChrome paints --c, the gate pip and the header totals; nulls clear them', () => {
  const { view, host } = mountView();
  const card = host.querySelector('[data-node-id="n_a"]');
  view.setNodeChrome('n_a', { color: 'violet', gate: { wireId: 'w1', title: 'waiting on a loop gate' }, totals: { dur: '2m 10s', cost: '$0.42' } });
  assert.equal(card.style.getPropertyValue('--c'), 'var(--violet)');
  assert.equal(card.querySelector('.ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector('.nrun .dur').textContent, '2m 10s');
  assert.equal(card.querySelector('.nrun .cost').textContent, '$0.42');
  assert.equal(card.classList.contains('run-node'), true, 'the 1s tick hook selects .run-node[data-id] .dur');
  assert.equal(card.dataset.id, 'n_a');
  view.setNodeChrome('n_a', { color: '', gate: null, totals: null });
  assert.equal(card.querySelector('.ngate'), null);
  assert.equal(card.querySelector('.nrun'), null);
});

test('setWireBadge writes an amber cycle badge and clears it', () => {
  const { view, host } = mountView();
  view.setWireBadge('w1', { text: '2×', title: '2 of 3 cycles' });
  const badge = host.querySelector('.wbadge[data-wire-id="w1"] .wfired');
  assert.equal(badge.textContent, '2×');
  assert.equal(badge.title, '2 of 3 cycles');
  view.setWireBadge('w1', null);
  assert.equal(host.querySelector('.wfired'), null);
});

test('the run-decor CSS block exists and never re-declares a shared keyframe', () => {
  for (const sel of ['.run-flow .node.is-error', '.run-flow .node.is-skipped', '.run-flow .ngate', '.run-flow .xfoot', '.run-flow .xrow', '.run-flow .xresult']) {
    assert.ok(css.includes(sel), `${sel} must be styled`);
  }
  for (const kf of ['@keyframes wireFlow', '@keyframes sqPulse', '@keyframes nodeGlow{']) {
    assert.equal(css.split(kf).length - 1, 1, `${kf} must be declared exactly once`);
  }
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs`
  `Expected: TypeError: view.setNodeChrome is not a function` (and the `.xfoot` assertions fail — `setFooter` does not yet speak bands).

- [ ] Step 3: Verify P5 shipped the three fast paths — `grep -n "setFooter(nodeId, bands)\|setNodeChrome(nodeId\|setWireBadge(wireId" ui/public/graph/view.mjs` prints three lines. If any is missing, STOP: P5a Task 2 owns them (its `test/ui-graph-view.test.mjs` pins them) — never re-implement or replace a view function body from this plan. **The code block below is P5's implementation, kept here for REFERENCE only (do not apply it):**

```js
  // ── run-decor fast paths (monitor/static modes; the composer never calls them) ──
  const FOOT_H = 26, EXEC_ROW_H = 22;
  const svgChevron = () => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'chev'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.innerHTML = '<path d="M6 9l6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    return s;
  };
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function bandEl(nodeId, band) {
    if (band.kind === 'fan') {
      const fan = mk('div', 'fan');
      for (const led of band.leds || []) fan.appendChild(mk('i', `sq${led === 'run' ? ' on' : ''}`));
      fan.appendChild(mk('span', 'fl', `×${band.count}`));
      return fan;
    }
    if (band.kind === 'strip') {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'xtoggle'; btn.dataset.nodeId = nodeId;
      btn.setAttribute('aria-expanded', band.expanded ? 'true' : 'false');
      const sq = mk('span', 'xsq');
      for (const led of band.leds || []) sq.appendChild(mk('i', `xq is-${led}`));
      btn.append(sq, mk('span', 'xsum', band.summary || ''), svgChevron());
      return btn;
    }
    if (band.kind === 'exec') {
      const row = mk('div', `xrow is-${band.led || 'pending'}`);
      row.dataset.executionId = band.executionId || '';
      row.dataset.nodeId = nodeId;
      row.append(mk('i', 'led'), mk('span', 'xl', band.label || ''), mk('span', 'xr', band.right || ''));
      return row;
    }
    const res = mk('div', 'xresult');           // kind: 'result'
    if (!band.path) { res.textContent = band.text || ''; return res; }
    const a = mk('a', null, band.text || '');
    a.href = '#'; a.dataset.path = band.path; a.title = band.path;
    res.appendChild(a);
    return res;
  }

  /** Replace a card's footer with `bands` and RE-SIZE the card from the band count. */
  function setFooter(nodeId, bands) {
    const card = nodeEls.get(nodeId);
    if (!card) return;
    const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
    for (const stale of card.querySelectorAll(':scope > .xfoot')) stale.remove();
    if (list.length) {
      const foot = mk('div', 'xfoot');
      foot.dataset.nodeId = nodeId;
      for (const band of list) foot.appendChild(bandEl(nodeId, band));
      card.appendChild(foot);
    }
    // The ONE place a run-mode card height is written. run-decor never sets one.
    const node = nodeOf(nodeId);
    if (node) card.style.height = `${nodeSize(node, portsOfNode(node), { footerRows: list.length }).h}px`;
  }

  /** Per-card ornaments: agent colour, gate pip, header duration · cost. */
  function setNodeChrome(nodeId, { color = '', gate = null, totals = null } = {}) {
    const card = nodeEls.get(nodeId);
    if (!card) return;
    card.style.setProperty('--c', color ? `var(--${color})` : '');
    // Keep the 1 s elapsed tick (app.js `.run-node[data-id] .dur`) working on v2 cards.
    card.classList.add('run-node');
    card.dataset.id = nodeId;
    for (const stale of card.querySelectorAll(':scope > .ngate')) stale.remove();
    if (gate) {
      const pip = mk('div', 'ngate', '?');
      pip.dataset.wireId = gate.wireId || '';
      pip.title = gate.title || '';
      card.appendChild(pip);
    }
    let run = card.querySelector(':scope > .nrun');
    if (!totals) { if (run) run.remove(); return; }
    if (!run) { run = mk('div', 'nrun'); run.append(mk('span', 'dur'), mk('span', 'cost')); card.appendChild(run); }
    run.querySelector('.dur').textContent = totals.dur || '';
    run.querySelector('.cost').textContent = totals.cost || '';
  }

  /** The amber `N×` delivery badge on a loop wire's bow. */
  function setWireBadge(wireId, badge) {
    const host = badgeEls.get(wireId);
    if (!host) return;
    for (const stale of host.querySelectorAll('.wfired')) stale.remove();
    if (!badge) return;
    const el = mk('span', 'wfired', badge.text || '');
    if (badge.title) el.title = badge.title;
    host.appendChild(el);
  }
```
> (Reference block ends. In P5's view the lookups are `ctx.byId.get(nodeId)` / `portsAt(node)` / `sizeOf(node)` and the height write goes through the view's own `footers` map — see P5 Task 2.)

- [ ] Step 4: Implement the CSS — append this block to `ui/public/style.css` immediately after the v1 run-flow block (the `@keyframes wireFlow` line at `style.css:1373`). It **extends** `style.css:1258-1381`: `.nstat`, `nodeGlow`, `nodeGlowAmber`, `wireFlow` and `sqPulse` are REUSED, never re-declared, and dev's `.is-pending/.is-active/.is-paused/.is-stopped` rules already cover four of the seven states. Every card rule is scoped `.run-flow .gv-world` so the v1 column renderer in the same host class is untouched.

```css
/* ===== Run monitor v2 — decor over the shared graph renderer (P6) ========== */
/* The v2 renderer fills the host absolutely; the v1 flex column layout above
   never sees these rules (they are all scoped to .gv-world). */
.run-flow > .gv-world,.run-flow .gv-world{position:absolute;left:0;top:0;transform-origin:0 0;}
.rc-detailed .run-flow-wrap{height:300px;}          /* additive: D5's static card graph */
.rd-graph .run-flow-wrap,.hd-graph .run-flow-wrap{height:var(--gv-host-h,360px);}
/* Two states the v1 block has no vocabulary for. */
.run-flow .gv-world .node.is-error{border-color:var(--red);box-shadow:0 0 0 3px color-mix(in srgb, var(--red) 18%, transparent),var(--shadow-soft);}
.run-flow .gv-world .node.is-skipped{opacity:.35;border-style:dashed;}
/* Gate pip — amber "?" while a loop gate holds on this node's publish. */
.run-flow .gv-world .ngate{position:absolute;top:-8px;right:-8px;width:21px;height:21px;border-radius:50%;display:grid;place-items:center;background:var(--amber);color:#fff;font-weight:800;font-size:12px;cursor:pointer;box-shadow:var(--shadow-soft);z-index:4;animation:dotpulse 1.3s ease-in-out infinite;}
/* Header duration · cost, on the card's coloured head. */
.run-flow .gv-world .node .nrun{position:absolute;right:11px;top:9px;display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;font-weight:600;color:#fff;opacity:.85;z-index:3;}
.run-flow .gv-world .node .nrun .dur:empty,.run-flow .gv-world .node .nrun .cost:empty{display:none;}
.run-flow .gv-world .node .nrun .cost:not(:empty)::before{content:"\00b7";margin-right:4px;}
/* Executions footer: bands stack bottom-up inside one .xfoot; 26px then 22px. */
.run-flow .gv-world .xfoot{position:absolute;left:0;right:0;bottom:0;border-top:1px solid var(--line);background:#FCFCFB;border-radius:0 0 14px 14px;overflow:hidden;}
.run-flow .gv-world .xtoggle{display:flex;align-items:center;gap:7px;width:100%;height:26px;padding:0 11px;background:none;border:none;font-family:inherit;font-size:10.5px;font-weight:600;color:var(--ink-3);cursor:pointer;}
.run-flow .gv-world .xtoggle:hover{background:var(--field);}
.run-flow .gv-world .xsq{display:flex;align-items:center;gap:3px;flex:0 0 auto;}
.run-flow .gv-world .xsq .xq{width:7px;height:7px;border-radius:2px;background:var(--ink-3);opacity:.5;}
.run-flow .gv-world .xsq .xq.is-done{background:var(--green);opacity:1;}
.run-flow .gv-world .xsq .xq.is-error,.run-flow .gv-world .xsq .xq.is-stopped{background:var(--red);opacity:1;}
.run-flow .gv-world .xsq .xq.is-paused{background:var(--amber);opacity:1;}
.run-flow .gv-world .xsq .xq.is-active{background:var(--blue);opacity:1;animation:sqPulse 1.5s ease-in-out infinite;}
.run-flow .gv-world .xsum{flex:1 1 auto;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.run-flow .gv-world .xtoggle .chev{width:12px;height:12px;flex:0 0 auto;transition:transform .2s;}
.run-flow .gv-world .xtoggle[aria-expanded="true"] .chev{transform:rotate(180deg);}
.run-flow .gv-world .xrow{display:flex;align-items:center;gap:7px;height:22px;padding:0 11px;font-size:10.5px;font-weight:600;color:var(--ink-2);cursor:pointer;}
.run-flow .gv-world .xrow:hover{background:var(--field);}
.run-flow .gv-world .xrow .led{width:7px;height:7px;border-radius:2px;flex:0 0 auto;background:var(--ink-3);opacity:.55;}
.run-flow .gv-world .xrow.is-done .led{background:var(--green);opacity:1;}
.run-flow .gv-world .xrow.is-error .led,.run-flow .gv-world .xrow.is-stopped .led{background:var(--red);opacity:1;}
.run-flow .gv-world .xrow.is-paused .led{background:var(--amber);opacity:1;}
.run-flow .gv-world .xrow.is-active .led{background:var(--blue);opacity:1;animation:sqPulse 1.5s ease-in-out infinite;}
.run-flow .gv-world .xrow .xl{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.run-flow .gv-world .xrow .xr{flex:0 0 auto;font-family:var(--mono);font-size:10px;color:var(--ink-3);}
.run-flow .gv-world .fan{display:flex;align-items:center;gap:3px;height:26px;padding:0 11px;overflow:hidden;}
.run-flow .gv-world .fan + .xtoggle{border-top:1px solid var(--line);}
/* End result chip — the bound payload's basename, or the void treatment. */
.run-flow .gv-world .xresult{height:26px;display:flex;align-items:center;justify-content:center;padding:0 11px;font-size:11px;font-weight:600;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.run-flow .gv-world .xresult a{color:var(--blue-ink);text-decoration:none;}
.run-flow .gv-world .xresult a:hover{text-decoration:underline;}
/* Loop delivery badge on a loop wire's bow. */
.run-flow .gv-world .wbadge .wfired{margin-left:5px;color:var(--amber-ink);font-weight:800;}
/* Quiescence banner (amber) in .rd-banners / .hd-banners. */
.run-warn{margin:0 0 14px;padding:11px 15px;border-radius:12px;background:var(--amber-bg);color:var(--amber-ink);font-size:12.5px;font-weight:600;border:1px solid color-mix(in srgb, var(--amber) 45%, transparent);}
.run-warn[hidden]{display:none;}
/* Engaged-wheel hint chip on the detail graphs. */
.rg-hint{position:absolute;right:12px;bottom:10px;padding:4px 9px;border-radius:999px;background:color-mix(in srgb, var(--ink) 72%, transparent);color:#fff;font-size:10.5px;font-weight:600;pointer-events:none;opacity:0;transition:opacity .15s;z-index:5;}
.run-flow-wrap:hover > .rg-hint{opacity:1;}
.rg-engaged .rg-hint{opacity:0;}
/* Static host (Running list card): the graph is scenery, the card owns the click. */
.rc-detailed .run-flow .gv-world{pointer-events:none;}
@media (prefers-reduced-motion: reduce){
  .run-flow .gv-world .xsq .xq.is-active,.run-flow .gv-world .xrow.is-active .led{animation:none;}
  .run-flow .gv-world .ngate{animation:none;}
}
```

- [ ] Step 5: `node --test test/ui-run-hosts.test.mjs` — `Expected: # pass 4 / # fail 0`.
- [ ] Step 6: `node --test test/ui-composer-editor.test.mjs test/ui-graph-view.test.mjs test/ui-log-filters-row.test.mjs` — `Expected: # fail 0` (the composer's `edit` mode is untouched by additive fast paths).
- [ ] Step 7: Commit — `worca: Node-graph v2 P6 — view decor fast paths + run monitor CSS`

### Task 4: `applyDecor(view, decor)` — the ONE DOM pass

**Files:** modify `ui/public/graph/run-decor.mjs`; modify `test/ui-run-hosts.test.mjs`.

**Interface produced:** `export function applyDecor(view, decor)` — idempotent and self-clearing; runs AFTER every `view.render()`. It uses ONLY the view fast paths (`setStatus`, `setNodeChrome`, `setFooter`, `setWireBadge`, `setWireLive`) and **never writes `card.style.height`** — the card grows because `setFooter` re-runs `nodeSize`. `decor.expanded` (a nodeId or null, set by the host's accordion) selects the ONE node whose execution rows are listed.

Band order inside a card's footer, top → bottom: `fan` → `strip` → `exec`×N (only when expanded) → `result`.

- [ ] Step 1: Write the failing test — append to `test/ui-run-hosts.test.mjs`

```js
import { decorFromState, applyDecor } from '../ui/public/graph/run-decor.mjs';

const RUN = (over = {}) => ({ stepper: MANIFEST, status: 'running', steps: [], active: [],
  endReached: false, result: null, warnings: [], wireDeliveries: {}, tokens: {}, gate: null, ...over });

test('applyDecor paints statuses, the collapsed strip, ants and badges; expanding one node lists its rows', () => {
  const { view, host } = mountView();
  const st = RUN({
    steps: [
      { key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle', status: 'done', activeMs: 63000, costUsd: 0.12, trigger: { wireIds: [], freshPorts: ['task'] } },
      { key: 'x:n_a:2', executionId: 'x:n_a:2', nodeId: 'n_a', ordinal: 2, kind: 'cycle', status: 'start', activeMs: 4000, costUsd: 0, trigger: { wireIds: ['w1'], freshPorts: [] } },
    ],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:2' }],
    wireDeliveries: { w1: 2 },
    gate: { wireId: 'w1', fromNode: 'n_a', toNode: 'n_end', askId: 'gate-w1-3' },
  });
  const decor = decorFromState(st);
  applyDecor(view, decor);
  const card = host.querySelector('[data-node-id="n_a"]');
  assert.ok(card.classList.contains('is-active'));
  assert.equal(host.querySelector('[data-node-id="n_end"]').classList.contains('is-pending'), true);
  assert.equal(card.querySelector('.xsum').textContent, '2 runs · $0.12');
  assert.equal(card.querySelectorAll('.xrow').length, 0, 'collapsed by default');
  assert.equal(card.querySelector('.ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector('.nrun .dur').textContent, '1m 7s');
  assert.equal(host.querySelector('.wbadge[data-wire-id="w1"] .wfired').textContent, '2×');
  assert.equal(host.querySelector('path[data-wire-id="w1"]').classList.contains('wire-live'), true);

  applyDecor(view, { ...decor, expanded: 'n_a' });
  assert.deepEqual([...card.querySelectorAll('.xrow')].map((r) => r.dataset.executionId), ['x:n_a:1', 'x:n_a:2']);
  assert.equal(card.querySelector('.xtoggle').getAttribute('aria-expanded'), 'true');
});

test('applyDecor is self-clearing: a settled repaint strands no ant, badge or pip', () => {
  const { view, host } = mountView();
  applyDecor(view, decorFromState(RUN({ wireDeliveries: { w1: 1 }, gate: { wireId: 'w1', fromNode: 'n_a' },
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'start', activeMs: 10, trigger: { wireIds: ['w1'] } }],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }] })));
  applyDecor(view, decorFromState(RUN({ status: 'done', endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' },
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 10 },
      { key: 'x:n_end:1', executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, status: 'done' }] })));
  assert.equal(host.querySelector('.ngate'), null, 'the gate pip is gone');
  assert.equal(host.querySelector('.wfired'), null, 'the badge is gone');
  assert.equal(host.querySelector('path.wire-live'), null, 'nothing marches on a resolved run');
  const endCard = host.querySelector('[data-node-id="n_end"]');
  assert.equal(endCard.querySelector('.xresult a').textContent, 'plan.md');
  assert.equal(endCard.querySelector('.xresult a').dataset.path, '/tmp/p/plan.md');
});

test('a run that finished at quiescence renders End as skipped with no result row', () => {
  const { view, host } = mountView();
  const decor = decorFromState(RUN({ status: 'done', endReached: false }));
  applyDecor(view, decor);
  assert.equal(host.querySelector('[data-node-id="n_end"]').classList.contains('is-skipped'), true);
  assert.equal(host.querySelector('.xresult'), null);
  assert.equal(decor.warnings[0], 'finished at quiescence — End not reached');
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs` — `Expected: SyntaxError` / `TypeError: applyDecor is not a function`.
- [ ] Step 3: Implement — in `ui/public/graph/run-decor.mjs` add `wireIds`/`nodeIds` to the bag and the DOM pass:
  - in `decorFromState`, extend the returned object literal with `nodeIds: nodes.map((n) => n.id), wireIds: wires.map((w) => w.id), expanded: null,`
  - append:

```js
/**
 * Lay the decor over an already-rendered view. Idempotent and self-clearing:
 * every ornament is rebuilt from the bag, so a repaint after the run settles
 * cannot strand an ant, a badge or a gate pip. NEVER writes a card height —
 * `view.setFooter` re-runs `nodeSize` for the band count it was handed.
 */
export function applyDecor(view, decor) {
  if (!view || !decor) return;
  const expanded = decor.expanded || null;
  for (const nodeId of decor.nodeIds || []) {
    view.setStatus(nodeId, decor.status[nodeId] || 'pending');
    view.setNodeChrome(nodeId, {
      color: decor.colors[nodeId] || '',
      gate: decor.gate && decor.gate.nodeId === nodeId
        ? { wireId: decor.gate.wireId, title: 'waiting on a loop gate — open the question panel' } : null,
      totals: decor.totals[nodeId] || null,
    });
    const foot = decor.footers[nodeId] || null;
    const bands = [];
    if (foot && foot.fan) bands.push({ kind: 'fan', leds: foot.fan.leds, count: foot.fan.count });
    if (foot && foot.rows.length) {
      bands.push({ kind: 'strip', leds: foot.leds, summary: foot.summary, expanded: expanded === nodeId });
      if (expanded === nodeId) {
        for (const r of foot.rows) {
          bands.push({ kind: 'exec', executionId: r.executionId, led: r.led, label: r.label,
            right: [r.dur, r.cost].filter(Boolean).join(' · ') });
        }
      }
    }
    if (decor.endResult && decor.endResult.nodeId === nodeId) {
      bands.push({ kind: 'result', text: decor.endResult.text, path: decor.endResult.path });
    }
    view.setFooter(nodeId, bands);
  }
  for (const wireId of decor.wireIds || []) view.setWireBadge(wireId, decor.loopBadges[wireId] || null);
  view.setWireLive(decor.liveWireIds || []);
}
```

- [ ] Step 4: `node --test test/ui-run-decor.test.mjs test/ui-run-hosts.test.mjs` — `Expected: # fail 0` (20 + 7).
- [ ] Step 5: Commit — `worca: Node-graph v2 P6 — applyDecor, the one DOM pass`

### Task 5: host adapters — `ui/public/graph/run-hosts.mjs`

**Files:** create `ui/public/graph/run-hosts.mjs`; modify `test/ui-run-hosts.test.mjs`.

**Interface produced:**
```js
export function mountRunGraph(hostEl, {
  mode,                       // 'static' (Running list card) | 'monitor' (detail pages)
  doc, raf, viewport,         // injectables for jsdom
  onRowClick,                 // (executionId, nodeId) — footer row → log filter (P6b completes the axis)
  onGateClick,                // (wireId) → scroll/focus the question panel
  onResultClick,              // (path) → showViewer via the artifact route
}) → { update(runId, stepper, decor), fit(), destroy(), view }
export const STATIC_HOST_H = 300;      // D5 lock: the list card's graph is 300px tall
export const DETAIL_MIN_H = 360, DETAIL_MAX_H = 600, DETAIL_PAD_H = 48;
export const HINT_TEXT = 'click to pan · ⌘+scroll to zoom';
```
**Rules:**
- `static` (host A): `createGraphView(host, {mode:'static', zoomMin:0.3, zoomMax:1.0})`; NO listeners; fit BOTH axes into `(wrapWidth − 32, 300 − 32)`; the wrap keeps `overflow-x:auto` so a wider graph scrolls natively (no wheel capture); re-fit on `ResizeObserver` when the environment has one (jsdom does not — **guard**). The world is `pointer-events:none` (CSS, Task 3) so the card's own click → `location.hash = running/<id>` passes through.
- `monitor` (hosts B and C): `createGraphView(host, {mode:'monitor', zoomMin:0.3, zoomMax:1.6, wheelPan:'engaged'})`. Two-pass sizing (the fit zoom depends on the height and the height on the zoom, so WIDTH decides the zoom first): `z = clamp(min(vw/bw, 1), 0.3, 1.6)` → `hostH = clamp(360, bounds.h·z + 48, 600)` → write `--gv-host-h` on the wrap → fit both axes into `(vw, hostH)`.
- Wheel policy (D8, engaged-only) — the flag `wheelPan:'engaged'` is honored by `view.mjs`'s nav controller: plain wheel pans ONLY while the graph is engaged; `⌘/Ctrl+wheel` and pinch are ALWAYS captured over the graph; a plain wheel while not engaged is NOT `preventDefault`ed, so the page scrolls normally. Engage = pointerdown inside the wrap or `focusin`; disengage = Escape or a pointerdown outside. `run-hosts` owns the `rg-engaged` class + the hover hint chip; if `view.mjs` does not yet honor `wheelPan`, add it there (same policy, one `if`).
- Accordion: ONE node expanded per surface. The mount instance holds `{ runId, expanded }` and CLEARS `expanded` when `update()` is called with a different `runId` (this is the `Map<runId,nodeId>` per surface, collapsed into the surface's own instance).
- Delegated `click` on the host: `.xtoggle` → toggle `expanded` + repaint; `.xrow` → `onRowClick(executionId, nodeId)`; `.ngate` → `onGateClick(wireId)`; `.xresult a` → `preventDefault()` + `onResultClick(path)`.

- [ ] Step 1: Write the failing test — append to `test/ui-run-hosts.test.mjs`

```js
import { mountRunGraph, STATIC_HOST_H, HINT_TEXT } from '../ui/public/graph/run-hosts.mjs';

function mountHost(mode, w = 800) {
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const { window } = dom;
  const wrap = window.document.querySelector('.run-flow-wrap');
  const host = window.document.querySelector('.run-flow');
  const m = mountRunGraph(host, { mode, doc: window.document, raf: (fn) => { fn(); return 1; },
    viewport: { left: 0, top: 0, width: w, height: mode === 'static' ? STATIC_HOST_H : 520 },
    onRowClick: (...a) => calls.push(['row', ...a]),
    onGateClick: (...a) => calls.push(['gate', ...a]),
    onResultClick: (...a) => calls.push(['result', ...a]) });
  return { window, wrap, host, m };
}
let calls = [];

// The world's inline transform is the ONE observable the view is guaranteed to
// write (`translate(x, y) scale(z)`); read it rather than assuming a getter.
const zoomOf = (world) => Number(/scale\(([-\d.]+)\)/.exec(world.style.transform || '')?.[1] ?? NaN);

test('the static host fits inside (width-32, 300-32), never magnifies past 1x and binds no listeners', () => {
  calls = [];
  const { m, host, window } = mountHost('static');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  const world = host.querySelector('.gv-world');
  assert.ok(world, 'the world is rendered');
  const z = zoomOf(world);
  assert.ok(z > 0.3 && z <= 1, `zoom ${z} clamps to (0.3, 1]`);
  const before = world.style.transform;
  // No pointer handlers: a pointerdown must not move the transform.
  host.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true }));
  assert.equal(world.style.transform, before, 'static mode never reacts to pointers');
});

test('the detail host sizes itself clamp(360, fitted + 48, 600) and shows the hint chip', () => {
  calls = [];
  const { m, wrap } = mountHost('monitor');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  const h = parseFloat(wrap.style.getPropertyValue('--gv-host-h'));
  assert.ok(h >= 360 && h <= 600, `host height ${h} is clamped`);
  assert.equal(wrap.querySelector('.rg-hint').textContent, HINT_TEXT);
  assert.equal(wrap.classList.contains('rg-engaged'), false);
});

test('engagement: pointerdown inside engages, Escape and an outside pointerdown disengage', () => {
  const { m, wrap, window } = mountHost('monitor');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  wrap.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true }));
  assert.equal(wrap.classList.contains('rg-engaged'), true);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(wrap.classList.contains('rg-engaged'), false);
  wrap.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 2, button: 0, bubbles: true }));
  window.document.body.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 3, button: 0, bubbles: true }));
  assert.equal(wrap.classList.contains('rg-engaged'), false, 'an outside pointerdown disengages');
});

test('the footer accordion opens ONE node, and row / gate / result clicks report out', () => {
  calls = [];
  const { m, host, window } = mountHost('monitor');
  const st = RUN({ steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }],
    status: 'done', endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' },
    gate: null });
  m.update('run1', MANIFEST, decorFromState(st));
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 1, 'expanded');
  host.querySelector('.xrow').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  host.querySelector('.xresult a').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [['row', 'x:n_a:1', 'n_a'], ['result', '/tmp/p/plan.md']]);
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 0, 'a second click collapses');
  m.update('run2', MANIFEST, decorFromState(st));
  assert.equal(host.querySelectorAll('.xrow').length, 0, 'a different run resets the accordion');
  m.destroy();
  assert.equal(host.querySelector('.gv-world'), null, 'destroy tears the view down');
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs` — `Expected: Cannot find module '.../ui/public/graph/run-hosts.mjs'`.

- [ ] Step 3: Implement — create `ui/public/graph/run-hosts.mjs`

```js
// ui/public/graph/run-hosts.mjs   (depth 3 below the repo root)
//
// The three run-graph HOSTS. One renderer (view.mjs) + one decor pass
// (run-decor.mjs) mounted with per-host mode, zoom clamp, wheel policy and
// sizing. Nothing here knows about the app's run model — app.js hands it a
// manifest + a decor bag and gets clicks back.
import { createGraphView } from './view.mjs';
import { applyDecor, manifestNodes, manifestPortsFn, manifestTemplate } from './run-decor.mjs';
import { graphBounds, fitBounds } from '../../../src/shared/graph/geometry.mjs';

export const STATIC_HOST_H = 300;      // D5: the Running list card's graph height
export const STATIC_INSET = 32;        // wrap padding allowance on both axes
export const DETAIL_MIN_H = 360, DETAIL_MAX_H = 600, DETAIL_PAD_H = 48;
export const HINT_TEXT = 'click to pan · ⌘+scroll to zoom';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** World bounds of the manifest incl. whatever footers the decor adds — the
 *  SHARED geometry (`graphBounds`) over the manifest's template, with this
 *  host's footer rows supplied through `footerRowsOf(node)`. */
export function worldBounds(stepper, portsFn, footerRowsOf, pad = 0) {
  return graphBounds(manifestTemplate(stepper), portsFn, { pad, footerRowsOf: (n) => footerRowsOf(n.id) })
    || { x: 0, y: 0, w: 0, h: 0 };
}

/** Centre `b` (already padded) in a vw×vh viewport through the SHARED `fitBounds`;
 *  fit NEVER magnifies past 1× (spec §7.6). Returns the view's `{x, y, z}`. */
export function fitInto(b, vw, vh, { zoomMin = 0.3 } = {}) {
  const f = fitBounds(b, { width: vw, height: vh }, { zoomMin, zoomMax: 1 });
  return { x: f.tx, y: f.ty, z: f.z };
}

export function mountRunGraph(hostEl, opts = {}) {
  const { mode = 'monitor', doc = hostEl.ownerDocument, raf, viewport,
    onRowClick = null, onGateClick = null, onResultClick = null } = opts;
  const wrap = hostEl.closest('.run-flow-wrap') || hostEl.parentElement || hostEl;
  const isStatic = mode === 'static';
  const zoomMin = 0.3, zoomMax = isStatic ? 1.0 : 1.6;

  let view = null, stepper = null, decor = null, runId = null, expanded = null, ro = null;
  const listeners = [];
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); };

  const rect = () => viewport || wrap.getBoundingClientRect();
  const footerRowsOf = (nodeId) => {
    if (!decor) return 0;
    const f = decor.footers[nodeId];
    const bands = (f && f.fan ? 1 : 0) + (f && f.rows.length ? (expanded === nodeId ? f.rows.length + 1 : 1) : 0)
      + (decor.endResult && decor.endResult.nodeId === nodeId ? 1 : 0);
    return bands;
  };

  function fit() {
    if (!view || !stepper) return;
    const portsFn = manifestPortsFn(stepper);
    const r = rect();
    if (isStatic) {
      const b = worldBounds(stepper, portsFn, footerRowsOf, 16);
      view.setTransform(fitInto(b, Math.max(0, r.width - STATIC_INSET), STATIC_HOST_H - STATIC_INSET, { zoomMin }));
      return;
    }
    // Two-pass: the WIDTH decides the zoom, the zoom decides the host height.
    const b = worldBounds(stepper, portsFn, footerRowsOf, 24);
    const vw = Math.max(0, r.width);
    const zw = clamp(Math.min(vw / b.w, 1), zoomMin, 1);
    const hostH = clamp(Math.round((b.h - 48) * zw + DETAIL_PAD_H), DETAIL_MIN_H, DETAIL_MAX_H);   // b is padded 24 each side
    wrap.style.setProperty('--gv-host-h', `${hostH}px`);
    view.setTransform(fitInto(b, vw, hostH, { zoomMin }));
  }

  function paint() {
    if (!view || !stepper || !decor) return;
    view.render(manifestTemplate(stepper), {});
    applyDecor(view, { ...decor, expanded });
  }

  function update(nextRunId, nextStepper, nextDecor) {
    if (nextRunId !== runId) { runId = nextRunId; expanded = null; }   // one node open per surface
    const structural = !view || nextStepper !== stepper;
    stepper = nextStepper; decor = nextDecor;
    if (!view) {
      view = createGraphView(hostEl, { mode, doc, raf, viewport,
        portsFn: manifestPortsFn(stepper), agents: {}, zoomMin, zoomMax,
        wheelPan: isStatic ? 'always' : 'engaged' });
      // The view never auto-binds a nav: monitor hosts ask for one (D8 engaged-only)
      // and learn engagement from it — run-hosts keeps NO engagement state of its own.
      if (!isStatic) nav = view.createNav({ wheelPan: 'engaged', onEngaged: (on) => wrap.classList.toggle('rg-engaged', on) });
      bind();
    }
    paint();
    if (structural) fit();
  }

  function bind() {
    if (isStatic) {
      if (typeof globalThis.ResizeObserver === 'function') {   // jsdom has none — guard
        ro = new globalThis.ResizeObserver(() => fit());
        ro.observe(wrap);
      }
      return;
    }
    const hint = doc.createElement('div');
    hint.className = 'rg-hint';
    hint.textContent = HINT_TEXT;
    wrap.appendChild(hint);
    // (engage/disengage listeners live in the view's nav — see createGraphView above)
    on(hostEl, 'click', (e) => {
      const toggle = e.target.closest && e.target.closest('.xtoggle');
      if (toggle) { expanded = expanded === toggle.dataset.nodeId ? null : toggle.dataset.nodeId; paint(); fit(); return; }
      const link = e.target.closest && e.target.closest('.xresult a');
      if (link) { e.preventDefault(); if (onResultClick) onResultClick(link.dataset.path); return; }
      const gate = e.target.closest && e.target.closest('.ngate');
      if (gate) { if (onGateClick) onGateClick(gate.dataset.wireId); return; }
      const row = e.target.closest && e.target.closest('.xrow');
      if (row && onRowClick) onRowClick(row.dataset.executionId, row.dataset.nodeId);
    });
    if (typeof globalThis.ResizeObserver === 'function') { ro = new globalThis.ResizeObserver(() => fit()); ro.observe(wrap); }
  }

  function destroy() {
    for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
    listeners.length = 0;
    if (ro) { try { ro.disconnect(); } catch { /* jsdom */ } ro = null; }
    const hint = wrap.querySelector(':scope > .rg-hint');
    if (hint) hint.remove();
    if (view) { view.destroy(); view = null; }
    hostEl.innerHTML = '';
  }

  return { update, fit, destroy, get view() { return view; } };
}
```

- [ ] Step 4: `view.mjs` is NOT edited here. P5's `createNav({wheelPan:'engaged', onEngaged})` implements the D8 policy (plain wheel only while engaged — pointerdown inside / focus; ⌘/Ctrl+wheel always; Escape / outside pointerdown disengages) and reports every change through `onEngaged`; `destroy()` must call `nav.destroy()` (declare `let nav = null;` beside `view`) before `view.destroy()`.
- [ ] Step 5: `node --test test/ui-run-hosts.test.mjs` — `Expected: # pass 11 / # fail 0`.
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — run graph host adapters (static + monitor)`

### Task 6: the End-result artifact routes

**Files:** modify `src/core/artifacts.mjs` (add `resolveIndexedArtifact`, exported); modify `ui/server.mjs` (two routes, beside `/diff` at `:2064` and its workspace twin at `:2580`); modify `test/ui-run-hosts.test.mjs`.

**Interfaces produced:**
```js
// src/core/artifacts.mjs
export async function resolveIndexedArtifact(key, id, rel) → { rel, text } | null
// GET /api/history/:key/:id/artifact?rel=<relPath|basename>   -> 200 { rel, text } | 404 { error }
// GET /api/workspaces/:id/runs/:runId/artifact?rel=…          -> the same
```
**Security posture (same as `/diff`, `ui/server.mjs:2050-2062`):** the query NEVER reaches the filesystem. `resolveIndexedArtifact` looks the run's INDEXED artifacts up (`listArtifacts(row.id)`), selects the row whose `relPath` equals `rel` **or** whose basename equals `rel`'s basename (the engine records absolute paths; the client sends `result.path` verbatim), and reads THAT stored `relPath`. Nothing matches ⇒ 404. `rel_path` is dir-relative for pipeline-local files and store-root-relative for the shared plan/review markdown, so both bases are tried, run dir first.

- [ ] Step 1: Write the failing test — append to `test/ui-run-hosts.test.mjs`

```js
// ── the End-result artifact route (server; own temp home inside the test) ────
test('GET /api/history/:key/:id/artifact serves ONLY indexed artifacts', async () => {
  const http = await import('node:http');
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'worca-p6-art-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  const { _resetForTests } = await import('../src/core/db.mjs');
  _resetForTests();
  const { recordArtifact } = await import('../src/core/artifacts.mjs');
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const proj = await mkdtemp(join(tmpdir(), 'worca-p6-proj-'));
  const { id, key, dir } = await seedPipeline(proj, { title: 'A', status: 'done' });
  await writeFile(join(dir, 'plan-review.md'), '# review\n', 'utf8');
  recordArtifact(id, 'review', 'plan-review.md');
  const { app } = await import('../ui/server.mjs');
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = await fetch(`${base}/api/history/${key}/${id}/artifact?rel=${encodeURIComponent('/abs/run/plan-review.md')}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { rel: 'plan-review.md', text: '# review\n' });
    const nope = await fetch(`${base}/api/history/${key}/${id}/artifact?rel=state.json`);
    assert.equal(nope.status, 404, 'an un-indexed file is never served');
    const trav = await fetch(`${base}/api/history/${key}/${id}/artifact?rel=${encodeURIComponent('../../../etc/passwd')}`);
    assert.equal(trav.status, 404);
  } finally {
    await new Promise((r) => srv.close(r));
    _resetForTests();
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  }
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs` — `Expected: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 404 !== 200` (the route does not exist; Express falls through).
- [ ] Step 3: Implement — in `src/core/artifacts.mjs`, beside `readRunArtifactText` (`:2003`):

```js
/**
 * Read one INDEXED artifact of a run. The caller's `rel` selects among the rows
 * the artifacts table already holds (exact rel_path, else basename); the path
 * that reaches the filesystem is ALWAYS the stored one, so no user input is ever
 * joined. Returns null when the run, the index row or the file is missing.
 */
export async function resolveIndexedArtifact(key, id, rel) {
  const want = String(rel || '');
  if (!want) return null;
  const row = lookupPipelineRow(key, id);
  if (!row) return null;
  const base = want.split('/').filter(Boolean).pop();
  const arts = await listArtifacts(row.id);
  const hit = arts.find((a) => a.relPath === want)
    || arts.find((a) => a.relPath.split('/').filter(Boolean).pop() === base);
  if (!hit) return null;
  const isWs = row.target === 'workspace' || !!row.workspace_key;
  const storeRoot = isWs ? workspaceStorePath(row.workspace_key) : projectStorePath(row.project_key);
  const runDir = await runDirForRow(row);
  for (const dir of [runDir, storeRoot]) {
    try { return { rel: hit.relPath, text: await readFile(join(dir, hit.relPath), 'utf8') }; } catch { /* try the next base */ }
  }
  return null;
}
```

- [ ] Step 4: Implement — in `ui/server.mjs`, import `resolveIndexedArtifact` in the `artifacts.mjs` import block (`:25-26`) and add, right after the `/diff` route (`:2073`):

```js
// GET /api/history/:key/:id/artifact?rel= -> { rel, text } for ONE artifact the
// run indexed (the End card's result chip). `rel` never reaches the FS: it only
// selects among the pipeline's own artifacts rows. Same key regex as /diff.
app.get('/api/history/:key/:id/artifact', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const hit = await resolveIndexedArtifact(req.params.key, req.params.id, req.query.rel);
    if (!hit) return res.status(404).json({ error: 'artifact not found' });
    res.json(hit);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```
and its workspace twin after the workspace `/diff` route (`:2591`), keying `workspaces/${req.params.id}` and guarding with `WORKSPACE_KEY_RE`:
```js
app.get('/api/workspaces/:id/runs/:runId/artifact', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) return res.status(404).json({ error: 'pipeline not found' });
  try {
    const hit = await resolveIndexedArtifact(`workspaces/${req.params.id}`, req.params.runId, req.query.rel);
    if (!hit) return res.status(404).json({ error: 'artifact not found' });
    res.json(hit);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

- [ ] Step 5: `node --test test/ui-run-hosts.test.mjs test/history-api.test.mjs` — `Expected: # fail 0`.
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — End result artifact routes`

### Task 7: the ONE branch point + the four v1 label helpers' v2 arms

**Files:** modify `ui/public/app.js` (`makeRun :1239`, `onState :1685`, `runDotClass :13945`, `statusPill :13982`, `runStepLabel :14319`, `rdStateCopy :13286`, the `window.__np` export literal `:2879-2976`); modify `test/ui-run-hosts.test.mjs`.

**Interfaces produced (all on `window.__np`):** `isGraphRun(r)`, `activeNodes(r)`, `activeCopy(r)`, `runDecorFor(r, mode)`. Task 8 adds `paintGraphFor(host, stepper, decor)`, documented here because it is the plan's single branch point:

```js
// paintGraphFor(host, stepper, decor) — the ONE branch point between the v1
// column painter and the v2 graph renderer. `decor` is the bag from
// runDecorFor(r) with `run`/`runId`/`mode` shallow-added by the caller; the v1
// arm reads decor.run and ignores everything else.
```

- [ ] Step 1: Write the failing test — append to `test/ui-run-hosts.test.mjs` (jsdom boot idiom copied from `test/ui-subagent-cycle-split.test.mjs:11-26`)

```js
// ── app.js: version arms ────────────────────────────────────────────────────
async function bootApp() {
  const htmlPath2 = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
  const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
  const dom = new JSDOM(readFileSync(htmlPath2, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}

test('v2 runs take the graph arm of every label helper; v1 runs are untouched', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }],
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'start', activeMs: 10, startedAt: '2026-08-26T10:00:00Z' }],
    endReached: false, result: null, warnings: [], wireDeliveries: {}, gate: null });
  assert.equal(np.isGraphRun(r), true);
  assert.deepEqual(np.activeNodes(r).map((a) => a.nodeId), ['n_a']);
  assert.equal(np.statusPill(r).text, 'Planner');
  assert.equal(np.runDotClass(r), 'violet');
  const label = np.runStepLabel(r);
  assert.deepEqual([label.n, label.m, label.name], [0, 1, 'Planner'], 'n/m are DONE agent nodes over agent nodes');
  r.active = [{ nodeId: 'n_a', executionId: 'x:n_a:1' }, { nodeId: 'n_a2', executionId: 'x:n_a2:1' }];
  assert.equal(np.statusPill(r).text, '2 agents running');
  assert.equal(np.rdStateCopy(r, 'Planner'), '2 agents running.');
  // v1 run: the phaseKey switch still rules.
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  v1.phaseKey = 'implement';
  assert.equal(np.isGraphRun(v1), false);
  assert.equal(np.statusPill(v1).text, 'Implementing');
  assert.equal(np.runDotClass(v1), 'blue');
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs` — `Expected: TypeError: np.isGraphRun is not a function`.
- [ ] Step 3: Implement in `ui/public/app.js`:
  - **imports** (top, beside `import { logLineVisible, … } from './log-filter.mjs';` `:63`):
    ```js
    import { decorFromState, applyDecor, isGraphManifest } from './graph/run-decor.mjs';
    import { mountRunGraph } from './graph/run-hosts.mjs';
    ```
  - **`makeRun` (`:1239`)** — add to the returned literal: `active: [], endReached: undefined, result: null, warnings: [], wireDeliveries: {}, tokens: {}, gate: null,`
  - **`onState` (`:1685`)** — after the existing field copies add:
    ```js
    // v2 run-level outcome fields (ignored by v1 runs, which never send them).
    for (const k of ['active', 'endReached', 'result', 'warnings', 'wireDeliveries', 'tokens', 'gate']) {
      if (msg[k] !== undefined) r[k] = msg[k];
    }
    ```
  - **new helpers** (place them just above `runDotClass :13945`):
    ```js
    /** A v2 (graph-engine) run — the ONE predicate every branch below reads. */
    function isGraphRun(r) { return isGraphManifest(r && r.stepper); }

    /** In-flight nodes, most recently started FIRST. [] on a v1 run. */
    function activeNodes(r) {
      if (!isGraphRun(r)) return [];
      const byId = new Map((r.stepper.graph.nodes || []).map((n) => [n.id, n]));
      const startedAt = {};
      for (const s of Array.isArray(r.steps) ? r.steps : []) {
        const k = s && (s.executionId || s.key);
        if (k) startedAt[k] = Date.parse(s.startedAt || '') || 0;
      }
      return (Array.isArray(r.active) ? r.active : []).filter(Boolean)
        .map((a) => { const n = byId.get(a.nodeId); return { nodeId: a.nodeId, executionId: a.executionId || null,
          label: (n && (n.label || n.id)) || a.nodeId, color: (n && n.color) || '', model: (n && n.model) || '', effort: (n && n.effort) || '' }; })
        .sort((x, y) => (startedAt[y.executionId] || 0) - (startedAt[x.executionId] || 0));
    }

    const PILL_FAMILIES = new Set(['violet', 'blue', 'peach', 'green', 'red', 'amber']);
    /** The pill family + word for a LIVE v2 run: the newest agent, or the count. */
    function activeCopy(r) {
      const list = activeNodes(r);
      if (list.length >= 2) return { family: 'peach', text: `${list.length} agents running` };
      if (list.length === 1) return { family: PILL_FAMILIES.has(list[0].color) ? list[0].color : 'peach', text: list[0].label };
      return { family: 'peach', text: 'Running' };
    }

    /** The decor bag for a run, plus the host fields applyDecor's callers add. */
    function runDecorFor(r, mode) {
      return Object.assign(
        decorFromState(r, { live: isLive(r), now: Date.now(), subsOf: (id) => subAgentsForNode(r, id) }),
        { run: r, runId: r.runId, mode },
      );
    }
    ```
  - **`runDotClass` (`:13945`)** — before the `switch (r.phaseKey)`: `if (isGraphRun(r)) return activeCopy(r).family;`
  - **`statusPill` (`:13982`)** — before the `switch (r.phaseKey)`: `if (isGraphRun(r)) return activeCopy(r);`
  - **`runStepLabel` (`:14319`)** — at the top:
    ```js
    if (isGraphRun(r)) {
      const nodes = (r.stepper.graph.nodes || []).filter((n) => n.kind === 'agent');
      const d = runDecorFor(r);
      const a = activeNodes(r)[0] || null;
      return { n: d.progress.done, m: d.progress.total || nodes.length, name: activeCopy(r).text,
        model: a && (a.model || a.effort) ? `${a.model || 'default'}${a.effort ? ` · ${a.effort}` : ''}` : '' };
    }
    ```
  - **`rdStateCopy` (`:13286`)** — replace ONLY the final `const cyc = …; return …` arm with:
    ```js
    if (isGraphRun(r)) return `${activeCopy(r).text}.`;
    const cyc = Number(r.cycle) || 0;
    return `${step} is running${cyc > 1 ? ` · cycle ${cyc}` : ''}.`;
    ```
  - **`window.__np`** — add `isGraphRun, activeNodes, activeCopy, runDecorFor,` to the literal (`paintGraphFor` joins it in Task 8).
- [ ] Step 4: `node --test test/ui-run-hosts.test.mjs` — `Expected: # pass 13 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P6 — v2 arms for the run status helpers`

### Task 8: `paintGraphFor` + the three hosts wired into app.js

**Files:** modify `ui/public/app.js` (`buildRunCard :14070`, `paintStepper :14296`, `paintRdGraph :14916`, `openHistDetail :10874-10876`); modify `test/ui-run-hosts.test.mjs`.

- [ ] Step 1: Write the failing test — append to `test/ui-run-hosts.test.mjs`

```js
test('paintGraphFor routes by stepper.version and mounts the v2 renderer once per host', async () => {
  const window = await bootApp();
  const np = window.__np;
  const doc = window.document;
  const host = doc.createElement('div'); host.className = 'run-flow';
  const wrap = doc.createElement('div'); wrap.className = 'run-flow-wrap'; wrap.appendChild(host);
  doc.body.appendChild(wrap);
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [], endReached: false, warnings: [], wireDeliveries: {}, gate: null });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.ok(host.querySelector('.gv-world'), 'v2 manifest → the graph renderer');
  const world = host.querySelector('.gv-world');
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(host.querySelector('.gv-world'), world, 'a repaint reuses the mount');
  // v1 manifest in a FRESH host keeps the column painter.
  const host2 = doc.createElement('div'); host2.className = 'run-flow';
  const w2 = doc.createElement('div'); w2.className = 'run-flow-wrap'; w2.appendChild(host2); doc.body.appendChild(w2);
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  np.onState(v1, { status: 'running', stepper: { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] }], feedbacks: [] } });
  np.paintGraphFor(host2, v1.stepper, np.runDecorFor(v1, 'static'));
  assert.equal(host2.querySelector('.gv-world'), null, 'v1 never reaches the graph renderer');
  assert.ok(host2.querySelector('.run-node, .col'), 'the v1 column painter ran');
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs` — `Expected: TypeError: np.paintGraphFor is not a function`.
- [ ] Step 3: Implement in `ui/public/app.js` — add above `paintStepper` (`:14296`):

```js
// The ONE branch point between the v1 column painter and the v2 graph renderer.
// `decor` is runDecorFor(r, mode) with `run`/`runId`/`mode` (+ `histKey` on the
// History screen) shallow-added; the v1 arm reads only `decor.run`.
const GRAPH_MOUNTS = new WeakMap();   // .run-flow element -> { m, ctx }
function paintGraphFor(host, stepper, decor) {
  if (!host) return;
  if (!isGraphManifest(stepper)) {
    const r = decor && decor.run;
    if (!r) return;
    buildRunGraph(host, stepper);
    const v1 = runStepperView(r);
    paintRunGraph(host, v1.manifest, v1.view);
    return;
  }
  let slot = GRAPH_MOUNTS.get(host);
  if (!slot) {
    host.innerHTML = '';                      // drop any v1 columns this host held
    slot = { m: null, ctx: decor };
    slot.m = mountRunGraph(host, {
      mode: decor.mode || 'monitor',
      onRowClick: (executionId, nodeId) => focusLogExecution(slot.ctx, executionId, nodeId),
      onGateClick: () => focusQuestionPanel(slot.ctx),
      onResultClick: (path) => openRunArtifact(slot.ctx, path),
    });
    GRAPH_MOUNTS.set(host, slot);
  }
  slot.ctx = decor;                            // callbacks always read the CURRENT bag
  slot.m.update(decor.runId, stepper, decor);
}

/** Footer row -> narrow the log to that execution. P6b lands the filter axis;
 *  this setter is no-op-safe so the click is wired exactly once, here. */
function focusLogExecution(ctx, executionId, nodeId) {
  const r = ctx && ctx.run;
  if (!r) return;
  if (typeof r.__setLogFilter === 'function') r.__setLogFilter({ execution: executionId, node: nodeId });
  const sec = (r.el && r.el.querySelector('.run-log'))
    || (runDetailState.screen && runDetailState.screen.querySelector('.rd-sec-logs'))
    || (histDetailState.screen && histDetailState.screen.querySelector('.hd-sec-logs'));
  if (sec) sec.scrollIntoView({ block: 'nearest' });
}

/** Gate pip -> the question panel that owns the answer buttons. */
function focusQuestionPanel(ctx) {
  const r = ctx && ctx.run;
  const screen = runDetailState.screen;
  const panel = (screen && screen.querySelector('.rd-questions'))
    || (r && r.el && r.el.querySelector('.qpanel'));
  if (!panel) return;
  panel.scrollIntoView({ block: 'nearest' });
  const focusable = panel.querySelector('button, [tabindex]');
  if (focusable && typeof focusable.focus === 'function') focusable.focus();
}

/** End result chip -> the saved-artifact viewer, through the indexed route. */
async function openRunArtifact(ctx, path) {
  const r = ctx && ctx.run;
  if (!r || !path) return;
  const name = String(path).split('/').filter(Boolean).pop();
  const rel = encodeURIComponent(String(path));
  const pid = r.pipelineId || r.id || ctx.runId;
  const url = r.workspaceId
    ? `/api/workspaces/${encodeURIComponent(r.workspaceId)}/runs/${encodeURIComponent(pid)}/artifact?rel=${rel}`
    : (() => { const key = ctx.histKey || historyKeyForRun(r); return key && pid ? `/api/history/${key}/${pid}/artifact?rel=${rel}` : ''; })();
  if (!url) { showViewer(name, 'This run is not in History yet — the file becomes viewable once it is saved.'); return; }
  try {
    const res = await fetch(url);
    const data = await safeJson(res);
    if (!res.ok) { showViewer(name, `Error: ${data.error || res.status}`); return; }
    showViewer(data.rel || name, data.text || '');
  } catch (e) { showViewer(name, `Error: ${e.message}`); }
}
```

- [ ] Step 4: Route the three hosts:
  - `buildRunCard` (`:14078`): `if (stepHost && !isGraphManifest(r.stepper)) buildRunGraph(stepHost, r.stepper);` and, after the `.rc-open` binding (`:14106`), `node.querySelector('.rc-detailed .run-flow-wrap')?.addEventListener('click', go);` (D5: clicking the card's graph opens the detail; the v2 world is `pointer-events:none`, so the wrap gets the click).
  - `paintStepper` (`:14296`) becomes:
    ```js
    function paintStepper(r) {
      if (!r.el) return;
      const host = r.el.querySelector('.run-flow');
      if (!host) return;
      if (isGraphRun(r)) {
        if (r.el.dataset.density === 'compact') return;   // locked: compact renders NO graph
        paintGraphFor(host, r.stepper, runDecorFor(r, 'static'));
        return;
      }
      const { manifest, view } = runStepperView(r);
      paintRunGraph(host, manifest, view);
    }
    ```
  - `paintRdGraph` (`:14916`): first line inside → `if (isGraphRun(r)) { paintGraphFor(host, r.stepper, runDecorFor(r, 'monitor')); return; }` (the `buildRunGraph` + `paintRunGraph` pair below is untouched).
  - `openHistDetail` (`:10874-10876`): replace the two lines with
    ```js
    const flow = screen.querySelector('.run-flow');
    if (isGraphManifest(data.state.stepper)) {
      paintGraphFor(flow, data.state.stepper, Object.assign(
        decorFromState(data.state, { live: false, now: 0, subsOf: (id) => subAgentsForNode(data.state, id) }),
        { run: data.state, runId: parsed.id, mode: 'monitor', histKey: parsed.projectKey }));
    } else {
      if (flow) buildRunGraph(flow, data.state.stepper); // null stepper -> legacy default
      paintHistStepper(screen, data.state);
    }
    ```
    (`wireHdGraphLogLinks` needs no guard here: it selects `.run-node[data-log-source]`, which a v2 card never carries — P6b gives it the `data-node-id` axis.)
  - add `paintGraphFor, focusLogExecution, openRunArtifact,` to `window.__np`.
- [ ] Step 5: `node --test test/ui-run-hosts.test.mjs test/ui-run-graph.test.mjs test/ui-run-graph-paint.test.mjs test/ui-history-detail.test.mjs test/ui-history-graph-log-link.test.mjs` — `Expected: # fail 0` (v1 surfaces untouched).
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — paintGraphFor and the three run-graph hosts`

### Task 9: quiescence banner, numeric progress, gate wire copy

**Files:** modify `ui/public/index.html` (one `.rc-meta` segment, `:397`); modify `ui/public/app.js` (`renderRunMeta :14054`, `paintRunCard :14362`, `paintRdHeader :14937`, `paintRunDetail :14740`, `openHistDetail`, the History Overview stat grid `:12790`, `renderGateBody :4438`); modify `test/ui-run-hosts.test.mjs`.

**Copy (VERBATIM):** banner `finished at quiescence — End not reached`; compact chip `3/6 done`; card meta segment `3/6`; detail `.rd-step` `3/6 done · Planner`; History DURATION sub-line `9 executions · 2 loop deliveries`; gate intro `This cycle reached its limit on Reviewer → Implementer (w9) with open issues. Approve another cycle to keep iterating, or continue with what you have.`

- [ ] Step 1: Write the failing test — append to `test/ui-run-hosts.test.mjs`

```js
test('progress reads numerically everywhere and the quiescence banner appears once', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'done' });
  np.onState(r, { status: 'done', stepper: MANIFEST, active: [], endReached: false, warnings: [],
    wireDeliveries: { w1: 2 }, gate: null,
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] });
  assert.deepEqual((({ n, m }) => [n, m])(np.runStepLabel(r)), [1, 1]);
  const banners = window.document.createElement('div');
  np.paintQuiescenceBanner(banners, np.runDecorFor(r, 'monitor'));
  np.paintQuiescenceBanner(banners, np.runDecorFor(r, 'monitor'));
  assert.equal(banners.querySelectorAll('.run-warn').length, 1, 'idempotent');
  assert.equal(banners.querySelector('.run-warn').textContent, 'finished at quiescence — End not reached');
  assert.equal(banners.querySelector('.run-warn').hidden, false);
  np.paintQuiescenceBanner(banners, { quiescent: false });
  assert.equal(banners.querySelector('.run-warn').hidden, true);
  assert.equal(np.progressText(r), '1/1 done');
  assert.equal(np.histCountsLine({ ...r, stepper: MANIFEST }), '1 execution · 2 loop deliveries');
});

test('the gate intro names the wire it holds on', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  assert.equal(np.gateWireCopy(r, 'w1'), ' on Planner → End (w1)');
  assert.equal(np.gateWireCopy(r, 'nope'), '', 'an unknown wire adds nothing');
});
```

- [ ] Step 2: `node --test test/ui-run-hosts.test.mjs` — `Expected: TypeError: np.paintQuiescenceBanner is not a function`.
- [ ] Step 3: Implement in `ui/public/app.js` — add beside the other v2 helpers:

```js
/** The amber Amendment-f banner, in .rd-banners / .hd-banners. Idempotent. */
function paintQuiescenceBanner(host, decor) {
  if (!host) return;
  const show = !!(decor && decor.quiescent);
  let el = host.querySelector(':scope > .run-warn');
  if (!el) {
    if (!show) return;
    el = document.createElement('div');
    el.className = 'run-warn';
    el.setAttribute('role', 'status');
    host.appendChild(el);
  }
  el.textContent = 'finished at quiescence — End not reached';
  el.hidden = !show;
}

/** `3/6 done` — D15 forbids a bar, not a number. '' on a v1 run. */
function progressText(r) {
  if (!isGraphRun(r)) return '';
  const { done, total } = runDecorFor(r).progress;
  return `${done}/${total} done`;
}

/** History Overview DURATION sub-line: `9 executions · 2 loop deliveries`. */
function histCountsLine(st) {
  const d = decorFromState(st, { live: false, now: 0 });
  const e = d.executions, l = d.loopDeliveries;
  return `${e} execution${e === 1 ? '' : 's'} · ${l} loop deliver${l === 1 ? 'y' : 'ies'}`;
}

/** ` on Reviewer → Implementer (w9)` for the gate panel's intro. '' when unknown. */
function gateWireCopy(r, wireId) {
  if (!isGraphRun(r) || !wireId) return '';
  const g = r.stepper.graph || {};
  const w = (g.wires || []).find((x) => x && x.id === wireId);
  if (!w) return '';
  const lbl = (id) => { const n = (g.nodes || []).find((x) => x && x.id === id); return (n && (n.label || n.id)) || id; };
  return ` on ${lbl(w.from.node)} → ${lbl(w.to.node)} (${wireId})`;
}
```
  Export all four on `window.__np`.
- [ ] Step 4: Wire the copy:
  - `ui/public/index.html:397` — after the `rm-text` segment inside `.rc-meta`, add `<span class="rc-seg rc-prog" hidden><span class="rc-dot">·</span><span class="rc-prog-text"></span></span>`.
  - `renderRunMeta` — at the end: `const prog = root.querySelector('.rc-prog'); if (prog) { const d = isGraphRun(r) ? runDecorFor(r).progress : null; prog.hidden = !d; if (d) prog.querySelector('.rc-prog-text').textContent = `${d.done}/${d.total}`; }`
  - `paintRunCard` compact block (`:14395`) — `chip.textContent = isGraphRun(r) ? `${n}/${m} done` : `STEP ${n}/${m}`;` (the `st-*` class line is unchanged).
  - `paintRdHeader` (`:14966`) — `const stepText = isGraphRun(r) ? `${step.n}/${step.m} done${step.name ? ` · ${step.name}` : ''}` : (step && step.name ? `step ${step.n}/${step.m} · ${step.name}` : '');`. **Nothing else in `paintRdHeader` changes** (C16: the disabled-rule block and the single `.rd-pause` control stay exactly as they are).
  - `paintRunDetail` (`:14746`) — after `paintRdBanners(screen, r);` add `if (isGraphRun(r)) paintQuiescenceBanner(screen.querySelector('.rd-banners'), runDecorFor(r, 'monitor'));`
  - `openHistDetail` — in the v2 arm added in Task 8, after `paintGraphFor(...)`: `paintQuiescenceBanner(screen.querySelector('.hd-banners'), decorFromState(data.state, { live: false, now: 0 }));`
  - History Overview stat grid (`:12790`) — replace the DURATION sub-line argument with
    `isGraphManifest(st.stepper) ? histCountsLine(st) : `${steps.length} step${steps.length === 1 ? '' : 's'} · ${maxCycle} cycle${maxCycle === 1 ? '' : 's'}``
  - `renderGateBody` (`:4443`) — `intro.textContent = `This cycle reached its limit${gateWireCopy(r, pq.wireId)}${issues.length ? ' with open issues' : ''}. Approve another cycle to keep iterating, or continue with what you have.`;` (one template replaces the two literals; the issues list below is untouched).
- [ ] Step 5: `node --test test/ui-run-hosts.test.mjs test/ui-history-detail.test.mjs test/ui-running-density.test.mjs` — `Expected: # fail 0`.
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — quiescence banner, numeric progress, gate wire copy`

### Task 10: P6a — full suite, regression sweep, commit

- [ ] Step 1: `npm test 2>&1 | tail -20`
  `Expected:` **BASELINE + 36** passing (20 in `test/ui-run-decor.test.mjs`, 16 in `test/ui-run-hosts.test.mjs`), `# fail 0`.
- [ ] Step 2: If a v1 UI suite went red, the cause is a shared helper that took the v2 arm for a v1 run — check `isGraphRun` (it must be false for `stepper.version !== 2` AND for a null stepper) before changing any test. `test/api-sources.test.mjs` has a known intermittent `ENOTEMPTY` teardown flake that fails the whole FILE; re-run that file alone before blaming this diff.
- [ ] Step 3: `grep -rn "card.style.height" ui/public/graph/run-decor.mjs ui/public/graph/run-hosts.mjs` — `Expected: no matches` (only `view.setFooter` sizes a card).
- [ ] Step 4: `git status --porcelain` — nothing under `docs/superpowers/**` is staged, ever.
- [ ] Step 5: Commit — `worca: Node-graph v2 P6 — run monitor v2 UI green (P6a)`

### — split point: P6b starts here —

### Task 11: P6b entry check

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — the pipeline's branch (by hand: `worca-cc/node-graph-v2-p6`). Never `git checkout dev`.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: P6a sentinels — **STOP if either is absent**:
  ```bash
  grep -q "export function decorFromState" ui/public/graph/run-decor.mjs && \
  grep -q "export function applyDecor" ui/public/graph/run-decor.mjs && \
  grep -q "function paintGraphFor" ui/public/app.js && echo P6A-OK
  ```
- [ ] Step 4: `npm test 2>&1 | tail -5` — record the pass count as **BASELINE-B** (green; it is P6a's total).

### Task 12: `log-filter.mjs` gains the `node` and `execution` axes

**Files:** modify `ui/public/log-filter.mjs`; modify `test/log-filter.test.mjs`.

**Rules (VERBATIM):** `node` matches `String(rec.nodeId)`; `execution` matches `String(rec.executionId)`. Both use the same attribution rule the `step` axis already has: **a record with no attribution shows ONLY when that axis is "all"**. The `step` axis stays (v1 records) until P8. `cycle` keeps matching `rec.cycle`, which on a v2 run is the execution's **ordinal**. Facets gain `nodes` (distinct `rec.nodeId`, sorted) and `executions` (distinct `rec.executionId`, sorted).

- [ ] Step 1: Write the failing test — append to `test/log-filter.test.mjs`

```js
test('node axis matches rec.nodeId; attribution-less lines only show under all', () => {
  assert.equal(logLineVisible(L({ nodeId: 'n_impl' }), { node: 'n_impl' }), true);
  assert.equal(logLineVisible(L({ nodeId: 'n_plan' }), { node: 'n_impl' }), false);
  assert.equal(logLineVisible(L(), { node: 'n_impl' }), false, 'no nodeId → hidden when a node is chosen');
  assert.equal(logLineVisible(L(), { node: '' }), true);
});

test('execution axis matches rec.executionId and composes with the others', () => {
  const rec = L({ nodeId: 'n_impl', executionId: 'x:n_impl:2', level: 'debug', cycle: 2 });
  assert.equal(logLineVisible(rec, { execution: 'x:n_impl:2' }), true);
  assert.equal(logLineVisible(rec, { execution: 'x:n_impl:1' }), false);
  assert.equal(logLineVisible(rec, { execution: 'x:n_impl:2', level: 'debug', cycle: '2' }), true);
  assert.equal(logLineVisible(rec, { execution: 'x:n_impl:2', level: 'info' }), false);
  assert.equal(logLineVisible(L(), { execution: 'x:n_impl:2' }), false);
});

test('facets offer the node and execution values seen so far', () => {
  const f = logFacets([L({ nodeId: 'n_b', executionId: 'x:n_b:1' }), L({ nodeId: 'n_a', executionId: 'x:n_a:1' }), L()]);
  assert.deepEqual(f.nodes, ['n_a', 'n_b']);
  assert.deepEqual(f.executions, ['x:n_a:1', 'x:n_b:1']);
});
```

- [ ] Step 2: `node --test test/log-filter.test.mjs` — `Expected: # fail 3` (`false !== true` on every new axis: an unknown key is ignored by `compileLogFilter`).
- [ ] Step 3: Implement — in `ui/public/log-filter.mjs`:
  - extend the header comment: `A filter is { source, level, step, node, execution, cycle, search } …` with the two new bullet texts (`node: matches String(rec.nodeId) — the v2 graph node the line was attributed to; attribution-less lines only show when no node is chosen.` / `execution: matches String(rec.executionId) — ONE execution of one node (x:<nodeId>:<ordinal>), so a loop's second cycle can be read alone.`)
  - in `compileLogFilter`, beside the `step` pair:
    ```js
    const hasNode = filter.node !== undefined && filter.node !== '';
    const node = hasNode ? String(filter.node) : '';
    const hasExec = filter.execution !== undefined && filter.execution !== '';
    const execution = hasExec ? String(filter.execution) : '';
    ```
    and, inside the predicate after the `step` line:
    ```js
    if (hasNode && (rec.nodeId == null || String(rec.nodeId) !== node)) return false;
    if (hasExec && (rec.executionId == null || String(rec.executionId) !== execution)) return false;
    ```
  - in `logFacets`, collect `nodes`/`executions` Sets the same way and return them sorted (`[...set].sort()`).
- [ ] Step 4: `node --test test/log-filter.test.mjs` — `Expected: # fail 0`.
- [ ] Step 5: Mutation audit — drop the `rec.nodeId == null` half of the node guard; the "attribution-less" assertion must fail. Restore.
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — log filter node and execution axes`

### Task 13: the shared filter bar — node select + execution chip

**Files:** modify `ui/public/index.html` (`:432`, the ONE `.log-filters` markup — D9); modify `ui/public/app.js` (`readLogFilterFrom :9470`, `paintLogFilters :4059`, `facetKeys :4092`, `makeRun :1275` filter literal, the History logs panel `:10528-10593`, `wireHdGraphLogLinks :11706`, `focusLogExecution` from Task 8); modify `test/ui-log-filters-row.test.mjs`.

**Rules:** ONE markup, cloned by History (`buildLogFilterBar :9463`) — do not fork it. The `.log-f-step` select is RE-PURPOSED: `data-axis="node"` when the run logged node ids (options = the manifest label of each node that logged), `data-axis="step"` otherwise (today's `step N` options, v1 records). The new `.log-f-exec` chip is hidden until an execution is picked; its `×` clears the execution axis; **any manual node/cycle change clears the chip** (adj-d §4).

- [ ] Step 1: Write the failing test — append to `test/ui-log-filters-row.test.mjs`

```js
test('the ONE filter markup carries the node select and the execution chip', () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'));
  const bar = dom.window.document.querySelector('#run-card-tpl').content.querySelector('.log-filters');
  const sel = bar.querySelector('.log-f-step');
  assert.ok(sel, 'the step select is re-purposed, never duplicated');
  assert.equal(bar.querySelectorAll('select.log-f').length, 4, 'still four selects (source, level, step/node, cycle)');
  const chip = bar.querySelector('.log-f-exec');
  assert.ok(chip && chip.hasAttribute('hidden'), 'the execution chip ships hidden');
  assert.ok(chip.querySelector('.lfe-text') && chip.querySelector('.lfe-x'), 'text + clear affordance');
});
```
and append to `test/ui-run-hosts.test.mjs`:
```js
test('the node select and the execution chip drive the filter', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [
    { key: 'x:n_a:2', executionId: 'x:n_a:2', nodeId: 'n_a', ordinal: 2, kind: 'cycle', status: 'done', activeMs: 1 }] });
  r.logLines = [{ source: 'planner', level: 'info', text: 'hi', ts: 1, nodeId: 'n_a', executionId: 'x:n_a:2', cycle: 2 }];
  const card = np.buildRunCard(r); r.el = card; window.document.body.appendChild(card);
  np.paintLogFilters(r, card);
  const sel = card.querySelector('.log-f-step');
  assert.equal(sel.dataset.axis, 'node');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['all nodes', 'Planner']);
  sel.value = 'n_a';
  assert.equal(np.readLogFilterFrom(card).node, 'n_a');
  assert.equal(np.readLogFilterFrom(card).step, '', 'the step axis is empty in node mode');
  r.__setLogFilter({ execution: 'x:n_a:2', node: 'n_a' });
  const chip = card.querySelector('.log-f-exec');
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.lfe-text').textContent, 'Planner #2');
  assert.equal(np.readLogFilterFrom(card).execution, 'x:n_a:2');
  chip.querySelector('.lfe-x').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(chip.hidden, true);
  assert.equal(np.readLogFilterFrom(card).execution, '');
});
```

- [ ] Step 2: `node --test test/ui-log-filters-row.test.mjs test/ui-run-hosts.test.mjs` — `Expected: AssertionError: the execution chip ships hidden` (`chip` is null) and `TypeError: Cannot read properties of null (reading 'hidden')`.
- [ ] Step 3: Implement:
  - `ui/public/index.html:432` — inside `.log-filters`, immediately after the `.log-f-cycle` select, insert
    `<button type="button" class="log-f log-f-exec" hidden title="Showing one execution — click × to clear"><span class="lfe-text"></span><span class="lfe-x" aria-hidden="true">×</span></button>`
    and add to `style.css` (beside the other `.log-f` rules): `.log-f-exec{display:inline-flex;align-items:center;gap:6px;max-width:220px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);background:var(--field);font-size:11px;font-weight:600;color:var(--ink-2);cursor:default;} .log-f-exec[hidden]{display:none;} .log-f-exec .lfe-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .log-f-exec .lfe-x{cursor:pointer;color:var(--ink-3);font-weight:800;}`
  - `makeRun` (`:1275`) — the filter literal becomes `{ source: '', level: '', step: '', node: '', execution: '', cycle: '', search: '' }`.
  - `readLogFilterFrom` (`:9470`) — replace the `step` line with:
    ```js
    const stepSel = root.querySelector('.log-f-step');
    const nodeAxis = stepSel && stepSel.dataset.axis === 'node';
    const stepVal = stepSel ? stepSel.value : '';
    const chip = root.querySelector('.log-f-exec');
    ```
    and return `step: nodeAxis ? '' : stepVal, node: nodeAxis ? stepVal : '', execution: chip && !chip.hidden ? (chip.dataset.executionId || '') : '',` alongside the existing keys.
  - `paintLogFilters` (`:4064`) — replace the single `fillFilterSelect(selStep, …)` call with:
    ```js
    const labelOf = nodeLabelLookup(r.stepper);
    if (facets.nodes && facets.nodes.length) {
      selStep.dataset.axis = 'node';
      selStep.title = 'Filter by node'; selStep.setAttribute('aria-label', 'Filter by node');
      fillFilterSelect(selStep, 'all nodes', facets.nodes, r.logFilter.node, (id) => labelOf(id));
    } else {
      selStep.dataset.axis = 'step';
      selStep.title = 'Filter by step'; selStep.setAttribute('aria-label', 'Filter by step');
      fillFilterSelect(selStep, 'all steps', facets.steps, r.logFilter.step, (i) => `step ${i + 1}`);
    }
    paintExecChip(r, root);
    ```
    and add `node`/`execution` to the `effective` comparison so a vanished value reconciles like the others; extend `facetKeys` with `...facets.nodes.map((n) => `n:${n}`)`.
  - new helpers (beside `paintLogFilters`), exported on `window.__np`:
    ```js
    /** `Planner #2` / `Implementer #2 · Add schema` for the execution chip. */
    function executionChipText(r, executionId) {
      const row = (Array.isArray(r.steps) ? r.steps : []).find((s) => s && (s.executionId || s.key) === executionId);
      if (!row) return String(executionId || '');
      const head = `${nodeLabelLookup(r.stepper)(row.nodeId)} #${row.ordinal ?? row.cycle ?? 1}`;
      return row.kind === 'task' ? `${head} · ${row.title || 'task'}` : head;
    }

    /** Mirror r.logFilter.execution into the chip on one bar. */
    function paintExecChip(r, root) {
      const chip = root && root.querySelector('.log-f-exec');
      if (!chip) return;
      const id = r.logFilter.execution || '';
      chip.hidden = !id;
      chip.dataset.executionId = id;
      if (id) chip.querySelector('.lfe-text').textContent = executionChipText(r, id);
    }
    ```
  - the card's delegated filter listener (`:9337`/`:9351`) — after `r.logFilter = readCardLogFilter(card, r);` add `if (e.target.closest && e.target.closest('.log-f-step, .log-f-cycle')) r.logFilter.execution = '';` then `paintExecChip(r, card)` (a manual node/cycle pick clears the chip). Bind the chip's `×` on the SAME delegated listener: `if (e.target.closest('.log-f-exec .lfe-x')) { r.logFilter.execution = ''; paintExecChip(r, card); repaintFilteredLog(r, card); }`.
  - `r.__setLogFilter` — define once in `makeRun`'s consumer path (add to the run model in `buildRunCard`, after `paintLogFilters(r, node)`):
    ```js
    r.__setLogFilter = (patch) => {
      Object.assign(r.logFilter, patch);
      for (const root of [r.el, runDetailState.screen && runDetailState.screen.querySelector('.rd-sec-logs')].filter(Boolean)) {
        const sel = root.querySelector('.log-f-step');
        if (sel && patch.node && sel.dataset.axis === 'node') sel.value = patch.node;
        paintExecChip(r, root);
        repaintFilteredLog(r, root);
      }
    };
    ```
  - History panel (`:10571`) — keep `panel.__setLogSource` exactly as it is (pinned by `test/ui-history-graph-log-link.test.mjs`) and add beside it:
    ```js
    panel.__setLogFilter = ({ node, execution } = {}) => {
      if (node !== undefined) { filter.node = node; const sel = bar.querySelector('.log-f-step'); if (sel && sel.dataset.axis === 'node') sel.value = node; }
      if (execution !== undefined) { filter.execution = execution; const chip = bar.querySelector('.log-f-exec'); if (chip) { chip.hidden = !execution; chip.dataset.executionId = execution || ''; } }
      paint();
    };
    ```
    and fill the History bar's step select through the same node/step branch as above (facets come from `recs`).
  - `wireHdGraphLogLinks` (`:11706`) — widen the selector to `'.run-node[data-log-source], .node[data-node-id]'` and in `open(node)`: `if (node.dataset.nodeId) { cell.sec.__setLogFilter ? cell.sec.__setLogFilter({ node: node.dataset.nodeId }) : (cell.sec.__pendingLogFilter = { node: node.dataset.nodeId }); } else { …today's __setLogSource path… }`; drain `__pendingLogFilter` next to `__pendingLogSource` after the first paint.
  - `focusLogExecution` (Task 8) — replace the body's setter line with `if (r.__setLogFilter) r.__setLogFilter({ execution: executionId, node: nodeId }); else if (histDetailState.screen) { const sec = histDetailState.screen.querySelector('.hd-sec-logs'); if (sec && sec.__setLogFilter) sec.__setLogFilter({ execution: executionId, node: nodeId }); }`.
- [ ] Step 4: `node --test test/ui-log-filters-row.test.mjs test/ui-run-hosts.test.mjs test/ui-history-graph-log-link.test.mjs test/log-filter.test.mjs` — `Expected: # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P6 — node select + execution chip on the shared log filter`

### Task 14: sub-agents keyed by `executionId`

**Files:** modify `ui/public/app.js` (`subsByNodeCycleArrays :1529`, `subsGroupsForRender :1557`, `stepStatusByKey :1583`, `stepSkillsFromSteps`, `stepGraphifyFromSteps`, `onStepSkills :1790`, `onStepGraphify :1801`, `cycleAwareLabel :1656`); possibly modify `src/core/graph/orchestrator.mjs` (the sub-agent reducer); modify `test/ui-subagent-cycle-split.test.mjs`.

**Why:** on v2 a node's composite task slices share an ordinal (`x:n_impl:2:p1t3`, `x:n_impl:2:p1t4`), so `nodeId|cycle` MERGES executions that must stay apart. The group key becomes `nodeId|executionId` whenever an executionId is present, and falls back to `nodeId|cycle` for v1 records — one helper, six call sites, `|` still splits unambiguously (a nodeId is `[A-Za-z0-9_]+`).

- [ ] Step 1: **Verify P4's delta.** `grep -n "executionId" src/core/graph/orchestrator.mjs | grep -i "subagent\|stepKey"`. P4 sets `attr.stepKey = executionId`; if the emitted `subagent` payload does NOT also carry `executionId`, add it in the v2 sub-agent reducer only (`executionId: attr.stepKey`) — the v1 `Orchestrator` emit stays untouched. **Record which branch you took in the commit body.**
- [ ] Step 2: Write the failing test — append to `test/ui-subagent-cycle-split.test.mjs`

```js
test('subsByNodeCycleArrays keys by executionId when present, so task slices never merge', async () => {
  const { window } = await boot();
  const g = window.__np.subsByNodeCycleArrays([
    { id: 'a', nodeId: 'n_impl', cycle: 2, executionId: 'x:n_impl:2:p1t3', status: 'finished' },
    { id: 'b', nodeId: 'n_impl', cycle: 2, executionId: 'x:n_impl:2:p1t4', status: 'running' },
    { id: 'c', nodeId: 'n_impl', cycle: 2, status: 'finished' },
  ]);
  assert.deepEqual(Object.keys(g).sort(), ['n_impl|2', 'n_impl|x:n_impl:2:p1t3', 'n_impl|x:n_impl:2:p1t4']);
});

test('cycleAwareLabel names a v2 group from the ledger', async () => {
  const { window } = await boot();
  const stepper = { version: 2, template: { id: 'w', name: 'W' }, graph: { nodes: [
    { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, ports: { inputs: [], outputs: [], await: true } }], wires: [] } };
  const steps = [
    { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', status: 'done' },
    { key: 'x:n_impl:1:p1t3', executionId: 'x:n_impl:1:p1t3', nodeId: 'n_impl', ordinal: 1, kind: 'task', title: 'Add schema', status: 'done' },
  ];
  const label = window.__np.cycleAwareLabel(stepper, [], ['n_impl|x:n_impl:1', 'n_impl|x:n_impl:1:p1t3'], steps);
  assert.equal(label('n_impl|x:n_impl:1'), 'Implementer #1');
  assert.equal(label('n_impl|x:n_impl:1:p1t3'), 'Implementer #1 · Add schema');
});
```

- [ ] Step 3: `node --test test/ui-subagent-cycle-split.test.mjs` — `Expected: # fail 2` (keys come back as `['n_impl|2']`; `label(...)` returns the raw key).
- [ ] Step 4: Implement in `ui/public/app.js`:
  - beside `CYCLE_KEY_SEP` (`:1521`):
    ```js
    /** The ONE group key for a node's execution: `nodeId|executionId` on v2 rows,
     *  `nodeId|cycle` on v1 rows. `|` occurs in neither half, so split() is exact. */
    function execKey(nodeId, executionId, cycle) {
      return `${nodeId}${CYCLE_KEY_SEP}${executionId || (cycle ?? 0)}`;
    }
    ```
  - `subsByNodeCycleArrays` → `const key = execKey(s.nodeId, s.executionId || s.stepKey, s.cycle);`
  - `subsGroupsForRender` / `stepStatusByKey` / `stepSkillsFromSteps` / `stepGraphifyFromSteps` → `execKey(st.nodeId, st.executionId || st.key, st.cycle)`
  - `onStepSkills` / `onStepGraphify` → `execKey(msg.nodeId, msg.executionId, msg.cycle)`
  - `cycleAwareLabel(stepper, subAgents, groupKeys, steps = [])` — at the top of the returned closure, before the v1 lookup:
    ```js
    const byExec = new Map((Array.isArray(steps) ? steps : []).filter(Boolean)
      .map((s) => [s.executionId || s.key, s]));
    // …inside the returned (key) => { … } after nodeId/cycle are split:
    const tail = i >= 0 ? String(key).slice(i + 1) : '';
    const row = byExec.get(tail);
    if (row) {
      const head = `${byId(nodeId)} #${row.ordinal ?? row.cycle ?? 1}`;
      return row.kind === 'task' ? `${head} · ${row.title || 'task'}` : head;
    }
    ```
    Every existing 3-arg call site keeps working (`steps` defaults to `[]` → the v1 path); pass `r.steps` / `st.steps` at the Running-detail and History Agents-tab call sites so v2 groups get ledger labels.
- [ ] Step 5: `node --test test/ui-subagent-cycle-split.test.mjs test/ui-subagent-tree.test.mjs test/ui-subagent-views.test.mjs test/ui-subagent-fan.test.mjs test/ui-agents-accordion.test.mjs` — `Expected: # fail 0` (v1 records have no `executionId`, so every key is byte-identical to today's).
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — key sub-agent groups by executionId`

### Task 15: `src/cli/render.mjs` — the pure exec formatter

**Files:** create `src/cli/render.mjs`; create `test/cli-exec-render.test.mjs`.

**Interfaces produced:**
```js
export function fmtDur(ms) → '12s' | '1m03s' | '1h01m'          // CLI shape; NOT the UI's '1m 3s'
export function formatExecLine(ev, manifest, { now = Date.now(), color = (n, s) => s } = {}) → string   // '' renders nothing
export function formatGateHeader(payload, manifest) → string
export function formatResultLine(result) → string
export function formatTotals({ executions, activeMs, costUsd }) → string
```
**The six line shapes (VERBATIM from spec §8; labels come from the manifest, ids are NEVER shown):**
```
▶ Implementer #2 · fix ← Reviewer                 start (the loop port from trigger.freshPorts; the source is the wire's from-node)
  ▶ task 3/7 · Add schema                          kind:'task' slice, indented two spaces
✓ Implementer #2  1m03s · $0.12                    done  (verifiers append ' — blocking' / ' — clean')
✓ OR · OR → Implementer                            flow-node done (the ' · AND' / ' · OR → X' half is dim)
✗ Reviewer #1  12s — could not parse the verdict   error
? Loop gate · Reviewer → Implementer  3/3 cycles used
■ End ← Reviewer.pass → plan-review.md             End bound
```
`token` events are never rendered. `status:'skipped'` renders `''`.

- [ ] Step 1: Write the failing test — create `test/cli-exec-render.test.mjs`

```js
// test/cli-exec-render.test.mjs — the CLI's exec line formatter (pure, no IO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExecLine, formatGateHeader, formatResultLine, formatTotals, fmtDur } from '../src/cli/render.mjs';

const M = { version: 2, template: { id: 'wf', name: 'W' }, graph: {
  nodes: [
    { id: 'n_rev', kind: 'agent', key: 'reviewer', label: 'Reviewer', ports: { inputs: [], outputs: [{ id: 'pass', type: 'void', when: 'clean' }] } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', ports: { inputs: [{ id: 'fix', type: 'md', loop: true }], outputs: [] } },
    { id: 'n_or', kind: 'or', key: null, label: 'OR', ports: { inputs: [], outputs: [{ id: 'out', type: 'md' }] } },
    { id: 'n_end', kind: 'end', key: null, label: 'End', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [] } },
  ],
  wires: [
    { id: 'w9', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
    { id: 'w10', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: false },
    { id: 'w11', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' }, loop: false },
  ] } };
const ev = (o) => ({ kind: 'cycle', agentKey: 'implementer', trigger: { wireIds: [], freshPorts: [] }, ...o });

test('start lines name the loop port and its source', () => {
  assert.equal(formatExecLine(ev({ nodeId: 'n_impl', executionId: 'x:n_impl:2', ordinal: 2, status: 'start',
    trigger: { wireIds: ['w9'], freshPorts: ['fix'] } }), M), '▶ Implementer #2 · fix ← Reviewer');
  assert.equal(formatExecLine(ev({ nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, status: 'start' }), M), '▶ Implementer #1');
});

test('task slices are indented and numbered', () => {
  assert.equal(formatExecLine(ev({ nodeId: 'n_impl', executionId: 'x:n_impl:1:p1t3', ordinal: 1, status: 'start',
    kind: 'task', taskIndex: 3, taskTotal: 7, title: 'Add schema' }), M), '  ▶ task 3/7 · Add schema');
});

test('done lines carry duration · cost, the verdict word and the flow markers', () => {
  assert.equal(formatExecLine(ev({ nodeId: 'n_impl', executionId: 'x:n_impl:2', ordinal: 2, status: 'done', costUsd: 0.12, durationMs: 63000 }), M),
    '✓ Implementer #2  1m03s · $0.12');
  assert.equal(formatExecLine(ev({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:1', ordinal: 1, status: 'done',
    costUsd: 0.02, durationMs: 12000, verdict: { hasBlocking: true } }), M), '✓ Reviewer #1  12s · $0.02 — blocking');
  assert.equal(formatExecLine(ev({ nodeId: 'n_or', agentKey: null, executionId: 'x:n_or:1', ordinal: 1, status: 'done' }), M),
    '✓ OR · OR → Implementer');
});

test('error and End lines', () => {
  assert.equal(formatExecLine(ev({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:1', ordinal: 1, status: 'error',
    durationMs: 12000, error: 'could not parse the verdict' }), M), '✗ Reviewer #1  12s — could not parse the verdict');
  assert.equal(formatExecLine(ev({ nodeId: 'n_end', agentKey: null, executionId: 'x:n_end:1', ordinal: 1, status: 'done',
    trigger: { wireIds: ['w11'], freshPorts: ['result'] }, result: { type: 'md', path: '/tmp/p/plan-review.md' } }), M),
    '■ End ← Reviewer.pass → plan-review.md');
  assert.equal(formatExecLine(ev({ nodeId: 'n_impl', status: 'skipped', ordinal: 1 }), M), '');
});

test('gate header, result line, totals and fmtDur', () => {
  assert.equal(formatGateHeader({ id: 'gate-w9-3', kind: 'gate', wireId: 'w9' }, M), '? Loop gate · Reviewer → Implementer  3/3 cycles used');
  assert.equal(formatResultLine({ type: 'md', path: '/tmp/p/plan.md' }), 'Result: /tmp/p/plan.md');
  assert.equal(formatResultLine({ type: 'void' }), 'Result: completed');
  assert.equal(formatTotals({ executions: 9, activeMs: 720000, costUsd: 1.23 }), '9 executions · 12m00s active · $1.23');
  assert.deepEqual([fmtDur(12000), fmtDur(63000), fmtDur(3660000)], ['12s', '1m03s', '1h01m']);
});
```

- [ ] Step 2: `node --test test/cli-exec-render.test.mjs` — `Expected: Cannot find module '.../src/cli/render.mjs'`.
- [ ] Step 3: Implement — create `src/cli/render.mjs`

```js
// src/cli/render.mjs
//
// The CLI's rendering of the graph engine's `exec` stream. PURE: no IO, no
// colour codes of its own — the caller injects `color(name, text)`. Labels come
// from the run manifest (pipelines.stepper); execution ids are NEVER printed.
const nodesOf = (m) => ((m && m.graph && m.graph.nodes) || []).filter(Boolean);
const wiresOf = (m) => ((m && m.graph && m.graph.wires) || []).filter(Boolean);
const nodeOf = (m, id) => nodesOf(m).find((n) => n.id === id) || null;
const labelOf = (m, id) => { const n = nodeOf(m, id); return (n && (n.label || n.id)) || id; };
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';

/** `12s` / `1m03s` / `1h01m` — the CLI's compact shape. */
export function fmtDur(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** The loop port that triggered this execution + the node that published it. */
function loopSource(ev, m) {
  const node = nodeOf(m, ev.nodeId);
  const loopIns = new Set(((node && node.ports && node.ports.inputs) || []).filter((p) => p.loop).map((p) => p.id));
  const port = ((ev.trigger && ev.trigger.freshPorts) || []).find((p) => loopIns.has(p));
  if (!port) return '';
  const wire = wiresOf(m).find((w) => (ev.trigger.wireIds || []).includes(w.id) && w.to && w.to.port === port);
  return wire ? ` · ${port} ← ${labelOf(m, wire.from.node)}` : ` · ${port}`;
}

/** The dim marker a flow card carries: ` · AND`, ` · OR → Implementer`. */
function flowMarker(ev, m, color) {
  const node = nodeOf(m, ev.nodeId);
  if (!node || node.kind === 'agent' || node.kind === 'end') return '';
  const kind = String(node.kind).toUpperCase();
  const out = wiresOf(m).find((w) => w.from && w.from.node === node.id);
  return color('dim', out ? ` · ${kind} → ${labelOf(m, out.to.node)}` : ` · ${kind}`);
}

/** ONE `exec` event -> ONE terminal line ('' when the event renders nothing). */
export function formatExecLine(ev, manifest, { color = (n, s) => s } = {}) {
  if (!ev || !ev.nodeId || ev.status === 'skipped') return '';
  if (BOOKEND_EXECUTION_IDS.includes(ev.executionId)) return '';   // P8's preflight/done rows render nothing
  const m = manifest || {};
  const node = nodeOf(m, ev.nodeId);
  const label = labelOf(m, ev.nodeId);
  const ord = ev.ordinal ?? 1;
  if (ev.kind === 'task') {
    if (ev.status !== 'start') return '';
    const n = ev.taskIndex, t = ev.taskTotal;
    const which = Number.isFinite(n) && Number.isFinite(t) ? ` ${n}/${t}` : '';
    return `  ${color('cyan', '▶')} task${which}${ev.title ? ` · ${ev.title}` : ''}`;
  }
  if (node && node.kind === 'end' && ev.status === 'done') {
    const wire = wiresOf(m).find((w) => (ev.trigger && ev.trigger.wireIds || []).includes(w.id));
    const from = wire ? ` ← ${labelOf(m, wire.from.node)}.${wire.from.port}` : '';
    const r = ev.result || {};
    const tail = r.path ? ` → ${base(r.path)}` : (r.value != null ? ` → ${String(r.value)}` : '');
    return `${color('bold', '■')} ${label}${from}${tail}`;
  }
  if (ev.status === 'start') return `${color('cyan', '▶')} ${label} #${ord}${loopSource(ev, m)}${flowMarker(ev, m, color)}`;
  if (ev.status === 'paused') return `${color('yellow', '⏸')} ${label} #${ord}  paused`;
  const dur = ev.durationMs != null ? `  ${fmtDur(ev.durationMs)}` : '';
  if (ev.status === 'error') return `${color('red', '✗')} ${label} #${ord}${dur} — ${ev.error || 'failed'}`;
  if (ev.status !== 'done') return '';
  const cost = ev.costUsd != null ? ` · ${usd(ev.costUsd)}` : '';
  const verdict = ev.verdict ? (ev.verdict.hasBlocking ? ' — blocking' : ' — clean') : '';
  return `${color('green', '✓')} ${label} #${ord}${dur}${cost}${flowMarker(ev, m, color)}${verdict}`;
}

/** The interactive gate prompt's header. */
export function formatGateHeader(payload, manifest) {
  const m = manifest || {};
  const wire = wiresOf(m).find((w) => w.id === (payload && payload.wireId)) || null;
  const where = wire ? ` · ${labelOf(m, wire.from.node)} → ${labelOf(m, wire.to.node)}` : '';
  const max = wire && wire.maxCycles ? Number(wire.maxCycles) : null;
  // P3 gate ask ids are `gate-<wireId>-<deliveryNo>` (spec §5.3); no deliveryNo field rides the payload.
  const m2 = /-(\d+)$/.exec(String((payload && payload.id) || ''));
  const n = m2 ? Number(m2[1]) : max;
  const budget = max ? `  ${n || max}/${max} cycles used` : '';
  return `? Loop gate${where}${budget}`;
}

/** The summary's result line. */
export function formatResultLine(result) {
  const r = result || {};
  if (r.path) return `Result: ${r.path}`;
  if (r.value != null && r.value !== '') return `Result: ${String(r.value)}`;
  return 'Result: completed';
}

/** `9 executions · 12m00s active · $1.23`. */
export function formatTotals({ executions = 0, activeMs = 0, costUsd = 0 } = {}) {
  return `${executions} execution${executions === 1 ? '' : 's'} · ${fmtDur(activeMs)} active · ${usd(costUsd)}`;
}
```

- [ ] Step 4: `node --test test/cli-exec-render.test.mjs` — `Expected: # pass 5 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P6 — pure CLI exec formatter`

### Task 16: CLI — exec rendering, gate header, summary, `--workflow` refusal, HELP

**Files:** modify `src/cli/worca-cc.mjs` (`HELP :182-220`, `phaseLabel :245` / `statusMark :252` **kept for v1**, `askGate :318`, `attachAndDrive :370`, the `orch.on('phase')` handler `:375`, the summary `:449-462`, `cmdRun`'s `createOrchestrator` call `:1526`); modify `test/cli-exec-render.test.mjs`.

- [ ] Step 1: **Verify P2's delta.** `grep -n "assertRunnableWorkflow" src/core/workflows.mjs src/cli/worca-cc.mjs ui/server.mjs`. P2b lands the function; if the CLI does not yet call it, Step 4 adds the call. **Record which branch you took in the commit body.**
- [ ] Step 2: Write the failing test — append to `test/cli-exec-render.test.mjs`

```js
test('the CLI refuses an archived workflow with the v2-upgrade message, exit 2', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url)), 'utf8');
  assert.match(src, /assertRunnableWorkflow/, 'the CLI validates --workflow through the shared guard');
  assert.match(src, /orch\.on\('exec'/, 'exec lines replace the phase renderer on v2 runs');
  assert.match(src, /worca — node-graph multi-agent pipelines/, 'the HELP headline is updated');

  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'worca-p6-cli-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  const { _resetForTests, getDb } = await import('../src/core/db.mjs');
  _resetForTests();
  try {
    const { assertRunnableWorkflow, writeGraphWorkflow } = await import('../src/core/workflows.mjs');
    await writeGraphWorkflow({ id: 'wf_old', name: 'Old', domain: 'dev', nodes: [], wires: [] });
    getDb().prepare("UPDATE workflows SET version = 1, archived_at = '2026-08-26T00:00:00Z' WHERE id = 'wf_old'").run();
    await assert.rejects(() => assertRunnableWorkflow('wf_old'), (e) => {
      assert.equal(e.code, 'ARCHIVED');
      assert.equal(e.message, 'workflow "wf_old" was archived by the v2 upgrade (v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer');
      return true;
    });
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
    await rm(home, { recursive: true, force: true });
  }
});
```

- [ ] Step 3: `node --test test/cli-exec-render.test.mjs` — `Expected: AssertionError: The input did not match the regular expression /orch\.on\('exec'/`.
- [ ] Step 4: Implement in `src/cli/worca-cc.mjs`:
  - import at the top: `import { formatExecLine, formatGateHeader, formatResultLine, formatTotals } from './render.mjs';`
  - `HELP` (`:182`): headline → `worca — node-graph multi-agent pipelines`; the `--workflow` line → `  --workflow <id>          Saved pipeline template to run (default: wf_default)`.
  - **Keep** `phaseLabel` and `statusMark` — the v1 engine is still live until P8.
  - `attachAndDrive` (`:374-377`) — replace the single `orch.on('phase', …)` with:
    ```js
    // v2 runs render their `exec` stream; the derived `phase` shim they ALSO emit
    // would double every line, so the v1 renderer is gated on the manifest.
    const graphRun = () => !!(orch.state && orch.state.stepper && orch.state.stepper.version === 2);
    orch.on('phase', ({ phase, cycle, status }) => {
      if (graphRun()) return;
      out(`${statusMark(status)} ${c('bold', phaseLabel(phase, cycle))} ${c('gray', status)}`);
    });
    orch.on('exec', (ev) => {
      const line = formatExecLine(ev, orch.state && orch.state.stepper, { color: c });
      if (line) out(line);
    });
    ```
    (`token` events are deliberately NOT subscribed.)
  - `askGate` (`:318`) — signature `async function askGate(rl, issues, header)`; first line becomes
    `out(c('yellow', c('bold', header || 'Loop gate — maximum cycles reached.')));`
    and the `question` handler's gate arm passes `formatGateHeader(payload, orch.state && orch.state.stepper)` when the run is a graph run (`payload` = the whole event object, which carries `wireId`).
  - the summary (`:449-462`) — inside the `done` arm, after `Pipeline complete.`:
    ```js
    const st = orch.state || {};
    if (st.stepper && st.stepper.version === 2) {
      if (st.endReached === false) out(c('yellow', 'Finished at quiescence — End not reached'));
      else out(formatResultLine(st.result));
      const execs = (Array.isArray(st.steps) ? st.steps : [])
        .filter((s) => s && !BOOKEND_EXECUTION_IDS.includes(s.executionId || s.key)).length;
      out(formatTotals({ executions: execs, activeMs: st.totalActiveMs, costUsd: st.totalCostUsd }));
    }
    ```
    (the `Pipeline directory:` line stays last, unchanged.)
  - `cmdRun` (`:1526`) — before `createOrchestrator({…})`:
    ```js
    if (flags.workflow) {
      const { assertRunnableWorkflow } = await import('../core/workflows.mjs');
      try { await assertRunnableWorkflow(flags.workflow); }
      catch (e) { fail(e && e.code === 'ARCHIVED' ? e.message : `unknown workflowId "${flags.workflow}"`); }
    }
    ```
    `fail()` writes `worca: <msg>` to stderr and exits 2 (`:165`).
- [ ] Step 5: `node --test test/cli-exec-render.test.mjs test/cli-resume.test.mjs test/cli-budget-gates.test.mjs` — `Expected: # fail 0` (`cli-resume` pins no phase output).
- [ ] Step 6: Commit — `worca: Node-graph v2 P6 — CLI exec rendering, gate header, summary, archived refusal`

### Task 17: P6b — full suite, manual verification, handoff

- [ ] Step 1: `npm test 2>&1 | tail -20`
  `Expected:` **BASELINE + 49** passing, `# fail 0` — 36 from P6a (20 `test/ui-run-decor.test.mjs`, 16 `test/ui-run-hosts.test.mjs`) plus 13 from P6b (3 `test/log-filter.test.mjs`, 1 `test/ui-log-filters-row.test.mjs`, 1 `test/ui-run-hosts.test.mjs`, 2 `test/ui-subagent-cycle-split.test.mjs`, 6 `test/cli-exec-render.test.mjs`).
- [ ] Step 2: Sentinels this plan OWES P7 — both must print:
  ```bash
  grep -q "export function decorFromState" ui/public/graph/run-decor.mjs && echo SENTINEL-1-OK
  test -f src/cli/render.mjs && grep -q "export function formatExecLine" src/cli/render.mjs && \
  grep -q "export function fmtDur" src/cli/render.mjs && echo SENTINEL-2-OK
  ```
- [ ] Step 3: Guard sweep — all four must print nothing:
  ```bash
  grep -rn "card.style.height" ui/public/graph/run-decor.mjs ui/public/graph/run-hosts.mjs
  grep -rn "worca-cc" ui/public/graph/*.mjs src/cli/render.mjs        # product name is "worca"
  grep -rn "paintLegacyStrip" ui/public/                              # P8 owns the legacy strip
  git status --porcelain -- docs/superpowers                          # never staged
  ```
- [ ] Step 4: **Manual checklist** (a live mock run; no server/browser command belongs in the suite — do this by hand, or hand it to the user):
  1. `WORCA_MOCK=1 node src/cli/worca-cc.mjs --prompt "add a flag" --project <dir> --workflow wf_default_v2 --yes` — the terminal shows `▶ Planner #1`, `✓ Planner #1  …s · $0.00`, a `· fix ← Reviewer` loop start on the second implementer cycle, `■ End ← …`, then `Pipeline complete.` / `Result: …` / `N executions · … active · $…` / `Pipeline directory: …`.
  2. `npm run ui` (or `node ui/server.mjs`) → **Running list, Detailed density**: the card shows a 300px graph, fit, non-interactive; clicking it opens `#running/<id>`; the meta line reads `… · 3/6`. Switch to **Compact**: no graph, chip reads `3/6 done`.
  3. **Running detail**: the graph is 360–600px tall; the page scrolls normally over it until you click into it; after a click, plain wheel pans and the hint chip disappears; ⌘+wheel zooms without a click; Escape releases it. A node's footer expands to 22px rows; a row click narrows the live log to that execution and the `.log-f-exec` chip appears; the `×` clears it.
  4. A loop wire shows the amber `2×` badge (tooltip `2 of 3 cycles`); the in-flight execution's trigger wire marches; the run finishes and NOTHING marches.
  5. Pause the run: the node shows the amber pip; resume: it goes back to active.
  6. **History detail** for the same run: the same graph, no model/effort anywhere (D5), the DURATION card's sub-line reads `9 executions · 2 loop deliveries`, and the End card's basename link opens the viewer with the file's text.
  7. A run that drained without End: the amber `finished at quiescence — End not reached` banner appears once on Running detail AND History detail, and the End card is dashed/faded.
  8. Open a **v1** run in History (any pre-P6 row): the old column strip renders exactly as before — no graph, no banner, `step 3/7 · Refine` in the header.
- [ ] Step 5: Commit — `worca: Node-graph v2 P6 — run monitor v2 + CLI green (P6b)`
- [ ] Step 6: **Handoff.** This plan is `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P6-run-monitor-v2-cli.md`. P7 (Agents view port editor + agent-gen v2 + plugin API 3) starts from the sentinels in Step 2. Do NOT push; do NOT commit anything under `docs/superpowers/`.
## Clarifications (Q&A)

- **D1** — Is P6 one document or two? → **One document, two independently-green halves (P6a / P6b) split at an explicit marker; either half may be executed as its own pipeline run (user decision 2026-08-26).**
- **D2 / spec §7.6–§8** — Zoom clamps per surface? (D2 itself fixes only "no on-canvas controls" and the composer's 0.4–1.6; the per-mode clamps are the spec's.) → **Composer 0.4–1.6, monitor 0.3–1.6, static 0.3–1.0; fit never magnifies past 1×; no on-canvas controls anywhere (user decision 2026-08-26).**
- **D5** — Where does the run graph render? → **(a) the Running LIST card at Detailed density (auto-fit, non-interactive, click → detail), (b) Running detail, (c) History detail; compact density renders NO graph (user decision 2026-08-26).**
- **D8/a** — Does the executions footer overlay the card or grow it? → **It GROWS the card via `view.setFooter` → `nodeSize`; anchors are top-relative so no wire re-routes, and overlapping a card below is accepted (user decision 2026-08-26).**
- **D8/b** — Do the detail graphs capture the wheel? → **Only once ENGAGED (pointerdown inside or Tab); ⌘/Ctrl+wheel and pinch are always captured; Escape or an outside pointerdown disengages; a hover hint chip says "click to pan · ⌘+scroll to zoom" (user decision 2026-08-26).**
- **D9** — Two log-filter bars or one markup? → **ONE markup, `#run-card-tpl .log-filters`, cloned by History; the `.log-f-step` select is re-purposed as the node select rather than a fifth control being added (History-detail lock D9).**
- **D13/D5-hist** — Model + effort on the run surfaces? → **Running may show `model · effort` (from the manifest); History shows it NOWHERE (History-detail lock D5).**
- **D15** — Progress bar or number? → **A number: `3/6` on the card meta, `3/6 done` on the compact chip and `.rd-step`; a bar is forbidden (Running-page lock D15).**
- **C16** — May `paintRdHeader` change more than the meta? → **No. Only the `.rd-meta` segment list changes; the disabled-rule block and the single `.rd-pause` control are untouched, and `RD_TERMINAL` stays declared once (Running-page lock C16/C6).**
- **P6-1** — What exactly is the decor bag? → **The frozen shape in Task 1 (`status`, `footers`, `totals`, `colors`, `liveWireIds`, `loopBadges`, `gate`, `endResult`, `progress`, `activeNodes`, `warnings`, `quiescent`, `executions`, `loopDeliveries`, `nodeIds`, `wireIds`, `expanded`); `decorFromState` is pure and the host adds `run`/`runId`/`mode`/`histKey` (planner default).**
- **P6-2** (P5a Task 2 ships it; this plan consumes) — How does the footer reach the view without run-decor writing heights? → **`view.setFooter(nodeId, bands)` takes a list of 26/22px BANDS (`fan` · `strip` · `exec` · `result`); `footerRows = bands.length` feeds `nodeSize`, which reproduces §7.4's `FOOT_H + (rows−1)·EXEC_ROW_H` exactly (planner default).**
- **P6-3** (P5a Task 2 ships them; this plan consumes) — Where do the per-card ornaments live? → **Two additive view fast paths, `setNodeChrome(nodeId, {color, gate, totals})` and `setWireBadge(wireId, badge)`; `setNodeChrome` also stamps `run-node` + `data-id` so the existing 1 s `.run-node[data-id] .dur` tick keeps working (planner default).**
- **P6-4** — Where do the host adapters live? → **A new `ui/public/graph/run-hosts.mjs` exporting `mountRunGraph(hostEl, opts)`; the accordion (`Map<runId,nodeId>`) collapses into the mount instance, which clears `expanded` when `update()` sees a new runId (planner default).**
- **P6-5** — `paintGraphFor`'s third argument? → **The decor bag itself, carrying `run` (the v1 arm's only input), `runId`, `mode` and, on History, `histKey` (planner default).**
- **P6-6** — What do the status pill / dot / state copy say on a v2 run? → **`activeCopy(r)`: ≥ 2 active → `"2 agents running"`; exactly 1 → the node's manifest label; 0 while live → `"Running"`; the family is the node's palette colour (planner default — the engine is agent-key-free, so v1's "Planning/Refining" vocabulary cannot be reused).**
- **P6-7** — How does the End chip fetch its file? → **New `GET /api/history/:key/:id/artifact?rel=` + `GET /api/workspaces/:id/runs/:runId/artifact?rel=` returning `{rel, text}`; `rel` NEVER reaches the filesystem — `resolveIndexedArtifact(key, id, rel)` selects among the run's `listArtifacts` rows by exact `relPath` or by basename (the engine records absolute paths) and reads the STORED path, run dir first then store root (planner default; same posture as `/diff` `ui/server.mjs:2064`).**
- **P6-8** — Log-filter state field names? → **`{ source, level, step, node, execution, cycle, search }`; the `step` axis survives until P8; the node select carries `data-axis="node"|"step"`; the execution chip is `.log-f-exec` with `data-execution-id` (planner default).**
- **P6-9** — Sub-agent group keys? → **`execKey(nodeId, executionId, cycle)` = `` `${nodeId}|${executionId || (cycle ?? 0)}` `` — one helper across `subsByNodeCycleArrays`, `subsGroupsForRender`, `stepStatusByKey`, the skills/graphify maps; v1 records keep byte-identical keys (planner default; `nodeId|cycle` would merge task slices that share an ordinal).**
- **P6-10** — Execution chip / group label text? → **`<Node label> #<ordinal>`, plus ` · <title>` for a `kind:'task'` row (e.g. `Implementer #1 · Add schema`) — the spec's illustrative `· task 3` becomes the slice's real title, which the ledger always carries (planner default).**
- **P6-11** — CLI duration shape? → **`src/cli/render.mjs`'s own `fmtDur`: `12s` / `1m03s` / `1h01m` (spec §8's CLI block), deliberately different from the UI's `1m 3s` (planner default).**
- **P6-12** — CLI line for a paused execution? → **`⏸ <Label> #<ordinal>  paused`; `skipped` renders nothing; `token` events are never subscribed (planner default — spec §8 lists neither).**
- **P6-13** (settled: P3 emits `taskIndex`/`taskTotal` on `kind:'task'` exec events, P4 persists them — cross-plan pass 2026-08-27) — Where do the CLI's `task 3/7` numbers come from? → **`ev.taskIndex` / `ev.taskTotal` on the `exec` event (from `args.slice.index` and `slice.siblings.length + 1`); when absent the line degrades to `  ▶ task · <title>` (planner default — flagged for the cross-plan pass with P4).**
- **P6-14** — Which ARCHIVED message? → **Spec §4's: `workflow "<id>" was archived by the v2 upgrade (v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer`; `adj-f2.md` §4's variant is superseded (the rebuild spec wins).**
- **P6-15** — Does the CLI still render `phase`? → **Yes, for v1 runs only: `phaseLabel`/`statusMark` stay until P8 and the `phase` handler returns early when `state.stepper.version === 2`, so the derived shim never double-prints (spec §5.7 + §11).**
- **P6-16** — Legacy History strip? → **NOT in P6. `paintLegacyStrip` is P8's; until then a v1 History row keeps today's column painter (spec §8).**

## Known issues (Session A, 2026-08-27 — resolve during this plan's refinement, before execution)

Findings recorded while refining P1/P2 and adjudicating the cross-plan contracts. The refinement reports live (untracked) in `docs/superpowers/plans/2026-08-26-node-graph-v2-reports/`; `xplan-manifest.md` §A is the canonical contract sheet, §D the residual list.

- xplan §D1: Task 3's ~95-line view-code block is a labelled REFERENCE copy of P5's implementation — delete or collapse to the Interfaces block.
- same shim-cell note as P4 (OR chip in cell 1) for `paintGraphFor`'s v1 arm expectations.
