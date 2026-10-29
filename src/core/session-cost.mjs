// src/core/session-cost.mjs — one session turn's dollars, split once (session groups, Task 33; spec §6.3, C9, C24, C33, C34).
// Pure: the step's share plus the main agent's overhead equals what the harness reports for the turn, a cut turn's
// carried spend goes back to the turn that spent it, and every check only reports: the harness figure is booked.
import { liveCostRates, estimateCost, isPriceableUsage } from './config.mjs';

/** Hook and per-epoch checks (spec §11). */
export const RECONCILE_ABS_USD = 0.001;
export const RECONCILE_REL = 0.02;
/** The token-priced estimate check (C33); S4's `estimateRatio` may raise `RECONCILE_EST_REL`. */
export const RECONCILE_EST_ABS_USD = 0.01;
export const RECONCILE_EST_REL = 0.15;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const first = (u, keys) => { for (const k of keys) if (u[k] != null) return num(u[k]); return 0; };
const SHORT_KEYS = ['in', 'out', 'cr', 'cw'];

/** `{ in, out, cr, cw }` from an API usage object (`input_tokens` …), from the demux's own `{ in, out, cr, cw }`
 *  (`facts().hostUsage`, Task 32) or from Ask's normalized `{ input, output, cacheRead, cacheCreation }` (which
 *  config.mjs `estimateCost` reads too, v3). The API key wins, then the demux's; a missing or non-numeric count is 0. */
export function usageTokens(u) {
  const o = u && typeof u === 'object' ? u : {};
  return {
    in: first(o, ['input_tokens', 'in', 'input']),
    out: first(o, ['output_tokens', 'out', 'output']),
    cr: first(o, ['cache_read_input_tokens', 'cr', 'cacheRead']),
    cw: first(o, ['cache_creation_input_tokens', 'cw', 'cacheCreation']),
  };
}

/** USD for `usage` at `model`'s rates (the operator's override, else the list price: `liveCostRates`). NaN when the
 *  model has no rates or the usage reports no counts at all (an all-zero usage is priceable, at $0, as
 *  `isPriceableUsage` says). Either usage shape (`usageTokens`); the demux's short shape has no `cache_creation`
 *  buckets, so its `cw` prices at the 5-minute cache-write rate (pass an API-shaped usage when the 1-hour split matters). */
export function priceUsage(model, usage) {
  const o = usage && typeof usage === 'object' ? usage : null;
  if (!o || !(isPriceableUsage(o) || SHORT_KEYS.some((k) => o[k] != null))) return NaN;
  const rates = liveCostRates(model);
  if (!rates) return NaN;
  const t = usageTokens(o);
  return estimateCost({ ...o, input_tokens: t.in, output_tokens: t.out, cache_read_input_tokens: t.cr, cache_creation_input_tokens: t.cw }, rates);
}

export function toleranceFor(harnessUsd, { abs = RECONCILE_ABS_USD, rel = RECONCILE_REL } = {}) {
  return Math.max(abs, rel * Math.abs(harnessUsd));
}

/** The member's own usage at its model plus each investigator's at its resolved model (C33). An unpriceable part is
 *  skipped; NaN only when no part is priceable. */
export function estimateMemberUsd({ memberUsage, memberModel, investigators = [] } = {}) {
  const parts = [[memberModel, memberUsage], ...(Array.isArray(investigators) ? investigators : []).map((i) => [i?.resolvedModel, i?.usage])];
  let sum = 0;
  let priced = false;
  for (const [model, usage] of parts) {
    const p = priceUsage(model, usage);
    if (Number.isFinite(p)) { sum += p; priced = true; }
  }
  return priced ? sum : NaN;
}

/** The split table (C9, C24, C34). `hostModel` is the RESOLVED main-agent model (C35). The first matching row wins:
 *  bridge, harness Δ, hook, estimate (only on an engine that reports cost), none (blank, never 0). */
export function splitTurnCost({ deltaUsd, bridgeUsd, hostUsage, hostModel, memberUsage, memberModel, investigators = [], hookUsd, engineCost } = {}) {
  const h = priceUsage(hostModel, hostUsage);
  const hostPriced = Number.isFinite(h);
  const estimateUsd = estimateMemberUsd({ memberUsage, memberModel, investigators });
  const H = (x) => (hostPriced ? Math.min(Math.max(h, 0), x) : 0);
  const row = (memberUsd, hostOverheadUsd, costSource) => ({ memberUsd, hostOverheadUsd, costSource, hostPriced, estimateUsd });
  if (Number.isFinite(bridgeUsd)) return row(bridgeUsd - H(bridgeUsd), H(bridgeUsd), 'bridge');
  if (Number.isFinite(deltaUsd)) return row(deltaUsd - H(deltaUsd), H(deltaUsd), 'harness');
  if (Number.isFinite(hookUsd)) return row(hookUsd, hostPriced ? h : 0, 'hook');
  if (engineCost !== false && Number.isFinite(estimateUsd)) return row(estimateUsd, hostPriced ? h : 0, 'estimate');
  return row(null, null, 'none');
}

/** A cut turn's spend inside the next Δ of the same host epoch (C9): the cut turn's priced usage, capped at Δ, goes
 *  back to the cut turn; the rest is the current turn's. A non-finite Δ carries nothing (v2). */
export function splitCarried({ deltaUsd, cutUsd } = {}) {
  const carriedUsd = Number.isFinite(cutUsd) && Number.isFinite(deltaUsd) ? Math.min(Math.max(cutUsd, 0), Math.max(deltaUsd, 0)) : 0;
  return { carriedUsd, restUsd: deltaUsd - carriedUsd };
}

/** Only a harness- or bridge-sourced booking is checked; a mismatch never changes it. */
export function reconcileTurn({ memberUsd, hookUsd, estimateUsd, costSource } = {}) {
  const checks = [];
  if (costSource === 'harness' || costSource === 'bridge') {
    const check = (method, otherUsd, tolerance) => checks.push({ method, harnessUsd: memberUsd, otherUsd, tolerance, ok: Math.abs(otherUsd - memberUsd) <= tolerance });
    if (Number.isFinite(hookUsd)) check('hook', hookUsd, toleranceFor(memberUsd));
    if (Number.isFinite(estimateUsd)) check('estimate', estimateUsd, toleranceFor(memberUsd, { abs: RECONCILE_EST_ABS_USD, rel: RECONCILE_EST_REL }));
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** Σ harness-sourced bookings of one host epoch vs what the harness says the epoch cost (C33). A missing side counts
 *  as 0 when the other is known; with neither there is nothing to compare. */
export function reconcileEpoch({ epoch, openingUsd, lastCumulativeUsd, bookedHarnessUsd } = {}) {
  const known = Number.isFinite(lastCumulativeUsd);
  if (!known && !Number.isFinite(bookedHarnessUsd)) return { epoch, harnessTotalUsd: null, bookedUsd: null, tolerance: null, ok: true };
  const harnessTotalUsd = known ? lastCumulativeUsd - (Number.isFinite(openingUsd) ? openingUsd : 0) : 0;
  const bookedUsd = Number.isFinite(bookedHarnessUsd) ? bookedHarnessUsd : 0;
  const tolerance = toleranceFor(harnessTotalUsd);
  return { epoch, harnessTotalUsd, bookedUsd, tolerance, ok: Math.abs(harnessTotalUsd - bookedUsd) <= tolerance };
}
