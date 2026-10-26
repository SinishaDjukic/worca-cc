// src/core/secret-paths.mjs
// The one owner of "which project files hold secrets" (plans/core-protection-layer-design.md §4.6). Guardrails
// (NORMAL_PROTECTED), chat's show-files (CREDENTIAL_NAMES), diff anchors and the sandbox upload overlay all build
// their lists from DEFAULT_SECRET_PATHS, plus the project's `secretPaths` setting where a project is known. Each of
// those modules keeps its own extra entries on top. No worca imports (node built-ins only): ask/tools.mjs re-exports
// the matcher and must stay cycle-free.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** File patterns every surface treats as secret. Slash-less patterns match the basename at any depth. */
export const DEFAULT_SECRET_PATHS = Object.freeze(['.env*', '*.pem', '*.key', '.npmrc', '.netrc', 'id_*']);

/** `git log` arguments (then a ref, or --all) listing every path ever added in that history, one per NUL: a secret
 *  committed once and deleted later is still in every older commit a clone or bundle carries (audit 2.9). No renames,
 *  so a renamed file shows under its new name too. */
export const HISTORY_ADDED_ARGS = Object.freeze(['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-filter=A']);
/** What a run log says to do about a secret in git history: deleting it in a new commit keeps it in the older ones. */
export const HISTORY_REMEDY = 'Deleting a file in a new commit keeps it in the older ones: rewrite the history (for example with git filter-repo) and rotate the secret.';

const MAX_ENTRIES = 200;
const MAX_LEN = 256;
/** A pattern isSecretPath can never match: absolute (`~/`, `/`), `./` (paths come without it), a folder (`dir/`: use
 *  `dir/**`), a backslash (paths are POSIX). */
const NEVER_MATCHES = (p) => /^(~\/|\/|\.\/)/.test(p) || p.endsWith('/') || p.includes('\\');
/** A valid `secretPaths` setting: a list of non-blank single-line project-relative file patterns, each one that can
 *  match a project file. */
export function isSecretPathList(value) {
  return Array.isArray(value) && value.length <= MAX_ENTRIES
    && value.every((p) => typeof p === 'string' && p.trim() && p.length <= MAX_LEN && !/[\n\r\0]/.test(p) && !NEVER_MATCHES(p.trim()));
}

/** The defaults plus the project's own additions (`project.secretPaths`, the resolved setting), de-duplicated. */
export function secretPathsFor(project) {
  const own = isSecretPathList(project?.secretPaths) ? project.secretPaths.map((p) => p.trim()) : [];
  return [...new Set([...DEFAULT_SECRET_PATHS, ...own])];
}

const globCache = new Map();
/** A guardrails.mjs pattern -> its steps: a leading double-star + slash = any dirs (`dirs`, then `dirsIn` once a
 *  character is read), double-star = anything (`any`), one star = within one segment (`seg`), else a literal. */
function globSteps(pattern) {
  let steps = globCache.get(pattern);
  if (steps) return steps;
  steps = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c !== '*') { steps.push({ kind: 'lit', c }); continue; }
    if (pattern[i + 1] !== '*') { steps.push({ kind: 'seg' }); continue; }
    if (pattern[i + 2] === '/') { steps.push({ kind: 'dirs' }, { kind: 'dirsIn' }); i += 2; } else { steps.push({ kind: 'any' }); i += 1; }
  }
  globCache.set(pattern, steps);
  return steps;
}

/** Does `s` match the whole of `steps`? A set-of-states walk, so the time is length x steps whatever the pattern
 *  (a backtracking regex goes exponential on many stars, and `secretPaths` patterns are the user's). */
function globMatch(steps, s) {
  const m = steps.length;
  const add = (set, j) => {
    while (j <= m && !set[j]) {
      set[j] = 1;
      const k = steps[j]?.kind;
      if (k === 'seg' || k === 'any') j += 1; else if (k === 'dirs') j += 2; else break;
    }
  };
  let cur = new Uint8Array(m + 1); let next = new Uint8Array(m + 1);
  add(cur, 0);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    next.fill(0);
    let live = false;
    for (let j = 0; j < m; j++) {
      if (!cur[j]) continue;
      const st = steps[j];
      live = true;
      if (st.kind === 'lit') { if (ch === st.c) add(next, j + 1); }
      else if (st.kind === 'seg') { if (ch !== '/') add(next, j); }
      else if (st.kind === 'any') add(next, j);
      else if (st.kind === 'dirs') { add(next, j + 1); if (ch === '/') add(next, j + 2); }
      else { add(next, j); if (ch === '/') add(next, j + 1); }   // dirsIn
    }
    if (!live) return false;
    [cur, next] = [next, cur];
  }
  return cur[m] === 1;
}

/**
 * Does the repo-relative POSIX path `rel` match one of `patterns`? The CLI semantics guardrails.mjs documents:
 * slash-LESS patterns (`*x*`, `*x`, `x*`, `x`) match the basename at any depth; slash-containing ones match the whole
 * path. `~/…` and `//…` are absolute and can never name a file inside a project, so they are skipped rather than
 * silently mis-matched. Case-insensitive: `.ENV` or `Server.PEM` names the same file as `.env` on macOS and Windows.
 */
export function isSecretPath(rel, patterns = DEFAULT_SECRET_PATHS) {
  const full = String(rel ?? '').replace(/^\.\//, '').toLowerCase();
  const base = full.slice(full.lastIndexOf('/') + 1);
  for (const p of patterns) {
    if (typeof p !== 'string' || !p || p.startsWith('~/') || p.startsWith('//')) continue;
    if (globMatch(globSteps(p.toLowerCase()), p.includes('/') ? full : base)) return true;
  }
  return false;
}

// Never walked: git's own store, and installed packages (their test keys are not the project's secrets).
const SKIP_DIRS = new Set(['.git', 'node_modules']);
/** The project-relative paths that exist under `projectDir` and match `patterns`, sorted: what a container backend
 *  covers with an empty read-only file. Symbolic links are listed by their own path and never followed. */
export async function maskPlan(projectDir, patterns = DEFAULT_SECRET_PATHS) {
  const out = [];
  const walk = async (dir, rel) => {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), r); continue; }
      if (isSecretPath(r, patterns)) out.push(r);
    }
  };
  try { if (!(await lstat(projectDir)).isDirectory()) return []; } catch { return []; }
  await walk(projectDir, '');
  return out.sort();
}
