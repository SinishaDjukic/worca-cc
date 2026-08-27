# Node-Graph Pipelines v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear steps+feedbacks pipeline (engine, composer, agent metadata) with a typed-port node graph: wires, conditional outputs, literal loop cycles, Await/Combine flow nodes, free-form canvas, executions collapsible under one block.

**Architecture:** New pure graph core (`src/core/graph/`: ports, validate, scheduler, executor) driven by a rewritten orchestrator dispatch; agent sidecars v2 declare `inputs[]/outputs[]` ports; UI gets a vanilla free-form node editor (`ui/public/graph/`) shared by composer and run monitor. Clean break: template v2 in a new `workflows.graph` column, v1 rows dropped (V17), single engine, single authoring model.

**Tech Stack:** Node >= 22.13 ESM (`.mjs`), `node --test`, jsdom (dev), express + ws (only runtime deps — no new dependencies), SQLite via existing `db.mjs`, vanilla ES-module UI, no build step.

**Spec:** `docs/superpowers/specs/2026-08-10-node-graph-pipelines-design.md` (authoritative for schemas, firing rule, validation rules V1–V18, port table, visual spec). Read it before starting any task.

## Global Constraints

- No new npm dependencies; no build step; UI stays vanilla ES modules.
- All new engine files under `src/core/graph/`; all new UI files under `ui/public/graph/`.
- Tests: `npm test` (`WORCA_HOME=.worca-cc-test node --test test/*.mjs`). Baseline: 4 pre-existing imagegen-skill failures are allowed; nothing else may fail.
- NEVER `git commit` anything under `docs/superpowers/` (plans/specs stay untracked).
- Types are exactly `md | json | void` (+ engine-internal `any` on Await inputs). Blocking = `critical|major` via existing `protocol.mjs` `hasBlocking` — do not reimplement severity logic.
- Phase 3 (Tasks 11–20) lands as ONE atomic PR: engine swap + server + UI + V17 together. Phases 1, 2, 4 are separate PRs.
- Commit messages: conventional style as in repo history (`worca: <summary>` also seen); end with the session trailer per harness rules.
- After Phases 2, 3: re-run plan refinement (Fable max reviewers) on the NEXT phase's tasks before executing them — later tasks here pin interfaces and key code, and must be re-grounded against the then-current tree.

---

## Phase 1 — Graph core (pure modules, zero callers) [PR1]

### Task 1: Canonical fixtures module

**Files:**
- Create: `src/core/graph/fixtures.mjs`
- Test: `test/graph-fixtures.test.mjs`

**Interfaces:**
- Produces: `FIXTURE_DEFAULT` (wf_default as template v2), `FIXTURE_FLOW` (mockup-shaped graph with await), `FIXTURE_PORTS` (static port map for both fixtures, keyed by agent key), `portsFnFor(fixturePorts)` → `(node) => {inputs, outputs}`.
- These fixtures are the shared contract stub for ALL graph tests (engine and UI). UI tests import the same file via relative path.

- [ ] **Step 1: Write the failing test**

```js
// test/graph-fixtures.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';

test('FIXTURE_DEFAULT is a version-2 template: 1 task node + 5 agent nodes, 9 wires', () => {
  assert.equal(FIXTURE_DEFAULT.version, 2);
  assert.equal(FIXTURE_DEFAULT.nodes.length, 6);
  assert.equal(FIXTURE_DEFAULT.wires.length, 9);
  assert.equal(FIXTURE_DEFAULT.nodes.filter((n) => n.kind === 'task').length, 1);
  assert.equal(FIXTURE_DEFAULT.nodes.filter((n) => n.kind === 'agent').length, 5);
  assert.ok(FIXTURE_DEFAULT.nodes.every((n) => typeof n.x === 'number'));
});

test('portsFnFor resolves agent ports and synthesizes await ports from arity', () => {
  const ports = portsFnFor(FIXTURE_PORTS);
  const reviewer = FIXTURE_DEFAULT.nodes.find((n) => n.key === 'reviewer');
  const p = ports(reviewer);
  assert.deepEqual(p.inputs.map((i) => i.id), ['plan', 'done']);
  assert.deepEqual(p.outputs.map((o) => [o.id, o.when]), [['review', 'blocking'], ['pass', 'clean']]);
  const awaitNode = FIXTURE_FLOW.nodes.find((n) => n.kind === 'await');
  const ap = ports(awaitNode);
  assert.equal(ap.inputs.length, awaitNode.config.arity);
  assert.equal(ap.inputs[0].type, 'any');
  assert.deepEqual(ap.outputs.map((o) => o.id), ['out']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --test test/graph-fixtures.test.mjs`
Expected: FAIL — cannot find module `../src/core/graph/fixtures.mjs`.

- [ ] **Step 3: Write the module**

`FIXTURE_DEFAULT` = the wf_default v2 JSON from spec §1 verbatim (nodes n_task/n_clarify/n_plan/n_refine/n_impl/n_review; wires w1–w9 — w1/w2 = task fan-out to clarify.task/planner.task; w5 (refine self-loop) and w9 (review→fix) carry `config: { maxCycles: 3 }`).
`FIXTURE_PORTS` = the spec §5 port table as data, for all 11 builtin keys, e.g.:

```js
export const FIXTURE_PORTS = {
  clarify: {
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json' }],
  },
  planner: {
    inputs: [
      { id: 'task', type: 'md', required: true },
      { id: 'answers', type: 'json', required: false },
      { id: 'revise', type: 'md', required: false, loop: true },
    ],
    outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}{vsuffix}.md', store: 'project' }],
  },
  refiner: {
    verdict: { filename: 'refine-review-cycle{cycle}.json' },
    inputs: [
      { id: 'plan', type: 'md', required: true },
      { id: 'revise', type: 'md', required: false, loop: true },
    ],
    outputs: [
      { id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md', store: 'project' },
      { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', store: 'project' },
    ],
  },
  implementer: {
    sideEffect: 'code',
    inputs: [
      { id: 'plan', type: 'md', required: true },
      { id: 'fix', type: 'md', required: false, loop: true },
      { id: 'task', type: 'json', required: false, expands: true },
      { id: 'start', type: 'void', required: false },
    ],
    outputs: [{ id: 'done', type: 'void', when: 'always' }],
  },
  reviewer: {
    verdict: { filename: 'impl-review-cycle{cycle}.json' },
    inputs: [
      { id: 'plan', type: 'md', required: true },
      { id: 'done', type: 'void', required: false },
    ],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-impl-review.md', store: 'project' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  // ...planReviewer, decomposer, manualTestsChecklist, manualWebUiTesting,
  // workspaceReviewer, workspaceScanner — copy exactly from spec §5 table.
};

export function portsFnFor(fixturePorts) {
  return (node) => {
    if (node.kind === 'agent') return fixturePorts[node.key];
    if (node.kind === 'task') {
      return { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] };
    }
    const arity = node.config?.arity ?? 2;
    const ins = Array.from({ length: arity }, (_, i) => ({
      id: `in${i + 1}`, type: node.kind === 'combine' ? 'md' : 'any', required: true,
    }));
    const out = { id: 'out', type: node.kind === 'combine' ? 'md' : 'any', when: 'always' };
    return { inputs: ins, outputs: [out] };
  };
}
```

