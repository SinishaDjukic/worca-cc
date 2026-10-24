---
name: ask-run-card-and-chain-facts
description: Read before designing anything that links Ask cards to runs or run chains (tickets with `after`) — non-obvious limits verified 2026-10-07
paths: ui/server.mjs, src/core/scheduler.mjs, src/core/ask/*.mjs, src/core/ask/store.mjs
updated: 2026-10-07T18:22:20.001Z
author: Bulibas
---

Run chains (`src/core/scheduler.mjs`):
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
- `pendingQuestion` is held in server memory only. In classic mode the Ask MCP child cannot see it, and `get_away_mode` returns `unknown` for a live run there.

Chaining several runs from one click (verified while planning run plans):
- A run started directly by `POST /api/run` cannot be an `after` target right away. Its runs-Map UUID is neither a ticket id nor a `pipelines` row id until the orchestrator creates the row, so `afterRefOf` finds nothing. Create every step as a ticket instead (a ticket's id IS the fired run's id), and start the roots with `requestRunNow` + `schedulerTick()`.
- A ticket whose stored request carries `askThreadId`/`askCardId` 409s at fire time unless that card is `scheduled` with `block.runId === ticket.id`. Only one ticket per card can pass, so extra tickets for one card must carry their link elsewhere (server-only `request.internal`, read back as `stored`).
- Away mode arms itself (`_nightArm`) synchronously AFTER the harness emits `question`. A listener that reads `orch.state.night` inside the `question` handler sees nothing; read it one `setImmediate` later.
