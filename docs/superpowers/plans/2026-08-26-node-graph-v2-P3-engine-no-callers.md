# Node-Graph v2 — P3: Engine, no callers Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the complete v2 graph engine — `src/core/graph/scheduler.mjs` (token store, readiness, launch order, loop budgets + human gates, composite fan-out, End drain, snapshot/reattach) and `src/core/graph/executor.mjs` (output allocation, the Ports block, prompt assembly, the agent/clarifier/flow executors, the generic MOCK chain) — with **zero callers**. Nothing dispatches through it yet: the v1 engine stays live and untouched, and the suite proves the engine on its own with unit fixtures, a prompt-parity pin suite over the 11 real builtin sidecars, and an offline mock run of every seed graph through a small test driver.

**Architecture:** Two pure-ish modules under `src/core/graph/`. The **scheduler** owns the dataflow loop: one latched token per output port with a global monotonic `seq`, `consumed[node][port]` at bind, readiness per Amendment f, a condensation-topo launch order, a counting semaphore for agent executions (flow cards bypass it), per-wire `{deliveries, allowance}` budgets whose overflow HOLDS a token and asks a human gate, End completion with a recorded-but-not-routed drain, and a resume snapshot after every publish. Every execution — agent AND flow — is routed through ONE injected `execute(args)`; the scheduler does no IO and never reads an agent key. The **executor** is that injected function's body: it selects by `node.kind` then `meta.runnerType`, allocates filenames from sidecar templates, assembles the task prompt by REUSING `phases.mjs` (so today's load-bearing bytes survive), and resolves the offline mock role from a 5-step graph-derived chain. The adapter that builds the `ctx` these executors read (`GraphOrchestrator._execute`) is P4's; this plan defines its contract exactly and tests against hand-built ctx objects.

**Series position:** P3 of 8; requires P2 landed (sentinels: `export function validateGraph` in `src/shared/graph/validate.mjs`, `SCHEMA_VERSION = 23` in `src/core/db.mjs`, `export const MOCK_WRITER_ROLES` in `src/core/claude-runner.mjs`); leaves dev green and shippable; the v1 engine stays live (P3 adds no dispatch path).

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats every rule, message, shape and literal it needs).

## Global Constraints

- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in user-facing strings: "worca" (never "worca-cc"; the repo dir/slug is fine in paths).
- Commits: `worca: Node-graph v2 P3 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file); baseline recorded in Task 0; final total recorded in Task 12.
- **NO CALLERS.** `src/core/orchestrator.mjs`, `src/core/run-harness.mjs`, `ui/server.mjs`, `src/cli/**`, `worca-cc.mjs` and `ui/public/**` are NOT modified by this plan. The only files touched outside `src/core/graph/` and `test/` are `src/core/phases.mjs` (Task 1: export-only additions + one extracted helper) — nothing else.
- **GENERICITY CHARTER** (hard rule for both new modules): no agent-key branch anywhere. Executor selection is `node.kind` + `meta.runnerType`; renderer selection is the port's `as`; mode selection is port FRESHNESS; the mock role comes from the generic chain. `grep -n "'implementer'\|'planner'\|'reviewer'\|'clarify'" src/core/graph/*.mjs` must return nothing but comments at the end of this plan.
- Tests are offline only: `WORCA_MOCK=1` / `claudeOpts:{mock:true}` / injected fakes. Never a live `claude`.
- Every rule/guard gets a test that FAILS when the rule is removed (mutation-proof). No `assert.doesNotThrow` anywhere.
- Borrowed code is cited as `old:<path>` with the exact list of changes; the old branch may be absent at execution time, so every module is EMBEDDED in full in this plan.

---

### Task 0: Branch check, deps, predecessor sentinels, baseline

**Files:** none changed.

**Interfaces:** produces the recorded BASELINE test count consumed by Task 12.

- [ ] **Step 1:** `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch. NEVER `git checkout dev`, never create a branch inside a pipeline run. By hand: `git checkout -b worca-cc/node-graph-v2-p3` off dev.
- [ ] **Step 2:** `[ -d node_modules ] || npm ci`
- [ ] **Step 3:** predecessor sentinels — ALL must print; if any is missing, STOP (P1/P2 have not landed):

```bash
grep -q "export function validateGraph" src/shared/graph/validate.mjs && echo OK-validate
grep -q "SCHEMA_VERSION = 23" src/core/db.mjs && echo OK-v23
grep -q "export const MOCK_WRITER_ROLES" src/core/claude-runner.mjs && echo OK-mockroles
grep -q "export function registryPortsFn" src/core/graph/registry-ports.mjs && echo OK-registryports
grep -q "export function classifyLoops" src/shared/graph/loops.mjs && echo OK-loops
grep -q "export function portsFnFor" src/shared/graph/ports.mjs && echo OK-portsfn
grep -q "export function flowPorts" src/shared/graph/ports.mjs && echo OK-flowports
grep -q "AWAIT_PORT" src/shared/graph/constants.mjs && echo OK-awaitport
grep -q "blockingIssues" src/shared/graph/verdict.mjs && echo OK-verdict
grep -q "export const SEED_TEMPLATES" src/core/graph/seed-templates.mjs && echo OK-seeds
grep -q "export const NODE_ID_MAP" src/core/graph/seed-templates.mjs && echo OK-nodemap
grep -q "export const FB_WIRE_MAP" src/core/graph/seed-templates.mjs && echo OK-fbmap
grep -q "GRAPH_DEFAULT_WORKFLOW" src/core/graph/builtin-workflows.mjs && echo OK-defaultgraph
grep -l '"metaVersion"' agents/*.meta.json | wc -l    # must print 11 (P2 ported every builtin sidecar)
```

- [ ] **Step 4:** record the exported names of the P2 test helper (this plan imports `realPortsFn`; if the landed helper exports a different name, alias it at the single import site in each test file and note the deviation):

```bash
grep -n "^export" test/helpers/graph-ports.mjs
```

- [ ] **Step 5 (optional, only if you intend to read the discarded branch):** `git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed`. Every module this plan needs is embedded here in full — the old branch is a cross-check, never a source of truth.
- [ ] **Step 6:** `npm test 2>&1 | tail -5` — record the printed pass count as **BASELINE**; it must be green before you write a line of code.

---

### Task 1: `phases.mjs` seams — export `siblingsBlock`, `mockMarkers`, `runOpts`, the tool lists; extract `diffInstruction(ctx)`

**Files:**
- Modify `src/core/phases.mjs`: add `export` to `mockMarkers` (`:321`), `runOpts` (`:397`), `siblingsBlock` (`:762`), `READ_WRITE_TOOLS` (`:25`), `IMPLEMENTER_TOOLS` (`:27`); extract the reviewer's `diffInstruction` (`:859-866`) into an exported pure function and call it from `runReviewer`.
- Create `test/phases-graph-seams.test.mjs`.

**Interfaces:**
- Produces: `export function diffInstruction(ctx)` → the reviewer's diff sentence (ref arm or no-ref arm), plus `mockMarkers(fields)`, `runOpts(ctx, {role, prompt, systemPrompt, allowedTools})`, `siblingsBlock(siblings)`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS` as named exports. `export const _runOptsForTests = runOpts` (`:446`) STAYS (existing importers).
- Consumes: nothing new. **Byte-neutral**: adding `export` changes no behavior; the extraction must leave `runReviewer`'s prompt byte-identical.

Why: the executor MUST reuse these (spec §5.4 "reuses `phases.mjs` helpers … the last two get exported; `diffInstruction(ctx)` extracted from `:858-866`"). Re-implementing them in the executor is the drift the rebuild exists to prevent.

- [ ] **Step 1: Write the failing test** — `test/phases-graph-seams.test.mjs`

```js
// test/phases-graph-seams.test.mjs
// The five prompt-library seams the v2 executor imports from phases.mjs, plus the
// extracted reviewer diff sentence. These are EXPORT-ONLY additions: the pins here
// are the exact live bytes, so a reword of any of them fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockMarkers, runOpts, siblingsBlock, diffInstruction,
  READ_WRITE_TOOLS, IMPLEMENTER_TOOLS, RESUME_HEADER,
} from '../src/core/phases.mjs';

test('mockMarkers renders KEY: value lines and drops empty values', () => {
  assert.equal(
    mockMarkers({ MOCK_ROLE: 'refiner', MOCK_CYCLE: 2, MOCK_OUT: '', MOCK_JSON: null, MOCK_IN: undefined }),
    'MOCK_ROLE: refiner\nMOCK_CYCLE: 2',
  );
});

test('siblingsBlock renders the shared-working-tree rules, and nothing when solo', () => {
  assert.equal(siblingsBlock([]), '');
  assert.equal(siblingsBlock(undefined), '');
  const b = siblingsBlock([{ id: 'p1t2', title: 'Slice two', file: 'tasks/p1-t2.md' }]);
  assert.ok(b.startsWith('\n## Parallel siblings — shared working tree\n\n'));
  assert.ok(b.includes('1 other implementer(s) are editing THIS SAME working tree right now, each on its own task:'));
  assert.ok(b.includes('- p1t2 "Slice two" (tasks/p1-t2.md)'));
  assert.ok(b.includes('1. Edit ONLY the files your TASK file lists.'));
  assert.ok(b.includes('4. No tree-wide git operations: no stash, no checkout --, no reset, no clean, no add, no commit.'));
});

test('diffInstruction: the checkpoint-ref arm names the ref, the bare arm does not', () => {
  assert.equal(
    diffInstruction({ checkpointRef: 'abc1234' }),
    'Inspect the diff with `git diff abc1234` (the orchestrator\'s pre-implementation ' +
    'checkpoint) and `git status` in your cwd. New/untracked files are intent-to-added, ' +
    'so they DO appear in that diff; use `git status` to cross-check.',
  );
  assert.equal(
    diffInstruction({}),
    'Inspect the diff with `git diff` and `git status` in your cwd. If `git diff` looks ' +
    'empty, the changes may be newly-created files — confirm with `git status` and ' +
    '`git diff HEAD`.',
  );
  assert.equal(diffInstruction({ checkpointRef: '   ' }), diffInstruction({}));
});

test('runOpts is exported and still applies RESUME_HEADER + frontmatter tools', () => {
  const o = runOpts(
    { projectDir: '/p', resumeSessionId: 's1', node: { tools: ['mcp__x__y'], fanOut: false }, claudeOpts: { mock: true } },
    { role: 'r', prompt: 'BODY', systemPrompt: 'SYS', allowedTools: READ_WRITE_TOOLS },
  );
  assert.equal(o.cwd, '/p');
  assert.equal(o.prompt, RESUME_HEADER + 'BODY');
  assert.ok(o.allowedTools.includes('mcp__x__y'), 'frontmatter tools are unioned in');
  assert.deepEqual(o.allowedTools.slice(0, READ_WRITE_TOOLS.length), READ_WRITE_TOOLS);
  assert.equal(o.mock, true);
});

test('the two baseline tool lists are the ones the v2 executor will branch on', () => {
  assert.deepEqual(READ_WRITE_TOOLS, ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill']);
  assert.deepEqual(IMPLEMENTER_TOOLS, ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob', 'Skill']);
});
```

`Expected: SyntaxError: The requested module '../src/core/phases.mjs' does not provide an export named 'diffInstruction'`

- [ ] **Step 2: Implement** — five one-word `export` additions plus one extraction.

1. `src/core/phases.mjs:25` and `:27` — prefix both with `export`:
```js
export const READ_WRITE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill'];
// Implementer additionally gets MultiEdit for larger, multi-hunk edits.
export const IMPLEMENTER_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob', 'Skill'];
```
2. `:321` — `function mockMarkers(fields) {` → `export function mockMarkers(fields) {`
3. `:397` — `function runOpts(ctx, { role, prompt, systemPrompt, allowedTools }) {` → `export function runOpts(ctx, { role, prompt, systemPrompt, allowedTools }) {` (leave `export const _runOptsForTests = runOpts;` at `:446` alone).
4. `:762` — `function siblingsBlock(siblings) {` → `export function siblingsBlock(siblings) {`
5. Extract the reviewer's diff sentence. Insert this function immediately ABOVE `export async function runReviewer(ctx, opts) {`:

```js
/**
 * The reviewer's diff instruction — extracted VERBATIM from runReviewer so the v2
 * executor's `as: 'worktree'` renderer and the `{diffInstruction}` prompt-hint token
 * resolve to the same bytes. Prefer diffing against the recorded checkpoint commit:
 * new files are made visible via the orchestrator's intent-to-add staging after each
 * implement pass, so `git diff <ref>` and `git status` both show greenfield work.
 * Pure + exported.
 * @param {{checkpointRef?:string}} ctx
 * @returns {string}
 */
export function diffInstruction(ctx) {
  const ref = String(ctx?.checkpointRef || '').trim();
  return ref
    ? `Inspect the diff with \`git diff ${ref}\` (the orchestrator's pre-implementation ` +
      `checkpoint) and \`git status\` in your cwd. New/untracked files are intent-to-added, ` +
      `so they DO appear in that diff; use \`git status\` to cross-check.`
    : 'Inspect the diff with `git diff` and `git status` in your cwd. If `git diff` looks ' +
      'empty, the changes may be newly-created files — confirm with `git status` and ' +
      '`git diff HEAD`.';
}
```

Then inside `runReviewer` DELETE these seven lines (`:859-866`):
```js
  const ref = (ctx.checkpointRef || '').trim();
  const diffInstruction = ref
    ? `Inspect the diff with \`git diff ${ref}\` (the orchestrator's pre-implementation ` +
      `checkpoint) and \`git status\` in your cwd. New/untracked files are intent-to-added, ` +
      `so they DO appear in that diff; use \`git status\` to cross-check.`
    : 'Inspect the diff with `git diff` and `git status` in your cwd. If `git diff` looks ' +
      'empty, the changes may be newly-created files — confirm with `git status` and ' +
      '`git diff HEAD`.';
```
and change the one prompt line that used the local const from `    diffInstruction +` to:
```js
    diffInstruction(ctx) +
```
The three comment lines above the deleted `const ref` (`// Prefer diffing against the recorded checkpoint commit. …`) move with the function (they are reproduced in its JSDoc); delete them from `runReviewer`.

- [ ] **Step 3: Verify byte-identity of the reviewer prompt** — the existing reviewer pins must still pass untouched:

```bash
node --test test/phases-graph-seams.test.mjs
node --test test/phases-prompt.test.mjs test/phases-workspace.test.mjs \
  test/phases-implementer-task.test.mjs test/phases-questions.test.mjs test/phases-agent-body.test.mjs 2>&1 | tail -5
```

`Expected: # pass 5` for the new file (0 fail), and the five existing `phases-*.test.mjs` files stay green (they are the reviewer/implementer/workspace prompt pins; any drift here means the extraction changed bytes).

- [ ] **Step 4: Commit** — `worca: Node-graph v2 P3 — phases.mjs prompt-library seams`

---

### Task 2: `scheduler.mjs` core — tokens, readiness, launch order, publish/route, End drain, quiescence

**Files:**
- Create `src/core/graph/scheduler.mjs`.
- Create `test/graph-scheduler.test.mjs`.

**Interfaces:**
- Produces: `export function createScheduler({ template, portsFn, loops, execute, onEvent, onSnapshot, onGate, onAsk, maxParallel, log }) → { run(), pause(), abort(), getState() }` (`reattach(snapshot)` lands in Task 5). `run()` resolves `'done' | 'error' | 'paused'`.
- Consumes (P1/P2): `classifyLoops(tpl, portsFn) → {loopWireIds, loopInputs, sccOf, launchOrder}` (`src/shared/graph/loops.mjs`), `firedOutputs(outputs, verdict)` + `resolveOrOutType(tpl, portsFn, orId)` (`src/shared/graph/ports.mjs`), `hasBlocking` (`src/shared/graph/verdict.mjs`). P2's `firedOutputs(portsOrOutputs, verdict)` accepts EITHER an outputs array or a resolved ports object (settled by the cross-plan pass); `publish` passes `portsOf(node).outputs`.
- `execute(args)` contract (the scheduler ⇄ executor contract, VERBATIM — Task 8 implements the other side):

```js
execute(args) // { node, executionId, ordinal, bindings:{[portId]:{seq,type,path,value,meta,forced}},
              //   trigger:{ wireIds:[], freshPorts:[] }, signal,
              //   composite?: 'expand'|'phase'|'finish', expandsPort?, phase?, phaseStatus?, phases?,
              //   kind?: 'task', slice?: { id, title, phase, path, index, siblings:[{id,title,file}] } }
// → { outputs:{[portId]:{path?,type?,value?}}, verdict?: review|null, summary?, sessionId? }
// 'expand' → { phases:[{ordinal, tasks:[{id,title,file,path,nodeId}]}] } ; 'phase' → {} ; 'finish' → { outputs:{} }
```

**Rules this task implements (Amendment f, verbatim):**
- **First execution**: every WIRED non-loop input has a token (a wired synthesized `await` port counts). Loop inputs (meta `loop:true` OR a classified loop wire) are excused. The Task node is the only zero-input node and fires once at t0.
- **Re-execution, `awaitAll` off (default)**: ≥ 1 fresh token on any input; other inputs bind their latched values.
- **Re-execution, `awaitAll` on**: every wired non-loop input fresh — OR a fresh loop token alone.
- **AND / Combine**: all inputs fresh, every execution (first included). **OR**: ≥ 1 fresh input, every execution, binds the FRESHEST and re-emits ITS payload with a NEW seq; several fresh in one drain ⇒ ONE emission. **End**: a fresh token on its `result` wire; binding it completes the run.
- Fresh = token seq > `consumed[node][port]`. Binding spends every PRESENT token (the OR spends the older fresh ones without binding them).
- Publish fires `always` outputs plus exactly the verdict-matching conditional side, in declared port order; every fired port mints a new token `{seq, type, path, value, meta, firedAt, sourceExecutionId, forced}`.
- Ready nodes launch in condensation-topo order (nodeId tiebreak) — `loops.launchOrder`. Agent executions run under a semaphore (`WORCA_MAX_PARALLEL`, default 4); flow executions bypass it and fire AT their order slot, never eagerly at publish. `rerunPending` coalescing is structural: a running node is skipped in the walk and readiness is re-evaluated after every completion.
- **End reached**: stop launching; in-flight executions run to completion and PUBLISH (tokens latch, `token` events emit) but route nowhere; the run resolves `'done'`. **Quiescence without End**: `'done'` + `endReached:false` + the warning `finished at quiescence — End not reached`.
- Fail-fast: the first genuine execution error aborts everything in flight and errors the run — including during the End drain.
- The scheduler emits **no `skipped` exec rows**: a node that never fired has no ledger row, and the run monitor derives `skipped` from "no rows on a done run" (P6). `'skipped'` stays a legal `exec.status` value for P4/P6.

- [ ] **Step 1: Write the failing test** — `test/graph-scheduler.test.mjs` (part 1 of 2: harness + fixtures; part 2 appends the cases below it)

```js
// test/graph-scheduler.test.mjs
// scheduler.mjs is the single-owner dataflow loop of the v2 graph engine: the token
// store, the drain/launch walk over loops.launchOrder, per-wire loop budgets and
// their human gates, the OR valve's same-drain collapse, End completion (the
// recorded-not-routed drain) and the resume snapshot.
//
// Every execution — agent AND flow card — is routed through the injected `execute`,
// so the fake below answers flow calls too. The fixtures use CUSTOM agent keys and a
// hand-built portsFn: if any scheduler decision ever keys off a builtin agent name,
// these go red first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/core/graph/scheduler.mjs';
import { flowPorts } from '../src/shared/graph/ports.mjs';
import { AWAIT_PORT } from '../src/shared/graph/constants.mjs';

const BLOCKING = (title = 'boom') => ({ issues: [{ severity: 'critical', title }] });
const CLEAN = { issues: [{ severity: 'minor', title: 'nit' }] };
const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Per-ordinal script; the LAST entry repeats for every later execution. */
const byOrdinal = (...list) => (args) => list[Math.min(args.ordinal, list.length) - 1] ?? {};

/** Custom sidecar port shapes — no builtin key appears anywhere in this file. */
const AGENTS = {
  maker: {
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'out', type: 'md', when: 'always' }],
  },
  checker: {
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }],
    verdict: { filename: 'check-cycle{cycle}.json' },
  },
  worker: {
    inputs: [
      { id: 'fix', type: 'md', required: false, loop: true },
      { id: 'task', type: 'json', required: false, expands: true },
      { id: 'plan', type: 'md', required: true },
    ],
    outputs: [{ id: 'done', type: 'void', when: 'always' }],
  },
};

const portsFn = (node) => (node.kind === 'agent'
  ? {
    inputs: [...(AGENTS[node.key]?.inputs || []).map((p) => ({ ...p })), { ...AWAIT_PORT }],
    outputs: (AGENTS[node.key]?.outputs || []).map((p) => ({ ...p })),
    verdict: AGENTS[node.key]?.verdict,
  }
  : flowPorts(node));

const N = (id, kind, key, config = {}) => ({ id, kind, key, x: 0, y: 0, config });
const W = (id, from, to, config) => ({
  id,
  from: { node: from.split('.')[0], port: from.split('.')[1] },
  to: { node: to.split('.')[0], port: to.split('.')[1] },
  ...(config ? { config } : null),
});
const TPL = (nodes, wires) => ({ id: 'wf_t', name: 'T', version: 2, domain: 'coding', nodes, wires });

/**
 * Scripted fake `execute`: records every call IN CALL ORDER (the execution sequence
 * the pins are written against), tracks agent concurrency, and answers unscripted
 * calls with `{}`.
 */
function harness({ template, script = {}, maxParallel, onAsk, onGate }) {
  const events = []; const snapshots = []; const calls = []; const asks = []; const gates = [];
  let inFlight = 0; let maxInFlight = 0;

  const execute = (args) => {
    calls.push({
      nodeId: args.node.id, executionId: args.executionId, ordinal: args.ordinal,
      bindings: args.bindings, trigger: args.trigger, signal: args.signal,
      composite: args.composite, phase: args.phase, phaseStatus: args.phaseStatus,
      kind: args.kind, slice: args.slice,
    });
    const isAgent = args.node.kind === 'agent' && !args.composite;
    if (isAgent) { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); }
    const release = () => { if (isAgent) inFlight -= 1; };
    const fn = script[args.node.id];
    let out;
    try { out = typeof fn === 'function' ? fn(args) : {}; } catch (err) { release(); throw err; }
    return Promise.resolve(out).then((v) => { release(); return v; }, (e) => { release(); throw e; });
  };

  const scheduler = createScheduler({
    template,
    portsFn,
    execute,
    maxParallel,
    onEvent: (name, payload) => events.push({ name, ...payload }),
    onSnapshot: (s) => snapshots.push(s),
    onAsk: onAsk || (async (a) => { asks.push(a); return a.kind === 'gate' ? 'continue' : []; }),
    onGate: onGate || ((g) => gates.push(g)),
  });

  return {
    scheduler, events, snapshots, calls, asks, gates,
    maxInFlight: () => maxInFlight,
    execEvents: () => events.filter((e) => e.name === 'exec'),
    tokenEvents: () => events.filter((e) => e.name === 'token'),
    execSeq: () => events.filter((e) => e.name === 'exec' && e.status === 'start')
      .map((e) => `${e.nodeId} c${e.ordinal}`),
    callsFor: (nodeId) => calls.filter((c) => c.nodeId === nodeId),
    last: () => snapshots[snapshots.length - 1],
  };
}
```

Append the fixtures and cases to the same file:

```js
// ── fixtures (validation deliberately not run over these) ────────────────────

/** maker -> {worker, checker}; checker.review loops back into worker.fix; the
 *  clean side reaches End. One SCC ⇒ w5 is the only loop wire. */
const LOOP_TPL = TPL(
  [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_work', 'agent', 'worker'),
    N('n_check', 'agent', 'checker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_work.plan'),
    W('w3', 'n_make.out', 'n_check.plan'), W('w4', 'n_work.done', 'n_check.done'),
    W('w5', 'n_check.review', 'n_work.fix', { maxCycles: 3 }), W('w6', 'n_check.pass', 'n_end.result')],
);

/** Two makers -> an OR valve (payload) and an AND card (sequencing) -> one worker
 *  whose `plan` comes from the valve and whose `await` gate comes from the AND. */
const FLOW_TPL = TPL(
  [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_b', 'agent', 'maker'),
    N('n_and', 'and', null, { arity: 2 }), N('n_or', 'or', null, { arity: 2 }),
    N('n_sink', 'agent', 'worker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_task.task', 'n_b.task'),
    W('w3', 'n_a.out', 'n_or.in1'), W('w4', 'n_b.out', 'n_or.in2'), W('w5', 'n_or.out', 'n_sink.plan'),
    W('w6', 'n_a.out', 'n_and.in1'), W('w7', 'n_b.out', 'n_and.in2'), W('w8', 'n_and.out', 'n_sink.await'),
    W('w9', 'n_sink.done', 'n_end.result')],
);

const md = (p) => ({ outputs: { out: { path: p } } });

// ── 1. the core loop ─────────────────────────────────────────────────────────

test('1 linear + loop: blocking re-fires the consumer, clean reaches End', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r1.md' } } },
        { verdict: CLEAN, outputs: {} }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_make c1', 'n_work c1', 'n_check c1', 'n_work c2', 'n_check c2', 'n_end c1',
  ]);
  const st = h.scheduler.getState();
  assert.equal(st.endReached, true);
  assert.deepEqual(st.result, { type: 'void' });
  assert.deepEqual(st.warnings, []);
});

test('2 first execution waits for every wired non-loop input, the await port included', async () => {
  const gate = deferred();
  const h = harness({
    template: FLOW_TPL,
    script: { n_a: () => md('/p/a.md'), n_b: () => gate.promise.then(() => md('/p/b.md')) },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.deepEqual(h.callsFor('n_sink'), [], 'the worker has no await token yet');
  gate.resolve();
  assert.equal(await run, 'done');
  const sink = h.callsFor('n_sink');
  assert.equal(sink.length, 1);
  assert.equal(sink[0].bindings.plan.path, '/p/b.md', 'the OR bound the freshest payload');
  assert.equal(sink[0].bindings.await, undefined, 'the await payload is discarded at bind');
});

test('3 re-execution binds latched values and names only the fresh port', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r1.md' } } }, { verdict: CLEAN }),
    },
  });
  await h.scheduler.run();
  const [c1, c2] = h.callsFor('n_work');
  assert.deepEqual(c1.trigger.freshPorts, ['plan']);
  assert.deepEqual(c2.trigger.freshPorts, ['fix'], 'A3: only the fresh port selects the mode');
  assert.deepEqual(c2.trigger.wireIds, ['w5']);
  assert.equal(c2.bindings.plan.path, '/p/plan.md', 'the latched plan is still bound');
  assert.equal(c2.bindings.fix.path, '/p/r1.md');
});

test('4 a meta loop:true input fed by an always-source is still excused from the barrier', async () => {
  // The OR-valve shape: `n_or.out -> n_sink.fix` is ALWAYS-sourced, so it is not a
  // classified loop wire — only the port's meta `loop` excuses it. Without that
  // union the seeds' implementer would wait forever for its first fix token.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_or', 'or', null, { arity: 2 }),
      N('n_sink', 'agent', 'worker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_a.out', 'n_sink.plan'),
      W('w3', 'n_a.out', 'n_or.in1'), W('w4', 'n_a.out', 'n_or.in2'),
      W('w5', 'n_or.out', 'n_sink.fix'), W('w6', 'n_sink.done', 'n_end.result')],
  );
  const h = harness({ template: tpl, script: { n_a: () => md('/p/a.md') } });
  assert.equal(await h.scheduler.run(), 'done');
  assert.ok(h.callsFor('n_sink').length >= 1, 'the worker fired despite an unfilled loop input');
});

test('5 awaitAll: every wired non-loop input must be fresh, or a lone fresh loop token', async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_b', 'agent', 'maker'),
      N('n_sink', 'agent', 'worker', { awaitAll: true }), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_task.task', 'n_b.task'),
      W('w3', 'n_a.out', 'n_sink.plan'), W('w4', 'n_b.out', 'n_sink.await'),
      W('w5', 'n_sink.done', 'n_check.done'), W('w6', 'n_a.out', 'n_check.plan'),
      W('w7', 'n_check.review', 'n_sink.fix', { maxCycles: 3 }), W('w8', 'n_check.pass', 'n_end.result')],
  );
  const late = deferred();
  const h = harness({
    template: tpl,
    script: {
      n_a: () => md('/p/a.md'),
      n_b: () => late.promise.then(() => md('/p/b.md')),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.deepEqual(h.callsFor('n_sink'), [], 'awaitAll blocks until BOTH wired non-loop inputs are fresh');
  late.resolve();
  assert.equal(await run, 'done');
  const sink = h.callsFor('n_sink');
  assert.equal(sink.length, 2, 'the lone fresh loop token re-fired it under awaitAll');
  assert.deepEqual(sink[1].trigger.freshPorts, ['fix']);
});
```

