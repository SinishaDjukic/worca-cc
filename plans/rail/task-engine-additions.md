# Task engine additions (Stillhet slice 5)

The three engine additions the Tasks slice builds, as approved with the slice plan at its plan gate. The design names each one in an open spec:
`plans/rail/review.md:171` (Pause after this step, Raise the cap), `plans/rail/review-agreed.md:8` (Restart Build as the failed run's step) and `plans/rail/review-2.md:77` (Raise the cap).

Their new state is exactly: `pipelines.cost_cap_usd` (Raise the cap), the round kind `by: 'restart'` (Restart Build) and the in-memory harness flag `pauseAfterStep` (Pause after this step). Nothing else.

If the owner strikes one, its action keeps dev's nearest path (Pause, Continue without cap, Start a new task) and its wiring row reads "removed by the owner".

## Raise the cap: dev's resume with a cap

- **Route.** `POST /api/resume` gains `costCapUsd` (USD, a number above 0).
- **Refusals.** New 400s, checked right after `pipelineId`: a non-number or non-positive value; `costCapUsd` with `ignoreCostCap`; a cap at or below the run's spend ("The new cap must be above what this task has spent ($N)."). The total-budget 403 and every later gate (double resume, worktree missing, base check, the team total and team pipeline gates, engine refusal) are unchanged and run first.
- **The gate.** The pipeline-cap gate compares the spend with `costCapUsd ?? the stored run cap ?? the settings cap`, so a later plain resume of a raised run is held to its stored cap.
- **State.** `pipelines.cost_cap_usd` (REAL, nullable, schema v90 through `INCREMENTAL_COLUMNS`) is written, and `cost_cap_override` cleared, only after every gate, right after the fresh row re-read and before the run is registered.
- **The harness** reads the stored cap once at construction and uses it as the local pipeline cap (still folded with the team cap). Fix checks rounds do not inherit it; a Restart Build run does.
- **Read.** `GET /api/history/:key/:id` adds `state.costCapUsd` (null when unset).
- **Rollback.** A reverted v89 build ignores the column: a raised cap reads as the settings cap again.

## Restart Build on a stopped or errored run

- **Route.** `POST /api/runs/:id/restart-build` (the id is the pipeline id). It answers `{runId, pipelineId}`.
- **What it starts.** A new run through `invokeStartRun`: workflow `wf_pr_fix` (no planner; the brief feeds both plan ports), the saved plan artifact as the brief, `featureBranch` the run's kept branch, `sourceBranch` its source, `syncBeforeStart: false`, tags, labels and `cost_cap_usd` inherited, and `roundOf: {pipelineId, round: nextRound(origin), by: 'restart'}`, so it folds under its origin as a round.
- **Refusals.** 404 unknown or archived; `NOT_STOPPED` 409 unless the status is `stopped` or `error` (paused runs use resume); `NO_PLAN` 409 "This task has no saved plan to build from."; `NO_BRANCH` 409 when the branch is gone; then every refusal of the run start, unchanged.
- **Rollback.** Restart rounds stay as ordinary runs.

## Pause after this step

- **Route.** `POST /api/pause` gains `afterStep: true`. Refusals are dev's pause refusals, plus `ALREADY_PAUSING` 409.
- **Behaviour.** It sets the harness flag `pauseAfterStep` without aborting anything. A node that would start while the flag is set waits; once no execution is in flight (the last running sibling finishes `done`), dev's `pause(by)` runs once and the waiting nodes stay non-terminal in the resume point, as dev's pause leaves them. A fan-out's running siblings always finish and are never aborted. If the run ends with nothing left to start, the flag is dropped.
- **Lifetime.** In memory only, never persisted; cleared by the conversion to a pause, by resume, stop, error and finish. A server restart interrupts the run as in dev and the flag is gone.
- **Read.** The state frame carries `pauseAfterStep`, read as the "Pausing after this step" word; Pause (now) stays offered.
- **Rollback.** Nothing is stored.
