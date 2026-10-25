---
name: stack-fixup-autosquash
description: Folding review fixes into an old commit of a long stack (fixup! + autosquash) — conflicts carry later commits' code, and per-commit tests catch rows that only p
updated: 2026-10-25T13:46:23.646Z
author: Bulibas
---

Rewriting a 14-commit stack with fixups made at HEAD (2026-10-25, protection stack on dev):

- **A fixup's conflict hunk carries LATER commits' code.** A fixup built at HEAD and squashed into commit N has, in its
  context and "theirs" side, code that commits N+1… add (a whole test block, a moved catalog field, a `signInMode:
  decision.signInMode` argument). Never take "theirs" whole: take "ours" plus only the fixup's own lines
  (`git show <fixup> -- <file>` shows them). Two such conflicts per file are normal.
- **A fix that later commits rewrite cannot be a fixup.** Build it in a scratch clone at commit N, test it there,
  and apply it at a planned `break` (or an `exec` line that patches and `git commit --amend --no-edit -a`). Then every
  later commit that rewrites those lines conflicts once; resolve by keeping the later commit's design.
- **Check the result:** `git diff --stat <backup-of-pre-squash-head> HEAD` must list only intended files. Then run each
  commit's own changed test files plus `test/boundary-*.test.mjs` and `test/git-raw-spawn-lint.test.mjs` in a clone
  (`git checkout --force <sha>` per commit, `node_modules` symlinked from the worktree, about 35 min for 14 commits).
- **Rows written at HEAD fail at earlier commits.** A conformance row over `ENGINE_NAMES`, added at commit N by a
  fixup, also runs for engines whose own later commit makes it pass (Goose's MCP env file, Gemini/Qwen chat sign-in).
  Give the row a `CHAT_PENDING`-style skip set and remove each engine from it in that engine's commit. A cap test that
  meets an earlier, overridable refusal (OpenCode's sub-agents before its catalog entry) passes `allowed: true`.
- An `exec python3 <script>` line after each `pick` rewrites messages safely: key it on the subject, and no-op elsewhere.
  Changing only messages leaves every tree as it was; prove it with `git diff --stat <backup> HEAD`.
