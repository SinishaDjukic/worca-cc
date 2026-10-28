// src/core/project-create.mjs
// The one module every New / Use git / probe path goes through — routes, the Ask card, tests.
// New (a name → <projects root>/<folder name>), add a folder with `Use git`, and the folder probe the
// Add project dialog reads. Every check runs before the first mkdir / git init; a failure after
// one of them removes what this call made (the new folder, or the .git it made) and nothing else.

import { execFile } from 'node:child_process';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { getProjectsRoot } from './settings.mjs';
import {
  listProjects as realListProjects, addProject as realAddProject, markProjectGit as realMarkProjectGit, detectVcs, displayPath,
  getProjectByPath, normalizeProjectPath, worcaHome, enclosingRepoOf, worcaNestedRepoOf, worcaNestedRepoHint,
} from './projects.mjs';
import { isWithin } from './fs-scope.mjs';
import { gitAvailable as realGitAvailable, GIT_MISSING } from './git-available.mjs';
import { isNoProjectWorkDir } from './store.mjs';
import { NO_PROJECT_ERRORS } from '../shared/no-project.mjs';
import { isAzureHost } from '../shared/azure-remote.mjs';
import { isBitbucketHost } from '../shared/bitbucket-remote.mjs';

/** A refusal or failure of New / add-a-folder / probe. `code` picks the HTTP status (PROJECT_ADD_STATUS). */
export class ProjectAddError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ProjectAddError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export const PROJECT_ADD_STATUS = Object.freeze({ INVALID: 400, EXISTS: 400, NESTED_IN_REPO: 400, NOT_FOUND: 404, GIT_MISSING: 409, FAILED: 500 });

const invalid = (message) => new ProjectAddError('INVALID', message);
const fold = (s) => String(s).normalize('NFC').toLowerCase();   // macOS stores NFD; macOS/Windows ignore case
// Microsoft's reserved device names (CONIN$/CONOUT$ and the superscript COM/LPT forms included); Win32 drops the
// spaces before an extension, so `CON .txt` is the console too (as src/core/download-filename.mjs).
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;
// Characters Windows forbids, C0/C1 controls, line/paragraph separators and the bidirectional controls that reorder
// what a list shows (`a<RLO>txt.exe`).
const BAD_CHARS = /[<>:"|?*\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const utf8Size = (s) => Buffer.byteLength(s, 'utf8');
const HOLDS_WORCA = 'this folder holds worca\'s data or projects folder; Use git here would put every project inside one repository';
const BAD_REMOTE = 'not a valid git remote URL; use https://host/owner/repo or git@host:owner/repo.git';
const REMOTE_CREDS = 'the URL contains credentials; remove them (git asks your credential helper or SSH key instead)';
const SCP_REMOTE_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/;

/** A remote URL Use git / Link remote may pass to `git remote add origin` (argv, never a shell). Returns it trimmed. */
export function checkRemoteUrl(raw) {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url) throw invalid('a remote URL is required');
  if (url.length > 2048 || /[\s\0]/.test(url) || url.startsWith('-')) throw invalid(BAD_REMOTE);
  if (SCP_REMOTE_RE.test(url)) return url;
  let u;
  try { u = new URL(url); } catch { throw invalid(BAD_REMOTE); }
  if (u.protocol !== 'https:' && u.protocol !== 'ssh:') throw invalid('only https:// and ssh remote URLs are supported');
  if (u.password || (u.protocol === 'https:' && u.username && !isAzureHost(u.hostname) && !isBitbucketHost(u.hostname))) throw invalid(REMOTE_CREDS);
  if (u.search || u.hash) throw invalid('the URL must not have a query or fragment');
  if (!u.hostname || !u.pathname.split('/').some(Boolean)) throw invalid('the URL must name a repository path');
  return url;
}

/**
 * The New name rule: one portable folder name (a project made on Linux opens on Windows).
 * First match wins. Unicode letters and inner spaces are allowed; `:` is refused on every OS
 * (Finder shows it as `/`).
 * @returns {string} the trimmed name
 * @throws {ProjectAddError} code INVALID
 */
export function checkFolderName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw invalid('a project name is required');
  if ([...name].length > 100) throw invalid('the name may be up to 100 characters');
  if (utf8Size(name) > 255) throw invalid('the name is too long for a folder');   // ext4 / APFS: 255 UTF-8 bytes
  if (/[/\\]/.test(name)) throw invalid('the name must be one folder name, without / or \\');
  if (name.startsWith('.')) throw invalid('the name cannot start with a dot');
  if (!name.isWellFormed() || BAD_CHARS.test(name)) throw invalid('the name cannot contain < > : " | ? * or control characters');
  if (name.endsWith('.')) throw invalid('the name cannot end with a dot');   // a trailing space cannot survive the trim
  if (RESERVED.test(name)) throw invalid(`"${name}" is a reserved name on Windows`);
  return name;
}

