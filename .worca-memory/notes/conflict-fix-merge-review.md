---
name: conflict-fix-merge-review
description: Reviewing a "resolve PR merge conflicts" run (MERGE_HEAD left staged) — the checkpoint trap and a mechanical proof of the merge in about 5 commands.
updated: 2026-10-27T12:47:42.122Z
author: Denislav Prinov
---

**The checkpoint can be the wrong "before" on a REPEAT conflict-fix run** (PR 954 merge 2, 2026-10-27).
- **What happened:** the run-root checkpoint (`2902c8c4b`) was the dev commit an EARLIER run had merged. It was the second parent of HEAD (`e0e1ac84b`), not HEAD.
- **Why it misleads:** `git diff <checkpoint>` then shows the PR's own 39 files on top of dev's new 295 files, and reads like an implementation.
- **The real before/after:** HEAD (`git log -n1 --format='%H %P'`) against `cat "$(git rev-parse --git-dir)/MERGE_HEAD"`.

**Mechanical proof, then read only what differs:**
- `git merge-tree --write-tree -z --name-only --no-messages HEAD <MERGE_HEAD>`: the first line is git's auto-merge tree; the rest are the conflicted files.
- `git diff --stat <that tree> $(git write-tree)`: the only files listed should be the resolved ones and any deliberate extra edits. Everything else is git's clean merge.
- Dev-only files equal dev, and PR-only files equal HEAD. Build the name lists:
  - `git diff --name-only <old-base> HEAD` (the PR's files)
  - `git diff --name-only <old-base> <MERGE_HEAD>` (dev's files)
  - `comm -12` of the two gives the files both sides touched, and only those can differ from both sides.
  - `git diff --name-only <MERGE_HEAD> <index tree> | comm -23 - pr.txt` must print nothing.
- Teardown does `git add -A`. Check that a symlinked `node_modules` is ignored with `git check-ignore -v node_modules`: a `node_modules/` pattern (trailing slash) does NOT match a symlink.

**Semantic seams a clean text merge hides.** Fan out one lane per both-touched area, and mutation-check every guard of the resolution in a `git archive <index tree>` copy.
- Seen here: dev's whole-transcript focus keeper (#958) was never stopped in `closePage`, so it pulled the focus into a host the PR added. No test caught it.
- One guard was dev's own and unpinned on dev too. Attribute such a survivor by running the same mutant on `git archive <MERGE_HEAD>` before calling it a merge defect.
