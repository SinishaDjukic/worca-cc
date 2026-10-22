// src/core/git-guard.mjs — the env for every git call worca runs in a project or run checkout (security G2).
//
// A run's agent can write the project's `.git`: run checkouts share its hooks and config, and on a hosted
// container agents and server share the projects group (docker/entrypoint.sh, core.sharedRepository group).
// Several config keys make git run a command: core.fsmonitor on any index refresh (status, add, diff),
// filter drivers on add/checkout, diff drivers and textconv on diff, merge drivers on merge, credential
// helpers, gpg programs and core.sshCommand on commit/push/fetch, plus every hook. Those commands would run
// as worca, with the server's secrets and the call's push token. So worca never lets repository-local
// config (scopes `local` and `worktree`, includes too) pick a command:
//
//  - Static keys are ALWAYS overridden, whatever the repository says, with the value from a trusted scope
//    (system, global, worca's own GIT_CONFIG_* / -c) or a neutral default. These are race-free: an agent
//    that rewrites .git/config between the listing below and the call changes nothing.
//  - The proxy keys (http.proxy, http.<url>.proxy, remote.<x>.proxy) are overridden only where the repository sets
//    them (read from the listing, like the named keys below): git reads an empty proxy as "no proxy, ignore
//    HTTPS_PROXY", so a pin with nothing trusted to give would send every call around worca's local or the
//    corporate proxy. The stand-in is what git would have used without the repository's value: the trusted one,
//    else the env proxy.
//  - Keys named by a driver or URL (filter.<x>.clean, diff.<x>.textconv, merge.<x>.driver, http.<url>.proxy,
//    …) cannot be named in advance: they come from `git config --list --show-scope`, read just before the
//    call. A config rewritten in the moment between that read and the call is not seen (a narrow race that
//    needs an agent process still running; making .git/config not agent-writable on hosted setups closes it).
//  - Keys git reads first-wins (remote.<x>.uploadpack/receivepack, core.gitProxy) cannot be overridden at all:
//    a repository that sets them locally is refused.
//
// Two safe local shapes are kept, pinned to the value read: a per-repo `core.sshCommand` that only picks a
// key (`ssh -i <path>`, deploy keys) and `git lfs install --local`'s exact filter commands.
//
// Hooks never run, except where a caller asks for them (`hooks: true`, worca's end-of-run commit and Apply
// to branch, which have always run the project's commit hooks): then the repository's own hooks run, as on
// a person's machine, unless agents run under their own user (agentIdentity) — there a hook is the agent's
// code and would run as worca, so it never runs.
// System config is trusted (not GIT_CONFIG_NOSYSTEM): it is not agent-writable and carries git-lfs and the
// platform credential manager.

import { execFile, execFileSync } from 'node:child_process';
import { devNull, homedir } from 'node:os';
import { join } from 'node:path';
import { agentIdentity } from './agent-user.mjs';

const LIST_ARGS = ['config', '--list', '--show-scope', '-z'];
const LIST_TIMEOUT_MS = 10_000;
/** The listing's timeout: its own 10 s, or the caller's smaller budget for the whole git call. */
const listTimeout = (budget) => (budget > 0 ? Math.min(budget, LIST_TIMEOUT_MS) : LIST_TIMEOUT_MS);
const UNTRUSTED = new Set(['local', 'worktree']);

/** A hooks path that holds no hooks: the null device on POSIX; on Windows a worca-home folder that does not exist. */
export function noHooksPath(platform = process.platform) {
  if (platform !== 'win32') return devNull;
  return join(process.env.WORCA_HOME || join(homedir(), '.worca-cc'), 'no-hooks');
}

/** `git config --list --show-scope -z` → [{ scope, key, value }]; a key given without `=` has value null. */
export function parseConfigList(out) {
  const parts = String(out || '').split('\0');
  const list = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const kv = parts[i + 1];
    const nl = kv.indexOf('\n');
    list.push({ scope: parts[i], key: nl < 0 ? kv : kv.slice(0, nl), value: nl < 0 ? null : kv.slice(nl + 1) });
  }
  return list;
}

