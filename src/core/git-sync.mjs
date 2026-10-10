// src/core/git-sync.mjs
// Base-branch freshness for runs, pickers and Ask Worca (#527): fetch a remote, read how far a
// local branch is from its remote twin, and fast-forward it when — and only when — that is safe.
// Never rebases or resets. The only merges are #620's on a run's FEATURE branch (mergeBaseInto,
// startConflictMerge); a base is only ever fast-forwarded. Every git call goes through an injectable runner
// (_testing.setRunner, mirroring git-info.mjs); nothing here throws.
//
// Freshness is shared ACROSS processes: the UI server and every Ask Worca MCP child import this
// module separately, so "last fetched" is the mtime of the repository's FETCH_HEAD (git writes it
// on every fetch, ours or a person's). The in-memory map only collapses concurrent callers inside
// ONE process onto one `git fetch`; a cross-process ref-lock race is retried (policy/sync.mjs:66).
// No GIT_SSH_COMMAND override (metrics/sync.mjs:105): it would beat the user's core.sshCommand;
// network commands run in their own session instead, so ssh has no tty to prompt on (defaultRun).

import { spawn, spawnSync } from 'node:child_process';
import { stat, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { devNull } from 'node:os';
import { githubEnv } from './github-credentials.mjs';
import { azureEnv } from './azure-credentials.mjs';
import { stripHostCredentials } from './host-credentials.mjs';
import { worcaHome } from './projects.mjs';
import { parseRemoteUrl } from './git-info.mjs';
import { forgeOf } from './forge.mjs';
import { mapWithCap } from './fanout.mjs';

export const INTERACTIVE_TTL_MS = 45_000;
export const INTERACTIVE_TIMEOUT_MS = 8_000;
export const RUN_TIMEOUT_MS = 60_000;
export { SYNC_EXECUTION_ID } from '../shared/graph/constants.mjs';   // 'x:sync:1' (plan §4.2)
const LOCAL_TIMEOUT_MS = 30_000;
const FF_TIMEOUT_MS = 120_000;
const LOCAL_REF_RACE = /cannot lock ref|incorrect old value provided|unable to update local ref|Unable to create '[^']*\.lock'/;
const QUIET_ENV = Object.freeze({ LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' });

/** Default runner: `git args` in cwd → { ok, stdout, stderr, code, timedOut }. Never throws.
 *  `env` REPLACES process.env (a githubEnv() result is already a full env); QUIET_ENV always wins.
 *
 *  Network commands (`fetch`) run in their OWN session/process group on POSIX (`detached: true`
 *  = setsid). Reason: GIT_TERMINAL_PROMPT / *_ASKPASS only silence git's own prompts. ssh asks for
 *  a key passphrase or a host-key yes/no on /dev/tty directly, so when worca runs in a terminal the
 *  prompt lands there, and a SIGKILL of `git` alone leaves the `ssh` child blocked forever (one per
 *  project per background tick). With no controlling tty, ssh fails at once ("Permission denied" /
 *  "Host key verification failed" → kind 'auth'), and the timeout kills the whole group.
 *  core.sshCommand and ssh-agent keep working (C6 still holds).
 *  `merge` is a network command too (v8): worca's own clones are blobless (clone-project.mjs:102,
 *  --filter=blob:none), so a fast-forward that checks out new files lazily fetches their blobs.
 *  `merge-tree` likewise (#620): it reads the blobs of both sides, which a blobless clone fetches lazily.
 *  Windows (v8): no setsid. Git for Windows' ssh can still prompt on an inherited console; on a
 *  timeout the whole tree is ended with `taskkill /T /F`, as script-runner.mjs:264-272 does. */
const NETWORK_CMDS = new Set(['fetch', 'merge', 'merge-tree']);
/** Every git-sync call runs with an empty hooks directory (metrics/sync.mjs hookFreeArgs, decision 33):
 *  `reference-transaction` fires on fetch / update-ref / branch and `post-merge` on merge --ff-only,
 *  with the spawn env — worca's GitHub credential included. Run worktrees share the project's
 *  .git/hooks, so an agent could plant one there. On POSIX the hooks path is the null device, which
 *  can hold no hooks (a directory could be created and filled later); on Windows, a worca-home
 *  folder that does not exist simply has no hooks. The shared .git/config is just as writable, so
 *  a planted core.fsmonitor command (run by `git status`) and http.sslVerify=false are overridden too. */
function hookFreeArgs() {
  let dir = devNull;
  if (process.platform === 'win32') { try { dir = join(worcaHome(), 'no-hooks'); } catch { /* devNull */ } }
  return ['-c', `core.hooksPath=${dir}`, '-c', 'core.fsmonitor=false', '-c', 'http.sslVerify=true'];
}
const liveGroups = new Set();   // pids of detached groups still running (POSIX)
let exitHooked = false;
function trackGroup(pid) {
  // A detached group leads its own session, so a server exit / Ctrl+C no longer reaches it
  // (the trap script-runner.mjs:288-294 measured). Kill what is left, synchronously, on exit.
  liveGroups.add(pid);
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => { for (const p of liveGroups) { try { process.kill(-p, 'SIGKILL'); } catch { /* gone */ } } });
}
function defaultRun(args, { cwd, timeoutMs = LOCAL_TIMEOUT_MS, env = null } = {}) {
  return new Promise((done) => {
    const network = NETWORK_CMDS.has(args[0]);
    const win = process.platform === 'win32';
    const group = network && !win;
    let child;
    try {
      child = spawn('git', [...hookFreeArgs(), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: group,
        env: { ...(env || stripHostCredentials(process.env)), ...QUIET_ENV } });
    } catch (err) { done({ ok: false, stdout: '', stderr: err.message, code: -1, timedOut: false }); return; }
    if (group && child.pid) trackGroup(child.pid);
    let stdout = '', stderr = '', settled = false, timer = null;
    const finish = (v) => {
      if (settled) return;
      settled = true; if (timer) clearTimeout(timer); done(v);
    };
    const kill = () => {
      if (network && win && child.pid) {
        try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
        return;
      }
      // SIGTERM first so git can remove its *.lock files; SIGKILL the group if it is still there.
      const sig = (s) => { try { if (group) process.kill(-child.pid, s); else child.kill(s); } catch { /* gone */ } };
      sig('SIGTERM'); setTimeout(() => sig('SIGKILL'), 1_000).unref();
    };
    if (timeoutMs > 0) timer = setTimeout(() => { kill(); finish({ ok: false, stdout, stderr, code: -1, timedOut: true }); }, timeoutMs);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    // A timed-out group stays in liveGroups until it really closes, so an exit in that second is covered.
    child.on('error', (err) => { liveGroups.delete(child.pid); finish({ ok: false, stdout, stderr: stderr || err.message, code: -1, timedOut: false }); });
    child.on('close', (code) => { liveGroups.delete(child.pid); finish({ ok: code === 0, stdout, stderr, code: code ?? -1, timedOut: false }); });
  });
}
let _run = defaultRun;
const inflight = new Map();   // `${realpath}\0${remote}` -> Promise<fetch result>
// Negative cache: a failed fetch does not refresh FETCH_HEAD, so without this every
// interactive caller offline would wait the full timeout again. Only callers that
// accept a cache (maxAgeMs > 0) see it; the run's Sync stage (maxAgeMs 0) always retries.
const failed = new Map();     // same key -> { at, result }
const ownFetch = new Map();   // same key -> FETCH_HEAD mtime right after THIS process's last good fetch
// A failed fetch truncates FETCH_HEAD (and bumps its mtime), so the disk forgets the last good
// fetch. Remember it here for DISPLAY only ("Last fetched …"); freshness decisions never read it.
const lastGood = new Map();   // same key -> ms of the last good fetch this process saw

// ── names, text ──────────────────────────────────────────────────────────────
/** A configured remote NAME (never a URL, never an option). */
export function isSafeRemoteName(s) {
  return typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(s);
}
/** A branch name we are willing to sync (git ref rules, conservative alphabet, not a bare SHA). */
export function isSafeBranchName(s) {
  if (typeof s !== 'string' || !s || s.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(s) || /^[0-9a-f]{40}$/i.test(s)) return false;
  if (s.startsWith('-') || s.startsWith('/') || s.endsWith('/') || s.endsWith('.') || s.endsWith('.lock')) return false;
  if (s.includes('..') || s.includes('//')) return false;
  return s.split('/').every((c) => c && !c.startsWith('.') && !c.endsWith('.lock'));
}
/** Redact URL credentials and GitHub / Azure DevOps token shapes from git output / URLs; cap the length. */
export function scrubGitText(s, max = 2000) {
  return String(s ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<redacted>')
    .replace(/\b(?:[A-Za-z0-9]{76}AZDO[A-Za-z0-9]{4}|[a-z2-7]{52})\b/g, '<redacted>')   // Azure DevOps PATs (84-char, legacy 52-char)
    .trim().slice(0, max);
}
/** Stable failure kind for a failed fetch's stderr (LC_ALL=C, so English). */
export function classifyFetchError(stderr) {
  const s = String(stderr || '');
  // git adds "make sure you have the correct access rights" to a MISSING repository too: a quoted
  // path or URL that is not a repository is unreachable, not a sign-in problem. A bare name
  // ('upstream') is a remote that is not configured.
  const notRepo = /'([^']*)' does not appear to be a git repository/i.exec(s);
  if (notRepo && /[/\\:]/.test(notRepo[1])) return 'network';
  if (/Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|HTTP 40[13]|returned error: 40[13]|Permission denied \(publickey|Repository not found|correct access rights|Host key verification failed|invalid credentials/i.test(s)) return 'auth';
  if (/No such remote|does not appear to be a git repository/i.test(s)) return 'no-remote';
  if (/Could not resolve host|unable to access|Connection (?:refused|timed out|reset)|Network is unreachable|Operation timed out|early EOF|remote end hung up|SSL|TLS/i.test(s)) return 'network';
  return 'failed';
}
/** One word for a status object (see SyncBlock.state). Pure. */
export function syncState(s) {
  if (!s || !s.ok) return 'unknown';
  if (!s.hasRemote) return s.hasLocal ? 'no-upstream' : 'missing';
  if (!s.hasLocal) return 'remote-only';
  if (s.ahead > 0 && s.behind > 0) return 'diverged';
  if (s.behind > 0) return 'behind';
  if (s.ahead > 0) return 'ahead';
  return 'up-to-date';
}
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);
const short = (sha) => (sha ? String(sha).slice(0, 7) : '—');

