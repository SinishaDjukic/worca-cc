# Ask Worca cost in Statistics — design

Date: 2026-08-23. Status: approved for planning.
Baseline: branch `worca-cc/ask-worca-p3-frontend-implementation-plan-c8ffb9eb` (P1–P3 of
`2026-08-22-ask-worca-design.md` implemented: commits `1b02d87b`, `dbb47f68`, `cb8b1ff4`, `1074c7d8`).

## 1. Problem

Ask Worca chat spend is invisible to Statistics and dies with its thread. Cost lives only in
`ask_threads.totals` (JSON) and `ask_messages.cost_usd` (`src/core/db.mjs:557-605`); the delete
flow (`DELETE /api/ask/threads/:id` → `deleteThread`, `src/core/ask/store.mjs:142-147`) cascades
both away (`ON DELETE CASCADE` at `db.mjs:571/589/596`). `recordCostDelta` is called from exactly
one place — `orchestrator.mjs:3720` — so chat never reaches `cost_ledger`, the Statistics page, the
sidebar budget indicator, or budget enforcement.

The user wants: a Statistics card for Ask Worca runs (number of sessions, total cost,
cost per session, …), with the cost data — and the fact that each was a separate session —
**surviving chat-history deletion**.

## 2. Goals

- Chat spend recorded permanently, per turn, surviving thread deletion (and boot sweeps).
- Statistics KPI row gains an **Ask Worca** card (sessions · total cost · cost/session · turns)
  and a **Pipeline spend** card, so chat vs pipeline spend is distinguishable.
- Chat spend counts **everywhere** (user decision, 2026-08-23): overall Spent tile, spend chart,
  sidebar budget indicator, Settings budget readout, and **budget enforcement** totals.
- Backfill: cost already sitting in `ask_messages` at upgrade time is not lost.

## 3. Non-goals

