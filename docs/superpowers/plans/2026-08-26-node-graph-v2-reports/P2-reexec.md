# P2 wave-2 full re-execution (Opus) — report

Clone: `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/clones/p2`
Branch: `worca-cc/node-graph-v2-p2`, reset to `e6968e15` before Task 0.
`WORCA_HOME=…/scratchpad/clones/p2-home` exported for every test command.
Plans executed, in order:
1. `docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations-v2.md` (prerequisite)
2. `docs/superpowers/plans/2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store-v2.md` (P2a Tasks 0–14, P2b Tasks B0–B10)

Method: every code block was extracted from the plan file mechanically
(`awk` fence counter, block index → file) and every in-place edit was applied as an
exact literal substitution asserted to match once. Nothing was retyped.

---

## §0 P1 v2 prerequisite notes

| task/step | predicted | actual | verdict |
|---|---|---|---|
| T0 S1 branch | pipeline branch | `worca-cc/node-graph-v2-p2` | OK |
| T0 S3 lineage | `OK` | `OK` | OK |
| T0 S4 old branch | present or fetched | present | OK |
| T0 S5 BASELINE | `ℹ fail 0` | **`ℹ tests 3760 / pass 3760 / fail 0`** | OK |
| T1 S1 | FAIL, `+ []` for the Set case | `ℹ pass 7 / fail 1`, AssertionError deep-equal | OK |
| T1 S3 | pass, `ℹ fail 0` (3 files) | `ℹ tests 20 / pass 20 / fail 0` | OK |
| T1 S3 mutation | Set test RED | `ℹ pass 7 / fail 1` → restored `pass 8 / fail 0` | OK |
| T2 S2 | `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines` | **byte-exact same line** | OK |
| T2 S3 | `PARSE-OK` | `PARSE-OK` | OK |
| T2 S4 | exactly `M src/core/orchestrator.mjs`, `?? src/core/run-harness.mjs` | same, nothing else | OK |
| T2 S5 multiset | ~103 lost / ~211 gained | **103 / 211** | OK |
| T2 S6 oracle | `ℹ fail 0`, 156 tests | `ℹ tests 156 / pass 156 / fail 0` | OK |
| T2 S7 | BASELINE + 2 | **3762** | OK |
| T3 S2 | `ℹ pass 10`, `ℹ fail 0` | `ℹ tests 10 / pass 10 / fail 0` | OK |
| T3 S3 mutations (a)–(h) | all RED | (a)1 (b)1 (c)3 (d)1 (e)1 (f)1 (g)1 (h)1 fails — all RED | OK |
| T4 S1 | `ERR_MODULE_NOT_FOUND` | same | OK |
| T4 S3 | `ℹ pass 5`, `ℹ fail 0` | `ℹ tests 5 / pass 5 / fail 0` | OK |
| T4 S3 mutation (gut factory) | 2 `orch.engine` assertions RED | `ℹ pass 3 / fail 2` | OK |
| T5 S2 | FAIL, cannot find constants.mjs | same | OK |
| T5 S4 | `ℹ pass 10`, `ℹ fail 0` | `ℹ tests 10 / pass 10 / fail 0` | OK |
| T6 S4 | `ℹ fail 0`, 22 tests | `ℹ tests 22 / pass 22 / fail 0` | OK |
| T6 S5 | BASELINE + 32 | **3792** | OK |
| T7 S2 | `ℹ pass 3`, `ℹ fail 0` | `ℹ tests 3 / pass 3 / fail 0` | OK |
| T7 S3 mutations | `non-relative import "node:path"`; `constants.mjs: DOM global` | both messages verbatim, `pass 2 / fail 1` each | OK |
| T8 S3 | `ℹ pass 4`, `ℹ fail 0` | `ℹ tests 4 / pass 4 / fail 0` | OK |
| T8 S4 mutations | 404-tail RED; widen mount+root RED; widen root only RED | fail 2 / fail 1 / fail 2 | OK (see P1-D1) |
| T9 S1 identity | `IDENTICAL` | `IDENTICAL` | OK |
| T9 S4 | `wf_full:11/17 …` | byte-identical line | OK |
| T10 S2 | `ℹ pass 11`, `ℹ fail 0` | `ℹ tests 11 / pass 11 / fail 0` | OK |
| T10 S3 mutations (a)–(d) | all RED | (a)2 (b)3 (c)1 (d)2 fails — all RED | OK (see P1-D2) |
| T11 S1 | BASELINE + 50 | **3810** (= 3760 + 50) | OK |
| T11 S2 sentinels | all six greps print | all print (`RunHarness :221`, `SEED_TEMPLATES :274`, `selectEngine :20`/`createOrchestratorFor :35`, `TEMPLATE_VERSION :8`/`gatePorts :59`, `hasBlocking :28`, `GRAPH_DEFAULT_WORKFLOW :23`) | OK |
| T11 S3 hygiene | porcelain clean, 10 `worca: … P1 —` commits, 1 grep hit, `_phase(` 0, abs specifiers 0, `ui/public` diff 0 | exactly that | OK |
| T11 S4 | manual browser check | **NOT RUN** — the wave-2 brief forbids browsers/servers | skipped by brief |

