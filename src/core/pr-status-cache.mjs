// src/core/pr-status-cache.mjs
// The PR status per repo + branch (+ recorded PR URL) that every Worca process on this machine shares
// (F-X-02): <worcaHome>/github/pr-status.json. A merged PR is final; an open PR or none is asked again
// after 10 min; a closed-only PR, or none on a run that ended a month ago, after a day (the policy
// metrics/prs.mjs cacheFresh uses). Reads are lock-free (the file is replaced by an atomic rename);
// writes re-read and merge under a short lock, and the newer answer wins. Worca's own PR writes leave a
// dated "forgotten" mark per PR URL and branch, so a lookup that started before them never stores its stale answer
// (forgetPrStatus, writePrStatus's startedAt). Nothing here throws. Without
// a Worca home or while suspended (a scripted test runner) it keeps nothing: in-process single-flight only.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './json-atomic.mjs';
import { withLock } from './metrics/lock.mjs';
import { worcaHome } from './projects.mjs';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const PR_STATUS_OPEN_TTL_MS = 10 * MIN;
export const PR_STATUS_OLD_TTL_MS = DAY;
const PRUNE_MS = 35 * DAY;
const MAX_ENTRIES = 5_000;
const LOCK_WAIT_MS = 2_000;
const FORGOTTEN_MS = DAY;           // a mark only has to outlive the slowest lookup in flight

let _dir = null;
let _suspended = false;
let _memo = null;                   // { path, ino, mtimeMs, size, file }: a rename changes the inode
const _flights = new Map();

/** <worcaHome>/github/pr-status.json, or the test override's pr-status.json. Throws only when there is no home. */
export function prStatusPath() {
  return join(_dir || join(worcaHome(), 'github'), 'pr-status.json');
}

function activePath() {
  if (_suspended) return null;
  try { return prStatusPath(); } catch { return null; }
}

const isMap = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/** `{ entries, forgotten }` of the file's text; `forgotten` maps `url:{url}` / `head:{head}` to the ms Worca wrote. */
function parseFile(text) {
  try {
    const v = JSON.parse(text);
    if (!(v && v.v === 1 && isMap(v.entries))) return { entries: {}, forgotten: {} };
    return { entries: v.entries, forgotten: isMap(v.forgotten) ? v.forgotten : {} };
  } catch { return { entries: {}, forgotten: {} }; }
}

function readFile(path) {
  try { return parseFile(readFileSync(path, 'utf8')); } catch { return { entries: {}, forgotten: {} }; }
}

/** Write the file, dropping marks older than a day. */
function saveFile(path, entries, forgotten) {
  const cutoff = Date.now() - FORGOTTEN_MS;
  const marks = Object.entries(forgotten).filter(([, at]) => Number.isFinite(at) && at >= cutoff);
  writeJsonAtomic(path, { v: 1, entries, ...(marks.length ? { forgotten: Object.fromEntries(marks) } : {}) });
}

/** The file's entries, re-parsed only when the file was replaced or changed. */
function loadEntries(path) {
  let st;
  try { st = statSync(path); } catch { return {}; }
  if (_memo && _memo.path === path && _memo.ino === st.ino && _memo.mtimeMs === st.mtimeMs && _memo.size === st.size) return _memo.entries;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return {}; }
  const { entries } = parseFile(text);
  _memo = { path, ino: st.ino, mtimeMs: st.mtimeMs, size: st.size, entries };
  return entries;
}

const headOf = (key) => key.slice(key.indexOf('#') + 1, key.lastIndexOf('#'));
const urlOf = (key) => key.slice(key.lastIndexOf('#') + 1);

/** Did Worca write this PR or branch at or after `startedAt`, so `entry` (asked before) may be stale? */
function forgottenSince(forgotten, key, entry, startedAt) {
  const after = (mark) => Number.isFinite(forgotten[mark]) && startedAt <= forgotten[mark];
  return [entry.live?.url, entry.closed?.url, urlOf(key)].some((u) => u && after(`url:${u}`))
    || (!entry.live && after(`head:${headOf(key)}`));
}

/** `{repo}#{head}#{prUrl or ''}` with a lower-cased repo slug; null when the repo or the head is missing. */
export function prStatusKey({ repo, head, prUrl = null } = {}) {
  if (!repo || !head) return null;
  return `${String(repo).toLowerCase()}#${head}#${prUrl || ''}`;
}

/** The stored entry for `key`, or null. */
export function readPrStatus(key) {
  const path = key ? activePath() : null;
  if (!path) return null;
  const e = loadEntries(path)[key];
  return e && typeof e === 'object' && Number.isFinite(e.checkedAt) ? e : null;
}

