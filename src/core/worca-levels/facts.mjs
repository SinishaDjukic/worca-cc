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
import { readRunLedger } from '../metrics/ledger.mjs';
import { firstParallelPair, councilStreak } from './timeline.mjs';

// The run status Statistics counts as finished (stats.mjs TOTALS_COLUMNS) and Getting started's
// "run" step reads (onboarding.mjs).
const DONE_STATUS = 'done';
// A deleted run keeps an anonymised row for Statistics (runs redesign §3.2); it is not the person's run any more.
const NOT_DELETED = ' AND deleted_at IS NULL';
export const TEAM_METRICS_CAP = 10;

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

export function countDoneRuns(who) { return countRows('pipelines', 'started_by', ` AND status = '${DONE_STATUS}'${NOT_DELETED}`, who); }

export function requirementCount(who) { return countRows('req_features', 'created_by', '', who); }

/**
 * { schedules, repeatingSchedules } (booleans). `schedules`: the person made a schedule, a one-off timed run
 * (a scheduled_runs row with no schedule) or started a run with a start time. `repeatingSchedules`: the person
 * made a schedule, or a run of theirs came from one (pipelines.schedule_id survives the schedule's deletion).
 */
export function scheduleFacts(who) {
  const madeSchedule = countRows('schedules', 'created_by', '', who) > 0;
  const oneOff = countRows('scheduled_runs', 'created_by', ' AND schedule_id IS NULL', who) > 0;
  const timedRun = countRows('pipelines', 'started_by', ' AND scheduled_for IS NOT NULL', who) > 0;
  const fromSchedule = countRows('pipelines', 'started_by', ' AND schedule_id IS NOT NULL', who) > 0;
  return { schedules: madeSchedule || oneOff || timedRun, repeatingSchedules: madeSchedule || fromSchedule };
}

/** { addonsInstalled, addonsAtOnce }. Single install: the lock. Shared: the person's live add-ons still in the lock. */
export function addonFacts({ shared, live }) {
  const lock = readPluginsLock();
  const installed = shared
    ? [...new Set(live.addons)].filter((name) => !!lock[name]).length
    : Object.keys(lock).length;
  return { addonsInstalled: installed, addonsAtOnce: Math.max(live.addonPeak, installed) };
}

export function spaceCount({ shared, live }) {
  if (shared) return live.spaces;
  return num(getDb().prepare('SELECT COUNT(*) AS n FROM workspaces').get());
}

/** The person's done, non-deleted runs as { id, start, end } (updated_at stands in for the finish: there is no finished_at). */
export function parallelIntervals(who) {
  const p = personClause('started_by', who);
  return getDb().prepare(`SELECT id, started_at AS start, updated_at AS end FROM pipelines
    WHERE status = '${DONE_STATUS}'${NOT_DELETED} AND started_at IS NOT NULL AND updated_at IS NOT NULL${p.sql}`).all(...p.params);
}

/** How many of the person's newest done runs have a recorded team-metrics ledger, up to TEAM_METRICS_CAP. */
export function teamMetricsRuns(who) {
  const p = personClause('started_by', who);
  const ids = getDb().prepare(`SELECT id FROM pipelines WHERE status = '${DONE_STATUS}'${NOT_DELETED}${p.sql}
    ORDER BY updated_at DESC, id DESC`).all(...p.params);
  let recorded = 0;
  for (const { id } of ids) {
    if (readRunLedger(id).state === 'recorded' && ++recorded >= TEAM_METRICS_CAP) break;
  }
  return recorded;
}

/** The ISO finish times (updated_at) of the person's done, non-deleted runs, oldest first. */
export function councilFinishes(who) {
  const p = personClause('started_by', who);
  return getDb().prepare(`SELECT updated_at FROM pipelines WHERE status = '${DONE_STATUS}'${NOT_DELETED}
    AND updated_at IS NOT NULL${p.sql} ORDER BY updated_at`).all(...p.params).map((r) => r.updated_at);
}

// onboarding.mjs pulls in the probes, workspaces and the metrics/policy graph; load it only when the
// facts are gathered, so importing this module stays cheap.
async function gettingStartedFacts() {
  const { onboardingStatus } = await import('../onboarding.mjs');
  return onboardingStatus();
}

const SOURCES = Object.freeze({
  onboarding: gettingStartedFacts,
  requirementsFlag: () => flagEnabled('requirements'),
  requirementCount, countStartedRuns, countDoneRuns, scheduleFacts,
  addonFacts, spaceCount, parallelIntervals, teamMetricsRuns, councilFinishes,
});

const asCount = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const asInstant = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

/** The live record, with every field normalised so a missing or malformed one reads as empty. */
function normaliseLive(live) {
  const o = live && typeof live === 'object' ? live : {};
  return {
    addons: Array.isArray(o.addons) ? o.addons.filter((a) => typeof a === 'string') : [],
    addonPeak: asCount(o.addonPeak),
    spaces: o.spaces === true ? 1 : asCount(o.spaces),   // the store keeps a boolean; a count is also accepted
    statsViewedAt: asInstant(o.statsViewedAt),
    teamMetricsOpenedAt: asInstant(o.teamMetricsOpenedAt),
  };
}

