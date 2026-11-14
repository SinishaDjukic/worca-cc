// src/core/usage-limits.mjs — the harnesses' own plan-limit readings (the profile's usage rings, D7, D8).
// The Claude normaliser turns the CLI's rate-limit frame into a `limit` event; runs, chats and the session host
// forward it here. Readings are kept per engine, in usage-limits.json under WORCA_HOME (temp file plus rename,
// written only on a change), and served at GET /api/usage-limits. Nothing renders them with `rail` off.
import fs from 'node:fs';
import path from 'node:path';
import { worcaHome } from './projects.mjs';
import { writeJsonAtomic } from './json-atomic.mjs';

/** The CLI's window types the rings draw; any other is ignored. */
const KIND = { five_hour: 'session', seven_day: 'week' };
const ORDER = ['session', 'week'];
const listeners = new Set();
let cache = null;   // { file, harnesses: { [engine]: { observedAt, windows: { [kind]: { pct, resetsAt } } } } }

const fileOf = () => path.join(worcaHome(), 'usage-limits.json');
const finite = (v) => (Number.isFinite(v) ? v : null);

/** A stored reading, or null when its shape is wrong. */
function validReading(r) {
  if (!r || typeof r !== 'object' || !r.windows || typeof r.windows !== 'object' || Array.isArray(r.windows)) return null;
  const windows = {};
  for (const k of ORDER) {
    const w = r.windows[k];
    if (w && Number.isFinite(w.pct)) windows[k] = { pct: Math.min(100, Math.max(0, Math.round(w.pct))), resetsAt: finite(w.resetsAt) };
  }
  return { observedAt: finite(r.observedAt), windows };
}

/** Reads usage-limits.json; a missing, unreadable or malformed file reads as no readings. */
export function loadUsageLimits() {
  const file = fileOf();
  const harnesses = {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const h = j && typeof j === 'object' && j.harnesses && typeof j.harnesses === 'object' ? j.harnesses : {};
    for (const [engine, r] of Object.entries(h)) { const v = validReading(r); if (v && Object.keys(v.windows).length) harnesses[engine] = v; }
  } catch { /* none yet, or unreadable: empty */ }
  cache = { file, harnesses };
  return cache.harnesses;
}

const current = () => (cache && cache.file === fileOf() ? cache.harnesses : loadUsageLimits());

function persist() {
  try { writeJsonAtomic(cache.file, { version: 1, harnesses: cache.harnesses }); } catch { /* a display reading: the memory copy still serves */ }
}

/** Keeps one `limit` event's readings for `engine`. Returns whether anything changed (and then persists and tells
 *  the listeners). A window without a numeric utilization, or of a type the rings do not draw, changes nothing. */
export function recordUsageLimit(engine, limitEvent, { now = Date.now() } = {}) {
  if (!engine || typeof engine !== 'string' || limitEvent?.type !== 'limit' || !Array.isArray(limitEvent.windows)) return false;
  const harnesses = current();
  const prev = harnesses[engine]?.windows || {};
  const next = { ...prev };
  let changed = false;
  for (const w of limitEvent.windows) {
    const kind = KIND[w?.window];
    if (!kind || !Number.isFinite(w.utilization)) continue;
    const reading = { pct: Math.min(100, Math.max(0, Math.round(w.utilization * 100))), resetsAt: finite(w.resetsAt) };
    if (prev[kind]?.pct === reading.pct && prev[kind]?.resetsAt === reading.resetsAt) continue;
    next[kind] = reading; changed = true;
  }
  if (!changed) return false;
  harnesses[engine] = { observedAt: now, windows: next };
  persist();
  const view = usageLimits({ now });
  for (const fn of listeners) { try { fn(view); } catch { /* a listener's own problem */ } }
  return true;
}

/** The readings to draw: { harnesses: [{ engine, observedAt, windows: [{ kind, pct, resetsAt }] }] }, by engine;
 *  a window whose reset has passed is dropped, and a harness with none left. */
export function usageLimits({ now = Date.now() } = {}) {
  const harnesses = [];
  for (const [engine, r] of Object.entries(current()).sort(([a], [b]) => a.localeCompare(b))) {
    const windows = ORDER.filter((k) => r.windows[k] && !(r.windows[k].resetsAt != null && r.windows[k].resetsAt <= now))
      .map((k) => ({ kind: k, pct: r.windows[k].pct, resetsAt: r.windows[k].resetsAt }));
    if (windows.length) harnesses.push({ engine, observedAt: r.observedAt, windows });
  }
  return { harnesses };
}

/** Registers a listener for a changed reading; returns its unsubscribe. */
export function onUsageLimitsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function _resetUsageLimitsForTests() { cache = null; }
