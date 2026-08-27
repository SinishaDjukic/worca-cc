# Node-Graph v2 — P4: GraphOrchestrator + dispatch Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the graph engine *runnable*. `src/core/graph/orchestrator.mjs` (`GraphOrchestrator extends RunHarness`) drives P3's scheduler + executor through a single `_execute` adapter, writes the execution ledger to `state.steps[]` + the V23 columns, emits the v2 `exec`/`token` events plus a derived `phase` shim so the untouched v1 UI keeps rendering, resumes from a v2 resume point, and is reached by `POST /api/run`, `/api/resume` and the CLI through `createOrchestratorFor`. `wf_default_v2` is served as "Default (graph)" so a v2 run is dogfoodable end-to-end. The v1 engine stays the live default; the suite stays green.

**Architecture:** `_resolveTopology` = `resolveGraph` (overlays + generic workspace variants + `placeable:false` refusal) → `workspaceFanOut` forcing → `buildGraphManifest`; `_engineRun` builds P3's scheduler with `execute = this._execute.bind(this)` and fans its `exec`/`token`/`gate` events onto the orchestrator's surface; `_execute` builds ONE ctx (phases fields ∪ graph fields), runs the cost gate → questions priming → attempt loop → questions loop → post-execution artifacts, and handles the three composite fan-out modes. `state.steps[]` IS the ledger (one row per execution, `key === executionId`), so `_recordCost`, the clocks, `writeState`, `sumStepCosts` and `readPipelineForResume` are shared and unchanged. A `phase` event derived from the manifest node's `uiPhase` follows every `exec`, and the manifest carries v1-shaped `steps`/`feedbacks` cells, so `app.js`, the CLI and Ask keep working untouched until P8 deletes the shim.

**Series position:** P4 of 8; requires P3 landed (sentinels: `export function createScheduler` in `src/core/graph/scheduler.mjs` and `export function runAgentExecution` in `src/core/graph/executor.mjs`); leaves dev green and shippable; v1 engine stays live.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats everything it needs).

## Global Constraints

- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in every user-facing string: **worca** (never "worca-cc").
- Commits: `worca: Node-graph v2 P4 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file); baseline recorded in Task 0; final total recorded in Task 14.
- **Every test is offline.** `claude: { mock: true }` or `WORCA_MOCK=1` plus injected `opts.runners`; never spawn a real agent.
- **v1 is untouched behaviourally.** `class Orchestrator` keeps every method it has today except the ones Task 1 *moves up* to `RunHarness` verbatim (it inherits them, byte-identical). The 16 `orchestrator-*` suites, `pause-resume-e2e`, `server-pause-resume`, `dispatcher` and `orchestrator-questions` must pass with only the additive edits this plan names.
- **Execution ids** are `x:<nodeId>:<ordinal>` and `x:<nodeId>:<ordinal>:p<P>t<T>` (minted by P3's scheduler; `sliceExecutionId(parentExecutionId, taskId)` is exported from `src/core/graph/scheduler.mjs`). `state.steps[].key === executionId` — there is no separate `executions[]` array.
- **No feature flag anywhere.** The engine is chosen from data: the resume point's `version` first, else the template row's `version`.
- Fixed contracts used verbatim (do not rename): module paths `src/core/graph/orchestrator.mjs`, `src/core/engine-select.mjs`, `src/core/run-harness.mjs`; exports `createGraphOrchestrator`, `GraphOrchestrator`, `createOrchestratorFor`, `selectEngine`; alias id `wf_default_v2` with name `Default (graph)`; event names `exec`, `token`, `phase`; DB columns `execution_id, exec_kind, agent_key, ended_at, exec_trigger, exec_result, exec_meta` on `pipeline_steps` and `outcome` on `pipelines`.
- Test file names are contracts: `test/orchestrator-graph.test.mjs`, `test/saved-pipeline-parity.test.mjs`, `test/graph-phase-shim.test.mjs`.

---

### Task 0: Branch check, deps, baseline, predecessor sentinels

**Files:** none (verification only).

**Interfaces:** produces the recorded BASELINE pass count consumed by Task 14.

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch. By hand, create it first: `git checkout -b worca-cc/node-graph-v2-p4` off dev. **NEVER `git checkout dev`; never create a branch inside a pipeline run.**
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: this plan borrows shapes from the discarded branch: `git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed`. Every borrowed snippet is already embedded below — the fetch is only for cross-checking, and the plan is executable without it.
- [ ] Step 4: predecessor sentinels — if ANY line prints nothing, **STOP** (a predecessor plan has not landed):
  ```sh
  grep -q "export function createScheduler" src/core/graph/scheduler.mjs && echo P3-scheduler-ok
  grep -q "export function runAgentExecution" src/core/graph/executor.mjs && echo P3-executor-ok
  grep -q "export function sliceExecutionId" src/core/graph/scheduler.mjs && echo P3-sliceid-ok
  grep -q "class RunHarness extends EventEmitter" src/core/run-harness.mjs && echo P1-harness-ok
  grep -q "createOrchestratorFor" src/core/engine-select.mjs && echo P1-select-ok
  grep -q "GRAPH_DEFAULT_WORKFLOW" src/core/graph/builtin-workflows.mjs && echo P1-default-ok
  grep -q "export async function resolveGraph" src/core/workflows.mjs && echo P2-resolveGraph-ok
  grep -q "assertRunnableWorkflow" src/core/workflows.mjs && echo P2-assert-ok
  grep -q "export function buildGraphManifest" src/shared/graph/manifest.mjs && echo P2-manifest-ok
  grep -q "kind: 'preflight'" src/shared/graph/manifest.mjs && echo P2-shim-cells-ok
  grep -q "export function classifyLoops" src/shared/graph/loops.mjs && echo P2-loops-ok
  grep -q "export function registryPortsFn" src/core/graph/registry-ports.mjs && echo P2-registryports-ok
  grep -q "execution_id" src/core/db.mjs && echo P2-v23-cols-ok
  ls test/fixtures/workflows-v1/wf_full.json && echo P3-v1-fixtures-ok
  ```
- [ ] Step 5: `npm test 2>&1 | tail -5` — record the printed pass count as **BASELINE**; it must be green before you change anything.

---

### Task 1: Harness extensions — `_log`/`_artifact` attribution + the attr-driven telemetry reducers move up

**Why:** v2 tags every `log`/`artifact` line with `{nodeId, executionId}` (§5.7), and the whole sub-agent/skills/graphify/cost telemetry block is already *pure `attr` plumbing* — it reads only `attr.stepKey`/`attr.nodeId`/`attr.cycle` and looks steps up by `state.steps[].key`. The ONLY thing v2 changes is the VALUE of `attr.stepKey` (an executionId instead of `"<stepIndex>:<nodeId>#<cycle>"`). Copying ~340 lines into the v2 class would create a drift trap, so these methods move UP to `RunHarness` verbatim; `Orchestrator` inherits them with byte-identical behaviour, and `GraphOrchestrator` gets them for free.

**Files:**
- `src/core/run-harness.mjs` — modify `_log` and `_artifact`; receive the moved methods + their module helpers.
- `src/core/orchestrator.mjs` — delete the moved methods + the now-unused module helpers and imports.
- `test/run-harness-attr.test.mjs` — NEW.

**Interfaces:**
- Produces: `RunHarness.prototype._log(source, level, text, attr)` emitting `executionId` when `attr.executionId != null`; `RunHarness.prototype._artifact(kind, path, attr = null)` emitting `{kind, path, nodeId?, executionId?, port?}`; `RunHarness.prototype.{_onAgentEvent,_recordSubAgentSpawns,_recordSubAgentFinishes,_recordSubAgentTelemetry,_recordSkills,_recordGraphify,_upsertSubAgent,_subAgentTransition,_recordCost}`.
- Consumes: nothing new.

- [ ] **Step 1: Check whether P1 already moved the telemetry block.** `grep -c "_onAgentEvent(role, e, attr" src/core/run-harness.mjs`. If it prints `1`, the block is already on the base — skip Steps 4–5 and do only the `_log`/`_artifact` edits. If it prints `0`, do every step.

- [ ] **Step 2: Write the failing test** — `test/run-harness-attr.test.mjs`

```js
// test/run-harness-attr.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RunHarness } from '../src/core/run-harness.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const TELEMETRY = [
  '_onAgentEvent', '_recordSubAgentSpawns', '_recordSubAgentFinishes',
  '_recordSubAgentTelemetry', '_recordSkills', '_recordGraphify',
  '_upsertSubAgent', '_subAgentTransition', '_recordCost',
];

test('the attr-driven telemetry block lives on RunHarness (both engines share ONE copy)', () => {
  for (const name of TELEMETRY) {
    assert.equal(typeof RunHarness.prototype[name], 'function', `RunHarness#${name}`);
    assert.ok(
      !Object.hasOwn(Object.getPrototypeOf(createOrchestrator({ projectDir: process.cwd() })), name),
      `Orchestrator must NOT redeclare ${name} — it inherits the one copy`,
    );
  }
});

test('_log carries executionId and _artifact carries the node attribution', () => {
  const orch = createOrchestrator({ projectDir: process.cwd() });
  const logs = [];
  const arts = [];
  orch.on('log', (e) => logs.push(e));
  orch.on('artifact', (e) => arts.push(e));

  orch._log('planner', 'info', 'hello', { nodeId: 'n_plan', executionId: 'x:n_plan:2', cycle: 2 });
  assert.equal(logs[0].nodeId, 'n_plan');
  assert.equal(logs[0].executionId, 'x:n_plan:2');
  assert.equal(logs[0].cycle, 2);

  orch._log('planner', 'info', 'plain', null);
  assert.equal(logs[1].executionId, undefined, 'no attr => no executionId key');

  orch._artifact('plan', '/tmp/p.md', { nodeId: 'n_plan', executionId: 'x:n_plan:2', port: 'plan' });
  assert.deepEqual(arts[0], { kind: 'plan', path: '/tmp/p.md', nodeId: 'n_plan', executionId: 'x:n_plan:2', port: 'plan' });

  orch._artifact('plan', '/tmp/q.md');
  assert.deepEqual(arts[1], { kind: 'plan', path: '/tmp/q.md' }, '2-arg call stays byte-identical');
});

test('_recordCost attributes to an arbitrary step key (the executionId case)', () => {
  const orch = createOrchestrator({ projectDir: process.cwd() });
  orch.state.steps.push({ key: 'x:n_impl:1', phase: 'implementer', cycle: 1, status: 'start', activeMs: 0, runningSince: null });
  orch._recordCost(0.25, 'x:n_impl:1');
  assert.equal(orch.state.steps[0].costUsd, 0.25);
  assert.equal(orch.state.totalCostUsd, 0.25);
});
```

`Expected:` red — `AssertionError [ERR_ASSERTION]: RunHarness#_onAgentEvent` (`expected 'undefined' to equal 'function'`), and `assert.deepEqual(arts[0], …)` fails with `{ kind: 'plan', path: '/tmp/p.md' }` because `_artifact` ignores its third argument.

- [ ] **Step 3: Extend `_log` and `_artifact` in `src/core/run-harness.mjs`** (moved verbatim from dev `orchestrator.mjs:3865` / `:3881`; the two additive lines are marked):

```js
  _log(source, level, text, attr = null) {
    const evt = { source, level, text, ts: new Date().toISOString() };
    if (attr) {
      if (attr.nodeId != null) evt.nodeId = attr.nodeId;
      if (attr.executionId != null) evt.executionId = attr.executionId;   // v2 (§5.7 / §8 log filter)
      if (attr.stepIndex != null) evt.stepIndex = attr.stepIndex;
      if (attr.cycle != null) evt.cycle = attr.cycle;
      if (attr.sub) evt.sub = true;        // drives sub-agent web styling
      // Origin channel of the text: 'err' when it came from a subprocess's
      // stderr (agent CLI, git, graphify). Provenance, not severity.
      if (attr.stream) evt.stream = attr.stream;
    }
    this._emit('log', evt);
    this.logWriter.push(evt); // persist the full stream (buffered; flushed on a timer)
  }

  /**
   * @param {string} kind
   * @param {string} path
   * @param {{nodeId?:string, executionId?:string, port?:string|null}|null} [attr]
   *   v2 attribution (§5.7). Omitted keys are omitted from the event, so every
   *   2-arg v1 call emits the byte-identical `{kind, path}` payload it always did.
   */
  _artifact(kind, path, attr = null) {
    const evt = { kind, path };
    if (attr) {
      if (attr.nodeId != null) evt.nodeId = attr.nodeId;
      if (attr.executionId != null) evt.executionId = attr.executionId;
      if (attr.port != null) evt.port = attr.port;
    }
    this._emit('artifact', evt);
    // ALSO index FS markdown/extra paths so pipeline-delete can unlink the EXACT
    // files later (best-effort; never blocks a run). Skip the synthetic
    // 'pipeline'/'clarify'/'questions' kinds.
    if (!this.pipeline || !path || kind === 'pipeline' || kind === 'clarify' || kind === 'questions') return;
    let relPath = null;
    const pdir = this.pipeline.dir;
    if (path.startsWith(pdir + sep)) {
      relPath = relative(pdir, path);                 // dir-relative (checklist, webui)
    } else {
      const root = this.isWorkspace
        ? workspaceStorePath(this.workspaceKey)
        : projectStorePath(projectKey(this.projectDir));
      if (path.startsWith(root + sep)) relPath = relative(root, path); // store-rel (plan/review)
    }
    if (relPath) recordArtifact(this.pipeline.id, kind, relPath);
  }
```

- [ ] **Step 3b: `_ask` passes the v2 attribution through** (`run-harness.mjs`, moved verbatim from dev `orchestrator.mjs:2834`; two additive keys, spec §5.7 "`question` gains `wireId?` and `executionId?`"). Change the signature to `async _ask({ id, kind, questions, issues, recovery, agent, nodeId, wireId, executionId }) {` and the emit to:
```js
    this._emit('question', {
      id, kind, questions, issues, recovery, agent, nodeId,
      ...(wireId != null ? { wireId } : {}),           // v2 gates name their wire
      ...(executionId != null ? { executionId } : {}), // v2 asks name their execution
    });
```
  Every v1 call passes neither key, so v1's `question` payload is byte-identical. Add to `test/run-harness-attr.test.mjs`: `orch.on('question', …)`; `orch._ask({ id: 'gate-w9-3', kind: 'gate', wireId: 'w9', executionId: 'x:n_rev:3', issues: [] })` under `auto: true` resolves `{ decision: 'continue' }` and the captured event carries `wireId === 'w9'` and `executionId === 'x:n_rev:3'`; a plain `_ask({ id:'q1', kind:'gate', issues: [] })` event has neither key.

- [ ] **Step 4: Move the telemetry block to `run-harness.mjs`** (skip if Step 1 printed `1`). This is a **pure cut-and-paste, zero edits to the bodies.** Cut from `src/core/orchestrator.mjs`, in this order, and paste into the `RunHarness` class body directly after `_artifact`:

  1. `_onAgentEvent(role, e, attr = null)` — dev `orchestrator.mjs:3074-3229`
  2. `_recordSubAgentSpawns(raw, attr)` — `:3231-3255`
  3. `_recordSubAgentFinishes(raw)` — `:3266-3277`
  4. `_recordSkills(raw, subId, attr)` — `:3288-3315`
  5. `_recordGraphify(raw, subId, attr)` — `:3325-3348`
  6. `_upsertSubAgent(rec)` — `:3352-3355`
  7. `_subAgentTransition(transition, rec)` — `:3359-…`
  8. `_recordSubAgentTelemetry(raw)` — `:3388-3400`
  9. `_recordCost(costUsd, stepKey = null)` — `:3796-3818`

  Then cut these module-level helpers + constants (they are private to the block) and paste them at module scope in `run-harness.mjs`: `SUBAGENT_LABEL_MAX :4090`, `registerSubAgents :4098`, `describeToolUses :4109`, `describeToolResults :4131`, `toolTarget :4144`, `SKILLS_MAX :4182`, `OVERFLOW_RE :4189`, `mcpServerLabel :4193`, `skillLabel :4206`, `extractSkillLabels :4229`, `GRAPHIFY_CMD_RE :4251`, `countGraphifyBashCalls :4255`, `mergeSkills :4285`.

  `run-harness.mjs` must import (add to its existing import blocks, do not duplicate): `upsertSubAgent` from `./artifacts.mjs`, `observeModelCost` from `./config.mjs`, `recordCostDelta` from `./cost-budget.mjs`, and it already needs `roundUsd`/`sumStepCosts`/`clip` (they moved with `_recordStep`/the clocks in P1 — if any is missing, move it too).

- [ ] **Step 4b: Export the pure helpers both engines need from `run-harness.mjs`.** `GraphOrchestrator` needs these module-private helpers of dev's `orchestrator.mjs`; move any that is not already in `run-harness.mjs` there and give EVERY one of them an `export` keyword: `isAbort :4028`, `pauseErr :4037`, `isPause :4042`, `jsonClone :4048`, `safeParse :4053`, `firstLine :4061`, `numOr :3987`, `roundUsd :3993`, `sumStepCosts :4004`, `sumStepActive :4020`, `clip :4322`, `clipMiddle :4332`, `normalizeClarifyAnswer :4345`. In `orchestrator.mjs` replace each moved definition with a named import from `./run-harness.mjs` (dev already re-exports `isAbort` — keep `export { isAbort }` there so `test/*` importing it from `orchestrator.mjs` still resolves). Verify: `grep -n "^export function isAbort\|^export function clipMiddle\|^export function normalizeClarifyAnswer" src/core/run-harness.mjs` prints three lines.

- [ ] **Step 5: Delete the now-dead code in `orchestrator.mjs`** (skip if Step 1 printed `1`): the nine methods and thirteen helpers above, plus any import that is now unreferenced there (`grep -n "observeModelCost\|upsertSubAgent\|recordCostDelta" src/core/orchestrator.mjs` must print nothing; if it does, that import stays). Verify with `node --check src/core/orchestrator.mjs && node --check src/core/run-harness.mjs`.

- [ ] **Step 6: Run the oracle.** `node --test test/run-harness-attr.test.mjs test/orchestrator-session-capture.test.mjs test/orchestrator-guardrails.test.mjs && node --test test/subagent-*.test.mjs test/ui-subagent-*.test.mjs`
  `Expected:` all green — `# pass <n>`, `# fail 0`. The ~25 sub-agent suites are the oracle proving the move changed no behaviour.

