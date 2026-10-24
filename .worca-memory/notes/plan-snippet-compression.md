---
name: plan-snippet-compression
description: Implementing or reviewing code a plan gives verbatim (whole-file blocks or diffs) — apply it by script and prove byte-identity; a hand "copy" can be a compresse
updated: 2026-10-17T22:51:36.980Z
author: Bulibas
---

Implementers sometimes "copy" a plan's full module snippet into ui/public as a compressed rewrite (whole functions
on one line, comments gone). The rewrite looks complete but silently drops pieces: a helper set
(e.g. `RUN_JOBS` in `utilityId`, so `models.<e>.memoryDefrag` became `models.<e>.utility.memoryDefrag`),
value formatters (`$5.00` became `5`), whole fields, and success messages. Seen in Plan 2a cycle 4
(engine-settings-view.mjs, project-settings-view.mjs).

How to check: when a plan gives a module verbatim, diff its exported constants, helpers and field lists against the
implemented file. Then run that task's jsdom test itself; do not trust the implementer's "tests pass" claim.
Setting ids must match `src/core/settings-cascade.mjs` (`UTIL_RE`, `utilityId`) exactly.

Implementer recipe (worked 2026-10-18 on the chat chips v5 plan: 7 new files and 15 diffs, all applied byte-exact):
- Extract the blocks with a python script, never by retyping. Each block follows a header line
  `` **`<path>`** (new file, complete): `` or `` **`<path>`** (diff against `<sha>`): ``, then a fence of three backticks,
  or four when the block itself holds a fence (a test with a fenced string, a markdown doc). The block ends at the
  line that is exactly the same backtick run.
- Write new files from the extracted text. `git apply --check` every diff first, then `git apply` them in
  test-first order: the step's test block, run it and see it red, then its code block.
- Prove it afterwards, so a reviewer can rerun the proof instead of reading every line: `cmp` each new file against
  its extracted block, and `git apply --check -R <diff>` for each diff (it succeeds only while that diff is in the tree).
- Reading the plan in python keeps backslash-u escape text intact; the Write tool would not
  (see [[write-tool-unicode-escape-trap]]).
