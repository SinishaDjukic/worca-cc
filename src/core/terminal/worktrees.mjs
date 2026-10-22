// src/core/terminal/worktrees.mjs — worca-owned worktrees for a project branch (issue #573, D6), opened
// through the API only (the pane's project terminal uses the project's own folder, which is never one of
// these), under <home>/terminal/worktrees/<projectKey>/. They follow the
// Actions keep policy: `never` removes a CLEAN one when its last terminal ends (and at boot); on-success
// and until-pr keep it until someone removes it; maxCheckouts caps how many stay. Nothing here ever
// deletes a branch, and a dirty worktree goes only on an explicit force.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { createDetachedWorktree, removeWorktree, worktreePathForBranch, listLocalBranches } from '../worktree.mjs';
import { isSafeBranchName } from '../git-sync.mjs';
import { branchWorktreeRoot } from './paths.mjs';
import * as store from './store.mjs';
import { gitAvailable, gitMissingError, GIT_MISSING } from '../git-available.mjs';

const codeError = (code, message) => Object.assign(new Error(message), { code });
// `busyDirs` may be a Set or a getter (() => Set): a getter is read again right before git removes the
// folder, since a terminal may have opened there while the checks before it ran.
const busyOf = (busyDirs) => (typeof busyDirs === 'function' ? busyDirs : () => busyDirs || new Set());
// dir → its removal in flight. Opening the same folder waits for it: the folder is either gone (and is
// made again) or stays, never removed under a shell that just started in it.
const removing = new Map();

export function branchCheckoutName(branch) {
  const slug = String(branch).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'branch';
  return `${slug}-${createHash('sha1').update(String(branch)).digest('hex').slice(0, 6)}`;
}

const execFileP = promisify(execFile); const run = (cmd, args, o) => (cmd === 'git' && !gitAvailable() ? Promise.reject(gitMissingError()) : execFileP(cmd, args, o));
const detachedWarning = (branch, holder) => `Branch "${branch}" is checked out ${holder ? `in ${holder}` : 'elsewhere'}, so this folder is a detached copy of its latest commit. Commits made here are not on the branch.`;

/**
 * Attach the existing branch as-is: `git worktree add -- <dir> <branch>`. createWorktree is not used
 * because it sanitizes the name first (lower-case, dots to `-`), which misses `Feature/ABC-1.2`.
 */
async function attachWorktree(projectDir, dir, branch) {
  await run('git', ['-C', projectDir, 'worktree', 'prune']).catch(() => {});
  await run('git', ['-C', projectDir, 'worktree', 'add', '--', dir, branch]);
}

export async function openBranchWorktree({ projectKey, projectDir, branch, by = 'local', now = Date.now() }) {
  if (!gitAvailable()) throw codeError('GIT_MISSING', GIT_MISSING.message);
  if (!/^[A-Za-z0-9._-]+$/.test(String(projectKey || ''))) throw codeError('BAD_PROJECT', 'Unknown project.');
  if (!isSafeBranchName(branch)) throw codeError('BAD_BRANCH', 'That is not a branch name worca can open.');
  let known = store.findBranchWorktree(projectKey, branch);
  while (known && removing.has(known.dir)) {
    await removing.get(known.dir);
    known = store.findBranchWorktree(projectKey, branch);
  }
  if (known && existsSync(known.dir)) {
    store.touchBranchWorktree(known.dir, now);
    return { ...known, reused: true, warning: known.detached ? detachedWarning(branch, null) : null };
  }
  if (known) store.deleteBranchWorktree(known.dir);                      // its folder went away
  if (!(await listLocalBranches(projectDir)).includes(branch)) throw codeError('NO_BRANCH', `Branch "${branch}" does not exist in this project.`);
  const baseDir = join(branchWorktreeRoot(worcaHome()), projectKey);
  await mkdir(baseDir, { recursive: true });
  const dir = join(await realpath(baseDir), branchCheckoutName(branch));   // macOS: /var → /private/var, as git reports it
  const holder = await worktreePathForBranch(projectDir, branch);
  const detached = !!holder;
  try {
    if (holder) await createDetachedWorktree({ projectDir, worktreeDir: dir, ref: branch });
    else await attachWorktree(projectDir, dir, branch);
  } catch (e) {
    throw codeError('WORKTREE_FAILED', `Worca could not create a folder for "${branch}": ${String(e?.stderr || e?.message || e).trim().slice(0, 300)}`);
  }
  store.insertBranchWorktree({ dir, projectKey, branch, detached, by, now });
  return { dir, projectKey, branch, detached, reused: false, warning: detached ? detachedWarning(branch, holder) : null };
}

