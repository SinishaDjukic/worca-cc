# Cost Limits — Design Spec

- **Date:** 2026-08-06
- **Status:** Approved (design + spec), ready for implementation plan
- **Author:** Denislav Prinov (with Claude)

## 1. Goal

Introduce configurable **cost limits** for worca-cc pipelines, in USD:

1. **Per-pipeline limit** — a single pipeline may spend at most $X. When reached, that pipeline **pauses**.
2. **Total limit** — the sum of spend across **all** pipelines within a rolling calendar window may reach at most $Y. When reached: **all pipelines pause** and **creation of new pipelines is disabled**.
3. **Reset window** — the period over which the *total* budget accumulates before resetting. Configurable: `1`, `15`, or `30` days; default `30`.

Limits are configurable from the **UI settings panel**, the **CLI**, and the **REST API**.

## 2. Background (what already exists)

Confirmed by codebase exploration:

- **Cost signal exists end-to-end.** worca-cc parses Claude Code's `total_cost_usd` from the CLI `stream-json` `result` event (`src/core/claude-runner.mjs:490` `extractResultCost`), records it per step via `Orchestrator._recordCost(costUsd, stepKey)` (`src/core/orchestrator.mjs:3340`), maintains a live cumulative `state.totalCostUsd` (`orchestrator.mjs:336`, recomputed by `sumStepCosts` `:3537`), and persists `pipelines.total_cost_usd` (`src/core/db.mjs:245`) + `pipeline_steps.cost_usd` (`db.mjs:273`). **No pricing math or Anthropic SDK is involved** — the figure is Claude Code's own client-side estimate (the UI already labels it "not authoritative billing", `ui/public/app.js:1034`).
- **Pause/resume is mature.** `Orchestrator.pause()` (`orchestrator.mjs:399`) sets `pausing`, SIGTERMs the in-flight node child via `pauseAbort`, stops new-step dispatch through `_checkPause()` at the top of the `_dispatch()` loop (`orchestrator.mjs:1833`), builds a resume point, and lands on status `paused` (indefinite, never crash-swept — `artifacts.mjs:1064`). An **automatic pause-on-limit** precedent exists: `_pauseForLimit(node, err)` (`orchestrator.mjs:2247`), triggered reactively when Claude returns a `usage_limit` error (`recoverable-error.mjs:25`).
- **No central supervisor.** Each `Orchestrator` owns exactly one pipeline. The only live registry is the **process-local** `runs` Map in the UI server (`ui/server.mjs:129`) — it does not see CLI-driven runs. Cross-process coordination is via the **shared SQLite DB** (`~/.worca-cc/worca-cc.db`) plus heartbeat columns. **There is no existing "act on all pipelines" lever.**
- **Settings tiers.** Global machine-wide settings live in `src/core/settings.mjs` → `~/.worca-cc/settings.json` (optional keys, reader+setter pairs, atomic read-modify-write). REST surface is `GET/POST /api/settings` (`ui/server.mjs:1684-1708`, thin delegation). UI panel is the `data-view="settings"` section (`ui/public/index.html:895`, wired by `loadSettings`/`paintSettings`/`saveSettings` in `ui/public/app.js`). **There is no `worca config` CLI subcommand today** — that surface is net-new.
- **Guardrails are not usage limits.** Guardrails are spawn-time permission/env rules (no counters, no runtime accumulation check). Their **storage/REST/UI/settings patterns are copyable**, but there is no enforcement analog to extend. Cost limits therefore live in **global settings**, not per-run guardrails.

## 3. Decisions

Locked with the user:

1. **Per-pipeline limit is a lifetime cap** (across pauses/resumes), **not** windowed. Only the *total* budget uses the reset window. On hit, the pipeline pauses and the user gets a **"Continue without cap (this pipeline)"** action that sets a persistent per-pipeline override so that pipeline ignores the per-pipeline cap thereafter.
2. **Manual resume** after a reset or a limit increase. Cost-paused pipelines are **never auto-resumed**; the reset only re-enables creation and makes manual resume possible.
3. **Global scope only.** One machine-wide set of limits applies to every pipeline. No per-run override picker.

Assumed (stated to user, not objected to):

4. **Local timezone** for all calendar boundaries (start of day / 1st / 15th).
5. **Hard-pause only for v1** — no pre-warning threshold banner (e.g. 80%). Deferred as a future enhancement.

## 4. Non-goals