/**
 * The folder New makes for a name: lowercase, each run of spaces one `_` ("Worca Presentation" → worca_presentation),
 * so no shell on any OS needs it quoted. The project keeps the name as typed. Checked again: lowercase can grow the
 * UTF-8 bytes (İ → i̇).
 * @throws {ProjectAddError} code INVALID
 */
export function folderNameFor(raw) {
  return checkFolderName(checkFolderName(raw).toLowerCase().replace(/\s+/g, '_'));
}

function withDeps(deps = {}) {
  return {
    projectsRoot: deps.projectsRoot,
    gitAvailable: deps.gitAvailable || realGitAvailable,
    enclosingRepo: deps.enclosingRepo || enclosingRepo,
    gitInit: deps.gitInit || runGitInit,
    gitRemote: deps.gitRemote || runGitRemote,
    listProjects: deps.listProjects || realListProjects,
    addProject: deps.addProject || realAddProject,
    markProjectGit: deps.markProjectGit || realMarkProjectGit,
  };
}

/**
 * The real path of `p` with the letter case on disk (realpathSync.native: on macOS and Windows the JS realpathSync keeps
 * the case as typed, so `/users/me` would not match `/Users/me`), or, for a path that does not exist yet, the real path
 * of its nearest existing ancestor joined with the rest.
 */
function realOnDisk(p) {
  const abs = resolve(p);
  for (let a = abs; ; a = dirname(a)) {
    try { const r = realpathSync.native(a); return a === abs ? r : join(r, abs.slice(a.length)); } catch { /* missing: up */ }
    if (dirname(a) === a) return abs;
  }
}
const removeQuietly = (p) => rm(p, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
// One add per folder at a time in this process (the dialog's route and the chat card): a second add of the same folder
// waits, then is refused as registered before any git init. Two git inits at once collide, and the losing call's
// cleanup would remove the .git of the project the other call registered as Git.
const folderAdds = new Map();
async function oneAddAtATime(key, fn) {
  const prev = folderAdds.get(key);
  let release;
  const mine = new Promise((r) => { release = r; });
  folderAdds.set(key, mine);
  try {
    if (prev) await prev;
    return await fn();
  } finally {
    release();
    if (folderAdds.get(key) === mine) folderAdds.delete(key);
  }
}
const lastLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';

function nestedError(enc) {
  const partOf = enc.partOf ?? null;
  return new ProjectAddError('NESTED_IN_REPO', partOf ? `Part of ${partOf}` : 'Inside a git repository',
    { repoRoot: enc.repoRoot ?? null, partOf });
}

/** A registration throw (projects.mjs#insertProject) as a ProjectAddError; P1a's NESTED_IN_REPO keeps repoRoot/partOf. */
function mapAddError(err) {
  if (err instanceof ProjectAddError) return err;
  const message = err && err.message ? err.message : String(err);
  if (err && err.code === 'NESTED_IN_REPO') return new ProjectAddError('NESTED_IN_REPO', message, { repoRoot: err.repoRoot ?? null, partOf: err.partOf ?? null });
  if (/already (exists|registered)/.test(message)) return new ProjectAddError('EXISTS', message);
  return new ProjectAddError('INVALID', message);
}

/** The registered project whose name folds (NFC + lowercase) to `name`'s, or null: a refusal names it by its stored spelling. */
async function nameTaken(listProjects, name) {
  const want = fold(name);
  return (await listProjects()).find((p) => p && typeof p.name === 'string' && fold(p.name) === want) ?? null;
}

/**
 * True when `dir` is, or holds, the Worca home or the projects root: git init there would put worca's own data and
 * every project inside one repository (R8 would then refuse every New). Compared as real paths with the case on disk
 * (`/users/me` is `/Users/me` on macOS and Windows; a missing projects root by its nearest existing ancestor), and by
 * folder identity: a path realpath does not map back (macOS `/System/Volumes/Data/Users/me`, a Linux bind mount) is
 * the same folder when one of the real path's ancestors has its device and inode.
 */
function holdsWorcaFolders(dir, projectsRoot) {
  let wh = null;
  try { wh = worcaHome(); } catch { /* node:test without WORCA_HOME */ }
  const me = realOnDisk(dir);
  const id = folderId(me);
  const holds = (real) => {
    if (isWithin(real, me)) return true;
    for (let a = real; id; a = dirname(a)) {
      if (folderId(a) === id) return true;
      if (dirname(a) === a) return false;
    }
    return false;
  };
  return [wh, projectsRoot ?? getProjectsRoot()].some((p) => p && holds(realOnDisk(p)));
}

/** `dev:ino` of a folder, or null (missing, or a file system without stable inodes: ino 0). */
function folderId(p) {
  try { const s = statSync(p, { bigint: true }); return s.ino ? `${s.dev}:${s.ino}` : null; } catch { return null; }
}

/** The first entry of `root` with the same NFC + lowercase name, or null (also when `root` is missing). */
function diskClash(root, name) {
  let entries;
  try { entries = readdirSync(root); } catch { return null; }
  const want = fold(name);
  return entries.find((e) => fold(e) === want) ?? null;
}

/** R8 for a path that may not exist yet: projects.mjs#enclosingRepoOf (one rule for Add, registration and run start). */
export const enclosingRepo = enclosingRepoOf;

/**
 * Files under `dir`, for the Folder pane's "N files" chip. Iterative; never enters `.git`, never
 * follows a symlink or junction (a Dirent that is not a directory counts as one file); an
 * unreadable folder is skipped. `capped` when there are more than `cap` files or more than
 * `maxDirs` folders.
 * @returns {Promise<{n:number, capped:boolean}>}
 */
export async function countFiles(dir, { cap = 5000, maxDirs = 2000 } = {}) {
  const stack = [dir];
  let n = 0;
  let dirs = 0;
  while (stack.length) {
    if (dirs >= maxDirs) return { n, capped: true };
    const d = stack.pop();
    dirs += 1;
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      if (e.isDirectory()) { stack.push(join(d, e.name)); continue; }
      n += 1;
      if (n > cap) return { n: cap, capped: true };
    }
  }
  return { n, capped: false };
}

