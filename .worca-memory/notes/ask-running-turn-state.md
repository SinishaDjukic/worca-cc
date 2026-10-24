---
name: ask-running-turn-state
description: Read before touching a running Ask/composer chat turn, the chat panel's client state or the Ask run card's agent lane — frames, reload, disk work, lane rows
paths: src/core/ask/**, src/core/claude-runner.mjs, src/broker/tokens.mjs, ui/server.mjs, ui/public/ask-model.mjs, ui/public/ask-panel.mjs, ui/public/node-tunables.mjs, ui/public/workflows/*.mjs, test/ask-*.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Tools, prompt, MCP child: [[ask-script-tools-traps]]. What lane overlays mean at run time: [[run-model-resolution-traps]].

## What the browser sees of a running turn
- Most stream events never become a frame (`events.mjs`: system events, `message_start`, thinking/`input_json` deltas, sub-agent deltas, text-only assistant messages, sub-agent tool rows past `agentLogMaxLines`): stamp activity in `AskTurn` (`_noteActivity`, stderr excluded) and send a seq-less `ask-activity` via `onOutOfTurn`, throttled by `ASK_LIMITS.activityFrameMs`.
- Reload restores only through `GET /api/ask/threads/:id` → `inFlight` (`{messageId, startedAt, lastEventAt}`), never top level (`ask-api-threads`/`ask-api-worktrees` deepEqual the keys); before `job.turn` exists use `job.startedAt`; `startElapsed(Date.parse(inFlight.startedAt))`.
- A notice never streams live (no `id`): pin it from the DB row. A new seq-less frame type needs its own `case` in `ask-model.mjs` `applyOutOfTurn`.
- `ask-start` REPLACES `inFlight` (merge same-messageId stamps). Stop shows on `model.live()`, not `inFlight()`. `.ask-activity` = head (a button only when its body can open) over body (`st.expandedActivity`).

## Hidden time bound: the broker token
`SPAWN_TTL_SEC.ask` (`claude-runner.mjs`) and the broker clamp `KIND_TTL_MS.ask` (`src/broker/tokens.mjs`) change together (both 24 h, pinned in `broker-units` and `claude-runner-broker` tests; an older broker keeps its own). Past expiry: 403 `token expired or revoked`, the turn ends as an `auth` error.

## Disk work under `<home>/ask/<thread>/`
- Thread delete does not wait: a turn parked on an await resumes after the `rmSync` and `mkdirSync(recursive)` resurrects the folder. Re-check `this.abort.signal.aborted` with NO await before `materializeSkillMount`; remove empty parents with sync `rmdirSync`; re-check `askDeleting.has(id) || !askGetThread(id)` right before `createAskTurn`. Pin a stop landing INSIDE the sweep (patch `fs.promises.rm` + `syncBuiltinESMExports()`).
- Thread ids are the only guard of the sweep's parent (`threadId: '..'` = `<home>/skills`): pin it.
- Hosted: `ask/` is setgid 2770 group-writable with no sticky bit, so a recursive rm there is a cross-user delete (a planted link emptied `worca-cc.db`). `lstat` each folder you own, sweep only expected shapes (`askm_<8 hex>`); a final-component link only unlinks. Test with `symlinkSync(target, path, win32 ? 'junction' : 'dir')`. Same class for run roots: [[run-worktree-hold-traps]].
- Boot sweeps race live turns (`bootMaintenance()` runs un-awaited before `listen`): sweep orphans per thread at the next turn's start; `settleJob` starts the next turn before the previous `finally` — touch shared parents with sync calls only.

## Prompt and retry
- A folder the model must Read needs an exception in BOTH `ASK_SYSTEM_RULES` rule 7 and `spawn.mjs` `NOTE_HEAD` (an allow rule does not make it read).
- `_attempts` keeps the reducer unless `attempt === 2`: a `continue` with `attempt -= 1` books the failed spawn's cost — fresh reducer, re-add the turn's notices.

## Panel client state (`ask-panel.mjs`)
- Tool inputs persist as `clipJson(input, 2048)`: stamp identity at tool_use (`block.script = {key}`). Row = `.ask-tool-dot` + `.ask-tool-target` (`.ask-tool-name` + `.ask-tool-args`) + `.ask-tool-note`; every row has `dataset.minLevel = 'advanced'` (an old whole-function `toolRow` fence drops it). Level hiding is CSS only: JS opening gated rows uses `levelShows` and repaints on `worca:level`; pin with `applyLevel('simple', ctx.doc)`.
- Model picker: `applyCatalogToPicker()` re-decides when `/api/ask/models` lands: `pickerFromThread` > `pickerFromStore`/`effortFromStore` > default; only an explicit pick writes `worca-cc.ask.model`; applies on a thread SWITCH only (re-applying in `resync()`/`onHello()` reverts an unlanded PATCH). One pin per guard in `ask-panel-pickers`.
- Per-chat `st.mcp`: send it with EVERY message (the thread exists before the POST); the route stores it, so re-PATCH after the 202 if it changed; one PATCH at a time. A `render()` refocusing by a `dataset` key jumps to `items[0]` from keyless items: key every focusable item.
- `listAttachments` sorts `created_at, id` (random ids): pin order-free; the 202's `attachments` keep request order.
- Every thread-holding surface handles seq-less `ask-history-cleared` (no `threadId`; shared deployments carry `threadIds`); app.js fans `ask-*` frames to `askPanel` AND `wfvChat`.

## Run card agent lane (`node-tunables.mjs` `buildNodeConfigRows`)
- `row.def` is layers 2-4 only (template config, engine slot, sidecar), not the project default: "differs from the project" compares `row.<k>`; "from the workflow default" = `modifiedFieldsOf(row, row.def)`.
- `laneSet` drops an edit equal to `row[k]`: anything keyed on `lane.edits[id]` (reset, "changed", pending) misses it, yet on a workspace lane such a pick still rides the overlay — give it its own state. `reloadLane()` rebuilds with `edits:{}` on any workflow/engine/project/target change (re-apply seeds in its `.then`); the workspace `<select>` does NOT reload the lane.
- The lane is Expert-only (`data-min-level="expert"`): a value applied at Start sets `data-level-keep`; `renderLane(null)` keeps it, so a failed load without picks DELETES it and one with picks shows what Start will send.
- Start and Open in New run share every guard (`local.lanePending`, "nothing loaded = nothing to save", the Save switch). Every "what the card sends" filter has two arms — `laneOverlay(lane)` and its error fallback, which mirrors the pair rule (only edits with `model` or `effort` carry a model).
- `card.warnings` are TEXT (`deviationsFor`, `premiumPick`) and go stale when picks move; the lane shows one only if it names a running model id as a bare space-separated WORD (`holds`) — pin from the REAL builder (`PROPOSAL_ERRORS`), not a copied literal. Mutating `applyProposal`: skipping `healForEngine` alone survives; mutate both.
- Workspace card rows come from `/api/config` without `projectDir` (built-ins) while runs merge over `members[0]`'s project layer: send workspace picks outright.
- Two chat run cards: Chat page `chat/run-card.mjs` (`mountRunGraph` `card`, raw ids) vs Ask sheet `ask-run-card.mjs` (`mountStaticGraph`): attribute a label change to the card that drew it.
- UI copy says "New run" everywhere: `ui-new-run-copy` scans `ui/public/*.mjs` and `src/core/ask/*.mjs` for "New pipeline".

## Tests
- `ask-panel-card` harness: its `GET /api/config` ignores `projectDir` and serves no legacy `steps` — copy `apiHandler` for per-project cases; `laneFail` fails every lane; drive selects with a bubbling `change`; a lane reload settles in ~4 ticks, Start in 8-12.
- `ask-turn` `makeTurn` returns `activity` apart from `outOfTurn`; `ask-panel-live-meters` boots `openLoaded(body, {now})`, `ctx.panel.onHello([])` = same-thread resync.
- AskTurn on the REAL runner: `WORCA_CLAUDE_BIN=<abs stub>` (read at import), `env -u WORCA_MOCK -u WORCA_HOST_PID`, sandbox `HOME`/`WORCA_HOME`/`TMPDIR`, inject `memoryMount: async () => null`, `resolveModelEnv: () => ({})`, `generateTitle`, `failedBecauseSignedOut`.