- No per-run or per-project cost limits (global only).
- No pre-warning / soft-threshold alerting in v1.
- No pricing computation from tokens; we consume Claude Code's `total_cost_usd` as-is.
- No auto-resume of paused pipelines.
- No total-limit bypass equivalent to the per-pipeline override — the total cap is absolute; to proceed the user raises the total limit or waits for reset.
- No backfill of historical spend into the new ledger (windowed accounting starts empty).

## 5. Requirements

### Functional

- **F1** Configurable `pipelineCostLimitUsd` (positive number, or unset = unlimited).
- **F2** Configurable `totalCostLimitUsd` (positive number, or unset = unlimited).
- **F3** Configurable `costLimitResetPeriodDays` ∈ {1, 15, 30}, default 30.
- **F4** A running pipeline pauses at the next step boundary when its own lifetime spend ≥ `pipelineCostLimitUsd`, unless that pipeline's override flag is set.
- **F5** All running pipelines pause at their next step boundary when windowed total spend ≥ `totalCostLimitUsd`. This applies regardless of the per-pipeline override.
- **F6** While windowed total spend ≥ `totalCostLimitUsd`, creating a new pipeline is refused (UI + CLI + REST).
- **F7** The per-pipeline pause exposes a "Continue without cap (this pipeline)" action (UI button, CLI `--ignore-cost-cap`, REST endpoint) that sets a persistent override and allows resume.
- **F8** Windowed total spend resets on calendar boundaries per the configured period (see §7). Reset re-enables creation; it does not auto-resume.
- **F9** Raising a limit (or lowering spend by reset) takes effect at the next enforcement point without restart (settings read live).
- **F10** Limits are opt-in: any unset limit means "no limit" (backward compatible; existing installs behave unchanged).

### Non-functional

- **N1** Enforcement is correct across processes (CLI and UI running concurrently) via the shared DB.
- **N2** Overshoot is bounded to at most one node's cost (limits are checked at step boundaries; a live Claude call cannot be interrupted to the exact dollar). This is documented behavior.
- **N3** The accounting mechanism must not require a cron/scheduler and must be race-safe across processes.

## 6. Architecture

### 6.1 Accounting mechanism — append-only delta ledger (chosen)

Rejected alternatives: a mutable accumulator row with a reset job (cross-process read-modify-write races; reset tangled into the write path) and deriving windowed spend from existing step costs (steps are delete/re-inserted on every persist with no stable per-cost-event timestamp).

Chosen: an **append-only ledger**. Each cost event appends the **delta** added to the pipeline's cumulative spend. "Spend this window" is a pure query `SUM(amount_usd) WHERE ts >= windowStart`. Reset is a pure function of time — no mutation, no scheduler, no race — and the ledger is auditable.

Recording the **delta** (`newTotal − prevTotal`) rather than the raw event value makes the ledger correct regardless of whether `_recordCost` treats its argument as per-event or cumulative; the implementer verifies the exact `_recordCost` semantics under test.

### 6.2 New core module `src/core/cost-budget.mjs`

Centralizes all budget logic (unit-testable, pure where possible):

- `costWindowStart(now, periodDays)` → epoch millis of the current window's start (local tz; see §7).
- `costWindowEnd(now, periodDays)` → epoch millis of the next boundary (for display).
- `windowedSpendUsd(db, windowStartMs)` → `SUM(amount_usd)` from `cost_ledger` where `ts >= windowStartMs`.
- `recordCostDelta(db, pipelineId, deltaUsd, tsMs)` → append a ledger row (skip when `deltaUsd <= 0`).
- `budgetStatus()` → reads settings + DB and returns `{ periodDays, windowStartMs, windowEndMs, spentUsd, totalLimitUsd, perPipelineLimitUsd, blocked }` where `blocked = totalLimitUsd != null && spentUsd >= totalLimitUsd`. Shared by the UI, REST, and the creation gate so all three agree.

### 6.3 Data model (new DB migration, next version after current head)

- `cost_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, pipeline_id TEXT, amount_usd REAL NOT NULL, ts INTEGER NOT NULL)` with index on `ts`. **Append-only**; **not** cascade-deleted when a pipeline is deleted (the spend still happened and must count toward the window). `ts` is epoch millis for unambiguous integer range comparison.
- `pipelines.cost_cap_override INTEGER NOT NULL DEFAULT 0` — the per-pipeline "disregard the per-pipeline cap" flag (F7). Read into pipeline state, written by the ignore-cost-cap action.
- **Pause reason** persisted so the UI can explain a paused pipeline after a process restart: store `pauseReason` (`'cost_pipeline' | 'cost_total'` and the existing `'usage_limit'`) inside the JSON `resume_point` (`orchestrator.mjs:_buildResumePoint`) and surface it on the pipeline wire shape.

