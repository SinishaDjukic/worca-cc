---
name: run-branch-record-fields
description: Where to store per-run facts recorded after a run finishes (published, checkout) and the git for-each-ref prefix-match trap
paths: ui/server.mjs, src/core/checkout.mjs, src/core/git-info.mjs, src/core/run-harness.mjs
updated: 2026-10-18T11:33:32.434Z
author: Bulibas
---

**Facts recorded on a FINISHED run go in its branch record, not a new column.** `updateBranchRecords(rowId, keys, mutate)`
(`src/core/checkout.mjs`) does a targeted UPDATE of `pipelines.branch` (project run; `keys[0]` only has to be
non-empty) or `workspace_meta.branches[memberKey]` (workspace run). `br.checkout` (#529) and `br.published` (#618,
`{ remote, sha, at, by }`) live there; no schema bump needed. They reach the API through `rowToState` as
`state.branch.*` / `state.branches[k].*`.
Caveat: `writeState`'s upsert re-serializes `branch`/`workspace_meta` from in-memory state, so a stopped/error run
that is RESUMED drops these fields. Keep a no-network fallback for readers (Publish falls back to `branchPushedTo`).

**`git for-each-ref <pattern>` matches refs UNDER a literal pattern too**: `refs/heads/feat` also returns
`refs/heads/feat/sub`. When reading a specific ref's sha with for-each-ref, keep only exact refnames
(`branchTips` in git-info.mjs does this). `branchPushedTo`'s `refs/remotes/*/<branch>` glob has the same edge.

**A "when the run finishes" step that reads the branch or writes its record must run AFTER teardown.** The harness
emits `done` (and sets status `done`) BEFORE its `finally` runs `_teardownRunRoot()`, which commits the agents' last
work onto the branch, removes the worktree and `_persist()`s the branch record from memory. A git check at `done`
time misses the final commit, and a record written then is erased. Put the step after `_keepCheckoutByPolicy()` in
BOTH finally blocks (`run()` and `resume()`), write with `updateBranchRecords`, then copy the row back into
`this.state.branch(es)` (the mirror tail of `_keepCheckoutByPolicy`). The server's `entry.settled` / `isFinishingRun`
stays true until that step ends. Planned this way for #620's base-conflict check (2026-10-07).

**Publish state `moved` is not "local ahead".** `publishStatus` (`ui/server.mjs`) answers `moved` whenever the local
tip differs from the tracking ref, which covers remote-ahead and diverged too. After a PR exists, the remote often
moves ahead: GitHub "Update branch", a suggestion commit, then any `git fetch --prune` (base check, PR remotes, Watch
PR). The UI then offers "Push changes", and its non-forced push fails. Gating on `moved` needs a direction check
(`git rev-list --left-right --count`). Also: Ship it (`createRunPr`) writes no `br.published`; only POST publish and
`pushIfPublished` do (seen 2026-10-18 review).
