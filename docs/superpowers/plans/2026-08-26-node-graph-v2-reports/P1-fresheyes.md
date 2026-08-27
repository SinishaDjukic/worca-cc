# P1 v2 (harness split + foundations) — cold fresh-eyes review

Reviewer: Fable 5, max effort, no prior context. Document: `docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations-v2.md` (2497 lines) read in full; spec sections §2 (P1 row), §3, §5.1, §5.2, §10.2 seeds, §12, §16 and the base spec's Amendment f read for the seed claims. Repo `dev @ e6968e15`, untouched.

## Method (what was actually executed, all in SCRATCH/fresheyes-p1, repo read-only)

- Every fenced block extracted by line range; all 16 files `node --check` clean (script, 5 modules, 8 tests, seeds).
- The Task 2 script, concatenated in document order, RUN against a copy of dev `orchestrator.mjs`: no `split:` assertion fired, both post-condition guards passed, both outputs parse. Printed `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines`. Multiset diff of non-blank lines: 103 lost / 211 gained, every one accounted for by the two import blocks, two class lines, nine `export`-prefixed helpers, the twelve seams, `planAgentKeys`, the `export {…}` line, header, `BASE_HOOKS`, `V1_HOOKS`.
- A symlink mirror of the repo with the split applied (+ modified `skills.mjs`/`protocol.mjs` produced by exact-match edits of the plan's anchors, + the new modules/tests) ran, fully offline, `WORCA_HOME`/`TMPDIR` in scratch:
  - new suites: graph-constants 10/10, graph-verdict 5/5, shared-graph-purity 3/3 (against the REAL `ui/public` tree), graph-seed-templates 11/11, skills-resolve 8/8 (6 old + 2 new), engine-select 5/5, run-harness-hooks 9/9.
  - oracle: all 16 `orchestrator-*`, pause-resume-e2e, dispatcher, clarify, clarify-node, workspace-mock, cost-tracking, duration-tracking, preflight-missing-agent, abort-classify, log-provenance, skill-capture, workflows-questions, runners, workflows → **221/221, 0 fail, 25 s** against the PRODUCED `run-harness.mjs`/`orchestrator.mjs`.
  - mutation audits executed and confirmed biting exactly as written: Task 1 (string guard → Set test red on the perChar assertion; red-first on dev prints `Expected values to be strictly deep-equal:` + `+ []`), Task 3 (a)–(g) (g prints `actual: 0, expected: 1`), Task 4 (gutted factory → the two `.engine` tests red), Task 7 (`mutant.mjs` → `…/src/shared/graph/mutant.mjs: non-relative import "node:path"`; `DOM_PROBE` in code → `constants.mjs: DOM global`; the same words in a comment → still 3/3 green), Task 10 (a)–(d).
  - seeds: the plan's `builtin-workflows.mjs` block is byte-identical to `origin/worca-cc/v2-orchestrator-bfb6a0ed:src/core/graph/builtin-workflows.mjs`; the three `seed-templates.mjs` blocks are identical to the branch file modulo the two blank lines between the fences (see G4).
- NOT executed: Task 8's `api-shared-static` test (it listens on loopback — no servers); its claims were checked against `node_modules/send@0.19.2`, `serve-static@1.16.3`, `mime@1.6.0` (`.mjs` → `application/javascript` confirmed) and `ui/server.mjs:766-771` / `:164` / `:4790-4797`. Task 2 Step 5's `git add -N` + `--color-moved` review not run (the multiset cross-check was).
- Anchors: 26 member/helper `path:line` anchors spot-checked exact; `_phase` has exactly the four call sites claimed; `rp.` / `plan` reads in the shells are exactly the seamed ones; 53/60 importer counts exact; `test/cost-tracking` 14 and `duration-tracking` 8 direct `_phase(` calls; hygiene greps on the produced files give `_phase(` → 0 and exactly one `createGraphOrchestrator` hit.

## Findings

### G1 — MAJOR — `tail -5` hides the pass count (Task 0 Step 5, Task 2 Step 7, Task 6 Step 5, Task 11 Step 1)
Problem: on Node 25 (the executor) `node --test` prints the spec summary as EIGHT lines — `ℹ tests`, `ℹ suites`, `ℹ pass`, `ℹ fail`, `ℹ cancelled`, `ℹ skipped`, `ℹ todo`, `ℹ duration_ms` — and `npm` prints nothing after it. Verified: `npm-style node --test x.test.mjs 2>&1 | tail -5` shows `fail … duration_ms` only. So "record the printed pass count" (BASELINE) and every "green at BASELINE + N" gate cannot be read off the command as written.
Fix (all four sites): replace `npm test 2>&1 | tail -5` with `npm test 2>&1 | tail -8` — or, sharper, `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail) '` — and in Task 0 Step 5 say "record the `ℹ pass N` line as BASELINE; `ℹ fail` must be 0".

### G2 — MAJOR — Task 8 Step 4, second mutation cannot bite as written; the guard has a blind spot for a wrong ROOT (FLAG FOR RE-EXECUTION — argued from source, not run)
Problem: the plan says "widen the mount to `path.join(PROJECT_ROOT, 'src')` → the traversal test fails on its 404 assertion (`/src/shared/../core/db.mjs` starts serving `src/core`)". With the mount PREFIX still `/src/shared`, Express hands serve-static `/../core/db.mjs`; `send@0.19.2` normalizes it, `UP_PATH_REGEXP` matches and it answers 403 BEFORE looking at the root (`node_modules/send/index.js:529-535`); serve-static's default `fallthrough:true` turns a non-file error into `next()` (`serve-static/index.js:115-121`), so the request lands on the 404 tail → still 404, body `Not found`. The same holds for the `%2e%2e` and `graph/../../` probes. Net: the mutation is expected to SURVIVE, and a root widened to `src` would leak `src/core/db.mjs` at `/src/shared/core/db.mjs` (no `..`) — a URL the test never asks for.
Fix: (a) in the traversal test add a probe with no dot-segments — extend the loop list with `'/src/shared/core/db.mjs'` (expects 404 and no `node:sqlite`; it is what a wrong root serves); (b) rewrite the mutation: "widen ONLY the root to `path.join(PROJECT_ROOT, 'src')` → the new `/src/shared/core/db.mjs` probe fails (200, body contains `node:sqlite`); optionally widen BOTH prefix and root (`app.use('/src', express.static(path.join(PROJECT_ROOT, 'src'), …))`) → `/src/shared/../core/db.mjs` now normalizes inside the root and the 404 assertion fails too". Re-execution agent: run the test with each mutation and confirm; keep the file at 4 tests so Task 11's +49 holds.

### G3 — MINOR — Task 2 Step 2 / Step 5: stale measured numbers
Problem: Step 2 expects `run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines`; the v2 script (longer `BASE_HOOKS` JSDoc on `_engineRehydrate`, the S8 comment) prints `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines` on dev `e6968e15`. 22 lines is more than the "±a few" the text allows, so a careful implementer stops. Step 5's multiset cross-check expects "~102 lost / ~188 gained"; measured 103 / 211, and the given command ends in `| wc -l` (one total, ~314), which cannot show the lost/gained split.
Fix: Step 2 → `run-harness.mjs 2715 lines; orchestrator.mjs 1780 lines` (measured 2026-08-27 with THIS script). Step 5 → "Expect 103 lost / 211 gained" and end the command with `> /tmp/ms.diff; grep -c '^<' /tmp/ms.diff; grep -c '^>' /tmp/ms.diff` (use a scratch path, not the repo).

### G4 — MINOR — Task 9 Step 3: the three seed fences must be joined with blank lines to be byte-identical
Problem: `seed-templates.mjs` is printed as three fenced blocks. The old-branch file has ONE blank line after `WF_NO_CLARIFY`'s closing `};` (before `/** Provided Plan …`) and one after `WF_FULL_NO_DECOMPOSE`'s `};` (before `/** Quick Fix …`). Typing the fences back to back gives 316 lines and the Step 1 identity diff prints `111d110` / `187d185` (two blank-line hunks) instead of `IDENTICAL`. `builtin-workflows.mjs` (49 lines) is byte-identical as printed.
Fix: in Step 3 add "join the three blocks with exactly one blank line between them — the file is 318 lines; a `diff` that shows only blank-line hunks means you dropped those joins, not that the content drifted".

### G5 — MINOR — Task 2 prose vs `ORCH_IMPORTS`: three dangling bindings, one inherited one
Problem: the paragraph after the import blocks says "`appendAudit` and `today` are imported by BOTH files (both sides call them)" and the heading says "nothing left dangling". In the produced `orchestrator.mjs`, `today`, `resolve` and `basename` are never referenced in code (only the word "today" in comments); all their callers moved to the harness. Harmless in ESM (an unused import is not an error, and the suite is green), but the sentence is false and a lint-minded implementer will "fix" the script mid-move. `artifactPaths` in `HARNESS_IMPORTS` was already unused on dev (only a comment at `:540`) — carried over verbatim, which the mandate allows. `realpath` IS used (twice) by the moved `_ensureGitCheckpointFor`.
Fix: either trim `ORCH_IMPORTS` to `import { join, dirname } from 'node:path';` and drop `today` from its `./artifacts.mjs` list (re-run Step 3/6/7 — no behavior change), or keep the script and reword: "`today`, `resolve`, `basename` stay imported in `orchestrator.mjs` although only the harness calls them now — leave them; the move does not lint". Pick one so the prose and the script agree.

### G6 — MINOR — Task 5 step numbering contradicts itself
Problem: Step 1 says "Write the failing test (full code in Step 3's block below — write the TEST first, watch it fail on the missing module), then implement" but Step 1's block IS the module, Step 2 holds the test, and Step 3 is the commit. A zero-context implementer cannot tell which order to type.
Fix: renumber — Step 1: the test file (block now in Step 2) → `node --test test/graph-constants.test.mjs` → `Expected: Cannot find module '…/src/shared/graph/constants.mjs'`; Step 2: the module (block now in Step 1); Step 3: `node --test …` → `ℹ pass 10`, `ℹ fail 0`; Step 4: commit.

### G7 — MINOR — Task 11 Handoff names the v1 file
Problem: "The plan file is `…/2026-08-26-node-graph-v2-P1-harness-split-foundations.md`" — the executed document is `…-foundations-v2.md`.
Fix: point the Handoff at the `-v2.md` path (or say "this file").

### G8 — MINOR — Task 2 Step 5 (harness side of the `--color-moved` list) omits the nine export-prefixed signatures
Problem: `function clip(` (orchestrator, removed) and `export function clip(` (harness, added) differ, so git shows BOTH as non-moved; the plan lists them only under "(orchestrator)". The reviewer reading the harness side per the list will chase nine "unexplained" lines (`ERR_STREAM`, `roundUsd`, `sumStepCosts`, `sumStepActive`, `pauseErr`, `isPause`, `firstLine`, `rel`, `clip`).
Fix: add to the (harness) list: "the nine helper signature lines now carrying `export `".

### G9 — MINOR — Task 1 Step 1, test 2: an assertion that cannot fail
`assert.equal(typeof plan[Symbol.iterator], 'undefined')` holds for every plain object literal regardless of `collectRequiredSkills`' implementation; it documents the branch rather than testing it. Harmless (the other assertion in that test, and the Set test's bare-string case, do the work — both verified biting). Keep as documentation or drop; no count change either way if kept.

