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
import { chmodSync, chownSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

/** { user, home, gid } when agent isolation is on, else null. Pure: reads only `env`. */
export function agentIdentity(env = process.env) {
  const user = String(env.WORCA_AGENT_USER || '').trim();
  const home = String(env.WORCA_AGENT_HOME || '').trim();
  if (!USER_RE.test(user) || !isAbsolute(home)) return null;
  const gid = Number.parseInt(env.WORCA_AGENT_GID, 10);
  return { user, home, gid: Number.isInteger(gid) && gid > 0 ? gid : null };
}

/** { user, home, gid } for plugin connector and chat-channel children when the container has a
 *  plugin user (WORCA_PLUGIN_USER / WORCA_PLUGIN_HOME, docker/entrypoint.sh), else null. Its own
 *  uid and HOME: it reads plugin code through the shared group, but neither worca's home (plugin
 *  secrets, settings, database) nor the agents' HOME. Pure: reads only `env`. */
export function pluginIdentity(env = process.env) {
  return agentIdentity({ WORCA_AGENT_USER: env.WORCA_PLUGIN_USER, WORCA_AGENT_HOME: env.WORCA_PLUGIN_HOME, WORCA_AGENT_GID: env.WORCA_AGENT_GID });
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
 *  wrapper scripts): the agent user's own group (`id.runGid`, agent-pool.mjs: worca and that user only; the shared group
 *  without a pool) on it and everything under it, group read/traverse (a sub-folder stays traversable, an executable
 *  stays executable), plus group traverse — never listing — on each folder above it up to `stopAt` (worca's tmp: the
 *  per-engine base `tmp/<engine>`, a chat's own folder under `tmp/ask`), in the shared group. Without `stopAt`, only its
 *  direct parent. `writable`: the agent also writes into the folder. Best effort; a failure surfaces as the agent's own
 *  read error.
 *  V10: a staged file can hold a secret (a relayed chat's WORCA_ASK_RELAY_TOKEN in Copilot's mcp-config.json, Gemini's
 *  and Qwen's settings, Goose's env files), so no other person's agent may read it, and a parent the server made with
 *  group read/write (umask 0007) loses them: another agent could list it and replace what is inside. A sticky parent
 *  (`tmp/ask`, 3770) keeps its bits: there no one renames or removes what another made. */
export function shareWithAgent(dir, id, { writable = false, stopAt = null, fsOps = { chownSync, chmodSync, statSync, readdirSync } } = {}) {
  if (!id || id.gid == null) return;
  const own = Number.isInteger(id.runGid) ? id.runGid : id.gid;
  const stop = stopAt ? resolve(stopAt) : null;
  for (let p = dirname(resolve(dir)), n = 0; n < 8 && p !== dirname(p) && (stop ? p !== stop && p.startsWith(`${stop}${sep}`) : n < 1); p = dirname(p), n++) {
    try {
      const m = fsOps.statSync(p).mode & 0o7777;
      fsOps.chownSync(p, -1, id.gid);
      fsOps.chmodSync(p, ((m & 0o1000) ? m : (m & ~0o060)) | 0o010);
    } catch { /* the agent reports what it cannot read */ }
  }
  const share = (p, isDir) => {
    fsOps.chownSync(p, -1, own);
    fsOps.chmodSync(p, isDir ? (writable ? 0o770 : 0o750) : (fsOps.statSync(p).mode & 0o100 ? 0o750 : 0o640));
  };
  const walk = (d) => {
    share(d, true);
    for (const e of fsOps.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.isFile()) share(join(d, e.name), false);
    }
  };
  try { walk(dir); } catch { /* the agent reports what it cannot read */ }
}

/** V10: refuse a folder another user made under `base`, a folder every agent may write into (`tmp/ask`, sticky): each
 *  folder below `base` down to `dir` that exists already must be a real folder this process owns, or another person's
 *  agent could make it first and replace what worca writes inside (a chat's settings, its token). A folder not there
 *  yet passes: worca makes it. Throws. No-op where there are no uids (Windows). */
export function assertOwnFolders(dir, base, { uid = process.getuid?.() ?? null, lstat = lstatSync } = {}) {
  if (uid == null) return;
  let p = resolve(base);
  for (const part of relative(p, resolve(dir)).split(sep).filter(Boolean)) {
    p = join(p, part);
    let st;
    try { st = lstat(p); } catch { return; }
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid) throw new Error(`${p} is not a folder worca made (a link, or another user's): a chat's files are never written there`);
  }
}

/** Hand one run's own folder to its owner's agent (G19): the pool user's own group (`id.runGid`,
 *  which only worca and that user are in) with setgid 2770, so what either writes inside keeps the
 *  group and no other person's agent can open it; the parent becomes sticky, so an agent can
 *  neither rename nor delete a run folder it does not own. A no-op without a run group (no pool,
 *  the shared agent user, a local install). Best effort, like shareWithAgent. */
/** Give one FILE to an agent user's own group (`id.runGid`, agent-pool.mjs: worca and that user only), mode 0640:
 *  the relayed Ask turn's MCP config, which holds its relay token (V10). Without a pool group the file keeps the
 *  shared group. Never throws. */
export function claimFileForAgent(file, id, fsOps = { chownSync, chmodSync }) {
  if (!id || !Number.isInteger(id.runGid)) return;
  try {
    fsOps.chownSync(file, -1, id.runGid);
    fsOps.chmodSync(file, 0o640);
  } catch { /* the file keeps the shared group: as before */ }
}

export function claimForAgent(dir, id, fsOps = { chownSync, chmodSync, statSync }) {
  if (!id || !Number.isInteger(id.runGid)) return;
  try {
    fsOps.chownSync(dir, -1, id.runGid);
    fsOps.chmodSync(dir, 0o2770);
    const parent = dirname(dir);
    fsOps.chmodSync(parent, (fsOps.statSync(parent).mode & 0o7777) | 0o1000);
  } catch { /* the folder keeps the shared group: as before */ }
}
