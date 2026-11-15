// src/core/cost-budget.mjs
// Budget accounting for cost limits (spec docs/superpowers/specs/2026-08-07-
// cost-limits-stats-design.md §6.1-6.2). Window boundaries are pure functions
// of `now` in the LOCAL calendar — no stored anchor, no scheduler; reset means
// old ledger rows fall out of the SUM. Ledger rows are appended per cost event
// (raw floats); roundUsd applies to aggregated outputs only.

import { prepare } from './db.mjs';
import {
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
  COST_RESET_PERIODS, DEFAULT_COST_RESET_PERIOD,
} from './settings.mjs';

/** A run's human hours for the Saved figures: a mock run (pipelines.run_setup) saved nobody any work. SQL over alias `p`. */
export const REAL_RUN_HOURS = `CASE WHEN json_extract(CASE WHEN json_valid(p.run_setup) THEN p.run_setup END, '$.mock') = 1 THEN 0 ELSE p.human_hours END`;

export { COST_RESET_PERIODS, DEFAULT_COST_RESET_PERIOD };

/** Round a USD amount to 4 decimal places — the same grain as the orchestrator's
 *  own roundUsd, but not the same function: this one adds an EPSILON nudge (a value
 *  sitting one float-ulp below a rounding boundary goes up) and takes a number,
 *  where the orchestrator's coerces with `Number(n) || 0`. */
