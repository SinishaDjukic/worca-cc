// src/core/workspace-import.mjs
// The workspace creation wizard's import (Add… and the paste box): what each picked or pasted path
// IS — a git repository, a folder of repositories or a VS Code `.code-workspace` file — as review
// rows the wizard ticks:
//   registered  an existing project (matched by projectKey, so a worktree or a subfolder of a
//               registered repository counts too, or by the folder its path opens): the
//               workspace reuses it
//   new         the wizard's Scan registers it first (POST /api/projects/bulk)
//   problem     why it cannot join (the workspace scan would refuse it): shown, never ticked
// One expander per source (IMPORT_SOURCES) turns an input into raw {name?, path, problem?} rows;
// one classifier checks them all. A folder inside a repository becomes that repository's top folder
// (a scan takes whole repositories: workspaces.mjs scanMemberProblems), and rows that name one
// repository merge into one.
//
// Read-only: it stats and lists folders, reads the .code-workspace file and runs `git rev-parse`
// with GIT_OPTIONAL_LOCKS=0. It never writes into a folder it reads, and never touches the project
// registry: the caller passes the registered projects in.

import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProjectPath } from './projects.mjs';
import { projectKey } from './store.mjs';

/** Paths one request may name (picked plus pasted lines); the route answers 400 past it. */
export const IMPORT_MAX_INPUTS = 100;
/** Rows one request classifies; the rest are cut and the answer says `truncated`. */
export const IMPORT_MAX_CANDIDATES = 100;
/** Folders the parent-folder scans of ONE request look at, in all: a pick of $HOME at depth 2 stays bounded. */
export const IMPORT_SCAN_MAX_DIRS = 2000;
/** A .code-workspace file is a few KB; anything past this is not one. */
export const CODE_WORKSPACE_MAX_BYTES = 1024 * 1024;

const CODE_WORKSPACE_RE = /\.code-workspace$/i;
const GIT_TIMEOUT_MS = 15000;
const PROBE_CONCURRENCY = 8;
// `~` and `~/…` are the user's home; `~bob/…` is not supported (normalizeProjectPath would read it
// as $HOME/bob/…, a different folder that may exist).
const HOME_PATH_RE = /^~(?:[\\/]|$)/;
const denied = (e) => !!e && (e.code === 'EACCES' || e.code === 'EPERM');
// A path its mode or macOS privacy settings (Documents, Desktop) keep closed: the same words for
// every way it was named (picked, pasted, listed in a .code-workspace file).
const PERMISSION_DENIED = 'Cannot be read: permission denied';
const unreadable = (e) => (denied(e) ? PERMISSION_DENIED : `Cannot be read: ${e.code || e.message}`);

// ── Parsers (pure) ────────────────────────────────────────────────────────────

// Index just past the JSON string that opens at s[i] (a '"'); an unterminated one runs to the end.
function stringEnd(s, i) {
  let j = i + 1;
  while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, s.length);
}

/**
 * JSON with comments, as VS Code writes `.code-workspace` files: `//` and block comments and
 * trailing commas outside strings, and a leading BOM. Two string-aware passes (a `//` inside
 * "file:///x" stays), then JSON.parse. Throws a SyntaxError like JSON.parse.
 */
export function parseJsonc(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  let bare = '';
  for (let i = 0; i < src.length;) {
    if (src[i] === '"') { const e = stringEnd(src, i); bare += src.slice(i, e); i = e; continue; }
    if (src.startsWith('//', i)) { const e = src.indexOf('\n', i); i = e === -1 ? src.length : e; bare += ' '; continue; }
    if (src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      if (e === -1) throw new SyntaxError('Unterminated comment');
      i = e + 2;
      bare += ' ';
      continue;
    }
    bare += src[i];
    i += 1;
  }
  let out = '';
  for (let i = 0; i < bare.length;) {
    if (bare[i] === '"') { const e = stringEnd(bare, i); out += bare.slice(i, e); i = e; continue; }
    if (bare[i] === ',') {
      let j = i + 1;
      while (j < bare.length && /\s/.test(bare[j])) j += 1;
      if (bare[j] === '}' || bare[j] === ']') { i += 1; continue; }   // a trailing comma
    }
    out += bare[i];
    i += 1;
  }
  return JSON.parse(out);
}

