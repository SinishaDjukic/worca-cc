// src/core/git-info.mjs
// Read-only git facts + gh (GitHub CLI) actions that the History UI needs.
// Leaf module: depends only on node:child_process so artifacts.mjs and the UI
// server can both import it without the worktree.mjs <-> artifacts.mjs cycle.
// Every command goes through an injectable runner (_testing.setRunner) so tests
// never shell out to real git/gh/GitHub. Nothing here ever throws.

import { spawn } from 'node:child_process';

/** Default runner: spawn `cmd args` in `cwd`, resolve { ok, stdout, stderr, code }. */
function defaultRun(cmd, args, { cwd, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: err.message, code: -1 });
      return;
    }
    let stdout = '', stderr = '';
    let settled = false;
    const done = (val) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(val); };
    // `-M -l0` (unlimited rename detection) can run for minutes on a huge diff, and
    // the diff helpers sit on the Stop/error terminal path (review of PR #376) —
    // a bound keeps a stop from hanging on git. 0 = no bound (the default).
    const timer = timeout > 0
      ? setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done({ ok: false, stdout, stderr: `${cmd} timed out after ${timeout} ms`, code: -1 }); }, timeout)
      : null;
    child.stdout?.on('data', (b) => (stdout += b.toString()));
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    child.on('error', (err) => done({ ok: false, stdout, stderr: stderr || err.message, code: -1 }));
    child.on('close', (code) => done({ ok: code === 0, stdout, stderr, code: code ?? -1 }));
  });
}

/** Bound for the diff helpers below (persisted-diff generation on every terminal path). */
export const DIFF_TIMEOUT_MS = 120_000;

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
  const r = await _run('git', args, { cwd: projectDir, timeout: DIFF_TIMEOUT_MS });
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
  const r = await _run('git', args, { cwd: projectDir, timeout: DIFF_TIMEOUT_MS });
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
  const r = await _run('git', args, { cwd: projectDir, timeout: DIFF_TIMEOUT_MS });
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

/** Push the branch to `remote` (default origin) and set upstream. Idempotent; surfaces stderr. */
export async function pushBranch(projectDir, branch, remote = 'origin') {
  const r = await _run('git', ['push', '-u', remote || 'origin', branch], { cwd: projectDir });
  return { ok: r.ok, stderr: (r.stderr || '').trim() };
}

/**
 * Open a PR with `gh pr create`. `repo` ([HOST/]OWNER/REPO) targets the base
 * repository explicitly — gh's non-interactive default prefers a remote named
 * `upstream` over `origin`, so an omitted --repo can land a PR in the wrong repo.
 * `headOwner` (the push remote's owner) selects the cross-repo `owner:branch`
 * head; leave it null when the branch lives in `repo` itself — gh matches PRs by
 * head LABEL, so the form must agree with where the branch actually is.
 * On "already exists", recover the open PR's URL via `gh pr view` with the same
 * selector + repo, else from the URL gh prints on the last stderr line.
 * Returns { ok, url, existed } | { ok:false, error }.
 */
