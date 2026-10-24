---
name: harness-ask-answer-traps
description: Read before adding any automatic/unattended answer path to RunHarness._ask/answer, or a new per-run flag that must survive pause/resume.
paths: src/core/run-harness.mjs, src/core/orchestrator.mjs, ui/server.mjs
updated: 2026-09-27T21:42:21.908Z
author: Bulibas
---

- The `--yes` branch inside `RunHarness._ask` returns its answer directly and never installs `pendingQuestion` or calls `answer()`. So auto answers get no `answeredBy`, no actor row in `pipeline_events`, and never appear in get_run `actions`. Any answer that must be attributed has to go through `answer(id, payload, by)`.
- `_ask` emits `question` BEFORE it installs `pendingQuestion`. That happens inside the Promise executor. Anything reacting to the event, or a timer armed from it, must defer at least one tick (setImmediate or setTimeout).
- The web server clears `entry.pendingQuestion` ONLY through `resolvePending` (a `question-resolved` broadcast). `answerRun` calls it after a human answer. If the harness answers itself, it must emit an event that the server's `wireRun` maps to `resolvePending`; otherwise every tab keeps a stale question card.
- The UI resume (`ui/server.mjs` resume path) passes only `resume: saved`. It passes neither `auto` nor any start flag, and the orchestrator's resume point does not store `auto`. A per-run flag has to be written into the resume point (`orchestrator.mjs` pause point builder) and read back in the harness constructor, or it is lost on the first pause.
- `pendingQuestion` is never persisted. After a resume the question is re-asked (for a gate, the hold survives in the scheduler snapshot). Counters that must survive a pause, such as decisions made or extra cycles granted, belong in the DB and not in harness memory.
- `_pauseFor(reason, …)` returns `true` even when the pause it asks for is REFUSED: it returns `false` only for an already-requested pause, a stop or an abort. On an `idle` (or any non-`running`) run it records `pauseReason`, calls `pause()` — which refuses — and still returns `true`. A caller that needs "did the run actually pause" must check `state.status === 'running'` first (night mode's guardrail does). Likewise `pause()` itself is a no-op unless `running`, so a unit test of a pause path sets `orch.state.status = 'running'`.
- A promise rejected during a fake-clock `tick()` with no handler yet attached fails the node:test test as an unhandled rejection: create the `assert.rejects(p, …)` promise BEFORE the tick, await it after.
- Gate asks only happen once a loop wire has spent its allowance (`maxCycles`). The payload carries critical and major issues only; minor issues are filtered out.
- Async work that a harness TIMER starts on its own (an LLM call, a backoff sleep) has three recurring gaps, and reviews flag each one:
  - **Stop.** `stop()` aborts only `this.abort`, and `pause()` aborts only `this.pauseAbort`. Pass `AbortSignal.any([this.abort.signal, this.pauseAbort.signal])`, or a Stop leaves the child running and books its cost on a stopped run.
  - **User switches.** After every `await`, re-check the user's switches (override, toggle, eligibility), not just `pendingQuestion?.id`. Otherwise "off" does not cancel a decision that is already in flight.
  - **Errors in `--yes` runs.** In a `--yes` run, the `.catch` of the fire-and-forget promise must fall back to the auto answer, not just log. Otherwise the unattended run hangs.
- Counters that are ALSO written to `policy_state`, the run view or metrics must be seeded from the DB on resume, not only read from the DB for the guardrail. A counter that restarts at 0 in harness memory overwrites the stored total on the next write.