- [ ] **Step 7: Commit** — `worca: Node-graph v2 P4 — harness attribution + shared telemetry block`

---

### Task 2: The `wf_default_v2` alias — readable, listable, askable

**Why (§5.2):** `GRAPH_DEFAULT_WORKFLOW` (P1, `src/core/graph/builtin-workflows.mjs`) already carries its FINAL id `wf_default` so the V24 seed/overlay maps never rename. Until P8 it is served under the alias id `wf_default_v2` so both defaults coexist. Overlays (`config_workflow_nodes` / `config_workflow_wires`) key on the **requested** id, so a user's per-node model on the graph default is stored under `wf_default_v2` — V24 remaps it.

**Files:**
- `src/core/workflows.mjs:277` (`readWorkflow`) — add the alias branch. `SAFE_WORKFLOW_ID = /^[A-Za-z0-9_-]+$/` (`:196`) already admits `wf_default_v2`.
- `ui/server.mjs:3116` (`GET /api/workflows`) — insert the alias row after `DEFAULT_WORKFLOW`.
- `src/core/ask/catalog.mjs:45-53` — same list, same order.
- `test/api-workflows-graph-alias.test.mjs` — NEW.

**Interfaces:**
- Produces: `readWorkflow('wf_default_v2') → { ...GRAPH_DEFAULT_WORKFLOW, id:'wf_default_v2', name:'Default (graph)' }` (a frozen-source shallow clone, never the frozen constant); `GRAPH_DEFAULT_ALIAS_ID = 'wf_default_v2'` and `graphDefaultAliasTemplate()` exported from `src/core/workflows.mjs`.
- Consumes: `GRAPH_DEFAULT_WORKFLOW` from `src/core/graph/builtin-workflows.mjs` (P1).

- [ ] **Step 1: Write the failing test** — `test/api-workflows-graph-alias.test.mjs`

```js
// test/api-workflows-graph-alias.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkflow, listWorkflows, DEFAULT_WORKFLOW, GRAPH_DEFAULT_ALIAS_ID } from '../src/core/workflows.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { createCatalog } from '../src/core/ask/catalog.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('readWorkflow serves the graph default under the alias id', async () => {
  assert.equal(GRAPH_DEFAULT_ALIAS_ID, 'wf_default_v2');
  const tpl = await readWorkflow('wf_default_v2');
  assert.ok(tpl, 'alias resolves');
  assert.equal(tpl.id, 'wf_default_v2');
  assert.equal(tpl.name, 'Default (graph)');
  assert.equal(tpl.version, 2);
  assert.deepEqual(tpl.nodes, GRAPH_DEFAULT_WORKFLOW.nodes);
  assert.deepEqual(tpl.wires, GRAPH_DEFAULT_WORKFLOW.wires);
  assert.notEqual(tpl, GRAPH_DEFAULT_WORKFLOW, 'a clone, never the frozen constant');
  // the v1 default is untouched
  assert.equal((await readWorkflow('wf_default')).version, 1);
  assert.equal((await readWorkflow('wf_default')).name, 'Default');
  // the alias is not a stored row
  assert.equal((await listWorkflows()).some((t) => t.id === 'wf_default_v2'), false);
});

test('the Ask catalog lists v1 default, then the alias, then saved rows', async () => {
  const cat = createCatalog({
    listProjects: async () => [], listWorkspaces: async () => [],
    listWorkflows: async () => [{ id: 'wf_mine', name: 'Mine', version: 1, steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] }],
    defaultWorkflow: DEFAULT_WORKFLOW, loadAgentRegistry: () => ({}),
  });
  const { workflows } = await cat.buildCatalog();
  assert.deepEqual(workflows.map((w) => w.id), ['wf_default', 'wf_default_v2', 'wf_mine']);
  assert.equal(workflows[1].name, 'Default (graph)');
});
```

`Expected:` red — `SyntaxError: The requested module '../src/core/workflows.mjs' does not provide an export named 'GRAPH_DEFAULT_ALIAS_ID'`.

- [ ] **Step 2: Implement the alias** in `src/core/workflows.mjs` — add the import at the top of the module and replace `readWorkflow` (`:277`):

```js
import { GRAPH_DEFAULT_WORKFLOW } from './graph/builtin-workflows.mjs';

/**
 * Coexistence alias (§5.2). GRAPH_DEFAULT_WORKFLOW carries its FINAL id
 * `wf_default` so the V24 seed/overlay maps never rename; until the break it is
 * served under this alias, and the v1 DEFAULT_WORKFLOW keeps `wf_default`.
 * Overlays key on the REQUESTED id, so per-node config on the graph default
 * lands under `wf_default_v2` and V24 remaps it. Removed in P8.
 */
export const GRAPH_DEFAULT_ALIAS_ID = 'wf_default_v2';

/** A fresh shallow clone under the alias identity — GRAPH_DEFAULT_WORKFLOW is
 *  deep-frozen and resolveGraph structuredClones it, so callers never mutate it. */
export function graphDefaultAliasTemplate() {
  // Same epoch stamps DEFAULT_WORKFLOW carries (workflows.mjs:107-108): every
  // listed template has createdAt/updatedAt. P8 moves them into the constant.
  return {
    ...GRAPH_DEFAULT_WORKFLOW, id: GRAPH_DEFAULT_ALIAS_ID, name: 'Default (graph)',
    createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

export async function readWorkflow(id, { includeArchived = false } = {}) {
  if (id === DEFAULT_WORKFLOW.id) return DEFAULT_WORKFLOW;
  if (id === GRAPH_DEFAULT_ALIAS_ID) return graphDefaultAliasTemplate();
  return readRaw(id, { includeArchived });
}
```

> If P2b gave `readWorkflow` a different options shape, keep P2b's signature and insert ONLY the two alias lines. The alias branch must sit **after** the `wf_default` branch and **before** the stored-row read, so a stray persisted row with that id can never shadow it.

- [ ] **Step 3: List it** — `ui/server.mjs:3116`, replacing the body of `GET /api/workflows`:

```js
app.get('/api/workflows', async (_req, res) => {
  try {
    // CONTRACT: [ v1 DEFAULT_WORKFLOW, the graph default under its coexistence
    // alias, ...listWorkflows() ]. The alias row is never persisted, so it can
    // never appear twice. P8 collapses this to [GRAPH_DEFAULT_WORKFLOW, ...].
    res.json({ workflows: [DEFAULT_WORKFLOW, graphDefaultAliasTemplate(), ...(await listWorkflows())] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```
Add `graphDefaultAliasTemplate` to the existing `from '../src/core/workflows.mjs'` import.

- [ ] **Step 4: Ask lists it identically** — `src/core/ask/catalog.mjs`, inside `buildCatalog` (dev `:53`):

```js
    // Same order as GET /api/workflows: v1 default, the graph default alias, saved
    // rows. shapeWorkflow derives `steps` (condensation-topo ranks) + `feedbacks`
    // (loop wires) for a v2 template, so the LLM-facing shape is unchanged.
    const templates = [
      defaultWorkflow,
      graphDefaultAliasTemplate(),
      ...workflows.filter((t) => t && t.id !== defaultWorkflow.id && t.id !== GRAPH_DEFAULT_ALIAS_ID),
    ];
```
with `import { GRAPH_DEFAULT_ALIAS_ID, graphDefaultAliasTemplate } from '../workflows.mjs';` added to the existing workflows import.

- [ ] **Step 5: Green** — `node --test test/api-workflows-graph-alias.test.mjs test/api-workflows.test.mjs test/workflows.test.mjs test/ask-catalog.test.mjs`
  `Expected:` `# fail 0`. If `test/api-workflows.test.mjs` asserts an exact `workflows.length`, update that ONE number (+1) and note it in the commit body; do not change what it asserts about `wf_default`.

- [ ] **Step 6: Commit** — `worca: Node-graph v2 P4 — wf_default_v2 alias listed as "Default (graph)"`

---

### Task 3: `src/core/graph/orchestrator.mjs` — GraphOrchestrator + the `_execute` adapter

**Files:**
- `src/core/graph/orchestrator.mjs` — NEW (the whole module, embedded below in five steps).
- `test/orchestrator-graph.test.mjs` — NEW (grown by Task 8).

**Interfaces:**
- Produces: `export class GraphOrchestrator extends RunHarness`, `export function createGraphOrchestrator(opts)`, `export function resolvedFromManifest(manifest, registry, agentsDir)` (returns the `resolveGraph` shape). Consumes `QUIESCENCE_WARNING` from `src/core/graph/scheduler.mjs` (P3 — the ONE quiescence text, `finished at quiescence — End not reached`; this module defines no text of its own) and `renderPromptArtifact` from `../channels.mjs` (until P8 re-homes it into `phases.mjs`).
- Consumes (contracts fixed by predecessors — if any signature differs, adapt the CALL, never rename the export):
  - `resolveGraph(projectDir, workflowId, registry, agentsDir?, { isWorkspace }) → { template, ports, loops, nodes, wires, agentsByKey, agentKeys }` (P2b, `src/core/workflows.mjs`; the P2 Task B4 contract). `template` is a deep copy whose agent nodes carry the RESOLVED key (workspace substitution applied); `ports` is `registryPortsFn(agentsByKey)` — `portsFn(node) → {...meta, inputs:[{id,type,required,loop,expands,as?,directive?}, …, await], outputs:[{id,type,when,filename?,store?,artifactKind?}], verdict?, known, ported}`; `loops` is `classifyLoops(template, ports)` computed once; `nodes[nodeId]` = `{ nodeId, kind:'agent', key, authoredKey, meta, runnerType, agentFile, agentPrompt, promptHints, tools, config, model, effort, fanOut, askQuestions, awaitAll, duplicateKey }` for agents, `{ nodeId, kind, key:null, config }` for flow cards; `wires[wireId] = {maxCycles}` for loop wires (overlay-merged); `agentKeys` is a `Set`. `resolveGraph` owns overlays, the generic `workspaceVariants(registry)` substitution + port-signature assertion, the `placeable:false` throw, the `workspaceFanOut` forcing (spec §5.10) and the per-loop-wire `maxCycles` merge. This class calls the resolver's per-node table `nodeCtx` (`this.resolved.nodeCtx === resolved.nodes`).
  - `classifyLoops(tpl, portsFn) → { loopWireIds:Set, loopInputs:Set, sccOf:Map, launchOrder:string[] }` (P2a, `src/shared/graph/loops.mjs`).
  - `buildGraphManifest(tpl, agentsByKey, { overlays }) → manifest v2` (P2a, `src/shared/graph/manifest.mjs`); `manifestPortsFn(manifest)`, `manifestTemplate(manifest)`.
  - `createScheduler({ template, portsFn, loops, execute, onEvent, onSnapshot, onGate, onAsk, maxParallel, log }) → { run(), pause(), abort(), reattach(snapshot), getState() }`, `sliceExecutionId(parentExecutionId, taskId)` (P3).
  - executor: `runAgentExecution, runClarifierExecution, runTaskExecution, runEndExecution, runAndExecution, runOrExecution, runCombineExecution, allocateOutputs, allocateVerdict, readDecomposition` (P3).
  - `registryPortsFn(registry)` (P2a, `src/core/graph/registry-ports.mjs`).

- [ ] **Step 1: Write the failing test.** Two files — the helper first, because three suites need it and importing one `*.test.mjs` from another would re-register its tests:

```js
// test/helpers/git-dir.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/** A throwaway git repo with one empty commit — the shape every orchestrator
 *  suite needs (a checkpoint ref must be resolvable). */
export function gitDir(tag = 'graph') {
  const dir = mkdtempSync(join(tmpdir(), `worca-cc-${tag}-`));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}
```

```js
// test/orchestrator-graph.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';

useTempHome(after);

test('the graph default runs end to end under WORCA_MOCK and reaches the End card', async () => {
  const dir = gitDir();
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo task',
    claude: { mock: true }, auto: true,
  });
  const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => orch.answer(q.id, { answers: [] }));

  const res = await orch.run();
  assert.equal(res.status, 'done');

  const st = orch.getState();
  assert.equal(st.engine, 2);
  assert.equal(st.endReached, true, 'the End card was bound');
  assert.ok(st.result, 'state.result carries the End payload');
  // Every ledger row is keyed by its executionId.
  assert.ok(st.steps.length > 0);
  for (const s of st.steps.filter((x) => String(x.key).startsWith('x:'))) {
    assert.equal(s.key, s.executionId);
    assert.ok(/^x:[A-Za-z0-9_-]+:\d+(:p\d+t\d+)?$/.test(s.key), `bad executionId ${s.key}`);
    assert.equal(s.stepIndex, null);
  }
  // The agent nodes all ran.
  const started = execs.filter((e) => e.status === 'start' && e.agentKey);
  assert.ok(started.length >= 4, `expected >= 4 agent executions, got ${started.length}`);
  assert.equal(orch.getState().status, 'done');
});
```

`Expected:` red — `Error: Cannot find module '<repo>/src/core/graph/orchestrator.mjs'`.

- [ ] **Step 2a: Create `src/core/graph/orchestrator.mjs` — header, imports, factory, constructor, topology hook**

```js
// src/core/graph/orchestrator.mjs
//
// The graph engine's orchestrator. It is NOT a second harness: everything that
// is engine-agnostic (run/resume shells, worktrees, guardrails, results, cost,
// clocks, questions plumbing, sub-agent telemetry, heartbeat) lives in
// RunHarness. This class supplies the six hooks plus ONE adapter, `_execute`,
// which the scheduler calls per execution.
//
// Vocabulary: an EXECUTION (not a step) is the unit. `x:<nodeId>:<ordinal>` for
// an ordinary execution, `x:<nodeId>:<ordinal>:p<P>t<T>` for a composite slice.
// state.steps[] IS the execution ledger: one row per execution, key ===
// executionId. There is no separate executions[] array.
import { join, isAbsolute } from 'node:path';
import { rm } from 'node:fs/promises';

import {
  RunHarness, isAbort, isPause, pauseErr, firstLine, jsonClone,
  clipMiddle, sumStepActive, normalizeClarifyAnswer,
} from '../run-harness.mjs';
import { resolveGraph, GRAPH_DEFAULT_ALIAS_ID } from '../workflows.mjs';
import { classifyLoops } from '../../shared/graph/loops.mjs';
import { buildGraphManifest, manifestTemplate, manifestPortsFn } from '../../shared/graph/manifest.mjs';
import { registryPortsFn } from './registry-ports.mjs';
import { createScheduler, sliceExecutionId } from './scheduler.mjs';
import {
  allocateOutputs, allocateVerdict, readDecomposition,
  runAgentExecution, runClarifierExecution,
  runTaskExecution, runEndExecution, runAndExecution, runOrExecution, runCombineExecution,
} from './executor.mjs';
import {
  appendAudit, writeReview, reviewKindOf, writeDecomposition, updateTaskStatus,
  updatePhaseStatus, writeStepQuestions, readStepQuestions,
} from '../artifacts.mjs';
import { readQuestionsFile } from '../protocol.mjs';
import { classifyError } from '../recoverable-error.mjs';

/** Flow-card executors by node kind. Instant, $0, no semaphore slot, no spawn. */
const FLOW_EXECUTORS = {
  task: runTaskExecution,
  end: runEndExecution,
  and: runAndExecution,
  or: runOrExecution,
  combine: runCombineExecution,
};

/** Agent executors by meta.runnerType. `opts.runners[type]` overrides (test seam). */
const AGENT_EXECUTORS = {
  producer: runAgentExecution,
  verifier: runAgentExecution,
  clarifier: runClarifierExecution,
};

/** Max ask-then-resume question rounds per execution (mirrors v1's constant). */
const MAX_QUESTION_ROUNDS = 3;
/** Concurrent AGENT executions (flow cards bypass the semaphore entirely). */
const MAX_PARALLEL = (() => {
  const n = Number(process.env.WORCA_MAX_PARALLEL);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
})();

// Amendment f (1): a graph that drains without binding End is a legitimate
// completion. The scheduler owns the warning text and state.warnings[] mirrors
// its getState().warnings (see _syncSchedulerState); this module only logs +
// audits it. Import: `import { createScheduler, sliceExecutionId, QUIESCENCE_WARNING } from './scheduler.mjs';`
// and `import { renderPromptArtifact } from '../channels.mjs';` (P8 re-points it to phases.mjs).

export function createGraphOrchestrator(opts = {}) {
  return new GraphOrchestrator(opts);
}

export class GraphOrchestrator extends RunHarness {
  constructor(opts) {
    super(opts);
    // Coexistence default: a bare construction targets the graph default under
    // its alias. createOrchestratorFor always passes an explicit id.
    this.workflowId = this.opts.workflowId || GRAPH_DEFAULT_ALIAS_ID;
    // The test seam (§5.4). NO defaultRunners and NO bound clarifier: executor
    // selection is node.kind -> meta.runnerType, never an agent key.
    // (this._runners is assigned by the _initRunners hook the base constructor calls.)
    this.resolved = null;        // resolveGraph's { template, ports, loops, nodes→nodeCtx, wires, agentsByKey, agentKeys }
    this._scheduler = null;
    this._graphSnapshot = null;  // last CLEAN scheduler snapshot
    this._resumeSnapshot = null; // the snapshot a resume restores from
    this._resumeSessions = null; // Map executionId -> sessionId (one-shot)
    this._graphError = null;     // first genuine execution error (identity preserved)
    this._planVersion = 0;       // {vsuffix} ticks, carried across a resume
    this._taskArtifact = null;   // the pre-rendered task document
    this.extrasFiles = [];
    Object.assign(this.state, {
      engine: 2,
      active: [],                // [{nodeId, executionId}]
      endReached: false,
      result: null,              // {type, path?, value?} | null
      warnings: [],
      wireDeliveries: {},        // {[wireId]: n}
      tokens: {},                // {'<node>.<port>': {seq,type,path,firedAt}}
      gate: null,                // {wireId, fromNode, toNode, askId} | null
    });
  }
```

- [ ] **Step 2b: Hooks 1 + 3 and the graph adoption** (append inside the class)

