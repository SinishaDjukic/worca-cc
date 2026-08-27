# Node-Graph v2 — P1: Harness split + foundations Implementation Plan

> **v2 (refined 2026-08-27, Session A):** v1 + cross-plan contract alignment (xplan A17/A18/A27/A28/A30) + Opus anchor fact-check (61 OK/15 DRIFT/7 WRONG) + executed dry-run in a clone (3760 → 3805, 40 mutations, 3 survivors fixed) + Fable critique (F1–F15 applied). Wave 2 (2026-08-27): full re-execution from a reset clone — 12/12 tasks green, 3760 → 3809 exactly as predicted, oracle 156/0, 21/22 mutations red (the survivor became the tenth hooks test; expected final now 3810) — and a cold Fable fresh-eyes review (G1–G10 applied: `ℹ pass N` summary grep, no-dot-segment traversal probe, seed-fence joins, Task 5 step order). Counts marked "re-measured" are confirmed by that run except the +1 from the tenth test — which the P2 wave-2 run then confirmed: P1 v2 executed a third time from a reset clone as P2's prerequisite, 3760 → **3810** exactly (Task 2: 3762, Task 6: 3792), two more minor text fixes folded in (Task 8 Step 4 revert hazard, Task 10 Step 3 blast radii). Anchors valid for dev @ e6968e15.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the engine-agnostic run harness out of `src/core/orchestrator.mjs` into `src/core/run-harness.mjs` (`class RunHarness`, six engine hooks) with `class Orchestrator extends RunHarness` byte-identical in behavior; add the data-driven engine selector `src/core/engine-select.mjs` (returns v1 for everything today); mount `/src/shared` statically; land the first two pure shared modules (`constants.mjs`, `verdict.mjs`) behind a purity guard; land the 7 seed graphs + the graph default as frozen constants with structural tests. No user-visible change, no engine change: v1 runs exactly as it does on dev.

**Architecture:** `run-harness.mjs` owns everything a run needs regardless of engine — construction, `run()`/`resume()` shells, worktrees/run root, guardrails, context, cost limits, recovery, asks, checkpoints, results, git, clocks/steps ledger, logs, artifacts, events, persistence, heartbeat. The ten v1-specific seams inside those shells become six overridable hooks (`_resolveTopology`, `_engineRun`, `_enginePrePausePoint`, `_engineRehydrate`, `_bookend`, `_initRunners`); the base implementations of the first four throw `engine hook not implemented: <name>`, and `Orchestrator` implements them with the exact v1 code that lives at those seams today. `src/shared/graph/` is the ONE source of the graph model for server, tests and browser: pure ESM, relative imports only, served at `/src/shared` so a browser URL equals its disk path. The seeds live in `src/core/graph/` as deep-frozen data — no migration, no callers, in P1.

**Series position:** P1 of 8; no predecessor (verify HEAD descends from dev `e6968e15`); leaves dev green and shippable; v1 engine stays live. Successor sentinels this plan produces: `export class RunHarness` in `src/core/run-harness.mjs` and `export const SEED_TEMPLATES` in `src/core/graph/seed-templates.mjs`.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats every rule, anchor, signature and constant it needs).

## Global Constraints

- NEVER `git add` anything under `docs/superpowers/**` — plans and specs stay untracked. Never `git push`.
- Product name in every user-facing string: "worca" (never "worca-cc"; the repo dir/slug is fine in paths).
- Commits: `worca: Node-graph v2 P1 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file). Baseline recorded in Task 0; final total in Task 11.
- **The harness move is behavior-preserving by mandate.** Task 2 moves code; it does not improve it. No renames, no reformatting, no "while I'm here" fixes. The oracle is the existing suite passing UNCHANGED.
- Every file under `src/shared/**` is pure: only relative imports that stay inside `src/shared`, no `node:` builtins, no `require`, no `process.`, no DOM globals (`window`/`document`/`navigator`/`localStorage`), no `fetch(`, no `import.meta`, no top-level `let`/`var`. Enforced by `test/shared-graph-purity.test.mjs` from Task 7 on.
- `src/shared` modules are imported by RELATIVE path from every layer (`../../shared/graph/x.mjs` from `src/core/graph/`, `../../src/shared/graph/x.mjs` from `ui/public/`, `../../../src/shared/graph/x.mjs` from `ui/public/graph/`). Absolute specifiers (`/src/shared/...`) are FORBIDDEN — they break Node ESM, and UI tests import `ui/public/*.mjs` as plain Node modules.
- Tests are offline: no live `claude`, no servers left running, no browsers. Every new guard/rule gets an assertion that fails when the rule is removed (mutation-proof).
- Test output: Node ≥ 22's `node --test` uses the `spec` reporter even when piped — the summary lines are `ℹ tests N` / `ℹ pass N` / `ℹ fail 0`; every `Expected:` below quotes those. macOS ships no `timeout`; to cap a command use `perl -e 'alarm 900; exec @ARGV' <cmd…>`.

---

### Task 0: Branch check, deps, baseline, predecessor sentinel

**Files:** none changed.

**Interfaces:** produces the recorded BASELINE test count that Task 11 compares against.

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch (by hand: `git checkout -b worca-cc/node-graph-v2-p1` off dev). NEVER `git checkout dev`; never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: predecessor sentinel: **none — P1 is the first plan of the series.** Instead verify the lineage: `git merge-base --is-ancestor e6968e15 HEAD && echo OK` — must print `OK`. If it does not, STOP: this plan's anchors were verified on dev `e6968e15`.
- [ ] Step 4: this plan copies two files from the discarded branch. Make it available: `git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed >/dev/null 2>&1 || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed`. If the fetch fails (no network / branch gone) that is FINE — Task 9 embeds both files in full and only the optional byte-identity check needs the branch.
- [ ] Step 5: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail) '` — record the `ℹ pass N` line as **BASELINE**; `ℹ fail` must be `0` before you change anything. Do not invent a number; write down what the run prints. (Node ≥ 22 prints an eight-line `spec` summary — `tail -5` would hide the pass line.)

---

### Task 1: `collectRequiredSkills` accepts a key set

**Why first:** the harness's `run()` shell must call `collectRequiredSkills(registry, agentKeys)` — it no longer has a v1 `plan`. The v1 plan shape must keep working (three existing test files pass plans).

**Files:**
- modify `src/core/skills.mjs:111` (`export function collectRequiredSkills(registry, plan) {` — JSDoc directly above at `:100-110`)
- modify `test/skills-resolve.test.mjs` (append two tests)

**Interfaces:**
- Produces: `collectRequiredSkills(registry, planOrKeys)` where `planOrKeys` is EITHER an ExecutablePlan (`{steps: Array<Array<{key}>>}`) OR any iterable of agent keys (`Set<string>` / `string[]`). Return shape unchanged: `Array<{skill, requiredBy:string[], origin?}>` sorted by skill name.
- Consumed by: Task 2's `RunHarness.run()`.

- [ ] Step 1: Write the failing tests — append to `test/skills-resolve.test.mjs`:

```js
test('collectRequiredSkills: accepts a Set of agent keys (harness entry point)', () => {
  const registry = {
    planner: { requiresSkills: ['brainstorming'] },
    implementer: { requiresSkills: ['tdd', 'brainstorming'] },
    reviewer: {},
  };
  assert.deepEqual(collectRequiredSkills(registry, new Set(['planner', 'implementer', 'reviewer'])), [
    { skill: 'brainstorming', requiredBy: ['implementer', 'planner'] },
    { skill: 'tdd', requiredBy: ['implementer'] },
  ]);
  // An array of keys is an iterable too.
  assert.deepEqual(collectRequiredSkills(registry, ['planner']), [
    { skill: 'brainstorming', requiredBy: ['planner'] },
  ]);
  // Empty iterable -> empty union (NOT "walk everything").
  assert.deepEqual(collectRequiredSkills(registry, new Set()), []);
  // A bare string is iterable but is NOT a key list: it must not union per character.
  assert.deepEqual(collectRequiredSkills({ ...registry, p: { requiresSkills: ['perChar'] } }, 'planner'), []);
});

test('collectRequiredSkills: a plan object still walks plan.steps (v1 path intact)', () => {
  const registry = { planner: { requiresSkills: ['brainstorming'] }, ghost: { requiresSkills: ['nope'] } };
  const plan = { steps: [[{ key: 'planner' }]] };
  assert.deepEqual(collectRequiredSkills(registry, plan), [
    { skill: 'brainstorming', requiredBy: ['planner'] },
  ]);
  // A plan is NOT iterable: it must not be treated as a key list.
  assert.equal(typeof plan[Symbol.iterator], 'undefined');
});
```

`Expected: FAIL` — `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` followed by the `+ actual - expected` diff showing `+ []` (an empty actual array) for the Set case (today the function reads `planOrKeys?.steps`, and a Set has none).

- [ ] Step 2: Implement — replace the first two lines of the function body at `src/core/skills.mjs:111-113`:

```js
export function collectRequiredSkills(registry, plan) {
  const nodeKeys = new Set();
  for (const group of plan?.steps || []) for (const node of group) nodeKeys.add(node.key);
```

with:

```js
export function collectRequiredSkills(registry, planOrKeys) {
  // Two entry shapes: the v1 ExecutablePlan ({steps:[[{key}]]}) and a plain
  // iterable of agent keys (what the engine-agnostic run harness has — it never
  // sees a v1 plan). A plan object is not iterable, so the test is unambiguous.
  const nodeKeys = new Set();
  if (planOrKeys && typeof planOrKeys !== 'string' && typeof planOrKeys[Symbol.iterator] === 'function') {
    for (const key of planOrKeys) nodeKeys.add(key);
  } else {
    for (const group of planOrKeys?.steps || []) for (const node of group) nodeKeys.add(node.key);
  }
```

and update the JSDoc line `@param {{steps?: Array<Array<{key:string}>>}} plan` to:

```js
 * @param {{steps?: Array<Array<{key:string}>>}|Iterable<string>} planOrKeys  v1 plan, or agent keys
```

- [ ] Step 3: `node --test test/skills-resolve.test.mjs test/skills-gate-wiring.test.mjs test/plugin-skills.test.mjs`
`Expected: pass` — all three files green (`ℹ fail 0`), including the pre-existing plan-shaped assertions.
**Mutation check** (apply, watch it bite, revert): remove the `typeof planOrKeys !== 'string'` guard from `collectRequiredSkills` → the new Set test goes RED on the bare-string assertion (a string is iterable, so the union runs per CHARACTER). Restore it **by re-adding the `typeof planOrKeys !== 'string' && ` text**, NOT with `git checkout -- src/core/skills.mjs`: this task is not committed yet, so a checkout reverts to HEAD and silently discards Step 2 as well.
- [ ] Step 4: Commit — `worca: Node-graph v2 P1 — collectRequiredSkills accepts a key set`

---

### Task 2: The harness move — `src/core/run-harness.mjs`

**This task lands alone and ends green.** It is the only risky task in the plan: 63 class members (of 96) and ≈2,590 of `orchestrator.mjs`'s 4369 lines move file. It is executed by a one-off script (Step 2) so the move is mechanical and reviewable with `--color-moved`, never retyped.

**Files:**
- create `src/core/run-harness.mjs` (`export class RunHarness extends EventEmitter` + moved module-level helpers)
- modify `src/core/orchestrator.mjs` (4369 lines on dev; `class Orchestrator extends EventEmitter` at `:233` → `extends RunHarness`)
- create then delete `split-harness.tmp.mjs` at the repo root (NEVER committed)

**Interfaces:**
- Produces `export class RunHarness extends EventEmitter` — the P2 sentinel — plus the exported helpers `isAbort`, `errStreamAttr`, `pauseErr`, `isPause`, `sumStepCosts`, `sumStepActive`, `roundUsd`, `firstLine`, `clip`, `rel`, `ERR_STREAM` (re-exported from `orchestrator.mjs` where they are part of its public surface today: `isAbort`, `errStreamAttr`).
- Produces the six hooks (exact signatures below). `createOrchestrator(opts)` and every other export of `orchestrator.mjs` are unchanged.
- Consumed by: Task 3's `test/run-harness-hooks.test.mjs`; P4's `GraphOrchestrator extends RunHarness`.

**The three member sets (verified line by line against dev `e6968e15`; where they differ from the design spec's list the dev anchor below WINS).**

**HARNESS — moves to `run-harness.mjs` verbatim** (`path:line` = the member's signature line):
`constructor :234` (whole, including the `'wf_default'` default `:297` which stays a literal, and `:306` which becomes the `_initRunners` hook call), `getState :400`, `answer :411`, `stop :423`, `pause :446`, `_checkPause :464`, `run() :474`, `resume() :810`, `_resolveSingleBranches :1078`, `_setupRunRoot :1097`, `_resolveGuardrails :1194`, `_assembleContext :1228`, `_recordCapabilities :1313`, `_resolveMemberBranches :1352`, `_buildWorktreeGraph :1378`, `_buildWorktreeGraphAll :1419`, `_teardownWorktree :1458`, `_teardownWorktreeAll :1509`, `_teardownRunRoot :1575`, `_recordRunWarning :1706`, `_snapshotRetained :1722`, `_recordCommitFailure :1744`, `_commitWork :1814`, `_preflightAgentKeys :1923` (signature changes — see below), `_checkCostLimits :2582`, `_pauseForCost :2610`, `_recover :2624`, `_enqueueRecoveryPrompt :2650`, `_enqueueAsk :2663`, `_backoff :2672`, `_recoveryNonce :2690`, `_workspaceChannel :2752`, `_reposCtx :2773`, `_ask :2834`, `_collectExtras :2952`, `_ensureGitCheckpointFor :3412`, `_buildResults :3464`, `_reportToSource :3551`, `_ensureGitCheckpoint :3566`, `_ensureGitCheckpointAll :3595`, `_stageWorkingTree :3625`, `_excludePathspecs :3655`, `_git :3667`, `_loadAgentPrompts :3700`, `_writeClarifyAnswers :3717`, `_deriveBaseName :3732`, `_checkAbort :3738`, `_phase :3746`, `_recordStep :3757`, `_clockResume :3819`, `_clockPause :3825`, `_clockPauseAll :3833`, `_runningStepKey :3840`, `liveActiveMs :3846`, `_setStatus :3855`, `_log :3865`, `_artifact :3881`, `_emit :3903`, `_kickoffTitleGeneration :3916`, `_persist :3947`, `_startHeartbeat :3957`, `_stopHeartbeat :3968`, `_completePaused :3974`.

> **Deviation from the spec's §5.1 list, deliberate and load-bearing:** the spec files `_phase :3746` under V1-ONLY "(except bookends)". On dev, `_phase` has FOUR call sites — `:515`, `:636`, `:717`, `:1000` — and all four ARE the bookends (per-node phase events come from `_nodeStep :3027`, which stays v1). On top of that, `test/cost-tracking.test.mjs` (14 calls) and `test/duration-tracking.test.mjs` (10 calls) call `orch._phase(phase, cycle, status)` directly and must pass unchanged. So `_phase` moves to the harness with its signature intact, and `_bookend(name, status)` is a thin base method that calls it. No `_phase` remains in `orchestrator.mjs`. P8 deletes `_phase` when those two suites are ported.

**V1-ONLY — stays in `orchestrator.mjs`, dies in P8:** `FANOUT_ELIGIBLE :139` (module-level), `decomposedTaskNode :190` (module-level, exported), `_dispatch :1961`, `_buildResumePoint :2141`, `_runStep :2176`, `_persistDecomposition :2228`, `_runDecomposedImplement :2249`, `_runDecomposedTask :2349`, `_runClarifyNode :2704`, `_bindNodeIo :2726`, `_publishNodeIo :2787`, `_loopFired :2807`, `_reviewOf :2819`, `_gate :2894`, `_phaseCtx :2903`, `_stepKeyFor :2944`.

**SHARED-BUT-SHAPE-CHANGES — stays in `orchestrator.mjs` at P1; P4 gives `GraphOrchestrator` an adapted twin, P8 deletes the v1 one:** `_logStepFailure :2390`, `_runNode :2403` (→ `_execute`), `_runNodeAttempts :2437`, `_runOnce :2467`, `_primeQuestions :2489`, `_questionsPath :2502`, `_questionsLoop :2517`, `_pauseForLimit :2572`, `_nodeCtx :2971` (→ `_execCtx`), `_nodeStep :3027` (→ `_execStep`), `_onAgentEvent :3074`, `_recordSubAgentSpawns :3231`, `_recordSubAgentFinishes :3266`, `_recordSkills :3288`, `_recordGraphify :3325`, `_upsertSubAgent :3352`, `_subAgentTransition :3359`, `_recordSubAgentTelemetry :3388`, `_recordCost :3796`.

**Module-level helpers `:3985–EOF`** — a helper moves iff a HARNESS member uses it; helpers used by BOTH files move to `run-harness.mjs` and are EXPORTED (`orchestrator.mjs` imports them back):
- **Move + export** (used on both sides): `roundUsd :3993`, `sumStepCosts :4004`, `sumStepActive :4020`, `isAbort :4028`, `pauseErr :4037`, `isPause :4042`, `firstLine :4061`, `rel :4070`, `clip :4322`, plus the top-of-file `ERR_STREAM :161` and `errStreamAttr :176`.
- **Move, private to the harness** (no v1 use): `safeParse :4053`, `errDetail :167`, `findDisabledPluginFor :110`, `RECOVERY_MAX_AUTO_ATTEMPTS :144`, `REPO_ROOT :99`.
- **Stay in `orchestrator.mjs`**: `numOr :3987`, `jsonClone :4048`, `SUBAGENT_LABEL_MAX :4090`, `registerSubAgents :4098`, `describeToolUses :4109`, `describeToolResults :4131`, `toolTarget :4144`, `SKILLS_MAX :4182`, `OVERFLOW_RE :4189`, `mcpServerLabel :4193`, `skillLabel :4206`, `extractSkillLabels :4229`, `GRAPHIFY_CMD_RE :4251`, `countGraphifyBashCalls :4255`, `mergeSkills :4285`, `clipMiddle :4332`, `normalizeClarifyAnswer :4345`, `MAX_QUESTION_ROUNDS :150`, `_testing :4369`.

**The six hooks.** Base versions live at the END of the `RunHarness` class body; the first four throw, `_bookend` and `_initRunners` are implemented there. `Orchestrator` implements all six with the exact v1 code that lives at the twelve seams today, appended at the end of its class body — moved, not rewritten.

**The hook text is the script's `BASE_HOOKS` / `V1_HOOKS` template strings** (Step 1, the second fenced block below) — that copy is the ONE copy and the one that actually lands. Do not retype the hook bodies here: read them there, and if a hook body must change, change it there.

The split also adds one new module-level helper to `orchestrator.mjs` (next to `numOr`) — it is the tail of the script's `ORCH_IMPORTS` constant, repeated here because the seams reference it:

```js
/** The distinct agent keys of a resolved v1 plan, in first-seen order — the
 *  shape the harness's preflight and skills gates take. */
