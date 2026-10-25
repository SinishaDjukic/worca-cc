---
name: rebase-cherry-pick-review
description: How to review a "put commit X onto current dev" run (cherry-pick --no-commit) in minutes instead of reading a 70-file diff
updated: 2026-10-25T17:04:57.352Z
author: Bulibas
---

A rebase run's diff is mostly a copy of a commit that was already reviewed. Prove that mechanically, then read only the
files that differ (#907 Bitbucket rebase, 2026-10-25: 74 files, 69 identical, 3 conflicts + 2 test edits).

- Baseline: `git ls-remote origin refs/heads/dev` should equal the checkpoint. That shows the base really is current dev.
- Same file set: `diff <(git show --name-only --format= <sha> | sort) <(git diff --name-only <checkpoint> | sort)`.
- Per-file equivalence: hash only the changed lines, so line-number and context shifts do not count:
  `git diff <checkpoint> -- $f | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | md5`, and do the same on
  `git show <sha> -- $f`. Every mismatch is a conflict resolution or a rebase fix. Read those hunk by hunk against
  `git show <sha> -- $f`.
- Semantic drift that the text merge cannot show: grep `git diff <sha>^ <checkpoint> -- src ui` for new forge-specific
  branches (`=== 'azure'`, new strip/env helpers). A feature that extends every Azure path must also extend the ones
  dev added after the commit's parent.
- Mutation-check each wrapper a resolution nests (e.g. dev's `stripTrackerTokens` around a new forge's env arm):
  edit from a backup copy, then `cp` it back and `cmp`.