// ── low-level reads ──────────────────────────────────────────────────────────
async function shaOf(dir, ref) {
  const r = await _run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: dir });
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}
const repoKey = async (dir, remote) => `${await realpath(dir).catch(() => resolve(dir))}\0${remote}`;
async function fetchHeadPath(dir) {
  const r = await _run(['rev-parse', '--git-path', 'FETCH_HEAD'], { cwd: dir });
  if (!r.ok || !r.stdout.trim()) return null;
  const p = r.stdout.trim();
  return isAbsolute(p) ? p : join(dir, p);
}
/** How git can name a remote inside FETCH_HEAD (builtin/fetch.c): the URL without
 *  `user[:pass]@`, trailing slashes and one trailing ".git". Both the fully anonymised form
 *  and the scp form that keeps `user@` are accepted. Credential-free by construction. */
export function fetchHeadUrls(url) {
  const trim = (s) => s.replace(/\/+$/, '').replace(/\.git$/, '');
  const noCred = String(url || '').trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, '$1');
  return [...new Set([trim(noCred), trim(noCred.replace(/^[^@/:]+@(?=[^/:]+:)/, ''))])].filter(Boolean);
}
/** When `remote` was last fetched (ms), or null. FETCH_HEAD is rewritten by a fetch of ANY
 *  remote, so its mtime counts only when this process's own last fetch of this remote wrote it,
 *  or when one of its lines names this remote's URL (a person's `git fetch upstream` must never
 *  make origin look fresh). */
