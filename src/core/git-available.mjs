// src/core/git-available.mjs — is git usable on this machine (CONTRACT §0, DECISIONS R3, SEAMS S1/S2).
import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { findOnPath as defaultFindOnPath } from './actions/builtins.mjs';

export const GIT_MISSING = Object.freeze({ code: 'GIT_MISSING', message: 'git is not installed on this machine' });
/** Without git, team branches and plugin sources work on GitHub only (P6 speaks the GitHub API): a Bitbucket one says so. */
export const BITBUCKET_NEEDS_GIT = 'git is required for Bitbucket repositories here: install git where worca runs (without git, team branches and plugin sources work on GitHub only)';
// The HOST is bitbucket.org (or a subdomain: altssh.): after scheme://[user@], or before the first ":" / "/" (scp, host slug).
const BITBUCKET_REF_RE = /^\s*(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?(?:[a-z0-9-]+\.)*bitbucket\.org(?::|\/|$)/i;
/** The "needs git" message for a slug, URL or remote: Bitbucket's own, else GIT_MISSING's. Code stays GIT_MISSING. */
export function gitMissingMessage(ref) { return BITBUCKET_REF_RE.test(String(ref ?? '')) ? BITBUCKET_NEEDS_GIT : GIT_MISSING.message; }
export const GIT_PROBE_TIMEOUT_MS = 5_000;
const MAC_SHIM = '/usr/bin/git';
// worca's macOS stub (nogit-stub.mjs) leads PATH in every terminal, agent and script started while git was missing.
// A worca process started from one (`worca ui restart` in a worca terminal) must neither probe nor spawn it by name,
// or git stays "missing" there after it is installed: drop it from this process's PATH before anything spawns git.
export const pathWithoutNoGitStub = (p) => String(p ?? '').split(':').filter((d) => posix.basename(d) !== 'nogit-bin').join(':');
if (process.platform !== 'win32' && /(^|\/)nogit-bin\/?(:|$)/.test(process.env.PATH ?? '')) process.env.PATH = pathWithoutNoGitStub(process.env.PATH);
const NOT_PROBED = Object.freeze({ available: false, path: null, version: null, reason: 'not-probed', checkedAt: 0 });
const forced = (env, at) => (env.WORCA_GIT === '0' ? { ...NOT_PROBED, reason: 'forced-off', checkedAt: at }
  : env.WORCA_GIT === '1' ? { ...NOT_PROBED, available: true, reason: 'forced-on', checkedAt: at } : null);
const defaultExists = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
// .native: the on-disk spelling (JS realpathSync keeps the caller's case on case-insensitive APFS: /USR/BIN/git).
const defaultRealpath = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const defaultExec = (file, args, { env, timeoutMs }) => new Promise((resolve) => {
  execFile(file, args, { env, timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout ?? ''), timedOut: !!err?.killed });
  });
});

export async function probeGit({ env = process.env, platform = process.platform, findOnPath = defaultFindOnPath,
  exec = defaultExec, exists = defaultExists, realpath = defaultRealpath } = {}) {
  const f = forced(env, Date.now());
  if (f) return f;
  // win32: only what a shell-less spawn('git') can start — libuv appends .com then .exe, never .cmd/.bat
  // (lower case: the name git for Windows ships, and what a case-insensitive stat answers).
  // libuv also accepts a quoted entry ("C:\Program Files\Git\cmd"): unquote, so the lookup sees what spawn sees.
  const winEnv = () => ({ ...env, PATH: String(env.PATH ?? env.Path ?? '').split(';').map((d) => d.replace(/^"(.*)"$/, '$1')).join(';'), PATHEXT: '.com;.exe' });
  const hit = findOnPath('git', { env: platform === 'win32' ? winEnv() : env, platform, exists });
  if (!hit) return { ...NOT_PROBED, reason: 'not-on-path', checkedAt: Date.now() };
  const done = (reason, extra = {}) => ({ ...NOT_PROBED, path: hit, reason, checkedAt: Date.now(), ...extra });
  if (platform === 'darwin' && realpath(hit).toLowerCase() === MAC_SHIM) {
    // The CLT shim opens the install dialog whenever it runs without the tools: ask xcode-select, never the shim.
    const xs = await exec('/usr/bin/xcode-select', ['-p'], { env, timeoutMs: GIT_PROBE_TIMEOUT_MS });
    const dir = xs.code === 0 ? xs.stdout.trim() : '';
    if (!dir || !exists(posix.join(dir, 'usr', 'bin', 'git'))) return done('xcode-clt-missing');
  }
  const v = await exec(hit, ['--version'], { env, timeoutMs: GIT_PROBE_TIMEOUT_MS });
  const m = v.code === 0 ? /^git version (\S+)/.exec(v.stdout.trim()) : null;
  return m ? done('ok', { available: true, version: m[1] }) : done('probe-failed');
}

let state = NOT_PROBED;
let inflight = null;
let probeImpl = () => probeGit();
const listeners = new Set();
function commit(next) {
  const prev = state;
  state = Object.freeze({ ...next });
  if (state.available !== prev.available) for (const fn of [...listeners]) { try { fn(state); } catch { /* a listener never breaks the flip */ } }
  return state;
}
const envForced = () => forced(process.env, Date.now());
export function gitAvailable() {
  return process.env.WORCA_GIT === '0' ? false : process.env.WORCA_GIT === '1' ? true : state.available;
}
export function currentGitState() { return { ...(envForced() ?? state) }; }
export function gitState({ maxAgeMs = 60_000, fresh = false } = {}) {
  const f = envForced();
  if (f) return Promise.resolve(f);
  if (!fresh && state.reason !== 'not-probed' && Date.now() - state.checkedAt < maxAgeMs) return Promise.resolve({ ...state });
  inflight ??= Promise.resolve().then(probeImpl)
    .then(commit, () => commit({ ...NOT_PROBED, reason: 'probe-failed', checkedAt: Date.now() }))
    .finally(() => { inflight = null; });
  return inflight.then((s) => ({ ...s }));
}
export function onGitChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function gitMissingResult() { return { ok: false, stdout: '', stderr: GIT_MISSING.message, code: -1 }; }
export function gitMissingError(ref) { const e = new Error(gitMissingMessage(ref)); e.code = GIT_MISSING.code; return e; }
export const _testing = {
  set(partial = {}) {
    return commit({ ...NOT_PROBED, reason: partial.available === true ? 'forced-on' : 'forced-off', checkedAt: Date.now(), ...partial, available: partial.available === true });
  },
  reset() { state = NOT_PROBED; inflight = null; probeImpl = () => probeGit(); },
  useProbe(fn) { probeImpl = fn || (() => probeGit()); },
};
