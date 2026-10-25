---
name: agent-tool-lockdown-per-engine
description: How to take tools away from one agent (no shell, no web, no secret reads) so it holds on every engine; read before planning any per-agent tool restriction.
paths: src/core/graph/executor.mjs, src/core/phases.mjs, src/core/run-harness.mjs, agents/*.meta.json
updated: 2026-10-25T11:39:08.448Z
author: Bulibas
---

Removing a tool from an agent body's frontmatter `tools:` does nothing: `effectiveAllowedTools` (src/core/phases.mjs:62)
only ADDS the frontmatter list on top of `toolsForMeta(meta)` (src/core/graph/executor.mjs:620). `allowedTools` and
`disallowedTools` are read by the Claude adapter only (Copilot also honours a missing Bash via `copilotToolPlan`).
The one channel every engine adapter reads is `permissionRules.deny`.

Probe on dev 02ba1291b (2026-10-25), `getEngine(name).unenforcedRules(rules)` / `.partialRules(rules)`:
- `deny: ['Bash','WebFetch','WebSearch']`: held on claude, codex, copilot, gemini, opencode, qwen; cursor Bash partial and
  WebFetch/WebSearch unenforced; goose has no permission rules at all.
- plus `Read(...)` secret-path denies (Secure preset protectedPaths): held only on claude and qwen; codex and copilot
  unenforced, gemini and opencode partial.

How to apply: give the agent an exact `--tools` set and a deny list at spawn (`spawnAgent`), and refuse the run in
`RunHarness._engineRefusal` (it already refuses per node for MCP tools) when the engine leaves any of the agent's denies
unenforced or partial. `_engineGate` returns early on Claude. Grep was seen ignoring Read denies on claude 2.1.241
(`src/core/ask/spawn.mjs:37-42`): leave Grep out of a secret-sensitive agent. Re-run the probe before trusting the
table: adapters change.
