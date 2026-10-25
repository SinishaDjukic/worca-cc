---
name: agent-tool-lockdown-gaps
description: Read when locking a pipeline agent down to a fixed tool set (no shell, no web): what --tools does not close, and which engines can hold it.
paths: src/core/graph/executor.mjs, src/core/run-harness.mjs, src/core/engines/*.mjs
updated: 2026-10-25T12:46:32.414Z
author: Bulibas
---

Locking a pipeline agent to an exact tool set (`opts.tools`, Claude's `--tools`) does not close two ways out.

- **MCP servers.** `mcpConfigPath`, `mcpServerGrants` and `pluginDirs` are set for the whole run in
  orchestrator.mjs. `buildClaudeArgs` adds every grant to `--allowedTools`, and `--tools` does not restrict MCP
  tools. So a fetch or browser MCP server stays usable. Clear all three in `spawnAgent` and set
  `strictMcpConfig: true`; the argv snapshot then gains `--strict-mcp-config`. Found in refine cycle 2 of the
  Promo video brand plan (2026-10-25).
- **Other engines.** No adapter except Claude's reads `opts.tools`.
  - On Qwen Code, a pipeline agent keeps every built-in in `QWEN_BUILTIN_TOOLS`: `exec`, `monitor`, `agent`,
    `workflow`, `grep_search` and the rest.
  - `qwenRulePlan` only checks that a rule names a tool Qwen knows. So `unenforcedRules`/`partialRules`
    returning `[]` does NOT prove that a `Bash` deny stops `exec`.
  - Only chats get Qwen's real lockdown (`--core-tools`/`--exclude-tools`, `QWEN_ASK_LOCKDOWN`).
  - Treat a locked-down step as Claude Code only until a probe proves otherwise.

A step whose output later steps with a shell follow (for example a brand.md written from an untrusted guide) needs
the secret-file Read denies too, not only no-shell and no-web.
