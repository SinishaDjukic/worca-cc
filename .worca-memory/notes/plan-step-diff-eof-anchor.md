---
name: plan-step-diff-eof-anchor
description: Worth reading when a plan gives a later step as a unified diff "against the Step N result" and you add or move content in an earlier step of the same file (refi
updated: 2026-11-02T23:25:06.683Z
author: Bulibas
---

A unified-diff hunk with leading context but NO trailing context (typical for "append a test case at the end of the
file") is anchored to end of file by `git apply`. If an earlier step later appends anything after that point (a new
e2e case added in a refine cycle), the later step's diff stops applying, even though its context lines still match.
`git apply -R` of such a hunk on the final tree fails for the same reason. Seen on the Discord reactions plan,
refine cycle 2 (2026-11-03): adding case 32 to Step 5's appended block broke Step 6's e2e diff.

How to apply:
- Never hand-edit a step diff's line numbers. Rebuild the "Step N result" file (the final tree minus the later step's
  hunks: `git apply -R` for normal hunks, a script that cuts the EOF block), then regenerate the diff with
  `diff -u --label a/<path> --label b/<path> <stepN-file> <final-file>` and prove `git apply` on a copy of the step-N
  file reproduces the final file byte for byte.
- Then run the step-N state itself (final tree with the later steps reversed) so each step's GREEN claim still holds.