```js
// ── 2. the flow cards ────────────────────────────────────────────────────────

test('6 OR collapses two same-drain arrivals into ONE emission of the freshest', async () => {
  const h = harness({ template: FLOW_TPL, script: { n_a: () => md('/p/a.md'), n_b: () => md('/p/b.md') } });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_or').length, 1, 'one emission per drain');
  const t = h.tokenEvents().filter((e) => e.from.node === 'n_or');
  assert.equal(t.length, 1);
  assert.equal(t[0].path, '/p/b.md', 'the freshest (max seq) payload is forwarded');
  assert.equal(t[0].type, 'md', 'the resolved OR out type');
  const inTok = h.tokenEvents().find((e) => e.from.node === 'n_b');
  assert.ok(t[0].seq > inTok.seq, 'the valve re-emits with a NEW seq');
});

test('7 OR re-emits once per arriving payload across drains; AND emits a void token', async () => {
  const late = deferred();
  const h = harness({
    template: FLOW_TPL,
    script: { n_a: () => md('/p/a.md'), n_b: () => late.promise.then(() => md('/p/b.md')) },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  late.resolve();
  assert.equal(await run, 'done');
  assert.equal(h.callsFor('n_or').length, 2, 'one emission per arriving payload');
  const andTok = h.tokenEvents().find((e) => e.from.node === 'n_and');
  assert.equal(andTok.type, 'void');
  assert.equal(andTok.path, null, 'the AND discards payloads');
  assert.equal(h.callsFor('n_and').length, 1, 'AND fires only when ALL inputs are fresh');
});

test('8 End: done carries the bound result and no token is emitted from it', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  await h.scheduler.run();
  const done = h.execEvents().find((e) => e.nodeId === 'n_end' && e.status === 'done');
  assert.deepEqual(done.result, { type: 'void' });
  assert.equal(done.agentKey, null);
  assert.equal(done.kind, 'cycle');
  assert.equal(h.tokenEvents().some((e) => e.from.node === 'n_end'), false);
});

test('9 End drain: in-flight work publishes and latches, but routes nowhere', async () => {
  // n_slow finishes AFTER End binds; its consumer must never launch.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_fast', 'agent', 'maker'), N('n_slow', 'agent', 'maker'),
      N('n_late', 'agent', 'worker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_fast.task'), W('w2', 'n_task.task', 'n_slow.task'),
      W('w3', 'n_slow.out', 'n_late.plan'), W('w4', 'n_fast.out', 'n_end.result')],
  );
  const slow = deferred();
  const h = harness({
    template: tpl,
    script: { n_fast: () => md('/p/fast.md'), n_slow: () => slow.promise.then(() => md('/p/slow.md')) },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  slow.resolve();
  assert.equal(await run, 'done');
  assert.ok(h.tokenEvents().some((e) => e.from.node === 'n_slow'), 'the drained publish is RECORDED');
  assert.deepEqual(h.callsFor('n_late'), [], 'and routed NOWHERE');
  assert.equal(h.scheduler.getState().endReached, true);
});

test('10 quiescence without an End token resolves done with the warning', async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_check.plan'),
      W('w3', 'n_check.review', 'n_end.result')],
  );
  const h = harness({ template: tpl, script: { n_make: () => md('/p/p.md'), n_check: () => ({ verdict: CLEAN }) } });
  assert.equal(await h.scheduler.run(), 'done');
  const st = h.scheduler.getState();
  assert.equal(st.endReached, false);
  assert.equal(st.result, null);
  assert.deepEqual(st.warnings, ['finished at quiescence — End not reached']);
});

// ── 3. scheduling policy ─────────────────────────────────────────────────────

test('11 fail-fast: the first error aborts in-flight siblings and errors the run', async () => {
  const stall = deferred();
  let sibling = null;
  const tpl = TPL(
    [N('n_task', 'task'), N('n_bad', 'agent', 'maker'), N('n_ok', 'agent', 'maker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_bad.task'), W('w2', 'n_task.task', 'n_ok.task'),
      W('w3', 'n_bad.out', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    script: {
      n_ok: (a) => { sibling = a.signal; return stall.promise.then(() => md('/p/ok.md')); },
      n_bad: () => { throw new Error('kaboom'); },
    },
  });
  const result = await h.scheduler.run();
  assert.equal(result, 'error');
  assert.equal(sibling.aborted, true, 'the in-flight sibling was aborted');
  const err = h.execEvents().find((e) => e.status === 'error');
  assert.equal(err.nodeId, 'n_bad');
  assert.match(err.error, /kaboom/);
  stall.resolve();
});

test('12 maxParallel caps agent executions; flow cards bypass the semaphore', async () => {
  const gates = [deferred(), deferred(), deferred()];
  const tpl = TPL(
    [N('n_task', 'task'), N('n_1', 'agent', 'maker'), N('n_2', 'agent', 'maker'), N('n_3', 'agent', 'maker'),
      N('n_and', 'and', null, { arity: 3 }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_1.task'), W('w2', 'n_task.task', 'n_2.task'), W('w3', 'n_task.task', 'n_3.task'),
      W('w4', 'n_1.out', 'n_and.in1'), W('w5', 'n_2.out', 'n_and.in2'), W('w6', 'n_3.out', 'n_and.in3'),
      W('w7', 'n_and.out', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    maxParallel: 2,
    script: {
      n_1: () => gates[0].promise.then(() => md('/p/1.md')),
      n_2: () => gates[1].promise.then(() => md('/p/2.md')),
      n_3: () => gates[2].promise.then(() => md('/p/3.md')),
    },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.equal(h.callsFor('n_3').length, 0, 'the third agent waits for a slot');
  gates[0].resolve(); gates[1].resolve(); gates[2].resolve();
  assert.equal(await run, 'done');
  assert.equal(h.maxInFlight(), 2);
  assert.equal(h.callsFor('n_and').length, 1);
});

test('13 determinism: identical scripts produce identical execution sequences', async () => {
  const seqs = [];
  for (let i = 0; i < 2; i += 1) {
    const h = harness({
      template: LOOP_TPL,
      script: {
        n_make: () => md('/p/plan.md'),
        n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
      },
    });
    await h.scheduler.run();
    seqs.push(h.execSeq());
  }
  assert.deepEqual(seqs[0], seqs[1]);
});
```

```js
test('14 conditional routing fires exactly the verdict-matching side, in declared order', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  await h.scheduler.run();
  const fired = h.tokenEvents().filter((e) => e.from.node === 'n_check').map((e) => e.from.port);
  assert.deepEqual(fired, ['review', 'pass'], 'blocking cycle fires review only; clean cycle fires pass only');
});

test('15 exec and token events carry the documented v2 shapes', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN, sessionId: 'sess-1' }) },
  });
  await h.scheduler.run();
  const start = h.execEvents().find((e) => e.nodeId === 'n_make' && e.status === 'start');
  assert.deepEqual(Object.keys(start).sort(), ['agentKey', 'executionId', 'kind', 'name', 'nodeId', 'ordinal', 'status', 'trigger']);
  assert.equal(start.executionId, 'x:n_make:1');
  assert.equal(start.agentKey, 'maker');
  assert.equal(start.kind, 'cycle');
  const verdictDone = h.execEvents().find((e) => e.nodeId === 'n_check' && e.status === 'done');
  assert.deepEqual(verdictDone.verdict, { hasBlocking: false }, 'verifier done carries the verdict flag');
  const tok = h.tokenEvents().find((e) => e.from.node === 'n_make');
  assert.deepEqual(tok.to, [{ node: 'n_work', port: 'plan', wireId: 'w2' }, { node: 'n_check', port: 'plan', wireId: 'w3' }]);
  assert.equal(tok.type, 'md');
  assert.equal(tok.path, '/p/plan.md');
  assert.equal(tok.forced, false);
  assert.equal(tok.sourceExecutionId, 'x:n_make:1');
  assert.equal(typeof tok.firedAt, 'number');
  assert.equal(typeof tok.seq, 'number');
});

test('16 pause resolves the literal "paused" and launches nothing further', async () => {
  const hold = deferred();
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => hold.promise.then(() => md('/p/plan.md')), n_check: () => ({ verdict: CLEAN }) },
  });
  const run = h.scheduler.run();
  await tick();
  h.scheduler.pause();
  hold.resolve();
  assert.equal(await run, 'paused');
  assert.deepEqual(h.callsFor('n_work'), [], 'no launch after the pause request');
  assert.equal(h.scheduler.getState().endReached, false);
});

test('17 abort fires the in-flight signal and errors the run', async () => {
  const hold = deferred();
  let seen = null;
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: (a) => { seen = a.signal; return hold.promise.then(() => md('/p/p.md')); } },
  });
  const run = h.scheduler.run();
  await tick();
  h.scheduler.abort();
  assert.equal(seen.aborted, true);
  hold.resolve();
  assert.equal(await run, 'error');
});
```

`Expected: Error: Cannot find module '.../src/core/graph/scheduler.mjs'` (17 tests fail to load).

- [ ] **Step 2: Implement** — create `src/core/graph/scheduler.mjs` with EXACTLY this content (part 1 of 3; parts 2 and 3 continue the same file).

Borrowed from `old:src/core/graph/scheduler.mjs` with these changes: (a) `blockingIssues`/`hasBlocking` come from `src/shared/graph/verdict.mjs`, never `protocol.mjs` (which imports `node:fs/promises`); (b) `classifyLoops` returns `{loopWireIds, loopInputs, launchOrder}` and is INJECTABLE as `opts.loops`; (c) `isReady`/`makeToken` are private here (the shared `ports.mjs` exports neither); (d) tokens carry `firedAt`; (e) `token` events carry `to[]` + `sourceExecutionId`; (f) an input is a LOOP input when the classification says so **or** the port's meta says `loop:true` (the old code checked only the classification, which deadlocks the OR-valve seeds); (g) `taskArtifact` is not a scheduler concern (the task node's payload is its execution's returned output); (h) `ask` is split into `onAsk` (the ask channel) + `onGate` (the state notifier); (i) no `skipped` exec rows.

```js
// src/core/graph/scheduler.mjs
// The single-owner dataflow loop of the v2 graph engine: the token store, the
// drain/launch walk, per-wire loop budgets and their human gates, End completion
// and the resume-v2 snapshot.
//
// Shape of a pass: publishing routes tokens IMMEDIATELY (per-wire delivery counting
// and gate checks happen AT DELIVERY), but FIRING happens only in the drain loop. A
// pass walks `loops.launchOrder` ONCE; a node ready at its slot fires AT that slot —
// agent nodes as an async `execute` under the semaphore, flow nodes synchronously,
// whose publishes route immediately and may make LATER slots ready within the same
// pass. Earlier slots are never revisited mid-pass; passes repeat until a pass fires
// nothing. The execution sequence is therefore the order of `execute` CALLS, and it
// is deterministic.
//
// EVERY node's execution is routed through the injected `execute` — flow kinds
// synchronously and outside the semaphore, agent kinds under it. The scheduler never
// reads an agent key and does no IO.
//
// `rerunPending` coalescing is structural: a node that is already running is skipped
// in the walk, and readiness is re-evaluated after every completion, so readiness
// reached while running re-fires exactly once and never queues.
import { classifyLoops } from '../../shared/graph/loops.mjs';
import { firedOutputs, resolveOrOutType } from '../../shared/graph/ports.mjs';
import { hasBlocking } from '../../shared/graph/verdict.mjs';

/** Kinds executed by the engine itself: instant, $0, no semaphore slot. */
const FLOW_KINDS = new Set(['task', 'end', 'and', 'or', 'combine']);
/** Execution statuses that need no re-invocation on restore. */
const TERMINAL = new Set(['done', 'error', 'skipped']);
/** The §3 completion warning for a run that quiesced without reaching End. */
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

function defaultMaxParallel() {
  const n = Number(process.env.WORCA_MAX_PARALLEL);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

/** Non-interactive default: gates continue, clarify asks answer empty (v1 `_ask` auto). */
const defaultAsk = async (ask) => (ask?.kind === 'gate' ? 'continue' : []);

/**
 * Build a scheduler over a resolved v2 template.
 *
 * @param {object} opts
 * @param {object} opts.template   v2 template `{ nodes, wires }`
 * @param {(node:object) => ({inputs?:Array, outputs?:Array, verdict?:object}|undefined)} opts.portsFn
 * @param {{loopWireIds:Set<string>, loopInputs:Set<string>, launchOrder:string[]}} [opts.loops]
 * @param {(args:object) => Promise<object>} opts.execute
 * @param {(name:'exec'|'token'|'gate', payload:object) => void} [opts.onEvent]
 * @param {(snapshot:object) => void} [opts.onSnapshot]
 * @param {(gate:{wireId,fromNode,toNode,askId}|null) => void} [opts.onGate]
 * @param {(ask:object) => Promise<any>} [opts.onAsk]
 * @param {number} [opts.maxParallel]
 * @param {(line:string, attrs?:object) => void} [opts.log]
 */
export function createScheduler(opts) {
  const {
    template,
    portsFn,
    execute,
    loops = classifyLoops(template, portsFn),
    onEvent = () => {},
    onSnapshot = () => {},
    onGate = () => {},
    onAsk = defaultAsk,
    maxParallel = defaultMaxParallel(),
    log = () => {},
  } = opts || {};

  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const wires = (Array.isArray(template?.wires) ? template.wires : [])
    .filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node));
  const wireById = new Map(wires.map((w) => [w.id, w]));
  const loopWireIds = new Set(loops?.loopWireIds || []);
  const loopInputs = new Set(loops?.loopInputs || []);
  const order = Array.isArray(loops?.launchOrder) && loops.launchOrder.length
    ? loops.launchOrder.filter((id) => nodeById.has(id))
    : nodes.map((n) => n.id);

  // Static wiring indexes. `wiredIn` is keyed by BARE port id per node; `outWires`
  // fans a fired output out to its wires.
  const wiredIn = new Map(nodes.map((n) => [n.id, new Map()]));
  const outWires = new Map();
  for (const w of wires) {
    wiredIn.get(w.to.node).set(w.to.port, w.id);
    const key = `${w.from.node}.${w.from.port}`;
    if (!outWires.has(key)) outWires.set(key, []);
    outWires.get(key).push(w);
  }

  // --- run state -----------------------------------------------------------
  let seq = 0;
  const tokens = new Map();       // '<node>.<inputPort>'  -> delivered token
  const outputs = new Map();      // '<node>.<outputPort>' -> latched token
  const consumed = new Map();     // nodeId -> Map(port -> seq), recorded at bind
  const ordinals = new Map();     // nodeId -> executions started
  const wireState = new Map();    // loop wireId -> { deliveries, allowance }
  const execs = new Map();        // executionId -> ledger entry
  const held = new Map();         // wireId -> { wireId, nodeId, executionId, token, issues, askId }
  const outstanding = new Set();  // wireIds with an un-withdrawn ask in flight
  const running = new Map();      // nodeId -> executionId
  const completions = [];
  const warnings = [];
  const controller = new AbortController();
  let activeAgents = 0;
  let ended = null;
  let gate = null;                // the CURRENT gate for state.gate (P4 stamps it)
  let failure = null;
  let pauseRequested = false;
  let abortRequested = false;
  let settled = false;

  for (const id of loopWireIds) {
    const maxCycles = Number(wireById.get(id)?.config?.maxCycles ?? 3);
    wireState.set(id, { deliveries: 0, allowance: Math.max(0, (Number.isFinite(maxCycles) ? maxCycles : 3) - 1) });
  }
```

Part 2 of 3 — wake plumbing, the semaphore, binding, launching, publishing and routing (continue the same file):

```js
  // --- wake plumbing -------------------------------------------------------
  let signalled = false;
  let waiter = null;
  function wake() {
    signalled = true;
    if (waiter) { const w = waiter; waiter = null; w(); }
  }
  async function waitForChange() {
    if (signalled) { signalled = false; return; }
    await new Promise((res) => { waiter = res; });
    signalled = false;
  }

  // --- the agent semaphore -------------------------------------------------
  // A counting semaphore with a FIFO waiter queue. The drain walk POLLS it before
  // launching a node; composite slices AWAIT it (they are launched from inside an
  // already-running execution). The composite SHELL holds no slot, which is what
  // keeps a fan-out from deadlocking behind itself at maxParallel 1.
  const slotQueue = [];
  function takeSlot() {
    if (activeAgents < maxParallel) { activeAgents += 1; return Promise.resolve(); }
    return new Promise((resolve) => { slotQueue.push(resolve); });
  }
  function freeSlot() {
    const next = slotQueue.shift();
    if (next) { next(); return; }             // handed straight over: the count is unchanged
    activeAgents -= 1;
    wake();                                   // a freed slot may unblock a queued launch
  }

  // --- small helpers -------------------------------------------------------
  const portsOf = (node) => (typeof portsFn === 'function' ? portsFn(node) : null) || {};
  const isFlow = (node) => FLOW_KINDS.includes(node.kind);   // FLOW_KINDS is a frozen ARRAY (P1)
  const spentOf = (nodeId) => consumed.get(nodeId) || new Map();

  /** A port is a loop input when the classification says so OR its meta declares it.
   *  Both halves are load-bearing: `or.out -> agent.fix` is an ALWAYS-sourced wire
   *  (never a classified loop wire) into a `loop:true` port, and only the meta half
   *  excuses it from the first-run barrier. */
  const isLoopPort = (nodeId, port) => Boolean(port?.loop) || loopInputs.has(`${nodeId}.${port?.id}`);

  function makeToken({ type, path = null, value = null, meta = null, sourceExecutionId = null, forced = false }) {
    seq += 1;
    return { seq, type, path, value, meta, firedAt: Date.now(), sourceExecutionId, forced };
  }

  /** The payload half of a token, materialized only where it exists. */
  function payloadOf(token) {
    const out = { seq: token.seq, type: token.type };
    if (token.path != null) out.path = token.path;
    if (token.value != null) out.value = token.value;
    if (token.meta != null) out.meta = token.meta;
    if (token.forced) out.forced = true;
    return out;
  }

  function emitExec(node, entry, status, extra) {
    onEvent('exec', {
      nodeId: node.id,
      executionId: entry.executionId,
      kind: entry.kind,
      ordinal: entry.ordinal,
      status,
      agentKey: node.kind === 'agent' ? (node.key ?? null) : null,   // flow rows carry none
      trigger: entry.trigger,
      // Composite sub-executions carry their slice identity; the UI collapses them
      // under the node and labels them by title.
      ...(entry.kind === 'task'
        ? { phase: entry.phase, taskId: entry.taskId, title: entry.title, parentExecutionId: entry.parentExecutionId,
            taskIndex: entry.taskIndex, taskTotal: entry.taskTotal }
        : null),
      ...(extra || null),
    });
  }

  function emitToken(node, port, token) {
    onEvent('token', {
      seq: token.seq,
      from: { node: node.id, port: port.id },
      to: (outWires.get(`${node.id}.${port.id}`) || [])
        .map((w) => ({ node: w.to.node, port: w.to.port, wireId: w.id })),
      type: token.type,
      path: token.path,
      forced: token.forced,
      firedAt: token.firedAt,
      sourceExecutionId: token.sourceExecutionId,
    });
  }

  // --- binding -------------------------------------------------------------

  /**
   * Latch this execution's inputs. Every input holding a token is bound (a
   * re-execution binds latched values for its non-triggering inputs) and spent in
   * `consumed`; the OR card binds ONLY the freshest fresh input, so the older fresh
   * tokens are spent at that same bind without being bound.
   */
  function bindFor(node) {
    const inputs = portsOf(node).inputs || [];
    const spent = spentOf(node.id);
    const first = (ordinals.get(node.id) || 0) === 0;
    const present = [];
    for (const inp of inputs) {
      const token = tokens.get(`${node.id}.${inp.id}`);
      if (!token) continue;
      const prior = spent.get(inp.id);
      present.push({ port: inp.id, token, fresh: prior === undefined || token.seq > prior });
    }

    let bound = present;
    if (node.kind === 'or') {
      const freshest = present
        .filter((p) => p.fresh)
        .reduce((best, p) => (best && best.token.seq >= p.token.seq ? best : p), null);
      bound = freshest ? [freshest] : [];
    }

    const bindings = {};
    for (const p of bound) {
      if (p.port === 'await') continue;              // consumed for the barrier, payload discarded
      bindings[p.port] = payloadOf(p.token);
    }
    const fresh = present.filter((p) => p.fresh);
    return {
      bindings,
      present,
      trigger: {
        wireIds: fresh.map((p) => wiredIn.get(node.id)?.get(p.port)).filter(Boolean),
        // A3: only a FRESH port selects the mode. `await` never does — it is absent
        // on first executions and ignored by the executor everywhere.
        freshPorts: fresh.filter((p) => !(first && p.port === 'await')).map((p) => p.port),
      },
    };
  }

  function commitBind(node, present) {
    let spent = consumed.get(node.id);
    if (!spent) { spent = new Map(); consumed.set(node.id, spent); }
    for (const p of present) spent.set(p.port, p.token.seq);
  }
```

Part 3 of 3 — launching, publish/route, the snapshot, readiness and the run loop (continue the same file):

```js
  // --- launching -----------------------------------------------------------

  function startExecution(node) {
    const ordinal = (ordinals.get(node.id) || 0) + 1;
    const executionId = `x:${node.id}:${ordinal}`;
    const b = bindFor(node);                 // reads `ordinals` — bind BEFORE the bump
    ordinals.set(node.id, ordinal);
    commitBind(node, b.present);
    const entry = {
      executionId,
      nodeId: node.id,
      kind: 'cycle',
      ordinal,
      status: 'start',
      sessionId: null,
      bindings: b.bindings,
      trigger: b.trigger,
    };
    execs.set(executionId, entry);
    running.set(node.id, executionId);
    emitExec(node, entry, 'start');
    return { node, entry, args: argsFor(node, entry), composite: false };
  }

  function argsFor(node, entry) {
    return {
      node,
      executionId: entry.executionId,
      ordinal: entry.ordinal,
      bindings: entry.bindings,
      trigger: entry.trigger,
      signal: controller.signal,
    };
  }

  /** Flow cards run inline at their slot so their publishes reach later slots. */
  async function fireFlow(node) {
    const h = startExecution(node);
    let res = null;
    let err = null;
    try { res = await execute(h.args); } catch (e) { err = e; }
    settle(h, res, err);
  }

  /** Agent nodes take a semaphore slot; `execute` is called AT the slot. */
  function fireAgent(node) {
    const h = startExecution(node);
    if (!h.composite) activeAgents += 1;
    let p;
    try { p = invoke(h); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(
      (res) => { completions.push({ h, res, err: null }); wake(); },
      (err) => { completions.push({ h, res: null, err }); wake(); },
    );
  }

  /** Run one started execution. (Task 4 routes composite firings through here.) */
  function invoke(h) {
    return execute(h.args);
  }

  function settle(h, res, err) {
    running.delete(h.node.id);
    if (!isFlow(h.node) && !h.composite) freeSlot();
    if (err || res?.error) failExecution(h, err || res.error);
    else completeExecution(h, res || {});
  }

  function completeExecution(h, res) {
    const { node, entry } = h;
    entry.status = 'done';
    if (res?.sessionId) entry.sessionId = res.sessionId;
    emitExec(node, entry, 'done', {
      ...(node.kind === 'end' ? { result: boundResult(entry) } : null),
      ...(res?.verdict ? { verdict: { hasBlocking: hasBlocking(res.verdict) } } : null),
    });
    publish(node, entry, res);
    snap();
  }

  function failExecution(h, err) {
    const { node, entry } = h;
    entry.status = 'error';
    entry.error = String(err?.message || err);
    emitExec(node, entry, 'error', { error: entry.error });
    failure = err;
    controller.abort();                       // fail-fast aborts everything in flight
    snap();
  }

  // --- publishing / routing ------------------------------------------------

  /** End's result is derived from the token the SCHEDULER bound, never from the
   *  execution's (informational) return value. */
  function boundResult(entry) {
    const bound = Object.values(entry.bindings)[0] || {};
    const result = { type: bound.type ?? 'void' };
    if (bound.path != null) result.path = bound.path;
    if (bound.value != null) result.value = bound.value;
    return result;
  }

  function publish(node, entry, res) {
    if (node.kind === 'end') {
      ended = {
        nodeId: node.id,
        executionId: entry.executionId,
        seq: Object.values(entry.bindings)[0]?.seq ?? null,
        result: boundResult(entry),
      };
      withdrawGates();                        // no run() may block on a pending ask now
      return;                                 // zero outputs — the publish step fires no token
    }
    const verdict = res?.verdict ?? null;
    for (const port of firedOutputs(portsOf(node).outputs, verdict)) {
      const token = makeToken({
        type: outTypeOf(node, port),
        ...payloadFor(node, port, entry, res),
        sourceExecutionId: entry.executionId,
      });
      emitToken(node, port, token);
      outputs.set(`${node.id}.${port.id}`, token);
      route(node, port, token, verdict, entry.executionId);
    }
  }

  const outTypeOf = (node, port) => (node.kind === 'or'
    ? (resolveOrOutType(template, portsFn, node.id) ?? port.type)
    : port.type);

  function payloadFor(node, port, entry, res) {
    // The OR valve re-emits the payload of the token IT bound; the AND card is a
    // pure synchronizer and emits void.
    if (node.kind === 'or') {
      const bound = Object.values(entry.bindings)[0] || {};
      return { path: bound.path ?? null, value: bound.value ?? null };
    }
    if (node.kind === 'and') return { path: null, value: null };
    const given = res?.outputs?.[port.id];
    if (given) return { path: given.path ?? null, value: given.value ?? null };
    return { path: null, value: null };
  }

  /**
   * Deliver a token along every wire out of a fired port. During the End drain
   * nothing is routed at all: the token is recorded (latched + evented) and loop
   * accounting/gates are skipped. (Task 3 adds the per-wire budget branch here.)
   */
  function route(node, port, token) {
    if (ended) return;
    for (const w of outWires.get(`${node.id}.${port.id}`) || []) {
      tokens.set(`${w.to.node}.${w.to.port}`, token);
    }
  }

  /** End reached: stop awaiting every outstanding ask and drop the held state. */
  function withdrawGates() {
    held.clear();
    outstanding.clear();
    gate = null;
    onGate(null);
  }
```

Part 3 continued — the snapshot, readiness and the run loop (same file, to EOF):

```js
  // --- snapshot ------------------------------------------------------------

  function snapshotObject() {
    return {
      version: 2,
      seq,
      graph: template,
      tokens: Object.fromEntries(tokens),
      outputs: Object.fromEntries(outputs),
      consumed: Object.fromEntries([...consumed].map(([id, m]) => [id, Object.fromEntries(m)])),
      ordinals: Object.fromEntries(ordinals),
      wires: Object.fromEntries([...wireState].map(([id, st]) => [id, { ...st }])),
      ended: ended ? { ...ended, result: { ...ended.result } } : null,
      // The FULL ledger entry is serialized (bindings + trigger included): reattach
      // re-invokes `execute` with the RECORDED args, and recomputing them from
      // `consumed` + `tokens` would silently change what a resumed execution works on.
      execs: [...execs.values()].map((e) => ({ ...e })),
      gates: [],
      asks: [],
      gate: null,
      ask: null,
    };
  }

  const snap = () => onSnapshot(snapshotObject());

  // --- readiness -----------------------------------------------------------

  /**
   * Amendment f, §3 "Firing rule". Flow kinds first (Task fires once; End/AND/
   * Combine all-fresh every execution; OR any-fresh), then the agent rules: the
   * first-run barrier over wired non-loop inputs (the synthesized `await` port
   * included), then any-fresh (default) or awaitAll.
   */
  function isReady(node) {
    const inputs = portsOf(node).inputs || [];
    const wired = wiredIn.get(node.id) || new Map();
    const spent = spentOf(node.id);
    const everRan = (ordinals.get(node.id) || 0) > 0;
    const awaitAll = node.config?.awaitAll === true;
    const isFresh = (port) => {
      const token = tokens.get(`${node.id}.${port}`);
      if (!token) return false;
      const prior = spent.get(port);
      return prior === undefined || token.seq > prior;
    };

    if (isFlow(node)) {
      switch (node.kind) {
        case 'task':
          return !everRan;                                  // zero inputs; fires once at t0
        case 'end':
        case 'and':
        case 'combine':
          return inputs.length > 0 && inputs.every((inp) => isFresh(inp.id));
        case 'or':
          return inputs.some((inp) => isFresh(inp.id));
        default:
          return false;                                     // unknown kind (V3)
      }
    }

    if (!everRan) {
      for (const inp of inputs) {
        if (!wired.has(inp.id)) {
          // V9 blocks this at save; stay defensively un-ready rather than firing a
          // node whose required payload can never arrive. Loop inputs are exempt.
          if (inp.required && !isLoopPort(node.id, inp)) return false;
          continue;
        }
        if (isLoopPort(node.id, inp)) continue;             // excused from the barrier
        if (!tokens.get(`${node.id}.${inp.id}`)) return false;
      }
      return true;
    }

    if (!awaitAll) return inputs.some((inp) => isFresh(inp.id));

    // awaitAll: a fresh loop token alone always re-fires (the loop path is the point).
    if (inputs.some((inp) => isLoopPort(node.id, inp) && isFresh(inp.id))) return true;
    let barrier = false;
    for (const inp of inputs) {
      if (!wired.has(inp.id) || isLoopPort(node.id, inp)) continue;
      barrier = true;
      if (!isFresh(inp.id)) return false;
    }
    return barrier;
  }

  const halted = () => Boolean(ended) || Boolean(failure) || pauseRequested || abortRequested;

  async function drainPasses() {
    for (;;) {
      let fired = false;
      for (const nodeId of order) {
        if (halted()) return;                 // pause/abort/End checked at every launch decision
        const node = nodeById.get(nodeId);
        if (!node || running.has(nodeId) || !isReady(node)) continue;
        if (isFlow(node)) { await fireFlow(node); fired = true; continue; }
        if (activeAgents >= maxParallel) continue;   // capped: retried once a slot frees
        fireAgent(node);
        fired = true;
      }
      if (!fired) return;
    }
  }

  function finish(result) {
    settled = true;
    if (result === 'error') controller.abort();
    if (result === 'done' && !ended) {
      warnings.push(QUIESCENCE_WARNING);
      log(QUIESCENCE_WARNING);
    }
    snap();                                   // one final snapshot at run resolution
    return result;
  }

  async function run() {
    for (;;) {
      while (completions.length) {
        const c = completions.shift();
        settle(c.h, c.res, c.err);
      }
      if (failure) return finish('error');
      if (abortRequested) return finish('error');
      if (!halted()) await drainPasses();
      if (failure) return finish('error');
      if (abortRequested) return finish('error');
      // Anything that landed while the pass ran — a completion, or a gate answer
      // that delivered its held token — gets its own pass before quiescence.
      if (completions.length || signalled) { signalled = false; continue; }
      if (running.size === 0) {
        if (ended) return finish('done');
        if (pauseRequested) return finish('paused');
        if (held.size === 0 && outstanding.size === 0) return finish('done');   // quiescence
      }
      await waitForChange();
    }
  }

  return {
    run,
    pause() { pauseRequested = true; wake(); },
    abort() { abortRequested = true; controller.abort(); wake(); },
    getState() {
      return {
        active: [...running].map(([nodeId, executionId]) => ({ nodeId, executionId })),
        executions: [...execs.values()].map((e) => ({ ...e })),
        // Latched OUTPUT tokens (what a wire carries), keyed '<node>.<outputPort>'.
        tokens: Object.fromEntries([...outputs].map(([k, t]) => [
          k, { seq: t.seq, type: t.type, path: t.path ?? null, firedAt: t.firedAt },
        ])),
        wireDeliveries: Object.fromEntries([...wireState].map(([id, st]) => [id, st.deliveries])),
        ended: ended ? { ...ended, result: { ...ended.result } } : null,
        endReached: Boolean(ended),
        result: ended ? { ...ended.result } : null,
        warnings: [...warnings],
        gate: gate ? { ...gate } : null,
        settled,
      };
    },
    get settled() { return settled; },
  };
}
```

