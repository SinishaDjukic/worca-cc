// src/core/worca-levels/evaluate.mjs
// Pure level evaluation: facts + a person's record + `now` -> { level, doneAt, progress, next, top }.
// No I/O and no clock (the caller passes `now`); the record is never mutated. Deciding whether a
// level-up deserves a celebration is the service's job, not this module's (plans/…-v2.md I-3).
import { WORCA_LEVELS, WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';

const TOP_LEVEL = WORCA_LEVELS[WORCA_LEVELS.length - 1].index;

// Does the fact behind each action meet its condition? One small predicate per action id.
const CONDITIONS = Object.freeze({
  gettingStarted: (f) => !!f.gettingStartedDone,
  // D-6: with the requirements flag off there is no requirement to write, so a started run counts.
  firstRequirement: (f) => f.requirements >= 1 || (!f.requirementsFlag && f.startedRuns >= 1),
  firstFeatureDone: (f) => f.doneRuns >= 1,
  addonInstalled: (f) => f.addonsInstalled >= 1,
  spaceSetUp: (f) => f.spaces >= 1,
  scheduleCreated: (f) => f.schedules >= 1,
  statsViewed: (f) => f.statsDays >= 1,
  parallelFeatures: (f) => f.peakParallel >= WORCA_THRESHOLDS.parallelFeatures,
  addonsInUse: (f) => f.addonsEnabled >= WORCA_THRESHOLDS.addonsInUse,
  scheduledRuns: (f) => f.scheduledRuns >= WORCA_THRESHOLDS.scheduledRuns,
  metricsRegular: (f) => f.statsDays >= WORCA_THRESHOLDS.metricsDays,
});

const allActions = WORCA_LEVELS.flatMap((l) => l.actions);

/** The latched map: every stored entry kept, every newly met action stamped with `now`. */
function latch(facts, stored, now) {
  const merged = { ...stored };
  for (const { id } of allActions) {
    if (!merged[id] && CONDITIONS[id](facts)) merged[id] = now;
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

function nextView(level, doneAt) {
  const actions = WORCA_LEVELS[level].actions.map((a) => ({
    ...a,
    done: !!doneAt[a.id],
    doneAt: doneAt[a.id] ?? null,
  }));
  return {
    next: actions,
    progress: { done: actions.filter((a) => a.done).length, total: actions.length },
  };
}

export function evaluate(facts, record, now) {
  const stored = (record && record.doneAt) || {};
  const doneAt = latch(facts, stored, now);
  const level = Math.max((record && record.level) || 1, earnedLevel(doneAt));
  if (level >= TOP_LEVEL) return { level, doneAt, progress: null, next: null, top: true };
  return { level, doneAt, ...nextView(level, doneAt), top: false };
}