`FIXTURE_PORTS` stores the CANONICAL NORMALIZED port shape — every default materialized (`required`, `when: 'always'`, `store: 'run'`) so the Task 7 drift guard compares like with like. No `seed` field exists (Amendment c).

`FIXTURE_FLOW` (complete, verbatim — Task 4 case 4 and Task 26 depend on it):

```json
{ "id": "wf_flow_fixture", "name": "Flow", "version": 2, "domain": "coding",
  "nodes": [
    { "id": "n_plan",   "kind": "agent", "key": "planner",              "x": 40,   "y": 160, "config": {} },
    { "id": "n_refine", "kind": "agent", "key": "refiner",              "x": 320,  "y": 140, "config": {} },
    { "id": "n_impl",   "kind": "agent", "key": "implementer",          "x": 320,  "y": 420, "config": {} },
    { "id": "n_review", "kind": "agent", "key": "reviewer",             "x": 640,  "y": 420, "config": {} },
    { "id": "n_await",  "kind": "await", "x": 900, "y": 200,            "config": { "arity": 2 } },
    { "id": "n_check",  "kind": "agent", "key": "manualTestsChecklist", "x": 1160, "y": 260, "config": {} }
  ],
  "wires": [
    { "id": "w1", "from": {"node":"n_plan","port":"plan"},     "to": {"node":"n_refine","port":"plan"} },
    { "id": "w2", "from": {"node":"n_refine","port":"revise"}, "to": {"node":"n_refine","port":"revise"}, "config": { "maxCycles": 3 } },
    { "id": "w3", "from": {"node":"n_refine","port":"plan"},   "to": {"node":"n_impl","port":"plan"} },
    { "id": "w4", "from": {"node":"n_refine","port":"plan"},   "to": {"node":"n_review","port":"plan"} },
    { "id": "w5", "from": {"node":"n_impl","port":"done"},     "to": {"node":"n_review","port":"done"} },
    { "id": "w6", "from": {"node":"n_review","port":"review"}, "to": {"node":"n_impl","port":"fix"},     "config": { "maxCycles": 3 } },
    { "id": "w7", "from": {"node":"n_refine","port":"plan"},   "to": {"node":"n_await","port":"in1"} },
    { "id": "w8", "from": {"node":"n_review","port":"pass"},   "to": {"node":"n_await","port":"in2"} },
    { "id": "w9", "from": {"node":"n_await","port":"out"},     "to": {"node":"n_check","port":"plan"} }
  ] }
```

Amendment c: FIXTURE_FLOW additionally contains `{ "id": "n_task2", "kind": "task", "x": -220, "y": 160, "config": {} }` and wire `{ "id": "w10", "from": {"node":"n_task2","port":"task"}, "to": {"node":"n_plan","port":"task"} }` — the planner's entry. Await `out` is `any` at declaration; its effective type (md, via w7's source port) is resolved by `resolveAwaitOutType` (Task 2) and used by validation V8 (Task 3).

- [ ] **Step 4: Run test to verify it passes** — same command, expected PASS.
- [ ] **Step 5: Commit** — `git add src/core/graph/fixtures.mjs test/graph-fixtures.test.mjs && git commit -m "feat(graph): canonical v2 template fixtures"`

---

### Task 2: ports.mjs — tokens, loop classification, conditional routing, readiness

**Files:**
- Create: `src/core/graph/ports.mjs`
- Test: `test/graph-ports.test.mjs`

**Interfaces (produced, later tasks depend on these exact names):**

```js
export function makeToken({ seq, type, path = null, value = null, meta = null, sourceExecutionId, forced = false })
export function classifyLoops(template, portsFn)
// -> { loopWires: Set<wireId>, loopInputs: Set<'nodeId.port'>, sccs: string[][], order: string[] }
//    order = deterministic launch order: condensation topo order, ties by nodeId.
export function firedOutputs(outputs, verdict /* normalized review or null */)
// -> outputs where when==='always', plus (hasBlocking ? blocking : clean) side. Import hasBlocking from ../protocol.mjs.
export function resolveAwaitOutType(node, template, portsFn) // -> 'md'|'json'|'void' from in1's wire source port
export function isReady(node, ctx)
// ctx = { portsFn, wiredIn: Map<port, wireId>, loopInputs, tokens: Map<'nodeId.port', Token>,
//         consumed: Map<port, seq>, everRan: boolean, awaitAll: boolean, isFlow: boolean }
// Implements spec §3 firing rule exactly (first-run barrier over wired non-loop inputs;
// re-run: any fresh, or awaitAll => all wired non-loop fresh OR fresh loop token; flow nodes: all fresh).
```

- [ ] **Step 1: Write the failing tests** (one file, these cases minimum)

```js
// test/graph-ports.test.mjs — import from fixtures; assert:
// classifyLoops(FIXTURE_DEFAULT): loopWires == {w5, w9}; loopInputs == {'n_refine.revise','n_impl.fix','n_plan.revise'} (meta-derived — planner.revise is loop:true even though unwired here);
//   sccs contain ['n_refine'] (self) and a 2-node SCC {n_impl,n_review}; w6 (done, when always) NOT a loop wire.
// firedOutputs(reviewer.outputs, {issues:[{severity:'major',...}]}) -> ['review']
// firedOutputs(reviewer.outputs, {issues:[{severity:'minor',...}]}) -> ['pass']
// firedOutputs(planner.outputs, null) -> ['plan']
// resolveAwaitOutType(awaitNode of FIXTURE_FLOW) -> 'md'
// isReady first-run: implementer with plan token present, fix loop-input absent -> true
// isReady first-run: reviewer with plan token but no done token (done wired) -> false
// isReady re-run: reviewer everRan, fresh done token (seq > consumed) -> true
// isReady re-run awaitAll: node with 2 wired non-loop inputs, only one fresh -> false; both fresh -> true;
//   fresh loop token alone -> true even with awaitAll.
// isReady: task node (zero inputs) is ready iff never ran; agent node with an unwired REQUIRED input is never ready (validation V9 prevents this at save — assert defensive behavior anyway).
// order: n_task first, then n_clarify, n_plan, n_refine, then n_impl/n_review.
```

Write them as real `test()` blocks with `assert.deepEqual`/`assert.equal` — copy the fixture wiring facts above into assertions.

- [ ] **Step 2: Run to verify FAIL** — module not found.
- [ ] **Step 3: Implement.** Tarjan iteratively (explicit stack — graphs are small but avoid recursion limits by habit):

