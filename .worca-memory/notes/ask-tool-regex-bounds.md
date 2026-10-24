---
name: ask-tool-regex-bounds
description: Read when adding or reviewing code that turns model or user input into a regex or glob (Ask tools, deny rules, secret-path patterns, any setting that holds patt
paths: src/core/ask/file-deps.mjs, src/core/ask/deny-rules.mjs, src/core/ask/tools.mjs, src/core/secret-paths.mjs, src/core/settings-cascade.mjs
updated: 2026-10-24T10:29:22.068Z
author: Bulibas
---

A pattern the model passes to an Ask tool is untrusted input. Repository text can prompt-inject the model into sending it.
A length cap does NOT bound the regex's run time:
- `globToRegExp` in `deny-rules.mjs` backtracks badly on repeated `*`. Measured on 2026-10-03: `'/b/' + '*a'.repeat(7) + 'z'`
  against a 60-character name took 5 s.
- `new RegExp(pattern)` accepts `(a+)+$`.

This matters more than it looks because of where the tools run. In agent-relay mode (`askAgentRelay` in `ui/server.mjs`),
`createAskToolServer` runs inside the worca server process, so one slow match blocks the whole server, not just one chat's
MCP child.

Rule: any tool that compiles model input into a regex or glob must bound it. Collapse runs of `*` and cap the number of
wildcards, use a non-backtracking matcher, or run the match in a worker with a timeout. Review must flag an unbounded
version as at least major once the tool can be reached. The Codex `grep`/`glob` tools from Plan 2b are still unbounded,
and they become reachable when `CODEX_ASK_LOCKDOWN` is set.

Same class, user input (seen 2026-10-24, core-3 review): `globRe` in `src/core/secret-paths.mjs` (the matcher that moved
out of ask/tools.mjs) gives each `*` a `[^/]*`. The project setting `secretPaths` feeds it user patterns, and
`isSecretPathList` checks only the length (256) and the count (200). `'*a'.repeat(7) + '*b'` against a 60-character name took 45 s.
`overlayFiles` matches every tracked and untracked file synchronously at sandbox start, so the run hangs. When a
setting starts holding patterns for an existing matcher, the matcher's input is no longer trusted: bound it, or move to a
linear wildcard match, and add a timing test.

Fixed in the core-3 fix cycle: `secret-paths.mjs` now has `globSteps` + `globMatch`, a set-of-states walk (time is
name length x pattern steps). Reuse it for any other glob that takes user or model input, e.g. `deny-rules.mjs`
`globToRegExp`. It is about 5x slower than the regex on plain patterns (100,000 paths x 6 defaults: 229 ms vs 46 ms),
which is fine next to the git calls around it. Pin it with a timing test that would hang on the old matcher:
`'*a'.repeat(8) + '*b'` against 200 `a`s under 50 ms (`test/secret-paths.test.mjs`).
