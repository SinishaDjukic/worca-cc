---
name: ask-run-card-and-chain-facts
description: Read before linking Ask cards to runs or run chains (tickets with `after`), or storing per-chat data on ask_threads (context, names, updated_at, columns).
paths: ui/server.mjs, src/core/scheduler.mjs, src/core/ask/*.mjs, src/core/db.mjs
updated: 2026-11-04T20:49:14.593Z
author: Bulibas
---

Run chains (`src/core/scheduler.mjs`):
- Since #1096 `runChains` (Runs-list groups, the ship flow) links a ticket to its predecessor ONLY when
  `source_from_previous` is set; a timing-only `after` (resume tickets included) roots its own chain and its root
  member carries `waitsFor: {title}`. A test fixture that wants a chain must pass `sourceFromPrevious: true`.
- A ticket's `after` is ONE `{kind:'ticket'|'pipeline', id}`. `parseScheduleRequest` in `ui/server.mjs` rejects an array. A step that waits on several predecessors (a join) needs new schema.
- `resolveAfterRef` refuses a predecessor on a different target (project vs workspace, or another project), a series ticket and a cycle.
- A predecessor that ends badly makes the dependent ticket `missed` (not `skipped`), via `missAfter`. That cascades one link per tick (30 s). A predecessor TICKET that is canceled/missed/failed/skipped counts as bad even under `afterPolicy: 'any'`. A paused run counts as still going.
- A missed ticket cannot be moved (`updateTicket` refuses). It can still be forced with Run now.
- No endpoint creates several tickets at once, and `createTicket` has no transaction around it.
- `schedulerTick` calls `releaseAskCard` for a missed/failed ticket, which flips the owning run card back to `proposed`.

Ask run cards:
- A run card is accepted through `POST /api/run` with `askThreadId`/`askCardId`, not through the cards route. "Not now" sets state `dismissed` (there is no `declined`), and it starts no event turn.
- `updateCardBlock` (`src/core/ask/store.mjs`) keeps only the keys in `CARD_PATCH_KEYS` (state, runId, error, workflowId, scheduledFor, scheduleId, sentence, after). A run card's `card` is never patched, and tests pin its key set. Per-step state needs a new patch key or a new card type.
- A started run card renders as the live progress card, fed by `ask-run-status` frames and the run store, not by the block contents.

Chaining several runs from one click (verified while planning run plans, 2026-10-07):
- A run started directly by `POST /api/run` cannot be an `after` target right away. Its runs-Map UUID is neither a ticket id nor a `pipelines` row id until the orchestrator creates the row, so `afterRefOf` finds nothing. Create every step as a ticket instead (a ticket's id IS the fired run's id), and start the roots with `requestRunNow` + `schedulerTick()`.
- A ticket whose stored request carries `askThreadId`/`askCardId` 409s at fire time unless that card is `scheduled` with `block.runId === ticket.id`. Only one ticket per card can pass, so extra tickets for one card must carry their link elsewhere (server-only `request.internal`, read back as `stored`).

Per-chat data on `ask_threads` (`src/core/ask/store.mjs`):
- `ask_threads.context` is only the LAST turn's validated, pin-merged client context. `startAskTurn` overwrites it every turn, and so does the PATCH scope branch (`askApplyPin` / `askValidateScope`); event turns replay it. Never use it for history or origin.
- MCP-child readers depend on its flat shape: `pinnedScope()` (`tool-deps.mjs`), `contextProjectKey()` (`memory-deps.mjs`), `schedule-deps.mjs` (`timeZone`). Keep new per-chat data in its own column.
- `context` holds ids only. Names (`project.name`, `workspace.name`, `run.title`) are resolved per turn in `resolveAskContext`, AFTER the `askUpdateThread(context)` write, and never persisted; to persist names, write after `resolveAskContext`.
- Every `updateThread` call bumps `updated_at`, which reorders the History popover. Cosmetic writes use a dedicated UPDATE, as `addThreadTotals` does.
- A new `ask_*` column goes into `INCREMENTAL_COLUMNS` with a `repairSchemaGaps` step; never ALTER `ASK_DDL`. `test/ask-store.test.mjs` (~39) pins the exact thread key set, so a new `rowToThread` field is added there.
- `JSON_PATCH_KEYS` is a `Set`, and `updateThread` binds with `.has(k) ? str(...)`. A `JSON_PATCH_KEYS[k]` lookup is always falsy, so it binds objects raw and node:sqlite throws.
