---
name: server-mock-run-tests
description: Read before writing a server/API test that starts a real mock run (POST /api/run, WORCA_MOCK=1), pauses/resumes it, turns Away mode on, or counts git fetches du
paths: test/*api*.test.mjs, test/run-harness-*.test.mjs, src/core/run-harness.mjs
updated: 2026-10-08T07:19:58.661Z
author: Bulibas
---

**A mock run started through the server never ends by itself.** `POST /api/run` (or an in-process
`startRunHandler` call) without `auto: true` runs `wf_default`, and the mock planner asks one clarify
question. The run then waits for an answer forever. Awaiting `runs.get(runId).launch` hangs until the
5-minute test timeout, and the failure only says the test was cancelled.

What to do instead:
- Poll for the state you need, for example the new row's branch record gets a `worktreeDir` once setup ran.
- Then call `stopAndSettle(mod.runs, (e) => e === entry)` (test/helpers/stop-and-settle.mjs). It stops
  the run and awaits its `launch`, so the harness's teardown and post-run steps have finished afterwards.
- To debug a hang, print `entry.status`, `entry.pendingQuestion` and the last `entry.events`.

**Driving pause / resume / Away / --yes over a mock server run** (verified 2026-10-08, ask-api-plan-cards):
- Pause is `POST /api/pause {runId}` (there is no `/api/runs/:id/pause`); a run parked at its clarify question
  pauses fine. Resume is `POST /api/resume {pipelineId}` (the 8-hex id, `runs.get(id).pipelineId`), and it answers
  a NEW runId; ask links move to it.
- `/api/resume` refuses `stopped`/`error` rows. To test "resumed from History after a bad end", pause, then
  `UPDATE pipelines SET status='interrupted'` (bad for the chain, still resumable). Forging `error` gets
  rewritten by `settleStaleParkedEntries` on the next scheduler tick.
- A cost-cap pause can be faked with `orch.emit('done', {status:'paused', reason:'cost_pipeline'})`; its row stays
  `running`, so clean up with `orch.stop()`, not `/api/stop`.
- Away mode: `POST /api/settings {nightMode:{strategy:'weights'}, nightModeToggle:'on'}` (needs temp HOME; reset
  with `{nightMode:null, nightModeToggle:'auto'}`). There is no `answersAfterMin` setting.
- `humanInLoop:false` does nothing on `wf_default`. An inline-answering (`--yes`) run comes from a ticket whose
  `request.internal.auto` is true.

**A test server has no scheduler timer, and a test can inherit the previous test's tick.** Importing
`ui/server.mjs` never calls `startScheduler`, so tickets fire only on explicit `schedulerTick()` calls. When a
chained run ends, the chain nudge (`setTimeout(schedulerTick, 0)`) starts its dependent, and under load that
tick is still running when the next test begins. Until 2026-10-08 a `schedulerTick()` called during a running
pass returned `null` at once, so a ticket forced then (`requestRunNow` + `await schedulerTick()`) stayed
`scheduled` forever and the test timed out ONLY in the full suite (ask-api-plan-cards D16). Since then a busy call
awaits one shared follow-up pass (pinned in test/api-schedules.test.mjs "a tick asked for while one is running").
Do not reintroduce a skip-when-busy guard. Still end every test only after the runs it chained are terminal (keep
the answer pump going until then), and check a new server test by running 3–4 copies of its file at once.

**Harness fetch counts include the post-run base check (#620).** After teardown, the harness runs
`afterRunBaseCheck`, which fetches the base once per kept branch. A test that pins "the Sync stage
fetched N times" must read the count when the run emits `done`, which happens before teardown. See
`fetchesUntilDone` in test/run-harness-sync.test.mjs.