**P1 v2 deviations found (both minor, plan-ready fixes in §2 as P1-D1/P1-D2). Otherwise the plan executed verbatim: 12/12 tasks, 3760 → 3810 exactly as predicted.**

---

## §1 per-task log — P2

BASELINE (P2 Task 0 Step 6, own `npm test` run on the P1 end state): **`ℹ tests 3810 / pass 3810 / fail 0`**.

| task/step | predicted | actual | verdict |
|---|---|---|---|
| T0 S3 sentinel | `P1-OK` | `P1-OK` | OK |
| T0 S4 constants | LIMITS `{maxNodes:80,maxWires:200,…}`, `shapes OK`, no MISSING | exactly `{"maxNodes":80,"maxWires":200,"maxPortsPerSide":8,"minArity":2,"maxArity":8,"maxCycles":20,"maxNameLen":80}` + `shapes OK`, zero MISSING | OK |
| T0 S5 | old branch reachable | present | OK |
| T0 S6 | `ℹ fail 0` (ref 3810) | **3810 / 3810 / 0** | OK |
| T1 S1 | FAIL `Cannot find module …/ports.mjs` | same | OK |
| T1 S2 | `ℹ pass 8` / `fail 0`; purity green | `tests 8 / pass 8 / fail 0`; purity `3/3/0` | OK |
| T2 S1 | FAIL `…/loops.mjs` | same | OK |
| T2 S2 | `ℹ pass 7` / `fail 0` | `tests 7 / pass 7 / fail 0` | OK |
| T3 S1 | FAIL `…/validate.mjs` | same | OK |
| T3 S2 | `ℹ pass 23` / `fail 0` | `tests 23 / pass 23 / fail 0` | OK |
| T3 S3 whole-rule removals | all 21 caught | all 21 RED (V1–V3,V5,V6,V8–V11,V13–V21 → fail 2; V4,V7 → 3; V12 → 4) | OK |
| T3 S3 fine #1 `KINDS.has` | every test dies, `pass 1 / fail 22` | `fail 22` + `TypeError: KINDS.has is not a function` | OK |
| T3 S3 fine #2 V5 metaOf guards | RED | dropping BOTH guards (as written) → `fail 1`; dropping only the `metaOf(toId)` half → **`fail 0` (survivor)** | see P2-D2 |
| T3 S3 fine #3 V7 `liveWires` | RED | `fail 1` | OK |
| T3 S3 fine #4 V9 drop `kind!=='agent'` | RED | `fail 1` | OK |
| T3 S3 fine #5 V9 drop loop clause | RED | `fail 1` | OK |
| T3 S3 fine #6 V11 `return false` | RED | `fail 1` | OK |
| T3 S3 fine #7 V15 drop `metaOf` | RED | `fail 1` | OK |
| T3 S3 fine #8 V18 (a)/(b)/(c)/(d) | RED | (c) 1, (a) 1, (d) 1, (b) 2 | OK |
| T3 S3 fine #9 V19 end/result + agent/await | RED | 1 and 1 | OK |
| T3 S3 V12 upper bound → `false` | RED | `fail 1` | OK |
| T4 S1/S2 | FAIL `…/template.mjs`; `ℹ pass 10` | same; `tests 10 / pass 10 / fail 0` | OK |
| T5 S1/S2 | FAIL `…/geometry.mjs`; `ℹ pass 10` | same; `tests 10 / pass 10 / fail 0` | OK |
| T6 S1–S3 | FAIL `…/layout.mjs`; `ℹ pass 7` for the pair | same; `tests 7 / pass 7 / fail 0` (5 layout + 2 thumbnail) | OK |
| T7 S1/S2 | FAIL `…/agent-meta.mjs`; `ℹ pass 11` | same; `tests 11 / pass 11 / fail 0` | OK |
| T8 S1 | FAIL `does not provide an export named 'MOCK_WRITER_ROLES'` | `…does not provide an export named 'MOCK_ROLE_CLARIFY'` | see P2-D3 |
| T8 S2 | `ℹ pass 2`; the four mock suites `fail 0` (ref 23) | `tests 2 / pass 2 / fail 0`; the four → `tests 21 / pass 21 / fail 0` | see P2-D4 |
| T9 S1 | 11 JSON fragments + 11 `## Ports` blocks | all applied; every anchor matched exactly once at the stated lines (`:10` ×8, `:12` plan-reviewer, `:15` decomposer) | OK |
| T9 S2 | `ALL 11 VALID` | `ALL 11 VALID` | OK |
| T9 S3 | 22 files changed; only the 7 `## Inputs` headings+bullets removed | `22 files changed, 209 insertions(+), 38 deletions(-)`; the removed-line list is exactly the 7 headings and their bullets | OK |
| T10 S1 | FAIL `…/registry-ports.mjs` + schema-v2 additions fail on `m.metaVersion` undefined | same (3 schema-v2 tests ✖ + the module error) | OK |
| T10 S2–S4 | `ℹ fail 0` on the pair; net +5 | `tests 11 / pass 11 / fail 0`; schema-v2 file 6 → 9 tests (**+3**) + registry-ports 2 = **+5** | OK |
| T10 S5 | `node --test test/api-agents.test.mjs` | **that file does not exist** — the real ones are `test/agents-api.test.mjs` / `api-agents-domain.test.mjs`; those 3 files → `tests 15 / pass 15 / fail 0`. `res.json({ agents` is at **:3928**, not `:3907-3913` | see P2-D5 |
| T11 S1/S2 | FAIL `…/manifest.mjs`; `ℹ pass 9` | same; `tests 9 / pass 9 / fail 0` | OK |
| T12 S1/S2 | FAIL `…/model.mjs`; `ℹ pass 2`; purity+static green | same; `tests 2 / pass 2 / fail 0`; pair `tests 7 / pass 7 / fail 0` | OK |
| T13 S1/S2 | 3 more passes than P1's version | `tests 14 / pass 14 / fail 0` (11 + 3) | OK |
| T14 S1 | `BASELINE + 97` (projected 3907) | **`ℹ tests 3907 / pass 3907 / fail 0`** — exactly 3810 + 97 | OK |
| T14 S2 | purity + static `fail 0` | `tests 7 / pass 7 / fail 0` | OK |
| T14 S3 | commit | nothing left to commit (Tasks 1–13 committed everything) — made an `--allow-empty` marker commit | see P2-D6 |
| B0 S3 | `P2a-OK` | `P2a-OK` | OK |
| B0 S4 | BASELINE-B = Task 14's number | **`ℹ tests 3907 / pass 3907 / fail 0`** | OK |
| B1 S1 | FAIL `22 !== 23` | `AssertionError … 22 !== 23`, `tests 4 / pass 0 / fail 4` | OK |
| B1 S4 BEFORE | exactly the two prose comments | exactly those two lines | OK |
| B1 S4 AFTER | empty output | empty | OK |
| B1 S5 | `ℹ pass 4` on db-migrate-v23; `fail 0` on the other five | `tests 4 / pass 4 / fail 0`; the five → `tests 62 / pass 62 / fail 0` | OK |
| B2 S1 | FAIL `does not provide an export named 'writeGraphWorkflow'` | `…named 'assertRunnableWorkflow'` (Node names the first unresolved binding) | see P2-D3 |
| B2 S2 | `ℹ pass 7`; the five v1 suites green | `tests 7 / pass 7 / fail 0`; the five → `tests 82 / pass 82 / fail 0` | OK (after the G1 patch) |
| B3 S1 | FAIL `does not provide an export named 'setWireCycles'` | verbatim | OK |
| B3 S2 | `ℹ pass 4`; config suites green | `tests 4 / pass 4 / fail 0`; the five config suites → `tests 62 / pass 62 / fail 0` | OK |
| B4 S1 | FAIL `does not provide an export named 'resolveGraph'` | verbatim | OK |
| B4 S2 | `ℹ pass 7` | `tests 7 / pass 7 / fail 0` | OK (after the G3 patch) |
| B5 S1 | FAIL `400 invalid workflow` | `actual: 400, expected: 201` + body `'invalid workflow'` | OK |
| B5 S2 | `ℹ pass 6`; api-workflows + warnings green | `tests 6 / pass 6 / fail 0`; the pair → `tests 19 / pass 19 / fail 0` | OK |
| B6 S1 | FAIL "the wires key is ignored" | `TypeError: Cannot read properties of undefined (reading 'wires')` + `actual 200 / expected 400`, `pass 7 / fail 2` | OK (message drift only) |
| B6 S2 | `ℹ pass 9` for the file; config-api green | `tests 9 / pass 9 / fail 0`; config-api `tests 11 / pass 11 / fail 0` | OK |
| B7 S1 | FAIL `expected 400, got 200` | `pass 1 / fail 3` on the gate file | OK |
| B7 S2 | `ℹ pass 4`; ask-proposal `fail 0` with one test MORE | `tests 4 / pass 4 / fail 0`; ask-proposal 5 → **6** tests, `fail 0`; all 42 `test/ask-*` → `tests 425 / pass 425 / fail 0` | OK |
| B8 S1 | FAIL `steps is []` | `pass 1 / fail 2` on the new file | OK |
| B8 S2 | `ℹ pass 3`; the ask suites green | `tests 3 / pass 3 / fail 0`; `ls test \| grep ^ask-` = 42 files, all green | OK |
| B9 S1 | FAIL `deleteAgent resolves` | `pass 0 / fail 2` on graph-row-consumers; ui-composer `pass 6 / fail 1` | OK |
| B9 S2 | `ℹ pass 2`; ui-composer +1; the four suites green | `tests 2 / pass 2 / fail 0`; ui-composer 6 → **7**; the four → `tests 43 / pass 43 / fail 0` | OK |
| B10 S1 | `BASELINE-B + 42` (projected 3949) | **`ℹ tests 3949 / pass 3949 / fail 0`** — exactly 3907 + 42 | OK |
| B10 S2 | empty output | empty | OK |
| B10 S3 | the 4 checklist commands green | `13/13/0`, `14/14/0`, `7/7/0`, `4/4/0` — all `fail 0` | OK |
| B10 S4 | commit | nothing to commit — `--allow-empty` marker again | see P2-D6 |
| B10 S5 | P3 sentinels present | all present: `validateGraph`, `SCHEMA_VERSION = 23` (`db.mjs:56`), `MOCK_WRITER_ROLES`, `portsOf`/`firedOutputs`/`resolveOrOutType`, `classifyLoops`, `buildGraphManifest`/`manifestPortsFn`/`manifestTemplate`/`UI_PHASE`, `registryPortsFn`, `resolveGraph`+`assertRunnableWorkflow` | OK |