function planAgentKeys(plan) {
  const keys = new Set();
  for (const group of plan?.steps || []) for (const node of group) keys.add(node?.key);
  return keys;
}
```

**The twelve seams** (`→` = the replacement text): S1–S10 sit inside the moved `run()`/`resume()` shells; S11 is the constructor runner hook (the `this._runners` line, `:306`) and S12 the `_preflightAgentKeys` signature (`:1923`) — both applied by the script's blocks of the same name below. Together with the two import blocks, the two class lines, `BASE_HOOKS`/`V1_HOOKS`, `planAgentKeys` and the export lines, they are the ONLY non-moved lines the review in Step 5 may show.

| # | dev anchor | replaced text (verbatim) | replacement |
|---|---|---|---|
| S1 | `:489`–`:511` | `this.channelDefs = collectChannelDefs(registry); …` through `this.state.stepper = buildStepperManifest(plan, registry);` (incl. the `resolveWorkflow` call `:493-495`, the `if (this.isWorkspace)` fan-out block `:501-507`, the `this._preflightAgentKeys(plan);` line `:510`) | the 11 lines in the S1 block below |
| S2 | `:515` | `this._phase('preflight', 0, 'start');` | `this._bookend('preflight', 'start');` |
| S3 | `:636` | `this._phase('preflight', 0, 'done');` | `this._bookend('preflight', 'done');` |
| S4 | `:663` | `const requiredSkills = collectRequiredSkills(this.registry, plan);` | `const requiredSkills = collectRequiredSkills(this.registry, topology.agentKeys);` |
| S5 | `:709`–`:710` | ``await appendAudit(this.pipeline.dir, `Workflow: **${plan.name}** (${plan.id}).`);`` + `const dispatched = await this._dispatch(plan);` | ``await appendAudit(this.pipeline.dir, `Workflow: **${topology.workflow.name}** (${topology.workflow.id}).`);`` + `const dispatched = await this._engineRun({ resume: null });` |
| S6 | `:717` and `:1000` | `this._phase('done', 0, 'done');` (both occurrences) | `this._bookend('done', 'done');` |
| S7 | `:727`–`:736` | `if (!this.state.resumePoint) {` + the `{ version: 1, kind: 'boundary', … }` literal | `if (!this.state.resumePoint) {` + `this.state.resumePoint = this._enginePrePausePoint();` + `}` |
| S8 | `:820` | ``if (rp.version !== 1) throw new Error(`resume(): unsupported resume point version ${rp.version}`);`` | `const rehydrated = await this._engineRehydrate(rp);` + the `engine hook contract: _engineRehydrate` guard line (see the script's `// ── S8:` block) |
| S9 | `:899`, `:905`, `:917` | `this.checkpointRefs[onlyKey] = rp.bus?.code?.baseRef \|\| null;` / `this.checkpointRef = rp.bus?.code?.baseRef \|\| null;` / `for (const p of rp.bus?.workspace?.projects \|\| []) {` | `this.checkpointRefs[onlyKey] = rehydrated.checkpointRef;` / `this.checkpointRef = rehydrated.checkpointRef;` / `for (const p of rehydrated.memberWorktrees) {` |
| S10 | `:945` (channelDefs) + `:952` (audit), `:981`–`:994` | ``await appendAudit(this.pipeline.dir, `Pipeline **resumed** (from ${rp.kind} at step ${rp.stepIndex}).`);`` + `this.channelDefs = collectChannelDefs(this.registry);` … and the whole `let plan = rp.plan; … const dispatched = await this._dispatch(plan, { resume: rp });` block | `await appendAudit(this.pipeline.dir, rehydrated.audit);` (channelDefs line deleted — it moves into v1 `_engineRun`) … `const dispatched = await this._engineRun({ resume: rp, rehydrated });` |
| S11 | `:306` | the 3-line comment + `this._runners = { clarifier: (ctx) => this._runClarifyNode(ctx), ...(this.opts.runners \|\| defaultRunners) };` (the runner table) | `// Engine hook: the v1 runner registry (see Orchestrator._initRunners).` + `this._initRunners(this.opts);` (base constructor) |
| S12 | `:1923` | the `@param {object} plan resolveWorkflow() output …` JSDoc line, `_preflightAgentKeys(plan) {` and the `plan?.steps` double walk down to its closing `}` | the `@param {Iterable<string>} agentKeys …` line, `_preflightAgentKeys(agentKeys) {` and `for (const key of agentKeys \|\| []) {` over the iterable (exact text: the script's `// ── S12:` block) |

**Disclosed behavior-order deviations** (the move is behavior-identical apart from these three; each is safe, and each is named HERE so the reviewer does not have to rediscover it):
1. `collectChannelDefs(this.registry)` on the RESUME path leaves the shell for v1 `_engineRun` (S10), so it now runs AFTER `_assembleContext`/`_recordRunWarning` instead of before. Safe: the only readers are `run`, `resume` and `_bindNodeIo` (inside `_dispatch`), and nothing between the old site and dispatch reads it.
2. `buildStepperManifest(plan, registry)` moves INSIDE v1 `_resolveTopology` (S1), so it now runs BEFORE the §9.4 preflight gate instead of after it. Safe: `workflows.mjs:476` reads `const meta = reg[node.key] || {}`, so an unresolvable key can neither throw nor change the manifest — and the gate still hard-fails before the manifest is STAMPED onto `state.stepper`.
3. v1 `_engineRehydrate` maps `rp.bus?.workspace?.projects` OUTSIDE the shell's `try` (S8 sits at dev's `:820` version-gate position, before it). Corrupt-point-only difference: a truthy NON-array `projects` now rejects `resume()` instead of landing as status `error`. Accepted under the byte-identical mandate; no guard added.

S1 block (replaces `:489`–`:511`; `:487-488` — the `loadAgentRegistry` + `this.registry =` lines — stay):

```js
      // Engine hook: resolve the run topology. v1 = resolveWorkflow + workspace
      // fan-out forcing + the v1 stepper manifest; v2 = resolveGraph +
      // buildGraphManifest. It yields the manifest the UI renders, the agent-key
      // set the preflight and skills gates walk, and the workflow's id/name.
      const topology = await this._resolveTopology(registry);
      if (!topology?.manifest || !topology.agentKeys || !topology.workflow?.id) throw new Error('engine hook contract: _resolveTopology must return { manifest, agentKeys, workflow:{id,name} }');
      // §9.4: hard-fail BEFORE the stepper is STAMPED / createPipeline / worktree
      // (the manifest is built inside the hook, which tolerates unknown keys) —
      // a missing agent key must never reach dispatch as an empty-prompt node.
      this._preflightAgentKeys(topology.agentKeys);
      this.state.stepper = topology.manifest;
```

`_preflightAgentKeys` (moved to `run-harness.mjs`; the plan-walking loop becomes the caller's job — everything else, including both message strings, is untouched):

```js
  /**
   * §9.4 preflight gate: every workflow node key must resolve in the MERGED
   * registry (builtin+user+plugin) BEFORE any node executes. This deliberately
   * supersedes the silent empty-prompt degradation for ALL origins (it was a
   * bug, not a feature) — resolveWorkflow keeps `reg[key] || {}` for library
   * callers; runs are gated HERE, covering run() and resume(). The thrown plain
   * Error lands in the caller's catch => status 'error' + message; the
   * recoverable-error gate surfaces it cleanly.
   * @param {Iterable<string>} agentKeys the run's distinct agent keys, in launch order
   */
  _preflightAgentKeys(agentKeys) {
    const reg = this.registry || {};
    const missing = [];
    const seen = new Set();
    for (const key of agentKeys || []) {
      if (!key || seen.has(key) || Object.hasOwn(reg, key)) continue;
      seen.add(key);
      const plugin = findDisabledPluginFor(key);
      missing.push(plugin
        ? `agent "${key}" comes from disabled plugin "${plugin}" — enable it`
        : `agent "${key}" is not installed (removed plugin?)`);
    }
    if (missing.length) {
      throw new Error(
        `Preflight failed: ${missing.length} workflow agent key(s) do not resolve:\n` +
        missing.map((m) => `  - ${m}`).join('\n'),
      );
    }
  }
```

**Imports after the split** (nothing imported twice; three bindings — `today`, `resolve`, `basename` — stay imported in `orchestrator.mjs` although only the harness calls them now: deliberate, the move does not lint, the script is the source of truth).

`src/core/run-harness.mjs` — the file header comment, then:

```js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, basename, resolve, sep, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, realpath } from 'node:fs/promises';

import { generateTitle } from './title.mjs';
import {
  createPipeline, updatePipelineTitle, appendAudit, writeState, artifactPaths, slugify, today,
  recordArtifact, writeClarify, readPipelineExtras, claimPipelineOwnership, touchHeartbeat,
  clearPipelineOwnership, HEARTBEAT_INTERVAL_MS,
} from './artifacts.mjs';
import { diffNameStatus, diffNumstat, diffPatch } from './git-info.mjs';
import {
  assembleResults, persistResults, persistDiffPatch, buildPerProject, rollupSummary,
  retainedWorkPatchName,
} from './results.mjs';
import { resolveTaskInput, retryWriteback } from './sources.mjs';
import { projectKey, projectStorePath, workspaceStorePath } from './store.mjs';
import { worcaHome } from './projects.mjs';
import {
  runRootMode, getProjectsRoot,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
} from './settings.mjs';
import { readCostCapOverride, totalWindowSpendUsd, costWindowStart } from './cost-budget.mjs';
import {
  writeRunManifest, readRunManifest, updateRunManifest, rmGuarded, rescueModifiedMounts,
  scanStrayEntries, copyRunManifestTo, removeInjectedPaths, stripClaudeMdFence,
  RETAIN_REASONS,
} from './run-manifest.mjs';
import { assembleRunContext, renderContextAudit, MCP_GRANT_MODE } from './run-context.mjs';
import { createRunLogWriter, RUN_LOG_FILE, RUN_LOG_KIND } from './run-log.mjs';
import {
  detectTools, detectToolsPerProject, runGraphifyUpdate, worktreeGraphInstruction,
  probeClaudeCapabilities, explainUnspawnableClaude,
} from './preflight.mjs';
import { fanoutCap, mapWithCap } from './fanout.mjs';
import { resolveStepModels } from './config.mjs';
import { readGuardrailSet } from './guardrail-store.mjs';
import { unionGuardrails, guardrailsToPermissionRules, mergePermissionRules } from './guardrails.mjs';
import { collectRequiredSkills, validateSkills, injectSkills, pluginSkillDirs } from './skills.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from './agent-registry.mjs';
import {
  createWorktree, removeWorktree, suggestBranchName, sanitizeBranchName, resolveDefaultBranch,
  isValidSourceRef, snapshotWorktreePatch,
} from './worktree.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // §9.4 disabled-plugin hint
```

`src/core/orchestrator.mjs` — its import block becomes exactly:

```js
import { join, resolve, dirname, basename } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';

import {
  appendAudit, planPath, today, writeReview, reviewKindOf,
  writeDecomposition, updateTaskStatus, updatePhaseStatus, upsertSubAgent,
  writeStepQuestions, readStepQuestions,
} from './artifacts.mjs';
import { hasBlocking, blockingIssues, readQuestionsFile } from './protocol.mjs';
import { runClarify } from './phases.mjs';
import { runners as defaultRunners } from './runners.mjs';
import { classifyError } from './recoverable-error.mjs';
import { resolveWorkflow, buildStepperManifest, rewriteStepperForDecomposition } from './workflows.mjs';
import { allocate, bindInputs, publish, legacyFields, entrySeedChannels, renderPromptArtifact } from './channels.mjs';
import { collectChannelDefs } from './agent-registry.mjs';
import { validateWorkflow } from './workflow-validator.mjs';
import { observeModelCost } from './config.mjs';
import { recordCostDelta } from './cost-budget.mjs';
import {
  RunHarness, ERR_STREAM, errStreamAttr, isAbort, isPause, pauseErr,
  roundUsd, sumStepCosts, sumStepActive, firstLine, rel, clip,
} from './run-harness.mjs';

export { isAbort, errStreamAttr }; // public surface kept (test/abort-classify, test/log-provenance)
```

`appendAudit` is imported by BOTH files (both sides call it); `today`, `resolve` and `basename` remain in `ORCH_IMPORTS` unused (leave them) — importing the same binding from `./artifacts.mjs` in two modules is not a duplicate import. `collectChannelDefs` splits off from `loadAgentRegistry`/`DEFAULT_AGENTS_DIR` (v1 needs only the first, the harness only the last two). `./protocol.mjs`, `./channels.mjs`, `./runners.mjs`, `./phases.mjs`, `./workflow-validator.mjs`, `./workflows.mjs` and `./recoverable-error.mjs` are NOT imported by the harness at all — that is the point of the split.

**Steps.**

- [ ] Step 1: Write the extraction script to `split-harness.tmp.mjs` at the repo root. It is a ONE-OFF: it reads `src/core/orchestrator.mjs`, locates every member by its exact signature line (never by line number), asserts the member count (96) and that every expected name is present, cuts the 63 HARNESS members plus 16 module-level helpers with their leading comment blocks, applies the twelve seam edits (each asserted to match exactly once; S6 and S9 exactly twice — see their `all(…, 2)` calls), and writes both files. **It is embedded in full below, and the fenced blocks are printed in EXECUTION order — concatenate them exactly as they appear.** Its `BASE_HOOKS`/`V1_HOOKS` template strings are the ONLY copy of the hook text, and its `HARNESS_IMPORTS`/`ORCH_IMPORTS` constants the only copy of the import blocks: the script is the source of truth — edit it, not the prose above.

```js
// split-harness.tmp.mjs — ONE-OFF. `node split-harness.tmp.mjs` from the repo
// root, then `rm split-harness.tmp.mjs`. NEVER commit this file.
import { readFileSync, writeFileSync } from 'node:fs';

const HARNESS_HEAD = `// src/core/run-harness.mjs
// The engine-agnostic run harness: everything a pipeline run needs regardless of
// which engine sequences the work — construction, the run()/resume() shells,
// run root + worktrees, guardrails, run context, cost limits, recovery, user
// asks, git checkpoints, results, the step ledger + clocks, logs, artifacts,
// events, persistence and the heartbeat.
//
// Engines subclass it and implement six hooks (bottom of the class):
// _resolveTopology, _engineRun, _enginePrePausePoint, _engineRehydrate,
// _bookend (implemented here), _initRunners (no-op here). The v1 engine is
// src/core/orchestrator.mjs (class Orchestrator extends RunHarness).
//
// It is an EventEmitter. Consumers (CLI, UI) subscribe to events and drive
// interaction via answer()/stop().
`;

const HARNESS_IMPORTS = `import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, basename, resolve, sep, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, realpath } from 'node:fs/promises';

import { generateTitle } from './title.mjs';
import {
  createPipeline, updatePipelineTitle, appendAudit, writeState, artifactPaths, slugify, today,
  recordArtifact, writeClarify, readPipelineExtras, claimPipelineOwnership, touchHeartbeat,
  clearPipelineOwnership, HEARTBEAT_INTERVAL_MS,
} from './artifacts.mjs';
import { diffNameStatus, diffNumstat, diffPatch } from './git-info.mjs';
import {
  assembleResults, persistResults, persistDiffPatch, buildPerProject, rollupSummary,
  retainedWorkPatchName,
} from './results.mjs';
import { resolveTaskInput, retryWriteback } from './sources.mjs';
import { projectKey, projectStorePath, workspaceStorePath } from './store.mjs';
import { worcaHome } from './projects.mjs';
import {
  runRootMode, getProjectsRoot,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
} from './settings.mjs';
import { readCostCapOverride, totalWindowSpendUsd, costWindowStart } from './cost-budget.mjs';
import {
  writeRunManifest, readRunManifest, updateRunManifest, rmGuarded, rescueModifiedMounts,
  scanStrayEntries, copyRunManifestTo, removeInjectedPaths, stripClaudeMdFence,
  RETAIN_REASONS,
} from './run-manifest.mjs';
import { assembleRunContext, renderContextAudit, MCP_GRANT_MODE } from './run-context.mjs';
import { createRunLogWriter, RUN_LOG_FILE, RUN_LOG_KIND } from './run-log.mjs';
import {
  detectTools, detectToolsPerProject, runGraphifyUpdate, worktreeGraphInstruction,
  probeClaudeCapabilities, explainUnspawnableClaude,
} from './preflight.mjs';
import { fanoutCap, mapWithCap } from './fanout.mjs';
import { resolveStepModels } from './config.mjs';
import { readGuardrailSet } from './guardrail-store.mjs';
import { unionGuardrails, guardrailsToPermissionRules, mergePermissionRules } from './guardrails.mjs';
import { collectRequiredSkills, validateSkills, injectSkills, pluginSkillDirs } from './skills.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from './agent-registry.mjs';
import {
  createWorktree, removeWorktree, suggestBranchName, sanitizeBranchName, resolveDefaultBranch,
  isValidSourceRef, snapshotWorktreePatch,
} from './worktree.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // §9.4 disabled-plugin hint
`;

const ORCH_IMPORTS = `import { join, resolve, dirname, basename } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';

import {
  appendAudit, planPath, today, writeReview, reviewKindOf,
  writeDecomposition, updateTaskStatus, updatePhaseStatus, upsertSubAgent,
  writeStepQuestions, readStepQuestions,
} from './artifacts.mjs';
import { hasBlocking, blockingIssues, readQuestionsFile } from './protocol.mjs';
import { runClarify } from './phases.mjs';
import { runners as defaultRunners } from './runners.mjs';
import { classifyError } from './recoverable-error.mjs';
import { resolveWorkflow, buildStepperManifest, rewriteStepperForDecomposition } from './workflows.mjs';
import { allocate, bindInputs, publish, legacyFields, entrySeedChannels, renderPromptArtifact } from './channels.mjs';
import { collectChannelDefs } from './agent-registry.mjs';
import { validateWorkflow } from './workflow-validator.mjs';
import { observeModelCost } from './config.mjs';
import { recordCostDelta } from './cost-budget.mjs';
import {
  RunHarness, ERR_STREAM, errStreamAttr, isAbort, isPause, pauseErr,
  roundUsd, sumStepCosts, sumStepActive, firstLine, rel, clip,
} from './run-harness.mjs';

export { isAbort, errStreamAttr }; // public surface kept (test/abort-classify, test/log-provenance)

/** The distinct agent keys of a resolved v1 plan, in first-seen order — the
 *  shape the harness's preflight and skills gates take. */
function planAgentKeys(plan) {
  const keys = new Set();
  for (const group of plan?.steps || []) for (const node of group) keys.add(node?.key);
  return keys;
}
`;
```

```js
const BASE_HOOKS = `
  // ── engine hooks ─────────────────────────────────────────────────────────────
  // The harness is engine-agnostic; everything an engine decides sits behind
  // these six seams. The base throws so a half-built engine fails loudly at the
  // seam instead of running a half-configured pipeline.

  /** Resolve the run's topology from the merged registry.
   *  @param {Record<string,object>} _registry loadAgentRegistry() output
   *  @returns {Promise<{manifest:object, agentKeys:Set<string>, workflow:{id:string,name:string}}>}
   *  All three fields are REQUIRED; the shell throws a named 'engine hook
   *  contract' error when one is missing. manifest -> state.stepper (the UI
   *  snapshot); agentKeys -> the §9.4 preflight gate + the skills gate;
   *  workflow -> the run's audit line. */
  async _resolveTopology(_registry) { throw new Error('engine hook not implemented: _resolveTopology'); }

  /** Run the pipeline to completion or to a pause.
   *  @param {{resume?:object|null, rehydrated?:object|null}} _args resume point + _engineRehydrate's bag
   *  @returns {Promise<'done'|'paused'>} */
  async _engineRun(_args) { throw new Error('engine hook not implemented: _engineRun'); }

  /** The resume point recorded when a pause unwinds BEFORE the engine started
   *  (preflight/worktree). @returns {object} */
  _enginePrePausePoint() { throw new Error('engine hook not implemented: _enginePrePausePoint'); }

  /** Read the engine-specific parts of a resume point; throws when the point is
   *  not this engine's. Called at the position of dev's version gate: BEFORE the
   *  shell has rehydrated any state (state.*, pipeline, logWriter, stepModels,
   *  workflowId, guardrails are NOT restored yet) and OUTSIDE the shell's try —
   *  a throw here rejects resume() without touching the row. Keep it pure: read
   *  rp, decide whether the point is yours, return the bag. Engine restoration
   *  that needs state/registry/pipeline (manifest adoption, prompt hydration,
   *  the §9.4 re-preflight) belongs in _engineRun({resume, rehydrated}), which
   *  runs inside the try after everything is restored — exactly where v1 does
   *  its re-preflight. May be async: the shell awaits this call.
   *  @param {object} _rp
   *  @returns {{checkpointRef:string|null,
   *             memberWorktrees:Array<{projectKey:string, worktreeDir:string, graphInstruction:string}>,
   *             plan?:object|null, audit:string}} audit is REQUIRED — the shell
   *  writes it verbatim as the resume audit line. */
  _engineRehydrate(_rp) { throw new Error('engine hook not implemented: _engineRehydrate'); }

  /** Framework bookend markers ('preflight' | 'done'). Emitted by the base for
   *  EVERY engine, so both engines bracket their runs identically. P8 turns
   *  these into \`exec\` rows. */
  _bookend(name, status) {
    this._phase(name, 0, status);
  }

  /** Constructor seam for the v1 runner registry (v1 only; the graph engine
   *  injects its runners through the executor). Called from the constructor at
   *  the exact position the assignment had. */
  _initRunners(_opts) { /* base: no runner registry */ }
`;

const V1_HOOKS = `
  // ── engine hooks (v1) ────────────────────────────────────────────────────────

  _initRunners(opts) {
    // Clarify needs orchestrator state (this._ask / this._writeClarifyAnswers), so it is a
    // bound runner rather than a pure runners.mjs entry. Put it first so opts.runners may
    // still override it in tests.
    this._runners = { clarifier: (ctx) => this._runClarifyNode(ctx), ...(opts.runners || defaultRunners) };
  }

  async _resolveTopology(registry) {
    this.channelDefs = collectChannelDefs(registry); // custom-channel kind/filename for allocate()
    // [C5/M4] On a workspace run, resolveWorkflow substitutes the review node's key
    // reviewer -> workspaceReviewer (the fan-out synthesizer). Single-project runs
    // pass isWorkspace:false, so the resolved plan is byte-identical to today.
    const plan = await resolveWorkflow(this.projectDir, this.workflowId, registry, undefined, {
      isWorkspace: this.isWorkspace,
    });
    // Workspace fan-out forcing (§5.5, C4): the ONLY in-orchestrator topology change a
    // workspace run makes — force fanOut=true on the eligible nodes so they fan out
    // across member projects. Applied right after resolveWorkflow; absent isWorkspace
    // the plan is untouched. workspaceReviewer is now the resolved review node key
    // (substituted in workflows.mjs above), so the review fan-out is forced here.
    if (this.isWorkspace) {
      for (const group of plan.steps) {
        for (const node of group) {
          if (FANOUT_ELIGIBLE.has(node.key)) node.fanOut = true;
        }
      }
    }
    this._plan = plan; // v1-only: the dispatcher's input, handed back by _engineRun
    return {
      manifest: buildStepperManifest(plan, registry),
      agentKeys: planAgentKeys(plan),
      workflow: { id: plan.id, name: plan.name },
    };
  }

  async _engineRun({ resume = null, rehydrated = null } = {}) {
    if (!resume) return await this._dispatch(this._plan);
    // The v1 bus (channels.mjs) is v1-only state; on a fresh run _resolveTopology
    // fills it, on a resume it is rebuilt here. Nothing between the old site and
    // dispatch reads this.channelDefs — the only reader is _bindNodeIo, inside
    // _dispatch.
    this.channelDefs = collectChannelDefs(this.registry);
    // plan: frozen at pause time; a pre-dispatch boundary pause re-resolves.
    let plan = rehydrated?.plan ?? null;
    if (!plan) {
      plan = await resolveWorkflow(this.projectDir, this.workflowId, this.registry, undefined, {
        isWorkspace: this.isWorkspace,
      });
    }
    // §9.4: the frozen (or re-resolved) plan must still resolve every agent
    // key — the providing plugin may have been disabled or uninstalled while
    // this run sat paused. Same gate, same messages as run().
    this._preflightAgentKeys(planAgentKeys(plan));
    return await this._dispatch(plan, { resume });
  }

  _enginePrePausePoint() {
    // Paused outside _dispatch (preflight/worktree): boundary point at step 0.
    return {
      version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
      bus: null, stepModels: this.stepModels, workflowId: this.workflowId,
      guardrailsId: this.guardrailsId, plan: null,
      nodes: [], gate: null, pauseReason: this.pauseReason || null,
      toolInstruction: this.toolInstruction ?? '',
      pipelineDir: this.pipeline.dir, pausedAt: new Date().toISOString(),
    };
  }

  _engineRehydrate(rp) {
    if (rp.version !== 1) throw new Error(\`resume(): unsupported resume point version \${rp.version}\`);
    return {
      checkpointRef: rp.bus?.code?.baseRef || null,
      memberWorktrees: (rp.bus?.workspace?.projects || []).map((p) => ({
        projectKey: p?.projectKey, worktreeDir: p?.worktreeDir, graphInstruction: p?.graphInstruction || '',
      })),
      plan: rp.plan || null,
      audit: \`Pipeline **resumed** (from \${rp.kind} at step \${rp.stepIndex}).\`,
    };
  }
`;
```

```js
const SRC = 'src/core/orchestrator.mjs';
const die = (m) => { throw new Error(`split: ${m}`); };
const lines = readFileSync(SRC, 'utf8').split('\n');
const classAt = lines.indexOf('class Orchestrator extends EventEmitter {');
const classEnd = lines.findIndex((l, i) => i > classAt && l === '}');
const firstImport = lines.findIndex((l) => l.startsWith('import '));
const importEnd = lines.findIndex((l) => l.startsWith('import { readPluginsLock, pluginCurrentDir }'));
(classAt > 0 && classEnd > classAt && firstImport > 0 && importEnd > firstImport) || die('landmarks not found');
const MEMBER = /^ {2}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(.*\{\s*$/;
const BLOCK = /^(?:export )?(?:async )?(?:function ([A-Za-z_]\w*)\s*\(|const ([A-Za-z_]\w*) =)/;
const isComment = (l) => /^\s*(\/\*\*|\*|\/\/|\*\/)/.test(l);
const up = (i) => { let c = i; while (c > 0 && isComment(lines[c - 1])) c -= 1; return c; };
const starts = [];
for (let i = classAt + 1; i < classEnd; i += 1) { const m = lines[i].match(MEMBER); if (m) starts.push({ i, name: m[1] }); }
starts.length === 96 || die(`expected 96 members, found ${starts.length}`);
const members = new Map();
starts.forEach(({ i, name }, k) => {
  const next = k + 1 < starts.length ? up(starts[k + 1].i) : classEnd;
  let e = next - 1; while (e > i && lines[e] !== '  }') e -= 1;
  lines[e] === '  }' || die(`no closing brace for ${name}`);
  members.set(name, { start: up(i), end: e });
});
const blocks = new Map();
for (const [lo, hi] of [[importEnd + 1, classAt], [classEnd + 1, lines.length]]) {
  const bs = [];
  for (let i = lo; i < hi; i += 1) { const m = lines[i].match(BLOCK); if (m) bs.push({ i, name: m[1] || m[2] }); }
  bs.forEach(({ i, name }, k) => {
    const next = k + 1 < bs.length ? up(bs[k + 1].i) : hi;
    let e = next - 1; while (e > i && lines[e].trim() === '') e -= 1;
    blocks.set(name, { start: up(i), end: e });
  });
}
const HARNESS = ['constructor', 'getState', 'answer', 'stop', 'pause', '_checkPause', 'run', 'resume',
  '_resolveSingleBranches', '_setupRunRoot', '_resolveGuardrails', '_assembleContext', '_recordCapabilities',
  '_resolveMemberBranches', '_buildWorktreeGraph', '_buildWorktreeGraphAll', '_teardownWorktree',
  '_teardownWorktreeAll', '_teardownRunRoot', '_recordRunWarning', '_snapshotRetained', '_recordCommitFailure',
  '_commitWork', '_preflightAgentKeys', '_checkCostLimits', '_pauseForCost', '_recover', '_enqueueRecoveryPrompt',
  '_enqueueAsk', '_backoff', '_recoveryNonce', '_workspaceChannel', '_reposCtx', '_ask', '_collectExtras',
  '_ensureGitCheckpointFor', '_buildResults', '_reportToSource', '_ensureGitCheckpoint', '_ensureGitCheckpointAll',
  '_stageWorkingTree', '_excludePathspecs', '_git', '_loadAgentPrompts', '_writeClarifyAnswers', '_deriveBaseName',
  '_checkAbort', '_phase', '_recordStep', '_clockResume', '_clockPause', '_clockPauseAll', '_runningStepKey',
  'liveActiveMs', '_setStatus', '_log', '_artifact', '_emit', '_kickoffTitleGeneration', '_persist',
  '_startHeartbeat', '_stopHeartbeat', '_completePaused'];
const HELPERS = ['REPO_ROOT', 'findDisabledPluginFor', 'RECOVERY_MAX_AUTO_ATTEMPTS', 'ERR_STREAM', 'errDetail',
  'errStreamAttr', 'roundUsd', 'sumStepCosts', 'sumStepActive', 'isAbort', 'pauseErr', 'isPause', 'safeParse',
  'firstLine', 'rel', 'clip'];
HARNESS.length === 63 || die(`HARNESS list is ${HARNESS.length}, expected 63`);
for (const n of HARNESS) members.has(n) || die(`member not found: ${n}`);
for (const n of HELPERS) blocks.has(n) || die(`helper not found: ${n}`);
const cut = new Set();
const take = (r) => { for (let i = r.start; i <= r.end; i += 1) cut.add(i); return lines.slice(r.start, r.end + 1).join('\n'); };
const movedMembers = HARNESS.map((n) => take(members.get(n)));
const movedHelpers = HELPERS.map((n) => take(blocks.get(n)));
const keep = (lo, hi) => lines.slice(lo, hi).filter((_, k) => !cut.has(lo + k)).join('\n')
  .replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
const once = (text, from, to) => {
  const n = text.split(from).length - 1;
  n === 1 || die(`seam matched ${n}x (expected 1): ${from.split('\n')[0].trim()}`);
  return text.split(from).join(to);
};
const all = (text, from, to, times) => {
  const n = text.split(from).length - 1;
  n === times || die(`seam matched ${n}x (expected ${times}): ${from.trim()}`);
  return text.split(from).join(to);
};
let body = movedMembers.join('\n\n');
```

```js
// ── S1: topology hook ───────────────────────────────────────────────────────
body = once(body, `      this.channelDefs = collectChannelDefs(registry); // custom-channel kind/filename for allocate()
      // [C5/M4] On a workspace run, resolveWorkflow substitutes the review node's key
      // reviewer -> workspaceReviewer (the fan-out synthesizer). Single-project runs
      // pass isWorkspace:false, so the resolved plan is byte-identical to today.
      const plan = await resolveWorkflow(this.projectDir, this.workflowId, registry, undefined, {
        isWorkspace: this.isWorkspace,
      });
      // Workspace fan-out forcing (§5.5, C4): the ONLY in-orchestrator topology change a
      // workspace run makes — force fanOut=true on the eligible nodes so they fan out
      // across member projects. Applied right after resolveWorkflow; absent isWorkspace
      // the plan is untouched. workspaceReviewer is now the resolved review node key
      // (substituted in workflows.mjs above), so the review fan-out is forced here.
      if (this.isWorkspace) {
        for (const group of plan.steps) {
          for (const node of group) {
            if (FANOUT_ELIGIBLE.has(node.key)) node.fanOut = true;
          }
        }
      }
      // §9.4: hard-fail BEFORE the stepper snapshot / createPipeline / worktree —
      // a missing agent key must never reach dispatch as an empty-prompt node.
      this._preflightAgentKeys(plan);
      this.state.stepper = buildStepperManifest(plan, registry);`,
`      // Engine hook: resolve the run topology. v1 = resolveWorkflow + workspace
      // fan-out forcing + the v1 stepper manifest; v2 = resolveGraph +
      // buildGraphManifest. It yields the manifest the UI renders, the agent-key
      // set the preflight and skills gates walk, and the workflow's id/name.
      const topology = await this._resolveTopology(registry);
      if (!topology?.manifest || !topology.agentKeys || !topology.workflow?.id) throw new Error('engine hook contract: _resolveTopology must return { manifest, agentKeys, workflow:{id,name} }');
      // §9.4: hard-fail BEFORE the stepper is STAMPED / createPipeline / worktree
      // (the manifest is built inside the hook, which tolerates unknown keys) —
      // a missing agent key must never reach dispatch as an empty-prompt node.
      this._preflightAgentKeys(topology.agentKeys);
      this.state.stepper = topology.manifest;`);
// ── S2/S3/S6: bookends ──────────────────────────────────────────────────────
body = once(body, `      this._phase('preflight', 0, 'start');`, `      this._bookend('preflight', 'start');`);
body = once(body, `      this._phase('preflight', 0, 'done');`, `      this._bookend('preflight', 'done');`);
body = all(body, `      this._phase('done', 0, 'done');`, `      this._bookend('done', 'done');`, 2);
// ── S4: skills gate ─────────────────────────────────────────────────────────
body = once(body, `collectRequiredSkills(this.registry, plan)`, `collectRequiredSkills(this.registry, topology.agentKeys)`);
// ── S5: audit + dispatch ────────────────────────────────────────────────────
body = once(body, "      await appendAudit(this.pipeline.dir, `Workflow: **${plan.name}** (${plan.id}).`);\n      const dispatched = await this._dispatch(plan);",
  "      await appendAudit(this.pipeline.dir, `Workflow: **${topology.workflow.name}** (${topology.workflow.id}).`);\n      const dispatched = await this._engineRun({ resume: null });");
// ── S7: pre-dispatch pause point ────────────────────────────────────────────
body = once(body, `            // Paused outside _dispatch (preflight/worktree): boundary point at step 0.
            this.state.resumePoint = {
              version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
              bus: null, stepModels: this.stepModels, workflowId: this.workflowId,
              guardrailsId: this.guardrailsId, plan: null,
              nodes: [], gate: null, pauseReason: this.pauseReason || null,
              toolInstruction: this.toolInstruction ?? '',
              pipelineDir: this.pipeline.dir, pausedAt: new Date().toISOString(),
            };`,
`            // Paused before the engine started (preflight/worktree): the engine
            // decides what a pre-dispatch resume point looks like.
            this.state.resumePoint = this._enginePrePausePoint();`);
// ── S8: rehydrate hook ──────────────────────────────────────────────────────
body = once(body, "    if (rp.version !== 1) throw new Error(`resume(): unsupported resume point version ${rp.version}`);",
  `    // Engine hook: rejects a resume point that is not this engine's, and yields
    // the engine-specific fields the shell below rehydrates from. It runs at dev's
    // version-gate position: before any state is rehydrated and OUTSIDE the try,
    // so a throw rejects resume() without touching the row. Awaited so an engine
    // may be async; v1's synchronous return is awaited unchanged.
    const rehydrated = await this._engineRehydrate(rp);
    if (!rehydrated || typeof rehydrated.audit !== 'string' || !Array.isArray(rehydrated.memberWorktrees)) throw new Error('engine hook contract: _engineRehydrate must return { checkpointRef, memberWorktrees:[], audit }');`);
// ── S9: checkpointRef + member worktrees ────────────────────────────────────
body = all(body, `rp.bus?.code?.baseRef || null`, `rehydrated.checkpointRef`, 2);
body = once(body, `        for (const p of rp.bus?.workspace?.projects || []) {`, `        for (const p of rehydrated.memberWorktrees) {`);
// ── S10: resume audit, channelDefs, plan re-resolve, dispatch ───────────────
body = once(body, "      await appendAudit(this.pipeline.dir, `Pipeline **resumed** (from ${rp.kind} at step ${rp.stepIndex}).`);",
  `      await appendAudit(this.pipeline.dir, rehydrated.audit);`);
body = once(body, `      this.registry = loadAgentRegistry(this.agentsDir);
      this.channelDefs = collectChannelDefs(this.registry); // custom-channel kind/filename for allocate()
      this.agentPrompts = await this._loadAgentPrompts();`,
`      this.registry = loadAgentRegistry(this.agentsDir);
      this.agentPrompts = await this._loadAgentPrompts();`);
body = once(body, `      // ── plan: frozen at pause time; a pre-dispatch boundary pause re-resolves ──
      let plan = rp.plan;
      if (!plan) {
        plan = await resolveWorkflow(this.projectDir, this.workflowId, this.registry, undefined, {
          isWorkspace: this.isWorkspace,
        });
      }

      // §9.4: the frozen (or re-resolved) plan must still resolve every agent
      // key — the providing plugin may have been disabled or uninstalled while
      // this run sat paused. Same gate, same messages as run().
      this._preflightAgentKeys(plan);

      const dispatched = await this._dispatch(plan, { resume: rp });`,
`      const dispatched = await this._engineRun({ resume: rp, rehydrated });`);
// ── S11: constructor runner hook ────────────────────────────────────────────
body = once(body, `    // Clarify needs orchestrator state (this._ask / this._writeClarifyAnswers), so it is a
    // bound runner rather than a pure runners.mjs entry. Put it first so opts.runners may
    // still override it in tests.
    this._runners = { clarifier: (ctx) => this._runClarifyNode(ctx), ...(this.opts.runners || defaultRunners) };`,
`    // Engine hook: the v1 runner registry (see Orchestrator._initRunners).
    this._initRunners(this.opts);`);
```

And S12 — written as single-quoted line arrays because the replaced text contains backticks and `${…}`. It MUST run before the assembly block below (that block writes the files), which is why it is printed here: document order == execution order.

```js
// ── S12: the preflight gate takes a key set ─────────────────────────────────
const S12_FROM = [
  '   * @param {object} plan resolveWorkflow() output (or a frozen resume plan)',
  '   */',
  '  _preflightAgentKeys(plan) {',
  '    const reg = this.registry || {};',
  '    const missing = [];',
  '    const seen = new Set();',
  '    for (const group of plan?.steps || []) {',
  '      for (const node of group) {',
  '        const key = node?.key;',
  '        if (!key || seen.has(key) || Object.hasOwn(reg, key)) continue;',
  '        seen.add(key);',
  '        const plugin = findDisabledPluginFor(key);',
  '        missing.push(plugin',
  '          ? `agent "${key}" comes from disabled plugin "${plugin}" — enable it`',
  '          : `agent "${key}" is not installed (removed plugin?)`);',
  '      }',
  '    }',
].join('\n');
const S12_TO = [
  '   * @param {Iterable<string>} agentKeys the run\'s distinct agent keys, in launch order',
  '   */',
  '  _preflightAgentKeys(agentKeys) {',
  '    const reg = this.registry || {};',
  '    const missing = [];',
  '    const seen = new Set();',
  '    for (const key of agentKeys || []) {',
  '      if (!key || seen.has(key) || Object.hasOwn(reg, key)) continue;',
  '      seen.add(key);',
  '      const plugin = findDisabledPluginFor(key);',
  '      missing.push(plugin',
  '        ? `agent "${key}" comes from disabled plugin "${plugin}" — enable it`',
  '        : `agent "${key}" is not installed (removed plugin?)`);',
  '    }',
].join('\n');
body = once(body, S12_FROM, S12_TO);
```

```js
// The helpers v1 still needs become named exports of the harness module.
const EXPORTED = ['ERR_STREAM', 'roundUsd', 'sumStepCosts', 'sumStepActive', 'pauseErr', 'isPause',
  'firstLine', 'rel', 'clip'];
let helpersText = movedHelpers.join('\n\n');
for (const n of EXPORTED) {
  const re = new RegExp(`^(function ${n}\\(|const ${n} =)`, 'm');
  re.test(helpersText) || die(`cannot export helper ${n}`);
  helpersText = helpersText.replace(re, 'export $1');
}
const harness = [HARNESS_HEAD, HARNESS_IMPORTS, helpersText, '',
  'export class RunHarness extends EventEmitter {', body, BASE_HOOKS + '}', ''].join('\n');
const orchestrator = [lines.slice(0, firstImport).join('\n'), ORCH_IMPORTS, keep(importEnd + 1, classAt), '',
  'class Orchestrator extends RunHarness {', keep(classAt + 1, classEnd), V1_HOOKS + '}', '',
  keep(classEnd + 1, lines.length), ''].join('\n');
harness.includes('  _preflightAgentKeys(agentKeys) {') || die('S12 not applied — script blocks out of order');
harness.includes('this._preflightAgentKeys(topology.agentKeys);') || die('S1 not applied');
writeFileSync('src/core/run-harness.mjs', harness);
writeFileSync(SRC, orchestrator);
console.log(`run-harness.mjs ${harness.split('\n').length} lines; orchestrator.mjs ${orchestrator.split('\n').length} lines`);
```

> Order inside the script (= the order the fenced blocks are printed in): the constants (`HARNESS_HEAD`, `HARNESS_IMPORTS`, `ORCH_IMPORTS`, `BASE_HOOKS`, `V1_HOOKS`) first, then the scan/cut block, then S1–S11, then S12, then the `EXPORTED`/assembly block LAST. Concatenating the blocks in printed order gives a script whose execution order is the same — assembling them in any other order silently drops a seam, which is what the two post-condition `die` guards before the writes catch.

- [ ] Step 2: `node split-harness.tmp.mjs`
`Expected:` `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines` (re-measured 2026-08-27 on a clone of dev `e6968e15` with the v2 hook text; ±a few lines is fine, an assertion failure is not — every `split: …` message means an anchor moved and you must stop and re-derive it, never loosen the assertion).
- [ ] Step 3: `node --check src/core/run-harness.mjs && node --check src/core/orchestrator.mjs && echo PARSE-OK`
`Expected: PARSE-OK`
- [ ] Step 4: `rm split-harness.tmp.mjs` — it must never be committed. Then `git status --porcelain` must list exactly two entries UNDER `src/`: `M src/core/orchestrator.mjs` and `?? src/core/run-harness.mjs` (Task 1 is already committed; a main checkout carries unrelated untracked files at the repo root — ignore those, they are not yours). If `split-harness.tmp.mjs` still shows, you did not delete it.
- [ ] Step 5: Review the move as a move. `run-harness.mjs` is untracked, so git has nothing to pair the moved blocks with — stage its existence first (content stays in the working tree) and diff BOTH paths:
`git add -N src/core/run-harness.mjs`
`git diff --color-moved=zebra --color-moved-ws=allow-indentation-change -- src/core/orchestrator.mjs src/core/run-harness.mjs`
Expect ≈2610 moved-away / ≈2610 moved-to lines and ≈275 non-moved. Everything must render as moved except: (orchestrator) the new import block, `class Orchestrator extends RunHarness {`, the `V1_HOOKS` block, `planAgentKeys`, `export { isAbort, errStreamAttr };`, the nine helper signature lines that gained an `export ` prefix, and the twelve seam ORIGINALS; (harness) the file header, the import block, the twelve seam replacements S1–S12 (the two `engine hook contract:` guard lines are part of the S1 and S8 replacements) and `BASE_HOOKS`, plus the nine helper signature lines now carrying `export ` (`ERR_STREAM`, `roundUsd`, `sumStepCosts`, `sumStepActive`, `pauseErr`, `isPause`, `firstLine`, `rel`, `clip` — git shows both the removed and the added signature as non-moved). One-line comment banners, lone `}` and blank lines also show as non-moved — git's move detection needs ≥ 3 lines per block — that is noise, not an edit. (Re-measured 2026-08-27: 2611 removed / 2608 added render as moved; 73 + 200 = 273 non-moved.)
**Stronger cross-check (do this too — `--color-moved` is a heuristic):** compare `git show HEAD:src/core/orchestrator.mjs` against `cat src/core/orchestrator.mjs src/core/run-harness.mjs` as a MULTISET of non-blank lines, e.g. `diff <(git show HEAD:src/core/orchestrator.mjs | grep -v '^\s*$' | sort) <(cat src/core/orchestrator.mjs src/core/run-harness.mjs | grep -v '^\s*$' | sort) | grep '^[<>]' | wc -l`. Expect ~103 lost / ~211 gained, ALL accounted for by the two import blocks, the two class lines, the nine `export `-prefixed helpers, the twelve seams, `planAgentKeys`, the `export {…}` line, the harness header, `BASE_HOOKS` and `V1_HOOKS`. Any other line is a bug in the script — stop and re-derive.
Then read `src/core/run-harness.mjs` end to end and confirm the same list from the harness side. Anything else is a bug in the script — fix the script and re-run it from a clean tree (`git checkout src/core/orchestrator.mjs && rm src/core/run-harness.mjs`), never hand-patch the output.
- [ ] Step 6: Run the oracle — the suites that exercise the moved code hardest, unchanged:
`node --test test/orchestrator-*.test.mjs test/pause-resume-e2e.test.mjs test/server-pause-resume.test.mjs test/dispatcher.test.mjs test/clarify.test.mjs test/clarify-node.test.mjs test/workspace-mock.test.mjs test/cost-tracking.test.mjs test/duration-tracking.test.mjs test/preflight-missing-agent.test.mjs`
`Expected: ℹ fail 0` (measured 2026-08-27 on a clone of dev `e6968e15` with the split applied: 156 tests, 0 fail). The real importer list is `{ grep -lE "from '[^']*orchestrator\.mjs'" test/*.mjs; grep -lE "import\(['\"][^'\"]*orchestrator\.mjs" test/*.mjs; } | sort -u` — 53 files (a plain `grep -l "orchestrator.mjs" test/*.mjs` prints 60: seven files mention the path only in comments); the full suite in Step 7 covers them all.
- [ ] Step 7: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail) '`
`Expected:` green at **BASELINE + 2** (the move itself adds no tests; the +2 are Task 1's). Reference measurement 2026-08-27 on a clone of dev `e6968e15` with Tasks 1–2 applied: 3760/3760 without Task 1's two new tests, i.e. BASELINE = 3760 there — confirm against YOUR Task 0 number, do not assume it.
- [ ] Step 8: Commit — `worca: Node-graph v2 P1 — split the run harness out of the orchestrator`

---

### Task 3: `test/run-harness-hooks.test.mjs` — the hook contract

**Files:** create `test/run-harness-hooks.test.mjs` (10 tests).

**Interfaces:** consumes `RunHarness` from Task 2; pins the contract P4's `GraphOrchestrator` implements. No production code changes. The shell `await`s `_engineRehydrate`, so an engine MAY be async — the base throws synchronously, which is why test 1 pins it with `assert.throws` and not `assert.rejects`.

- [ ] Step 1: Write the test (it is the deliverable — there is no "make it fail first" for a contract test on code that already exists; run it, watch it pass, then MUTATE to prove it bites: Step 3).

```js
// test/run-harness-hooks.test.mjs
// The engine-agnostic harness contract: a stub engine (no v1 code, no claude)
// drives RunHarness through run() and resume() and proves the six hooks are the
// ONLY seams — bookends, stepper stamping, the preflight key set, the
// pre-pause point and the rehydrate bag all flow through them.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';

useTempHome(after);

const dirs = [];
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {}); });

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-harness-'));
  dirs.push(dir);
  await writeFile(join(dir, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

class StubEngine extends RunHarness {
  constructor(opts) {
    super(opts);
    this.calls = { topology: 0, engineRun: [], prePause: 0, rehydrate: [] };
    this.agentKeys = opts.agentKeys || new Set(['planner']);
  }
  async _resolveTopology(registry) {
    this.calls.topology += 1;
    this.calls.registryKeys = Object.keys(registry).length;
    return {
      manifest: { version: 99, steps: [{ kind: 'stub' }], feedbacks: [] },
      agentKeys: this.agentKeys,
      workflow: { id: 'wf_stub', name: 'Stub' },
    };
  }
  async _engineRun(args) {
    this.calls.engineRun.push(args);
    // Exactly what v1's dispatcher does on entry: honour a pause that was
    // requested while the harness was still in preflight.
    this._checkPause();
    return 'done';
  }
  _enginePrePausePoint() { this.calls.prePause += 1; return { version: 99, kind: 'stub-boundary' }; }
  _engineRehydrate(rp) {
    this.calls.rehydrate.push(rp);
    if (rp.version !== 99) throw new Error(`stub: unsupported resume point version ${rp.version}`);
    return {
      checkpointRef: 'ref-from-hook',
      memberWorktrees: [{ projectKey: 'k', worktreeDir: '/nope', graphInstruction: 'gi' }],
      plan: { marker: 'frozen' },
      audit: 'Pipeline **resumed** (stub).',
    };
  }
}

/** The pipeline's audit lines, in order — the two seams S5 and S10 write here. */
const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id')
  .all(id).map((r) => r.text).join('\n');

beforeEach(() => { _resetForTests(); });

test('base hooks throw a named "engine hook not implemented" error', () => {
  const h = new RunHarness({ projectDir: process.cwd() });
  assert.throws(() => h._enginePrePausePoint(), /engine hook not implemented: _enginePrePausePoint/);
  assert.throws(() => h._engineRehydrate({}), /engine hook not implemented: _engineRehydrate/);
  return Promise.all([
    assert.rejects(() => h._resolveTopology({}), /engine hook not implemented: _resolveTopology/),
    assert.rejects(() => h._engineRun({}), /engine hook not implemented: _engineRun/),
  ]);
});

test('the base implements _bookend and _initRunners (no engine needed)', () => {
  const h = new RunHarness({ projectDir: process.cwd() });
  const phases = [];
  h.on('phase', (p) => phases.push(p));
  h._bookend('preflight', 'start');
  h._bookend('preflight', 'done');
  assert.deepEqual(phases, [
    { phase: 'preflight', cycle: 0, status: 'start' },
    { phase: 'preflight', cycle: 0, status: 'done' },
  ]);
  assert.equal(h.state.steps.length, 1);
  assert.equal(h.state.steps[0].key, 'preflight');
  assert.equal(h.state.steps[0].status, 'done');
  assert.equal(h._runners, undefined, 'the base installs no runner registry');
});

test('_preflightAgentKeys gates on a key SET, with the §9.4 message', () => {
  const h = new RunHarness({ projectDir: process.cwd() });
  h.registry = { planner: {}, reviewer: {} };
  h._preflightAgentKeys(new Set(['planner', 'reviewer']));           // no throw
  assert.throws(
    () => h._preflightAgentKeys(new Set(['planner', 'ghost'])),
    /Preflight failed: 1 workflow agent key\(s\) do not resolve:\n {2}- agent "ghost" is not installed \(removed plugin\?\)/,
  );
});
```

```js
test('run(): the topology hook stamps state.stepper, feeds the preflight gate and the bookends bracket the engine', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo task', claude: { mock: true }, auto: true });
  const seen = { stepperAt: -1, phases: [] };
  orch.on('state', (s) => { if (seen.stepperAt < 0 && s.stepper) seen.stepperAt = seen.phases.length; });
  orch.on('phase', (p) => seen.phases.push(`${p.phase}:${p.status}`));
  const res = await orch.run();
  assert.equal(res.status, 'done');
  assert.equal(orch.calls.topology, 1);
  assert.ok(orch.calls.registryKeys > 0, 'the base loads the registry and hands it to the hook');
  assert.deepEqual(orch.state.stepper, { version: 99, steps: [{ kind: 'stub' }], feedbacks: [] });
  assert.equal(seen.stepperAt, 0, 'stepper is stamped before the first phase event');
  assert.deepEqual(seen.phases, ['preflight:start', 'preflight:done', 'done:done']);
  assert.deepEqual(orch.calls.engineRun, [{ resume: null }]);
  assert.equal(orch.state.steps.at(-1).key, 'done');
  // The workflow field of the topology bag is what the audit line renders (P1-c).
  assert.match(auditOf(orch.pipeline.id), /Workflow: \*\*Stub\*\* \(wf_stub\)\./, 'the audit line comes from topology.workflow');
});

test('run(): a key the registry does not know fails preflight through the hook set', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({
    projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true,
    agentKeys: new Set(['planner', 'ghostAgent']),
  });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /agent "ghostAgent" is not installed/);
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
});

test('run(): a topology bag missing `workflow` fails AT THE SEAM, before the engine runs', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true });
  // Exactly what P4's first draft returned: the spec's two fields, no workflow.
  orch._resolveTopology = async () => ({ manifest: { version: 99, steps: [], feedbacks: [] }, agentKeys: new Set(['planner']) });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /engine hook contract: _resolveTopology/);
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
});

