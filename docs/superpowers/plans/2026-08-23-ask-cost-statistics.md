# Ask Worca Cost in Statistics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every Ask Worca chat turn's cost into a deletion-proof ledger, count it in all budget totals and enforcement, and surface it in Statistics as two new KPI cards (Pipeline spend, Ask Worca) with sessions / total cost / cost-per-session.

**Architecture:** New FK-free `ask_cost_ledger` table (schema v19, mirrors `cost_ledger`) written once per completed turn from `AskTurn._complete()`; `cost-budget.mjs` gains ask readers and a combined `totalWindowSpendUsd` used by `budgetStatus()` and the orchestrator's total-cost gate; `stats.mjs` adds `pipelineSpendUsd` + `ask:{spendUsd,sessions,turns}` to the `/api/stats` payload; `stats-view.mjs` renders a 6-tile KPI row.

**Tech Stack:** Node ESM (`.mjs`), `node:sqlite` (`DatabaseSync`), `node:test` + jsdom for UI tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-ask-cost-statistics-design.md` (read it first — decisions D1–D12 are locked; it in turn amends `2026-08-22-ask-worca-design.md` per its §4).

## Global Constraints

- Base branch: `worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb` (contains Ask Worca P1–P3). Work on a new branch `worca/ask-cost-statistics` off it.
- The working tree has pre-existing uncommitted changes (`src/core/title.mjs`, `test/title.test.mjs`, untracked `PR_DESCRIPTION.md`, `marketing/`, `docs/superpowers/`). **Never commit, revert, or touch them.** `git add` only the explicit paths each task lists. `docs/superpowers/` plans+specs stay untracked always.
- Test runner: `npm test` = `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/*.mjs`. Single file: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/<file>.mjs`. In a fresh worktree run `npm ci` first (skipping it produces bogus express failures).
- User-facing copy says **worca** / **Ask Worca**, never "worca-cc".
- All new SQL DDL uses `IF NOT EXISTS` (runs from both the ladder and the self-heal).
- Money helpers: reuse `roundUsd` from `cost-budget.mjs` for every aggregated output; raw floats in ledger rows.
- Comment style: match the surrounding files (dense, "why"-focused header comments; spec-section references like `ask-cost-statistics-design.md §6`).

---

### Task 0: Branch + baseline

**Files:** none (setup only)

- [ ] **Step 1: Create the branch**

```bash
cd /Users/denislavprinov/Develop/worca-cc
git checkout worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb
git checkout -b worca/ask-cost-statistics
```

(If executing in a fresh worktree instead: `git worktree add <dir> -b worca/ask-cost-statistics worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb`, then `npm ci` in it.)

- [ ] **Step 2: Baseline suite**

Run: `npm test 2>&1 | tail -5`
Expected: all green. Record the pass count (last known baseline 3228; any failure here is pre-existing — stop and report, do not fix).

---

### Task 1: Schema v19 — `ask_cost_ledger` + backfill

**Files:**
- Modify: `src/core/db.mjs` (`:54` SCHEMA_VERSION; new DDL const near `:538`; `schemaGaps` `:641-673`; `repairSchemaGaps` `:677-686`; `reconcileSchema` `:699-711`; new `applySchemaV19` after `applySchemaV16` `:803`; ladder `:854-855`)
- Create: `test/migrate-v19.test.mjs`
- Modify: `test/db.test.mjs:137-146`, `test/ask-db-schema.test.mjs:25,41,48,50,62` and every other `user_version` 18-pin (list in Step 5)
- Test: `test/migrate-v19.test.mjs`

**Interfaces:**
- Consumes: `ASK_DDL` tables (v18), `repairSchemaGaps`/`schemaGaps` idioms, `ask/store.mjs` writers for test seeding.
- Produces: table `ask_cost_ledger (id INTEGER PK AUTOINCREMENT, thread_id TEXT NOT NULL, message_id TEXT, amount_usd REAL NOT NULL, tokens INTEGER, model TEXT, ts INTEGER NOT NULL)` + index `idx_ask_cost_ledger_ts`; `PRAGMA user_version` = 19. Tasks 2–4 SELECT/INSERT this table.

- [ ] **Step 1: Write the failing migration test**

Create `test/migrate-v19.test.mjs`:

```js
// test/migrate-v19.test.mjs
//
// v19 adds ask_cost_ledger — the append-only, FK-free Ask Worca spend ledger
// (ask-cost-statistics-design.md §6) — and backfills one row per already-
// persisted costed assistant message (cost_usd > 0), ts = the message's
// created_at, tokens = the sum of the stored usage fields, so pre-upgrade chat
// spend lands in Statistics. Threads deleted before the upgrade left no
// messages (CASCADE), so they backfill nothing. Structure mirrors
// test/migrate-v16.test.mjs: seed at current version through the production
// writers, stamp user_version back, reopen — the ladder runs only the v19 step.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, _resetForTests } from '../src/core/db.mjs';
import { createThread, appendMessage, finishMessage, deleteThread } from '../src/core/ask/store.mjs';

useTempHome(after);

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const indexNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);

// The same minimal seed the other migrate tests use: only the tables the
// incremental-column repair ALTERs.
const MINIMAL_SEED = `
  CREATE TABLE pipelines (id TEXT PRIMARY KEY);
  CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
`;

const ids = {};

test('v18 -> v19 creates ask_cost_ledger and backfills costed messages', async () => {
  const db = getDb();

  const t1 = createThread(); ids.t1 = t1.id;
  // m1: costed, usage sum 1500, model set — the one full backfill row
  const m1 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m1.id, { text: 'a', blocks: [], status: 'done', reason: null,
    usage: { input: 1000, output: 400, cacheRead: 50, cacheCreation: 50 }, costUsd: 0.42, durationMs: 5 });
  db.prepare("UPDATE ask_messages SET model = 'claude-opus-5' WHERE id = ?").run(m1.id);
  ids.m1 = m1.id;
  // m2: pre-result stop — cost_usd NULL — skipped
  const m2 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m2.id, { text: 'b', blocks: [], status: 'stopped', reason: 'user',
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: null, durationMs: 5 });
  // m3: $0 (mock) — skipped by cost_usd > 0
  const m3 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m3.id, { text: 'c', blocks: [], status: 'done', reason: null,
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5 });
  // m4: costed but unparseable created_at — skipped (v16 precedent)
  const m4 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m4.id, { text: 'd', blocks: [], status: 'done', reason: null,
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.1, durationMs: 5 });
  db.prepare('UPDATE ask_messages SET created_at = ? WHERE id = ?').run('not-a-date', m4.id);
  // m5: costed, usage NULL — row with tokens NULL
  const m5 = appendMessage(t1.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m5.id, { text: 'e', blocks: [], status: 'done', reason: null,
    usage: null, costUsd: 0.08, durationMs: 5 });
  ids.m5 = m5.id;

  // a thread deleted pre-upgrade: CASCADE removed its messages — nothing to backfill
  const t2 = createThread();
  const m6 = appendMessage(t2.id, { role: 'assistant', text: '', status: 'streaming' });
  finishMessage(m6.id, { text: 'f', blocks: [], status: 'done', reason: null,
    usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 9, durationMs: 5 });
  deleteThread(t2.id);

  // Rewind: drop the table the fresh-DB ladder already made, stamp 18, reopen.
  db.exec('DROP TABLE IF EXISTS ask_cost_ledger');
  db.exec('PRAGMA user_version = 18');
  _resetForTests();
  const db2 = getDb();

  assert.equal(db2.prepare('PRAGMA user_version').get().user_version, 19);
  assert.ok(tableNames(db2).includes('ask_cost_ledger'));
  assert.ok(indexNames(db2).includes('idx_ask_cost_ledger_ts'));
  assert.deepEqual(cols(db2, 'ask_cost_ledger'),
    ['id', 'thread_id', 'message_id', 'amount_usd', 'tokens', 'model', 'ts']);

  const rows = db2.prepare('SELECT * FROM ask_cost_ledger ORDER BY id').all();
  assert.equal(rows.length, 2, 'only the costed, parseable messages backfill');
  assert.equal(rows[0].thread_id, ids.t1);
  assert.equal(rows[0].message_id, ids.m1);
  assert.equal(rows[0].amount_usd, 0.42);
  assert.equal(rows[0].tokens, 1500);
  assert.equal(rows[0].model, 'claude-opus-5');
  assert.equal(rows[0].ts, Date.parse(
    db2.prepare('SELECT created_at FROM ask_messages WHERE id = ?').get(ids.m1).created_at));
  assert.equal(rows[1].message_id, ids.m5);
  assert.equal(rows[1].amount_usd, 0.08);
  assert.equal(rows[1].tokens, null, 'NULL usage backfills tokens NULL');
});

test('reopen after backfill is a no-op: no duplicate rows', () => {
  _resetForTests();
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 2);
});

test('ladder: a v18 DB gets ask_cost_ledger and is stamped 19', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 18');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
  assert.ok(tableNames(db).includes('ask_cost_ledger'), 'created by the ladder');
});

test('self-heal: a DB stamped 19 WITHOUT the table gets it from reconcileSchema, empty', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 19'); // divergent ladder: version says done, schema says otherwise
  migrate(db);                          // fast path → reconcileSchema
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19, 'stamp not rewritten');
  assert.ok(tableNames(db).includes('ask_cost_ledger'), 'healed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
    'no backfill on the heal path (accepted, same as cost_ledger)');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/migrate-v19.test.mjs`
Expected: FAIL — `user_version` is 18 / `ask_cost_ledger` missing.

- [ ] **Step 3: Implement v19 in `src/core/db.mjs`**

3a. `db.mjs:54`: `const SCHEMA_VERSION = 18;` → `const SCHEMA_VERSION = 19;`

3b. After `MODEL_COST_FLAGS_DDL` (below `db.mjs:550`), add:

```js
/** v19: append-only Ask Worca spend ledger (ask-cost-statistics-design.md §6).
 *  NO foreign key on thread_id: spend is a permanent financial fact and must
 *  survive thread deletion (cost_ledger precedent). One row per completed turn
 *  with a finite cost > 0; tokens = input+output+cacheRead+cacheCreation. */
