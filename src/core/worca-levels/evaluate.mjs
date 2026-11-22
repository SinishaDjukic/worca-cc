// src/core/worca-levels/evaluate.mjs
// Pure level evaluation: facts + a person's record + `now` ->
//   { level, doneAt, reachedAt, progress, next, nextLevel, top, levels }.
// No I/O and no clock (the caller passes `now`); neither input is mutated (I-3). Deciding whether a level-up
// deserves a celebration is the service's job, not this module's. Level 0 means "no level yet".
import { WORCA_LEVELS, WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';
import { CONDITIONS, readsTrue } from './conditions.mjs';

const TOP_LEVEL = WORCA_LEVELS[WORCA_LEVELS.length - 1].index;

const isIso = (v) => typeof v === 'string' && v !== '' && Number.isFinite(Date.parse(v));
const leavesOf = (item) => (item.kind === 'pick' ? item.choices : [item]);
const allLeaves = WORCA_LEVELS.flatMap((l) => l.items.flatMap(leavesOf));

/** A fact source that cannot be read (offline, no team service) counts as "not done", never as an error. */
const NOT_MET = Object.freeze({ met: false });
function conditionOf(id, facts) {
  try {
    return CONDITIONS[id](facts) ?? NOT_MET;
  } catch {
    return NOT_MET;
  }
}

/** The latched map: every stored stamp kept as-is (I-2), every newly met item or choice stamped `at ?? now`. */
function latch(facts, stored, now) {
  const merged = { ...stored };
  for (const { id } of allLeaves) {
    if (merged[id]) continue;
    const c = conditionOf(id, facts);
    if (c.met) merged[id] = c.at ?? now;
  }
  return merged;
}

/** The ladder fields an ItemView repeats from the item. */
function staticFields(item) {
  const { id, label, hint, href, openLabel, kind, need, onlyFor, threshold, unit } = item;
  const out = { id, label, hint, href, openLabel, kind };
  if (need !== undefined) out.need = need;
  if (onlyFor) out.onlyFor = onlyFor;
  if (threshold !== undefined) out.threshold = threshold;
  if (unit) out.unit = unit;
  return out;
}

function singleView(item, facts, doneAt) {
  const c = conditionOf(item.id, facts);
  const done = !!doneAt[item.id];
  const view = { ...staticFields(item), status: done ? 'done' : c.unknown ? 'unknown' : 'todo', done, doneAt: doneAt[item.id] ?? null };
  if (done) return view;
  if (c.count !== undefined) { view.count = c.count; view.of = c.of; }
  if (c.parts) view.parts = c.parts;
  return view;
}

/** A pick item is done when `need` of its choices are latched; its stamp is the `need`-th choice stamp. */
function pickView(item, facts, doneAt) {
  const choices = item.choices.map((c) => singleView(c, facts, doneAt));
  const stamps = choices.filter((c) => c.done).map((c) => c.doneAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  const done = stamps.length >= item.need;
  const view = { ...staticFields(item), status: done ? 'done' : 'todo', done, doneAt: done ? stamps[item.need - 1] : null, choices };
  return done ? view : { ...view, count: stamps.length, of: item.need };
}

/** A team-only item is shown (and required) for people on a team, or once it has been latched (R-po-31, R-po-35). */
const visible = (item, facts, doneAt) =>
  !item.onlyFor || readsTrue(facts, 'teamMetricsOn') || readsTrue(facts, 'teamPolicyOn') || !!doneAt[item.id];

function levelViews(facts, doneAt) {
  const out = {};
  for (const l of WORCA_LEVELS) {
    out[l.index] = l.items
      .filter((item) => visible(item, facts, doneAt))
      .map((item) => (item.kind === 'pick' ? pickView(item, facts, doneAt) : singleView(item, facts, doneAt)));
  }
  return out;
}

/** Highest level N such that every required item of every level <= N is done; 0 when Curious is not. A level the
 *  record already holds counts as satisfied (A-11, R-po-39): a missing item of it never blocks the climb above. */
function earnedLevel(levels, held) {
  let reached = 0;
  for (const l of WORCA_LEVELS) {
    if (l.index > held && !levels[l.index].every((v) => v.done)) break;
    reached = l.index;
  }
  return reached;
}

/** Existing stamps are never changed (I-2); a held level without one gets the latest stamp of its items, else `now`. */
function stampReached(stored, level, levels, now) {
  const out = {};
  for (const [k, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) if (isIso(v)) out[k] = v;
  for (let index = 1; index <= level; index++) {
    if (out[index]) continue;
    const stamps = levels[index].map((v) => v.doneAt).filter(isIso);
    out[index] = stamps.length ? stamps.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : now;
  }
  return out;
}

const levelRef = ({ index, key, name }) => ({ index, key, name });

function progressOf(nextDef, views, facts) {
  if (nextDef.index === TOP_LEVEL) {
    const total = WORCA_THRESHOLDS.councilDays;
    const days = Number.isFinite(facts.activeDays?.inWindow) ? facts.activeDays.inWindow : 0;
    return { done: Math.min(days, total), total, unit: 'days' };
  }
  return { done: views.filter((v) => v.done).length, total: views.length, unit: 'items' };
}

export function evaluate(facts, record, now) {
  const stored = (record && record.doneAt) || {};
  const doneAt = latch(facts, stored, now);
  const levels = levelViews(facts, doneAt);
  const held = (record && record.level) || 0;
  const level = Math.max(held, earnedLevel(levels, held));
  const reachedAt = stampReached(record && record.reachedAt, level, levels, now);
  if (level >= TOP_LEVEL) {
    return { level, doneAt, reachedAt, progress: null, next: null, nextLevel: null, top: true, levels };
  }
  const nextDef = WORCA_LEVELS[level];
  const next = levels[nextDef.index];
  return { level, doneAt, reachedAt, progress: progressOf(nextDef, next, facts), next, nextLevel: levelRef(nextDef), top: false, levels };
}
