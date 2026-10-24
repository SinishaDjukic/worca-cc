---
name: ask-tool-regex-bounds
description: Read when adding or reviewing an Ask Worca MCP tool that turns model input into a regex or glob (grep/glob/read tools, deny-rule matching).
paths: src/core/ask/file-deps.mjs, src/core/ask/deny-rules.mjs, src/core/ask/tools.mjs
updated: 2026-10-03T13:53:03.481Z
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
