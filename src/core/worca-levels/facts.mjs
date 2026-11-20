// src/core/worca-levels/facts.mjs
// The facts the worca-level evaluator reads (facts v2): numbers and booleans about one person's use of worca,
// gathered from the DB, the plugin lock and the onboarding state. One small function per source; a source that
// fails is logged and its fact becomes a neutral value (0 / false / null = not met), so gatherFacts never throws.
//
// Who did what (plans/…-v2.md D-3, D-4):
//   - run rows are filtered by person ONLY on a shared install, on COALESCE(started_by, credit_key) so a
//     deleted run (started_by NULLed, credit_key kept) still counts for its owner; a single-person install
//     counts every row, which also covers NULL started_by (old runs).
//   - real runs follow real-run.mjs (finished, not a demo, cost something); deleted rows are included.
//   - add-ons are read from the lock on a single-person install (backfill); on a shared install only the
//     person's live events count.
// Levels 3 to 5 read one query over the person's real runs (realRunRows) plus the pure day maths in timeline.mjs;
// no fact comes from which pages the person opened.
import { getDb } from '../db.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { REAL_RUN_SQL } from '../real-run.mjs';
import { NO_PROJECT_KEY } from '../../shared/no-project.mjs';
import { WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';
import { firstParallelPair, activeDayKeys, firstRunsOnDays, activeDaysWindow } from './timeline.mjs';

// The pipelines owner column: started_by, else the credit key a deleted run keeps.
const RUN_OWNER = 'COALESCE(started_by, credit_key)';

// The finish instant of a pipelines row `p`: finished_at (set once when the run first reached done), else updated_at for a row from before v96.
const FINISH_AT_P = 'COALESCE(p.finished_at, p.updated_at)';
const RUN_OWNER_P = 'COALESCE(p.started_by, p.credit_key)';

const num = (row) => (row ? Number(row.n) || 0 : 0);

/** SQL for "this person's rows": a case-insensitive match on `column`, only when shared. */
function personClause(column, { person, shared }) {
  return shared ? { sql: ` AND LOWER(${column}) = ?`, params: [String(person)] } : { sql: '', params: [] };
}

function countRows(table, column, extraWhere, who) {
  const p = personClause(column, who);
  return num(getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE 1 = 1${extraWhere}${p.sql}`).get(...p.params));
}

/** Every pipelines row of the person, deleted ones included (the past-activity check of a shared install). */
export function countStartedRuns(who) { return countRows('pipelines', RUN_OWNER, '', who); }

export function requirementCount(who) { return countRows('req_features', 'created_by', '', who); }

/** The person's real runs (real-run.mjs): finished, not a demo, cost something; deleted runs still count. */
export function countRealRuns(who) {
  const p = personClause(`COALESCE(p.started_by, p.credit_key)`, who);
  return num(getDb().prepare(`SELECT COUNT(*) AS n FROM pipelines p WHERE ${REAL_RUN_SQL('p')}${p.sql}`).get(...p.params));
}

/**
 * { schedules, repeatingSchedules } (booleans). `schedules`: the person made a schedule, a one-off timed run
 * (a scheduled_runs row with no schedule) or started a run with a start time. `repeatingSchedules`: the person
 * made a schedule, or a run of theirs came from one (pipelines.schedule_id survives the schedule's deletion).
 */
export function scheduleFacts(who) {
  const madeSchedule = countRows('schedules', 'created_by', '', who) > 0;
  const oneOff = countRows('scheduled_runs', 'created_by', ' AND schedule_id IS NULL', who) > 0;
  const timedRun = countRows('pipelines', RUN_OWNER, ' AND scheduled_for IS NOT NULL', who) > 0;
  const fromSchedule = countRows('pipelines', RUN_OWNER, ' AND schedule_id IS NOT NULL', who) > 0;
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

/** The person's real runs, deleted ones included (D-4), as { id, start, end }; end is the finish instant (FINISH_AT_P). */
export function parallelIntervals(who) {
  const p = personClause(RUN_OWNER_P, who);
  return getDb().prepare(`SELECT p.id AS id, p.started_at AS start, COALESCE(p.finished_at, p.updated_at) AS end FROM pipelines p
    WHERE ${REAL_RUN_SQL('p')} AND p.started_at IS NOT NULL AND COALESCE(p.finished_at, p.updated_at) IS NOT NULL${p.sql}`).all(...p.params);
}

/** A JSON array of strings read from a column; anything else, bad JSON included, is []. */
function parseKeys(value) {
  if (typeof value !== 'string') return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string' && k) : [];
  } catch { return []; }
}

/**
 * The person's real runs (real-run.mjs, deleted ones included), oldest finish first, as
 * { id, finishedAt, scheduleId, scheduledFor, target, projectKey, projectKeys, prUrl, prState }.
 * `finishedAt` is the finish instant; `projectKeys` are a workspace run's member keys (workspace_meta).
 */
export function realRunRows(who) {
  const p = personClause(RUN_OWNER_P, who);
  const rows = getDb().prepare(`SELECT p.id AS id, ${FINISH_AT_P} AS finishedAt, p.schedule_id AS scheduleId, p.scheduled_for AS scheduledFor,
      p.target AS target, p.project_key AS projectKey,
      json_extract(CASE WHEN json_valid(p.workspace_meta) THEN p.workspace_meta END, '$.projectKeys') AS projectKeys,
      p.pr_url AS prUrl, p.pr_state AS prState
    FROM pipelines p WHERE ${REAL_RUN_SQL('p')}${p.sql} ORDER BY finishedAt, p.id`).all(...p.params);
  return rows.map((r) => ({ ...r, projectKeys: parseKeys(r.projectKeys) }));
}

/** The facts that come from the real-run rows (levels 3 to 5), computed purely from `rows`. */
function rowFacts(rows, tz, now) {
  const days = activeDayKeys(rows, tz);
  const keys = new Set();
  const perSchedule = new Map();
  for (const r of rows) {
    for (const k of [r.projectKey, ...r.projectKeys]) if (k && k !== NO_PROJECT_KEY) keys.add(k);
    if (r.scheduleId) perSchedule.set(r.scheduleId, (perSchedule.get(r.scheduleId) || 0) + 1);
  }
  return {
    runsOnDays: firstRunsOnDays(rows, tz, { runs: WORCA_THRESHOLDS.hookedRuns, days: WORCA_THRESHOLDS.hookedDays }),
    activeDays: activeDaysWindow(days, tz, now, { need: WORCA_THRESHOLDS.councilDays, window: WORCA_THRESHOLDS.councilWindow }),
    prsOpened: rows.filter((r) => r.prUrl).length,
    prsMerged: rows.filter((r) => r.prState === 'MERGED').length,
    prMergedUnknown: rows.some((r) => r.prUrl && r.prState == null),
    scheduledRunDone: rows.some((r) => r.scheduleId || r.scheduledFor),
    workspaceRunDone: rows.some((r) => r.target === 'workspace'),
    projects: keys.size,
    repeatingScheduleRunsMax: Math.max(0, ...perSchedule.values()),
  };
}

const NEUTRAL_ROW_FACTS = Object.freeze({
  runsOnDays: Object.freeze({ metAt: null, runs: 0, days: 0 }), activeDays: Object.freeze({ inWindow: 0, metAt: null }),
  prsOpened: 0, prsMerged: 0, prMergedUnknown: false, scheduledRunDone: false, workspaceRunDone: false, projects: 0,
  repeatingScheduleRunsMax: 0,
});

const STEPS_OF = WORCA_THRESHOLDS.runnerSteps;

// onboarding.mjs pulls in the probes, workspaces and the metrics/policy graph; load it only when the
// facts are gathered, so importing this module stays cheap. Getting started's steps 1 to 6 are Runner's
// (7 to 9 are never read); steps 8 and 9 only say whether the person is on a team.
async function onboardingFacts() {
  const { onboardingStatus, ONBOARDING_STEPS } = await import('../onboarding.mjs');
  const status = await onboardingStatus();
  const steps = status.steps || {};
  return {
    setupFinished: status.setupFinished === true,
    providerSignedIn: status.providerSignedIn === true,
    runnerSteps: { done: ONBOARDING_STEPS.slice(0, STEPS_OF).filter((id) => steps[id]).length, of: STEPS_OF },
    teamMetricsOn: steps.teamMetrics === true,
    teamPolicyOn: steps.teamPolicy === true,
  };
}

const SOURCES = Object.freeze({
  onboarding: onboardingFacts,
  realRuns: countRealRuns,
  addonFacts,
  parallelIntervals,
  realRunRows,
});

const NEUTRAL_ONBOARDING = Object.freeze({
  setupFinished: false, providerSignedIn: false, runnerSteps: Object.freeze({ done: 0, of: STEPS_OF }),
  teamMetricsOn: false, teamPolicyOn: false,
});

const asCount = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The live record, with every field normalised so a missing or malformed one reads as empty. */
function normaliseLive(live) {
  const o = live && typeof live === 'object' ? live : {};
  return {
    addons: Array.isArray(o.addons) ? o.addons.filter((a) => typeof a === 'string') : [],
    addonPeak: asCount(o.addonPeak),
  };
}

// The source names `skip` understands, where one differs from the key in SOURCES / `overrides`.
const SKIP_NAMES = Object.freeze({ parallelIntervals: 'parallel', realRunRows: 'runRows' });

/**
 * Never throws: a source that fails is logged and its fact takes its neutral value; a source named in
 * `skip` is not run at all and takes its neutral value too.
 * @param {{person:string, shared:boolean, live?:object, tz?:string, now?:number, skip?:Set<string>}} input  person = lowercased key
 * @param {object} [overrides]  replaces named sources (tests inject failing ones)
 * @returns {Promise<{setupFinished:boolean, providerSignedIn:boolean, runnerSteps:{done:number,of:number},
 *   teamMetricsOn:boolean, teamPolicyOn:boolean, realRuns:number, runsOnDays:{metAt:?string,runs:number,days:number},
 *   activeDays:{inWindow:number,metAt:?string}, prsOpened:number, prsMerged:number, prMergedUnknown:boolean,
 *   daysUnknown:boolean, scheduledRunDone:boolean, workspaceRunDone:boolean, projects:number,
 *   repeatingScheduleRunsMax:number, addonsInstalled:number, addonsAtOnce:number, parallelDoneAt:?string}>}
 */
export async function gatherFacts({ person, shared, live, tz = 'UTC', now = Date.now(), skip = new Set() } = {}, overrides = {}) {
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

  const [onboarding, realRuns, addons, intervals, rows] = await Promise.all([
    guard('onboarding', () => src.onboarding(), NEUTRAL_ONBOARDING),
    guard('realRuns', () => src.realRuns(who), 0),
    guard('addonFacts', () => src.addonFacts({ shared: who.shared, live: lv }), { addonsInstalled: 0, addonsAtOnce: 0 }),
    guard('parallelIntervals', () => src.parallelIntervals(who), []),
    guard('realRunRows', () => src.realRunRows(who), []),
  ]);

  // The pure timeline maths sits behind the same guard as the reads, so a bad row cannot make gatherFacts throw.
  const pair = await guard('parallel', () => firstParallelPair(intervals), null);
  const rf = await guard('rowFacts', () => rowFacts(Array.isArray(rows) ? rows : [], tz, now), NEUTRAL_ROW_FACTS);
  const ob = onboarding && typeof onboarding === 'object' ? onboarding : NEUTRAL_ONBOARDING;

  return {
    setupFinished: ob.setupFinished === true,
    providerSignedIn: ob.providerSignedIn === true,
    runnerSteps: { done: Math.min(asCount(ob.runnerSteps?.done), STEPS_OF), of: STEPS_OF },
    teamMetricsOn: ob.teamMetricsOn === true,
    teamPolicyOn: ob.teamPolicyOn === true,
    realRuns: asCount(realRuns),
    runsOnDays: { ...rf.runsOnDays },
    activeDays: { ...rf.activeDays },
    prsOpened: rf.prsOpened,
    prsMerged: rf.prsMerged,
    prMergedUnknown: rf.prMergedUnknown,
    daysUnknown: false,
    scheduledRunDone: rf.scheduledRunDone,
    workspaceRunDone: rf.workspaceRunDone,
    projects: rf.projects,
    repeatingScheduleRunsMax: rf.repeatingScheduleRunsMax,
    addonsInstalled: asCount(addons?.addonsInstalled),
    addonsAtOnce: asCount(addons?.addonsAtOnce),
    parallelDoneAt: pair ? pair.at : null,
  };
}