- [ ] **Step 3: Run** — `node --test test/graph-scheduler.test.mjs`

`Expected: # pass 17` / `# fail 0`.

- [ ] **Step 4: Mutation audit** (do NOT commit these edits) — each must turn a test red, then revert:
  1. In `isLoopPort`, drop `Boolean(port?.loop) ||` → test 4 fails (the OR-valve worker never fires).
  2. In `bindFor`, delete the `node.kind === 'or'` freshest branch → test 6 fails (two OR emissions).
  3. In `route`, delete `if (ended) return;` → test 9 fails (`n_late` launches).
  4. In `finish`, delete the quiescence warning push → test 10 fails.
- [ ] **Step 5: Commit** — `worca: Node-graph v2 P3 — scheduler core (tokens, readiness, End drain)`

---

### Task 3: Loop budgets (A1) and the human gate (A4)

**Files:** modify `src/core/graph/scheduler.mjs`, `test/graph-scheduler.test.mjs`.

**Interfaces:** produces the gate contract consumed by P4's `_ask` wiring —
- ask payload: `{ id: 'gate-<wireId>-<deliveryNo>', kind: 'gate', wireId, nodeId: <the SOURCE node>, executionId, issues }`, answered `'another' | 'continue'` (anything else reads as `'continue'`).
- `onGate(g)` where `g = { wireId, fromNode, toNode, askId } | null` — P4 stamps `state.gate` from it.
- `onEvent('gate', { wireId, nodeId, executionId, issues, askId, status: 'held'|'another'|'continue' })` — audit only.