```js
  // ── hook 6: the runner registry (constructor seam, P1) ─────────────────────
  /** The test seam (§5.4). NO defaultRunners and NO bound clarifier: executor
   *  selection is node.kind -> meta.runnerType, never an agent key. */
  _initRunners(opts) {
    this._runners = { ...((opts && opts.runners) || {}) };
  }

  // ── hook 1: topology ───────────────────────────────────────────────────────
  /**
   * Resolve the workflow row into a runnable graph and snapshot the manifest.
   * The base stamps state.stepper with the returned manifest BEFORE the first
   * `state` emit (pinned by test/orchestrator-stepper-timing), calls
   * _preflightAgentKeys(agentKeys) and collectRequiredSkills(registry, agentKeys).
   * @param {Record<string,object>} registry loadAgentRegistry() output
   * @returns {Promise<{manifest:object, agentKeys:Set<string>}>}
   */
  async _resolveTopology(registry) {
    const resolved = await resolveGraph(this.projectDir, this.workflowId, registry, this.agentsDir, {
      isWorkspace: this.isWorkspace,
    });
    this._adoptResolvedGraph(resolved);
    // The manifest is built from the RESOLVED template, the resolver's registry
    // slice and its EFFECTIVE per-node/per-wire values (P2 contract): the run
    // monitor shows exactly what the engine will run. The builder stamps
    // template {id, name} from the (alias-aware) template itself.
    const manifest = buildGraphManifest(this.resolved.template, this.resolved.agentsByKey, {
      overlays: { nodes: this.resolved.nodeCtx, wires: this.resolved.wires },
    });
    return {
      manifest,
      agentKeys: new Set(this.resolved.agentKeys),
      workflow: { id: this.workflowId, name: this.resolved.template.name || this.workflowId },
    };
  }

  /**
   * Adopt a resolveGraph result (P2 contract: { template, ports, loops, nodes,
   * wires, agentsByKey, agentKeys }). The resolver has ALREADY applied the
   * workspace substitution AND the workspaceFanOut forcing (spec §5.10 — a META
   * flag, never a key set; v1's FANOUT_ELIGIBLE literal has no v2 counterpart)
   * and classified the loops ONCE. This class names the per-node table
   * `nodeCtx`; nothing is re-derived and no template node is mutated here.
   */
  _adoptResolvedGraph(resolved) {
    this.resolved = { ...resolved, nodeCtx: resolved.nodes };
  }

  // ── hook 3: the pre-dispatch pause point ───────────────────────────────────
  /** Paused before the scheduler ever ran (preflight/worktree setup): a v2 point
   *  with a null snapshot, which resume() replays as "start from scratch". */
  _enginePrePausePoint() {
    return this._buildResumePoint(null);
  }
```

- [ ] **Step 2c: Hook 2 (`_engineRun`), the resume point, and the scheduler event fan-out**

```js
  // ── hook 2: run the graph ──────────────────────────────────────────────────
  /**
   * The scheduler owns readiness, loop budgets, gates and End; this method owns
   * the process side: the pre-rendered task document, the executor binding, the
   * event fan-out and the resume-v2 snapshot. Returns 'done' | 'paused'; a
   * genuine execution failure is re-thrown VERBATIM (AbortError/pause identity
   * intact) so the base run()/resume() catch classifies it exactly as v1 does.
   * @param {{resume?:object|null, rehydrated?:object|null}} [o] the base passes
   *   `{ resume: rp, rehydrated }` on a resume and `{ resume: null }` on a fresh run;
   *   `rehydrated` is v1-only (the frozen plan) and ignored here
   * @returns {Promise<'done'|'paused'>}
   */
  async _engineRun({ resume = null } = {}) {
    const { template, ports, loops } = this.resolved;
    this.extrasFiles = await this._collectExtras();
    // The task document is pre-rendered ONCE: the Task card publishes it and
    // every entry agent binds that same file.
    // Byte-identical to v1's seeded task file (orchestrator.mjs:2044): the same
    // renderer, so the Task card's document matches what v1 handed its entry node.
    this._taskArtifact = { text: renderPromptArtifact(this.pipeline.promptText, this.extrasFiles) };

    const sched = createScheduler({
      template,
      portsFn: ports,
      loops,
      execute: this._execute.bind(this),
      onEvent: (name, payload) => this._onSchedulerEvent(name, payload),
      onSnapshot: (snap) => {
        // Freeze at the last CLEAN completion once a pause is requested: the
        // executions this pause kills must stay NON-TERMINAL in the persisted
        // point so the scheduler re-invokes them on resume.
        if (!this.pauseRequested) this._graphSnapshot = snap;
      },
      // P3 contract: onGate is the state.gate NOTIFIER ({wireId, fromNode, toNode,
      // askId} | null); onAsk is the ONE ask channel (gates today).
      onGate: (g) => { this.state.gate = g ? { ...g } : null; this._emit('state', this.getState()); },
      onAsk: (q) => this._schedulerAsk(q),
      maxParallel: MAX_PARALLEL,
      log: (source, level, text, attr = null) => this._log(source, level, text, attr),
    });
    this._scheduler = sched;
    if (resume && this._resumeSnapshot) {
      this._graphSnapshot = this._resumeSnapshot;
      sched.reattach(this._resumeSnapshot);
    }

    let outcome;
    try {
      outcome = await sched.run();
    } finally {
      this.state.active = [];
      this._syncSchedulerState();
    }

    if (outcome === 'error') throw this._graphError || new Error('a graph execution failed');
    if (outcome === 'paused' || this.pauseRequested) {
      this.state.resumePoint = this._buildResumePoint(this._graphSnapshot);
      return 'paused';
    }
    if (!this.state.endReached) {
      // state.warnings already carries the scheduler's text (_syncSchedulerState);
      // this is the run log + audit trail for it.
      this._log('orchestrator', 'warn', QUIESCENCE_WARNING);
      if (this.pipeline) await appendAudit(this.pipeline.dir, `Run **${QUIESCENCE_WARNING}**.`).catch(() => {});
    }
    return 'done';
  }

  /**
   * Serialize the run position into a JSON-safe resume-v2 point. The scheduler
   * snapshot IS the position; the manifest freezes the topology (resume never
   * re-reads the workflow row); everything else is the run identity a fresh
   * instance cannot rebuild from the pipelines row alone.
   */
  _buildResumePoint(snapshot) {
    return {
      version: 2,
      snapshot: snapshot ? jsonClone(snapshot) : null,
      manifest: this.state.stepper ? jsonClone(this.state.stepper) : null,
      // Observability + the resume audit line; the AUTHORITATIVE session map is
      // rebuilt from the persisted step rows (readPipelineForResume).
      nodes: (snapshot?.execs || []).map((e) => ({
        nodeId: e.nodeId,
        executionId: e.executionId,
        sessionId: e.sessionId || null,
        completed: e.status === 'done',
      })),
      planVersion: this._planVersion,
      stepModels: this.stepModels,
      workflowId: this.workflowId,
      guardrailsId: this.guardrailsId,
      checkpointRef: this.checkpointRef || null,
      checkpointRefs: { ...this.checkpointRefs },
      workspace: this.isWorkspace ? { projects: this._workspaceProjects() } : null,
      pauseReason: this.pauseReason || null,
      // The EFFECTIVE instruction at dispatch time (post in-worktree graph
      // build), not the detect-time tools.instruction.
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir,
      pausedAt: new Date().toISOString(),
    };
  }

  /** Per-member worktree facts the v1 point kept under rp.bus.workspace. */
  _workspaceProjects() {
    return this.members.map((m) => ({
      projectKey: m.projectKey,
      projectDir: m.projectDir,
      projectName: m.projectName,
      worktreeDir: this.workDirs.get(m.projectKey) || null,
      graphInstruction: this.toolInstructions.get(m.projectKey) || '',
    }));
  }
```

- [ ] **Step 2d: The scheduler event fan-out, the loop gate and the ask withdrawal**

```js
  /** Mirror the scheduler's derived counters onto state (the scheduler is the
   *  authority for deliveries/latches/gate; state is the transport). Defensive:
   *  a partially-built scheduler state degrades to the previous values. */
  _syncSchedulerState() {
    const s = this._scheduler ? this._scheduler.getState() : null;
    if (!s) return;
    // P3's getState(): { active, executions, tokens, wireDeliveries, ended,
    // endReached, result, warnings, gate, settled }.
    if (Array.isArray(s.active)) this.state.active = s.active.map((a) => ({ nodeId: a.nodeId, executionId: a.executionId }));
    if (s.wireDeliveries && typeof s.wireDeliveries === 'object') this.state.wireDeliveries = { ...s.wireDeliveries };
    if (Array.isArray(s.warnings)) this.state.warnings = [...s.warnings];
    if (s.endReached === true) { this.state.endReached = true; if (s.result) this.state.result = { ...s.result }; }
    if (s.tokens) {
      const t = {};
      for (const [slot, tok] of Object.entries(s.tokens)) {
        if (!tok) continue;
        t[slot] = { seq: tok.seq, type: tok.type, path: tok.path ?? null, firedAt: tok.firedAt ?? null };
      }
      this.state.tokens = t;
    }
    // s.gate is already the §5.7 shape ({wireId, fromNode, toNode, askId} | null).
    this.state.gate = s.gate ? { ...s.gate } : null;
  }

  /**
   * Fan the scheduler's events onto the orchestrator's event surface.
   * `exec` replaces v1's `phase` (an execution, not a step) and `token` is new;
   * `gate` is audit-only — the human-facing half is the `question` the ask
   * plumbing already emits (§5.7).
   */
  _onSchedulerEvent(name, payload) {
    if (name === 'token') {
      this._syncSchedulerState();
      this._emit('token', payload);
      return;
    }
    if (name === 'gate') {
      this._syncSchedulerState();
      if (payload.status !== 'held' && this.pipeline) {
        appendAudit(
          this.pipeline.dir,
          `Loop gate on wire ${payload.wireId} (${payload.nodeId}): the user chose **${payload.status}**.`,
        ).catch(() => {});
      }
      return;
    }
    if (name !== 'exec') return;
    const step = this.state.steps.find((s) => s.key === payload.executionId);
    this._syncSchedulerState();
    // The bound End payload is exec-only, and the step row IS the durable ledger
    // — without this History has no result to anchor the End card on.
    if (step && payload.result !== undefined) step.result = payload.result;
    if (payload.status === 'done' && payload.result !== undefined) {
      this.state.result = payload.result;
      this.state.endReached = true;
      // End arrival withdraws every pending gate in the scheduler; the QUEUED
      // question is the orchestrator's to dismiss, or the run blocks on an
      // answer nobody can give any more.
      this._dismissPendingAsk();
      // The End-bound path is a first-class artifact (the History artifact route
      // in P6 serves exactly what listArtifacts() carries).
      if (payload.result?.path) {
        this._artifact('result', payload.result.path, {
          nodeId: payload.nodeId, executionId: payload.executionId, port: null,
        });
      }
    }
    this._emit('exec', { ...payload, costUsd: step ? (step.costUsd || 0) : 0 });
  }

  /**
   * The scheduler's ask channel (P3 `onAsk`). A gate ask arrives as
   * `{ id:'gate-<wireId>-<deliveryNo>', kind:'gate', wireId, nodeId, executionId, issues }`
   * and is answered 'another' | 'continue'. It rides the SAME serialized ask
   * queue as recovery prompts and step questions, so only ONE prompt is ever
   * open, and answers arrive through the unchanged POST /api/answer {id} path
   * (the harness's _ask resolves a gate with `{decision}` — dev `_gate :2894`).
   * @param {{id:string, kind:string, wireId?:string, nodeId?:string, executionId?:string, issues?:Array, questions?:Array}} q
   * @returns {Promise<'another'|'continue'|any>}
   */
  async _schedulerAsk(q) {
    const payload = await this._enqueueAsk(() => this._ask(q));
    if (q.kind === 'gate') return payload?.decision === 'another' ? 'another' : 'continue';
    return payload;
  }

  /** Resolve the queued question, if any, without an answer. Used on End arrival:
   *  a gate ask resolves to `continue` (a no-op — the scheduler already withdrew
   *  it), and a clarify/questions ask resolves to EMPTY answers, which the
   *  clarifier's malformed/empty tolerance turns into a normal publish. */
  _dismissPendingAsk() {
    const pq = this.pendingQuestion;
    if (!pq) return false;
    this.pendingQuestion = null;
    this._log('orchestrator', 'info', `End reached — withdrawing pending ${pq.kind} "${pq.id}"`);
    pq.resolve(pq.kind === 'gate' ? { decision: 'continue' } : { answers: [] });
    return true;
  }
```

- [ ] **Step 2e: `_execute` — the ONE adapter** (order is normative, §5.4: cost gate → prime → attempts → once → questions → after)

```js
  // ── execution ──────────────────────────────────────────────────────────────
  /**
   * The scheduler's `execute`. Selection is node.kind, then meta.runnerType for
   * agents — never an agent key. Flow cards are instant, $0 and spawn nothing;
   * agent cards go through the full attempt/recovery/questions machinery, all of
   * it keyed by executionId.
   */
  async _execute(args) {
    const node = args.node;
    const nc = (this.resolved.nodeCtx || {})[node.id] || { nodeId: node.id, kind: node.kind, key: null };
    // The composite protocol: these three modes are the process side of a
    // fan-out — they spawn nothing, record no ledger row and allocate nothing,
    // so a composite shell never burns a plan version.
    if (args.composite === 'expand') return await this._expandDecomposition(node, args);
    if (args.composite === 'phase') return this._compositePhase(args);
    if (args.composite === 'finish') return await this._finishComposite(nc, args);

    const ctx = this._execCtx(node, nc, args);
    this._execStep(ctx, 'start');
    if (ctx.slice) updateTaskStatus(this.pipeline.id, ctx.slice.id, 'running', new Date().toISOString());
    let endMark = 'done';
    try {
      if (node.kind !== 'agent') return await this._runFlow(node, ctx, args);
      this._checkCostLimits();                  // budget gate at EVERY agent launch
      this._primeQuestions(nc, ctx);
      let result = await this._runNodeAttempts(nc, ctx);
      result = await this._questionsLoop(nc, ctx, result);
      await this._afterExecution(nc, ctx, result);
      return result;
    } catch (err) {
      if (isPause(err) || (this.pauseRequested && (isAbort(err) || this.pauseAbort.signal.aborted))) {
        // Settle QUIETLY: the persisted snapshot was frozen the moment pause()
        // was requested, so nothing this publishes can reach it, and the
        // scheduler is already halted — no downstream node can fire off it.
        endMark = 'paused';
        // P3 protocol: a paused execution answers { paused: true } — the scheduler
        // keeps its row NON-TERMINAL (nothing publishes) and reattach() re-invokes
        // it on resume. `{ outputs: {} }` would COMPLETE it and strand the resume.
        return { paused: true };
      }
      endMark = 'error';
      this._graphError ||= err;                 // preserve identity for the base catch
      this._logStepFailure(nc, ctx, err);
      // A sibling slice parked on an interactive recovery prompt is not
      // signal-reachable (_ask settles only via answer()/pause()/stop()), so a
      // genuine slice failure rejects that prompt exactly as v1's noteFailure
      // does (orchestrator.mjs:2265-2273) — the phase is failing and must not
      // wait on a now-meaningless human answer.
      if (ctx.slice && this.pendingQuestion?.kind === 'recovery') {
        const pq = this.pendingQuestion;
        this.pendingQuestion = null;
        const e = new Error('aborted');
        e.name = 'AbortError';
        pq.reject(e);
      }
      throw err;
    } finally {
      this._execStep(ctx, endMark);
      // A PAUSED slice stays 'running': the resume re-runs the whole composite,
      // and a task that never finished must not read as done.
      if (ctx.slice && endMark !== 'paused') {
        updateTaskStatus(this.pipeline.id, ctx.slice.id, endMark, new Date().toISOString());
      }
    }
  }

  /** The five flow cards. Engine-owned: instant, $0, no semaphore slot, no spawn. */
  async _runFlow(node, ctx, args) {
    const exec = FLOW_EXECUTORS[node.kind];
    if (typeof exec !== 'function') throw new Error(`no executor for node kind "${node.kind}"`);
    return await exec({
      ...args,
      runCtx: ctx.runCtx,
      taskArtifact: this._taskArtifact,
      allocatedPath: ctx.outputs?.out?.path,
      names: this._flowNames(node),
    });
  }

  /** Port id -> the source node's display name, for the Combine card's headings. */
  _flowNames(node) {
    const names = {};
    for (const wire of this.resolved.template.wires || []) {
      if (wire?.to?.node !== node.id) continue;
      const src = (this.resolved.nodeCtx || {})[wire.from.node] || {};
      names[wire.to.port] = src.meta?.displayName || src.key || wire.from.node;
    }
    return names;
  }

  /** Executor selection: node.kind, then meta.runnerType. An injected
   *  opts.runners[runnerType] wins — the tests' ONLY seam. */
  _executorFor(nc, node) {
    if (node.kind !== 'agent') return FLOW_EXECUTORS[node.kind];
    const type = nc.runnerType || 'producer';
    return this._runners[type] || AGENT_EXECUTORS[type] || runAgentExecution;
  }
```

- [ ] **Step 2f: `_execCtx` (the ONE ctx) and `_execStep` (the ledger row)**

