// src/core/runs-share/branch.mjs — plumbing on the `worca-runs` ref only (run sharing s1, D5/D7).
// Commits are built in the project's object store with a temp index (the orphanCommit recipe of metrics/sync.mjs):
// no worktree, no checkout, no reset; the developer's HEAD, index and files are never touched. Every push is a
// fast-forward; a non-fast-forward rejection is rebuilt on the fetched tip and retried. Every git call goes through
// the injected runner (default runGit: guarded env, hook-free args, worca's own network credential).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { gitAvailable, GIT_MISSING } from '../git-available.mjs';
import {
  runGit, fetchTeamBranch, isNonFastForward, pushHint, backoffMs, MISSING_REMOTE_REF, MAX_PUSH_ATTEMPTS,
} from '../metrics/sync.mjs';
import { RECORD_PATH_RE } from './record.mjs';

export const RUNS_BRANCH = 'worca-runs';
export const RUNS_REMOTE_REF = `refs/remotes/origin/${RUNS_BRANCH}`;
export const RUNS_SHARE_PROTECTION_HINT = `exempt \`${RUNS_BRANCH}\` from branch protection in the repository rules — Worca pushes to it directly, without a pull request`;
/** A refused compaction push (run sharing s3, D12): the branch needs force pushes allowed as well. */
export const RUNS_SHARE_COMPACT_HINT = `allow \`${RUNS_BRANCH}\` to be force-pushed by Worca (exempt it from branch protection): it squashes the branch to one commit`;
export const README_TEXT = `# worca-runs

This branch is written by Worca, not by people. Each teammate who switched on "Share my runs" keeps one small JSON
record per run under \`runs/<personKey>/<runId>.json\`: status, phase, cost, the PR link and who started it. It never
holds a prompt, a title, a file path or a log. See docs/run-sharing.md in Worca.
`;

const firstLine = (s) => String(s || '').trim().split('\n')[0] || '';
const tmpRoot = () => join(worcaHome(), 'runs-share', 'tmp');

/**
 * Build one commit on `parent` (or a root commit holding README.md) with `files` ({ relPath: text }) written over it
 * and the record paths in `remove` deleted (s3 retention, D1/D5). Only a path matching RECORD_PATH_RE that `files`
 * does not write is removed (re-checked here, never trusted from the caller); a root commit ignores `remove`.
 * @returns {Promise<{ok:true, sha:string, tree:string, unchanged:boolean, removed:number} | {ok:false, code:'COMMIT_FAILED', stderr:string}>}
 */