const ASK_COST_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS ask_cost_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  TEXT NOT NULL,
  message_id TEXT,
  amount_usd REAL NOT NULL,
  tokens     INTEGER,
  model      TEXT,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ask_cost_ledger_ts ON ask_cost_ledger (ts);
`;
```

3c. In `schemaGaps()` (`db.mjs:641-673`), after the `hasAskThreads` probe add:

```js
  const hasAskCostLedger = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='ask_cost_ledger'"
  ).get().n > 0;
```

and extend the return object with `askCostLedgerTable: !hasAskCostLedger,`.

3d. In `repairSchemaGaps()` (`db.mjs:677-686`), after the `gaps.askTables` line add:

```js
  if (gaps.askCostLedgerTable) db.exec(ASK_COST_LEDGER_DDL);
```

3e. In `reconcileSchema()` (`db.mjs:699-711`), extend the clean-path condition:

```js
  if (gaps.columns.length === 0 && !gaps.stepQuestionsTable && !gaps.guardrailSetsTable
      && !gaps.costLedgerTable && !gaps.modelCostFlagsTable && !gaps.askTables
      && !gaps.askCostLedgerTable) return; // clean — no lock
```

3f. After `applySchemaV16` (`db.mjs:803`), add:

```js
/**
 * v18 -> v19 (ask-cost-statistics-design.md §6): ask_cost_ledger — the
 * append-only, FK-free Ask Worca spend ledger (survives thread deletion) —
 * plus a backfill of one row per already-persisted costed assistant message,
 * so pre-upgrade chat spend lands in Statistics. Gap-repair first, v12-v16
 * style; the NOT EXISTS guard keeps re-runs (divergent stamps) idempotent.
 * Threads deleted before the upgrade left no messages (CASCADE) — accepted.
 */
function applySchemaV19(db) {
  repairSchemaGaps(db, schemaGaps(db));
  // A hand-built or divergent DB (minimal test seeds) can lack ask_messages
  // columns entirely — such a DB never stored a chat cost, nothing to backfill.
  const has = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('ask_messages', 'cost_usd')) return;
  const rows = db.prepare(`
    SELECT id, thread_id, cost_usd, usage, model, created_at
    FROM ask_messages
    WHERE cost_usd > 0
      AND NOT EXISTS (SELECT 1 FROM ask_cost_ledger l WHERE l.message_id = ask_messages.id)
  `).all();
  const ins = db.prepare(
    'INSERT INTO ask_cost_ledger (thread_id, message_id, amount_usd, tokens, model, ts) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of rows) {
    const ts = Date.parse(r.created_at ?? '');
    if (!Number.isFinite(ts)) continue;
    let tokens = null;
    try {
      const u = JSON.parse(r.usage ?? 'null');
      if (u && typeof u === 'object') {
        tokens = ['input', 'output', 'cacheRead', 'cacheCreation']
          .reduce((a, k) => a + (Number(u[k]) || 0), 0);
      }
    } catch { /* unreadable usage — tokens stay NULL */ }
    ins.run(r.thread_id, r.id, r.cost_usd, tokens, r.model, ts);
  }
}
```