test('run(): a pause requested during preflight lands on _enginePrePausePoint and is what resume() will read back', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true });
  orch.on('phase', (p) => { if (p.phase === 'preflight' && p.status === 'done') assert.equal(orch.pause(), true); });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(orch.calls.prePause, 1, 'the engine decided the pre-engine resume point');
  assert.deepEqual(orch.state.resumePoint, { version: 99, kind: 'stub-boundary' });
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'paused');
  assert.equal(JSON.parse(row.resume_point).kind, 'stub-boundary', 'persisted through _completePaused');
});

test('resume(): the shell consumes the _engineRehydrate bag and never reads rp.bus', async () => {
  const dir = await makeRepo();
  const p = await createPipeline(dir, { promptText: 'demo', sourceType: 'prompt' });
  const rp = {
    version: 99, kind: 'stub-boundary', stepIndex: 0, pipelineDir: p.dir,
    stepModels: null, workflowId: 'wf_stub', guardrailsId: 'permissive', toolInstruction: '',
    bus: { code: { baseRef: 'POISON' } }, // v1-shaped field: the shell must ignore it
  };
  const row = {
    id: p.id, status: 'paused', archived_at: null, title: 'demo', started_at: new Date().toISOString(),
    prompt: 'demo', stepper: null, tools: null, branch: null, base_name: 'demo',
    date_prefix: '01-01-26', workspace_meta: null,
  };
  const orch = new StubEngine({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: { row, resumePoint: rp, steps: [] },
  });
  const res = await orch.resume();
  assert.equal(res.status, 'done');
  assert.equal(orch.checkpointRef, 'ref-from-hook');
  assert.deepEqual(orch.calls.rehydrate, [rp]);
  assert.equal(orch.calls.engineRun.length, 1);
  assert.equal(orch.calls.engineRun[0].resume, rp);
  assert.deepEqual(orch.calls.engineRun[0].rehydrated.plan, { marker: 'frozen' });
  assert.deepEqual(
    Object.keys(orch.calls.engineRun[0].rehydrated).sort(),
    ['audit', 'checkpointRef', 'memberWorktrees', 'plan'],
  );
  assert.match(auditOf(p.id), /Pipeline \*\*resumed\*\* \(stub\)\./, 'the resume audit line is the rehydrate bag\'s');
});

