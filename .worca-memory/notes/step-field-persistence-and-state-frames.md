---
name: step-field-persistence-and-state-frames
description: Read before adding a field to a run step (state.steps[]) or emitting `state` more often from RunHarness.
paths: src/core/run-harness.mjs, src/core/orchestrator.mjs, src/core/artifacts.mjs
updated: 2026-10-29T09:22:14.083Z
author: Bulibas
---

**A new step field is in-memory only unless whitelisted.** `writeState` (`src/core/artifacts.mjs`, the
`pipeline_steps` insert) writes fixed columns plus an `exec_meta` object built from an explicit list
(`taskId` … `auxCosts`, `stoppedTurns`, `sessionCosts`). Any other field on a step still rides every live
`state` frame (`getState()` deep-copies `this.state`), but History, resume and the smoke DB diff never see
it. Display-only data (a live estimate) wants exactly that; a fact that must survive a pause or reload
needs a `hasMeta` term AND a spread in that list, plus the reader at `rowToState` (`em.<field>`).

**Every `state` emit is a full snapshot the UI server buffers.** `wireRun` pushes each event into the
run's ring (`bufferEvent`, `MAX_BUFFER = 5000`, `ui/server.mjs`) and broadcasts it whole, and app.js
replaces `r.steps` from it. Never emit per stream frame: arm one unref'd timer and emit only when a value
the UI shows changed. Pricing helpers are not free either: `liveCostRates` -> `modelCostConfig` re-reads
settings.json on every call, so price at flush time, not in `_noteOpenTurn`.

**Normalized vs legacy events in unit tests.** `isNormalized(e)` is false for any event with a `raw`
key (except `hook`), so `{ type: 'result', raw: {...} }` goes through the Claude normalizer: its cost comes
from `raw.total_cost_usd`, and an absent one gives `costUsd: undefined` (NaN at `_sessionCostDelta`,
nothing booked, no `_recordCost` state frame).