/**
 * The folders of a VS Code `.code-workspace` file: `folders[]` entries `{ path, name? }` (a relative
 * path resolves against the file's own folder, as VS Code does) or `{ uri, name? }` (a file: URI;
 * any other scheme is a remote folder, reported, never followed).
 * @returns {{ rows: {name?: string, path: string, problem?: string}[], workspaceName: string } | { problem: string }}
 */
export function codeWorkspaceFolders(text, filePath) {
  let doc;
  try { doc = parseJsonc(text); } catch (e) { return { problem: `Cannot read this .code-workspace file: ${e.message}` }; }
  const folders = doc && typeof doc === 'object' && Array.isArray(doc.folders) ? doc.folders : [];
  if (!folders.length) return { problem: 'Lists no folders' };
  const base = dirname(filePath);
  const rows = [];
  for (const f of folders) {
    if (!f || typeof f !== 'object') continue;
    const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : undefined;
    if (typeof f.path === 'string' && f.path.trim()) {
      const p = f.path.trim();
      rows.push({ name, path: isAbsolute(p) ? resolve(p) : resolve(base, p) });
    } else if (typeof f.uri === 'string' && f.uri.trim()) {
      const uri = f.uri.trim();
      const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1] || '').toLowerCase();
      if (scheme !== 'file') {
        rows.push({ name, path: uri, problem: `A remote folder (${scheme || 'no scheme'}): only folders on this machine can join` });
        continue;
      }
      // resolve: `file:///x/api/` names /x/api, the path addProjects stores.
      try { rows.push({ name, path: resolve(fileURLToPath(uri)) }); } catch { rows.push({ name, path: uri, problem: 'Not a usable file: URI' }); }
    }
  }
  if (!rows.length) return { problem: 'Lists no folders' };   // every entry lacked a path and a uri
  return { rows, workspaceName: basename(filePath).replace(CODE_WORKSPACE_RE, '') };
}

/**
 * A pasted list: one path per line. Blank lines and `#` lines are skipped; surrounding quotes, a
 * file:// URL and a POSIX shell's backslash escapes (a folder dragged into Terminal: `My\ Repo`,
 * `app\ \(old\)`) are undone. Duplicates collapse, order is kept. `~` is left for
 * normalizeProjectPath. It stops once it holds more than `max` paths: the route refuses past its
 * limit anyway, and a pasted `find` listing of megabytes must not hold the event loop.
 */
export function parsePathList(text, max = Infinity) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    let p = line.trim();
    if (!p || p.startsWith('#')) continue;
    if (p.length >= 2 && (p[0] === '"' || p[0] === "'") && p[p.length - 1] === p[0]) p = p.slice(1, -1).trim();
    if (/^file:\/\//i.test(p)) { try { p = fileURLToPath(p); } catch { /* left as is: it reads as not a full path */ } }
    if (/^(?:\/|~\/)/.test(p)) p = p.replace(/\\(.)/g, '$1');
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length > max) break;
  }
  return out;
}

// ── File system and git probes (read-only) ────────────────────────────────────

const statOrNull = (p) => stat(p).catch(() => null);
// True when the folder cannot be listed: git cannot even enter it.
const closed = (p) => readdir(p).then(() => false, denied);
// realpath(3), as scanMemberProblems compares (realpathSync.native).
const realOrSelf = (p) => realpath(p).catch(() => resolve(p));

// Read-only git: GIT_OPTIONAL_LOCKS=0 keeps even an index refresh from writing into the repository.
function git(cwd, args) {
  return new Promise((done) => {
    try {
      execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
        (err, stdout) => done(err ? null : String(stdout).trim()));
    } catch { done(null); }
  });
}

