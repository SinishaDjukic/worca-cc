// src/core/runs-share/compact.mjs — the one place Worca rewrites `worca-runs` (run sharing s3, D9–D13).
// Past COMPACT_COMMIT_LIMIT commits the publisher writes ONE parentless commit holding exactly the tip's tree and pushes
// it with `--force-with-lease=refs/heads/worca-runs:<tip>` (an explicit expected sha, never the bare form and never
// `--force`): when a teammate pushed meanwhile, git refuses it, their commit stays and the next publish counts again.
// Built in the project's object store; the developer's HEAD, index and files are never touched.
import { gitAvailable, GIT_MISSING } from '../git-available.mjs';
import { runGit, isNonFastForward, pushHint } from '../metrics/sync.mjs';
import { RUNS_BRANCH, RUNS_REMOTE_REF, RUNS_SHARE_COMPACT_HINT } from './branch.mjs';

export const COMPACT_COMMIT_LIMIT = 200;
/** After a refusal that is not a stale lease (protection blocking force pushes), skip compaction this long (D12). */
export const COMPACT_RETRY_MS = 3_600_000;

/** Commits reachable from `sha`, or null. A shallow clone counts to its shallow boundary only (D9). */
export async function commitCount(projectDir, sha, { git = runGit } = {}) {
  const r = await git(projectDir, ['rev-list', '--count', sha]);
  if (!r.ok) return null;
  const v = Number(String(r.stdout).trim());
  return Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Squash the branch to one root commit when `tip` has more than `limit` commits.
 * @returns {Promise<{ok:true, compacted:false, count:number|null}
 *   | {ok:true, compacted:true, sha:string, from:string, count:number}
 *   | {ok:false, code:'COMPACT_STALE'|'COMPACT_REJECTED'|'COMMIT_FAILED'|'GIT_MISSING', stderr:string, hint:string|null}>}
 */
export async function compactIfNeeded(projectDir, { tip, limit = COMPACT_COMMIT_LIMIT, identity = [], git = runGit, hooks = {} } = {}) {
  if (!gitAvailable()) return { ok: false, code: 'GIT_MISSING', stderr: GIT_MISSING.message, hint: null };
  const count = await commitCount(projectDir, tip, { git });
  if (count === null || count <= limit) return { ok: true, compacted: false, count };
  const tr = await git(projectDir, ['rev-parse', `${tip}^{tree}`]);
  if (!tr.ok) return { ok: false, code: 'COMMIT_FAILED', stderr: String(tr.stderr || ''), hint: null };
  const ct = await git(projectDir, [...identity, 'commit-tree', tr.stdout.trim(), '-m', `${RUNS_BRANCH}: compacted ${count} commits`]);
  if (!ct.ok) return { ok: false, code: 'COMMIT_FAILED', stderr: String(ct.stderr || ''), hint: null };
  const root = ct.stdout.trim();
  await hooks.beforeCompactPush?.();
  const push = await git(projectDir, [
    'push', '--no-verify', `--force-with-lease=refs/heads/${RUNS_BRANCH}:${tip}`, 'origin', `${root}:refs/heads/${RUNS_BRANCH}`,
  ], { timeoutMs: 120_000 });
  if (push.ok) {
    // CAS: move the remote-tracking ref only while it still names the old tip; a failure is repaired by the next fetch.
    await git(projectDir, ['update-ref', RUNS_REMOTE_REF, root, tip]);
    return { ok: true, compacted: true, sha: root, from: tip, count };
  }
  const stderr = String(push.stderr || '');
  if (/\(stale info\)/.test(stderr) || isNonFastForward(stderr)) return { ok: false, code: 'COMPACT_STALE', stderr, hint: null };
  return { ok: false, code: 'COMPACT_REJECTED', stderr, hint: pushHint(stderr, RUNS_SHARE_COMPACT_HINT) };
}
