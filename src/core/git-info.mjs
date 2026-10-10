// src/core/git-info.mjs
// Read-only git facts + gh (GitHub CLI) actions that the History UI needs.
// Leaf module: depends only on node:child_process so artifacts.mjs and the UI
// server can both import it without the worktree.mjs <-> artifacts.mjs cycle.
// Every command goes through an injectable runner (_testing.setRunner) so tests
// never shell out to real git/gh/GitHub. Nothing here ever throws.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { githubEnv } from './github-credentials.mjs';
import { gitEnvFor, githubOnlyEnv, hostLookupNeeded, stripHostCredentials } from './host-credentials.mjs';
import { parseRemoteUrl, parseGithubPrUrl, remoteRepoSlug, forgeOf, forgeOfPrUrl, FORGE_LABEL } from './forge.mjs';
import { redactSecrets } from './redact.mjs';
import * as azurePr from './pr/azure.mjs';
import { readAzureCredentials } from './azure-credentials.mjs';
import { parseAzurePrUrl } from '../shared/azure-remote.mjs';
export { parseRemoteUrl, remoteRepoSlug, sameRepo } from './forge.mjs';

/** Default runner: spawn `cmd args` in `cwd`, resolve { ok, stdout, stderr, code }. */
function defaultRun(cmd, args, { cwd, timeout = 0, env = null } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
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

/** Commits on `feature` not on `source` (`git rev-list --count source..feature`), or null on any failure. */
export async function commitsAhead(projectDir, source, feature) {
  if (!projectDir || !source || !feature) return null;
  const r = await _run('git', ['rev-list', '--count', `${source}..${feature}`], { cwd: projectDir });
  if (!r.ok) return null;
  const n = Number.parseInt(String(r.stdout || '').trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
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

/**
 * Files git does not track yet and does not ignore (`ls-files --others --exclude-standard`).
 * A LIVE run has not staged anything with `add -N`, so `git diff <base>` cannot see a file an
 * agent created; the live diff lists these separately. Read-only: never touches the index.
 * @returns {Promise<string[]>}
 */
export async function untrackedFiles(projectDir, pathspecs = []) {
  if (!projectDir) return [];
  const args = ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...pathspecs];
  const r = await _run('git', args, { cwd: projectDir, timeout: DIFF_TIMEOUT_MS });
  if (!r.ok) return [];
  return r.stdout.split('\0').filter(Boolean);
}

/**
 * The creation patch of one untracked file (`git diff --no-index /dev/null <path>`), with the
 * same pinned header shape as diffPatch. `--no-index` exits 1 when the files differ, which is
 * the success case here, so the exit code is ignored and stdout decides.
 * @returns {Promise<{patch:string, added:number, binary:boolean}>}
 */
export async function untrackedPatch(projectDir, relPath) {
  const args = ['-c', 'core.quotePath=false', 'diff', '--no-index', '--no-color', '--no-ext-diff',
    '--src-prefix=a/', '--dst-prefix=b/', '--', '/dev/null', relPath];
  const r = await _run('git', args, { cwd: projectDir, timeout: DIFF_TIMEOUT_MS });
  const patch = r.code === 0 || r.code === 1 ? r.stdout : '';
  const binary = /^Binary files /m.test(patch);
  let added = 0;
  if (!binary) for (const line of patch.split('\n')) if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
  return { patch, added, binary };
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

/**
 * The write env for a push to `remote`. The host matters only in GitHub App mode, with an Azure DevOps
 * credential, or with push-as-person (hostLookupNeeded); then the push URL picks the credential
 * (gitEnvFor). Otherwise — and for a URL that does not parse, e.g. a local path — the host-blind
 * GitHub env, exactly as before (minus the strip-only Boards token), with no extra git call.
 */
async function pushEnv(projectDir, remote) {
  if (!hostLookupNeeded({ push: true })) return githubOnlyEnv('write', { repo: null });
  const u = await _run('git', ['remote', 'get-url', '--push', remote], { cwd: projectDir, env: stripHostCredentials(process.env) });
  const url = u.ok ? String(u.stdout || '').trim().split(/\r?\n/)[0] : '';
  return parseRemoteUrl(url) ? gitEnvFor('write', url) : githubOnlyEnv('write', { repo: null });
}

/** "owner/name" of a github.com PR URL, or null. */
const ownerRepoOfPrUrl = (url) => { const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(String(url || '')); return m ? m[1] : null; };

/** "owner/name" from gh's `[HOST/]OWNER/REPO`, or null. */
const ownerRepo = (repo) => (repo ? String(repo).split('/').slice(-2).join('/') : null);

/**
 * The remote could not read the pack we sent ("remote: error: inflate: data stream error",
 * "pack has bad object at offset N", "unpack failed: index-pack failed"). git streams stored
 * objects to a remote without re-checking them, so this surfaces only there. Seen once on a
 * hosted worca (a blob:none partial clone, 2026-09-27) while other git writers were busy in
 * the same object store — a background `gc --auto` repacking ~12,500 loose objects and the
 * team-metrics flush; the same push rebuilt afterwards was clean. Pure.
 */
export function isRemotePackFailure(stderr) {
  return /unpack failed|index-pack (?:failed|abnormal exit)|pack has bad object|inflate: data stream error|bad pack header|unpacker error|did not receive expected object/i.test(String(stderr || ''));
}

/** A `git gc` running in this repository right now (its gc.pid names a live process here). */
async function gcRunning(projectDir) {
  const r = await _run('git', ['rev-parse', '--git-common-dir'], { cwd: projectDir });
  if (!r.ok) return false;
  const common = r.stdout.trim();
  let text;
  try { text = await readFile(join(isAbsolute(common) ? common : join(projectDir, common), 'gc.pid'), 'utf8'); } catch { return false; }
  const pid = Number.parseInt(String(text).trim().split(/\s+/)[0], 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/** Wait (up to `maxMs`) for a running `git gc` in the repository to finish. */
async function waitForGc(projectDir, { maxMs = 120_000, stepMs = 2_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const until = Date.now() + maxMs;
  while (Date.now() < until && await gcRunning(projectDir)) await sleep(stepMs);
}

/**
 * Push the branch to `remote` (default origin) and set upstream. Idempotent; surfaces stderr.
 * A pack the remote could not read (isRemotePackFailure) is pushed once more, after any running
 * `git gc` in the repository finished, as a self-contained pack (--no-thin: no delta against
 * objects the remote has, which a partial clone may not hold).
 */
export async function pushBranch(projectDir, branch, remote = 'origin', { gcWait = {} } = {}) {
  const r0 = remote || 'origin';
  const cred = await pushEnv(projectDir, r0);
  if (cred.error) return { ok: false, stderr: cred.error };
  const r = await _run('git', ['push', '-u', r0, branch], { cwd: projectDir, env: cred.env });
  if (r.ok || !isRemotePackFailure(r.stderr)) return { ok: r.ok, stderr: (r.stderr || '').trim() };
  await waitForGc(projectDir, gcWait);
  const again = await _run('git', ['push', '--no-thin', '-u', r0, branch], { cwd: projectDir, env: cred.env });
  if (again.ok) return { ok: true, stderr: (again.stderr || '').trim(), retried: true };
  return {
    ok: false,
    retried: true,
    stderr: `${(again.stderr || '').trim()}\n(the remote could not read the pack git sent, twice — a second push waited for ` +
      'any running git gc and sent a self-contained pack. Check the local repository with `git fsck --full`.)',
  };
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
 * `draft` adds `--draft` (a new PR only; an existing one is recovered as-is).
 * Returns { ok, url, existed } | { ok:false, error }.
 */
async function ghCreatePr({ projectDir, base, head, title, body = '', repo = null, headOwner = null, draft = false }) {
  const headRef = prHeadRef(head, headOwner);
  const repoArgs = repo ? ['--repo', repo] : [];
  const args = ['pr', 'create', ...repoArgs, '--base', base, '--head', headRef,
    '--title', title || head, '--body', body || title || head, ...(draft === true ? ['--draft'] : [])];
  const cred = await githubEnv('write', { repo: ownerRepo(repo) });
  if (cred.error) return { ok: false, error: cred.error };
  const r = await _run('gh', args, { cwd: projectDir, env: cred.env });
  if (r.ok) {
    // gh prints the PR URL as the last stdout line.
    const url = (r.stdout.trim().split(/\r?\n/).pop() || '').trim();
    return { ok: true, url, existed: false };
  }
  if (/already exists/i.test(r.stderr || '')) {
    const v = await _run('gh', ['pr', 'view', headRef, ...repoArgs, '--json', 'url', '-q', '.url'], { cwd: projectDir, env: (await githubEnv('read', { repo: ownerRepo(repo) })).env });
    if (v.ok && v.stdout.trim()) return { ok: true, url: v.stdout.trim(), existed: true };
    // gh's message ends with the existing PR's URL ("… already exists:\n<url>");
    // use it when the view selector cannot resolve (e.g. a PR opened from another fork).
    const m = /https?:\/\/\S+\/pull\/\d+/.exec(r.stderr || '');
    if (m) return { ok: true, url: m[0], existed: true };
  }
  return { ok: false, error: (r.stderr || '').trim() || `gh exited ${r.code}` };
}

// ── Closing the source issue from a PR body ──────────────────────────────────
// A run whose task came from a GitHub issue (plugins/github-source stores its
// html_url in pipelines.source_ref) ships with a closing keyword so merging the
// PR closes the issue. Only issue URLs count: the issues API also returns PRs.

const ISSUE_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/([1-9]\d*)\/?(?:[?#].*)?$/i;

/** { owner, repo, number } of a github.com issue URL (never a PR URL), else null. Pure. */
export function parseGithubIssueUrl(url) {
  if (typeof url !== 'string') return null;
  const m = ISSUE_URL_RE.exec(url.trim());
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

const CLOSING_KEYWORD = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The line that closes the run's source issue from the PR body, or '' when none
 * should be added: no/non-issue `sourceUrl`, or `body` already closes that issue
 * with a GitHub closing keyword (by owner/repo#N, the full URL, or — only when the
 * issue lives in `baseRepo` — #N). `baseRepo` is the PR's OWNER/REPO (case-insensitive);
 * the same repo gives `Closes #N`, any other (or null) `Closes owner/repo#N`. Pure.
 */
export function issueClosingLine({ sourceUrl, baseRepo = null, body = '' } = {}) {
  const issue = parseGithubIssueUrl(sourceUrl);
  if (!issue) return '';
  const slug = `${issue.owner}/${issue.repo}`;
  const inBase = typeof baseRepo === 'string' && baseRepo.toLowerCase() === slug.toLowerCase();
  const n = issue.number;
  const refs = [`${escapeRe(slug)}#${n}`, `https://github\\.com/${escapeRe(slug)}/issues/${n}`];
  if (inBase) refs.push(`#${n}`);
  const already = new RegExp(`(?<![\\w-])${CLOSING_KEYWORD}:?\\s+(?:${refs.join('|')})(?!\\d)`, 'i');
  if (already.test(String(body ?? ''))) return '';
  return inBase ? `Closes #${n}` : `Closes ${slug}#${n}`;
}

// ── gh issue create ───────────────────────────────────────────────────────────
// The run reporter's one write to GitHub. The body is a whole JSON report (40 KB on
// the largest run measured), so it rides a FILE: --body argv would be at the mercy of
// the platform's argument limit, and every backtick and newline in it would depend on
// spawn's quoting. --body-file has neither problem and is byte-exact.

/** Applied to every filed report. `bug` exists upstream; `ai` marks the filer. */
export const ISSUE_LABELS = Object.freeze(['bug', 'ai']);

// gh resolves label NAMES through the API and fails the whole create when one is
// missing — and a reporter with no triage permission on the target repo cannot add
// labels at all. Both read like this, and both are recoverable by dropping them.
const LABEL_REJECTED = /could not add label|label .*not found|must have (?:admin|push|triage)/i;

/** gh's own failures, split so the UI can say something actionable. */
function ghFailureKind(stderr) {
  const s = String(stderr || '');
  if (/gh auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(s)) return 'auth';
  return 'failed';
}

/**
 * Open a GitHub issue with `gh issue create`. `repo` (OWNER/REPO) is REQUIRED and
 * always explicit: gh would otherwise resolve the target from the cwd's remotes and
 * file a worca bug report in whatever repository the user happens to be standing in.
 *
 * Labels are best effort — on a label rejection the issue is filed again without
 * them rather than lost. Any OTHER failure is returned as-is and never retried: a
 * retried create that actually succeeded the first time files the report twice.
 *
 * @returns {{ok:true, url:string, labeled:boolean} | {ok:false, kind:'no-repo'|'no-gh'|'auth'|'failed', error:string}}
 */
export async function createIssue({ repo, title, body = '', labels = ISSUE_LABELS }) {
  if (!repo) return { ok: false, kind: 'no-repo', error: 'no GitHub repository is configured' };
  if (!(await hasGh())) {
    return { ok: false, kind: 'no-gh', error: 'the GitHub CLI (gh) is not installed' };
  }

  let dir = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'worca-issue-'));
    const file = join(dir, 'body.md');
    await writeFile(file, String(body), 'utf8');

    const base = ['issue', 'create', '--repo', repo, '--title', title || 'Run report',
      '--body-file', file];
    const withLabels = [...base, ...labels.flatMap((l) => ['--label', l])];

    let labeled = labels.length > 0;
    let r = labeled ? await _run('gh', withLabels) : await _run('gh', base);
    if (!r.ok && labeled && LABEL_REJECTED.test(r.stderr || '')) {
      labeled = false;
      r = await _run('gh', base);
    }
    if (r.ok) {
      // gh prints the issue URL as the last stdout line, after its progress chatter.
      const url = ((r.stdout || '').trim().split(/\r?\n/).pop() || '').trim();
      return { ok: true, url, labeled };
    }
    return { ok: false, kind: ghFailureKind(r.stderr),
             error: (r.stderr || '').trim() || `gh exited ${r.code}` };
  } catch (err) {
    // mkdtemp/writeFile only: a read-only temp dir must not throw through the route.
    return { ok: false, kind: 'failed', error: err && err.message ? err.message : String(err) };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
async function ghPrMergeable({ projectDir, head, repo = null, headOwner = null, prUrl = null }) {
  const selector = prUrl || (head ? prHeadRef(head, headOwner) : '');
  if (!selector) return 'UNKNOWN';
  const repoArgs = !prUrl && repo ? ['--repo', repo] : [];
  const r = await _run('gh', ['pr', 'view', selector, ...repoArgs, '--json', 'mergeable', '-q', '.mergeable'], { cwd: projectDir, env: (await githubEnv('read', { repo: prUrl ? ownerRepoOfPrUrl(prUrl) : ownerRepo(repo) })).env });
  if (!r.ok) return 'UNKNOWN';
  return normalizeMergeable(r.stdout.trim());
}

const CHECK_FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

/**
 * Fold gh's `statusCheckRollup` (CheckRun and StatusContext items) into one PR-level answer:
 * `failing` when any check failed, else `pending` while any still runs, else `passing`;
 * `none` when the PR has no checks that ran. Skipped checks are counted apart (`skipped`, not in
 * `total`), as GitHub lists them; neutral and stale checks count as passed. A failed check whose name
 * also fails on the base branch head (`baseFailing`) is not the PR's: it counts as `inherited`, not `failed`.
 */
export function rollupChecks(items, { baseFailing = [] } = {}) {
  const out = { state: 'none', total: 0, failed: 0, pending: 0, skipped: 0, inherited: 0 };
  const inherited = new Set(baseFailing);
  for (const c of Array.isArray(items) ? items : []) {
    const status = c?.__typename === 'StatusContext'
      ? String(c.state || '').toUpperCase()                     // SUCCESS | PENDING | EXPECTED | FAILURE | ERROR
      : String(c?.status || '').toUpperCase() === 'COMPLETED' ? String(c.conclusion || '').toUpperCase() : 'PENDING';
    if (status === 'SKIPPED') { out.skipped += 1; continue; }
    out.total += 1;
    if (CHECK_FAILED.has(status)) out[inherited.has(c.name || c.context) ? 'inherited' : 'failed'] += 1;
    else if (status === 'PENDING' || status === 'EXPECTED') out.pending += 1;
  }
  if (out.failed) out.state = 'failing';
  else if (out.pending) out.state = 'pending';
  else if (out.total) out.state = 'passing';
  return out;
}

const checksLabel = (c, base) => {
  const n = c.inherited || 0;
  const main = c.state === 'failing' ? `${c.failed} of ${c.total} check${c.total === 1 ? '' : 's'} failed`
    : c.state === 'pending' ? `Checks running · ${c.total - c.pending} of ${c.total} done`
      : c.state === 'passing' ? (n ? `${c.total - n} of ${c.total} checks passed` : c.total === 1 ? 'Check passed' : `All ${c.total} checks passed`) : '';
  const withSkipped = main && c.skipped ? `${main}, ${c.skipped} skipped` : main;
  return withSkipped && n ? `${withSkipped} · ${n} also failing on ${base || 'the base branch'}` : withSkipped;
};

/**
 * The PR's one-line verdict, in the order GitHub's merge box weighs it: draft, conflicts, changes
 * requested, failing or running checks, review required, behind the base, blocked by branch rules,
 * then ready to merge. `detail` is the checks line when the verdict is about something else; `base`
 * names the base branch in it ("· 2 also failing on dev").
 * tone: ok | run (checks running) | wait (on a person or the base) | bad | none. GitHub computes mergeStateStatus lazily; UNKNOWN falls back to the checks.
 */
export function prMergeStatus({ checks, mergeable, mergeState, reviewDecision, draft, base } = {}) {
  const c = checks || { state: 'none', total: 0, failed: 0, pending: 0 };
  const state = String(mergeState || '').toUpperCase();
  const review = String(reviewDecision || '').toUpperCase();
  const detail = checksLabel(c, base);
  const say = (tone, label, withChecks = true) => ({ tone, label, detail: withChecks ? detail : '' });
  if (draft) return say('none', 'Draft');
  if (mergeable === 'CONFLICTING' || state === 'DIRTY') return say('bad', 'Merge conflicts');
  if (review === 'CHANGES_REQUESTED') return say('bad', 'Changes requested');
  if (c.state === 'failing') return say('bad', detail, false);
  if (c.state === 'pending') return say('run', detail, false);
  if (review === 'REVIEW_REQUIRED') return say('wait', 'Review required');
  if (state === 'BEHIND') return say('wait', 'Out of date with the base branch');
  if (state === 'BLOCKED') return say('wait', 'Blocked by branch rules');
  if (['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(state)) return say('ok', 'Ready to merge');
  return detail ? say(c.state === 'passing' ? 'ok' : 'none', detail, false) : say('none', '', false);
}

/** The names failing on a PR's base branch head and the base branch's name, read with the same fields
 *  as the watch snapshot. { base: null, failing: [] } on any failure: the line then counts every failure. */
async function ghPrBaseFailing({ projectDir, prUrl }) {
  const p = parseGithubPrUrl(prUrl);
  if (!p) return { base: null, failing: [] };
  const q = await watchGraphql(BASE_CHECKS_QUERY, { owner: p.owner, repo: p.repo, number: p.number }, { projectDir, repo: `${p.owner}/${p.repo}` });
  const pr = q.ok ? q.data?.repository?.pullRequest : null;
  return { base: pr?.baseRefName || null, failing: pr ? baseChecks(pr.baseRef).failing : [] };
}

/** A github.com PR's checks rollup, mergeability and merge verdict: one gh pr view, plus the base
 *  branch head's failing checks so the line counts them apart. null on any failure. Never throws. */
export async function ghPrChecks({ projectDir, prUrl }) {
  const repo = ownerRepoOfPrUrl(prUrl);
  if (!repo || !(await ghUsable())) return null;
  try {
    const [r, base] = await Promise.all([
      _run('gh', ['pr', 'view', prUrl, '--json', 'mergeable,mergeStateStatus,reviewDecision,isDraft,statusCheckRollup'],
        { cwd: projectDir, env: (await githubEnv('read', { repo })).env }),
      ghPrBaseFailing({ projectDir, prUrl }).catch(() => ({ base: null, failing: [] })),
    ]);
    if (!r.ok) return null;
    const v = JSON.parse(r.stdout);
    const checks = rollupChecks(v.statusCheckRollup, { baseFailing: base.failing });
    const mergeable = normalizeMergeable(v.mergeable);
    return { checks, mergeable, base: base.base,
      status: prMergeStatus({ checks, mergeable, mergeState: v.mergeStateStatus, reviewDecision: v.reviewDecision, draft: v.isDraft === true, base: base.base }) };
  } catch { return null; }
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
async function ghFindPrForBranch({ projectDir, head, prUrl = null }) {
  if (prUrl) {
    const v = await _run('gh', ['pr', 'view', prUrl, '--json', 'number,state,url'], { cwd: projectDir, env: (await githubEnv('read', { repo: ownerRepoOfPrUrl(prUrl) })).env });
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
    { cwd: projectDir, env: (await githubEnv('read', { repo: null })).env },
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

/** A PR's current body via its (repo-agnostic) URL. { ok, body } | { ok:false, error }. Never throws. */
export async function readPrBody({ projectDir = null, prUrl } = {}) {
  if (!prUrl) return { ok: false, error: 'prUrl is required' };
  const r = await _run('gh', ['pr', 'view', prUrl, '--json', 'body', '-q', '.body'],
    { cwd: projectDir || undefined, env: (await githubEnv('read', { repo: ownerRepoOfPrUrl(prUrl) })).env });
  if (!r.ok) return { ok: false, error: (r.stderr || '').trim() || `gh exited ${r.code}` };
  return { ok: true, body: String(r.stdout || '').replace(/\r?\n$/, '') };
}

/** Replace a PR's body (`gh pr edit <url> --body`; argv, no shell). { ok } | { ok:false, error }. */
export async function editPrBody({ projectDir = null, prUrl, body } = {}) {
  if (!prUrl) return { ok: false, error: 'prUrl is required' };
  const cred = await githubEnv('write', { repo: ownerRepoOfPrUrl(prUrl) });
  if (cred.error) return { ok: false, error: cred.error };
  const r = await _run('gh', ['pr', 'edit', prUrl, '--body', String(body ?? '')], { cwd: projectDir || undefined, env: cred.env });
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || '').trim() || `gh exited ${r.code}` };
}

// ── Remotes (fork support) ──────────────────────────────────────────────────

/** gh's PR selector for a head branch: `owner:branch` for a cross-repo head, else bare. */
export function prHeadRef(head, headOwner) {
  return headOwner ? `${headOwner}:${head}` : head;
}

/**
 * The repo's git remotes from `git remote -v`, in git's (alphabetical) order.
 * Each entry is { name, fetchUrl, pushUrl, host, owner, repo, slug, forge, org, project } with
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
      forge: forgeOf(parsed), org: parsed?.org ?? null, project: parsed?.project ?? null,
    };
  });
  return { ok: true, remotes };
}

/**
 * The branches each named remote has, from the LOCAL remote-tracking refs
 * (`refs/remotes/<remote>/*` — no network, as fresh as the last fetch). A remote
 * name may itself hold a slash, so the longest matching name owns a ref; the
 * symbolic `HEAD` is dropped. Never throws:
 * { ok:true, byRemote:{ [name]: string[] } } | { ok:false, byRemote:{}, error }.
 */
export async function listRemoteBranches(projectDir, remoteNames = []) {
  if (!projectDir) return { ok: false, byRemote: {}, error: 'projectDir is required' };
  const r = await _run('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/'], { cwd: projectDir });
  if (!r.ok) return { ok: false, byRemote: {}, error: (r.stderr || '').trim() || `git exited ${r.code}` };
  const names = [...remoteNames].sort((a, b) => b.length - a.length);
  const byRemote = Object.fromEntries(remoteNames.map((n) => [n, []]));
  for (const raw of (r.stdout || '').split(/\r?\n/)) {
    const rest = raw.trim().startsWith('refs/remotes/') ? raw.trim().slice('refs/remotes/'.length) : '';
    const name = rest && names.find((n) => rest.startsWith(`${n}/`));
    const branch = name ? rest.slice(name.length + 1) : '';
    if (branch && branch !== 'HEAD') byRemote[name].push(branch);
  }
  return { ok: true, byRemote };
}

// ── Check out (#529) ────────────────────────────────────────────────────────

/** OPEN | MERGED | CLOSED | null — unlike findPrForBranch, CLOSED is reported (keep policy `until-pr`). */
async function ghPrLifecycleState({ projectDir, prUrl }) {
  const v = await _run('gh', ['pr', 'view', prUrl, '--json', 'state'],
    { cwd: projectDir, env: (await githubEnv('read', { repo: ownerRepoOfPrUrl(prUrl) })).env });
  if (!v.ok) return null;
  try { const s = JSON.parse(v.stdout || 'null')?.state; return ['OPEN', 'MERGED', 'CLOSED'].includes(s) ? s : null; } catch { return null; }
}

// ── PR providers (dispatch by forge) ────────────────────────────────────────
// The GitHub provider is the gh code above (so _testing.setRunner keeps intercepting it);
// Azure DevOps goes to pr/azure.mjs. Only Azure diverts — GHE and unknown hosts keep gh (D4).

const PROVIDERS = {
  github: { forge: 'github', label: FORGE_LABEL.github,
    available: async () => ((await hasGh()) ? { ok: true } : { ok: false, reason: 'GitHub CLI (gh) is not available' }) },
  azure: { forge: 'azure', label: FORGE_LABEL.azure, available: () => azurePr.available() },
};
/** The PR provider for a base remote (a listRemotes entry). Only Azure diverts; every other host keeps gh (D4). */
export const prProviderFor = (remote) => PROVIDERS[forgeOf(remote) === 'azure' ? 'azure' : 'github'];

/** Which PR hosts worca can talk to right now (no network). */
export async function prHostsAvailable() {
  return { github: await hasGh(), azure: readAzureCredentials().mode !== 'none' };
}
export async function anyPrHost() { const h = await prHostsAvailable(); return h.github || h.azure; }

/** The remote a project's PRs target with no stored PR URL: upstream, else origin, else the first (gh's own guess). */
async function prBaseRemote(projectDir) {
  const rl = await listRemotes(projectDir);
  if (!rl.ok || !rl.remotes.length) return null;
  return rl.remotes.find((r) => r.name === 'upstream') || rl.remotes.find((r) => r.name === 'origin') || rl.remotes[0];
}
/** The project's base remote when it is on Azure DevOps — only looked up when an Azure credential exists (D6). */
async function azureBaseRemote(projectDir) {
  if (!projectDir || readAzureCredentials().mode === 'none') return null;
  const r = await prBaseRemote(projectDir);
  return forgeOf(r) === 'azure' ? r : null;
}

/**
 * anyPrHost() lets an Azure-only machine (no gh) into these paths for every project. A GitHub/other project there
 * must not spawn a doomed `gh` per row: skip gh when it is missing. Checked only when an Azure credential is
 * configured, so gh-only setups (and the runner-scripted tests, whose setRunner resets the hasGh memo) see
 * exactly today's calls.
 */
async function ghUsable() {
  return readAzureCredentials().mode === 'none' || hasGh();
}

/**
 * Open a PR on the base remote's forge. `baseRemote` / `pushRemote` (listRemotes entries) pick the provider;
 * without an Azure base remote this is gh's createPr (see ghCreatePr). @returns {Promise<import('./pr/azure.mjs').PrCreateResult>}
 */
export async function createPr(opts) {
  if (forgeOf(opts.baseRemote) === 'azure') {
    return azurePr.createPr({ ...opts, baseRepo: opts.baseRemote, pushRepo: opts.pushRemote || null });
  }
  return ghCreatePr(opts);
}

/** MERGEABLE | CONFLICTING | UNKNOWN, by the PR URL's forge, else the base remote's (see ghPrMergeable). */
export async function prMergeable(opts = {}) {
  if (forgeOfPrUrl(opts.prUrl) === 'azure') return (await azurePr.viewPr({ prUrl: opts.prUrl }))?.mergeable || 'UNKNOWN';
  if (!opts.prUrl) {
    const az = forgeOf(opts.baseRemote) === 'azure' ? opts.baseRemote : await azureBaseRemote(opts.projectDir);
    if (az) return (await azurePr.findPrForBranch({ head: opts.head, baseRepo: az }))?.mergeable || 'UNKNOWN';
  }
  if (!(await ghUsable())) return 'UNKNOWN';
  return ghPrMergeable(opts);
}

/** { state: OPEN|MERGED, url, number } | null for `head`, by forge (see ghFindPrForBranch). Never throws. */
export async function findPrForBranch({ projectDir, head, prUrl = null } = {}) {
  if (!projectDir || !head) return null;
  const strip = (pr) => (pr ? { state: pr.state, url: pr.url, number: pr.number } : null);
  if (forgeOfPrUrl(prUrl) === 'azure') {
    const pr = await azurePr.viewPr({ prUrl });
    if (pr && (pr.state === 'OPEN' || pr.state === 'MERGED')) return strip(pr);
    return strip(await azurePr.findPrForBranch({ head, baseRepo: parseAzurePrUrl(prUrl) }));   // CLOSED: search the branch
  }
  const az = prUrl ? null : await azureBaseRemote(projectDir);
  if (az) return strip(await azurePr.findPrForBranch({ head, baseRepo: az }));
  if (!(await ghUsable())) return null;
  return ghFindPrForBranch({ projectDir, head, prUrl });
}

/** OPEN | MERGED | CLOSED | null for a persisted PR URL, by its forge (see ghPrLifecycleState). */
export async function prLifecycleState({ projectDir, prUrl }) {
  if (!projectDir || !prUrl) return null;
  if (forgeOfPrUrl(prUrl) === 'azure') return (await azurePr.viewPr({ prUrl }))?.state || null;
  if (!(await ghUsable())) return null;
  return ghPrLifecycleState({ projectDir, prUrl });
}

/** The remote whose tracking ref holds `branch` ({ remote }), preferring origin; null = not pushed. No network. */
export async function branchPushedTo(projectDir, branch) {
  const r = await _run('git', ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${branch}`], { cwd: projectDir });
  if (!r.ok) return null;
  const remotes = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((ref) => ref.slice('refs/remotes/'.length, ref.length - branch.length - 1));
  if (!remotes.length) return null;
  return { remote: remotes.includes('origin') ? 'origin' : remotes[0] };
}

/**
 * The local tip of `branch` and its tip on `remote`'s tracking ref, as { local, remote } shas
 * (each null when the ref is absent; no remote = local only). Publish branch (#618) compares
 * them to tell "published" from "local commits since". No network. null on git failure.
 */
export async function branchTips(projectDir, branch, remote) {
  if (!projectDir || !branch) return null;
  const refs = [`refs/heads/${branch}`, ...(remote ? [`refs/remotes/${remote}/${branch}`] : [])];
  const r = await _run('git', ['for-each-ref', '--format=%(refname) %(objectname)', ...refs], { cwd: projectDir });
  if (!r.ok) return null;
  // for-each-ref also matches refs UNDER a pattern (refs/heads/feat/sub), so keep exact names only.
  const sha = new Map((r.stdout || '').split(/\r?\n/).map((l) => l.trim().split(' ')).filter((p) => p.length === 2));
  return { local: sha.get(refs[0]) || null, remote: remote ? sha.get(refs[1]) || null : null };
}

/** Recreate a local branch from its remote-tracking ref (checkout D7). */
export async function restoreBranchFromRemote(projectDir, branch, remote) {
  const r = await _run('git', ['branch', '--', branch, `refs/remotes/${remote}/${branch}`], { cwd: projectDir });
  return r.ok;
}

// stderr only: stdout can carry a GraphQL payload whose fields ("author") read like an auth failure.
const ghWatchFailure = (r) => {
  const text = String(r?.stderr || '').toLowerCase();
  if (/rate.?limit|secondary rate|abuse detection/.test(text)) return 'rate-limit';
  if (/\bauth(?:entication|orization)?\b|credential|login|\b40[13]\b|resource not accessible/.test(text)) return 'auth';
  return 'failed';
};
const pageOk = (p) => p && typeof p.hasNextPage === 'boolean'
  && (!p.hasNextPage || (typeof p.endCursor === 'string' && p.endCursor));

async function watchGraphql(query, vars, { projectDir, repo, role = 'read' }) {
  const cred = await githubEnv(role, { repo });
  if (cred.error) return { ok: false, class: 'auth', error: cred.error };
  const args = ['api', 'graphql', '-f', `query=${query}`];
  // `-f` sends a raw string; `-F` types its value, and only the literals true/false and an integer
  // become a GraphQL Boolean!/Int! (the @include switches and the PR number). Nothing else is typed.
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue;
    if (typeof v === 'string') args.push('-f', `${k}=${v}`);
    else if (typeof v === 'boolean') args.push('-F', `${k}=${v ? 'true' : 'false'}`);
    else if (Number.isSafeInteger(v)) args.push('-F', `${k}=${v}`);
    else return { ok: false, class: 'failed', error: `GraphQL variable ${k} has an unsupported type` };
  }
  const r = await _run('gh', args, { cwd: projectDir, env: cred.env });
  if (!r.ok) return { ok: false, class: ghWatchFailure(r), error: (r.stderr || '').trim() || `gh exited ${r.code}` };
  let body; try { body = JSON.parse(r.stdout); } catch { return { ok: false, class: 'failed', error: 'GitHub returned invalid JSON' }; }
  if (!body || (Array.isArray(body.errors) && body.errors.length)) return { ok: false, class: 'failed', error: 'GitHub GraphQL returned errors' };
  return { ok: true, data: body.data };
}

// The base branch head's checks: shared by the watch snapshot and the PR card's checks line (ghPrChecks),
// so both tell the PR's own failures from the base's with the same fields.
const BASE_TARGET = 'target{... on Commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}';
// `compare` against refs/pull/<n>/head (it lives in the base repository, fork or not): behindBy is how
// many base commits the PR lacks.
const WATCH_QUERY = `query PrWatch($owner:String!,$repo:String!,$number:Int!,$headRef:String!,$contextsCursor:String,$threadsCursor:String,$reviewsCursor:String,$withContexts:Boolean!,$withThreads:Boolean!,$withReviews:Boolean!,$withBase:Boolean!){repository(owner:$owner,name:$repo){pullRequest(number:$number){url state headRefName headRefOid baseRefName baseRefOid mergeable author{login} statusCheckRollup{contexts(first:100,after:$contextsCursor) @include(if:$withContexts){nodes{__typename ... on CheckRun{databaseId name status conclusion detailsUrl isRequired(pullRequestNumber:$number) checkSuite{workflowRun{databaseId}}} ... on StatusContext{context state targetUrl isRequired(pullRequestNumber:$number)}} pageInfo{hasNextPage endCursor}}} reviewThreads(first:100,after:$threadsCursor) @include(if:$withThreads){nodes{id isResolved comments(first:100){nodes{databaseId body author{login} authorAssociation} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}} reviews(first:100,after:$reviewsCursor) @include(if:$withReviews){nodes{databaseId body state author{login} authorAssociation} pageInfo{hasNextPage endCursor}} baseRef @include(if:$withBase){compare(headRef:$headRef){behindBy} ${BASE_TARGET}}}}}`;
const BASE_CHECKS_QUERY = `query PrBaseChecks($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){baseRefName baseRef{${BASE_TARGET}}}}}`;
const COMMENTS_QUERY = `query PrWatchComments($threadId:ID!,$commentsCursor:String){node(id:$threadId){... on PullRequestReviewThread{comments(first:100,after:$commentsCursor){nodes{databaseId body author{login} authorAssociation} pageInfo{hasNextPage endCursor}}}}}`;

/** The base branch head's checks by name: `failing` (completed, not passing: a PR failing the same
 *  check inherited it), `passing`, `pending` (still running), and `settled` when nothing runs. Only the
 *  first 100 contexts (best effort). */
export function baseChecks(baseRef) {
  const nodes = baseRef?.target?.statusCheckRollup?.contexts?.nodes;
  const out = { failing: [], passing: [], pending: [], settled: true };
  if (!Array.isArray(nodes)) return out;
  const sets = { failing: new Set(), passing: new Set(), pending: new Set() };
  for (const c of nodes) {
    const name = c?.name || c?.context;
    if (!name) continue;
    const state = c.__typename === 'StatusContext'
      ? (['PENDING', 'EXPECTED'].includes(c.state) ? 'pending' : ['FAILURE', 'ERROR'].includes(c.state) ? 'failing' : 'passing')
      : c.status !== 'COMPLETED' ? 'pending' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) ? 'passing' : 'failing';
    sets[state].add(name);
  }
  return { failing: [...sets.failing], passing: [...sets.passing], pending: [...sets.pending], settled: sets.pending.size === 0 };
}

export async function ghPrWatchSnapshot({ projectDir, prUrl } = {}) {
  const p = parseGithubPrUrl(prUrl);
  if (!p) return { ok: false, class: 'failed', error: 'invalid GitHub pull request URL' };
  const repo = `${p.owner}/${p.repo}`;
  // Each connection pages on its own cursor; a finished one is left out of later pages (@include), so
  // uneven page counts never re-read (and re-collect) a page that was already taken.
  const cursor = { contexts: null, threads: null, reviews: null };
  const open = { contexts: true, threads: true, reviews: true };
  const contexts = []; const threads = []; const reviews = []; let facts = null;
  for (let pages = 0; pages < 100; pages++) {
    const q = await watchGraphql(WATCH_QUERY, { owner: p.owner, repo: p.repo, number: p.number,
      headRef: `refs/pull/${p.number}/head`, contextsCursor: cursor.contexts, threadsCursor: cursor.threads, reviewsCursor: cursor.reviews,
      withContexts: open.contexts, withThreads: open.threads, withReviews: open.reviews, withBase: pages === 0 }, { projectDir, repo });
    if (!q.ok) return q;
    const pr = q.data?.repository?.pullRequest;
    if (!pr || typeof pr.state !== 'string' || typeof pr.headRefName !== 'string' || typeof pr.headRefOid !== 'string') return { ok: false, class: 'failed', error: 'malformed GitHub snapshot' };
    if (!facts) {
      const base = baseChecks(pr.baseRef);
      facts = { url: pr.url || p.url, state: pr.state, branch: pr.headRefName, headSha: pr.headRefOid, author: pr.author || null,
        base: pr.baseRefName || null, baseSha: pr.baseRefOid || null, mergeable: normalizeMergeable(pr.mergeable),
        behindBy: Number(pr.baseRef?.compare?.behindBy) || 0,
        baseFailing: base.failing, basePassing: base.passing, basePending: base.pending, baseSettled: base.settled };
    }
    const done = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    const cc = !open.contexts || pr.statusCheckRollup === null ? done : pr.statusCheckRollup?.contexts;
    const tt = open.threads ? pr.reviewThreads : done; const rr = open.reviews ? pr.reviews : done;
    if (!cc || !Array.isArray(cc.nodes) || !pageOk(cc.pageInfo) || !tt || !Array.isArray(tt.nodes) || !pageOk(tt.pageInfo) || !rr || !Array.isArray(rr.nodes) || !pageOk(rr.pageInfo)) return { ok: false, class: 'failed', error: 'malformed GitHub pagination' };
    for (const c of cc.nodes) {
      if (typeof c.isRequired !== 'boolean') return { ok: false, class: 'failed', error: 'GitHub omitted isRequired' };
      if (c.__typename === 'StatusContext') { contexts.push({ ...c, type: 'status', headSha: facts.headSha }); continue; }
      // The Actions workflow run behind a check run, so its failed jobs can be re-run; null for other apps.
      const { checkSuite, ...run } = c;
      contexts.push({ ...run, type: 'check', runId: checkSuite?.workflowRun?.databaseId || null });
    }
    for (const t of tt.nodes) {
      if (!t?.id || !t.comments || !Array.isArray(t.comments.nodes) || !pageOk(t.comments.pageInfo)) return { ok: false, class: 'failed', error: 'malformed review thread' };
      threads.push({ nodeId: t.id, isResolved: !!t.isResolved, comments: [...t.comments.nodes], _page: t.comments.pageInfo });
    }
    reviews.push(...rr.nodes);
    for (const [k, conn] of [['contexts', cc], ['threads', tt], ['reviews', rr]]) {
      if (!open[k]) continue;
      open[k] = conn.pageInfo.hasNextPage;
      if (open[k]) cursor[k] = conn.pageInfo.endCursor;
    }
    if (!open.contexts && !open.threads && !open.reviews) break;
    if (pages === 99) return { ok: false, class: 'failed', error: 'GitHub pagination ceiling exceeded' };
  }
  for (const thread of threads) {
    let cursor = thread._page.hasNextPage ? thread._page.endCursor : null;
    for (let pages = 0; cursor && pages < 100; pages++) {
      const q = await watchGraphql(COMMENTS_QUERY, { threadId: thread.nodeId, commentsCursor: cursor }, { projectDir, repo });
      if (!q.ok) return q;
      const c = q.data?.node?.comments;
      if (!c || !Array.isArray(c.nodes) || !pageOk(c.pageInfo)) return { ok: false, class: 'failed', error: 'malformed review comments' };
      thread.comments.push(...c.nodes); cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
      if (pages === 99 && cursor) return { ok: false, class: 'failed', error: 'GitHub pagination ceiling exceeded' };
    }
    delete thread._page;
  }
  return { ok: true, pr: { ...facts, contexts, threads, reviews } };
}

export async function ghFailedJobLog({ projectDir, prUrl, databaseId } = {}) {
  const p = parseGithubPrUrl(prUrl); if (!p || !databaseId) return { ok: false, class: 'failed', error: 'invalid job log request' };
  const repo = `${p.owner}/${p.repo}`; const cred = await githubEnv('read', { repo });
  if (cred.error) return { ok: false, class: 'auth', error: cred.error };
  const r = await _run('gh', ['run', 'view', '--job', String(databaseId), '--log-failed', '--repo', repo], { cwd: projectDir, env: cred.env });
  if (!r.ok) return { ok: false, class: ghWatchFailure(r), error: (r.stderr || '').trim() || `gh exited ${r.code}` };
  // `--log-failed` prefixes every line with "<job>\t<step>\t<timestamp> ": keep only the message.
  const text = redactSecrets(String(r.stdout || '').replace(/^[^\t\n]*\t[^\t\n]*\t\uFEFF?(?:\d{4}-\d\d-\d\dT[\d:.]+Z ?)?/gm, ''));
  return { ok: true, text: failedLogTail(text) };
}

/** Re-run a workflow run's failed jobs once (a flaky check gets one more try before a fix run). */
export async function ghRerunFailedJobs({ projectDir, prUrl, runId } = {}) {
  const p = parseGithubPrUrl(prUrl); if (!p || !runId) return { ok: false, class: 'failed', error: 'invalid re-run request' };
  const repo = `${p.owner}/${p.repo}`; const cred = await githubEnv('write', { repo });
  if (cred.error) return { ok: false, class: 'auth', error: cred.error };
  const r = await _run('gh', ['run', 'rerun', String(runId), '--failed', '--repo', repo], { cwd: projectDir, env: cred.env });
  return r.ok ? { ok: true } : { ok: false, class: ghWatchFailure(r), error: (r.stderr || '').trim() || `gh exited ${r.code}` };
}

export const PR_WATCH_LOG_BYTES = 12 * 1024;
/** The longest suffix of `text` that fits in `max` UTF-8 bytes: a log's failure is at its end. */
export function tailBytes(text, max) {
  const buf = Buffer.from(String(text || ''));
  return buf.length <= max ? buf.toString() : buf.subarray(buf.length - max).toString().replace(/^\ufffd+/, '');
}
/** What explains a failed job: without the runner's setup (through "Complete job name:") and the
 *  post-job cleanup, which gh prints whole when it cannot map steps; then the last `max` bytes. */
export function failedLogTail(text, max = PR_WATCH_LOG_BYTES) {
  let lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('Complete job name: '));
  if (start >= 0) lines = lines.slice(start + 1);
  const post = lines.findIndex((l) => l === 'Post job cleanup.');
  if (post >= 0) lines = lines.slice(0, post);
  return tailBytes(lines.join('\n').trim(), max);
}

async function watchMutation({ projectDir, prUrl, query, vars }) {
  const p = parseGithubPrUrl(prUrl); if (!p) return { ok: false, class: 'failed', error: 'invalid GitHub pull request URL' };
  return watchGraphql(query, vars, { projectDir, repo: `${p.owner}/${p.repo}`, role: 'write' });
}
export async function ghReplyToThread({ projectDir, prUrl, threadId, body } = {}) {
  const r = await watchMutation({ projectDir, prUrl, query: 'mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{id}}}', vars: { threadId, body } });
  return r.ok ? { ok: true } : r;
}
export async function ghPrComment({ projectDir, prUrl, body } = {}) {
  const p = parseGithubPrUrl(prUrl); if (!p) return { ok: false, class: 'failed', error: 'invalid GitHub pull request URL' };
  const repo = `${p.owner}/${p.repo}`; const cred = await githubEnv('write', { repo });
  if (cred.error) return { ok: false, class: 'auth', error: cred.error };
  const r = await _run('gh', ['pr', 'comment', String(p.number), '--repo', repo, '--body', String(body || '')], { cwd: projectDir, env: cred.env });
  return r.ok ? { ok: true } : { ok: false, class: ghWatchFailure(r), error: (r.stderr || '').trim() || `gh exited ${r.code}` };
}
export async function commitSubjects(projectDir, from, to) {
  if (!projectDir || !from || !to) return { ok: false, subjects: [], error: 'projectDir, from and to are required' };
  const r = await _run('git', ['log', '--format=%s', `${from}..${to}`], { cwd: projectDir });
  return r.ok ? { ok: true, subjects: String(r.stdout || '').split(/\r?\n/).filter(Boolean) }
    : { ok: false, subjects: [], error: (r.stderr || '').trim() || `git exited ${r.code}` };
}

/**
 * Did a conflict fix really merge the base? `baseSha` must be an ancestor of `to`, and no line added
 * between `from` (the PR head it started on) and `to` may be a leftover conflict marker
 * (`git diff --check` names them; its whitespace complaints are ignored).
 * Returns { ok, merged, markers: ['file:line', …] }.
 */
export async function checkConflictMerge(projectDir, { baseSha, from, to } = {}) {
  if (!projectDir || !baseSha || !from || !to) return { ok: false, error: 'projectDir, baseSha, from and to are required' };
  const anc = await _run('git', ['merge-base', '--is-ancestor', baseSha, to], { cwd: projectDir });
  if (!anc.ok && anc.code !== 1) return { ok: false, error: (anc.stderr || '').trim() || `git exited ${anc.code}` };
  const d = await _run('git', ['diff', '--check', from, to], { cwd: projectDir });
  if (!d.ok && d.code !== 2) return { ok: false, error: (d.stderr || '').trim() || `git exited ${d.code}` };
  const markers = String(d.stdout || '').split(/\r?\n/).filter((l) => /: leftover conflict marker$/.test(l))
    .map((l) => l.replace(/: leftover conflict marker$/, ''));
  return { ok: true, merged: anc.ok, markers };
}

// Test seam: swap the command runner + clear the gh memo. Mirrors server.mjs#_testing.
export const _testing = {
  defaultRun,
  setRunner(fn) { _run = typeof fn === 'function' ? fn : defaultRun; _ghCache = null; },
  reset() { _run = defaultRun; _ghCache = null; },
};