export async function createPr({ projectDir, base, head, title, body = '', repo = null, headOwner = null }) {
  const headRef = prHeadRef(head, headOwner);
  const repoArgs = repo ? ['--repo', repo] : [];
  const args = ['pr', 'create', ...repoArgs, '--base', base, '--head', headRef,
    '--title', title || head, '--body', body || title || head];
  const r = await _run('gh', args, { cwd: projectDir });
  if (r.ok) {
    // gh prints the PR URL as the last stdout line.
    const url = (r.stdout.trim().split(/\r?\n/).pop() || '').trim();
    return { ok: true, url, existed: false };
  }
  if (/already exists/i.test(r.stderr || '')) {
    const v = await _run('gh', ['pr', 'view', headRef, ...repoArgs, '--json', 'url', '-q', '.url'], { cwd: projectDir });
    if (v.ok && v.stdout.trim()) return { ok: true, url: v.stdout.trim(), existed: true };
    // gh's message ends with the existing PR's URL ("… already exists:\n<url>");
    // use it when the view selector cannot resolve (e.g. a PR opened from another fork).
    const m = /https?:\/\/\S+\/pull\/\d+/.exec(r.stderr || '');
    if (m) return { ok: true, url: m[0], existed: true };
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

/**
 * Read mergeability. A `prUrl` is repo-agnostic (a fork PR lives in the BASE
 * repo, which need not be the cwd's default) and wins; else the head selector
 * (`owner:branch` when `headOwner`) scoped by `repo`. UNKNOWN on any failure.
 */
export async function prMergeable({ projectDir, head, repo = null, headOwner = null, prUrl = null }) {
  const selector = prUrl || (head ? prHeadRef(head, headOwner) : '');
  if (!selector) return 'UNKNOWN';
  const repoArgs = !prUrl && repo ? ['--repo', repo] : [];
  const r = await _run('gh', ['pr', 'view', selector, ...repoArgs, '--json', 'mergeable', '-q', '.mergeable'], { cwd: projectDir });
  if (!r.ok) return 'UNKNOWN';
  return normalizeMergeable(r.stdout.trim());
}

const normalizePr = (pr) => ({
  state: String(pr?.state || '').toUpperCase(),
  url: String(pr?.url || ''),
  number: Number(pr?.number) || null,
});

/**
 * Look up an existing PR for `head`, so the History UI can hide the Create-PR
 * button when a PR is already open or merged. Returns { state, url, number } with
 * state ∈ { OPEN, MERGED }, or null when there is no open/merged PR / on any gh
 * failure. Never throws.
 *
 * With a persisted `prUrl` (spec: later lookups use pr_url) the PR is read
 * directly via `gh pr view <url>` — repo-agnostic, so a cross-repo PR is found
 * even though `gh pr list` in the cwd would search the wrong repository. The
 * view answers a JSON OBJECT (the list answers an array — parsed separately).
 * The branch search runs for rows with no PR yet, when gh cannot read the URL
 * (deleted PR, network, unparseable output), or when the PR behind the URL is
 * CLOSED (unmerged) — a newer PR may exist for the branch. The list keeps the
 * BARE branch: `gh pr list --head owner:branch` matches nothing. It scans the
 * matches and selects by priority OPEN > MERGED, so a newer closed PR never
 * masks an older merged one; a closed-but-not-merged PR is ignored.
 */
export async function findPrForBranch({ projectDir, head, prUrl = null } = {}) {
  if (!projectDir || !head) return null;
  if (prUrl) {
    const v = await _run('gh', ['pr', 'view', prUrl, '--json', 'number,state,url'], { cwd: projectDir });
    if (v.ok) {
      let obj = null;
      try { obj = JSON.parse(v.stdout || 'null'); } catch { obj = null; }
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.url) {
        const pr = normalizePr(obj);
        if (pr.state === 'OPEN' || pr.state === 'MERGED') return pr;
        // CLOSED: fall through to the branch search below.
      }
    }
  }
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
  const norm = arr.map(normalizePr).filter((pr) => pr.state === 'OPEN' || pr.state === 'MERGED');
  if (norm.length === 0) return null;
  // Requirement is binary: hide the button if any OPEN or MERGED PR exists. After
  // the filter, norm[0] is necessarily a MERGED entry when there is no OPEN one.
  return norm.find((p) => p.state === 'OPEN') || norm[0];
}

// ── Remotes (fork support) ──────────────────────────────────────────────────

/**
 * Parse a git remote URL into { host, owner, repo } or null when it is not a
 * hosted owner/repo URL (local paths, file://, bare hosts). Accepts
 *   https://github.com/owner/repo.git   https://user@host/owner/repo
 *   ssh://git@github.com/owner/repo.git ssh://git@host:2222/owner/repo
 *   git@github.com:owner/repo.git       (scp-style, cf. marketplaces.mjs:31)
 *   git@github.com:/owner/repo.git      host:owner/repo
 *   git://host/owner/repo.git
 * Trailing `.git` / `/` are dropped; owner/repo are the LAST two path segments.
 * Pure; never throws.
 */
export function parseRemoteUrl(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  let host = '';
  let pathPart = '';
  let m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(s);
  if (m) {
    host = m[1]; pathPart = m[2];
  } else if ((m = /^(?:([^@/\s]+)@)?([^:/\s]+):(.+)$/.exec(s))) {
    // scp-style [user@]host:path. Without a user@ prefix a leading `/` is
    // indistinguishable from a Windows drive path (C:/repos/x) → not hosted.
    if (!m[1] && m[3].startsWith('/')) return null;
    host = m[2]; pathPart = m[3];
  } else {
    return null;
  }
  const segs = pathPart.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const owner = segs[segs.length - 2];
  const repo = segs[segs.length - 1];
  if (!owner || !repo) return null;
  return { host: host.toLowerCase(), owner, repo };
}

/** gh's `[HOST/]OWNER/REPO` form for --repo; the host is omitted for github.com. */
export function remoteRepoSlug(parsed) {
  if (!parsed || !parsed.owner || !parsed.repo) return null;
  const base = `${parsed.owner}/${parsed.repo}`;
  return parsed.host && parsed.host !== 'github.com' ? `${parsed.host}/${base}` : base;
}

/** True when two parsed remotes name the same repository (GitHub is case-insensitive). */
export function sameRepo(a, b) {
  if (!a || !b || !a.owner || !b.owner || !a.repo || !b.repo) return false;
  return String(a.host || '').toLowerCase() === String(b.host || '').toLowerCase()
    && a.owner.toLowerCase() === b.owner.toLowerCase()
    && a.repo.toLowerCase() === b.repo.toLowerCase();
}

/** gh's PR selector for a head branch: `owner:branch` for a cross-repo head, else bare. */
export function prHeadRef(head, headOwner) {
  return headOwner ? `${headOwner}:${head}` : head;
}

/**
 * The repo's git remotes from `git remote -v`, in git's (alphabetical) order.
 * Each entry is { name, fetchUrl, pushUrl, host, owner, repo, slug } with
 * host/owner/repo/slug null when the URL is not a hosted owner/repo URL. The
 * push URL is what the branch lands on, so it is parsed first; the fetch URL is
 * the fallback. Never throws: { ok:true, remotes } | { ok:false, remotes:[], error }.
 * Lives here (not in worktree.mjs) so it shares the `_run` seam the tests stub.
 */
export async function listRemotes(projectDir) {
  if (!projectDir) return { ok: false, remotes: [], error: 'projectDir is required' };
  const r = await _run('git', ['remote', '-v'], { cwd: projectDir });
  if (!r.ok) return { ok: false, remotes: [], error: (r.stderr || '').trim() || `git exited ${r.code}` };
  const byName = new Map();
  for (const raw of (r.stdout || '').split(/\r?\n/)) {
    const m = /^(\S+)\t(.+?)\s+\((fetch|push)\)$/.exec(raw.trim());
    if (!m) continue;
    const [, name, url, kind] = m;
    const e = byName.get(name) || { name, fetchUrl: null, pushUrl: null };
    if (kind === 'fetch') e.fetchUrl = url; else e.pushUrl = url;
    byName.set(name, e);
  }
  const remotes = [...byName.values()].map((e) => {
    const parsed = parseRemoteUrl(e.pushUrl || e.fetchUrl);
    return {
      ...e,
      host: parsed?.host ?? null, owner: parsed?.owner ?? null, repo: parsed?.repo ?? null,
      slug: remoteRepoSlug(parsed),
    };
  });
  return { ok: true, remotes };
}

// Test seam: swap the command runner + clear the gh memo. Mirrors server.mjs#_testing.
export const _testing = {
  defaultRun,
  setRunner(fn) { _run = typeof fn === 'function' ? fn : defaultRun; _ghCache = null; },
  reset() { _run = defaultRun; _ghCache = null; },
};
