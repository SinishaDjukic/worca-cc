// src/core/workflow-tests/project-copy.mjs
// Worca's own copy of a project (plans/workflow-tests-part3a-plan.md D42, D53, D54, D60, D61). One clone per project key at
// <worcaHome>/workflow-tests/repos/<key>, with no remote. Examples pin a start commit in it; every try is a worktree of it.
// The person's repository is only ever read: clone and fetch use it as their source, everything else is rev-parse,
// rev-list, ls-tree, cat-file, show, grep <tree>, for-each-ref and symbolic-ref, and uncommitted changes are read with
// uncommittedPatch's scratch objects.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { testCopiesRoot, testCopyDirFor, PROJECT_KEY_RE } from '../store.mjs';
import { uncommittedPatch } from '../git-info.mjs';
import { isSafeBranchName } from '../git-sync.mjs';
import { rmGuarded } from '../run-manifest.mjs';
import { testError, PIN_MAX_CHANGES } from './store.mjs';
import { lfsText, submodulesText, START_GONE_TEXT, CHANGES_TOO_BIG_TEXT } from '../../shared/workflow-tests/project-text.mjs';

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
      done({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const LOCKS = new Map();
/** One job at a time writes a copy (a clone, a fetch, a start commit): three tries start at once (D36). */
export function withKeyLock(key, fn) {
  const prev = LOCKS.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  LOCKS.set(key, tail);
  tail.then(() => { if (LOCKS.get(key) === tail) LOCKS.delete(key); });
  return next;
}

/** The copy of `key`, made from `projectDir` when it is missing or half made (D54). */
export async function ensureTestCopy(key, { projectDir }) {
  const dir = testCopyDirFor(key);
  if (existsSync(join(dir, '.git')) && (await git(dir, ['rev-parse', '--git-dir'])).ok) return { dir, created: false };
  await rm(dir, RM);
  await mkdir(testCopiesRoot(), { recursive: true });
  const c = await git(testCopiesRoot(), ['clone', '--quiet', '--local', '--no-checkout', '--no-tags', '--', resolve(projectDir), dir]);
  if (!c.ok) throw testError(`Worca could not copy the project: ${firstLine(c.stderr)}`, 'NOT_READY');
  for (const args of [['remote', 'remove', 'origin'], ['config', 'core.longpaths', 'true'], ['config', 'gc.auto', '0'], ['config', 'maintenance.auto', 'false']]) {
    const r = await git(dir, args);
    if (!r.ok) throw testError(`Worca could not set up its copy of the project: ${firstLine(r.stderr)}`, 'NOT_READY');
  }
  return { dir, created: true };
}

/** D54: what the copy could not hold. Read only (cat-file, grep on the tree). */
export async function projectUnsupported({ projectDir, sha }) {
  if ((await git(projectDir, ['cat-file', '-e', `${sha}:.gitmodules`])).ok) return 'submodules';
  const g = await git(projectDir, ['grep', '-q', '-I', '-e', 'filter=lfs', sha, '--', '.gitattributes', '*/.gitattributes']);
  return g.ok ? 'lfs' : null;
}

async function resolveStart(projectDir, { ref, sha }) {
  const current = (await git(projectDir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;
  if (sha) {
    const v = await git(projectDir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (!v.ok) throw testError(START_GONE_TEXT, 'NOT_READY');
    return { commit: v.stdout.trim(), startRef: ref ?? null, current };
  }
  const startRef = ref ?? current;
  const v = await git(projectDir, ['rev-parse', '--verify', '--quiet', startRef ? `refs/heads/${startRef}^{commit}` : 'HEAD^{commit}']);
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
  if ((await git(dir, ['cat-file', '-e', `${sha}^{commit}`])).ok) return;
  const f = await git(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--', resolve(projectDir), sha]);
  if (!f.ok) throw testError(START_GONE_TEXT, 'NOT_READY');
}

/** D53: start commit = `base` + the patch, in the copy, with a temporary index. Same inputs → same SHA. */
async function commitChanges(dir, base, patch, at) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-wft-start-'));
  try {
    const env = { ...process.env, ...WORCA_ID, GIT_INDEX_FILE: join(tmp, 'index'), GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
    for (const k of GIT_DIR_ENV) if (k !== 'GIT_INDEX_FILE') delete env[k];
    const file = join(tmp, 'changes.patch');
    await writeFile(file, patch);
    for (const args of [['read-tree', base], ['apply', '--cached', '--binary', '--whitespace=nowarn', file]]) {
      const r = await git(dir, args, { env });
      if (!r.ok) throw testError(`Worca could not apply your changes that are not committed: ${firstLine(r.stderr)}`, 'BAD_REQUEST');
    }
    const tree = (await git(dir, ['write-tree'], { env })).stdout.trim();
    const c = await git(dir, ['commit-tree', '--no-gpg-sign', tree, '-p', base, '-m', 'Worca test start: changes that were not committed yet'], { env });
    if (!c.ok || !c.stdout.trim()) throw testError(`Worca could not make the start point: ${firstLine(c.stderr)}`, 'NOT_READY');
    return c.stdout.trim();
  } finally { await rm(tmp, RM).catch(() => {}); }
}

const pinRef = (dir, sha) => git(dir, ['update-ref', `refs/worca-tests/${sha}`, sha]);

/**
 * Pin a start point (D41, D53): the newest commit of `ref` (default: the branch the folder is on), or exactly `sha` (a past
 * run's start, D65). With `includeChanges`, the person's uncommitted changes go on top as Worca's own start commit.
 */
export async function pinStart({ key, name = key, projectDir, ref = null, sha = null, includeChanges = false } = {}) {
  if (ref != null && !isSafeBranchName(ref)) throw testError('pick a branch of the project', 'BAD_REQUEST');
  const { commit, startRef, current } = await resolveStart(projectDir, { ref, sha });
  const why = await projectUnsupported({ projectDir, sha: commit });
  if (why) throw testError(why === 'lfs' ? lfsText(name) : submodulesText(name), 'NOT_READY');
  const startAt = new Date((await git(projectDir, ['show', '-s', '--format=%cI', commit])).stdout.trim()).toISOString();
  let changes = null;
  if (includeChanges) {
    if (sha || !startRef || startRef !== current) throw testError('uncommitted changes can be kept only for the branch your project folder is on', 'BAD_REQUEST');
    changes = await readChanges(projectDir, commit);
  }
  return withKeyLock(key, async () => {
    const { dir } = await ensureTestCopy(key, { projectDir });
    await fetchInto(dir, projectDir, commit);
    const startCommit = changes ? await commitChanges(dir, commit, changes, startAt) : commit;
    await pinRef(dir, startCommit);
    return { key, startSha: commit, startRef, startAt, startCommit, changes, setupCmd: null };
  });
}

/** Before a try: the example's start commit is in the copy; a copy removed meanwhile is made again (same SHA, D53). */
export async function ensureStartCommit({ key, projectDir, project, changes = null }) {
  return withKeyLock(key, async () => {
    const { dir } = await ensureTestCopy(key, { projectDir });
    if (!(await git(dir, ['cat-file', '-e', `${project.startCommit}^{commit}`])).ok) {
      await fetchInto(dir, projectDir, project.startSha);
      const again = changes ? await commitChanges(dir, project.startSha, changes, project.startAt) : project.startSha;
      if (again !== project.startCommit) throw testError(START_GONE_TEXT, 'NOT_READY');
    }
    await pinRef(dir, project.startCommit);
    return { copyDir: dir, startCommit: project.startCommit };
  });
}

/** D63: how many commits the start branch gained since the start point; null when Worca cannot tell. Read only. */
export async function behindCount({ projectDir, startSha, startRef }) {
  if (!startRef || !projectDir || !existsSync(projectDir) || !isSafeBranchName(startRef)) return null;
  const r = await git(projectDir, ['rev-list', '--count', `${startSha}..refs/heads/${startRef}`]);
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
 * `git worktree remove` is not used: its own walk is not proved junction-safe on Windows.
 */
export async function removeTryCheckout({ copyDir, worktreeDir = null, branch = null, runRoot = null, pipelineId = null, rmImpl } = {}) {
  const errors = [];
  if (worktreeDir && existsSync(worktreeDir)) {
    const e = await removeTree(worktreeDir, rmImpl ? { rmImpl } : {});
    if (e) errors.push(e);
  }
  if (copyDir && existsSync(copyDir)) {
    await git(copyDir, ['worktree', 'prune']);
    if (branch && /^[^-]/.test(branch)) await git(copyDir, ['branch', '-D', branch]);
  }
  if (runRoot && pipelineId && existsSync(runRoot)) {
    const r = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId });
    if (!r.removed && existsSync(runRoot)) errors.push(r.reason || 'the run folder stayed');
  }
  return { removed: !errors.length, error: errors[0] || null };
}

/** D61, at boot (no try runs): every copy prunes its worktrees and loses the try branches no worktree holds. */
export async function sweepTestCopies({ log = () => {} } = {}) {
  const out = { copies: 0, branches: 0 };
  let names = [];
  try { names = (await readdir(testCopiesRoot(), { withFileTypes: true })).filter((e) => e.isDirectory() && PROJECT_KEY_RE.test(e.name)).map((e) => e.name); }
  catch { return out; }
  for (const name of names) {
    const dir = join(testCopiesRoot(), name);
    if (!(await git(dir, ['rev-parse', '--git-dir'])).ok) continue;
    out.copies += 1;
    await git(dir, ['worktree', 'prune']);
    const held = new Set((await git(dir, ['worktree', 'list', '--porcelain'])).stdout.split('\n')
      .filter((l) => l.startsWith('branch refs/heads/')).map((l) => l.slice('branch refs/heads/'.length)));
    const r = await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/worca-cc/']);
    for (const b of r.stdout.split('\n').filter(Boolean)) {
      if (held.has(b)) continue;
      if ((await git(dir, ['branch', '-D', b])).ok) out.branches += 1;
    }
  }
  if (out.branches) log('info', `workflow tests: removed ${out.branches} leftover try branch(es) in ${out.copies} copy(ies) of a project`);
  return out;
}
