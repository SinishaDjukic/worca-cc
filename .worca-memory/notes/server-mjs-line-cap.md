---
name: server-mjs-line-cap
description: ui/server.mjs has a hard line cap; any plan that adds lines to it turns two unrelated tests red only in the full suite
paths: ui/server.mjs
updated: 2026-11-27T06:59:15.157Z
author: Denislav Prinov
---

`ui/server.mjs` may not grow past the cap in `tools/split-by-feature/size-caps.json` (10922 lines at checkpoint
8263a56f9, 2026-11-26; the file sat 14 lines under it). A plan's server edits that stay green in every scoped test
then fail two tests only in the full suite:
- `test/shape-server-slices.test.mjs` "C3: ui/server.mjs stays within its size cap" (`10936 > 10922`)
- `test/split-by-feature-plan.test.mjs` "the real tree is fully covered…" ("over its ceiling")

How to apply: before adding server code, compare `wc -l ui/server.mjs` with the cap. Write new logic in a module
under `ui/routes/` or `src/core/`, or keep the server diff line-neutral (shorter comments, no new braces). Never raise
the cap to fit a feature.

A related trap: a probe orchestrator built "on every start" (`createOrchestratorFor` in `startRunHandler`'s schedule
branch) must pass every option the constructor validates. A scheduled Memory defragment without `memoryScope` throws
inside the handler and answers 500 (`test/api-run-tags`, `test/api-memory-defrag-model`).

On this Mac, these 7 tests also fail on a clean `git archive` copy of 8263a56f9 (the `/private/tmp` vs `/tmp` realpath
mismatch plus the Shaper golden keys). They are not regressions: `api-workflow-test-round2` (×2),
`api-workflow-test-project-try`, `workflow-test-project-copy`, `workflow-test-project-key` and
`shape-classic-walk-golden` (×2).
