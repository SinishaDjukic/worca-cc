// src/core/git-info.mjs
// Read-only git facts + gh (GitHub CLI) actions that the History UI needs.
// Leaf module: depends only on node:child_process so artifacts.mjs and the UI
// server can both import it without the worktree.mjs <-> artifacts.mjs cycle.
// Every command goes through an injectable runner (_testing.setRunner) so tests
// never shell out to real git/gh/GitHub. Nothing here ever throws.

import { spawn } from 'node:child_process';

/** Default runner: spawn `cmd args` in `cwd`, resolve { ok, stdout, stderr, code }. */
function defaultRun(cmd, args, { cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: err.message, code: -1 });
      return;
    }
    let stdout = '', stderr = '';
    child.stdout?.on('data', (b) => (stdout += b.toString()));
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    child.on('error', (err) => resolve({ ok: false, stdout, stderr: stderr || err.message, code: -1 }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr, code: code ?? -1 }));
  });
}

let _run = defaultRun;
let _ghCache = null;

/** Parse `git diff --shortstat` output into { added, removed }. */
export function parseShortstat(out) {
  const ins = /(\d+)\s+insertion/.exec(String(out || ''));
  const del = /(\d+)\s+deletion/.exec(String(out || ''));
  return { added: ins ? Number(ins[1]) : 0, removed: del ? Number(del[1]) : 0 };
}

/** Added/removed line counts for source...feature (merge-base/3-dot). 0/0 on any failure. */
export async function diffShortstat(projectDir, source, feature) {
  if (!projectDir || !source || !feature) return { added: 0, removed: 0 };
  const r = await _run('git', ['diff', '--shortstat', `${source}...${feature}`], { cwd: projectDir });
  if (!r.ok) return { added: 0, removed: 0 };
  return parseShortstat(r.stdout);
}

/**
 * Parse `git diff --name-status -M` rows. `head` omitted -> diff base vs working tree.
 * Rename/copy rows look like `R100\told\tnew`; status letter is the first char.
 * `pathspecs` (optional) are appended AFTER the bare '--' so callers can restrict
 * or, more usefully, EXCLUDE paths (`:(exclude)<path>` — exclude-only pathspecs are
 * valid git). Passing nothing yields the byte-identical argv of before (§8.8).
 * `core.quotePath=false` matches diffPatch below, so results.json and the persisted
 * patch name a non-ASCII file the same way instead of `"cl\303\251.pem"` vs `clé.pem`.
 * `-l0` matches it for the same reason: `diff.renameLimit` would otherwise decide
 * per command whether a rename is one `R` row or a `D` plus an `A`.
 * @returns {Promise<Array<{status:string, path:string, from?:string}>>}
 */
export async function diffNameStatus(projectDir, base, head, pathspecs = []) {
  if (!projectDir || !base) return [];
  const args = ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', '-l0', base, ...(head ? [head] : []), '--', ...pathspecs];
  const r = await _run('git', args, { cwd: projectDir });
  if (!r.ok) return [];
  const out = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0][0]; // R100 -> R, C75 -> C
    if (status === 'R' || status === 'C') {
      out.push({ status, from: parts[1], path: parts[2] });
    } else {
      out.push({ status, path: parts[1] });
    }
  }
  return out;
}

/**
 * Parse `git diff --numstat -M` into a Map keyed by path. Binary files report
 * `-`/`-` and are flagged `binary:true` with zero counts. `pathspecs` (optional)
 * are appended AFTER the bare '--' — see diffNameStatus, whose `core.quotePath=false`
 * and `-l0` this shares so the Map keys match the name-status paths.
 * @returns {Promise<Map<string,{added:number, removed:number, binary:boolean}>>}
 */
export async function diffNumstat(projectDir, base, head, pathspecs = []) {
  const m = new Map();
  if (!projectDir || !base) return m;
  const args = ['-c', 'core.quotePath=false', 'diff', '--numstat', '-M', '-l0', base, ...(head ? [head] : []), '--', ...pathspecs];
  const r = await _run('git', args, { cwd: projectDir });
  if (!r.ok) return m;
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split('\t');
    const path = rest[rest.length - 1]; // for renames the last col is the new path
    const binary = a === '-' || d === '-';
    m.set(path, { added: binary ? 0 : Number(a) || 0, removed: binary ? 0 : Number(d) || 0, binary });
  }
  return m;
}

/**
 * Full unified diff (`git diff -M base [head]`). Empty string on failure.
 * `pathspecs` (optional) are appended AFTER the bare '--' — see diffNameStatus.
 * `core.quotePath=false` keeps non-ASCII paths literal instead of C-quoted, so
 * every `diff --git a/X b/X` parser downstream sees the real path. The prefixes
 * themselves are a SETTING, not a constant — `diff.noprefix`,
 * `diff.mnemonicPrefix` (`c/` … `w/`) and `diff.srcPrefix`/`diff.dstPrefix` come
 * from the user's own ~/.gitconfig and apply to every worktree — and
 * `diff.external`/`GIT_EXTERNAL_DIFF` replaces the patch wholesale, emitting no
 * `diff --git` line at all. Pin all four so the header shape those parsers
 * (ask/tools.mjs, ui/public/diff-view.mjs) rely on is ours, not the user's.
 * `color.diff`/`color.ui = always` is the same class of setting — it wraps every
 * header in SGR escapes, which no parser here strips — so `--no-color` is pinned too.
 * `diff.submodule = diff` is the same class one level down: git spawns an INNER
 * `git diff` inside the submodule and propagates none of these pins into it, so an
 * external diff tool (config or GIT_EXTERNAL_DIFF) makes the inner patch header-less
 * and it rides inside the section before it. `--submodule=short` keeps a submodule
 * as one `Subproject commit` hunk under its own path — the name the two row parsers
 * above already use.
 * `diff.renameLimit` decides whether git PAIRS a rename+edit at all: below it a
 * rename out of a credential file arrives as delete + add, and the add's `+` lines
 * are the old file's content under the new, harmless name. `-l0` pins the unlimited
 * detection the old-path filter in ask/tools.mjs depends on.
 * @returns {Promise<string>}
 */