// One request's git probes, memoized by folder: inputs that name one folder probe it once.
async function probeContext(projects, outsideProblem = null) {
  const memo = (fn) => { const m = new Map(); return (p) => { const k = resolve(p); if (!m.has(k)) m.set(k, fn(k)); return m.get(k); }; };
  const registered = (Array.isArray(projects) ? projects : []).filter((p) => p && typeof p.key === 'string');
  // The folder each registered project's path opens (realpath(3) resolves a symlink, the letter
  // case and the Unicode form in one step). projectKey keeps the spelling it is given, so a project
  // stored as `…/API` keys apart from the folder `…/Api` that a picker or the disk names.
  const reals = await Promise.all(registered.map((p) => realpath(p.path).catch(() => null)));
  return {
    // { top, superproject } of the repository `dir` is in (superproject: set inside a submodule), or null.
    repo: memo(async (dir) => {
      const out = await git(dir, ['rev-parse', '--show-toplevel', '--show-superproject-working-tree']);
      if (!out) return null;
      const [top, superproject] = out.split(/\r?\n/);
      return { top: resolve(top), superproject: superproject ? resolve(superproject) : null };
    }),
    head: memo(async (dir) => (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null),
    byKey: new Map(registered.map((p) => [p.key, p])),
    byReal: new Map(registered.map((p, i) => [reals[i], p])),   // null: a path that opens nothing, never looked up
    // Folders the "holds repositories?" probes (describeInput) may visit, for the whole request.
    // Spent, a folder inside a repository simply stands for that repository again.
    probe: { dirs: IMPORT_SCAN_MAX_DIRS, cut: false, outside: outsideProblem },
  };
}

// fn over items, at most `limit` at a time; answers in input order.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next; next += 1; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Sources ───────────────────────────────────────────────────────────────────

async function expandCodeWorkspace(it) {
  if (it.size > CODE_WORKSPACE_MAX_BYTES) return { rows: [{ path: it.path, problem: 'Too large for a .code-workspace file' }] };
  let text;
  try { text = await readFile(it.path, 'utf8'); } catch (e) { return { rows: [{ path: it.path, problem: unreadable(e) }] }; }
  const ws = codeWorkspaceFolders(text, it.path);
  return ws.problem ? { rows: [{ path: it.path, problem: ws.problem }] } : ws;
}

// The git repositories in `dir`: each subfolder holding a `.git` (a folder, or a worktree's `.git`
// file), never descending into one, and at depth 2 the same one level further down. Hidden
// folders and node_modules are skipped; symlinked folders are followed, except one `budget.outside`
// refuses (a hosted Worca's link out of its folders: skipped unread, as the folder browser hides it);
// `budget` caps the walk (only folders count, so a file after the last allowed folder never reads as a cut).
async function reposUnder(dir, depth, budget) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const found = [];
  for (const d of entries) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    const p = join(dir, d.name);
    if (d.isSymbolicLink() && budget.outside && (await budget.outside(p))) continue;
    if (!d.isDirectory() && !(d.isSymbolicLink() && (await statOrNull(p))?.isDirectory())) continue;
    if (budget.dirs <= 0) { budget.cut = true; break; }
    budget.dirs -= 1;
    if (await statOrNull(join(p, '.git'))) found.push(p);
    else if (depth > 1) found.push(...(await reposUnder(p, depth - 1, budget)));
  }
  return found;
}

// `budget` is the request's (importCandidates): every parent folder of one request shares it (D13).
async function expandParentFolder(it, { depth, budget }) {
  // A folder that cannot be listed says so, never "no repositories in it".
  try { await readdir(it.path); } catch (e) { return { rows: [{ path: it.path, problem: unreadable(e) }] }; }
  // `budget.cut` is the request's: an earlier input may have spent the budget. This folder reads
  // "stopped early" only when ITS walk was cut (a folder with no subfolder never is).
  const cutBefore = budget.cut;
  budget.cut = false;
  const repos = await reposUnder(it.path, depth, budget);
  const cut = budget.cut;
  budget.cut = cutBefore || cut;
  if (repos.length) return { rows: repos.map((path) => ({ path })) };
  const problem = cut ? 'The search stopped early: too many folders'
    : depth > 1 ? 'Not a git repository, and none inside (two levels searched)' : 'Not a git repository, and none directly inside';
  return { rows: [{ path: it.path, problem }] };
}