3g. In `migrate()` (`db.mjs:854`), after the `< 18` line add:

```js
    if (current < 19) applySchemaV19(db);
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/migrate-v19.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Bump every `user_version` 18-pin to 19**

These all assert or stamp "the current version". Change `18` → `19` at exactly:

- `test/db.test.mjs:137-141` (test name string + assert), `:146`
- `test/ask-db-schema.test.mjs:25`, `:41`, `:48` (the divergent stamp), `:50`, `:62`
- `test/migrate-v10.test.mjs:12`, `:54`
- `test/migrate-v12.test.mjs:38`, `:53`, `:78`, `:94` (stamp), `:96`, `:129`
- `test/migrate-v13.test.mjs:29`, `:53`, `:68` (stamp), `:72`, `:100`, `:111`
- `test/migrate-v14.test.mjs:29`, `:51`, `:62` (stamp), `:66`, `:84`, `:93`
- `test/migrate-v15.test.mjs:29`, `:62`
- `test/migrate-v16.test.mjs:69`, `:96`
- `test/subagent-migration.test.mjs:83`, `test/subagent-migration-v3.test.mjs:85`, `test/subagent-migration-v6.test.mjs:42`, `test/subagent-migration-v7.test.mjs:44`, `test/subagent-migration-v8.test.mjs:44` (also update the `'forward-migrated to v18'` message strings to v19)
- `test/upgrade-integration.test.mjs:159`

Do NOT touch: `test/db.test.mjs:126` (`EXPECTED_TABLES.length === 18` counts the original core tables — `ask_cost_ledger` is deliberately not in that list, like `cost_ledger`); historical stamps (`= 15`, `= 17`, etc.); `test/ask-db-schema.test.mjs:39` (`= 17` setup).

Verify nothing was missed:

```bash
grep -rn "user_version, 18\|user_version = 18\|user_version').get().user_version, 18" test/ || echo CLEAN
```

Expected: `CLEAN` (the v19 test's own deliberate `PRAGMA user_version = 18` rewind lines at `test/migrate-v19.test.mjs` are the only permitted hits — they stamp the PRE-v19 version on purpose; if grep shows only those, proceed).

- [ ] **Step 6: Run the schema-affected suites**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/db.test.mjs test/ask-db-schema.test.mjs test/migrate-v1*.test.mjs test/migrate-v19.test.mjs test/subagent-migration*.test.mjs test/upgrade-integration.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/db.mjs test/migrate-v19.test.mjs test/db.test.mjs test/ask-db-schema.test.mjs \
  test/migrate-v10.test.mjs test/migrate-v12.test.mjs test/migrate-v13.test.mjs \
  test/migrate-v14.test.mjs test/migrate-v15.test.mjs test/migrate-v16.test.mjs \
  test/subagent-migration.test.mjs test/subagent-migration-v3.test.mjs \
  test/subagent-migration-v6.test.mjs test/subagent-migration-v7.test.mjs \
  test/subagent-migration-v8.test.mjs test/upgrade-integration.test.mjs
git commit -m "worca: Add ask_cost_ledger schema v19 with backfill"
```

---

### Task 2: Budget accounting — writer, readers, combined enforcement

**Files:**
- Modify: `src/core/cost-budget.mjs` (new functions after `windowedSpendUsd` `:55`; `budgetStatus` `:83-103`)
- Modify: `src/core/orchestrator.mjs:63` (import), `:2543` (gate)
- Test: `test/cost-budget.test.mjs`, `test/cost-enforcement.test.mjs`

