// src/core/worca-levels/migrate.mjs
// Pure repair and migration of a stored per-person record. The service reads records only through
// normaliseRecord, so a damaged record (hand-edited, truncated, written by a newer build) yields a view
// instead of a throw; migrateRecord carries a v1 record (no `rules`) into the v2 shape. No I/O and no clock
// reads beyond the `now` default; the input is never mutated.
import { WORCA_LEVELS, WORCA_LEVEL_COUNT } from '../../shared/worca-levels.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && v !== '' && Number.isFinite(Date.parse(v));
const isoOrNull = (v) => (isIso(v) ? v : null);
const stampOr = (v, fallback) => (typeof v === 'string' && v !== '' ? v : fallback);

/** An integer in 1..COUNT; 0 (the "not created yet" marker of a live-only record) for anything unusable. */
function clampLevel(v) {
  if (!Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return n < 1 ? 0 : Math.min(n, WORCA_LEVEL_COUNT);
}

function clampCelebrated(v, level) {
  const n = Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.min(Math.max(n, 0), level);
}

/** A missing or unusable welcome is treated as already seen (at createdAt, else now) so it never re-opens. */
function normaliseWelcome(w, createdAt, now) {
  if (!isObj(w)) return { kind: 'new', seenAt: stampOr(createdAt, now) };
  return { kind: w.kind === 'existing' ? 'existing' : 'new', seenAt: isoOrNull(w.seenAt) };
}

function normaliseDoneAt(d) {
  const out = {};
  if (isObj(d)) for (const [k, v] of Object.entries(d)) if (isIso(v)) out[k] = v;
  return out;
}

/** { [level index 1..COUNT]: ISO }; any other key or value is dropped. */
function normaliseReachedAt(r) {
  const out = {};
  if (isObj(r)) {
    for (let index = 1; index <= WORCA_LEVEL_COUNT; index++) if (isIso(r[index])) out[index] = r[index];
  }
  return out;
}

/** { from, to, shownAt } with whole levels 0..COUNT, or null. */
function normaliseSummary(s) {
  if (!isObj(s)) return null;
  const level = (v) => (Number.isInteger(v) && v >= 0 && v <= WORCA_LEVEL_COUNT ? v : null);
  const from = level(s.from);
  const to = level(s.to);
  return from === null || to === null ? null : { from, to, shownAt: isoOrNull(s.shownAt) };
}

const SUGGESTION_ANSWERS = Object.freeze(['dismissed', 'accepted', 'skipped']);
const answerOrNull = (v) => (SUGGESTION_ANSWERS.includes(v) ? v : null);

function normaliseModeSuggestion(m) {
  const base = isObj(m) ? m : {};
  return { advanced: answerOrNull(base.advanced), expert: answerOrNull(base.expert) };
}

export function normaliseLive(live) {
  const base = isObj(live) ? live : {};
  return {
    addons: Array.isArray(base.addons) ? base.addons.filter((a) => typeof a === 'string') : [],
    addonPeak: Number.isFinite(base.addonPeak) ? base.addonPeak : 0,
    spaces: base.spaces === true,
    statsViewedAt: isoOrNull(base.statsViewedAt),
    teamMetricsOpenedAt: isoOrNull(base.teamMetricsOpenedAt),
  };
}

/** A stored record -> a record with every field valid (v1 and v2 fields), or null when `raw` is not an object. */
export function normaliseRecord(raw, now = new Date().toISOString()) {
  if (!isObj(raw)) return null;
  const level = clampLevel(raw.level);
  return {
    ...raw,
    level,
    celebrated: clampCelebrated(raw.celebrated, level),
    welcome: normaliseWelcome(raw.welcome, raw.createdAt, now),
    doneAt: normaliseDoneAt(raw.doneAt),
    reachedAt: normaliseReachedAt(raw.reachedAt),
    summary: normaliseSummary(raw.summary),
    nudged: normaliseDoneAt(raw.nudged),
    modeSuggestion: normaliseModeSuggestion(raw.modeSuggestion),
    tz: typeof raw.tz === 'string' && raw.tz ? raw.tz : null,
    live: normaliseLive(raw.live),
    createdAt: stampOr(raw.createdAt, now),
    updatedAt: stampOr(raw.updatedAt, now),
  };
}

/** The v1 `doneAt` ids that still mean the same thing in v2 (R-po-11); every other v1 stamp is dropped. */
const KEPT_DONE_IDS = Object.freeze(['parallelFeatures', 'addonInstalled', 'addonsAtOnce']);

/** A v1 level below this is not kept as a floor: the new rules re-decide Curious from the facts. */
const FLOOR_FROM_LEVEL = 2;

const leafIds = (item) => (item.kind === 'pick' ? item.choices.map((c) => c.id) : [item.id]);

/** The instant a held level was reached: its own stamp, else the latest v1 stamp among its items, else absent. */
function reachedStamp(index, stamped, doneAt) {
  if (stamped[index]) return stamped[index];
  const stamps = WORCA_LEVELS[index - 1].items.flatMap(leafIds).map((id) => doneAt[id]).filter(Boolean);
  return stamps.length ? stamps.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null;
}

function migrateV1(v1, level) {
  const doneAt = {};
  for (const id of KEPT_DONE_IDS) if (v1.doneAt[id]) doneAt[id] = v1.doneAt[id];
  const reachedAt = {};
  for (let index = 1; index <= level; index++) {
    const at = reachedStamp(index, v1.reachedAt, v1.doneAt);
    if (at) reachedAt[index] = at;
  }
  return {
    ...v1,
    rules: 2,
    level,
    celebrated: Math.min(v1.celebrated, level),
    doneAt,
    reachedAt,
    summary: null,
    nudged: {},
    modeSuggestion: { advanced: null, expert: null },
  };
}

/**
 * A stored record (or null) -> { record, from }. A v2 record (`rules: 2`) passes through normaliseRecord and
 * `from` is its level. Anything else is a v1 or live-only record: its level stays a floor only from
 * FLOOR_FROM_LEVEL up, three `doneAt` ids are kept, and nothing is stamped for Curious, so setup and the
 * provider latch from the facts at the first v2 evaluation (I-2). `from` is the v1 level, 0 when there was none.
 * Pure and idempotent (I-14): migrating its own output returns the same record.
 */
export function migrateRecord(raw, { now = new Date().toISOString() } = {}) {
  const norm = normaliseRecord(isObj(raw) ? raw : {}, now);
  if (norm.rules === 2) return { record: norm, from: norm.level };
  const level = norm.level >= FLOOR_FROM_LEVEL ? norm.level : 0;
  return { record: normaliseRecord(migrateV1(norm, level), now), from: norm.level };
}
