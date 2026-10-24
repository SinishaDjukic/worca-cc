---
name: command-text-checks-and-quotes
description: Read before writing or reviewing any text check on a shell command line (host guard, Ask command policy, block lists).
paths: src/core/host-guard.mjs, src/core/ask/command-policy.mjs, src/core/ask/redact.mjs
updated: 2026-10-04T22:38:59.579Z
author: Bulibas
---

Blanking quoted spans before a check (the `stripQuotes` idiom in `src/core/host-guard.mjs`) is right for
"is this a command?" (a commit message `-m "rm -rf /"` is data), but WRONG for "does this name a path?".
`cat "$HOME/.ssh/id_rsa"` and `rm -rf "/tmp/x"` become `cat ""` / `rm -rf ""` and pass. Claude quotes paths by
habit, so this is the normal case, not obfuscation. Seen in the #574 plan (refine cycle 4).

Pattern that works:
- path deny checks read the whole text, quotes included (cost: a commit message naming `.env` is refused);
- command/argument checks split segments on `;`, `&&`, `|`… with quoted spans MASKED, then restore each
  span's content without its quotes as one word.

Per-segment "first word" checks miss ordinary forms (implementation review, cycle 1, 2026-10-05). All of these passed:
- `cd .. && rm -rf proj`: the rm target was resolved against the starting folder, not the folder after the `cd`.
- `xargs rm -rf /`, `bash -c "rm -rf /"`, and `rm -rf $(pwd)/..` (the split on `$(` dropped the target).
- `git -C . push --force`: the check required `push` to be the first argument.

Any block-list test must cover these forms:
- `cd` tracking across segments;
- wrapper prefixes (xargs, nice, timeout, doas);
- `sh -c` bodies;
- `$(`/backtick targets;
- git global options.

Output from Ask's shell reaches the model, so `gh auth token` must be refused, and `redact.mjs` must cover `gho_`, not only `ghp_`.

Also: `ASK_DENY_RULES` anchors `.claude`, `.docker`, `.kube`, `.npmrc` at `~/` only. Every worca worktree has
its own `.claude/rules`, so a check that refuses those names anywhere blocks ordinary project work.
