// src/core/workflow-tests/project-copy.mjs
// Worca's own copy of a project (plans/workflow-tests-part3a-plan.md D42, D53, D54, D60, D61). One clone per project key at
// <worcaHome>/workflow-tests/repos/<key>, with no remote. Examples pin a start commit in it; every try is a worktree of it.
// The person's repository is only ever read: clone and fetch use it as their source, everything else is rev-parse,
// rev-list, ls-tree, cat-file, show, grep <tree>, for-each-ref, symbolic-ref and remote get-url, and uncommitted changes
// are read with uncommittedPatch's scratch objects.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { testCopiesRoot, testCopyDirFor, testCopyKeyOf, PROJECT_KEY_RE } from '../store.mjs';
import { uncommittedPatch } from '../git-info.mjs';
import { isSafeBranchName } from '../git-sync.mjs';
import { rmGuarded } from '../run-manifest.mjs';
import { testError, PIN_MAX_CHANGES } from './store.mjs';
import { lfsText, submodulesText, START_GONE_TEXT, CHANGES_TOO_BIG_TEXT } from '../../shared/workflow-tests/project-text.mjs';
import { tryGitEnv, withSafeGitArgs } from './try-guard-env.mjs';

const GIT_TIMEOUT_MS = 10 * 60_000;
const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0].slice(0, 300) || 'git failed';
/** Worca's commits in its copy (D53): one identity and the start commit's own date, so a start commit is the same every time. */
const WORCA_ID = Object.freeze({ GIT_AUTHOR_NAME: 'Worca', GIT_AUTHOR_EMAIL: 'worca@localhost', GIT_COMMITTER_NAME: 'Worca', GIT_COMMITTER_EMAIL: 'worca@localhost' });
const GIT_DIR_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
const RM = Object.freeze({ recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);

function git(cwd, args, { env = null } = {}) {
  const e = { ...(env || process.env) };
  if (!env) for (const k of GIT_DIR_ENV) delete e[k];
  return new Promise((done) => {
    execFile('git', args, { cwd, env: e, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      done({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * git in Worca's copy (or a folder being made into one). GIT_CEILING_DIRECTORIES stops git's walk up at testCopiesRoot():
 * a copy whose .git is missing or broken must fail, never act on an enclosing repository (a worcaHome inside a repo).
 */
function copyGit(dir, args, { env = null } = {}) {
  const e = { ...(env || process.env) };
  if (!env) for (const k of GIT_DIR_ENV) delete e[k];
  e.GIT_CEILING_DIRECTORIES = resolve(testCopiesRoot());
  // Final review I2: the copy's config is written by tries (a setup, an agent), so Worca's own git here runs none of its
  // hooks or fsmonitor and carries the try guard's env (no token, no sign-in).
  return git(dir, withSafeGitArgs(args), { env: tryGitEnv({ env: e }) });
}

const samePath = (a, b) => {
  const fold = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  if (fold(a) === fold(b)) return true;
  try { return fold(realpathSync(a)) === fold(realpathSync(b)); } catch { return false; }   // macOS /var ↔ /private/var
};

/** `dir` is a repository of its own: its git dir is exactly `<dir>/.git` (not an enclosing repo's, not a gitfile's target). */
async function ownRepo(dir) {
  if (!existsSync(join(dir, '.git'))) return false;
  const r = await copyGit(dir, ['rev-parse', '--absolute-git-dir']);
  return r.ok && !!r.stdout.trim() && samePath(r.stdout.trim(), join(dir, '.git'));
}

/** What every copy has set (D54): long paths on Windows, and no automatic gc or maintenance under a running try. */
const COPY_SETTINGS = Object.freeze([['config', 'core.longpaths', 'true'], ['config', 'gc.auto', '0'], ['config', 'maintenance.auto', 'false']]);
/** Final review I2: settings a try can leave in the copy's shared config that make git run a program (or move the config
 *  per checkout); every repair unsets them, so the next test starts from a copy that runs nothing of a past try's. */
const UNSAFE_COPY_KEYS = Object.freeze(['core.hooksPath', 'core.fsmonitor', 'extensions.worktreeConfig']);

const notACopy = (dir) => `${dir} is not a usable copy of the project (no git repository of its own): skipped`;

const LOCKS = new Map();
/**
 * One job at a time writes a copy (a clone, a fetch, a start commit): three tries start at once (D36).
 * Not re-entrant: never call withKeyLock, ensureTestCopy or removeTryCheckout for the same key from inside `fn`, or both wait
 * for each other forever.
 */
export function withKeyLock(key, fn) {
  const prev = LOCKS.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  LOCKS.set(key, tail);
  tail.then(() => { if (LOCKS.get(key) === tail) LOCKS.delete(key); });
  return next;
}

/** Rename, riding out a Windows lock on a folder git just let go of. */
async function renameRetry(from, to, attempts = 10) {
  for (let i = 1; ; i += 1) {
    try { await rename(from, to); return; }
    catch (e) {
      if (i >= attempts || !RETRY_CODES.has(e && e.code)) throw e;
      await new Promise((r) => setTimeout(r, 100 * i));
    }
  }
}

/**
 * The copy of `key`; call it inside the key's lock. A copy that is a repository of its own is kept: if it has a remote
 * (an agent in a try's checkout can add one, since worktrees share the copy's config), it is repaired in place: every
 * remote removed and COPY_SETTINGS set again. Deleting it would take the live tries' worktrees, branches and pins with it.
 * Only a folder that is not a repository of its own (missing; a .git that is empty, a gitfile, or resolves to an
 * enclosing repository) is removed and made again from `projectDir` (D54). The clone is made and set up in a temporary
 * sibling folder and renamed into place only when every step worked, so a copy is never left half set up (with `origin`
 * still pointing at the person's repository).
 */
async function ensureTestCopyLocked(key, { projectDir }) {
  const dir = testCopyDirFor(key);
  const setUp = async (at, steps) => {
    for (const args of steps) {
      const r = await copyGit(at, args);
      if (!r.ok) throw testError(`Worca could not set up its copy of the project: ${firstLine(r.stderr)}`, 'NOT_READY');
    }
  };
  if (await ownRepo(dir)) {
    const rem = await copyGit(dir, ['remote']);
    if (!rem.ok) throw testError(`Worca could not read its copy of the project: ${firstLine(rem.stderr)}`, 'NOT_READY');
    const remotes = rem.stdout.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
    // Always (final review I2), not only when a remote was found: every remote removed, the unsafe settings unset and
    // COPY_SETTINGS set again.
    await setUp(dir, [...remotes.map((n) => ['remote', 'remove', '--', n]), ...COPY_SETTINGS]);
    for (const k of UNSAFE_COPY_KEYS) {
      const u = await copyGit(dir, ['config', '--unset-all', k]);
      if (!u.ok && u.code !== 5) throw testError(`Worca could not set up its copy of the project: ${firstLine(u.stderr)}`, 'NOT_READY');   // 5: not set
    }
    return { dir, created: false };
  }
  try { await rm(dir, RM); }
  catch (e) { throw testError(`Worca could not remove its broken copy of the project: ${e.message}`, 'NOT_READY'); }
  await mkdir(testCopiesRoot(), { recursive: true });
  const tmp = await mkdtemp(join(testCopiesRoot(), `.clone-${key}-`));   // never matches PROJECT_KEY_RE; the boot sweep removes a leftover
  try {
    // --local hardlinks the project's object files on purpose: cheap, and git never rewrites an object file in place.
    const c = await copyGit(testCopiesRoot(), ['clone', '--quiet', '--local', '--no-checkout', '--no-tags', '--', resolve(projectDir), tmp]);
    if (!c.ok) throw testError(`Worca could not copy the project: ${firstLine(c.stderr)}`, 'NOT_READY');
    await setUp(tmp, [['remote', 'remove', 'origin'], ...COPY_SETTINGS]);
    await renameRetry(tmp, dir);
  } catch (e) {
    await rm(tmp, RM).catch(() => {});
    throw e.code === 'NOT_READY' ? e : testError(`Worca could not set up its copy of the project: ${e.message}`, 'NOT_READY');
  }
  return { dir, created: true };
}

/**
 * The copy of `key`, made from `projectDir` when it is not a repository of its own, repaired when it has a remote (D54).
 * Takes the key's lock, and is not re-entrant: never call it from inside withKeyLock for the same key.
 */
export function ensureTestCopy(key, { projectDir }) {
  return withKeyLock(key, () => ensureTestCopyLocked(key, { projectDir }));
}

/**
 * D54: what the copy could not hold. Read only (ls-tree, grep on the tree). A `.gitattributes` at any depth counts; a
 * commented line does not. A git error throws (NOT_READY): it never passes as "supported".
 */
export async function projectUnsupported({ projectDir, sha }) {
  const unreadable = (r) => testError(`Worca could not read the project: ${firstLine(r.stderr)}`, 'NOT_READY');
  const m = await git(projectDir, ['ls-tree', '--name-only', sha, '--', '.gitmodules']);
  if (!m.ok) throw unreadable(m);
  if (m.stdout.trim()) return 'submodules';
  const g = await git(projectDir, ['grep', '-q', '-I', '-E', '-e', '^[^#]*filter=lfs', sha, '--', '.gitattributes', '*/.gitattributes']);
  if (g.code === 0) return 'lfs';
  if (g.code === 1) return null;
  throw unreadable(g);
}

/** The full ref a start branch name reads (final review): a local branch (refs/heads/<name>), else a remote-tracking one
 *  (refs/remotes/<name>: a past run that started from `origin/main` records that name). null when neither exists. Read only:
 *  Worca never fetches; a remote-tracking ref is as fresh as the person's last fetch. */
async function startRefName(projectDir, name) {
  for (const full of [`refs/heads/${name}`, `refs/remotes/${name}`]) {
    if ((await git(projectDir, ['rev-parse', '--verify', '--quiet', `${full}^{commit}`])).ok) return full;
  }
  return null;
}

async function resolveStart(projectDir, { ref, sha }) {
  const current = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  if (sha) {
    const v = await git(projectDir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (!v.ok) throw testError(START_GONE_TEXT, 'NOT_READY');
    return { commit: v.stdout.trim(), startRef: ref ?? null, current };
  }
  const startRef = ref ?? current;
  const full = startRef ? await startRefName(projectDir, startRef) : 'HEAD';
  const v = full ? await git(projectDir, ['rev-parse', '--verify', '--quiet', `${full}^{commit}`]) : { ok: false };
  if (!v.ok) throw testError(startRef ? `the branch ${startRef} is not in the project` : 'the project has no commit yet', 'BAD_REQUEST');
  return { commit: v.stdout.trim(), startRef, current };
}

async function readChanges(projectDir, base) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-wft-changes-'));
  try {
    const r = await uncommittedPatch(projectDir, { base, outFile: join(tmp, 'changes.patch'), scratchObjects: true });
    if (!r.ok) throw testError(`Worca could not read your changes that are not committed: ${r.message}`, 'BAD_REQUEST');
    if (!r.file) return null;
    if (r.bytes > PIN_MAX_CHANGES) throw testError(CHANGES_TOO_BIG_TEXT, 'BAD_REQUEST');
    return await readFile(r.file);
  } finally { await rm(tmp, RM).catch(() => {}); }
}

async function fetchInto(dir, projectDir, sha) {
  if ((await copyGit(dir, ['cat-file', '-e', `${sha}^{commit}`])).ok) return;
  const f = await copyGit(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--', resolve(projectDir), sha]);
  if (!f.ok) throw testError(START_GONE_TEXT, 'NOT_READY');
}

/** D53: start commit = `base` + the patch, in the copy, with a temporary index. Same inputs → same SHA. */
async function commitChanges(dir, base, patch, at) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-wft-start-'));
  try {
    const env = { ...process.env, ...WORCA_ID, GIT_INDEX_FILE: join(tmp, 'index'), GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
    for (const k of GIT_DIR_ENV) if (k !== 'GIT_INDEX_FILE') delete env[k];
    env.GIT_CEILING_DIRECTORIES = resolve(testCopiesRoot());
    const file = join(tmp, 'changes.patch');
    await writeFile(file, patch);
    for (const args of [['read-tree', base], ['apply', '--cached', '--binary', '--whitespace=nowarn', file]]) {
      const r = await copyGit(dir, args, { env });
      if (!r.ok) throw testError(`Worca could not apply your changes that are not committed: ${firstLine(r.stderr)}`, 'BAD_REQUEST');
    }
    const w = await copyGit(dir, ['write-tree'], { env });
    const tree = w.stdout.trim();
    if (!w.ok || !tree) throw testError(`Worca could not make the start point: ${firstLine(w.stderr)}`, 'NOT_READY');
    const c = await copyGit(dir, ['commit-tree', '--no-gpg-sign', tree, '-p', base, '-m', 'Worca test start: changes that were not committed yet'], { env });
    if (!c.ok || !c.stdout.trim()) throw testError(`Worca could not make the start point: ${firstLine(c.stderr)}`, 'NOT_READY');
    return c.stdout.trim();
  } finally { await rm(tmp, RM).catch(() => {}); }
}

/** Keep `sha` in the copy as refs/worca-tests/<sha>, so no gc or branch removal drops it. */
async function pinRef(dir, sha) {
  const r = await copyGit(dir, ['update-ref', `refs/worca-tests/${sha}`, sha]);
  if (!r.ok) throw testError(`Worca could not keep the start point in its copy of the project: ${firstLine(r.stderr)}`, 'NOT_READY');
}

/**
 * Pin a start point (D41, D53): the newest commit of `ref` (default: the branch the folder is on), or exactly `sha` (a past
 * run's start, D65). With `includeChanges`, the person's uncommitted changes go on top as Worca's own start commit.
 */
export async function pinStart({ key, name = key, projectDir, ref = null, sha = null, includeChanges = false } = {}) {
  if (ref != null && !isSafeBranchName(ref)) throw testError('pick a branch of the project', 'BAD_REQUEST');
  const { commit, startRef, current } = await resolveStart(projectDir, { ref, sha });
  const why = await projectUnsupported({ projectDir, sha: commit });
  if (why) throw testError(why === 'lfs' ? lfsText(name) : submodulesText(name), 'NOT_READY');
  const shown = await git(projectDir, ['show', '-s', '--format=%cI', commit]);
  const at = Date.parse(shown.stdout.trim());
  if (!shown.ok || !Number.isFinite(at)) throw testError(`Worca could not read the start point: ${firstLine(shown.stderr)}`, 'NOT_READY');
  const startAt = new Date(at).toISOString();
  let changes = null;
  if (includeChanges) {
    if (sha || !startRef || startRef !== current) throw testError('uncommitted changes can be kept only for the branch your project folder is on', 'BAD_REQUEST');
    changes = await readChanges(projectDir, commit);
  }
  return withKeyLock(key, async () => {
    const { dir } = await ensureTestCopyLocked(key, { projectDir });
    await fetchInto(dir, projectDir, commit);
    const startCommit = changes ? await commitChanges(dir, commit, changes, startAt) : commit;
    await pinRef(dir, commit);   // D53: both are pinned, the start SHA and (with changes) Worca's start commit on top
    if (startCommit !== commit) await pinRef(dir, startCommit);
    return { key, name, startSha: commit, startRef, startAt, startCommit, changes, setupCmd: null };
  });
}

/** Before a try: the example's start commit is in the copy; a copy removed meanwhile is made again (same SHA, D53). */
export async function ensureStartCommit({ key, projectDir, project, changes = null }) {
  return withKeyLock(key, async () => {
    const { dir } = await ensureTestCopyLocked(key, { projectDir });
    if (!(await copyGit(dir, ['cat-file', '-e', `${project.startCommit}^{commit}`])).ok) {
      await fetchInto(dir, projectDir, project.startSha);
      const again = changes ? await commitChanges(dir, project.startSha, changes, project.startAt) : project.startSha;
      if (again !== project.startCommit) throw testError(START_GONE_TEXT, 'NOT_READY');
    }
    if (project.startSha && project.startSha !== project.startCommit) await pinRef(dir, project.startSha);   // D53: both
    await pinRef(dir, project.startCommit);
    return { copyDir: dir, startCommit: project.startCommit };
  });
}

/** D63: how many commits the start branch gained since the start point; null when Worca cannot tell. Read only. */
export async function behindCount({ projectDir, startSha, startRef }) {
  if (!startRef || !projectDir || !existsSync(projectDir) || !isSafeBranchName(startRef)) return null;
  const full = await startRefName(projectDir, startRef);
  if (!full) return null;
  const r = await git(projectDir, ['rev-list', '--count', `${startSha}..${full}`]);
  return r.ok ? Number(r.stdout.trim()) || 0 : null;
}

/** D60: the bytes of every file in the start tree (exact, cheap). Read only. */
export async function treeBytes({ projectDir, sha }) {
  const r = await git(projectDir, ['ls-tree', '-r', '-l', '-z', sha]);
  if (!r.ok) return null;
  let n = 0;
  for (const entry of r.stdout.split('\0')) {
    const m = /^\d+ blob [0-9a-f]+ +(\d+)\t/.exec(entry);
    if (m) n += Number(m[1]);
  }
  return n;
}

/** D60: free bytes on the disk that holds the run folders. */
export async function freeDiskBytes(dir = worcaHome()) {
  try {
    await mkdir(dir, { recursive: true });
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

/** D60: the bytes in a checkout after its setup. Links and junctions are never followed. null past `maxEntries`. */
export async function dirBytes(dir, { maxEntries = 300_000 } = {}) {
  let bytes = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names;
    try { names = await readdir(d); } catch { continue; }
    for (const name of names) {
      seen += 1;
      if (seen > maxEntries) return null;
      const p = join(d, name);
      let st;
      try { st = await lstat(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;   // Node reports a Windows junction as a link too
      if (st.isDirectory()) stack.push(p); else bytes += st.size;
    }
  }
  return bytes;
}

/** The start point dialog (P2): the project's local branches, the one its folder is on first. Read only. */
export async function listBranches(projectDir, { max = 50 } = {}) {
  const current = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  const r = await git(projectDir, ['for-each-ref', '--sort=-committerdate', `--count=${max}`,
    '--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)', 'refs/heads']);
  if (!r.ok) return [];
  const out = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, sha, at] = line.split('\0');
    return { name, sha, at: new Date(at).toISOString(), current: name === current };
  });
  return out.sort((x, y) => Number(y.current) - Number(x.current));
}

/** Remove a folder, riding out a Windows file lock (EPERM, EBUSY). null = gone; else why it stayed. Never throws. */
export async function removeTree(dir, { rmImpl = rm, attempts = 5, waitMs = 500 } = {}) {
  for (let i = 1; ; i += 1) {
    try { await rmImpl(dir, RM); return null; }
    catch (e) {
      if (i >= attempts || !RETRY_CODES.has(e && e.code)) return e && e.message ? e.message : String(e);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * D61: after a try's checks, or on any other end: its checkout, its branch in the copy and its run root. Node's rm removes
 * the checkout first (it never follows a junction, as the test proves); `git worktree prune` then drops the registration.
 * This rm-then-prune intentionally replaces `git worktree remove --force`, whose own walk is not proved junction-safe.
 * The checkout folder goes first, outside the lock (a long removal never holds up another try's start); only the copy
 * writes (prune, branch -D) take its key's lock. A copy that is not a repository of its own is skipped and reported.
 * Takes the key's lock, and is not re-entrant: never call it from inside withKeyLock for the same key.
 */
export async function removeTryCheckout({ copyDir, worktreeDir = null, branch = null, runRoot = null, pipelineId = null, rmImpl } = {}) {
  const errors = [];
  // Final review: the recorded folder is removed only inside the try's own run folder (<worcaHome>/runs/<pipelineId>; without
  // a pipeline id, inside <worcaHome>/runs). Anything else is refused and reported, never removed.
  if (worktreeDir && existsSync(worktreeDir) && !insideRunFolder(worktreeDir, pipelineId)) {
    errors.push(`Worca did not remove ${worktreeDir}: it is outside the try's run folder`);
    worktreeDir = null;
  }
  if (worktreeDir && existsSync(worktreeDir)) {
    const e = await removeTree(worktreeDir, rmImpl ? { rmImpl } : {});
    if (e) errors.push(e);
  }
  const inCopy = async () => {
    if (!(await ownRepo(copyDir))) { errors.push(notACopy(copyDir)); return; }
    await copyGit(copyDir, ['worktree', 'prune']);
    if (branch && /^[^-]/.test(branch) && (await copyGit(copyDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok) {
      const d = await copyGit(copyDir, ['branch', '-D', branch]);
      if (!d.ok) errors.push(`Worca could not delete the branch ${branch} in its copy of the project: ${firstLine(d.stderr)}`);
    }
  };
  if (copyDir && existsSync(copyDir)) {
    const key = testCopyKeyOf(copyDir);
    if (key) await withKeyLock(key, inCopy);
    else errors.push(notACopy(copyDir));   // not under testCopiesRoot(): never touched
  }
  if (runRoot && pipelineId && existsSync(runRoot)) {
    const r = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId });
    if (!r.removed && existsSync(runRoot)) errors.push(r.reason || 'the run folder stayed');
  }
  return { removed: !errors.length, error: errors[0] || null };
}

/** `dir` is inside <worcaHome>/runs/<pipelineId> (or <worcaHome>/runs without one): by path, and by realpath when both exist. */
function insideRunFolder(dir, pipelineId) {
  const runs = join(worcaHome(), 'runs');
  if (pipelineId != null && !/^[A-Za-z0-9._-]+$/.test(String(pipelineId))) return false;
  const base = pipelineId ? join(runs, String(pipelineId)) : runs;
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const within = (child, parent) => { const c = fold(resolve(child)); const b = fold(resolve(parent)); return c !== b && c.startsWith(b.endsWith(sep) ? b : b + sep); };
  if (!within(dir, base)) return false;
  try { return within(realpathSync(dir), realpathSync(base)); } catch { return true; }   // the path test held; a base that is gone has nothing to follow
}

/**
 * D61, at boot (no try runs, no clone is being made): clone folders a crash left half made are removed, and every copy
 * prunes its worktrees and loses the try branches no worktree holds.
 */
export async function sweepTestCopies({ log = () => {} } = {}) {
  const out = { copies: 0, branches: 0 };
  let entries = [];
  try { entries = (await readdir(testCopiesRoot(), { withFileTypes: true })).filter((e) => e.isDirectory()); }
  catch { return out; }
  for (const e of entries.filter((x) => x.name.startsWith('.clone-'))) {
    const why = await removeTree(join(testCopiesRoot(), e.name));
    if (why) log('warn', `workflow tests: could not remove the half made copy ${e.name}: ${why}`);
    else log('info', `workflow tests: removed the half made copy ${e.name}`);
  }
  const names = entries.filter((e) => PROJECT_KEY_RE.test(e.name)).map((e) => e.name);
  for (const name of names) {
    const dir = join(testCopiesRoot(), name);
    await withKeyLock(name, async () => {
      if (!(await ownRepo(dir))) { log('warn', `workflow tests: ${notACopy(dir)}`); return; }
      out.copies += 1;
      await copyGit(dir, ['worktree', 'prune']);
      const held = new Set((await copyGit(dir, ['worktree', 'list', '--porcelain'])).stdout.split('\n')
        .filter((l) => l.startsWith('branch refs/heads/')).map((l) => l.slice('branch refs/heads/'.length)));
      const r = await copyGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/worca-cc/']);
      for (const b of r.stdout.split('\n').filter(Boolean)) {
        if (held.has(b)) continue;
        if ((await copyGit(dir, ['branch', '-D', b])).ok) out.branches += 1;
        else log('warn', `workflow tests: could not delete the leftover branch ${b} in ${dir}`);
      }
    });
  }
  if (out.branches) log('info', `workflow tests: removed ${out.branches} leftover try branch(es) in ${out.copies} copy(ies) of a project`);
  return out;
}

/** The branch the folder is on and its commit (the editor's default start point). Read only. null without a commit. */
export async function headOf(projectDir) {
  const sha = (await git(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).stdout.trim();
  if (!sha) return null;
  const branch = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  return { branch, sha, at: await commitDate(projectDir, sha) };
}

// A commit id (a run's branch record or a stored pin): never an option or a ref expression handed to git.
const isSha = (sha) => typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha);

/** Whether the repository has this commit (P4: a project added again keeps an example's start point). Read only. */
export async function commitExists(projectDir, sha) {
  return isSha(sha) && (await git(projectDir, ['cat-file', '-e', `${sha}^{commit}`])).ok;
}

/** One remote's URL (P9: the forge a guarded push named), or null. Read only (`git remote get-url`). */
export async function remoteUrl(projectDir, name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name)) return null;   // never an option
  const r = await git(projectDir, ['remote', 'get-url', name]);
  return r.ok ? r.stdout.trim().split(/\r?\n/)[0] || null : null;
}

/** A commit's committer date as ISO, or null. Read only. */
export async function commitDate(projectDir, sha) {
  if (!isSha(sha)) return null;
  const r = await git(projectDir, ['show', '-s', '--format=%cI', sha]);
  const d = r.ok ? Date.parse(r.stdout.trim()) : NaN;
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
}
