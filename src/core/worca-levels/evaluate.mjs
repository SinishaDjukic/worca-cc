// src/core/worca-levels/evaluate.mjs
// Pure level evaluation: facts + a person's record + `now` -> { level, doneAt, progress, next, nextLevel, top }.
// No I/O and no clock (the caller passes `now`); neither input is mutated. Deciding whether a level-up
// deserves a celebration is the service's job, not this module's (plans/…-v2.md I-3). The service also
// owns the Team metrics href/openLabel override (D-8).
import { WORCA_LEVELS, WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';

const TOP_LEVEL = WORCA_LEVELS[WORCA_LEVELS.length - 1].index;

const met = (ok, at) => (at ? { met: !!ok, at } : { met: !!ok });

// Does the fact behind each action meet its condition? One small predicate per action id. A condition may
// name the instant the thing really happened (`at`); otherwise the stamp is `now`.
const CONDITIONS = Object.freeze({
  gettingStarted: (f) => met(f.gettingStartedDone),
  // D-5: with the requirements flag off there is no requirement to write, so a started run counts.
  firstRequirement: (f) => met(f.requirementsFlag === false ? f.startedRuns >= 1 : f.requirements >= 1),
  firstFeatureDone: (f) => met(f.doneRuns >= 1),
  addonInstalled: (f) => met(f.addonsInstalled >= 1),
  spaceSetUp: (f) => met(f.spaces >= 1),
  scheduleCreated: (f) => met(f.schedules >= 1),
  statsViewed: (f) => met(f.statsViewedAt),
  parallelFeatures: (f) => met(f.parallelDoneAt, f.parallelDoneAt),
  addonsAtOnce: (f) => met(f.addonsAtOnce >= WORCA_THRESHOLDS.addonsAtOnce),
  repeatingSchedule: (f) => met(f.repeatingSchedules >= 1),
  // Opening Team metrics is the act; the run count is only shown as progress (R-po-39).
  teamMetrics: (f) => met(f.teamMetricsOpenedAt, f.teamMetricsOpenedAt),
  councilStreak: (f) => met(f.council?.metAt, f.council?.metAt),
});

// Optional { count, of } shown on an action that is not done yet.
const PROGRESS = Object.freeze({
  gettingStarted: (f) => ({ count: f.gettingStarted.done, of: f.gettingStarted.total }),
  teamMetrics: (f) => ({ count: f.teamMetricsRuns, of: WORCA_THRESHOLDS.teamMetricsRuns }),
  councilStreak: (f) => ({
    count: Math.min(f.council.current, WORCA_THRESHOLDS.councilDays),
    of: WORCA_THRESHOLDS.councilDays,
  }),
});

const allActions = WORCA_LEVELS.flatMap((l) => l.actions);

for (const { id } of allActions) {
  if (typeof CONDITIONS[id] !== 'function') throw new Error(`worca-levels: no condition for action "${id}"`);
}

/** The latched map: every stored entry kept as-is, every newly met action stamped `at ?? now`. */
function latch(facts, stored, now) {
  const merged = { ...stored };
  for (const { id } of allActions) {
    if (merged[id]) continue;
    const c = CONDITIONS[id](facts);
    if (c.met) merged[id] = c.at ?? now;
  }
  return merged;
}

/** Highest level N such that every action of every level <= N is done (level 1 has none). */
function earnedLevel(doneAt) {
  let reached = 1;
  for (const l of WORCA_LEVELS) {
    if (!l.actions.every((a) => doneAt[a.id])) break;
    reached = l.index;
  }
  return reached;
}

const levelRef = ({ index, key, name }) => ({ index, key, name });

function nextAction(a, facts, doneAt) {
  const done = !!doneAt[a.id];
  const view = { ...a, done, doneAt: doneAt[a.id] ?? null };
  const progress = !done && PROGRESS[a.id];
  return progress ? { ...view, ...progress(facts) } : view;
}

function progressOf(next, facts) {
  if (next.index === TOP_LEVEL) {
    const total = WORCA_THRESHOLDS.councilDays;
    return { done: Math.min(facts.council.current, total), total, unit: 'days' };
  }
  return { done: 0, total: next.actions.length, unit: 'items' };
}

export function evaluate(facts, record, now) {
  const stored = (record && record.doneAt) || {};
  const doneAt = latch(facts, stored, now);
  const level = Math.max((record && record.level) || 1, earnedLevel(doneAt));
  if (level >= TOP_LEVEL) {
    return { level, doneAt, progress: null, next: null, nextLevel: null, top: true };
  }
  const nextDef = WORCA_LEVELS[level];
  const next = nextDef.actions.map((a) => nextAction(a, facts, doneAt));
  const base = progressOf(nextDef, facts);
  const progress = base.unit === 'items' ? { ...base, done: next.filter((a) => a.done).length } : base;
  return { level, doneAt, progress, next, nextLevel: levelRef(nextDef), top: false };
}