```js
export function classifyLoops(template, portsFn) {
  const nodeById = new Map(template.nodes.map((n) => [n.id, n]));
  const wires = template.wires.filter((w) => nodeById.has(w.from.node) && nodeById.has(w.to.node));
  // dangling endpoints are V5's problem — never crash here (validator collects all errors)
  const adj = new Map(template.nodes.map((n) => [n.id, []]));
  for (const w of wires) adj.get(w.from.node).push(w.to.node);
  const sccs = tarjan(adj); // standard; ties broken by sorted nodeId iteration
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const nontrivial = new Set(
    sccs.map((scc, i) => (scc.length > 1 ? i : -1)).filter((i) => i >= 0),
  );
  const selfWired = new Set(template.wires.filter((w) => w.from.node === w.to.node).map((w) => w.from.node));
  const loopWires = new Set();
  for (const w of wires) {
    const sameScc = sccOf.get(w.from.node) === sccOf.get(w.to.node) &&
      (nontrivial.has(sccOf.get(w.from.node)) || selfWired.has(w.from.node));
    if (!sameScc) continue;
    const out = portsFn(nodeById.get(w.from.node)).outputs.find((o) => o.id === w.from.port);
    if (out && out.when === 'blocking') loopWires.add(w.id); // blocking-source rule (spec amendment b)
  }
  // loop INPUTS come from meta `loop: true`, not from wiring — stays correct through Merge nodes
  const loopInputs = new Set();
  for (const n of template.nodes) {
    for (const inp of (portsFn(n)?.inputs || [])) {
      if (inp.loop) loopInputs.add(`${n.id}.${inp.id}`);
    }
  }
  const order = condensationTopo(sccs, adj); // Kahn on condensation, ties by min nodeId, flatten sorted
  return { loopWires, loopInputs, sccs, order };
}
```

`isReady` implements the spec rule literally; `firedOutputs` uses `hasBlocking` from `src/core/protocol.mjs` (import path `../protocol.mjs`).

- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `feat(graph): ports, loop classification, readiness`

---

### Task 3: validate.mjs — rules V1–V19

**Files:**
- Create: `src/core/graph/validate.mjs`
- Test: `test/graph-validate.test.mjs`

**Interfaces:**
- Produces: `validateGraph(template, portsFn) -> { errors: [{code, msg, nodeId?, wireId?}], warnings: [...] }`. Codes are `'V1'..'V19'` exactly as spec §2. Consumed by: server save route (Task 14), plugin import (Task 24), UI adapter (Task 16).

- [ ] **Step 1: Failing tests.** One test per rule, built by mutating structuredClone(FIXTURE_DEFAULT):
  - Baseline: `validateGraph(FIXTURE_DEFAULT, portsFn).errors` AND `validateGraph(FIXTURE_FLOW, portsFn).errors` are both `[]` (the flow fixture exercises await out-type resolution).
  - V1–V4: version 1 rejected; duplicate node id; bad id chars; `kind:'agent'` without key; unknown agent key; `workspaceScanner` as node.
  - V5: wire to a nonexistent node AND to a nonexistent port → errors, NO crash (exercises the classifyLoops dangling guard).
  - V6: duplicate wire id; duplicate (from,to) pair.
  - V7: add second wire into `n_impl.plan` → error with that wireId.
  - V8: wire `n_clarify.answers` (json) → `n_refine.plan` (md) → type error.
  - V9: delete wire w6 (refiner.plan→implementer.plan) → error "required input implementer.plan unwired"; unwired OPTIONAL input (n_plan.revise) → NO error.
  - V20: delete the n_task node → error; add a second task node → error; task node's `task` output with zero wires → error.
  - V10: replace w9's from-port `review` with a cloned always-output → "cycle without blocking-source edge" error naming the w8/w9 cycle set.
  - V11: SCC where every member has a required input fed only from inside the SCC → deadlock error (construct a 2-node cycle of always... note: such a graph already fails V10; build the V11 case with a conditional wire present but required inputs unsatisfiable — reviewer.plan wired from INSIDE the SCC).
  - V12: await arity 1 → error; combine with unwired in2 → error; await with in1 unwired → error; merge with mixed input types (md + json) → error.
  - V13: `maxCycles` on non-loop wire w2 → error; `when:'sometimes'` in portsFn → error.
  - V14: `expands` on an md input (mutated portsFn) → error.
  - V15: node with no path from any entry → warning. V16: awaitAll with 1 wired input → warning. V17: unknown `config` key → warning. V18: two always md inputs, no awaitAll → warning. V19: blocking output wired into an input without `loop:true` (e.g. reviewer.review → checklist.plan) → warning; same wire into a merge input → NO warning.
  Assert `code`, and that errors block (`errors.length`) vs warnings don't.
  V8 must resolve Await output types via `resolveAwaitOutType` before comparing (chained awaits resolve recursively; unwired in1 is already a V12 error, so resolution may return null there and V8 skips).
- [ ] **Step 2: FAIL run.** — module not found.
- [ ] **Step 3: Implement** — straight-line checks in rule order; reuse `classifyLoops` for V10/V11; keep each rule a small named function so error text lives beside its check. Deadlock V11: for each nontrivial SCC, require ≥1 node whose required inputs are all (wired-from-outside-SCC | optional | loop input).
- [ ] **Step 4: PASS run.**
- [ ] **Step 5: Commit** — `feat(graph): validator v2 (V1-V18)`

---

### Task 4: scheduler.mjs — token store, firing loop, gates, quiescence, snapshot

**Files:**
- Create: `src/core/graph/scheduler.mjs`
- Test: `test/graph-scheduler.test.mjs`

**Interfaces:**

```js
export function createScheduler({
  template, portsFn,
  execute,            // async ({node, executionId, ordinal, bindings, trigger}) -> {verdict?, outputs?:{[port]:{path?,value?}}, error?}
  taskArtifact,       // { path } — pre-rendered task document; the task node's execution emits it as its token
  onEvent,            // (name, payload) => void  — 'exec' | 'token' | 'gate'
  ask,                // async ({kind:'gate', wireId, issues}) -> 'another' | 'continue'
  maxParallel = 4,
  snapshot = null,    // resume-v2 object to restore from
  onSnapshot,         // (snapshotObject) => void — called after every publish
})
// -> { run(): Promise<'done'|'error'>, pause(), abort(), getState(): {active, executions, tokens} }
```

Consumed by Task 13 (orchestrator binds execute/ask/onEvent/onSnapshot to real machinery).

