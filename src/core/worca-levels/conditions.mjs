// src/core/worca-levels/conditions.mjs
// One small predicate per ladder item or choice id: facts -> { met, at?, count?, of?, parts?, unknown? }.
//   at       the instant the thing really happened (else the evaluator stamps `now`)
//   count/of progress shown while the item is not done
//   parts    several counters under one item, [{ count, of }]
//   unknown  the fact could not be read (offline, no git host); not met, and shown as unknown
// Facts for levels 3 to 5 are neutral (not met) until their sources are filled, so every predicate reads
// optionally and never throws.
import { WORCA_LEVELS, WORCA_THRESHOLDS as T } from '../../shared/worca-levels.mjs';

/** Team metrics and Team policy: the two things "Team set up" counts. */
const TEAM_STEPS = 2;

/** A flag from a source that can fail (offline team service): unreadable means off. */
export const readsTrue = (f, key) => {
  try {
    return f[key] === true;
  } catch {
    return false;
  }
};

const n = (v) => (Number.isFinite(v) ? v : 0);

/** A counted condition: met at `of`, carrying the counter. `at` is the instant it was first met, when known. */
const counted = (count, of, { at, unknown } = {}) => {
  const met = n(count) >= of;
  const out = { met, count: Math.min(n(count), of), of };
  if (met && at) out.at = at;
  if (!met && unknown) out.unknown = true;
  return out;
};

const flag = (ok, at) => (at ? { met: !!ok, at } : { met: !!ok });

export const CONDITIONS = Object.freeze({
  // Level 1 (D-7): the provider counts only once setup is finished, so both hold at the same evaluation (I-8).
  setupFinished: (f) => flag(f.setupFinished === true),
  providerSignedIn: (f) => flag(f.setupFinished === true && f.providerSignedIn === true),

  // Level 2: steps 7 to 9 of Getting started are never read (R-po-4).
  runnerSteps: (f) => counted(f.runnerSteps?.done, T.runnerSteps),
  realRuns: (f) => counted(f.realRuns, T.runnerRealRuns),

  // Level 3
  hookedRuns: (f) => {
    const runs = n(f.runsOnDays?.runs);
    const days = n(f.runsOnDays?.days);
    const met = runs >= T.hookedRuns && days >= T.hookedDays;
    const parts = [
      { count: Math.min(runs, T.hookedRuns), of: T.hookedRuns },
      { count: Math.min(days, T.hookedDays), of: T.hookedDays },
    ];
    const at = f.runsOnDays?.metAt;
    const base = { met, parts };
    if (met && at) return { ...base, at };
    return f.daysUnknown === true && !met ? { ...base, unknown: true } : base;
  },
  prOpened: (f) => counted(f.prsOpened, T.prsOpened),
  // The team rule (visibility and both halves) is the evaluator's; here: both team steps are on.
  teamSetUp: (f) => {
    const count = Number(readsTrue(f, 'teamMetricsOn')) + Number(readsTrue(f, 'teamPolicyOn'));
    return { met: count >= TEAM_STEPS, count, of: TEAM_STEPS, parts: [{ count, of: TEAM_STEPS }] };
  },
  scheduledRunDone: (f) => flag(f.scheduledRunDone === true),
  workspaceRunDone: (f) => flag(f.workspaceRunDone === true),
  addonInstalled: (f) => flag(n(f.addonsInstalled) >= 1),
  prMerged: (f) => {
    const met = n(f.prsMerged) >= 1;
    return !met && f.prMergedUnknown === true ? { met, unknown: true } : { met };
  },
  twoProjects: (f) => counted(f.projects, T.hookedProjects),

  // Level 4
  parallelFeatures: (f) => flag(!!f.parallelDoneAt, f.parallelDoneAt ?? undefined),
  prsMerged: (f) => counted(f.prsMerged, T.holicMergedPrs, { unknown: f.prMergedUnknown === true }),
  repeatingScheduleRuns: (f) => counted(f.repeatingScheduleRunsMax, T.repeatingScheduleRuns),
  addonsAtOnce: (f) => counted(f.addonsAtOnce, T.addonsAtOnce),
  threeProjects: (f) => counted(f.projects, T.holicProjects),

  // Level 5
  councilDays: (f) => {
    const days = n(f.activeDays?.inWindow);
    return counted(days, T.councilDays, { at: f.activeDays?.metAt ?? undefined, unknown: f.daysUnknown === true });
  },
});

for (const { items } of WORCA_LEVELS) {
  for (const it of items) {
    for (const part of it.kind === 'pick' ? it.choices : [it]) {
      if (typeof CONDITIONS[part.id] !== 'function') throw new Error(`worca-levels: no condition for item "${part.id}"`);
    }
  }
}