test('resume(): a foreign resume point is rejected BY THE HOOK, not by the shell', async () => {
  const dir = await makeRepo();
  const p = await createPipeline(dir, { promptText: 'demo', sourceType: 'prompt' });
  const orch = new StubEngine({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: {
      row: { id: p.id, status: 'paused', archived_at: null, title: 't', started_at: null, prompt: '', stepper: null, tools: null, branch: null, base_name: 'b', date_prefix: 'd', workspace_meta: null },
      resumePoint: { version: 1, kind: 'boundary', pipelineDir: p.dir },
      steps: [],
    },
  });
  await assert.rejects(() => orch.resume(), /stub: unsupported resume point version 1/);
});

test('resume(): a rehydrate bag missing `audit` fails AT THE SEAM, before anything is rehydrated', async () => {
  const dir = await makeRepo();
  const p = await createPipeline(dir, { promptText: 'demo', sourceType: 'prompt' });
  const orch = new StubEngine({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: {
      row: { id: p.id, status: 'paused', archived_at: null, title: 't', started_at: null, prompt: '', stepper: null, tools: null, branch: null, base_name: 'b', date_prefix: 'd', workspace_meta: null },
      resumePoint: { version: 99, kind: 'stub-boundary', stepIndex: 0, pipelineDir: p.dir },
      steps: [],
    },
  });
  // Exactly what P4's first draft returned: the spec's §5.1 fields, no audit —
  // which would otherwise insert an EMPTY pipeline_events row (P1-d).
  orch._engineRehydrate = () => ({ checkpointRef: null, memberWorktrees: [], plan: null });
  await assert.rejects(() => orch.resume(), /engine hook contract: _engineRehydrate/);
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
});
```

- [ ] Step 2: `node --test test/run-harness-hooks.test.mjs`
`Expected: ℹ pass 10`, `ℹ fail 0` (7 measured 2026-08-27 on the reference clone in ~0.7 s + the three contract tests added by the critique and re-execution passes — re-measured in the wave-2 execution; write the printed number).
- [ ] Step 3: **Mutation audit** (revert each after checking): (a) in `run-harness.mjs`, change `this.state.stepper = topology.manifest;` to `this.state.stepper = null;` → the run() test fails on the `deepEqual(orch.state.stepper, …)` assertion; (b) change `this._preflightAgentKeys(topology.agentKeys)` to `this._preflightAgentKeys([])` → the ghostAgent test fails (`res.status === 'done'`); (c) change `_bookend` to a no-op → the phase-sequence assertion fails; (d) change `this._engineRun({ resume: rp, rehydrated })` to `this._engineRun({ resume: rp })` → the resume test fails on `rehydrated.plan`; (e) in the S5 audit line print `topology.workflow.id` where the NAME goes → the run() test fails on the `Workflow: **Stub**` match; (f) in the S10 audit line write a literal string instead of `rehydrated.audit` → the resume test fails on the `Pipeline **resumed** (stub).` match; (g) change `this.state.resumePoint = this._enginePrePausePoint();` (S7) to `= null` → the pre-pause test fails (`actual: 0, expected: 1` on `calls.prePause`). Confirm each failure, then restore. (e)–(g) exist because all three mutations SURVIVED the full suite on the reference clone — S7 survived 3805/3805 — so they are the only thing standing between a wrong hook contract and green. (h) delete the S8 `engine hook contract: _engineRehydrate` guard line in `run-harness.mjs` → the new "rehydrate bag missing `audit`" test fails (`ℹ pass 9 / ℹ fail 1`); it survived the full suite (3809/3809) before that test existed.
- [ ] Step 4: Commit — `worca: Node-graph v2 P1 — run-harness hook contract test`

---

### Task 4: `src/core/engine-select.mjs` — data-driven engine selection

**Files:** create `src/core/engine-select.mjs`, create `test/engine-select.test.mjs` (5 tests). **No call site changes** — `POST /api/run` (`ui/server.mjs:972`; the workflow row is read at `:1062`; factories `:1150` workspace / `:1203` single), `resumeRun` (declared `:1497`, its `createOrchestrator` call `:1560`), CLI run `src/cli/worca-cc.mjs:1526` and `cmdResume` (declared `:724`, its call `:809`) keep calling `createOrchestrator` directly. P4 switches them.

**Interfaces:**
- Produces `selectEngine({templateVersion, resumePointVersion}) → 'v1'|'graph'` (pure) and `async createOrchestratorFor(opts) → orchestrator` whose `.engine` property records the selector's answer (`'v1'|'graph'`) — the instance itself is the v1 orchestrator either way until P4.
- Consumes `readWorkflow(id)` from `./workflows.mjs` (`workflows.mjs:277`, async, returns `DEFAULT_WORKFLOW` for `wf_default` and `null` for an unknown id) and `createOrchestrator` from `./orchestrator.mjs`.

- [ ] Step 1: Write the failing test `test/engine-select.test.mjs`:

```js
// test/engine-select.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { selectEngine, createOrchestratorFor } from '../src/core/engine-select.mjs';

