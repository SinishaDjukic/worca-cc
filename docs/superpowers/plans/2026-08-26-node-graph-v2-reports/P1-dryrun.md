# P1 dry-run — executed TDD + mutation audit

**Plan:** `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations.md`
**Clone:** `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/clones/p1` (branch `worca-cc/node-graph-v2-p1`, off dev `e6968e15`)
**WORCA_HOME:** `.../scratchpad/clones/p1-home` exported for every test command.
**Verdict:** the plan is EXECUTABLE AS WRITTEN except for ONE step (Task 2 Step 5, the `--color-moved` review command) and a handful of stale predicted numbers. Everything else — every anchor, every seam, every assertion count, every mutation prediction — reproduced exactly.

---

## §1 Per-task execution log

### Task 0 — branch, deps, baseline

| Step | Predicted | Actual |
|---|---|---|
| 1 | on the pipeline branch | `git checkout -b worca-cc/node-graph-v2-p1` → `Switched to a new branch 'worca-cc/node-graph-v2-p1'`; `rev-parse --abbrev-ref HEAD` → `worca-cc/node-graph-v2-p1` |
| 2 | `node_modules` present or `npm ci` | present (clone was pre-`npm ci`'d) |
| 3 | `git merge-base --is-ancestor e6968e15 HEAD && echo OK` → `OK` | `OK`; `git rev-parse HEAD` → `e6968e1575fb7e6614cea2338c633e2d80493e1c` |
| 4 | old branch fetched or absent (both fine) | already present: `origin/worca-cc/v2-orchestrator-bfb6a0ed` resolves |
| 5 | green BASELINE | **`ℹ tests 3760 / ℹ pass 3760 / ℹ fail 0`** — identical to the plan's reference measurement (3760) |

**Environment deviation (not a plan defect):** the harness instruction to wrap every command in `timeout 900` cannot run on this macOS — `which timeout` → `timeout not found`, and the first attempt returned `EXIT=127 / (eval):4: command not found: timeout`. Every test/node command in this run was wrapped in `perl -e 'alarm 900; exec @ARGV' <cmd>` instead (same 900 s cap).

### Task 1 — `collectRequiredSkills` accepts a key set

| Step | Predicted | Actual |
|---|---|---|
| 1 | `FAIL` with `actual: []` for the Set case | RED as predicted: `✖ collectRequiredSkills: accepts a Set of agent keys (harness entry point)` … `AssertionError [ERR_ASSERTION]` … `actual: []`, `operator: 'deepStrictEqual'` |
| 2 | replace body head + JSDoc line | both anchors matched exactly once (`src/core/skills.mjs:111-113`, JSDoc `:109`); patched |
| 3 | 3 files green, `# fail 0` | `ℹ tests 20 / ℹ pass 20 / ℹ fail 0` |
| 4 | commit | `b90315de worca: Node-graph v2 P1 — collectRequiredSkills accepts a key set` |

### Task 2 — the harness move

Dev anchors re-verified before running: `orchestrator.mjs` = 4369 lines; `class Orchestrator extends EventEmitter {` at `:233`; `async run()` `:474`; `async resume()` `:810`; `_preflightAgentKeys(plan)` `:1923`; `_phase(phase, cycle, status, nodeId = null)` `:3746`. All match the plan.

| Step | Predicted | Actual |
|---|---|---|
| 1 | script assembled from the plan's blocks (constants, scan/cut, S1–S11, S12, EXPORTED/assembly) | assembled verbatim in that order; `node --check` OK (438 lines) |
| 2 | `run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines` | **`run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines`** — exact, zero `split: …` assertion failures |
| 3 | `PARSE-OK` | `PARSE-OK` |
| 4 | porcelain = exactly `M src/core/orchestrator.mjs` + `?? src/core/run-harness.mjs` | exactly that (after `rm split-harness.tmp.mjs`) |
| 5 | move review | **DOES NOT WORK AS WRITTEN — see §2 D-1.** With the fix applied the result is exactly what the plan says. |
| 6 | oracle green, "126 + 43 passing" | `ℹ tests 156 / ℹ pass 156 / ℹ fail 0`. The prediction `# fail 0` holds; the parenthetical count `126 + 43` (=169) does not match the measured 156 — see §2 D-4 |
| 7 | BASELINE + 2 | **`ℹ tests 3762 / ℹ pass 3762 / ℹ fail 0`** = 3760 + 2 ✔ |
| 8 | commit | `9cdbc8f7 worca: Node-graph v2 P1 — split the run harness out of the orchestrator` |

#### Task 2 Step 5 — the `--color-moved` review result (the seam list)

The plan's command (`git diff --color-moved=zebra --color-moved-ws=allow-indentation-change -- src/core/orchestrator.mjs`) detects **no moves at all**: ANSI histogram `{'31': 2643, '32': 55, '1;35': 41, '1;36': 39}` — 2643 plain-red deletions. `run-harness.mjs` is untracked and excluded by the pathspec, so git has nowhere to pair the moved blocks. After `git add -N src/core/run-harness.mjs` and adding that path to the pathspec, the histogram becomes `{'1;35': 2419, '1;34': 193, '1;36': 1655, '1;33': 954, '31': 72, '32': 177}` — i.e. **2612 old-moved / 2609 new-moved lines** and **249 non-moved** (72 `-`, 177 `+`).

**Is the non-moved list exactly what the plan says it should be? YES.**

`src/core/orchestrator.mjs` — 127 non-moved lines, all in the plan's allowed set:
- the old import block replaced by the new one (`node:path`, `node:fs/promises`, the exploded `artifacts.mjs` list → the 3-line list, `cost-budget`/`config`/`agent-registry` splits, the new `run-harness.mjs` import);
- `-class Orchestrator extends EventEmitter {` → `+class Orchestrator extends RunHarness {`;
- `+export { isAbort, errStreamAttr };`;
- `+planAgentKeys` (6 lines);
- the whole `V1_HOOKS` block (`_initRunners`, `_resolveTopology`, `_engineRun`, `_enginePrePausePoint`, `_engineRehydrate`);
- the ten seam ORIGINALS removed (`this._phase('preflight'…)`, `this._phase('done'…)` ×2, `collectRequiredSkills(this.registry, plan)`, the `Workflow: **${plan.name}**` audit + `this._dispatch(plan)`, the boundary-literal `resumePoint`, `rp.bus?.code?.baseRef || null` ×2, `for (const p of rp.bus?.workspace?.projects || [])`, the resume `channelDefs` line, the resume audit line, the `let plan = rp.plan` block, `this._preflightAgentKeys(plan)` ×2, the old `_preflightAgentKeys(plan)` signature + plan-walking loop);
- the 9 helper signature lines that gained an `export ` prefix (`ERR_STREAM`, `roundUsd`, `sumStepCosts`, `sumStepActive`, `pauseErr`, `isPause`, `firstLine`, `rel`, `clip`);
- 2 one-line comment banners (`// ── public control ──`, `// ── main run ──`) and stray braces that fall under git's 3-line minimum block size, so they cannot be paired — cosmetic noise, not edits.

`src/core/run-harness.mjs` — 122 non-moved lines: the 14-line file header, the import block, **all twelve seam replacements S1–S12**, the `BASE_HOOKS` block, and ~14 unpairable `}` / blank lines around the S7/S12 edits. Nothing else.

**Independent cross-check (stronger than `--color-moved`, which is heuristic):** a multiset comparison of every non-blank line of `HEAD:src/core/orchestrator.mjs` (4162 lines) against `orchestrator.mjs + run-harness.mjs` concatenated (4248 lines) yields **102 lost / 188 gained** lines, and every one of them is accounted for by: the two import blocks, the two class-declaration lines, the 9 `export `-prefixed helper signatures, the twelve seams, `planAgentKeys`, `export { isAbort, errStreamAttr }`, the harness file header, `BASE_HOOKS` and `V1_HOOKS`. **Zero unaccounted content changes** — the move is behaviour-preserving by construction, and the 3762/3762 suite agrees.

### Task 3 — `test/run-harness-hooks.test.mjs`

| Step | Predicted | Actual |
|---|---|---|
| 2 | `# pass 7`, `# fail 0` | `ℹ tests 7 / ℹ pass 7 / ℹ fail 0` (`duration_ms 591`) |
| 3 | 4 mutations, each RED | all four RED — see §3 rows M1–M4 |
| 4 | commit | `76249f85 worca: Node-graph v2 P1 — run-harness hook contract test` |

### Task 4 — `src/core/engine-select.mjs`

Anchors re-verified: `readWorkflow` is `export async function readWorkflow(id)` at `workflows.mjs:277`; `createOrchestrator` at `orchestrator.mjs:115`.

| Step | Predicted | Actual |
|---|---|---|
| 1 | `Cannot find module '…/src/core/engine-select.mjs'` | exactly that (`ERR_MODULE_NOT_FOUND`), `ℹ pass 0` |
| 3 | `# pass 5`, `# fail 0` | `ℹ tests 5 / ℹ pass 5 / ℹ fail 0` |
| 4 | commit | `fc5acb2c worca: Node-graph v2 P1 — engine-select module` |

### Task 5 — `src/shared/graph/constants.mjs`

| Step | Predicted | Actual |
|---|---|---|
| test-first | `Cannot find module '…/src/shared/graph/constants.mjs'` | exactly that |
| 2 | `# pass 9`, `# fail 0` | `ℹ tests 9 / ℹ pass 9 / ℹ fail 0` |
| 3 | commit | `3ebe039a worca: Node-graph v2 P1 — shared graph constants` |

### Task 6 — `src/shared/graph/verdict.mjs`

Anchors re-verified on dev: `SEVERITIES :15`, `const BLOCKING :17` (NOT exported on dev), `function normalizeSeverity :20-24` (NOT exported on dev), `hasBlocking :244-247`, `blockingIssues :254-257`, `normalizeSeverity` used at `:214`. All exact.

| Step | Predicted | Actual |
|---|---|---|
| 1–3 | move verbatim, protocol re-exports | both anchors matched once; `protocol.mjs` now 226 lines, no dangling `BLOCKING` |
| 4 | `# fail 0`, 22 tests | `ℹ tests 22 / ℹ pass 22 / ℹ fail 0` — exactly the plan's 22 |

| 5 | BASELINE + 28 | **`ℹ tests 3788 / ℹ pass 3788 / ℹ fail 0`** = 3760 + 28 ✔ |
| 6 | commit | `855710ea worca: Node-graph v2 P1 — move the verdict helpers into the shared core` |

### Task 7 — `test/shared-graph-purity.test.mjs`

| Step | Predicted | Actual |
|---|---|---|
| 2 | `# pass 3`, `# fail 0` ("23 ui/public specifiers, zero false positives") | `ℹ tests 3 / ℹ pass 3 / ℹ fail 0` — zero false positives confirmed (the two `from`-looking strings in `ui/public/app.js:1263` and `:2340` are correctly NOT matched) |
| 3 | mutant.mjs → FAIL with `…mutant.mjs: node: builtin` | FAILS (`ℹ pass 2 / ℹ fail 1`) but with a DIFFERENT message: `AssertionError […]: …/src/shared/graph/mutant.mjs: non-relative import "node:path"` — the relative-import assertion fires first. Guard bites; the plan's predicted message text is wrong. See §2 D-3. After `rm`: `ℹ pass 3 / ℹ fail 0` |
| 4 | commit | `dcb03e1f worca: Node-graph v2 P1 — shared-core purity guard` |

### Task 8 — serve `/src/shared`

Anchors re-verified: `PROJECT_ROOT` `ui/server.mjs:164`, `import path from 'node:path'` `:11`, the `/vendor` 404 tail ends `:769`, `express.static(PUBLIC_DIR…)` `:771`. Exact.

| Step | Predicted | Actual |
|---|---|---|
| 3 | `# pass 4`, `# fail 0` (express serves `.mjs` as `application/javascript`) | `ℹ tests 4 / ℹ pass 4 / ℹ fail 0` — all four green first try |
| 4 | delete the 404 tail → the 404 test fails with `text/html` | RED: `ℹ pass 3 / ℹ fail 1`, `AssertionError [ERR_ASSERTION]: /src/shared/graph/nope.mjs`. Restored → 4/4 |
| 5 | commit | `392fbf4e worca: Node-graph v2 P1 — serve the shared graph core at /src/shared` (`ui/server.mjs | 15 +++`) |

### Task 9 — the 8 shipping graphs

| Step | Predicted | Actual |
|---|---|---|
| 1 | `IDENTICAL` for both files | `IDENTICAL (seed-templates)`, `IDENTICAL (builtin-workflows)`. **Note: as written this check is a tautology** (it diffs the git blob against a file just written from that same blob) — see §2 D-5. I ran the check that actually matters instead: the plan's EMBEDDED blocks vs the branch files → `plan-embedded seed-templates == branch file`, `plan-embedded builtin-workflows == branch file`. Byte-identical, so a no-network execution typing from the plan lands the same bytes. |
| 4 | `wf_full:11/17 wf_no-clarify:9/13 wf_provided-plan:9/14 wf_full-no-decompose:10/15 wf_quick-fix:5/6 wf_clarify-implement:7/10 wf_clarify-quick-fix:6/8` | **byte-for-byte that string** |
| 5 | commit | `0574c1a1 worca: Node-graph v2 P1 — the 8 shipping graphs as frozen constants` |

### Task 10 — `test/graph-seed-templates.test.mjs`

| Step | Predicted | Actual |
|---|---|---|
| 2 | `# pass 10`, `# fail 0` | `ℹ tests 10 / ℹ pass 10 / ℹ fail 0` |
| 3 | (a) RED on await + V7; (b) RED on FB_WIRE_MAP; (c) GREEN (documented, deliberate); (d) RED on V7 | (a) RED — `✖ V7…` + `✖ reviewer.pass -> checklist.await…` (2 fails); (b) RED — `✖ the OR valve appears on exactly the three double-loop seeds` + `✖ FB_WIRE_MAP equals the dynamic (from,to) resolver…`; (c) **GREEN, `ℹ pass 10 / ℹ fail 0`** — exactly the survivor the plan documents; (d) RED — `✖ the 8 shipping graphs: ids, names, version, domain, pin counts` + `✖ V7…`. Each reverted; 10/10 restored. |
| 4 | commit | `97b0501b worca: Node-graph v2 P1 — seed graph structural tests` |

---

## §2 Deviations / placeholder resolutions (plan-ready text)

### D-1 — **BLOCKING.** Task 2, Step 5: the review command detects no moves at all

`run-harness.mjs` is UNTRACKED when Step 5 runs, and the pathspec names only `orchestrator.mjs`, so `git diff` has no "new" side to pair the moved blocks against. Measured: ANSI histogram `{'31': 2643 plain-red, '32': 55 plain-green, '1;35': 41, '1;36': 39}` — 2643 of ~2612 moved lines render as ordinary deletions, and the reviewer would have to eyeball them one by one. Replace Task 2 Step 5's first paragraph with:

> - [ ] Step 5: Review the move as a move. `run-harness.mjs` is untracked, so git has nothing to pair the moved blocks with — stage its existence first (content stays in the working tree) and diff BOTH paths:
> `git add -N src/core/run-harness.mjs`
> `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change -- src/core/orchestrator.mjs src/core/run-harness.mjs`
> Expect ≈2600 moved-away / ≈2600 moved-to lines and ≈250 non-moved. Everything must render as moved except: (orchestrator) the new import block, `class Orchestrator extends RunHarness {`, the `V1_HOOKS` block, `planAgentKeys`, `export { isAbort, errStreamAttr };`, the nine helper signature lines that gained an `export ` prefix, and the ten seam ORIGINALS; (harness) the file header, the import block, the twelve seam replacements S1–S12 and `BASE_HOOKS`. One-line comment banners, lone `}` and blank lines also show as non-moved — git's move detection needs ≥3 lines per block, so these cannot be paired; they are noise, not edits.
> **Stronger cross-check (do this too — `--color-moved` is a heuristic):** `git show HEAD:src/core/orchestrator.mjs` vs `cat src/core/orchestrator.mjs src/core/run-harness.mjs`, compared as a multiset of non-blank lines. Expect ~102 lost / ~188 gained, ALL accounted for by the two import blocks, the two class lines, the nine `export `-prefixed helpers, the twelve seams, `planAgentKeys`, the `export {…}` line, the harness header, `BASE_HOOKS` and `V1_HOOKS`. Any other line is a bug in the script.

### D-2 — Environment: `timeout` does not exist on macOS

`which timeout` → `timeout not found` (no coreutils/`gtimeout`); the literal wrapper returns `EXIT=127 / command not found: timeout`. Use `perl -e 'alarm 900; exec @ARGV' <cmd>` (same cap, always available). Affects the runner's instructions, not the plan text.

### D-3 — Task 7 Step 3: the predicted mutation message is wrong

The plan predicts `…/src/shared/graph/mutant.mjs: node: builtin`. The actual first failure is the relative-import assertion, which runs earlier in the same loop. Replace the Expected line with:

> `Expected:` the purity test FAILS with `…/src/shared/graph/mutant.mjs: non-relative import "node:path"` (the relative-import assertion fires before the `node:`-builtin one; both pin the same rule). After `rm`, re-run → `# pass 3`.

### D-4 — Task 2 Step 6: the parenthetical test count is wrong

Plan: "(measured: 126 + 43 passing across these files with the split applied)" = 169. Measured here: `ℹ tests 156 / ℹ pass 156 / ℹ fail 0`. The pass/fail criterion is right; only the number is stale. Replace with:

> `Expected: # fail 0` (measured 2026-08-27 on a clone of dev `e6968e15` with the split applied: **156 tests, 0 fail**).

### D-5 — Task 9 Step 1: the byte-identity check is a tautology

`git show <branch>:F > F` followed by `git show <branch>:F | diff - F` compares the blob to a file just written from that blob; it can never fail and proves nothing about the plan's embedded copy. Replace Step 1's last sentence with:

> then verify the PLAN's embedded copy against the branch (this is the check that can actually fail — it is what a no-network execution would type):
> `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:src/core/graph/seed-templates.mjs | diff - src/core/graph/seed-templates.mjs && echo IDENTICAL`
> — run this AFTER writing the file from the plan's blocks, not after `git show > file`. Verified here: the plan's embedded blocks are byte-identical to both branch files, so either path lands the same bytes.

### D-6 — cosmetic: Task 2's member count is stated two ways

The script asserts `starts.length === 96` and `HARNESS.length === 63`; the prose says "~60 class members". Both assertions passed unchanged. No action needed, noted for completeness.

**Everything else in the plan executed EXACTLY as written** — every `path:line` anchor, every `once()`/`all()` seam assertion (12 of 12 matched exactly once), every predicted line count, every predicted per-file test count, and 3 of 3 full-suite deltas.

### Task 11 — full suite, sentinels, handoff

| Step | Predicted | Actual |
|---|---|---|
| 1 | BASELINE + 45 (reference final 3805) | **`ℹ tests 3805 / ℹ pass 3805 / ℹ fail 0`** = 3760 + 45 ✔ — identical to the plan's reference |
| 2 | 6 sentinel greps all print | all print: `run-harness.mjs:221 export class RunHarness extends EventEmitter {`; `seed-templates.mjs:274 export const SEED_TEMPLATES = deepFreeze([`; `engine-select.mjs:20/34 selectEngine / createOrchestratorFor`; `constants.mjs:8/59 TEMPLATE_VERSION / gatePorts`; `verdict.mjs:28 hasBlocking`; `builtin-workflows.mjs:23 GRAPH_DEFAULT_WORKFLOW` |
| 3 | hygiene | `git status --porcelain` empty; no `docs/superpowers` path in any of the 10 commits; no `split-harness.tmp.mjs`; all 10 commits prefixed `worca: Node-graph v2 P1 — `; `grep -rn "wf_default_v2\|GraphOrchestrator\|createGraphOrchestrator" src/ ui/` → exactly 1 hit (`engine-select.mjs:40`, the comment); `grep -c "_phase(" src/core/orchestrator.mjs` → `0`; `grep -rn "from '/src/shared" ui/ src/ test/ \| wc -l` → `0`; `git diff e6968e15 -- ui/public/ index.html \| wc -l` → `0` |
| 4 | manual browser check | **NOT PERFORMED** — this run is forbidden servers/browsers. The server half is covered automatically by `test/api-shared-static.test.mjs` (200 + `application/javascript; charset=UTF-8` + `nosniff` + body equality; 404 + `text/plain; charset=utf-8` + body `Not found`), measured directly against a booted `ui/server.mjs`. Only "a real Chrome executes the module" is unverified. |
| 5 | commit outstanding | nothing outstanding |

---

## §3 Mutation audit

Every mutation was applied alone and reverted with `git checkout -- <file>` before the next. `RED` = the named test file failed; `GREEN` = **SURVIVOR**.

### Plan-prescribed mutations (all as predicted)

| # | Test file | Mutation | Result |
|---|---|---|---|
| M1 | run-harness-hooks | `state.stepper = topology.manifest` → `= null` | RED (`✖ run(): the topology hook stamps state.stepper…`) |
| M2 | run-harness-hooks | `_preflightAgentKeys(topology.agentKeys)` → `([])` | RED (`✖ run(): a key the registry does not know…`) |
| M3 | run-harness-hooks | `_bookend` → no-op | RED ×2 (`✖ the base implements _bookend…`, `✖ run(): the topology hook…`) |
| M4 | run-harness-hooks | `_engineRun({resume: rp, rehydrated})` → drop `rehydrated` | RED (`✖ resume(): the shell consumes the _engineRehydrate bag…`) |
| P7 | shared-graph-purity | add `src/shared/graph/mutant.mjs` importing `node:path` | RED (message differs — see §2 D-3) |
| P8 | api-shared-static | delete the `/src/shared` 404 tail | RED (`✖ a missing shared path 404s as text/plain…`) |
| S-a | graph-seed-templates | `wf_full` w13 → `n_check.plan` | RED ×2 (V7 + await) |
| S-b | graph-seed-templates | drop `config` from `wf_full` w12 | RED ×2 (OR valve + FB_WIRE_MAP) |
| S-c | graph-seed-templates | `FB_WIRE_MAP['wf_clarify-implement']` → `{fb_0:'w5', fb_1:'w9'}` | **GREEN — documented, deliberate survivor** (the plan states it; the fb_N↔wire pairing for that template is unverifiable, which is why V24 resolves dynamically) |
| S-d | graph-seed-templates | second wire into `wf_quick-fix` `n_review.plan` | RED ×2 (pin counts + V7) |

### Additional mutations (this audit)

| # | Test file | Mutation | Result |
|---|---|---|---|
| M5 | run-harness-hooks | base `_resolveTopology` returns instead of throwing | RED (test 1) |
| M6 | run-harness-hooks | base `_initRunners` installs `this._runners = {}` | RED (test 2) |
| M7 | run-harness-hooks | §9.4 message text → `agent "${key}" is missing` | RED ×2 (tests 3, 5) |
| M8 | run-harness-hooks | `_preflightAgentKeys` never throws | RED ×2 (tests 3, 5) |
| M9 | engine-select | `Number(raw) === 2` → `raw === 2` | RED (test 1: the `'2'` case) |
| M10 | engine-select | template row wins over the resume point | RED (test 2) |
| M11 | engine-select | `createOrchestratorFor` no longer `async` | RED (test 3) |
| **M12** | **engine-select** | **gut the factory: no `readWorkflow`, no `selectEngine` call (keep `async`)** | **GREEN — SURVIVOR** |
| M13 | graph-constants | `TEMPLATE_VERSION` 2 → 3 | RED (test 1) |
| M14 | graph-constants | `KINDS` not frozen | RED (test 2) |
| M15 | graph-constants | `AWAIT_PORT.required` false → true | RED (test 3) |
| M16 | graph-constants | `TASK_PORTS` output id `task` → `out` | RED (test 4) |
| M17 | graph-constants | `END_PORTS.result.required` true → false | RED (test 5) |
| M18 | graph-constants | AND `out` type `void` → `any` | RED (test 6) |
| M19 | graph-constants | `gatePorts` clamp min 2 → 1 | RED (test 7) |
| M20 | graph-constants | `NODE_ID_RE` admits uppercase | RED (test 8) |
| M21 | graph-constants | `WIRE_ID_RE` requires the underscore | RED (test 8 — the `w1` seed ids) |
| M22 | graph-constants | `LIMITS.maxNodes` 80 → 100 | RED (test 9) |

| # | Test file | Mutation | Result |
|---|---|---|---|
| M23 | graph-verdict | `BLOCKING` gains `'minor'` | RED ×2 (tests 1, 3) |
| M24 | graph-verdict | `normalizeSeverity` drops `.toLowerCase()` | RED ×3 (tests 2, 3, 5) |
| M25 | graph-verdict | `hasBlocking` drops the `Array.isArray` guard | RED (test 3) |
| M26 | graph-verdict | `protocol.mjs` re-exports a LOCAL COPY instead of the shared bindings | RED (test 4 — the one-source identity check bites) |
| M27 | graph-verdict | `normalizeReview` stops calling `normalizeSeverity` | RED (test 5) |
| M28 | shared-graph-purity | DOM bare word (`document`) inside a comment in `constants.mjs` | RED (test 2) |
| M29 | shared-graph-purity | top-level `let` in `verdict.mjs` | RED (test 2) |
| M30 | shared-graph-purity | rename `constants.mjs` away (vacuity probe) | RED (test 1 — the anti-vacuity guard works) |
| M31 | shared-graph-purity | `ui/public/log-line.mjs` imports `../../src/core/protocol.mjs` | RED (test 3 — the escape branch bites) |
| M32 | shared-graph-purity | bare specifier (`'lodash-es'`) in `ui/public` | RED (test 3) |
| M33 | api-shared-static | drop the `nosniff` `setHeaders` | RED (test 1) |
| M34 | api-shared-static | widen the mount to `/src` over `PROJECT_ROOT/src` | RED (test 3 — the traversal test is NOT vacuous) |
| M35 | skills-resolve | remove the iterable branch (plan path only) | RED (the new Set test) |
| **M36** | **skills-resolve** | **remove the `typeof planOrKeys !== 'string'` guard** | **GREEN — SURVIVOR** |
| M37 | skills-resolve | iterable branch swallows the plan path too | RED ×2 (the pre-existing plan test + the new one) |
| M38 | graph-seed-templates | `deepFreeze(SEED_TEMPLATES)` → shallow `Object.freeze` | RED (test 10) |
| M39 | run-harness (S4 seam) | skills gate fed `[]` instead of `topology.agentKeys` | RED ×3 in `skills-gate-wiring` |
| **M40** | **run-harness (S5 seam)** | **audit line prints `topology.workflow.id` where the name goes** | **GREEN — SURVIVOR** (no test anywhere greps `Workflow: **`) |

### Survivors, and the assertion that catches each (all three fixes VALIDATED here: green unmutated, red under the mutation)

**SURVIVOR 1 — M40, `test/run-harness-hooks.test.mjs`.** The S5 seam turned a v1 local (`plan.name`/`plan.id`) into hook output (`topology.workflow.name`/`.id`) — that third field exists only for this audit line (clarification P1-c) — yet `grep -rn "Workflow: \*\*" test/` returns **0 files**. A P4 `GraphOrchestrator` returning `workflow: {}` would silently write `Workflow: **undefined** (undefined).`. Add to the `run()` test (import `getDb` alongside `_resetForTests`):

```js
  // The workflow field of the topology bag is what the audit line renders (P1-c).
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id')
    .all(orch.pipeline.id).map((r) => r.text).join('\n');
  assert.match(audit, /Workflow: \*\*Stub\*\* \(wf_stub\)\./, 'the audit line comes from topology.workflow');
```

**SURVIVOR 2 — M12, `test/engine-select.test.mjs`.** `createOrchestratorFor` can be reduced to `await Promise.resolve(); return createOrchestrator(opts);` — no row read, no selector call — and all 5 tests stay green. The selector is tested in isolation and the factory is tested only for "returns a v1 orchestrator", so nothing pins that the factory consults the DATA, which is the module's entire premise and exactly the seam P4 flips. Make the decision observable (2 lines of production code) and pin it:

```js
// src/core/engine-select.mjs — in createOrchestratorFor, replacing the bare selectEngine(...) call:
  const engine = selectEngine({ templateVersion, resumePointVersion });
  // P4 routes 'graph' to createGraphOrchestrator(opts); until then every run is v1.
  const orch = createOrchestrator(opts);
  orch.engine = engine; // the decision the data made, observable by callers and tests
  return orch;
```
```js
// test/engine-select.test.mjs — one line in each of the two factory tests:
  assert.equal(orch.engine, 'v1', 'the factory records the selector\'s answer for the row it read');
  …
  assert.equal(orch.engine, 'graph', 'the factory consulted the resume point, not just the row');
```

**SURVIVOR 3 — M36, `test/skills-resolve.test.mjs`.** Deleting the `typeof planOrKeys !== 'string'` guard keeps all 8 tests green, yet a bare string is iterable: `collectRequiredSkills(reg, 'planner')` would union per CHARACTER. Append to the new Set test:

```js
  // A bare string is iterable but is NOT a key list: it must not union per character.
  assert.deepEqual(collectRequiredSkills({ ...registry, p: { requiresSkills: ['perChar'] } }, 'planner'), []);
```

### Vacuity audit

- `test/shared-graph-purity.test.mjs` test 1 is a real anti-vacuity guard — M30 (renaming `constants.mjs`) turns it RED.
- `test/shared-graph-purity.test.mjs` test 3 is **fully vacuous at P1 for its headline claim**: no `ui/public` specifier escapes the static root yet, so the only assertion that runs on real files is "every specifier is relative" (M32 proves that one bites). M31 proves the escape branch bites once exercised, so the test is sound — it just has nothing to check until P5.
- Within test 3, the closing `assert.equal(url, '/' + relative(ROOT, onDisk))` is **structurally unfalsifiable**: `ui/public` sits exactly 2 levels under the repo root, so any specifier whose disk path lands inside `src/shared` also produces the URL `/src/shared/…` after the browser's root clamp (verified over 5 depth/`..`-count combinations — every divergent case is rejected one line earlier by `startsWith(SHARED)`). Harmless, but it adds no coverage; the real guard is the preceding assertion.
- `test/api-shared-static.test.mjs` test 3 is NOT vacuous (M34 turns it RED) but its assertion is weak: it only checks `doesNotMatch(body, /node:sqlite/)`. Measured, all three traversal probes return `404 text/plain "Not found"`. Consider adding `assert.equal(res.status, 404, p)` so a 500 or an HTML fallthrough cannot pass silently.
- `test/run-harness-hooks.test.mjs` test 1 returns `Promise.all([assert.rejects(...), ...])`, which `node:test` awaits — the async assertions really run (M5 turns it RED). No `assert.doesNotThrow`-style escape hatches anywhere in the new tests.
- No probe fails before reaching its guard: every mutation above produced an assertion failure at the intended assertion, never a lookup/import error, except M30 which is intentionally a missing-file probe.

---

## §4 Counts

| | Tests | Note |
|---|---|---|
| **BASELINE** (Task 0, dev `e6968e15`) | **3760 / 3760 green** | matches the plan's reference exactly |
| after Task 2 (harness move) | 3762 / 3762 | = BASELINE + 2 (Task 1's two) — predicted BASELINE + 2 ✔ |
| after Task 6 (verdict move) | 3788 / 3788 | = BASELINE + 28 — predicted BASELINE + 28 ✔ |
| **FINAL** (Task 11) | **3805 / 3805 green** | = BASELINE + **45** — predicted BASELINE + 45, reference final 3805 ✔ |

**Tests added: 45**, exactly the plan's split — Task 1 → 2, Task 3 → 7, Task 4 → 5, Task 5 → 9, Task 6 → 5, Task 7 → 3, Task 8 → 4, Task 10 → 10. Every per-file count was measured individually and every one matched (20/20, 156/156, 7/7, 5/5, 9/9, 22/22, 3/3, 4/4, 10/10).

`src/core/orchestrator.mjs` 4369 → 1780 lines; `src/core/run-harness.mjs` 2693 lines (predicted `2693` / `1780` — exact).

Post-audit re-verification of every new/modified test file after all mutations were reverted: `ℹ tests 67 / ℹ pass 67 / ℹ fail 0`, working tree clean.

---

## §5 Clone final state

`git log --oneline -11`:

```
97b0501b worca: Node-graph v2 P1 — seed graph structural tests
0574c1a1 worca: Node-graph v2 P1 — the 8 shipping graphs as frozen constants
392fbf4e worca: Node-graph v2 P1 — serve the shared graph core at /src/shared
dcb03e1f worca: Node-graph v2 P1 — shared-core purity guard
855710ea worca: Node-graph v2 P1 — move the verdict helpers into the shared core
3ebe039a worca: Node-graph v2 P1 — shared graph constants
fc5acb2c worca: Node-graph v2 P1 — engine-select module
76249f85 worca: Node-graph v2 P1 — run-harness hook contract test
9cdbc8f7 worca: Node-graph v2 P1 — split the run harness out of the orchestrator
b90315de worca: Node-graph v2 P1 — collectRequiredSkills accepts a key set
e6968e15 Collapse Ring Amount to Whole Thousands (#391)
```

`git status --short`:

```
(empty — working tree clean)
```

Clone left IN PLACE at the plan's end state for wave 2: `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/clones/p1` on branch `worca-cc/node-graph-v2-p1` @ `97b0501b`. Nothing pushed.
