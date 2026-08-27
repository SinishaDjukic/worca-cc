# P1 wave-2 full re-execution — report

Clone: `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/clones/p1`
Branch: `worca-cc/node-graph-v2-p1`, reset to dev `e6968e15`, `WORCA_HOME` = `…/clones/p1-home` (fresh).
Plan: `docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations-v2.md`
Executed: every task, in order, commit per task with the plan's messages. Never pushed.

## §1 Per-task log (predicted vs actual)

### Task 0 — branch check, deps, baseline, predecessor sentinel

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 `git rev-parse --abbrev-ref HEAD` | on the pipeline branch | `worca-cc/node-graph-v2-p1` | OK |
| 2 `[ -d node_modules ] \|\| npm ci` | deps present | `node_modules` present (`@asamuzakjp`, `@bramus`) — no `npm ci` needed | OK |
| 3 `git merge-base --is-ancestor e6968e15 HEAD && echo OK` | `OK` | `OK` | OK |
| 4 old branch available | sha or a tolerated failure | `origin/worca-cc/v2-orchestrator-bfb6a0ed` = `0e6cee6f266fe8989a5aa7f538df2a3b2b45123e` | OK |
| 5 `npm test 2>&1 \| tail -5` | green, record BASELINE | `ℹ tests 3760` / `ℹ pass 3760` / `ℹ fail 0`, `duration_ms 83235.2` | **BASELINE = 3760** (identical to the plan's reference) |

### Task 1 — `collectRequiredSkills` accepts a key set

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 append 2 tests, run | FAIL with `+ actual` `[]` for the Set case | `AssertionError [ERR_ASSERTION]` … `actual: []`, `expected: [ {skill:'brainstorming',…}, {skill:'tdd',…} ]`, `operator: 'deepStrictEqual'` | OK — verbatim |
| 2 implement (JSDoc + 2-branch body) | both anchors unique | both `once`-style anchors matched exactly 1x | OK |
| 3 `node --test skills-resolve skills-gate-wiring plugin-skills` | `ℹ fail 0` | `ℹ tests 20` / `ℹ pass 20` / `ℹ fail 0` | OK |
| 3 mutation: drop `typeof planOrKeys !== 'string'` | Set test RED on the bare-string arm | `✖ collectRequiredSkills: accepts a Set of agent keys (harness entry point)`, `ℹ pass 7` / `ℹ fail 1` | RED as predicted |
| 4 commit | — | `49c64ffb` | OK |

> Note on the mutation revert: `git checkout -- src/core/skills.mjs` reverts to **HEAD**, i.e. it also discards the Task 1 implementation (the file was not yet committed at that point). Re-applied and re-verified before committing. See finding F5.

### Task 2 — the harness move

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 assemble the script from the fenced blocks in document order | a runnable one-off | 6 blocks at plan lines 338, 445, 585, 654, 758, 798 → 463-line script, `node --check` clean | OK |
| 2 `node split-harness.tmp.mjs` | `run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines` | `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines` | **DRIFT** (+22 harness lines) — see finding F1. Zero `split:` assertions fired. |
| 3 `node --check` both | `PARSE-OK` | `PARSE-OK` | OK |
| 4 `rm` + `git status --porcelain` | exactly `M src/core/orchestrator.mjs`, `?? src/core/run-harness.mjs` | exactly those two, no `split-harness.tmp.mjs` | OK |
| 5 `git add -N` + two-path `--color-moved` | ≈2612 moved-away / ≈2609 moved-to, ≈250 non-moved | **2611 moved-old / 2608 moved-new; 73 non-moved removed + 200 non-moved added (273)** | OK (±1 on moved; non-moved list fully allowed — enumerated below) |
| 5 multiset cross-check | ~102 lost / ~188 gained | **103 lost / 211 gained** | lost OK; gained **DRIFT** (+23) — same cause as F1, see F2. All lines accounted for. |
| 6 oracle (10 suites) | `ℹ fail 0`, 156 tests | `ℹ tests 156` / `ℹ pass 156` / `ℹ fail 0`, `duration_ms 25284.3` | OK — exact |
| 7 `npm test` | BASELINE + 2 = 3762 | `ℹ tests 3762` / `ℹ pass 3762` / `ℹ fail 0` | OK — exact |
| 8 commit | — | `550b1346` | OK |

**Task 2 Step 5 — the complete non-moved line list (all allowed by the plan).**

*Removed side (73):* 30 lines of the OLD orchestrator import block (`node:path`, `node:fs/promises`, the multi-line `./artifacts.mjs` list, `./cost-budget.mjs`, `./config.mjs`, `./agent-registry.mjs`); `const ERR_STREAM = Object.freeze({ stream: 'err' });`; `class Orchestrator extends EventEmitter {`; the S11 runner-table line; 2 one-line comment banners (`// ── public control ──`, `// ── main run ──`); 3 lone `}`/blank lines; and the twelve seam ORIGINALS — S1 (`// §9.4: hard-fail BEFORE the stepper snapshot…`, `this._preflightAgentKeys(plan);`, `this.state.stepper = buildStepperManifest(plan, registry);`), S2, S3, S4, S5 (2 lines), S6 (×2), S7 (`this.state.resumePoint = {`), S9 (3 lines), S10 (6 lines incl. the `channelDefs` line, the resume audit, `let plan = rp.plan;`, the second `_preflightAgentKeys(plan)`, the `_dispatch(plan, { resume: rp })` line), S12 (6 lines) — plus the 8 helper signature lines that gained an `export ` prefix (`roundUsd`, `sumStepCosts`, `sumStepActive`, `pauseErr`, `isPause`, `firstLine`, `rel`, `clip`).

*Added side (200):* the new orchestrator import block (11 lines); `export { isAbort, errStreamAttr };`; `planAgentKeys` (6); `class Orchestrator extends RunHarness {`; 2 comment banners; the whole `V1_HOOKS` block (32); the harness file header (14); the harness import block (12); 9 `export `-prefixed helper signatures + `export const ERR_STREAM`; `export class RunHarness extends EventEmitter {`; the twelve seam REPLACEMENTS S1–S12 (incl. both `engine hook contract:` guard lines); `BASE_HOOKS` (51) + its closing `}`; and ~19 lone braces / blank lines (git needs ≥3 lines per moved block).

Nothing outside that list appeared. `isAbort` and `errStreamAttr` were ALREADY `export function` on dev, so they moved verbatim and are correctly absent from the `EXPORTED` prefix list (9 = 8 functions + `ERR_STREAM`).

**Task 2 — NEGATIVE CHECK of the script's new post-condition guards.** In a throwaway dir (`…/scratchpad/negcheck`, since discarded) holding only `src/core/orchestrator.mjs` @ `e6968e15`:
- control (blocks in document order): `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines`, exit 0 — reproduces the clone's numbers outside the clone.
- mutant (the S12 block moved AFTER the assembly/write block): `Error: split: S12 not applied — script blocks out of order`, exit 1, and **no `run-harness.mjs` was written** (`ls src/core/` → `orchestrator.mjs` only). The `die` fires before `writeFileSync`, exactly as the plan claims.

### Task 3 — `test/run-harness-hooks.test.mjs`

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 write the test (2 fenced blocks, 209 lines) | parses | `node --check` clean | OK |
| 2 `node --test test/run-harness-hooks.test.mjs` | `ℹ pass 9`, `ℹ fail 0` | `ℹ tests 9` / `ℹ pass 9` / `ℹ fail 0`, `duration_ms 1006.6` | OK — exact |
| 3 mutation (a) `state.stepper = null` | run() test RED | `✖ run(): the topology hook stamps state.stepper…`, `pass 8 / fail 1` | RED |
| 3 mutation (b) `_preflightAgentKeys([])` | ghostAgent test RED | `✖ run(): a key the registry does not know fails preflight…`, `pass 8 / fail 1` | RED |
| 3 mutation (c) `_bookend` no-op | phase-sequence RED | `pass 6 / fail 3` (bookend test + run() test + pre-pause test) | RED (bites harder than predicted) |
| 3 mutation (d) `_engineRun({ resume: rp })` | resume test RED on `rehydrated.plan` | `✖ resume(): the shell consumes the _engineRehydrate bag…`, `pass 8 / fail 1` | RED |
| 3 mutation (e) S5 prints `workflow.id` where the NAME goes | run() test RED | `✖ run(): the topology hook stamps state.stepper…`, `pass 8 / fail 1` | RED |
| 3 mutation (f) S10 literal instead of `rehydrated.audit` | resume test RED | `✖ resume(): the shell consumes the _engineRehydrate bag…`, `pass 8 / fail 1` | RED |
| 3 mutation (g) S7 `= null` | pre-pause test RED (`calls.prePause`) | `✖ run(): a pause requested during preflight lands on _enginePrePausePoint…`, `pass 8 / fail 1` | RED |
| 3 extra: remove the **S1** `engine hook contract: _resolveTopology` guard | (brief's item 8) | `✖ run(): a topology bag missing 'workflow' fails AT THE SEAM…`, `pass 8 / fail 1` | RED |
| 3 extra: remove the **S8** `engine hook contract: _engineRehydrate` guard | — | `ℹ pass 9` / `ℹ fail 0` | **SURVIVES — finding F3** |
| 4 commit | — | `1c44dc4f` | OK |

The pre-pause test (mutation g's target) passes as written: `orch.calls.prePause === 1`, `orch.state.resumePoint` deep-equals `{version: 99, kind: 'stub-boundary'}`, and the persisted `pipelines.resume_point` JSON carries `kind: 'stub-boundary'`.

### Task 4 — `src/core/engine-select.mjs`

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 write the test | `ERR_MODULE_NOT_FOUND … engine-select.mjs` | exactly that | OK |
| 2 implement | — | 48-line module, `node --check` clean | OK |
| 3 `node --test test/engine-select.test.mjs` | `ℹ pass 5`, `ℹ fail 0` | `ℹ tests 5` / `ℹ pass 5` / `ℹ fail 0` | OK — exact |
| 3 mutation: gut the factory (no `readWorkflow`, no `selectEngine`) | the two `orch.engine` assertions RED | `✖ createOrchestratorFor: async, and builds the v1 orchestrator from a workflow id` + `✖ createOrchestratorFor: P1 returns v1 even when the selector says graph`, `pass 3 / fail 2` | RED |
| 4 commit | — | `e86d3adc` | OK |

### Task 5 — `src/shared/graph/constants.mjs`

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| test-first | `Cannot find module … src/shared/graph/constants.mjs` | exactly that | OK |
| 1–2 implement + run | `ℹ pass 10`, `ℹ fail 0` | `ℹ tests 10` / `ℹ pass 10` / `ℹ fail 0` | OK — exact |
| extra mutation: `BOOKEND_EXECUTION_IDS` → `['x:preflight:0','x:done:0']` | (brief's item 9) | `✖ BOOKEND_EXECUTION_IDS names the two bookend ledger rows, frozen`, `pass 9 / fail 1` | RED |
| 3 commit | — | `f427e5fa` | OK |

### Task 6 — `src/shared/graph/verdict.mjs`

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1–2 create verdict.mjs + protocol.mjs surgery | both anchors unique; protocol re-exports all five, imports only `normalizeSeverity` | both `once`-style anchors matched 1x; `protocol.mjs` 257 → 231 lines; `node --check` clean | OK |
| 4 `node --test graph-verdict runners workspace-mock` | `ℹ fail 0`, 22 tests | `ℹ tests 22` / `ℹ pass 22` / `ℹ fail 0` | OK — exact |
| 5 `npm test` | BASELINE + 31 = 3791 | `ℹ tests 3791` / `ℹ pass 3791` / `ℹ fail 0`, `duration_ms 80775.6` | OK — exact |
| 6 commit | — | `658fb6ed` | OK |

### Task 7 — the purity guard

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 2 `node --test test/shared-graph-purity.test.mjs` | `ℹ pass 3`, `ℹ fail 0`, 23 `ui/public` specifiers | `ℹ tests 3` / `ℹ pass 3` / `ℹ fail 0`; independently counted **23** `ui/public` specifiers, zero false positives | OK — exact |
| 3 mutation 1: `src/shared/graph/mutant.mjs` importing `node:path` | RED with `non-relative import "node:path"` | `AssertionError … /src/shared/graph/mutant.mjs: non-relative import "node:path"`, `pass 2 / fail 1`; after `rm` → `pass 3 / fail 0` | RED as predicted |
| 3 mutation 2: `export const DOM_PROBE = typeof document;` in CODE | RED with `constants.mjs: DOM global` | `AssertionError … /src/shared/graph/constants.mjs: DOM global`, `pass 2 / fail 1` | RED as predicted |
| 3 mutation 2b (brief item 10): the same tokens **inside comments** | must stay GREEN | appended a `//` line and a `/** … */` block containing `document.querySelector`, `window.localStorage`, `navigator.userAgent`, `the process.` → `ℹ pass 3` / `ℹ fail 0` | GREEN — comment stripping works |
| 4 commit | — | `407b9624` | OK |

### Task 8 — serve `/src/shared`

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 insert between the `/vendor` 404 tail and the SPA static | anchor unique | matched 1x; `node --check ui/server.mjs` clean | OK |
| 3 `node --test test/api-shared-static.test.mjs` | `ℹ pass 4`, `ℹ fail 0` | `ℹ tests 4` / `ℹ pass 4` / `ℹ fail 0` | OK — exact |
| 4 mutation 1: delete the 404-tail `app.use` | the 404 test fails with `text/html` | `pass 2 / fail 2` — both the 404 test AND the traversal test go RED | RED (bites harder than predicted) |
| 4 mutation 2 (brief item 7): widen `SHARED_DIR` to `path.join(PROJECT_ROOT, 'src')` | *"the traversal test fails on its 404 status assertion"* | RED, but on **test 1** (`every shared file is served as a module at its repo-relative path`, `actual: 404, expected: 200`); the traversal test still PASSES | RED, wrong test named — **finding F4** |
| 4 probe: widen mount path **and** root (`app.use('/src', express.static(path.join(PROJECT_ROOT,'src'), …))`) | — | `✖ the mount cannot serve outside src/shared (raw, un-normalized paths)`, `actual: 200, expected: 404` | this is the mutation the plan meant; traversal test IS live |
| 5 commit | — | `f6e060f8` | OK |

### Task 9 — the 8 shipping graphs

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 byte-identity vs `origin/worca-cc/v2-orchestrator-bfb6a0ed` | `IDENTICAL` | `IDENTICAL` (both files; written from the plan's blocks first, then diffed — never `git show > file`) | OK |
| 2–3 file sizes | 49 / 318 lines | `49 src/core/graph/builtin-workflows.mjs`, `318 src/core/graph/seed-templates.mjs` | OK — exact |
| 4 `node --check` + the id/count print | `wf_full:11/17 wf_no-clarify:9/13 wf_provided-plan:9/14 wf_full-no-decompose:10/15 wf_quick-fix:5/6 wf_clarify-implement:7/10 wf_clarify-quick-fix:6/8` | byte-for-byte the same line | OK — exact |
| 5 commit | — | `aeb5dc39` | OK |

### Task 10 — the structural invariants

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 2 `node --test test/graph-seed-templates.test.mjs` | `ℹ pass 11`, `ℹ fail 0` | `ℹ tests 11` / `ℹ pass 11` / `ℹ fail 0` | OK — exact |
| 3 (a) `wf_full` `w13` → `n_check.plan` | await test AND V7 test RED | `✖ V7…` + `✖ reviewer.pass -> checklist.await…`, `pass 9 / fail 2` | RED — exact |
| 3 (b) drop `config` from `wf_full` `w12` | FB_WIRE_MAP test RED | `✖ the OR valve…` + `✖ FB_WIRE_MAP equals the dynamic…` + `✖ FB_WIRE_MAP pins the fb_N ↔ wire PAIRING…`, `pass 8 / fail 3` | RED (bites harder) |
| 3 (c) `FB_WIRE_MAP['wf_clarify-implement']` → `{fb_0:'w5', fb_1:'w9'}` (brief item 6) | resolver test still passes, PAIRING test RED | exactly that: only `✖ FB_WIRE_MAP pins the fb_N ↔ wire PAIRING…`, `pass 10 / fail 1` | RED — exact |
| 3 (d) second wire into `wf_quick-fix` `n_review.plan` | V7 test RED | `✖ the 8 shipping graphs: … pin counts` + `✖ V7…`, `pass 9 / fail 2` | RED (the added wire also moves the pin count) |
| 4 commit | — | `79c2f7e8` | OK |

### Task 11 — full suite, sentinels, handoff

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| 1 `npm test` | BASELINE + 49 = 3809 | `ℹ tests 3809` / `ℹ pass 3809` / `ℹ fail 0`, `duration_ms 84511.6` | OK — exact, and equal to the plan's reference final |
| 2 sentinel `export class RunHarness` | prints | `src/core/run-harness.mjs:221` | OK |
| 2 sentinel `export const SEED_TEMPLATES` | prints | `src/core/graph/seed-templates.mjs:274` | OK |
| 2 `selectEngine` / `createOrchestratorFor` | print | `engine-select.mjs:20` / `:35` | OK |
| 2 `TEMPLATE_VERSION` / `gatePorts` | print | `constants.mjs:8` / `:59` | OK |
| 2 `hasBlocking` | prints | `verdict.mjs:28` | OK |
| 2 `GRAPH_DEFAULT_WORKFLOW` | prints | `builtin-workflows.mjs:23` | OK |
| 3 `git status --porcelain` clean, no `docs/superpowers`, no `split-harness.tmp.mjs` | — | status EMPTY; 0 `docs/superpowers` paths and 0 `split-harness` paths across `e6968e15..HEAD` | OK |
| 3 commit prefixes | all `worca: Node-graph v2 P1 — ` | 10/10 (0 non-matching) | OK |
| 3 `grep -rn "wf_default_v2\|GraphOrchestrator\|createGraphOrchestrator" src/ ui/` | exactly ONE hit | 1 hit: `src/core/engine-select.mjs:43` (the P4 comment) | OK |
| 3 `grep -c "_phase(" src/core/orchestrator.mjs` | `0` | `0` | OK |
| 3 `grep -rn "from '/src/shared" ui/ src/ test/ \| wc -l` | `0` | `0` | OK |
| 3 `git diff e6968e15 -- ui/public/ \| wc -l` | `0` | `0` | OK |
| 4 manual browser check | by hand | **NOT PERFORMED** — this run is barred from starting servers/browsers. Its HTTP half is fully covered by `test/api-shared-static.test.mjs` (200 + `application/javascript` + `nosniff`, body == file; 404 + `text/plain` + `Not found`); only "a real Chrome executes the module" is unverified here. |
| 5 commit outstanding | — | nothing outstanding | OK |

---

## §2 Findings (with plan-ready fixes)

### F1 — MINOR (stale number). Task 2, Step 2: the expected line count for `run-harness.mjs` is 22 lines short.

The plan predicts `run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines`. The script actually prints:

```
run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines
```

The orchestrator number is exact. The +22 is entirely in the harness and is fully explained by the v2 passes that grew `BASE_HOOKS` (the 11-line `_engineRehydrate` JSDoc added by critique F4/xplan S3, plus the two `engine hook contract:` guard lines in the S1/S8 replacements) AFTER the 2026-08-27 dry-run that measured 2693. Reproduced outside the clone in a throwaway dir holding only `orchestrator.mjs @ e6968e15`, so it is not a clone artifact. No `split:` assertion fired.

**Fix — Task 2, Step 2, replace the `Expected:` line with:**

> `Expected:` `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines` (re-measured 2026-08-27 on a clone of dev `e6968e15` with the v2 hook text; ±a few lines is fine, an assertion failure is not — every `split: …` message means an anchor moved and you must stop and re-derive it, never loosen the assertion).

### F2 — MINOR (stale numbers). Task 2, Step 5: three review counts are pre-v2.

| plan text | measured |
|---|---|
| "Measured 2026-08-27: 2612 removed / 2609 added render as moved." | **2611 removed / 2608 added** |
| "≈250 non-moved" | **273** (73 removed + 200 added) |
| "Expect ~102 lost / ~188 gained" (multiset) | **103 lost / 211 gained** |

Same cause as F1 (BASE_HOOKS grew; every added line lands on the harness side of both counts). Every one of the 273 non-moved lines and all 314 multiset lines is on the plan's own allowed list — enumerated in §1 above; nothing unexplained.

**Fix — Task 2, Step 5:** replace "≈2600 moved-away / ≈2600 moved-to lines and ≈250 non-moved" with "≈2610 moved-away / ≈2610 moved-to lines and ≈275 non-moved"; replace "(Measured 2026-08-27: 2612 removed / 2609 added render as moved.)" with "(Re-measured 2026-08-27: 2611 removed / 2608 added render as moved; 73 + 200 = 273 non-moved.)"; and in the "Stronger cross-check" paragraph replace "Expect ~102 lost / ~188 gained" with "Expect ~103 lost / ~211 gained".

### F3 — MAJOR (missing coverage). Task 3: the S8 `engine hook contract: _engineRehydrate` guard is NOT exercised by any test.

The brief asks that "the hook-contract guards (`engine hook contract:` errors) are exercised by Task 3's contract test". Only ONE of the two is. Deleting the S1 guard turns `run(): a topology bag missing 'workflow' fails AT THE SEAM` RED. Deleting the S8 guard —

```js
    if (!rehydrated || typeof rehydrated.audit !== 'string' || !Array.isArray(rehydrated.memberWorktrees)) throw new Error('engine hook contract: _engineRehydrate must return { checkpointRef, memberWorktrees:[], audit }');
```

— leaves `test/run-harness-hooks.test.mjs` at `ℹ pass 9` / `ℹ fail 0`. The stub's own `_engineRehydrate` always returns a well-formed bag, so nothing ever hits the guard. That matters because the plan's own **P1-d** says the guard exists precisely so that a missing `audit` does not silently insert an EMPTY `pipeline_events` row (`artifacts.mjs:930` coerces `undefined` to `''`) — exactly the P4 mistake it is meant to catch.

**Fix — Task 3, Step 1, append this 10th test to `test/run-harness-hooks.test.mjs`** (empirically verified in this run: GREEN with the guard → `ℹ pass 10` / `ℹ fail 0`; RED without it → `✖ resume(): a rehydrate bag missing 'audit' fails AT THE SEAM…`, `pass 9 / fail 1`):

```js
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

**and update the four counts that follow from it:** Task 3 Step 1 header `create test/run-harness-hooks.test.mjs (**10** tests)`; Task 3 Step 2 `Expected: ℹ pass 10`; Task 3 Step 3 add `(h) delete the S8 'engine hook contract: _engineRehydrate' guard line → the new bag test fails; it survived the full suite before this test existed`; Task 6 Step 5 `BASELINE + **32**`; Task 11 Step 1 `BASELINE + **50**` with the breakdown `Task 3 → 10` and reference final **3810** on a 3760 baseline.

### F4 — MINOR (wrong prediction). Task 8, Step 4: the second mutation names the wrong failing test.

The plan says: *"then widen the mount to `path.join(PROJECT_ROOT, 'src')` → the traversal test fails on its `404` status assertion (`/src/shared/../core/db.mjs` starts serving `src/core`)."*

Widening only the ROOT while leaving the mount path at `/src/shared` makes **test 1** RED instead (`every shared file is served as a module at its repo-relative path`, `actual: 404, expected: 200`) — `/src/shared/graph/constants.mjs` now resolves to `PROJECT_ROOT/src/graph/constants.mjs`, which does not exist. The traversal test still passes. The mutation the plan describes needs the MOUNT PATH widened too; verified in this run:

```js
const SHARED_DIR = path.join(PROJECT_ROOT, 'src');
app.use('/src', express.static(SHARED_DIR, {
```

→ `✖ the mount cannot serve outside src/shared (raw, un-normalized paths)`, `actual: 200, expected: 404`. So the traversal test IS load-bearing; only the wording is wrong.

**Fix — Task 8, Step 4, replace the second mutation with:**

> then widen BOTH the mount path and its root — `const SHARED_DIR = path.join(PROJECT_ROOT, 'src');` and `app.use('/src', express.static(SHARED_DIR, {` → the traversal test fails on its `404` status assertion (`actual: 200`, because `/src/shared/graph/../../core/db.mjs` now resolves inside `src/`). Widening only the ROOT is a different mutation: it turns test 1 RED (`actual: 404, expected: 200`), since every shared file moves out from under the mount. Restore both.

### F5 — MINOR (procedural hazard). Task 1, Step 3: "revert" via `git checkout --` silently discards Step 2.

Task 1's mutation check runs BEFORE Step 4's commit, so `src/core/skills.mjs` is still dirty. Reverting the mutation with `git checkout -- src/core/skills.mjs` reverts to **HEAD**, throwing away the Step-2 implementation as well; the next run then shows `ℹ pass 8` on stale code and the commit would ship nothing. (Hit in this run; caught and re-applied before committing.) Every later task's mutation check is safe because its production file is already committed.

**Fix — Task 1, Step 3, append to the Mutation check line:**

> Restore it **by re-adding the `typeof planOrKeys !== 'string' && ` text**, NOT with `git checkout -- src/core/skills.mjs`: this task is not committed yet, so a checkout reverts to HEAD and silently discards Step 2 as well.

### F6 — TRIVIAL (cross-reference). Task 5, Step 1 points at the wrong step for the test code.

"Write the failing test (full code in **Step 3's** block below…)" — the test block is Step **2**; Step 3 is the commit.

**Fix — Task 5, Step 1:** "(full code in Step 2's block below — write the TEST first, watch it fail on the missing module)".

---

## §3 Mutation table (wave-1 list + the plan's own audits)

Every mutation was applied one at a time and reverted immediately after (`git checkout -- <file>`, or a saved copy where the file was not yet committed).

| # | Mutation | Target file | Test run | Result | Failing assertion |
|---|---|---|---|---|---|
| 1 | S5 seam prints `topology.workflow.id` where the NAME goes | `src/core/run-harness.mjs` | `test/run-harness-hooks.test.mjs` | **RED** `pass 8 / fail 1` | `run(): the topology hook stamps state.stepper…` on `Workflow: \*\*Stub\*\*` |
| 2 | S10 writes a literal instead of `rehydrated.audit` | `src/core/run-harness.mjs` | `test/run-harness-hooks.test.mjs` | **RED** `pass 8 / fail 1` | `resume(): the shell consumes the _engineRehydrate bag…` on `Pipeline **resumed** (stub).` |
| 3 | `this.state.resumePoint = this._enginePrePausePoint();` → `= null;` (S7) | `src/core/run-harness.mjs` | `test/run-harness-hooks.test.mjs` | **RED** `pass 8 / fail 1` | `run(): a pause requested during preflight lands on _enginePrePausePoint…` (`calls.prePause`) |
| 4 | `createOrchestratorFor` gutted (no `readWorkflow`, no `selectEngine`, keeps `async`) | `src/core/engine-select.mjs` | `test/engine-select.test.mjs` | **RED** `pass 3 / fail 2` | both `orch.engine` assertions |
| 5 | `typeof planOrKeys !== 'string'` guard removed | `src/core/skills.mjs` | `test/skills-resolve.test.mjs` | **RED** `pass 7 / fail 1` | `collectRequiredSkills: accepts a Set of agent keys` — the bare-string arm (per-character union) |
| 6 | `FB_WIRE_MAP['wf_clarify-implement']` → `{fb_0:'w5', fb_1:'w9'}` | `src/core/graph/seed-templates.mjs` | `test/graph-seed-templates.test.mjs` | **RED** `pass 10 / fail 1` | ONLY `FB_WIRE_MAP pins the fb_N ↔ wire PAIRING…` — the set-equality/resolver test still passes, exactly as the plan predicts |
| 7 | widen the `/src/shared` mount root to `PROJECT_ROOT/src` | `ui/server.mjs` | `test/api-shared-static.test.mjs` | **RED** `pass 3 / fail 1` | `every shared file is served…` `actual: 404, expected: 200` — a status assertion, but NOT the traversal test the plan names (**F4**) |
| 7b | widen the mount PATH too (`app.use('/src', express.static(PROJECT_ROOT/src))`) | `ui/server.mjs` | `test/api-shared-static.test.mjs` | **RED** `pass 3 / fail 1` | `the mount cannot serve outside src/shared…` `actual: 200, expected: 404` — the traversal test the plan meant |
| 8 | stub engine returning `{manifest, agentKeys}` without `workflow`, with the **S1** contract guard deleted | `src/core/run-harness.mjs` | `test/run-harness-hooks.test.mjs` | **RED** `pass 8 / fail 1` | `run(): a topology bag missing 'workflow' fails AT THE SEAM…` |
| 8b | the **S8** `engine hook contract: _engineRehydrate` guard deleted | `src/core/run-harness.mjs` | `test/run-harness-hooks.test.mjs` + full suite | **GREEN — SURVIVOR** `pass 9 / fail 0` | none — see **F3** for the verified 10th test that kills it |
| 9 | `BOOKEND_EXECUTION_IDS` → `['x:preflight:0','x:done:0']` | `src/shared/graph/constants.mjs` | `test/graph-constants.test.mjs` | **RED** `pass 9 / fail 1` | `BOOKEND_EXECUTION_IDS names the two bookend ledger rows, frozen` |
| 10 | bare `document` token in CODE of a shared file (`export const DOM_PROBE = typeof document;`) | `src/shared/graph/constants.mjs` | `test/shared-graph-purity.test.mjs` | **RED** `pass 2 / fail 1` | `src/shared/** is pure…` → `constants.mjs: DOM global` |
| 10b | the same tokens inside COMMENTS (`//` line + `/** … */` with `document.`, `window.`, `navigator.`, `localStorage`, `the process.`) | `src/shared/graph/constants.mjs` | `test/shared-graph-purity.test.mjs` | **GREEN (required)** `pass 3 / fail 0` | comment stripping holds — no false positive |
| A | Task 3 (a) `state.stepper = null` | `run-harness.mjs` | hooks | **RED** `pass 8 / fail 1` | `deepEqual(orch.state.stepper, …)` |
| B | Task 3 (b) `_preflightAgentKeys([])` | `run-harness.mjs` | hooks | **RED** `pass 8 / fail 1` | ghostAgent test (`res.status === 'done'`) |
| C | Task 3 (c) `_bookend` no-op | `run-harness.mjs` | hooks | **RED** `pass 6 / fail 3` | bookend + run() phase sequence + pre-pause |
| D | Task 3 (d) `_engineRun({ resume: rp })` (drop `rehydrated`) | `run-harness.mjs` | hooks | **RED** `pass 8 / fail 1` | `rehydrated.plan` |
| E | Task 7 impure `src/shared/graph/mutant.mjs` importing `node:path` | new file | purity | **RED** `pass 2 / fail 1` | `mutant.mjs: non-relative import "node:path"` |
| F | Task 8 delete the `/src/shared` 404 tail | `ui/server.mjs` | api-shared-static | **RED** `pass 2 / fail 2` | 404 test (`text/html`) + traversal test |
| G | Task 10 (a) `wf_full` `w13` → `n_check.plan` | seed-templates | seed structural | **RED** `pass 9 / fail 2` | V7 + `reviewer.pass -> checklist.await` |
| H | Task 10 (b) drop `config` from `wf_full` `w12` | seed-templates | seed structural | **RED** `pass 8 / fail 3` | OR-valve + both FB_WIRE_MAP tests |
| I | Task 10 (d) second wire into `wf_quick-fix` `n_review.plan` | seed-templates | seed structural | **RED** `pass 9 / fail 2` | V7 + pin counts |

**Survivors: 1 — mutation 8b** (the S8 `_engineRehydrate` contract guard). Proposed assertion: the 10th test in F3, verified GREEN-with-guard / RED-without in this run.

**Negative check of the script's post-condition guards (not a code mutation — a SCRIPT mutation).** In a throwaway copy holding only `src/core/orchestrator.mjs @ e6968e15`:

- blocks in document order → `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines`, exit 0.
- the S12 block moved AFTER the assembly/write block → `Error: split: S12 not applied — script blocks out of order`, exit 1, and `ls src/core/` shows `orchestrator.mjs` only — **no file was written**. The guard fires before `writeFileSync`, exactly as the plan claims. Copy discarded.

---

## §4 Counts

| Point | Command | Printed | Delta vs BASELINE | Predicted | Verdict |
|---|---|---|---|---|---|
| Task 0 Step 5 — **BASELINE** | `npm test` | `ℹ tests 3760` / `ℹ pass 3760` / `ℹ fail 0` | — | green | **3760** (= the plan's reference baseline) |
| Task 1 Step 3 | `node --test skills-resolve skills-gate-wiring plugin-skills` | `ℹ tests 20` / `ℹ pass 20` / `ℹ fail 0` | +2 new | `ℹ fail 0` | OK |
| Task 2 Step 6 (oracle) | 10 suites | `ℹ tests 156` / `ℹ pass 156` / `ℹ fail 0` | — | 156 / 0 fail | OK — exact |
| Task 2 Step 7 | `npm test` | `ℹ tests 3762` / `ℹ pass 3762` / `ℹ fail 0` | **+2** | BASELINE + 2 | OK — exact |
| Task 3 Step 2 | `node --test run-harness-hooks` | `ℹ tests 9` / `ℹ pass 9` / `ℹ fail 0` | +9 | `ℹ pass 9` | OK — exact |
| Task 4 Step 3 | `node --test engine-select` | `ℹ tests 5` / `ℹ pass 5` / `ℹ fail 0` | +5 | `ℹ pass 5` | OK — exact |
| Task 5 | `node --test graph-constants` | `ℹ tests 10` / `ℹ pass 10` / `ℹ fail 0` | +10 | `ℹ pass 10` | OK — exact |
| Task 6 Step 4 | `node --test graph-verdict runners workspace-mock` | `ℹ tests 22` / `ℹ pass 22` / `ℹ fail 0` | +5 new | 22 tests, `ℹ fail 0` | OK — exact |
| Task 6 Step 5 | `npm test` | **`ℹ tests 3791` / `ℹ pass 3791` / `ℹ fail 0`** | **+31** | **BASELINE + 31** | OK — exact |
| Task 7 Step 2 | `node --test shared-graph-purity` | `ℹ tests 3` / `ℹ pass 3` / `ℹ fail 0` | +3 | `ℹ pass 3` | OK — exact |
| Task 8 Step 3 | `node --test api-shared-static` | `ℹ tests 4` / `ℹ pass 4` / `ℹ fail 0` | +4 | `ℹ pass 4` | OK — exact |
| Task 10 Step 2 | `node --test graph-seed-templates` | `ℹ tests 11` / `ℹ pass 11` / `ℹ fail 0` | +11 | `ℹ pass 11` | OK — exact |
| Task 11 Step 1 — **FINAL** | `npm test` | **`ℹ tests 3809` / `ℹ pass 3809` / `ℹ fail 0`**, `duration_ms 84511.6` | **+49** | **BASELINE + 49**, reference 3809 | OK — exact, and equal to the plan's reference final |

New tests by task: Task 1 → 2, Task 3 → 9, Task 4 → 5, Task 5 → 10, Task 6 → 5, Task 7 → 3, Task 8 → 4, Task 10 → 11. Sum **49**. 3760 + 49 = **3809**. ✅

Other measured numbers: `run-harness.mjs` 2715 lines / `orchestrator.mjs` 1780 lines (F1); moved 2611/2608, non-moved 73+200 (F2); multiset 103 lost / 211 gained (F2); `builtin-workflows.mjs` 49 lines, `seed-templates.mjs` 318 lines (exact); 23 `ui/public` import specifiers (exact).

---

## §5 Final repo state

```
$ git log --oneline e6968e15..HEAD
79c2f7e8 worca: Node-graph v2 P1 — seed graph structural tests
aeb5dc39 worca: Node-graph v2 P1 — the 8 shipping graphs as frozen constants
f6e060f8 worca: Node-graph v2 P1 — serve the shared graph core at /src/shared
407b9624 worca: Node-graph v2 P1 — shared-core purity guard
658fb6ed worca: Node-graph v2 P1 — move the verdict helpers into the shared core
f427e5fa worca: Node-graph v2 P1 — shared graph constants
e86d3adc worca: Node-graph v2 P1 — engine-select module
1c44dc4f worca: Node-graph v2 P1 — run-harness hook contract test
550b1346 worca: Node-graph v2 P1 — split the run harness out of the orchestrator
49c64ffb worca: Node-graph v2 P1 — collectRequiredSkills accepts a key set
e6968e15 Collapse Ring Amount to Whole Thousands (#391)   <- dev, the plan's anchor

$ git status --short
(empty — working tree clean, nothing staged, nothing untracked)

$ git rev-parse --abbrev-ref HEAD
worca-cc/node-graph-v2-p1
```

Never pushed. The clone is left at this end state at
`/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/clones/p1`.