```js
  /**
   * The per-execution context. This is the ONE ctx: it carries the phases.mjs
   * prompt fields (cwd, workspace, toolInstruction, agentPrompts, claudeOpts) AND
   * the graph fields the executors read (ports, meta, bindings, trigger, the
   * allocated outputs/verdict). Allocation happens HERE, once per execution, so a
   * questions resume or a recovery retry never burns a second plan version.
   */
  _execCtx(node, nc, args) {
    const executionId = args.executionId;
    const ordinal = args.ordinal || 1;
    const slice = args.slice || null;
    const ports = this.resolved.ports(node) || {};
    const runCtx = {
      pipelineDir: this.pipeline.dir,
      projectDir: this.projectDir,
      baseName: this.baseName,
      datePrefix: this.planDatePrefix,
      workspaceKey: this.workspaceKey || undefined,
      duplicateKey: !!nc.duplicateKey,
      // Composite slices share their parent's ordinal, so their run-store outputs
      // and verdict are additionally slice-prefixed (the executor's dupPrefix).
      slice: slice ? slice.id : undefined,
      planVersion: () => (this._planVersion += 1),
    };
    const outputs = allocateOutputs({ node, ports, executionId, ordinal, runCtx });
    const verdict = allocateVerdict({ node, ports, ordinal, runCtx });
    // attr.stepKey IS the executionId: that single substitution is what re-keys
    // the whole inherited telemetry block (sub_agents.step_key, step skills,
    // graphify counts, cost) onto executions. stepIndex is null — a graph has
    // executions, not step indexes.
    const attr = {
      nodeId: node.id,
      executionId,
      stepKey: executionId,
      stepIndex: null,
      cycle: ordinal,
      uiPhase: this._uiPhaseOf(node.id),
      model: nc.model || this.claude.model,
    };
    return {
      // Consumed as `cwd` by phases.mjs. runCwd is the run root on a detached
      // workspace run, the member worktree on a detached single run, today's
      // workDir under legacy.
      projectDir: this.runCwd || this.workDir,
      runRoot: this.runRoot,
      mcpConfigPath: this.mcpConfigPath,
      mcpServerGrants: this.mcpServerGrants,
      repos: this._reposCtx(),
      pipelineDir: this.pipeline.dir,
      pipelineId: this.pipeline.id,
      taskPrompt: this.pipeline.promptText,
      toolInstruction: this.toolInstruction,
      agentPrompts: this.agentPrompts,
      checkpointRef: this.checkpointRef,
      workspace: this.isWorkspace ? this._workspaceChannel() : undefined,
      // A composite slice ALSO honors the scheduler's signal, which folds in its
      // phase-local controller: a sibling's failure cancels it (v1's third
      // signal). An ordinary execution keeps today's two, so the fail-fast blast
      // radius is unchanged.
      signal: slice && args.signal
        ? AbortSignal.any([this.abort.signal, this.pauseAbort.signal, args.signal])
        : AbortSignal.any([this.abort.signal, this.pauseAbort.signal]),
      extras: this.extrasFiles || [],
      // ── graph ──
      node: {
        ...node,
        key: nc.key,
        fanOut: !!nc.fanOut,
        agentPrompt: nc.agentPrompt,
        tools: nc.tools,               // frontmatter grants MUST be stamped
        promptHints: nc.promptHints || '',
      },
      nodeId: node.id,
      executionId,
      ordinal,
      cycle: ordinal,
      slice,
      uiPhase: attr.uiPhase,
      bindings: args.bindings || {},
      trigger: args.trigger || { wireIds: [], freshPorts: [] },
      template: this.resolved.template,
      portsFn: this.resolved.ports,
      ports,
      meta: nc.meta || {},
      outputs,
      verdict,
      runCtx,
      resumeSessionId: this._takeResumeSession(executionId),
      ask: (q) => this._enqueueAsk(() => this._ask(q)),
      onEvent: (e) => this._onAgentEvent(nc.key || node.kind, e, attr),
      claudeOpts: {
        bin: this.claude.bin,
        permissionMode: this.claude.permissionMode,
        model: nc.model || this.claude.model,  // per-node, falling back to global
        effort: nc.effort,                     // per-node effort (undefined when unset)
        permissionRules: this.guardrailPermissionRules || undefined,
        envScrub: this.guardrails?.envScrub || undefined,
        envAllowlist: this.guardrails?.envScrub ? this.guardrails.envAllowlist : undefined,
        mock: this.claude.mock,
      },
    };
  }

  /** ONE-SHOT session re-attach: an executionId is consumed the first time it is
   *  asked for, so a recovery retry or a fix cycle never re-attaches a stale
   *  session. Composite slices re-run whole and are never in the map. */
  _takeResumeSession(executionId) {
    if (!this._resumeSessions?.has(executionId)) return undefined;
    const id = this._resumeSessions.get(executionId);
    this._resumeSessions.delete(executionId);
    return id;
  }

  /** The manifest node's uiPhase (the shim's phase vocabulary, and the label the
   *  sub-agent records carry). Flow cards report their kind. */
  _uiPhaseOf(nodeId) {
    const n = (this.state.stepper?.graph?.nodes || []).find((x) => x.id === nodeId);
    if (n?.uiPhase) return n.uiPhase;
    const nc = (this.resolved?.nodeCtx || {})[nodeId];
    return nc?.key || nc?.kind || nodeId;
  }
```

- [ ] **Step 2g: the ledger row, the attempt loop and the post-execution tail**

```js
  /**
   * Record/transition ONE execution's ledger row. state.steps[] IS the ledger:
   * key === executionId, phase = agentKey (the legacy column), cycle = ordinal.
   * On 'start' it does NOT pause sibling clocks (concurrent executions are
   * normal); on a terminal marker it folds just this execution's clock.
   */
  _execStep(ctx, status) {
    const key = ctx.executionId;
    const now = new Date().toISOString();
    const terminal = status === 'done' || status === 'error' || status === 'stopped' || status === 'paused';
    let step = this.state.steps.find((s) => s.key === key);
    if (!step) {
      step = {
        key,
        executionId: key,
        nodeId: ctx.nodeId,
        kind: ctx.slice ? 'task' : 'cycle',
        ordinal: ctx.ordinal,
        cycle: ctx.ordinal,                 // legacy alias the whole UI reads
        agentKey: ctx.node?.key ?? null,
        phase: ctx.node?.key ?? ctx.uiPhase, // legacy column
        stepIndex: null,                    // a graph has executions, not step indexes
        status,
        startedAt: now,
        updatedAt: now,
        endedAt: null,
        activeMs: 0,
        runningSince: null,
        // The firing trigger, taken from the execute args rather than the exec
        // 'start' event: the scheduler emits that event BEFORE it invokes, so the
        // row does not exist yet when the event lands. History labels a loop
        // re-fire `cycle 2 · fix` off this.
        trigger: ctx.trigger || { wireIds: [], freshPorts: [] },
        ...(ctx.slice
          ? { taskId: ctx.slice.id, parentExecutionId: ctx.parentExecutionId ?? null, title: ctx.slice.title ?? null, phaseOrdinal: ctx.slice.phase ?? null,
              taskIndex: ctx.taskIndex ?? null, taskTotal: ctx.taskTotal ?? null }
          : {}),
      };
      this.state.steps.push(step);
    } else {
      step.status = status;
      step.updatedAt = now;
    }
    if (terminal) step.endedAt = now;
    if (status === 'start') this._clockResume(key);
    else this._clockPause(key);
    this.state.totalActiveMs = sumStepActive(this.state.steps);
    // Coexistence shim: the scalars mirror the LAST-STARTED execution so every
    // unported v1 consumer keeps working. They die in P8.
    if (status === 'start') {
      this.state.phase = ctx.uiPhase;
      this.state.cycle = ctx.ordinal;
    }
    this.state.updatedAt = now;
    // Backstop: on a terminal marker force-close any sub-agent still 'running'
    // for THIS execution so the UI never shows a stuck-active square.
    if (terminal) {
      const closeTo = (this.state.status === 'stopped' || this.state.status === 'pausing') ? 'stopped' : 'finished';
      for (const rec of this.state.subAgents) {
        if (rec.stepKey !== key || rec.status !== 'running') continue;
        rec.status = closeTo;
        rec.finishedAt = new Date().toISOString();
        this._upsertSubAgent(rec);
        this._subAgentTransition('finish', rec);
      }
    }
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }

  /** The recoverable-error retry loop around ONE execution. The pause paths throw
   *  pauseErr() with pauseRequested already set (_pauseForLimit calls pause()),
   *  so _execute's catch reproduces the 'paused' mark. */
  async _runNodeAttempts(nc, ctx) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this._runOnce(nc, ctx);
      } catch (err) {
        if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) throw pauseErr();
        if (isAbort(err) || isPause(err)) throw err;
        const cls = classifyError(err);
        if (!cls) throw err;                    // not recoverable -> today's path
        if (cls === 'usage_limit') { this._pauseForLimit(nc, ctx, err); throw pauseErr(); }
        const decision = await this._recover({ node: { key: nc.key || ctx.nodeId }, cls, err, attempt });
        if (decision === 'abort') throw err;    // user/auto gave up -> fail as today
        this._execStep(ctx, 'start');           // back to running for the retry
      }
    }
  }

  /** One invocation of this execution's executor, with the vanished-session
   *  fresh re-run fallback (a dead `--resume` session must not fail the run). */
  async _runOnce(nc, ctx) {
    const runner = this._executorFor(nc, ctx.node);
    if (typeof runner !== 'function') throw new Error(`no executor for runner type "${nc.runnerType}"`);
    try {
      return await runner(ctx);
    } catch (err) {
      if (ctx.resumeSessionId && !isAbort(err) && !isPause(err) && !this.pauseRequested) {
        this._log(nc.key || ctx.nodeId, 'warn',
          `session resume failed (${err?.message || err}); re-running the execution fresh`,
          { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal, ...(err?.stream ? { stream: err.stream } : {}) });
        await appendAudit(this.pipeline.dir, `Resume fallback: ${ctx.executionId} re-ran fresh (session resume failed).`).catch(() => {});
        ctx.resumeSessionId = undefined;
        return await runner(ctx);
      }
      throw err;
    }
  }

  /** The ONE `error`-level line for a terminally failed execution. A pause/abort
   *  is not a failure, and a recoverable error that retried logged its own warn. */
  _logStepFailure(nc, ctx, err) {
    if (isAbort(err) || isPause(err)) return;
    this._log(nc.key || ctx.nodeId, 'error', `execution failed: ${clipMiddle(err?.message || err, 500)}`, {
      nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal,
      ...(err?.stream ? { stream: err.stream } : {}),
    });
  }

  /** A session/usage cap that only clears after a multi-hour reset: pause the run. */
  _pauseForLimit(nc, ctx, err) {
    const label = nc.key || ctx.nodeId;
    const reason = firstLine(err?.message || String(err));
    if (!this.pauseReason) this.pauseReason = reason;
    this._log(label, 'warn', `session/usage limit reached — pausing for manual resume: ${reason}`,
      { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal });
    appendAudit(this.pipeline.dir, `Pipeline **paused**: session/usage limit on ${label} — ${reason}. Resume after the reset.`).catch(() => {});
    this.pause();
  }

  /**
   * Everything between an agent returning and the scheduler publishing its tokens:
   *  - the verdict lands in the AUTHORITATIVE reviews table, keyed by the generic
   *    filename-derived kind (reviewKindOf strips `-cycle{n}.json`);
   *  - ONE `artifact` per DISTINCT allocated output path (the refiner's plan and
   *    revise ports resolve to the same file — that is one artifact, not two);
   *  - a `sideEffect: 'code'` node stages its working tree so the next node's
   *    `git diff` sees newly created files. A composite SLICE skips that: its
   *    phase-mates edit the same tree in parallel and the composite stages once
   *    after the last phase (_finishComposite).
   */
  async _afterExecution(nc, ctx, result) {
    if (this.pipeline && ctx.verdict?.path && result?.verdict) {
      await writeReview(this.pipeline.id, this._verdictKind(nc, ctx), ctx.ordinal, result.verdict);
    }
    const seen = new Set();
    for (const port of ctx.ports?.outputs || []) {
      const path = ctx.outputs?.[port?.id]?.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      this._artifact(port.artifactKind || port.id, path, {
        nodeId: ctx.nodeId, executionId: ctx.executionId, port: port.id,
      });
    }
    if (nc.meta?.sideEffect === 'code' && !ctx.slice) await this._stageWorkingTree();
  }

  /** reviews.kind, derived from the verdict FILENAME minus `-cycle{cycle}.json`
   *  (artifacts.mjs reviewKindOf) — `impl|plan|refine|ws|webui` for the builtins,
   *  `<stem>` for a custom agent. Zero agent-key coupling. */
  _verdictKind(nc, ctx) {
    const file = String(ctx.verdict?.path || '').split(/[\\/]/).pop() || '';
    return reviewKindOf(file.replace(`-cycle${ctx.ordinal}.json`, '')) || nc.key || ctx.nodeId;
  }
```

- [ ] **Step 2h: the ask-then-resume questions loop** (v1 `orchestrator.mjs:2489-2570` re-keyed by executionId; the file name follows §5.4, NOT the old branch's)

```js
  /**
   * Prime the ask-then-resume state for ONE execution. The prior-answer filter
   * stays NODE-scoped: keying it by executionId would re-ask every answered
   * question on the next fix cycle, because that cycle is a new execution.
   * Composite slices never gate the user (several run at once, so a question
   * from one would block its phase-mates behind a prompt nobody can attribute);
   * clarifier nodes have their own gate; auto mode would answer noise.
   */
  _primeQuestions(nc, ctx) {
    const enabled = !!nc.askQuestions && nc.runnerType !== 'clarifier' && !this.auto && !ctx.slice;
    ctx.questionsEnabled = enabled;
    if (!enabled) return;
    ctx.questionsAnswered = readStepQuestions(this.pipeline.id)
      .filter((r) => r.nodeId === ctx.nodeId)
      .flatMap((r) => r.answers);
    ctx.questionsFile = this._questionsPath(ctx.nodeId, ctx.ordinal, 1);
  }

  /**
   * Absolute per-round questions file inside the pipeline dir:
   *   questions-x-<nodeIdSafe>-c<ordinal>-r<round>.json
   * `nodeIdSafe` = the node id with every character outside [A-Za-z0-9_-]
   * replaced by `_`, so a hand-authored template id can never escape the dir.
   * (v1's name was questions-<stepIndex>-<nodeIdSafe>-c<cycle>-r<round>.json; no
   * dev test pins the orchestrator-built name.)
   */
  _questionsPath(nodeId, ordinal, round) {
    const nodeIdSafe = String(nodeId).replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.pipeline.dir, `questions-x-${nodeIdSafe}-c${ordinal}-r${round}.json`);
  }

  /**
   * Ask-then-resume rounds. After a successful execution: if the agent wrote this
   * round's questions file, persist the questions, gate the user (serialized —
   * single pendingQuestion slot), persist the answers BEFORE the resume spawns
   * (crash-safe), then resume the SAME session with the answers injected. The
   * resume goes through _runNodeAttempts, so recovery + the vanished-session
   * fresh re-run apply unchanged. Caps at MAX_QUESTION_ROUNDS; the final resume
   * carries no next-round file so the agent proceeds on assumptions.
   */
  async _questionsLoop(nc, ctx, firstResult) {
    let result = firstResult;
    if (!ctx.questionsEnabled) return result;
    const stepKey = ctx.executionId;           // step_questions.step_key = executionId
    const agentLabel = nc.meta?.displayName || nc.key || ctx.nodeId;
    const attr = { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal };
    for (let round = 1; round <= MAX_QUESTION_ROUNDS; round++) {
      const qPath = ctx.questionsFile;
      if (!qPath) break;
      const { questions, malformed } = await readQuestionsFile(qPath);
      if (!questions.length) {
        if (malformed) {
          await appendAudit(this.pipeline.dir, `${agentLabel}: questions file was malformed — proceeding without asking (round ${round}).`).catch(() => {});
        }
        break;
      }
      this._checkAbort();
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: nc.key, nodeId: ctx.nodeId, questions: { questions },
      });
      this._artifact('questions', qPath, { nodeId: ctx.nodeId, executionId: ctx.executionId, port: null });
      await appendAudit(this.pipeline.dir, `${agentLabel} asked ${questions.length} question(s) (round ${round}).`).catch(() => {});
      const payload = await this._enqueueAsk(() => this._ask({
        id: `questions-${stepKey}-r${round}`,
        kind: 'questions',
        questions,
        agent: agentLabel,
        nodeId: ctx.nodeId,
        executionId: ctx.executionId,
      }));
      this._checkAbort();
      const answers = normalizeClarifyAnswer(payload, questions);
      const byId = new Map(questions.map((q) => [q.id, q]));
      const enriched = answers.map((a) => ({ id: a.id, question: byId.get(a.id)?.question || '', choice: a.choice }));
      await writeStepQuestions(this.pipeline.id, stepKey, round, {
        agentKey: nc.key, nodeId: ctx.nodeId, answers: { answers: enriched },
      });
      await appendAudit(this.pipeline.dir, `${agentLabel}: ${enriched.length} answer(s) received (round ${round}).`).catch(() => {});
      // Consume the processed round file: the DB row is authoritative, and a
      // surviving file would re-gate the user on a crash/pause-resumed re-run.
      await rm(qPath, { force: true }).catch(() => {});
      const step = this.state.steps.find((s) => s.key === stepKey);
      if (step?.sessionId) ctx.resumeSessionId = step.sessionId;
      ctx.questionsAnswered = [...(ctx.questionsAnswered || []), ...enriched];
      ctx.questionsFile = round < MAX_QUESTION_ROUNDS
        ? this._questionsPath(ctx.nodeId, ctx.ordinal, round + 1)
        : null;
      this._log(agentLabel, 'debug', `resuming with ${enriched.length} answer(s) (round ${round})`, attr);
      result = await this._runNodeAttempts(nc, ctx);
    }
    return result;
  }
```

- [ ] **Step 2i: the three composite fan-out modes** (generic replacements for v1's `_persistDecomposition :2228` / `_runDecomposedImplement :2249` / `_runDecomposedTask :2349`; the synthetic `s_impl_p<P>_t<N>` node ids do NOT return)

```js
  /**
   * Composite mode `expand`: read the decomposition the bound token points at,
   * through the tolerant parse, and persist phases + tasks BEFORE any slice runs
   * — so the records exist even if the fan-out aborts mid-phase. Each task row is
   * stamped with the sub-EXECUTION id that will run it.
   *
   * An empty or malformed document is not an error: it warns and hands back zero
   * phases, which the scheduler turns into one ordinary unexpanded execution.
   */
  async _expandDecomposition(node, args) {
    const token = (args.bindings || {})[args.expandsPort];
    const { phases } = await readDecomposition(token?.path);
    const attr = { nodeId: node.id, executionId: args.executionId, cycle: args.ordinal || 1 };
    if (!phases.length) {
      this._log(node.id, 'warn',
        `no runnable phases in the decomposition bound to "${args.expandsPort}"`
        + `${token?.path ? ` (${token.path})` : ''} — running one normal execution instead`, attr);
      await appendAudit(this.pipeline.dir,
        `${node.id}: the decomposition on \`${args.expandsPort}\` carried no runnable phases — `
        + 'running one normal execution with that input unbound.').catch(() => {});
      return { phases: [] };
    }
    const resolved = phases.map((ph) => ({
      ordinal: ph.ordinal,
      tasks: ph.tasks.map((t) => ({
        ...t,
        nodeId: sliceExecutionId(args.executionId, t.id),
        path: isAbsolute(t.file || '') ? t.file : join(this.pipeline.dir, t.file || ''),
      })),
    }));
    writeDecomposition(this.pipeline.id, resolved);
    const count = resolved.reduce((n, ph) => n + ph.tasks.length, 0);
    await appendAudit(this.pipeline.dir,
      `${node.id}: expanded into ${resolved.length} phase(s), ${count} task(s).`).catch(() => {});
    return { phases: resolved };
  }

  /** Composite mode `phase`: the per-phase status plumbing plus its audit line. */
  _compositePhase(args) {
    updatePhaseStatus(this.pipeline.id, args.phase, args.phaseStatus, new Date().toISOString());
    if (args.phaseStatus === 'running') {
      appendAudit(this.pipeline.dir, `Phase ${args.phase}: task(s) starting.`).catch(() => {});
    } else if (args.phaseStatus === 'error') {
      appendAudit(this.pipeline.dir, `Phase ${args.phase}: a task failed — aborting the run.`).catch(() => {});
    }
    return {};
  }

  /**
   * Composite mode `finish`: the ONE publish. A `sideEffect: 'code'` consumer
   * stages its worktree HERE — after the last phase, never per slice — so the
   * next node's `git diff` sees every task's files at once and no two parallel
   * slices race for the git index lock.
   *
   * The returned outputs are deliberately EMPTY: a composite wrote no node-level
   * artifact (each slice wrote its own under slice-prefixed paths), so the node's
   * ports fire as pure sequencing tokens. For a void output — the live case,
   * `implementer.done` — that is byte-identical to an ordinary execution.
   */
  async _finishComposite(nc, args) {
    if (nc.meta?.sideEffect === 'code') await this._stageWorkingTree();
    const label = nc.meta?.displayName || nc.key || args.node.id;
    const n = Array.isArray(args.phases) ? args.phases.length : 0;
    return { summary: `${label}: composite execution complete (${n} phase(s)).`, outputs: {}, verdict: null };
  }
}
```

- [ ] **Step 3: Two finishing touches, then syntax-check.**
  1. In the Step 2f ctx object literal, add `parentExecutionId: args.parentExecutionId ?? null,`, `taskIndex: args.taskIndex ?? null,` and `taskTotal: args.taskTotal ?? null,` on the lines after `slice,` — the scheduler passes all three for a `kind:'task'` execution (P3 `runSlice` args) and `_execStep` writes them into the ledger row.
  2. `_engineRehydrate` (hook 4) is added by Task 6; until then only `run()` works on this class, which is exactly what this task's test exercises.
  3. `node --check src/core/graph/orchestrator.mjs`
  `Expected:` no output (syntax OK).

- [ ] **Step 4: Green** — `node --test test/orchestrator-graph.test.mjs`
  `Expected:` `# pass 1`, `# fail 0`. If the run finishes with `endReached:false`, the graph drained without an End token — read the emitted `token` events to find the port that never fired; do NOT weaken the assertion.