- Blocking or pausing the **chat itself** on the total budget (per-turn caps from
  `ask/limits.mjs` remain the chat's only limiter — unchanged).
- Per-model or per-thread breakdown pages, a separate chat chart, stacked spend chart series.
- Recovering cost of threads deleted **before** this feature ships (data no longer exists).
- Any change to `ask_threads.totals` / the in-chat meters (P3 UI unchanged).

## 4. Supersession note

This spec **amends `2026-08-22-ask-worca-design.md`**: its §3 non-goal "Writing chat spend to
`cost_ledger` / Statistics" and the "nothing written to the ledger" half of locked **D5** are
reversed. The other half of D5 stands: chat cost still shows in-chat, and chat is never blocked
by the total budget. New consequence, accepted by the user: heavy chat spend now counts toward
the budget window, so it can trip the **pipeline** cost pause (`budgetStatus().blocked`).

## 5. Decisions (locked, user-approved 2026-08-23)

| # | decision |
|---|---|
| D1 | New **FK-free, append-only** table `ask_cost_ledger` (schema **v19**), mirroring `cost_ledger`'s "spend is a permanent financial fact and must survive any row surgery" (`db.mjs:527-538`). No FK to `ask_threads`; thread deletion never touches it. |
| D2 | **One row per completed turn with finite `costUsd > 0`** — same gate as `recordCostDelta` (`cost-budget.mjs:44-48`). Turns that end before a `result` frame (`costUsd:null`, §6.2.8 of the ask spec) and $0 mock turns write nothing. |
| D3 | **Count everywhere**: `budgetStatus()` window + all-time spend, Statistics `totals.spentUsd`, and every `series[].spentUsd` bucket sum **both** ledgers. Budget enforcement therefore includes chat spend (see §4). Chat itself is never gated. |
| D4 | KPI row grows 4 → **6 tiles**; `.stat-row` grid `repeat(4,1fr)` → `repeat(3,1fr)` (3+3 balanced; the ≤1080px 2-column override at `style.css:1654-1656` stays). Order: **Spent · Pipeline spend · Ask Worca · Time worked · Pipelines finished · PRs merged**. |
| D5 | **Ask Worca card**: value = chat spend in the selected range; delta chip vs previous window; sub `N sessions · $X/session · M turns` (numbers auto-bold via `subEl`), or `no sessions in this period` when 0; `fmt.estTitle` tooltip. |
| D6 | **Session** = thread with ≥1 ledger row in the window (`COUNT(DISTINCT thread_id)`); cost/session = window spend ÷ that count. A long-lived thread counts as a session in every window it spent money in. UI word is "session" (user's term; the chat UI's own "chats" wording is untouched). |
| D7 | **Pipeline spend card**: value = pipeline-only spend in range (existing `ledgerSpend`; `range=all` uses the fallback-aware `allTimeTotals().spendUsd`); delta chip; sub `NN% of spend` (of the combined total; `no spend in this period` when the total is 0); `fmt.estTitle` tooltip. |
| D8 | **Spent tile unchanged in form** — value/meter/sub semantics as today, now over combined figures (its `budget.windowSpendUsd` sub-line is combined too, automatically). |
| D9 | **v19 backfill**: synthesize one `ask_cost_ledger` row per existing `ask_messages` row with `cost_usd > 0` (ts = `Date.parse(created_at)`, tokens = usage sum, model) — v16 precedent (`db.mjs:779-803`), same guards (skip unparseable ts; probe columns first so hand-built DBs no-op). Self-heal recreates the table **empty** (same accepted behavior as `cost_ledger` on divergent stamps). |
| D10 | Writer `recordAskCostDelta` lives in `cost-budget.mjs` beside `recordCostDelta`. The turn writes it in `_complete()` immediately after `addThreadTotals` (`turn.mjs:187-192`), via an injectable dep — and **independently of thread existence** (a thread deleted mid-turn still spent the money). |
| D11 | `tokens` column = `input + output + cacheRead + cacheCreation` from the turn summary's usage. |
| D12 | Statistics view also refreshes on **`ask-done`** WS frames (today only `pipelines-changed` triggers it, `app.js:592-598`), so an open stats page tracks chat spend live. |

## 6. Data model (v19)

```sql
-- v19: append-only Ask Worca spend ledger. NO foreign key on thread_id: spend is a
-- permanent financial fact and must survive thread deletion (cost_ledger precedent).
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
```

Wiring (all in `src/core/db.mjs`, following the v15–v18 idioms):

- `SCHEMA_VERSION` 18 → **19** (`db.mjs:54`).
- `ASK_COST_LEDGER_DDL` const near `COST_LEDGER_DDL` (`db.mjs:529`), `IF NOT EXISTS` throughout
  (runs from both the ladder and the self-heal).
- Ladder: `if (current < 19) applySchemaV19(db)` after the v18 step (`db.mjs:854`).
  `applySchemaV19` = `repairSchemaGaps(db, schemaGaps(db))` first (v12–v16 shape), then the
  §D9 backfill guarded by `PRAGMA table_info(ask_messages)` probes.
- `schemaGaps()` gains an `askCostLedgerTable` flag (sqlite_master probe, `db.mjs:656-671`
  pattern); `repairSchemaGaps` executes the DDL (`db.mjs:683-685`); `reconcileSchema`'s clean-path
  condition includes the new flag (`db.mjs:701-702`).

Backfill query (inside `applySchemaV19`, JS loop like v16's):

```sql
SELECT id, thread_id, cost_usd, usage, model, created_at
FROM ask_messages
WHERE cost_usd > 0
  AND NOT EXISTS (SELECT 1 FROM ask_cost_ledger l WHERE l.message_id = ask_messages.id)
```

tokens = sum of the four usage fields from the `usage` JSON (null on parse failure), ts =
`Date.parse(created_at)` (skip row when not finite). The `NOT EXISTS` guard makes a re-run
(divergent stamp, partial upgrade) idempotent.

## 7. Accounting semantics

### 7.1 Writer — `src/core/cost-budget.mjs`

```js
/** Append one Ask Worca cost event. Same no-op gate as recordCostDelta:
 *  nothing on non-positive/non-finite amounts or a missing thread id. */
export function recordAskCostDelta({ threadId, messageId = null, amountUsd,
                                     tokens = null, model = null, tsMs = Date.now() }) {
  if (!threadId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare(`INSERT INTO ask_cost_ledger (thread_id, message_id, amount_usd, tokens, model, ts)
           VALUES (?, ?, ?, ?, ?, ?)`).run(threadId, messageId, amountUsd, tokens, model, tsMs);
}
```

### 7.2 Turn write point — `src/core/ask/turn.mjs`

In `_complete()` (`turn.mjs:171-209`), after the `addThreadTotals` try/catch (D10 — outside it,
never skipped by a deleted thread):

```js
d.recordAskCost({
  threadId: this.threadId, messageId: this.assistantMessageId,
  amountUsd: costUsd,                            // null → the writer no-ops (D2)
  tokens: ['input', 'output', 'cacheRead', 'cacheCreation']
    .reduce((a, k) => a + (Number(summary.usage?.[k]) || 0), 0),
  model: this.model, tsMs: d.now(),
});
```

Dep: `recordAskCost: deps.recordAskCost ?? recordAskCostDelta` in the deps object
(`turn.mjs:58-81`), imported from `cost-budget.mjs`. Tests inject a recorder.

Stop/error paths need no special casing: a SIGTERM stop has `costUsd:null` (no `result` frame) →
no row; a `max_turns`/`max_budget` stop DID spend → its `result` cost is recorded.

### 7.3 Budget — `src/core/cost-budget.mjs`

- New `askWindowedSpendUsd(fromMs, toMs = null)`: `SUM(amount_usd)` over `ask_cost_ledger`
  (`toMs` null = open-ended), `roundUsd`ed.
- `budgetStatus()` (`cost-budget.mjs:83-103`): `windowSpendUsd = roundUsd(windowedSpendUsd(start)
  + askWindowedSpendUsd(start))`; `allTimeSpendUsd = roundUsd(allTimeTotals().spendUsd +
  askWindowedSpendUsd(0))`. `blocked`/`remainingUsd` follow automatically → enforcement,
  sidebar indicator, Settings readout, and cost-pause banners are combined with **no shape
  change** to the payload.
- `windowedSpendUsd` / `allTimeTotals` themselves stay pipeline-only (the Pipeline card and the
  stats `all` fallback need them pure). Planning must grep their callers and keep any other
  call sites pipeline-scoped or move them to `budgetStatus()` — expected callers today:
  `budgetStatus` itself and `stats.mjs`.

### 7.4 Stats — `src/core/stats.mjs`

- New `askTotals(fromMs, toMs)` →
  `{ spendUsd, sessions, turns }` from one query:
  `SELECT COALESCE(SUM(amount_usd),0) s, COUNT(DISTINCT thread_id) sessions, COUNT(*) turns
   FROM ask_cost_ledger WHERE ts >= ? AND ts < ?` (`roundUsd` on `s`).
- `shapeTotals(fromMs, toMs)` (`stats.mjs:138-147`) returns, additionally:
  `pipelineSpendUsd: ledgerSpend(fromMs, toMs)`, `ask: askTotals(fromMs, toMs)`, and
  `spentUsd` becomes `roundUsd(pipelineSpendUsd + ask.spendUsd)`.
- `range=all` branch (`stats.mjs:150-158`): `pipelineSpendUsd = allTimeTotals().spendUsd`
  (fallback-aware, pre-ledger history), `ask = askTotals(0, windowEnd)`,
  `spentUsd = roundUsd(pipelineSpendUsd + ask.spendUsd)`.
- Series (`stats.mjs:168-175`): `spentUsd: roundUsd(ledgerSpend(a,b) + askWindowedSpendUsd(a,b))`
  per bucket — the one §7.3 function serves both budget (open-ended) and stats (bounded) callers.
- `prev` flows through `shapeTotals` → gets `pipelineSpendUsd` + `ask` for the delta chips.

Money attribution for chat = ledger `ts` (event-exact), identical to pipeline money — including
the `today` range.

### 7.5 API shape (`GET /api/stats`, route unchanged at `ui/server.mjs:1699-1707`)

`totals` and `prev` gain:

```
pipelineSpendUsd: number,
ask: { spendUsd: number, sessions: number, turns: number }
```

`totals.spentUsd` / `series[].spentUsd` become combined. `GET /api/budget` payload: same field
names, combined values (§7.3). No new endpoints.

## 8. Frontend (`ui/public/stats-view.mjs` + `style.css` + `app.js`)

- `ICONS` (`stats-view.mjs:57-62`) gains `pipeline` (stacked-layers glyph) and `ask`
  (chat-bubble glyph) — 24×24 stroke paths in the existing style.
- `renderKpiRow` (`stats-view.mjs:129-194`): two new `tile()` calls after Spent, per D4–D7.
  Defensive defaults `const ask = totals.ask || { spendUsd: 0, sessions: 0, turns: 0 }` and
  `totals.pipelineSpendUsd ?? totals.spentUsd` so a stale payload renders zeros, not a throw.
  Delta chips: `deltaChip(doc, totals.pipelineSpendUsd, prev.pipelineSpendUsd, range)` and
  `deltaChip(doc, ask.spendUsd, prev.ask?.spendUsd, range)` (deltaChip already null-guards).
  Cost/session formatted with `fmt.usd`.
- `.stat-row` grid → `repeat(3,1fr)` (`style.css:1573`); no other CSS.
- `app.js:592-598` WS refresh predicate: also reload the stats view on `ask-done` frames (D12).
- `renderStatsBody` untouched (KPI row is internal); the charts' empty-state predicate
  (`stats-view.mjs:558`) already keys off `series` spend, which now includes chat.

## 9. Testing (extends the existing suites; `npm test` green throughout)

| Suite | Additions/updates |
|---|---|
| `test/db.test.mjs` | `EXPECTED_TABLES` + `ask_cost_ledger` (count 18 → **19** at `:126`), `EXPECTED_INDEXES` + `idx_ask_cost_ledger_ts`, `user_version` pins 18 → 19 (`:137-141`, `:146`). |
| `test/ask-db-schema.test.mjs` | Version pins → 19 (`:25/:41/:50/:62`); new-table column/index pins; ladder v18 → 19 test; self-heal test (stamped-19 DB without the table); **backfill test**: v18 DB with costed + null-cost + bad-ts `ask_messages` rows → exactly the costed/parseable ones appear, idempotent on re-run. |
| `test/cost-budget.test.mjs` | `recordAskCostDelta` gate (no-ops on null/0/negative/missing id) + insert shape; `budgetStatus` combines both ledgers; chat spend alone can flip `blocked`. |
| `test/stats-api.test.mjs` | Seed ask ledger rows in `seedWorld` (this week + prev week, two threads, one thread spanning windows) → assert `totals.spentUsd` combined, `pipelineSpendUsd`, `ask.{spendUsd,sessions,turns}`, `prev.ask`, per-bucket combined series, `range=all` fallback + ask sums, sessions = DISTINCT threads per window. |
| `test/ask-turn.test.mjs` | Injected `recordAskCost` dep: called once with `{threadId, messageId, amountUsd, tokens, model}` on done; **not** called on a pre-result stop (`costUsd:null`); still called when the store throws (deleted thread). |
| `test/ask-store.test.mjs` (or new `ask-cost-ledger.test.mjs`) | Real-store integration: record → `deleteThread` → ledger row still there; `sweepEmptyThreads` untouched by ledger rows. |
| `test/stats-view.test.mjs` | Tile count 4 → 6 + index shifts (`:31-56` etc.); Ask card value/sub/cost-per-session math/empty state; Pipeline card share sub + zero state; delta chips from `prev.ask`; purity test still holds. `MODEL` fixture gains the new fields. |
| `test/ui-stats.test.mjs` | `STATS_FIXTURE` (`:18-32`) gains `pipelineSpendUsd` + `ask` (also serves `/api/budget`); tile-count smoke; D12 refresh-on-`ask-done` test. |
| `test/cost-enforcement.test.mjs` | One case: ask-ledger spend counts toward the total-limit pause gate. |

## 10. Docs

`docs/storage.md`: add `ask_cost_ledger` to the schema/table list with the survives-deletion note.

## 11. Rollout

No flag. v19 migrates + backfills on first boot; existing installs immediately see historical
chat spend (whatever threads still exist) in the new cards. Threads deleted before the upgrade
are unrecoverable (§3). Single implementation plan — no decomposition needed.
