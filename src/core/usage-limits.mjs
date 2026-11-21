// src/core/usage-limits.mjs — the providers' own plan-limit readings (the profile's usage rings).
// Claude's `limit` events (runs and chats), Codex's session file and Gemini's quota call convert their figures with
// `toUsagePct`/`toResetMs` and record them here. The latest reading per engine is kept in usage-limits.json under
// WORCA_HOME (atomic write, only on a change) and served at GET /api/usage-limits. Only engine, kind, pct and times
// are kept: never a token, account, path or plan name.
import fs from 'node:fs';
import path from 'node:path';
import { worcaHome } from './projects.mjs';
import { writeJsonAtomic } from './json-atomic.mjs';

export const KINDS = Object.freeze(['session', 'week', 'day']);
export const ENGINES = Object.freeze(['claude', 'codex', 'gemini']);
/** The window a usage-limit pause fills: the one that engine has (Gemini has no session window). */
const PAUSE_KIND = Object.freeze({ claude: 'session', codex: 'session', gemini: 'day' });
/** Claude's window names the rings draw; any other (`seven_day_opus`, `overage`, …) is ignored. */
const CLAUDE_KIND = Object.freeze({ five_hour: 'session', seven_day: 'week' });
const SCALE = Object.freeze({ fraction: 100, percent: 1, 'fraction-left': 100 });

const listeners = new Set();
let cache = null; // { file, sig, harnesses: { [engine]: { observedAt, windows: { [kind]: { pct, resetsAt } } } } }

const fileOf = () => path.join(worcaHome(), 'usage-limits.json');
const isPct = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
const isTime = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** The file's mtime and size, or null when absent: another Worca process (a CLI run) may write it too. */
const sigOf = (file) => { try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; } catch { return null; } };

/** A provider figure as an integer percent 0–100, half-up after cleaning float noise (0.485 → 49); null when not a
 *  finite number or the unit is unknown. `fraction-left` is a share LEFT (Gemini): used = 1 − it. */
export function toUsagePct(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(unit in SCALE)) return null;
  const x = unit === 'fraction-left' ? 1 - value : value;
  const pct = Math.round(Number((x * SCALE[unit]).toPrecision(12)));
  return Math.min(100, Math.max(0, pct)) || 0;
}

/** A reset time in ms: a number below 1e11 is seconds, from 1e11 ms; a string is an ISO date; else null. */
export function toResetMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : null;
  if (typeof value === 'string') { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; }
  return null;
}

/** A stored reading, or null when nothing in it is valid. */
function validReading(r) {
  if (!isObj(r) || !isObj(r.windows)) return null;
  const windows = {};
  for (const k of KINDS) {
    const w = r.windows[k];
    if (isObj(w) && isPct(w.pct) && isTime(w.resetsAt)) windows[k] = { pct: w.pct, resetsAt: w.resetsAt };
  }
  if (!Object.keys(windows).length) return null;
  return { observedAt: isTime(r.observedAt) ? r.observedAt : null, windows };
}

/** Reads usage-limits.json; a missing, unparsable or wrong-shaped file reads as no readings. Never throws. */
export function loadUsageLimits() {
  let file = null;
  let sig = null;
  const harnesses = {};
  try {
    file = fileOf();
    sig = sigOf(file);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const h = isObj(j) && isObj(j.harnesses) ? j.harnesses : {};
    for (const engine of ENGINES) { const v = validReading(h[engine]); if (v) harnesses[engine] = v; }
  } catch { /* none yet, or unreadable: empty */ }
  cache = { file, sig, harnesses };
  return harnesses;
}

/** The cached readings, read again when the file changed on disk since (so a write merges another process's). */
const current = () => (cache && cache.file === fileOf() && cache.sig === sigOf(cache.file) ? cache.harnesses : loadUsageLimits());

const LOCK_STALE_MS = 2000;
const LOCK_TRIES = 5;
const LOCK_WAIT_MS = 10;

const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev && a.mtimeMs === b.mtimeMs;

/** Breaks `lock` only while it is still `seen` (the stale stat that judged it): renames it to a unique name, so of
 *  two breakers only one rename lands, then checks the renamed file is `seen`. When it is not (a fresh holder's lock
 *  took its place in between), it is linked back without replacing a newer lock. True when the stale lock was ours
 *  to break. */