- [ ] **Step 5: Commit** — `worca: Node-graph v2 P4 — GraphOrchestrator + the _execute adapter`

---

### Task 4: Ledger persistence — the V23 columns write path

**Why (§5.9):** a live `state` snapshot and a DB-rehydrated one must be the SAME shape, or History renders a v2 run differently from Running. `state.steps[]` is the ledger, so `writeState` gains six `pipeline_steps` columns and `pipelines.outcome`, and `rowToState`/`stepRowToStep` read them back. `sub_agents.step_key` and `step_questions.step_key` are already TEXT (`db.mjs:354`, `:507`) and receive the executionId with `step_index` NULL — no DDL change.

**Files:** `src/core/artifacts.mjs` — `writeState :985`, `toPipelineRow :1295`, `stepRowToStep :1636`, `rowToState :1662`. `test/artifacts-exec-ledger.test.mjs` — NEW.

**Interfaces:** produces round-tripping of `{executionId, kind, ordinal, agentKey, endedAt, trigger, result, taskId, parentExecutionId, title, phaseOrdinal}` per step row and `{endReached, result, warnings, wireDeliveries, tokens}` per pipeline row.

- [ ] **Step 1: Write the failing test** — `test/artifacts-exec-ledger.test.mjs`

```js
// test/artifacts-exec-ledger.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeState, createPipeline, readPipelineByKey } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

useTempHome(after);

test('the execution ledger round-trips through pipeline_steps + pipelines.outcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-ledger-'));
  const p = await createPipeline(dir, { promptText: 'x', sourceType: 'prompt' });
  const live = {
    id: p.id, projectDir: dir, status: 'done', phase: 'implement', cycle: 2,
    engine: 2, endReached: true, result: { type: 'md', path: '/tmp/plan.md' },
    warnings: ['w1'], wireDeliveries: { w9: 2 },
    tokens: { 'n_impl.done': { seq: 7, type: 'void', path: null, firedAt: 't' } },
    steps: [{
      key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', kind: 'cycle',
      ordinal: 2, cycle: 2, agentKey: 'implementer', phase: 'implementer', stepIndex: null,
      status: 'done', startedAt: 'a', updatedAt: 'b', endedAt: 'c', activeMs: 10,
      runningSince: null, costUsd: 0.5, trigger: { wireIds: ['w9'], freshPorts: ['fix'] },
      result: null,
    }, {
      key: 'x:n_impl:2:p1t1', executionId: 'x:n_impl:2:p1t1', nodeId: 'n_impl', kind: 'task',
      ordinal: 2, cycle: 2, agentKey: 'implementer', phase: 'implementer', stepIndex: null,
      status: 'done', activeMs: 3, runningSince: null, costUsd: 0.1,
      trigger: { wireIds: [], freshPorts: [] },
      taskId: 't1', parentExecutionId: 'x:n_impl:2', title: 'Add schema', phaseOrdinal: 1,
    }],
    subAgents: [],
  };
  await writeState(p.dir, live);

  const back = readPipelineByKey(null, p.id) || (await import('../src/core/artifacts.mjs')).readPipelineState?.(p.id);
  const st = back && back.steps ? back : back?.state;
  const rows = (st || back).steps;
  const row = rows.find((r) => r.key === 'x:n_impl:2');
  assert.equal(row.executionId, 'x:n_impl:2');
  assert.equal(row.kind, 'cycle');
  assert.equal(row.ordinal, 2);
  assert.equal(row.agentKey, 'implementer');
  assert.equal(row.endedAt, 'c');
  assert.deepEqual(row.trigger, { wireIds: ['w9'], freshPorts: ['fix'] });
  assert.equal(row.stepIndex, undefined, 'v2 rows carry no stepIndex');
  const slice = rows.find((r) => r.key === 'x:n_impl:2:p1t1');
  assert.equal(slice.kind, 'task');
  assert.equal(slice.taskId, 't1');
  assert.equal(slice.parentExecutionId, 'x:n_impl:2');
  assert.equal(slice.title, 'Add schema');
  assert.equal(slice.phaseOrdinal, 1);
  const outcome = (st || back);
  assert.equal(outcome.endReached, true);
  assert.deepEqual(outcome.result, { type: 'md', path: '/tmp/plan.md' });
  assert.deepEqual(outcome.warnings, ['w1']);
  assert.deepEqual(outcome.wireDeliveries, { w9: 2 });
  assert.deepEqual(outcome.tokens, { 'n_impl.done': { seq: 7, type: 'void', path: null, firedAt: 't' } });
});
```

> Resolve the reader in Step 1 to whatever `artifacts.mjs` actually exports for "read one pipeline's state" (`readPipelineByKey(projectKey, id)` on dev, `:1918`) and simplify the two lines above accordingly — the ASSERTIONS are the contract, not the plumbing.

`Expected:` red — `AssertionError: undefined !== 'x:n_impl:2'` (`row.executionId`).

- [ ] **Step 2: Write the columns** — `src/core/artifacts.mjs`, inside `writeState` (`:1011-1030`), replace the step INSERT block:

```js
    getDb().prepare('DELETE FROM pipeline_steps WHERE pipeline_id = ?').run(id);
    const ins = getDb().prepare(`
      INSERT INTO pipeline_steps (pipeline_id, key, node_id, phase, step_index, cycle,
        status, started_at, updated_at, active_ms, running_since, cost_usd, session_id,
        skills, graphify_count,
        execution_id, exec_kind, agent_key, ended_at, exec_trigger, exec_result, exec_meta)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const st of Array.isArray(obj.steps) ? obj.steps : []) {
      // v2 rows: execution_id === key. v1 rows leave every exec_* column NULL, so
      // the readers below reproduce today's exact shape for a v1 pipeline.
      const meta = (st.taskId != null || st.parentExecutionId != null || st.title != null || st.phaseOrdinal != null)
        ? s({ taskId: st.taskId ?? null, parentExecutionId: st.parentExecutionId ?? null,
              title: st.title ?? null, phaseOrdinal: st.phaseOrdinal ?? null,
              taskIndex: st.taskIndex ?? null, taskTotal: st.taskTotal ?? null })
        : null;
      ins.run(
        id, st.key, st.nodeId ?? null, st.phase ?? null,
        st.stepIndex ?? null, st.cycle ?? null, st.status ?? null,
        st.startedAt ?? null, st.updatedAt ?? null,
        Number.isFinite(st.activeMs) ? st.activeMs : 0,
        st.runningSince == null ? null : String(st.runningSince),
        Number.isFinite(st.costUsd) ? st.costUsd : 0,
        st.sessionId ?? null,
        s(st.skills),
        Number.isFinite(st.graphifyCount) ? st.graphifyCount : null,
        st.executionId ?? null,
        st.kind ?? null,
        st.agentKey ?? null,
        st.endedAt ?? null,
        st.trigger === undefined ? null : s(st.trigger),
        st.result === undefined ? null : s(st.result),
        meta,
      );
    }
```

- [ ] **Step 3: `pipelines.outcome`** — in `toPipelineRow` (`:1295`), add to the returned object and to the UPSERT's column list / `VALUES` / `DO UPDATE SET` in `writeState` (`outcome=excluded.outcome`):

```js
    // §5.9 outcome: the derived run-level v2 facts, so a rehydrated state matches
    // a live one. NULL for a v1 run (nothing to say), so v1 rows are unchanged.
    outcome: (o.engine === 2 || o.endReached !== undefined)
      ? s({
          endReached: !!o.endReached,
          result: o.result ?? null,
          warnings: Array.isArray(o.warnings) ? o.warnings : [],
          wireDeliveries: o.wireDeliveries ?? {},
          tokens: o.tokens ?? {},
        })
      : null,
```

- [ ] **Step 4: Read them back** — `stepRowToStep` (`:1636`) gains, before `return step`:

```js
  if (r.execution_id != null) step.executionId = r.execution_id;
  if (r.exec_kind != null) step.kind = r.exec_kind;
  if (r.agent_key != null) step.agentKey = r.agent_key;
  if (r.ended_at != null) step.endedAt = r.ended_at;
  if (r.cycle != null) step.ordinal = r.cycle;          // `ordinal` is the v2 name; `cycle` is its alias
  if (r.exec_trigger != null) step.trigger = j(r.exec_trigger, { wireIds: [], freshPorts: [] });
  if (r.exec_result != null) step.result = j(r.exec_result, null);
  const em = r.exec_meta != null ? j(r.exec_meta, null) : null;
  if (em) {
    if (em.taskId != null) step.taskId = em.taskId;
    if (em.parentExecutionId != null) step.parentExecutionId = em.parentExecutionId;
    if (em.title != null) step.title = em.title;
    if (em.phaseOrdinal != null) step.phaseOrdinal = em.phaseOrdinal;
    if (em.taskIndex != null) step.taskIndex = em.taskIndex;
    if (em.taskTotal != null) step.taskTotal = em.taskTotal;
  }
```
and its `SELECT` in `rowToState` (`:1683`) gains `execution_id, exec_kind, agent_key, ended_at, exec_trigger, exec_result, exec_meta`.

- [ ] **Step 5: Spread `outcome` back** — in `rowToState`, after `subAgents: listSubAgents(row.id),`:

```js
  const outcome = j(row.outcome, null);
  if (outcome) {
    state.engine = 2;
    state.endReached = !!outcome.endReached;
    state.result = outcome.result ?? null;
    state.warnings = Array.isArray(outcome.warnings) ? outcome.warnings : [];
    state.wireDeliveries = outcome.wireDeliveries ?? {};
    state.tokens = outcome.tokens ?? {};
    state.active = [];        // nothing is in flight in a rehydrated snapshot
    state.gate = null;
  }
```
and add `outcome` to the `SELECT *`-free callers if any name columns explicitly (`grep -n "FROM pipelines" src/core/artifacts.mjs` — the resume/state readers use `SELECT *`; the History list query does not need it).

- [ ] **Step 6: Green** — `node --test test/artifacts-exec-ledger.test.mjs test/artifacts.test.mjs test/orchestrator-db-authoritative.test.mjs test/db.test.mjs test/api-history.test.mjs`
  `Expected:` `# fail 0`.

- [ ] **Step 7: Commit** — `worca: Node-graph v2 P4 — execution ledger persistence (V23 columns)`

---

### Task 5: The coexistence `phase` shim

**Why (§5.7):** `app.js` has no `stepper.version` check — `manifestFor :876`, `buildRunGraph :1071`, `locateInManifest`, `advanceRun`, `onPhase :1307`, CLI `phaseLabel :245`, `ask/follow.mjs:60` and `chat/command-router.mjs:184` render whatever cells exist and drive off `phase`. So a v2 run ALSO emits a derived `phase` after every `exec`, `state.phase/cycle` mirror the last-started execution (Task 3's `_execStep` already does this), and the manifest carries v1-shaped `steps`/`feedbacks` cells. Everything here dies in P8.

**Files:** `src/core/graph/orchestrator.mjs` (`_onSchedulerEvent`). `test/graph-phase-shim.test.mjs` — NEW.

**Interfaces:** produces a `phase` event `{ phase, cycle, status, nodeId }` per non-`skipped` `exec`; consumes `state.stepper.graph.nodes[].uiPhase` + `state.stepper.steps/feedbacks` from P2's `buildGraphManifest`.

- [ ] **Step 1: Write the failing test** — `test/graph-phase-shim.test.mjs`

```js
// test/graph-phase-shim.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

test('every exec is followed by a derived phase, and the manifest carries v1 shim cells', async () => {
  const dir = gitDir('shim');
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo', claude: { mock: true }, auto: true,
  });
  const seq = [];
  orch.on('exec', (e) => seq.push({ t: 'exec', status: e.status, nodeId: e.nodeId, ordinal: e.ordinal }));
  orch.on('phase', (p) => seq.push({ t: 'phase', ...p }));
  orch.on('state', () => seq.push({ t: 'state' }));

  await orch.run();

  const phases = seq.filter((e) => e.t === 'phase');
  assert.ok(phases.length > 0, 'the shim emitted phase events');
  // RULE 1: every phase is immediately preceded by an exec of the same status,
  // with no state event between them (order exec -> phase -> state).
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].t !== 'phase') continue;
    const prev = seq[i - 1];
    assert.equal(prev?.t, 'exec', `phase at ${i} must follow an exec, got ${prev?.t}`);
    assert.equal(prev.status, seq[i].status, 'status is 1:1');
    assert.equal(prev.nodeId, seq[i].nodeId, 'nodeId is carried through');
    assert.equal(prev.ordinal, seq[i].cycle, 'cycle === ordinal');
  }
  // RULE 2: a `skipped` exec emits NO phase.
  const skipped = seq.filter((e) => e.t === 'exec' && e.status === 'skipped');
  for (const s of skipped) {
    const i = seq.indexOf(s);
    assert.notEqual(seq[i + 1]?.t, 'phase', 'skipped executions emit no phase');
  }
  // RULE 3: phase vocabulary comes from the manifest node's uiPhase.
  const man = orch.getState().stepper;
  const uiPhases = new Set(man.graph.nodes.map((n) => n.uiPhase));
  for (const p of phases) assert.ok(uiPhases.has(p.phase), `unknown uiPhase "${p.phase}"`);
  assert.ok(uiPhases.has('plan') && uiPhases.has('implement'), 'builtin keys map through UI_PHASE');
  // RULE 4: the manifest carries the v1-shaped shim cells the untouched UI reads.
  assert.equal(man.version, 2);
  assert.equal(man.steps[0].kind, 'preflight');
  assert.equal(man.steps[man.steps.length - 1].kind, 'done');
  const agentCells = man.steps.filter((c) => c.kind === 'agents');
  assert.ok(agentCells.length >= 1);
  for (const cell of agentCells) {
    for (const n of cell.nodes) {
      for (const k of ['id', 'key', 'uiPhase', 'label', 'color', 'sub', 'cycles', 'model', 'effort']) {
        assert.ok(k in n, `shim cell node missing ${k}`);
      }
    }
  }
  assert.ok(Array.isArray(man.feedbacks));
  for (const f of man.feedbacks) {
    for (const k of ['id', 'from', 'to', 'maxCycles']) assert.ok(k in f, `feedback missing ${k}`);
    assert.equal(typeof f.from, 'string');
  }
  // RULE 5: state.phase/cycle mirror the LAST-STARTED execution.
  const lastStart = seq.filter((e) => e.t === 'exec' && e.status === 'start').pop();
  assert.equal(orch.getState().cycle, lastStart.ordinal);
});
```

`Expected:` red — `AssertionError: the shim emitted phase events` (`phases.length > 0` is false).

- [ ] **Step 2: Verify P2's manifest builder already produces the shim cells.**
  `node -e "import('./src/shared/graph/manifest.mjs').then(m=>{const t={id:'t',name:'T',version:2,nodes:[{id:'n_task',kind:'task',x:0,y:0,config:{}},{id:'n_end',kind:'end',x:300,y:0,config:{}}],wires:[{id:'w1',from:{node:'n_task',port:'task'},to:{node:'n_end',port:'result'}}]};const man=m.buildGraphManifest(t,{},{overlays:{nodes:{},wires:{}}});console.log(JSON.stringify(man.steps?.map(c=>c.kind)),Array.isArray(man.feedbacks));})"`
  `Expected:` `["preflight","agents","agents","done"] true`. If it prints `undefined false`, P2's builder is missing the shim half — **STOP and fix `src/shared/graph/manifest.mjs`** to append `steps` (a `{kind:'preflight'}` cell, one `{kind:'agents', nodes:[…]}` cell per condensation-topo rank of `loops.launchOrder`, a `{kind:'done'}` cell) and `feedbacks` (`loopWires.map(w => ({id: w.id, from: w.from.node, to: w.to.node, maxCycles}))`) exactly as this task's RULE 4 asserts; it is P2's contract, not a new invention.

- [ ] **Step 3: Emit the shim** — in `_onSchedulerEvent`, replace the final `this._emit('exec', …)` line with:

```js
    this._emit('exec', { ...payload, costUsd: step ? (step.costUsd || 0) : 0 });
    // ── coexistence shim (P4–P7, deleted in P8) ──
    // Every unported v1 consumer drives off `phase`. Derived, never authored:
    // the vocabulary is the manifest node's uiPhase (UI_PHASE[key] || key for
    // agents, the kind for flow cards), the cycle is the ordinal, and a task
    // slice reports its PARENT node/ordinal (the exec payload already does).
    // `skipped` has no v1 counterpart, so it emits nothing.
    if (payload.status !== 'skipped') {
      this._emit('phase', {
        phase: this._uiPhaseOf(payload.nodeId),
        cycle: payload.ordinal,
        status: payload.status,
        nodeId: payload.nodeId,
      });
    }
```

- [ ] **Step 4: Green** — `node --test test/graph-phase-shim.test.mjs test/orchestrator-graph.test.mjs`
  `Expected:` `# fail 0`.

- [ ] **Step 5: Mutation audit.** Delete the `if (payload.status !== 'skipped')` guard (emit unconditionally) → RULE 2 must fail. Change `cycle: payload.ordinal` to `cycle: 1` → RULE 1's `cycle === ordinal` must fail. Restore both.

- [ ] **Step 6: Commit** — `worca: Node-graph v2 P4 — derived phase shim for the untouched v1 UI`

---

### Task 6: Resume v2 — hook 4, the snapshot trail and the one-shot session re-attach

**Why (§5.6):** a v2 `resume()` **never re-reads the workflow row**. The persisted manifest freezes the topology and the scheduler snapshot freezes the position, so an archived, re-seeded or edited template — or a sidecar whose ports changed while the run sat paused — cannot break a resume. The live registry is consulted only for the *executor-side* meta (runner type, prompt body, frontmatter tools, filename/store per port) that the manifest deliberately does not carry.

**Files:** `src/core/graph/orchestrator.mjs` (hook 4 + `resolvedFromManifest`); `src/core/workflows.mjs` (`export` on `loadAgentFile :47`). `test/orchestrator-graph-resume.test.mjs` — NEW.

**Interfaces:**
- Produces: `_engineRehydrate(rp) → { checkpointRef, memberWorktrees, plan:null, audit }` (the base writes `audit`); `resolvedFromManifest(manifest, registry, agentsDir) → { template, ports, loops, nodes, wires, agentsByKey, agentKeys }` — the SAME shape `resolveGraph` returns, so `_adoptResolvedGraph` has one input contract.
- Consumes: `readPipelineForResume(pipelineId) :1268` → `{row, resumePoint, steps}` (steps carry `key` = executionId, `sessionId`, `status`).

- [ ] **Step 1: Preconditions.** `grep -n "rp.version" src/core/run-harness.mjs` must print NOTHING — P1 replaced the `rp.version !== 1` literal (`orchestrator.mjs:820`) with hook 4. If it prints a line, move that check into the subclasses now (`Orchestrator._engineRehydrate` keeps `!== 1`).

- [ ] **Step 2: Write the failing test** — `test/orchestrator-graph-resume.test.mjs`

```js
// test/orchestrator-graph-resume.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

/** A producer that emits a session id, asks for a pause, then hangs until aborted. */
function pausingOnce(getOrch, seen) {
  return async (ctx) => {
    ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.executionId}` });
    if (seen.paused) return { outputs: outsOf(ctx), verdict: null, summary: 'ok' };
    seen.paused = true;
    seen.executionId = ctx.executionId;
    queueMicrotask(() => getOrch().pause());
    return new Promise((_r, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

test('a v2 run pauses mid-execution and resumes from the frozen snapshot', async () => {
  const dir = gitDir('gresume');
  const seen = {};
  let orch;
  orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: pausingOnce(() => orch, seen), verifier: async (ctx) => ({ outputs: outsOf(ctx), verdict: { issues: [], summary: '' }, summary: '' }), clarifier: async (ctx) => ({ outputs: outsOf(ctx), verdict: null, summary: '' }) },
  });
  const first = await orch.run();
  assert.equal(first.status, 'paused');

  const saved = readPipelineForResume(orch.getState().id);
  const rp = saved.resumePoint;
  assert.equal(rp.version, 2);
  assert.ok(rp.manifest && rp.manifest.version === 2, 'the manifest is frozen into the point');
  assert.ok(rp.snapshot, 'a CLEAN scheduler snapshot was kept');
  // The paused execution must be NON-TERMINAL in the frozen snapshot.
  const frozen = rp.snapshot.execs.find((e) => e.executionId === seen.executionId);
  assert.ok(frozen && frozen.status !== 'done', 'the killed execution stays re-invokable');
  assert.equal(saved.steps.find((s) => s.key === seen.executionId).status, 'paused');

  // A stale row must not be consulted: break the alias source before resuming.
  const orch2 = createGraphOrchestrator({
    projectDir: dir, workflowId: 'nope_does_not_exist', auto: true, claude: { mock: true },
    resume: saved,
    runners: { producer: pausingOnce(() => orch2, seen), verifier: async (ctx) => ({ outputs: outsOf(ctx), verdict: { issues: [], summary: '' }, summary: '' }), clarifier: async (ctx) => ({ outputs: outsOf(ctx), verdict: null, summary: '' }) },
  });
  const second = await orch2.resume();
  assert.equal(second.status, 'done', 'resume never re-reads the workflow row');
  assert.equal(orch2.getState().stepper.version, 2);
});

