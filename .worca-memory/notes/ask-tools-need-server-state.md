---
name: ask-tools-need-server-state
description: Read before designing an Ask MCP tool that must act on live server state (terminals, live runs), or a hook that must see every memory-store write.
paths: src/core/ask/*.mjs, ui/server.mjs, src/core/memory-*.mjs
updated: 2026-10-16T23:54:30.874Z
author: Bulibas
---

In classic mode the Ask MCP child (`src/core/ask/mcp-stdio.mjs`) runs every tool in its OWN process and opens the DB
itself. It cannot see anything that lives only in the worca server process: the `TerminalManager` PTYs, the runs Map,
live orchestrator state. Only relay mode (agent users, `askAgentRelay` in `ui/server.mjs`) runs tools in the server,
through `extraDeps`.

The two existing patterns do not fit a tool whose RESULT the model needs:
- parent-intercept (`set_away_now`, `track_run`: events.mjs sees the tool result, turn.mjs acts) — the model never sees the outcome;
- relay `extraDeps` — absent in classic mode.

What works (planned for #574 agent mode): a loopback-only server endpoint with a per-turn token. The URL is not secret
and may ride `mcpServers.env`; the token must NOT (the mcp json is model-readable) — put it in `buildAskSpawnOptions`
`spawnEnv` (survives the scrub, Claude Code hands it to the stdio child). `cleanRunEnv` drops `WORCA_*` keys from
`spawnEnv`, so the token var needs a non-`WORCA_` name. `spawnEnv` must stay absent when there are neither MCP copies
nor a token (`test/ask-spawn.test.mjs:396` pins it).

Relay mode IS agent isolation (`agentRelay: agentIdentity() ? askAgentRelay : null`). Do NOT inject a server-side power
there just because `extraDeps` makes it easy: the server user's terminal, Actions and similar refuse agent callers on
purpose (`agentMayBeCaller` → `terminalEnabledHere`/`actionsEnabledHere` false). A tool that runs things as the server
user must be OFF in relay mode (the #574 refine settled this: agent mode is unavailable under agent isolation).

Two limits on long-running tool calls: `createRpcServer` runs calls on ONE sequential chain (a long wait blocks every
later call of the turn), and Node `fetch` (undici) has a 300 s headers timeout, so a classic-mode call over HTTP must
return within ~240 s.

Memory writes split the same way (checked 2026-10-16, team-memory planning). In classic mode Ask `remember`/`forget`
write the store FROM THE MCP CHILD, so an in-process hook never sees them, and `withStoreLock` (memory-sync.mjs) is only
a per-process promise chain. Every Ask memory write surfaces in the server at ONE place: the `onMemoryMutation` sink,
fed by `ask/events.mjs` `pokeMemoryWrite` from worca's own tool result (it passed only `{scope, tool}` until team memory
added `name`). The other store writers: the REST PUT/DELETE/restore routes in `ui/server.mjs` — `restoreSnapshot`
rewrites the whole scope with rm + cp and bypasses `writeMemory`/`removeMemory`, so diff `listMemory` before/after — and
run sync-back in `run-harness.mjs` `_syncMemoryWith`, which runs in the CLI process for a CLI-started run. A hook that
must see every write needs a durable on-disk queue fed from all three.

Relay mode still has a stdio MCP child: `mcp-stdio.mjs --relay <url>` (`relayMain`) only forwards each call to the
server. The tool result still comes back through the CLI's stream, so every `events.mjs` poke (`pokeMemoryWrite` and
the rest) fires in BOTH modes. Do not plan a separate relay-mode hook for it (checked 2026-10-17, team memory 1a
review). The poke is lost only when the turn dies between the child's write and the tool_result line (a Stop, a crash):
nothing re-detects such a write later.