// Lower-case section and name, keep the subsection (git's own spelling of a key); `--list` already does this.
const norm = (key) => {
  const a = key.indexOf('.'), b = key.lastIndexOf('.');
  return a === b ? key.toLowerCase() : `${key.slice(0, a).toLowerCase()}${key.slice(a, b)}${key.slice(b).toLowerCase()}`;
};
const valueOf = (e) => (e.value == null ? 'true' : e.value);

// Pick a key only: `ssh` plus -i/-p/-o IdentitiesOnly|IdentityFile|Port, every word shell-inert.
const SAFE_WORD = /^[A-Za-z0-9_./~@%+=:,-]+$/;
const SAFE_SSH_OPT = /^(IdentitiesOnly=(yes|no)|IdentityFile=.+|Port=\d+)$/i;
export function safeLocalSshCommand(v) {
  const w = String(v ?? '').trim().split(/\s+/);
  if (w[0] !== 'ssh' || !w.every((x) => SAFE_WORD.test(x))) return false;
  for (let i = 1; i < w.length; i += 2) {
    if (w[i] === '-i' || w[i] === '-p') { if (w[i + 1] == null) return false; continue; }
    if (w[i] === '-o' && SAFE_SSH_OPT.test(w[i + 1] ?? '')) continue;
    return false;
  }
  return true;
}
const LFS = { clean: 'git-lfs clean -- %f', smudge: 'git-lfs smudge -- %f', process: 'git-lfs filter-process' };

const FIRST_WINS = [/^remote\..+\.(uploadpack|receivepack)$/, /^core\.gitproxy$/];
// Named keys: [pattern, neutral value when no trusted scope sets the same key]. An empty filter command passes
// content through; textconv `cat` and merge-file stand in for git's own behaviour (an empty one fails to run).
// An empty diff command fails the diff instead of running something; git has no value that turns diff.external
// off, so it is listed here too, and worca's patch diffs pass --no-ext-diff (race-free).
const NAMED = [
  [/^diff\.external$/, ''],
  [/^filter\..+\.(clean|smudge|process)$/, ''],
  [/^diff\..+\.textconv$/, 'cat'],
  [/^diff\..+\.command$/, ''],
  [/^merge\..+\.driver$/, 'git merge-file --marker-size=%L %A %O %B'],
  [/^http\..+\.sslverify$/, 'true'],
  [/^http\..+\.curloptresolve$/, ''],
  [/^trailer\..+\.(command|cmd)$/, ''],
];

const PROXY_KEY = /^(http\.proxy|http\..+\.proxy|remote\..+\.proxy)$/;
/** The proxy git takes from the env for a `url` (https unless it says http): https_proxy, HTTPS_PROXY (http_proxy
 *  for http), then all_proxy, ALL_PROXY; lower case first, as git and curl read them. '' when none is set. */
export function envProxy(env, url = '') {
  const names = /^http:/i.test(url) ? ['http_proxy'] : ['https_proxy', 'HTTPS_PROXY'];
  for (const k of [...names, 'all_proxy', 'ALL_PROXY']) if (env?.[k]) return env[k];
  return '';
}

/**
 * The GIT_CONFIG_* entries that keep repository-local config from choosing a command, for one listing.
 * Pure. `refused` names a first-wins key set locally (the call must not run).
 * @returns {{ entries: Array<[string,string]>, refused: string|null }}
 */
