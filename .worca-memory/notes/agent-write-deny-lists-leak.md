---
name: agent-write-deny-lists-leak
description: Read before designing or reviewing any "this agent cannot plant code / read secrets" lockdown; deny lists always miss places.
paths: src/core/graph/agent-lockdown.mjs, src/core/guardrails.mjs, src/core/engines/claude.mjs
updated: 2026-10-25T19:04:27.084Z
author: Bulibas
---

`--allowedTools Write` approves a write to ANY path, so a lockdown built from `Edit(...)` deny rules always misses a
place that runs code or carries instructions into the next step. Found in the Promo video plan's refine cycle 4
(2026-10-25), after three cycles had called the deny list complete:
- `<runRoot>/mcp.json`: every later spawn gets it as `--mcp-config` (run-context.mjs:11), so a planted stdio server
  runs in the next step. `<runRoot>/CLAUDE.md`: a single-project run's cwd is `<runRoot>/repos/<key>`, and Claude
  loads the CLAUDE.md of every parent folder.
- `~/.gitconfig` (`core.fsmonitor` runs on the host's next git call), `/opt/homebrew/bin` (user-writable PATH),
  worca's own install (`loadKitTool` imports `assets/promo-kit/tools`), `~/.worca-cc/{memory,team-memory,skills}`.
- Inside the pipeline dir: staged assets (`<P>/promo-kit/`, run-assets.mjs), `directions.ndjson` (later steps treat
  its lines as the person's directions), and the step's own inputs (`<P>/task.md` feeds the Prerequisites check's
  probe allow-list).
- Read side: `<runRoot>/mcp.json` copies `~/.claude.json` server env keys; `<worcaHome>/proxy-login.json` is an NT
  hash; `//**/.worca-cc/` rules miss Docker's `WORCA_HOME=/worca`.

What works: an allow-list as a PreToolUse hook in the same `--settings` payload as the host guard
(`buildSettingsPayload`), fail-closed, with exact files for writes. Thread the option like `memoryLoadLog`
(claude-runner.mjs runClaude → engines/claude.mjs buildClaudeArgs / planClaudeInvocation / runClaudeProcess).
`dontAsk`-style allow-lists break the mock runner (it routes dontAsk spawns to the Ask mock).
Trap while writing it: `//**/` inside a `/** … */` JSDoc ends the comment at `**/` (SyntaxError).
