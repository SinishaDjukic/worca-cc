# P1 plan — anchor fact-check (independent verification)

Plan: `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations.md` (2458 lines)
Verified against: `/Users/denislavprinov/Develop/worca-cc` @ `e6968e15` (dev), Node **v25.6.1**, express 4.22.2 / send 0.19.2 / mime 1.6.0.
Method: every anchor read out of the real file; the extraction script reassembled from the plan's own code blocks and run in a throwaway clone
(`<scratch>/clone`); the whole plan (Tasks 1–10) applied to that clone and the full suite run; a second pristine clone run for BASELINE.
The repo itself was never modified.

## Headline empirical results (independent, not taken from the plan)

| what | plan says | measured |
|---|---|---|
| dev full suite (BASELINE) | 3760 | **3760 / 3760, fail 0** |
| full suite, whole plan applied | 3805 (= 3760+45) | **3805 / 3805, fail 0** |
| `node split-harness.tmp.mjs` | `run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines` | **byte-identical output** |
| `node --check` both files | PARSE-OK | **PARSE-OK**; both modules also import cleanly |
| orchestrator export surface after split | unchanged | `_testing, createOrchestrator, decomposedTaskNode, errStreamAttr, isAbort` — **identical to dev** |
| harness exports | RunHarness + 11 helpers | **exactly those 12** |
| new-test counts | 2/7/5/9/5/3/4/10 = 45 | **all confirmed** (api-shared-static's 4 not run — no servers; the +45 delta is confirmed by 3805−3760) |
| seed files vs old branch | byte-identical | **IDENTICAL** (49 and 318 lines) |

## Findings table

| # | plan location | claim | verdict | correction |
|---|---|---|---|---|
| 1 | Task 2 Files / header | `orchestrator.mjs` is 4369 lines; `class Orchestrator extends EventEmitter` at `:233`; constructor `:234` | **OK** | — |
| 2 | Task 2 script `starts.length === 96` | 96 class members | **OK** | — |
| 3 | Task 2 HARNESS list (63 anchors) | every `name :line` | **OK** | all 63 exact; script's `HARNESS.length === 63` assertion holds |
| 4 | Task 2 V1-ONLY list (14 members + 2 module-level) | every `name :line` | **OK** | all exact (`FANOUT_ELIGIBLE :139`, `decomposedTaskNode :190`, `_dispatch :1961` … `_stepKeyFor :2944`) |
| 5 | Task 2 SHARED list (19 members) | every `name :line` | **OK** | all exact (`_logStepFailure :2390` … `_recordCost :3796`) |
| 6 | Task 2 module-level helper list (37 names) | every `name :line`, `:3985–EOF` | **OK** | all exact, incl. `numOr :3987`, `clip :4322`, `_testing :4369`, `REPO_ROOT :99`, `ERR_STREAM :161`, `errStreamAttr :176` |
| 7 | Task 2 constructor notes | `'wf_default'` default at `:297`; runner assignment at `:306` | **OK** | `:297 this.workflowId = this.opts.workflowId \|\| 'wf_default';` / `:306 this._runners = { clarifier: … }` |
| 8 | Seam S1 | `:489`–`:511`, `:487-488` stay | **OK** | quoted text byte-exact (incl. `:493-495`, `:501-507`, `:510`) |
| 9 | Seam S2 / S3 | `:515` / `:636` `this._phase('preflight', 0, …)` | **OK** | byte-exact |
| 10 | Seam S4 | `:663 const requiredSkills = collectRequiredSkills(this.registry, plan);` | **OK** | byte-exact |
| 11 | Seam S5 | `:709`–`:710` audit + `_dispatch(plan)` | **OK** | byte-exact |
| 12 | Seam S6 | `:717` and `:1000` `this._phase('done', 0, 'done');` | **OK** | byte-exact, exactly 2 occurrences |
| 13 | Seam S7 | `:727`–`:736` boundary literal | **OK** | byte-exact |
| 14 | Seam S8 | `:820 if (rp.version !== 1) throw …` | **OK** | byte-exact |
| 15 | Seam S9 | `:899`, `:905`, `:917` | **OK** | byte-exact; `rp.bus?.code?.baseRef \|\| null` occurs exactly twice |
| 16 | Seam S10, row col 2 | the resume audit line is at `:944`–`:945` | **WRONG** | `:944` is `this.registry = loadAgentRegistry(this.agentsDir);` and `:945` is the `channelDefs` line. The `` await appendAudit(this.pipeline.dir, `Pipeline **resumed** (from ${rp.kind} at step ${rp.stepIndex}).`); `` line is at **`:952`**. Replace the row's anchor with ``:945` (channelDefs) + `:952` (audit)``. The script keys off text, so behavior is unaffected. |
| 17 | Seam S10, row col 2 | the `let plan = rp.plan; … _dispatch(plan, { resume: rp })` block is `:976`–`:994` | **DRIFT** | actual **`:981`–`:994`** (`:981` is the `// ── plan: frozen at pause time …` comment, `:982` is `let plan = rp.plan;`). `:976` is inside the run.json warning string. |
| 18 | Seam table heading | "The ten seams … These are the ONLY non-moved lines the review in Step 5 may show" | **DRIFT** | the script applies **twelve** (S11 = constructor runner hook, S12 = `_preflightAgentKeys` signature); neither is in the table. Retitle "The twelve seams" and add S11/S12 rows, or say "ten in-shell seams + S11/S12 below". |
| 19 | Seam S1 row | "the **8 lines** in the S1 block below" | **DRIFT** | the S1 block is **9 lines**. |
| 20 | Task 2 header | "~60 class members and ~2000 of `orchestrator.mjs`'s 4369 lines move" | **DRIFT** | **63** members; **~2,590** lines move (4369 → 1780). |
| 21 | Task 2 Step 1 | the script "asserts every expected name is found exactly once" | **DRIFT** | it asserts `starts.length === 96` + `members.has(name)`. A duplicated member name would be silently overwritten in the `Map`, not caught. Say "asserts the member count and that every expected name is present". |
| 22 | Task 2 Step 1 | "applies the twelve seam edits (**each** asserted to match exactly once)" | **DRIFT** | S6 and S9 use `all(…, 2)` — asserted to match **twice**. |
| 23 | Task 2 Step 2 | `Expected: run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines` | **OK** | reproduced byte-for-byte in a clean clone of `e6968e15`. |
| 24 | Task 2 Step 3 | `node --check` both → PARSE-OK | **OK** | reproduced; both files also `import()` cleanly. |
| 25 | Task 2 Step 4 | `git status --porcelain` shows `M src/core/orchestrator.mjs` + `?? src/core/run-harness.mjs` | **OK** | reproduced (porcelain prints a leading space: `' M src/core/orchestrator.mjs'`). |
| 26 | **Task 2 Step 5** | `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change -- src/core/orchestrator.mjs` — "Everything must render as moved-away (zebra)" | **WRONG** | `run-harness.mjs` is **untracked** *and* excluded by the pathspec, so git has no "+" side to pair the removals with. Measured: **2643 removed lines plain red (31)**, only 41 coloured as moved. Correct command: `git add -N src/core/run-harness.mjs` then `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change -- src/core/orchestrator.mjs src/core/run-harness.mjs` → measured **2612 removed / 2609 added render as moved**, 72 removed + 177 added plain. (Run the `git add -N` *after* Step 4's status check.) |
| 27 | Task 2 Step 6 | "The full importer list is `grep -l "orchestrator.mjs" test/*.mjs` — **53 files**" | **DRIFT** | that command prints **60**. 53 is the count of *real* importers: `{ grep -lE "from '[^']*orchestrator\.mjs'" test/*.mjs; grep -lE "import\(['\"][^'\"]*orchestrator\.mjs" test/*.mjs; } \| sort -u \| wc -l` → **53**. 7 files only mention the path in comments. |
| 28 | Task 2 Step 6 | "measured: **126 + 43** passing across these files" | **WRONG** | the ten listed paths declare **156** tests. Measured with the split applied: **146 pass / 0 fail** for the nine files excluding `server-pause-resume.test.mjs` (10 tests, not run here). Replace with "156 passing". |
| 29 | Task 2 Step 7 | "with Tasks 1–2 applied: 3760/3760 without Task 1's two new tests, i.e. BASELINE = 3760" | **OK (confusing)** | BASELINE **is 3760** (measured on a pristine clone of `e6968e15`). But with Tasks 1–2 actually applied the run prints **3762**. Reword: "BASELINE measured 3760 on a clone of dev; after Tasks 1–2 the run prints 3762." |
| 30 | Global / every step | `Expected: # pass N`, `# fail 0` (8 occurrences: Steps at plan `:118, :919, :1111, :1232, :1564, :1641, :1779, :2403`) | **WRONG** | Node ≥ 22 uses the **`spec`** reporter by default even when stdout is a pipe. Measured: zero `# pass` / `# fail` lines. It prints `ℹ tests N` / `ℹ pass N` / `ℹ fail 0`. Either change every expectation to `ℹ pass N`, `ℹ fail 0`, or append `--test-reporter=tap` to those commands. |
| 31 | Task 2 `_phase` deviation note | `_phase` has FOUR call sites `:515`, `:636`, `:717`, `:1000`, all bookends | **OK** | exactly those four (`grep -n "_phase(" src/core/orchestrator.mjs` → 4 calls + the definition at `:3746`); per-node phase events come from `_nodeStep :3027` ✓ |
| 32 | Task 2 `_phase` deviation note | "`test/cost-tracking.test.mjs` (**13** calls) and `test/duration-tracking.test.mjs` (**11** calls)" | **DRIFT** | measured `grep -o "_phase(" \| wc -l`: cost-tracking **14**, duration-tracking **10**. (A third file, `test/pause-resume-e2e.test.mjs`, mentions `_phase()` only in a comment — the "two test files call it directly" claim is right.) |
| 33 | Task 2 Interfaces | harness exports `isAbort, errStreamAttr, pauseErr, isPause, sumStepCosts, sumStepActive, roundUsd, firstLine, clip, rel, ERR_STREAM` + `RunHarness` | **OK** | measured exactly those 12 |
| 34 | Task 2 imports prose | `export { isAbort, errStreamAttr };` "public surface kept (test/abort-classify, test/log-provenance)" | **OK** | `test/abort-classify.test.mjs:8` imports `isAbort`, `test/log-provenance.test.mjs:7` imports `errStreamAttr`, both from `../src/core/orchestrator.mjs` |
| 35 | Task 2 imports prose vs script `HARNESS_IMPORTS` | "the same text" | **OK** | byte-identical (plan `:363-411` ≡ `:470-518`) |
| 36 | Task 2 imports prose vs script `ORCH_IMPORTS` | "the same text" | **OK** | identical; the script's copy additionally contains `planAgentKeys`, which the prose shows as the next block |
| 37 | Task 2 prose `BASE_HOOKS` vs script `BASE_HOOKS` | "same text … if you change one, change both" | **DRIFT** | they **already differ**: prose `@param … registry` vs script `_registry`; prose has the extra `manifest -> state.stepper …` lines, "P8 turns these into `exec` rows", and a 3-line `_initRunners` comment the script shortens to one. Only the script's copy lands. Sync the prose to the script (or vice-versa). |
| 38 | Task 2 prose `V1_HOOKS` vs script `V1_HOOKS` | "same text" | **DRIFT** | prose carries `// (orchestrator.mjs:945 on dev)` which the script drops (rewrapped). The anchor `:945` itself is correct. |
| 39 | Task 2 prose `_preflightAgentKeys` block | shows the post-S12 method | **OK** | byte-identical to what the script produces in `run-harness.mjs` |
| 40 | Task 2 script S12 `S12_FROM` | 17 lines keyed off dev `:1921-:1937` | **OK** | byte-exact (`:1921 * @param {object} plan resolveWorkflow() output (or a frozen resume plan)` … `:1937 }`) |
| 41 | Task 2 script `ORCH_IMPORTS` | node:path `{ join, resolve, dirname, basename }` | **DRIFT** | after the split `resolve` and `basename` are **never used** in `orchestrator.mjs` (dead imports). Harmless — no ESLint in the repo — but `import { join, dirname } from 'node:path';` is the honest line. |
| 42 | Task 2 script cut logic | helpers "move iff a HARNESS member uses it"; both-sides helpers exported | **OK** | verified empirically on the generated files: harness-private (`REPO_ROOT, findDisabledPluginFor, RECOVERY_MAX_AUTO_ATTEMPTS, errDetail, safeParse`) have **0** references in the new `orchestrator.mjs`; every "stays" helper (`numOr, jsonClone, FANOUT_ELIGIBLE, MAX_QUESTION_ROUNDS, decomposedTaskNode, SUBAGENT_LABEL_MAX, registerSubAgents, describeToolUses, describeToolResults, toolTarget, SKILLS_MAX, OVERFLOW_RE, mcpServerLabel, skillLabel, extractSkillLabels, GRAPHIFY_CMD_RE, countGraphifyBashCalls, mergeSkills, clipMiddle, normalizeClarifyAnswer`) has **0** references in `run-harness.mjs`. No used-but-not-imported identifier in either file. |
| 43 | Task 2 script comment handling | cuts members "with their leading comment blocks" | **OK (side effect)** | `up()` stops at the first blank line, which is right — but it leaves two now-orphaned banners in `orchestrator.mjs` where `_preflightAgentKeys` was cut: `// ── phase helpers ──` and `// ── data-driven dispatcher ──` now sit back-to-back with no members under the first. Cosmetic; worth a one-line cleanup note in Step 5. |
| 44 | Task 2 script HARNESS/HELPERS coverage vs spec §5.1 | "where they differ from the design spec's list the dev anchor WINS" | **OK** | spec §5.1 HARNESS names **61** members; the script's 63 = spec + `_phase` (Q&A P1-b) + `_preflightAgentKeys` (spec files it under SHARED; Q&A P1-f moves it). Both deviations are documented in the plan's own Q&A. The spec's `:3980` for the helper tail is corrected by the plan to `:3985`. |
| 45 | Task 1 Files | `src/core/skills.mjs:111` = `export function collectRequiredSkills(registry, plan) {` | **OK** | byte-exact |
| 46 | Task 1 Files | "JSDoc directly above at `:101-110`" | **DRIFT** | the JSDoc block is **`:100`–`:110`** (`/**` on `:100`). |
| 47 | Task 1 Step 2 | the quoted `:111-113` three lines | **OK** | byte-exact; the `@param {{steps?: …}} plan` line to replace is `:108` and exists verbatim |
| 48 | Task 1 Step 1 | `Expected: FAIL … with `actual: []`` | **DRIFT** | Node 25 prints `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` then `+ actual - expected` / `+ []` — not the literal token `actual: []`. Substance is right (the Set path returns `[]`). |
| 49 | Task 1 Step 3 / Why-first | three existing test files pass plans | **OK** | `test/skills-resolve.test.mjs` (3 call sites), `test/skills-gate-wiring.test.mjs` (2), `test/plugin-skills.test.mjs` (1); the only production caller is `orchestrator.mjs:663` |
| 50 | Task 1 (empirical) | the appended 2 tests pass after the edit | **OK** | applied to the clone → `skills-resolve` + `skills-gate-wiring` + `plugin-skills` all green |
| 51 | Task 3 test file | imports `useTempHome` from `test/helpers/temp-home.mjs`, `_resetForTests` from `src/core/db.mjs`, `createPipeline` from `src/core/artifacts.mjs` | **OK** | all exist (`db.mjs:1152 export function _resetForTests()`) |
| 52 | Task 3 Step 2 | `# pass 7`, `# fail 0` | **OK (except reporter text, #30)** | measured **7 pass / 0 fail** in ~0.64 s |
| 53 | Task 4 header | `POST /api/run` at `ui/server.mjs:1062` | **WRONG** | actual **`ui/server.mjs:972`** (`app.post('/api/run', async (req, res) => {`) |
| 54 | Task 4 header | factories `≈:1143` / `≈:1210` | **DRIFT** | actual `createOrchestrator(` at **`:1150`** and **`:1203`** |
| 55 | Task 4 header | `resumeRun ≈:1560` | **DRIFT** | `async function resumeRun(` is at **`:1497`**; its `createOrchestrator(` call is at `:1560` |
| 56 | Task 4 header | "CLI run `worca-cc.mjs:1526` and `cmdResume :809`" | **WRONG** | there is **no root-level `worca-cc.mjs`**; the CLI is **`src/cli/worca-cc.mjs`** (`package.json bin.worca`). Within it the line numbers are right: `createOrchestrator(` at `:1526` and at `:809` (inside `cmdResume`, which is declared at `:724`). |
| 57 | Task 4 Interfaces | `readWorkflow(id)` at `workflows.mjs:277`, async, DEFAULT_WORKFLOW for `wf_default`, `null` for unknown | **OK** | byte-exact; `DEFAULT_WORKFLOW.version === 1` (`workflows.mjs:94`) so `selectEngine` correctly says `v1` |
| 58 | Task 4 Step 1 | `Expected: FAIL` — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…'` | **OK** | Node 25.6.1 prints exactly `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<abs path>' imported from <abs path>` |
| 59 | Task 4 Step 3 | `# pass 5` | **OK (reporter text aside)** | measured 5 pass / 0 fail |
| 60 | Task 5 | `constants.mjs` is pure (no imports at all); 9 tests | **OK** | measured 9 pass / 0 fail; passes the Task 7 purity guard |
| 61 | Task 6 Why / Files | `protocol.mjs:8` imports `node:fs/promises`; `SEVERITIES :15`, `BLOCKING :17`, `normalizeSeverity :20-24`, `hasBlocking :244-247`, `blockingIssues :254-257`, local use at `:214` | **OK** | every anchor byte-exact; the five bodies in the new `verdict.mjs` are verbatim copies |
| 62 | Task 6 Interfaces | importers are exactly `src/core/runners.mjs:35`, `src/core/orchestrator.mjs:81`, `test/workspace-mock.test.mjs:15`; other hits are the `summary.blockingIssues` count and `workflows.mjs:452`'s `gate: 'hasBlocking'` string | **OK** | reproduced exactly (one extra harmless hit: a *comment* at `src/core/phases.mjs:939`) |
| 63 | Task 6 Step 2 | replace `protocol.mjs:11-24`; import only `normalizeSeverity` back | **OK** | applied; `protocol.readReview` still normalizes, and `protocol.hasBlocking === verdict.hasBlocking` |
| 64 | Task 6 Step 4 | `node --test graph-verdict + runners + workspace-mock` → 22 tests | **OK (unverified exact 22)** | the trio ran inside a 6-file batch: 37 pass / 0 fail overall, none failing |
| 65 | Task 6 Step 5 | green at BASELINE + 28 | **OK (arithmetic)** | 2+7+5+9+5 = 28 ✓ |
| 66 | Task 7 Step 2 | "23 `ui/public` specifiers, zero false positives" | **OK** | measured **23** specifiers across 19 `ui/public` js files; the guard passes on the real tree |
| 67 | **Task 7 Step 3** | mutation `Expected:` the purity test FAILS with `…/src/shared/graph/mutant.mjs: node: builtin` | **WRONG** | the guard checks import specifiers *before* the banned-token regexes, so the first (and only) failure is `AssertionError [ERR_ASSERTION]: …/src/shared/graph/mutant.mjs: non-relative import "node:path"`. Correction: change the expectation to that message, **or** make the mutant trip only the token regex, e.g. `printf "export const X = process.env.HOME;\n" > src/shared/graph/mutant.mjs` → `…/mutant.mjs: process`. |
| 68 | Task 8 Files | insert between the `/vendor` 404 tail (ends `:769`) and `express.static(PUBLIC_DIR…)` (`:771`); `PROJECT_ROOT` `:164`; `path` imported `:11` | **OK** | all exact; the quoted `ui/server.mjs:766-771` block is byte-exact |
| 69 | Task 8 Step 2 | boot recipe "same as `test/api-hljs-assets.test.mjs:7-38`"; DNS guard `ui/server.mjs:711-716` | **OK (±1)** | the recipe spans `:7`–`:39` (`after` closes at `:39`); the guard block is exactly `:711-716`; `ui/server.mjs:4955` does `export { app, server, runs }` so `mod.app` works |
| 70 | Task 8 Step 3 | "express 4.22.2 → send → mime 1.6.0 serves `.mjs` as `application/javascript`" | **OK** | measured: express **4.22.2**, send **0.19.2**, mime **1.6.0**, `mime.lookup('x.mjs')` → `application/javascript` |
| 71 | Task 8 | 4 tests | **not run** | skipped per the "no servers" constraint (it boots an in-process listener). Its 4 tests are nevertheless accounted for by the confirmed +45 delta (3805 − 3760). |
| 72 | Task 9 header | `builtin-workflows.mjs` 49 lines, `seed-templates.mjs` 318 lines | **OK** | exact |
| 73 | **Task 9 "copied VERBATIM"** | the embedded blocks equal `old:src/core/graph/{builtin-workflows,seed-templates}.mjs` | **OK** | extracted both from the plan and `diff`ed against `origin/worca-cc/v2-orchestrator-bfb6a0ed` (= `0e6cee6f`): **zero differences in either file** |
| 74 | Task 9 Step 1 | the old branch is fetchable | **OK** | `origin/worca-cc/v2-orchestrator-bfb6a0ed` resolves locally to `0e6cee6f` |
| 75 | Task 9 Step 4 | `Expected: wf_full:11/17 … wf_clarify-quick-fix:6/8` | **OK** | reproduced **character-for-character** |
| 76 | Task 10 Step 2 | 10 tests pass against the verbatim files | **OK** | measured 10 pass / 0 fail |
| 77 | Task 11 Step 1 | BASELINE + 45; reference 3803 with every task except Task 1's two tests | **OK** | measured: pristine clone **3760/3760**; whole plan applied **3805/3805, fail 0**. 3805 − 3760 = **45** ✓, and 3805 − 2 = 3803 ✓ |
| 78 | Task 11 Step 2 | six sentinel greps | **OK** | all six print (`export class RunHarness` `run-harness.mjs:221`, `export const SEED_TEMPLATES` `seed-templates.mjs:274`, `selectEngine` `:20`, `createOrchestratorFor` `:34`, `TEMPLATE_VERSION` `:8`, `gatePorts` `:59`, `hasBlocking` `verdict.mjs:28`, `GRAPH_DEFAULT_WORKFLOW` `:23`) |
| 79 | Task 11 Step 3 | `grep -rn "wf_default_v2\|GraphOrchestrator\|createGraphOrchestrator" src/ ui/` → exactly ONE hit | **OK** | one hit: `src/core/engine-select.mjs:40` |
| 80 | Task 11 Step 3 | `grep -c "_phase(" src/core/orchestrator.mjs` → `0` | **OK** | measured `0` on the applied clone (`_phaseCtx(` does not match) |
| 81 | Task 11 Step 3 | `grep -rn "from '/src/shared" ui/ src/ test/ \| wc -l` → `0` | **OK** | measured `0` |
| 82 | Task 11 Step 3 | `git diff e6968e15 -- ui/public/ index.html \| wc -l` → `0` | **OK** | measured `0` |
| 83 | Plan header "Spec:" | the spec is UNTRACKED and absent in a pipeline worktree | **OK (note)** | it is untracked but **present** in this working tree at `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md`; §5.1 was read and cross-checked (row 44) |
| 84 | Series position | HEAD descends from dev `e6968e15` | **OK** | repo HEAD *is* `e6968e15` on branch `dev` |

## Verdict counts

| verdict | count |
|---|---|
| OK | **61** (rows 1–15, 23–25, 29, 31, 33–36, 39, 40, 42–45, 47, 49–52, 57–66, 68–70, 72–84) |
| DRIFT | **15** (rows 17–22, 27, 32, 37, 38, 41, 46, 48, 54, 55) |
| WRONG | **7** (rows 16, 26, 28, 30, 53, 56, 67 → see list below) |
| MISSING | **0** |
| not run | 1 (row 71, `test/api-shared-static.test.mjs` — no-servers constraint) |

(Counting rows, not sub-claims: the ~180 individual `path:line` anchors in Task 2's three member lists all verified clean, so they are folded into rows 3–7.)

## The 10 most consequential corrections

1. **Task 2 Step 5 — the review command cannot work as written.** `git diff --color-moved=zebra … -- src/core/orchestrator.mjs` renders **2643 of the moved-out lines as plain deletions** because `run-harness.mjs` is untracked *and* filtered out by the pathspec. Replace with:
   `git add -N src/core/run-harness.mjs`
   `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change -- src/core/orchestrator.mjs src/core/run-harness.mjs`
   (measured: 2612 removed / 2609 added render as moved; 72 + 177 plain). Put the `git add -N` after Step 4's `git status` check, and note that the status line then reads `A  src/core/run-harness.mjs`.
2. **Every `Expected: # pass N` / `# fail 0` is unmatchable on Node 25.** Node ≥ 22 uses the `spec` reporter even for a pipe; it prints `ℹ tests N` / `ℹ pass N` / `ℹ fail 0`. Eight steps are affected (plan `:118, :919, :1111, :1232, :1564, :1641, :1779, :2403`). Either change the expected text to `ℹ pass N`, `ℹ fail 0`, or add `--test-reporter=tap` to those commands.
3. **Task 4's `POST /api/run` anchor is off by 90 lines**: `ui/server.mjs:1062` → **`:972`**. Also in the same line: factories `≈:1143`/`≈:1210` → **`:1150`/`:1203`**, and `resumeRun ≈:1560` → the function is at **`:1497`** (its `createOrchestrator` call is at `:1560`).
4. **Task 4 names a file that does not exist**: `worca-cc.mjs:1526` → **`src/cli/worca-cc.mjs:1526`** (and `cmdResume` is declared at `:724`; the `createOrchestrator` call inside it is at `:809`). There is no `worca-cc.mjs` at the repo root.
5. **Task 7 Step 3's mutation expectation is the wrong message.** The injected `import { join } from 'node:path'` trips the *relative-import* assertion first: `…/mutant.mjs: non-relative import "node:path"`, never `…: node: builtin`. Fix the expected text, or use a mutant that only trips a token regex (e.g. `export const X = process.env.HOME;` → `…/mutant.mjs: process`).
6. **Task 2 Step 6's oracle numbers are wrong twice.** "53 files" is what `grep -l "orchestrator.mjs" test/*.mjs` is claimed to print — it prints **60** (53 is the real-importer count; 7 files only mention the path in comments). And "126 + 43 passing" → the ten paths declare **156** tests (measured 146 pass / 0 fail for the nine excluding `server-pause-resume`).
7. **Seam S10's anchors.** The `Pipeline **resumed**` `appendAudit` line is at **`:952`**, not `:944-945` (`:945` is only the `channelDefs` line); and the `let plan = rp.plan; … _dispatch(plan, {resume: rp})` block is **`:981`–`:994`**, not `:976`–`:994`. Text-keyed replacement is unaffected — the *table* is what misleads a reviewer.
8. **The seam table says "ten seams … the ONLY non-moved lines"** while the script applies **twelve** (S11 constructor hook, S12 preflight signature). Retitle and add the two rows, otherwise Step 5's review criterion contradicts the script.
9. **Prose `BASE_HOOKS` and the script's `BASE_HOOKS` already differ** (JSDoc `registry` vs `_registry`, three dropped explanatory lines, a shortened `_initRunners` comment) — exactly the drift the plan warns about ("if you change one, change both"). Only the script's copy lands; sync the prose. Same, smaller, for `V1_HOOKS` (the prose's `(orchestrator.mjs:945 on dev)` parenthetical).
10. **`_phase` call counts in the deviation note**: cost-tracking has **14** direct calls (not 13) and duration-tracking **10** (not 11). Also worth adding to Step 5: cutting `_preflightAgentKeys` leaves two orphaned banners back-to-back in `orchestrator.mjs` (`// ── phase helpers ──`, `// ── data-driven dispatcher ──`).

## Bottom line

The plan is **executable as written** — I reproduced the whole thing end to end in a throwaway clone and got **3805/3805, fail 0** against a measured dev BASELINE of **3760/3760**, with the split output matching the plan's line counts exactly and the seed files byte-identical to the discarded branch. Every `path:line` anchor in Task 2's three member lists and every seam quote is correct. The defects are concentrated in the *verification prose*: one step (2.5) whose command cannot demonstrate what it claims, one systematically wrong expected-output format (`# pass`), four wrong navigation anchors in Task 4 (including a non-existent file path), and one wrong mutation message.
