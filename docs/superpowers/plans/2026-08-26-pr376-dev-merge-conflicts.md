# Plan — Resolve PR #376 ↔ `dev` merge conflicts

**Date:** 2026-08-26
**PR:** [#376 — Ask Worca](https://github.com/SinishaDjukic/worca-cc/pull/376)
**Head:** `worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb` → **Base:** `dev`
**Status on GitHub:** `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`

---

## 1. Situation

| Fact | Value |
|---|---|
| Merge base | `79dc9256` |
| `origin/dev` tip | `d4a8181c` (18 commits ahead of base) |
| PR head (remote) | `b73bf83f` |
| Local branch tip | `5ef76b90` — **2 commits behind the remote PR head** |
| Conflicted files | 15 (`src/core/db.mjs` + 14 migration tests) |
| Files changed by both sides | 22 |

What landed on `dev` since the base:

- **#350 — per-profile task-source config and project/workspace bindings** (the big one: `source_bindings` table, schema **v18**, `plugin-config.mjs` profile parameter, profile roster UI/API)
- #381 — classify `"Request timed out"` as a recoverable network error
- #374/#375 — honor `ANTHROPIC_MODEL` in a model entry's env as the wire model id
- #378/#379 — architecture docs + README hero image

> **Local working tree carries untracked `PR_DESCRIPTION.md`, `docs/superpowers/`, `marketing/`, `worca-showcase.html`.** Leave them untracked — plans and specs are never committed in this repo.

---

## 2. Root cause

Both branches minted **schema version 18** on the same `migrate()` ladder, and `dev` additionally *refactored the gap-repair machinery that this PR extended*.

**`dev` side**

- `SCHEMA_VERSION` 17 → **18**, where v18 = `SOURCE_BINDINGS_DDL`.
- `SCHEMA_VERSION` is now **exported** so migration tests assert "reached the module's current version" instead of hardcoding a number.
- Replaced the per-table boolean gap flags (`stepQuestionsTable`, `guardrailSetsTable`, …) with a generic `INCREMENTAL_TABLES` name → DDL map; `schemaGaps()` now returns `{ columns, tables }`.
- Mechanically swapped the version literal for the imported `SCHEMA_VERSION` in 14 migration tests (commit `87334ef4`).

**PR side**

- `SCHEMA_VERSION` 17 → **21**: v18 `ASK_DDL`, v19 `applySchemaV19` (`ask_cost_ledger` + backfill), v20 `ASK_WORKTREES_DDL`, v21 `applySchemaV21` (diff-comment tables + `ask_run_links.comment_ids`).
- Kept the boolean flag shape and **added** two things `dev`'s refactor has no slot for:
  - `askAttachmentsIndex` — an **index**, not a table (`idx_ask_attachments_thread`), probed so an existing stamped DB heals without a version bump.
  - a **load-bearing reordering** of `repairSchemaGaps`: CREATE tables first, then `missingColumns(db)` **re-probed against the post-CREATE schema** — because `ask_run_links.comment_ids` is an `INCREMENTAL_COLUMNS` entry whose host table is itself created by a gap-repair DDL in the same pass.
- Mechanically bumped the same 14 test files' literals 17 → 21.

So the 14 test conflicts are two mechanical rewrites of the same lines, and `db.mjs` is a genuine 6-hunk semantic merge.

---

## 3. Strategy

**Merge `origin/dev` into the PR branch. Do not rebase.** A rebase replays 30+ commits, each through a schema renumber — every ask/diff commit would conflict in turn. One merge commit, one resolution.

**Version arithmetic:** `dev` already shipped 18, so it keeps it. The PR's four ladder steps shift up by one.

| Step | Before (PR) | After (merged) |
|---|---|---|
| `SOURCE_BINDINGS_DDL` | — (dev's 18) | **18** |
| `ASK_DDL` | 18 | **19** |
| `ask_cost_ledger` + backfill | 19 (`applySchemaV19`) | **20** (`applySchemaV20`) |
| `ASK_WORKTREES_DDL` | 20 | **21** |
| diff comments + `comment_ids` | 21 (`applySchemaV21`) | **22** (`applySchemaV22`) |
| `SCHEMA_VERSION` | 21 | **22** (exported, per `dev`) |

**Merge direction note:** merging `origin/dev` *into* the PR branch makes `--ours` = PR and `--theirs` = `dev`. Every `--theirs` below means "take `dev`'s file".

---

## 4. Tasks

### T0 — Sync (do this first; skipping it resolves against a stale tree)

```bash
git checkout worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb
git pull --ff-only origin worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb   # 5ef76b90 -> b73bf83f
git fetch origin dev
git log --oneline -1   # expect b73bf83f
```

Optional but recommended — do the resolution in a throwaway worktree first, then apply it for real:

```bash
git worktree add --detach /tmp/pr376-merge b73bf83f
```

### T1 — Start the merge

```bash
git merge origin/dev            # expect: 15 conflicts
git diff --name-only --diff-filter=U
```

### T2 — The 14 test conflicts: take `dev` wholesale

**Verified:** across all 14 files the PR's *only* change vs. the merge base was the `17 → 21` literal bump. `dev`'s imported-`SCHEMA_VERSION` form supersedes it, so taking `dev`'s file loses nothing.

```bash
git checkout --theirs -- \
  test/db-pause-schema.test.mjs \
  test/db.test.mjs \
  test/migrate-v10.test.mjs \
  test/migrate-v12.test.mjs \
  test/migrate-v13.test.mjs \
  test/migrate-v14.test.mjs \
  test/migrate-v15.test.mjs \
  test/migrate-v16.test.mjs \
  test/subagent-migration.test.mjs \
  test/subagent-migration-v3.test.mjs \
  test/subagent-migration-v6.test.mjs \
  test/subagent-migration-v7.test.mjs \
  test/subagent-migration-v8.test.mjs \
  test/upgrade-integration.test.mjs
git add <the same 14 paths>
```

Sanity check afterwards — no bare version literal should survive in them:

```bash
grep -n "user_version').get().user_version, 2\?[0-9]" test/migrate-v1*.test.mjs test/db*.test.mjs
```

### T3 — Resolve `src/core/db.mjs` (6 hunks)

Take **`dev`'s generic machinery** as the skeleton, then re-add the two things it cannot express (the index probe, the CREATE-before-ALTER order) and register the PR's tables in the map.

**Hunk 1 — `SCHEMA_VERSION` (~line 53).** Take `dev`'s exported form, value **22**:

```js
/** Latest schema version. Bump + append a new migration step when the DDL grows.
 *  Exported so migration tests assert "reached the module's current version"
 *  instead of hardcoding the number — a schema bump then touches no test file. */
export const SCHEMA_VERSION = 22;
```

**Hunk 2 — `INCREMENTAL_COLUMNS`.** Not conflicted, but confirm the merged file keeps the PR's extra entry (it is the only difference between the two sides' maps):

```js
  ask_run_links:          { comment_ids: 'TEXT' },        // v22: JSON array of dc_ ids pending at launch
```

**Hunk 3 — `INCREMENTAL_TABLES` + a new `INCREMENTAL_INDEXES`.** Keep `dev`'s doc comment; register every table the PR's gap flags covered. `ASK_DDL` and `DIFF_COMMENTS_DDL` each create several tables — list every one of them (this is strictly stronger than the PR's single-table probe: it heals a DB missing only `ask_run_links`) and de-duplicate at exec time.

```js
const INCREMENTAL_TABLES = {
  step_questions:    STEP_QUESTIONS_DDL,
  guardrail_sets:    GUARDRAIL_SETS_DDL,
  cost_ledger:       COST_LEDGER_DDL,
  model_cost_flags:  MODEL_COST_FLAGS_DDL,
  source_bindings:   SOURCE_BINDINGS_DDL,
  ask_threads:       ASK_DDL,
  ask_messages:      ASK_DDL,
  ask_attachments:   ASK_DDL,
  ask_run_links:     ASK_DDL,
  ask_cost_ledger:   ASK_COST_LEDGER_DDL,
  ask_worktrees:     ASK_WORKTREES_DDL,
  diff_comments:     DIFF_COMMENTS_DDL,
  ask_card_comments: DIFF_COMMENTS_DDL,
};

/**
 * Indexes added after their host table shipped, keyed by index name. Same hazard
 * as INCREMENTAL_TABLES, but a missing index cannot be inferred from a missing
 * table: idx_ask_attachments_thread was added to ASK_DDL after v19 shipped, so a
 * DB that already HAS ask_attachments never re-runs that DDL. Probed only when
 * the host table exists — otherwise INCREMENTAL_TABLES fires the DDL, which
 * carries the CREATE INDEX itself.
 */
const INCREMENTAL_INDEXES = {
  idx_ask_attachments_thread: {
    table: 'ask_attachments',
    ddl: 'CREATE INDEX IF NOT EXISTS idx_ask_attachments_thread ON ask_attachments (thread_id)',
  },
};
```

**Hunk 4 — `missingColumns` / `schemaGaps`.** Keep the PR's `missingColumns()` **split out** (T3's re-probe depends on it); `schemaGaps` returns `dev`'s shape plus `indexes`:

```js
const hasSqliteObject = (db, type, name) => db.prepare(
  "SELECT count(*) AS n FROM sqlite_master WHERE type=? AND name=?"
).get(type, name).n > 0;

function schemaGaps(db) {
  const tables = Object.keys(INCREMENTAL_TABLES)
    .filter((t) => !hasSqliteObject(db, 'table', t));
  const indexes = Object.entries(INCREMENTAL_INDEXES)
    .filter(([name, { table }]) => hasSqliteObject(db, 'table', table)
                                && !hasSqliteObject(db, 'index', name))
    .map(([name]) => name);
  return { columns: missingColumns(db), tables, indexes };
}
```

**Hunk 5 — `repairSchemaGaps`.** **Take the PR's order and keep its comment verbatim** — this is the one hunk where `dev`'s side is actively wrong for this branch. `dev` ALTERs then CREATEs; on a DB stamped ≥19 that is missing the ask tables, `gaps.columns` was computed before `ask_run_links` existed, so `comment_ids` would be skipped and the DB stamped current without it.

```js
/** Apply the gap repairs with NO transaction control of its own — the caller owns
 *  the transaction (the ladder tx in migrate(), or reconcileSchema's own lock).
 *  ORDER IS LOAD-BEARING: tables and indexes FIRST, then the columns RE-probed
 *  against the post-CREATE schema. `gaps.columns` was computed BEFORE this pass
 *  ran, so it cannot see an incremental column on a table this pass is about to
 *  create (ask_run_links.comment_ids on a >=20-stamped DB missing the ask
 *  tables) — the ALTER would be skipped and the DB stamped current with the
 *  column absent, and only a LATER migrate() would heal it. No gap DDL
 *  references an INCREMENTAL_COLUMNS column, so nothing needs an ALTER first. */
function repairSchemaGaps(db, gaps) {
  // One DDL block can create several tables (ASK_DDL, DIFF_COMMENTS_DDL) — the
  // Set collapses the duplicate keys to a single idempotent exec.
  for (const ddl of new Set((gaps.tables || []).map((t) => INCREMENTAL_TABLES[t]))) db.exec(ddl);
  for (const name of gaps.indexes || []) db.exec(INCREMENTAL_INDEXES[name].ddl);
  for (const { table, col, type } of missingColumns(db)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}
```

**Hunk 6 — `reconcileSchema` early return.** `dev`'s two-clause form plus `indexes`:

```js
  const gaps = schemaGaps(db);
  if (gaps.columns.length === 0 && gaps.tables.length === 0
      && gaps.indexes.length === 0) return; // clean — no lock
```

**Hunk 7 — the ladder in `migrate()`.** Both sides' steps, PR's shifted up one:

```js
    if (current < 17) db.exec(MODEL_COST_FLAGS_DDL); // IF NOT EXISTS — reconcile-safe
    // v17 -> v18 (task-source profiles): source_bindings. IF NOT EXISTS —
    // reconcileSchema may already have created it on a divergently-stamped DB.
    if (current < 18) db.exec(SOURCE_BINDINGS_DDL);
    if (current < 19) db.exec(ASK_DDL);              // IF NOT EXISTS — reconcile-safe
    if (current < 20) applySchemaV20(db);            // ask_cost_ledger + backfill
    if (current < 21) db.exec(ASK_WORKTREES_DDL);    // IF NOT EXISTS — reconcile-safe
    if (current < 22) applySchemaV22(db);            // tables + the ask_run_links column
```

### T4 — Rename the two renumbered ladder functions

Both are module-private, so this is a pure rename plus their doc comments:

- `applySchemaV19` → `applySchemaV20` — update its docblock: "v18 -> v19" → "v19 -> v20", "a ladder pass through <19" → "<20", "the stamp stays 19" → "20".
- `applySchemaV21` → `applySchemaV22` — update "v21:" → "v22:", "an EXISTING v19/v20 DB" → "v20/v21".

Also fix the version references in the surviving comments elsewhere in `db.mjs` (`// Added after v18 shipped (review of PR #376)` → v19) and in:

- `src/core/ask/store.mjs:62` — `// v21: diff comments this run addresses` → v22
- `src/core/ask/turn.mjs:212` — `the v19 backfill` → v20
- `src/core/cost-budget.mjs:60` — `the v19 backfill's idempotency key` → v20
- `src/core/diff-comments.mjs:2` — `(diff_comments, v21)` → v22
- `test/ask-api-cards.test.mjs:198` — `// v21: the propose→launch→state chain` → v22

### T5 — Renumber the four PR-only schema tests

None of these conflict (they are new files on this branch), but every one asserts the old numbers and **will fail after T3**.

**Rule:** an assertion about the *final* stamp becomes `SCHEMA_VERSION` (imported — this is `dev`'s new convention and immunises the next collision); a stamp that encodes a *ladder step* stays a literal, shifted +1.

| File | Change |
|---|---|
| `test/ask-db-schema.test.mjs` | final `21` → `SCHEMA_VERSION`; `'the v18 ladder step'` → v19; `'a v19 DB gets ask_worktrees'` → v20 with `PRAGMA user_version = 20`; "stamped 21"/"stamped-21" prose → 22 |
| `test/ask-worktrees-schema.test.mjs` | `'v20: ask_worktrees …'` → v21; `user_version >= 20` → `>= 21` |
| `test/migrate-v19.test.mjs` | **`git mv` to `test/migrate-v20.test.mjs`**; header + test names v19 → v20; seed stamps `PRAGMA user_version = 18` → `19`; final `21` → `SCHEMA_VERSION` |
| `test/diff-comments-schema.test.mjs` | `v21:` test names → v22; `user_version = 20` (real v20 DB) → `21`; final `21` → `SCHEMA_VERSION`; **the M3 loop `for (const stamp of [19, 20, 21])` → `[20, 21, 22]`** |

The M3 case is the regression guard for hunk 5's ordering — it must stay green, and it is the first thing to check if `updateRunLink({commentIds})` starts throwing.

### T6 — Hand-verify the auto-merged overlaps

Textual auto-merge succeeded on these, but both sides edited the same functions. Read each merged hunk before trusting it.

| File | Overlap | Risk |
|---|---|---|
| `src/core/claude-runner.mjs` | `runReal(...)` and `mockEnabled(opts)` — `dev` #375 sets `ANTHROPIC_MODEL` as the wire model id; the PR reworked `buildSpawnEnv(envScrub, envAllowlist)` and the mcp forwarding | **Highest.** Confirm the PR's env scrub/allowlist does not strip the `ANTHROPIC_MODEL` `dev` now injects. `test/spawn-args.test.mjs` has one test from each side — both must pass. |
| `ui/server.mjs` | `app.post('/api/run')` — `dev` added the multiProfile `source.profile` gate; the PR added the lost-card-state 409 and the ask follower wiring | Medium. Read the merged handler top to bottom once. *Checked: Ask card launches carry project/workspace + workflow + guardrails, never a `source`, so the new profile gate cannot 400 them.* |
| `src/cli/worca-cc.mjs` | both edited the help text (`Usage:` / `Options:`) | Low. `npm run cli -- --help` and eyeball. |
| `ui/public/app.js` | both extended the `state` object literal and the import block | Low, but re-read both. |
| `ui/public/style.css` | both appended near `fieldset.source legend` | Low — check for a duplicated or shadowed rule. |
| `src/core/settings.mjs` | disjoint functions | None. |

Not a merge issue, noted for completeness: `dev` gave `readPluginConfig`/`readPluginState`/`writePluginState` an optional trailing `profile` argument. `src/core/chat/channel-host.mjs` and `notifier.mjs` call them without one and so read the default bucket — but both files predate the merge base, so this is `dev`'s own behaviour, not something this merge introduces.

### T7 — Verify

Module-load first (`node --check` will not catch a temporal-dead-zone `ReferenceError` if `INCREMENTAL_TABLES` ends up above one of the `*_DDL` consts the merge moved):

```bash
node --input-type=module -e "import('./src/core/db.mjs').then(m => console.log('SCHEMA_VERSION', m.SCHEMA_VERSION))"
# expect: SCHEMA_VERSION 22
```

Then the blast radius, then the full suite:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/db.test.mjs test/db-pause-schema.test.mjs test/migrate-v1*.test.mjs \
  test/migrate-v20.test.mjs test/subagent-migration*.test.mjs \
  test/upgrade-integration.test.mjs test/ask-db-schema.test.mjs \
  test/ask-worktrees-schema.test.mjs test/diff-comments-schema.test.mjs \
  test/spawn-args.test.mjs

npm test
npm run smoke
```

The suite was fully green on both parents. `test/api-sources.test.mjs` has a known intermittent `ENOTEMPTY` teardown flake that fails the whole file and inflates the failure count by one — re-run it alone before blaming the merge.

### T8 — Commit and push

```bash
git commit    # keep the default merge message; add a body naming the renumber
git push origin worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb
gh pr view 376 --json mergeable,mergeStateStatus   # expect MERGEABLE / CLEAN
```

Suggested commit body:

```
Merge dev into the Ask Worca branch.

dev's #350 minted schema v18 (source_bindings) and refactored the gap-repair
machinery; this branch had minted 18-21 for the ask/diff ladder. dev keeps 18;
the ask steps shift to 19 (ask tables), 20 (ask_cost_ledger + backfill),
21 (ask_worktrees) and 22 (diff comments + ask_run_links.comment_ids).
SCHEMA_VERSION is 22 and stays exported.

The PR's gap flags fold into dev's INCREMENTAL_TABLES map; idx_ask_attachments_thread
moves to a new INCREMENTAL_INDEXES map because a missing index cannot be inferred
from a missing table. repairSchemaGaps keeps THIS branch's order — tables and
indexes first, columns re-probed after — since ask_run_links.comment_ids is an
incremental column on a table the same repair pass creates.
```

---

## 5. Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | `repairSchemaGaps` silently reverts to `dev`'s ALTER-then-CREATE order → `ask_run_links.comment_ids` never added on a DB stamped ≥20 without the ask tables; surfaces only as a swallowed throw at the `updateRunLink` log-only catch | The M3 loop in `test/diff-comments-schema.test.mjs` is the guard — keep it, and shift it to `[20, 21, 22]` |
| 2 | `idx_ask_attachments_thread` dropped during the fold into `INCREMENTAL_TABLES` (it is an index; the map is table-keyed) → per-thread attachment reads go back to full scans, silently | `INCREMENTAL_INDEXES` + the index test at `test/ask-db-schema.test.mjs:128` |
| 3 | Resolving against the stale local tip `5ef76b90` → the two review-fix commits are re-conflicted or lost | T0's `git pull --ff-only` before anything else |
| 4 | `ANTHROPIC_MODEL` scrubbed by the PR's spawn-env allowlist | T6, plus both `test/spawn-args.test.mjs` tests |
| 5 | A `*_DDL` const ends up below `INCREMENTAL_TABLES` after the merge → TDZ `ReferenceError` at import, invisible to `node --check` | The dynamic-import check in T7 |
| 6 | A wholesale `--theirs` on the 14 tests quietly discards a PR change | Verified: the PR's only edits to those files were the `17 → 21` literals. Re-verify with `git diff 79dc9256..b73bf83f -- <files> \| grep '^[+-][^+-]'` if in doubt |