// The source names `skip` understands, where one differs from the key in SOURCES / `overrides`.
const SKIP_NAMES = Object.freeze({ parallelIntervals: 'parallel', teamMetricsRuns: 'teamMetrics', councilFinishes: 'council' });
const NEUTRAL_COUNCIL = Object.freeze({ current: 0, metAt: null });

/**
 * Never throws: a source that fails is logged and its fact takes its neutral value; a source named in
 * `skip` is not run at all and takes its neutral value too.
 * @param {{person:string, shared:boolean, live?:object, tz?:string, now?:number, skip?:Set<string>}} input  person = lowercased key
 * @param {object} [overrides]  replaces named sources (tests inject failing ones)
 * @returns {Promise<{gettingStartedDone:boolean, gettingStarted:{done:number,total:number}, policyInstalled:boolean,
 *   requirements:number, requirementsFlag:boolean, startedRuns:number, doneRuns:number, addonsInstalled:number,
 *   addonsAtOnce:number, spaces:number, schedules:boolean, repeatingSchedules:boolean, statsViewedAt:?string,
 *   parallelDoneAt:?string, teamMetricsRuns:number, teamMetricsOpenedAt:?string, council:{current:number,metAt:?string}}>}
 */
export async function gatherFacts({ person, shared, live, tz, now = Date.now(), skip = new Set() } = {}, overrides = {}) {
  const src = { ...SOURCES, ...overrides };
  const who = { person: String(person ?? ''), shared: shared === true };
  const lv = normaliseLive(live);
  const skipped = skip instanceof Set ? skip : new Set();
  const ctx = `personPresent=${who.person.length > 0} shared=${who.shared}`;
  const guard = async (name, fn, fallback) => {
    if (skipped.has(name) || skipped.has(SKIP_NAMES[name])) return fallback;
    try { return await fn(); } catch (err) {
      console.warn(`[worca-levels] fact source ${name} failed (${ctx}): ${err?.stack || err?.message || err}`);
      return fallback;
    }
  };

  const [onboarding, requirementsFlag, requirements, startedRuns, doneRuns, addons, spaces, sched, intervals, teamRuns, finishes] = await Promise.all([
    guard('onboarding', () => src.onboarding(), null),
    guard('requirementsFlag', () => src.requirementsFlag(), false),
    guard('requirementCount', () => src.requirementCount(who), 0),
    guard('countStartedRuns', () => src.countStartedRuns(who), 0),
    guard('countDoneRuns', () => src.countDoneRuns(who), 0),
    guard('addonFacts', () => src.addonFacts({ shared: who.shared, live: lv }), { addonsInstalled: 0, addonsAtOnce: 0 }),
    guard('spaceCount', () => src.spaceCount({ shared: who.shared, live: lv }), 0),
    guard('scheduleFacts', () => src.scheduleFacts(who), { schedules: false, repeatingSchedules: false }),
    guard('parallelIntervals', () => src.parallelIntervals(who), []),
    guard('teamMetricsRuns', () => src.teamMetricsRuns(who), 0),
    guard('councilFinishes', () => src.councilFinishes(who), null),
  ]);

  const gs = {
    done: Number(onboarding?.done) || 0,
    total: Number(onboarding?.total) || 0,
    policyInstalled: !!onboarding?.steps?.teamPolicy,
  };

  // The pure timeline maths sits behind the same guard as the reads, so a bad row cannot make gatherFacts throw.
  const pair = await guard('parallel', () => firstParallelPair(intervals), null);
  const council = finishes === null ? NEUTRAL_COUNCIL
    : await guard('council', () => councilStreak(finishes, tz, now), NEUTRAL_COUNCIL);

  return {
    gettingStartedDone: gs.total > 0 && gs.done >= gs.total,
    gettingStarted: { done: gs.done, total: gs.total },
    policyInstalled: gs.policyInstalled === true,
    requirements: asCount(requirements),
    requirementsFlag: requirementsFlag === true,
    startedRuns: asCount(startedRuns),
    doneRuns: asCount(doneRuns),
    addonsInstalled: asCount(addons.addonsInstalled),
    addonsAtOnce: asCount(addons.addonsAtOnce),
    spaces: asCount(spaces),
    schedules: sched.schedules === true,
    repeatingSchedules: sched.repeatingSchedules === true,
    statsViewedAt: lv.statsViewedAt,
    parallelDoneAt: pair ? pair.at : null,
    teamMetricsRuns: Math.min(asCount(teamRuns), TEAM_METRICS_CAP),
    teamMetricsOpenedAt: lv.teamMetricsOpenedAt,
    council: { current: council.current, metAt: council.metAt },
  };
}