- [ ] **Step 1: Failing tests** with a scripted fake `execute` (records calls, returns canned verdicts):
  1. **Default-graph happy path with loop**: verdict script — refiner c1 blocking, c2 clean; reviewer c1 blocking, c2 clean. Assert execution sequence exactly: `task c1, clarify c1, planner c1, refiner c1, refiner c2, implementer c1, reviewer c1, implementer c2, reviewer c2` and run resolves `'done'` (quiescence). Assert reviewer.pass token exists after c2, and the review token is superseded — pinned as: implementer's `consumed['fix']` equals the review token's seq and no node is ready at quiescence.
  2. **maxCycles gate**: script refiner always-blocking with w5 maxCycles 2; `ask` resolves 'continue' → assert refiner ran EXACTLY 3 executions (2 allowed deliveries + the held 3rd firing), held token discarded, `plan` (clean side) force-fired with `forced:true` AND `meta.issues` carrying the held verdict's open issues, downstream implementer ran.
  3. **Gate 'another'**: same but 'another' once → one extra refine cycle then clean.
  4. **awaitAll semantics**: FIXTURE_FLOW await node fires only after BOTH in1 (refiner.plan) and in2 (reviewer.pass) fresh; re-emits payload token type md; checklist fires after await.
  5. **Determinism**: two runs with same script produce identical exec event sequences.
  6. **Snapshot/restore**: kill after reviewer c1 (script `execute` throws a sentinel pause), createScheduler with snapshot → run completes with implementer c2 next; no re-run of finished executions.
  7. **Fail-fast**: execute error on implementer → run 'error', no further launches.
  8. **maxParallel cap**: fixture with one task node fanning to 3 independent agent nodes, maxParallel 2 → never more than 2 concurrent agent `execute`s (count via in-flight tracker in the fake; the task node bypasses the cap).
  9. **pause()/resume via public API**: pause mid-run → run resolves 'paused'-equivalent, snapshot handed to onSnapshot; new scheduler from that snapshot completes with no re-run of finished executions.
  10. **abort()**: mid-flight abort → in-flight signal fired, no further launches.
  11. **Merge OR-join**: synthetic fixture — two verdict nodes' blocking outputs → merge.in1/in2 → consumer with a `loop:true` input; script them blocking in DIFFERENT iterations → merge fires on each alone, consumer re-fires per emission, no deadlock (this is the "Full" template's double-review-loop shape).
  Write each as concrete `test()` with an event-collector array asserted via `assert.deepEqual`.
- [ ] **Step 2: FAIL run.**
- [ ] **Step 3: Implement** per spec §3 algorithm (single-owner loop; global seq; `consumed` recorded at bind; wire `{deliveries, allowance}`; held-gate queue; `rerunPending` coalescing; launch order from `classifyLoops(...).order`; flow-node executions inline; `onSnapshot` after every publish with the exact resume-v2 shape from spec §3).
- [ ] **Step 4: PASS run.**
- [ ] **Step 5: Commit** — `feat(graph): dataflow scheduler with loops, gates, snapshots`

---

### Task 5: builtin-workflows.mjs — GRAPH_DEFAULT_WORKFLOW

**Files:**
- Create: `src/core/graph/builtin-workflows.mjs`
- Test: `test/graph-builtin-workflows.test.mjs`

**Interfaces:**
- Produces: `GRAPH_DEFAULT_WORKFLOW` (frozen, id `wf_default`, version 2 — same object shape as FIXTURE_DEFAULT but the shipping constant; fixtures import from HERE after this task to avoid drift: refactor fixtures.mjs to `export { GRAPH_DEFAULT_WORKFLOW as FIXTURE_DEFAULT }`).

- [ ] Steps: failing test asserting `Object.isFrozen(GRAPH_DEFAULT_WORKFLOW)` + literal shape (id `wf_default`, version 2, 6 nodes incl. one `task`, 9 wires, w5/w9 `config.maxCycles === 3`) — NOT deepEqual against FIXTURE_DEFAULT (after the re-export that would be a tautology; the re-export itself is the drift guard); implement; pass; commit `feat(graph): builtin default workflow v2`. Run FULL suite (`npm test`) — Phase 1 adds no callers, nothing else may break.

---

## Phase 2 — Agent meta v2, sidecars, executor, prompt pinning [PR2]

### Task 6: agent-registry meta v2

**Files:**
- Modify: `src/core/agent-registry.mjs` (normalizeMeta ~:179; DEFAULT_SPEC :40-55 stays for now — see shim; description-derivation :326-332)
- Test: `test/agent-registry-v2.test.mjs`

**Interfaces:**
- Produces: registry entries expose `inputs`, `outputs`, `verdict`, `sideEffect`, `mockRole` (NEW field, not v1-retained), `metaVersion:2`, `portSummary` (derived text — do NOT reuse the name `descriptionDerived`: today that is a BOOLEAN "description came from frontmatter" flag with a live test, `test/agent-derived-description.test.mjs`, which stays green); v1 sidecars (no `metaVersion:2`) are SKIPPED with `console.warn` containing the exact string `requires metaVersion 2`. `loopSource` dies (subsumed by `when`). Validation rules from spec §5 enforced in `normalizeMeta` (load: skip+warn) and exported as `validateMetaV2(meta) -> {errors:[string]}` for agent-store 400s. Normalization MATERIALIZES all port defaults (`required:true`, `when:'always'`, `store:'run'`; no `seed` field — Amendment c) — this canonical shape is what FIXTURE_PORTS (Task 1) stores.
- **v1-COMPAT SHIM (critical — keeps the live v1 engine green until Phase 3):** normalizeMeta v2 additionally DERIVES the v1 fields the running engine still reads (`workflows.mjs:315-318`, `channels.mjs:116/:132/:259`, `workflow-validator.mjs:121-181`, `orchestrator.mjs:448/:884`): `consumes` = required non-void input ids mapped to v1 channel names, `optionalConsumes` = optional ones, `produces` = non-void output channel names, `connectsTo: '*'`, `channelDefs` from output filenames, `uiPhase` from the existing key map. `DEFAULT_SPEC` deletion and shim removal happen in Task 25, NOT here. Between PR2 and PR3, `npm test` and `npm run smoke` stay green on the v1 engine.
- Consumes: nothing from Phase 1 (independent).

- [ ] **Step 1: Failing tests**: v2 sidecar loads with ports; v1 sidecar (fixture with `consumes`) skipped + warn; each §5 rule rejects (bad port id, void with filename, verifier without verdict, `loop` on a required input → coerced optional with warning, `expands` on md input, 9-port side, duplicate output ids, `when:'clean'` without verdict…); `portSummary` equals `Reads plan, fix; produces done.`-style text for implementer fixture; SHIM test: v2 reviewer sidecar yields `consumes:['plan']`, `optionalConsumes:['code']`-equivalent per the channel mapping, `produces:['review']`, `connectsTo:'*'`.
- [ ] **Step 2: FAIL.** **Step 3: implement.** **Step 4: PASS.**
- [ ] **Step 5:** Update `test/agent-registry-schema-v2.test.mjs` expectations — run, fix, commit `feat(agents): sidecar metaVersion 2 with typed ports (+v1 engine shim)`.

### Task 7: Rewrite the 11 builtin sidecars + .md `## Ports` sections

**Files:**
- Modify: all `agents/*.meta.json` (11 files) — content = spec §5 table verbatim (same shape as Task 1 FIXTURE_PORTS, plus the retained v1 fields: displayName/color/icon/agentFile/runnerType/scope/domain/order/fanOut/questions trio/promptHints/mockRole).
- Modify: all `agents/worca-cc-*.md` — add the `## Ports` section per spec §5 skeleton: REPLACE the existing `## Inputs (from the task prompt)` heading where present (7 files: code-reviewer, manual-tests-checklist, manual-web-ui-testing, plan-refiner, plan-reviewer, workspace-reviewer, workspace-scanner); INSERT it after the role section in the 4 files that lack the heading (planner, clarify, implementer, decomposer). Verdict/clarify JSON contract sections stay byte-identical; remove filename-convention sentences.
- Test: `test/agents-sidecars-v2.test.mjs`