export function guardEntries(list, { env = process.env, hooks = false, isolated = agentIdentity() !== null } = {}) {
  const all = (list || []).map((e) => ({ ...e, key: norm(e.key) }));
  const trusted = all.filter((e) => !UNTRUSTED.has(e.scope));
  const local = all.filter((e) => UNTRUSTED.has(e.scope));
  const lastOf = (rows, ...keys) => { let v; for (const e of rows) if (keys.includes(e.key)) v = valueOf(e); return v; };
  const refused = local.find((e) => FIRST_WINS.some((re) => re.test(e.key)))?.key ?? null;
  const entries = [];
  const pin = (key, fallback) => entries.push([key, lastOf(trusted, key) ?? fallback]);
  const replay = (match) => { for (const e of trusted) if (match(e.key)) entries.push([e.key, valueOf(e)]); };

  if (!hooks || isolated) entries.push(['core.hooksPath', noHooksPath()]);
  pin('core.fsmonitor', 'false');
  const localSsh = lastOf(local, 'core.sshcommand');
  entries.push(['core.sshCommand', localSsh !== undefined && safeLocalSshCommand(localSsh) ? localSsh
    : lastOf(trusted, 'core.sshcommand') ?? (env.GIT_SSH ? `'${String(env.GIT_SSH).replace(/'/g, `'\\''`)}'` : 'ssh')]);
  pin('core.askPass', '');
  entries.push(['core.editor', ':'], ['sequence.editor', ':']);
  pin('core.alternateRefsCommand', '');
  // gpg.program is another name for gpg.openpgp.program: both get the trusted value of either.
  const openpgp = lastOf(trusted, 'gpg.program', 'gpg.openpgp.program') ?? 'gpg';
  entries.push(['gpg.program', openpgp], ['gpg.openpgp.program', openpgp]);
  pin('gpg.x509.program', 'gpgsm');
  pin('gpg.ssh.program', 'ssh-keygen');
  pin('gpg.ssh.defaultKeyCommand', '');
  pin('http.sslVerify', 'true');
  entries.push(['http.curloptResolve', '']); replay((k) => k === 'http.curloptresolve');
  // An empty helper clears every helper read so far; then the trusted ones again, in order.
  entries.push(['credential.helper', '']); replay((k) => /^credential\.(.+\.)?helper$/.test(k));
  entries.push(['protocol.ext.allow', 'never']);
  pin('submodule.recurse', 'false');
  pin('fetch.recurseSubmodules', 'false');
  pin('push.recurseSubmodules', 'no');

  const seen = new Set(entries.map(([k]) => norm(k)));
  for (const e of local) {
    if (seen.has(e.key)) continue;
    if (PROXY_KEY.test(e.key)) {
      seen.add(e.key);
      const url = /^http\.(.+)\.proxy$/.exec(e.key)?.[1] ?? '';
      entries.push([e.key, lastOf(trusted, e.key) ?? lastOf(trusted, 'http.proxy') ?? envProxy(env, url)]);
      continue;
    }
    const named = NAMED.find(([re]) => re.test(e.key));
    if (!named) continue;
    seen.add(e.key);
    const lfs = /^filter\.lfs\.(clean|smudge|process)$/.exec(e.key);
    const localVal = lastOf(local, e.key);
    if (lfs && localVal === LFS[lfs[1]]) { entries.push([e.key, localVal]); continue; }
    if (/curloptresolve$/.test(e.key)) { entries.push([e.key, '']); replay((k) => k === e.key); continue; }
    pin(e.key, named[1]);
  }
  return { entries, refused };
}

/** `env` plus `entries` as GIT_CONFIG_* (after any the env already has, so they win over it but not over `-c`). */
export function withGitConfig(env, entries) {
  const out = { ...env };
  const n = Number.parseInt(out.GIT_CONFIG_COUNT, 10);
  let i = Number.isInteger(n) && n > 0 ? n : 0;
  for (const [k, v] of entries) { out[`GIT_CONFIG_KEY_${i}`] = k; out[`GIT_CONFIG_VALUE_${i}`] = v; i++; }
  out.GIT_CONFIG_COUNT = String(i);
  return out;
}

const refusal = (cwd, key) => Object.assign(
  new Error(`worca will not run git in ${cwd}: its repository config sets ${key}, which would make git run a command as worca. Remove it (git config --unset-all ${key}) and try again.`),
  { code: 'GIT_CONFIG_REFUSED', key },
);

function finish(cwd, env, opts, listed) {
  if (listed.error) throw Object.assign(new Error(`git config could not be read in ${cwd}: ${listed.error}`), { code: 'GIT_CONFIG_UNREADABLE' });
  const { entries, refused } = guardEntries(parseConfigList(listed.stdout), { env, hooks: opts.hooks });
  if (refused) throw refusal(cwd, refused);
  return withGitConfig(env, entries);
}
// A cwd that does not exist cannot be listed; git itself then fails the same way, so list nothing.
const listFailure = (err, stderr) => (err?.code === 'ENOENT' || err?.code === 'ENOTDIR' ? null : (String(stderr || '').trim() || err.message));

/**
 * The env for one git call in `cwd` (a project, run or retained checkout): `env` (default process.env) plus the
 * overrides above. Rejects (code GIT_CONFIG_REFUSED / GIT_CONFIG_UNREADABLE) when the call must not run.
 * `hooks: true` keeps the repository's hooks (see the header); every other override still applies.
 * `timeout` (ms) is the caller's budget for its whole git call: the listing never takes longer than it.
 */
export function guardedGitEnv(cwd, { env = process.env, hooks = false, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', LIST_ARGS, { cwd, env, timeout: listTimeout(timeout), killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        try { resolve(finish(cwd, env, { hooks }, { stdout: err ? '' : stdout, error: err ? listFailure(err, stderr) : null })); }
        catch (e) { reject(e); }
      });
  });
}

/** guardedGitEnv, synchronously (for the sync git callers). Throws instead of rejecting. */
export function guardedGitEnvSync(cwd, { env = process.env, hooks = false, timeout = 0 } = {}) {
  let stdout = '', error = null;
  try {
    stdout = execFileSync('git', LIST_ARGS, { cwd, env, timeout: listTimeout(timeout), killSignal: 'SIGKILL', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).toString();
  } catch (err) { error = listFailure(err, err?.stderr); }
  return finish(cwd, env, { hooks }, { stdout, error });
}

/**
 * `git worktree add` with the guard listed where the files are checked out (security G2). A plain
 * `worktree add` lists config in the project, then checks out under `.git/worktrees/<name>`, where a
 * conditional include (`includeIf.gitdir:…/worktrees/**`, `includeIf.onbranch:…`) the listing never saw can
 * name a filter driver. So the worktree is added with `--no-checkout` and its files are checked out by a
 * second git call inside it, with guardedGitEnv(dir). Every `worktree add` worca runs goes through here.
 *
 * `branch` creates that branch at `commitish` (`-b`); `detach` and `force` are git's flags. `env` is the base
 * env (default process.env); `configArgs` go before the subcommand (`-c k=v`). Never throws.
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string }>}
 */
export async function guardedWorktreeAdd(projectDir, dir, commitish, {
  branch = null, detach = false, force = false, env = process.env, configArgs = [], timeout = 120_000, signal,
} = {}) {
  const run = async (cwd, args) => {
    let guarded;
    try { guarded = await guardedGitEnv(cwd, { env }); } catch (err) { return { ok: false, code: -1, stdout: '', stderr: err.message }; }
    return new Promise((done) => {
      execFile('git', [...configArgs, ...args], { cwd, env: guarded, timeout, signal, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => done({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '') || (err ? String(err.message) : ''),
        }));
    });
  };
  const add = await run(projectDir, ['worktree', 'add', '--no-checkout', ...(force ? ['--force'] : []), ...(detach ? ['--detach'] : []),
    ...(branch ? ['-b', branch] : []), '--', dir, commitish]);
  if (!add.ok) return add;
  // An index that does not exist yet: reset fills it and the files from HEAD, which the add already set.
  const checkout = await run(dir, ['reset', '--hard', '--quiet']);
  if (checkout.ok) return { ...checkout, stdout: add.stdout + checkout.stdout, stderr: add.stderr + checkout.stderr };
  // As git does when its own checkout fails: the half-made worktree goes (a created branch stays).
  await run(projectDir, ['worktree', 'remove', '--force', '--', dir]);
  return checkout;
}
