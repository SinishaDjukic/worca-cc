---
name: run-worktree-hold-traps
description: Read before touching checkouts, retained worktrees, their patches, commits or banners, or any server read/write/rm inside a run's pipeline dir or run root
paths: src/core/folder-members.mjs, src/core/checkout.mjs, src/core/worktree.mjs, src/core/pipeline-delete.mjs, src/core/run-harness.mjs, src/core/artifacts.mjs, src/core/folder-apply.mjs, src/core/folder-copy.mjs, src/core/run-manifest.mjs, ui/public/actions-view.mjs, ui/public/run-glance.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Task texts "verified on dev" got several of these wrong: re-check in code. Archive and run.json rules: [[pipelines-db-traps]].

## Patches
- `snapshotWorktreePatch` is NOT read-only: it runs `git add -A` on the folder's REAL index (how untracked files enter), then `git diff --binary HEAD`. On a linked folder (`checkout.external`, the person's own clone, never patched per docs/actions.md) it stages their work; mid-merge it marks conflicts resolved. Read-only diffs use a temporary `GIT_INDEX_FILE` (precedent metrics/sync.mjs) or git-info's `liveDiff` helpers.
- A temporary-index helper reads the real index path BEFORE setting `GIT_INDEX_FILE` (`rev-parse --git-path index` answers `$GIT_INDEX_FILE` once set; the seed silently falls back to `read-tree <base>` and `--skip-worktree` files leak). Pin with a skip-worktree file.
- A linked folder's record outlives its branch (`checkoutRecordsFor` keeps it while the folder exists; people switch back to `main`): diffing against `refs/heads/<run branch>` shows the run's commits REVERSED. Diff against `HEAD` or refuse when `symbolic-ref HEAD` is not the branch. The linked holder is always a worktree of the project repo.
- `checkout-discard-<pk>-<ts>.patch` is never `recordArtifact`ed (no route serves it, though the confirm says "saved as a patch"). `/recovery-patch` serves only the FIRST `retained-work-patch` row, else `diff-patch.patch`.
- `test/helpers/history-detail-boot.mjs` serves `box.detail` BY REFERENCE: app code mutating `histDetailState.data` leaks into module fixtures — copy.

## Commit, then release
- Code that commits in a worktree a PERSON could have touched (retained after a failed teardown commit, a kept checkout) and then releases it (`removeWorktree(force:true)` = rm -rf) must first check `git symbolic-ref -q HEAD` is the run's branch (teardown's `_commitWork` never needed it). Probe: `git checkout --detach` / `git switch -c side` inside, then assert the work is on `refs/heads/<branch>` and the worktree survives a refusal. Shape: `commitStagedWork(dir, {…, branch})` → `{ok:false, step:'branch'}`, member `failed`, stamp kept.
- Memory exclude: `_excludePathspecs(key)` is EMPTY when the checkout TRACKS `.claude/rules/worca` (mount refused); a re-commit hardcoding `exclude: [MEMORY_RULES_REL]` `git rm --cached`s them, DELETING them from the branch. Landed: `indexTracks(dir, rel)` (`ls-files -- :(icase)<rel>`; `ls-tree` refuses icase, exit 128) gates the exclude in `applyRetainedUnderLock`. The INDEX is the witness, not HEAD; a test `git add -f`ing a mount into an untracked project fakes a state Apply never meets — pin with mount files left UNSTAGED. `commitStagedWork` drops every exclude from the index: keep tracked-path checks at the call site.
- `_commitWork` tries repo identity with hooks, `orchestrator@local` with hooks, then (detached runs only) `-c core.hooksPath=`. It never overrides signing, so retained work on a detached run means signing, a young `index.lock`, the 120 s timeout or disk; `commitFailed.message` is attempt 2's stderr. Teardown never recomputes diff stats.

