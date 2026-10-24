---
name: new-pipeline-form-and-start-refusals
description: Read before placing a control "next to the model picker" on New pipeline, or before surfacing a run-start refusal in the form (ui/public, ui/server.mjs /api/run
paths: ui/public/index.html, ui/public/app.js, ui/server.mjs
updated: 2026-10-02T15:46:33.256Z
author: Bulibas
---

**There is no run-level model picker on New pipeline.** Model and effort are per agent row,
built by `renderAgentRows` in `ui/public/app.js`, inside `<details id="advanced-config"
data-min-level="advanced">`, and saved on change with `PATCH /api/config`. The start body
(`POST /api/run`) carries no `model` for a normal workflow; the server reads `body.model` only
for the memory-defragment workflow (`checkStartPair`). A request to put something "next to the
model picker in the main form" therefore has no literal target; the main-form spot is beside
the Workflow field.

**A refusal raised inside `run()` never reaches the form as an HTTP error.** `startRunHandler`
answers `200 { runId }` and only then starts `orch.run()` fire-and-forget; anything `run()`
throws before `createPipeline` (engine gate, broker preflight, topology) arrives as the run's
`error` event. To show a refusal inline on the form, check it on the server before
`runs.set` / `wireRun` / `announceRun` and answer 4xx with a `code` (the ask-card 409 is the
precedent for withdrawing before anything is announced). The form then handles it as a resend
branch next to `needsPolicyAck` / `sync-diverged` in the submit handler.