**Rules (⟨d/A1⟩ + ⟨d/A4⟩, parity-mandatory):**
- Per loop wire `{ deliveries, allowance = maxCycles − 1 }`; `maxCycles` = `wire.config.maxCycles ?? 3`. The wire's allowance caps TOTAL source firings around the loop at `maxCycles`, exactly like v1's `st.cycle < fb.maxCycles`.
- Delivering past the allowance HOLDS the token and asks the human gate: **"another"** → `allowance += 1`, deliver, loop continues; **"continue"** → the held token is discarded and the SOURCE node's `clean` outputs are force-fired (`forced: true`, the open issues in `meta`). No wired clean output ⇒ that path is terminal.
- **A4 payload rule**: the forced token reuses the HELD blocking token's `path`/`value` when the port types match, else the clean port's latched payload, else null.
- Non-interactive runs answer `continue` (today's behavior) — that is `onAsk`'s default.
- The End drain skips loop accounting and gates entirely.

- [ ] **Step 1: Write the failing tests** — append to `test/graph-scheduler.test.mjs`, and first add one entry to the `AGENTS` map (a refiner-shaped node whose clean and blocking outputs share a type, which is what makes the A4 same-type branch reachable):

```js
  polisher: {
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'clean' }, { id: 'revise', type: 'md', when: 'blocking' }],
    verdict: { filename: 'refine-cycle{cycle}.json' },
  },
```

```js
// ── 4. loop budgets and gates ────────────────────────────────────────────────

const withMaxCycles = (template, wireId, maxCycles) => {
  const clone = structuredClone(template);
  const w = clone.wires.find((x) => x.id === wireId);
  w.config = { ...(w.config || {}), maxCycles };
  return clone;
};

/** n_pol refines itself: `revise` (blocking) self-wire is the loop wire. */
const SELF_LOOP = TPL(
  [N('n_task', 'task'), N('n_pol', 'agent', 'polisher'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_pol.plan'), W('w2', 'n_pol.revise', 'n_pol.revise', { maxCycles: 2 }),
    W('w3', 'n_pol.plan', 'n_end.result')],
);

const blockingRevise = (p) => ({ verdict: BLOCKING(), outputs: { revise: { path: p } } });

test('18 A1: maxCycles caps TOTAL source firings; the gate fires at the would-be Nth delivery', { timeout: 5000 }, async () => {
  const h = harness({
    template: withMaxCycles(LOOP_TPL, 'w5', 3),
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: (a) => ({ verdict: BLOCKING(), outputs: { review: { path: `/p/r${a.ordinal}.md` } } }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_check').length, 3, 'maxCycles 3 ⇒ three source firings, then the gate');
  assert.equal(h.callsFor('n_work').length, 3);
  assert.equal(h.asks.length, 1, 'exactly one gate ask');
  assert.equal(h.asks[0].id, 'gate-w5-3', 'ask id is gate-<wireId>-<deliveryNo>');
  assert.deepEqual(Object.keys(h.asks[0]).sort(), ['executionId', 'id', 'issues', 'kind', 'nodeId', 'wireId']);
  assert.equal(h.asks[0].kind, 'gate');
  assert.equal(h.asks[0].nodeId, 'n_check', 'the gate names the SOURCE node');
  assert.equal(h.asks[0].executionId, 'x:n_check:3');
  assert.deepEqual(h.asks[0].issues, [{ severity: 'critical', title: 'boom' }]);
  assert.equal(h.scheduler.getState().wireDeliveries.w5, 2);
});

test('19 gate "another": the allowance grows by one and the held token is delivered', { timeout: 5000 }, async () => {
  const answers = ['another', 'continue'];
  const h = harness({
    template: withMaxCycles(LOOP_TPL, 'w5', 2),
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: (a) => ({ verdict: BLOCKING(), outputs: { review: { path: `/p/r${a.ordinal}.md` } } }),
    },
    onAsk: async (a) => answers.shift() ?? 'continue',
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_check').length, 3, 'one extra iteration was granted');
  const fix = h.callsFor('n_work').at(-1);
  assert.equal(fix.bindings.fix.path, '/p/r2.md', 'the HELD token was delivered, not a fresh one');
});

test('20 gate "continue": A4 force-fires the source clean side with the held payload', { timeout: 5000 }, async () => {
  const h = harness({
    template: SELF_LOOP,
    script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_pol').length, 2, 'maxCycles 2 ⇒ two firings');
  const forced = h.tokenEvents().find((e) => e.forced === true);
  assert.deepEqual(forced.from, { node: 'n_pol', port: 'plan' }, 'the CLEAN side force-fires');
  assert.equal(forced.path, '/p/rev2.md', 'A4: same type ⇒ the held blocking payload is reused');
  assert.equal(h.scheduler.getState().endReached, true);
  const end = h.callsFor('n_end')[0];
  assert.equal(end.bindings.result.path, '/p/rev2.md');
  assert.deepEqual(end.bindings.result.meta, { issues: [{ severity: 'critical', title: 'boom' }] });
  assert.equal(end.bindings.result.forced, true);
});

test('21 gate audit: held → continue events, state.gate lifecycle, non-interactive default', { timeout: 5000 }, async () => {
  const h = harness({ template: SELF_LOOP, script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) } });
  await h.scheduler.run();
  const audit = h.events.filter((e) => e.name === 'gate');
  assert.deepEqual(audit.map((e) => e.status), ['held', 'continue']);
  assert.equal(audit[0].wireId, 'w2');
  assert.equal(audit[0].askId, 'gate-w2-2');
  assert.equal(audit[0].nodeId, 'n_pol');
  assert.deepEqual(h.gates[0], { wireId: 'w2', fromNode: 'n_pol', toNode: 'n_pol', askId: 'gate-w2-2' });
  assert.equal(h.gates.at(-1), null, 'the gate clears when it resolves');
  assert.equal(h.scheduler.getState().gate, null);
});

test('22 two loop wires into one OR gate independently in the same drain', { timeout: 5000 }, async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_work', 'agent', 'worker'), N('n_c1', 'agent', 'checker'),
      N('n_c2', 'agent', 'checker'), N('n_or', 'or', null, { arity: 2 }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_work.plan'), W('w2', 'n_task.task', 'n_c1.plan'), W('w3', 'n_task.task', 'n_c2.plan'),
      W('w4', 'n_work.done', 'n_c1.done'), W('w5', 'n_work.done', 'n_c2.done'),
      W('w6', 'n_c1.review', 'n_or.in1', { maxCycles: 1 }), W('w7', 'n_c2.review', 'n_or.in2', { maxCycles: 1 }),
      W('w8', 'n_or.out', 'n_work.fix'), W('w9', 'n_c1.pass', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    script: {
      n_c1: byOrdinal({ verdict: BLOCKING('a'), outputs: { review: { path: '/p/a.md' } } }, { verdict: CLEAN }),
      n_c2: byOrdinal({ verdict: BLOCKING('b'), outputs: { review: { path: '/p/b.md' } } }, { verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  // maxCycles 1 ⇒ allowance 0 ⇒ the FIRST delivery on each wire gates.
  assert.deepEqual(h.asks.map((a) => a.id).sort(), ['gate-w6-1', 'gate-w7-1']);
  assert.deepEqual(h.scheduler.getState().wireDeliveries, { w6: 0, w7: 0 });
});
```

`Expected: 22 tests run, tests 18–22 FAIL. Without the budget code the loop never gates, so each of them trips its 5 s timeout: `'test failed' ... 'test timed out after 5000ms'`. (The 5 s option is deliberate and stays: an unbudgeted loop is an infinite loop, and a hanging suite is not a red test.)`

- [ ] **Step 2: Implement** — four edits to `src/core/graph/scheduler.mjs`.

**(a)** extend the verdict import:
```js
import { blockingIssues, hasBlocking } from '../../shared/graph/verdict.mjs';
```

**(b)** REPLACE the whole `route` function (the Task 2 body `function route(node, port, token) { … }`) with the budgeted one, and add the gate machinery immediately after it (above `withdrawGates`):

```js
  /**
   * Deliver a token along every wire out of a fired port. Loop-wire deliveries are
   * counted and gated HERE, per wire — before, and independently of, any downstream
   * bind. During the End drain nothing is routed at all: the token is recorded
   * (latched + evented) and accounting/gates are skipped.
   */
  function route(node, port, token, verdict, executionId) {
    if (ended) return;
    for (const w of outWires.get(`${node.id}.${port.id}`) || []) {
      const st = wireState.get(w.id);
      if (st) {
        if (st.deliveries >= st.allowance) { holdAt(w, token, verdict, node, executionId); continue; }
        st.deliveries += 1;
      }
      tokens.set(`${w.to.node}.${w.to.port}`, token);
    }
  }

  // --- gates ---------------------------------------------------------------

  /** The current gate descriptor for `state.gate` — the FIRST hold, or null. */
  function syncGate() {
    const first = held.values().next().value || null;
    const w = first ? wireById.get(first.wireId) : null;
    const next = first && w
      ? { wireId: first.wireId, fromNode: w.from.node, toNode: w.to.node, askId: first.askId }
      : null;
    const changed = JSON.stringify(next ?? null) !== JSON.stringify(gate ?? null);
    gate = next;
    if (changed) onGate(gate ? { ...gate } : null);
  }

  function askGate(entry) {
    Promise.resolve(onAsk({
      id: entry.askId,
      kind: 'gate',
      wireId: entry.wireId,
      nodeId: entry.nodeId,
      executionId: entry.executionId,
      issues: entry.issues,
    })).then(
      (answer) => resolveGate(entry.wireId, answer),
      () => resolveGate(entry.wireId, 'continue'),
    );
  }

  /** Past the allowance: HOLD the token and ask the human. "Open issues" = the
   *  critical/major findings that caused the block; they ride the ask and, on
   *  continue, the forced token's meta. */
  function holdAt(wire, token, verdict, node, executionId) {
    const st = wireState.get(wire.id);
    const deliveryNo = st.deliveries + 1;           // the delivery this hold stands in for
    const issues = blockingIssues(verdict);
    const askId = `gate-${wire.id}-${deliveryNo}`;
    const entry = { wireId: wire.id, nodeId: node.id, executionId, token, issues, askId };
    held.set(wire.id, entry);
    outstanding.add(wire.id);
    onEvent('gate', { wireId: wire.id, nodeId: node.id, executionId, issues, askId, status: 'held' });
    syncGate();
    askGate(entry);
  }

  function resolveGate(wireId, answer) {
    if (!outstanding.has(wireId)) return;     // withdrawn by End (or already answered) — a no-op
    outstanding.delete(wireId);
    const entry = held.get(wireId);
    held.delete(wireId);
    syncGate();
    if (!entry) return;
    const decision = answer === 'another' ? 'another' : 'continue';
    onEvent('gate', {
      wireId, nodeId: entry.nodeId, executionId: entry.executionId,
      issues: entry.issues, askId: entry.askId, status: decision,
    });
    if (decision === 'another') {
      const st = wireState.get(wireId);
      st.allowance += 1;
      st.deliveries += 1;
      const w = wireById.get(wireId);
      tokens.set(`${w.to.node}.${w.to.port}`, entry.token);
    } else {
      forceClean(entry);
    }
    snap();
    wake();
  }

  /**
   * A4: on "continue" the held blocking token is discarded and each of the SOURCE
   * node's clean outputs force-fires — payload = the held token's path/value when
   * the port types match, else the clean port's latched payload, else null;
   * `forced` + the open issues in meta either way.
   */
  function forceClean(entry) {
    const node = nodeById.get(entry.nodeId);
    if (!node) return;
    for (const port of (portsOf(node).outputs || []).filter((o) => o.when === 'clean')) {
      const latched = outputs.get(`${node.id}.${port.id}`);
      const payload = port.type === entry.token.type
        ? { path: entry.token.path ?? null, value: entry.token.value ?? null }
        : latched
          ? { path: latched.path ?? null, value: latched.value ?? null }
          : { path: null, value: null };
      const token = makeToken({
        type: port.type,
        ...payload,
        meta: { issues: entry.issues },
        sourceExecutionId: entry.executionId,
        forced: true,
      });
      emitToken(node, port, token);
      outputs.set(`${node.id}.${port.id}`, token);
      route(node, port, token, null, entry.executionId);
    }
  }
```

**(c)** REPLACE `withdrawGates`'s body so the notifier cannot double-fire:
```js
  function withdrawGates() {
    held.clear();
    outstanding.clear();
    syncGate();
  }
```

**(d)** REPLACE the four literal fields at the end of `snapshotObject` (`gates: [], asks: [], gate: null, ask: null,`) — hoist the two lists above the `return`:
```js
  function snapshotObject() {
    // `held` is a Map — N loop wires can block in ONE drain (two verifiers into an
    // OR, both at allowance). Every hold is serialized; `gate`/`ask` keep their
    // singular spec shape as the FIRST hold.
    const gates = [...held.values()].map((g) => ({
      wireId: g.wireId, nodeId: g.nodeId, executionId: g.executionId,
      token: g.token, issues: g.issues, askId: g.askId,
    }));
    const asks = gates.map((g) => ({
      id: g.askId, kind: 'gate', wireId: g.wireId, nodeId: g.nodeId,
      executionId: g.executionId, issues: g.issues,
    }));
    return {
      version: 2,
      // … every field from Task 2, unchanged, then:
      gates,
      asks,
      gate: gates[0] || null,
      ask: asks[0] || null,
    };
  }
```

- [ ] **Step 3: Run** — `node --test test/graph-scheduler.test.mjs`

`Expected: # pass 22` / `# fail 0`.

- [ ] **Step 4: Mutation audit** (revert each): change `allowance = maxCycles − 1` to `maxCycles` → test 18 fails (4 firings); drop the `port.type === entry.token.type` branch in `forceClean` → test 20 fails (`path` null); drop `forced: true` → test 20 fails.
- [ ] **Step 5: Commit** — `worca: Node-graph v2 P3 — per-wire loop budgets and the A4 gate`

---

### Task 4: Composite fan-out driver (expand → phases → slices → finish)

**Files:** modify `src/core/graph/scheduler.mjs`, `test/graph-scheduler.test.mjs`.

**Interfaces:** produces `export function sliceExecutionId(parentExecutionId, taskId)` → `x:<nodeId>:<ordinal>:<taskId>` (the decomposition contract mints `p<ordinal>t<n>` ids, so the shipped shape is `x:n_impl:1:p1t1`), and the four-mode composite protocol on the injected `execute`:

```
{ …args, composite:'expand', expandsPort }                    -> { phases:[{ ordinal, tasks:[{id,title,file,path}] }] }
{ …args, composite:'phase', phase, phaseStatus:'running'|'done'|'error' } -> {}   (status plumbing only)
{ …args, executionId:<slice>, kind:'task', slice }            -> an ordinary execution of one slice
{ …args, composite:'finish', expandsPort, phases }            -> { outputs }  — the ONE publish
```

**Rules:** a FRESH token binding an `expands` input — and NO fresh loop trigger (A3) — turns one firing into a composite: phases run sequentially, each phase's tasks in parallel under the semaphore, all recorded `kind:'task'` under the SAME node, and the node publishes ONCE at the end. The first genuine (non-abort) slice failure aborts its phase-mates and fails the whole composite. `phases: []` (including every malformed document) downgrades the firing to ONE ordinary execution with the expands input left UNBOUND. A halted run (pause/abort/End/failure) returns the empty publish and never calls `finish`, so no worktree is staged and no phase is falsely marked done. A later fix-cycle re-fire runs a single normal execution on the combined diff.

- [ ] **Step 1: Write the failing tests** — add one `AGENTS` entry and append the cases:

```js
  splitter: {
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'tasks', type: 'json', when: 'always' }],
  },
```

```js
// ── 5. composite fan-out ─────────────────────────────────────────────────────

/** maker -> splitter -> worker(expands `task`), with a checker loop for the A3 case. */
const FANOUT = TPL(
  [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_split', 'agent', 'splitter'),
    N('n_work', 'agent', 'worker'), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_split.plan'),
    W('w3', 'n_make.out', 'n_work.plan'), W('w4', 'n_split.tasks', 'n_work.task'),
    W('w5', 'n_make.out', 'n_check.plan'), W('w6', 'n_work.done', 'n_check.done'),
    W('w7', 'n_check.review', 'n_work.fix', { maxCycles: 3 }), W('w8', 'n_check.pass', 'n_end.result')],
);

const PHASES = [
  { ordinal: 1, tasks: [
    { id: 'p1t1', title: 'One', file: 'tasks/p1-t1.md', path: '/p/tasks/p1-t1.md' },
    { id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md', path: '/p/tasks/p1-t2.md' },
  ] },
  { ordinal: 2, tasks: [{ id: 'p2t1', title: 'Three', file: 'tasks/p2-t1.md', path: '/p/tasks/p2-t1.md' }] },
];

/** A composite-aware worker script; `onSlice` may throw to test sibling abort. */
const compositeWorker = ({ phases = PHASES, onSlice = () => ({}) } = {}) => (args) => {
  if (args.composite === 'expand') return { phases };
  if (args.composite === 'phase') return {};
  if (args.composite === 'finish') return { outputs: {} };
  if (args.kind === 'task') return onSlice(args);
  return {};
};

test('23 composite: expand → phases → parallel slices with siblings → finish, ONE publish', async () => {
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: () => ({ outputs: { tasks: { path: '/p/decomposition.json' } } }),
      n_work: compositeWorker(),
      n_check: () => ({ verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const c = h.callsFor('n_work');
  assert.deepEqual(
    c.map((x) => x.composite ? `${x.composite}${x.phase ? `:${x.phase}:${x.phaseStatus}` : ''}` : `slice:${x.slice.id}`),
    ['expand', 'phase:1:running', 'slice:p1t1', 'slice:p1t2', 'phase:1:done',
      'phase:2:running', 'slice:p2t1', 'phase:2:done', 'finish'],
  );
  const slice = c.find((x) => x.slice?.id === 'p1t1');
  assert.deepEqual(slice.slice, {
    id: 'p1t1', title: 'One', phase: 1, path: '/p/tasks/p1-t1.md', index: 0,
    siblings: [{ id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md' }],
  });
  assert.equal(slice.executionId, 'x:n_work:1:p1t1');
  assert.equal(slice.bindings.task.path, '/p/tasks/p1-t1.md', 'the expands input is rebound to the slice file');
  assert.deepEqual(c.find((x) => x.slice?.id === 'p2t1').slice.siblings, [], 'a solo task has no siblings');
  const row = h.execEvents().find((e) => e.executionId === 'x:n_work:1:p1t2' && e.status === 'start');
  assert.equal(row.kind, 'task');
  assert.equal(row.ordinal, 1);
  assert.equal(row.phase, 1);
  assert.equal(row.taskId, 'p1t2');
  assert.equal(row.title, 'Two');
  assert.equal(row.parentExecutionId, 'x:n_work:1');
  assert.equal(h.tokenEvents().filter((e) => e.from.node === 'n_work').length, 1, 'the node publishes ONCE');
});

test('24 sibling failure aborts phase-mates and fails the run', { timeout: 5000 }, async () => {
  let mateSignal = null;
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: () => ({ outputs: { tasks: { path: '/p/d.json' } } }),
      n_work: compositeWorker({
        onSlice: (a) => {
          if (a.slice.id === 'p1t1') { mateSignal = a.signal; return new Promise(() => {}); }
          throw new Error('slice exploded');
        },
      }),
    },
  });
  assert.equal(await h.scheduler.run(), 'error');
  assert.equal(mateSignal.aborted, true, 'the phase-mate was aborted');
  assert.ok(h.callsFor('n_work').some((x) => x.phaseStatus === 'error'), 'the phase is marked error');
  assert.ok(h.callsFor('n_work').every((x) => x.composite !== 'finish'), 'finish never runs');
  const err = h.execEvents().find((e) => e.nodeId === 'n_work' && e.status === 'error' && e.kind === 'cycle');
  assert.match(err.error, /composite execution failed in phase 1: task "Two": slice exploded/);
});

test('25 an empty decomposition downgrades to ONE ordinary execution with the port unbound', async () => {
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: () => ({ outputs: { tasks: { path: '/p/d.json' } } }),
      n_work: compositeWorker({ phases: [] }),
      n_check: () => ({ verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const c = h.callsFor('n_work');
  assert.equal(c.length, 2, 'the expand probe, then one ordinary execution');
  assert.equal(c[1].composite, undefined);
  assert.equal(c[1].bindings.task, undefined, 'the expands binding is stripped');
  assert.deepEqual(c[1].trigger.freshPorts, ['plan'], 'and so is its freshness (no slice directive)');
});

test('26 A3: a fresh loop token beats the expands port — the fix re-fire is one normal execution', async () => {
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: () => ({ outputs: { tasks: { path: '/p/d.json' } } }),
      n_work: compositeWorker(),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const second = h.callsFor('n_work').filter((x) => x.ordinal === 2);
  assert.equal(second.length, 1, 'ordinal 2 is a single plain call');
  assert.equal(second[0].composite, undefined);
  assert.deepEqual(second[0].trigger.freshPorts, ['fix']);
  assert.equal(second[0].bindings.task.path, '/p/decomposition.json', 'the latched manifest is still bound');
});
```

`Expected: 26 tests run, 23–26 fail — e.g. test 23 `expected [ 'expand', … ] to deeply equal [ ]` (no composite call is ever made).`

- [ ] **Step 2: Implement** — four edits to `src/core/graph/scheduler.mjs`.

**(a)** Add the exported id minter + the abort predicate just above `export function createScheduler`:

```js
/**
 * The execution id of one composite sub-execution: the parent's id plus the manifest
 * task id (`x:n_impl:1:p1t1`). Deterministic on purpose — a resumed composite
 * re-mints the SAME ids, so its ledger entries overwrite rather than accumulate.
 * @param {string} parentExecutionId
 * @param {string} taskId
 */
export function sliceExecutionId(parentExecutionId, taskId) {
  return `${parentExecutionId}:${taskId}`;
}

/** An abort rejection — a sibling cancelled by a phase-mate's failure, or the whole
 *  run going down. Never counted as the FIRST genuine failure. */
const isAbortError = (err) => err?.name === 'AbortError';
```

**(b)** In `startExecution`, stamp the expands port and report the composite flag. REPLACE its last three lines (`execs.set(executionId, entry); running.set(node.id, executionId); emitExec(node, entry, 'start'); return { node, entry, args: argsFor(node, entry), composite: false };`) with:

```js
    const expandsPort = expandsTrigger(node, b);
    if (expandsPort) entry.expandsPort = expandsPort;
    execs.set(executionId, entry);
    running.set(node.id, executionId);
    emitExec(node, entry, 'start');
    return { node, entry, args: argsFor(node, entry), composite: !!expandsPort };
```

**(c)** REPLACE `invoke`:
```js
  /** Run one started execution: the composite driver, or the plain injected call. */
  function invoke(h) {
    return h.composite ? runComposite(h) : execute(h.args);
  }
```

**(d)** Add the driver immediately after `invoke` (before `settle`):

```js
  /**
   * The FRESH `expands` input that makes this firing COMPOSITE, or null.
   *
   * A3, parity-mandatory: a fresh LOOP input wins outright — a fix-cycle re-fire runs
   * ONE ordinary execution on the combined diff, which is v1's `!bus.review` arm of
   * the same guard. A latched expands token never fans out again either, because only
   * FRESH ports are considered.
   */
  function expandsTrigger(node, b) {
    if (isFlow(node)) return null;
    const inputs = portsOf(node).inputs || [];
    const fresh = new Set(b.trigger.freshPorts || []);
    if (inputs.some((inp) => isLoopPort(node.id, inp) && fresh.has(inp.id))) return null;
    const port = inputs.find((inp) => inp?.expands && fresh.has(inp.id) && b.bindings[inp.id]);
    return port ? port.id : null;
  }

  /**
   * Drive ONE composite execution. Phases run in order, each phase's tasks in
   * parallel under the semaphore, and the single value returned here is what the node
   * PUBLISHES — so its outputs fire exactly once, after the last phase, never once
   * per task. Pause/abort is checked at every phase boundary.
   */
  async function runComposite(h) {
    const portId = h.entry.expandsPort;
    const expanded = await execute({ ...h.args, composite: 'expand', expandsPort: portId });
    const phases = Array.isArray(expanded?.phases) ? expanded.phases : [];
    if (!phases.length) return runUnexpanded(h, portId);

    for (const ph of phases) {
      if (halted()) return { outputs: {} };
      await runPhase(h, portId, ph);
    }
    if (halted()) return { outputs: {} };
    return await execute({ ...h.args, composite: 'finish', expandsPort: portId, phases });
  }

  /**
   * Nothing to fan out. Strip the expands binding — so the consumer neither sees the
   * manifest as an input nor renders its slice directive (A3) — and run the ONE
   * ordinary execution the firing would have been. The entry is mutated in place
   * because it is the ledger row a resume would re-invoke from.
   */
  async function runUnexpanded(h, portId) {
    const { node, entry } = h;
    delete entry.bindings[portId];
    entry.trigger = {
      ...entry.trigger,
      freshPorts: (entry.trigger.freshPorts || []).filter((p) => p !== portId),
    };
    delete entry.expandsPort;
    h.composite = false;                    // … so settle() frees the slot taken here
    await takeSlot();
    h.args = argsFor(node, entry);
    return await execute(h.args);
  }

  /**
   * One phase: every task launched together, each awaiting its own semaphore slot.
   * The FIRST genuine (non-abort) failure aborts its siblings immediately through the
   * phase-local controller and fails the whole composite — v1's abort-on-first-
   * failure, kept.
   */
  async function runPhase(h, portId, ph) {
    const tasks = Array.isArray(ph.tasks) ? ph.tasks : [];
    const phaseAbort = new AbortController();
    let firstError = null;
    await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'running' });

    await Promise.allSettled(tasks.map((task, index) =>
      runSlice(h, portId, ph, task, index, phaseAbort).catch((err) => {
        if (!firstError && !isAbortError(err)) {
          firstError = { task, err };
          phaseAbort.abort();
        }
        throw err;
      })));

    if (firstError) {
      await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'error' });
      const label = firstError.task.title || firstError.task.id;
      throw new Error(
        `composite execution failed in phase ${ph.ordinal}: task "${label}": ` +
        `${firstError.err?.message || firstError.err}`,
      );
    }
    // A halted run leaves the phase RUNNING: the resume re-runs the whole composite,
    // and a phase that never finished must not read as done.
    if (halted()) return;
    await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'done' });
  }

  /**
   * One task sub-execution: the consumer node with its expands input rebound to this
   * task's own markdown file, still FRESH so the slice directive renders, and its
   * phase-mates listed in `slice.siblings` (the shared-working-tree block). Recorded
   * `kind:'task'` under the SAME node — it publishes nothing; `finish` does that.
   */
  async function runSlice(h, portId, ph, task, index, phaseAbort) {
    const { node, entry } = h;
    await takeSlot();
    const sub = {
      executionId: sliceExecutionId(entry.executionId, task.id),
      nodeId: node.id,
      kind: 'task',
      ordinal: entry.ordinal,
      status: 'start',
      sessionId: null,
      phase: ph.ordinal,
      taskId: task.id,
      title: task.title || task.id,
      parentExecutionId: entry.executionId,
      taskIndex: index + 1,                                   // 1-based within its phase (the CLI's "task 3/7")
      taskTotal: (Array.isArray(ph.tasks) ? ph.tasks : []).length,
      bindings: {
        ...entry.bindings,
        [portId]: { seq: entry.bindings[portId]?.seq, type: 'md', path: task.path ?? null },
      },
      trigger: entry.trigger,
    };
    execs.set(sub.executionId, sub);
    emitExec(node, sub, 'start');
    const args = {
      ...argsFor(node, sub),
      node: { ...node },
      signal: AbortSignal.any([controller.signal, phaseAbort.signal]),
      kind: 'task',
      parentExecutionId: sub.parentExecutionId,   // the adapter's ledger row + exec_meta read these three
      taskIndex: sub.taskIndex,
      taskTotal: sub.taskTotal,
      slice: {
        id: task.id,
        title: task.title ?? null,
        phase: ph.ordinal,
        path: task.path ?? null,
        index,
        siblings: (Array.isArray(ph.tasks) ? ph.tasks : [])
          .filter((t) => t.id !== task.id)
          .map((t) => ({ id: t.id, title: t.title ?? null, file: t.file ?? null })),
      },
    };
    try {
      const res = await execute(args);
      sub.status = 'done';
      if (res?.sessionId) sub.sessionId = res.sessionId;
      emitExec(node, sub, 'done');
      return res;
    } catch (err) {
      sub.status = 'error';
      sub.error = String(err?.message || err);
      emitExec(node, sub, 'error', { error: sub.error });
      throw err;
    } finally {
      freeSlot();
    }
  }
```

- [ ] **Step 3: Run** — `node --test test/graph-scheduler.test.mjs` → `Expected: # pass 26` / `# fail 0`.
- [ ] **Step 4: Mutation audit** (revert each): delete the `slice.siblings` mapping → test 23 fails; delete the loop-wins guard in `expandsTrigger` → test 26 fails; return `{}` instead of `runUnexpanded(...)` for empty phases → test 25 fails.
- [ ] **Step 5: Commit** — `worca: Node-graph v2 P3 — composite fan-out driver`

---

### Task 5: Snapshot, `reattach(snapshot)` and the paused-execution status

**Files:** modify `src/core/graph/scheduler.mjs`, `test/graph-scheduler.test.mjs`.

**Interfaces:** produces `reattach(snapshot)` on the returned object (call it BEFORE `run()`), and the `{ paused: true }` return value on `execute` (the adapter's answer when a pause cancels an in-flight execution: the entry is marked `paused` — non-terminal — nothing publishes, and the resume re-invokes it).

**Snapshot shape (written after EVERY publish and at finish):**
```js
{ version:2, seq, graph, tokens, outputs, consumed, ordinals,
  wires:{[wireId]:{deliveries, allowance}}, ended,
  execs:[{executionId, nodeId, kind, ordinal, status, sessionId, bindings, trigger,
          taskId?, title?, phase?, parentExecutionId?, taskIndex?, taskTotal?, expandsPort?, error?}],
  gates:[{wireId, nodeId, executionId, token, issues, askId}], asks, gate, ask }
```
`reattach` re-invokes `execute` once per NON-TERMINAL execution with **exactly the recorded arguments** — recomputing bindings from `consumed`+`tokens` is forbidden (a source that re-published after the bind would silently change what the resumed execution works on). Composite slices are re-invoked BY their shell (the shell re-runs the whole fan-out and re-mints the same ids). A restored hold re-raises its ask unless `ended` is set (drain resume launches nothing).

- [ ] **Step 1: Write the failing tests** — append:

```js
// ── 6. snapshot / reattach ───────────────────────────────────────────────────

test('27 the snapshot carries the full resume state, including outputs and recorded args', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  await h.scheduler.run();
  const s = h.last();
  assert.deepEqual(Object.keys(s).sort(), [
    'ask', 'asks', 'consumed', 'ended', 'execs', 'gate', 'gates', 'graph',
    'ordinals', 'outputs', 'seq', 'tokens', 'version', 'wires',
  ]);
  assert.equal(s.version, 2);
  assert.equal(s.outputs['n_make.out'].path, '/p/plan.md', 'latched OUTPUT tokens survive');
  assert.equal(s.tokens['n_work.plan'].path, '/p/plan.md', 'delivered INPUT tokens survive');
  assert.deepEqual(s.wires, { w5: { deliveries: 0, allowance: 2 } });
  assert.equal(s.consumed.n_work.plan, s.outputs['n_make.out'].seq);
  const work = s.execs.find((e) => e.executionId === 'x:n_work:1');
  assert.equal(work.status, 'done');
  assert.equal(work.bindings.plan.path, '/p/plan.md', 'the RECORDED args are serialized');
  assert.deepEqual(work.trigger.freshPorts, ['plan']);
  assert.equal(s.ended.nodeId, 'n_end');
});

test('28 reattach re-invokes only the non-terminal execution, with its recorded args', async () => {
  const hold = deferred();
  const first = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_work: () => hold.promise.then(() => ({ paused: true })),   // the adapter's answer to a pause
    },
  });
  const run = first.scheduler.run();
  await tick(); await tick();
  first.scheduler.pause();
  hold.resolve();
  assert.equal(await run, 'paused');
  const snap = first.last();
  assert.equal(snap.execs.find((e) => e.executionId === 'x:n_work:1').status, 'paused');
  assert.equal(first.execEvents().some((e) => e.status === 'paused'), true);

  const second = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  second.scheduler.reattach(snap);
  assert.equal(await second.scheduler.run(), 'done');
  assert.deepEqual(second.callsFor('n_task'), [], 'a finished flow node is never re-run');
  assert.deepEqual(second.callsFor('n_make'), [], 'a finished agent is never re-run');
  const again = second.callsFor('n_work');
  assert.equal(again.length, 1);
  assert.equal(again[0].executionId, 'x:n_work:1', 'the SAME execution id');
  assert.equal(again[0].bindings.plan.path, '/p/plan.md', 'with the RECORDED bindings');
  assert.equal(second.scheduler.getState().endReached, true);
});

test('29 drain resume: a snapshot with `ended` set launches nothing', async () => {
  const done = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  await done.scheduler.run();
  const resumed = harness({ template: LOOP_TPL, script: {} });
  resumed.scheduler.reattach(done.last());
  assert.equal(await resumed.scheduler.run(), 'done');
  assert.deepEqual(resumed.calls, []);
});

test('30 a restored hold re-raises its gate ask', { timeout: 5000 }, async () => {
  const asked = deferred();
  const first = harness({
    template: SELF_LOOP,
    script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) },
    onAsk: (a) => { asked.resolve(a); return new Promise(() => {}); },   // never answered
  });
  const run = first.scheduler.run();
  await asked.promise;
  first.scheduler.pause();
  assert.equal(await run, 'paused');
  const snap = first.last();
  assert.equal(snap.gates.length, 1);
  assert.equal(snap.gate.askId, 'gate-w2-2');
  assert.equal(snap.gates[0].token.path, '/p/rev2.md', 'the held token survives');

  const second = harness({ template: SELF_LOOP, script: { n_pol: (a) => blockingRevise(`/p/x.md`) } });
  second.scheduler.reattach(snap);
  assert.equal(await second.scheduler.run(), 'done');
  assert.equal(second.asks.length, 1, 'the hold was re-asked');
  assert.equal(second.asks[0].id, 'gate-w2-2');
  assert.equal(second.scheduler.getState().endReached, true);
});
```

`Expected: 30 tests run, 28–30 FAIL with `TypeError: second.scheduler.reattach is not a function`. Test 27 passes on arrival — it pins the snapshot shape Tasks 2/3 already write, and `restore` must round-trip exactly it; if it is red, the Task 3 snapshot edit is wrong.`

- [ ] **Step 2: Implement** — three edits to `src/core/graph/scheduler.mjs`.

**(a)** REPLACE the last line of `settle` (`if (err || res?.error) failExecution(h, err || res.error); else completeExecution(h, res || {});`) with the three-way branch, and add `pausedExecution` after `failExecution`:

```js
    if (err || res?.error) failExecution(h, err || res.error);
    else if (res?.paused === true) pausedExecution(h);
    else completeExecution(h, res || {});
```

```js
  /**
   * A pause cancelled this execution. The row stays NON-TERMINAL and nothing is
   * published, so `reattach` re-invokes it with the recorded args on resume.
   */
  function pausedExecution(h) {
    const { node, entry } = h;
    entry.status = 'paused';
    emitExec(node, entry, 'paused');
    snap();
  }
```

**(b)** Add `restore` + `reattach` immediately after `snap` (before the readiness section):

```js
  function restore(s) {
    if (!s) return;
    seq = s.seq ?? 0;
    for (const [k, v] of Object.entries(s.tokens || {})) tokens.set(k, v);
    for (const [k, v] of Object.entries(s.outputs || {})) outputs.set(k, v);
    for (const [id, m] of Object.entries(s.consumed || {})) consumed.set(id, new Map(Object.entries(m)));
    for (const [id, n] of Object.entries(s.ordinals || {})) ordinals.set(id, n);
    for (const [id, st] of Object.entries(s.wires || {})) wireState.set(id, { ...st });
    for (const e of s.execs || []) execs.set(e.executionId, { ...e });
    ended = s.ended ? { ...s.ended, result: { ...s.ended.result } } : null;
    // Every hold comes back (reattach re-asks all of them). A pre-plural resume point
    // carries only the singular `gate`; read it as a one-element list.
    const gates = Array.isArray(s.gates) ? s.gates : (s.gate ? [s.gate] : []);
    if (!ended) for (const g of gates) held.set(g.wireId, { ...g });
  }

  /**
   * Restore a snapshot and re-invoke `execute` once per NON-TERMINAL execution with
   * exactly the recorded arguments — the injected execute decides re-attach vs
   * re-run. Call BEFORE `run()`.
   *
   * A composite's slices are re-invoked BY their shell, not from here: the shell
   * re-runs the whole fan-out (v1 resumed the decomposed stage whole) and re-mints
   * the same ids, so those stale rows are overwritten in place.
   */
  function reattach(snapshot) {
    restore(snapshot);
    for (const entry of [...execs.values()]) {
      if (TERMINAL.has(entry.status)) continue;
      if (entry.kind === 'task') continue;
      const node = nodeById.get(entry.nodeId);
      if (!node) continue;
      running.set(node.id, entry.executionId);
      const h = { node, entry, args: argsFor(node, entry), composite: !!entry.expandsPort };
      if (!isFlow(node) && !h.composite) activeAgents += 1;
      let p;
      try { p = invoke(h); } catch (err) { p = Promise.reject(err); }
      Promise.resolve(p).then(
        (res) => { completions.push({ h, res, err: null }); wake(); },
        (err) => { completions.push({ h, res: null, err }); wake(); },
      );
    }
    // A gate restored without an End re-raises its ask — otherwise the held token has
    // nobody to answer for it and the run would deadlock.
    for (const entry of [...held.values()]) {
      if (outstanding.has(entry.wireId)) continue;
      outstanding.add(entry.wireId);
      askGate(entry);
    }
    syncGate();
  }
```

**(c)** Add `reattach` to the returned object, directly after `run`:
```js
    run,
    reattach,
```

- [ ] **Step 3: Run** — `node --test test/graph-scheduler.test.mjs` → `Expected: # pass 30` / `# fail 0`.
- [ ] **Step 4: Mutation audit** (revert each): in `reattach`, rebuild the args from `tokens` instead of `entry.bindings` → test 28 fails; drop `if (!ended)` in `restore` → test 29 fails (a re-asked gate on a drained run); drop the `res?.paused` branch → test 28 fails ('done' instead of 'paused').
- [ ] **Step 5: Commit** — `worca: Node-graph v2 P3 — snapshot and reattach`

---

### Task 6: `executor.mjs` pure API — allocation, the Ports block, A3 mode selection, decomposition, mock role

**Files:** create `src/core/graph/executor.mjs`; create `test/graph-executor.test.mjs`.

**Interfaces (produced):** `allocateOutputs({node, ports, executionId, ordinal, runCtx})`, `allocateVerdict({node, ports, ordinal, runCtx})`, `portIoBlock({node, ports, bindings, outputs, verdict, ctx})`, `selectMode({ports, bindings, freshPorts})`, `taskSourcedPorts(template, nodeId)`, `expandsOutputPort(template, portsFn, nodeId)`, `normalizeDecomposition(raw)`, `readDecomposition(path)`, `resolveMockRole({meta, expandsPort})`, `readVerdict(path)`.

**`runCtx` contract** (built by P4's `_execute`, hand-built in tests):
```js
runCtx = { pipelineDir, projectDir, baseName, datePrefix, workspaceKey, duplicateKey, slice, planVersion }
// planVersion: () => number   — the run-global plan-version counter, ++ per call
// duplicateKey: boolean       — true when >1 agent node in the resolved graph shares this key
// slice: string|null          — the slice id on a composite sub-execution, else null
```

**Allocation rules:** filename templates carry `{cycle}` (= the execution ordinal), `{base}` (= `runCtx.baseName`) and `{vsuffix}` (`''` for version 1, `-v<n>` after). `{vsuffix}` consumes ONE tick of `runCtx.planVersion()`, and only when the template carries it. Each DISTINCT `[store, filename]` pair is resolved exactly ONCE per execution, so two outputs sharing a template (the refiner's `plan`/`revise`) resolve to ONE `{path, store}` and burn ONE plan version. Ports with no `filename` (every void port) allocate nothing. `store:'project'` routes through `artifacts.mjs`: an artifactKind/`id` of `plan` → `planPath(projectDir, baseName, version, datePrefix, workspaceKey)`, anything else → `reviewPath(projectDir, baseName, datePrefix, kind, workspaceKey)` with `kind` read off a `{base}-<kind>.md` template. The DUPLICATE-KEY rule prefixes every `store:'run'` output and the verdict with `<nodeId>-` when `runCtx.duplicateKey`, and with `<sliceId>-` when `runCtx.slice` (parallel slices share their parent's ordinal, so without it they would clobber one filename).

- [ ] **Step 1: Write the failing test** — `test/graph-executor.test.mjs`

```js
// test/graph-executor.test.mjs
// The executor's PURE surface: filename allocation from sidecar templates, the
// "## Ports (this run)" block and its `as` renderers, A3 mode selection, the
// decomposition document, the generic MOCK-role chain and the flow executors.
// Every fixture uses CUSTOM agent keys — no builtin name appears in this file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  allocateOutputs, allocateVerdict, portIoBlock, selectMode, taskSourcedPorts,
  expandsOutputPort, normalizeDecomposition, readDecomposition, resolveMockRole, readVerdict,
} from '../src/core/graph/executor.mjs';

// `store:'project'` allocations resolve under worcaHome() — isolate it or the tests
// write plans/reviews into the user's REAL store.
useTempHome(after);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const pipelineDir = tmp('worca-exec-pipe-');
const projectDir = tmp('worca-exec-proj-');

function runCtx(over = {}) {
  let v = 0;
  return {
    pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
    workspaceKey: null, duplicateKey: false, slice: null,
    planVersion: () => { v += 1; return v; },
    ...over,
  };
}

const node = (id = 'n_x', over = {}) => ({ id, kind: 'agent', key: 'custom', x: 0, y: 0, config: {}, ...over });

const REFINER_LIKE = {
  inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', loop: true }],
  outputs: [
    { id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
    { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
  ],
  verdict: { filename: 'refine-review-cycle{cycle}.json' },
};

test('1 allocation: one resolution per DISTINCT template, one plan-version tick', () => {
  const rc = runCtx();
  const out = allocateOutputs({ node: node(), ports: REFINER_LIKE, ordinal: 2, runCtx: rc });
  assert.equal(out.plan.path, out.revise.path, 'a shared template resolves once');
  assert.match(out.plan.path, /01-01-26-feature\.md$/, 'version 1 renders no suffix');
  assert.equal(out.plan.store, 'project');
  const second = allocateOutputs({ node: node(), ports: REFINER_LIKE, ordinal: 3, runCtx: rc });
  assert.match(second.plan.path, /01-01-26-feature-v2\.md$/, 'the next execution ticks to -v2');
});

test('2 allocation: {cycle}, run store, void ports, duplicate-key and slice prefixes', () => {
  const ports = {
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: 'webui-review-cycle{cycle}.md', store: 'run' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
    verdict: { filename: 'webui-review-cycle{cycle}.json' },
  };
  const plain = allocateOutputs({ node: node(), ports, ordinal: 2, runCtx: runCtx() });
  assert.equal(plain.review.path, join(pipelineDir, 'webui-review-cycle2.md'));
  assert.equal(plain.pass, undefined, 'a void port allocates nothing');
  assert.equal(allocateVerdict({ node: node(), ports, ordinal: 2, runCtx: runCtx() }).path,
    join(pipelineDir, 'webui-review-cycle2.json'));
  const dup = allocateOutputs({ node: node('n_two'), ports, ordinal: 1, runCtx: runCtx({ duplicateKey: true }) });
  assert.equal(dup.review.path, join(pipelineDir, 'n_two-webui-review-cycle1.md'));
  const slice = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx({ slice: 'p1t2' }) });
  assert.equal(slice.review.path, join(pipelineDir, 'p1t2-webui-review-cycle1.md'));
  assert.equal(allocateVerdict({ node: node(), ports, ordinal: 1, runCtx: runCtx() }).path,
    join(pipelineDir, 'webui-review-cycle1.json'));
  assert.equal(allocateVerdict({ node: node(), ports: { outputs: [] }, ordinal: 1, runCtx: runCtx() }), null);
});

test('3 the Ports block: `as` renderers, the await port, shared paths, placeholders', () => {
  const ports = {
    inputs: [
      { id: 'plan', type: 'md', required: true },
      { id: 'answers', type: 'json', as: 'answers' },
      { id: 'fix', type: 'md', as: 'fix-review', loop: true },
      { id: 'done', type: 'void', as: 'worktree' },
      { id: 'await', type: 'any', required: false, synthetic: true },
    ],
    outputs: REFINER_LIKE.outputs,
  };
  const bindings = {
    plan: { type: 'md', path: '/abs/plan.md' },
    answers: { type: 'json', path: '/abs/clarify.json' },
    fix: { type: 'md', path: '/abs/review.md' },
    done: { type: 'void' },
    await: { type: 'void' },
  };
  const outputs = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx() });
  const block = portIoBlock({
    node: node(), ports, bindings, outputs,
    verdict: { path: join(pipelineDir, 'refine-review-cycle1.json') },
    ctx: { checkpointRef: 'abc1234' },
  });
  assert.ok(block.startsWith('## Ports (this run)\n\n### Inputs\n\n'));
  assert.ok(block.includes('- **plan** (md) -> /abs/plan.md'));
  assert.ok(block.includes('- **answers** (json) -> /abs/clarify.json (the clarifying questions and the answers already given)'));
  assert.ok(block.includes('- **fix** (md) -> /abs/review.md (the review to address — fix EVERY critical and major issue)'));
  assert.ok(block.includes('- **done** (void) -> Inspect the diff with `git diff abc1234`'), 'the worktree arm is the v1 diff sentence');
  assert.ok(!block.includes('**await**'), 'the synthesized gate is never listed');
  assert.ok(block.includes(`- Write **plan** (also **revise**) to: ${outputs.plan.path}`), 'shared paths collapse to ONE line');
  assert.ok(block.includes(`- Write the **verdict** JSON (machine-readable) to: ${join(pipelineDir, 'refine-review-cycle1.json')}`));
  const empty = portIoBlock({ node: node(), ports: { inputs: [], outputs: [] }, bindings: {}, outputs: {}, ctx: {} });
  assert.ok(empty.includes('- (none — work from the request above)'));
  assert.ok(empty.includes('- (none — report your findings as your final message)'));
});
```

```js
test('4 A3: only the FIRST fresh directive port in DECLARED order selects the mode', () => {
  const ports = {
    inputs: [
      { id: 'fix', type: 'md', loop: true, directive: 'FIX ARM' },
      { id: 'task', type: 'json', expands: true, directive: 'SLICE ARM' },
      { id: 'plan', type: 'md', required: true, directive: 'IMPLEMENT ARM' },
      { id: 'await', type: 'any', synthetic: true },
    ],
  };
  const bindings = {
    fix: { type: 'md', path: '/abs/r.md' }, task: { type: 'json', path: '/abs/d.json' },
    plan: { type: 'md', path: '/abs/p.md' }, await: { type: 'void' },
  };
  assert.equal(selectMode({ ports, bindings, freshPorts: ['fix', 'plan'] }).mode, 'fix', 'fix beats plan');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['task', 'plan'] }).mode, 'task', 'task beats plan');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['plan'] }).mode, 'plan');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['plan'] }).directives.length, 1, 'ONE directive renders');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['await'] }).mode, null, 'the gate selects nothing');
  assert.equal(selectMode({ ports, bindings, freshPorts: [] }).mode, null, 'a LATCHED loop token never selects');
  assert.equal(selectMode({ ports, bindings }).mode, 'fix', 'no freshPorts ⇒ first executions treat every bound port as fresh');
});

test('5 graph-derived facts: task-sourced ports and the expands consumer', () => {
  const tpl = {
    nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_a', kind: 'agent', key: 'a' }, { id: 'n_b', kind: 'agent', key: 'b' }],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'tasks' }, to: { node: 'n_b', port: 'task' } },
    ],
  };
  const portsFn = (n) => (n.id === 'n_b'
    ? { inputs: [{ id: 'task', type: 'json', expands: true }], outputs: [] }
    : { inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'tasks', type: 'json' }] });
  assert.deepEqual([...taskSourcedPorts(tpl, 'n_a')], ['task']);
  assert.deepEqual([...taskSourcedPorts(tpl, 'n_b')], [], 'only a kind:task source counts');
  assert.equal(expandsOutputPort(tpl, portsFn, 'n_a'), 'tasks');
  assert.equal(expandsOutputPort(tpl, portsFn, 'n_b'), null);
});

test('6 the decomposition document parses tolerantly and sorts by ordinal', async () => {
  assert.deepEqual(normalizeDecomposition(null), { phases: [] });
  assert.deepEqual(normalizeDecomposition({ phases: 'nope' }), { phases: [] });
  const d = normalizeDecomposition({
    phases: [
      { ordinal: 2, tasks: [{ id: 'p2t1', file: 'tasks/b.md' }] },
      { ordinal: 'x', tasks: [{ id: 'bad', file: 'x.md' }] },
      { ordinal: 3, tasks: [{ id: 'nofile' }] },
      { ordinal: 1, tasks: [{ id: 'p1t1', title: 'One', file: 'tasks/a.md' }, { file: 'noid.md' }] },
    ],
  });
  assert.deepEqual(d.phases.map((p) => p.ordinal), [1, 2], 'unusable phases are dropped, the rest sorted');
  assert.deepEqual(d.phases[0].tasks, [{ id: 'p1t1', title: 'One', file: 'tasks/a.md' }]);
  assert.deepEqual(d.phases[1].tasks[0], { id: 'p2t1', title: null, file: 'tasks/b.md' });
  assert.deepEqual(await readDecomposition(join(pipelineDir, 'nope.json')), { phases: [] });
  assert.deepEqual(await readDecomposition(null), { phases: [] });
  const p = join(pipelineDir, 'decomposition.json');
  writeFileSync(p, '{ not json', 'utf8');
  assert.deepEqual(await readDecomposition(p), { phases: [] }, 'malformed reads as nothing to fan out');
});

test('7 the MOCK role chain is graph-derived, never keyed on an agent name', () => {
  assert.equal(resolveMockRole({ meta: { mockRole: 'refiner' } }), 'refiner', '1. a validated declaration wins');
  assert.equal(resolveMockRole({ meta: { mockRole: 'not-a-writer-role', runnerType: 'producer' } }), 'generic-producer',
    'an unknown declaration is ignored');
  assert.equal(resolveMockRole({ meta: { runnerType: 'clarifier' } }), 'clarify', '2. clarifier');
  assert.equal(resolveMockRole({ meta: { runnerType: 'producer' }, expandsPort: 'tasks' }), 'decomposer',
    '3. an output wired into an expands input');
  assert.equal(resolveMockRole({ meta: { runnerType: 'verifier', verdict: { filename: 'v.json' } } }), 'generic-verifier',
    '4. a declared verdict');
  assert.equal(resolveMockRole({ meta: { runnerType: 'producer' } }), 'generic-producer', '5. the fallback');
});

test('8 readVerdict never throws: a missing or malformed file is "no issues"', async () => {
  assert.deepEqual(await readVerdict(null), { issues: [], summary: '' });
  assert.deepEqual((await readVerdict(join(pipelineDir, 'gone.json'))).issues, []);
  const v = join(pipelineDir, 'v.json');
  writeFileSync(v, JSON.stringify({ issues: [{ severity: 'critical', title: 'x' }], summary: 's' }), 'utf8');
  assert.equal((await readVerdict(v)).issues.length, 1);
});
```

`Expected: Error: Cannot find module '.../src/core/graph/executor.mjs'` (8 tests fail to load).

- [ ] **Step 2: Implement** — create `src/core/graph/executor.mjs` (part 1 of 3; Tasks 7 and 8 append to the same file).

Borrowed from `old:src/core/graph/executor.mjs` with these changes: (a) the tool lists are IMPORTED from `phases.mjs` (no second copy); (b) the `worktree` renderer emits the v1 `diffInstruction` bytes (the old branch shipped a static parenthetical and LOST the reviewer's checkpoint-ref sentence); (c) outputs sharing one allocated path collapse into ONE `- Write **plan** (also **revise**) to:` line; (d) `promptHints` get `{pipelineDir}` / `{cycle}` / `{diffInstruction}` substitution; (e) the slice's `siblingsBlock` is rendered; (f) `buildSystemPrompt` is called with FOUR args (dev's signature); (g) `renderPromptArtifact` is NOT imported (the adapter supplies the task document, keeping the engine free of `channels.mjs`, which dies in P8).

```js
// src/core/graph/executor.mjs
//
// The generic execution layer of the node-graph engine: output allocation from
// filename templates, the "## Ports (this run)" prompt block, prompt assembly, the
// clarifier gate, and the five flow-node executors.
//
// GENERICITY CHARTER (hard rule for this module): there is NO agent-key branch
// anywhere. Executor selection is `node.kind` + `meta.runnerType`; renderer selection
// is the port's `as`; mode selection is port FRESHNESS; the offline MOCK role comes
// from the generic resolution chain below. Everything that used to be a bespoke
// per-role runner is now data on the sidecar.
//
// The prompt machinery deliberately REUSES phases.mjs (taskHeader, runOpts,
// buildSystemPrompt, mockMarkers, siblingsBlock, diffInstruction, the fan-out
// directives) rather than forking it, so the v2 prompts keep today's load-bearing
// bytes. `test/graph-prompt-parity.test.mjs` is the contract.
//
// ── THE DECOMPOSITION CONTRACT ───────────────────────────────────────────────
// One document, no owner: ANY producer may emit it on a json output port, and ANY
// node with an `expands` input may consume it. Neither side is named anywhere in the
// engine — the relationship IS the wire (`expandsOutputPort`).
//
//   { "phases": [ { "ordinal": <int>,
//                   "tasks": [ { "id": <string>, "title": <string?>,
//                                "file": <pipelineDir-relative markdown path> } ] } ] }
//
// The parse is TOLERANT: a missing file, invalid JSON, a non-array `phases`, a phase
// without a usable ordinal or without runnable tasks, and a task missing `id` or
// `file` are all DROPPED rather than thrown on. `phases.length === 0` means "there is
// nothing to fan out": the consumer then runs ONE ordinary execution with its expands
// input left UNBOUND. The composite DRIVER is scheduler.mjs; this module owns the
// document.
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

import {
  runClaude, MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER,
} from '../claude-runner.mjs';
import { planPath, reviewPath, writeStepQuestions, writeClarify } from '../artifacts.mjs';
import { readReview, normalizeClarify } from '../protocol.mjs';
import {
  taskHeader, buildSystemPrompt, resolveAgentBody, mockMarkers, runOpts,
  fanOutDirective, ctxFanOut, workspaceFanOutDirective, workspaceDiffInstruction,
  renderAnswers, siblingsBlock, diffInstruction, READ_WRITE_TOOLS, IMPLEMENTER_TOOLS,
} from '../phases.mjs';

/** The reserved synthesized gate input. Scheduler-only: it never reaches `bindings`,
 *  is never listed in the Ports block, selects no mode, and carries no renderer. */
const AWAIT_ID = 'await';

/** The clarifier gate's ask kind — the same token the mock writer role uses, so it is
 *  referenced through the imported constant rather than a bare agent-key literal. */
const CLARIFY_ASK_KIND = MOCK_ROLE_CLARIFY;

/** The verdict-contract reminder every node with a declared verdict carries
 *  (phases.mjs:879-881, verbatim). */
export const VERDICT_CONTRACT =
  'The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], ' +
  '"summary" }. Use severities critical|major|minor|suggestion; only critical/major block the ' +
  'pipeline.\n\n';

// ── allocation ────────────────────────────────────────────────────────────────

/**
 * Resolve one filename template into `{ path, store }`. Tokens: `{cycle}` -> the
 * execution ordinal, `{base}` -> the run base name, `{vsuffix}` -> the run-global
 * plan-version suffix ('' for version 1, '-vN' after). `{vsuffix}` CONSUMES one tick
 * of `runCtx.planVersion()`, and only when the template actually carries it.
 */
function resolveTemplate(port, { ordinal, runCtx, prefix }) {
  const tpl = String(port.filename);
  const store = port.store || 'run';
  let version = null;
  const nextVersion = () => {
    if (version === null) {
      version = typeof runCtx.planVersion === 'function' ? Number(runCtx.planVersion()) || 1 : 1;
    }
    return version;
  };
  const name = tpl
    .replace(/\{cycle\}/g, String(ordinal))
    .replace(/\{base\}/g, String(runCtx.baseName || ''))
    .replace(/\{vsuffix\}/g, () => (nextVersion() > 1 ? `-v${nextVersion()}` : ''));

  if (store !== 'project') return { path: join(runCtx.pipelineDir, prefix + name), store };

  if ((port.artifactKind || port.id) === 'plan') {
    const v = tpl.includes('{vsuffix}') ? nextVersion() : 1;
    return {
      path: planPath(runCtx.projectDir, runCtx.baseName, v, runCtx.datePrefix, runCtx.workspaceKey),
      store,
    };
  }
  const m = /^\{base\}-(.+)\.md$/.exec(tpl);
  const kind = m ? m[1] : (port.artifactKind || port.id);
  return {
    path: reviewPath(runCtx.projectDir, runCtx.baseName, runCtx.datePrefix, kind, runCtx.workspaceKey),
    store,
  };
}

/**
 * DUPLICATE-KEY RULE (generic): when two or more agent nodes share one agent key,
 * every `store:'run'` output and the verdict of those nodes is prefixed `<nodeId>-`.
 * `runCtx.slice` extends the same rule to a COMPOSITE fan-out: every sub-execution of
 * one composite shares its parent's ordinal, so without a per-task prefix the parallel
 * slices would resolve to one filename and clobber each other.
 */
function dupPrefix(node, runCtx) {
  const dup = runCtx && runCtx.duplicateKey ? `${node.id}-` : '';
  const slice = runCtx && runCtx.slice ? `${runCtx.slice}-` : '';
  return dup + slice;
}

/** The combine card's own allocation: one md artifact per emission. */
function combinePath(node, ordinal, runCtx) {
  return join(runCtx.pipelineDir, `combine-${node.id}-c${ordinal}.md`);
}

/**
 * Allocate this execution's output paths, keyed by port id. Outputs whose templates
 * are IDENTICAL resolve to ONE `{path, store}` object (the refiner's `plan`/`revise`
 * pair is the live case): each distinct template is evaluated exactly ONCE per
 * execution, so a refine cycle consumes one plan version, not two.
 * @returns {Record<string, {path:string, store:string}>}
 */
export function allocateOutputs({ node, ports, executionId, ordinal = 1, runCtx = {} }) {  // eslint-disable-line no-unused-vars
  const out = {};
  if (node?.kind === 'combine') {
    out.out = { path: combinePath(node, ordinal, runCtx), store: 'run' };
    return out;
  }
  const prefix = dupPrefix(node, runCtx);
  const byTemplate = new Map();
  for (const port of ports?.outputs || []) {
    if (!port || !port.filename) continue;
    const cacheKey = JSON.stringify([port.store || 'run', port.filename]);
    if (!byTemplate.has(cacheKey)) {
      byTemplate.set(cacheKey, resolveTemplate(port, { ordinal, runCtx, prefix }));
    }
    out[port.id] = byTemplate.get(cacheKey);
  }
  return out;
}

/** The node-level verdict allocation (a verdict is NOT a port). Always lands in the
 *  pipeline dir, and carries the duplicate-key prefix for the same reason. */
export function allocateVerdict({ node, ports, ordinal = 1, runCtx = {} }) {
  const filename = ports?.verdict?.filename;
  if (!filename) return null;
  const { path } = resolveTemplate(
    { id: 'verdict', filename, store: 'run' },
    { ordinal, runCtx, prefix: dupPrefix(node, runCtx) },
  );
  return { path };
}
```

Part 2 of 3 — the Ports block, A3 mode selection, the graph-derived facts, the decomposition document and the mock chain (continue the same file):

```js
// ── the Ports block ───────────────────────────────────────────────────────────

/** True on a detached WORKSPACE run: cwd is the run root and the members live at
 *  `repos/<projectKey>` inside it. */
function detachedWorkspace(ctx) {
  return !!(ctx?.runRoot) && (ctx?.workspace?.projects || []).length > 0;
}

/**
 * Per-port input renderers, selected by the port's `as` (default `file`) — NEVER
 * inferred from the port id or the agent key. These are the generalized form of v1's
 * bespoke prompt arms. `worktree` renders the v1 reviewer bytes: the checkpoint-ref
 * diff sentence, or the per-member `git -C repos/<key> diff <ref>` lines on a
 * detached workspace.
 */
const INPUT_RENDERERS = {
  file: (t) => t.path || null,
  answers: (t) => (t.path ? `${t.path} (the clarifying questions and the answers already given)` : null),
  'fix-review': (t) => (t.path
    ? `${t.path} (the review to address — fix EVERY critical and major issue)`
    : null),
  worktree: (t, ctx) => (detachedWorkspace(ctx) ? workspaceDiffInstruction(ctx) : diffInstruction(ctx)),
};

/**
 * The generated "## Ports (this run)" block: every BOUND input bound through its `as`
 * renderer, and every declared output bound to its allocated path. Conditional
 * outputs are listed on EVERY execution (`when` gates token ROUTING only, so a
 * passing verifier still writes its review markdown and its verdict exactly as
 * today). Outputs sharing ONE allocated path render ONE line. The synthesized
 * `await` input is never listed.
 */
export function portIoBlock({ node, ports, bindings = {}, outputs = {}, verdict = null, ctx = {} }) {  // eslint-disable-line no-unused-vars
  const inLines = [];
  for (const port of ports?.inputs || []) {
    if (!port || port.id === AWAIT_ID) continue;
    const token = bindings[port.id];
    if (!token) continue;
    const render = INPUT_RENDERERS[port.as || 'file'] || INPUT_RENDERERS.file;
    const target = render(token, ctx);
    if (!target) continue;
    inLines.push(`- **${port.id}** (${token.type || port.type}) -> ${target}`);
  }
  const outLines = [];
  const byPath = new Map();                       // path -> [portId, …] in declared order
  for (const port of ports?.outputs || []) {
    const path = outputs[port?.id]?.path;
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(port.id);
  }
  for (const [path, ids] of byPath) {
    const also = ids.slice(1).map((id) => `**${id}**`).join(', ');
    outLines.push(`- Write **${ids[0]}**${also ? ` (also ${also})` : ''} to: ${path}`);
  }
  if (verdict?.path) {
    outLines.push(`- Write the **verdict** JSON (machine-readable) to: ${verdict.path}`);
  }
  return (
    '## Ports (this run)\n\n' +
    '### Inputs\n\n' +
    (inLines.length ? inLines.join('\n') : '- (none — work from the request above)') +
    '\n\n### Outputs\n\n' +
    (outLines.length ? outLines.join('\n') : '- (none — report your findings as your final message)') +
    '\n\n'
  );
}

// ── A3: mode selection is port FRESHNESS ──────────────────────────────────────

/**
 * Amendment A3 (parity-mandatory): an input's `directive` renders — and its mode
 * applies — ONLY when that port is FRESH for this execution, and only the FIRST such
 * port in DECLARED order wins. A latched loop-input token never selects a mode, which
 * is the token-model equivalent of v1's publish-clears-review. First executions list
 * every bound port as fresh. The synthesized `await` port never participates.
 * @returns {{mode: string|null, directives: Array<{id:string, directive:string, token:object}>}}
 */
export function selectMode({ ports, bindings = {}, freshPorts }) {
  const fresh = new Set(Array.isArray(freshPorts) ? freshPorts : Object.keys(bindings));
  for (const port of ports?.inputs || []) {
    if (!port || port.id === AWAIT_ID || !port.directive) continue;
    if (!fresh.has(port.id) || !bindings[port.id]) continue;
    return { mode: port.id, directives: [{ id: port.id, directive: String(port.directive), token: bindings[port.id] }] };
  }
  return { mode: null, directives: [] };
}

/** Render the selected mode's arm: the announcement, the directive, and the path it
 *  points at. Empty string when no fresh port carries a directive. */
function modeBlock({ mode, directives }) {
  if (!directives.length) return '';
  return (
    `Mode: ${mode}\n\n` +
    directives
      .map((d) => d.directive.trim() + '\n\n' + (d.token?.path ? `${d.id}: ${d.token.path}\n\n` : ''))
      .join('')
  );
}

// ── graph-derived facts the prompt and the mock chain need ────────────────────

/**
 * The input ports of `nodeId` fed by a `kind:'task'` node — what replaces v1's
 * hardcoded agent-key test for "who gets the raw request and the attachments":
 * binding the task document IS the entry relationship.
 * @returns {Set<string>}
 */
export function taskSourcedPorts(template, nodeId) {
  const kinds = new Map((template?.nodes || []).map((n) => [n.id, n.kind]));
  const out = new Set();
  for (const w of template?.wires || []) {
    if (w?.to?.node === nodeId && kinds.get(w?.from?.node) === 'task') out.add(w.to.port);
  }
  return out;
}

/** This node's output port that is wired into an `expands` input, if any — the
 *  graph-derived fact that makes a node "the thing that decomposes" without ever
 *  naming a key. Returns the port id, or null. */
export function expandsOutputPort(template, portsFn, nodeId) {
  const byId = new Map((template?.nodes || []).map((n) => [n.id, n]));
  for (const w of template?.wires || []) {
    if (w?.from?.node !== nodeId) continue;
    const target = byId.get(w?.to?.node);
    if (!target) continue;
    const input = (portsFn(target)?.inputs || []).find((i) => i.id === w.to.port);
    if (input?.expands) return w.from.port;
  }
  return null;
}

// ── the decomposition document ────────────────────────────────────────────────

/**
 * Normalize a decomposition document into the engine's canonical shape. PURE and
 * TOTAL: every input — including null, a bare array, a number — resolves to
 * `{ phases: [...] }`, dropping whatever cannot be run rather than throwing. Phases
 * come back ordinal-sorted.
 */
export function normalizeDecomposition(raw) {
  const phases = [];
  for (const ph of Array.isArray(raw?.phases) ? raw.phases : []) {
    const ordinal = Number(ph?.ordinal);
    if (!Number.isFinite(ordinal)) continue;
    const tasks = (Array.isArray(ph?.tasks) ? ph.tasks : [])
      .filter((t) => t && t.id && t.file)
      .map((t) => ({ id: String(t.id), title: t.title == null ? null : String(t.title), file: String(t.file) }));
    if (!tasks.length) continue;                  // a phase with nothing to run is not a phase
    phases.push({ ordinal, tasks });
  }
  phases.sort((a, b) => a.ordinal - b.ordinal);
  return { phases };
}

/** Read a decomposition document off disk through the tolerant parse. Never throws
 *  and never rejects. */
export async function readDecomposition(path) {
  if (!path) return { phases: [] };
  try {
    return normalizeDecomposition(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return { phases: [] };
  }
}

// ── the generic MOCK_ROLE resolution chain ────────────────────────────────────

/**
 * Resolve the offline mock writer role, generically:
 *   1. a validated `meta.mockRole` (the builtins pin today's writer table);
 *   2. else a clarifier runner;
 *   3. else a node whose output feeds an `expands` input (graph-derived);
 *   4. else a node with a declared verdict;
 *   5. else the generic producer.
 * The chain can only ever yield a role the mock writer actually handles, which is what
 * lets an all-custom graph complete offline.
 */
export function resolveMockRole({ meta, expandsPort = null }) {
  const declared = meta?.mockRole;
  if (declared && MOCK_WRITER_ROLES.has(declared)) return declared;
  if (meta?.runnerType === 'clarifier') return MOCK_ROLE_CLARIFY;
  if (expandsPort) return MOCK_ROLE_DECOMPOSER;
  if (meta?.verdict) return 'generic-verifier';
  return 'generic-producer';
}

// ── verdicts ──────────────────────────────────────────────────────────────────

/** Read a node's verdict JSON back through the protocol normalizer. Never throws: a
 *  missing or malformed file reads as "no issues", which is what makes an unwritten
 *  verdict a clean pass rather than a run failure. */
export function readVerdict(verdictPath) {
  if (!verdictPath) return Promise.resolve({ issues: [], summary: '' });
  return readReview(verdictPath);
}
```

- [ ] **Step 3: Run** — `node --test test/graph-executor.test.mjs` → `Expected: # pass 8` / `# fail 0`.
- [ ] **Step 4: Mutation audit** (revert each): remove the `byTemplate` cache → test 1 fails (two versions burned); remove the `port.id === AWAIT_ID` guard in `portIoBlock` → test 3 fails; return every fresh directive from `selectMode` instead of the first → test 4 fails.
- [ ] **Step 5: Commit** — `worca: Node-graph v2 P3 — executor allocation, ports block, mode selection`

---

### Task 7: Flow executors and the `runExecution` dispatcher

**Files:** modify `src/core/graph/executor.mjs`, `test/graph-executor.test.mjs`.

**Interfaces (produced):** `runTaskExecution(ctx)` (incl. A2 `planStoreSeed`), `runAndExecution(ctx)`, `runOrExecution(ctx)`, `runEndExecution(ctx)`, `runCombineExecution(ctx)`, and `runExecution(ctx, { runners } = {})` — the ONE entry point P4's `_execute` calls. Selection is `node.kind` → flow executor; `kind:'agent'` → `meta.runnerType` (`clarifier` → `runClarifierExecution`, else `runAgentExecution`), with `opts.runners[runnerType]` as the injected test seam (v1's `orchestrator.mjs:306`).

**A2 (parity-mandatory for the mid-stream entry template):** with `config.planStoreSeed`, the task execution ALSO writes its rendered document to `planPath(projectDir, baseName, 1, datePrefix, workspaceKey)`, the emitted token's path IS that plans-store file, and the run's plan-version counter starts consumed at 1 (the next plan-store write allocates `-v2`).

- [ ] **Step 1: Write the failing tests** — append to `test/graph-executor.test.mjs` (extend the import list with `runTaskExecution, runAndExecution, runOrExecution, runEndExecution, runCombineExecution, runExecution`):

```js
// ── flow executors ───────────────────────────────────────────────────────────

test('9 the Task card: a given path passes through, given text is written, neither throws', () => {
  const given = runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: { path: '/abs/task.md' }, runCtx: runCtx() });
  assert.deepEqual(given, { outputs: { task: { path: '/abs/task.md' } } });
  const written = runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: { text: '# Build it\n' }, runCtx: runCtx() });
  assert.equal(written.outputs.task.path, join(pipelineDir, 'task.md'));
  assert.equal(readFileSync(join(pipelineDir, 'task.md'), 'utf8'), '# Build it\n');
  assert.throws(
    () => runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: null, runCtx: runCtx() }),
    /task node "n_task": no task artifact/,
  );
});

test('10 A2 planStoreSeed: the document lands in the plans store and consumes version 1', () => {
  const rc = runCtx();
  const res = runTaskExecution({
    node: { id: 'n_task', kind: 'task', config: { planStoreSeed: true } },
    taskArtifact: { text: '# Provided plan\n' }, runCtx: rc,
  });
  assert.match(res.outputs.task.path, /plans\/01-01-26-feature\.md$/, 'version 1, no suffix');
  assert.equal(readFileSync(res.outputs.task.path, 'utf8'), '# Provided plan\n');
  const next = allocateOutputs({ node: node(), ports: REFINER_LIKE, ordinal: 1, runCtx: rc });
  assert.match(next.plan.path, /-v2\.md$/, 'the counter was consumed at 1');
});

test('11 AND is a void synchronizer, OR forwards the bound payload, End echoes the result', () => {
  assert.deepEqual(runAndExecution({ node: { id: 'n_and', kind: 'and' }, bindings: { in1: { type: 'md', path: '/a.md' } } }),
    { outputs: { out: {} } });
  assert.deepEqual(runOrExecution({ node: { id: 'n_or', kind: 'or' }, bindings: { in2: { type: 'md', path: '/b.md' } } }),
    { outputs: { out: { type: 'md', path: '/b.md', value: null } } });
  assert.deepEqual(runOrExecution({ node: { id: 'n_or', kind: 'or' }, bindings: {} }), { outputs: { out: {} } });
  assert.deepEqual(runEndExecution({ node: { id: 'n_end', kind: 'end' }, bindings: { result: { type: 'md', path: '/r.md' } } }),
    { result: { type: 'md', path: '/r.md', value: null } });
  assert.deepEqual(runEndExecution({ node: { id: 'n_end', kind: 'end' }, bindings: {} }),
    { result: { type: 'void', path: null, value: null } });
});

test('12 Combine concatenates in numeric port order under `## From <node name>` headings', async () => {
  const a = join(pipelineDir, 'a.md'); const b = join(pipelineDir, 'b.md');
  writeFileSync(a, 'AAA\n', 'utf8'); writeFileSync(b, 'BBB\n', 'utf8');
  const res = await runCombineExecution({
    node: { id: 'n_comb', kind: 'combine', config: { arity: 10 } },
    bindings: { in10: { type: 'md', path: b }, in2: { type: 'md', path: a }, in1: { type: 'md', value: 'INLINE' } },
    names: { in1: 'Planner', in2: 'Refiner' },
    ordinal: 1, runCtx: runCtx(),
  });
  assert.equal(res.outputs.out.path, join(pipelineDir, 'combine-n_comb-c1.md'));
  const text = readFileSync(res.outputs.out.path, 'utf8');
  assert.deepEqual(text.match(/^## From .*$/gm), ['## From Planner', '## From Refiner', '## From in10'],
    'in2 before in10, and an unnamed port falls back to its id');
  assert.ok(text.indexOf('INLINE') < text.indexOf('AAA') && text.indexOf('AAA') < text.indexOf('BBB'));
});

test('13 runExecution selects by kind, then by runnerType, and honors the injected seam', async () => {
  const calls = [];
  const runners = { producer: async (c) => { calls.push(c.node.id); return { outputs: {}, seam: true }; } };
  const agent = { id: 'n_a', kind: 'agent', key: 'custom', config: {} };
  const res = await runExecution({ node: agent, meta: { runnerType: 'producer' }, ports: {}, runCtx: runCtx() }, { runners });
  assert.equal(res.seam, true, 'the injected runner wins');
  assert.deepEqual(calls, ['n_a']);
  assert.deepEqual(await runExecution({ node: { id: 'n_or', kind: 'or' }, bindings: { in1: { type: 'md', path: '/x.md' } } }),
    { outputs: { out: { type: 'md', path: '/x.md', value: null } } });
  await assert.rejects(
    async () => runExecution({ node: { id: 'n_z', kind: 'wat' } }),
    /node "n_z": unknown kind "wat"/,
  );
});
```

`Expected: 13 tests run, 9–13 fail with `TypeError: runTaskExecution is not a function` (and the other four names).`

- [ ] **Step 2: Implement** — extend the `node:fs` import to `import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';` and append part 3 of 3 to `src/core/graph/executor.mjs`:

```js
// ── flow executors (pure engine: instant, $0, no process spawn) ───────────────

/** Write a file, creating its directory. Synchronous on purpose: the flow cards run
 *  inline in the scheduler's walk. */
function writeOut(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/**
 * The Task card — the source. Fires once at run start and emits the rendered task
 * document (run title + the user's prompt markdown + the attached-files section). The
 * ADAPTER renders it: `ctx.taskArtifact` is `{ path }` (already on disk — the normal
 * case) or `{ text }`.
 *
 * A2 (parity-mandatory for the mid-stream entry template): with
 * `config.planStoreSeed`, the document ALSO lands in the plans store at version 1, the
 * emitted token IS that plans-store path, and the run's plan-version counter is
 * consumed at 1 — so the next plan-store write allocates `-v2`.
 */
export function runTaskExecution({ node, taskArtifact, runCtx = {} }) {
  const given = taskArtifact?.path || null;
  let text = typeof taskArtifact?.text === 'string' ? taskArtifact.text : null;
  if (text === null && given) {
    try { text = readFileSync(given, 'utf8'); } catch { text = null; }
  }
  const missing = () => new Error(
    `task node "${node?.id}": no task artifact — the adapter must supply ctx.taskArtifact { path } or { text }`,
  );

  if (node?.config?.planStoreSeed !== true) {
    if (given) return { outputs: { task: { path: given } } };
    if (text === null) throw missing();
    const target = join(runCtx.pipelineDir, 'task.md');
    writeOut(target, text);
    return { outputs: { task: { path: target } } };
  }

  if (text === null) throw missing();
  const version = typeof runCtx.planVersion === 'function' ? Number(runCtx.planVersion()) || 1 : 1;
  const seeded = planPath(runCtx.projectDir, runCtx.baseName, version, runCtx.datePrefix, runCtx.workspaceKey);
  writeOut(seeded, text);
  return { outputs: { task: { path: seeded } } };
}

/** The AND card — the pure synchronizer. Payloads are discarded on purpose: its `out`
 *  is a static void token, which is what makes it reusable sequencing. */
export function runAndExecution({ node }) {                             // eslint-disable-line no-unused-vars
  return { outputs: { out: {} } };
}

/**
 * The OR card — the payload-forwarding valve. INFORMATIONAL in the scheduler path: the
 * scheduler owns any-fresh triggering, freshest selection, the same-drain single
 * emission AND the re-emitted payload. `bindings` therefore holds EXACTLY ONE entry —
 * the freshest input the scheduler already picked — which this simply forwards.
 */
export function runOrExecution({ node, bindings = {} }) {               // eslint-disable-line no-unused-vars
  const token = Object.values(bindings)[0];
  if (!token) return { outputs: { out: {} } };
  return { outputs: { out: { type: token.type, path: token.path ?? null, value: token.value ?? null } } };
}

/** The End card — the sink. Records the bound result token and emits NO outputs.
 *  INFORMATIONAL: the scheduler derives `ended.result` from the token it bound. */
export function runEndExecution({ node, bindings = {} }) {              // eslint-disable-line no-unused-vars
  const token = Object.values(bindings)[0] || null;
  return {
    result: { type: token?.type ?? 'void', path: token?.path ?? null, value: token?.value ?? null },
  };
}

/** Order `in1..inN` numerically so the concatenation follows port order, not lexical
 *  order (`in10` must not sort before `in2`). */
function comparePortIds(a, b) {
  const na = /^in(\d+)$/.exec(a);
  const nb = /^in(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Combine card — the payload-bearing md AND-join. Concatenates its bound inputs in
 * PORT order under `## From <node name>` headings and writes one md artifact. `names`
 * maps port id -> the source node's display name (the dispatcher derives it from the
 * template); absent one, the token's own provenance (then the port id) stands in.
 */
export async function runCombineExecution({ node, bindings = {}, allocatedPath, names = {}, ordinal = 1, runCtx = {} }) {
  const path = allocatedPath || combinePath(node, ordinal, runCtx);
  const parts = [];
  for (const portId of Object.keys(bindings).sort(comparePortIds)) {
    const token = bindings[portId];
    if (!token) continue;
    const name = names[portId] || token.meta?.sourceName || token.sourceNodeId || portId;
    let body = typeof token.value === 'string' ? token.value : '';
    if (!body && token.path) {
      try { body = await readFile(token.path, 'utf8'); } catch { body = ''; }
    }
    parts.push(`## From ${name}\n\n${body.trim()}\n`);
  }
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  await writeFile(path, parts.join('\n'), 'utf8');
  return { outputs: { out: { path } } };
}

/** Port id -> the display name of the node wired into it (Combine's headings). */
function combineNames(template, nodeId) {
  const byId = new Map((template?.nodes || []).map((n) => [n.id, n]));
  const out = {};
  for (const w of template?.wires || []) {
    if (w?.to?.node !== nodeId) continue;
    const src = byId.get(w.from.node);
    out[w.to.port] = src?.label || src?.key || w.from.node;
  }
  return out;
}

// ── the ONE entry point ───────────────────────────────────────────────────────

/**
 * Select and run this execution. Selection is `node.kind` → flow executor, then
 * `kind:'agent'` → `meta.runnerType` — NEVER an agent key. `opts.runners[runnerType]`
 * is the injected seam (v1's `orchestrator.mjs:306` test hook) and wins when present.
 * @param {object} ctx  the execution context (see the ctx contract in Task 8)
 * @param {{runners?:Record<string,Function>}} [opts]
 */
export function runExecution(ctx, opts = {}) {
  const node = ctx?.node || {};
  switch (node.kind) {
    case 'task': return runTaskExecution(ctx);
    case 'and': return runAndExecution(ctx);
    case 'or': return runOrExecution(ctx);
    case 'end': return runEndExecution(ctx);
    case 'combine':
      return runCombineExecution({ ...ctx, names: ctx.names || combineNames(ctx.template, node.id) });
    case 'agent': break;
    default:
      throw new Error(`node "${node.id}": unknown kind "${node.kind}"`);
  }
  const runnerType = ctx.meta?.runnerType || 'producer';
  const injected = (opts.runners || ctx.runners || {})[runnerType];
  if (typeof injected === 'function') return injected(ctx);
  return runnerType === 'clarifier' ? runClarifierExecution(ctx) : runAgentExecution(ctx);
}
```

- [ ] **Step 3: Run** — `node --test test/graph-executor.test.mjs` → `Expected: # pass 13` / `# fail 0`. `runAgentExecution` / `runClarifierExecution` do not exist yet: they are referenced ONLY on `runExecution`'s un-injected agent branch (a runtime lookup, not a link-time one), and test 13 takes the injected seam, so nothing here reaches them. Task 8 lands both.
- [ ] **Step 4: Commit** — `worca: Node-graph v2 P3 — flow executors and the runExecution dispatcher`

---

### Task 8: Prompt assembly, the agent executor and the clarifier gate

**Files:** modify `src/core/graph/executor.mjs`, `test/graph-executor.test.mjs`.

**Interfaces (produced):** `buildAgentPrompt(ctx)` (pure), `runAgentExecution(ctx)`, `runClarifierExecution(ctx)`.

**THE `ctx` CONTRACT** — one object, built by P4's `_execute` (and by hand in tests). Everything the executor reads:

| field | meaning |
|---|---|
| `node` | `{...templateNode, key, fanOut, agentPrompt, tools, promptHints, config}` — `tools` is the frontmatter list (MUST be stamped: it is what grants the Playwright MCP tools) |
| `nodeId`, `executionId`, `ordinal`, `cycle` | identity; `cycle === ordinal` |
| `template`, `portsFn`, `ports`, `meta` | the resolved graph, `portsOf(portsFn, node)` and the normalized sidecar meta |
| `bindings`, `trigger` | from the scheduler, verbatim |
| `outputs`, `verdict`, `expandsPort`, `mockRole` | pre-allocated; `prepare()` fills any that are absent |
| `slice`, `taskArtifact`, `names` | composite slice / Task-card document / Combine headings |
| `runCtx` | `{pipelineDir, projectDir, baseName, datePrefix, workspaceKey, duplicateKey, slice, planVersion}` |
| `projectDir`, `runRoot`, `pipelineDir`, `pipelineId`, `taskPrompt`, `toolInstruction`, `agentPrompts`, `checkpointRef`, `workspace`, `extras`, `repos`, `mcpConfigPath`, `mcpServerGrants`, `signal`, `onEvent` | the phases ctx (`orchestrator.mjs:2971-3021`) |
| `claudeOpts` | `{bin, permissionMode, model, effort, permissionRules, envScrub, envAllowlist, mock}` |
| `questionsEnabled`, `questionsFile`, `questionsAnswered`, `resumeSessionId` | the ask-then-resume block (applied inside `runOpts`) |
| `priorAnswers` | the answers already given (`as:'answers'` inline block + `MOCK_PRIOR`); `prepare()` reads them off the bound answers file when the caller did not supply them |
| `ask` | `async ({id, kind, nodeId, agent, questions}) => answers` — the clarifier gate |

**Prompt assembly (exact order):**
```
taskHeader(headerCtx, meta.displayName)      // isEntry = task-wired binding || meta.wantsRequest; extras only when task-wired
+ '\n## What to do\n\n' + baseInstruction(meta.runnerType) + '\n\n'
+ hints                                       // meta.promptHints, {pipelineDir}/{cycle}/{diffInstruction} substituted
+ modeBlock(selectMode(...))                  // ONE winning directive (A3)
+ fanOutDirective(ctxFanOut(ctx), {omitProjectAgents: detachedWs})
+ workspaceFanOutDirective(meta.workspaceStrategy, ctx.workspace, {relative: detachedWs})
+ (slice ? siblingsBlock(slice.siblings) : '')
+ portIoBlock(...)                            // '## Ports (this run)' → '### Inputs' / '### Outputs'
+ answersBlock                                // '## Clarifications already answered' when an `as:'answers'` port is declared
+ (verdict ? VERDICT_CONTRACT : '')
+ mockMarkers(...)
```
System prompt = `buildSystemPrompt(ctx.toolInstruction, resolveAgentBody(ctx, node.key), node.key, ctx.workspace)` (4-arg). `allowedTools` = `meta.sideEffect === 'code' ? IMPLEMENTER_TOOLS : READ_WRITE_TOOLS` — the union with `ctx.node.tools` and the fan-out `Task`/`Agent` grants happens inside `runOpts` (`phases.mjs:397` → `effectiveAllowedTools`, `:47`), which also carries `modelEnv` (`:429`), the MCP flags, the questions block and `RESUME_HEADER`. Spawning therefore ALWAYS goes through `runOpts`.

**Clarifier flow:** spawn → read the FIRST json output port's file through `normalizeClarify` → if questions: `writeStepQuestions` + `writeClarify` → `ctx.ask({ id: 'clarify-<nodeId>-<ordinal>', kind: 'clarify', nodeId, agent, questions })` → normalize the answers (a missing answer falls back to its question's first option) → REWRITE the file as `{questions, answers}` (one idempotent full-file write) → publish the now self-contained token. Ask ids are nodeId-scoped, so any number of clarifiers per graph is legal.

- [ ] **Step 1: Write the failing tests** — append to `test/graph-executor.test.mjs` (extend the import list with `buildAgentPrompt, runAgentExecution, runClarifierExecution`):

```js
// ── prompt assembly and the spawning executors ───────────────────────────────

const CUSTOM = {
  displayName: 'Custom Agent',
  runnerType: 'verifier',
  promptHints: 'Read {pipelineDir}/notes.md at cycle {cycle}. {diffInstruction}',
  workspaceStrategy: null,
  verdict: { filename: 'custom-review-cycle{cycle}.json' },
  mockRole: 'generic-verifier',
  inputs: [
    { id: 'fix', type: 'md', loop: true, as: 'fix-review', directive: 'FIX ARM' },
    { id: 'plan', type: 'md', required: true, directive: 'PLAN ARM' },
    { id: 'await', type: 'any', synthetic: true },
  ],
  outputs: [
    { id: 'review', type: 'md', when: 'blocking', filename: 'custom-review-cycle{cycle}.md', store: 'run' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
};

const TPL8 = {
  id: 'wf_8', name: 'T', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_c', kind: 'agent', key: 'custom' }],
  wires: [],
};

function ctx8(over = {}) {
  const nodeObj = { id: 'n_c', kind: 'agent', key: 'custom', config: {}, fanOut: false, agentPrompt: 'You are custom.', tools: [] };
  const rc = runCtx();
  const bindings = { plan: { type: 'md', path: '/abs/plan.md' } };
  return {
    node: nodeObj, nodeId: 'n_c', executionId: 'x:n_c:2', ordinal: 2, cycle: 2,
    template: TPL8, ports: CUSTOM, meta: CUSTOM, bindings,
    trigger: { wireIds: [], freshPorts: ['plan'] },
    outputs: allocateOutputs({ node: nodeObj, ports: CUSTOM, ordinal: 2, runCtx: rc }),
    verdict: allocateVerdict({ node: nodeObj, ports: CUSTOM, ordinal: 2, runCtx: rc }),
    expandsPort: null, runCtx: rc, priorAnswers: [],
    projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'TOOLS', extras: [],
    checkpointRef: 'abc1234', workspace: null, agentPrompts: {}, claudeOpts: { mock: true },
    ...over,
  };
}

test('14 buildAgentPrompt assembles the blocks in the documented order', () => {
  const p = buildAgentPrompt(ctx8());
  const at = (s) => { const i = p.indexOf(s); assert.notEqual(i, -1, `missing: ${s}`); return i; };
  assert.ok(p.startsWith('# Task: Custom Agent\n\n'));
  assert.ok(at('## What to do') < at('You are a verifier.'));
  assert.ok(at('You are a verifier.') < at('Read ' + pipelineDir + '/notes.md at cycle 2.'));
  assert.ok(at('at cycle 2.') < at('Mode: plan'));
  assert.ok(at('Mode: plan') < at('## Ports (this run)'));
  assert.ok(at('PLAN ARM') < at('## Ports (this run)'));
  assert.ok(!p.includes('FIX ARM'), 'A3: the latched loop directive never renders');
  assert.ok(at('## Ports (this run)') < at('The review JSON shape is'));
  assert.ok(at('The review JSON shape is') < at('MOCK_ROLE: generic-verifier'));
  assert.ok(p.includes('MOCK_CYCLE: 2'));
  assert.ok(p.includes(`MOCK_JSON: ${join(pipelineDir, 'custom-review-cycle2.json')}`));
  assert.ok(p.includes(`MOCK_OUT: ${join(pipelineDir, 'custom-review-cycle2.md')}`));
  assert.ok(p.includes('MOCK_IN: /abs/plan.md'));
});

test('15 prompt hints substitute {pipelineDir}, {cycle} and {diffInstruction}', () => {
  const p = buildAgentPrompt(ctx8());
  assert.ok(p.includes(`Read ${pipelineDir}/notes.md at cycle 2. Inspect the diff with \`git diff abc1234\``));
  const detached = buildAgentPrompt(ctx8({
    runRoot: '/run/root',
    workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/run/root/repos/api', checkpointRef: 'aaa1' }] },
  }));
  assert.ok(detached.includes('- **API**: `git -C repos/api diff aaa1`'), 'the detached workspace variant');
});

