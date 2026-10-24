---
name: ask-secrets-never-in-mcp-json
description: Read before passing any secret (API key, token) to the Ask Worca MCP child — the per-turn mcp json is model-readable
paths: src/core/ask/spawn.mjs, src/core/ask/turn.mjs, src/core/ask/mcp-stdio.mjs, src/core/ask/*-deps.mjs
updated: 2026-09-26T18:02:14.486Z
author: Bulibas
---

The per-turn `mcp-<msgId>.json` is written into `<worcaHome>/tmp/ask`. That directory is the Ask chat's own cwd, and all threads share it. Only `Read(//**/.worca-cc/tmp/**)` guards it, and Grep has been seen ignoring path denies (spawn.mjs header). Treat everything in `mcpServers.worca.env` as readable by a prompt-injected model.

Rule: never put a secret value into `buildMcpConfig` env. Put the variable NAME into the config and add that name to `buildAskSpawnOptions` `envAllowlist`. That list scrubs the claude process env, and Claude Code passes the process env on to the stdio MCP child. The child then reads `env[name]`. Reject reserved names (`RESERVED_KEY_VAR`, case-insensitive) before you allowlist a name. See `webKeyVar` / `webMcpEnv`.

Verify with a turn test: set a real env value, read the written mcp json inside a fake `runClaudeImpl`, and assert that the value is missing and the name is in `opts.envAllowlist`.

Why: in the web-access work, a search key written into this json cost one review cycle. A 30–40 character key also falls under the data-in-URL threshold, so it could be exfiltrated through `web_fetch`.
