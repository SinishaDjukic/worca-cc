// src/core/in-base.mjs — "Merged · in dev" (honest status, D6): is a run's branch head already in its base branch?
// Local refs only (no fetch, clarify answer): one for-each-ref per call, and one merge-base --is-ancestor per new
// (head sha, base sha) pair, cached for the process. A git error is "unknown" and is not cached.
import { execFile } from 'node:child_process';
import { scopedRefTips, parseRefTips } from './git-info.mjs';

const CACHE_MAX = 2000;
const cache = new Map();   // `${repoDir}\0${headSha}\0${baseSha}` → boolean
const realRun = (args, cwd) => new Promise((resolve) => {
  execFile('git', args, { cwd, timeout: 10_000, windowsHide: true }, (err, stdout) =>
    resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || '') }));
});
let run = realRun;

/** `{ base }` when `feature` has commits of its own (its head is not `startSha`) and its head is an ancestor of the
 *  base branch, local or `remote`-tracking; null otherwise. `source` may be "dev" or "origin/dev". */
export async function workInBase({ repoDir, feature, source, startSha = null, remote = 'origin' } = {}) {
  if (!repoDir || !feature || !source || !startSha) return null;
  const base = String(source).startsWith(`${remote}/`) ? String(source).slice(remote.length + 1) : String(source);
  if (!base || base === feature) return null;
  const refs = [`refs/heads/${feature}`, `refs/heads/${base}`, `refs/remotes/${remote}/${base}`];
  // Inside a history listing (withRefSnapshot): the listing's one read of every tip, not a for-each-ref per row.
  const scoped = scopedRefTips(repoDir);
  let sha;
  if (scoped) {
    sha = await scoped;
    if (!sha) return null;
  } else {
    const r = await run(['for-each-ref', '--format=%(refname) %(objectname)', ...refs], repoDir);
    if (!r.ok) return null;
    sha = parseRefTips(r.stdout);
  }
  const head = sha.get(refs[0]);
  if (!head || head === startSha) return null;                 // nothing of its own: never "Merged"
  for (const ref of refs.slice(1)) {
    const b = sha.get(ref);
    if (!b) continue;
    const key = `${repoDir}\0${head}\0${b}`;
    if (!cache.has(key)) {
      const a = await run(['merge-base', '--is-ancestor', head, b], repoDir);
      if (!a.ok && a.code !== 1) continue;                       // exit 1 = not an ancestor; anything else = unknown
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, a.ok);
    }
    if (cache.get(key)) return { base };
  }
  return null;
}

export const _testing = {
  runner: () => run,
  setRunner(fn) { run = fn; },
  reset() { run = realRun; cache.clear(); },
};
