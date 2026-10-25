---
name: refiner-scratch-tree-reuse
description: Implementing a big prose-heavy plan: reuse the refiner's replayed scratch tree, but audit every prose bullet, because the tree lags the final plan version
updated: 2026-10-25T15:48:07.946Z
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