export function breakStaleLock(lock, seen) {
  const aside = `${lock}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try { fs.renameSync(lock, aside); } catch { return false; }
  let stale = false;
  try { stale = sameFile(fs.statSync(aside), seen); } catch { /* gone */ }
  if (!stale) { try { fs.linkSync(aside, lock); } catch { /* a newer lock is already there */ } }
  try { fs.unlinkSync(aside); } catch { /* already gone */ }
  return stale;
}

/** Runs `fn` holding `<file>.lock` (O_EXCL), so a second Worca process cannot commit between our re-read and our
 *  write. A lock older than LOCK_STALE_MS is a crashed holder's and is broken (`breakStaleLock`). Returns false,
 *  without running `fn`, when the lock stays held after a few short waits. On release it unlinks the lock only while
 *  it is still the file this call created. */
export function withStoreLock(file, fn) {
  const lock = `${file}.lock`;
  let fd = null;
  for (let i = 0; i < LOCK_TRIES && fd === null; i++) {
    try { fd = fs.openSync(lock, 'wx'); break; } catch (e) {
      if (e?.code === 'ENOENT') { fs.mkdirSync(path.dirname(lock), { recursive: true }); continue; }
      if (e?.code !== 'EEXIST') return false;
    }
    try {
      const seen = fs.statSync(lock);
      if (Date.now() - seen.mtimeMs > LOCK_STALE_MS) { breakStaleLock(lock, seen); continue; }
    } catch { continue; /* the holder just let go */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
  }
  if (fd === null) return false;
  try { fn(); return true; } finally {
    try {
      const mine = fs.fstatSync(fd);
      const now = fs.statSync(lock);
      if (mine.ino === now.ino && mine.dev === now.dev) fs.unlinkSync(lock);
    } catch { /* already gone */ }
    fs.closeSync(fd);
  }
}

/** Merges one reading into `harnesses[engine]` in place; true when a pct or reset changed. `observedAt` always
 *  moves forward; an engine with no reading and no valid window is left absent. */
function mergeReading(harnesses, engine, observedAt, windows, now) {
  const prev = harnesses[engine];
  const next = { ...(prev?.windows || {}) };
  let changed = false;
  for (const w of windows) {
    if (!isObj(w) || !KINDS.includes(w.kind) || !isPct(w.pct) || !isTime(w.resetsAt)) continue;
    const old = next[w.kind];
    if (old && old.pct === w.pct && old.resetsAt === w.resetsAt) continue;
    next[w.kind] = { pct: w.pct, resetsAt: w.resetsAt };
    changed = true;
  }
  if (!prev && !changed) return false;
  const seen = isTime(observedAt) ? observedAt : now;
  harnesses[engine] = { observedAt: Math.max(prev?.observedAt ?? -Infinity, seen), windows: next };
  return changed;
}

/** Keeps one converted reading for `engine`: `windows` [{ kind, pct, resetsAt }], a reading replacing only the kinds
 *  it names. `observedAt` always moves forward in memory; only a pct or reset change writes the file, tells the
 *  listeners and returns true. The write re-reads and merges the file under the store lock; when the lock is held
 *  the write is skipped and the memory copy serves. */
export function recordUsageReading(engine, { observedAt, windows } = {}, { now = Date.now() } = {}) {
  if (!ENGINES.includes(engine) || !Array.isArray(windows)) return false;
  if (!mergeReading(current(), engine, observedAt, windows, now)) return false;
  try {
    if (cache.file) withStoreLock(cache.file, () => {
      const disk = loadUsageLimits(); // the fresh cache: the merge below lands in memory even if the write fails
      mergeReading(disk, engine, observedAt, windows, now);
      writeJsonAtomic(cache.file, { version: 1, harnesses: disk });
      cache.sig = null; // read the file back on the next read, never a post-write stat another process may race
    });
  } catch { /* a display reading: the memory copy still serves */ }
  const view = usageLimits({ now });
  for (const fn of listeners) { try { fn(view); } catch { /* a listener's own problem */ } }
  return true;
}

/** Keeps one Claude `limit` event (from the normaliser): five_hour → session, seven_day → week. */
export function recordClaudeLimit(limitEvent, opts) {
  if (limitEvent?.type !== 'limit' || !Array.isArray(limitEvent.windows)) return false;
  const windows = [];
  for (const w of limitEvent.windows) {
    const kind = CLAUDE_KIND[w?.window];
    if (kind) windows.push({ kind, pct: toUsagePct(w.utilization, 'fraction'), resetsAt: w.resetsAt ?? null });
  }
  return recordUsageReading('claude', { observedAt: opts?.now, windows }, opts);
}

/** `{ harnesses: [{ engine, observedAt, windows: [{ kind, pct, resetsAt }] }] }` from a reading map, engines and
 *  kinds in their fixed order, dropping passed resets and engines with none left. */
function answerOf(map, now) {
  const harnesses = [];
  for (const engine of ENGINES) {
    const r = map[engine];
    if (!r) continue;
    const windows = KINDS.filter((k) => r.windows[k] && r.windows[k].resetsAt > now)
      .map((k) => ({ kind: k, pct: r.windows[k].pct, resetsAt: r.windows[k].resetsAt }));
    if (windows.length) harnesses.push({ engine, observedAt: r.observedAt, windows });
  }
  return { harnesses };
}

/** The stored readings still live at `now`. */
export function usageLimits({ now = Date.now() } = {}) {
  return answerOf(current(), now);
}

/** The API answer: the stored readings plus, for each usage-limit pause (`[{ engine, resetsAt, pausedAt }]`, ms) with
 *  a future reset, that engine's pause window at 100% until the pause's reset. A stored window already at 100 keeps
 *  its own reset; an engine with no reading takes the pause time as "as of". Never written to the store. */
export function usageLimitsAnswer({ now = Date.now(), pauses = [] } = {}) {
  const stored = current();
  const map = {};
  for (const [engine, r] of Object.entries(stored)) map[engine] = { observedAt: r.observedAt, windows: { ...r.windows } };
  const overridden = new Set();
  for (const p of Array.isArray(pauses) ? pauses : []) {
    const kind = PAUSE_KIND[p?.engine];
    if (!kind || !isTime(p.resetsAt) || p.resetsAt <= now) continue;
    const r = map[p.engine] ??= { observedAt: isTime(p.pausedAt) ? p.pausedAt : now, windows: {} };
    const w = r.windows[kind];
    const key = `${p.engine}:${kind}`;
    const live = w && w.resetsAt > now;
    if (live && w.pct === 100 && !(overridden.has(key) && p.resetsAt > w.resetsAt)) continue;
    r.windows[kind] = { pct: 100, resetsAt: p.resetsAt };
    overridden.add(key);
  }
  return answerOf(map, now);
}

/** Registers a listener for a changed reading (called with `usageLimits()`); returns its unsubscribe. */
export function onUsageLimitsChanged(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _resetUsageLimitsForTests() { cache = null; }
