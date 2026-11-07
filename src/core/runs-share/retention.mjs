// src/core/runs-share/retention.mjs — which records on `worca-runs` are gone (run sharing s3, D2/D3/D7).
// A terminal record expires RETENTION_DAYS after `finishedAt`, any other after `updatedAt`; a timestamp that does not
// parse keeps the record. Only a record that passes slice 1's `sanitizeRecord` and sits at the path its own keys name is
// judged: junk paths, bad JSON, non-blob or non-100644 entries, over-size blobs and future record versions are never
// listed, so an older Worca never deletes what it cannot read. Imports nothing from read.mjs or publish.mjs (no cycle).
import { runGit } from '../metrics/sync.mjs';
import { sanitizeRecord, parseTreeListing, RECORD_MAX_BYTES, RECORD_PATH_RE, TERMINAL_STATUSES } from './record.mjs';

export const RETENTION_DAYS = 14;
export const RETENTION_MS = RETENTION_DAYS * 86_400_000;
/** At most this many uncached blobs are read per scan; the rest are judged on later publishes (D7). */
export const RETENTION_SCAN_MAX = 2000;

const BLOB_CACHE_MAX = 2000;
/** blob sha → { bad: true } | { personKey, runId, at, terminal } (content-addressed: never stale; `now` is compared per call). */
const blobs = new Map();

function rememberBlob(sha, value) {
  blobs.set(sha, value);
  while (blobs.size > BLOB_CACHE_MAX) blobs.delete(blobs.keys().next().value);
}

const judgedAt = (rec) => {
  const terminal = TERMINAL_STATUSES.includes(rec.status);
  return { terminal, at: Date.parse(terminal ? rec.finishedAt : rec.updatedAt) };
};
const isOld = (at, now) => Number.isFinite(at) && at < now - RETENTION_MS;

/** True when the run behind `rec` is gone (D2). @param {number} now ms */
export function recordExpired(rec, now) {
  if (!rec || typeof rec !== 'object') return false;
  return isOld(judgedAt(rec).at, now);
}

/**
 * The paths of valid expired records at `tip`, in `ls-tree` order (D3/D7).
 * @returns {Promise<{ok:true, paths:string[], scanned:number, deferred:number} | {ok:false, stderr:string}>}
 */
export async function expiredPaths(projectDir, tip, { now, git = runGit, scanMax = RETENTION_SCAN_MAX } = {}) {
  const ls = await git(projectDir, ['ls-tree', '-r', '-z', '-l', tip, '--', 'runs/']);
  if (!ls.ok) return { ok: false, stderr: String(ls.stderr || 'ls-tree failed') };
  const paths = [];
  let scanned = 0;
  let deferred = 0;
  for (const e of parseTreeListing(ls.stdout)) {
    const m = RECORD_PATH_RE.exec(e.path);
    if (!m || e.mode !== '100644' || e.type !== 'blob') continue;
    if (!Number.isFinite(e.size) || e.size > RECORD_MAX_BYTES) continue;
    let hit = blobs.get(e.sha);
    if (!hit) {
      if (scanned >= scanMax) { deferred++; continue; }
      scanned++;
      const r = await git(projectDir, ['cat-file', 'blob', e.sha]);
      if (!r.ok) return { ok: false, stderr: String(r.stderr || 'cat-file failed') };
      let obj;
      try { obj = JSON.parse(r.stdout); } catch { obj = undefined; }
      const rec = obj === undefined ? null : sanitizeRecord(obj);
      hit = rec ? { personKey: rec.personKey, runId: rec.runId, ...judgedAt(rec) } : { bad: true };
      rememberBlob(e.sha, hit);
    }
    if (hit.bad || hit.personKey !== m[1] || hit.runId !== m[2]) continue;
    if (isOld(hit.at, now)) paths.push(e.path);
  }
  return { ok: true, paths, scanned, deferred };
}

export const _testing = {
  reset() { blobs.clear(); },
};
