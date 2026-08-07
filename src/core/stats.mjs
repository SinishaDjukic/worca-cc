// src/core/stats.mjs
// Statistics over ALL pipeline records — archived included, deliberately: the
// archive exists so these numbers survive history cleanup (spec §6.9). Pure
// synchronous DB reads; no gh, no git, offline-correct.
//
// Attribution: money = cost_ledger by event timestamp (exact); runs, time,
// and PRs = cohort by started_at (a run belongs to the bucket its start falls
// in, with its CURRENT status). 'all' money/time use the fallback-aware
// pipelines sums so pre-ledger history still counts.

import { prepare } from './db.mjs';
import {
  budgetStatus, costWindowStart, costWindowEnd, allTimeTotals, roundUsd,
} from './cost-budget.mjs';

const RANGES = ['week', 'month', 'all'];

function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

/** Cohort totals over runs started in [fromMs, toMs). Legacy fs->db imports have
 *  no started_at; they fall back to updated_at so their money (which always
 *  lands in the all-time sums) is never counted without its run. */
function cohortTotals(fromMs, toMs) {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const row = prepare(`
    SELECT COUNT(*) AS runs,
      COALESCE(SUM(status = 'done'), 0)                                      AS finished,
      COALESCE(SUM(status = 'stopped'), 0)                                   AS stopped,
      COALESCE(SUM(status = 'error'), 0)                                     AS failed,
      COALESCE(SUM(status IN ('paused','interrupted')), 0)                   AS paused,
      COALESCE(SUM(status IN ('created','starting','running','pausing')), 0) AS running,
      COALESCE(SUM(pr_url IS NOT NULL), 0)                                   AS prsOpened,
      COALESCE(SUM(pr_state = 'MERGED'), 0)                                  AS prsMerged,
      COALESCE(SUM(CASE WHEN p.total_cost_usd  > 0 THEN p.total_cost_usd  ELSE COALESCE(s.sc, 0) END), 0) AS spend,
      COALESCE(SUM(CASE WHEN p.total_active_ms > 0 THEN p.total_active_ms ELSE COALESCE(s.sa, 0) END), 0) AS active
    FROM pipelines p
    LEFT JOIN (SELECT pipeline_id, SUM(cost_usd) sc, SUM(active_ms) sa
               FROM pipeline_steps GROUP BY pipeline_id) s ON s.pipeline_id = p.id
    WHERE COALESCE(p.started_at, p.updated_at) >= ?
      AND COALESCE(p.started_at, p.updated_at) <  ?
  `).get(fromIso, toIso);
  return {
    runs: row.runs, finished: row.finished, stopped: row.stopped, failed: row.failed,
    paused: row.paused, running: row.running,
    prsOpened: row.prsOpened, prsMerged: row.prsMerged,
    workedMs: Number(row.active || 0),
    cohortSpendUsd: roundUsd(row.spend || 0),
  };
}

/** Ledger spend in [fromMs, toMs). */
function ledgerSpend(fromMs, toMs) {
  const row = prepare(
    'SELECT SUM(amount_usd) AS s FROM cost_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
  return roundUsd(row?.s || 0);
}

/** Build zero-filled buckets [{startMs, endMs}] from windowStart through `now`. */
function buildBuckets(windowStart, now, bucket) {
  const out = [];
  if (bucket === 'day') {
    for (let d = dayStart(windowStart); d <= now; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      out.push({ startMs: d.getTime(), endMs: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() });
    }
  } else {
    for (let m = monthStart(windowStart); m <= now; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      out.push({ startMs: m.getTime(), endMs: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() });
    }
  }
  return out;
}

/** GET /api/stats backing (spec §6.9). @throws {RangeError} on unknown range. */
export function getStats({ range = 'month', now = new Date() } = {}) {
  if (!RANGES.includes(range)) throw new RangeError(`unknown stats range: ${range}`);
  const budget = budgetStatus(now);

  let windowStart, windowEnd, prevStart, prevEnd, bucket;
  if (range === 'week') {
    windowStart = costWindowStart(now, 'weekly'); windowEnd = costWindowEnd(now, 'weekly');
    prevStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() - 7);
    prevEnd = windowStart; bucket = 'day';
  } else if (range === 'month') {
    windowStart = costWindowStart(now, 'monthly'); windowEnd = costWindowEnd(now, 'monthly');
    prevStart = new Date(windowStart.getFullYear(), windowStart.getMonth() - 1, 1);
    prevEnd = windowStart; bucket = 'day';
  } else {
    // all time: series over the last 12 months; totals over everything
    windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    windowEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    prevStart = null; prevEnd = null; bucket = 'month';
  }

  const shapeTotals = (fromMs, toMs) => {
    const c = cohortTotals(fromMs, toMs);
    return {
      spentUsd: ledgerSpend(fromMs, toMs),
      workedMs: c.workedMs,
      runs: c.runs, finished: c.finished, stopped: c.stopped, failed: c.failed,
      paused: c.paused, running: c.running,
      prsOpened: c.prsOpened, prsMerged: c.prsMerged,
    };
  };

  let totals;
  if (range === 'all') {
    const at = allTimeTotals();
    const c = cohortTotals(0, windowEnd.getTime());
    totals = {
      spentUsd: at.spendUsd, workedMs: at.activeMs,
      runs: c.runs, finished: c.finished, stopped: c.stopped, failed: c.failed,
      paused: c.paused, running: c.running,
      prsOpened: c.prsOpened, prsMerged: c.prsMerged,
    };
  } else {
    totals = shapeTotals(windowStart.getTime(), windowEnd.getTime());
  }

  const prev = prevStart ? shapeTotals(prevStart.getTime(), prevEnd.getTime()) : null;

  const series = buildBuckets(windowStart, now, bucket).map(({ startMs, endMs }) => {
    const c = cohortTotals(startMs, endMs);
    return {
      bucketStartMs: startMs,
      spentUsd: ledgerSpend(startMs, endMs),
      finished: c.finished, stopped: c.stopped, failed: c.failed,
    };
  });

  return {
    range, bucket,
    windowStartMs: windowStart.getTime(), windowEndMs: windowEnd.getTime(),
    totals, prev, budget, series,
  };
}