**Interfaces:**
- Produces: `loadAgentRegistry(DEFAULT_AGENTS_DIR)` returns 11 v2 entries whose ports deep-equal `FIXTURE_PORTS` (single test importing both — THE drift guard between fixtures and shipped data).
- `mockRole` values pin today's writer table — EXACT case strings from the `claude-runner.mjs:645-693` switch: planner→`planner-plan`, refiner→`refiner`, decomposer→`decomposer`, implementer→`implementer`, reviewer→`reviewer`, planReviewer→`plan-review`, workspaceReviewer→`workspace-reviewer`, manualWebUiTesting→`manual-web-ui-testing`, manualTestsChecklist→`manual-tests-checklist`, clarify→`clarify`, workspaceScanner→`workspace-scan`. (Also in the switch, unused by sidecars: `agent-gen`, `generic-producer`, `generic-verifier`.)

- [ ] Steps: write drift-guard test (FAIL), rewrite sidecars + md bodies, PASS, full `npm test` — the Task 6 compat shim keeps engine/channel/composer suites green; expected remaining fallout only in tests asserting raw sidecar file contents (e.g. `test/connects-to.test.mjs` if it reads files directly) — update, each change justified in the commit body. Commit `feat(agents): port-based sidecars v2 + Ports sections`.

### Task 8: executor.mjs — port binding, allocation, verdict routing, flow executors

**Files:**
- Create: `src/core/graph/executor.mjs`
- Test: `test/graph-executor.test.mjs`

**Interfaces:**

```js
export function allocateOutputs({ node, ports, executionId, ordinal, runCtx })
// runCtx = { pipelineDir, projectDir, baseName, datePrefix, workspaceKey, planVersion() }
// -> { [portId]: { path, store } } ; filename tokens {cycle}->ordinal, {vsuffix}->planVersion(), {base}->baseName
// store 'project' resolves via artifacts.mjs planPath/reviewPath helpers (import, don't duplicate).
export function portIoBlock({ node, ports, bindings, outputs })  // -> markdown '## Ports (this run)' block
export async function runAgentExecution(ctx)     // generalizes phases.mjs runGenericProducer/Verifier :1185/:1218
export async function runClarifyExecution(ctx)   // ports variant of orchestrator._runClarifyNode :2391
export function runAwaitExecution({ node, bindings })    // -> { outputs: { out: passthrough of in1 } }
export function runMergeExecution({ node, bindings })    // -> { outputs: { out: freshest input token } } (OR-join)
export function runTaskExecution({ node, taskArtifact }) // -> { outputs: { task: { path: taskArtifact.path } } } (source node, fires once)
export async function runCombineExecution({ node, bindings, allocatedPath })  // concat with '## From <name>' headings
export function readVerdict(verdictPath)         // -> normalized review via protocol.readReview
```

Consumed by Task 13 (`execute` callback wiring). `runAgentExecution` builds prompts from `taskHeader` + `meta.promptHints` + `portIoBlock` + `questionsPromptBlock` + `mockMarkers` and calls the existing `runOpts`/`runClaude` path (`phases.mjs:396`, `claude-runner.mjs:213`) — reuse, don't fork. NOTE: `runOpts` and `mockMarkers` are currently module-PRIVATE in phases.mjs — first step of implementation is exporting them (no behavior change). MOCK markers: `MOCK_ROLE` = `meta.mockRole` (fallback `generic-verifier` when the meta has `verdict`, else `generic-producer`), `MOCK_CYCLE` = execution ordinal — Task 9 pins both, Task 23 only audits. Combine output allocates `combine-<nodeId>-c<ordinal>.md` in pipelineDir. portIoBlock's per-port `as` renderers: `file` (default), `answers`, `fix-review`, `worktree`.