test('16 a composite slice renders the shared-working-tree block', () => {
  const p = buildAgentPrompt(ctx8({
    slice: { id: 'p1t1', title: 'One', phase: 1, path: '/abs/t1.md', index: 0, siblings: [{ id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md' }] },
  }));
  assert.ok(p.includes('## Parallel siblings — shared working tree'));
  assert.ok(p.includes('- p1t2 "Two" (tasks/p1-t2.md)'));
  assert.ok(p.indexOf('## Parallel siblings') < p.indexOf('## Ports (this run)'));
  assert.ok(!buildAgentPrompt(ctx8()).includes('## Parallel siblings'), 'and nothing when solo');
});

test('17 runAgentExecution spawns through runOpts and returns the same prompt it built', async () => {
  const c = ctx8();
  const r = await runAgentExecution(c);
  assert.equal(r.prompt, buildAgentPrompt(c), 'the round trip is byte-identical');
  assert.deepEqual(Object.keys(r.outputs).sort(), ['pass', 'review'], 'every declared port is publishable');
  assert.equal(r.outputs.review.path, join(pipelineDir, 'custom-review-cycle2.md'));
  assert.deepEqual(r.outputs.pass, {}, 'a void port publishes an empty payload');
  assert.ok(Array.isArray(r.verdict.issues), 'the verdict JSON is read back');
  assert.ok(r.summary.length > 0);
});

test('18 runClarifierExecution gates the human and rewrites the file as {questions, answers}', async () => {
  const asked = [];
  const meta = {
    displayName: 'Ask First', runnerType: 'clarifier', mockRole: 'clarify', promptHints: '',
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'await', type: 'any', synthetic: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'clarify' }],
  };
  const nodeObj = { id: 'n_ask', kind: 'agent', key: 'asker', config: {}, agentPrompt: 'You ask.', tools: [] };
  const rc = runCtx();
  const c = {
    node: nodeObj, nodeId: 'n_ask', executionId: 'x:n_ask:1', ordinal: 1, cycle: 1,
    template: TPL8, ports: meta, meta, bindings: { task: { type: 'md', path: '/abs/task.md' } },
    trigger: { freshPorts: ['task'] }, runCtx: rc, priorAnswers: [],
    outputs: allocateOutputs({ node: nodeObj, ports: meta, ordinal: 1, runCtx: rc }),
    verdict: null, projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'T',
    extras: [], workspace: null, agentPrompts: {}, claudeOpts: { mock: true },
    ask: async (a) => { asked.push(a); return { answers: [{ id: a.questions[0].id, choice: 'Option A' }] }; },
  };
  const r = await runClarifierExecution(c);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].id, 'clarify-n_ask-1', 'the ask id is nodeId-scoped');
  assert.equal(asked[0].kind, 'clarify');
  assert.equal(asked[0].nodeId, 'n_ask');
  assert.equal(asked[0].agent, 'Ask First');
  assert.ok(asked[0].questions.length >= 1);
  const written = JSON.parse(readFileSync(join(pipelineDir, 'clarify.json'), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['answers', 'questions']);
  assert.equal(written.answers[0].choice, 'Option A');
  assert.ok(written.answers[0].question.length > 0, 'each answer carries its question text');
  assert.equal(r.outputs.answers.path, join(pipelineDir, 'clarify.json'));
  assert.ok(r.prompt.includes('MOCK_PRIOR: 0'));
});
```

`Expected: 18 tests run, 14–18 fail with `TypeError: buildAgentPrompt is not a function` (and the two executors).`

- [ ] **Step 2: Implement** — insert this block into `src/core/graph/executor.mjs` between the mock-role chain and the flow executors:

```js
// ── prompt assembly ───────────────────────────────────────────────────────────