async function remoteFetchedMs(dir, key, urls) {
  const p = await fetchHeadPath(dir);
  if (!p) return null;
  let ms;
  try { ms = (await stat(p)).mtimeMs; } catch { return null; }
  if (ownFetch.get(key) === ms) return ms;
  let text = '';
  try { text = await readFile(p, 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  if (!(urls || []).some((u) => lines.some((l) => l.endsWith(` of ${u}`)))) return null;
  if (!(lastGood.get(key) >= ms)) lastGood.set(key, ms);
  return ms;
}
/** For display: the last good fetch, surviving a failed fetch that emptied FETCH_HEAD. */
async function shownFetchedMs(dir, key, urls) {
  return (await remoteFetchedMs(dir, key, urls)) ?? lastGood.get(key) ?? null;
}
async function lastFetchedMs(dir, remote) {
  const info = await remoteInfo(dir, remote);
  return info.ok ? shownFetchedMs(dir, await repoKey(dir, remote), info.fetchUrls) : null;
}
/** ISO time `remote` was last fetched into `dir` (any process, or a person), or null. No network. */
export async function lastFetchedAt(dir, { remote = 'origin' } = {}) {
  return dir && isSafeRemoteName(remote) ? iso(await lastFetchedMs(dir, remote)) : null;
}
/** { sha, at } of a ref's tip commit, or null. */
export async function commitInfo(dir, ref) {
  const r = await _run(['log', '-1', '--no-color', '--format=%H%x1f%ct', ref, '--'], { cwd: dir });
  if (!r.ok || !r.stdout.trim()) return null;
  const [sha, ct] = r.stdout.trim().split('\x1f');
  return { sha, at: iso(Number(ct) * 1000) };
}
/** Commits reachable from `to` and not from `from`; null when unknown (a missing ref must
 *  never read as "0 = not moved"). */
export async function commitsBetween(dir, from, to) {
  if (!from || !to || /^-/.test(from) || /^-/.test(to)) return null;
  const r = await _run(['rev-list', '--count', `${from}..${to}`, '--'], { cwd: dir });
  if (!r.ok) return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}
// git and Node can spell one directory differently (drive-letter / path case, 8.3 short names,
// symlinked parents). Compare canonical paths, case-insensitively where the filesystem is.
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';
const samePath = (a, b) => (CASE_INSENSITIVE_FS ? a.toLowerCase() === b.toLowerCase() : a === b);
async function canonPath(p) { return resolve(await realpath(p).catch(() => p)); }

/** Canonical absolute paths of the worktrees that have refs/heads/<base> checked out; null when
 *  git could not list them. */
async function checkoutsOf(dir, base) {
  const r = await _run(['worktree', 'list', '--porcelain'], { cwd: dir });
  if (!r.ok) return null;                  // unknown: callers must treat the branch as in use
  const out = [];
  let cur = null;
  for (const line of (r.ok ? r.stdout : '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) cur = line.slice('worktree '.length).trim();
    else if (line.trim() === `branch refs/heads/${base}` && cur) out.push(await canonPath(cur));
  }
  return out;
}

// ── remote + fetch ───────────────────────────────────────────────────────────
/** The remote's display label (host/owner/repo, credential-free), its github "owner/name", and whether it is Azure DevOps. */
export async function remoteInfo(dir, remote = 'origin') {
  if (!isSafeRemoteName(remote)) return { ok: false, kind: 'bad-remote', error: 'invalid remote name' };
  const r = await _run(['remote', 'get-url', remote], { cwd: dir });
  if (!r.ok || !r.stdout.trim()) return { ok: false, kind: 'no-remote', error: `no remote named "${remote}"` };
  const url = r.stdout.trim();
  const p = parseRemoteUrl(url);
  return { ok: true, name: remote, label: p ? `${p.host}/${p.owner}/${p.repo}` : scrubGitText(url, 200),
    githubRepo: p && p.host === 'github.com' ? `${p.owner}/${p.repo}` : null,
    azure: forgeOf(p) === 'azure', fetchUrls: fetchHeadUrls(url) };
}

/** worca's server-side READ credential for the remote's host (App mode mints per call); other hosts: this machine's git. */
async function readCred(info) {
  if (info.githubRepo) return githubEnv('read', { repo: info.githubRepo });
  if (info.azure) return { env: azureEnv('read'), error: null };
  return { env: stripHostCredentials(process.env), error: null };
}

async function runFetch(key, dir, info, timeoutMs) {
  const cred = await readCred(info);
  let r;
  for (let i = 0; i < 3; i++) {
    r = await _run(['fetch', '--prune', '--no-tags', info.name], { cwd: dir, env: cred.env, timeoutMs });
    if (r.ok || r.timedOut || !LOCAL_REF_RACE.test(r.stderr)) break;
    await new Promise((res) => setTimeout(res, 50 + Math.floor(Math.random() * 200)));
  }
  if (r.ok) {
    const p = await fetchHeadPath(dir);
    const ms = p ? await stat(p).then((s) => s.mtimeMs, () => null) : null;
    if (ms) { ownFetch.set(key, ms); lastGood.set(key, ms); }
    return { ok: true, fetchedAt: iso(ms) || iso(Date.now()), cached: false };
  }
  const fetchedAt = iso(await shownFetchedMs(dir, key, info.fetchUrls));   // this remote's last good fetch
  return {
    ok: false, kind: r.timedOut ? 'timeout' : classifyFetchError(r.stderr), timeoutMs, fetchedAt,
    error: scrubGitText(r.stderr) || (r.timedOut ? `git fetch timed out after ${timeoutMs} ms` : `git fetch exited ${r.code}`),
    ...(cred.error ? { credentialError: scrubGitText(cred.error, 300) } : {}),
  };
}

function startFetch(key, dir, info, timeoutMs) {
  const p = runFetch(key, dir, info, timeoutMs)
    .then((r) => { if (r.ok) failed.delete(key); else failed.set(key, { at: Date.now(), result: r }); return r; })
    .finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/**
 * `git fetch --prune --no-tags <remote>`, deduplicated per repository+remote inside this
 * process, skipped when FETCH_HEAD is younger than `maxAgeMs` (0 = always fetch).
 * → { ok:true, fetchedAt, cached } | { ok:false, kind, error, fetchedAt }
 */
export async function fetchRemote(dir, { remote = 'origin', timeoutMs = INTERACTIVE_TIMEOUT_MS, maxAgeMs = 0 } = {}) {
  if (!dir) return { ok: false, kind: 'failed', error: 'projectDir is required' };
  const info = await remoteInfo(dir, remote);
  if (!info.ok) return info;
  const key = await repoKey(dir, remote);
  if (maxAgeMs > 0) {
    const at = await remoteFetchedMs(dir, key, info.fetchUrls);
    const fail = failed.get(key);
    // A failure newer than the last good FETCH_HEAD wins (a killed fetch can even touch FETCH_HEAD).
    if (fail && Date.now() - fail.at < maxAgeMs && (!at || fail.at >= at)) return { ...fail.result, cached: true };
    if (at && Date.now() - at < maxAgeMs && !(fail && fail.at >= at)) return { ok: true, fetchedAt: iso(at), cached: true };
  }
  const running = inflight.get(key);
  if (!running) return startFetch(key, dir, info, timeoutMs);
  // Joining a LONGER-bounded fetch (the background tick's or a run's 60 s) must not stretch a
  // person's 8 s wait (v8): race it against this caller's own bound. The shared fetch continues.
  let bound = null;
  const shared = await Promise.race([running, new Promise((res) => {
    bound = setTimeout(() => res({ ok: false, kind: 'timeout', timeoutMs, joined: true,
      fetchedAt: null, error: `git fetch timed out after ${timeoutMs} ms` }), timeoutMs);
    bound.unref?.();
  })]);
  clearTimeout(bound);
  if (shared.joined) return { ...shared, fetchedAt: iso(await shownFetchedMs(dir, key, info.fetchUrls)) };
  // Joined a SHORTER-bounded fetch (a person's 8 s) that timed out: a longer caller (the run's
  // 60 s Sync stage) tries once on its own bound instead of inheriting the timeout.
  if (!shared.ok && shared.kind === 'timeout' && timeoutMs > (shared.timeoutMs || 0)) {
    return inflight.get(key) || startFetch(key, dir, info, timeoutMs);
  }
  return shared;
}

/** No network. The last failed fetch of `remote` when it is newer than its last good one (the
 *  rule fetchRemote's cache uses), else null: a status read must still read Offline after a
 *  background refresh or a Sync that could not fetch. Server clock on both sides. */
async function standingFailure(dir, remote) {
  const key = await repoKey(dir, remote);
  const fail = failed.get(key);
  if (!fail) return null;                  // the common case: no git spawn at all
  const info = await remoteInfo(dir, remote);
  if (!info.ok) return null;
  const at = await remoteFetchedMs(dir, key, info.fetchUrls);
  return !at || fail.at >= at ? fail.result : null;
}

// ── status ───────────────────────────────────────────────────────────────────
/** No network. How far refs/heads/<base> is from refs/remotes/<remote>/<base>. */
export async function syncStatus(dir, { base, remote = 'origin' } = {}) {
  if (!dir) return { ok: false, kind: 'failed', error: 'projectDir is required' };
  if (!isSafeBranchName(base)) return { ok: false, kind: 'bad-base', error: 'not a syncable branch name' };
  if (!isSafeRemoteName(remote)) return { ok: false, kind: 'bad-remote', error: 'invalid remote name' };
  const [headSha, remoteSha, fetched, top, shallow, listed, head] = await Promise.all([
    shaOf(dir, `refs/heads/${base}`), shaOf(dir, `refs/remotes/${remote}/${base}`), lastFetchedMs(dir, remote),
    _run(['rev-parse', '--show-toplevel'], { cwd: dir }), _run(['rev-parse', '--is-shallow-repository'], { cwd: dir }),
    checkoutsOf(dir, base), _run(['symbolic-ref', '-q', 'HEAD'], { cwd: dir }),
  ]);
  const checkouts = listed || [];
  const here = top.ok && top.stdout.trim() ? await canonPath(top.stdout.trim()) : null;
  const matchesHere = (p) => !!here && samePath(p, here);
  // dir's own HEAD is authoritative for "checked out HERE" — no path comparison involved. A
  // spelling mismatch must not make a person's own checkout read as "in use elsewhere", which
  // would stop Sync from ever fast-forwarding it (plan §0.5).
  const headIsBase = head.ok && head.stdout.trim() === `refs/heads/${base}`;
  const checkedOutHere = headIsBase || checkouts.some(matchesHere);
  let checkedOutElsewhere = checkouts.filter((p) => !matchesHere(p));
  // HEAD here names the base but no line matched `here` (a spelling difference). git lets a branch be
  // checked out in ONE worktree, so a single remaining line is this one. Anything else stays
  // "elsewhere" → fastForward refuses with in-use (safe: nothing moves).
  if (headIsBase && !checkouts.some(matchesHere) && checkedOutElsewhere.length === 1) checkedOutElsewhere = [];
  let ahead = 0, behind = 0;
  if (headSha && remoteSha && headSha !== remoteSha) {
    const c = await _run(['rev-list', '--left-right', '--count', `refs/heads/${base}...refs/remotes/${remote}/${base}`, '--'], { cwd: dir });
    const m = /^(\d+)\s+(\d+)/.exec(c.stdout.trim());
    if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
  }
  let dirtyCount = 0;
  if (checkedOutHere) {
    const st = await _run(['status', '--porcelain', '--untracked-files=no'], { cwd: dir });
    dirtyCount = st.ok ? st.stdout.split('\n').filter(Boolean).length : 0;
  }
  const out = {
    ok: true, base, remote, hasLocal: !!headSha, hasRemote: !!remoteSha, headSha, remoteSha, ahead, behind,
    dirty: dirtyCount > 0, dirtyCount, detached: !head.ok, checkedOutHere, checkedOutElsewhere, worktreesUnknown: listed === null,
    shallow: shallow.ok && shallow.stdout.trim() === 'true', fetchedAt: iso(fetched),
  };
  out.state = syncState(out);
  return out;
}

/** The commits on <remote>/<base> that <base> lacks, newest first (≤ 50). */
export async function incomingCommits(dir, { base, remote = 'origin', limit = 20 } = {}) {
  if (!isSafeBranchName(base) || !isSafeRemoteName(remote)) return [];
  const n = Math.min(Math.max(1, Math.trunc(Number(limit)) || 20), 50);
  const r = await _run(['log', '--no-color', `--max-count=${n}`, '--format=%H%x1f%ct%x1f%an%x1f%s',
    `refs/heads/${base}..refs/remotes/${remote}/${base}`, '--'], { cwd: dir });
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [sha, ct, author, subject] = line.split('\x1f');
    return { sha, at: iso(Number(ct) * 1000), author: String(author || '').slice(0, 120), subject: String(subject || '').slice(0, 200) };
  });
}

// ── writes (fast-forward only) ───────────────────────────────────────────────
/** Create refs/heads/<base> tracking <remote>/<base> when only the remote has it. */
export async function ensureLocalBranch(dir, { base, remote = 'origin' } = {}) {
  if (!isSafeBranchName(base) || !isSafeRemoteName(remote)) return { ok: false, kind: 'bad-base', error: 'invalid branch or remote name' };
  if (await shaOf(dir, `refs/heads/${base}`)) return { ok: true, created: false };
  const target = await shaOf(dir, `refs/remotes/${remote}/${base}`);
  if (!target) return { ok: false, kind: 'missing', error: `${base} exists neither locally nor on ${remote}` };
  const r = await _run(['branch', '--track', base, `refs/remotes/${remote}/${base}`], { cwd: dir });
  if (!r.ok) return { ok: false, kind: 'failed', error: scrubGitText(r.stderr) };
  return { ok: true, created: true, from: null, to: target, commits: 0 };
}

/**
 * Fast-forward refs/heads/<base> to the LAST FETCHED <remote>/<base>. Refuses anything that
 * is not a fast-forward, a dirty checked-out base, and a base checked out in another worktree.
 * Checked out here + clean → `git merge --ff-only`; not checked out → CAS `git update-ref`.
 */
export async function fastForward(dir, { base, remote = 'origin' } = {}) {
  const s = await syncStatus(dir, { base, remote });
  if (!s.ok) return s;
  if (!s.hasRemote) return { ok: false, kind: 'no-upstream', error: `${remote}/${base} does not exist`, status: s };
  if (!s.hasLocal) return ensureLocalBranch(dir, { base, remote });
  if (s.behind === 0) return { ok: true, from: s.headSha, to: s.headSha, commits: 0, status: s };
  if (s.ahead > 0) return { ok: false, kind: 'diverged', ahead: s.ahead, behind: s.behind, status: s };
  if (s.checkedOutElsewhere.length || (s.worktreesUnknown && !s.checkedOutHere)) return { ok: false, kind: 'in-use', paths: s.checkedOutElsewhere, status: s };
  let r;
  if (s.checkedOutHere) {
    if (s.dirty) return { ok: false, kind: 'dirty', dirtyCount: s.dirtyCount, status: s };
    // `merge` acts on whatever HEAD is NOW: re-check it (a person may have run `git checkout -b feat`
    // since syncStatus), and merge the SHA we measured, not the remote-tracking ref, which a fetch
    // in another process (an Ask child) can move in between. `to`/`commits` then stay exact, and
    // the harness re-points the diff base to exactly the commit HEAD moved to.
    // A blobless clone fetches the new files' blobs during the checkout: give the merge the same
    // read credential the fetch had (v8), or a private hosted repo fails every fast-forward.
    // Minting can take a network round trip, so HEAD is re-checked after it, right before the merge.
    const info = await remoteInfo(dir, remote);
    const cred = info.ok && (info.githubRepo || info.azure) ? await readCred(info) : null;
    const headNow = await _run(['symbolic-ref', '-q', 'HEAD'], { cwd: dir });
    if (!(headNow.ok && headNow.stdout.trim() === `refs/heads/${base}`)) return { ok: false, kind: 'in-use', paths: [], status: s };
    r = await _run(['merge', '--ff-only', '--no-stat', '-q', s.remoteSha], { cwd: dir, timeoutMs: FF_TIMEOUT_MS, env: cred ? cred.env : null });
  } else {
    // Belt and braces: update-ref on a CHECKED-OUT branch would move HEAD under that checkout's
    // index and files (they would read as a staged revert of every upstream commit). Re-read
    // right before writing, and refuse when anything has the branch checked out.
    const [again, headNow] = await Promise.all([checkoutsOf(dir, base), _run(['symbolic-ref', '-q', 'HEAD'], { cwd: dir })]);
    if (again === null || again.length || (headNow.ok && headNow.stdout.trim() === `refs/heads/${base}`)) {
      return { ok: false, kind: 'in-use', paths: again, status: s };
    }
    r = await _run(['update-ref', '-m', `worca sync: fast-forward ${base} to ${remote}/${base}`,
      `refs/heads/${base}`, s.remoteSha, s.headSha], { cwd: dir });
  }
  if (!r.ok) {
    const e = String(r.stderr || '');
    // Re-read: the refusal usually means <base> moved meanwhile (a commit, or a lost update-ref
    // compare-and-swap), and the caller's message must show the counts as they are NOW.
    const now = await syncStatus(dir, { base, remote });
    const status = now.ok ? now : s;
    const kind = /would be overwritten|untracked working tree/i.test(e) ? 'dirty'
      : (/Not possible to fast-forward|diverg/i.test(e) || status.state === 'diverged') ? 'diverged' : 'failed';
    return { ok: false, kind, error: scrubGitText(e), ...(kind === 'diverged' ? { ahead: status.ahead, behind: status.behind } : {}), status };
  }
  return { ok: true, from: s.headSha, to: s.remoteSha, commits: s.behind };
}

// ── composite operations ─────────────────────────────────────────────────────
/**
 * mode 'status' (no network) | 'fetch' | 'ff' (fetch, then fast-forward when safe).
 * → { ok, ...status, fetch, ff, stale }. A failed fetch still answers from cached refs; mode
 * 'status' reports this process's standing fetch failure as stale too (no network).
 */
export async function syncRepo(dir, { base, remote = 'origin', mode = 'status', maxAgeMs = INTERACTIVE_TTL_MS, timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  const f = mode === 'status' ? null : await fetchRemote(dir, { remote, maxAgeMs, timeoutMs });
  if (f && !f.ok && (f.kind === 'no-remote' || f.kind === 'bad-remote')) return { ok: false, kind: f.kind, error: f.error };
  const ff = mode === 'ff' ? await fastForward(dir, { base, remote }) : null;
  const s = await syncStatus(dir, { base, remote });
  const bad = f ? (f.ok ? null : f) : await standingFailure(dir, remote);
  const stale = !!bad;
  return { ...s, fetch: f, ff: ff ? { ok: ff.ok, kind: ff.kind, commits: ff.commits, from: ff.from, to: ff.to, error: ff.error } : null,
    stale, ...(stale ? { fetchError: { kind: bad.kind, message: bad.error } } : {}) };
}

/**
 * A run's own Sync stage for one member: fetch (maxAgeMs 0, long timeout), then decide.
 *   result: 'skipped' | 'no-upstream' | 'created' | 'up-to-date' | 'fetch-failed'
 *         | 'fast-forwarded' | 'remote-start' | 'diverged'
 * `startRef` (a SHA) is set only when the worktree must NOT branch off the local <base>
 * (diverged + onDiverged 'origin', dirty, in-use): the shared checkout is left untouched.
 */
export async function syncBaseForRun(dir, { base, remote = 'origin', timeoutMs = RUN_TIMEOUT_MS, onDiverged = 'fail' } = {}) {
  const log = [];
  const note = (line) => { log.push(scrubGitText(line, 300)); };
  if (!isSafeBranchName(base)) return { result: 'skipped', reason: 'not-a-branch', log };
  note(`git fetch --prune --no-tags ${remote}`);
  const f = await fetchRemote(dir, { remote, timeoutMs, maxAgeMs: 0 });
  if (!f.ok && (f.kind === 'no-remote' || f.kind === 'bad-remote')) { note(`no remote "${remote}" — nothing to sync`); return { result: 'skipped', reason: f.kind, log }; }
  note(f.ok ? `fetched ${remote} (${f.fetchedAt})` : `fetch failed (${f.kind}): ${f.error} — using the last fetch${f.fetchedAt ? ` (${f.fetchedAt})` : ''}`);
  const fetch = f.ok ? { ok: true, fetchedAt: f.fetchedAt } : { ok: false, kind: f.kind, error: f.error, fetchedAt: f.fetchedAt || null };
  try { await stat(join(dir, '.gitmodules')); note('submodules and LFS objects are not synced (out of scope for v1)'); } catch { /* none */ }
  const s = await syncStatus(dir, { base, remote });
  if (!s.ok) return { result: 'skipped', reason: s.kind, fetch, log };
  const common = { fetch, stale: !f.ok, from: s.headSha, remoteSha: s.remoteSha, ahead: s.ahead, behind: s.behind, shallow: s.shallow };
  if (!s.hasRemote) { note(`${remote}/${base} does not exist — starting from the local ${base}`); return { result: 'no-upstream', ...common, to: s.headSha, log }; }
  if (!s.hasLocal) {
    const c = await ensureLocalBranch(dir, { base, remote });
    note(c.ok ? `created local ${base} tracking ${remote}/${base} (${short(s.remoteSha)})` : `could not create ${base}: ${c.error}`);
    return c.ok ? { result: 'created', ...common, to: s.remoteSha, commits: 0, log } : { result: 'skipped', reason: c.kind, ...common, log };
  }
  const atLeast = s.shallow ? 'at least ' : '';
  if (s.behind === 0) {
    note(`${base} is up to date with ${remote}/${base}${s.ahead ? ` (${s.ahead} local commit(s) not on ${remote})` : ''}`);
    return { result: f.ok ? 'up-to-date' : 'fetch-failed', ...common, to: s.headSha, commits: 0, log };
  }
  if (s.ahead > 0) {
    note(`${base} has diverged from ${remote}/${base}: ${atLeast}${s.ahead} ahead, ${atLeast}${s.behind} behind`);
    if (onDiverged !== 'origin') return { result: 'diverged', ...common, log };
    note(`starting the run from ${remote}/${base} (${short(s.remoteSha)}); ${base} is left untouched`);
    return { result: 'remote-start', reason: 'diverged', startRef: s.remoteSha, ...common, to: s.remoteSha, commits: s.behind, log };
  }
  note(s.checkedOutHere ? `git merge --ff-only ${remote}/${base}` : `git update-ref refs/heads/${base} ${short(s.remoteSha)} (fast-forward, ${base} not checked out)`);
  const ff = await fastForward(dir, { base, remote });
  if (ff.ok) {
    note(`fast-forwarded ${base} ${short(ff.from)}..${short(ff.to)} (${atLeast}${ff.commits} commit(s))`);
    // remoteSha = ff.to (v8): fastForward re-read the status, and an Ask child's fetch in between
    // would leave common.remoteSha behind `to`; resume / Ship it measure "moved since" from it.
    return { result: 'fast-forwarded', ...common, remoteSha: ff.to, to: ff.to, commits: ff.commits, log };
  }
  // Someone committed on <base> between syncStatus and the fast-forward: it is diverged NOW,
  // so the member's onDiverged applies (a 'fail' project must not silently start from the remote).
  if (ff.kind === 'diverged' && onDiverged !== 'origin') {
    note(`${base} diverged from ${remote}/${base} while syncing; nothing was moved`);
    // The counts from BEFORE the fast-forward read "0 ahead": report the re-read ones.
    return { result: 'diverged', ...common, ahead: ff.ahead ?? common.ahead, behind: ff.behind ?? common.behind, log };
  }
  note(`not moving ${base} (${ff.kind}${ff.kind === 'dirty' ? `: ${s.dirtyCount} changed file(s)` : ''}); the run starts from ${remote}/${base} (${short(s.remoteSha)}) in a fresh worktree`);
  return { result: 'remote-start', reason: ff.kind, startRef: s.remoteSha, ...common, to: s.remoteSha, commits: s.behind, log };
}

// ── base conflicts (#620) ────────────────────────────────────────────────────
export const BASE_CHECK_FETCH_TIMEOUT_MS = 20_000;
const MERGE_TREE_TIMEOUT_MS = 120_000;
const CONFLICT_FILES_CAP = 200;
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The read credential env for `remote` (GitHub/Azure); null = this machine's git (fastForward's rule). */
async function readEnvFor(dir, remote) {
  const info = isSafeRemoteName(remote) ? await remoteInfo(dir, remote) : { ok: false };
  return info.ok && (info.githubRepo || info.azure) ? (await readCred(info)).env : null;
}

/** Where the base lives: the fetched <remote>/<base> when present, else the local <base> (Q&A base-ref). */
async function baseTip(dir, base, remote) {
  const remoteSha = remote ? await shaOf(dir, `refs/remotes/${remote}/${base}`) : null;
  if (remoteSha) return { ref: `${remote}/${base}`, sha: remoteSha, remote };
  const localSha = await shaOf(dir, `refs/heads/${base}`);
  return localSha ? { ref: base, sha: localSha, remote: null } : null;
}

/** NUL-separated names, deduplicated (merge-tree --name-only can repeat a path). */
const nulNames = (s) => [...new Set(String(s || '').split('\0').filter(Boolean))];

/**
 * Would `feature` still merge into its base? Fetches <remote> (maxAgeMs as fetchRemote), then
 * `git merge-tree --write-tree` in `dir` (no checkout, no ref moves). Never throws.
 * → { status: 'up-to-date'|'clean'|'conflicts'|'error'|'no-branch', base, baseRef, remote, baseSha, headSha,
 *     feature, behind, files, fileCount, tree?, stale, fetchError?, kind?, error?, at }
 */
export async function checkBaseMerge(dir, { base, feature, remote = 'origin', fetch = true, maxAgeMs = 0,
  timeoutMs = BASE_CHECK_FETCH_TIMEOUT_MS } = {}) {
  const at = new Date().toISOString();
  const fail = (kind, error, extra = {}) => ({ status: 'error', kind, error: scrubGitText(error, 500), base: base ?? null,
    feature: feature ?? null, files: [], fileCount: 0, at, ...extra });
  if (!dir) return fail('failed', 'projectDir is required');
  if (!isSafeBranchName(base)) return fail('bad-base', `not a mergeable base branch: ${String(base).slice(0, 80)}`);
  if (!isSafeBranchName(feature)) return fail('bad-branch', `not a branch name: ${String(feature).slice(0, 80)}`);
  const r = isSafeRemoteName(remote) ? remote : 'origin';
  let fetchError = null;
  let useRemote = true;
  if (fetch) {
    const f = await fetchRemote(dir, { remote: r, timeoutMs, maxAgeMs });
    // No such remote: the local base is the base, nothing is stale. Any other failure: the last fetch.
    if (!f.ok && (f.kind === 'no-remote' || f.kind === 'bad-remote')) useRemote = false;
    else if (!f.ok) fetchError = { kind: f.kind, message: f.error };
  }
  const headSha = await shaOf(dir, `refs/heads/${feature}`);
  if (!headSha) return { status: 'no-branch', base, feature, files: [], fileCount: 0, at };
  const tip = await baseTip(dir, base, useRemote ? r : null);
  if (!tip) return fail('missing-base', `${base} exists neither locally nor on ${r}`, { headSha });
  const common = { base, baseRef: tip.ref, remote: tip.remote, baseSha: tip.sha, headSha, feature, at,
    stale: !!fetchError, ...(fetchError ? { fetchError } : {}) };
  const behind = await commitsBetween(dir, headSha, tip.sha);
  if (behind === null) return fail('failed', 'could not count the base commits', common);
  if (behind === 0) return { status: 'up-to-date', behind: 0, files: [], fileCount: 0, ...common };
  const env = tip.remote ? await readEnvFor(dir, tip.remote) : null;
  const m = await _run(['merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', headSha, tip.sha],
    { cwd: dir, timeoutMs: MERGE_TREE_TIMEOUT_MS, env });
  // `-z --name-only --no-messages` prints "<tree>\0" (clean, exit 0) or "<tree>\0<path>\0…" (conflicts, exit 1).
  // git ALSO exits 1 with an empty stdout for an object it cannot merge, so a result counts only with a tree OID.
  const [tree, ...rest] = nulNames(m.stdout);
  if (SHA_RE.test(tree || '') && m.code === 0) return { status: 'clean', behind, tree, files: [], fileCount: 0, ...common };
  if (SHA_RE.test(tree || '') && m.code === 1 && rest.length) {
    return { status: 'conflicts', behind, files: rest.slice(0, CONFLICT_FILES_CAP), fileCount: rest.length, ...common };
  }
  if (m.code === 129 || /usage: git merge-tree/.test(m.stderr)) {
    return fail('git-too-old', 'The conflict check needs git 2.38 or newer (git merge-tree --write-tree).', common);
  }
  return fail(m.timedOut ? 'timeout' : 'failed', m.stderr || `git merge-tree exited ${m.code}`, common);
}

/** Canonical worktree paths with refs/heads/<branch> checked out, null when git cannot list them (checkoutsOf). */
export const branchCheckouts = (dir, branch) => checkoutsOf(dir, branch);

/**
 * Update branch (#620): a merge commit of `baseSha` into `feature`. Not checked out anywhere: commit-tree on the
 * merge-tree result + a compare-and-swap update-ref (no checkout moves). Checked out in ONE clean worktree that
 * is on the branch at `headSha`: `git merge --no-ff` there. Never throws.
 * → { ok:true, from, to, via:'commit-tree'|'merge', path? } | { ok:false, kind:'in-use'|'dirty'|'moved'|'identity'|'not-clean'|'failed'|'bad-request', error, path? }
 */
export async function mergeBaseInto(dir, { feature, baseSha, headSha, baseRef, tree = null, remote = null } = {}) {
  if (!isSafeBranchName(feature) || !SHA_RE.test(baseSha || '') || !SHA_RE.test(headSha || '')) {
    return { ok: false, kind: 'bad-request', error: 'invalid branch or commit' };
  }
  const message = `Merge ${baseRef || baseSha.slice(0, 10)} into ${feature}`;
  const holders = await checkoutsOf(dir, feature);
  if (holders === null || holders.length > 1) return { ok: false, kind: 'in-use', error: 'git could not tell where the branch is checked out' };
  if (holders.length === 1) {
    const wt = holders[0];
    const head = await _run(['symbolic-ref', '-q', 'HEAD'], { cwd: wt });
    if (!(head.ok && head.stdout.trim() === `refs/heads/${feature}`)) return { ok: false, kind: 'in-use', path: wt, error: `${wt} is not on ${feature}` };
    if (await shaOf(wt, 'HEAD') !== headSha) return { ok: false, kind: 'moved', error: `${feature} moved since the check` };
    const st = await _run(['status', '--porcelain', '--untracked-files=no'], { cwd: wt });
    if (!st.ok || st.stdout.trim()) return { ok: false, kind: 'dirty', path: wt, error: `${wt} has uncommitted changes` };
    const env = remote ? await readEnvFor(wt, remote) : null;
    const r = await _run(['merge', '--no-ff', '--no-edit', '-q', '-m', message, baseSha], { cwd: wt, timeoutMs: FF_TIMEOUT_MS, env });
    if (!r.ok) {
      await _run(['merge', '--abort'], { cwd: wt });
      return { ok: false, kind: 'failed', path: wt, error: scrubGitText(r.stderr) || `git merge exited ${r.code}` };
    }
    return { ok: true, from: headSha, to: await shaOf(wt, 'HEAD'), via: 'merge', path: wt };
  }
  let t = tree;
  if (!t) {
    const m = await _run(['merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', headSha, baseSha],
      { cwd: dir, timeoutMs: MERGE_TREE_TIMEOUT_MS, env: remote ? await readEnvFor(dir, remote) : null });
    [t] = nulNames(m.stdout);
    if (m.code !== 0 || !SHA_RE.test(t || '')) {
      return { ok: false, kind: m.code === 1 && SHA_RE.test(t || '') ? 'not-clean' : 'failed', error: scrubGitText(m.stderr) || 'the merge is not clean' };
    }
  }
  const c = await _run(['commit-tree', t, '-p', headSha, '-p', baseSha, '-m', message], { cwd: dir });
  if (!c.ok || !SHA_RE.test(c.stdout.trim())) {
    const identity = /Author identity unknown|tell me who you are|unable to auto-detect email/i.test(c.stderr);
    return { ok: false, kind: identity ? 'identity' : 'failed', error: scrubGitText(c.stderr) || 'git commit-tree failed' };
  }
  const to = c.stdout.trim();
  // Belt and braces (fastForward's rule): a checkout that appeared meanwhile must not see its ref move.
  const again = await checkoutsOf(dir, feature);
  if (again === null || again.length) return { ok: false, kind: 'in-use', error: `${feature} was checked out meanwhile` };
  const u = await _run(['update-ref', '-m', `worca: ${message}`, `refs/heads/${feature}`, to, headSha], { cwd: dir });
  if (!u.ok) return { ok: false, kind: 'moved', error: scrubGitText(u.stderr) || `${feature} moved since the check` };
  return { ok: true, from: headSha, to, via: 'commit-tree' };
}

/** Unmerged paths of a worktree's index (a merge in progress). */
async function unmergedFiles(wt) {
  const r = await _run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: wt });
  return r.ok ? nulNames(r.stdout) : [];
}