/** `git init -q` in `dir`, like every other worca git call (`execFile('git', …)`). Never spawns while git is missing. */
export function runGitInit(dir, { timeoutMs = 15_000 } = {}) {
  if (!realGitAvailable()) return Promise.resolve({ ok: false, stderr: GIT_MISSING.message });
  return new Promise((done) => {
    execFile('git', ['init', '-q'], {
      cwd: dir, timeout: timeoutMs, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, _stdout, stderr) => {
      done(err ? { ok: false, stderr: String(stderr || err.message || '') } : { ok: true, stderr: String(stderr || '') });
    });
  });
}

/** `git remote ARGS` in `dir` (no prompt, bounded). Resolves { ok, stdout, stderr }; never rejects. */
export function runGitRemote(dir, args, { timeoutMs = 15_000 } = {}) {
  if (!realGitAvailable()) return Promise.resolve({ ok: false, stdout: '', stderr: GIT_MISSING.message });
  return new Promise((done) => {
    execFile('git', ['remote', ...args], {
      cwd: dir, timeout: timeoutMs, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => {
      done({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') });
    });
  });
}

/**
 * New: a folder named folderNameFor(`name`) under the projects root (made on first use), registered as a Folder
 * project, or a Git one with `useGit` (git init once). Nothing is created on any refusal.
 * @returns {Promise<{dryRun:true, root:string, path:string, name:string, displayPath:string}|{project:object, projects:object[]}>}
 * @throws {ProjectAddError}
 */
export async function createProject({ name, useGit = false, dryRun = false } = {}, deps = {}) {
  const d = withDeps(deps);
  const clean = checkFolderName(name);
  const folder = folderNameFor(clean);
  const root = resolve(d.projectsRoot ?? getProjectsRoot());
  const dir = join(root, folder);
  const taken = await nameTaken(d.listProjects, clean);
  if (taken) throw new ProjectAddError('EXISTS', `a project named "${taken.name}" already exists`);
  const registered = getProjectByPath(dir);   // its folder may be gone
  if (registered) throw new ProjectAddError('EXISTS', `${dir} is already registered as "${registered.name}"; pick another name`);
  const clash = diskClash(root, folder);
  if (clash !== null) throw new ProjectAddError('EXISTS', `${join(root, clash)} already exists; pick another name`);
  const gitOn = d.gitAvailable();
  if (useGit && !gitOn) throw new ProjectAddError('GIT_MISSING', GIT_MISSING.message);
  if (!useGit) {
    const enc = await d.enclosingRepo(dir, { gitOn });
    if (enc) throw nestedError(enc);
  }
  if (dryRun) return { dryRun: true, root, path: dir, name: clean, displayPath: displayPath(dir) };
  try {
    await mkdir(root, { recursive: true });
  } catch (err) {
    throw new ProjectAddError('FAILED', `could not create ${root}: ${err.message}`);
  }
  try {
    await mkdir(dir);
  } catch (err) {
    if (err && err.code === 'EEXIST') throw new ProjectAddError('EXISTS', `${dir} already exists; pick another name`);
    throw new ProjectAddError('FAILED', `could not create ${dir}: ${err.message}`);
  }
  if (useGit) {
    const r = await d.gitInit(dir);
    if (!r || !r.ok) {
      await removeQuietly(dir);
      throw new ProjectAddError('FAILED', `git init failed: ${lastLine(r && r.stderr) || 'unknown error'}`);
    }
  }
  let projects;
  try {
    projects = await d.addProject({ name: clean, path: dir });
  } catch (err) {
    await removeQuietly(dir);
    throw mapAddError(err);
  }
  const project = (Array.isArray(projects) ? projects : []).find((p) => p.path === dir) || { name: clean, path: dir, vcs: useGit ? 'git' : 'none' };
  return { project, projects };
}

/**
 * Add an existing folder (git or not). `useGit` on a folder without .git runs git init once and
 * stores Git; a folder that already has .git is added as Git without git init.
 * @returns {Promise<{dryRun:true, name:string, path:string, vcs:'git'|'none', displayPath:string}|{project:object, projects:object[]}>}
 * @throws {ProjectAddError}
 */
export async function addProjectFolder(input = {}, deps = {}) {
  if (input.dryRun) return addFolderNow(input, deps);
  const dir = normalizeProjectPath(input.path);
  return oneAddAtATime(dir ? realOnDisk(dir) : '', () => addFolderNow(input, deps));
}

async function addFolderNow({ name, path, useGit = false, dryRun = false } = {}, deps = {}) {
  const d = withDeps(deps);
  const dir = normalizeProjectPath(path);
  if (!dir) throw invalid('project path is required');
  let st;
  try { st = statSync(dir); } catch { throw invalid('folder does not exist'); }
  if (!st.isDirectory()) throw invalid('path is not a directory');
  if (isNoProjectWorkDir(dir)) throw invalid(NO_PROJECT_ERRORS.register);   // insertProject's refusal, before any git init
  const label = (typeof name === 'string' && name.trim()) || basename(dir);
  if (await nameTaken(d.listProjects, label)) throw new ProjectAddError('EXISTS', `a project named "${label}" already exists`);
  if (getProjectByPath(dir)) throw new ProjectAddError('EXISTS', 'this project path is already registered');
  const gitOn = d.gitAvailable();
  const enc = await d.enclosingRepo(dir, { gitOn });
  if (enc) throw nestedError(enc);
  const hasGit = detectVcs(dir) === 'git';
  const willInit = !!useGit && !hasGit;
  if (willInit && !gitOn) throw new ProjectAddError('GIT_MISSING', GIT_MISSING.message);
  if (willInit && holdsWorcaFolders(dir, d.projectsRoot)) throw invalid(HOLDS_WORCA);
  if (dryRun) return { dryRun: true, name: label, path: dir, vcs: hasGit || useGit ? 'git' : 'none', displayPath: displayPath(dir) };
  const madeGit = join(dir, '.git');
  if (willInit) {
    const r = await d.gitInit(dir);
    if (!r || !r.ok) {
      await removeQuietly(madeGit);
      throw new ProjectAddError('FAILED', `git init failed: ${lastLine(r && r.stderr) || 'unknown error'}`);
    }
  }
  let projects;
  try {
    projects = await d.addProject({ name: label, path: dir });
  } catch (err) {
    if (willInit) await removeQuietly(madeGit);   // only a .git this call made is ever removed
    throw mapAddError(err);
  }
  const project = (Array.isArray(projects) ? projects : []).find((p) => p.path === dir) || { name: label, path: dir, vcs: hasGit || willInit ? 'git' : 'none' };
  return { project, projects };
}

const ALREADY_GIT = 'this folder already has a .git; remove the project (the folder stays) and add the folder again to use it as a Git project';

/**
 * Use git (Folder → Git in place) or Link remote (a Git project without origin), chosen by the stored vcs.
 * Folder: guards, git init, optional `git remote add origin`, then vcs 'git' — any failure after init removes the
 * .git this call made. No commit: the first run's initial checkpoint makes it (run-harness).
 * @returns {Promise<{project:{key:string,name:string,path:string,vcs:'git'}, initialized:boolean, remote:string|null}>}
 * @throws {ProjectAddError}
 */
export async function makeGitProject({ key, remoteUrl = null } = {}, deps = {}) {
  const d = withDeps(deps);
  const p = (await d.listProjects()).find((x) => x.key === key);
  if (!p) throw new ProjectAddError('NOT_FOUND', 'project not found');
  return oneAddAtATime(realOnDisk(p.path), () => makeGitNow(p, remoteUrl, d));
}

async function makeGitNow(p, remoteUrl, d) {
  if (remoteUrl != null && typeof remoteUrl !== 'string') throw invalid('remoteUrl must be a string');   // the route forwards the body untyped
  const url = remoteUrl == null || remoteUrl.trim() === '' ? null : checkRemoteUrl(remoteUrl);
  const dir = p.path;
  let st;
  try { st = statSync(dir); } catch { throw invalid('folder does not exist'); }
  if (!st.isDirectory()) throw invalid('path is not a directory');
  const gitOn = d.gitAvailable();
  if (!gitOn) throw new ProjectAddError('GIT_MISSING', GIT_MISSING.message);
  if (p.vcs === 'git') return linkOrigin(p, url, d);
  if (detectVcs(dir) === 'git') throw invalid(ALREADY_GIT);
  const enc = await d.enclosingRepo(dir, { gitOn });
  if (enc) throw nestedError(enc);
  if (holdsWorcaFolders(dir, d.projectsRoot)) throw invalid(HOLDS_WORCA);
  const madeGit = join(dir, '.git');
  const fail = async (message) => { await removeQuietly(madeGit); return new ProjectAddError('FAILED', message); };
  const r = await d.gitInit(dir);
  if (!r || !r.ok) throw await fail(`git init failed: ${lastLine(r && r.stderr) || 'unknown error'}`);
  if (url) {
    const a = await d.gitRemote(dir, ['add', 'origin', url]);
    if (!a || !a.ok) throw await fail(`git remote add failed: ${lastLine(a && a.stderr) || 'unknown error'}`);
  }
  let moved = false;
  try { moved = d.markProjectGit(p.key); } catch (err) { throw await fail(`could not record the change: ${err.message}`); }
  if (!moved) throw await fail('the project changed meanwhile; reload the page and try again');
  return { project: { key: p.key, name: p.name, path: dir, vcs: 'git' }, initialized: true, remote: url };
}

async function linkOrigin(p, url, d) {
  if (!url) throw invalid('a remote URL is required');
  if (detectVcs(p.path) !== 'git') throw invalid('this folder has no .git');
  if ((await d.gitRemote(p.path, ['get-url', 'origin'])).ok) throw new ProjectAddError('EXISTS', 'this project already has an origin remote');
  const a = await d.gitRemote(p.path, ['add', 'origin', url]);
  if (!a || !a.ok) throw new ProjectAddError('FAILED', `git remote add failed: ${lastLine(a && a.stderr) || 'unknown error'}`);
  return { project: { key: p.key, name: p.name, path: p.path, vcs: 'git' }, initialized: false, remote: url };
}

/**
 * What the Folder pane shows for a path: exists / is a folder, its kind, a file count (plain
 * folders outside any repository only), and the R8 chips (`insideRepo`, `partOf`).
 * @returns {Promise<{path:string, exists:boolean, isDir:boolean, vcs:'git'|'none'|null, files:number|null,
 *   filesCapped:boolean, insideRepo:boolean, partOf:string|null, repoRoot?:string, nestedHint?:string}>}
 * @throws {ProjectAddError} INVALID on a blank path
 */
export async function probeFolder(input, deps = {}) {
  const d = withDeps(deps);
  const path = normalizeProjectPath(input);
  if (!path) throw invalid('path is required');
  const gone = { path, exists: false, isDir: false, vcs: null, files: null, filesCapped: false, insideRepo: false, partOf: null };
  let st;
  try { st = statSync(path); } catch { return gone; }
  if (!st.isDirectory()) return { ...gone, exists: true };
  const vcs = detectVcs(path);
  const enc = await d.enclosingRepo(path, { gitOn: d.gitAvailable() });
  // #693: a repository an older worca git-inited inside the user's one reads as Git; the dialog warns with the fix.
  const made = vcs === 'git' ? worcaNestedRepoOf(path) : null;
  let files = null;
  let filesCapped = false;
  if (vcs === 'none' && !enc) ({ n: files, capped: filesCapped } = await countFiles(path));
  const repoRoot = enc?.repoRoot ?? made?.repoRoot ?? null;
  return {
    path, exists: true, isDir: true, vcs, files, filesCapped, insideRepo: !!enc,
    partOf: enc ? enc.partOf ?? null : made ? made.partOf : null,
    ...(repoRoot ? { repoRoot } : {}),
    ...(made ? { nestedHint: worcaNestedRepoHint(path, made) } : {}),
  };
}