/** The role-free base instruction, keyed by runnerType — never by an agent key. */
function baseInstruction(runnerType) {
  if (runnerType === 'verifier') {
    return 'You are a verifier. Inspect the inputs below exactly as your role instructions describe, ' +
      'then write a human-readable review markdown AND a machine-readable review JSON.';
  }
  if (runnerType === 'clarifier') {
    return 'You are a clarifier. Identify the decisions that cannot be safely resolved from the task ' +
      'text or the real codebase — including things a downstream agent would otherwise silently ' +
      'assume. For each, write one conceptual question with 2 to 4 options and a free-text fallback ' +
      '(up to 8; never pad, never split one decision) as ' +
      '{ "questions": [ { "id", "question", "options": [ ... ], "allowFreeText": true } ] } to the ' +
      'output path below. If nothing material is open, write { "questions": [] } to that same path.';
  }
  return 'You are a pipeline agent. Read every input below, do your job exactly as your role ' +
    'instructions describe, and write EVERY declared output to its exact path.';
}

/** The answers port of a clarifier: its FIRST json output (meta validation guarantees
 *  a clarifier declares at least one). */
function answersPortOf(ports) {
  return (ports?.outputs || []).find((p) => p?.type === 'json') || null;
}

/** The three prompt-hint tokens. `{diffInstruction}` resolves to the SAME helper the
 *  `as:'worktree'` renderer uses, so the two can never drift. */
function substituteHints(raw, ctx) {
  const hints = String(raw || '').trim();
  if (!hints) return '';
  const diff = detachedWorkspace(ctx) ? workspaceDiffInstruction(ctx) : diffInstruction(ctx);
  return hints
    .replace(/\{pipelineDir\}/g, String(ctx.runCtx?.pipelineDir || ctx.pipelineDir || ''))
    .replace(/\{cycle\}/g, String(ctx.ordinal ?? ctx.cycle ?? 1))
    .replace(/\{diffInstruction\}/g, () => diff);
}

/** The MOCK marker set for this execution, per the resolution chain. */
function markersFor({ role, ordinal, runCtx, outputs, verdict, bindings, ports, meta, expandsPort, priorCount }) {
  const markers = { MOCK_ROLE: role, MOCK_CYCLE: ordinal, MOCK_BASE: runCtx.baseName };
  if (role === MOCK_ROLE_CLARIFY) {
    markers.MOCK_OUT = outputs[answersPortOf(ports)?.id]?.path;
    markers.MOCK_PRIOR = priorCount;
  } else if (role === MOCK_ROLE_DECOMPOSER) {
    markers.MOCK_OUT = outputs[expandsPort]?.path;
    markers.MOCK_TASKS_DIR = join(runCtx.pipelineDir, 'tasks');
  } else {
    markers.MOCK_OUT = Object.values(outputs).find((o) => o && o.path)?.path;
  }
  if (verdict?.path) markers.MOCK_JSON = verdict.path;
  const primaryIn = (ports?.inputs || [])
    .filter((p) => p && p.id !== AWAIT_ID)
    .map((p) => bindings[p.id]?.path)
    .find(Boolean);
  if (primaryIn) markers.MOCK_IN = primaryIn;
  if (meta?.workspaceStrategy) markers.MOCK_STRATEGY = meta.workspaceStrategy;
  return markers;
}

/**
 * Assemble the v2 task prompt. PURE (no IO, no spawn), so prompt behavior is
 * assertable on its own — `test/graph-prompt-parity.test.mjs` drives this directly
 * with the REAL sidecars.
 */
export function buildAgentPrompt(ctx) {
  const { node, bindings = {}, trigger = {}, ordinal = 1, runCtx = {} } = ctx;
  const ports = ctx.ports || {};
  const meta = ctx.meta || ports;
  const outputs = ctx.outputs || {};
  const verdict = ctx.verdict || null;

  // Who gets the raw request and the attachments: binding a task node's token, or
  // declaring `wantsRequest`. taskHeader reads those decisions off `isEntry` /
  // `inputs` / `extras`, so drive it through them.
  const fromTask = ctx.taskSourcedPorts instanceof Set
    ? ctx.taskSourcedPorts
    : taskSourcedPorts(ctx.template || {}, node?.id);
  const taskBound = Object.keys(bindings).some((id) => fromTask.has(id));
  const headerCtx = {
    ...ctx,
    isEntry: taskBound || meta.wantsRequest === true,
    inputs: {},                                   // the graph binds ports, not v1 channels
    extras: taskBound ? (ctx.extras || []) : [],  // wantsRequest gets the request, never the attachments
  };

  const relative = detachedWorkspace(ctx);
  const hints = substituteHints(meta.promptHints, ctx);
  const title = meta.displayName || node?.key || node?.id || 'agent';
  const answersBlock = (ports.inputs || []).some((p) => p?.as === 'answers')
    ? '## Clarifications already answered\n\n' + renderAnswers(ctx.priorAnswers || []) + '\n'
    : '';

  return (
    taskHeader(headerCtx, title) +
    '\n## What to do\n\n' +
    baseInstruction(meta.runnerType) + '\n\n' +
    (hints ? hints + '\n\n' : '') +
    modeBlock(selectMode({ ports, bindings, freshPorts: trigger.freshPorts })) +
    fanOutDirective(ctxFanOut(ctx), { omitProjectAgents: relative }) +
    workspaceFanOutDirective(meta.workspaceStrategy, ctx.workspace, { relative }) +
    (ctx.slice ? siblingsBlock(ctx.slice.siblings) + '\n' : '') +
    portIoBlock({ node, ports, bindings, outputs, verdict, ctx }) +
    answersBlock +
    (verdict?.path ? VERDICT_CONTRACT : '') +
    mockMarkers(markersFor({
      role: ctx.mockRole || resolveMockRole({ meta, expandsPort: ctx.expandsPort }),
      ordinal, runCtx, outputs, verdict, bindings, ports, meta,
      expandsPort: ctx.expandsPort,
      priorCount: (ctx.priorAnswers || []).length,
    }))
  );
}

// ── the agent executor ────────────────────────────────────────────────────────

async function readJsonMaybe(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/** The answers already given, read off the bound `as:'answers'` port. */
async function readPriorAnswers(ports, bindings = {}) {
  const port = (ports?.inputs || []).find((p) => p?.as === 'answers');
  const path = port ? bindings[port.id]?.path : null;
  if (!path) return [];
  const json = await readJsonMaybe(path);
  return Array.isArray(json?.answers) ? json.answers : [];
}

/**
 * Prepare an agent execution: allocate whatever the caller did not, resolve the mock
 * role and the prior answers, and assemble both prompts. Shared by the agent and
 * clarifier executors so the two can never drift.
 */
async function prepare(ctx) {
  const { node, ordinal = 1, runCtx = {} } = ctx;
  const ports = ctx.ports || {};
  const meta = ctx.meta || ports;
  const outputs = ctx.outputs
    || allocateOutputs({ node, ports, executionId: ctx.executionId, ordinal, runCtx });
  const verdict = ctx.verdict !== undefined
    ? ctx.verdict
    : allocateVerdict({ node, ports, ordinal, runCtx });
  const expandsPort = ctx.expandsPort !== undefined
    ? ctx.expandsPort
    : (ctx.template && ctx.portsFn ? expandsOutputPort(ctx.template, ctx.portsFn, node.id) : null);
  const mockRole = resolveMockRole({ meta, expandsPort });
  const priorAnswers = Array.isArray(ctx.priorAnswers)
    ? ctx.priorAnswers
    : await readPriorAnswers(ports, ctx.bindings);

  const role = node?.key || node?.kind || 'agent';
  const body = resolveAgentBody(ctx, node?.key);
  if (!String(body || '').trim()) {
    console.warn(`[executor] node "${node?.id}": no agent .md body resolved — running with an empty system prompt`);
  }
  const systemPrompt = buildSystemPrompt(ctx.toolInstruction, body, role, ctx.workspace);
  const full = { ...ctx, ports, meta, outputs, verdict, expandsPort, mockRole, priorAnswers };
  const prompt = buildAgentPrompt(full);
  const allowedTools = meta.sideEffect === 'code' ? IMPLEMENTER_TOOLS : READ_WRITE_TOOLS;
  return { full, ports, meta, outputs, verdict, role, systemPrompt, prompt, allowedTools };
}

/** The output map the scheduler publishes from: an entry per declared port, with a
 *  path where one was allocated and an empty payload for void ports. */
function publishable(ports, outputs) {
  const out = {};
  for (const port of ports?.outputs || []) {
    if (!port) continue;
    out[port.id] = outputs[port.id]?.path ? { path: outputs[port.id].path } : {};
  }
  return out;
}

/**
 * The ONE generic agent executor — the generalization of v1's runGenericProducer and
 * runGenericVerifier and of the nine bespoke runners they replace. Selected for
 * `kind:'agent'` with any `runnerType` other than clarifier.
 */
export async function runAgentExecution(ctx) {
  const { full, ports, meta, outputs, verdict, role, systemPrompt, prompt, allowedTools } = await prepare(ctx);
  const { text } = await runClaude(runOpts(full, { role, prompt, systemPrompt, allowedTools }));
  const review = verdict?.path ? await readVerdict(verdict.path) : null;
  return {
    summary: (text || '').trim() || `${meta.displayName || ctx.node?.key || 'Agent'} completed.`,
    outputs: publishable(ports, outputs),
    verdict: review,
    prompt,
  };
}

// ── the clarifier executor ────────────────────────────────────────────────────

/**
 * Normalize an ask payload into enriched answers. Accepts `{answers:[{id,choice}]}` or
 * a bare array; any question the user left out falls back to its first option, so
 * downstream consumers never see a gap. Each answer carries its question text so the
 * row and the History UI render the full Q&A without a join.
 */
function normalizeAnswers(payload, questions) {
  const arr = Array.isArray(payload?.answers) ? payload.answers : Array.isArray(payload) ? payload : [];
  const byId = new Map();
  for (const a of arr) if (a && a.id != null) byId.set(String(a.id), String(a.choice ?? ''));
  return (questions || []).map((q) => ({
    id: q.id,
    question: q.question || '',
    choice: byId.has(q.id) ? byId.get(q.id) : (q.options && q.options.find((o) => o && o.trim())) || '',
  }));
}

/**
 * The clarifier executor — selected by `meta.runnerType === 'clarifier'`, NEVER by an
 * agent key, so any number of clarifier nodes per graph is legal. Spawn → read the
 * questions JSON off the FIRST json output port (malformed or empty is tolerated: no
 * gate, empty answers) → gate the human on `clarify-<nodeId>-<ordinal>` → REWRITE that
 * file as `{questions, answers}` in one idempotent full-file write → publish the (now
 * self-contained) token. The snapshot lands only after the publish, so a mid-gate
 * resume re-runs the gate from the questions half.
 */
export async function runClarifierExecution(ctx) {
  const { node, ordinal = 1 } = ctx;
  const { full, ports, meta, outputs, role, systemPrompt, prompt, allowedTools } = await prepare(ctx);
  const answersPort = answersPortOf(ports);
  const answersPath = outputs[answersPort?.id]?.path;

  await runClaude(runOpts(full, { role, prompt, systemPrompt, allowedTools }));

  const { questions } = normalizeClarify(await readJsonMaybe(answersPath));
  let answers = [];
  if (questions.length) {
    if (ctx.pipelineId) {
      await writeStepQuestions(ctx.pipelineId, ctx.executionId, ordinal, {
        agentKey: node?.key, nodeId: node?.id, questions: { questions },
      });
      await writeClarify(ctx.pipelineId, { questions: { questions } });
    }
    const payload = await ctx.ask({
      id: `${CLARIFY_ASK_KIND}-${node.id}-${ordinal}`,
      kind: CLARIFY_ASK_KIND,
      nodeId: node.id,
      agent: meta.displayName || node.key,
      questions,
    });
    answers = normalizeAnswers(payload, questions);
    if (ctx.pipelineId) {
      await writeStepQuestions(ctx.pipelineId, ctx.executionId, ordinal, {
        agentKey: node?.key, nodeId: node?.id, answers: { answers },
      });
      await writeClarify(ctx.pipelineId, { answers: { answers } });
    }
  }

  await mkdir(dirname(answersPath), { recursive: true }).catch(() => {});
  await writeFile(answersPath, JSON.stringify({ questions, answers }, null, 2) + '\n', 'utf8');
  return { outputs: publishable(ports, outputs), questions, answers, prompt };
}
```

- [ ] **Step 3: Run** — `node --test test/graph-executor.test.mjs` → `Expected: # pass 18` / `# fail 0`.
- [ ] **Step 4: Mutation audit** (revert each): drop the `{diffInstruction}` substitution → test 15 fails; drop `siblingsBlock` from the assembly → test 16 fails; call `buildSystemPrompt` with 5 args → nothing fails, but `node --test test/phases-agent-body.test.mjs` still passes, so instead assert by inspection that the 4-arg call site is the only one (`grep -n "buildSystemPrompt(" src/core/graph/executor.mjs` → exactly one hit, 4 arguments).
- [ ] **Step 5: Commit** — `worca: Node-graph v2 P3 — prompt assembly, agent and clarifier executors`

---

### Task 9: Prompt-parity pin suite (11 builtins, literals pasted from `phases.mjs`)

**Files:** create `test/graph-prompt-parity.test.mjs`.

**Interfaces:** consumes `buildAgentPrompt` / `allocateOutputs` / `allocateVerdict` / `expandsOutputPort` / `taskSourcedPorts` / `runAgentExecution` (P3), `registryPortsFn` (P2), `loadAgentRegistry` + the REAL `agents/*.meta.json`, and `runOpts` / `RESUME_HEADER` (P1 dev).

**This suite is the contract.** Every expected string is a VERBATIM copy of the live v1 builder text, pasted as a literal rather than imported: `phases.mjs`'s bespoke builders die at the engine swap, and a pin that imports the thing it guards degrades into a tautology the moment the source moves. If a literal is missing from a prompt, the SIDECAR is wrong (its `promptHints` / `directive` / `filename` lost a byte in P2) — fix `agents/<key>.meta.json`, never the pin.

- [ ] **Step 1: Write the failing test** — `test/graph-prompt-parity.test.mjs` (part 1: the v1 bytes)

```js
// test/graph-prompt-parity.test.mjs
// THE prompt snapshot pin. For each of the 11 shipped builtins this assembles the v2
// task prompt through the SAME builder runAgentExecution ships (buildAgentPrompt,
// driven by the REAL agents/*.meta.json sidecars — never a fixture) and asserts it
// still CONTAINS every load-bearing line of today's bespoke phases.mjs prompts.
// Anchors as of dev e6968e15: taskHeader :449-495 · fanOutDirective :122-157 ·
// RESUME_HEADER :331-335 · questions block :349-378 · verdict contract :879-881 ·
// implementer arms :788-812 + :836 · siblings :762-786 · reviewer diff :859-866 ·
// planner revise :639-646 + inline answers :658-660 · decomposer :719-731 ·
// checklist :1076-1088 · web UI :1118-1127 · workspace reviewer :955-969.
// If a number has drifted, locate by content — the strings are the contract.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { runOpts, RESUME_HEADER, READ_WRITE_TOOLS, IMPLEMENTER_TOOLS } from '../src/core/phases.mjs';
import {
  buildAgentPrompt, allocateOutputs, allocateVerdict, expandsOutputPort,
  taskSourcedPorts, runAgentExecution,
} from '../src/core/graph/executor.mjs';

// `store:'project'` allocations resolve under worcaHome() — isolate it FIRST.
useTempHome(after);

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
/** Builtin layer only — the pin is about the 11 files that ship in agents/. */
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const projectDir = tmp('worca-parity-proj-');
const pipelineDir = tmp('worca-parity-pipe-');

const TASK_PROMPT = 'BUILD THE THING';
const ORDINAL = 2;                       // proves {cycle} still renders the cycle

// ── the v1 bytes (verbatim copies; see the header note) ──────────────────────

const V1_REQUEST_BLOCK = `## Original request\n\n${TASK_PROMPT}\n`;
const V1_UPSTREAM_BLOCK =
  '## Upstream input\n\nYour input is the output of the preceding step(s); the file paths to ' +
  'read are named below.\n';
/** channels.mjs#renderAttachmentsBlock (:294-301). */
const V1_ATTACHMENTS_HEAD =
  '\n## Attached files\n\nThe user attached these files; read any that are relevant:\n\n';
/** phases.mjs#taskHeader's legacy skills sentence (:481-486). */
const V1_SKILLS_HINT =
  'Project and personal skills (.claude/skills in this project and ~/.claude/skills) are ' +
  'available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or ' +
  'knowledge-graph skills) rather than guessing conventions.\n\n';
/** phases.mjs#fanOutDirective, the legacy (non-detached) arm (:122-157). */
const V1_FANOUT_HEAD = '## Fan-out ENABLED — parallelize your research\n\n';
const V1_FANOUT_SUBAGENTS =
  'Pick the BEST-FIT `subagent_type`: this project\'s own agents (`.claude/agents`) and your personal ' +
  'agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the ' +
  'sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).';
const V1_FANOUT_TAIL =
  'Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a ' +
  'trivial, single-file change.\n\n';
/** The three lines every v1 verdict contract opens with (reviewer :879-881). */
const V1_VERDICT_CONTRACT =
  'The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], ' +
  '"summary" }. Use severities critical|major|minor|suggestion; only critical/major block the ' +
  'pipeline.\n\n';
/** The role-specific tails the four bespoke contracts added on top. */
const V1_REFINER_CALIBRATION = 'Mark a finding critical/major only if it must be fixed before implementation.';
const V1_PLAN_REVIEW_CONSEQUENCE = 'critical/major block (the planner then revises).';
const V1_WEBUI_CALIBRATION = 'a failing manual case is at least major';
const V1_WS_UNION_LINE =
  'The issue list is the UNION of every per-project critical/major issue (never ' +
  'collapse one), sorted by projectKey then severity, each location prefixed "<projectKey>: ".';
/** The bespoke "what to do" sentences the generic baseInstruction cannot carry. */
const V1_PLAN_REVIEW_SCOPE = 'Do NOT rewrite the plan.';
const V1_WEBUI_INSTRUCTION =
  'Execute the manual test checklist against the running web UI using the Playwright tools.';
/** The three moved-bytes directive arms — now sidecar `directive` fields. */
const V1_FIX_DIRECTIVE =
  'Address EVERY critical and major issue in the review below, then re-run the tests. ' +
  'Follow the plan; deviate only if something does not work at all.';
const V1_SLICE_DIRECTIVE =
  'Implement the task below using TDD (red-green-refactor). The TASK file is a ' +
  'self-contained vertical slice and is AUTHORITATIVE — do exactly what it says and ' +
  'nothing outside its scope. The plan is reference/context only; you do NOT need to ' +
  'read the whole plan.';
const V1_IMPLEMENT_DIRECTIVE =
  'Implement the plan using TDD (red-green-refactor). Follow it with NO deviation; ' +
  'deviate slightly only if a step does not work at all.';
const V1_REVISE_DIRECTIVE =
  '## Revise to address the review\n\n' +
  'A reviewer found issues with the previous plan. Re-plan from scratch (cold start) and ' +
  'address EVERY critical and major finding in the review below. Preserve the ' +
  '"## Clarifications (Q&A)" section.';
/** The per-agent hint sentences the old branch DROPPED (adj-f1 §0 item 2). */
const V1_IMPL_CWD = 'Work inside the project directory (your cwd). Commit nothing; just edit files and tests.';
const V1_REVIEWER_DIFF_REF =
  'Inspect the diff with `git diff abc1234` (the orchestrator\'s pre-implementation ' +
  'checkpoint) and `git status` in your cwd. New/untracked files are intent-to-added, ' +
  'so they DO appear in that diff; use `git status` to cross-check.';
const V1_DECOMPOSER_SLICES =
  'tracer-bullet vertical slices grouped into ordered phases. Within a phase, tasks must be ' +
  'parallel-safe and edit DISJOINT files';
const V1_DECOMPOSER_MANIFEST =
  'The manifest shape is { "phases": [ { "ordinal", "tasks": [ { "id", "title", "file" } ] } ] }. ' +
  'Use id "p<ordinal>t<n>" and a pipeline-dir-relative "file" path.';
const V1_PLANNER_INSTRUCTION =
  'Write a complete, build-ready implementation plan. It MUST contain concrete code snippets ' +
  'for the features and MUST end with a "## Clarifications (Q&A)" section';
const V1_NO_ANSWERS = '_No clarifying questions were asked._';
const V1_CLARIFY_SCOPE = 'Identify the decisions';
const V1_REFINER_INSTRUCTION =
  'Read the current plan, critically review it INCLUDING its code snippets, then write an ' +
  'improved version and a machine-readable review.';
const V1_REVIEWER_INSTRUCTION =
  'Review the git diff of what was implemented against the plan.';
const V1_WS_REVIEW_INSTRUCTION =
  'Review what was implemented across the member projects against the plan.';
const V1_CHECKLIST_SINGLE =
  'Read the implementation plan and the implemented changes (via `git diff` in your cwd), ' +
  'then write a markdown checklist of concrete manual test cases a human can run against the ' +
  'app. Each case: a `- [ ]` line with steps and the expected result.';
const V1_CHECKLIST_DETACHED = 'your cwd is the worca-cc run root, not a repository, so inspect each member on its own';
/** The generalized input renderers that replace v1's bespoke arms. */
const V2_FIX_REVIEW_ARM = '(the review to address — fix EVERY critical and major issue)';
const V2_ANSWERS_ARM = '(the clarifying questions and the answers already given)';
```

Part 2 — the graph, the ctx builder and the cases:

```js
// ── the graph the builtins are wired into ────────────────────────────────────
// Only two wire facts matter to the prompt: which ports a `kind:'task'` node feeds
// (the request/attachments gate), and which output lands on an `expands` input (the
// decomposer's MOCK markers). Everything else is sidecar data.

const nodeId = (key) => `n_${key}`;
const BUILTIN_KEYS = Object.keys(REGISTRY).sort();

const PARITY_TPL = {
  id: 'wf_parity', name: 'Parity', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    ...BUILTIN_KEYS.map((key, i) => ({ id: nodeId(key), kind: 'agent', key, x: 200 + i * 40, y: 0, config: {} })),
  ],
  wires: [
    { id: 'w_t_clarify', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('clarify'), port: 'task' } },
    { id: 'w_t_planner', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('planner'), port: 'task' } },
    { id: 'w_t_scan', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('workspaceScanner'), port: 'task' } },
    { id: 'w_dec_impl', from: { node: nodeId('decomposer'), port: 'tasks' }, to: { node: nodeId('implementer'), port: 'task' } },
  ],
};

/** The frontmatter `tools:` line of an agent .md — what resolveGraph stamps onto
 *  `node.tools` in production (workflows.mjs#parseFrontmatterTools). */