**Interfaces:**
- Consumes: `ask_cost_ledger` (Task 1), `prepare`/`roundUsd` already in `cost-budget.mjs`.
- Produces (exact exports, used by Tasks 3–4 and orchestrator):
  - `recordAskCostDelta({threadId, messageId=null, amountUsd, tokens=null, model=null, tsMs=Date.now()})` → void; no-ops unless `threadId` truthy AND `Number.isFinite(amountUsd) && amountUsd > 0`.
  - `askWindowedSpendUsd(fromMs, toMs=null)` → number (roundUsd'ed; `toMs` null = open-ended, else `ts < toMs`).
  - `totalWindowSpendUsd(windowStartMs)` → number = roundUsd(pipeline + ask window sums).
  - `budgetStatus()` unchanged shape; `windowSpendUsd`, `allTimeSpendUsd`, `remainingUsd`, `blocked` now combined.

- [ ] **Step 1: Write the failing tests**

In `test/cost-budget.test.mjs`, extend the import (`:9-12`) to also pull `recordAskCostDelta, askWindowedSpendUsd, totalWindowSpendUsd`, and `setTotalCostLimitUsd, setCostLimitResetPeriod` from settings (already imported at `:13-14` — add any missing names). Append:

```js
test('recordAskCostDelta appends raw rows; skips null/zero/negative and missing threadId', () => {
  getDb().exec('DELETE FROM ask_cost_ledger');
  recordAskCostDelta({ threadId: 'ask_00000001', messageId: 'askm_00000001',
    amountUsd: 0.123456, tokens: 1500, model: 'claude-opus-5', tsMs: 2000 });
  recordAskCostDelta({ threadId: 'ask_00000001', amountUsd: null, tsMs: 2001 }); // pre-result turn
  recordAskCostDelta({ threadId: 'ask_00000001', amountUsd: 0, tsMs: 2002 });    // mock
  recordAskCostDelta({ threadId: 'ask_00000001', amountUsd: -1, tsMs: 2003 });
  recordAskCostDelta({ threadId: '', amountUsd: 5, tsMs: 2004 });
  const rows = getDb().prepare('SELECT * FROM ask_cost_ledger ORDER BY id').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thread_id, 'ask_00000001');
  assert.equal(rows[0].message_id, 'askm_00000001');
  assert.equal(rows[0].amount_usd, 0.123456); // raw, unrounded
  assert.equal(rows[0].tokens, 1500);
  assert.equal(rows[0].model, 'claude-opus-5');
  assert.equal(rows[0].ts, 2000);
});

test('askWindowedSpendUsd: open-ended and bounded (toMs exclusive), 4dp rounding', () => {
  getDb().exec('DELETE FROM ask_cost_ledger');
  recordAskCostDelta({ threadId: 'ask_a', amountUsd: 0.11111, tsMs: 1000 });
  recordAskCostDelta({ threadId: 'ask_b', amountUsd: 0.2, tsMs: 2000 });
  assert.equal(askWindowedSpendUsd(1000), roundUsd(0.31111));
  assert.equal(askWindowedSpendUsd(1500), 0.2);
  assert.equal(askWindowedSpendUsd(1000, 2000), 0.1111, 'toMs is exclusive');
  assert.equal(askWindowedSpendUsd(3000), 0);
});

test('totalWindowSpendUsd + budgetStatus combine both ledgers; chat spend alone can block', async () => {
  getDb().exec('DELETE FROM cost_ledger');
  getDb().exec('DELETE FROM ask_cost_ledger');
  const now = local(2026, 8, 6, 12);
  await setCostLimitResetPeriod('weekly');
  await setTotalCostLimitUsd(1);
  const winStart = +costWindowStart(now, 'weekly');
  recordCostDelta({ pipelineId: 'p-combined', amountUsd: 0.4, tsMs: winStart + 1000 });
  recordAskCostDelta({ threadId: 'ask_a', amountUsd: 0.3, tsMs: winStart + 2000 });
  recordAskCostDelta({ threadId: 'ask_b', amountUsd: 0.9, tsMs: winStart - 1000 }); // previous window
  assert.equal(totalWindowSpendUsd(winStart), 0.7);
  const b = budgetStatus(now);
  assert.equal(b.windowSpendUsd, 0.7);
  assert.equal(b.blocked, false);
  assert.equal(b.remainingUsd, 0.3);
  recordAskCostDelta({ threadId: 'ask_a', amountUsd: 0.5, tsMs: winStart + 3000 });
  const b2 = budgetStatus(now);
  assert.equal(b2.windowSpendUsd, 1.2);
  assert.equal(b2.blocked, true, 'chat spend counts toward the total-limit block (D3)');
  // allTimeSpendUsd = pipelines-table sums + EVERY ask row (0.3 + 0.9 + 0.5)
  assert.ok(b2.allTimeSpendUsd >= 1.7);
  await setTotalCostLimitUsd('');
  await setCostLimitResetPeriod('monthly');
});
```

(If the suite's existing tests set a reset period, restore whatever value they expect afterward — check the file's final state conventions before choosing the closing `setCostLimitResetPeriod` value; `'monthly'` is the default.)

In `test/cost-enforcement.test.mjs`, add `recordAskCostDelta` to the `cost-budget.mjs` import (`:15`) and append after the total-cap test (`:113-123`):

```js
test('total cap trips from Ask Worca spend alone (count-everywhere D3)', async () => {
  clearLedger();
  getDb().exec('DELETE FROM ask_cost_ledger');
  await setTotalCostLimitUsd(2);
  const { orch } = await makeOrchWithPipeline({ status: 'running' });
  recordAskCostDelta({ threadId: 'ask_ffffffff', amountUsd: 2.5, tsMs: Date.now() });
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_total');
  await setTotalCostLimitUsd('');
  getDb().exec('DELETE FROM ask_cost_ledger');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/cost-budget.test.mjs test/cost-enforcement.test.mjs`
Expected: FAIL — `recordAskCostDelta` not exported; enforcement test fails (gate reads pipeline ledger only).

- [ ] **Step 3: Implement in `cost-budget.mjs`**

After `windowedSpendUsd` (`:55`), insert:

```js
/** Append one Ask Worca cost event (ask-cost-statistics-design.md §7.1). Same
 *  no-op gate as recordCostDelta: turns that ended before a `result` frame
 *  (amountUsd null, §6.2.8 of the ask spec) and $0 mock turns leave no row. */
export function recordAskCostDelta({ threadId, messageId = null, amountUsd,
                                     tokens = null, model = null, tsMs = Date.now() }) {
  if (!threadId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare(`INSERT INTO ask_cost_ledger (thread_id, message_id, amount_usd, tokens, model, ts)
    VALUES (?, ?, ?, ?, ?, ?)`).run(threadId, messageId, amountUsd, tokens, model, tsMs);
}

/** Windowed Ask Worca spend; toMs null = open-ended (budget windows), else ts < toMs. */
export function askWindowedSpendUsd(fromMs, toMs = null) {
  const row = toMs == null
    ? prepare('SELECT SUM(amount_usd) AS s FROM ask_cost_ledger WHERE ts >= ?').get(fromMs)
    : prepare('SELECT SUM(amount_usd) AS s FROM ask_cost_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
  return roundUsd(row?.s || 0);
}

/** Pipeline + Ask Worca spend since windowStartMs — THE enforcement figure
 *  (count-everywhere, ask-cost-statistics-design.md D3). windowedSpendUsd /
 *  allTimeTotals stay pipeline-only for the Statistics split. */
export function totalWindowSpendUsd(windowStartMs) {
  return roundUsd(windowedSpendUsd(windowStartMs) + askWindowedSpendUsd(windowStartMs));
}
```

In `budgetStatus()` (`:83-103`) change two lines:

```js
  const windowSpendUsd = totalWindowSpendUsd(windowStartMs);
```

and

```js
    allTimeSpendUsd: roundUsd(allTimeTotals().spendUsd + askWindowedSpendUsd(0)),
```

- [ ] **Step 4: Swap the orchestrator gate**

`src/core/orchestrator.mjs:63`: in the `cost-budget.mjs` import, replace `windowedSpendUsd` with `totalWindowSpendUsd`. At `:2543`:

```js
      const spent = totalWindowSpendUsd(costWindowStart(new Date(), period).getTime());
```

Verify no other `windowedSpendUsd` references remain in `src/`:

```bash
grep -rn "windowedSpendUsd" src/ | grep -v "askWindowedSpendUsd\|totalWindowSpendUsd\|cost-budget.mjs"
```

Expected: no output.

- [ ] **Step 5: Run to verify pass**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/cost-budget.test.mjs test/cost-enforcement.test.mjs test/budget-api.test.mjs test/cost-settings.test.mjs`
Expected: PASS (budget-api/cost-settings prove no regression — ask ledger is empty there, so combined == pipeline-only).

- [ ] **Step 6: Commit**

```bash
git add src/core/cost-budget.mjs src/core/orchestrator.mjs test/cost-budget.test.mjs test/cost-enforcement.test.mjs
git commit -m "worca: Count Ask Worca spend in budget totals and enforcement"
```

---

### Task 3: Turn write point

**Files:**
- Modify: `src/core/ask/turn.mjs` (import block `:18-28`; deps object `:58-81`; `_complete()` `:187-193`)
- Test: `test/ask-turn.test.mjs`

**Interfaces:**
- Consumes: `recordAskCostDelta` (Task 2), `summary = this.reducer.finish()` (`{usage:{input,output,cacheRead,cacheCreation}, costUsd, …}` — `events.mjs:411-433`), `this.model`, `d.now()`.
- Produces: dep `recordAskCost` on `AskTurn.deps` (default `recordAskCostDelta`, injectable in tests); one ledger row per costed turn.

- [ ] **Step 1: Write the failing tests**

In `test/ask-turn.test.mjs`: add to the imports `getDb` from `../src/core/db.mjs` (new import line) — `deleteThread` is already imported (`:12-14`). Add near the helpers:

```js
const clearAskLedger = () => getDb().exec('DELETE FROM ask_cost_ledger');
```

Append three tests (mirror the file's existing runClaudeImpl fakes — `say`/`push`/`RESULT` helpers at `:18-26`, stop shape at the R-C stop test):

```js
test('done turn appends one ask_cost_ledger row that survives thread deletion', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ onEvent }) => {
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());                 // total_cost_usd 0.05, usage 10/20/0/0
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  const rows = getDb().prepare('SELECT * FROM ask_cost_ledger ORDER BY id').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thread_id, s.thread.id);
  assert.equal(rows[0].message_id, s.asst.id);
  assert.equal(rows[0].amount_usd, 0.05);
  assert.equal(rows[0].tokens, 30);            // 10 + 20 + 0 + 0
  assert.equal(rows[0].model, 'claude-opus-5');
  assert.equal(typeof rows[0].ts, 'number');
  deleteThread(s.thread.id);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 1,
    'FK-free: the row survives the thread delete (D1)');
});

