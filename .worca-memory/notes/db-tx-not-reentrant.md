---
name: db-tx-not-reentrant
description: Read before writing a DB helper that must commit atomically with pipeline creation (writeState) or another tx() caller.
paths: src/core/db.mjs, src/core/artifacts.mjs
updated: 2026-10-08T07:05:35.866Z
author: Bulibas
---

`tx(fn)` in `src/core/db.mjs` is NOT reentrant: a `tx()` inside another `tx()` throws
"a transaction is already active (nested tx is not supported)". `writeState` (artifacts.mjs) already runs
its pipeline upsert inside `tx()`, and `createPipeline` creates the row through `writeState`.

So a helper that must land in the SAME transaction as pipeline creation (e.g. Watch PR's
`attachWatchPipeline(runId, pipelineId)`, #619) must be a plain function that uses `getDb()` directly and
throws on failure (the outer tx rolls the pipeline row back). Give it no `tx()` of its own; a test that
wants to call it alone wraps it: `tx(() => attachWatchPipeline(...))`.

Same family of surprise: `redactSecrets` (src/core/redact.mjs) only removes broker `wbt_…` tokens, not
GitHub `ghp_…` tokens or other secrets. Use a `wbt_` token in a redaction test, or `createRedactor(values)`
for known secret values.