function frontmatterTools(key) {
  const file = REGISTRY[key].agentFile;
  const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  const line = m ? m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l)) : null;
  return line ? line.replace(/^tools\s*:/, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const tok = (over = {}) => ({ seq: 1, type: 'md', ...over });

/** Bind a port to a plausible absolute artifact path; a void port binds a
 *  payload-free token (which is exactly what an `as:'worktree'` input gets). */
function bind(port) {
  if (port.type === 'void') return tok({ type: 'void' });
  return tok({ type: port.type, path: `/abs/${port.id}.${port.type === 'json' ? 'json' : 'md'}` });
}

/**
 * The ctx `runAgentExecution` hands its builder, assembled the way `prepare` does —
 * real sidecar meta, real allocation, graph-derived expands port. `only` names the
 * ports to bind; absent it, every REQUIRED input is bound (the steady-state first
 * execution).
 */
function ctxFor(key, { only = null, workspace = null, extras = [], slice = null, runRoot = null } = {}) {
  const meta = REGISTRY[key];
  const node = {
    id: nodeId(key), kind: 'agent', key, x: 0, y: 0, config: {},
    fanOut: !!meta.fanOut, agentPrompt: `You are ${meta.displayName}.`, tools: frontmatterTools(key),
  };
  const ports = { ...portsFn(node), verdict: meta.verdict };
  let v = 0;
  const runCtx = {
    pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
    workspaceKey: null, duplicateKey: false, slice: slice?.id ?? null,
    planVersion: () => { v += 1; return v; },
  };
  const chosen = (ports.inputs || []).filter((p) => p.id !== 'await' && (only ? only.includes(p.id) : p.required));
  const bindings = {};
  for (const port of chosen) bindings[port.id] = bind(port);
  const executionId = `x:${node.id}:${ORDINAL}`;
  return {
    node, nodeId: node.id, ports, meta, bindings,
    trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
    ordinal: ORDINAL, cycle: ORDINAL, executionId, runCtx, slice,
    outputs: allocateOutputs({ node, ports, executionId, ordinal: ORDINAL, runCtx }),
    verdict: allocateVerdict({ node, ports, ordinal: ORDINAL, runCtx }),
    expandsPort: expandsOutputPort(PARITY_TPL, portsFn, node.id),
    projectDir, pipelineDir, taskPrompt: TASK_PROMPT, toolInstruction: 'TOOLS',
    checkpointRef: 'abc1234', extras, workspace, runRoot, template: PARITY_TPL,
    priorAnswers: [], agentPrompts: {}, claudeOpts: { mock: true },
  };
}

const promptFor = (key, opts) => buildAgentPrompt(ctxFor(key, opts));

// ── the 11 ────────────────────────────────────────────────────────────────────

test('the pin covers exactly the 11 shipped builtins, all v2-ported', () => {
  assert.deepEqual(BUILTIN_KEYS, [
    'clarify', 'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting',
    'planReviewer', 'planner', 'refiner', 'reviewer', 'workspaceReviewer', 'workspaceScanner',
  ]);
  for (const key of BUILTIN_KEYS) {
    assert.equal(REGISTRY[key].metaVersion, 2, `${key} is metaVersion 2`);
    assert.ok((portsFn({ kind: 'agent', key }).inputs || []).some((p) => p.id === 'await'),
      `${key} carries the synthesized await gate`);
  }
});

test('every builtin keeps the v1 task header: title, cwd line, pipeline dir, skills hint', () => {
  for (const key of BUILTIN_KEYS) {
    const p = promptFor(key);
    assert.ok(p.startsWith(`# Task: ${REGISTRY[key].displayName}\n\n`), `${key}: task title`);
    assert.ok(p.includes(`Project directory (your cwd): ${projectDir}\n`), `${key}: cwd line`);
    assert.ok(p.includes(`Pipeline directory (shared artifacts): ${pipelineDir}\n\n`), `${key}: pipeline dir`);
    assert.ok(p.includes(V1_SKILLS_HINT), `${key}: skills hint`);
  }
});

// ── request policy (v1 phases.mjs:449-495 semantics, restated without the key list) ──

const TASK_WIRED = ['clarify', 'planner', 'workspaceScanner'];
const WANTS_REQUEST = ['refiner', 'reviewer', 'planReviewer'];
const UPSTREAM_ONLY = ['decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer'];

test('request policy: task-wired builtins get the request AND the attachments', () => {
  const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
  for (const key of TASK_WIRED) {
    assert.ok(taskSourcedPorts(PARITY_TPL, nodeId(key)).size > 0, `${key} is task-wired`);
    const p = promptFor(key, { extras });
    assert.ok(p.includes(V1_REQUEST_BLOCK), `${key}: ## Original request`);
    assert.ok(!p.includes(V1_UPSTREAM_BLOCK), `${key}: no upstream header`);
    assert.ok(p.includes(V1_ATTACHMENTS_HEAD), `${key}: ## Attached files`);
    assert.ok(p.includes('- `/abs/spec.md` (spec.md)'), `${key}: the attachment row`);
  }
});

test('request policy: wantsRequest builtins get the request but NEVER the attachments', () => {
  const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
  for (const key of WANTS_REQUEST) {
    assert.equal(REGISTRY[key].wantsRequest, true, `${key}.wantsRequest`);
    assert.equal(taskSourcedPorts(PARITY_TPL, nodeId(key)).size, 0, `${key} binds no task token`);
    const p = promptFor(key, { extras });
    assert.ok(p.includes(V1_REQUEST_BLOCK), `${key}: ## Original request`);
    assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
  }
});

test('request policy: every other builtin gets the upstream-input header and no request text', () => {
  for (const key of UPSTREAM_ONLY) {
    const p = promptFor(key, { extras: [{ name: 'spec.md', path: '/abs/spec.md' }] });
    assert.ok(p.includes(V1_UPSTREAM_BLOCK), `${key}: ## Upstream input`);
    assert.ok(!p.includes(TASK_PROMPT), `${key}: no request text at all`);
    assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
  }
});

test('request policy is driven by wantsRequest, not by the v1 agent-key list', () => {
  const base = ctxFor('reviewer');
  const node = { ...base.node, id: 'n_custom', key: 'custom' };
  const meta = { ...REGISTRY.reviewer, key: 'custom', displayName: 'Custom' };
  const wants = buildAgentPrompt({ ...base, node, ports: { ...base.ports, ...meta }, meta });
  assert.ok(wants.includes(V1_REQUEST_BLOCK), 'wantsRequest alone earns the request');
  const { wantsRequest, ...without } = meta;                 // eslint-disable-line no-unused-vars
  const neither = buildAgentPrompt({ ...base, node, ports: { ...base.ports, ...without }, meta: without });
  assert.ok(neither.includes(V1_UPSTREAM_BLOCK));
  assert.ok(!neither.includes(TASK_PROMPT));
});
```

Part 3 — the per-builtin literal lists, the markers, the tools pin and the round trip:

```js
// ── fan-out, verdict contract, markers ───────────────────────────────────────

test('fan-out declarers keep the v1 directive verbatim; the others carry none', () => {
  for (const key of BUILTIN_KEYS) {
    const p = promptFor(key);
    if (REGISTRY[key].fanOut) {
      assert.ok(p.includes(V1_FANOUT_HEAD), `${key}: fan-out head`);
      assert.ok(p.includes(V1_FANOUT_SUBAGENTS), `${key}: subagent_type sentence`);
      assert.ok(p.includes(V1_FANOUT_TAIL), `${key}: read-only tail`);
    } else {
      assert.ok(!p.includes(V1_FANOUT_HEAD), `${key}: no fan-out block`);
    }
  }
});

test('every verdict declarer carries the three-line contract plus its calibration tail', () => {
  const withVerdict = BUILTIN_KEYS.filter((k) => REGISTRY[k].verdict);
  assert.deepEqual(withVerdict.sort(), ['manualWebUiTesting', 'planReviewer', 'refiner', 'reviewer', 'workspaceReviewer']);
  for (const key of withVerdict) assert.ok(promptFor(key).includes(V1_VERDICT_CONTRACT), `${key}: verdict contract`);
  assert.ok(promptFor('refiner').includes(V1_REFINER_CALIBRATION));
  assert.ok(promptFor('planReviewer').includes(V1_PLAN_REVIEW_CONSEQUENCE));
  assert.ok(promptFor('manualWebUiTesting').includes(V1_WEBUI_CALIBRATION));
  assert.ok(promptFor('workspaceReviewer').includes(V1_WS_UNION_LINE));
  assert.ok(!promptFor('decomposer').includes(V1_VERDICT_CONTRACT), 'a producer carries none');
});

/** v1's MOCK_ROLE per builtin — the closed writer vocabulary the offline mock
 *  switches on. The scanner's marker is deliberately NOT its prompt role. */
const MOCK_ROLES = {
  clarify: 'clarify', planner: 'planner-plan', refiner: 'refiner', decomposer: 'decomposer',
  implementer: 'implementer', reviewer: 'reviewer', planReviewer: 'plan-review',
  workspaceReviewer: 'workspace-reviewer', manualTestsChecklist: 'manual-tests-checklist',
  manualWebUiTesting: 'manual-web-ui-testing', workspaceScanner: 'workspace-scan',
};

test('every builtin pins its v1 MOCK_ROLE and names its allocated outputs absolutely', () => {
  for (const key of BUILTIN_KEYS) {
    const ctx = ctxFor(key);
    const p = buildAgentPrompt(ctx);
    assert.equal(REGISTRY[key].mockRole, MOCK_ROLES[key], `${key}: sidecar mockRole`);
    assert.ok(p.includes(`MOCK_ROLE: ${MOCK_ROLES[key]}`), `${key}: MOCK_ROLE marker`);
    assert.ok(p.includes(`MOCK_CYCLE: ${ORDINAL}`), `${key}: MOCK_CYCLE`);
    for (const [portId, alloc] of Object.entries(ctx.outputs)) {
      assert.ok(alloc.path.startsWith('/'), `${key}.${portId}: absolute`);
      assert.ok(p.includes(alloc.path), `${key}.${portId}: the path is in the prompt`);
    }
    if (ctx.verdict) assert.ok(p.includes(`MOCK_JSON: ${ctx.verdict.path}`), `${key}: MOCK_JSON`);
  }
  // The filename contract, spot-checked against v1's shipped names.
  assert.match(ctxFor('reviewer').outputs.review.path, /01-01-26-feature-impl-review\.md$/);
  assert.match(ctxFor('reviewer').verdict.path, /impl-review-cycle2\.json$/);
  assert.match(ctxFor('planReviewer').outputs.review.path, /01-01-26-feature-plan-review\.md$/);
  assert.match(ctxFor('workspaceReviewer').verdict.path, /ws-review-cycle2\.json$/);
  assert.match(ctxFor('refiner').verdict.path, /refine-review-cycle2\.json$/);
  assert.match(ctxFor('manualWebUiTesting').outputs.review.path, /webui-review-cycle2\.md$/);
  assert.match(ctxFor('manualTestsChecklist').outputs.checklist.path, /manual-tests-checklist\.md$/);
  assert.match(ctxFor('decomposer').outputs.tasks.path, /decomposition\.json$/);
  assert.match(ctxFor('clarify').outputs.answers.path, /clarify\.json$/);
  assert.match(ctxFor('planner').outputs.plan.path, /plans\/01-01-26-feature\.md$/);
  assert.equal(ctxFor('refiner').outputs.plan.path, ctxFor('refiner').outputs.revise.path);
  assert.ok(buildAgentPrompt(ctxFor('decomposer')).includes(`MOCK_TASKS_DIR: ${join(pipelineDir, 'tasks')}`),
    'the decomposer is discovered through the wire into implementer.task');
});

// ── the per-agent load-bearing sentences (adj-f1 §0 item 2: what the old branch lost) ──

test('clarify keeps its scope, its budget and its empty-questions instruction', () => {
  const p = promptFor('clarify');
  assert.ok(p.includes(V1_CLARIFY_SCOPE));
  assert.ok(p.includes('2 to 4 options'));
  assert.ok(p.includes('up to 8'));
  assert.ok(p.includes('write { "questions": [] } to that same path'));
  assert.ok(p.includes('MOCK_PRIOR: 0'));
  assert.ok(!p.includes('## Already answered — DO NOT ask these again'),
    'the round-2 block is gone: the clarifier executes once per token');
});

test('planner keeps its instruction, the REVISE arm and the inline answers block', () => {
  const p = promptFor('planner');
  assert.ok(p.includes(V1_PLANNER_INSTRUCTION));
  assert.ok(p.includes('## Clarifications already answered'));
  assert.ok(p.includes(V1_NO_ANSWERS), 'unbound answers render the v1 placeholder');
  assert.ok(p.includes('MOCK_BASE: feature'));
  const revising = promptFor('planner', { only: ['task', 'revise'] });
  assert.ok(revising.includes(V1_REVISE_DIRECTIVE), 'the revise directive is byte-faithful');
  const answered = buildAgentPrompt({
    ...ctxFor('planner', { only: ['task', 'answers'] }),
    priorAnswers: [{ id: 'q1', question: 'Fail fast?', choice: 'Yes' }],
  });
  assert.ok(answered.includes('- **Q:** Fail fast? — **A:** Yes'));
  assert.ok(answered.includes(V2_ANSWERS_ARM), 'and the answers port renders its own arm');
});

test('refiner, reviewer, planReviewer and workspaceReviewer keep their v1 instructions', () => {
  assert.ok(promptFor('refiner').includes(V1_REFINER_INSTRUCTION));
  const rev = promptFor('reviewer');
  assert.ok(rev.includes(V1_REVIEWER_INSTRUCTION));
  assert.ok(rev.includes(V1_REVIEWER_DIFF_REF), 'the checkpoint-ref diff sentence survives (as:worktree)');
  const pr = promptFor('planReviewer');
  assert.ok(pr.includes('Review the implementation PLAN against the original request and the real codebase.'));
  assert.ok(pr.includes(V1_PLAN_REVIEW_SCOPE));
  assert.ok(promptFor('workspaceReviewer').includes(V1_WS_REVIEW_INSTRUCTION));
  assert.ok(promptFor('workspaceReviewer', {
    workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/abs/api', checkpointRef: 'aaa1' }] },
  }).includes('## Workspace fan-out — one reviewer per touched project'));
});

test('implementer renders exactly ONE arm per execution, plus the cwd sentence', () => {
  const fix = promptFor('implementer', { only: ['fix', 'plan'] });
  assert.ok(fix.includes(V1_FIX_DIRECTIVE), 'fix beats implement (A3, declared order)');
  assert.ok(fix.includes(V2_FIX_REVIEW_ARM));
  assert.ok(!fix.includes(V1_IMPLEMENT_DIRECTIVE));
  const sliced = promptFor('implementer', { only: ['task', 'plan'] });
  assert.ok(sliced.includes(V1_SLICE_DIRECTIVE), 'task beats implement');
  assert.ok(!sliced.includes(V1_FIX_DIRECTIVE));
  const plain = promptFor('implementer', { only: ['plan'] });
  assert.ok(plain.includes(V1_IMPLEMENT_DIRECTIVE));
  for (const p of [fix, sliced, plain]) assert.ok(p.includes(V1_IMPL_CWD), 'Work inside… Commit nothing');
  const withSiblings = promptFor('implementer', {
    only: ['task', 'plan'],
    slice: { id: 'p1t1', title: 'One', phase: 1, path: '/abs/t1.md', index: 0, siblings: [{ id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md' }] },
  });
  assert.ok(withSiblings.includes('## Parallel siblings — shared working tree'));
  assert.ok(withSiblings.includes('- p1t2 "Two" (tasks/p1-t2.md)'));
});

test('decomposer keeps the slicing rules, the tasks dir and the manifest shape', () => {
  const p = promptFor('decomposer');
  assert.ok(p.includes(V1_DECOMPOSER_SLICES));
  assert.ok(p.includes(`Write each task file under: ${join(pipelineDir, 'tasks')}/ (name them p<phase>-t<n>-<kebab-title>.md)`));
  assert.ok(p.includes(V1_DECOMPOSER_MANIFEST));
});

test('the checklist keeps both change-inspection variants; web UI keeps its instruction', () => {
  assert.ok(promptFor('manualTestsChecklist').includes(V1_CHECKLIST_SINGLE));
  const detached = promptFor('manualTestsChecklist', {
    runRoot: '/run/root',
    workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/run/root/repos/api', checkpointRef: 'aaa1' }] },
  });
  assert.ok(detached.includes(V1_CHECKLIST_DETACHED));
  assert.ok(detached.includes('- **API**: `git -C repos/api diff aaa1`'));
  assert.ok(promptFor('manualWebUiTesting').includes(V1_WEBUI_INSTRUCTION));
});

// ── tools, resume header, round trip ─────────────────────────────────────────

test('frontmatter tools reach allowedTools — the Playwright grants are not lost', () => {
  const ctx = ctxFor('manualWebUiTesting');
  const browser = frontmatterTools('manualWebUiTesting').filter((t) => t.startsWith('mcp__plugin_playwright_playwright__browser_'));
  assert.ok(browser.length >= 10, 'the sidecar body still declares the browser tools');
  const opts = runOpts(ctx, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: READ_WRITE_TOOLS });
  for (const t of browser) assert.ok(opts.allowedTools.includes(t), `granted: ${t}`);
  assert.deepEqual(opts.allowedTools.slice(0, READ_WRITE_TOOLS.length), READ_WRITE_TOOLS);
  assert.equal(REGISTRY.implementer.sideEffect, 'code', 'the implementer is the code writer');
  const implOpts = runOpts(ctxFor('implementer'), { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: IMPLEMENTER_TOOLS });
  assert.ok(implOpts.allowedTools.includes('MultiEdit'));
});

test('a resumed execution keeps the v1 resume header, ahead of the task prompt', () => {
  const ctx = { ...ctxFor('reviewer'), resumeSessionId: 'sess-9' };
  const opts = runOpts(ctx, { role: 'r', prompt: buildAgentPrompt(ctx), systemPrompt: 'S', allowedTools: READ_WRITE_TOOLS });
  assert.ok(opts.prompt.startsWith(RESUME_HEADER));
  assert.ok(opts.prompt.includes('# Task: Review Implementation'));
});

test('runAgentExecution ships exactly the prompt buildAgentPrompt produced', async () => {
  const ctx = ctxFor('reviewer');
  const r = await runAgentExecution(ctx);
  assert.equal(r.prompt, buildAgentPrompt(ctx), 'no second builder, no drift');
  assert.ok(r.outputs.review.path.endsWith('-impl-review.md'));
  assert.ok(Array.isArray(r.verdict.issues));
});
```

`Expected: Cannot find module '.../src/core/graph/registry-ports.mjs'` only if P2 is missing (Task 0 would have stopped you). With P3's executor in place: `# pass 18` / `# fail 0`.

- [ ] **Step 2:** there is no implementation step — this suite pins Tasks 6–8 and the P2 sidecars. If a literal is absent, fix `agents/<key>.meta.json` (its `promptHints`, `directive`, `filename` or capability flag) and re-run; that is a P2 defect the pin exists to catch. Record any sidecar you had to repair in the commit body.
- [ ] **Step 3: Run** — `node --test test/graph-prompt-parity.test.mjs` → `Expected: # pass 18` / `# fail 0`.
- [ ] **Step 4: Commit** — `worca: Node-graph v2 P3 — prompt-parity pin suite`

---

### Task 10: The offline mock chain — a test driver and `test/mock-graph.test.mjs`

**Files:** create `test/helpers/graph-run.mjs` (the driver) and `test/mock-graph.test.mjs`; modify `src/core/graph/executor.mjs` (export `publishable`).

**Interfaces:**
- Produces `runGraphOffline({ template, portsFn, registry, projectDir, pipelineDir, answer, taskText, maxParallel })` → `{ result, state, events, execSeq, calls }` — a scheduler + executor wired by a hand-built ctx factory, i.e. exactly what P4's `_execute` will do minus the ledger, the DB and the harness. **No orchestrator exists yet**, so this driver is how a whole graph is exercised offline.
- Produces `export function publishable(ports, outputs)` from `executor.mjs` (P4's `finish` arm needs it too).

**Mock rules (§5.5):** `MOCK_CYCLE = ordinal`, and every verifier mock gates on `cycle <= 1` (`claude-runner.mjs:1272, :1404, :1455, :1592, :1664`) ⇒ blocking at ordinal 1, clean at 2 ⇒ **every loop closes at ordinal 2**, also through the OR valve (per-source ordinals). The clarifier mock returns `questions: []` once `MOCK_PRIOR > 0`. Flow nodes never spawn. Markers ride the PROMPT (`parseMarkers`, `:808-822`) — there is no mock env var to set beyond `claudeOpts.mock`.

- [ ] **Step 1: Write the driver** — `test/helpers/graph-run.mjs`

```js
// test/helpers/graph-run.mjs
// Run a whole v2 graph offline: the real scheduler + the real executor, wired by the
// same ctx shape P4's GraphOrchestrator._execute will build (minus the ledger, the DB
// and the harness). Everything spawns through the offline mock (`claudeOpts.mock`).
import { join } from 'node:path';
import { createScheduler } from '../../src/core/graph/scheduler.mjs';
import {
  runExecution, allocateOutputs, allocateVerdict, expandsOutputPort,
  readDecomposition, publishable,
} from '../../src/core/graph/executor.mjs';

/**
 * @param {object} o
 * @param {object} o.template   a v2 template
 * @param {Function} o.portsFn  node -> ports
 * @param {Record<string,object>} o.registry  agent key -> normalized meta
 * @param {(ask:object) => any} [o.answer]    answers clarify asks and gates
 * @returns {Promise<{result:string, state:object, events:object[], execSeq:string[], calls:object[]}>}
 */
export async function runGraphOffline({
  template, portsFn, registry = {}, projectDir, pipelineDir,
  answer = (a) => (a.kind === 'gate' ? 'continue' : { answers: [] }),
  taskText = '# Task\n\nBUILD IT\n', maxParallel = 4,
}) {
  const events = [];
  const calls = [];
  let planVersion = 0;
  const keyCount = new Map();
  for (const n of template.nodes || []) {
    if (n.kind === 'agent') keyCount.set(n.key, (keyCount.get(n.key) || 0) + 1);
  }

  const execute = async (args) => {
    const node = args.node;
    const meta = registry[node.key] || {};
    const ports = node.kind === 'agent'
      ? { ...portsFn(node), verdict: meta.verdict }
      : portsFn(node);
    const runCtx = {
      pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
      workspaceKey: null, duplicateKey: (keyCount.get(node.key) || 0) > 1,
      slice: args.slice?.id ?? null,
      planVersion: () => { planVersion += 1; return planVersion; },
    };
    const outputs = allocateOutputs({ node, ports, executionId: args.executionId, ordinal: args.ordinal, runCtx });
    const verdict = allocateVerdict({ node, ports, ordinal: args.ordinal, runCtx });
    calls.push({ nodeId: node.id, kind: node.kind, key: node.key ?? null, composite: args.composite ?? null, ordinal: args.ordinal });

    // The three composite arms the adapter owns (the scheduler drives them).
    if (args.composite === 'expand') {
      const doc = await readDecomposition(args.bindings[args.expandsPort]?.path);
      return {
        phases: doc.phases.map((ph) => ({
          ordinal: ph.ordinal,
          tasks: ph.tasks.map((t) => ({ ...t, path: join(pipelineDir, t.file) })),
        })),
      };
    }
    if (args.composite === 'phase') return {};
    if (args.composite === 'finish') return { outputs: publishable(ports, outputs) };

    const ctx = {
      node: {
        ...node,
        fanOut: !!meta.fanOut,
        agentPrompt: `You are ${meta.displayName || node.key || node.kind}.`,
        tools: [],
        promptHints: meta.promptHints,
      },
      nodeId: node.id, executionId: args.executionId, ordinal: args.ordinal, cycle: args.ordinal,
      bindings: args.bindings, trigger: args.trigger, signal: args.signal, slice: args.slice ?? null,
      template, portsFn, ports, meta, outputs, verdict,
      expandsPort: expandsOutputPort(template, portsFn, node.id),
      runCtx, taskArtifact: { text: taskText },
      projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'TOOLS',
      extras: [], workspace: null, agentPrompts: {}, checkpointRef: 'abc1234',
      claudeOpts: { mock: true },
      ask: async (a) => answer(a),
    };
    return runExecution(ctx);
  };

  const scheduler = createScheduler({
    template, portsFn, execute, maxParallel,
    onEvent: (name, payload) => events.push({ name, ...payload }),
    onAsk: async (a) => answer(a),
  });
  const result = await scheduler.run();
  return {
    result,
    state: scheduler.getState(),
    events,
    calls,
    execSeq: events.filter((e) => e.name === 'exec' && e.status === 'start').map((e) => `${e.nodeId} c${e.ordinal}`),
  };
}
```

Implementation note: add `export` to `function publishable(ports, outputs)` in `src/core/graph/executor.mjs`.

- [ ] **Step 2: Write the failing test** — `test/mock-graph.test.mjs`

```js
// test/mock-graph.test.mjs
// The offline MOCK chain, audited as a whole.
//
// The chain is: sidecar `mockRole` -> clarifier runnerType -> a node whose output
// feeds an `expands` input -> a declared verdict -> the generic producer
// (`resolveMockRole`, executor.mjs), and every link of it must land on a `case` the
// writer switch in `runMock` actually handles. The unit-level chain is pinned in
// graph-executor.test.mjs; what this file adds is the two things a unit test cannot
// see:
//   1. the STRUCTURAL audit — the writer switch's case labels and the
//      MOCK_WRITER_ROLES export are the same set, and the 11 builtin sidecars pin
//      roles that already exist in it;
//   2. the BEHAVIOURAL audit — real graphs run to completion offline. Every seed
//      graph and the graph default terminate because the mock verdicts get less
//      severe each cycle, an ALL-CUSTOM graph reaches its End card with agents the
//      engine has never heard of, and no flow card ever spawns a runner.
//
// GENERICITY: the all-custom case is the load-bearing one. Every key in it is a user
// sidecar, so if any part of the chain ever keys off a builtin agent name, that test
// goes red first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { runGraphOffline } from './helpers/graph-run.mjs';
import { MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER } from '../src/core/claude-runner.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { flowPorts } from '../src/shared/graph/ports.mjs';
import { AWAIT_PORT } from '../src/shared/graph/constants.mjs';

useTempHome(after);
const REPO = fileURLToPath(new URL('..', import.meta.url));
const AGENTS_DIR = join(REPO, 'agents');
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

// ── 1. structural audit: the switch, the export, the builtin sidecars ────────

/** The `case` labels of runMock's writer switch, read straight off the source — the
 *  only way to prove the export has not drifted from the switch it mirrors. */
function writerSwitchRoles() {
  const src = readFileSync(join(REPO, 'src/core/claude-runner.mjs'), 'utf8');
  const start = src.indexOf('switch (role) {');
  assert.notEqual(start, -1, 'runMock still dispatches on `switch (role)`');
  const end = src.indexOf('default:', start);
  assert.notEqual(end, -1, 'the switch still has a default arm');
  const named = { MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER };
  const roles = [...src.slice(start, end).matchAll(/^\s*case\s+(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*)):/gm)]
    .map(([, literal, ident]) => {
      if (literal !== undefined) return literal;
      assert.ok(ident in named, `case ${ident}: names a constant this audit does not know`);
      return named[ident];
    });
  assert.ok(roles.length > 0, 'the switch has case arms');
  return new Set(roles);
}

test('MOCK_WRITER_ROLES is exactly the writer switch case set', () => {
  assert.deepEqual([...writerSwitchRoles()].sort(), [...MOCK_WRITER_ROLES].sort(),
    'the export and the switch it mirrors must not drift');
});

test('the 11 builtins pin roles the switch already handles — no new case strings', () => {
  const pinned = {};
  for (const file of readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.meta.json'))) {
    const meta = JSON.parse(readFileSync(join(AGENTS_DIR, file), 'utf8'));
    pinned[meta.key] = meta.mockRole ?? null;
  }
  assert.equal(Object.keys(pinned).length, 11, 'the 11 builtin sidecars');
  for (const [key, role] of Object.entries(pinned)) {
    assert.notEqual(role, null, `${key} pins an explicit mockRole`);
    assert.ok(MOCK_WRITER_ROLES.has(role), `${key} -> ${role} is a handled writer role`);
  }
  // Nothing in the switch is orphaned either: what the builtins do not claim is
  // exactly the three roles no sidecar can pin.
  const unclaimed = [...MOCK_WRITER_ROLES].filter((r) => !Object.values(pinned).includes(r));
  assert.deepEqual(unclaimed.sort(), ['agent-gen', 'generic-producer', 'generic-verifier'],
    'the switch carries no case the chain can never reach');
});

// ── 2. behavioural audit: whole graphs, offline ──────────────────────────────

const GRAPHS = [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW];

const clarifyAnswer = (a) => (a.kind === 'gate'
  ? 'continue'
  : { answers: (a.questions || []).map((q) => ({ id: q.id, choice: (q.options || ['ok'])[0] })) });

for (const tpl of GRAPHS) {
  test(`${tpl.id} completes offline and reaches its End card`, { timeout: 120000 }, async () => {
    const r = await runGraphOffline({
      template: tpl, portsFn, registry: REGISTRY,
      projectDir: tmp('worca-mockgraph-proj-'), pipelineDir: tmp('worca-mockgraph-pipe-'),
      answer: clarifyAnswer,
    });
    assert.equal(r.result, 'done', `${tpl.id}: the run resolves done`);
    assert.equal(r.state.endReached, true, `${tpl.id}: a token reached End`);
    assert.ok(r.state.result, `${tpl.id}: the End card carries a result`);
    assert.deepEqual(r.state.warnings, [], `${tpl.id}: no quiescence warning`);
    // Every loop closed at ordinal 2 (the verifier mocks' `cycle <= 1` gate), so no
    // wire ever hit its budget and no gate was ever raised.
    assert.equal(r.events.some((e) => e.name === 'gate'), false, `${tpl.id}: no gate was needed`);
    for (const [wireId, n] of Object.entries(r.state.wireDeliveries)) {
      assert.ok(n <= 1, `${tpl.id}: ${wireId} delivered ${n} times (loops close at ordinal 2)`);
    }
    // No flow card ever spawned a runner.
    const flowExecs = r.events.filter((e) => e.name === 'exec' && e.agentKey === null && e.status === 'done');
    assert.ok(flowExecs.length > 0, `${tpl.id}: flow cards executed`);
  });
}

test('an ALL-CUSTOM graph completes offline through the generic chain alone', { timeout: 60000 }, async () => {
  const CUSTOM = {
    asker: {
      displayName: 'Asker', runnerType: 'clarifier', promptHints: '',
      inputs: [{ id: 'task', type: 'md', required: true }],
      outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'asker.json', store: 'run' }],
    },
    maker: {
      displayName: 'Maker', runnerType: 'producer', promptHints: '', fanOut: false,
      inputs: [{ id: 'task', type: 'md', required: true }, { id: 'answers', type: 'json', as: 'answers' }],
      outputs: [{ id: 'plan', type: 'md', when: 'always', filename: 'maker-plan-c{cycle}.md', store: 'run' }],
    },
    splitter: {
      displayName: 'Splitter', runnerType: 'producer', promptHints: '',
      inputs: [{ id: 'plan', type: 'md', required: true }],
      outputs: [{ id: 'tasks', type: 'json', when: 'always', filename: 'splitter.json', store: 'run' }],
    },
    worker: {
      displayName: 'Worker', runnerType: 'producer', sideEffect: 'code', promptHints: '',
      inputs: [
        { id: 'fix', type: 'md', loop: true, as: 'fix-review', directive: 'Fix it.' },
        { id: 'task', type: 'json', expands: true, directive: 'Do the slice.' },
        { id: 'plan', type: 'md', required: true, directive: 'Build it.' },
      ],
      outputs: [{ id: 'done', type: 'void', when: 'always' }],
    },
    checker: {
      displayName: 'Checker', runnerType: 'verifier', promptHints: '',
      inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', as: 'worktree' }],
      outputs: [
        { id: 'review', type: 'md', when: 'blocking', filename: 'checker-review-cycle{cycle}.md', store: 'run' },
        { id: 'pass', type: 'void', when: 'clean' },
      ],
      verdict: { filename: 'checker-review-cycle{cycle}.json' },
    },
  };
  const customPorts = (n) => (n.kind === 'agent'
    ? {
      inputs: [...(CUSTOM[n.key]?.inputs || []).map((p) => ({ ...p })), { ...AWAIT_PORT }],
      outputs: (CUSTOM[n.key]?.outputs || []).map((p) => ({ ...p })),
      verdict: CUSTOM[n.key]?.verdict,
    }
    : flowPorts(n));
  const W = (id, from, to, config) => ({
    id,
    from: { node: from.split('.')[0], port: from.split('.')[1] },
    to: { node: to.split('.')[0], port: to.split('.')[1] },
    ...(config ? { config } : null),
  });
  const tpl = {
    id: 'wf_custom', name: 'All custom', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_ask', kind: 'agent', key: 'asker', x: 0, y: 0, config: {} },
      { id: 'n_make', kind: 'agent', key: 'maker', x: 0, y: 0, config: {} },
      { id: 'n_split', kind: 'agent', key: 'splitter', x: 0, y: 0, config: {} },
      { id: 'n_work', kind: 'agent', key: 'worker', x: 0, y: 0, config: {} },
      { id: 'n_check', kind: 'agent', key: 'checker', x: 0, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} },
    ],
    wires: [
      W('w1', 'n_task.task', 'n_ask.task'), W('w2', 'n_task.task', 'n_make.task'),
      W('w3', 'n_ask.answers', 'n_make.answers'), W('w4', 'n_make.plan', 'n_split.plan'),
      W('w5', 'n_make.plan', 'n_work.plan'), W('w6', 'n_make.plan', 'n_check.plan'),
      W('w7', 'n_split.tasks', 'n_work.task'), W('w8', 'n_work.done', 'n_check.done'),
      W('w9', 'n_check.review', 'n_work.fix', { maxCycles: 3 }),
      W('w10', 'n_check.pass', 'n_end.result'),
    ],
  };
  const r = await runGraphOffline({
    template: tpl, portsFn: customPorts, registry: CUSTOM,
    projectDir: tmp('worca-custom-proj-'), pipelineDir: tmp('worca-custom-pipe-'),
    answer: clarifyAnswer,
  });
  assert.equal(r.result, 'done');
  assert.equal(r.state.endReached, true);
  assert.equal(r.calls.filter((c) => c.nodeId === 'n_check').length, 2, 'the loop closed at ordinal 2');
  assert.ok(r.calls.some((c) => c.composite === 'expand'), 'the expands consumer fanned out');
  assert.ok(r.execSeq.some((s) => s.startsWith('n_end')), 'End executed');
});
```

`Expected: Error: Cannot find module '.../test/helpers/graph-run.mjs'` before Step 1; afterwards `# pass 11` / `# fail 0` (2 structural + 8 graphs + 1 all-custom).

- [ ] **Step 3: Run** — `node --test test/mock-graph.test.mjs`. If a seed hangs, the FIRST thing to check is the loop-closing rule: a verifier whose mock never goes clean (its `mockRole` does not reach a `cycle <= 1` writer arm) loops until its budget gates, and the driver answers gates `continue`, so it still terminates — a hang means a readiness bug, not a mock bug.
- [ ] **Step 4: Commit** — `worca: Node-graph v2 P3 — offline mock chain and the graph test driver`

---

### Task 11: Hand-written v1 fixture graphs for the 7 seeds

**Files:** create `test/fixtures/workflows-v1/<seedId>.json` (7 files) and `test/graph-seed-v1-fixtures.test.mjs`.

**Why:** P4's `test/saved-pipeline-parity.test.mjs` runs each seed on the LIVE v1 engine and on v2 under identical mock verdict scripts, and asserts identical agent execution order, produced files, gate prompts and budgets. The v1 rows those graphs were converted FROM live only in the user's DB, so the v1 side needs a checked-in template. Each fixture is the v1 `{id, name, version:1, domain, steps, feedbacks}` shape (`workflows.mjs:91-108` `DEFAULT_WORKFLOW` is the reference), derived mechanically from the seed graph through the INVERSE of the two static maps:
- `NODE_ID_MAP[seedId]`: v1 step id → v2 node id. Inverted, it names each agent node's v1 step id; the numeric suffix (`s<rank>_<col>`) is its position, so `steps` is one single-node group per rank, in `s0_0, s1_0, …` order and `key` = the seed node's `key`.
- `FB_WIRE_MAP[seedId]`: v1 feedback id → v2 wire id. The wire's `from.node` gives the feedback's `from`; its `to.node` gives the `to` — **except when the target is the OR valve**, where the v1 `to` is the node the valve's `out` feeds (the valve did not exist in v1: `reviewer.review → or.in1 → or.out → implementer.fix` IS v1's `reviewer → implementer` feedback).

- [ ] **Step 1: Write the fixtures** — seven files under `test/fixtures/workflows-v1/`:

`test/fixtures/workflows-v1/wf_full.json`
```json
{
  "id": "wf_full", "name": "Full", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "clarify" }],
    [{ "id": "s1_0", "key": "planner" }],
    [{ "id": "s2_0", "key": "refiner" }],
    [{ "id": "s3_0", "key": "decomposer" }],
    [{ "id": "s4_0", "key": "implementer" }],
    [{ "id": "s5_0", "key": "reviewer" }],
    [{ "id": "s6_0", "key": "manualTestsChecklist" }],
    [{ "id": "s7_0", "key": "manualWebUiTesting" }]
  ],
  "feedbacks": [
    { "id": "fb_0", "from": "s2_0", "to": "s2_0" },
    { "id": "fb_1", "from": "s5_0", "to": "s4_0" },
    { "id": "fb_2", "from": "s7_0", "to": "s4_0" }
  ],
  "createdAt": "2026-07-29T19:39:27.650Z", "updatedAt": "2026-07-29T19:39:27.650Z"
}
```

`test/fixtures/workflows-v1/wf_no-clarify.json`
```json
{
  "id": "wf_no-clarify", "name": "No Clarify", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "planner" }],
    [{ "id": "s1_0", "key": "refiner" }],
    [{ "id": "s2_0", "key": "decomposer" }],
    [{ "id": "s3_0", "key": "implementer" }],
    [{ "id": "s4_0", "key": "reviewer" }],
    [{ "id": "s5_0", "key": "manualTestsChecklist" }],
    [{ "id": "s6_0", "key": "manualWebUiTesting" }]
  ],
  "feedbacks": [
    { "id": "fb_0", "from": "s1_0", "to": "s1_0" },
    { "id": "fb_1", "from": "s4_0", "to": "s3_0" }
  ],
  "createdAt": "2026-07-29T19:40:22.212Z", "updatedAt": "2026-07-29T19:40:22.212Z"
}
```

`test/fixtures/workflows-v1/wf_provided-plan.json`
```json
{
  "id": "wf_provided-plan", "name": "Provided Plan", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "refiner" }],
    [{ "id": "s1_0", "key": "decomposer" }],
    [{ "id": "s2_0", "key": "implementer" }],
    [{ "id": "s3_0", "key": "reviewer" }],
    [{ "id": "s4_0", "key": "manualTestsChecklist" }],
    [{ "id": "s5_0", "key": "manualWebUiTesting" }]
  ],
  "feedbacks": [
    { "id": "fb_0", "from": "s0_0", "to": "s0_0" },
    { "id": "fb_1", "from": "s3_0", "to": "s2_0" },
    { "id": "fb_2", "from": "s5_0", "to": "s2_0" }
  ],
  "createdAt": "2026-08-07T11:29:56.074Z", "updatedAt": "2026-08-07T11:29:56.074Z"
}
```

`test/fixtures/workflows-v1/wf_full-no-decompose.json`
```json
{
  "id": "wf_full-no-decompose", "name": "FULL-NO-Decompose", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "clarify" }],
    [{ "id": "s1_0", "key": "planner" }],
    [{ "id": "s2_0", "key": "refiner" }],
    [{ "id": "s3_0", "key": "implementer" }],
    [{ "id": "s4_0", "key": "reviewer" }],
    [{ "id": "s5_0", "key": "manualTestsChecklist" }],
    [{ "id": "s6_0", "key": "manualWebUiTesting" }]
  ],
  "feedbacks": [
    { "id": "fb_0", "from": "s2_0", "to": "s2_0" },
    { "id": "fb_1", "from": "s4_0", "to": "s3_0" },
    { "id": "fb_2", "from": "s6_0", "to": "s3_0" }
  ],
  "createdAt": "2026-08-08T00:02:32.776Z", "updatedAt": "2026-08-08T00:02:32.776Z"
}
```

`test/fixtures/workflows-v1/wf_quick-fix.json`
```json
{
  "id": "wf_quick-fix", "name": "Quick Fix", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "planner" }],
    [{ "id": "s1_0", "key": "implementer" }],
    [{ "id": "s2_0", "key": "reviewer" }]
  ],
  "feedbacks": [{ "id": "fb_0", "from": "s2_0", "to": "s1_0" }],
  "createdAt": "2026-08-09T14:40:59.262Z", "updatedAt": "2026-08-09T14:40:59.262Z"
}
```

`test/fixtures/workflows-v1/wf_clarify-implement.json`
```json
{
  "id": "wf_clarify-implement", "name": "Clarify -> Implement", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "clarify" }],
    [{ "id": "s1_0", "key": "planner" }],
    [{ "id": "s2_0", "key": "refiner" }],
    [{ "id": "s3_0", "key": "implementer" }],
    [{ "id": "s4_0", "key": "reviewer" }]
  ],
  "feedbacks": [
    { "id": "fb_0", "from": "s4_0", "to": "s3_0" },
    { "id": "fb_1", "from": "s2_0", "to": "s2_0" }
  ],
  "createdAt": "2026-08-09T15:16:43.806Z", "updatedAt": "2026-08-09T15:16:43.806Z"
}
```

`test/fixtures/workflows-v1/wf_clarify-quick-fix.json`
```json
{
  "id": "wf_clarify-quick-fix", "name": "Clarify -> Quick Fix", "version": 1, "domain": "coding",
  "steps": [
    [{ "id": "s0_0", "key": "clarify" }],
    [{ "id": "s1_0", "key": "planner" }],
    [{ "id": "s2_0", "key": "implementer" }],
    [{ "id": "s3_0", "key": "reviewer" }]
  ],
  "feedbacks": [{ "id": "fb_0", "from": "s3_0", "to": "s2_0" }],
  "createdAt": "2026-08-09T15:18:40.077Z", "updatedAt": "2026-08-09T15:18:40.077Z"
}
```

Note `wf_clarify-implement`'s feedback ORDER: `FB_WIRE_MAP` maps `fb_0 → w9` (the review loop) and `fb_1 → w5` (the refine self-loop), i.e. the reverse of every other seed. That ordering is the map's, and the fixture follows it so the two stay consistent; the map's own comment records that this seed is absent from the reference DB and the order is unverified.

- [ ] **Step 2: Write the structural test** — `test/graph-seed-v1-fixtures.test.mjs`

```js
// test/graph-seed-v1-fixtures.test.mjs
// The 7 hand-written v1 rows the seeds were converted FROM. P4's dual-engine parity
// suite runs these on the LIVE v1 engine and their v2 twins on the graph engine, so a
// fixture that does not correspond to its seed would silently compare two different
// pipelines. This file proves the correspondence through the SAME static maps the
// V24 overlay migration uses — nothing here is hand-checked prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';

const DIR = fileURLToPath(new URL('./fixtures/workflows-v1/', import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));
/** `s<rank>_<col>` sorts by rank, then column — the v1 step order. */
const byPosition = (a, b) => {
  const pa = /^s(\d+)_(\d+)$/.exec(a); const pb = /^s(\d+)_(\d+)$/.exec(b);
  return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
};

test('every seed has a v1 fixture with the v1 template shape', () => {
  assert.equal(SEED_TEMPLATES.length, 7);
  for (const seed of SEED_TEMPLATES) {
    const fx = load(seed.id);
    assert.equal(fx.id, seed.id);
    assert.equal(fx.name, seed.name, `${seed.id}: same display name`);
    assert.equal(fx.domain, seed.domain);
    assert.equal(fx.version, 1, `${seed.id}: the fixture is a v1 row`);
    assert.ok(Array.isArray(fx.steps) && fx.steps.every((g) => Array.isArray(g)), `${seed.id}: steps are groups`);
    assert.ok(Array.isArray(fx.feedbacks));
    assert.equal(typeof fx.createdAt, 'string');
    assert.equal(typeof fx.updatedAt, 'string');
  }
});

test('fixture steps are the seed agent nodes, in NODE_ID_MAP order and with their keys', () => {
  for (const seed of SEED_TEMPLATES) {
    const fx = load(seed.id);
    const map = NODE_ID_MAP[seed.id];
    assert.ok(map, `${seed.id}: NODE_ID_MAP entry`);
    const expectedIds = Object.keys(map).sort(byPosition);
    assert.deepEqual(fx.steps.map((g) => g[0].id), expectedIds, `${seed.id}: one group per mapped step, in order`);
    assert.deepEqual(fx.steps.map((g) => g.length), expectedIds.map(() => 1), `${seed.id}: every seed is linear`);
    const nodeById = new Map(seed.nodes.map((n) => [n.id, n]));
    for (const group of fx.steps) {
      const nodeId = map[group[0].id];
      assert.ok(nodeId, `${seed.id}: ${group[0].id} is mapped`);
      assert.equal(group[0].key, nodeById.get(nodeId).key, `${seed.id}: ${group[0].id} keeps its agent key`);
    }
    // …and every agent node of the seed is represented (nothing dropped).
    const agents = seed.nodes.filter((n) => n.kind === 'agent').map((n) => n.id).sort();
    assert.deepEqual(Object.values(map).sort(), agents, `${seed.id}: the map covers every agent node`);
  }
});

test('fixture feedbacks are the seed loop wires, resolved through the OR valve', () => {
  for (const seed of SEED_TEMPLATES) {
    const fx = load(seed.id);
    const fbMap = FB_WIRE_MAP[seed.id];
    const inv = Object.fromEntries(Object.entries(NODE_ID_MAP[seed.id]).map(([v1, v2]) => [v2, v1]));
    const wireById = new Map(seed.wires.map((w) => [w.id, w]));
    const nodeById = new Map(seed.nodes.map((n) => [n.id, n]));
    assert.equal(fx.feedbacks.length, Object.keys(fbMap).length, `${seed.id}: one feedback per mapped wire`);
    for (const fb of fx.feedbacks) {
      const wireId = fbMap[fb.id];
      assert.ok(wireId, `${seed.id}: ${fb.id} is mapped to a wire`);
      const wire = wireById.get(wireId);
      assert.ok(wire, `${seed.id}: ${wireId} exists in the seed`);
      assert.equal(wire.config?.maxCycles, 3, `${seed.id}: ${wireId} is a budgeted loop wire`);
      assert.equal(inv[wire.from.node], fb.from, `${seed.id}: ${fb.id} source`);
      // The OR valve did not exist in v1: the v1 target is whatever `or.out` feeds.
      let target = wire.to.node;
      if (nodeById.get(target)?.kind === 'or') {
        const out = seed.wires.find((w) => w.from.node === target && w.from.port === 'out');
        assert.ok(out, `${seed.id}: the valve has an out wire`);
        target = out.to.node;
      }
      assert.equal(inv[target], fb.to, `${seed.id}: ${fb.id} target`);
    }
  }
});
```

`Expected (before Step 1): Error: ENOENT: no such file or directory, open '.../test/fixtures/workflows-v1/wf_full.json'`. With the fixtures in place: `# pass 3` / `# fail 0`.

- [ ] **Step 3: Run** — `node --test test/graph-seed-v1-fixtures.test.mjs` → `Expected: # pass 3` / `# fail 0`.
- [ ] **Step 4: Commit** — `worca: Node-graph v2 P3 — v1 fixture graphs for the 7 seeds`

---

### Task 12: Full suite, genericity + no-callers audit, handoff to P4

**Files:** none changed (audit only).

- [ ] **Step 1: Full suite** — `npm test 2>&1 | tail -5`

`Expected: BASELINE + 85 passing tests` (5 seams + 30 scheduler + 18 executor + 18 parity + 11 mock-graph + 3 fixtures), 0 failing. If the delta is not exactly 85, count the `test(` calls per new file (`grep -c "^test(" test/graph-scheduler.test.mjs` → 30, `test/graph-executor.test.mjs` → 18, `test/graph-prompt-parity.test.mjs` → 18, `test/mock-graph.test.mjs` → 3 top-level + 8 generated in the `for (const tpl of GRAPHS)` loop = 11, `test/graph-seed-v1-fixtures.test.mjs` → 3, `test/phases-graph-seams.test.mjs` → 5) and reconcile before moving on.

- [ ] **Step 2: NO-CALLERS audit** — the engine must still be dead code from the product's point of view:

```bash
git diff --name-only dev...HEAD | sort
```
`Expected:` exactly these, and nothing else:
```
agents/…            # ONLY if Task 9 had to repair a P2 sidecar literal
src/core/graph/executor.mjs
src/core/graph/scheduler.mjs
src/core/phases.mjs
test/fixtures/workflows-v1/wf_clarify-implement.json
test/fixtures/workflows-v1/wf_clarify-quick-fix.json
test/fixtures/workflows-v1/wf_full-no-decompose.json
test/fixtures/workflows-v1/wf_full.json
test/fixtures/workflows-v1/wf_no-clarify.json
test/fixtures/workflows-v1/wf_provided-plan.json
test/fixtures/workflows-v1/wf_quick-fix.json
test/graph-executor.test.mjs
test/graph-prompt-parity.test.mjs
test/graph-scheduler.test.mjs
test/graph-seed-v1-fixtures.test.mjs
test/helpers/graph-run.mjs
test/mock-graph.test.mjs
test/phases-graph-seams.test.mjs
```
```bash
git diff dev...HEAD -- src/core/orchestrator.mjs src/core/run-harness.mjs ui/ src/cli/ worca-cc.mjs | wc -l
```
`Expected: 0` — no dispatch path was touched. And the `phases.mjs` diff must be export keywords + the extraction only:
```bash
git diff dev...HEAD -- src/core/phases.mjs | grep -c "^[-+]" 
```
`Expected: ≤ 40 changed lines` (5 `export` prefixes + the moved diff sentence).

- [ ] **Step 3: GENERICITY audit** — no agent-key branch reached the engine:

```bash
grep -nE "'(clarify|planner|refiner|decomposer|implementer|reviewer|planReviewer|workspaceReviewer|manualTestsChecklist|manualWebUiTesting|workspaceScanner)'" src/core/graph/scheduler.mjs src/core/graph/executor.mjs
```
`Expected: no output.` (`MOCK_ROLE_CLARIFY` / `MOCK_ROLE_DECOMPOSER` are imported constants, not literals — that is the point of importing them.)

```bash
grep -n "node:fs\|process\." src/shared/graph/*.mjs
```
`Expected: no output` — P2's purity guard still holds; P3 imported shared modules, it did not edit them.

- [ ] **Step 4: Successor sentinels for P4** — both must print:
```bash
grep -q "export function createScheduler" src/core/graph/scheduler.mjs && echo OK-scheduler
grep -q "export function runAgentExecution" src/core/graph/executor.mjs && echo OK-executor
grep -q "export function runExecution" src/core/graph/executor.mjs && echo OK-dispatch
grep -q "export function sliceExecutionId" src/core/graph/scheduler.mjs && echo OK-slice-ids
ls test/fixtures/workflows-v1/*.json | wc -l    # 7
```

- [ ] **Step 5: Manual verification checklist** (no server, no browser — this plan ships no UI):
  - [ ] `node --test test/graph-scheduler.test.mjs test/graph-executor.test.mjs test/graph-prompt-parity.test.mjs test/mock-graph.test.mjs test/graph-seed-v1-fixtures.test.mjs test/phases-graph-seams.test.mjs 2>&1 | tail -5` — all green in one process (proves no cross-file `WORCA_HOME` leakage).
  - [ ] Re-run `node --test test/mock-graph.test.mjs` twice: the two runs must produce the same result (the driver is deterministic; a flake here means a readiness race).
  - [ ] `git status --porcelain` — nothing under `docs/superpowers/` is staged or committed.
  - [ ] The v1 engine is untouched: start nothing, but confirm `node --test test/orchestrator-run.test.mjs 2>&1 | tail -3` is green (it was in the baseline; P3 must not have moved it).

- [ ] **Step 6: Commit** — `worca: Node-graph v2 P3 — full suite green, engine landed with no callers`

**Handoff:** P3 is complete. The next plan is **P4 — GraphOrchestrator + dispatch**: `docs/superpowers/plans/2026-08-26-node-graph-v2-P4-graph-orchestrator.md`. It consumes `createScheduler` / `runExecution` / `runAgentExecution` / `sliceExecutionId` from `src/core/graph/{scheduler,executor}.mjs`, the `execute` and `ctx` contracts documented in Tasks 2 and 8 above, `publishable(ports, outputs)` for its `finish` arm, `test/helpers/graph-run.mjs` as the shape its `_execute` must reproduce (with the ledger, the DB and the harness added), and `test/fixtures/workflows-v1/*.json` for `test/saved-pipeline-parity.test.mjs`. This plan's absolute path: `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P3-engine-no-callers.md`.

---

## Clarifications (Q&A)

- **D1** — How does the engine land? → **New implementation on top of dev in 8 sequential plans; the old branch is a borrowable source only, and every plan leaves `npm test` green with dev shippable (user decision 2026-08-26).**
- **D6** — Is a v2 engine with no callers acceptable as a landed increment? → **Yes: P3 lands the engine, P4 lands the dispatch; the v1 engine stays live until P8 (user decision 2026-08-26).**
- **f-V7** — How many wires may an input take? → **Exactly one, everywhere (agents incl. `await`, AND/OR/Combine ins, End.result); fan-IN is the explicit OR card (Amendment f, authoritative text).**
- **f-await** — Where does the universal gate input come from? → **The engine synthesizes `{id:'await', type:'any', required:false}` on every agent node (P2's `portsFn`); it binds like any input for readiness, its payload is DISCARDED at bind, it never renders, never selects a mode, and never appears in the Ports block (Amendment f).**
- **f-flow** — Which flow cards exist? → **Task · End · AND · OR · Combine. AND fires all-fresh and emits static `void`; OR fires any-fresh, binds the FRESHEST and re-emits its payload with a new seq (one emission per drain); End binds once and completes the run (Amendment f).**
- **A1** — What does `maxCycles` cap? → **TOTAL source firings around the loop: `allowance = maxCycles − 1`, and the gate fires at the would-be `maxCycles`-th delivery (parity-mandatory, base spec §3).**
- **A2** — How does the mid-stream entry template seed the plans store? → **`Task.config.planStoreSeed: true` writes the rendered document to `planPath(..., 1, ...)`, the emitted token IS that path, and the plan-version counter starts consumed at 1 (parity-mandatory).**
- **A3** — What selects an agent's mode? → **Port FRESHNESS: the FIRST fresh directive port in DECLARED order, and only it; a latched loop token never selects; first executions treat every bound port as fresh (parity-mandatory).**
- **A4** — What happens on gate "continue"? → **The held blocking token is discarded and the SOURCE node's `clean` outputs force-fire with `forced:true` + the open issues in `meta`; payload = the held token's path/value when the types match, else the clean port's latched payload, else null (parity-mandatory).**
- **P3-1** — Gate ask identity? → **`gate-<wireId>-<deliveryNo>` with payload `{id, kind:'gate', wireId, nodeId: <source node>, executionId, issues}`, answered through the unchanged `POST /api/answer {id}` path (rebuild spec §5.3).**
- **P3-2** — What do non-interactive runs answer? → **Gates `continue`, clarify asks `[]` — the scheduler's default `onAsk` implements exactly that (rebuild spec §5.3, v1 `_ask` auto path).**
- **P3-3** — Does the scheduler emit `skipped` rows for nodes that never fired? → **No. The run monitor derives `skipped` from "no ledger rows on a done run" (`adj-d.md` §64); emitting rows would break that derivation. `'skipped'` stays a legal `exec.status` for P4/P6 (agent adjudication adj-d).**
- **P3-4** — `onGate` vs `onAsk`? → **`onAsk(ask) → Promise<answer>` is the ask CHANNEL (gates now, and whatever the scheduler owns later); `onGate(gate|null)` is the state NOTIFIER that feeds `state.gate = {wireId, fromNode, toNode, askId}|null` (§5.7). `onEvent('gate', …)` stays the engine-internal audit trail (planner default).**
- **P3-5** — How does a pause reach the scheduler from inside an execution? → **`execute` resolves `{ paused: true }`: the ledger row is marked `paused` (NON-terminal), nothing publishes, and `reattach` re-invokes it with the recorded args. P4's `_execute` returns this when its pause abort cancels a spawn (planner default; matches §5.6 "executions marked `paused`, non-terminal").**
- **P3-6** — How is a snapshot restored? → **`reattach(snapshot)` on the returned object, called BEFORE `run()`; it restores and re-invokes `execute` for every non-terminal execution with its RECORDED args, and re-raises every held gate unless `ended` is set (rebuild spec §5.3 signature; the call ordering is a planner default).**
- **P3-7** — What is `state.tokens`? → **The latched OUTPUT tokens, keyed `'<node>.<outputPort>'` → `{seq, type, path, firedAt}` (what a wire carries). The snapshot keeps BOTH: `tokens` (delivered, keyed by input port) and `outputs` (latched, keyed by output port) (planner default; §5.7 names the field but not which side).**
- **P3-8** — Who renders the task document? → **P4's adapter: `ctx.taskArtifact = { path }` (already on disk) or `{ text }`. The scheduler carries no `taskArtifact` option, and the executor never imports `channels.mjs` (which dies in P8) (planner default).**
- **P3-9** — Which extra exports does the executor publish for P4? → **`runExecution(ctx, {runners})` (the single dispatch entry, keeping the `opts.runners[runnerType]` seam) and `publishable(ports, outputs)` (the composite `finish` arm's return value) (planner default).**
- **P3-10** — May P3 edit `phases.mjs`? → **Only export-only additions (`mockMarkers`, `runOpts`, `siblingsBlock`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS`) plus the byte-neutral extraction of `diffInstruction(ctx)` from `runReviewer`, which keeps using it. Nothing else outside `src/core/graph/` and `test/` changes (rebuild spec §5.4 names the two exports and the extraction; the other three are a planner default forced by "spawning goes through `runOpts`").**
- **P3-11** — Where does `verdict.filename` reach the executor? → **On the ports object (`ports.verdict.filename`), which P2's `portsFn` carries through from the sidecar; the parity/test ctx builders stamp `{...portsFn(node), verdict: meta.verdict}` so the pin holds either way (planner default; P2 contract assumption).**
- **P3-12** — Which portsFn do the tests use? → **The REAL one: `registryPortsFn(loadAgentRegistry(agents/, {userAgentsDir:null, includePlugins:false}))` (P2's `src/core/graph/registry-ports.mjs`). Scheduler unit fixtures build a local portsFn over CUSTOM keys from `AWAIT_PORT` + `flowPorts`, so no builtin name can leak into a scheduling decision (planner default; satisfies "no `FIXTURE_PORTS` copy").**
- **P3-13** — Where does the whole-graph offline driver live? → **`test/helpers/graph-run.mjs`, exporting `runGraphOffline(...)`. No orchestrator exists in P3, and P4's `_execute` must reproduce its ctx shape with the ledger/DB/harness added (planner default).**
- **P3-14** — What are the v1 fixtures called? → **`test/fixtures/workflows-v1/<seedId>.json`, one per seed, in the v1 `{id,name,version:1,domain,steps,feedbacks,createdAt,updatedAt}` shape (rebuild spec §2 names the path).**
- **P3-15** — `wf_clarify-implement`'s feedback order? → **`fb_0` = the review loop, `fb_1` = the refine self-loop — the order `FB_WIRE_MAP` records (its own comment marks that seed as absent from the reference DB and the order unverified); the fixture follows the map so the two cannot disagree (planner default).**
- **P3-16** — The v2 questions filename (`questions-x-<nodeIdSafe>-c<ordinal>-r<round>.json`)? → **NOT implemented here: `_questionsLoop` and `_questionsPath` are the ADAPTER's (P4). P3 only pins the clarifier ask id `clarify-<nodeId>-<ordinal>` (rebuild spec §5.4).**
- **P3-18** — Do slice executions know their position? → **Yes: `kind:'task'` exec events, snapshot `execs[]` rows and the slice's `execute` args carry `taskIndex` (1-based inside its phase), `taskTotal` (the phase's task count) and `parentExecutionId`; P4 writes all three onto the ledger row + `exec_meta`, and the CLI renders `task 3/7` (agent adjudication, cross-plan pass 2026-08-27 — additive to spec §5.7).**
- **P3-19** — Which constants are arrays? → **`KINDS`/`FLOW_KINDS`/`PORT_TYPES` are frozen ARRAYS (P1); membership is `.includes()` (cross-plan pass 2026-08-27 — `FLOW_KINDS.has` was a bug).**
- **P3-17** — What if a prompt-parity literal is missing? → **The P2 sidecar lost a byte: repair `agents/<key>.meta.json` (its `promptHints` / `directive` / `filename`) and record the repair in the commit body. Never weaken the pin (planner default; the pin list is the contract per §6).**
- **f-drift** — Which old-branch prompt bytes must be restored? → **The implementer siblings block, the plain implement arm, "Work inside the project directory… Commit nothing", the reviewer's checkpoint-ref diff sentence, the checklist's detached-workspace variant, the planner's inline "## Clarifications already answered", and the decomposer's tasks-dir + manifest-shape lines — each pinned in `test/graph-prompt-parity.test.mjs` (agent adjudication `adj-f1.md` §0 item 2).**
- **f-tools** — Do frontmatter tools still reach the spawn? → **Yes: the executor passes the base list to `runOpts`, which unions `ctx.node.tools` via `effectiveAllowedTools` (`phases.mjs:47`). P4's `resolveGraph` MUST stamp `node.tools`; the parity suite pins manualWebUiTesting's Playwright grants (adj-f1 §0 item 1).**

## Known issues (Session A, 2026-08-27 — resolve during this plan's refinement, before execution)

Findings recorded while refining P1/P2 and adjudicating the cross-plan contracts. The refinement reports live (untracked) in `docs/superpowers/plans/2026-08-26-node-graph-v2-reports/`; `xplan-manifest.md` §A is the canonical contract sheet, §D the residual list.

- P2 refinement: `manualTestsChecklist.promptHints` carries a `{diffInstruction}` token (single-project value reproduces dev bytes; the detached-workspace arm cannot come from the same template) — Task 9's parity pins + sidecar-repair allowance must cover it.
- P2 keeps the implementer `promptHints` ("Work inside the project directory (your cwd). Commit nothing; just edit files and tests.") — Task 9's parity pin must consume it from the sidecar, not re-add it in `baseInstruction`.
- `PORT_ID_RE` canonical = P1's strict lowerCamel regex (no `_`/`-`); adj-f2 §2/§3 texts saying otherwise are superseded — P7's editor hint must say lowerCamel only.