- [ ] **Step 1: Failing tests**: allocation (implementer done:void → no path; reviewer verdict path `impl-review-cycle2.json` at ordinal 2; planner `{base}.md` then `{base}-v2.md` via planVersion counter; store:'project' lands under store dirs — use `useTempHome` helper); portIoBlock lists every bound input as `- **plan** (md) -> /abs/path` and outputs as `Write ... to: /abs/path`; MODE SELECTION: portIoBlock with `fix` bound renders the fix-review directive arm (and the prompt announces fix mode), with `task` bound renders the decomposed-slice arm, planner with `revise` bound renders the REVISE arm; combine concatenation order + headings + its `combine-<nodeId>-c<ordinal>.md` path; await passthrough keeps payload path and type; merge forwards the freshest input token unchanged; task execution emits the taskArtifact path as an md token.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(graph): execution layer (binding, allocation, flow nodes)`

### Task 9: Prompt snapshot pinning

**Files:**
- Create: `test/graph-prompt-parity.test.mjs`

For each of the 11 builtins: assemble the v2 task prompt via `runAgentExecution`'s builder in mock ctx, and assert it CONTAINS every load-bearing line of today's bespoke prompts: absolute output path lines, `MOCK_ROLE`/`MOCK_OUT`/`MOCK_JSON`/`MOCK_CYCLE` markers, verdict-contract reminder line, fan-out directive when enabled, RESUME_HEADER on resumed ctx, PLUS one load-bearing line each from today's implementer FIX-mode prompt and planner REVISE prompt (both still in phases.mjs — mode regressions must fail here). Build the expected-line lists by READING the current builders in `src/core/phases.mjs` (:442 taskHeader; contract-line copies at :872-874 reviewer, :908-910 planReviewer, :681-683 refiner, :952-954 workspaceReviewer, :1118-1120 webui, :1243-1245 generic verifier) BEFORE they are deleted in Phase 3/4 — copy the exact strings into the test.

- [ ] Steps: write test against v2 builder (FAIL if builder incomplete), fix builder until PASS, commit `test(graph): pin load-bearing prompt lines for builtins`.

### Task 10: agent-gen v2 + agent-store validation

**Files:**
- Modify: `src/core/agent-gen.mjs` (`_metaSchemaBlock` :125-142; neighbor context block)
- Modify: `src/core/agent-store.mjs` (save path → `validateMetaV2`, HTTP 400 with rule text)
- Test: `test/agent-gen-v2.test.mjs`, extend `test/agent-store.test.mjs`

- [ ] Steps: failing tests (schema block mentions `metaVersion: 2`, `inputs`, `outputs`, closed type set, and no longer mentions `consumes`/`connectsTo`; generated-meta fixture with 0 outputs rejected; store 400 message equals validateMetaV2 error text), implement, pass, commit `feat(agents): generator + store on meta v2`. Full `npm test`.

---

## Phase 3 — THE BREAK: engine swap + persistence + server + UI [PR3, atomic]

> Re-ground this phase (Fable plan refinement) after Phase 2 lands. Interfaces below are binding; line anchors are as of 2026-08-10 and must be re-verified.

### Task 11: DB migration V17

**Files:**
- Modify: `src/core/db.mjs` (SCHEMA_VERSION 16→17 at :54; ladder :742-782; INCREMENTAL_COLUMNS map declared :555 — `pipeline_steps` row :560, `workflows` row :562)
- Test: `test/migrate-v17.test.mjs` (pattern-copy `test/migrate-v16.test.mjs`)

Migration body (spec §8): `ALTER TABLE workflows ADD COLUMN graph TEXT;` · `DELETE FROM workflows WHERE version = 1;` (log one audit line per deleted row: id + name) · `ALTER TABLE pipeline_steps ADD COLUMN execution_id TEXT;` · `CREATE TABLE config_workflow_wires (workflow_id TEXT, project_key TEXT, wire_id TEXT, max_cycles INTEGER, PRIMARY KEY (workflow_id, project_key, wire_id));`

- [ ] Steps: failing test (seed a v16 DB with 1 v1 workflow row + steps rows; migrate; assert row deleted, columns exist, user_version 17, reopen idempotent), implement, pass, commit `feat(db): V17 graph column, drop v1 templates, execution_id`.

### Task 12: workflows.mjs v2 (store + resolve + manifest)

**Files:**
- Modify: `src/core/workflows.mjs` — writeWorkflow/readWorkflow/listWorkflows to graph column + version 2 (reject version≠2); DELETE `DEFAULT_WORKFLOW` and `rewriteStepperForDecomposition` (:395), import `GRAPH_DEFAULT_WORKFLOW`; `resolveWorkflow` → `resolveGraph(projectDir, workflowId, registry, agentsDir, {isWorkspace})` returning `{ template, ports, nodeCtx }` with per-node model/effort overlay (node > role > global, keep `config.mjs` resolveStepModels inputs) AND per-wire maxCycles overlay merged from the new `config_workflow_wires` table (overlay > template `wire.config.maxCycles` > default 3 — without this merge the Task 11/14 overlay is write-only), workspace reviewer→workspaceReviewer rewrite + port-signature equality assertion (resolve-time, deliberate deviation from spec's "registry load" wording — the assertion needs both entries together); `buildStepperManifest` → `buildGraphManifest(resolved)` returning spec §8 manifest v2 (nodes with ports/loop flags/label/color/model/effort; wires with `loop`; bookends).
- Delete: `src/core/workflow-validator.mjs` (validate.mjs replaces it; update importers: `ui/server.mjs`, `src/core/plugin-workflows.mjs`, AND `src/core/orchestrator.mjs:84`).
- Test: rewrite `test/workflows.test.mjs` (roundtrip v2, resolveGraph model/effort precedence, wire maxCycles precedence overlay>template>3, substitution assertion, manifest shape), delete `test/workflow-validator.test.mjs` in favor of Task 3 suite. Known fallout to update in this task: `test/workflows-db.test.mjs`, `test/workflows-questions.test.mjs`, `test/saved-pipeline-parity.test.mjs`.

- [ ] Steps: failing tests → implement → pass → commit `feat(core): workflows store/resolve/manifest v2`.

### Task 13: Orchestrator swap

**Files:**
- Modify: `src/core/orchestrator.mjs` — delete the v1 dispatch block ~:1722-:2519 EXCEPT the kept machinery inside it (`_runNodeAttempts` :2125, `_runOnce` :2155, `_questionsLoop` :2204 survive; deleted: `_dispatch` :1722, `_runStep` :1937, `_runDecomposedImplement` :2006, `_runNode` :2093, `_bindNodeIo` :2413, `_loopFired` :2494, `_reviewOf` :2506, `_buildResumePoint` :1902); `run()` pre-renders the task artifact (`renderPromptArtifact` text moves here from channels — prompt + extras section), calls `validateGraph(template, portsFn)` after resolveGraph and ABORTS with a clean error on E-rules (templates can go invalid when agent metas change after save — spec §2 says rules block save AND run), then `createScheduler({ template, portsFn, execute, taskArtifact, onEvent, ask: this._ask, onSnapshot })`; `execute` binds `runAgentExecution`/`runClarifyExecution`/flow executors with `_runNodeAttempts/_runOnce/_questionsLoop` machinery re-keyed by executionId (the executionId IS the stepKey: `x:<nodeId>:<ordinal>[:p<P>t<T>]`, stored in `pipeline_steps.execution_id` — this satisfies spec §8's `<nodeId>:<executionId>` keying); `resume()` v2-only + startup sweep marking paused v1 rows interrupted with reason `paused before the graph engine rework — not resumable`; events per spec §3 (`exec`, `token`, state.active[], `question` gains `wireId?` on gates, resolved runtime `graph` included in the FIRST state event); worktree staging hook on `sideEffect:'code'` before publish; TEMPORARY E-guard until Task 21: resolveGraph/validate errors on a WIRED `expands` input ("decomposer fan-out arrives with composite executions — not yet supported on the graph engine"), removed in Task 21. Workspace runs stay FUNCTIONAL in PR3: run() keeps the workspace setup (worktrees, runroot, substitution via Task 12); Task 22 is verification/test-porting, not enablement. portIoBlock lives in executor.mjs; phases.mjs keeps only taskHeader/buildSystemPrompt/questionsPromptBlock/mock markers/workspace blocks/FALLBACK_PROMPTS.
- Delete: `src/core/channels.mjs`, `src/core/runners.mjs`; shrink `src/core/phases.mjs` to the prompt library (taskHeader, buildSystemPrompt, portIoBlock deps, questionsPromptBlock, mock markers, workspace blocks, FALLBACK_PROMPTS reworded).
- Modify: `ui/server.mjs` EVENT_NAMES (:154): replace `'phase'` with `'exec'`, add `'token'`.
- Test: rewrite `test/dispatcher.test.mjs` → `test/orchestrator-graph.test.mjs` (mock-mode end-to-end on GRAPH_DEFAULT_WORKFLOW: exec sequence, loop fix cycle, resume mid-run, gate continue, run-time validateGraph abort when a saved template references a renamed port); update `test/orchestrator-resume.test.mjs`, `test/persist-roundtrip.test.mjs`, `test/spawn-args.test.mjs` expectations.

- [ ] Steps: failing end-to-end mock test first (asserts the Task 4 case-1 sequence through the REAL orchestrator with WORCA_MOCK=1) → swap → pass → chase suite fallout with justification per deletion — known list: `test/channels*.test.mjs` (6 files, module deleted), `test/runners*.test.mjs`, `test/phases-*.test.mjs` (ported to executor tests), `test/server-event-names.test.mjs` ('phase'→'exec'), `test/ui-server-stepper-seed.test.mjs`, `test/graph-build.test.mjs`, remaining `test/orchestrator-*.test.mjs` ports → commit `feat(core)!: graph dataflow orchestrator (v1 engine removed)`.

### Task 14: Server routes v2

**Files:**
- Modify: `ui/server.mjs` — `/api/workflows` GET returns `{ workflows: [GRAPH_DEFAULT_WORKFLOW, ...listWorkflows()] }` (v2 only); POST validates via `validateGraph` + registry portsFn, 422 with `{errors, warnings}`; `/api/agents` returns v2 entries (ports included); run wiring passes new event names; `/api/config` wire-maxCycles overlay endpoints (config_workflow_wires).
- Test: `test/api-workflows.test.mjs` rewrite; CREATE `test/api-agents.test.mjs` (no server-side /api/agents test exists today — new file asserting v2 port payload + workspace-only filtering); update `test/api-workflows-warnings.test.mjs` (validator v2 warning shapes).

- [ ] Steps: failing route tests → implement → pass → commit `feat(server): graph workflow + agent APIs`.

### Task 15: UI graph core (pure modules)

**Files:**
- Create: `ui/public/graph/graph-model.mjs`, `graph-geometry.mjs`, `graph-layout.mjs`, `thumbnail.mjs`, `agents-meta.mjs`
- Test: `test/ui-graph-model.test.mjs`, `test/ui-graph-geometry.test.mjs`, `test/ui-graph-layout.test.mjs`, `test/ui-graph-thumbnail.test.mjs`

Key geometry (pin in tests):

```js
export const NODE_W = 220, HEADER_H = 34, PORT_ROW_H = 24, FOOTER_H = 26, EXEC_ROW_H = 22, SNAP = 11;
export function nodeSize(ports, { footerRows = 0 } = {}) {
  // footerRows: 0 = 8px pad; 1 = AWAIT chip / collapsed executions strip (FOOTER_H);
  // >1 = collapsed strip + (footerRows-1) expanded execution rows (run monitor).
  const rows = Math.max(ports.inputs.length, ports.outputs.length);
  const footer = footerRows === 0 ? 8 : FOOTER_H + (footerRows - 1) * EXEC_ROW_H;
  return { w: NODE_W, h: HEADER_H + rows * PORT_ROW_H + footer };
}
export function portAnchor(node, ports, portId, dir /* 'in'|'out' */) {
  const list = dir === 'in' ? ports.inputs : ports.outputs;
  const i = list.findIndex((p) => p.id === portId);
  return { x: node.x + (dir === 'in' ? 0 : NODE_W),
           y: node.y + HEADER_H + i * PORT_ROW_H + PORT_ROW_H / 2 };
}
export function bezierPath(a, b, { loop = false } = {}) {
  const dx = Math.max(48, Math.min(160, Math.abs(b.x - a.x) * 0.45));
  if (!loop) return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  const bow = 56 + Math.abs(a.y - b.y) * 0.2;   // loop wires bow underneath
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y + bow}, ${b.x - dx} ${b.y + bow}, ${b.x} ${b.y}`;
}
```

