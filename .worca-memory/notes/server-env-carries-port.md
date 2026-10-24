---
name: server-env-carries-port
description: Read before spawning any person-facing process (Actions, terminal, tools) with the worca server's env — PORT is worca's own port there.
paths: src/core/actions/spawn.mjs, src/core/terminal/**, ui/server.mjs
updated: 2026-10-03T09:25:28.545Z
author: Bulibas
---

The worca UI server always runs with `PORT` set to its own port: `worca ui` spawns it with
`{ ...process.env, PORT: String(port) }` (`src/cli/worca-cc.mjs`), and `docker/Dockerfile` sets `PORT=4317`.
`actionBaseEnv()` (`src/core/actions/spawn.mjs`) strips GitHub tokens, `WORCA_HOME`, `WORCA_RUN_ROOT` and
`WORCA_HOST_PID`, but NOT `PORT`. Any child built from `process.env` therefore gets `PORT=4317`. An app
started there that honours `PORT` (Express, Next, Puma) tries to bind worca's port and fails with EADDRINUSE.

Quick proof: spawn `sh -c 'echo "[$PORT]"'` with `actionBaseEnv(process.env)` from a server started by `worca ui`.

The built-in terminal (#573) deletes `PORT` in `terminalEnv`. Actions still inherit it unless an action
declares its own `PORT` env, which is a known follow-up. Never assume the server's env holds only the user's own vars.