/**
 * Store `entry` under `key`: under the lock, re-read what other processes wrote, keep the newer answer
 * (checkedAt), prune entries older than 35 days, cap at 5 000 (the oldest go first). `startedAt` (ms, Date.now())
 * is when the lookup behind `entry` began: when Worca wrote its PR (or created a PR on its branch, for a "no live
 * PR" entry) at or after that, the answer may predate the write and is not stored. A lock that stays busy
 * past 2 s, or any I/O error, skips the write.
 */
export async function writePrStatus(key, entry, { startedAt = null } = {}) {
  const path = key ? activePath() : null;
  if (!path || !entry || !Number.isFinite(entry.checkedAt)) return;
  try {
    await withLock(`${path}.lock`, async () => {
      const file = readFile(path);
      if (Number.isFinite(startedAt) && forgottenSince(file.forgotten, key, entry, startedAt)) return;
      const entries = { ...file.entries };
      const prev = entries[key];
      if (!prev || !Number.isFinite(prev.checkedAt) || entry.checkedAt >= prev.checkedAt) entries[key] = entry;
      const cutoff = Date.now() - PRUNE_MS;
      let kept = Object.entries(entries).filter(([, e]) => e && Number.isFinite(e.checkedAt) && e.checkedAt >= cutoff);
      if (kept.length > MAX_ENTRIES) kept = kept.sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, MAX_ENTRIES);
      saveFile(path, Object.fromEntries(kept), file.forgotten);
    }, { timeoutMs: LOCK_WAIT_MS });
  } catch { /* a busy lock or a failed write only costs one more lookup later */ }
}

/**
 * Drop what Worca's own write just made wrong (C1): every entry about the PR at `url` (merged, closed or marked
 * ready by Worca), and every "no live PR" entry for branch `head` (a PR Worca just created), and mark the URL or
 * branch as forgotten now, so a lookup already in flight does not store its older answer. The next lookup asks
 * GitHub again. Same lock and skip-on-failure as writePrStatus.
 */
export async function forgetPrStatus({ url = null, head = null } = {}) {
  const path = (url || head) ? activePath() : null;
  if (!path) return;
  const stale = (key, e) => (url && (e?.live?.url === url || e?.closed?.url === url || urlOf(key) === url))
    || (head && !e?.live && headOf(key) === head);
  try {
    await withLock(`${path}.lock`, async () => {
      const { entries, forgotten } = readFile(path);
      const at = Date.now();
      const marks = { ...forgotten, ...(url ? { [`url:${url}`]: at } : {}), ...(head ? { [`head:${head}`]: at } : {}) };
      saveFile(path, Object.fromEntries(Object.entries(entries).filter(([k, e]) => !stale(k, e))), marks);
    }, { timeoutMs: LOCK_WAIT_MS });
  } catch { /* the entry then ages out on its own TTL */ }
}

/** Is a stored answer still good? Merged is final; an open PR or none: 10 min; closed-only, or none on a run that ended over a month ago: a day. */
export function entryFresh(entry, { now = Date.now(), runEndedAt = null } = {}) {
  if (!entry || !Number.isFinite(entry.checkedAt)) return false;
  if (entry.live?.state === 'MERGED') return true;
  const old = runEndedAt != null && now - runEndedAt > 30 * DAY;
  const ttl = (!entry.live && entry.closed) || (!entry.live && !entry.closed && old) ? PR_STATUS_OLD_TTL_MS : PR_STATUS_OPEN_TTL_MS;
  return now - entry.checkedAt < ttl;
}

/** One lookup per key at a time in this process: a second caller awaits the first call's promise. */
export function singleFlight(key, fn) {
  if (key == null) return fn();
  const running = _flights.get(key);
  if (running) return running;
  const p = Promise.resolve().then(fn).finally(() => { if (_flights.get(key) === p) _flights.delete(key); });
  _flights.set(key, p);
  return p;
}

/** A caller's PR from an entry, in findPrForBranch's shape (an OPEN PR carries `verdict` when asked, null when unread). */
export function derivePr(entry, { includeClosed = false, withVerdict = false } = {}) {
  if (!entry) return null;
  const { live } = entry;
  if (live) return { ...live, ...(withVerdict && live.state === 'OPEN' ? { verdict: entry.verdict ?? null } : {}) };
  return includeClosed ? (entry.closed || null) : null;
}

export const _testing = {
  useDir(dir) { _dir = dir || null; _memo = null; if (dir) _suspended = false; },
  suspend() { _suspended = true; },
  resume() { _suspended = false; },
  reset() { _dir = null; _suspended = false; _memo = null; _flights.clear(); },
};