export async function buildCommit(projectDir, { parent = null, files, remove = [], message, identity = [], git = runGit }) {
  const gd = await git(projectDir, ['rev-parse', '--absolute-git-dir']);
  if (!gd.ok) return { ok: false, code: 'COMMIT_FAILED', stderr: gd.stderr };
  await mkdir(tmpRoot(), { recursive: true });
  const stage = await mkdtemp(join(tmpRoot(), 'commit-'));
  const env = { GIT_DIR: gd.stdout.trim(), GIT_INDEX_FILE: join(stage, 'index') };
  const must = async (args) => {
    const r = await git(stage, args, { env });
    if (!r.ok) throw Object.assign(new Error(firstLine(r.stderr)), { stderr: r.stderr });
    return r.stdout.trim();
  };
  try {
    await must(parent ? ['read-tree', parent] : ['read-tree', '--empty']);
    const all = parent ? { ...files } : { 'README.md': README_TEXT, ...files };
    let i = 0;
    for (const [rel, text] of Object.entries(all)) {
      const src = join(stage, `blob-${i++}`);
      await writeFile(src, text, 'utf8');
      const blob = await must(['hash-object', '-w', '--no-filters', src]);
      await must(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
    }
    let removed = 0;
    const drop = parent ? [...new Set(Array.isArray(remove) ? remove : [])]
      .filter((rel) => typeof rel === 'string' && RECORD_PATH_RE.test(rel) && !Object.hasOwn(all, rel)) : [];
    if (drop.length) {
      const present = new Set((await must(['ls-files', '-z', '--', 'runs/'])).split('\0'));
      for (const rel of drop) {
        if (!present.has(rel)) continue;
        await must(['update-index', '--force-remove', '--', rel]);
        removed++;
      }
    }
    const tree = await must(['write-tree']);
    if (parent && tree === await must(['rev-parse', `${parent}^{tree}`])) return { ok: true, sha: parent, tree, unchanged: true, removed: 0 };
    const sha = await must([...identity, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', typeof message === 'function' ? message(removed) : message]);
    return { ok: true, sha, tree, unchanged: false, removed };
  } catch (err) {
    return { ok: false, code: 'COMMIT_FAILED', stderr: String(err?.stderr || err?.message || err) };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function localTip(projectDir, git) {
  const r = await git(projectDir, ['rev-parse', '--verify', '--quiet', RUNS_REMOTE_REF]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * Commit `files` on top of the known `worca-runs` tip and push it as a fast-forward (D7). `prune(parent)` (s3, D1/D4/D5)
 * is asked again for every attempt's parent; its `{ok:true, paths}` are removed in the same commit, and a failed or
 * throwing prune builds the commit without removals (no log here: the caller's closure logs). `message` may be a
 * function of the number of removed paths.
 * @returns {Promise<{ok:true, pushed:boolean, sha:string|null, attempts:number, removed:number}
 *   | {ok:false, code:'COMMIT_FAILED'|'FETCH_FAILED'|'PUSH_REJECTED'|'PUSH_RETRIES_EXHAUSTED'|'GIT_MISSING', stderr:string, hint:string|null, attempts:number}>}
 */
export async function publishFiles(projectDir, {
  files, message, identity = [], git = runGit, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random, hooks = {},
  prune = null,
}) {
  if (!gitAvailable()) return { ok: false, code: 'GIT_MISSING', stderr: GIT_MISSING.message, hint: null, attempts: 0 };
  let parent = await localTip(projectDir, git);
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    let remove = [];
    if (parent && typeof prune === 'function') {
      try {
        const p = await prune(parent);
        remove = p?.ok && Array.isArray(p.paths) ? p.paths : [];
      } catch { remove = []; }
    }
    const built = await buildCommit(projectDir, { parent, files, remove, message, identity, git });
    if (!built.ok) return { ok: false, code: built.code, stderr: built.stderr, hint: null, attempts: attempt };
    if (built.unchanged) return { ok: true, pushed: false, sha: parent, attempts: attempt, removed: 0 };
    await hooks.beforePush?.(attempt);
    const push = await git(projectDir, ['push', '--no-verify', 'origin', `${built.sha}:refs/heads/${RUNS_BRANCH}`], { timeoutMs: 120_000 });
    if (push.ok) {
      // CAS on the remote-tracking ref: old value = the parent this push was built on; a failure is harmless.
      await git(projectDir, ['update-ref', RUNS_REMOTE_REF, built.sha, parent || '']);
      return { ok: true, pushed: true, sha: built.sha, attempts: attempt, removed: built.removed };
    }
    if (push.stderr === GIT_MISSING.message) return { ok: false, code: 'GIT_MISSING', stderr: push.stderr, hint: null, attempts: attempt };
    if (!isNonFastForward(push.stderr)) {
      return { ok: false, code: 'PUSH_REJECTED', stderr: push.stderr, hint: pushHint(push.stderr, RUNS_SHARE_PROTECTION_HINT), attempts: attempt };
    }
    if (attempt === MAX_PUSH_ATTEMPTS) return { ok: false, code: 'PUSH_RETRIES_EXHAUSTED', stderr: push.stderr, hint: null, attempts: attempt };
    const f = await fetchTeamBranch(projectDir, RUNS_BRANCH);
    if (f.ok) parent = await localTip(projectDir, git);
    else if (MISSING_REMOTE_REF.test(f.stderr)) {
      await git(projectDir, ['update-ref', '-d', RUNS_REMOTE_REF]);
      parent = null;
    } else return { ok: false, code: 'FETCH_FAILED', stderr: f.stderr, hint: null, attempts: attempt };
    await sleep(backoffMs(attempt, random));
  }
  return { ok: false, code: 'PUSH_RETRIES_EXHAUSTED', stderr: '', hint: null, attempts: MAX_PUSH_ATTEMPTS };
}