/**
 * Resolve in a terminal (#620): start `git merge --no-ff --no-commit <baseSha>` in a run's checkout and leave the
 * conflicts for a person. A merge already in progress is reported as is (idempotent). Never throws.
 * → { ok:true, started, files } | { ok:false, kind:'in-use'|'dirty'|'failed', error }
 */
export async function startConflictMerge(wt, { feature, baseSha, baseRef, remote = null } = {}) {
  if (!isSafeBranchName(feature) || !SHA_RE.test(baseSha || '')) return { ok: false, kind: 'failed', error: 'invalid branch or commit' };
  const head = await _run(['symbolic-ref', '-q', 'HEAD'], { cwd: wt });
  if (!(head.ok && head.stdout.trim() === `refs/heads/${feature}`)) return { ok: false, kind: 'in-use', error: `${wt} is not on ${feature}` };
  if (await shaOf(wt, 'MERGE_HEAD')) return { ok: true, started: false, files: await unmergedFiles(wt) };
  const st = await _run(['status', '--porcelain', '--untracked-files=no'], { cwd: wt });
  if (!st.ok || st.stdout.trim()) return { ok: false, kind: 'dirty', error: `${wt} has uncommitted changes; commit or discard them first` };
  const env = remote ? await readEnvFor(wt, remote) : null;
  const r = await _run(['merge', '--no-ff', '--no-commit', '-m', `Merge ${baseRef || baseSha.slice(0, 10)} into ${feature}`, baseSha],
    { cwd: wt, timeoutMs: FF_TIMEOUT_MS, env });
  const files = await unmergedFiles(wt);
  if (!r.ok && !files.length) {
    await _run(['merge', '--abort'], { cwd: wt });
    return { ok: false, kind: 'failed', error: scrubGitText(r.stderr) || `git merge exited ${r.code}` };
  }
  return { ok: true, started: true, files };
}