## Refusals and gates
- "Discard that checkout first" exists ONLY in `POST …/resolve-pipeline`; a plain new run reusing a held branch fails `createWorktree` (`already checked out in worktree`) → error PAUSE.
- Archive refuses retained work and a live checkout (409); `hdSetArchiveGate` disables only for retained work; Archive lives in History's ⋯ menu (Advanced). Retained work does NOT block `POST /api/pr`/publish (`glanceCopy` reads frozen results.json); `retainedWorkFor` gates only archive, Check out, deleteWorkspace, keep-policy, Try it.
- Check out/Discard/Unlink/discard-worktree emit `pipelines-changed`, never `actions-changed`: call `refreshActionsModel`. `writeHistoryCache` strips `pr`/`retainedWork` but not `checkout`.
- The retained banner sits on the GLANCE (`.rd-banners`/`.hd-banners`), every level. `pipelines-changed` → `rdRepaintOpenGlance` runs `paintRdGlance` only, never `paintRdBanners`: History-row banners stay stale.
- A finished run page is transient (no server sets `live`; `rdSavedRow` hands off to History as soon as a terminal row lands): fixtures with `live:true` rows are artificial; put finished-run fixes on History first.

## Without git
- Every `force:true` discard deletes uncommitted edits with NO patch while git is missing (`snapshotWorktreePatch` fails, `!snap.ok && !force` is the only stop, `removeWorktree` rms). Reached by hourly `releaseKeptCheckouts` (`gh pr view` needs no git) and `enforceCheckoutCap`: gate automatic discards on `gitAvailable()` ("spawns no git" crawls miss it).
- Stopping a paused run without git is safe: the root is kept `retained: commit_failed` (apply/discard 409 until git returns).

## Pipeline dir and run root are agent-writable (hosted)
`store/` and `runs/` are `2770 worca:worca-share`, umask 0007: any server-uid read/write there crosses users. Ask's `ask/` has the same class ([[ask-running-turn-state]]).
- Write: never follow a planted link — random temp name with `flag:'wx'` (`writeAtomic`) + rename, `realFoldersUnder` + `COPYFILE_EXCL` for nested saves (`run.json.tmp` is still fixed-name).
- Read: never take a PATH from a file there (a forged `folder-manifest.json` `root` or `..` key exposed server files in `changes.patch`): root from the DB record, keys validated at read (`readFolderManifest` refuses the whole manifest via `safeRelPath`, so Apply answers `COPY_MISSING`). Read every pipeline-dir file with `readRegularText` (lstat + `O_NOFOLLOW` + `O_NONBLOCK`); never re-read a file only to re-write it. Patch sides need `parentInside` (realpath of the parent under the root's realpath).
- A realpath containment check is only as good as its ROOT: the agent can rename its cwd `runs/<id>/repos/<key>` and plant a link. `folderCopyRoot(copyDir, {pipelineId, key})` (lstat real dir + realpath === `<realpath(home)>/runs/<id>/repos/<key>`) gates refresh, apply, teardown, resume re-attach, memory `refreshMount` and Cursor's per-spawn `.cursor/`. Add a `repos/` swap row (a cwd-only swap lets the root check be deleted). Swap mid-scan with an fs/promises `open` hook; producer probe `renameSync(orch.runCwd, x); symlinkSync(canary, orch.runCwd)`. Probe in ~5 s: `copyFolder`, forge the manifest, `scanChanges` + `buildChangesPatch`, grep a canary.
- Delete: run.json `injectedPaths` drive `rm`/`cp` in the boot sweep and resumed teardowns — contain each entry (lexical + parent realpath) and prove the root real first (`ownWorkDir`). "Built from trusted parts" is not containment: `rm(join(home,'runs',id,'repos',key),{recursive})` follows a planted link; only `rmGuarded(runs/<id>)` is safe — gate deeper removals with `folderCopyRoot(path, {pipelineId, key, home})`.
- A new resident of the run root must survive every OTHER remover: `discardCheckout` (incl. keep-policy eviction) filtered members by `worktreeDir`, `releaseRetainedTargets` counted worktrees only, `deleteWorkspace` removed the store holding `changes.json`. Grep every `rmGuarded(`/`rm(` of the dir and every retain filter; keep tests `liveRetainMembers` (counts `copyDir`), `folderApplyRetainFor(row)`; fixture `seedRun({commitFailedWt})` in `test/workspace-folder-apply.test.mjs`.