useTempHome(after);

test('selectEngine: version 2 picks the graph engine, everything else v1', () => {
  assert.equal(selectEngine({ templateVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: '2' }), 'graph');
  assert.equal(selectEngine({ templateVersion: 1 }), 'v1');
  assert.equal(selectEngine({ templateVersion: undefined }), 'v1');
  assert.equal(selectEngine({}), 'v1');
  assert.equal(selectEngine(), 'v1');
  assert.equal(selectEngine({ templateVersion: 'two' }), 'v1');
});

test('selectEngine: the resume point wins over the template row', () => {
  assert.equal(selectEngine({ templateVersion: 2, resumePointVersion: 1 }), 'v1');
  assert.equal(selectEngine({ templateVersion: 1, resumePointVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: 2, resumePointVersion: null }), 'graph');
});

test('createOrchestratorFor: async, and builds the v1 orchestrator from a workflow id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const p = createOrchestratorFor({ projectDir: dir, workflowId: 'wf_default', prompt: 'x' });
  assert.ok(p instanceof Promise, 'createOrchestratorFor is async — every call site awaits it');
  const orch = await p;
  assert.equal(typeof orch._dispatch, 'function', 'v1 orchestrator (the v1-only dispatcher is present)');
  assert.equal(orch.workflowId, 'wf_default');
  assert.equal(orch.engine, 'v1', 'the factory records the selector\'s answer for the row it read');
});

test('createOrchestratorFor: an unknown workflow id still yields the v1 orchestrator (no throw)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const orch = await createOrchestratorFor({ projectDir: dir, workflowId: 'wf_nope', prompt: 'x' });
  assert.equal(typeof orch._dispatch, 'function');
});

test('createOrchestratorFor: P1 returns v1 even when the selector says graph (no graph factory yet)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  assert.equal(selectEngine({ resumePointVersion: 2 }), 'graph');
  const orch = await createOrchestratorFor({
    projectDir: dir, workflowId: 'wf_default',
    resume: { row: {}, resumePoint: { version: 2 }, steps: [] },
  });
  assert.equal(typeof orch._dispatch, 'function', 'P4 flips this to GraphOrchestrator');
  assert.equal(orch.engine, 'graph', 'the factory consulted the resume point, not just the row');
});
```

`Expected: FAIL` — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/core/engine-select.mjs'`.

- [ ] Step 2: Implement `src/core/engine-select.mjs`:

```js
// src/core/engine-select.mjs
// Which engine runs a pipeline is decided by DATA — the template's `version`,
// or (on a resume) the frozen resume point's — never by a flag. There is no
// feature flag anywhere in worca's engine selection.
//
// The SELECTOR is final: `selectEngine` already answers 'graph' for version-2
// inputs. The FACTORY is not: no graph engine exists yet, so
// createOrchestratorFor still builds the v1 orchestrator for every input.

import { createOrchestrator } from './orchestrator.mjs';
import { readWorkflow } from './workflows.mjs';

/**
 * @param {{templateVersion?: number|string, resumePointVersion?: number|string}} args
 *   resumePointVersion WINS when present: a resume must run on the engine that
 *   froze the point (the v1 point freezes `plan`, the v2 point freezes the graph
 *   snapshot), whatever the workflow row says today.
 * @returns {'v1'|'graph'}
 */
export function selectEngine({ templateVersion, resumePointVersion } = {}) {
  const raw = resumePointVersion === undefined || resumePointVersion === null
    ? templateVersion
    : resumePointVersion;
  return Number(raw) === 2 ? 'graph' : 'v1';
}

/**
 * Build the orchestrator for `opts`. Reads the resume point's version first,
 * else the workflow row's. Async because the row read is async — every call
 * site awaits it.
 * @param {object} opts createOrchestrator options (+ optional opts.resume)
 * @returns {Promise<object>} an orchestrator instance; its `.engine` is the
 *   selector's answer for the data that was read.
 */
export async function createOrchestratorFor(opts = {}) {
  const resumePointVersion = opts.resume?.resumePoint?.version;
  // `== null`, not `=== undefined`: a stored point carrying `version: null` is
  // "no point" to selectEngine, so the template row must be read for it too.
  const templateVersion = resumePointVersion == null && opts.workflowId
    ? (await readWorkflow(opts.workflowId))?.version
    : undefined;
  const engine = selectEngine({ templateVersion, resumePointVersion });
  // P4 routes 'graph' to createGraphOrchestrator(opts); until then every run is v1.
  const orch = createOrchestrator(opts);
  orch.engine = engine; // the decision the data made, observable by callers and tests
  return orch;
}
```

- [ ] Step 3: `node --test test/engine-select.test.mjs`
`Expected: ℹ pass 5`, `ℹ fail 0` (measured 2026-08-27 — re-measured in the wave-2 execution; write the printed number).
**Mutation check** (apply, watch it bite, revert): gut the factory — `export async function createOrchestratorFor(opts = {}) { await Promise.resolve(); return createOrchestrator(opts); }` (no `readWorkflow`, no `selectEngine`) → the two `orch.engine` assertions go RED. Without them this mutation survives the whole suite, and the module's entire premise — that DATA picks the engine — is untested.
- [ ] Step 4: Commit — `worca: Node-graph v2 P1 — engine-select module`

---

### Task 5: `src/shared/graph/constants.mjs` — the shared v2 vocabulary

**Files:** create `src/shared/graph/constants.mjs` (the first file of the shared core), create `test/graph-constants.test.mjs` (10 tests).

**Interfaces:** produces `TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS, gatePorts(kind, arity), NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS, BOOKEND_EXECUTION_IDS` — consumed by P2's `ports/loops/validate/template/geometry/layout/manifest`, by the composer in P5, and (`BOOKEND_EXECUTION_IDS`) by P6's `run-decor.mjs` + `src/cli/render.mjs` and P8's bookend rows. `KINDS`/`FLOW_KINDS`/`PORT_TYPES` are frozen ARRAYS — consumers test membership with `.includes()`, never `.has()`. Pure: no imports at all.

- [ ] Step 1: Write the failing test — `test/graph-constants.test.mjs` (write the TEST first; the module does not exist yet):

```js
// test/graph-constants.test.mjs — the shared v2 vocabulary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS,
  gatePorts, NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS,
  BOOKEND_EXECUTION_IDS,
} from '../src/shared/graph/constants.mjs';

test('scalars and kind sets', () => {
  assert.equal(TEMPLATE_VERSION, 2);
  assert.equal(DEFAULT_MAX_CYCLES, 3);
  assert.equal(MAX_PORTS_PER_SIDE, 8);
  assert.deepEqual([...KINDS], ['agent', 'task', 'end', 'and', 'or', 'combine']);
  assert.deepEqual([...FLOW_KINDS], ['task', 'end', 'and', 'or', 'combine']);
  assert.deepEqual([...PORT_TYPES], ['md', 'json', 'void', 'any']);
  assert.deepEqual(FLOW_KINDS.filter((k) => !KINDS.includes(k)), [], 'flow kinds are kinds');
  assert.deepEqual(KINDS.filter((k) => !FLOW_KINDS.includes(k)), ['agent']);
});

test('every exported table is deep-frozen (a shared constant no consumer can mutate)', () => {
  for (const v of [KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS, LIMITS]) {
    assert.ok(Object.isFrozen(v));
  }
  assert.ok(Object.isFrozen(TASK_PORTS.outputs) && Object.isFrozen(TASK_PORTS.outputs[0]));
  assert.ok(Object.isFrozen(END_PORTS.inputs[0]));
  assert.throws(() => { KINDS.push('nope'); }, TypeError);
});

test('AWAIT_PORT is the synthesized any-typed optional gate', () => {
  assert.deepEqual({ ...AWAIT_PORT }, { id: 'await', type: 'any', required: false, synthetic: true });
});

test('TASK_PORTS: zero inputs, one always-firing md output named task', () => {
  assert.deepEqual(TASK_PORTS.inputs, []);
  assert.equal(TASK_PORTS.outputs.length, 1);
  assert.deepEqual({ ...TASK_PORTS.outputs[0] }, { id: 'task', type: 'md', when: 'always' });
});

test('END_PORTS: one any-typed required input named result, zero outputs', () => {
  assert.equal(END_PORTS.outputs.length, 0);
  assert.deepEqual({ ...END_PORTS.inputs[0] }, { id: 'result', type: 'any', required: true, loop: false, expands: false });
});

test('gatePorts: in1..inN + out, with the per-kind out type', () => {
  const and = gatePorts('and', 3);
  assert.deepEqual(and.inputs.map((p) => p.id), ['in1', 'in2', 'in3']);
  assert.deepEqual(and.inputs.map((p) => p.type), ['any', 'any', 'any']);
  assert.deepEqual({ ...and.outputs[0] }, { id: 'out', type: 'void', when: 'always' });
  const or = gatePorts('or', 2);
  assert.deepEqual(or.inputs.map((p) => p.type), ['any', 'any']);
  assert.equal(or.outputs[0].type, 'any', 'OR out stays any until resolved from wiring');
  const combine = gatePorts('combine', 2);
  assert.deepEqual(combine.inputs.map((p) => p.type), ['md', 'md']);
  assert.equal(combine.outputs[0].type, 'md');
});

test('gatePorts: arity is clamped to [2, MAX_PORTS_PER_SIDE] and never throws', () => {
  for (const bad of [undefined, null, 0, 1, -4, NaN, 'x', {}]) {
    assert.equal(gatePorts('and', bad).inputs.length, 2, `arity ${String(bad)} -> 2`);
  }
  assert.equal(gatePorts('and', 99).inputs.length, MAX_PORTS_PER_SIDE);
  assert.equal(gatePorts('and', 2.9).inputs.length, 2);
  assert.ok(Object.isFrozen(gatePorts('or', 2)) && Object.isFrozen(gatePorts('or', 2).inputs[0]));
});

test('id shapes: minted ids and the seed graphs both match', () => {
  for (const id of ['n_task', 'n_or', 'n_a1b2c3d4']) assert.match(id, NODE_ID_RE);
  for (const id of ['task', 'N_task', 'n_', 'n_Task', 'w1']) assert.doesNotMatch(id, NODE_ID_RE);
  for (const id of ['w1', 'w17', 'w_a1b2c3d4']) assert.match(id, WIRE_ID_RE);
  for (const id of ['fb_0', 'W1', 'n_task', 'w_']) assert.doesNotMatch(id, WIRE_ID_RE);
  for (const id of ['task', 'revise', 'in1', 'await', 'planStoreSeed']) assert.match(id, PORT_ID_RE);
  for (const id of ['Task', 'in-1', 'in_1', '1in', '', 'x'.repeat(33)]) assert.doesNotMatch(id, PORT_ID_RE);
});

test('BOOKEND_EXECUTION_IDS names the two bookend ledger rows, frozen', () => {
  assert.deepEqual([...BOOKEND_EXECUTION_IDS], ['x:preflight:1', 'x:done:1']);
  assert.ok(Object.isFrozen(BOOKEND_EXECUTION_IDS));
});

test('LIMITS carries the ceilings the validator reads', () => {
  assert.deepEqual(LIMITS, {
    maxNodes: 80, maxWires: 200, maxPortsPerSide: 8, minArity: 2, maxArity: 8, maxCycles: 20, maxNameLen: 80,
  });
});
```


- [ ] Step 2: `node --test test/graph-constants.test.mjs`
`Expected:` FAIL — `Cannot find module '…/src/shared/graph/constants.mjs'` (every test in the file fails on the import).

- [ ] Step 3: Implement `src/shared/graph/constants.mjs`:

```js
// src/shared/graph/constants.mjs
// The frozen vocabulary of the v2 template model: node kinds, port types, the
// synthesized await gate, the flow cards' port tables, id shapes and limits.
// Pure data + one pure function — imported unchanged by the engine, the
// server's 422 path, the tests and the browser (served at /src/shared).

/** Templates this model understands. v1 rows carry `version: 1`. */
export const TEMPLATE_VERSION = 2;

/** Every node kind a template may carry (palette order). */
export const KINDS = Object.freeze(['agent', 'task', 'end', 'and', 'or', 'combine']);

/** The flow cards: every kind that is not a spawned agent. They are pure engine
 *  executions — instant, $0, no spawn. */
export const FLOW_KINDS = Object.freeze(['task', 'end', 'and', 'or', 'combine']);

/** Port payload types. 'any' is engine-internal: it lives only on AND inputs,
 *  OR ports before resolution, End's `result` and the synthesized `await` gate —
 *  never declarable in agent meta. */
export const PORT_TYPES = Object.freeze(['md', 'json', 'void', 'any']);

/** Max ports per side of one card (agent meta inputs/outputs, gate arity). */
export const MAX_PORTS_PER_SIDE = 8;

/** Per-wire loop budget when neither the overlay nor `wire.config` sets one. */
export const DEFAULT_MAX_CYCLES = 3;

/** The universal gate input every agent card gets: synthesized by portsFn and
 *  appended LAST to the agent's declared inputs. Never stored in a template and
 *  never declared in meta ('await' is a reserved port id on both sides). It
 *  accepts a wire from ANY output type and its payload is discarded — pure
 *  sequencing: no file, no renderer, no directive, no mode effect. */
export const AWAIT_PORT = Object.freeze({ id: 'await', type: 'any', required: false, synthetic: true });

/** Task card — the graph's single source: zero inputs, one always-firing md
 *  output carrying the rendered task md. */
export const TASK_PORTS = Object.freeze({
  inputs: Object.freeze([]),
  outputs: Object.freeze([Object.freeze({ id: 'task', type: 'md', when: 'always' })]),
});

/** End card — the graph's single sink: one single-wire input, zero outputs. The
 *  token arriving on its wire completes the run. */
export const END_PORTS = Object.freeze({
  inputs: Object.freeze([Object.freeze({ id: 'result', type: 'any', required: true, loop: false, expands: false })]),
  outputs: Object.freeze([]),
});

/**
 * Ports of a gate card at a given arity. AND is the pure synchronizer (`any`
 * ins, ONE static `void` out, fires when all ins are fresh, payloads discarded);
 * OR is the payload-forwarding valve (fires on any fresh in, re-emits that
 * payload — its in/out types RESOLVE FROM WIRING, so `any` here is the
 * pre-resolution placeholder); Combine is the md AND-join.
 * @param {'and'|'or'|'combine'} kind
 * @param {number} arity clamped to [2, MAX_PORTS_PER_SIDE]
 * @returns {{inputs: Array<object>, outputs: Array<object>}}
 */
export function gatePorts(kind, arity) {
  const n = Math.min(MAX_PORTS_PER_SIDE, Math.max(2, Math.floor(Number(arity)) || 2));
  const inType = kind === 'combine' ? 'md' : 'any';
  const inputs = [];
  for (let i = 1; i <= n; i += 1) {
    inputs.push(Object.freeze({ id: `in${i}`, type: inType, required: true, loop: false, expands: false }));
  }
  const outType = kind === 'and' ? 'void' : kind === 'combine' ? 'md' : 'any';
  return Object.freeze({
    inputs: Object.freeze(inputs),
    outputs: Object.freeze([Object.freeze({ id: 'out', type: outType, when: 'always' })]),
  });
}

/** Minted node ids are `n_` + 8 base36; the seed graphs use readable `n_<word>`
 *  ids. Both shapes match. */
export const NODE_ID_RE = /^n_[a-z0-9]{1,32}$/;

/** Minted wire ids are `w_` + 8 base36; the seed graphs use `w1`..`w17`. Both
 *  shapes match — the underscore is optional. */
export const WIRE_ID_RE = /^w_?[a-z0-9]{1,32}$/;

/** Port ids are lowerCamel, at most 32 chars (`task`, `revise`, `in1`, `await`). */
export const PORT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/;

/** The two ledger rows every run writes for its own bookends (P8 makes them
 *  `exec` rows keyed exactly so). Shared by the run monitor and the CLI so
 *  neither counts them as executions or progress. */
export const BOOKEND_EXECUTION_IDS = Object.freeze(['x:preflight:1', 'x:done:1']);

/** Structural ceilings the validator enforces (override per call with
 *  `validateGraph(tpl, portsFn, { limits })`). */
export const LIMITS = Object.freeze({
  maxNodes: 80,
  maxWires: 200,
  maxPortsPerSide: MAX_PORTS_PER_SIDE,
  minArity: 2,
  maxArity: MAX_PORTS_PER_SIDE,
  maxCycles: 20,
  maxNameLen: 80,
});
```

- [ ] Step 4: `node --test test/graph-constants.test.mjs`
`Expected: ℹ pass 10`, `ℹ fail 0` (measured 2026-08-27 on the reference clone; re-measured in the wave-2 execution).

- [ ] Step 5: Commit — `worca: Node-graph v2 P1 — shared graph constants`

---

### Task 6: `src/shared/graph/verdict.mjs` — the verdict helpers move out of `protocol.mjs`

**Why:** `protocol.mjs:8` imports `node:fs/promises`, so it can never load in a browser — yet the composer, the run monitor and the validator all need the verdict vocabulary. The move is the reason the shared core exists.

**Files:**
- create `src/shared/graph/verdict.mjs`
- modify `src/core/protocol.mjs` — delete `SEVERITIES :15`, `BLOCKING :17`, `normalizeSeverity :20-24`, `hasBlocking :244-247`, `blockingIssues :254-257`; re-export all five from the new module and import `normalizeSeverity` for its own use at `:214`.
- create `test/graph-verdict.test.mjs` (5 tests)

