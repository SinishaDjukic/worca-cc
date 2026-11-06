// src/core/worca-levels/facts.mjs
// The facts the worca-level evaluator reads: numbers and booleans about one person's use of worca,
// gathered from the DB, the plugin lock, the requirements flag and the person's live record
// (store.mjs). One small function per source; a source that fails is logged and its fact becomes
// 0 / false, so gatherFacts never throws.
//
// Who did what (plans/…-v2.md D-3, D-4):
//   - rows (runs, requirements, schedules) are filtered by person ONLY on a shared install; a
//     single-person install counts every row, which also covers NULL started_by (old runs).
//   - Getting started is credited from install state for both kinds of install.
//   - add-ons and spaces are read from the lock / workspaces table on a single-person install
//     (backfill); on a shared install only the person's live events count.
import { getDb } from '../db.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { flagEnabled } from '../flags.mjs';

const DAY_MS = 86400000;
export const PEAK_PARALLEL_WINDOW_DAYS = 90;
// The run status Statistics counts as finished (stats.mjs TOTALS_COLUMNS) and Getting started's
// "run" step reads (onboarding.mjs).
const DONE_STATUS = 'done';

const num = (row) => (row ? Number(row.n) || 0 : 0);

/** SQL for "this person's rows": a case-insensitive match on `column`, only when shared. */
function personClause(column, { person, shared }) {
  return shared ? { sql: ` AND LOWER(${column}) = ?`, params: [String(person)] } : { sql: '', params: [] };
}

