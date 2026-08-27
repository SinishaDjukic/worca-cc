# apply-P1-v2 — the P1 v2 plan file was written (Opus applier, 2026-08-27)

**File written (the ONLY file touched):** `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P1-harness-split-foundations-v2.md`
v1 (`…-P1-harness-split-foundations.md`) untouched; nothing staged/committed; no repo file other than the new `-v2.md` written; no `npm test`/`npm ci`; the extraction script was NEVER executed (it writes `src/core/*`).

Method: every edit was applied as an EXACT literal substitution by `scratchpad/p1-apply/apply.mjs`, which aborts unless the `from` text matches exactly once. 66 substitutions, all `matched 1x`. Large `from` blocks were extracted from the file itself with `sed` (never retyped), so no transcription drift is possible.

## Ledger

### Mechanical (P1-M1…M29, from P1-manifest-final.md + P1-dryrun §2/§3)

| edit | status | note |
|---|---|---|
| P1-M1 | applied | Task 1 Step 3 → `ℹ fail 0` |
| P1-M2 | applied | Task 2 Step 6 Expected replaced verbatim (156 tests; real importer list = the two `grep -lE` forms) — dry-run D-4 |
| P1-M3 | applied + C5 | Task 3 Step 2 → `ℹ pass 9`, `ℹ fail 0` (7 + F1 + F2) |
| P1-M4 | applied | Task 4 Step 3 → `ℹ pass 5`, `ℹ fail 0` |
| P1-M5 | applied | Task 6 Step 4 → `ℹ fail 0` |
| P1-M6 | applied | Task 7 Step 2 → `ℹ pass 3` |
| P1-M7 | applied | Task 7 Step 3 message = `non-relative import "node:path"` — dry-run D-3 |
| P1-M8 | applied | Task 8 Step 3 → `ℹ pass 4` |
| P1-M9 | applied + C5/C8 | Task 10 Step 2 → `ℹ pass 11`, `ℹ fail 0` |
| P1-M10 | applied | Global Constraints bullet: spec reporter lines + `perl -e 'alarm 900; exec @ARGV'` (dry-run D-2) |
| P1-M11 | verified | `grep '# pass\|# fail'` = 0 hits. Also fixed the xplan-added Task 5 line (`# pass 10` → `ℹ pass 10`) that the manifest did not list |
| P1-M12 | applied | Task 4 Files anchors (`:972`, `:1062`, `:1150`/`:1203`, `resumeRun :1497/:1560`, `cmdResume :724/:809`) |
| P1-M13 | applied | "63 class members (of 96) and ≈2,590 of" — dry-run D-6 |
| P1-M14 | applied | "The twelve seams" intro + S11/S12 table rows (4-column form, pipes escaped, text derived from the script's `// ── S11:` / `// ── S12:` blocks) |
| P1-M15 | applied | S10 anchor cell → `:945` (channelDefs) + `:952` (audit), `:981`–`:994` |
| P1-M16 | **applied, ADAPTED** | manifest said 8 → 9; written as **11**, because P1-C1's guard line and P1-C7's 3-line §9.4 comment land in the same block. Verified by extracting the block: exactly 11 lines |
| P1-M17 | applied | `(14 calls)` / `(10 calls)` |
| P1-M18 | applied | "asserts the member count (96) and that every expected name is present" + "S6 and S9 exactly twice — see their `all(…, 2)` calls" |
| P1-M19 | applied | `:100-110` |
| P1-M20 | applied | Expected → the `+ actual - expected` diff showing `+ []` |
| P1-M21 | applied | Task 9 Step 1 rewritten: write BOTH files from the plan, THEN diff both against the branch; the `git show > file` path demoted to a labelled OPTIONAL shortcut — dry-run D-5 |
| P1-M22 | applied | Step 5 replaced verbatim (`git add -N`, both pathspecs, twelve seam originals, multiset cross-check) + the C1 clause "(the two `engine hook contract:` guard lines are part of the S1 and S8 replacements)" — dry-run D-1 |
| P1-M23 | applied | Q&A P1-a gains "(after `git add -N` of the new file, over BOTH paths)" |
| P1-M24 | applied (= C13) | prose `BASE_HOOKS`/`V1_HOOKS` blocks DELETED and replaced by a pointer to the script's template strings; Step 1's "if you change one, change both" replaced by "the script is the source of truth — edit it, not the prose"; the script's `BASE_HOOKS` JSDoc upgraded with the prose's richer lines + F1/F4 sentences |
| P1-M25 | **SUBSUMED by P1-C1** | F1's version applied once (getDb import + `auditOf` helper + the test-4 and test-6 `assert.match`), not the dry-run's inline duplicate |
| P1-M26 | applied | `engine-select.mjs` records `orch.engine`; one assertion in each of the two factory tests; Interfaces line; mutation line ("gut the factory") added to Step 3 |
| P1-M27 | applied | bare-string assertion appended to the Set test + mutation line on Task 1 Step 3 |
| P1-M28 | applied | `assert.equal(res.status, 404, p);` in the traversal loop + "widen the mount to `src/`" mutation on Task 8 Step 4 |
| P1-M29 | applied (one word adapted) | Task 7 prose sentence about test 3's escape branch, placed right after the test block; "the injected-import mutations above" would have dangled (those mutations live in the dry-run, not in the plan), so it now names them explicitly as measured-on-the-clone probes |
| "Not applied (recorded)" | unchanged | ORCH_IMPORTS dead `resolve`/`basename` left alone; Task 11 Step 4 stays a manual check |

### Cross-plan overlap (P1-E1…E8)
Already in the source file; NOT re-applied. Only interaction: E4's Task 5 line still said `# pass 10` (reporter text) — fixed under M11; and E6's extra Task 10 test drove the C8 adaptation below.

### Critique fixes (P1-C1…C15 / P1-critique.md F1–F15)

| edit | status | note |
|---|---|---|
| P1-C1 | applied (4/4) | (1) `BASE_HOOKS` JSDoc: all three topology fields REQUIRED + `audit:string` REQUIRED; (2) the `engine hook contract: _resolveTopology` guard in the S1 replacement (prose AND script, byte-identical) and the `engine hook contract: _engineRehydrate` guard in the S8 replacement; (3) Task 3 `getDb` import, `auditOf` helper, `assert.match` on tests 4 and 6, new contract test, mutations (e)/(f); (4) count 7 → 9 |
| P1-C2 | applied | stub `_engineRun` gains `this._checkPause();` (with the comment); F2's pre-pause test added verbatim; mutation (g) added; NO v1 `orchestrator-pause` test added |
| P1-C3 | applied | the S12 fenced block MOVED before the `EXPORTED`/assembly block (document order == execution order; verified by re-extracting blocks 9–14 in order); its lead sentence rewritten; the order note rewritten; the two post-condition `die` guards inserted immediately before `writeFileSync` |
| P1-C4 | applied | F4's JSDoc paragraph in `BASE_HOOKS`; `const rehydrated = await this._engineRehydrate(rp);` in the S8 seam (script + table row); Task 3 Interfaces notes the base still throws synchronously (hence `assert.throws`); Q&A **P1-s** added |
| P1-C5 | applied | Task 3 = 9, Task 5 = 10, Task 10 = 11; Task 6 Step 5 = **BASELINE + 31** (2+9+5+10+5); Task 11 Step 1 = **BASELINE + 49** (…+3+4+11), reference **3809** on a 3760 baseline. Every one of these gates carries "re-measured in the wave-2 execution; write the printed number" |
| P1-C6 | applied | Q&A P1-r gains the `SKILLS_MAX/skillLabel/mergeSkills` + `_testing` sentence |
| P1-C7 | applied | S1 comment → "hard-fail BEFORE the stepper is STAMPED … (the manifest is built inside the hook, which tolerates unknown keys)"; the `buildStepperManifest` reorder added to a new **Disclosed behavior-order deviations** list next to the `collectChannelDefs` relocation |
| P1-C8 | **applied, ADAPTED** | F8's two pins (loop-role `EXPECTED_FB` table + `wf_default` derived from the REAL `DEFAULT_WORKFLOW`) were FOLDED INTO the existing `wf_clarify-implement` pairing test rather than added as a separate test. Reason: the cross-plan pass (E6) had already added a test to Task 10 that the manifest's arithmetic did not count, so a new test would have made Task 10 = 12 and broken every count gate the brief pins (Task 10 = 11, total +49, 3809). Merged, the file now really contains 11 `test(` blocks and 2+9+5+10+5+3+4+11 = 49 exactly. All of F8's assertions are present; `LOOP_OF`/`EXPECTED_FB` are module-level consts and `DEFAULT_WORKFLOW` is imported |
| P1-C9 | applied | `api-shared-static` walk filters `/\.mjs$/` (with the .DS_Store rationale) |
| P1-C10 | applied | purity test scans a comment-stripped `code` copy for the token rules (specifiers still read from raw `src`); the "also never as a bare word in a comment" clause dropped from Global Constraints; a second Task 7 mutation added that puts a bare `document` in CODE |
| P1-C11 | applied (note) | item 3 of the Disclosed behavior-order deviations list (`.map` outside the try, corrupt-point-only); no code change |
| P1-C12 | (a) applied, (b) applied, (c) skipped | (a) "exactly two entries UNDER `src/`"; (b) `git diff e6968e15 -- ui/public/`; (c) branch-name case skipped per manifest |
| P1-C13 | applied | see P1-M24 |
| P1-C14 | applied | Q&A P1-p names the `fixtures.mjs` / FIXTURE_DEFAULT comment for P8 |
| P1-C15 | applied | `resumePointVersion == null` + a comment saying why |
| F16 | skipped | per manifest (A30 accepted `w_?`) |

### Extra (not in the manifest, needed for consistency)
- Task 3/5/10 **Files:** lines updated to `(9 tests)` / `(10 tests)` / `(11 tests)`.
- Task 10 **Interfaces** names the REAL v1 `DEFAULT_WORKFLOW` as a consumed input (the test now imports it).
- The lead-in sentence before `planAgentKeys` was rewritten (it used to say "plus one new module-level helper", which dangled once the prose hook blocks were removed).

## Verification greps on the -v2 file

MUST BE EMPTY (all 0 hits):
- `grep -n '# pass\|# fail'` → **0**
- `grep -n -E 'TBD|TODO|see spec|see the spec|adapt as needed|similar to Task|<!--END-->'` → **0**
- `grep -n 'KINDS.has\|audit?: string\|audit?:string'` → **0** (Q&A P1-d was rewritten to `audit: string` REQUIRED)

MUST BE NON-EMPTY:
- `engine hook contract` → **7** hits (≥ 3 required): S8 table row, S1 prose block, S1 script, S8 script, Step 5 allowed-list, Task 3 contract test, Q&A P1-d
- `git add -N src/core/run-harness.mjs` → 1
- `BOOKEND_EXECUTION_IDS` → 7
- `fb_0: 'w9', fb_1: 'w5'` → 2 (seed constant + the pin assertion)
- `_checkPause()` → 1 (the stub engine)
- `EXPECTED_FB|DEFAULT_WORKFLOW` → 18
- `orch.engine` → 4
- `v2 (refined 2026-08-27` → 1 (the provenance line, line 3)

Fence sanity: 68 ``` lines (even, balanced).

## node --check (syntax only, nothing executed)

| extracted artifact | source blocks (document order) | result |
|---|---|---|
| `split-harness.tmp.mjs` (the script's SIX fenced blocks concatenated as printed) | 9,10,11,12,13,14 | PARSE-OK |
| `run-harness-hooks.test.mjs` | 15,16 | PARSE-OK (9 `test(` blocks) |
| `graph-seed-templates.test.mjs` | 32,33 | PARSE-OK (11 `test(` blocks) |
| `engine-select.test.mjs` | 17 | PARSE-OK (5) |
| `engine-select.mjs` | 18 | PARSE-OK |
| `shared-graph-purity.test.mjs` | 24 | PARSE-OK (3) |
| `api-shared-static.test.mjs` | 27 | PARSE-OK (4) |
| Task 1 appended tests | 0 | PARSE-OK (2) |
| `graph-constants.test.mjs` (untouched, checked anyway) | 20 | PARSE-OK (10) |

Extra probe: block 10 (`BASE_HOOKS`/`V1_HOOKS`) was evaluated in isolation and both strings were wrapped in `class Probe { … }` and `node --check`ed → PARSE-OK, i.e. the escaped backticks in the new JSDoc (`\`exec\` rows`) are correct and the hook text still parses as a class body. BASE_HOOKS 53 lines, V1_HOOKS 83 lines.

Sync probe: the S1 replacement in the prose block and the S1 replacement inside the script are byte-identical (`diff` clean).

## Counts

- v1: **2481** lines · v2: **2497** lines (+16).
- `diff v1 v2`: 217 lines removed, 233 added, 77 hunks — consistent with 66 substitutions, of which one (the prose hook blocks) deletes 129 lines and adds 3, and several add 10–30 lines of new test/guard text.
- Test-count arithmetic now internally consistent: Task 1 → 2, Task 3 → 9, Task 4 → 5, Task 5 → 10, Task 6 → 5, Task 7 → 3, Task 8 → 4, Task 10 → 11 = **49**; Tasks 1/3/4/5/6 = **31** (the Task 6 Step 5 gate). Both gates say "re-measured in the wave-2 execution".
