// src/core/engines/try-log-redaction.mjs — workflow tests 3b, Task 5 (M13, and the fix review's I-1).
// A try's connector-calls.ndjson is written raw by the stand-in connectors and the try guard (child processes that hold no
// secret list), then shown in "Would have sent", while the same values in the transcript are redacted. So the log is
// rewritten through the spawns' redactors once the LAST spawn writing to it has ended (a fan-out try has several at once:
// rewriting while a sibling still appends could lose its line). The redactors are kept in memory only, never on disk.
// A rename Windows refuses for a moment (antivirus, a reader holding the file: EPERM, EBUSY, EACCES) is tried again with a
// short backoff; when it still fails the raw file stays, one warning is logged, and the read path (pendingTryLogRedactor,
// connectors.mjs readConnectorCalls) applies the redactors still held for that file.
import { lstatSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

/** The waits (ms) between rename attempts after a refused one: about one second in all, as graceful-fs does. */
export const RENAME_RETRY_DELAYS_MS = Object.freeze([10, 20, 40, 60, 80, 100, 150, 200, 200, 200]);
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const _ov = { rename: null, sleep: null, warn: null };
/** Test seam: stub the rename, the wait between attempts and the warning. */
export const _testing = {
  set({ rename = _ov.rename, sleep = _ov.sleep, warn = _ov.warn } = {}) { Object.assign(_ov, { rename, sleep, warn }); },
  reset() { Object.assign(_ov, { rename: null, sleep: null, warn: null }); logs.clear(); },
};
const renameFn = () => _ov.rename ?? renameSync;
const sleepFn = () => _ov.sleep ?? ((ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t && t.unref) t.unref(); }));
const warnFn = () => _ov.warn ?? ((t) => console.warn(t));

/** One redactor that applies every one of `redactors` in turn. */
function combined(redactors) {
  const list = [...redactors];
  return { text: (s) => list.reduce((v, r) => r.text(v), s), deep: (v) => list.reduce((x, r) => r.deep(x), v) };
}

/**
 * One rewrite of `file` through `redactor`: every whole line (as JSON, keys included; a line that is not JSON as text), a
 * torn last line kept as it is. Only when something changes, through a new temp file and a rename (never through a link,
 * never into a hardlink's other name); a log that grew while it was read is read again (three tries). Never throws.
 * @returns {'rewritten'|'unchanged'|{retry: string}|'failed'} `retry`: the rename was refused with a code worth retrying
 */
export function redactTryLogOnce(file, redactor) {
  if (typeof file !== 'string' || !file || !redactor) return 'unchanged';
  for (let attempt = 0; attempt < 3; attempt++) {
    let tmp = null;
    try {
      const st = lstatSync(file);
      if (!st.isFile()) return 'unchanged';   // a symlink (or anything but a plain file): never followed
      const text = readFileSync(file, 'utf8');
      const parts = text.split('\n');
      const torn = parts.pop();          // after the last newline: '' or a line still being written
      const lines = parts.map((l) => {
        if (!l.trim()) return l;
        try { return JSON.stringify(redactor.deep(JSON.parse(l))); } catch { return redactor.text(l); }
      });
      const next = [...lines, torn].join('\n');
      if (next === text) return 'unchanged';
      const now = lstatSync(file);
      if (now.size !== st.size || now.mtimeMs !== st.mtimeMs) continue;   // it grew: read it again
      tmp = `${file}.worca-${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, next, { encoding: 'utf8', flag: 'wx' });
      try { renameFn()(tmp, file); } catch (e) {
        try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
        return e && RETRYABLE.has(e.code) ? { retry: e.code } : 'failed';
      }
      return 'rewritten';
    } catch (e) {
      if (tmp) { try { rmSync(tmp, { force: true }); } catch { /* best effort */ } }
      return e && e.code === 'ENOENT' ? 'unchanged' : 'failed';
    }
  }
  return 'failed';   // it kept growing
}

/** M13's first form, kept for its callers: one rewrite, true when the log was rewritten. Never throws. */
export function redactTryLog(file, redactor) {
  return redactTryLogOnce(file, redactor) === 'rewritten';
}

/** One rewrite, then on a refused rename the retries (RENAME_RETRY_DELAYS_MS). Never rejects.
 *  @returns {Promise<'rewritten'|'unchanged'|'failed'>} */
export async function redactTryLogRetrying(file, redactor) {
  let r = redactTryLogOnce(file, redactor);
  for (const ms of RENAME_RETRY_DELAYS_MS) {
    if (!r || typeof r !== 'object') break;
    await sleepFn()(ms);
    r = redactTryLogOnce(file, redactor);
  }
  return r && typeof r === 'object' ? 'failed' : r;
}

// ── The spawns writing to each log, and their redactors (in memory only) ────────────────────────────────────────────────
/** key → { file, active, redactors: Set, running: Promise|null, again: boolean, warned: boolean } */
const logs = new Map();
const keyOf = (file) => { const p = resolve(file); return process.platform === 'win32' ? p.toLowerCase() : p; };

async function settle(key) {
  const e = logs.get(key);
  if (!e || e.active > 0) return;
  if (e.running) { e.again = true; return; }
  let out;
  do {
    e.again = false;
    e.running = redactTryLogRetrying(e.file, combined(e.redactors));   // its first try runs now, synchronously
    out = await e.running;
    e.running = null;
  } while (e.again && e.active === 0 && out !== 'failed');
  if (e.active > 0) return;                     // a new spawn joined: its end settles the log again
  if (out === 'failed') {
    if (!e.warned) {
      e.warned = true;
      warnFn()(`[worca] Worca could not redact the try log ${e.file}; what it shows of it is redacted from memory until Worca restarts`);
    }
    return;                                     // the redactors stay held for the read path
  }
  logs.delete(key);
}

/**
 * A spawn starts writing to the try log `file` with `redactor`: counted, its redactor held. Returns the release to call
 * once (more calls do nothing) when the spawn has ended; the release of the last active spawn rewrites the log through
 * every redactor held (synchronously on a first try that works, the retries later). Never throws.
 * @returns {() => void}
 */
export function openTryLog(file, redactor) {
  if (typeof file !== 'string' || !file || !redactor) return () => {};
  const key = keyOf(file);
  const e = logs.get(key) || { file, active: 0, redactors: new Set(), running: null, again: false, warned: false };
  e.active++;
  e.redactors.add(redactor);
  logs.set(key, e);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    e.active = Math.max(0, e.active - 1);
    if (e.active === 0) settle(key).catch(() => {});
  };
}

/** The redactor still held for `file` (a spawn writing to it, a rewrite in flight, or one that failed), or null. */
export function pendingTryLogRedactor(file) {
  if (typeof file !== 'string' || !file) return null;
  const e = logs.get(keyOf(file));
  return e && e.redactors.size ? combined(e.redactors) : null;
}