### G10 — MINOR — Task 8 Step 4, first mutation wording
Without the 404 tail, `/src/shared/graph/nope.mjs` falls to the SPA middleware at `ui/server.mjs:4790-4797` and returns 200 `text/html`; the first assertion to fail is `assert.equal(res.status, 404, url)`, not the content-type match. Say "fails on the 404 status (the SPA shell answers 200 text/html)".

### G11 — MINOR — Global Constraints, reporter claim
"Node ≥ 22's `node --test` uses the `spec` reporter even when piped" — verified on Node 25.6.1 (the executor). Whether early 22.x defaulted to `tap` when piped is not something this review checked; if the executor can be older than 23, add `--test-reporter=spec` to the commands, otherwise leave as is. Informational.

### G12 — MINOR — Task 2 Step 6 "156 tests" and Task 6 Step 4 "22 tests" are reference figures
Task 6's 22 = 5 new + `runners` 10 + `workspace-mock` 7 — arithmetic verified. Task 2's 156 was not reproduced exactly (this review ran a superset: 221/221 with `server-pause-resume` excluded and six extra suites added); treat 156 as informational, `ℹ fail 0` is the gate. No change needed.

### G13 — MINOR — document integrity, otherwise clean
No TODO/TBD/"see spec"/placeholder text (the one "placeholder" hit is the OR-type comment in `constants.mjs`). Every symbol is defined before use: `planAgentKeys` (script `ORCH_IMPORTS` tail, repeated in prose), `findDisabledPluginFor` (moved helper) for the moved `_preflightAgentKeys`, `deepFreeze` before `SEED_TEMPLATES`, `resolveWireId`/`LOOP_OF`/`EXPECTED_FB` before the Task 10 tests. Hook names and return shapes are consistent across `BASE_HOOKS`, `V1_HOOKS`, the Task 3 stub and Q&A P1-c/d/e/s; the two `engine hook contract:` strings match the Task 3 regexes; `engine-select` exports match its test; every `constants.mjs` export is imported by its test; seed test helpers exist. Commit messages all carry the `worca: Node-graph v2 P1 — ` prefix. Task 0 is complete (branch check, `npm ci`, lineage, optional fetch, baseline). Per-task counts 2+9+5+10+5+3+4+11 = 49 = Task 11's delta; Task 6's +31 = 2+9+5+10+5. Q&A: every decision carries a source (user decision / spec § / planner default / adjudication); none reads as an invented user answer. Import paths and `..` depths are right for `src/core/graph/` (`../../shared/graph/`), `src/core/protocol.mjs` (`../shared/graph/`) and `test/` (`../src/…`); no absolute `/src/shared` specifier anywhere; no duplicate import sources in either produced file.