`graph-model.mjs` wraps Task-1-style serialization + client legality (`canWire(fromPort, toPort, existingWiresIntoInput)` → `{ok, reason}`) + SCC/loop detect (duplicate the small pure functions client-side; keep the implementation copies byte-identical and covered by the same fixture assertions — server remains authoritative via /api validation). `graph-layout.mjs`: longest-path ranks excluding loop wires, `x = 60 + rank*300`, barycenter y-ordering, snap. `agents-meta.mjs`: EMBEDDED_AGENTS regenerated with v2 ports (copy from Task 7 sidecars), mergePalette/groupPaletteByDomain ports (moved from composer-core.mjs before deleting it).

- [ ] Steps: failing tests (anchor math incl. footerRows height deltas, bezier endpoints equal anchors, layout determinism + no-overlap, thumbnail returns `<svg` string with node count rects, legality matrix md→md ok / json→md reject / second-wire-into-input reject, template `canvas {x,y,zoom}` survives normalize/serialize round-trip, groupPaletteByDomain pins the Flow group (Task, Await, Combine, Merge) present and ordered last, Task pill disabled when the graph already has one) → implement → pass → commit `feat(ui): graph core modules`.

### Task 16: graph-view + composer-editor + inspector + save-dialog + CSS

**Files:**
- Create: `ui/public/graph/graph-view.mjs`, `composer-editor.mjs`, `inspector.mjs`, `save-dialog.mjs`
- Modify: `ui/public/index.html` (composer section replaced: palette rail + canvas host + inspector host + save dialog), `ui/public/style.css` (delete :744-879 composer block — the New-Pipeline fanout toggle at :881+ STAYS; add ~450-line graph block per spec §6 visual spec), `ui/public/app.js` (initComposer → new editor; delete column composer :1669-:2350 ONLY — `modelById`/`option` helpers at :2352-:2361 are used by the run view and new-pipeline view and STAY; palette fetch stays). ALSO in scope: the Agents-view PORT EDITOR (spec §5 — rows: id/type/required/loop/when/filename; save surfaces the agent-store 400 rule text verbatim). New canvas preloads one Task node.
- Delete: `ui/public/composer-core.mjs` (after moving survivors in Task 15).
- Test: `test/ui-graph-view.test.mjs`, `test/ui-composer-editor.test.mjs` (jsdom PointerEvents: spawn node from palette, drag node persists snapped x/y, wire drag legal/illegal, replace-on-drop, undo/redo restores serialization, Del deletes, save dialog posts template v2 including `canvas`), `test/ui-agent-port-editor.test.mjs` (edit port row → save → 400 text rendered), port `test/ui-composer-palette-desc/filter` to ports summary. jsdom caveat: `HTMLElement.prototype.setPointerCapture` does not exist in jsdom — editor must call `el.setPointerCapture?.(e.pointerId)` guarded, tests dispatch `new window.PointerEvent(...)`.

Visual spec source: spec §6 (card anatomy px values, dot colors by type, amber loop wires + `≤3` pill, AWAIT chip, selected outline, legend text `grey = data · amber = loop · ◆ = conditional`, zoom cluster, empty state copy). Implement exactly.

- [ ] Steps: failing jsdom tests → implement (graph-view renders from model only — zero getBoundingClientRect; single `#world` transform) → pass → kill dead ui tests per spec §9 list with justifications → commit `feat(ui)!: free-form node composer`.

### Task 17: Run monitor v2 (run-decor + executions UI)

**Files:**
- Create: `ui/public/graph/run-decor.mjs`
- Modify: `ui/public/app.js` (buildRunGraph :859 / paintRunGraph :928 → graph-view static + run-decor; WS handlers: `exec`/`token`/state.active; log filter gains executionId dimension), `ui/public/index.html` run-card template, `style.css` run block (delete :967-:1112 ONLY — the Agents-view block starts at :1114 and STAYS; add states incl. `skipped`/`error`, executions footer styles). Executions expand/collapse CHANGES node height (`footerRows` in nodeSize) — wires repaint on the height transition's `transitionend` and on toggle start; this is the chosen behavior (no overlay positioning).
- Test: `test/ui-run-decor.test.mjs` (exec ledger → node status map; executions rows text `cycle 2 · fix · 2m10s · $0.42`; cost/duration summed; collapsed strip `3 runs · $1.12`; legacy v1 stepper → chip-strip rows), update `test/ui-cost*/ui-duration*` assertions.

- [ ] Steps: failing tests → implement (executions footer collapse/expand per spec §7; row click filters log; trigger.wireIds → ants) → pass → commit `feat(ui): live graph run monitor with collapsible executions`.

### Task 18: New-pipeline view rewire

**Files:**
- Modify: `ui/public/app.js` (buildNodeConfigRows :2373 → collapsed "Per-run overrides" topo rows; entry prompt textarea copy: "feeds the Task node"; read-only mini-graph of the selected template rendered via graph-view static mode), `index.html` new-pipeline section.
- Test: update `test/newpipeline-config.test.mjs`.