### 6.4 Settings (global — `src/core/settings.mjs`)

All optional; unset = unlimited / default.

- `pipelineCostLimitUsd` — positive finite number, or unset. Numeric idiom (mirror `contextMaxBytesPerFile` reader/setter: reader falls back loudly, setter throws on invalid, deletes key on empty).
- `totalCostLimitUsd` — positive finite number, or unset. Same idiom.
- `costLimitResetPeriodDays` — enum `1 | 15 | 30`, default `30`. Enum idiom (mirror `skillMount`: allowed-list constant, reader validates + loud fallback, setter throws on invalid).

### 6.5 Enforcement (orchestrator)

- **Ledger write:** in `_recordCost()` (`orchestrator.mjs:3340`), after recomputing `state.totalCostUsd`, append the delta to the ledger via `recordCostDelta(db, this.pipelineId, delta, now)`.
- **Boundary check:** new `_checkCostLimits()` invoked immediately after `_checkPause()` in `_dispatch()` (`orchestrator.mjs:1833`). It reads settings **fresh** each boundary (cheap sync read, so a raised limit takes effect at the next step):
  1. If `pipelineCostLimitUsd` set AND `cost_cap_override` is false AND `state.totalCostUsd >= pipelineCostLimitUsd` → set `pauseReason='cost_pipeline'` and pause.
  2. If `totalCostLimitUsd` set AND `windowedSpendUsd() >= totalCostLimitUsd` → set `pauseReason='cost_total'` and pause.
- Pausing reuses the existing `pause()` path (SIGTERM in-flight child, resume point, status `paused`) — modeled on `_pauseForLimit`. Each orchestrator self-checks, so "pause all" emerges without a supervisor and works cross-process.
- The per-pipeline override bypasses **only** check (1). Check (2) (total) is absolute.

### 6.6 Creation gate

A shared helper (from `cost-budget.mjs`, e.g. `budgetStatus().blocked`) is consulted at both entry points:

- **REST:** `POST /api/run` (`ui/server.mjs`) refuses with HTTP 403 and a message `{ error, budget }` when blocked.
- **CLI:** `worca add` (`src/cli/worca-cc.mjs`) prints an error naming the limit and reset date, and exits non-zero.

Per-pipeline caps never block creation (only the total does).

### 6.7 Config surfaces

- **REST**
  - `GET /api/settings` — add `pipelineCostLimitUsd`, `totalCostLimitUsd`, `costLimitResetPeriodDays` to `settingsState()` (`ui/server.mjs:1684`).
  - `POST /api/settings` — add `has('...')` branches delegating to the new setters (`ui/server.mjs:1693`), 400 on setter throw.
  - `GET /api/budget` — returns `budgetStatus()` for the UI banner and gating.
  - Include budget status in the WebSocket `state` broadcast (`ui/server.mjs:245`) so the UI updates live.
  - `POST /api/runs/:id/ignore-cost-cap` — sets `cost_cap_override=1` for that pipeline (the "Continue without cap" action); the client then calls the existing resume endpoint.
- **CLI (net-new `worca config` subcommand)** — register `config` in `SUBCOMMANDS` (`src/cli/worca-cc.mjs:1175`) + dispatch in `main()`:
  - `worca config` — list current values.
  - `worca config get <key>` / `set <key> <value>` / `unset <key>` for the three keys (accept friendly aliases, e.g. `pipeline-cost-limit`, `total-cost-limit`, `cost-reset-period`).
  - `worca resume <id> --ignore-cost-cap` — sets the override flag then resumes (mirrors the UI button).
  - `worca add` — refused when total-blocked (§6.6).
