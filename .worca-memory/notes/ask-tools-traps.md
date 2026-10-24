---
name: ask-tools-traps
description: Non-obvious traps when adding tools, settings or network code to Ask Worca (src/core/ask/*, settings.mjs, SSRF guards)
paths: src/core/ask/**, src/core/settings.mjs, test/ask-*.test.mjs, test/settings-api.test.mjs
updated: 2026-10-07T20:33:33.193Z
author: Bulibas
---

- `test/ask-tools.test.mjs` source-scans `src/core/ask/tools.mjs` for the case-sensitive words `INSERT`, `UPDATE`, `DELETE`, anywhere in the file, description strings included. Never write an HTTP method list or SQL-ish word in uppercase there.
- Node `net.BlockList`: an IPv6 rule `::ffff:0:0/96` matches EVERY IPv4 address, because BlockList checks v4 addresses in their v4-mapped form against IPv6 rules. To block v4-mapped or NAT64 addresses, decode the embedded IPv4 and check it against the IPv4 rules instead.
- `settingsFile()` resolves under `HOME`/`USERPROFILE`, not `WORCA_HOME`. Settings tests must override `HOME`, the way `test/policy-local.test.mjs` does. `persistSettings` is module-private, so setters live in `settings.mjs`.
- Every new `SETTINGS_POST_KEYS` entry needs a probe in the `probes` map of `test/settings-api.test.mjs` (around line 140), or that test fails.
- `ASK_DENY_RULES` enumerates worca home subdirectories one by one. Any new file under `~/.worca-cc/` that the Ask model must not Read needs its own deny rule, and the exact list is pinned in `test/ask-spawn.test.mjs`.
- A deny rule does not keep a secret from the Ask model. Grep was seen ignoring path denies (see the `spawn.mjs` header). The per-turn `tmp/ask/mcp-*.json` is the chat's own cwd, which a Grep with no path searches first. Never write a credential value into the mcp config or any file under the worca home. Treat everything on disk as model-readable, and pass secrets through a channel the model cannot reach. The working channel: add the var NAME to `envAllowlist` in `buildAskSpawnOptions` — the scrubbed claude process keeps it and Claude Code hands its env on to the stdio MCP child (the path `SSH_AUTH_SOCK` already takes; see `webKeyVar` in `spawn.mjs`).
- `runChild` in `test/ask-mcp-stdio.test.mjs` merges `process.env`, so an env-gated tool can leak into the name pin (66 names at :144 as of 2026-10-05; it grows) from the developer's shell unless the test blanks that var.
- Two more pins the plan-level greps miss. `test/settings-projects-root.test.mjs` (around line 314) pins the exact sorted key list of `GET /api/settings`, so any new `settingsState()` key must be added there. (An older note said `test/ask-prompt.test.mjs` ~678 source-scans the `askBuildSystemPrompt(catalog, { … })` call: as of 2026-10-07 no test references `askBuildSystemPrompt` at all — grep before relying on it.)
- Full-suite recipe inside a worca-hosted agent: run `env -u WORCA_HOST_PID npm test`. The host exports `WORCA_HOST_PID`, and `test/host-guard-wiring.test.mjs` then fails ("no WORCA_HOST_PID"). `test/orchestrator-workspace.test.mjs` compares the product repo's `git worktree list` before and after, so it fails when another session moves a worktree branch at the same time. Re-run that file alone before treating it as a real failure.