test('resume refuses a v1 resume point', async () => {
  const dir = gitDir('gresume-v1');
  const orch = createGraphOrchestrator({
    projectDir: dir, claude: { mock: true },
    resume: { row: { id: 'p1', status: 'paused', archived_at: null, branch: null, workspace_meta: null }, resumePoint: { version: 1 }, steps: [] },
  });
  await assert.rejects(() => orch.resume(), /unsupported resume point version 1/);
});
```

`Expected:` red — `TypeError: this._engineRehydrate is not a function`.

- [ ] **Step 3: `export` `loadAgentFile`** in `src/core/workflows.mjs:47` — add the keyword, change nothing else. It returns `{ prompt, tools }` (body + frontmatter tool grants).

- [ ] **Step 4: Implement hook 4 + the manifest-driven resolve** (append to `src/core/graph/orchestrator.mjs`, inside the class for the method, at module scope for the function):

```js
  // ── hook 4: rehydrate ──────────────────────────────────────────────────────
  /**
   * Restore the v2 run position. The snapshot is authoritative and the workflow
   * ROW is never read: the frozen manifest supplies the topology + ports, the
   * live registry only the executor-side meta. Overlays are NOT refreshed —
   * re-reading them would let a config edit made while the run sat paused change
   * the model of an execution that is mid-flight in the snapshot.
   * @param {object} rp the parsed resume_point
   * @returns {{checkpointRef:string|null, memberWorktrees:Array, plan:null}}
   */
  _engineRehydrate(rp) {
    if (!rp || rp.version !== 2) throw new Error(`resume(): unsupported resume point version ${rp?.version}`);
    this._resumeSnapshot = rp.snapshot || null;
    this._graphSnapshot = rp.snapshot || null;
    this._planVersion = Number.isFinite(rp.planVersion) ? rp.planVersion : 0;
    this.pauseReason = null;
    const manifest = rp.manifest || this.state.stepper;
    if (!manifest || manifest.version !== 2) throw new Error('resume(): the v2 resume point carries no manifest');
    this.state.stepper = manifest;
    this._adoptResolvedGraph(resolvedFromManifest(manifest, this.registry, this.agentsDir));
    // §9.4, unchanged messages: the providing plugin may have been disabled or
    // uninstalled while this run sat paused.
    this._preflightAgentKeys(this.resolved.agentKeys);
    // One-shot session re-attach: only executions the pause left PAUSED. The map
    // is consumed entry-by-entry in _execCtx, so a fix cycle (a NEW executionId)
    // never re-attaches, and a composite slice re-runs whole.
    this._resumeSessions = new Map(
      (this.resumeOpts?.steps || [])
        .filter((s) => s.status === 'paused' && s.sessionId)
        .map((s) => [s.key, s.sessionId]),
    );
    return {
      checkpointRef: rp.checkpointRef ?? null,
      memberWorktrees: (rp.workspace?.projects || []).map((p) => ({
        projectKey: p.projectKey,
        worktreeDir: p.worktreeDir,
        graphInstruction: p.graphInstruction || '',
      })),
      plan: null,   // v2 has no frozen ExecutablePlan; the manifest is the topology
      // The base writes this line (P1 hook 4 contract); v1's is "from <kind> at step <n>".
      audit: `Pipeline **resumed** (graph snapshot at seq ${rp.snapshot?.seq ?? 0}).`,
    };
  }
}

/**
 * Rebuild a resolveGraph-shaped result from a PERSISTED manifest + the live
 * registry. The manifest is authoritative for topology, ports, per-node model/
 * effort/askQuestions/awaitAll and per-wire maxCycles; the registry supplies only
 * what a manifest deliberately omits (runnerType, prompt body, frontmatter tools,
 * per-port as/directive/filename/store/artifactKind, sideEffect, displayName).
 * @param {object} manifest a manifest v2
 * @param {Record<string,object>} registry loadAgentRegistry() output
 * @param {string} agentsDir
 * @returns {{template:object, ports:Function, nodeCtx:Record<string,object>}}
 */
export function resolvedFromManifest(manifest, registry, agentsDir) {
  const reg = registry && typeof registry === 'object' ? registry : {};
  const template = manifestTemplate(manifest);
  const manPorts = manifestPortsFn(manifest);
  const regPorts = registryPortsFn(reg);
  // Port IDENTITY (ids/types/loop/expands/when) comes from the snapshot so a
  // changed sidecar cannot break a resume; the per-port RENDERING fields ride
  // along from the registry when the id still exists there.
  const ports = (node) => {
    const snap = manPorts(node) || { inputs: [], outputs: [] };
    const live = regPorts(node) || { inputs: [], outputs: [] };
    const merge = (side) => (snap[side] || []).map((p) => {
      const l = (live[side] || []).find((x) => x.id === p.id);
      return l ? { ...l, ...p } : p;
    });
    return { ...snap, inputs: merge('inputs'), outputs: merge('outputs') };
  };
  const nodeCtx = {};
  const keyCounts = new Map();
  for (const mn of manifest.graph?.nodes || []) {
    if (mn.kind !== 'agent') {
      nodeCtx[mn.id] = { nodeId: mn.id, kind: mn.kind, key: null, config: { arity: mn.arity } };
      continue;
    }
    const meta = reg[mn.key] || {};
    keyCounts.set(mn.key, (keyCounts.get(mn.key) || 0) + 1);
    nodeCtx[mn.id] = {
      nodeId: mn.id, kind: 'agent', key: mn.key, authoredKey: mn.key, meta,
      runnerType: meta.runnerType || 'producer',
      agentFile: meta.agentFile ?? null,
      agentPrompt: '',        // filled by hydrateAgentPrompts below
      promptHints: typeof meta.promptHints === 'string' ? meta.promptHints : '',
      tools: [],              // filled below
      config: {},
      model: mn.model || undefined,
      effort: mn.effort || undefined,
      fanOut: !!mn.fanOut,
      askQuestions: !!mn.askQuestions,
      awaitAll: !!mn.awaitAll,
      duplicateKey: false,
    };
  }
  for (const nc of Object.values(nodeCtx)) {
    if (nc.kind === 'agent') nc.duplicateKey = (keyCounts.get(nc.key) || 0) > 1;
  }
  // Loop budgets and the registry slice, so the result has resolveGraph's shape.
  const wires = {};
  for (const w of manifest.graph?.wires || []) {
    if (w.loop) wires[w.id] = { maxCycles: Number.isInteger(w.maxCycles) && w.maxCycles >= 1 ? w.maxCycles : DEFAULT_MAX_CYCLES };
  }
  const agentsByKey = {};
  const agentKeys = new Set();
  for (const nc of Object.values(nodeCtx)) {
    if (nc.kind !== 'agent') continue;
    agentsByKey[nc.key] = nc.meta;
    agentKeys.add(nc.key);
  }
  return { template, ports, loops: classifyLoops(template, ports), nodes: nodeCtx, wires, agentsByKey, agentKeys };
}
```

- [ ] **Step 5: Hydrate the prompt bodies.** `resolvedFromManifest` is synchronous, so the bodies are filled in `_engineRehydrate` right after `_adoptResolvedGraph`, from the registry the base already loaded (`loadAgentFile` is awaited once per distinct key):

```js
    // (inside _engineRehydrate, after _adoptResolvedGraph)
    this._hydratePrompts = (async () => {
      const cache = new Map();
      for (const nc of Object.values(this.resolved.nodeCtx)) {
        if (nc.kind !== 'agent') continue;
        const meta = nc.meta || {};
        const ck = meta.agentPath || meta.agentFile || nc.key;
        if (!cache.has(ck)) cache.set(ck, await loadAgentFile(this.agentsDir, meta.agentFile ?? null, meta.agentPath ?? null));
        const { prompt, tools } = cache.get(ck);
        nc.agentPrompt = prompt;
        nc.tools = tools;
      }
    })();
```
and `_engineRun` awaits it first: `if (this._hydratePrompts) await this._hydratePrompts;` as its opening line. Import `loadAgentFile` from `'../workflows.mjs'`.

- [ ] **Step 6: Keep the resume-point trail fresh** — in `_engineRun`'s `onSnapshot` callback, after the `if (!this.pauseRequested) this._graphSnapshot = snap;` line add:
```js
        // Keep a resumable point on the row at all times: a crash-reconciled
        // ('interrupted') v2 run is then resumable from its last clean snapshot.
        // The base clears it on done and on stop.
        if (!this.pauseRequested) this.state.resumePoint = this._buildResumePoint(snap);
```
(no extra `_persist` — the next `_execStep` writes it.)

- [ ] **Step 7: Green** — `node --test test/orchestrator-graph-resume.test.mjs test/orchestrator-graph.test.mjs`
  `Expected:` `# fail 0`.

- [ ] **Step 8: Commit** — `worca: Node-graph v2 P4 — resume v2 from the frozen manifest + snapshot`

---

### Task 7: Dispatch — `createOrchestratorFor` routes v2, and the server speaks `exec`/`token`

**Files:** `src/core/engine-select.mjs`; `ui/server.mjs:251` (`EVENT_NAMES`), `:541` (`wireRun`), `:1062` + `:1150` + `:1203` (`POST /api/run`), `:1560` (`resumeRun`); `src/cli/worca-cc.mjs:809` (`cmdResume`), `:1526` (run). `test/api-run-engine-dispatch.test.mjs` — NEW; `test/cli-resume.test.mjs` — extended.

**Interfaces:** produces `async createOrchestratorFor(opts) → Orchestrator | GraphOrchestrator`; consumes `selectEngine({templateVersion, resumePointVersion})` (P1) and `assertRunnableWorkflow(id)` (P2b).

- [ ] **Step 1: Write the failing test** — `test/api-run-engine-dispatch.test.mjs`

```js
// test/api-run-engine-dispatch.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestratorFor, selectEngine } from '../src/core/engine-select.mjs';
import { GraphOrchestrator } from '../src/core/graph/orchestrator.mjs';

useTempHome(after);

test('selectEngine prefers the resume point, then the template version', () => {
  assert.equal(selectEngine({ templateVersion: 1, resumePointVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: 2, resumePointVersion: 1 }), 'v1');
  assert.equal(selectEngine({ templateVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: 1 }), 'v1');
  assert.equal(selectEngine({}), 'v1', 'unknown => the live engine');
});

test('createOrchestratorFor dispatches a v2 workflow id to the graph engine', async () => {
  const graph = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_default_v2', claude: { mock: true } });
  assert.ok(graph instanceof GraphOrchestrator, 'wf_default_v2 => GraphOrchestrator');
  assert.equal(graph.getState().engine, 2);

  const v1 = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true } });
  assert.ok(!(v1 instanceof GraphOrchestrator), 'wf_default => the v1 Orchestrator');
  assert.equal(v1.getState().engine, undefined);
});

test('createOrchestratorFor dispatches a v2 resume point to the graph engine', async () => {
  const o = await createOrchestratorFor({
    projectDir: process.cwd(), claude: { mock: true },
    resume: { row: { id: 'p', status: 'paused' }, resumePoint: { version: 2 }, steps: [] },
  });
  assert.ok(o instanceof GraphOrchestrator);
});
```

`Expected:` red — `AssertionError: wf_default_v2 => GraphOrchestrator` (`createOrchestratorFor` still returns the v1 class for everything).

- [ ] **Step 2: Route** — `src/core/engine-select.mjs`:

```js
import { createOrchestrator } from './orchestrator.mjs';
import { createGraphOrchestrator } from './graph/orchestrator.mjs';
import { readWorkflow } from './workflows.mjs';

/**
 * Which engine runs this pipeline. NO feature flag: the answer is data.
 * A RESUME is authoritative — a v1 point freezes an ExecutablePlan, a v2 point
 * freezes the graph snapshot, and neither can be replayed by the other engine.
 * @param {{templateVersion?:number, resumePointVersion?:number}} o
 * @returns {'v1'|'graph'}
 */
export function selectEngine({ templateVersion, resumePointVersion } = {}) {
  if (resumePointVersion != null) return Number(resumePointVersion) === 2 ? 'graph' : 'v1';
  return Number(templateVersion) === 2 ? 'graph' : 'v1';
}

/**
 * Build the orchestrator this run needs. Async: it may have to read the
 * workflow row. Pass `opts.template` when the caller already read it
 * (POST /api/run does, at ui/server.mjs:1062) to skip the second read.
 * @param {object} opts the orchestrator options (workflowId, resume, …)
 */
export async function createOrchestratorFor(opts = {}) {
  const resumePointVersion = opts.resume?.resumePoint?.version;
  let templateVersion;
  if (resumePointVersion == null) {
    const tpl = opts.template || (await readWorkflow(opts.workflowId || 'wf_default'));
    templateVersion = tpl?.version;
  }
  const { template, ...rest } = opts;   // `template` is a routing hint, not an orchestrator option
  return selectEngine({ templateVersion, resumePointVersion }) === 'graph'
    ? createGraphOrchestrator(rest)
    : createOrchestrator(rest);
}
```

