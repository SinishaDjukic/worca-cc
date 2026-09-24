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
import { delimiter, isAbsolute, join } from 'node:path';

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
 * with the agent's HOME, USER and LOGNAME in its env. Throws when `bin` cannot be resolved,
 * rather than running something else.
 */
export function agentSpawn(bin, args, env, id, { isFile = defaultIsFile } = {}) {
  const abs = resolveOnPath(bin, env.PATH || process.env.PATH || '', isFile);
  if (!abs) throw new Error(`cannot run ${bin} as ${id.user}: not found on PATH`);
  return {
    file: 'sudo',
    args: ['-n', '-E', '-u', id.user, '--', abs, ...args],
    env: { ...env, HOME: id.home, USER: id.user, LOGNAME: id.user },
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

/** Let the agent read a directory the server made for one spawn (staged prompt files):
 *  the shared group, group read/traverse. Best effort; a failure surfaces as the agent's
 *  own read error. */
export function shareWithAgent(dir, id) {
  if (!id || id.gid == null) return;
  try {
    chownSync(dir, -1, id.gid);
    chmodSync(dir, 0o750);
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      chownSync(p, -1, id.gid);
      chmodSync(p, 0o640);
    }
  } catch { /* the agent reports what it cannot read */ }
}
