---
name: terminal-session-cwd-drift
description: Read before reusing a TerminalManager session for program-run commands — snap.cwd is NOT the shell's current folder.
paths: src/core/terminal/manager.mjs, src/core/ask/commands.mjs
updated: 2026-10-04T21:57:28.017Z
author: Bulibas
---

A `cd` inside one command line persists in the shell. `TerminalManager` tracks the live folder in
`s.cwdNow` (set by the `W` mark, printed with `D` and before `A` after every command). `snap.cwd`, which
`get(id).cwd` and `busyDirs()` return, is the folder the session was OPENED in and never changes.

So any code that reuses a session "in folder X" by comparing `get(id).cwd` will run the next command
somewhere else. Any check that reasons about paths relative to X (for example Ask's rm-outside rail)
is then wrong. Compare the live folder, and compare through realpath: `$PWD` can be logical (`/tmp/x`)
or physical (`/private/tmp/x` on macOS).

Related trap in `src/core/ask/store.mjs`: `JSON_PATCH_KEYS` is a `Set`, and `updateThread` binds with
`.has(k) ? str(...)`. A `JSON_PATCH_KEYS[k]` lookup is always falsy, so it binds objects raw and node:sqlite throws.