export function roundUsd(n) {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/** Start of the current budget window (local calendar). Calendar-component
 *  Date constructors keep boundaries at local midnight through DST. */
export function costWindowStart(now = new Date(), period = DEFAULT_COST_RESET_PERIOD) {
  if (period === 'weekly') {
    const sinceMonday = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Next reset boundary (exclusive end of the current window). */
export function costWindowEnd(now = new Date(), period = DEFAULT_COST_RESET_PERIOD) {
  const s = costWindowStart(now, period);
  return period === 'weekly'
    ? new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7)
    : new Date(s.getFullYear(), s.getMonth() + 1, 1);
}

/** Append one cost event. No-ops on non-positive amounts (mock runs emit $0)
 *  and on a missing pipeline id. */
export function recordCostDelta({ pipelineId, stepKey = null, amountUsd, tsMs = Date.now() }) {
  if (!pipelineId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare('INSERT INTO cost_ledger (pipeline_id, step_key, amount_usd, ts) VALUES (?, ?, ?, ?)')
    .run(pipelineId, stepKey, amountUsd, tsMs);
}

/** Windowed spend: roundUsd(SUM(amount_usd)) where ts >= windowStartMs. */
export function windowedSpendUsd(windowStartMs) {
  const row = prepare('SELECT SUM(amount_usd) AS s FROM cost_ledger WHERE ts >= ?')
    .get(windowStartMs);
  return roundUsd(row?.s || 0);
}

/** Append one Ask Worca cost event (ask-cost-statistics-design.md §7.1). Same
 *  no-op gate as recordCostDelta: turns that ended before a `result` frame
 *  (amountUsd null, §6.2.8 of the ask spec) and $0 mock turns leave no row.
 *  messageId is the v20 backfill's idempotency key (db.mjs NOT EXISTS on
 *  l.message_id) — every live caller must pass it. */
export function recordAskCostDelta({ threadId, messageId = null, amountUsd,
                                     tokens = null, model = null, tsMs = Date.now() }) {
  if (!threadId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare(`INSERT INTO ask_cost_ledger (thread_id, message_id, amount_usd, tokens, model, ts)
    VALUES (?, ?, ?, ?, ?, ?)`).run(threadId, messageId, amountUsd, tokens, model, tsMs);
}

/** Append one utility cost event: spend with no run behind it (Smart run naming, kind 'naming'). Never touches
 *  cost_ledger, so it is not billed to a run and does not count toward a budget. A $0 or unpriced result leaves no row. */
export function recordUtilityCost(kind, { costUsd, usage = null, model = null, tsMs = Date.now() } = {}) {
  if (!kind || !Number.isFinite(costUsd) || costUsd <= 0) return;
  prepare(`INSERT INTO utility_cost_ledger (kind, amount_usd, tokens_in, tokens_out, model, ts)
    VALUES (?, ?, ?, ?, ?, ?)`).run(kind, costUsd, usage?.input_tokens ?? null, usage?.output_tokens ?? null, model, tsMs);
}

/** Utility spend per kind in [fromMs, toMs): { naming: { usd, count } }. */
export function utilityTotals(fromMs, toMs) {
  const rows = prepare(`SELECT kind, COALESCE(SUM(amount_usd), 0) AS s, COUNT(*) AS n
    FROM utility_cost_ledger WHERE ts >= ? AND ts < ? GROUP BY kind`).all(fromMs, toMs);
  const out = { naming: { usd: 0, count: 0 } };
  for (const r of rows) out[r.kind] = { usd: roundUsd(r.s || 0), count: r.n || 0 };
  return out;
}

/** Windowed Ask Worca spend; toMs null = open-ended (budget windows), else ts < toMs. */
export function askWindowedSpendUsd(fromMs, toMs = null) {
  const row = toMs == null
    ? prepare('SELECT SUM(amount_usd) AS s FROM ask_cost_ledger WHERE ts >= ?').get(fromMs)
    : prepare('SELECT SUM(amount_usd) AS s FROM ask_cost_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
  return roundUsd(row?.s || 0);
}

/** Append one requirements cost event (plans/requirements-design.md D9): an orientation pass or an
 *  interview round (`featureSeq`, with its `turnId`), or a product brief look (A7: `featureSeq` 0 and the
 *  brief's `briefId`); A8 adds `attachmentId` for a file's read or ask, under its feature or its brief; A3 adds
 *  `helperMessageId` for a Feature chat call (no turn). 9c adds the harness (`engine`), the `step`, the `costKind`
 *  ('billed' | 'estimated' | 'unknown') and the token counts; an 'unknown' call books a $0 row, nothing else books below it. Same no-op gate as the other ledgers ($0 mock calls leave no row). */
export function recordRequirementsCostDelta({ featureSeq = 0, briefId = null, turnId = null, attachmentId = null, helperMessageId = null, amountUsd,
  model = null, tsMs = Date.now(), engine = null, step = null, costKind = 'billed', inputTokens = null, outputTokens = null }) {
  if (!featureSeq && !briefId) return;
  const unknown = costKind === 'unknown';
  if (unknown) amountUsd = 0;   // 9c: a harness that reports no cost is booked as $0 'unknown', counted apart, never as spend
  else if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare(`INSERT INTO req_cost_ledger (feature_seq, brief_id, turn_id, attachment_id, helper_message_id, amount_usd, model, ts,
      engine, step, cost_kind, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(featureSeq || 0, briefId || null, turnId, attachmentId || null, helperMessageId == null ? null : Number(helperMessageId), amountUsd, model, tsMs,
      engine || null, step || null, costKind || 'billed', Number.isFinite(inputTokens) ? inputTokens : null, Number.isFinite(outputTokens) ? outputTokens : null);
}

/** Windowed requirements spend; toMs null = open-ended (budget windows), else ts < toMs. */
export function requirementsWindowedSpendUsd(fromMs, toMs = null) {
  const row = toMs == null
    ? prepare('SELECT SUM(amount_usd) AS s FROM req_cost_ledger WHERE ts >= ?').get(fromMs)
    : prepare('SELECT SUM(amount_usd) AS s FROM req_cost_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
  return roundUsd(row?.s || 0);
}

/** Append one Design cost event (design SPEC C-9): one agent's spend in one build of one design. Design has no
 *  limit of its own (M13); this row counts toward worca's own limits. Same no-op gate as the other ledgers
 *  ($0 mock calls and a missing design id leave no row). */
export function recordDesignCostDelta({ designId, buildId = null, agentId = null, amountUsd, model = null, tsMs = Date.now() }) {
  if (!designId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare(`INSERT INTO design_cost_ledger (design_id, build_id, agent_id, amount_usd, model, ts)
    VALUES (?, ?, ?, ?, ?, ?)`).run(designId, buildId, agentId, amountUsd, model, tsMs);
}

/** Windowed Design spend; toMs null = open-ended (budget windows), else ts < toMs. */
export function designWindowedSpendUsd(fromMs, toMs = null) {
  const row = toMs == null
    ? prepare('SELECT SUM(amount_usd) AS s FROM design_cost_ledger WHERE ts >= ?').get(fromMs)
    : prepare('SELECT SUM(amount_usd) AS s FROM design_cost_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
  return roundUsd(row?.s || 0);
}

/** Pipeline + Ask Worca + requirements + Design spend since windowStartMs — THE enforcement figure
 *  (count-everywhere, ask-cost-statistics-design.md D3; requirements-design.md D9; Design M13). windowedSpendUsd /
 *  allTimeTotals stay pipeline-only for the Statistics split. */
export function totalWindowSpendUsd(windowStartMs) {
  return roundUsd(windowedSpendUsd(windowStartMs) + askWindowedSpendUsd(windowStartMs)
    + requirementsWindowedSpendUsd(windowStartMs) + designWindowedSpendUsd(windowStartMs));
}

/** All-time spend + active time over ALL pipelines (archived included),
 *  falling back to per-step sums when the row total is 0. */
export function allTimeTotals() {
  const row = prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN p.total_cost_usd  > 0 THEN p.total_cost_usd  ELSE COALESCE(s.sc, 0) END), 0) AS spend,
      COALESCE(SUM(CASE WHEN p.total_active_ms > 0 THEN p.total_active_ms ELSE COALESCE(s.sa, 0) END), 0) AS active,
      COALESCE(SUM(${REAL_RUN_HOURS}), 0) AS humanHours
    FROM pipelines p
    LEFT JOIN (SELECT pipeline_id, SUM(cost_usd) sc, SUM(active_ms) sa
               FROM pipeline_steps GROUP BY pipeline_id) s ON s.pipeline_id = p.id
  `).get();
  return { spendUsd: roundUsd(row?.spend || 0), activeMs: Number(row?.active || 0), humanHours: Math.round(Number(row?.humanHours || 0) * 100) / 100 };
}

/** True when this pipeline ignores the per-pipeline cap (persistent, F7). */
export function readCostCapOverride(pipelineId) {
  const row = prepare('SELECT cost_cap_override FROM pipelines WHERE id = ?').get(pipelineId);
  return !!row?.cost_cap_override;
}

/** The cap raised for one run (Raise the cap), in USD, or null when the settings cap applies. */
export function readRunCostCap(pipelineId) {
  const v = prepare('SELECT cost_cap_usd FROM pipelines WHERE id = ?').get(pipelineId)?.cost_cap_usd;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
/** Store a run's raised cap; it replaces any "continue without cap" override, so the run is held to the new cap. */
export function setRunCostCap(pipelineId, usd) {
  prepare('UPDATE pipelines SET cost_cap_usd = ?, cost_cap_override = 0 WHERE id = ?').run(Number(usd), pipelineId);
}
/** The run cap's checks for `POST /api/run` and `POST /api/resume` `costCapUsd`: → { cap: number|null, error?: string }. `spent`: the run's spend. */
export function runCostCapCheck(costCapUsd, { ignoreCostCap = false, spent = 0 } = {}) {
  if (costCapUsd === undefined || costCapUsd === null) return { cap: null };
  if (typeof costCapUsd !== 'number' || !Number.isFinite(costCapUsd) || costCapUsd <= 0) return { cap: null, error: 'costCapUsd must be a number above 0' };
  if (ignoreCostCap === true) return { cap: null, error: 'costCapUsd and ignoreCostCap cannot be combined' };
  const s = Number(spent || 0);
  if (costCapUsd <= s) return { cap: null, error: `The new cap must be above what this task has spent ($${s.toFixed(2)}).` };
  return { cap: costCapUsd };
}
/** Every resume gate passed: store the raised cap (it replaces any override) and hand it to the run's harness, built before. */
export function raiseRunCostCap(orch, pipelineId, usd) {
  setRunCostCap(pipelineId, usd);
  if (orch) { orch.runCostCapUsd = usd; if (orch.state) orch.state.pipelineCapUsd = usd; }
}
/** Set the persistent per-pipeline "disregard the cap" flag. */
export function setCostCapOverride(pipelineId) {
  prepare('UPDATE pipelines SET cost_cap_override = 1 WHERE id = ?').run(pipelineId);
}

/** One shared truth for gates, CLI, and every UI badge (spec §6.1). */
export function budgetStatus(now = new Date(), { scope = null } = {}) {
  const resetPeriod = costLimitResetPeriod();
  const pipelineLimitUsd = pipelineCostLimitUsd(scope);
  const totalLimitUsd = totalCostLimitUsd();
  const windowStartMs = costWindowStart(now, resetPeriod).getTime();
  const windowEndMs = costWindowEnd(now, resetPeriod).getTime();
  const windowSpendUsd = totalWindowSpendUsd(windowStartMs);
  const blocked = totalLimitUsd != null && windowSpendUsd >= totalLimitUsd;
  return {
    pipelineLimitUsd,
    totalLimitUsd,
    resetPeriod,
    windowStartMs,
    windowEndMs,
    msUntilReset: windowEndMs - now.getTime(),
    windowSpendUsd,
    allTimeSpendUsd: roundUsd(allTimeTotals().spendUsd + askWindowedSpendUsd(0) + requirementsWindowedSpendUsd(0)
      + designWindowedSpendUsd(0)),
    remainingUsd: totalLimitUsd == null ? null : Math.max(0, roundUsd(totalLimitUsd - windowSpendUsd)),
    blocked,
  };
}