**Interfaces:** produces `SEVERITIES, BLOCKING, normalizeSeverity, hasBlocking, blockingIssues`. Every existing importer keeps its import path: `src/core/runners.mjs:35` (`hasBlocking, blockingIssues`), `src/core/orchestrator.mjs:81` → after Task 2 the v1 import block (`hasBlocking, blockingIssues, readQuestionsFile`), `test/workspace-mock.test.mjs:15` (`hasBlocking`). Nothing else in the tree imports these names from `protocol.mjs` (verified: `grep -rn "SEVERITIES\|normalizeSeverity\|hasBlocking\|blockingIssues" src/ ui/ test/` — the other hits are the unrelated `summary.blockingIssues` COUNT field of `results.mjs`, and `workflows.mjs:452`'s `gate: 'hasBlocking'` STRING).

- [ ] Step 1: Create `src/shared/graph/verdict.mjs` — the five symbols moved VERBATIM (same bodies, same JSDoc; `SEVERITIES` stays a plain array and `BLOCKING` a plain `Set`, exactly as on dev — this is a move, not a redesign):

```js
// src/shared/graph/verdict.mjs
// The verdict vocabulary: severities, what blocks, and the two readers the
// engine's conditional outputs (`when: blocking|clean`) and the UI both need.
// Moved verbatim out of src/core/protocol.mjs, which re-exports them: protocol
// imports node:fs/promises, so it can never be loaded in a browser, and the
// composer/run monitor need exactly these five symbols.

/**
 * Severity ranking used throughout the pipeline. Order is significant:
 * earlier entries are more severe. "critical" and "major" are *blocking*.
 */
export const SEVERITIES = ['critical', 'major', 'minor', 'suggestion'];

export const BLOCKING = new Set(['critical', 'major']);

/** Normalize an arbitrary value to one of SEVERITIES (default "minor"). */
export function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'minor';
  const v = value.trim().toLowerCase();
  return SEVERITIES.includes(v) ? v : 'minor';
}

/**
 * True if a review contains any critical or major issue.
 * @param {{issues: Array}} review
 * @returns {boolean}
 */
export function hasBlocking(review) {
  if (!review || !Array.isArray(review.issues)) return false;
  return review.issues.some((i) => BLOCKING.has(normalizeSeverity(i?.severity)));
}

/**
 * The subset of issues that are critical or major.
 * @param {{issues: Array}} review
 * @returns {Array}
 */
export function blockingIssues(review) {
  if (!review || !Array.isArray(review.issues)) return [];
  return review.issues.filter((i) => BLOCKING.has(normalizeSeverity(i?.severity)));
}
```

- [ ] Step 2: In `src/core/protocol.mjs`, replace the block at `:11-24` (the `SEVERITIES` JSDoc through the end of `normalizeSeverity`) with:

```js
// The verdict vocabulary lives in the browser-safe shared core (this module
// imports node:fs/promises and can never be loaded in a browser); re-exported
// here so every existing importer of protocol.mjs keeps working unchanged.
export {
  SEVERITIES, BLOCKING, normalizeSeverity, hasBlocking, blockingIssues,
} from '../shared/graph/verdict.mjs';
import { normalizeSeverity } from '../shared/graph/verdict.mjs';
```

and DELETE the two function blocks (`hasBlocking` with its JSDoc, `blockingIssues` with its JSDoc) at the end of the file. Import only `normalizeSeverity` for local use (`:214` in `normalizeReview`) — importing `BLOCKING` too would leave a dangling binding.

- [ ] Step 3: The test — `test/graph-verdict.test.mjs`:

```js
// test/graph-verdict.test.mjs — the verdict vocabulary, and the proof that
// protocol.mjs and the shared core are ONE source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as verdict from '../src/shared/graph/verdict.mjs';
import * as protocol from '../src/core/protocol.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('severities and the blocking set', () => {
  assert.deepEqual(verdict.SEVERITIES, ['critical', 'major', 'minor', 'suggestion']);
  assert.deepEqual([...verdict.BLOCKING].sort(), ['critical', 'major']);
  assert.ok(verdict.SEVERITIES.slice(0, 2).every((s) => verdict.BLOCKING.has(s)));
  assert.ok(verdict.SEVERITIES.slice(2).every((s) => !verdict.BLOCKING.has(s)));
});

test('normalizeSeverity: trims, lowercases, defaults to minor', () => {
  assert.equal(verdict.normalizeSeverity('  CRITICAL '), 'critical');
  assert.equal(verdict.normalizeSeverity('Major'), 'major');
  assert.equal(verdict.normalizeSeverity('nonsense'), 'minor');
  for (const bad of [undefined, null, 3, {}, []]) assert.equal(verdict.normalizeSeverity(bad), 'minor');
});

test('hasBlocking / blockingIssues read a review tolerantly', () => {
  const review = { issues: [{ severity: 'minor' }, { severity: ' Major ' }, { severity: 'suggestion' }] };
  assert.equal(verdict.hasBlocking(review), true);
  assert.deepEqual(verdict.blockingIssues(review), [{ severity: ' Major ' }]);
  assert.equal(verdict.hasBlocking({ issues: [{ severity: 'minor' }] }), false);
  assert.deepEqual(verdict.blockingIssues({ issues: [{ severity: 'minor' }] }), []);
  for (const bad of [null, undefined, {}, { issues: 'x' }]) {
    assert.equal(verdict.hasBlocking(bad), false);
    assert.deepEqual(verdict.blockingIssues(bad), []);
  }
  // An unknown severity normalizes to minor => never blocking.
  assert.equal(verdict.hasBlocking({ issues: [{ severity: 'catastrophic' }] }), false);
});

test('protocol.mjs re-exports the SAME function objects (one source, no copy)', () => {
  assert.equal(protocol.hasBlocking, verdict.hasBlocking);
  assert.equal(protocol.blockingIssues, verdict.blockingIssues);
  assert.equal(protocol.normalizeSeverity, verdict.normalizeSeverity);
  assert.equal(protocol.SEVERITIES, verdict.SEVERITIES);
  assert.equal(protocol.BLOCKING, verdict.BLOCKING);
});

test('protocol.readReview still normalizes severities through the moved helper', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-verdict-'));
  const file = join(dir, 'review.json');
  await writeFile(file, JSON.stringify({ summary: 's', issues: [{ severity: 'CRITICAL', title: 't' }] }), 'utf8');
  const r = await protocol.readReview(file);
  assert.equal(r.issues[0].severity, 'critical');
  assert.equal(protocol.hasBlocking(r), true);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] Step 4: `node --test test/graph-verdict.test.mjs test/runners.test.mjs test/workspace-mock.test.mjs`
`Expected: ℹ fail 0` — 22 tests measured 2026-08-27 (5 new + the two unchanged importer suites).
- [ ] Step 5: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail) '`
`Expected:` green at **BASELINE + 32** (Task 1: 2, Task 3: 10, Task 4: 5, Task 5: 10, Task 6: 5) — re-measured in the wave-2 execution; write the printed number. The point of this step is that NOTHING regressed: the total must be BASELINE plus exactly the tests those five tasks added.
- [ ] Step 6: Commit — `worca: Node-graph v2 P1 — move the verdict helpers into the shared core`

---

### Task 7: `test/shared-graph-purity.test.mjs` — the purity guard

**Files:** create `test/shared-graph-purity.test.mjs` (3 tests). No production code changes.

**Interfaces:** none produced; it constrains every future file under `src/shared/**` (P2 adds nine more) and every `ui/public` import that leaves the static root (P5).

- [ ] Step 1: Write the guard:

```js
// test/shared-graph-purity.test.mjs
// src/shared/** is the ONE source of the graph model for server + browser, so
// it must stay pure ESM: relative imports that never leave src/shared, no
// node: builtins, no DOM, no module-level mutable state. And every ui/public
// specifier that leaves the static root must land inside src/shared at a URL
// equal to its disk path — which is exactly what the /src/shared mount serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED = path.join(ROOT, 'src/shared');
const PUBLIC = path.join(ROOT, 'ui/public');
const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.(mjs|js)$/.test(e.name) && out.push(p); } return out; };
const specs = (src) => [...src.matchAll(IMPORT_RE)].map((m) => m[1] || m[2]);
const posix = (p) => p.split(path.sep).join('/');

test('src/shared/graph holds the shared core (the guard is never vacuous)', () => {
  const names = walk(SHARED).map((f) => posix(path.relative(SHARED, f)));
  for (const required of ['graph/constants.mjs', 'graph/verdict.mjs']) {
    assert.ok(names.includes(required), `src/shared/${required} must exist`);
  }
});

test('src/shared/** is pure, relative-only, self-contained, stateless ESM', () => {
  const files = walk(SHARED);
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Specifiers are read from the RAW source; the token rules run on a
    // comment-stripped copy, so ordinary prose ("the task document.", "the
    // process.") in a JSDoc block cannot fail the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    for (const s of specs(src)) {
      assert.match(s, /^\.\.?\//, `${f}: non-relative import "${s}"`);
      const t = path.resolve(path.dirname(f), s);
      assert.ok(t.startsWith(SHARED + path.sep) && statSync(t).isFile(), `${f}: "${s}" leaves src/shared or is missing`);
    }
    for (const [label, re] of [
      ['node: builtin', /['"]node:/], ['require()', /\brequire\s*\(/], ['process', /\bprocess\./],
      ['DOM global', /\b(window|document|navigator|localStorage)\b/], ['fetch', /\bfetch\s*\(/],
      ['import.meta', /import\.meta\b/], ['top-level mutable binding', /^(let|var)\s/m],
    ]) assert.doesNotMatch(code, re, `${f}: ${label}`);
  }
});

test('ui/public leaves the static root only into src/shared, at the URL the mount serves', () => {
  for (const f of walk(PUBLIC)) {
    for (const s of specs(readFileSync(f, 'utf8'))) {
      if (/^https?:|^\/vendor\//.test(s)) continue;
      assert.match(s, /^\.\.?\//, `${f}: "${s}" must be relative (absolute specifiers break Node)`);
      const onDisk = path.resolve(path.dirname(f), s);
      if (onDisk.startsWith(PUBLIC + path.sep)) continue;
      assert.ok(onDisk.startsWith(SHARED + path.sep), `${f}: "${s}" escapes ui/public but not into src/shared`);
      const url = new URL(s, 'http://x/' + posix(path.relative(PUBLIC, f))).pathname;
      assert.equal(url, '/' + posix(path.relative(ROOT, onDisk)), `${f}: browser URL != disk path`);
    }
  }
});
```

Test 3's escape-branch assertions have nothing to check at P1 (no `ui/public` specifier leaves the static root until P2's `model.mjs`); they are proven live by injected-import mutations — measured RED on the reference clone with `ui/public/log-line.mjs` importing `../../src/core/protocol.mjs`, and again with a bare `'lodash-es'` specifier — and become load-bearing from P2. What DOES run on real files today is its "every specifier is relative" arm.

- [ ] Step 2: `node --test test/shared-graph-purity.test.mjs`
`Expected: ℹ pass 3`, `ℹ fail 0` (measured 2026-08-27 against the real tree: 23 `ui/public` specifiers, zero false positives).
- [ ] Step 3: **Mutation step (required).** Inject an impure file and watch the guard bite:
`printf "import { join } from 'node:path';\nexport const X = join('a','b');\n" > src/shared/graph/mutant.mjs && node --test test/shared-graph-purity.test.mjs; rm src/shared/graph/mutant.mjs`
`Expected:` the purity test FAILS with `…/src/shared/graph/mutant.mjs: non-relative import "node:path"` (the relative-import assertion runs before the `node:`-builtin regex; both pin the same rule); after `rm`, re-run → `ℹ pass 3`. (At P1 `ui/public` has no shared imports yet, which is why test 1 exists: without it the walk could pass on an empty tree.)
Second mutation (the DOM rule, which now reads a comment-stripped copy — so it must be exercised in CODE): append `export const DOM_PROBE = typeof document;` to `src/shared/graph/constants.mjs` → the purity test fails with `constants.mjs: DOM global`; revert. The same words inside a comment must NOT fail — that is the point of the stripping.
- [ ] Step 4: Commit — `worca: Node-graph v2 P1 — shared-core purity guard`

---

### Task 8: serve `/src/shared` (mount + 404 tail)

**Files:**
- modify `ui/server.mjs` — insert between the `/vendor` 404 tail (ends `:769`) and `app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));` (`:771`). `PROJECT_ROOT` is `:164` (`path.resolve(__dirname, '..')`), `path` is imported at `:11` — nothing else is needed.
- create `test/api-shared-static.test.mjs` (4 tests)

**Interfaces:** produces the URL contract `GET /src/shared/<repo-relative path>` → the file, `application/javascript`, `nosniff`; anything else under `/src/shared` → 404 `text/plain` `Not found`. P5's `ui/public/graph/*.mjs` import through it.

- [ ] Step 1: The insert. Dev `ui/server.mjs:766-771` reads:

```js
app.use('/vendor', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
```

Insert between them:

```js
// src/shared/** is the ONE source of the graph model for server + browser
// (no build step). ui modules import it by relative path that walks above
// ui/public; the browser clamps that URL at '/', so it must be served here at
// exactly the repo-relative path. The 404 tail keeps a typo'd path from
// falling through to the SPA index.html (which Chrome reports as a MIME error).
const SHARED_DIR = path.join(PROJECT_ROOT, 'src', 'shared');
app.use('/src/shared', express.static(SHARED_DIR, {
  index: false,
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/src/shared', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
});
```

- [ ] Step 2: The test — `test/api-shared-static.test.mjs`. It uses the same boot recipe every other `api-*` suite uses (`test/api-hljs-assets.test.mjs:7-38`): `useTempHome(after)` from `test/helpers/temp-home.mjs`, `await import('../ui/server.mjs')`, `http.createServer(mod.app)`, `listen(0, '127.0.0.1')` — the loopback Host is what gets past the DNS-rebinding guard at `ui/server.mjs:711-716`.

```js
// test/api-shared-static.test.mjs
// The /src/shared mount: every file of the shared graph core is served to the
// browser at exactly its repo-relative path, as a module, with nosniff — and a
// typo'd path 404s as text/plain instead of falling through to the SPA shell
// (which the browser reports as an opaque MIME error).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED = path.join(ROOT, 'src/shared');
// Only .mjs: a gitignored Finder .DS_Store (invisible to CI, common on macOS) is
// ignored by express.static's dotfile rule and would 404 this walk's first test.
const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.mjs$/.test(e.name) && out.push(p); } return out; };
const posix = (p) => p.split(path.sep).join('/');

let srv;
let base;

before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { srv.off('error', reject); resolve(); });
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((resolve) => { srv.close(resolve); srv.closeAllConnections(); });
});

test('every shared file is served as a module at its repo-relative path', async () => {
  const files = walk(SHARED);
  assert.ok(files.length >= 2, 'the shared core is not empty');
  for (const f of files) {
    const url = `/src/shared/${posix(path.relative(SHARED, f))}`;
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type') || '', /javascript/i, url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(await res.text(), readFileSync(f, 'utf8'), `${url} body == file`);
  }
});

test('a missing shared path 404s as text/plain, never the SPA shell', async () => {
  for (const url of ['/src/shared/graph/nope.mjs', '/src/shared/graph/', '/src/shared/']) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 404, url);
    assert.match(res.headers.get('content-type') || '', /text\/plain/, url);
    const body = await res.text();
    assert.equal(body, 'Not found', url);
    assert.doesNotMatch(body, /<!doctype html>/i, url);
  }
});

test('the mount cannot serve outside src/shared (raw, un-normalized paths)', async () => {
  // fetch() normalizes '..' away client-side, so ask the socket directly.
  const raw = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  for (const p of ['/src/shared/../core/db.mjs', '/src/shared/%2e%2e/core/db.mjs',
    '/src/shared/graph/../../core/db.mjs',
    '/src/shared/core/db.mjs' /* no dot-segments: what a WIDENED ROOT would serve */]) {
    const res = await raw(p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.body, /node:sqlite/, `${p} must never serve a src/core module`);
  }
});

test('the SPA fallback still serves the app shell for a normal route', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});
```

- [ ] Step 3: `node --test test/api-shared-static.test.mjs`
`Expected: ℹ pass 4`, `ℹ fail 0` (measured 2026-08-27; express 4.22.2 → send → mime 1.6.0 serves `.mjs` as `application/javascript`).
- [ ] Step 4: Mutation check (two, revert each): delete the 404-tail `app.use` block and re-run → the 404 test fails on its `404` status assertion (the SPA shell answers 200 `text/html`); then widen BOTH the mount path and its root — `const SHARED_DIR = path.join(PROJECT_ROOT, 'src');` and `app.use('/src', express.static(SHARED_DIR, {` → the traversal test fails on its `404` status assertion (`actual: 200`, because `/src/shared/graph/../../core/db.mjs` now resolves inside `src/`). Widening only the ROOT is a different mutation: it turns test 1 RED (`actual: 404, expected: 200`), since every shared file moves out from under the mount — and, with the no-dot-segment probe `/src/shared/core/db.mjs` in the list, the traversal test ALSO goes red (`actual: 200`, body contains `node:sqlite`). That probe exists because `fetch` normalizes `..` before the request reaches Express and `send` refuses any literal `..` with 403 (falling through to the 404 tail), so the three `..` probes alone cannot detect a wrong root. Restore both — **by editing the text back** (or from a `cp ui/server.mjs /tmp/server.bak` snapshot taken before the first mutation), NOT with `git checkout -- ui/server.mjs`: this task is not committed yet, so a checkout reverts to HEAD and silently discards Step 1's mount too (the next mutation then reports an anchor miss instead of a test failure).
- [ ] Step 5: Commit — `worca: Node-graph v2 P1 — serve the shared graph core at /src/shared`

---

### Task 9: the 8 shipping graphs as frozen constants

**Files:** create `src/core/graph/builtin-workflows.mjs` (49 lines) and `src/core/graph/seed-templates.mjs` (318 lines). No callers in P1: they are data the V24 migration (P8) inserts and the engine (P3/P4) runs.

**Interfaces:** produces `deepFreeze(value)`, `GRAPH_DEFAULT_WORKFLOW` (final id `wf_default`), `SEED_TEMPLATES` (the P2 sentinel), `NODE_ID_MAP`, `FB_WIRE_MAP`.

Both files are copied VERBATIM from the discarded branch (`old:src/core/graph/seed-templates.mjs`, `old:src/core/graph/builtin-workflows.mjs`) — they were hand-authored against the user's real v1 rows and re-verified against Amendment f on 2026-08-26. They are embedded in full below because the old branch may not be present at execution time. **Do not "fix" the stale `V17` references in the comments** — the migration is V24 in P8, but byte-identity with the borrowed file is the checkable property here; P8 updates the comments when it writes the migration.

- [ ] Step 1: Write BOTH files from the code blocks embedded below (Steps 2–3) — that is what a no-network execution types — and then verify the PLAN's copies against the old branch, which is the check that can actually fail:
`git show origin/worca-cc/v2-orchestrator-bfb6a0ed:src/core/graph/seed-templates.mjs | diff - src/core/graph/seed-templates.mjs && git show origin/worca-cc/v2-orchestrator-bfb6a0ed:src/core/graph/builtin-workflows.mjs | diff - src/core/graph/builtin-workflows.mjs && echo IDENTICAL`
`Expected: IDENTICAL` — run it AFTER writing the files from the plan, never after a `git show … > file` (that compares a blob to itself and can never fail). Measured 2026-08-27: the embedded blocks are byte-identical to both branch files. If the branch is NOT available, skip the check — Task 10's structural tests are the acceptance gate either way.
  - OPTIONAL shortcut, only if the branch is present and you would rather not retype: `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:src/core/graph/builtin-workflows.mjs > src/core/graph/builtin-workflows.mjs` and the same for `seed-templates.mjs`. The plan's blocks stay authoritative; the identity check above then proves nothing, so do not report it as passed.

- [ ] Step 2: `src/core/graph/builtin-workflows.mjs`:

```js
// src/core/graph/builtin-workflows.mjs
// The SHIPPING builtin workflow: wf_default as a version-2 template. This is the
// constant the seeder writes and the V17 migration reconciles against — not a
// test fixture. `fixtures.mjs` re-exports it as FIXTURE_DEFAULT so the engine
// tests and the shipping default can never drift apart.
//
// Pure data + one pure helper — no IO, no imports, no dependency on the registry.

/** Recursively freeze a value and everything reachable from it, returning the
 *  same reference. A shallow `Object.freeze` is NOT enough here: it passes
 *  `Object.isFrozen(template)` while `template.nodes[0].x = 999` mutates the
 *  shipping constant silently, which is exactly what a frozen constant exists to
 *  prevent. Primitives and null pass straight through. */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** wf_default as a version-2 graph. w5 (refine self-loop) and w9 (review -> fix)
 *  are the loop wires; w10 lands the clean review on the End node. */
export const GRAPH_DEFAULT_WORKFLOW = deepFreeze({
  id: 'wf_default',
  name: 'Default',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 320, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 200, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 880, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1160, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1440, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1720, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});
```