export async function diffPatch(projectDir, base, head, pathspecs = []) {
  if (!projectDir || !base) return '';
  const args = ['-c', 'core.quotePath=false', 'diff', '-M', '-l0', '--no-color', '--no-ext-diff', '--submodule=short',
    '--src-prefix=a/', '--dst-prefix=b/',
    base, ...(head ? [head] : []), '--', ...pathspecs];
  const r = await _run('git', args, { cwd: projectDir });
  return r.ok ? r.stdout : '';
}

/** True iff `branch` exists locally in `projectDir`. False on a missing repo/branch. */
export async function branchExists(projectDir, branch) {
  if (!projectDir || !branch) return false;
  const r = await _run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: projectDir });
  return r.ok && !!r.stdout.trim();
}

/** True iff the GitHub CLI is on PATH. Memoized (reset via _testing.reset()). */
export async function hasGh() {
  if (_ghCache !== null) return _ghCache;
  const r = await _run('gh', ['--version']);
  _ghCache = r.ok;
  return _ghCache;
}

/** Push the branch and set upstream. Idempotent; surfaces stderr on failure. */
export async function pushBranch(projectDir, branch) {
  const r = await _run('git', ['push', '-u', 'origin', branch], { cwd: projectDir });
  return { ok: r.ok, stderr: (r.stderr || '').trim() };
}

/**
 * Open a PR with `gh pr create`. On "already exists", recover the open PR's URL
 * via `gh pr view` so the button is still useful. Returns { ok, url, existed } |
 * { ok:false, error }.
 */
export async function createPr({ projectDir, base, head, title, body = '' }) {
  const args = ['pr', 'create', '--base', base, '--head', head, '--title', title || head, '--body', body || title || head];
  const r = await _run('gh', args, { cwd: projectDir });
  if (r.ok) {
    // gh prints the PR URL as the last stdout line.
    const url = (r.stdout.trim().split(/\r?\n/).pop() || '').trim();
    return { ok: true, url, existed: false };
  }
  if (/already exists/i.test(r.stderr || '')) {
    const v = await _run('gh', ['pr', 'view', head, '--json', 'url', '-q', '.url'], { cwd: projectDir });
    if (v.ok && v.stdout.trim()) return { ok: true, url: v.stdout.trim(), existed: true };
  }
  return { ok: false, error: (r.stderr || '').trim() || `gh exited ${r.code}` };
}

/** Normalize gh's `mergeable` / `mergeStateStatus` to MERGEABLE | CONFLICTING | UNKNOWN. */
export function normalizeMergeable(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'MERGEABLE' || s === 'CLEAN') return 'MERGEABLE';
  if (s === 'CONFLICTING' || s === 'DIRTY') return 'CONFLICTING';
  return 'UNKNOWN';
}

/** Read mergeability for the PR whose head is `head`. UNKNOWN on any failure. */
export async function prMergeable({ projectDir, head }) {
  const r = await _run('gh', ['pr', 'view', head, '--json', 'mergeable', '-q', '.mergeable'], { cwd: projectDir });
  if (!r.ok) return 'UNKNOWN';
  return normalizeMergeable(r.stdout.trim());
}

/**
 * Look up an existing PR for `head` via `gh pr list`, so the History UI can hide
 * the Create-PR button when a PR is already open or merged. Scans the matches and
 * selects by priority OPEN > MERGED, so a newer closed PR never masks an older
 * merged one; a closed-but-not-merged PR is ignored (treated as "no active PR").
 * Returns { state, url, number } with state ∈ { OPEN, MERGED }, or null when there
 * is no open/merged PR / on any gh failure. Never throws.
 */
export async function findPrForBranch({ projectDir, head } = {}) {
  if (!projectDir || !head) return null;
  const r = await _run(
    'gh',
    ['pr', 'list', '--head', head, '--state', 'all', '--json', 'number,state,url', '--limit', '30'],
    { cwd: projectDir },
  );
  if (!r.ok) return null;
  let arr;
  try { arr = JSON.parse(r.stdout || '[]'); } catch { return null; }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // Keep only the states the UI acts on; closed/declined PRs are deliberately dropped.
  const norm = arr
    .map((pr) => ({
      state: String(pr?.state || '').toUpperCase(),
      url: String(pr?.url || ''),
      number: Number(pr?.number) || null,
    }))
    .filter((pr) => pr.state === 'OPEN' || pr.state === 'MERGED');
  if (norm.length === 0) return null;
  // Requirement is binary: hide the button if any OPEN or MERGED PR exists. After
  // the filter, norm[0] is necessarily a MERGED entry when there is no OPEN one.
  return norm.find((p) => p.state === 'OPEN') || norm[0];
}

// Test seam: swap the command runner + clear the gh memo. Mirrors server.mjs#_testing.
export const _testing = {
  setRunner(fn) { _run = typeof fn === 'function' ? fn : defaultRun; _ghCache = null; },
  reset() { _run = defaultRun; _ghCache = null; },
};