test('a turn that ends before a result leaves no ledger row', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ signal, onEvent }) => {
      say(onEvent, 'm1', 'partial');
      await waitAbort(signal);
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    },
  });
  const p = turn.run();
  setTimeout(() => turn.stop(), 5);
  await p;
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
    'costUsd null (no result frame) writes nothing (D2)');
});

test('thread deleted mid-turn: the ledger row is still written', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ onEvent }) => {
      deleteThread(s.thread.id);               // user deletes the chat while the turn runs
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  const rows = getDb().prepare('SELECT thread_id, amount_usd FROM ask_cost_ledger').all();
  assert.equal(rows.length, 1, 'spend is a financial fact even without the thread (D10)');
  assert.equal(rows[0].thread_id, s.thread.id);
  assert.equal(rows[0].amount_usd, 0.05);
});
```

(Adapt the stop test's fake to exactly match the existing stop test's `runClaudeImpl` shape in this file if it differs — the point under test is only "no result frame → no row".)

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/ask-turn.test.mjs`
Expected: the three new tests FAIL (`no such table` never — table exists; rows.length 0 ≠ 1); every pre-existing test still passes.

- [ ] **Step 3: Implement in `turn.mjs`**

3a. Import (after the `store.mjs` import at `:26-28`):

```js
import { recordAskCostDelta } from '../cost-budget.mjs';
```

3b. Deps object (`:58-81`), after the `newAskId` line:

```js
      recordAskCost: deps.recordAskCost ?? recordAskCostDelta,
```

3c. In `_complete()` (`turn.mjs:187-193`), directly after the `addThreadTotals` try/catch block (and before `this.status = finalStatus;`):

```js
    // D10: the spend is a financial fact even when the thread was deleted
    // mid-turn — sits OUTSIDE the store try/catches above so it is never
    // skipped; best-effort so a DB hiccup still settles the frames.
    try {
      d.recordAskCost({
        threadId: this.threadId, messageId: this.assistantMessageId,
        amountUsd: costUsd,                    // null → the writer no-ops (D2)
        tokens: ['input', 'output', 'cacheRead', 'cacheCreation']
          .reduce((a, k) => a + (Number(summary.usage?.[k]) || 0), 0),
        model: this.model, tsMs: d.now(),
      });
    } catch { /* ledger append is best-effort */ }
```

- [ ] **Step 4: Run to verify pass**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/ask-turn.test.mjs test/ask-store.test.mjs test/ask-api-messages.test.mjs`
Expected: PASS (api-messages uses the mock role, `total_cost_usd: 0` → no rows, nothing changes).

- [ ] **Step 5: Commit**

```bash
git add src/core/ask/turn.mjs test/ask-turn.test.mjs
git commit -m "worca: Record chat turn cost into ask_cost_ledger"
```

---

### Task 4: Stats payload — ask/pipeline split

**Files:**
- Modify: `src/core/stats.mjs` (import `:14-17`; new `askTotals` near `ledgerSpend` `:81-85`; `shapeTotals` `:138-147`; `all` branch `:150-158`; series `:168-175`)
- Test: `test/stats-api.test.mjs`

**Interfaces:**
- Consumes: `askWindowedSpendUsd` (Task 2), `ask_cost_ledger`.
- Produces (Task 5/6 render this): `getStats()` `totals` and `prev` each gain `pipelineSpendUsd: number` and `ask: {spendUsd: number, sessions: number, turns: number}`; `totals.spentUsd` and every `series[i].spentUsd` are combined (pipeline + ask). Route `GET /api/stats` (`ui/server.mjs:1699-1707`) is untouched — it serializes `getStats()` as-is.

- [ ] **Step 1: Update the failing tests**

In `test/stats-api.test.mjs`:

1a. Import: add `recordAskCostDelta` to the `cost-budget.mjs` import (`:17`).

1b. Extend `seedWorld()` (after the `recordCostDelta` lines at `:78-80`):

```js
  // ask ledger: this week — thread A twice, thread B once; prev week — thread A
  // again (a session counts in EVERY window it spent in, D6) + thread C
  recordAskCostDelta({ threadId: 'ask_aaaaaaaa', messageId: 'askm_00000001', amountUsd: 0.10,
    tokens: 1000, model: 'claude-opus-5', tsMs: +new Date(2026, 7, 3, 11) });
  recordAskCostDelta({ threadId: 'ask_aaaaaaaa', messageId: 'askm_00000002', amountUsd: 0.05,
    tokens: 500, model: 'claude-opus-5', tsMs: +new Date(2026, 7, 5, 11) });
  recordAskCostDelta({ threadId: 'ask_bbbbbbbb', messageId: 'askm_00000003', amountUsd: 0.25,
    tokens: 2000, model: 'claude-haiku-4-5', tsMs: +new Date(2026, 7, 4, 11) });
  recordAskCostDelta({ threadId: 'ask_aaaaaaaa', messageId: 'askm_00000004', amountUsd: 0.20,
    tokens: 800, model: 'claude-opus-5', tsMs: +new Date(2026, 6, 30, 11) });
  recordAskCostDelta({ threadId: 'ask_cccccccc', messageId: 'askm_00000005', amountUsd: 1,
    tokens: 900, model: 'claude-opus-5', tsMs: +new Date(2026, 6, 28, 11) });