/** Files (of `files`) on `ref`'s tip that still hold conflict markers (D13); a structured failure on doubt. */
export async function conflictMarkers(dir, ref, files) {
  const list = (files || []).filter((f) => typeof f === 'string' && f && !f.startsWith('-'));
  if (!list.length || !isSafeBranchName(ref)) return [];
  const r = await _run(['grep', '-l', '-I', '-E', '^(<{7}|>{7})( |$)', `refs/heads/${ref}`, '--', ...list], { cwd: dir });
  // git grep prints "<rev>:<path>"; exit 1 alone means a verified no-match. Other failures fail closed.
  if (r.ok) return [...new Set(r.stdout.split('\n').filter(Boolean).map((l) => l.slice(l.indexOf(':') + 1)))];
  if (r.code === 1 && !r.timedOut) return [];
  return { ok: false, kind: r.timedOut ? 'timeout' : 'failed', error: scrubGitText(r.stderr) || `git grep exited ${r.code}` };
}

/** Resolve a user/model-named source: local ref first, then (after a TTL fetch) <remote>/<name>. */
export async function resolveSourceRef(dir, name, { remote = 'origin', fetch = true, maxAgeMs = INTERACTIVE_TTL_MS, timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  if (typeof name !== 'string' || !name || name.startsWith('-')) return { ok: false, kind: 'bad-ref' };
  if (await shaOf(dir, name)) {
    const st = isSafeBranchName(name) ? await syncStatus(dir, { base: name, remote }) : null;
    return { ok: true, ref: name, local: true, remoteOnly: false, ...(st && st.ok && st.hasRemote ? { behind: st.behind, ahead: st.ahead } : {}) };
  }
  if (!isSafeBranchName(name) || !isSafeRemoteName(remote)) return { ok: false, kind: 'missing' };
  const f = fetch ? await fetchRemote(dir, { remote, maxAgeMs, timeoutMs }) : null;
  if (await shaOf(dir, `refs/remotes/${remote}/${name}`)) {
    return { ok: true, ref: `${remote}/${name}`, local: false, remoteOnly: true, fetchedAt: f?.fetchedAt || null, stale: !!(f && !f.ok) };
  }
  // A name already spelled `<remote>/<branch>` that only this fetch brought in.
  if (name.startsWith(`${remote}/`) && await shaOf(dir, `refs/remotes/${name}`)) {
    return { ok: true, ref: name, local: false, remoteOnly: true, fetchedAt: f?.fetchedAt || null, stale: !!(f && !f.ok) };
  }
  return { ok: false, kind: f && !f.ok && f.kind !== 'no-remote' ? 'stale' : 'missing', ...(f && !f.ok ? { fetchError: { kind: f.kind, message: f.error } } : {}) };
}

/** Local + <remote> branches with tip facts and ahead/behind (for Ask list_branches). */
export async function listBranches(dir, { remote = 'origin', fresh = true, pattern = null, limit = 100, maxAgeMs = INTERACTIVE_TTL_MS, timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  if (!dir) return { ok: false, kind: 'failed', error: 'projectDir is required' };
  const safeRemote = isSafeRemoteName(remote) ? remote : 'origin';
  const f = fresh ? await fetchRemote(dir, { remote: safeRemote, maxAgeMs, timeoutMs }) : null;
  // Without a fetch, ask git whether the remote exists at all (no network).
  const hasRemote = f ? !(!f.ok && (f.kind === 'no-remote' || f.kind === 'bad-remote'))
    : (await remoteInfo(dir, safeRemote)).ok;
  const fmt = '%(refname)%1f%(objectname)%1f%(committerdate:iso-strict)%1f%(authorname)%1f%(subject)';
  const r = await _run(['for-each-ref', `--format=${fmt}`, 'refs/heads/', `refs/remotes/${safeRemote}/`], { cwd: dir });
  if (!r.ok) return { ok: false, kind: 'failed', error: scrubGitText(r.stderr) };
  const byName = new Map();
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    const [ref, sha, at, author, subject] = line.split('\x1f');
    let name, side;
    if (ref.startsWith('refs/heads/')) { name = ref.slice(11); side = 'local'; }
    else { name = ref.slice(`refs/remotes/${safeRemote}/`.length); side = 'remote'; if (name === 'HEAD') continue; }
    const e = byName.get(name) || { name };
    e[side] = { sha, at, author, subject };
    byName.set(name, e);
  }
  const needle = typeof pattern === 'string' && pattern ? pattern.toLowerCase() : null;
  // iso-strict dates carry per-commit offsets, so compare instants, not strings.
  const when = (e) => Date.parse((e.local || e.remote).at) || 0;
  const all = [...byName.values()].filter((e) => !needle || e.name.toLowerCase().includes(needle))
    .sort((a, b) => when(b) - when(a) || a.name.localeCompare(b.name));
  const cap = Math.min(Math.max(1, Math.trunc(Number(limit)) || 100), 200);
  const rows = await mapWithCap(all.slice(0, cap), 8, async (e) => {
    const tip = e.local || e.remote;
    let ahead = 0, behind = 0;
    if (e.local && e.remote && e.local.sha !== e.remote.sha) {
      const c = await _run(['rev-list', '--left-right', '--count', `refs/heads/${e.name}...refs/remotes/${safeRemote}/${e.name}`, '--'], { cwd: dir });
      const m = /^(\d+)\s+(\d+)/.exec(c.stdout.trim());
      if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
    }
    return { name: e.name, hasLocal: !!e.local, hasRemote: !!e.remote, sha: tip.sha, ...(e.remote && e.local ? { remoteSha: e.remote.sha } : {}),
      ahead, behind, at: tip.at, author: tip.author, subject: tip.subject };
  });
  const cur = await _run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: dir });
  return {
    ok: true, remote: hasRemote ? safeRemote : null, current: cur.ok ? cur.stdout.trim() : null, branches: rows,
    total: all.length, truncated: all.length > rows.length, fetchedAt: iso(await lastFetchedMs(dir, safeRemote)),
    stale: !!(f && !f.ok && hasRemote), ...(f && !f.ok && hasRemote ? { fetchError: { kind: f.kind, message: f.error } } : {}),
  };
}

