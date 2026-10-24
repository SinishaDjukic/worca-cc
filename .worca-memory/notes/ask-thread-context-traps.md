---
name: ask-thread-context-traps
description: Read before storing or reading per-chat context on ask_threads (context column, scope pin, resolved names, updated_at ordering).
paths: src/core/ask/store.mjs, ui/server.mjs, src/core/db.mjs, ui/public/ask-panel.mjs
updated: 2026-09-27T20:14:32.620Z
author: Bulibas
---

- `ask_threads.context` is only the LAST turn's validated, pin-merged client context. `startAskTurn` overwrites it on every turn, and so does the PATCH scope branch (`askApplyPin` / `askValidateScope`). Event turns replay it. Never use it to hold history or origin.
- MCP-child readers depend on `context` keeping its flat shape: `pinnedScope()` in `tool-deps.mjs`, `contextProjectKey()` in `memory-deps.mjs`, and `schedule-deps.mjs` (`timeZone`). Keep any new per-chat data in its own column.
- `context` holds ids only. Names (`project.name`, `workspace.name`, `run.title`) are resolved per turn in `resolveAskContext`, which runs AFTER the `askUpdateThread(context)` write, and are never persisted. To persist names, write after `resolveAskContext`.
- Every `updateThread` call bumps `updated_at`, which reorders the History popover. For cosmetic writes, use a dedicated UPDATE, the way `addThreadTotals` does.
- A new `ask_*` column goes into `INCREMENTAL_COLUMNS` with a `repairSchemaGaps` step. Never ALTER `ASK_DDL`. `test/ask-store.test.mjs` (about line 39) pins the exact thread key set, so any new `rowToThread` field must be added there.
- `.ask-chip` / `renderChips()` in `ask-panel.mjs` already belong to the composer's attachment chips. Pick another class prefix for new chips.
