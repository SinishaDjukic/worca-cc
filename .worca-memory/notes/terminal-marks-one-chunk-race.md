---
name: terminal-marks-one-chunk-race
description: Read before writing code that awaits a TerminalManager start waiter and then tracks the block (Ask commands, any programmatic runner).
paths: src/core/terminal/manager.mjs, src/core/ask/commands.mjs
updated: 2026-10-04T22:01:05.875Z
author: Bulibas
---

`TerminalManager._onData` handles every OSC 133 mark in one data chunk synchronously:
`for (const ev of s.parser.push(text)) this._onMark(s, ev)`. A fast command (`true`, `git status`) often
prints its C (start) and D (end) marks in one chunk. So the `block` running event and the `block` done
event both fire before any `await` on a start waiter resumes.

Any per-block state, such as a concurrency slot, a cap timer, or an "active" map, must be created in
the synchronous `block` running handler, never after `await runCommand(...)`. If it is created after
the await, the entry is made for a block that already ended and is never cleared. The Ask chat then
stays stuck at its 3-command limit, and the leaked timer interrupts a later command in that session.
A timer that interrupts must also check that `liveBlock(id).seq` is still its own block's seq.

To test this with a fake manager, let the fake's `runCommand` emit both the running and the done
event before it resolves. That case was found in plan refine cycle 3 for issue #574.
