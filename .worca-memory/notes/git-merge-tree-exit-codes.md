---
name: git-merge-tree-exit-codes
description: Read before parsing `git merge-tree --write-tree` output, exit codes or argv (git-sync.mjs base-conflict check, the Ask git tool)
paths: src/core/git-sync.mjs, src/core/base-conflicts.mjs, src/core/ask/git-allowlist.mjs, src/core/ask/tools.mjs
updated: 2026-10-18T17:54:32.284Z
author: Bulibas
---

`git merge-tree --write-tree -z --name-only --no-messages <a> <b>` (verified on git 2.50):
- clean: exit 0, stdout `<tree-oid>\0`
- conflicts: exit 1, stdout `<tree-oid>\0<path>\0<path>\0…` (no extra section NUL with `--no-messages`)
- **trap:** an object git cannot merge (an unknown ref or sha) ALSO exits 1, with an EMPTY stdout and stderr
  `merge-tree: <x> - not something we can merge`. Exit 1 alone is not "conflicts": require stdout to start with a
  40/64-hex tree OID and, for conflicts, at least one path.
- unrelated histories exit 128; git older than 2.38 prints usage and exits 129.

**Argv trap** (verified 2026-10-18, git 2.50): merge-tree stops reading options at the FIRST ref. In
`merge-tree --name-only a b --write-tree`, `--write-tree` is a third ref, so git runs the legacy trivial-merge mode,
which prints file CONTENTS. A validator that takes flags in any order must refuse any flag after the first ref
(`validateMergeTree` in src/core/ask/git-allowlist.mjs does).

The Ask `git` tool throws on every nonzero exit except the exit-1-is-data list (`dataExit` in src/core/ask/tools.mjs:
grep, diff, merge-tree, each only with an empty stderr). A new subcommand whose exit 1 carries the answer must join
that list, or the model only sees `git: exited 1`.

**Filtered output can invert the answer** (review of this run, cycle 1). The Ask git tool line-filters merge-tree output
for protected paths. When every conflicted path is protected (`.env*`, `**/secrets/**`, `*.tfstate*` …; two branches
editing `.env.example` is enough), the filter strips every path and every CONFLICT line and leaves a bare tree id, which
looks like a clean merge. Never let the model infer clean/conflicted, or any "no output = OK" answer, from filtered
text. The fix (cycle 2): the git handler returns `conflicted: r.code === 1 || !!r.truncated` for merge-tree only, and
the tool description tells the model to read that field. The `env-only` branch in test/ask-worktree-tools.test.mjs
pins the all-protected case. Give any future subcommand whose answer is "no output" the same kind of field.

**Capped captures lose the exit status.** `runGitCapture` (src/core/worktree.mjs) stops git once stdout passes
`maxBytes` and reports `{ ok: true, code: 0, truncated: true }`, a synthetic 0. Any answer derived from the exit
status must handle `truncated`. For merge-tree that is safe: a clean merge prints only its tree id (no messages by
default, verified on git 2.50), so output past the cap means conflicts.

merge-tree also runs a merge driver defined in git config (`merge.<name>.driver`) when the checked-out tree's
`.gitattributes` selects it (verified 2026-10-18 through the tool). `diff` runs a configured textconv the same way.
`GIT_HARDEN` only nulls `diff.external`, so "read-only" git subcommands can still run programs that git config defines.
`git --attr-source=<empty tree>` stops the in-tree selection, but then the dry run ignores `merge=union` attributes.

In git-sync.mjs, `NETWORK_CMDS` only sets process-group handling (setsid plus a group kill on timeout). It never
adds credentials. Pass `env` explicitly (`readCred(info).env`), as `fastForward` does. `_run`'s `env` REPLACES
`process.env`; `null` means `stripHostCredentials(process.env)`.
