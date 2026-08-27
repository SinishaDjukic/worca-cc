# Plan v2 — Resolve PR #376 ↔ `dev` merge conflicts

**Date:** 2026-08-26
**Supersedes:** `2026-08-26-pr376-dev-merge-conflicts.md`
**PR:** [#376 — Ask Worca](https://github.com/SinishaDjukic/worca-cc/pull/376)
**Head:** `worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb` → **Base:** `dev`
**Status on GitHub:** `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`

> **What changed from v1.** The strategy, the version arithmetic and every `db.mjs`
> hunk in v1 were **empirically validated** (see §2) and carry over unchanged. Two
> MAJOR defects are fixed: **T5**'s renumbering rule silently disarmed two
> self-heal regression tests (v1 called a live `PRAGMA user_version = 21` *seed*
> "prose"), and **T4**'s comment sweep pointed at the one comment the resolution
> deletes while missing the four DDL docblocks that survive with stale version
> numbers. T2's verification grep and T7's guards are tightened; risks 4 and 5 are
> re-scored against measurement.

---

## 1. Situation

| Fact | Value | Verified |
|---|---|---|
| Merge base | `79dc9256` | ✅ `git merge-base` |
| `origin/dev` tip | `d4a8181c` (18 commits ahead of base) | ✅ |
| PR head (remote) | `b73bf83f` | ✅ `git ls-remote` |
| Local branch tip | `5ef76b90` — **2 commits behind** (`824e6178`, `b73bf83f`) | ✅ |
| Conflicted files | **15** (`src/core/db.mjs` + 14 migration tests) | ✅ `git merge-tree` |
| Conflict hunks in `db.mjs` | **6** | ✅ |
| Files changed by both sides | 22 | ✅ |

What landed on `dev` since the base:

- **#350 — per-profile task-source config and project/workspace bindings** (the big one: `source_bindings` table, schema **v18**, `plugin-config.mjs` profile parameter, profile roster UI/API, new `test/migrate-v18.test.mjs`)
- #381 — classify `"Request timed out"` as a recoverable network error
- #374/#375 — honor `ANTHROPIC_MODEL` in a model entry's env as the wire model id
- #378/#379 — architecture docs + README hero image

> **Local working tree carries untracked `PR_DESCRIPTION.md`, `docs/superpowers/`, `marketing/`, `worca-showcase.html`.** Leave them untracked — plans and specs are never committed in this repo.

> **No markdown doc references the schema version.** `grep -rniE "user_version|SCHEMA_VERSION|schema v1[6-9]|schema v2[0-2]" --include='*.md'` over the merged tree returns nothing outside `docs/superpowers/`. The renumber touches code and tests only.

---

## 2. Empirical validation of this plan

This resolution was executed end to end in a throwaway worktree at `b73bf83f` before
this document was written. Every number below is measured, not predicted:

| Check | Result |
|---|---|
| `git merge origin/dev` | 15 conflicts, exactly as listed |
| `git checkout --theirs` on the 14 tests | clean; suite green afterwards |
| `db.mjs` conflict hunks | 6, matching §4 T3 one-for-one |
| `node --input-type=module -e "import('./src/core/db.mjs')…"` | `SCHEMA_VERSION 22` |
| Schema blast radius (18 files) | **90 / 90 pass** |
| `npm test` (full suite) | **3671 / 3671 pass**, 0 fail, ~91 s |
| `test/api-sources.test.mjs` ENOTEMPTY flake | did not fire on this run |

So the plan below is known-executable. What follows are the corrections that keep
the *coverage* honest, not fixes to a broken resolution.

---

## 3. Root cause

Both branches minted **schema version 18** on the same `migrate()` ladder, and `dev`
additionally *refactored the gap-repair machinery that this PR extended*.

**`dev` side**

- `SCHEMA_VERSION` 17 → **18**, where v18 = `SOURCE_BINDINGS_DDL`.
- `SCHEMA_VERSION` is now **exported** so migration tests assert "reached the module's current version" instead of hardcoding a number.
- Replaced the per-table boolean gap flags (`stepQuestionsTable`, `guardrailSetsTable`, …) with a generic `INCREMENTAL_TABLES` name → DDL map; `schemaGaps()` now returns `{ columns, tables }`; `missingColumns()` is **inlined** into `schemaGaps`.
- Mechanically swapped the version literal for the imported `SCHEMA_VERSION` in 14 migration tests (commit `87334ef4`) — **including the `db.exec('PRAGMA user_version = 17')` seeds**, which became `db.exec(\`PRAGMA user_version = ${SCHEMA_VERSION}\`)`.

**PR side**

- `SCHEMA_VERSION` 17 → **21**: v18 `ASK_DDL`, v19 `applySchemaV19` (`ask_cost_ledger` + backfill), v20 `ASK_WORKTREES_DDL`, v21 `applySchemaV21` (diff-comment tables + `ask_run_links.comment_ids`).
- Kept the boolean flag shape and **added** two things `dev`'s refactor has no slot for:
  - `askAttachmentsIndex` — an **index**, not a table (`idx_ask_attachments_thread`), probed so an existing stamped DB heals without a version bump.
  - a **load-bearing reordering** of `repairSchemaGaps`: CREATE tables first, then `missingColumns(db)` **re-probed against the post-CREATE schema** — because `ask_run_links.comment_ids` is an `INCREMENTAL_COLUMNS` entry whose host table is itself created by a gap-repair DDL in the same pass. It is also why the PR **split `missingColumns()` out** of `schemaGaps()`.
- Mechanically bumped the same 14 test files' literals 17 → 21.

So the 14 test conflicts are two mechanical rewrites of the same lines, and `db.mjs`
is a genuine 6-hunk semantic merge.

---

## 4. Strategy

**Merge `origin/dev` into the PR branch. Do not rebase.** A rebase replays 30+
commits, each through a schema renumber — every ask/diff commit would conflict in
turn. One merge commit, one resolution.

**Version arithmetic:** `dev` already shipped 18, so it keeps it. The PR's four
ladder steps shift up by one.

| Step | Before (PR) | After (merged) |
|---|---|---|
| `SOURCE_BINDINGS_DDL` | — (dev's 18) | **18** |
| `ASK_DDL` | 18 | **19** |
| `ask_cost_ledger` + backfill | 19 (`applySchemaV19`) | **20** (`applySchemaV20`) |
| `ASK_WORKTREES_DDL` | 20 | **21** |
| diff comments + `comment_ids` | 21 (`applySchemaV21`) | **22** (`applySchemaV22`) |
| `SCHEMA_VERSION` | 21 | **22** (exported, per `dev`) |

**Merge direction note:** merging `origin/dev` *into* the PR branch makes `--ours` =
PR and `--theirs` = `dev`. Every `--theirs` below means "take `dev`'s file".
(Verified: `git checkout --theirs` on the test files yields dev's imported-`SCHEMA_VERSION` form.)

---

## 5. Tasks

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

**Verified** (`git diff 79dc9256..b73bf83f -- <the 14> | grep '^[+-][^+-]'`): across all
14 files the PR's *only* change vs. the merge base was the `17 → 21` literal bump.
`dev` rewrote the same lines — assertions **and** seeds — to the imported
`SCHEMA_VERSION`, so taking `dev`'s file loses nothing and immunises them against
the next collision.

```bash
FILES="test/db-pause-schema.test.mjs test/db.test.mjs \
test/migrate-v10.test.mjs test/migrate-v12.test.mjs test/migrate-v13.test.mjs \
test/migrate-v14.test.mjs test/migrate-v15.test.mjs test/migrate-v16.test.mjs \
test/subagent-migration.test.mjs test/subagent-migration-v3.test.mjs \
test/subagent-migration-v6.test.mjs test/subagent-migration-v7.test.mjs \
test/subagent-migration-v8.test.mjs test/upgrade-integration.test.mjs"

git checkout --theirs -- $FILES
git add $FILES
```

Sanity check afterwards — **over all 14 files**, no bare version literal may survive
(v1's grep covered only `migrate-v1*` and `db*`, missing 6 of the 14):

```bash
grep -nE "user_version'\)\.get\(\)\.user_version, [0-9]+|PRAGMA user_version = [0-9]+" $FILES
# expect: NO output
```

> `test/migrate-v18.test.mjs` arrives new from `dev` (source_bindings). It is written
> against the imported `SCHEMA_VERSION`, it does not conflict, and it needs **no**
> change — source_bindings stays v18 after the renumber. Do not "fix" it.

### T3 — Resolve `src/core/db.mjs` (6 conflict hunks + 1 non-conflicted edit)

Take **`dev`'s generic machinery** as the skeleton, then re-add the two things it
cannot express (the index probe, the CREATE-before-ALTER order) and register the
PR's tables in the map.

**Hunk 1 — `SCHEMA_VERSION`.** Take `dev`'s exported form, value **22**:

```js
/** Latest schema version. Bump + append a new migration step when the DDL grows.
 *  Exported so migration tests assert "reached the module's current version"
 *  instead of hardcoding the number — a schema bump then touches no test file. */
export const SCHEMA_VERSION = 22;
```

**Hunk 2 — `INCREMENTAL_COLUMNS` (NOT conflicted — edit by hand).** Textual
auto-merge keeps the PR's extra entry; only its version comment is stale:

```js
  ask_run_links:          { comment_ids: 'TEXT' },        // v22: JSON array of dc_ ids pending at launch
```

**Hunk 3 — `INCREMENTAL_TABLES` + a new `INCREMENTAL_INDEXES`.** Keep `dev`'s doc
comment; register every table the PR's gap flags covered. `ASK_DDL` and
`DIFF_COMMENTS_DDL` each create several tables — list every one of them (strictly
stronger than the PR's single-table probe: it heals a DB missing only
`ask_run_links`) and de-duplicate at exec time.

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

**Hunk 4 — `missingColumns` / `schemaGaps`.** Keep the PR's `missingColumns()`
**split out** (hunk 5's re-probe depends on it); `schemaGaps` returns `dev`'s shape
plus `indexes`. The PR's `schemaGaps` docblock is *inside* this conflict region, so
it goes with the old body:

```js
const hasSqliteObject = (db, type, name) => db.prepare(
  "SELECT count(*) AS n FROM sqlite_master WHERE type=? AND name=?"
).get(type, name).n > 0;

/**
 * The INCREMENTAL_COLUMNS gaps plus the names of any INCREMENTAL_TABLES /
 * INCREMENTAL_INDEXES that do not exist yet (all CREATEs are IF NOT EXISTS, so
 * reasserting one on any stamped DB is safe). Cheap and read-only.
 */
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

**Hunk 5 — `repairSchemaGaps`.** **Take the PR's order** — this is the one hunk
where `dev`'s side is actively wrong for this branch. `dev` ALTERs then CREATEs; on
a DB stamped ≥20 that is missing the ask tables, `gaps.columns` was computed before
`ask_run_links` existed, so `comment_ids` would be skipped and the DB stamped
current without it.

> ⚠️ **The docblock above `repairSchemaGaps` is OUTSIDE the conflict region.** Git
> keeps the PR's text verbatim, including its stale `>=19-stamped DB`. Replace the
> whole block with the version below — do not stop at the conflict markers.

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

### T4 — Rename the two renumbered ladder functions, and fix EVERY stale version reference

Both functions are module-private and contain **no version literals in their
bodies**, so the rename is purely mechanical:

```bash
sed -i '' 's/applySchemaV19/applySchemaV20/g; s/applySchemaV21/applySchemaV22/g' src/core/db.mjs
```

**The comment sweep is where v1 was wrong.** v1's only worked example
(`// Added after v18 shipped (review of PR #376)`) lives *inside* the PR's
`schemaGaps` body, which hunk 4 deletes outright — so following it literally fixes
nothing. These are the references that actually survive the resolution. Every one is
doc-only, so **no test catches a miss**:

| Location | Current text | Becomes |
|---|---|---|
| `db.mjs` `ASK_DDL` docblock | `/** v18: Ask Worca — assistant chat threads, …` | **v19** |
| `db.mjs` `ASK_COST_LEDGER_DDL` docblock | `/** v19: append-only Ask Worca spend ledger …` | **v20** |
| `db.mjs` `ASK_WORKTREES_DDL` docblock | `/** v20: Ask Worca worktrees — per-thread …` | **v21** |
| `db.mjs` `DIFF_COMMENTS_DDL` docblock | `/** v21: internal, line-anchored comments …` | **v22** |
| `db.mjs` `INCREMENTAL_COLUMNS` | `// v21: JSON array of dc_ ids pending at launch` | **v22** (T3 hunk 2) |
| `db.mjs` `repairSchemaGaps` docblock | `>=19-stamped DB` | **>=20** (T3 hunk 5) |
| `db.mjs` `applySchemaV20` docblock | `v18 -> v19 (ask-cost-statistics-design.md §6)` | **v19 -> v20** |
| `db.mjs` `applySchemaV20` docblock | `a ladder pass through <19` / `after v19 leaves` / `the stamp stays 19` | **<20** / **after v20** / **stays 20** |
| `db.mjs` `applySchemaV22` docblock | `/** v21: both new tables are IF NOT EXISTS` | **v22** |
| `db.mjs` `applySchemaV22` docblock | `an EXISTING v19/v20 DB` | **v20/v21** |
| `src/core/ask/store.mjs:62` | `// v21: diff comments this run addresses` | **v22** |
| `src/core/ask/turn.mjs:212` | `the v19 backfill never re-runs` | **v20** |
| `src/core/cost-budget.mjs:60` | `the v19 backfill's idempotency key` | **v20** |
| `src/core/diff-comments.mjs:2` | `(diff_comments, v21)` | **v22** |
| `test/ask-api-cards.test.mjs:198` | `// v21: the propose→launch→state chain` | **v22** |
| `test/migrate-v20.test.mjs:108` | `never re-enters applySchemaV19` | **applySchemaV20** |

`db.mjs`'s `SOURCE_BINDINGS_DDL` docblock (`* v18 (task-source profiles): …`) and
the ladder comment (`// v17 -> v18 (task-source profiles)`) are **correct as-is** —
source_bindings keeps 18.

**Closing sweep** (must return only the lines you deliberately kept):

```bash
grep -rnE "\bv(18|19|20|21)\b|applySchemaV(19|21)" src ui test | grep -viE "migrate-v1[0-9]|SCHEMA_V1[0-9]|applySchemaV1[0-6]"
```

### T5 — Renumber the four PR-only schema tests

None of these conflict (they are new files on this branch), but every one asserts the
old numbers and **will fail, or silently stop testing what it names, after T3**.

**Classify every number into one of THREE buckets — v1 had only two, and the missing
one is the MAJOR defect:**

| Bucket | Shape | Rule |
|---|---|---|
| **A. final-stamp assertion** | `assert.equal(…user_version, 21)` / `>= 21` | → imported `SCHEMA_VERSION` (dev's convention; immunises the next collision) |
| **B. stamped-CURRENT seed** | `db.exec('PRAGMA user_version = 21')` with a `// divergent ladder` comment, always paired with a `'stamp not rewritten'` assertion | → **`` db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`) ``** |
| **C. ladder-step seed** | `db.exec('PRAGMA user_version = 17\|18\|19\|20')` — encodes "a real vN DB" | → stays a **literal, shifted +1** (17 is pre-collision and stays 17) |

> **Why bucket B is load-bearing.** A bucket-B seed left at `21` makes
> `migrate()` take the **ladder** path (21 < 22) instead of the `reconcileSchema`
> fast path. Measured on the resolved module:
>
> ```
> seed 21 -> after 22 | stamp rewritten: true  | path: LADDER (applySchemaV22)
> seed 22 -> after 22 | stamp rewritten: false | path: reconcileSchema fast path
> ```
>
> With the paired assertion converted to `SCHEMA_VERSION` (bucket A), the test still
> **passes** — the ladder wrote 22 too. So the suite stays green while the two tests
> that Risk 1 and Risk 2 name as their guards stop exercising `reconcileSchema` at
> all. Nothing in T7 catches this; only the classification does.

**Per-file changes:**

| File | Change |
|---|---|
| `test/ask-db-schema.test.mjs` | import `SCHEMA_VERSION`; all `user_version, 21` → `SCHEMA_VERSION` (A); **`db.exec('PRAGMA user_version = 21')` on the "already stamped 21 WITHOUT the ask tables" test → `` `PRAGMA user_version = ${SCHEMA_VERSION}` `` (B)**; `PRAGMA user_version = 19` → `20` (C); header `the v18 ladder step` → v19; test name `a v19 DB gets ask_worktrees` → v20; `// 17 -> 21: run the ask ladder steps` → `17 -> 22`; `// the v21 column is LAST` → v22; remaining "stamped 21"/"stamped-21" names → current/22 |
| `test/ask-worktrees-schema.test.mjs` | header `the v20 ask_worktrees table` → v21; test name `'v20: ask_worktrees …'` → v21; `user_version >= 20` → `>= 21` (C — this asserts a *floor*, not the final stamp) |
| `test/migrate-v19.test.mjs` | **`git mv` to `test/migrate-v20.test.mjs`**; self-referential line-1 header `// test/migrate-v19.test.mjs` → v20; import `SCHEMA_VERSION`; test names `v18 -> v19` → `v19 -> v20`, `the v19 step` → `the v20 step`, `a v18 DB gets …` → `a v19 DB gets …`; **all three `PRAGMA user_version = 18` seeds → `19` (C)**; **`db.exec('PRAGMA user_version = 21')` on the "stamped 21 WITHOUT the table" test → `` `PRAGMA user_version = ${SCHEMA_VERSION}` `` (B)**; all `user_version, 21` → `SCHEMA_VERSION` (A) |
| `test/diff-comments-schema.test.mjs` | import `SCHEMA_VERSION`; `v21:` test names → v22; `user_version >= 21` → `SCHEMA_VERSION` (A); `PRAGMA user_version = 20` ("rewind … a real v20 DB") → `21` (C, comment too); `// 17 -> 21 first` → `17 -> 22`; all `user_version, 21` → `SCHEMA_VERSION` (A); **the M3 loop `for (const stamp of [19, 20, 21])` → `[20, 21, 22]`**; the M3 preamble `(19 and 20 via applySchemaV21, 21 via reconcileSchema)` → `(20 and 21 via applySchemaV22, 22 via reconcileSchema)` |

The M3 case is the regression guard for hunk 5's ordering — it must stay green, and
it is the first thing to check if `updateRunLink({commentIds})` starts throwing.

### T6 — Hand-verify the auto-merged overlaps

Textual auto-merge succeeded on these, but both sides edited the same functions.

| File | Overlap | Status |
|---|---|---|
| `src/core/claude-runner.mjs` | `runReal(...)` — `dev` #375 sets `ANTHROPIC_MODEL` as the wire model id; the PR reworked `buildSpawnEnv(envScrub, envAllowlist)` | **Verified clean.** The merged body ends with `spawnEnv = { ...(guardrailEnv ?? process.env), ...safeModelEnv }` — modelEnv merges **last** and wins over the scrub by construction, and `wireModel = safeModelEnv?.ANTHROPIC_MODEL \|\| model` is passed as an explicit `--model`. Both `test/spawn-args.test.mjs` cases pass. |
| `ui/server.mjs` | `app.post('/api/run')` — `dev` added the multiProfile `source.profile` gate; the PR added the lost-card-state 409 and the ask follower wiring | **Verified clean.** The ask-card 409 gate runs first and returns early; the profile gate sits behind `if (source && source.type === 'plugin')`, and Ask card launches never carry a `source`. |
| `src/cli/worca-cc.mjs` | both edited the help text (`Usage:` / `Options:`) | Low. `npm run cli -- --help` and eyeball. |
| `ui/public/app.js` | both extended the `state` object literal and the import block | Low, but re-read both. |
| `ui/public/style.css` | both appended near `fieldset.source legend` | Low — check for a duplicated or shadowed rule. |
| `src/core/settings.mjs` | disjoint functions | None. |

Not a merge issue, noted for completeness: `dev` gave
`readPluginConfig`/`readPluginState`/`writePluginState` an optional trailing
`profile` argument. `src/core/chat/channel-host.mjs` and `notifier.mjs` call them
without one and so read the default bucket — but both files predate the merge base,
so this is `dev`'s own behaviour, not something this merge introduces.

### T7 — Verify

Module-load first (`node --check` will not catch a temporal-dead-zone
`ReferenceError` if `INCREMENTAL_TABLES` ends up above one of the `*_DDL` consts):

```bash
node --input-type=module -e "import('./src/core/db.mjs').then(m => console.log('SCHEMA_VERSION', m.SCHEMA_VERSION))"
# expect: SCHEMA_VERSION 22
```

**Bucket-B guard** — no bare stamped-current literal may survive in the four
renumbered files (this is the check v1 lacked; it is what makes the T5 defect
visible instead of silently green):

```bash
grep -nE "PRAGMA user_version = (2[0-9])'" \
  test/ask-db-schema.test.mjs test/migrate-v20.test.mjs \
  test/diff-comments-schema.test.mjs test/ask-worktrees-schema.test.mjs
# expect: only bucket-C ladder-step seeds (= 20 in ask-db-schema, = 21 in diff-comments)
```

Then the blast radius, then the full suite:

```bash
WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test \
  test/db.test.mjs test/db-pause-schema.test.mjs test/migrate-v1*.test.mjs \
  test/migrate-v20.test.mjs test/subagent-migration*.test.mjs \
  test/upgrade-integration.test.mjs test/ask-db-schema.test.mjs \
  test/ask-worktrees-schema.test.mjs test/diff-comments-schema.test.mjs \
  test/spawn-args.test.mjs
# measured on the dry run: 90 / 90 pass

npm test    # measured on the dry run: 3671 / 3671 pass
npm run smoke
```

`test/api-sources.test.mjs` has a known intermittent `ENOTEMPTY` teardown flake that
fails the whole file and inflates the failure count by one — re-run it alone before
blaming the merge. (It did not fire on the dry run.)

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

## 6. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | `repairSchemaGaps` silently reverts to `dev`'s ALTER-then-CREATE order → `ask_run_links.comment_ids` never added on a DB stamped ≥20 without the ask tables; surfaces only as a swallowed throw at the `updateRunLink` log-only catch | High | The M3 loop in `test/diff-comments-schema.test.mjs`, shifted to `[20, 21, 22]` — **and** T5 bucket B, without which the sibling self-heal tests stop covering the reconcile path |
| 2 | `idx_ask_attachments_thread` dropped during the fold into `INCREMENTAL_TABLES` (it is an index; the map is table-keyed) → per-thread attachment reads go back to full scans, silently | High | `INCREMENTAL_INDEXES` + the index test at the tail of `test/ask-db-schema.test.mjs` |
| 3 | **A bucket-B seed left at `21`** → the two "stamped current, stamp not rewritten" tests take the LADDER path, still pass, and stop exercising `reconcileSchema`. Green suite, lost coverage — the failure mode v1 shipped | High | T5's three-bucket rule + T7's bucket-B grep |
| 4 | Resolving against the stale local tip `5ef76b90` → the two review-fix commits are re-conflicted or lost | Medium | T0's `git pull --ff-only` before anything else |
| 5 | `ANTHROPIC_MODEL` scrubbed by the PR's spawn-env allowlist | **Downgraded to none** — measured: the merged `runReal` spreads `safeModelEnv` *after* `guardrailEnv`, so modelEnv wins over the scrub unconditionally | Still read the merged `runReal` once (T6); both `test/spawn-args.test.mjs` cases pass |
| 6 | A `*_DDL` const ends up below `INCREMENTAL_TABLES` after the merge → TDZ `ReferenceError` at import, invisible to `node --check` | **Downgraded to low** — measured on the merged file: every `*_DDL` lands at lines 509–693, `INCREMENTAL_TABLES` at 764 | Keep T7's dynamic-import check; it is one line |
| 7 | A wholesale `--theirs` on the 14 tests quietly discards a PR change | **Closed** — verified by diffing the base against the PR head over all 14 files: literal-only edits | Re-verify with `git diff 79dc9256..b73bf83f -- $FILES \| grep '^[+-][^+-]'` if in doubt |
| 8 | A stale `vNN` comment survives the renumber and misleads the *next* branch into the same collision — doc-only, so no test fails | Medium | T4's exhaustive table + its closing `grep` sweep |
