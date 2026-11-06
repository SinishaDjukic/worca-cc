// src/core/worca-levels/store.mjs
// Persisted per-person worca-level state: <settings root>/.worca-cc/worca-levels.json, beside
// away-people.json. Shape { version: 1, people: { [key]: PersonRecord } }.
//
// updatePerson() is the ONLY writer. Updates run through an in-process promise queue, so two
// parallel calls for one key never lose a write; each call re-reads the file, hands `fn` the
// stored record (or null), and writes the record `fn` returns with writeJsonAtomic.

import { readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRoot } from '../settings.mjs';
import { writeJsonAtomic } from '../json-atomic.mjs';

export const STORE_VERSION = 1;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class WorcaLevelKeyError extends Error {
  constructor(key) {
    super(`worca-level store: invalid person key ${JSON.stringify(String(key))}`);
    this.name = 'WorcaLevelKeyError';
    this.code = 'WORCA_LEVEL_BAD_KEY';
  }
}

export class WorcaLevelRecordError extends Error {
  constructor(key) {
    super(`worca-level store: update for ${JSON.stringify(key)} did not return a record object`);
    this.name = 'WorcaLevelRecordError';
    this.code = 'WORCA_LEVEL_BAD_RECORD';
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function worcaLevelsFile() {
  return join(defaultRoot(), '.worca-cc', 'worca-levels.json');
}

function assertKey(key) {
  if (typeof key !== 'string' || !key.trim() || FORBIDDEN_KEYS.has(key)) throw new WorcaLevelKeyError(key);
}

function emptyData() {
  return { version: STORE_VERSION, people: Object.create(null) };
}

function quarantine(file, reason) {
  const to = `${file}.corrupt-${Date.now()}`;
  try {
    renameSync(file, to);
    console.warn(`worca-levels: ${reason}; moved ${file} to ${to} and starting empty`);
  } catch (err) {
    console.warn(`worca-levels: ${reason}; could not move ${file} aside (${err.message}); starting empty`);
  }
}

function parseData(text) {
  const data = JSON.parse(text);
  if (!isObj(data) || !isObj(data.people)) throw new Error('unexpected shape');
  const people = Object.create(null);
  for (const [k, v] of Object.entries(data.people)) if (!FORBIDDEN_KEYS.has(k) && isObj(v)) people[k] = v;
  return { version: STORE_VERSION, people };
}

/**
 * Read the whole file. Missing -> empty. Corrupt -> renamed aside, logged, empty.
 * Any other read error (EACCES, EMFILE, EIO) throws when `strict`, so a writer never overwrites
 * the file with an empty set; a reader (not strict) logs and answers empty.
 */
function load({ strict = false } = {}) {
  const file = worcaLevelsFile();
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyData();
    if (strict) throw err;
    console.warn(`worca-levels: cannot read ${file} (${err.message}); answering empty`);
    return emptyData();
  }
  try {
    return parseData(text);
  } catch (err) {
    quarantine(file, `corrupt file (${err.message})`);
    return emptyData();
  }
}

/** The stored record for `key`, or null. */
export function readPerson(key) {
  assertKey(key);
  return load().people[key] ?? null;
}

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

/**
 * Serialised read-modify-write of one person. `fn(record|null)` returns the NEW record (never
 * mutate the one it is given). Resolves to the record that was written.
 */
export function updatePerson(key, fn) {
  try { assertKey(key); } catch (err) { return Promise.reject(err); }
  return enqueue(() => {
    const data = load({ strict: true });   // a failed read must not turn into a write of an empty file
    const next = fn(data.people[key] ?? null);
    if (!isObj(next)) throw new WorcaLevelRecordError(key);
    data.people[key] = next;
    writeJsonAtomic(worcaLevelsFile(), data);
    return next;
  });
}

function blankLive() {
  return { addons: [], addonPeak: 0, spaces: false, statsViewedAt: null, teamMetricsOpenedAt: null };
}

function blankRecord(now) {
  return {
    level: 0,
    celebrated: 0,
    welcome: { kind: 'new', seenAt: null },
    doneAt: {},
    tz: null,
    live: blankLive(),
    createdAt: now,
    updatedAt: now,
  };
}

const isIso = (v) => typeof v === 'string' && v !== '' && Number.isFinite(Date.parse(v));

// A latched timestamp keeps its first valid value; a later (or malformed) write changes nothing.
const latch = (existing, incoming) => (isIso(existing) ? existing : isIso(incoming) ? incoming : null);

/**
 * Build the next `live` block from the stored one and a patch. Only the known keys survive, so a
 * legacy block loses its removed fields. Never mutates `live` or `patch`.
 */
function mergeLive(live, patch) {
  const base = isObj(live) ? live : {};
  const addons = Array.isArray(base.addons) ? base.addons.filter((a) => typeof a === 'string') : [];
  const peak = Number.isFinite(base.addonPeak) ? base.addonPeak : 0;
  const addon = typeof patch.addon === 'string' && patch.addon ? patch.addon : null;
  const nextPeak = Number.isFinite(patch.addonPeak) ? patch.addonPeak : 0;
  return {
    addons: addon && !addons.includes(addon) ? [...addons, addon] : addons,
    addonPeak: Math.max(peak, nextPeak),
    spaces: base.spaces === true || patch.space === true,
    statsViewedAt: latch(base.statsViewedAt, patch.statsViewedAt),
    teamMetricsOpenedAt: latch(base.teamMetricsOpenedAt, patch.teamMetricsOpenedAt),
  };
}

/**
 * Merge a live event into `live`: { addon: id, addonPeak: n, space: true, statsViewedAt: ISO,
 * teamMetricsOpenedAt: ISO }. Malformed values are ignored. Creates the record when absent.
 */
export function recordLive(key, patch = {}) {
  const p = isObj(patch) ? patch : {};
  return updatePerson(key, (rec) => {
    const now = new Date().toISOString();
    const base = rec ?? blankRecord(now);
    return { ...base, live: mergeLive(base.live, p), updatedAt: now };
  });
}
