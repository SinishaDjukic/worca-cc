---
name: ask-tool-extension-traps
description: Read before adding or gating an Ask Worca MCP tool, prompt rule, or sandbox note — pinned lists and import bans that break silently.
paths: src/core/ask/tools.mjs, src/core/ask/prompt.mjs, src/core/ask/spawn.mjs, src/core/ask/mcp-stdio.mjs
updated: 2026-10-18T18:07:58.327Z
author: Bulibas
---

- `src/core/ask/tools.mjs` must stay import-free: `test/ask-tools.test.mjs` scans its source. Any I/O or network code goes in a `*-deps.mjs` bundle that `mcp-stdio.mjs main()` spreads into `createAskTools`. Handlers only call `deps.<bundle>.*`.
- Gate a tool by spreading it onto the END of `defs` (`...(deps.x ? [...] : [])`). The real tool-name list is pinned in `test/ask-mcp-stdio.test.mjs` and `test/ask-tools.test.mjs`, so a tool that is absent by default keeps both pins byte-identical.
- `ASK_SYSTEM_RULES` ends at a pinned last number and `ASK_HOSTING_RULE` takes the next one. The number moves: on 2026-10-07 the rules stop at 22 (Away mode) and hosting is 23 (`test/ask-prompt.test.mjs` ~488 and ~669 assert no `23.`). Grep `rules stop at` in that test for the current pin. Put new conditional guidance in a section appended by `buildSystemPrompt`, the way the scripts section is, never as a new numbered rule.
- The claude process env is scrubbed (`envScrub`). The MCP child sees only `mcpServers.env` from `buildMcpConfig`, whose default output is pinned exactly in `test/ask-spawn.test.mjs`. Add env entries only conditionally.
- `useTempHome` sets `WORCA_HOME` but not `HOME`, and `settingsFile()` resolves under `HOME`. MCP-child code that reads settings directly would hit the real `~/.worca-cc/settings.json` in tests. Resolve settings in the parent and pass the result via env, or inject a reader.
- The old `ask-worca-design.md` §6.3 referenced in the `spawn.mjs` header is untracked (commit 33b7d88e). Read it with `git show 33b7d88e^:docs/superpowers/specs/2026-08-22-ask-worca-design.md`.
- A new key in a tool's return object reaches the model as is. `src/core/ask/rpc-server.mjs` (`tools/call`) sends `JSON.stringify(out)` of the whole object, and nothing whitelists keys or keeps only `text`. This holds for both Ask engines (`ASK_ENGINES` is claude and codex), relay mode and the loopback bridge (checked 2026-10-18). A thrown `AskToolError` reaches the model only as `error: <message>`. The parent's `events.mjs` keeps only status and duration, so the UI never shows result keys. The model learns what a key means only from the tool description, so pin that wording in a test: `tools.list().find((d) => d.name === '<tool>').description`, the pattern in `test/ask-model-tools.test.mjs`.