/**
 * A detached copy's HEAD can hold commits no branch, remote or tag reaches (its reflog is the only
 * thing keeping them alive). `git worktree remove` without `--force` only catches modified/untracked
 * files, not this, so check it ourselves. Fails closed: a git error is treated as "has commits to lose".
 */
async function hasUnreachedCommits(dir) {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-list', '-1', 'HEAD', '--not', '--branches', '--remotes', '--tags']);
    return stdout.trim().length > 0;
  } catch { return true; }
}

/**
 * Remove worca's folder (never the branch). Without `force`, git refuses a dirty one and it stays.
 * `isBusy` is asked once more just before git runs: a terminal that opened there meanwhile keeps it.
 */
export function removeBranchWorktree(dir, opts) {
  const run = (removing.get(dir) || Promise.resolve()).then(() => removeNow(dir, opts));
  const done = run.then(() => {}, () => {}).finally(() => { if (removing.get(dir) === done) removing.delete(dir); });
  removing.set(dir, done);
  return run;
}

async function removeNow(dir, { force = false, projectDirOf, isBusy = () => false }) {
  const row = store.getBranchWorktree(dir);
  if (!row) return { removed: false, reason: 'unknown' };
  if (!existsSync(dir)) { store.deleteBranchWorktree(dir); return { removed: true }; }
  if (row.detached && !force && (await hasUnreachedCommits(dir))) return { removed: false, reason: 'unpushed-commits' };
  const projectDir = await projectDirOf(row.projectKey);
  if (!projectDir) return { removed: false, reason: 'no-project' };
  if (resolve(dir) === resolve(projectDir)) return { removed: false, reason: 'project-dir' };   // the person's own checkout: never
  if (isBusy()) return { removed: false, reason: 'in-use' };
  const r = await removeWorktree({ projectDir, worktreeDir: dir, force });   // no `branch:` — the branch is the person's
  if (existsSync(dir)) return { removed: false, reason: r.ok ? 'busy' : 'dirty' };
  store.deleteBranchWorktree(dir);
  return { removed: true };
}

/** A branch terminal ended: under keep `never`, remove its folder once no live terminal uses it. */
export async function releaseBranchWorktree(dir, { keep, busyDirs = new Set(), projectDirOf }) {
  const isBusy = () => busyOf(busyDirs)().has(dir);
  if (keep !== 'never' || isBusy() || !store.getBranchWorktree(dir)) return { removed: false };
  return removeBranchWorktree(dir, { projectDirOf, isBusy });
}

export async function enforceBranchWorktreeCap({ max, busyDirs = new Set(), projectDirOf }) {
  if (!max) return { evicted: [] };
  const all = store.listBranchWorktrees();
  let over = all.length - max;
  const evicted = [];
  for (const w of all) {
    if (over <= 0) break;
    const isBusy = () => busyOf(busyDirs)().has(w.dir);
    if (isBusy()) continue;
    if ((await removeBranchWorktree(w.dir, { projectDirOf, isBusy })).removed) { evicted.push(w.dir); over--; }
  }
  return { evicted };
}

/** Boot: forget vanished folders; under `never` remove the clean ones; then apply the cap. */
export async function sweepBranchWorktrees({ keep, maxCheckouts, busyDirs = new Set(), projectDirOf }) {
  let removed = 0;
  for (const w of store.listBranchWorktrees()) {
    if (!existsSync(w.dir)) { store.deleteBranchWorktree(w.dir); removed++; continue; }
    const isBusy = () => busyOf(busyDirs)().has(w.dir);
    if (keep === 'never' && !isBusy() && (await removeBranchWorktree(w.dir, { projectDirOf, isBusy })).removed) removed++;
  }
  const { evicted } = await enforceBranchWorktreeCap({ max: maxCheckouts, busyDirs, projectDirOf });
  return { removed, evicted: evicted.length };
}
