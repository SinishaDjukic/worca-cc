---
name: refiner-scratch-tree-reuse
description: Implementing a big prose-heavy plan: reuse the refiner's replayed scratch tree, but audit every prose bullet, because the tree lags the final plan version
updated: 2026-10-26T18:06:45.789Z
author: Bulibas
---

The refiner's replay trees often survive in its session scratchpad:
`/private/tmp/claude-501/<cwd-slug>/<session>/scratchpad/{tree,tree2,final}` (git clones at the checkpoint, changes
uncommitted). Find them with `grep -o '/private/tmp/[^"]*scratchpad/[a-z0-9]*' <pipeline>/live-log.ndjson | sort -u`,
and take the newest by `stat` that is older than the plan file (#907, 2026-10-25: tree2 of the cycle-2 refiner).

It saved most of a 205 KB plan (11 tasks, 74 files): `cmp` each "(new file, complete)" block against the tree and
`git -C <tree> apply --check -R` each ````diff block. All matched. Then copy the files task by task (tests first, run
red, then code, run green). Hold back hunks that a LATER task's tests pin, so each task's red stays real (for example
one app.js block, or a file two tasks share).

**Trap:** the tree is the refiner's replay of the PREVIOUS plan version plus the new tests. The final `-vN` text added
prose-only edits that were missing from it: JSDoc and comment rewording (forge, host-credentials, git-sync, plugin-repo,
pr-watch, two server.mjs comments, tools/test.mjs, metrics/prs), a whole docs section, a test comment, the env-table
backticks. Its "outline only" doc was a 3-line stub. Diff the plan versions first (`diff <plan>-v(N-1).md <plan>-vN.md`)
to list what the tree cannot have. Then run two read-only audit lanes (sonnet is enough), each holding half the tasks.
They check every prose bullet against `git diff <checkpoint>` and skip the blocks already `cmp`'d. They also found a
duplicated test card id and a missing doc string.

The lag can reach back more than one version, even when the plan's Handoff calls the tree "the whole vN plan applied"
(promo video, 2026-10-25: cycle 4's `w`). Its code blocks all matched, but prompt bullets from v5 were missing too
(capture step 4's `storageState`, the review's brand-file order, a scenes write-scope tail), a hook-line paragraph
was an older wording, and three T12 files (README, docs/models.md, the changelog) were never written at all. So the
v(N-1)→vN diff is not the full list: check each quoted bullet against the files. A python helper that takes the span
between the first and last backtick of a plan line and searches the whitespace-normalised file finds most misses in
seconds. Also list `comm` of the tree's changed files against the plan's Files lists, since whole files can be absent.

**Trap: sub-agents share YOUR session scratchpad.** A refiner's audit lane told to stay read-only still built its own
replay there, and something it ran put the run worktree's files back over the refiner's `scratchpad/tree`
(2026-10-26, #943: tracked files back at the checkpoint text with the worktree's OLD mtimes, untracked files and later
edits kept). Nothing errored. The next test run failed on a missing export. Keep your replay in a uniquely named
subfolder (`scratchpad/rf<issue>/tree`). Tell lanes to use their own named subfolder. Check `git -C <tree> status --short`
before trusting a green run.

**Fast path that worked (#943 implement, 2026-10-26: 35 files, 9 tasks, ~1 h).** The refiner's lanes now write paths
like `scratchpad/rf<issue>c<N>/tree`, so widen the grep to `[A-Za-z0-9_-]*\(/[A-Za-z0-9_-]*\)\?`. Check
`git -C <tree> diff | md5` against the saved `c<N>.diff` first. Then confirm every fenced block of the final plan appears
in the tree's changed files (compare whitespace-normalised text; a block that is absent should be the OLD side of a
"replace"). Then copy the files whole, task by task: tests first and run red, then code and run green. Afterwards
`cmp` every file against the tree. A whole-file copy also copies any wrong placement that four refine cycles missed.
Here it was a new JSDoc + function put between an existing function's JSDoc and its `export` line, because the plan's
anchor was "directly above `export async function X`". Only a read-only prose audit lane caught it.
