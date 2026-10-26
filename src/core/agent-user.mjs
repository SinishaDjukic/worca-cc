// Agents under their own uid (docker/entrypoint.sh, single-volume hosts).
//
// Worca never hands an agent a credential (github-credentials.mjs), but an agent
// running as the server's own user could still read the server's environment
// through /proc/<pid>/environ, or worca's settings and database. So on a hosted
// container the entrypoint creates the boundary and tells the server about it:
//
//   WORCA_AGENT_USER   the user agents run as (worca-agent)
//   WORCA_AGENT_HOME   that user's HOME (its own ~/.claude, npm and pip caches)
//   WORCA_AGENT_GID    the group server and agent share (projects, runs, store)
//
// Each agent spawn becomes `sudo -n -E -u <user> -- <bin> …` (a sudoers rule
// lets the server switch to that one user and nothing else). Unset = agents run
// as the server, as on every local install.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, chownSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

/** { user, home, gid } when agent isolation is on, else null. Pure: reads only `env`. */
export function agentIdentity(env = process.env) {
  const user = String(env.WORCA_AGENT_USER || '').trim();
  const home = String(env.WORCA_AGENT_HOME || '').trim();
  if (!USER_RE.test(user) || !isAbsolute(home)) return null;
  const gid = Number.parseInt(env.WORCA_AGENT_GID, 10);
  return { user, home, gid: Number.isInteger(gid) && gid > 0 ? gid : null };
}

/** An absolute path for `bin` from PATH (sudo's secure_path must not change which binary runs). */
export function resolveOnPath(bin, pathVar = process.env.PATH || '', isFile = defaultIsFile) {
  if (isAbsolute(bin)) return bin;
  if (bin.includes('/')) return null;
  for (const dir of String(pathVar).split(delimiter)) {
    if (dir && isAbsolute(dir) && isFile(join(dir, bin))) return join(dir, bin);
  }
  return null;
}

function defaultIsFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/**
 * The spawn for one agent command under `id`: `sudo -n -E -u <user> -- <abs bin> …args`,
 * with the agent's HOME (or `home`), USER and LOGNAME in its env. Throws when `bin` cannot be resolved,
 * rather than running something else.
 */
export function agentSpawn(bin, args, env, id, { isFile = defaultIsFile, home = null } = {}) {
  const abs = resolveOnPath(bin, env.PATH || process.env.PATH || '', isFile);
  if (!abs) throw new Error(`cannot run ${bin} as ${id.user}: not found on PATH`);
  return {
    file: 'sudo',
    args: ['-n', '-E', '-u', id.user, '--', abs, ...args],
    // `home`: a folder of the agent's own the command runs with as HOME instead (a Goose chat's home).
    env: { ...env, HOME: home || id.home, USER: id.user, LOGNAME: id.user },
  };
}

/** SIGKILL every process of the agent's group `pgid` (the server cannot signal another uid;
 *  sudo relays SIGTERM, but a SIGKILLed sudo would orphan its command). Best effort. */
export function killAgentGroup(pgid, id, spawnImpl = spawn) {
  if (!id || !Number.isInteger(pgid) || pgid <= 1) return;
  try {
    const c = spawnImpl('sudo', ['-n', '-u', id.user, '--', 'kill', '-KILL', '--', `-${pgid}`], { stdio: 'ignore' });
    c.on?.('error', () => {});
    c.unref?.();
  } catch { /* nothing left to kill */ }
}

/** killAgentGroup, synchronously: for a process 'exit' listener, which cannot wait. */
export function killAgentGroupSync(pgid, id, spawnSyncImpl = spawnSync) {
  if (!id || !Number.isInteger(pgid) || pgid <= 1) return;
  try {
    spawnSyncImpl('sudo', ['-n', '-u', id.user, '--', 'kill', '-KILL', '--', `-${pgid}`], { stdio: 'ignore', timeout: 5000 });
  } catch { /* nothing left to kill */ }
}

/** Let the agent read a directory the server made for one spawn (staged prompt files, an engine's per-spawn settings,
 *  wrapper scripts): the shared group on it and everything under it, group read/traverse (a sub-folder stays
 *  traversable, an executable stays executable), plus group traverse — never listing — on each folder above it up to
 *  `stopAt` (worca's tmp: the per-engine base `tmp/<engine>`, a chat's own folder under `tmp/ask`), which the server
 *  creates for itself with no access for the group. Without `stopAt`, only its direct parent. `writable`: the agent
 *  also writes into the folder. Best effort; a failure surfaces as the agent's own read error. */
export function shareWithAgent(dir, id, { writable = false, stopAt = null } = {}) {
  if (!id || id.gid == null) return;
  const stop = stopAt ? resolve(stopAt) : null;
  for (let p = dirname(resolve(dir)), n = 0; n < 8 && p !== dirname(p) && (stop ? p !== stop && p.startsWith(`${stop}${sep}`) : n < 1); p = dirname(p), n++) {
    try {
      chownSync(p, -1, id.gid);
      chmodSync(p, (statSync(p).mode & 0o7777) | 0o010);
    } catch { /* the agent reports what it cannot read */ }
  }
  const share = (p, isDir) => {
    chownSync(p, -1, id.gid);
    chmodSync(p, isDir ? (writable ? 0o770 : 0o750) : (statSync(p).mode & 0o100 ? 0o750 : 0o640));
  };
  const walk = (d) => {
    share(d, true);
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.isFile()) share(join(d, e.name), false);
    }
  };
  try { walk(dir); } catch { /* the agent reports what it cannot read */ }
}