- **UI settings panel** (`ui/public/index.html` settings card + `ui/public/app.js`)
  - Three controls: two numeric inputs (per-pipeline, total) and a select (reset period 1/15/30), wired through `paintSettings`/`saveSettings` like `projectsRoot`.
  - A **budget readout**: spent / total limit / reset date, from `GET /api/budget` (and live via WS).
  - **New-pipeline button disabled** when `budget.blocked`, with an inline reason.
  - **Paused-pipeline surfacing:** show the pause reason; for `cost_pipeline`, render a "Continue without cap (this pipeline)" button (→ `ignore-cost-cap` then resume); for `cost_total`, render "Total budget reached — raise limit or wait until \<reset date\>" (resume stays disabled while total remains over).

## 7. Reset semantics (window math)

Calendar-aligned, **local timezone**, per the user's exact rules. `costWindowStart(now, periodDays)`:

- **`periodDays = 1`** → start of the current day (today 00:00 local). Resets every midnight.
- **`periodDays = 15`** → if `now`'s day-of-month `< 15` → the 1st at 00:00; else → the 15th at 00:00. Resets on the 1st and the 15th of each month (two windows per month; the second is 15–17 days depending on month length — intentional).
- **`periodDays = 30`** → the 1st of the current month at 00:00. Resets on the 1st of every month.

Windowed spend = `SUM(cost_ledger.amount_usd) WHERE ts >= costWindowStart(now, period)`. Because the window start is derived purely from `now`, a reset requires **no** stored anchor, no mutation, and no scheduled job — the sum simply excludes older rows once the boundary passes.

`costWindowEnd` (for display of the reset date) is the next corresponding boundary: next midnight (1); the 15th or the 1st-of-next-month (15); the 1st of next month (30).

## 8. Edge cases

- **Opt-in / backward compat:** all limits unset → behavior identical to today (F10). Existing installs: new settings absent, new columns default to 0/empty, ledger empty.
- **Bounded overshoot (N2):** the check runs at step boundaries; the currently-running node finishes (or is SIGTERMed by `pause()`), so total spend can exceed a cap by at most one node's cost.
- **Cross-process race:** two pipelines near the total cap may each overshoot by one node before both observe the sum crossing — acceptable and bounded. SQLite WAL handles concurrent readers.
- **Override scope:** `cost_cap_override` disables only the per-pipeline cap for that one pipeline; it never bypasses the total cap.
- **Deleted pipelines:** their ledger rows remain (spend counts toward the window); ledger is not cascade-deleted.
- **Limit lowered below current spend:** at the next boundary, running pipelines pause (per-pipeline) / all pause (total); creation is gated. No retroactive kill of in-flight nodes beyond the normal pause SIGTERM.
- **Limit raised / window reset while paused:** creation re-enables automatically; paused pipelines stay paused until manually resumed (F8, decision 2).
- **Zero / negative / non-numeric input:** setters throw (reads never throw, fall back). Empty input clears the key (unlimited).
- **Estimate caveat:** limits act on Claude Code's client-side cost estimate, not authoritative billing — surfaced in the UI near the controls.

## 9. Testing strategy (TDD)

- **`cost-budget` unit tests:** `costWindowStart`/`costWindowEnd` for periods 1/15/30 across boundary dates — day 14 vs 15, the 1st, month-end, December→January rollover, and leap-year Feb; `windowedSpendUsd` sum correctness; `budgetStatus().blocked` thresholds (unset, under, at, over).
- **Ledger:** `_recordCost` appends the correct **delta**; no double counting on repeated events; no row for non-positive deltas.
- **Orchestrator enforcement:** per-pipeline cap → pause with `pauseReason='cost_pipeline'`; override set → no pause; total cap (seeded ledger) → pause with `pauseReason='cost_total'`; total pause fires even with per-pipeline override set.
- **Settings:** reader fallbacks + setter validation (positive number; enum 1/15/30; empty clears) for all three keys.
- **REST:** `GET/POST /api/settings` roundtrip for the three keys; `GET /api/budget` shape; `POST /api/run` returns 403 when blocked; `ignore-cost-cap` sets the flag.
- **CLI:** `worca config get/set/unset` for the three keys; `worca resume --ignore-cost-cap` sets override + resumes; `worca add` refused when total-blocked.
- **UI:** settings controls paint/save; create button disabled + reason when blocked; paused pipeline renders reason and the correct action per reason.

## 10. Rollout / migration notes

- One additive DB migration: create `cost_ledger` (+ `ts` index) and add `pipelines.cost_cap_override`. No data backfill.
- All settings optional; no config migration needed (unknown keys already survive the read-modify-write in `settings.mjs`).
- Feature is inert until a user sets a limit, so it can ship dark and be enabled per-machine.