/**
 * The import sources, tried in order: the first whose `match` takes an input expands it into raw
 * rows `{ name?, path, problem? }` (and may name the workspace). `it` is the described input:
 * `{ path, isFile, size }` for a file, `{ path, isDir, repo, holdsRepos }` for a folder (`repo`: the
 * git probe, null outside a repository; `holdsRepos`: a folder inside a repository, not its top,
 * with repositories of its own within the requested depth). A later source (a JetBrains project, a
 * `repo` manifest) is one more entry here; classification, merging and the review list stay as they are.
 */
export const IMPORT_SOURCES = Object.freeze([
  { id: 'code-workspace', match: (it) => !!it.isFile && CODE_WORKSPACE_RE.test(it.path), expand: expandCodeWorkspace },
  { id: 'repo', match: (it) => !!it.isDir && !!it.repo && !it.holdsRepos, expand: async (it) => ({ rows: [{ path: it.path }] }) },
  { id: 'parent-folder', match: (it) => !!it.isDir, expand: expandParentFolder },
]);

async function describeInput(path, ctx, depth) {
  let st;
  try { st = await stat(path); } catch (e) {
    return { path, problem: denied(e) ? PERMISSION_DENIED : 'Does not exist' };
  }
  if (st.isFile()) return { path, isFile: true, size: st.size };
  if (!st.isDirectory()) return { path, problem: 'Not a folder or a .code-workspace file' };
  const repo = await ctx.repo(path);
  // A folder inside a repository stands for that repository (a monorepo package, a folder of the
  // repository's own submodules), unless it is not the top folder and holds repositories of its
  // own within `depth`: a home folder kept in git, or an umbrella repository with independent
  // repositories nested inside. That one is a folder of repositories (D17).
  let holdsRepos = false;
  if (repo && (await realOrSelf(path)) !== (await realOrSelf(repo.top))) {
    for (const p of await reposUnder(path, depth, ctx.probe)) {
      const r = await ctx.repo(p);
      if (r && !r.superproject) { holdsRepos = true; break; }
    }
  }
  return { path, isDir: true, repo, holdsRepos };
}

// ── Classification ────────────────────────────────────────────────────────────

// The workspace scan's member rule (workspaces.mjs scanMemberProblems) for one folder, async: an
// existing folder that is the top of its own git repository and has a commit. → why not, or null.
async function memberProblem(dir, ctx) {
  if (!(await statOrNull(dir))?.isDirectory()) return 'does not exist';
  const repo = await ctx.repo(dir);
  if (!repo || (await realOrSelf(repo.top)) !== (await realOrSelf(dir))) return 'is not the top folder of its own git repository';
  if (!(await ctx.head(dir))) return 'has no commit yet';
  return null;
}

async function classify(row, ctx) {
  const problem = (path, text, extra = {}) => ({
    path, name: row.name || basename(path) || path, key: '', status: 'problem', problem: text, liftedFrom: [], ...extra,
  });
  if (row.problem) return problem(row.path, row.problem);
  let st;
  try { st = await stat(row.path); } catch (e) { return problem(row.path, denied(e) ? PERMISSION_DENIED : 'Does not exist'); }
  if (!st.isDirectory()) return problem(row.path, 'Not a folder');
  const repo = await ctx.repo(row.path);
  if (!repo) return problem(row.path, (await closed(row.path)) ? PERMISSION_DENIED : 'Not in a git repository');
  const real = await realOrSelf(row.path);
  const top = await realOrSelf(repo.top);   // the folder the member path below opens
  const lifted = real !== top;
  // A case-insensitive disk (macOS, Windows) opens `~/dev/API` as `~/dev/api`, but projectKey keeps
  // the typed case: a new row takes the disk's spelling, the one a picker or a folder scan gives.
  const caseOnly = real !== row.path && real.toLowerCase() === row.path.toLowerCase();
  const path = lifted ? repo.top : caseOnly ? real : row.path;
  const liftedFrom = lifted ? [row.path] : [];
  const name = lifted ? basename(path) : row.name || basename(path);
  // The submodules in one folder of a superproject share one projectKey (store.mjs canonicalProjectRoot):
  // they would merge into one row and the second would never register. Submodules come later.
  if (repo.superproject) return problem(path, `A git submodule of ${repo.superproject}: submodules cannot join a workspace yet`, { name, liftedFrom });
  const key = projectKey(path);
  // By key (a worktree or a subfolder of a registered repository), else by folder: a project stored
  // in another letter case, or through a symlink, keys apart from the folder it names.
  const reg = ctx.byKey.get(key) || ctx.byReal.get(top);
  if (reg) {
    const why = await memberProblem(reg.path, ctx);
    if (why) return problem(path, `Already the project "${reg.name}" (${reg.path}), which ${why}`, { name, liftedFrom });
    return { path: reg.path, name: reg.name, key: reg.key, status: 'registered', problem: null, liftedFrom };
  }
  const why = await memberProblem(path, ctx);
  if (why) return problem(path, why.charAt(0).toUpperCase() + why.slice(1), { name, liftedFrom });
  return { path, name, key, status: 'new', problem: null, liftedFrom };
}