- [ ] Step 3: `src/core/graph/seed-templates.mjs` — header + the first two seeds. The file is printed as THREE fenced blocks (this step and the two that follow): join them with EXACTLY ONE blank line between blocks — the file is 318 lines; an identity `diff` that shows only blank-line hunks (`111d110` / `187d185`) means the joins were dropped, not that content drifted:

```js
// src/core/graph/seed-templates.mjs
// The 7 hand-written v2 seed templates the V17 migration re-seeds the user's
// saved pipelines as, plus the static overlay-migration maps.
//
// Each entry is a FLAT Template object — `{ id, name, version, domain, createdAt,
// nodes, wires }` at the TOP level, never nested under `graph`. Flat is
// load-bearing: validateGraph runs on the whole template and V1 reads `version`
// off the object it is handed.
//
// Shape rules the graphs follow (a copy-check, not an authoring recipe — these
// were hand-authored and verified against the v1 rows):
//   - Every template has a Task source node and exactly ONE End node, wired from
//     `webui.pass` where a webui node exists, else `reviewer.pass`.
//   - `implementer.done -> reviewer.done`, `reviewer.pass -> checklist.await` and
//     `checklist.checklist -> webui.checklist` reproduce v1's linear order; refine
//     self-loops and review loops carry `config.maxCycles: 3`.
//   - The double-loop templates (wf_full, wf_provided-plan, wf_full-no-decompose)
//     fan `reviewer.review -> n_or.in1` and `webui.review -> n_or.in2` — each
//     in-wire keeps its OWN maxCycles, because those are the loop wires and the
//     gate sites — while `n_or.out -> implementer.fix` carries NO config
//     (maxCycles on an always-sourced wire fails V13). wf_no-clarify has no or
//     card: only w10 targets `fix`, and `webui.review` is UNWIRED, matching its
//     two-feedback v1 row.
//
// Parity note: the OR in-wires keep their v1-era wire ids and budgets, so source
// firings, per-wire delivery counts and gate sites are identical to the direct
// wire shape; the OR adds one $0 instant exec row per loop emission and forwards
// the identical review path to `fix`.

import { deepFreeze } from './builtin-workflows.mjs';

/** Full: clarify -> plan -> refine -> decompose -> implement -> review ->
 *  checklist -> web UI, with both review loops fanned through the or card.
 *  11 nodes / 17 wires. */
const WF_FULL = {
  id: 'wf_full',
  name: 'Full',
  version: 2,
  domain: 'coding',
  createdAt: '2026-07-29T19:39:27.650Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 960, y: 198, config: {} },
    { id: 'n_decompose', kind: 'agent', key: 'decomposer', x: 1260, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1560, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1860, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 2160, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2460, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2760, y: 198, config: {} },
    { id: 'n_or', kind: 'or', x: 2010, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_decompose', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w8', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w9', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w10', from: { node: 'n_decompose', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w11', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w12', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w13', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w14', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w15', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w16', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w17', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};

/** No Clarify: Full minus the clarify node, and with only ONE feedback into
 *  `fix` — w10 reviewer.review. `webui.review` is deliberately unwired, matching
 *  the v1 row's two feedbacks. 9 nodes / 13 wires. */
const WF_NO_CLARIFY = {
  id: 'wf_no-clarify',
  name: 'No Clarify',
  version: 2,
  domain: 'coding',
  createdAt: '2026-07-29T19:40:22.212Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 660, y: 198, config: {} },
    { id: 'n_decompose', kind: 'agent', key: 'decomposer', x: 960, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1260, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1560, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1860, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2160, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2460, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w3', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_decompose', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w8', from: { node: 'n_decompose', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w9', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w10', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w11', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w12', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w13', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};
```

```js
/** Provided Plan: no planner — the task node carries `planStoreSeed` (A2) and
 *  wires straight into `refiner.plan`. 9 nodes / 14 wires. */
const WF_PROVIDED_PLAN = {
  id: 'wf_provided-plan',
  name: 'Provided Plan',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-07T11:29:56.074Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: { planStoreSeed: true } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 360, y: 198, config: {} },
    { id: 'n_decompose', kind: 'agent', key: 'decomposer', x: 660, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 960, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1260, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1560, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 1860, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2160, y: 198, config: {} },
    { id: 'n_or', kind: 'or', x: 1410, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w2', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w3', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_decompose', port: 'plan' } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w7', from: { node: 'n_decompose', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w11', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w12', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w13', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w14', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};

/** FULL-NO-Decompose: Full minus the decomposer, so the implementer takes the
 *  whole plan. 10 nodes / 15 wires. */
const WF_FULL_NO_DECOMPOSE = {
  id: 'wf_full-no-decompose',
  name: 'FULL-NO-Decompose',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-08T00:02:32.776Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 960, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1260, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1560, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1860, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2160, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2460, y: 198, config: {} },
    { id: 'n_or', kind: 'or', x: 1710, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w9', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w10', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w11', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w12', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w13', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w14', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w15', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};
```

```js
/** Quick Fix: plan -> implement -> review, no refiner, no checklist. The
 *  reviewer's only other input is the VOID `done` port, which is why it stays
 *  warning-free under V18 (exemption (b)). 5 nodes / 6 wires. */
const WF_QUICK_FIX = {
  id: 'wf_quick-fix',
  name: 'Quick Fix',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-09T14:40:59.262Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 660, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 960, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1260, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** Clarify -> Implement: clarify -> plan -> refine -> implement -> review.
 *  7 nodes / 10 wires. */
const WF_CLARIFY_IMPLEMENT = {
  id: 'wf_clarify-implement',
  name: 'Clarify -> Implement',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-09T15:16:43.806Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 960, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1260, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1560, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1860, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** Clarify -> Quick Fix: Quick Fix with a clarify step in front. 6 nodes /
 *  8 wires. */
const WF_CLARIFY_QUICK_FIX = {
  id: 'wf_clarify-quick-fix',
  name: 'Clarify -> Quick Fix',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-09T15:18:40.077Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 960, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1260, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1560, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w5', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w7', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w8', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The 7 seeds, in seeding order. */
export const SEED_TEMPLATES = deepFreeze([
  WF_FULL,
  WF_NO_CLARIFY,
  WF_PROVIDED_PLAN,
  WF_FULL_NO_DECOMPOSE,
  WF_QUICK_FIX,
  WF_CLARIFY_IMPLEMENT,
  WF_CLARIFY_QUICK_FIX,
]);

/** V17 overlay migration: `config_workflow_nodes.node_id` rewrites, old v1 step
 *  id -> v2 node id. wf_default is included for projects carrying overlays on
 *  the builtin default workflow. */
export const NODE_ID_MAP = deepFreeze({
  wf_full: { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_decompose', s4_0: 'n_impl', s5_0: 'n_review', s6_0: 'n_check', s7_0: 'n_webui' },
  'wf_no-clarify': { s0_0: 'n_plan', s1_0: 'n_refine', s2_0: 'n_decompose', s3_0: 'n_impl', s4_0: 'n_review', s5_0: 'n_check', s6_0: 'n_webui' },
  'wf_provided-plan': { s0_0: 'n_refine', s1_0: 'n_decompose', s2_0: 'n_impl', s3_0: 'n_review', s4_0: 'n_check', s5_0: 'n_webui' },
  'wf_full-no-decompose': { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_impl', s4_0: 'n_review', s5_0: 'n_check', s6_0: 'n_webui' },
  'wf_quick-fix': { s0_0: 'n_plan', s1_0: 'n_impl', s2_0: 'n_review' },
  'wf_clarify-implement': { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_impl', s4_0: 'n_review' },
  'wf_clarify-quick-fix': { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_impl', s3_0: 'n_review' },
  wf_default: { s_clarify: 'n_clarify', s0_0: 'n_plan', s1_0: 'n_refine', s2_0: 'n_impl', s3_0: 'n_review' },
});

/** V17 overlay migration: `config_workflow_feedbacks` -> `config_workflow_wires`
 *  rows, old feedback id -> v2 wire id. Wire ids reflect Amendment f as revised
 *  (single-wire inputs; the double-loop seeds' blocking wires keep their ids as
 *  the OR valve's in-wires — exactly where budgets and gates now count, so
 *  migrated overlays land correctly by construction).
 *
 *  wf_no-clarify's fb_0 is the refine self-wire and fb_1 the review loop wire —
 *  the user's max_cycles=6 overlays ride those two. wf_clarify-implement's fb
 *  order is BELIEVED swapped in the DB and is UNVERIFIED (that template is absent
 *  from the reference DB); V17's dynamic resolver, not this row, is what makes
 *  the migration safe. */
export const FB_WIRE_MAP = deepFreeze({
  wf_full: { fb_0: 'w5', fb_1: 'w12', fb_2: 'w15' },
  'wf_no-clarify': { fb_0: 'w3', fb_1: 'w10' },
  'wf_provided-plan': { fb_0: 'w2', fb_1: 'w9', fb_2: 'w12' },
  'wf_full-no-decompose': { fb_0: 'w5', fb_1: 'w10', fb_2: 'w13' },
  'wf_quick-fix': { fb_0: 'w5' },
  'wf_clarify-implement': { fb_0: 'w9', fb_1: 'w5' },
  'wf_clarify-quick-fix': { fb_0: 'w7' },
  wf_default: { fb_refine: 'w5', fb_review: 'w9' },
});
```

- [ ] Step 4: `node --check src/core/graph/seed-templates.mjs && node --check src/core/graph/builtin-workflows.mjs && node -e "import('./src/core/graph/seed-templates.mjs').then(m => console.log(m.SEED_TEMPLATES.map(t => t.id + ':' + t.nodes.length + '/' + t.wires.length).join(' ')))"`
`Expected:` `wf_full:11/17 wf_no-clarify:9/13 wf_provided-plan:9/14 wf_full-no-decompose:10/15 wf_quick-fix:5/6 wf_clarify-implement:7/10 wf_clarify-quick-fix:6/8`
- [ ] Step 5: Commit — `worca: Node-graph v2 P1 — the 8 shipping graphs as frozen constants`

---

### Task 10: `test/graph-seed-templates.test.mjs` — the structural invariants

**Files:** create `test/graph-seed-templates.test.mjs` (11 tests). No production code changes.

**Interfaces:** consumes `SEED_TEMPLATES/NODE_ID_MAP/FB_WIRE_MAP` (Task 9), `GRAPH_DEFAULT_WORKFLOW/deepFreeze` (Task 9), `NODE_ID_RE/WIRE_ID_RE/PORT_ID_RE/TEMPLATE_VERSION` (Task 5) and the REAL v1 `DEFAULT_WORKFLOW` (`src/core/workflows.mjs`, unchanged by this plan — it is what makes the `wf_default` overlay pins non-circular). The zero-errors/zero-warnings `validateGraph` drift guard against the REAL sidecars is **P2's**, not this task's — P1 has no validator.

- [ ] Step 1: Write the test:

```js
// test/graph-seed-templates.test.mjs
// The 8 shipping graphs (7 seeds + the graph default) are frozen DATA that the
// V24 migration will insert and the engine will run. These are the structural
// invariants Amendment f pins; the zero-errors/zero-warnings validateGraph
// drift guard against the real sidecars lands with the validator (P2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW, deepFreeze } from '../src/core/graph/builtin-workflows.mjs';
import { NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, TEMPLATE_VERSION } from '../src/shared/graph/constants.mjs';
import { DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';

const ALL = [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW];
const byId = Object.fromEntries(ALL.map((t) => [t.id, t]));
const PINS = {
  wf_full: [11, 17],
  'wf_no-clarify': [9, 13],
  'wf_provided-plan': [9, 14],
  'wf_full-no-decompose': [10, 15],
  'wf_quick-fix': [5, 6],
  'wf_clarify-implement': [7, 10],
  'wf_clarify-quick-fix': [6, 8],
  wf_default: [7, 10],
};
const VALVE = new Set(['and', 'or', 'combine']);
const node = (t, id) => t.nodes.find((n) => n.id === id);

/** The loop each v1 feedback id names, by ROLE — the pairing the static map encodes. */
const LOOP_OF = {
  refine: ['refiner', 'refiner'], review: ['reviewer', 'implementer'], webui: ['manualWebUiTesting', 'implementer'],
};
const EXPECTED_FB = {
  wf_full: { fb_0: 'refine', fb_1: 'review', fb_2: 'webui' },
  'wf_no-clarify': { fb_0: 'refine', fb_1: 'review' },
  'wf_provided-plan': { fb_0: 'refine', fb_1: 'review', fb_2: 'webui' },
  'wf_full-no-decompose': { fb_0: 'refine', fb_1: 'review', fb_2: 'webui' },
  'wf_quick-fix': { fb_0: 'review' },
  // The A28 convention (this seed is absent from the reference DB) — pinned so an edit is deliberate.
  'wf_clarify-implement': { fb_0: 'review', fb_1: 'refine' },
  'wf_clarify-quick-fix': { fb_0: 'review' },
};

/** The dynamic overlay resolver the V24 migration uses: the UNIQUE
 *  maxCycles-bearing wire on a path from `fromId` to `toId`, following and/or/
 *  combine valves, at most 4 hops. null when it is not unique. */
function resolveWireId(tpl, fromId, toId) {
  const outOf = (id) => tpl.wires.filter((w) => w.from.node === id);
  const hits = new Set();
  const queue = outOf(fromId).map((w) => ({ w, budget: w.config?.maxCycles ? w : null, hops: 1 }));
  while (queue.length) {
    const { w, budget, hops } = queue.shift();
    if (w.to.node === toId) { if (budget) hits.add(budget.id); continue; }
    const target = node(tpl, w.to.node);
    if (hops >= 4 || !target || !VALVE.has(target.kind)) continue;
    for (const nx of outOf(w.to.node)) {
      queue.push({ w: nx, budget: budget || (nx.config?.maxCycles ? nx : null), hops: hops + 1 });
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

test('the 8 shipping graphs: ids, names, version, domain, pin counts', () => {
  assert.equal(SEED_TEMPLATES.length, 7);
  assert.deepEqual(SEED_TEMPLATES.map((t) => t.id), [
    'wf_full', 'wf_no-clarify', 'wf_provided-plan', 'wf_full-no-decompose',
    'wf_quick-fix', 'wf_clarify-implement', 'wf_clarify-quick-fix',
  ]);
  assert.deepEqual(SEED_TEMPLATES.map((t) => t.name), [
    'Full', 'No Clarify', 'Provided Plan', 'FULL-NO-Decompose',
    'Quick Fix', 'Clarify -> Implement', 'Clarify -> Quick Fix',
  ]);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.id, 'wf_default');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.name, 'Default');
  for (const t of ALL) {
    assert.equal(t.version, TEMPLATE_VERSION, `${t.id} version`);
    assert.equal(t.domain, 'coding', `${t.id} domain`);
    assert.deepEqual([t.nodes.length, t.wires.length], PINS[t.id], `${t.id} node/wire counts`);
  }
  for (const t of SEED_TEMPLATES) assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}T/, `${t.id} createdAt`);
});

test('every graph has exactly one Task and one End; key iff kind agent', () => {
  for (const t of ALL) {
    assert.equal(t.nodes.filter((n) => n.kind === 'task').length, 1, `${t.id} task`);
    assert.equal(t.nodes.filter((n) => n.kind === 'end').length, 1, `${t.id} end`);
    for (const n of t.nodes) {
      assert.equal('key' in n, n.kind === 'agent', `${t.id}/${n.id}: key iff agent`);
      if (n.kind === 'agent') assert.ok(n.key && typeof n.key === 'string');
      assert.equal(typeof n.x, 'number');
      assert.equal(typeof n.y, 'number');
      assert.ok(n.config && typeof n.config === 'object', `${t.id}/${n.id} config`);
    }
  }
});

test('ids are unique, well-shaped, and every wire lands on a real node', () => {
  for (const t of ALL) {
    const ids = t.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, `${t.id} unique node ids`);
    const wids = t.wires.map((w) => w.id);
    assert.equal(new Set(wids).size, wids.length, `${t.id} unique wire ids`);
    for (const id of ids) assert.match(id, NODE_ID_RE, `${t.id}/${id}`);
    for (const w of t.wires) {
      assert.match(w.id, WIRE_ID_RE, `${t.id}/${w.id}`);
      assert.ok(node(t, w.from.node), `${t.id}/${w.id} from`);
      assert.ok(node(t, w.to.node), `${t.id}/${w.id} to`);
      assert.match(w.from.port, PORT_ID_RE, `${t.id}/${w.id} from.port`);
      assert.match(w.to.port, PORT_ID_RE, `${t.id}/${w.id} to.port`);
    }
  }
});

test('V7: every input carries exactly one inbound wire, and no port is named start', () => {
  for (const t of ALL) {
    const seen = new Set();
    for (const w of t.wires) {
      const key = `${w.to.node}.${w.to.port}`;
      assert.ok(!seen.has(key), `${t.id}: ${key} has two inbound wires (V7)`);
      seen.add(key);
      assert.notEqual(w.to.port, 'start', `${t.id}/${w.id}`);
      assert.notEqual(w.from.port, 'start', `${t.id}/${w.id}`);
    }
  }
});
```

```js
test('the End node is fed from webui.pass where a webui node exists, else reviewer.pass', () => {
  for (const t of ALL) {
    const end = t.nodes.find((n) => n.kind === 'end');
    const inbound = t.wires.filter((w) => w.to.node === end.id);
    assert.equal(inbound.length, 1, `${t.id}: one wire into End`);
    assert.equal(inbound[0].to.port, 'result');
    const src = node(t, inbound[0].from.node);
    const hasWebui = t.nodes.some((n) => n.key === 'manualWebUiTesting');
    assert.equal(src.key, hasWebui ? 'manualWebUiTesting' : 'reviewer', `${t.id}: End source`);
    assert.equal(inbound[0].from.port, 'pass');
  }
});

test('reviewer.pass -> checklist.await wherever a checklist node exists', () => {
  for (const t of ALL) {
    const check = t.nodes.find((n) => n.key === 'manualTestsChecklist');
    if (!check) continue;
    const rev = t.nodes.find((n) => n.key === 'reviewer');
    const w = t.wires.find((x) => x.from.node === rev.id && x.from.port === 'pass');
    assert.ok(w, `${t.id}: reviewer.pass is wired`);
    assert.equal(w.to.node, check.id, `${t.id}: reviewer.pass -> checklist`);
    assert.equal(w.to.port, 'await', `${t.id}: lands on the synthesized await gate`);
  }
});

test('the OR valve appears on exactly the three double-loop seeds', () => {
  const withOr = ALL.filter((t) => t.nodes.some((n) => n.kind === 'or')).map((t) => t.id);
  assert.deepEqual(withOr.sort(), ['wf_full', 'wf_full-no-decompose', 'wf_provided-plan']);
  for (const id of withOr) {
    const t = byId[id];
    const or = t.nodes.find((n) => n.kind === 'or');
    assert.equal(or.config.arity, 2, `${id} arity`);
    const ins = t.wires.filter((w) => w.to.node === or.id);
    assert.deepEqual(ins.map((w) => w.to.port).sort(), ['in1', 'in2'], `${id} valve inputs`);
    for (const w of ins) assert.equal(w.config.maxCycles, 3, `${id}/${w.id} keeps its own budget`);
    const outs = t.wires.filter((w) => w.from.node === or.id);
    assert.equal(outs.length, 1, `${id}: one out-wire`);
    assert.equal(outs[0].from.port, 'out');
    assert.equal(outs[0].to.port, 'fix');
    assert.equal(outs[0].config, undefined, `${id}: the always-sourced out-wire carries no maxCycles`);
  }
});

test('NODE_ID_MAP: the 7 seed ids + wf_default, every target node exists', () => {
  assert.deepEqual(Object.keys(NODE_ID_MAP).sort(), Object.keys(PINS).sort());
  for (const [wfId, map] of Object.entries(NODE_ID_MAP)) {
    const t = byId[wfId];
    for (const [v1Id, nodeId] of Object.entries(map)) {
      assert.match(v1Id, /^s(_clarify|\d+_\d+)$/, `${wfId}: v1 stage id ${v1Id}`);
      assert.ok(node(t, nodeId), `${wfId}: ${v1Id} -> ${nodeId} exists`);
      assert.equal(node(t, nodeId).kind, 'agent', `${wfId}: ${nodeId} is an agent node`);
    }
    const agents = t.nodes.filter((n) => n.kind === 'agent').length;
    assert.equal(Object.keys(map).length, agents, `${wfId}: one overlay mapping per agent node`);
  }
});

test('FB_WIRE_MAP equals the dynamic (from,to) resolver over the seed graphs', () => {
  assert.deepEqual(Object.keys(FB_WIRE_MAP).sort(), Object.keys(PINS).sort());
  for (const [wfId, map] of Object.entries(FB_WIRE_MAP)) {
    const t = byId[wfId];
    const budgeted = t.wires.filter((w) => w.config?.maxCycles);
    assert.deepEqual(
      Object.values(map).sort(),
      budgeted.map((w) => w.id).sort(),
      `${wfId}: the map covers exactly the budget-bearing wires`,
    );
    for (const w of budgeted) {
      // The loop's (from, to) as v1 saw it: source node -> ultimate consumer,
      // following the OR valve where the seeds route through one.
      const direct = node(t, w.to.node);
      const to = VALVE.has(direct.kind)
        ? t.wires.find((x) => x.from.node === direct.id).to.node
        : w.to.node;
      assert.equal(resolveWireId(t, w.from.node, to), w.id, `${wfId}: resolve(${w.from.node}, ${to})`);
    }
    // Every mapped feedback id is a v1 fb id, and the ids are distinct.
    assert.equal(new Set(Object.values(map)).size, Object.keys(map).length, `${wfId}: distinct wire ids`);
    for (const fbId of Object.keys(map)) assert.match(fbId, /^fb_/, `${wfId}: ${fbId}`);
  }
});

test('FB_WIRE_MAP pins the fb_N ↔ wire PAIRING: wf_default off the REAL v1 row, every seed by loop role', () => {
  // wf_clarify-implement is absent from the reference DB, so its v1 feedback ORDER is a
  // convention shared with P3's v1 fixture (test/fixtures/workflows-v1/wf_clarify-implement.json):
  // fb_0 = the review loop (n_review.review -> n_impl.fix, w9), fb_1 = the refiner
  // self-loop (n_refine.revise -> n_refine.revise, w5). V24 applies the STATIC
  // maps only (spec §10.2), so this pairing is load-bearing and pinned verbatim.
  const t = byId['wf_clarify-implement'];
  assert.deepEqual({ ...FB_WIRE_MAP['wf_clarify-implement'] }, { fb_0: 'w9', fb_1: 'w5' });
  assert.deepEqual([t.wires.find((w) => w.id === 'w9').to.port, t.wires.find((w) => w.id === 'w5').to.port], ['fix', 'revise']);

  // Every seed's fb_N named by the LOOP it stands for — the same pairing, stated as data.
  for (const [wfId, fbs] of Object.entries(EXPECTED_FB)) {
    const tpl = byId[wfId];
    assert.deepEqual(Object.keys(FB_WIRE_MAP[wfId]).sort(), Object.keys(fbs).sort(), `${wfId}: fb ids`);
    for (const [fbId, loop] of Object.entries(fbs)) {
      const [fromKey, toKey] = LOOP_OF[loop];
      const from = tpl.nodes.find((n) => n.key === fromKey).id;
      const to = tpl.nodes.find((n) => n.key === toKey).id;
      assert.equal(FB_WIRE_MAP[wfId][fbId], resolveWireId(tpl, from, to), `${wfId}.${fbId} is the ${loop} loop`);
    }
  }

  // wf_default is no convention at all: both maps are derivable from the REAL v1
  // DEFAULT_WORKFLOW row (workflows.mjs) — node ids, agent keys and feedbacks.
  const v1 = DEFAULT_WORKFLOW;
  const nodeMap = NODE_ID_MAP.wf_default;
  assert.deepEqual(Object.keys(nodeMap).sort(), v1.steps.flat().map((n) => n.id).sort());
  for (const n of v1.steps.flat()) {
    assert.equal(node(GRAPH_DEFAULT_WORKFLOW, nodeMap[n.id]).key, n.key, `${n.id} keeps its agent key`);
  }
  assert.deepEqual(Object.keys(FB_WIRE_MAP.wf_default).sort(), v1.feedbacks.map((f) => f.id).sort());
  for (const fb of v1.feedbacks) {
    assert.equal(
      FB_WIRE_MAP.wf_default[fb.id],
      resolveWireId(GRAPH_DEFAULT_WORKFLOW, nodeMap[fb.from], nodeMap[fb.to]),
      `${fb.id} resolves from the real (from,to)`,
    );
  }
});

test('the shipping constants are deep-frozen', () => {
  assert.ok(Object.isFrozen(SEED_TEMPLATES) && Object.isFrozen(NODE_ID_MAP) && Object.isFrozen(FB_WIRE_MAP));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW));
  for (const t of ALL) {
    assert.ok(Object.isFrozen(t.nodes) && Object.isFrozen(t.nodes[0]) && Object.isFrozen(t.nodes[0].config));
    assert.ok(Object.isFrozen(t.wires) && Object.isFrozen(t.wires[0].from));
  }
  assert.throws(() => { SEED_TEMPLATES[0].nodes[0].x = 999; }, TypeError);
  const o = deepFreeze({ a: { b: 1 } });
  assert.ok(Object.isFrozen(o.a));
  assert.equal(deepFreeze(5), 5);
});
```

- [ ] Step 2: `node --test test/graph-seed-templates.test.mjs`
`Expected: ℹ pass 11`, `ℹ fail 0` (10 measured 2026-08-27 against the verbatim old-branch files + the loop-role/`DEFAULT_WORKFLOW` pins folded into the pairing test — re-measured in the wave-2 execution; write the printed number).
- [ ] Step 3: **Mutation audit** (revert each): (a) retarget `wf_full`'s `w13` from `n_check.await` to `n_check.plan` → the await test fails AND the V7 test fails (`n_check.plan` already has `w9`); (b) drop `config` from `wf_full`'s `w12` → **three** tests fail (the FB_WIRE_MAP coverage "covers exactly the budget-bearing wires", the budget-placement pin and the loop-wire set); (c) change `FB_WIRE_MAP['wf_clarify-implement']` to `{ fb_0: 'w5', fb_1: 'w9' }` → the resolver test still passes (SET equality + per-wire resolve) but the PAIRING pin test fails — that pin is the contract V24's static overlay map (spec §10.2, static maps only) and P3's v1 fixture both follow; (d) add a second wire into `wf_quick-fix`'s `n_review.plan` → **two** tests fail (V7 and the wire-id/port pins).
- [ ] Step 4: Commit — `worca: Node-graph v2 P1 — seed graph structural tests`

---

### Task 11: Full suite, sentinels, handoff

**Files:** none changed.

- [ ] Step 1: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail) '`
`Expected:` green at **BASELINE + 50** — re-measured in the wave-2 execution; write the printed number. The 50 new tests: Task 1 → 2, Task 3 → 10, Task 4 → 5, Task 5 → 10, Task 6 → 5, Task 7 → 3, Task 8 → 4, Task 10 → 11. Reference: the 2026-08-27 dry-run of this plan's v1 measured 3760 → **3805** (+45) on a clone of dev `e6968e15`; the cross-plan, critique and re-execution passes add five more tests, so the reference final is **3810** on a 3760 baseline (the wave-2 re-execution of this v2 measured 3809 before the tenth hooks test was added). If your BASELINE differs, the DELTA is what must hold.
- [ ] Step 2: Successor sentinels — P2 greps for these; both must print:
`grep -n "export class RunHarness" src/core/run-harness.mjs`
`grep -n "export const SEED_TEMPLATES" src/core/graph/seed-templates.mjs`
Also confirm the rest of the surface P2–P4 build on:
`grep -n "export function selectEngine\|export async function createOrchestratorFor" src/core/engine-select.mjs`
`grep -n "export const TEMPLATE_VERSION\|export function gatePorts" src/shared/graph/constants.mjs`
`grep -n "export function hasBlocking" src/shared/graph/verdict.mjs`
`grep -n "export const GRAPH_DEFAULT_WORKFLOW" src/core/graph/builtin-workflows.mjs`
- [ ] Step 3: Hygiene checklist (all must hold):
  - [ ] `git status --porcelain` shows nothing under `docs/superpowers/` staged or committed, and no `split-harness.tmp.mjs`.
  - [ ] `git log --oneline` shows the plan's commits, all prefixed `worca: Node-graph v2 P1 — `.
  - [ ] `grep -rn "wf_default_v2\|GraphOrchestrator\|createGraphOrchestrator" src/ ui/` → exactly ONE hit, the `// P4 routes 'graph' to createGraphOrchestrator(opts)` comment in `src/core/engine-select.mjs`. No code, no alias id anywhere (P4 introduces both).
  - [ ] `grep -c "_phase(" src/core/orchestrator.mjs` → `0` (every bookend now goes through the harness; the v1 class has no `_phase`).
  - [ ] `grep -rn "from '/src/shared" ui/ src/ test/ | wc -l` → `0` (absolute specifiers are forbidden; they break Node ESM).
  - [ ] No user-visible string changed: `git diff e6968e15 -- ui/public/ | wc -l` → `0` (the app shell IS `ui/public/index.html`; a second root `index.html` pathspec is a no-op).
- [ ] Step 4: Manual verification (by hand, not part of `npm test`) — the one thing the suite cannot prove is that a real browser executes the shared module. Start the app, open the browser devtools console on the worca UI and run `await import('/src/shared/graph/constants.mjs')` → it resolves with `TEMPLATE_VERSION: 2`; `await fetch('/src/shared/graph/nope.mjs').then(r => [r.status, r.headers.get('content-type')])` → `[404, 'text/plain; charset=utf-8']`. (Chrome 151 was verified doing exactly this on 2026-08-26 during spec work; re-confirm once here, then never again — P5 covers the browser side with its CDP script.)
- [ ] Step 5: Commit anything outstanding, then hand off.

**Handoff:** P1 is complete. The plan file is `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations-v2.md` (this document). Next: **P2 — Shared graph core + sidecars v2 + schema + store** (halves P2a/P2b), which starts by grepping for `export class RunHarness` in `src/core/run-harness.mjs` and `export const SEED_TEMPLATES` in `src/core/graph/seed-templates.mjs`.

---

## Clarifications (Q&A)

- **D1** — How does node-graph v2 land? → **New plan + new implementation on top of dev; the PR #359 branch is borrowable source only. Eight sequential plans, each one worca orchestrate pipeline run AND hand-runnable, each leaving `npm test` green and dev shippable; the v1 engine stays live until P8** (user decision 2026-08-26).
- **D7 / seeds** — Do the 7 seed graphs land now or with the migration? → **The constants + structural tests land in P1 (this plan); the V24 migration that inserts them, and the zero-errors `validateGraph` drift guard, land later** (spec §10.2 + adj-e §3 "LAND EARLY").
- **P1-a** — Is the harness move allowed to improve the code it moves? → **No. Byte-identical behavior; the oracle is the 53 orchestrator importers passing unchanged. `git diff --color-moved` (after `git add -N` of the new file, over BOTH paths) must show only the twelve seam edits as non-moved lines** (spec §13 risk 1: "land it alone").
- **P1-b** — `_phase` is listed V1-ONLY "(except bookends)", but all four of its call sites ARE bookends and two test files call `orch._phase(...)` directly. Where does it go? → **It moves to `RunHarness` with its signature intact; `_bookend(name, status)` calls it. No `_phase` remains in `orchestrator.mjs`. P8 deletes it when `cost-tracking`/`duration-tracking` are ported** (planner default, forced by the oracle).
- **P1-c** — `_resolveTopology` returns `{manifest, agentKeys}` per spec §5.1, but the run shell also needs the workflow's display name for `Workflow: **<name>** (<id>).`. → **The return gains a third field `workflow: {id, name}`** (planner default; strictly additive).
- **P1-d** — `_engineRehydrate` returns `{checkpointRef, memberWorktrees, plan?}` per spec §5.1, but the resume shell also writes `Pipeline **resumed** (from <kind> at step <n>).` from v1-only fields. → **The return gains `audit: string` — REQUIRED, not optional. The base writes `rehydrated.audit` unconditionally, and an absent field would insert an EMPTY `pipeline_events` row (`artifacts.mjs:930` coerces `undefined` to `''`), so the S8 seam validates the bag and throws a named `engine hook contract:` error instead. v1's bytes are unchanged** (planner default, tightened by the Fable critique F1).
- **P1-e** — `_engineRun` is specified as `_engineRun({resume})`, yet v1's resume path needs the frozen plan the rehydrate hook read. → **The base calls `_engineRun({ resume, rehydrated })`; v1 reads `rehydrated.plan`. On a fresh run: `{ resume: null }`** (planner default).
- **P1-f** — Where does the §9.4 preflight gate live once the plan is gone from the shell? → **`_preflightAgentKeys(agentKeys)` moves to the harness and takes an ITERABLE of keys (both messages and the throw text unchanged); the v1 engine derives the set from its plan with a new module-level `planAgentKeys(plan)` helper** (spec §5.1 hook 1).
- **P1-g** — `collectRequiredSkills(registry, plan)` has three test files passing plans. → **It accepts EITHER a plan object or any iterable of keys (a plan is not iterable, so the branch is unambiguous). All existing callers and tests are untouched** (spec §5.1 "skills.mjs:113 accepts a key set").
- **P1-h** — Which `wf_default` default does the shared constructor keep? → **The literal `'wf_default'` stays in the harness constructor, untouched until P8** (spec §5.2: the constructor default at `orchestrator.mjs:297` is in the "untouched until P8" list).
- **P1-i** — Does `createOrchestratorFor` return a graph orchestrator when the selector says `'graph'`? → **Not at P1: the SELECTOR is final, the FACTORY is v1-only. `createOrchestratorFor` always returns `createOrchestrator(opts)` with a one-line comment naming P4, and NO call site changes** (spec §2 P1 row, §5.2).
- **P1-j** — `selectEngine` on a stringy version? → **`Number(raw) === 2` — `'2'` selects graph, `'two'`/`undefined`/`null` select v1** (planner default; the DB gives numbers, JSON round-trips give numbers, and coercion removes a silent-downgrade footgun).
- **P1-k** — `LIMITS` contents (spec §3 names the export, not its keys). → **`{ maxNodes: 80, maxWires: 200, maxPortsPerSide: 8, minArity: 2, maxArity: 8, maxCycles: 20, maxNameLen: 80 }`** (planner default; P2's `validateGraph(tpl, portsFn, {limits})` consumes it and may extend the object — it must not rename these keys).
- **P1-l** — `gatePorts` OR `out` type before resolution? → **`'any'`, `when: 'always'`; AND `out` is `'void'`, Combine `out` is `'md'`. AND/OR inputs are `'any'`, Combine inputs `'md'`; all gate inputs are `required: true`** (base spec Amendment f + planner default for `required`).
- **P1-m** — `KINDS`/`FLOW_KINDS`/`PORT_TYPES` as arrays or Sets? → **Frozen ARRAYS in declaration order (palette order); `.includes` is the membership test** (planner default).
- **P1-n** — `NODE_ID_RE`/`WIRE_ID_RE` must admit both minted ids and the seeds'. → **`/^n_[a-z0-9]{1,32}$/` and `/^w_?[a-z0-9]{1,32}$/` (the seeds use `w1`…`w17` with NO underscore — a `w_`-only pattern would reject every shipping graph); `PORT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/`** (planner default, verified against all 8 graphs).
- **P1-o** — Does `protocol.mjs` re-export `BLOCKING`/`normalizeSeverity`, which it does not export today? → **Yes, all five names are re-exported; only `normalizeSeverity` is additionally imported for local use** (spec §3 verdict row).
- **P1-p** — Are the borrowed seed files edited to say V24 instead of V17? → **No. They are byte-identical to `old:src/core/graph/{seed-templates,builtin-workflows}.mjs`; the stale `V17` comments are corrected in P8, where the migration is actually written** (spec §10.2 "copied VERBATIM" + the byte-identity check). P8's comment-correction list: the `V17` references in both headers, AND `builtin-workflows.mjs`'s header claim that "`fixtures.mjs` re-exports it as FIXTURE_DEFAULT" — no such file exists in the rebuild.
- **P1-q** — What proves `FB_WIRE_MAP` right? → **A dynamic `(from,to)` resolver written inside the test (unique `maxCycles`-bearing wire, following `and`/`or`/`combine` valves ≤ 4 hops) plus set-equality with each graph's budget-bearing wires. The fb_N ↔ wire PAIRING for `wf_clarify-implement` cannot be read off a DB row (that row is absent from the reference DB), so it is a pinned CONVENTION — `fb_0` = the review loop `w9`, `fb_1` = the refiner self-loop `w5` — asserted verbatim here and followed by P3's v1 fixture; V24 (P8) applies the STATIC maps only, exactly as spec §10.2 says** (agent adjudication, cross-plan pass 2026-08-27; adj-e §2/§3 for the resolver).
- **P1-r** — Do `_onAgentEvent`, the sub-agent/skills/graphify reducers and `_recordCost` move to the harness here? → **No. They stay in `orchestrator.mjs` in this plan (spec §5.1 lists them as SHARED-BUT-SHAPE-CHANGES); P4 Task 1 moves them onto `RunHarness` verbatim, because the only v2 difference is the VALUE of `attr.stepKey`, which the caller sets — the refiner must not fold that move into this plan's extraction script** (agent adjudication, cross-plan pass 2026-08-27). The P4 move must treat `SKILLS_MAX`, `skillLabel` and `mergeSkills` as "used by both sides" (`orchestrator.mjs:4369 _testing`, imported by `test/skill-capture.test.mjs`): export them from `run-harness.mjs` and import them back, or move `_testing` with them — otherwise `orchestrator.mjs` fails to load and all 53 importers break.
- **P1-s** — When does `_engineRehydrate` run, and what may it do? → **At dev's `:820` version-gate position: BEFORE any state is rehydrated and OUTSIDE the shell's try; pure (read `rp`, decide, return the bag); async allowed (the shell awaits it). Engine restoration that needs state/registry/pipeline — manifest adoption, prompt hydration, the §9.4 re-preflight — goes in `_engineRun({resume, rehydrated})`, inside the try, exactly where v1 does it** (agent adjudication, Fable critique F4 / xplan seam S3).

