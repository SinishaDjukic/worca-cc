---
name: run-liveness-key-by-pipeline
description: When code tracks a run it started and later checks whether that run is still live; resumes mint a new runs-map id
paths: ui/server.mjs, src/core/pr-watch.mjs
updated: 2026-10-08T07:13:34.148Z
author: Bulibas
---

**The live `runs` map key is not stable for the life of a pipeline.** `startRunHandler` keys the entry by
its runId. Every resume (a manual Resume, the auto-resume after a server drain or restart, or a resume after a
cost-limit pause) creates a NEW entry under a fresh `randomUUID()` (see the resume path in `ui/server.mjs`).
Code that remembers the start-time runId and later calls `runs.get(runId)` loses track of the run after the
first pause. If it then reads the durable row (`status = 'running'`, but no live entry), it wrongly decides
the run was interrupted. Review of #619 found this in the PR-watch `observeFix`, and the unit test asserted
the wrong behaviour.

Rule: once a pipeline id exists, check liveness by pipeline. Find the live entry whose
`pipelineId === <id>` (any runId) and check `isFinishingRun(<id>)`. Use the start-time runId only for the
window before the pipeline row exists. Do not treat durable `running` with no live entry as a final state.
Wait, or apply a grace timeout. When you test such a watcher, cover a resume that has a different runId.