// One row per repository (worktrees and subfolders of one repository share its key) and per
// problem path; the first row keeps its place and name, later ones add where they came from.
function mergeRows(rows) {
  const out = [];
  const seen = new Map();
  for (const r of rows) {
    const id = r.status === 'problem' ? `problem:${r.path}` : `key:${r.key}`;
    const prev = seen.get(id);
    if (!prev) { seen.set(id, r); out.push(r); continue; }
    for (const p of r.liftedFrom) if (!prev.liftedFrom.includes(p)) prev.liftedFrom.push(p);
  }
  return out;
}

/**
 * @param {string[]} inputs  picked or pasted paths (absolute, or starting with ~)
 * @param {{ depth?: 1|2, projects?: {key: string, name: string, path: string}[],
 *   outsideProblem?: ((path: string) => Promise<string|null>) | null }} [opts]
 *   projects: the registered projects (listProjects()), matched by key or by the folder their path opens
 *   outsideProblem: on a hosted Worca, why a path may not be read here (null when it may). Asked for
 *   each input before it is read and for each listed row before it is probed; a refused one is a
 *   problem row and nothing else about it is read.
 * @returns {Promise<{ candidates: {path: string, name: string, key: string, status: 'registered'|'new'|'problem',
 *   problem: string|null, liftedFrom: string[]}[], workspaceName: string|null, truncated: boolean }>}
 */
export async function importCandidates(inputs, { depth = 1, projects = [], outsideProblem = null } = {}) {
  const levels = depth === 2 ? 2 : 1;
  const ctx = await probeContext(projects, outsideProblem);
  const budget = { dirs: IMPORT_SCAN_MAX_DIRS, cut: false, outside: outsideProblem };   // the parent-folder scans', per request (D13)
  const raw = [];
  let workspaceName = null;
  let truncated = false;
  const list = [...new Set((Array.isArray(inputs) ? inputs : []).filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean))];
  for (const input of list) {
    // Never resolved against the server's working folder: that path means nothing to the user.
    if (!isAbsolute(input) && !HOME_PATH_RE.test(input)) { raw.push({ path: input, problem: 'Not a full path: start it with / or ~/' }); continue; }
    const path = normalizeProjectPath(input);
    const refused = outsideProblem ? await outsideProblem(path) : null;
    if (refused) { raw.push({ path, problem: refused }); continue; }
    const it = await describeInput(path, ctx, levels);
    const source = it.problem ? null : IMPORT_SOURCES.find((s) => s.match(it));
    if (!source) { raw.push({ path: it.path, problem: it.problem || 'Not a folder or a .code-workspace file' }); continue; }
    const out = await source.expand(it, { depth: levels, budget });
    if (out.workspaceName && workspaceName === null) workspaceName = out.workspaceName;
    if (out.truncated) truncated = true;
    raw.push(...out.rows);
    if (raw.length > IMPORT_MAX_CANDIDATES) break;
  }
  if (raw.length > IMPORT_MAX_CANDIDATES) { raw.length = IMPORT_MAX_CANDIDATES; truncated = true; }
  if (budget.cut) truncated = true;
  if (outsideProblem) {
    for (const r of raw) {
      if (r.problem) continue;
      const refused = await outsideProblem(r.path);
      if (refused) r.problem = refused;
    }
  }
  const rows = await mapLimit(raw, PROBE_CONCURRENCY, (r) => classify(r, ctx));
  return { candidates: mergeRows(rows), workspaceName, truncated };
}