---

## §2 findings (plan-ready fixes)

### P1 v2

**P1-D1 (MINOR) — Task 8 Step 4: the mutation revert destroys the uncommitted task.**
`ui/server.mjs` is modified but NOT yet committed when Step 4 runs, so a reflexive
`git checkout -- ui/server.mjs` between mutations reverts Step 1's mount as well and
mutations 2 and 3 then fail to find their anchors (measured: `MUT-ANCHOR-FAIL count=0`
twice). Task 1 Step 3 carries exactly this warning; Task 8 Step 4 does not.
*Fix — append to Task 8 Step 4, after "Restore both.":*
> Restore each mutation **by editing the text back** (or from a `cp ui/server.mjs /tmp/server.bak` snapshot taken before the first mutation), NOT with `git checkout -- ui/server.mjs`: this task is not committed yet, so a checkout reverts to HEAD and silently discards Step 1's mount too — the next mutation then reports an anchor miss instead of a test failure.

**P1-D2 (TRIVIAL) — Task 10 Step 3 blast radii are understated.**
(b) "drop `config` from `wf_full`'s `w12`" fails **3** tests, not 1; (d) "add a second wire
into `wf_quick-fix`'s `n_review.plan`" fails **2**, not 1. Both are RED (the point holds).
*Fix — Task 10 Step 3:* change "(b) … → the FB_WIRE_MAP test fails" to "→ **three** tests
fail (FB_WIRE_MAP coverage, the budget-placement pin and the loop-wire set)" and
"(d) … → the V7 test fails" to "→ **two** tests fail (V7 and the wire-id/port pins)".