function countRows(table, column, extraWhere, who) {
  const p = personClause(column, who);
  return num(getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE 1 = 1${extraWhere}${p.sql}`).get(...p.params));
}

export function countStartedRuns(who) { return countRows('pipelines', 'started_by', '', who); }

export function countDoneRuns(who) { return countRows('pipelines', 'started_by', ` AND status = '${DONE_STATUS}'`, who); }

export function requirementCount(who) { return countRows('req_features', 'created_by', '', who); }

/** { schedules, scheduledRuns }: schedules the person made, and runs started from a schedule. */
export function scheduleFacts(who) {
  return {
    schedules: countRows('schedules', 'created_by', '', who),
    scheduledRuns: countRows('pipelines', 'started_by', ' AND schedule_id IS NOT NULL', who),
  };
}

/** { installed, enabled }. Single install: the lock. Shared: the person's live add-ons, enabled when the lock still enables them. */
export function addonFacts({ shared, live }) {
  const lock = readPluginsLock();
  const enabledInLock = (name) => !!lock[name] && lock[name].enabled !== false;
  if (!shared) {
    const names = Object.keys(lock);
    return { installed: names.length, enabled: names.filter(enabledInLock).length };
  }
  const names = [...new Set(live.addons)];
  return { installed: names.length, enabled: names.filter(enabledInLock).length };
}

export function spaceCount({ shared, live }) {
  if (shared) return live.spaces;
  return num(getDb().prepare('SELECT COUNT(*) AS n FROM workspaces').get());
}

/** The most pipelines in flight at once, from each pipeline's [first phase start, last phase finish]. */
export function peakParallelBackfill(who, now = Date.now()) {
  const p = personClause('p.started_by', who);
  const since = new Date(now - PEAK_PARALLEL_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = getDb().prepare(`
    SELECT MIN(ph.started_at) AS s, MAX(COALESCE(ph.finished_at, ph.started_at)) AS f
    FROM pipeline_phases ph JOIN pipelines p ON p.id = ph.pipeline_id
    WHERE ph.started_at IS NOT NULL${p.sql}
    GROUP BY ph.pipeline_id HAVING MIN(ph.started_at) >= ?`).all(...p.params, since);
  // Sweep line; at an equal instant a finish sorts before a start, so back-to-back runs do not overlap.
  const events = [];
  for (const r of rows) {
    const s = Date.parse(r.s);
    const f = Date.parse(r.f);
    if (Number.isNaN(s) || Number.isNaN(f)) continue;
    events.push([s, 1], [Math.max(f, s), -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let peak = 0;
  for (const [, d] of events) { open += d; if (open > peak) peak = open; }
  return peak;
}

export function statsDayCount(live) { return live.statsDays.length; }

// onboarding.mjs pulls in the probes, workspaces and the metrics/policy graph; load it only when the
// facts are gathered, so importing this module stays cheap.
async function gettingStartedFacts() {
  const { onboardingStatus } = await import('../onboarding.mjs');
  const { done, total } = await onboardingStatus();
  return { done: Number(done) || 0, total: Number(total) || 0 };
}

const SOURCES = Object.freeze({
  onboarding: gettingStartedFacts,
  requirementsFlag: () => flagEnabled('requirements'),
  requirementCount, countStartedRuns, countDoneRuns, scheduleFacts,
  addonFacts, spaceCount, peakParallelBackfill, statsDayCount,
});

const asCount = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The live record, with every field normalised so a missing or malformed one reads as empty. */
function normaliseLive(live) {
  const o = live && typeof live === 'object' ? live : {};
  return {
    addons: Array.isArray(o.addons) ? o.addons.filter((a) => typeof a === 'string') : [],
    spaces: o.spaces === true ? 1 : asCount(o.spaces),   // the store keeps a boolean; a count is also accepted
    statsDays: Array.isArray(o.statsDays) ? o.statsDays : [],
    peakParallel: asCount(o.peakParallel),
  };
}

/**
 * @param {{person:string, shared:boolean, live?:object}} input  person = lowercased key
 * @param {object} [overrides]  replaces named sources (tests inject failing ones)
 * @returns {Promise<{gettingStartedDone:boolean, gettingStarted:{done:number,total:number}, requirements:number,
 *   requirementsFlag:boolean, startedRuns:number, doneRuns:number, addonsInstalled:number, addonsEnabled:number,
 *   spaces:number, schedules:number, scheduledRuns:number, peakParallel:number, statsDays:number}>}
 */
export async function gatherFacts({ person, shared, live } = {}, overrides = {}) {
  const src = { ...SOURCES, ...overrides };
  const who = { person: String(person ?? ''), shared: shared === true };
  const lv = normaliseLive(live);
  const ctx = `person=${JSON.stringify(who.person)} shared=${who.shared}`;
  const guard = async (name, fn, fallback) => {
    try { return await fn(); } catch (err) {
      console.warn(`[worca-levels] fact source ${name} failed (${ctx}): ${err?.stack || err?.message || err}`);
      return fallback;
    }
  };

  const [gs, requirementsFlag, requirements, startedRuns, doneRuns, addons, spaces, sched, backfill, statsDays] = await Promise.all([
    guard('onboarding', () => src.onboarding(), { done: 0, total: 0 }),
    guard('requirementsFlag', () => src.requirementsFlag(), false),
    guard('requirementCount', () => src.requirementCount(who), 0),
    guard('countStartedRuns', () => src.countStartedRuns(who), 0),
    guard('countDoneRuns', () => src.countDoneRuns(who), 0),
    guard('addonFacts', () => src.addonFacts({ shared: who.shared, live: lv }), { installed: 0, enabled: 0 }),
    guard('spaceCount', () => src.spaceCount({ shared: who.shared, live: lv }), 0),
    guard('scheduleFacts', () => src.scheduleFacts(who), { schedules: 0, scheduledRuns: 0 }),
    guard('peakParallelBackfill', () => src.peakParallelBackfill(who), 0),
    guard('statsDayCount', () => src.statsDayCount(lv), 0),
  ]);

  return {
    gettingStartedDone: gs.total > 0 && gs.done >= gs.total,
    gettingStarted: { done: gs.done, total: gs.total },
    requirements: asCount(requirements),
    requirementsFlag: requirementsFlag === true,
    startedRuns: asCount(startedRuns),
    doneRuns: asCount(doneRuns),
    addonsInstalled: asCount(addons.installed),
    addonsEnabled: asCount(addons.enabled),
    spaces: asCount(spaces),
    schedules: asCount(sched.schedules),
    scheduledRuns: asCount(sched.scheduledRuns),
    peakParallel: Math.max(lv.peakParallel, asCount(backfill)),
    statsDays: asCount(statsDays),
  };
}