- [ ] **Step 3: The five call sites.** Replace the `createOrchestrator` import with `createOrchestratorFor` in `ui/server.mjs:21` and `src/cli/worca-cc.mjs:18`, then:

  **(a) `ui/server.mjs:1061-1062`** — keep the row and let ARCHIVED speak for itself:
  ```js
    const workflowId =
      typeof body.workflowId === 'string' && body.workflowId.trim() ? body.workflowId.trim() : 'wf_default';
    let workflowRow;
    try {
      workflowRow = await assertRunnableWorkflow(workflowId);
    } catch (e) {
      // NOT_FOUND keeps today's wording; ARCHIVED carries the upgrade explanation.
      return badRequest(res, e.code === 'ARCHIVED' ? e.message : `unknown workflowId "${workflowId}"`);
    }
  ```
  (add `assertRunnableWorkflow` to the existing `from '../src/core/workflows.mjs'` import).

  **(b) `ui/server.mjs:1150`** (workspace) and **`:1203`** (single project) — `orch = createOrchestrator({` becomes `orch = await createOrchestratorFor({`, and each options object gains `template: workflowRow,` next to `workflowId,`.

  **(c) `ui/server.mjs:1560`** (`resumeRun`) — `const orch = createOrchestrator({` becomes `const orch = await createOrchestratorFor({` (the function is already `async`; the `resume: saved` option carries the routing version).

  **(d) `src/cli/worca-cc.mjs:1526`** (run) — `const orch = createOrchestrator({` becomes `const orch = await createOrchestratorFor({` (the enclosing function already `await import(...)`s).

  **(e) `src/cli/worca-cc.mjs:809`** (`cmdResume`) — same one-line change.

  Verify: `grep -n "createOrchestrator(" ui/server.mjs src/cli/worca-cc.mjs` prints NOTHING.

- [ ] **Step 4: The server speaks the two new events** — `ui/server.mjs:251`:
```js
// `exec` and `token` are the graph engine's (§5.7). `phase` stays for the v1
// engine AND for the v2 shim until the graph cut-over retires it.
const EVENT_NAMES = ['phase', 'exec', 'token', 'log', 'question', 'artifact', 'state', 'done', 'error', 'subagent', 'stepskills', 'stepgraphify', 'title'];
```
and `wireRun ≈:541`:
```js
      if (name === 'phase' || name === 'exec') {
        entry.status = 'running';
      }
```
`summarizeRuns :455` already passes `stepper` through — no change; confirm with `grep -n "stepper: r.orch" ui/server.mjs`.

- [ ] **Step 5: CLI resume of a v2 run** — append to `test/cli-resume.test.mjs` (mirror the file's existing helper style):

```js
test('cmdResume routes a v2 resume point to the graph engine', async () => {
  const { selectEngine } = await import('../src/core/engine-select.mjs');
  assert.equal(selectEngine({ resumePointVersion: 2 }), 'graph');
  // and the CLI no longer imports the v1 factory directly
  const src = await readFile(new URL('../src/cli/worca-cc.mjs', import.meta.url), 'utf8');
  assert.ok(/createOrchestratorFor/.test(src), 'CLI uses the engine-selecting factory');
  assert.ok(!/\bcreateOrchestrator\(/.test(src), 'CLI has no direct v1 construction left');
});
```

- [ ] **Step 6: Green** — `node --test test/api-run-engine-dispatch.test.mjs test/engine-select.test.mjs test/cli-resume.test.mjs test/api-run*.test.mjs test/server-pause-resume.test.mjs test/pause-resume-e2e.test.mjs`
  `Expected:` `# fail 0`.

- [ ] **Step 7: Commit** — `worca: Node-graph v2 P4 — dispatch v2 runs through createOrchestratorFor`

---

### Task 8: `test/orchestrator-graph.test.mjs` — the mock e2e suite

**Files:** `test/orchestrator-graph.test.mjs` — grown from Task 3's single test. No source changes are expected; any failure here is a real defect in Tasks 3–7.

- [ ] **Step 1: Seed the eight graphs into the store** (top of the file, after the imports):

```js
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { setSetting } from '../src/core/settings.mjs';

/** Persist the 7 seeds so readWorkflow can serve them (V24 does this for real
 *  in P8). wf_default rides its coexistence alias and is NOT written. */
async function seedGraphs() {
  for (const t of SEED_TEMPLATES) {
    await writeGraphWorkflow({ id: t.id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires });
  }
}
/** Every runnable graph id: the 7 saved seeds + the graph default's alias. */
const GRAPH_IDS = [...SEED_TEMPLATES.map((t) => t.id), 'wf_default_v2'];
```

- [ ] **Step 2: Add the suite** (each `test(...)` is one new passing test):

```js
test('every seed graph completes offline under WORCA_MOCK and binds its End card', async () => {
  await seedGraphs();
  assert.equal(GRAPH_IDS.length, 8, 'seven seeds + the graph default alias');
  for (const workflowId of GRAPH_IDS) {
    const dir = gitDir('seed');
    const orch = createGraphOrchestrator({
      projectDir: dir, workflowId, prompt: 'demo task', claude: { mock: true }, auto: true,
    });
    const res = await orch.run();
    const st = orch.getState();
    assert.equal(res.status, 'done', `${workflowId} finished`);
    assert.equal(st.endReached, true, `${workflowId} reached End`);
    assert.ok(st.result, `${workflowId} bound a result`);
    assert.deepEqual(st.warnings, [], `${workflowId} produced no quiescence warning`);
  }
});

test('the ledger is one row per execution, and every loop closes at ordinal 2', async () => {
  await seedGraphs();
  const dir = gitDir('ledger');
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_full', prompt: 'demo', claude: { mock: true }, auto: true,
  });
  await orch.run();
  const st = orch.getState();
  const keys = st.steps.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate ledger keys');
  // The mock verifier is blocking at ordinal 1 and clean at ordinal 2, so every
  // looped node runs EXACTLY twice — never a third time.
  const byNode = new Map();
  for (const s of st.steps.filter((x) => x.kind === 'cycle' && x.agentKey)) {
    byNode.set(s.nodeId, Math.max(byNode.get(s.nodeId) || 0, s.ordinal));
  }
  assert.ok([...byNode.values()].some((n) => n === 2), 'at least one node re-fired');
  assert.ok([...byNode.values()].every((n) => n <= 2), `a loop overran: ${JSON.stringify([...byNode])}`);
  // wireDeliveries never exceeds the wire's budget.
  const wires = new Map((st.stepper.graph.wires || []).map((w) => [w.id, w]));
  for (const [wireId, n] of Object.entries(st.wireDeliveries)) {
    const max = wires.get(wireId)?.maxCycles;
    if (max != null) assert.ok(n <= max, `${wireId} delivered ${n} > ${max}`);
  }
});

test('a loop gate asks with the POST /api/answer shape and "another" buys one more cycle', async () => {
  await seedGraphs();
  const dir = gitDir('gate');
  // Budget 1 => the FIRST delivery is already the would-be maxCycles-th.
  const tpl = SEED_TEMPLATES.find((t) => t.id === 'wf_quick-fix');
  const wires = tpl.wires.map((w) => ({ ...w, config: { ...(w.config || {}), maxCycles: 1 } }));
  await writeGraphWorkflow({ id: 'wf_gate_probe', name: 'Gate probe', domain: tpl.domain, nodes: tpl.nodes, wires });
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_gate_probe', prompt: 'demo', claude: { mock: true }, auto: false,
  });
  const gates = [];
  orch.on('question', (q) => {
    if (q.kind !== 'gate') return orch.answer(q.id, { answers: [] });
    gates.push(q);
    orch.answer(q.id, { decision: gates.length === 1 ? 'another' : 'continue' });
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  assert.ok(gates.length >= 1, 'the gate fired');
  const g = gates[0];
  assert.match(g.id, /^gate-[A-Za-z0-9_-]+-\d+$/, 'ask id is gate-<wireId>-<deliveryNo>');
  assert.equal(g.kind, 'gate');
  assert.ok(g.wireId, 'the gate names its wire');
  assert.ok(g.nodeId, 'the gate names the SOURCE node');
  assert.ok(Array.isArray(g.issues), 'the gate carries the blocking issues');
});
```

- [ ] **Step 3: Stop, End-result artifact and the per-launch cost cap** (three more tests in the same file):

```js
test('stop mid-run keeps the partial diff and leaves no resume point', async () => {
  await seedGraphs();
  const dir = gitDir('gstop');
  let orch;
  orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => {
        // Write a real file so the staged partial diff is non-empty, then stop.
        await (await import('node:fs/promises')).writeFile(join(ctx.projectDir, 'touched.txt'), 'x');
        queueMicrotask(() => orch.stop());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
      verifier: async () => ({ outputs: {}, verdict: { issues: [], summary: '' } }),
      clarifier: async () => ({ outputs: {}, verdict: null }),
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
  assert.equal(orch.getState().resumePoint, null, 'a stopped run is not resumable');
  const saved = readPipelineForResume(orch.getState().id);
  assert.equal(saved.row.status, 'stopped');
  assert.equal(saved.resumePoint, null);
  // In-flight rows are stamped `stopped` by the harness, never by an exec event.
  assert.ok(saved.steps.some((s) => s.status === 'stopped' || s.status === 'error'));
});

test('the End-bound result is recorded as an artifact', async () => {
  await seedGraphs();
  const dir = gitDir('gend');
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo', claude: { mock: true }, auto: true,
  });
  const arts = [];
  orch.on('artifact', (a) => arts.push(a));
  await orch.run();
  const st = orch.getState();
  if (st.result?.path) {
    const hit = arts.find((a) => a.path === st.result.path);
    assert.ok(hit, 'the End-bound path was recordArtifact-ed');
    assert.ok(hit.nodeId, 'the artifact event carries its node attribution');
    assert.ok(hit.executionId, 'the artifact event carries its execution attribution');
  } else {
    assert.equal(st.result.type, 'void', 'a void End binds no path');
  }
});

test('the pipeline cost cap is enforced at EVERY agent launch, not per step', async () => {
  await seedGraphs();
  const dir = gitDir('gcost');
  await setSetting('pipelineCostLimitUsd', 0.05);
  let launches = 0;
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => { launches += 1; ctx.onEvent({ type: 'result', costUsd: 0.04, raw: { type: 'result', total_cost_usd: 0.04 } }); return { outputs: {}, verdict: null }; },
      verifier: async (ctx) => { launches += 1; ctx.onEvent({ type: 'result', costUsd: 0.04, raw: { type: 'result', total_cost_usd: 0.04 } }); return { outputs: {}, verdict: { issues: [], summary: '' } }; },
      clarifier: async (ctx) => { launches += 1; return { outputs: {}, verdict: null }; },
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(orch.getState().pauseReason ?? orch.pauseReason, 'cost_pipeline');
  assert.ok(launches >= 2 && launches <= 3, `capped after the spend crossed 0.05, saw ${launches} launches`);
  await setSetting('pipelineCostLimitUsd', null);
});
```

> `setSetting` must match `src/core/settings.mjs`'s real writer (`grep -n "^export" src/core/settings.mjs` — use whatever sets `pipelineCostLimitUsd`, or write the settings file directly as `test/orchestrator-*` cost tests already do; copy that file's approach rather than inventing one).

- [ ] **Step 4: Green** — `node --test test/orchestrator-graph.test.mjs`
  `Expected:` `# pass 7`, `# fail 0` (Task 3's test + the six added here).

- [ ] **Step 5: Commit** — `worca: Node-graph v2 P4 — mock e2e suite for the graph engine`

---

### Task 9: Parametrize the harness suites over both engines

**Why:** the harness is now shared, so a harness fix must be proved on BOTH engines. Six suites are engine-agnostic by construction (they inject `runners` and assert on `state`/the DB, never on `steps`): `orchestrator-heartbeat`, `-partial-diff`, `-pause`, `-resume`, `-session-capture`, `-guardrails`.

**Files:** `test/helpers/engines.mjs` — NEW; the six suites above — modified.

- [ ] **Step 1: Write the helper** — `test/helpers/engines.mjs`

```js
// test/helpers/engines.mjs
// One test body, two engines. The v1 stub-runner ABI ({status, issues, review,
// summary}) is adapted to the v2 executor ABI ({outputs, verdict, summary}) so a
// suite's runners do not have to be written twice.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createOrchestrator } from '../../src/core/orchestrator.mjs';
import { createGraphOrchestrator } from '../../src/core/graph/orchestrator.mjs';

/** Wrap a v1-shaped stub so the graph executor contract is satisfied: every
 *  declared non-void output gets a real file at its ALLOCATED path (downstream
 *  nodes bind paths, not values) and the verdict rides `verdict`. A stub that
 *  already returns `outputs` is passed through untouched, and a stub that hangs
 *  or rejects still hangs or rejects — the pause/stop suites depend on that. */
export function adaptRunner(fn) {
  return async (ctx) => {
    const r = await fn(ctx);
    if (r && r.outputs) return r;
    const outputs = {};
    for (const p of ctx.ports?.outputs || []) {
      const path = ctx.outputs?.[p.id]?.path ?? null;
      if (path && p.type !== 'void') {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, p.type === 'json' ? '{"ok":true}\n' : `# ${p.id}\n`, 'utf8');
      }
      outputs[p.id] = { path, type: p.type };
    }
    const verdict = r?.review
      ?? (r?.status === 'blocked'
        ? { issues: (r.issues || [{ severity: 'major' }]), summary: r.summary || '' }
        : (ctx.verdict ? { issues: [], summary: '' } : null));
    return { outputs, verdict, summary: r?.summary || '' };
  };
}

/** The two engines, in the shape a suite loops over. */
export const ENGINES = [
  {
    id: 'v1',
    workflowId: 'wf_default',
    create: (opts) => createOrchestrator(opts),
  },
  {
    id: 'graph',
    workflowId: 'wf_default_v2',
    create: (opts) => createGraphOrchestrator({
      ...opts,
      workflowId: opts.workflowId && opts.workflowId !== 'wf_default' ? opts.workflowId : 'wf_default_v2',
      runners: Object.fromEntries(Object.entries(opts.runners || {}).map(([k, fn]) => [k, adaptRunner(fn)])),
    }),
  },
];
```

- [ ] **Step 2: The parametrization pattern** (apply to each of the six files). Wrap the file's `test(...)` calls, leaving every assertion untouched:

```js
// at the top, replacing `import { createOrchestrator } from '../src/core/orchestrator.mjs';`
import { ENGINES } from './helpers/engines.mjs';

for (const engine of ENGINES) {
  // …the file's existing test(...) blocks, with:
  //   * the test NAME prefixed: test(`[${engine.id}] <original name>`, …)
  //   * every `createOrchestrator({ … })` call replaced by `engine.create({ … })`
  //   * every literal `workflowId: 'wf_default'` (if present) replaced by `workflowId: engine.workflowId`
}
```

- [ ] **Step 3: Per-file notes.**
  - `test/orchestrator-heartbeat.test.mjs` (2 tests) — plain wrap.
  - `test/orchestrator-partial-diff.test.mjs` (10 tests) — plain wrap; the stub producers that write files already return v1 shapes, so `adaptRunner` allocates the outputs for them.
  - `test/orchestrator-pause.test.mjs` (4 tests) — plain wrap. The pausing producer's returned Promise never settles until abort; `adaptRunner` awaits it, so the rejection identity is preserved.
  - `test/orchestrator-resume.test.mjs` (2 tests) — plain wrap; the graph leg re-enters through `_engineRehydrate`.
  - `test/orchestrator-session-capture.test.mjs` — plain wrap. Assertions that key a step by `'<stepIndex>:<nodeId>'` must instead find the row by `nodeId`: `const step = st.steps.find((s) => s.nodeId === <id> );` — the KEY differs per engine, the nodeId does not. If a test hard-codes a v1 node id (`s0_0`), select by `agentKey`/`phase` instead (`s.phase === 'planner'`), which both engines fill.
  - `test/orchestrator-guardrails.test.mjs` — plain wrap; guardrails ride `claudeOpts`, which both `_nodeCtx` and `_execCtx` build identically.

- [ ] **Step 4: Green** — `node --test test/orchestrator-heartbeat.test.mjs test/orchestrator-partial-diff.test.mjs test/orchestrator-pause.test.mjs test/orchestrator-resume.test.mjs test/orchestrator-session-capture.test.mjs test/orchestrator-guardrails.test.mjs`
  `Expected:` every original test now runs twice — the printed `# pass` is exactly double the pre-change count for these six files, `# fail 0`. Record the delta; Task 11 needs it.

- [ ] **Step 5: Commit** — `worca: Node-graph v2 P4 — harness suites run on both engines`

---

### Task 10: `test/saved-pipeline-parity.test.mjs` — dual-engine parity on the eight graphs

**Why (A1–A4 are parity-mandatory):** the graph engine must reproduce the v1 trace of the same pipeline. This runs each shape on the LIVE v1 engine (from P3's hand-written v1 fixtures + `DEFAULT_WORKFLOW`) and on v2, under the SAME mock verdict script — `WORCA_MOCK`'s verifier mocks are blocking at cycle 1 and clean at cycle 2 on both engines, so both traces close every loop at cycle/ordinal 2.

**Files:** `test/saved-pipeline-parity.test.mjs` — NEW. No source changes.

**Normalization (this IS the contract — do not loosen it):**
| dimension | v1 projection | v2 projection |
|---|---|---|
| agent execution order | `state.steps[]` in insertion order, keep rows with a `nodeId`, drop the `preflight`/`done` bookends, project to `` `${s.phase}#${s.cycle}` `` | same, keep rows with `agentKey != null` (flow cards have none, and v1 has no flow cards), project to `` `${s.agentKey}#${s.ordinal}` `` |
| produced files | `listArtifacts(pipelineId)` → `rel` values, minus the kinds `pipeline`, `run-log`, `questions`, `clarify`, `decomposition`, `result` → sorted | identical projection |
| gate prompts | `question` events with `kind === 'gate'`, project to `` `${FB_WIRE_MAP[wfId][fbIdOf(q.id)]}#${cycleOf(q.id)}` `` | project to `` `${q.wireId}#${deliveryNoOf(q.id)}` `` |
| budgets | max `cycle` per agent key | max `ordinal` per agent key |

- [ ] **Step 1: Write the suite**

```js
// test/saved-pipeline-parity.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';
import { writeWorkflow, writeGraphWorkflow, DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';
import { listArtifacts } from '../src/core/artifacts.mjs';

useTempHome(after);

const SKIP_KINDS = new Set(['pipeline', 'run-log', 'questions', 'clarify', 'decomposition', 'result']);

const order1 = (st) => st.steps.filter((s) => s.nodeId && s.key !== 'preflight' && s.key !== 'done')
  .map((s) => `${s.phase}#${s.cycle}`);
const order2 = (st) => st.steps.filter((s) => s.agentKey != null).map((s) => `${s.agentKey}#${s.ordinal}`);
const files = (id) => listArtifacts(id).filter((a) => !SKIP_KINDS.has(a.kind)).map((a) => a.rel).sort();
const budgets = (pairs) => {
  const m = {};
  for (const p of pairs) { const [k, c] = p.split('#'); m[k] = Math.max(m[k] || 0, Number(c)); }
  return m;
};

/** v1 gate id is `gate-<fbId>-<cycle>`; v2's is `gate-<wireId>-<deliveryNo>`. */
const gates1 = (qs, wfId) => qs.map((q) => {
  const m = /^gate-(.+)-(\d+)$/.exec(q.id);
  return `${(FB_WIRE_MAP[wfId] || {})[m[1]] || m[1]}#${m[2]}`;
});
const gates2 = (qs) => qs.map((q) => {
  const m = /^gate-(.+)-(\d+)$/.exec(q.id);
  return `${q.wireId || m[1]}#${m[2]}`;
});

async function drive(orch) {
  const gateQs = [];
  orch.on('question', (q) => {
    if (q.kind === 'gate') gateQs.push(q);
    orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] });
  });
  const res = await orch.run();
  return { res, st: orch.getState(), gateQs };
}