```

1c. In the `range=week` test, update/extend the money assertions:

```js
  assert.equal(s.totals.spentUsd, 1.15);              // 0.75 pipeline + 0.40 ask
  assert.equal(s.totals.pipelineSpendUsd, 0.75);
  assert.deepEqual(s.totals.ask, { spendUsd: 0.4, sessions: 2, turns: 3 });
  assert.equal(s.prev.spentUsd, 3.2);                 // 2 + 1.2
  assert.equal(s.prev.pipelineSpendUsd, 2);
  assert.deepEqual(s.prev.ask, { spendUsd: 1.2, sessions: 2, turns: 2 });
```

(replacing the old `spentUsd, 0.75` and `prev.spentUsd, 2` lines at `:95/:97`) and the series lines:

```js
  assert.equal(s.series[0].spentUsd, 0.6);            // Mon: 0.5 pipeline + 0.10 ask
  assert.equal(s.series[1].spentUsd, 0.25);           // Tue: ask only
  assert.equal(s.series[2].spentUsd, 0.3);            // Wed: 0.25 pipeline + 0.05 ask
```

(the old `:102` `series[0].spentUsd, 0.5` and `:106` `series[2].spentUsd, 0.25` change; series[1] gains a spend assertion; its `finished/stopped` assertions stay).

1d. In the `range=all` test, replace `assert.ok(all.totals.spentUsd >= 3)` with:

```js
  assert.deepEqual(all.totals.ask, { spendUsd: 1.6, sessions: 3, turns: 5 });
  assert.ok(all.totals.pipelineSpendUsd >= 3);        // pipelines fallback sums (a:1 + d:2)
  assert.equal(all.totals.spentUsd, roundUsd(all.totals.pipelineSpendUsd + 1.6));
```

adding `roundUsd` to the `cost-budget.mjs` import.

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/stats-api.test.mjs`
Expected: FAIL — `totals.pipelineSpendUsd` undefined.

- [ ] **Step 3: Implement in `stats.mjs`**

3a. Import (`:14-17`): add `askWindowedSpendUsd` to the `cost-budget.mjs` list.

3b. After `ledgerSpend` (`:85`):

```js
/** Ask Worca window aggregate (ask-cost-statistics-design.md D5/D6): spend,
 *  DISTINCT sessions, turns. A thread is a session in every window it has a
 *  costed turn in. */
function askTotals(fromMs, toMs) {
  const row = prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) AS s,
           COUNT(DISTINCT thread_id)    AS sessions,
           COUNT(*)                     AS turns
    FROM ask_cost_ledger WHERE ts >= ? AND ts < ?`).get(fromMs, toMs);
  return { spendUsd: roundUsd(row?.s || 0), sessions: row?.sessions || 0, turns: row?.turns || 0 };
}
```

3c. `shapeTotals` (`:138-147`) becomes:

```js
  const shapeTotals = (fromMs, toMs) => {
    const c = windowTotalsFn(fromMs, toMs);
    const pipelineSpendUsd = ledgerSpend(fromMs, toMs);
    const ask = askTotals(fromMs, toMs);
    return {
      spentUsd: roundUsd(pipelineSpendUsd + ask.spendUsd),
      pipelineSpendUsd, ask,
      workedMs: c.workedMs,
      runs: c.runs, finished: c.finished, stopped: c.stopped, failed: c.failed,
      paused: c.paused, running: c.running,
      prsOpened: c.prsOpened, prsMerged: c.prsMerged,
    };
  };
