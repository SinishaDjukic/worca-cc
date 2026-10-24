---
name: harness-timer-async-work
description: Rules for async work that RunHarness starts from a timer instead of a step (night decider, backoffs); read before adding any such work
paths: src/core/run-harness.mjs
updated: 2026-10-18T22:56:18.899Z
author: Bulibas
---

Async work that `RunHarness` starts from a timer callback, rather than from a step, has cost a review cycle four times. Apply all four rules:

1. **Abort on stop and on pause.** `stop()` aborts only `this.abort`. Pause aborts only `this.pauseAbort`. Pass `AbortSignal.any([this.abort.signal, this.pauseAbort.signal])`, as the orchestrator does. A bare `pauseAbort.signal` leaves a child process running after Stop, and its cost is booked on the stopped run.
2. **Check the switches again after every await.** Re-check that `pendingQuestion` is still the same question. Also resolve the config again, and check the per-run override and the global toggle again. The user can switch the feature off during a long await.
3. **A --yes run must never hang.** A rejection from the timer callback goes nowhere unless you catch it. In a `this.auto` run, catch it and fall back to the auto answer. If even the fallback answer fails, reject the ask.
4. **Seed counters from the DB on resume.** In-memory counters that feed `_persistPolicyState` restart at 0 in the constructor. Reload them from the DB when resume sets `this.pipeline`, or the first write after a resume overwrites the stored totals.

5. **A cancel is not a failure.** When rule 1's signal aborts the call (the user answered, Stop, pause), the catch
   still runs. Do not write a `warn` "… failed" line for the abort code: nothing failed. Keep the record's error
   status if you need it. Seen 2026-10-19 on the Clef pre-pass `_nightClef` (code `'aborted'`). Test it with a fetch
   stub that rejects only on `init.signal` abort, then answer the ask while the call is in flight.

A Settings form saved at the user level must send an empty field as `__unset`, not `null`. An explicit `null` stops the per-field fall-through to the team value.
