# PR #364 Review — fix(pipeline): retain worktree on commit failure

Reviewed commit: `4f2901a2` (sole commit of PR #364, base `dev`).
Review method: max-effort multi-agent review (15 findings: 13 CONFIRMED / 2 PLAUSIBLE / 0 refuted), two independent code-archaeology passes (pre-fix @`527d29da`, post-fix @HEAD), full test run.

## Verdict

**The PR fixes a real, serious data-loss bug, and the fix's mainline path works.** Pre-fix, `_commitWork(...).catch(() => {})` swallowed every `git status`/`add`/`commit` failure at all three teardown sites and `removeWorktree({force:true})` (plus `rmGuarded` of the run root in detached mode) then destroyed the only copy of the agent's uncommitted work. On `error`/`stopped` runs **nothing** survived (no `diff-patch.patch` — `_buildResults` runs only on the done path); on `done` runs only a text patch survived. The failure modes are realistic: the teardown commit runs the user's real repo hooks (husky), respects `commit.gpgsign`, and can hit a stale `index.lock` after the agent process is SIGKILLed. The pre-existing code comments themselves acknowledged the risk.

**The architecture is right and should be kept** (no rewrite): retain the checkout (richest form of the work), protect it from sweeps, block Archive, exit via explicit discard-with-patch. 88/88 tests in the touched suites pass; the retention state is deliberately orthogonal to run status.

**But the implementation has one test regression and a cluster of integrity gaps in its own promise** — paths where the retained work can still be destroyed or wedged — plus UX states that lie to the user. These must be fixed before merge (P0) or soon after (P1/P2).

## Findings

### P0 — merge blockers

- **F1 — `test/ui-history.test.mjs` regression (CONFIRMED).** The always-present hidden `hist-retained-badge` (`ui/public/index.html:422`) adds a second `.badge` per card; `querySelectorAll('#history .badge')[1]` is now card 1's hidden badge, not card 2's status badge. Full suite: 2285 pass / 5 fail = 4 pre-existing imagegen + this one.
- **F2 — Archive guard sees only the DB; the DB stamp is the LAST, swallowed teardown write (CONFIRMED).** Teardown order: `updateRunManifest({retain})` → … → `await this._persist().catch(() => {})` (`orchestrator.mjs:1599`). A crash/SQLITE_BUSY/disk-full in that window (the same conditions that make commits fail) leaves manifest-only retention: sweep keeps the root, but `archivePipeline` (`pipeline-delete.mjs:106`) passes and destroys checkout + feature branch + run root. No consumer of the manifest `retain` blocks archive.
- **F3 — Discard reports success when removal fails (CONFIRMED).** `discardRetainedWorktrees` builds `{ok:true, discarded:true}` before removal (`pipeline-delete.mjs:296`); a failed `removeWorktree` only appends a warning while `commitFailed` stays set. The UI (`app.js:7973`) trusts `res.ok`, nulls `retainedWork`, persists the cleaned row to the cache, hides the banner and re-enables Archive — which then 409s against a card that claims nothing is retained.
- **F5 — sweep `retainOf` throw is swallowed (CONFIRMED).** `worktree.mjs:447` `catch { }` converts "retention unknown" into "remove", contradicting the three-state "callbacks deliberately DO NOT catch" doctrine this same commit wrote into `runRootSweepLookups`. One-line fix.
- **F12 — `SNAPSHOT_FAILED` surfaces as HTTP 500 (CONFIRMED).** The discard route maps only `RUNNING`/`BAD_REQUEST` (`ui/server.mjs:1369`); every snapshot precondition failure (including the guaranteed one after workspace deletion, F4) becomes a generic 500.

### P1 — integrity hardening

- **F4 — `DELETE /api/workspaces/:id` bypasses retention (CONFIRMED).** `deleteWorkspace` (`workspaces.mjs:324`) `rm -rf`s the workspace store including the pipeline runDir that discard needs for the recovery patch. Retained runs become permanently wedged: Discard → `SNAPSHOT_FAILED` 500 forever, Archive → 409 forever, sweep keeps the run root forever.
- **F6 — `branchRecord=null` retention is machine-invisible (PLAUSIBLE trigger, real mechanism).** `_recordCommitFailure` (`orchestrator.mjs:1635`) records only a run warning; in legacy mode even that no-ops (no runRoot). No DB stamp → no banner, no archive block; legacy leaks a registered worktree invisibly.
- **F7 — following the banner's own instructions never clears the state (CONFIRMED).** Only Discard deletes `commitFailed`; after a successful manual commit the banner keeps claiming the work is unsafe, Archive stays blocked, and the Discard confirm falsely warns the work "exists only in the retained worktree".
- **F8 — snapshot uses the 30s SIGKILL git timeout and unbounded in-memory patch string (CONFIRMED).** `snapshotWorktreePatch` (`worktree.mjs:326`) fails precisely on the largest retained work; V8 string cap risk. `--output=<file>` + the existing 120s slow timeout fix both.
- **F9 — history cache persists the live `retainedWork` fact; v1 blob orphaned (CONFIRMED).** `writeHistoryCache` strips only `pr` (`app.js:7412`); stale false banners paint from localStorage; the v1→v2 key bump leaves the old blob forever. Since `retainedWork` should never be cached, the bump itself is unnecessary — revert to v1.
- **F13 — legacy workspace teardown stamps the scalar mirror unconditionally (CONFIRMED).** `orchestrator.mjs:1450` sets `state.branch.worktreeRemoved=true/branchKept=true` with no retained guard (the detached twin got one at `:1555`) → durably self-contradictory row.
- **F14 — discard persists via lossy full `writeState` (CONFIRMED).** Bumps `updated_at` (stats terminal-write proxy + history sort key), UPSERTs `resume_point=NULL` (error rows still carry one), DELETE+re-INSERTs `pipeline_steps`. A targeted `branch`/`workspace_meta` column UPDATE avoids all of it.
- **D1 — no durable artifact at retention time (design gap).** The recovery patch is written only at explicit discard; a crash/manual deletion before that loses everything, and the "Alternate recovery" diff-patch link can never exist for `error`/`stopped` runs (the runs that lose everything). Snapshot best-effort at teardown-retention time.

### P2 — correctness polish

- **F10 — corrupt `workspace_meta` fails OPEN (PLAUSIBLE).** `retainedWorkFor` (`artifacts.mjs:1377`) silently falls through to the scalar path on unparseable meta → archive passes where it should refuse.
- **F11 — `runDirForRow`'s new fallback can resolve the wrong run (CONFIRMED).** First-match `endsWith('-<id>')`, case-sensitive — diverges from `findRunDir` (case-insensitive, exact-name second pass) it claims parity with; non-8-hex id `pp` matches `…-my-pp`. Reuse `findRunDir`.
- **F15 — phantom retention when the worktree vanished mid-run (CONFIRMED).** `git status` spawn-fails (`ENOENT`) → classified as commit failure → "KEEPING the worktree at <missing path>", unclearable stale `commitFailed`, leaked run root until next sweep.

### Cleanups (confirmed, low priority)

- **C1** — run-route preamble (workspaceId/projectKey/projectDir validation) now triplicated in `ui/server.mjs`.
- **C2** — `listWorkspacePipelines` duplicates `listPipelines`'s SELECT; this commit edited the identical SQL twice in lockstep.
- **C3** — `ui/server.mjs:1156` hardcodes `'diff-patch.patch'` instead of `DIFF_PATCH_FILE` from `src/core/results.mjs`.

### Noted, out of scope (pre-existing semantics)

- **N1 — Archive deletes the feature branch** (`removeWorktree({branch: liveBranch, force:true})`, `pipeline-delete.mjs:170/:183`). After a manual recovery commit, Archive still destroys the branch carrying the just-recovered work. Pre-existing archive semantics, not introduced by this PR — decide separately (e.g., refuse to `-D` an unmerged branch, or archive-confirm copy).
- Non-findings verified: legacy sweeps are protected incidentally by `referencedPaths` + the detached-only mode gate; `recordArtifact` already dedupes via `INSERT OR IGNORE`; discard's mount re-rescue is a no-op; all list SELECTs carry the columns `retainedWorkFor` needs.

## Necessity assessment

Necessary and correctly scoped: discriminated `_commitWork` result, `_recordCommitFailure`, retention short-circuit at all 3 teardown sites, `sweepRunRoots` keep (manifest + DB fallback), archive guard + 409 + UI disable, discard-with-patch exit, banner/badge UI.
Over-built or misdirected: triple state storage with divergent readers (keep both representations, but every guard must read both — F2); write-only `retained-work*.patch`; done-only "recovery" endpoint; unreachable-in-production `runDirForRow` fallback added to serve non-8-hex test fixtures (and buggy — F11); cache v2 bump (unnecessary once `retainedWork` is stripped — F9).
Missing: durable patch at retention time (D1); truthful exits from the retained state (F3/F7); workspace-delete integration (F4).