/**
 * Normalize the harness's `opts.sync` (absent → disabled: CLI, resume and tests keep today's
 * behaviour). Shape the server passes (plan §5.4):
 *   { members: { [projectKey]: { enabled, remote, onDiverged, policySource } }, timeoutMs }
 * memberFor(key) → { enabled, remote, onDiverged:'origin'|'fail', policySource } (never throws).
 */
export function runSyncOptions(input) {
  const o = input && typeof input === 'object' ? input : {};
  const members = o.members && typeof o.members === 'object' ? o.members : {};
  const memberFor = (projectKey) => {
    const m = members[projectKey] && typeof members[projectKey] === 'object' ? members[projectKey] : {};
    return {
      enabled: m.enabled === true,
      remote: isSafeRemoteName(m.remote) ? m.remote : 'origin',
      onDiverged: m.onDiverged === 'origin' ? 'origin' : 'fail',
      policySource: ['user', 'schedule', 'setting'].includes(m.policySource) ? m.policySource : 'setting',
    };
  };
  return {
    enabled: Object.keys(members).some((k) => memberFor(k).enabled),
    memberFor,
    timeoutMs: Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : RUN_TIMEOUT_MS,
  };
}

// Test seam: swap the git runner. Mirrors git-info.mjs#_testing.
export const _testing = {
  defaultRun,
  QUIET_ENV,
  NETWORK_CMDS,
  setRunner(fn) { _run = typeof fn === 'function' ? fn : defaultRun; },
  reset() { _run = defaultRun; inflight.clear(); failed.clear(); ownFetch.clear(); lastGood.clear(); },
  /** Forget this process's fetch memory only (simulates another process; the runner stays). */
  forgetProcess() { inflight.clear(); failed.clear(); ownFetch.clear(); lastGood.clear(); },
};