const CASES = [
  ...SEED_TEMPLATES.map((t) => ({ id: t.id, graph: t })),
  { id: 'wf_default', graph: null },   // rides the coexistence alias on v2
];

for (const c of CASES) {
  test(`parity: ${c.id} traces identically on both engines`, async () => {
    // ── v1 leg ──
    const v1Tpl = c.graph
      ? JSON.parse(await readFile(new URL(`./fixtures/workflows-v1/${c.id}.json`, import.meta.url), 'utf8'))
      : DEFAULT_WORKFLOW;
    if (c.graph) await writeWorkflow(v1Tpl);
    const a = await drive(createOrchestrator({
      projectDir: gitDir(`${c.id}-v1`), workflowId: v1Tpl.id, prompt: 'parity probe',
      claude: { mock: true }, auto: false,
    }));

    // ── v2 leg ──
    if (c.graph) await writeGraphWorkflow({ id: `${c.id}__g`, name: c.graph.name, domain: c.graph.domain, nodes: c.graph.nodes, wires: c.graph.wires });
    const b = await drive(createGraphOrchestrator({
      projectDir: gitDir(`${c.id}-v2`), workflowId: c.graph ? `${c.id}__g` : 'wf_default_v2',
      prompt: 'parity probe', claude: { mock: true }, auto: false,
    }));

    assert.equal(a.res.status, 'done', 'v1 leg completed');
    assert.equal(b.res.status, 'done', 'v2 leg completed');
    const o1 = order1(a.st); const o2 = order2(b.st);
    assert.deepEqual(o2, o1, `agent execution order diverged for ${c.id}`);
    assert.deepEqual(budgets(o2), budgets(o1), `loop budgets diverged for ${c.id}`);
    assert.deepEqual(files(b.st.id), files(a.st.id), `produced files diverged for ${c.id}`);
    assert.deepEqual(gates2(b.gateQs), gates1(a.gateQs, c.id), `gate prompts diverged for ${c.id}`);
  });
}
```

- [ ] **Step 2: Green** — `node --test test/saved-pipeline-parity.test.mjs`
  `Expected:` `# pass 8`, `# fail 0`. Divergences are REAL defects: fix the engine, never the normalization. Two known-legitimate differences the projections already absorb — v2's flow-card ledger rows (dropped by `agentKey != null`) and v2's `result` artifact kind (in `SKIP_KINDS`). Anything else — a missing agent execution, an extra loop cycle, a differently-named plan file — is a bug in P3/P4.

- [ ] **Step 3: Commit** — `worca: Node-graph v2 P4 — dual-engine parity suite`

---

### Task 11: Full suite, verification checklist, handoff

**Files:** none (verification only).

- [ ] **Step 1: Full suite** — `npm test 2>&1 | tail -5`
  `Expected:` `# fail 0`, with a total of **BASELINE + 28 + D**, where 28 = the fixed new tests of this plan (3 harness-attr + 2 alias + 7 orchestrator-graph + 1 ledger + 1 shim + 2 graph-resume + 3 dispatch + 1 cli-resume + 8 parity) and **D** is the duplicated-harness delta recorded in Task 9 Step 4 (each of the six parametrized suites runs its tests twice). If the total is lower, a suite silently skipped; if higher, a suite double-registered — investigate before committing.

- [ ] **Step 2: Regression spot-checks that MUST be green and untouched in behaviour:**
  ```sh
  node --test test/orchestrator-stepper-timing.test.mjs   # manifest precedes the first phase event on BOTH engines
  node --test test/dispatcher.test.mjs test/orchestrator-questions.test.mjs test/orchestrator-decompose.test.mjs
  node --test test/pause-resume-e2e.test.mjs test/server-pause-resume.test.mjs
  node --test test/workflows.test.mjs test/workflows-db.test.mjs test/api-workflows.test.mjs
  node --test test/ask-catalog.test.mjs test/ask-proposal.test.mjs
  ```

- [ ] **Step 3: Offline CLI dogfood (exits; no server, no browser).** In a scratch git repo:
  ```sh
  D=$(mktemp -d) && git -C "$D" init -q && git -C "$D" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  WORCA_HOME=$(mktemp -d) WORCA_MOCK=1 timeout 300 node src/cli/worca-cc.mjs run --project "$D" --prompt "smoke" --workflow wf_default_v2 --auto --mock
  ```
  `Expected:` exit code 0 and a `Pipeline complete.` summary. The CLI still renders `phase`-derived lines (P6 replaces them with `exec` lines) — that is the shim working. A `worca: unknown workflowId` means Task 2's alias did not land; a mid-run `template is a graph — runs on the graph engine` means Task 7's dispatch did not land.

- [ ] **Step 4: Manual verification checklist (record PASS/FAIL for each).**
  1. `readWorkflow('wf_default_v2').name === 'Default (graph)'` and `readWorkflow('wf_default').version === 1`.
  2. `GET /api/workflows` order is v1 default → "Default (graph)" → saved rows (asserted by `test/api-workflows-graph-alias.test.mjs`).
  3. A v2 run's `state` carries `engine:2`, `endReached`, `result`, `warnings`, `wireDeliveries`, `tokens`, `gate`, and `steps[].key === steps[].executionId`.
  4. Every `phase` event on a v2 run is preceded by an `exec` of the same status; `skipped` emits none.
  5. A paused v2 run's `resume_point.version === 2` and carries a non-null `manifest`; resuming with a bogus `workflowId` still completes.
  6. `grep -rn "createOrchestrator(" ui/server.mjs src/cli/worca-cc.mjs` prints nothing.
  7. `git diff --stat dev -- src/core/orchestrator.mjs` shows ONLY deletions (the Task 1 move) — no behavioural edit to the v1 class.
  8. `git status --short` shows nothing under `docs/superpowers/`.

- [ ] **Step 5: Commit** — `worca: Node-graph v2 P4 — full suite green`

- [ ] **Step 6: Handoff.** This plan is `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P4-graph-orchestrator-dispatch.md`. **Sentinels produced for P5:** `export function createGraphOrchestrator` in `src/core/graph/orchestrator.mjs`, and `readWorkflow('wf_default_v2')` returning `{...GRAPH_DEFAULT_WORKFLOW, id:'wf_default_v2', name:'Default (graph)'}`. P5 (Composer v2) can now render and SAVE v2 templates that this engine runs; the run-setup picker's "Default (graph)" entry is already served.

---

## Clarifications (Q&A)

- **D1** — How does v2 land? → **New plan + new implementation on top of dev; 8 sequential plans, each leaving `npm test` green and dev shippable; the v1 engine stays live until P8 (user decision 2026-08-26).**
- **D8a** — Which default does a v2 run use during coexistence? → **`GRAPH_DEFAULT_WORKFLOW` keeps its FINAL id `wf_default` in code but is SERVED under the alias `wf_default_v2`, listed as "Default (graph)" from P4; V24 remaps every alias reference (user decision 2026-08-26, adj-a §2).**
- **E1** — Is there a feature flag? → **No. The engine is chosen from data: the resume point's version first, else the template row's version (spec §5.2; adjudication adj-a §2).**
- **E2** — Where does the execution ledger live? → **`state.steps[]` IS the ledger — one row per execution, `key === executionId`, `phase = agentKey`, `cycle = ordinal`. No separate `executions[]` (spec §5.7; adj-a §1, adj-d §2).**
- **E3** — Does `pipeline_steps.execution_id` matter to readers? → **No. Every reader keys on `key`; the column exists for gap-healing the old-branch residue and ad-hoc SQL (spec §5.9).**
- **E4** — How does the untouched v1 UI render a v2 run? → **A derived `phase` event after every `exec` (`uiPhase` from the manifest node, `cycle = ordinal`, `skipped` emits none), `state.phase/cycle` = last-started execution, and v1-shaped `steps`/`feedbacks` shim cells inside manifest v2. All of it dies in P8 (spec §5.7).**
- **E5** — Does a v2 resume re-read the workflow row? → **Never. The frozen `rp.manifest` supplies the topology and ports, `rp.snapshot` the position; only the live registry is consulted, for executor-side meta (spec §5.6, §15).**
- **E6** — When is the cost cap checked? → **At EVERY agent launch, not per step. This is deliberately stricter than v1's per-step boundary check (spec §5.4).**
- **E7** — What happens on a pause inside an execution (composite slice included)? → **`_execute` returns `{ paused: true }` (P3's execute protocol — the scheduler keeps the row NON-TERMINAL and re-invokes it on resume), the ledger row is marked `paused`, and the `pipeline_tasks` row stays `running` — the resume re-runs the whole composite (spec §5.6 "executions marked paused, non-terminal"; dev 885fb013; the `{outputs:{}}` literal in spec §5.4 would complete the execution and strand the resume — agent adjudication, cross-plan pass 2026-08-27).**
- **E8** — Which `attr` key re-attributes the whole telemetry block? → **`attr.stepKey = executionId`, with `stepIndex: null`. `_onAgentEvent` and the sub-agent/skills/graphify reducers are otherwise untouched (spec §5.1 SHARED-BUT-SHAPE-CHANGES; dev `orchestrator.mjs:3087`).**
- **E9** — May `old:src/core/orchestrator.mjs` be copied wholesale? → **No (spec §16 never-borrow list): it lacks dev's `readCostCapOverride`/`cost_total` gate, the `ERR_STREAM`/`clipMiddle` stderr handling, the recovery-prompt rejection on a slice failure and the pause-in-slice rule. Only the `_execute` and `_adoptResolvedGraph :1738-1748` SHAPES are taken; every one of those four dev behaviours is reinstated in Task 3.**
- **P1** — Where do `_onAgentEvent`, the five telemetry reducers and `_recordCost` live? → **On `RunHarness`, moved verbatim by Task 1 rather than duplicated into the v2 class (planner default). They read only `attr` and `state.steps[].key`, so the move is behaviour-preserving and the ~25 sub-agent suites are its oracle; duplicating ~340 lines until P8 would be a drift trap.**
- **P2** — What is the v2 questions file called? → **`questions-x-<nodeIdSafe>-c<ordinal>-r<round>.json`, `nodeIdSafe` = the node id with every character outside `[A-Za-z0-9_-]` replaced by `_` (spec §5.4; no dev test pins the orchestrator-built name).**
- **P3** — What text does a quiescent run record? → **`finished at quiescence — End not reached` — P3's `QUIESCENCE_WARNING` (scheduler.mjs), imported here; `state.warnings` mirrors the scheduler's `getState().warnings`, this class only logs + audits it, the UI banner and the CLI summary print the same sentence (agent adjudication, cross-plan pass 2026-08-27: one text, one owner).**
- **P4** — What shape does `buildGraphManifest`'s `overlays` take here? → **The resolver's own tables, verbatim: `{ nodes: resolved.nodes, wires: resolved.wires }` (P2 Task B4 contract — effective `model/effort/fanOut/askQuestions/awaitAll` per agent node, overlay-merged `maxCycles` per loop wire; the builder reads only those keys), with `agentsByKey = resolved.agentsByKey`; nothing is re-derived here (agent adjudication, cross-plan pass 2026-08-27).**
- **P5** — How are the scheduler's human gate and generic ask wired? → **P3's contract: `onAsk(ask)` is the ONE ask channel — `_schedulerAsk(q)` rides `_enqueueAsk` → `_ask(q)` and maps a gate's `{decision}` to `'another'|'continue'` (gate ask id `gate-<wireId>-<deliveryNo>`, payload `{id, kind:'gate', wireId, nodeId, executionId, issues}`, answered through the unchanged `POST /api/answer {id}`); `onGate(gate|null)` only mirrors `state.gate = {wireId, fromNode, toNode, askId}` and emits `state` (agent adjudication, cross-plan pass 2026-08-27).**
- **P10** — Which resolver fields does this class consume? → **All seven of `resolveGraph`'s `{ template, ports, loops, nodes, wires, agentsByKey, agentKeys }`; `_adoptResolvedGraph` aliases `nodeCtx = nodes` and re-derives nothing (no second `classifyLoops`, no `_overlays()`, no workspace fan-out forcing — that is the resolver's, spec §5.10); `resolvedFromManifest` returns the same shape (agent adjudication, cross-plan pass 2026-08-27).**
- **P11** — Slice numbering for the CLI's `task 3/7`? → **The scheduler (P3) puts `taskIndex`/`taskTotal`/`parentExecutionId` on the slice's execute args and `exec` events; `_execCtx` copies them, `_execStep` writes them on the ledger row, `writeState` stores them in `exec_meta`, `stepRowToStep` reads them back (agent adjudication, cross-plan pass 2026-08-27; additive to spec §5.7/§5.9).**
- **P6** — How does a non-interactive run answer? → **The v1 `_ask` auto path, unchanged: gates auto-answer `continue` (the A4 rule) and clarify/questions auto-answer their first option; `_dismissPendingAsk` resolves a queued gate to `continue` and a queued clarify to `{answers: []}` when End arrives (spec §5.3).**
- **P7** — How is parity between the engines compared? → **Four normalized projections — agent execution order (`agentKey#ordinal` vs `phase#cycle`, bookends and flow cards dropped), produced files (`listArtifacts` rel paths minus the synthetic kinds), gate prompts (v1 `fbId` mapped through `FB_WIRE_MAP` to the v2 `wireId`) and per-key max cycle. A divergence is an engine bug, never a normalization bug (spec §12.2; table in Task 10).**
- **P8** — What does `createOrchestratorFor` need from `opts`? → **`opts.resume?.resumePoint?.version` (authoritative), else `opts.workflowId`; `opts.template` is an OPTIONAL already-read row that skips the second `readWorkflow` (spec §5.2 anchors the reuse at `ui/server.mjs:1062`; the option name is a planner default). Every other option is passed through untouched.**
- **P9** — What is the GraphOrchestrator's constructor default `workflowId`? → **`wf_default_v2` (the coexistence alias). `createOrchestratorFor` always passes an explicit id, so this only affects direct construction in tests (planner default; v1's `'wf_default'` default at `orchestrator.mjs:297` is untouched).**

## Known issues (Session A, 2026-08-27 — resolve during this plan's refinement, before execution)

Findings recorded while refining P1/P2 and adjudicating the cross-plan contracts. The refinement reports live (untracked) in `docs/superpowers/plans/2026-08-26-node-graph-v2-reports/`; `xplan-manifest.md` §A is the canonical contract sheet, §D the residual list.

- F6 (P1 critique): Task 1's telemetry hoist moves+deletes `SKILLS_MAX`, `skillLabel`, `mergeSkills` from `orchestrator.mjs` while `export const _testing = { SKILLS_MAX, skillLabel, mergeSkills }` (`orchestrator.mjs:4369`, imported by `test/skill-capture.test.mjs`) stays → ReferenceError at module load → every importer of `orchestrator.mjs` breaks. Fix: Step 4b export list += the three; Step 5 `import { SKILLS_MAX, skillLabel, mergeSkills } from './run-harness.mjs'` for `_testing` (or move `_testing` with them); Step 6 oracle += `test/skill-capture.test.mjs`.
- F4 / xplan seam S3 + §D4: `_engineRehydrate` runs BEFORE any state is rehydrated and OUTSIDE the shell's try (dev `:820` position; P1 v2 documents + validates it and `await`s it). P4 Task 6 must move manifest adoption, prompt hydration and the §9.4 re-preflight into `_engineRun({resume, rehydrated})` (inside the try, after restoration); `_engineRehydrate` stays pure (read `rp`, decide, return `{checkpointRef, memberWorktrees, plan?, audit}` with `audit` REQUIRED: `Pipeline **resumed** (graph snapshot at seq ${rp.snapshot?.seq ?? 0}).`). `resume` in `_engineRun` is the resume POINT (object), not a boolean.
- P1 v2 validates the hook contracts at the seams: `_resolveTopology` must return `{manifest, agentKeys, workflow:{id,name}}` (else `engine hook contract: _resolveTopology …` error before `_engineRun`); `_engineRehydrate` must return a string `audit` and an array `memberWorktrees`.
- xplan §D5: `resolvedFromManifest` returns live metas in `agentsByKey` — add a resume test that a changed sidecar cannot alter port identity.
- `_initRunners(opts)` is the constructor seam (P1 A17) — implement it rather than assigning `this._runners` after `super()`.
- F9: manifest cells now carry `config: {...node.config}` verbatim and `manifestTemplate` restores it — `resolvedFromManifest` must read `mn.config` (not `{ arity: mn.arity }`); A1's `nodes[id].config` then has one source on fresh and resume paths (spec §5.8 shape gains `config`, additive).
- A20/E6: `resolveGraph`'s not-found text is now `unknown workflowId "<id>"` — `_resolveTopology`'s error mapping should expect it.
- Shim cells (A19, measured): the OR card lands in cell 1 beside Task on `wf_full`/`wf_provided-plan`/`wf_full-no-decompose` (both in-wires are loop wires) — v1 painters draw a `key:null` OR chip there until P6.