**P1-N1 (note, no change needed).** Task 11 Step 4 (open a browser devtools console) was NOT run —
the wave-2 brief forbids servers and browsers. Everything else in Task 11 passed.

### P2 v2

**P2-D1 (already fixed in the plan by the cold fresh-eyes pass — recorded for comparison).**
Three defects were patched into the plan file mid-execution (G1/G2/G3). Two of them I had
already hit independently, with the same diagnosis:
- **G1** (Task B2 Step 2 `writeGraphWorkflow`): I did not reach the backtick failure — the
  insertion anchor assertion (`/** Read one template by id.`) aborted the whole edit first,
  because dev's JSDoc actually reads `/** Read a template by id. Returns the built-in
  DEFAULT_WORKFLOW for "wf_default";` (see P2-D7). Nothing was written, so I re-ran the step
  from the patched plan and it applied clean.
- **G2** (Task 10 Step 5 `test/api-agents.test.mjs`): hit and reported before the patch —
  see P2-D5, which the patch resolves.
- **G3** (Task B4 Step 2 `setWorkflowNodeDefaults` placement): executed only after the patch;
  the "immediately AFTER `const patch = …`" text applied cleanly.

**P2-D2 (MINOR) — Task 3 Step 3 mutation #2 is only mutation-proof as a PAIR.**
Dropping BOTH `metaOf(...)&&` guards in V5 is caught (`fail 1`); dropping only the
`metaOf(toId) &&` half **survives** (`ℹ fail 0`) — the fixture's `n_ghost` wire is an
OUTBOUND-from-ghost wire, so only the `fromId` arm is exercised.
*Fix — Task 3 Step 1, in the V5 test:* add an INBOUND wire into the unknown-key node, e.g.
`t.wires.push({ id: 'w_ghost_in', from: { node: 'n_ts', port: 'task' }, to: { node: 'n_ghost', port: 'nope' } });`
and assert the V5 issue list still contains no `'n_ghost.nope' is not a declared input`
entry. Then add to Step 3 #2: "drop EITHER guard on its own — each must go RED".

**P2-D3 (TRIVIAL) — three `Expected: FAIL` texts name the wrong missing export.**
Node's `SyntaxError` names the FIRST unresolved binding in the import list, not the one
the step is about. Measured:
| step | plan says | actually printed |
|---|---|---|
| Task 8 Step 1 | `…does not provide an export named 'MOCK_WRITER_ROLES'` | `…named 'MOCK_ROLE_CLARIFY'` |
| Task B2 Step 1 | `…named 'writeGraphWorkflow'` | `…named 'assertRunnableWorkflow'` |
*Fix:* in both steps write `SyntaxError: The requested module '…' does not provide an export
named '<the first missing name in the test's import list>'` (Task 8: `MOCK_ROLE_CLARIFY`;
Task B2: `assertRunnableWorkflow`). Task B3/B4's texts (`setWireCycles`, `resolveGraph`) are
already correct because those are the only missing bindings.

