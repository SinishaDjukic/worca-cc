---
name: schema-version-merge-collision
description: When a PR merge conflicts in src/core/db.mjs because both sides claimed the same SCHEMA_VERSION rung — how to resolve and what to check.
paths: src/core/db.mjs, test/db-migrate-v*.test.mjs
updated: 2026-10-31T17:21:48.864Z
author: Bulibas
---

A PR and dev often both bump `SCHEMA_VERSION` to the same number (PR #982 vs dev #711, 2026-10-31: both v82).
The conflict shows only in `migrate()`'s rung list and in the `test/db-migrate-vN.test.mjs` both sides created.

Resolution that worked: dev keeps vN (its rung, its test file byte-identical to dev's). The PR moves to vN+1:
bump `SCHEMA_VERSION`, rename its rung comment, `INCREMENTAL_COLUMNS` comment and pin comments, and move its test
to `test/db-migrate-v<N+1>.test.mjs` stamping the DB at N (not N-1) and asserting `SCHEMA_VERSION >= N+1`.

Check both upgrade paths:
- A dev DB stamped N lacks the PR's column/table: it must be in `INCREMENTAL_COLUMNS` / `INCREMENTAL_TABLES`
  (added by the hoisted `repairSchemaGaps`), or the PR needs a real `if (current < N+1)` rung.
- A DB from the PR's own earlier build is ALSO stamped N but lacks dev's tables, so dev's `if (current < N)` rung is
  skipped. Safe only if dev's tables are in `INCREMENTAL_TABLES`; otherwise this is a blocking defect.
- `git diff <base> HEAD | grep -nE '^\+.*\bvN\b'` for any leftover vN reference to the PR's change.