- [ ] Steps: failing test → implement → pass → commit `feat(ui): run setup on graph templates`.

### Task 19: History + legacy rendering + resume sweep UX

**Files:**
- Modify: `ui/public/app.js` history views (stepper.version 1 or missing → chip strip from run-decor), `ui/server.mjs` boot sweep call.
- Test: `test/ui-history-legacy.test.mjs`.

- [ ] Steps: failing test (v1 manifest fixture renders N chips, no crash) → implement → pass → commit `feat(ui): legacy run rendering + v1 pause sweep`.

### Task 20: Phase-3 gate

- [ ] Full `npm test` green (minus imagegen baseline). `npm run smoke` (mock CLI run) passes on the graph engine. Manual: `npm start`, compose default graph from palette, save, run mock, watch executions collapse/expand, gate 'continue' path. Commit any fixups; PR3 assembled.

---

## Phase 4 — Fan-out, workspace, plugins, kill list [PR4]

### Task 21: Composite decompose execution

**Files:** Modify `src/core/graph/executor.mjs` + `scheduler.mjs` (expands-input branch per spec §3), orchestrator task/phase status plumbing (`updateTaskStatus` etc. kept); REMOVE the Task 13 temporary wired-expands E-guard. Test: `test/graph-decompose.test.mjs` (mock decomposition 2 phases × 2 tasks → exec events kind:'task' under n_impl, phases sequential, tasks parallel, outputs fire once; fix re-fire runs single cycle execution; guard removal: decomposer template now validates clean).
- [ ] Steps: failing → implement → pass → commit `feat(graph): composite fan-out executions`.

### Task 22: Workspace parity

**Files:** Modify orchestrator/resolveGraph workspace path; Test: port `test/orchestrator-workspace.test.mjs` to graph engine (substitution, per-project worktrees, ws-review filenames).
- [ ] Steps: failing → implement → pass → `npm run smoke:workspace` → commit `feat(graph): workspace runs on graph engine`.

### Task 23: Mock v2 completeness

**Files:** MOCK_ROLE/MOCK_CYCLE emission already lands in Task 8 (markers from meta.mockRole + ordinal, pinned by Task 9) — this task is the AUDIT + generic defaulting only: verify `claude-runner.mjs` writer switch needs NO new case strings for the 11 builtins (Task 7 pinned exact names), confirm generic-producer/generic-verifier fallbacks route correctly for custom agents. Test: `test/mock-graph.test.mjs` — offline default + flow fixtures terminate with cycle-decreasing severities; a custom v2 agent (fixture registry entry with verdict) mocks as generic-verifier.
- [ ] Steps: failing → implement (expected: little or no claude-runner change) → pass → commit `test(mock): graph-engine mock coverage`.

### Task 24: Plugin API v2

**Files:** Modify `src/core/plugin-api.mjs` (WORCA_PLUGIN_API = 2), `plugin-manifest.mjs` (sidecar v2 hard errors), `plugin-workflows.mjs` (import v2 graphs via validateGraph; reject v1 with warning), `ui/public/plugins-view.mjs` (api-mismatch message per spec §5). Update `test/fixtures/plugins/mock-source/` to v2 (sidecar + workflows/mock-flow.json as graph). Tests: `test/plugin*.test.mjs` updates.
- [ ] Steps: failing → implement → pass → `npm run smoke:plugin` → commit `feat(plugins)!: worca-cc-api 2 (graph templates, port sidecars)`.

### Task 25: Kill list + docs

**Files:** Delete every remaining spec §9 item INCLUDING the Task 6 v1-compat shim in `agent-registry.mjs` and `DEFAULT_SPEC` (:40-55) — nothing reads the derived v1 fields once the engine/UI are on ports; grep-verify zero references (`grep -rn "legacyFields\|BESPOKE_BASE\|connectsTo\|entrySeedChannels\|CHANNEL_IDS\|composer-core\|DEFAULT_SPEC\|optionalConsumes" src ui test`); fix `skills/worca/SKILL.md` stale flags; add freeze note atop `.claude/skills/orchestrate/SKILL.md`; README pipeline section rewrite (graph model, Await/Combine, run parameters).
- [ ] Steps: delete → grep clean → full `npm test` → commit `chore: remove v1 pipeline remnants; docs`.

### Task 26: End-to-end acceptance

- [ ] `npm test` green (imagegen baseline only). `npm run smoke` + `smoke:workspace` + `smoke:plugin` green. Manual UI pass: compose the mockup graph (planner→refiner self-loop→implementer⇄reviewer→await→checklist), save, mock-run, verify: conditional skip state on untaken branch, loop badge counts, executions collapse, gate flow, resume after pause mid-loop. Real (non-mock) short run on `examples/`-scale project if available. Tag release notes: template v1 removal, plugin API 2, v1 paused runs unresumable.

---

## Self-review notes (kept honest)

- Spec coverage: §1→T5/T12, §2→T2/T3 (+run-time validation T13), §3→T4/T8/T13/T21/T23, §4→T2/T4/T8, §5→T6/T7/T10/T16 (port editor)/T24, §6→T15/T16/T18, §7→T17/T19, §8→T11/T12/T13 (executionId keying), §9→T25, §10 phasing→PR structure, §11 risks→T9 (prompt pinning), T3-V18, T19 (sweep), T11 (audit log), T6 shim (green main between PRs).
- Later-phase tasks carry interfaces + key code, not full diffs — by design; the Global Constraints section mandates per-phase Fable re-grounding before execution.
- Amendment 2026-08-10-b (from re-expressing the saved "Full" template): Merge flow node (OR-join, Tasks 3/4/8/15), `loop: true` input flag replaces wiring-derived loop inputs (Tasks 1/2), blocking-source loop-wire rule (Task 2/3), V19 warning. Spec updated in lockstep.
- Amendment 2026-08-10-c (user request): explicit Task node replaces implicit prompt-seeding — `seed` field removed everywhere, V9 = "required non-loop inputs must be wired", V20 = exactly one task node, wf_default renumbered to w1–w9 (loops now w5/w9), scheduler takes `taskArtifact` instead of `seeds`, `runTaskExecution` added, palette Flow group gains singleton Task pill. Spec updated in lockstep.
- Reviewed 2026-08-10 by two Fable max agents (anchor fact-check vs working tree; fresh-eyes vs spec). All corrections applied: v1-compat shim in Task 6 (critical — PR2 no longer breaks the live engine), run-time validateGraph, wire-maxCycles overlay read path, PR3 decomposer E-guard + workspace stance, await out-type resolution in V8, full FIXTURE_FLOW topology, dangling-wire guard, mode-selection tests, Agents-view port editor task, nodeSize footerRows, mock role case strings (planner-plan / manual-tests-checklist / manual-web-ui-testing), corrected anchors (descriptionDerived :326-332 → new `portSummary`; app.js :859/:928/:1669-2350; style.css :967-1112; INCREMENTAL_COLUMNS :555; phases contract lines :1243-1245; orchestrator delete range :1722-2519), runOpts/mockMarkers export need, jsdom setPointerCapture guard.