```

3d. `range === 'all'` branch (`:150-158`):

```js
  if (range === 'all') {
    const at = allTimeTotals();
    const c = cohortTotals(0, windowEnd.getTime());
    const ask = askTotals(0, windowEnd.getTime());
    totals = {
      spentUsd: roundUsd(at.spendUsd + ask.spendUsd),
      pipelineSpendUsd: at.spendUsd, ask,
      workedMs: at.activeMs,
      runs: c.runs, finished: c.finished, stopped: c.stopped, failed: c.failed,
      paused: c.paused, running: c.running,
      prsOpened: c.prsOpened, prsMerged: c.prsMerged,
    };
  } else {
```

3e. Series map (`:172`):

```js
      spentUsd: roundUsd(ledgerSpend(startMs, endMs) + askWindowedSpendUsd(startMs, endMs)),
```

Also update the header comment (`stats.mjs:6`) — money attribution now reads
"money = cost_ledger + ask_cost_ledger by event timestamp (exact)".

- [ ] **Step 4: Run to verify pass**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/stats-api.test.mjs test/stats-today.test.mjs test/migrate-v16.test.mjs`
Expected: PASS (stats-today and migrate-v16 have empty ask ledgers — combined == pipeline-only).

- [ ] **Step 5: Commit**

```bash
git add src/core/stats.mjs test/stats-api.test.mjs
git commit -m "worca: Add ask/pipeline spend split to /api/stats"
```

---

### Task 5: Statistics cards — 6-tile KPI row

**Files:**
- Modify: `ui/public/stats-view.mjs` (`ICONS` `:57-62`; `renderKpiRow` `:128-194`)
- Modify: `ui/public/style.css:1573` (`.stat-row` grid)
- Test: `test/stats-view.test.mjs`

**Interfaces:**
- Consumes: `totals.pipelineSpendUsd`, `totals.ask`, `prev.pipelineSpendUsd`, `prev.ask` (Task 4 shape); existing `tile()/deltaChip()/subEl()` helpers.
- Produces: `renderKpiRow` returns 6 `.stat-tile`s in order Spent(0) · Pipeline spend(1) · Ask Worca(2) · Time worked(3) · Pipelines finished(4) · PRs merged(5). Missing new fields render zeros (never throw).

- [ ] **Step 1: Update the fixture + write the failing tests**

In `test/stats-view.test.mjs`:

1a. `MODEL` (`:19-26`) — extend both objects:

```js
const MODEL = {
  range: 'week',
  totals: { spentUsd: 12.34, pipelineSpendUsd: 10.34,
    ask: { spendUsd: 2, sessions: 4, turns: 10 },
    workedMs: 22320000, runs: 40, finished: 34, stopped: 5,
    failed: 1, paused: 0, running: 2, prsOpened: 18, prsMerged: 12 },
  prev: { spentUsd: 10, pipelineSpendUsd: 9, ask: { spendUsd: 1, sessions: 2, turns: 3 },
    workedMs: 20000000, runs: 30, finished: 30, stopped: 0,
    failed: 0, paused: 0, running: 0, prsOpened: 10, prsMerged: 8 },
  budget: BUDGET,
};
```

1b. Shift the existing index-based assertions (the 4 → 6 reorder, D4):
- `:31` → `assert.equal(tiles.length, 6);`
- `:36-39` `tiles[2]` → `tiles[4]` (Pipelines finished)
- `:40-41` `tiles[3]` → `tiles[5]` (PRs merged)
- `:49` `bolds(tiles[1])` → `bolds(tiles[3])` (Time worked); `:50` `tiles[2]` → `tiles[4]`; `:51` `tiles[3]` → `tiles[5]`

1c. Append new tests:

```js
test('renderKpiRow: Pipeline spend + Ask Worca cards (D4-D7)', () => {
  const tiles = renderKpiRow(MODEL, { doc }).querySelectorAll('.stat-tile');
  assert.equal(tiles.length, 6);
  // tile 1: pipeline-only money + share of the combined total
  assert.match(tiles[1].querySelector('.stat-label').textContent, /Pipeline spend/);
  assert.match(tiles[1].querySelector('.stat-value').textContent, /\$10\.34/);
  assert.equal(tiles[1].querySelector('.stat-sub').textContent, '84% of spend'); // 10.34/12.34
  assert.match(tiles[1].title, /not authoritative billing/);
  assert.ok(tiles[1].querySelector('.stat-delta'), 'delta vs prev.pipelineSpendUsd');
  // tile 2: chat money + sessions math
  assert.match(tiles[2].querySelector('.stat-label').textContent, /Ask Worca/);
  assert.match(tiles[2].querySelector('.stat-value').textContent, /\$2\.00/);
  assert.equal(tiles[2].querySelector('.stat-sub').textContent,
    '4 sessions · $0.50/session · 10 turns');
  assert.match(tiles[2].title, /not authoritative billing/);
  assert.ok(tiles[2].querySelector('.stat-delta'), 'delta vs prev.ask.spendUsd');
  // sub bolding: numeric tokens only
  const bolds = (t) => [...t.querySelectorAll('.stat-sub b')].map((b) => b.textContent);
  assert.deepEqual(bolds(tiles[1]), ['84']);
  assert.deepEqual(bolds(tiles[2]), ['4', '$0.50', '10']);
});

test('renderKpiRow: zero states for the new cards', () => {
  const zero = { ...MODEL, prev: null, totals: { ...MODEL.totals,
    spentUsd: 0, pipelineSpendUsd: 0, ask: { spendUsd: 0, sessions: 0, turns: 0 } } };
  const tiles = renderKpiRow(zero, { doc }).querySelectorAll('.stat-tile');
  assert.match(tiles[1].querySelector('.stat-sub').textContent, /no spend in this period/);
  assert.match(tiles[2].querySelector('.stat-sub').textContent, /no sessions in this period/);
  assert.match(tiles[2].querySelector('.stat-value').textContent, /\$0\.00/);
});

test('renderKpiRow: a payload without the new fields renders zeros, not a throw', () => {
  const legacy = { ...MODEL,
    totals: { ...MODEL.totals }, prev: { ...MODEL.prev } };
  delete legacy.totals.pipelineSpendUsd; delete legacy.totals.ask;
  delete legacy.prev.pipelineSpendUsd; delete legacy.prev.ask;
  const tiles = renderKpiRow(legacy, { doc }).querySelectorAll('.stat-tile');
  assert.equal(tiles.length, 6);
  assert.match(tiles[1].querySelector('.stat-value').textContent, /\$12\.34/,
    'pipelineSpendUsd falls back to spentUsd');
  assert.match(tiles[2].querySelector('.stat-sub').textContent, /no sessions in this period/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/stats-view.test.mjs`
Expected: FAIL — tile count 4, new tests throw/miss.

- [ ] **Step 3: Implement in `stats-view.mjs` + CSS**

3a. `ICONS` (`:57-62`) — add two 24×24 stroke paths in the existing glyph style:

```js
  pipeline: 'M12 3.2 20.5 8 12 12.8 3.5 8 12 3.2ZM3.5 12l8.5 4.8 8.5-4.8M3.5 16l8.5 4.8 8.5-4.8',
  ask: 'M12 19.6l-3.2-2.8H6.4A3.4 3.4 0 0 1 3 13.4V7.8a3.4 3.4 0 0 1 3.4-3.4h11.2A3.4 3.4 0 0 1 21 7.8v5.6a3.4 3.4 0 0 1-3.4 3.4h-2.4L12 19.6Z',
```

3b. In `renderKpiRow` (`:128-194`), immediately after the Spent `row.appendChild(tile(...))` block (`:150-161`), insert:

```js
  // Pipeline spend (D7): pipeline-only money; sub = share of the combined
  // total. Falls back to spentUsd when the payload predates the ask split.
  const pipeSpend = totals.pipelineSpendUsd ?? totals.spentUsd;
  row.appendChild(tile(doc, {
    iconD: ICONS.pipeline, label: 'Pipeline spend',
    chip: prev ? deltaChip(doc, pipeSpend, prev.pipelineSpendUsd, range) : null,
    valueNodes: [doc.createTextNode(fmt.usd(pipeSpend))],
    sub: totals.spentUsd > 0
      ? `${Math.round((pipeSpend / totals.spentUsd) * 100)}% of spend`
      : 'no spend in this period',
    title: fmt.estTitle(pipeSpend),
  }));

  // Ask Worca (D5/D6): chat spend; a session = a thread with a costed turn in
  // the range, so cost/session is window spend over that count.
  const ask = totals.ask || { spendUsd: 0, sessions: 0, turns: 0 };
  row.appendChild(tile(doc, {
    iconD: ICONS.ask, label: 'Ask Worca',
    chip: prev ? deltaChip(doc, ask.spendUsd, prev.ask?.spendUsd, range) : null,
    valueNodes: [doc.createTextNode(fmt.usd(ask.spendUsd))],
    sub: ask.sessions > 0
      ? `${ask.sessions} session${ask.sessions === 1 ? '' : 's'} · ${fmt.usd(ask.spendUsd / ask.sessions)}/session · ${ask.turns} turn${ask.turns === 1 ? '' : 's'}`
      : 'no sessions in this period',
    title: fmt.estTitle(ask.spendUsd),
  }));
```

3c. Update the row's doc comment (`:128`) to
`/** KPI row: Spent · Pipeline spend · Ask Worca · Time worked · Pipelines finished · PRs merged (D4). */`

3d. `style.css:1573`:

```css
.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px;}
```

(the `@media (max-width:1080px)` 2-column override at `:1654-1656` stays as-is).

- [ ] **Step 4: Run to verify pass**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/stats-view.test.mjs test/ui-theme.test.mjs test/ui-stats-chart-hover-css.test.mjs`
Expected: PASS. (If `ui-stats.test.mjs` runs here it may still pass — its fixture lacks the new fields, which the defensive defaults absorb; it is updated in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add ui/public/stats-view.mjs ui/public/style.css test/stats-view.test.mjs
git commit -m "worca: Add Pipeline spend and Ask Worca statistics cards"
```

---

### Task 6: Live refresh + fixtures + docs

**Files:**
- Modify: `ui/public/app.js:576-578` (ask-frame WS branch)
- Modify: `test/ui-stats.test.mjs` (`STATS_FIXTURE` `:18-32`; new test)
- Modify: `docs/storage.md` (the `ask/<threadId>/att/...` note, lines ~22-24)
- Test: `test/ui-stats.test.mjs`

**Interfaces:**
- Consumes: `loadStatsView()`, `refreshBudget()`, `currentView()` (all already in `app.js`); `ask-done` frame type (server-stamped).
- Produces: an open Statistics view refetches on every `ask-done`; the sidebar budget indicator repaints (combined spend moved).

- [ ] **Step 1: Update fixture + write the failing test**

In `test/ui-stats.test.mjs`:

1a. `STATS_FIXTURE.totals` (`:21-22`) becomes:

```js
  totals: { spentUsd: 3.5, pipelineSpendUsd: 3, ask: { spendUsd: 0.5, sessions: 2, turns: 4 },
    workedMs: 7200000, runs: 3, finished: 2, stopped: 1,
    failed: 0, paused: 0, running: 0, prsOpened: 1, prsMerged: 1 },
```

1b. Append:

```js
test('ask-done while stats open refetches; other ask-* frames do not', async () => {
  const { calls, wsBox, tick, showStats } = await boot();
  await showStats();
  const before = calls.length;
  wsBox.ws.dispatch('message', { data: JSON.stringify(
    { type: 'ask-usage', threadId: 'ask_00000000', messageId: 'askm_00000000', usage: {} }) });
  await tick();
  assert.equal(calls.length, before, 'ask-usage does not refetch');
  wsBox.ws.dispatch('message', { data: JSON.stringify(
    { type: 'ask-done', threadId: 'ask_00000000', messageId: 'askm_00000000',
      status: 'done', usage: {}, costUsd: 0.1, threadTotals: null }) });
  await tick();
  assert.ok(calls.length > before, 'ask-done refetches /api/stats (D12)');
});
```

(The frames carry a foreign `threadId` so `askPanel.pushServerFrame` ignores them; only the app.js branch under test reacts. If `pushServerFrame` throws on these stubs, match the frame shape the ask-panel tests use in `test/helpers/ask-frames.mjs` instead.)

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/ui-stats.test.mjs`
Expected: the new test FAILs (`calls.length` unchanged after ask-done); existing tests pass.

- [ ] **Step 3: Implement in `app.js`**

Replace the ask-frame branch (`app.js:576-579`):

```js
  if (typeof msg.type === 'string' && msg.type.startsWith('ask-')) {
    askPanel?.pushServerFrame(msg);
    // D12: a finished chat turn moves the combined spend — repaint the sidebar
    // indicator and, when open, the Statistics view.
    if (msg.type === 'ask-done') {
      refreshBudget();
      if (currentView() === 'stats') loadStatsView();
    }
    return;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --test test/ui-stats.test.mjs test/ui-ask-integration.test.mjs test/ui-cost.test.mjs test/ui-budget-indicator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Update `docs/storage.md`**

Replace the ask layout note (the three lines starting `ask/<threadId>/att/`):

```
  ask/<threadId>/att/<attachmentId>.txt  Ask Worca attachment bodies (threads, messages and
                                        run links live in the DB: ask_threads, ask_messages,
                                        ask_attachments, ask_run_links); removed with the thread.
                                        Chat spend is copied per turn into ask_cost_ledger
                                        (append-only, FK-free), so Statistics keeps session
                                        count and cost after deletion
```

- [ ] **Step 6: Commit**

```bash
git add ui/public/app.js test/ui-stats.test.mjs docs/storage.md
git commit -m "worca: Refresh stats on ask-done; document ask_cost_ledger"
```

---

### Task 7: Full-suite verification

**Files:** none

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | tail -15`
Expected: green, pass count = Task 0 baseline + the new tests (Task 1: +4, Task 2: +4, Task 3: +3, Task 4: net +0 files (edits), Task 5: +3, Task 6: +1 — roughly baseline +15; the exact figure comes from the run).

- [ ] **Step 2: Grep hygiene**

```bash
grep -rn "user_version, 18\|user_version = 18" test/ | grep -v migrate-v19
grep -rn "windowedSpendUsd" src/ | grep -v "askWindowedSpendUsd\|totalWindowSpendUsd\|cost-budget.mjs"
```

Expected: both empty.

- [ ] **Step 3: Report**

State the final pass count vs baseline, list the 6 commits, and flag any deviation taken. Do NOT merge, push, or open a PR — the user decides integration.

---

## Self-Review Notes (already applied)

- Spec D1–D12 → tasks: D1/D9 (Task 1), D2/D10/D11 (Tasks 2–3), D3 (Task 2 incl. the orchestrator gate at `orchestrator.mjs:2543`, found by the caller grep the spec §7.3 mandated), D4–D7 (Task 5), D8 (no code — Spent tile reads combined figures automatically), D12 (Task 6), §7.5 API (Task 4), §10 docs (Task 6), §11 no-flag rollout (Task 1 backfill).
- `EXPECTED_TABLES.length === 18` in `db.test.mjs:126` deliberately unchanged — that list has never included ledger/config tables (`cost_ledger`, `guardrail_sets`, `model_cost_flags`, ask tables are absent from it too).
- Type consistency: `recordAskCostDelta` / `askWindowedSpendUsd` / `totalWindowSpendUsd` / `askTotals` / `recordAskCost` (dep name) / `pipelineSpendUsd` / `ask.{spendUsd,sessions,turns}` used identically across Tasks 2–6.