## Spec coverage (§2 P1 row, §3, §5.1, §5.2, §10.2 seeds, §12, §16 → tasks)
- `run-harness.mjs` + `Orchestrator extends RunHarness`, six hooks → Task 2 (+ Task 3 contract test). Deviations vs §5.1 are disclosed and sourced: `_phase` moves (P1-b; all four call sites are bookends), `_preflightAgentKeys` moves with an iterable signature (P1-f), `workflow` field (P1-c), `audit` field (P1-d), `rehydrated` arg (P1-e), rehydrate timing (P1-s). Oracle list matches §5.1 (16 `orchestrator-*`, pause-resume-e2e, server-pause-resume, dispatcher; `orchestrator-questions` is inside the glob).
- `engine-select.mjs` returning v1 for everything, resume point first, async factory, no call-site changes → Task 4 (§5.2). `wf_default_v2` alias correctly left to P4 (hygiene grep confirms zero hits on dev, one comment hit after P1).
- `skills.mjs:113` key set → Task 1. `/src/shared` mount + 404 tail + `api-shared-static` → Task 8 (text identical to §3's snippet). `constants.mjs` (all 14 §3 exports + `BOOKEND_EXECUTION_IDS`) → Task 5; `verdict.mjs` moved verbatim from `protocol.mjs:244-259` and re-exported → Task 6; purity guard with all seven token rules + relative-only + inside-`src/shared` + the `ui/public` escape rule → Task 7.
- Seeds copied VERBATIM (byte-identity check) as frozen constants + structural tests; pin counts 11/17, 9/13, 9/14, 10/15, 5/6, 7/10, 6/8, 7/10; one Task + one End; OR valve on exactly the three double-loop graphs; `reviewer.pass → checklist.await`; no `start` ports; `FB_WIRE_MAP` = dynamic resolver; `wf_default` maps derived from the REAL `DEFAULT_WORKFLOW` → Tasks 9–10 (§10.2). validateGraph drift guard correctly deferred to P2.
- §12: baseline in Task 0, final total in Task 11, mutation-proof assertions per guard (all executed here except Task 8's — see G2). §16 conventions: header, self-contained Spec line, Global Constraints, Task 0…N, Q&A, per-task Files/Interfaces/TDD/expected output/commit — all present.
Gaps: none beyond G2 (a guard that is not mutation-proof for the root).

## Contract sanity toward P2–P4 (verified on the produced files)
- Sentinels: `export class RunHarness extends EventEmitter {` (run-harness.mjs:221 of the produced file), `export const SEED_TEMPLATES = deepFreeze([` (seed-templates.mjs:274) — both match the Handoff greps verbatim.
- Six hooks, base: `async _resolveTopology(_registry)`, `async _engineRun(_args)`, `_enginePrePausePoint()`, `_engineRehydrate(_rp)` throw `engine hook not implemented: <name>` (the first two reject, the last two throw synchronously — Task 3 test 1 pins exactly that); `_bookend(name, status)` → `this._phase(name, 0, status)`; `_initRunners(_opts)` no-op. Shell validation errors: `engine hook contract: _resolveTopology must return { manifest, agentKeys, workflow:{id,name} }` and `engine hook contract: _engineRehydrate must return { checkpointRef, memberWorktrees:[], audit }` — matched by the tests and confirmed reachable (`res.status === 'error'` path; S8 sits at line 789, OUTSIDE the `try` at 791, so a foreign point rejects `resume()`).
- v1 implementations reproduce the seam code byte-for-byte (the multiset diff shows only the expected relocations); `Orchestrator` keeps `createOrchestrator`, `decomposedTaskNode`, `_testing`, and re-exports `isAbort`, `errStreamAttr`; the harness exports the 11 helpers (`ERR_STREAM`, `errStreamAttr`, `roundUsd`, `sumStepCosts`, `sumStepActive`, `isAbort`, `pauseErr`, `isPause`, `firstLine`, `rel`, `clip`).
- `createOrchestratorFor(opts).engine` ∈ {'v1','graph'} stamped from the resume point first, else the row (`readWorkflow` at workflows.mjs:277 is async, returns null for unknown ids — confirmed); `selectEngine` `Number(raw) === 2`.
- `constants.mjs`: `TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS, gatePorts, NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS, BOOKEND_EXECUTION_IDS` — all exported, frozen where claimed, `WIRE_ID_RE` admits `w1`…`w17` and `w_xxxxxxxx` (the seed test proves it on all 8 graphs).
- `verdict.mjs` → `protocol.mjs` re-exports the SAME objects (`SEVERITIES`, `BLOCKING`, `normalizeSeverity`, `hasBlocking`, `blockingIssues`); `protocol.mjs` keeps its other exports; `runners.mjs:35`, `workspace-mock.test.mjs:15` untouched and green.

## Flags for the re-execution agent (empirical doubts, not asserted)
- G2 (Task 8 second mutation) — run it; expected NOT to bite as written; add the `/src/shared/core/db.mjs` probe and confirm THAT bites under a widened root.
- G1 — confirm your `npm test` tail shows `ℹ pass N` once the command is changed; record BASELINE from that line.
- Task 2 Step 2 — expect `2715`/`1780` (G3), not `2693`.
- Task 9 Step 1 — expect `IDENTICAL` only if the three seed fences are joined with one blank line each (G4).
- Task 8 Step 3 — not run here; the recipe mirrors `test/api-hljs-assets.test.mjs:7-38` exactly and `mime@1.6.0` maps `.mjs` → `application/javascript`, so 4/4 is expected.

## Verdict
**READY TO EXECUTE after two text edits** — no CRITICAL findings; the extraction script, all seven new suites and the oracle were executed against dev `e6968e15` and are green; every mutation check that could be run bites as written.

CRITICAL: none.
MAJOR:
- G1 — `npm test 2>&1 | tail -5` never shows `ℹ pass N` on Node 25 (8-line summary); change to `tail -8` / `grep -E '^ℹ (tests|pass|fail) '` in Task 0 Step 5, Task 2 Step 7, Task 6 Step 5, Task 11 Step 1.
- G2 — Task 8 Step 4's "widen the root" mutation cannot bite (send refuses `..` before consulting the root; serve-static falls through to the 404 tail) and the mount guard is blind to a wrong root: add the `/src/shared/core/db.mjs` (no `..`) → 404 probe and reword the mutation; verify by re-execution.
