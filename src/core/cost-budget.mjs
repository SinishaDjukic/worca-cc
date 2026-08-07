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

/** All-time spend + active time over ALL pipelines (archived included),
 *  falling back to per-step sums when the row total is 0. */
export function allTimeTotals() {
  const row = prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN p.total_cost_usd  > 0 THEN p.total_cost_usd  ELSE COALESCE(s.sc, 0) END), 0) AS spend,
      COALESCE(SUM(CASE WHEN p.total_active_ms > 0 THEN p.total_active_ms ELSE COALESCE(s.sa, 0) END), 0) AS active
    FROM pipelines p
    LEFT JOIN (SELECT pipeline_id, SUM(cost_usd) sc, SUM(active_ms) sa
               FROM pipeline_steps GROUP BY pipeline_id) s ON s.pipeline_id = p.id
  `).get();
  return { spendUsd: roundUsd(row?.spend || 0), activeMs: Number(row?.active || 0) };
}

/** True when this pipeline ignores the per-pipeline cap (persistent, F7). */
export function readCostCapOverride(pipelineId) {
  const row = prepare('SELECT cost_cap_override FROM pipelines WHERE id = ?').get(pipelineId);
  return !!row?.cost_cap_override;
}

/** Set the persistent per-pipeline "disregard the cap" flag. */
export function setCostCapOverride(pipelineId) {
  prepare('UPDATE pipelines SET cost_cap_override = 1 WHERE id = ?').run(pipelineId);
}

/** One shared truth for gates, CLI, and every UI badge (spec §6.1). */
export function budgetStatus(now = new Date()) {
  const resetPeriod = costLimitResetPeriod();
  const pipelineLimitUsd = pipelineCostLimitUsd();
  const totalLimitUsd = totalCostLimitUsd();
  const windowStartMs = costWindowStart(now, resetPeriod).getTime();
  const windowEndMs = costWindowEnd(now, resetPeriod).getTime();
  const windowSpendUsd = windowedSpendUsd(windowStartMs);
  const blocked = totalLimitUsd != null && windowSpendUsd >= totalLimitUsd;
  return {
    pipelineLimitUsd,
    totalLimitUsd,
    resetPeriod,
    windowStartMs,
    windowEndMs,
    msUntilReset: windowEndMs - now.getTime(),
    windowSpendUsd,
    allTimeSpendUsd: allTimeTotals().spendUsd,
    remainingUsd: totalLimitUsd == null ? null : Math.max(0, roundUsd(totalLimitUsd - windowSpendUsd)),
    blocked,
  };
}