**P2-D4 (TRIVIAL) — Task 8 Step 2's reference count for the four mock suites is 23, measured 21.**
`node --test test/claude-runner-ask-mock.test.mjs test/skill-mock.test.mjs test/subagent-mock.test.mjs test/workspace-mock.test.mjs`
→ `ℹ tests 21 / pass 21 / fail 0`. The gate (`ℹ fail 0`) holds.
*Fix:* "(the dry-run measured 23 passing across the four)" → "(21 passing across the four on dev `e6968e15`)".

**P2-D5 (MAJOR — superseded by the plan's G2 patch, kept for the record).**
Task 10 Steps 4/5 named `test/api-agents.test.mjs`, which does not exist on dev
(`Could not find 'test/api-agents.test.mjs'`). The real files are
`test/agents-api.test.mjs` and `test/api-agents-domain.test.mjs`
(`tests 15 / pass 15 / fail 0` together with `test/agents-meta.test.mjs`).
The patched plan now says exactly that. **Residual (TRIVIAL, still open):** the grep comment
inside that same block still reads `# :3913`; after P1's 15-line `/src/shared` insert the
line is **`:3928`**.
*Fix — Task 10 Step 5, block:* `grep -n "res.json({ agents" ui/server.mjs   # :3928 after P1's mount insert (:3913 on bare dev) — objects pass through; no field list to update`

**P2-D6 (MINOR) — Task 14 Step 3 and Task B10 Step 4 ask for a commit with nothing to commit.**
Every P2a task (1–13) and every P2b task (B1–B9) commits its own files, so by the time the
half-closing task runs `git status --porcelain` is empty and `git commit` exits 1
("nothing to commit"). Measured on both.
*Fix — Task 14 Step 3 / Task B10 Step 4:*
> Commit the half marker: `git commit --allow-empty -m "worca: Node-graph v2 P2 — P2a green (shared core + sidecars)"` — every task above already committed its own files, so this is a deliberate empty marker commit (it is what a later `git log` bisects the half boundary on). Drop it entirely if your workflow dislikes empty commits.

**P2-D7 (MINOR) — Task B2 Step 2's placement anchor for `writeGraphWorkflow` is not quotable from the plan.**
The plan says only "place beside `writeWorkflow`". A zero-context implementer needs a literal
anchor, and the obvious one ("the `readWorkflow` JSDoc") is easy to mis-transcribe: dev's text is
`/**\n * Read a template by id. Returns the built-in DEFAULT_WORKFLOW for "wf_default";`
(NOT "Read one template by id.", which is `readRaw`'s JSDoc lead-in).
*Fix — Task B2 Step 2, before the `writeGraphWorkflow` block:*
> New `writeGraphWorkflow` — insert it between the end of `writeWorkflow` (`return stored;\n}`) and the JSDoc that begins `/**\n * Read a template by id. Returns the built-in DEFAULT_WORKFLOW for "wf_default";` (`workflows.mjs:284` on dev). `writeWorkflow` stays v1 and untouched.

**P2-D8 (TRIVIAL) — Task B6 Step 1's `Expected: FAIL` text.**
Plan: "the wires key is ignored: `workflows.wf_g` is undefined". Measured:
`TypeError: Cannot read properties of undefined (reading 'wires')` for the first case and
`actual: 200, expected: 400` for the second (`ℹ pass 7 / fail 2` over the whole file — B5's 6
still pass).
*Fix:* `Expected: FAIL — TypeError: Cannot read properties of undefined (reading 'wires') (the wires key is ignored, so config.workflows.wf_g is undefined), plus actual 200 / expected 400 on the missing-workflowId case; ℹ pass 7 / fail 2 for the file.`

**P2-D9 (MINOR) — the `ui/public/app.js` version guards are NOT mutation-proof as tested.**
Task B9 Step 1 asserts the behavioural test catches `if (false && workflow.version === 2) return [];`.
Measured: it does **not** — with the fixture `{ id:'wf_g', name:'Graph', version:2, nodes:[], wires:[] }`
the pre-existing `Array.isArray(workflow.steps) ? … : []` fallback returns `[]` anyway, so
disabling EITHER guard (`buildNodeConfigRows` and `buildFeedbackRows`) leaves the suite green
(`ℹ fail 0` on both). Only the `composerRenderList` filter mutation is caught.
*Fix — Task B9 Step 1, in the `test/ui-composer.test.mjs` block, replace the `const v2 = …` line with:*
```js
  // The v2 row deliberately carries STALE v1 cells: without the version guard the
  // builders would walk them and paint rows, so this is what makes the guard
  // load-bearing (an empty-steps fixture is inert either way).
  const v2 = { id: 'wf_g', name: 'Graph', version: 2, nodes: [], wires: [],
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]],
    feedbacks: [{ id: 'fb_x', from: 's1_0', to: 's0_0' }] };
```
Verified on the clone: green as written (`ℹ pass 7 / fail 0`), and RED (`ℹ pass 6 / fail 1`)
with either `if (workflow && workflow.version === 2) return [];` turned into
`if (false && workflow.version === 2) return [];`.

**P2-N1 (note, no change needed).** Every `ui/server.mjs` anchor in P2b is exactly **+15** lines
from the plan's number because P1 Task 8 inserts 15 lines at `:766`. Verified for
`POST /api/run` (1062→1077), `GET /api/workflows` (3116→3131), `PATCH /api/config` (2751→2766),
`GET /api/config` (2687→2702), `DELETE /api/config/workflow` (2792→2807). The plan's anchors are
declared "valid for dev @ e6968e15", so this is expected, not drift — but a one-line note in the
P2b preamble would save the next executor a double-take.

---

## §3 mutation table

Every mutation applied ALONE against the committed production tree and reverted immediately
(`git checkout -- <file>`); the number is the `ℹ fail N` line of the named test file(s).
"RED" = the suite goes red, i.e. the assertion bites.

### Wave-1 + critique list (the brief's list)

| # | mutation | file | test(s) | result |
|---|---|---|---|---|
| M1 | V18 exemption (a) task-sourced removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M2 | V18 exemption (c) synthesized `await` removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M3 | V18 exemption (d) loop input removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M4 | V19 `end.result` exemption removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M5 | V19 `agent.await` exemption removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M6 | V15 "unresolved meta is never an entry" removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M7 | V11 unresolved-member branch flipped (`true`→`false`) | validate.mjs | graph-validate | **RED** `fail 1` |
| M8 | V7 restricted to live wires | validate.mjs | graph-validate | **RED** `fail 1` |
| M9 | V9 not restricted to agents | validate.mjs | graph-validate | **RED** `fail 1` |
| M10 | V12 arity upper bound removed | validate.mjs | graph-validate | **RED** `fail 1` |
| M11 | `KINDS.includes` → `.has` | validate.mjs | graph-validate | **RED** `fail 22` + `TypeError: KINDS.has is not a function` |
| M12 | V5 `metaOf` guards removed (BOTH, as the plan words it) | validate.mjs | graph-validate | **RED** `fail 1` |
| M13 | Task 13 `!!` fix reverted | graph-seed-templates.test.mjs | graph-seed-templates | **RED** `fail 1` |
| M14 | manifest `config` cell dropped | manifest.mjs | graph-manifest + graph-seed-templates | **RED** `fail 2` |
| M15 | `manifestTemplate` restores only `arity`/`awaitAll` | manifest.mjs | graph-manifest | **RED** `fail 1` |
| M16 | `meta.uiPhase` ignored | manifest.mjs | graph-manifest | **RED** `fail 1` |
| M17 | `writeGraphWorkflow` origin `COALESCE` → `excluded.origin` | workflows.mjs | workflows-graph-rows + plugin-workflows | **RED** `fail 1` |
| M18 | `readWorkflow` returns archived rows | workflows.mjs | workflows-graph-rows + api-workflows-graph + run-workflow-gate | **RED** `fail 5` |
| M19 | ARCHIVED message text changed | workflows.mjs | same three | **RED** `fail 4` |
| M20 | `resolveGraph` `agentsByKey` keyed by the pre-substitution key | workflows.mjs | workflows-resolve-graph | **RED** `fail 1` |
| M21 | v2 POST catalog validation (`nodeDefaultsError`) removed | ui/server.mjs | api-workflows-graph | **RED** `fail 1` |
| M22 | 422 body diverges from the shared validator (hand-written issues) | ui/server.mjs | api-workflows-graph | **RED** `fail 1` |
| M23 | `POST /api/run` v2 refusal removed | ui/server.mjs | run-workflow-gate | **RED** `fail 1` |
| M24 | Ask proposal graph refusal removed | ask/proposal.mjs | ask-proposal | **RED** `fail 1` |
| M25 | CLI `--workflow` gate removed | cli/worca-cc.mjs | run-workflow-gate | **RED** `fail 1` |
| M26 | `agent-store` `includeArchived:true` → default | agent-store.mjs | graph-row-consumers + agent-store | **RED** `fail 1` |
| M27 | `plugin-workflows` graph walk removed | plugin-workflows.mjs | graph-row-consumers + plugin-workflows | **RED** `fail 1` |
| M28 | `app.js` `if (false && workflow.version === 2)` in `buildNodeConfigRows` | ui/public/app.js | ui-composer | **GREEN — SURVIVOR** `fail 0` |
| M28b | same, in `buildFeedbackRows` | ui/public/app.js | ui-composer | **GREEN — SURVIVOR** `fail 0` |
| M29 | `app.js` saved-list filter inverted (`w \|\| w.version !== 2`) | ui/public/app.js | ui-composer | **RED** `fail 1` |

### Task 3 Step 3's own audit (run during the task, copy-revert because `validate.mjs` was still untracked)

- **All 21 whole-rule removals caught** (V1–V3, V5, V6, V8–V11, V13–V21 → `fail 2`; V4 and V7 → `fail 3`; V12 → `fail 4`).
- All nine fine-grained mutations + the V12 upper bound: RED, with the one exception below.
- V18 exemption (b) VOID also RED (`fail 2`).

### Survivors and the proposed assertions

**S1 — `app.js` `buildNodeConfigRows` / `buildFeedbackRows` version guards (M28, M28b).**
Cause: the fixture `{version:2, nodes:[], wires:[]}` has no `steps`/`feedbacks`, and the
pre-existing `Array.isArray(workflow.steps) ? … : []` fallback already returns `[]`, so the new
guard changes nothing observable. **Proposed assertion: give the v2 fixture stale v1 cells** —
see P2-D9 for the exact replacement block. **Empirically validated on the clone:** green as
written (`ℹ pass 7 / fail 0`), RED (`ℹ pass 6 / fail 1`) with either guard disabled.

**S2 — V5's `metaOf(toId) &&` guard alone (Task 3 Step 3 #2, half of M12).**
Cause: the fixture only wires OUT of the unknown-key node, so the `toId` arm is never exercised.
Dropping both guards together (what the plan's mutation text says) IS caught.
**Proposed assertion:** add an inbound wire into the unknown-key node — see P2-D2.

---

## §4 counts

All numbers are the `ℹ pass N` line printed by `npm test` (Node 25 `spec` reporter,
`WORCA_HOME` pointed at the throwaway home), on the clone at
`…/scratchpad/clones/p2`, branch `worca-cc/node-graph-v2-p2`.

| checkpoint | plan's prediction | printed | delta |
|---|---|---|---|
| **BASELINE** (P1 v2 Task 0 Step 5, tree = `e6968e15`) | `ℹ fail 0` | **3760** / 3760 / fail 0 | — |
| P1 Task 2 Step 7 | BASELINE + 2 | **3762** | +2 ✓ |
| P1 Task 6 Step 5 | BASELINE + 32 | **3792** | +32 ✓ |
| **after P1 v2** (Task 11 Step 1) | BASELINE + 50 → ref 3810 | **3810** / 3810 / fail 0 | +50 ✓ |
| **P2 BASELINE** (Task 0 Step 6) | ref 3810 | **3810** / 3810 / fail 0 | — |
| **after P2a** (Task 14 Step 1) | `BASELINE + 97` → projected **3907** | **3907** / 3907 / fail 0 | +97 ✓ |
| **BASELINE-B** (Task B0 Step 4) | = Task 14's number | **3907** / 3907 / fail 0 | — |
| **after P2b** (Task B10 Step 1) | `BASELINE-B + 42` → projected **3949** | **3949** / 3949 / fail 0 | +42 ✓ |
| **final `npm test`** (after the whole mutation campaign, tree restored) | — | **3949** / 3949 / **fail 0** | — |

Every count gate hit its projection exactly; no gate needed reconciling.
Whole-series delta: **3760 → 3949 = +189** (= P1 50 + P2a 97 + P2b 42).

---

## §5 `git log --oneline` + `git status --short`

`git status --short` → **empty** (clean tree at the end state).

```
d25ecf4c worca: Node-graph v2 P2 — P2b green (schema + store)
ed16ef6e worca: Node-graph v2 P2 — v1 consumers tolerate graph rows
f6cd3104 worca: Node-graph v2 P2 — Ask catalog understands graph templates
fc94af0f worca: Node-graph v2 P2 — one runnable-workflow gate for every run path
d2513bfa worca: Node-graph v2 P2 — /api/config carries per-wire budgets
38a2bd27 worca: Node-graph v2 P2 — /api/workflows accepts and validates v2 graphs
29c3a41a worca: Node-graph v2 P2 — resolveGraph, workspace variants and v2 node defaults
dc101b87 worca: Node-graph v2 P2 — per-wire cycle budgets
bf73209e worca: Node-graph v2 P2 — v2 workflow rows, archiving and the runnable gate
8133543b worca: Node-graph v2 P2 — DB v23 additive schema
32babc8f worca: Node-graph v2 P2 — P2a green (shared core + sidecars)      [empty marker]
e3ca4728 worca: Node-graph v2 P2 — seed drift guard against the real sidecars
59226e68 worca: Node-graph v2 P2 — browser re-export door and the single-source guard
014000a0 worca: Node-graph v2 P2 — graph manifest v2 with the v1 shim cells
0f9a699c worca: Node-graph v2 P2 — registry merges meta v2 and exposes registryPortsFn
0a9eed12 worca: Node-graph v2 P2 — dual-shape meta v2 sidecars for the 11 builtins
3655ac28 worca: Node-graph v2 P2 — export the mock writer role vocabulary
691e2857 worca: Node-graph v2 P2 — shared agent meta v2 normalizer
a5a91ada worca: Node-graph v2 P2 — auto-layout and thumbnails
750e7b24 worca: Node-graph v2 P2 — shared geometry
d294b19f worca: Node-graph v2 P2 — template model and drop legality
e875d92b worca: Node-graph v2 P2 — shared graph validator (V1-V21)
5b852fbd worca: Node-graph v2 P2 — loop classification and launch order
55d12ee1 worca: Node-graph v2 P2 — shared ports layer
feee3748 worca: Node-graph v2 P1 — seed graph structural tests
82c7d1e8 worca: Node-graph v2 P1 — the 8 shipping graphs as frozen constants
a900c3fe worca: Node-graph v2 P1 — serve the shared graph core at /src/shared
ec5e3318 worca: Node-graph v2 P1 — shared-core purity guard
5296fc7c worca: Node-graph v2 P1 — move the verdict helpers into the shared core
6e78bb7f worca: Node-graph v2 P1 — shared graph constants
f7e1f8d4 worca: Node-graph v2 P1 — engine-select module
f71e7166 worca: Node-graph v2 P1 — run-harness hook contract test
339b8c52 worca: Node-graph v2 P1 — split the run harness out of the orchestrator
45379d9d worca: Node-graph v2 P1 — collectRequiredSkills accepts a key set
e6968e15 Collapse Ring Amount to Whole Thousands (#391)   [dev, the reset point]
```

34 commits: 10 for P1 v2, 24 for P2 v2 (22 task commits + the two empty half markers).
Nothing under `docs/superpowers/` was staged or committed; nothing was pushed;
`split-harness.tmp.mjs` was deleted before the Task 2 commit and never appears.
The clone is left at this end state.
