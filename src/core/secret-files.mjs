// src/core/secret-files.mjs — the boot check for every secret file Worca reads (#1619; X2 in broker-boot.mjs).
//
// With agents under their own users (docker/compose.isolation.yml, single-volume hosts), an agent shares Worca's
// container. A secret file its group or others can read is one `cat` away: the guardrails' Read deny on
// /run/secrets/** does not stop Bash, and compose secrets keep the host file's mode and owner. So, while agent users
// are on, every secret file Worca reads must be mode 0600 (nothing for group or others) and owned by Worca's own
// user. Worca refuses to start otherwise, with one line per file that names it and the fix.
//
// Each reader records its file when it reads it, once, at boot (sealBrokerSecret, sealEgressSecret,
// sealGithubAppKey); the check reads those records, so it sees the file Worca actually used.
//
//   WORCA_BROKER_SECRET_FILE   the broker's shared secret (broker-client.mjs); checked by broker-boot.mjs
//   WORCA_EGRESS_SECRET_FILE   the egress sidecar's API secret (egress-sidecar-client.mjs)
//   WORCA_GH_APP_KEY_FILE      the deployment's GitHub App private key (github-app.mjs)
//
// Files Worca's container never reads stay out: the broker's vault key and model keys live in the broker container,
// the managed proxy login in the sidecar's. Agents do not run there.
//
// `stat` is not the whole answer (#1641). Docker Desktop (macOS, Windows) mounts compose secret files on its
// `fakeowner` file system, where every user sees itself as the file's owner: a 0600 file owned by Worca's user is
// read by worca-agent all the same. So, when it can, the check also opens each file AS the agent user (the same
// `sudo -n -u <agent>` path agents start with) and refuses when that read works. When no agent user can be
// impersonated, it falls back to the mode and owner, logs one line, and still refuses a file on a `fakeowner` mount.
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { agentIdentity } from './agent-user.mjs';

export const BOX_SECRET_FILES = Object.freeze(['WORCA_BROKER_SECRET_FILE', 'WORCA_EGRESS_SECRET_FILE', 'WORCA_GH_APP_KEY_FILE']);

/** name → { path, mode, uid } (mode & 0o777; uid null when unknown), or { path, error } when it could not be read. */
const records = new Map();

/** A reader records the file it read once (stat now, before anything could swap it). */
export function recordSecretFile(name, path, { stat = statSync } = {}) {
  try {
    const st = stat(path);
    records.set(name, { path, mode: st.mode & 0o777, uid: Number.isInteger(st.uid) ? st.uid : null });
  } catch (e) { records.set(name, { path, error: e && e.code ? e.code : 'error' }); }
}

/** Tests. */
export function _resetSecretFiles() { records.clear(); probeLogged = false; }
export function recordedSecretFile(name) { return records.get(name) || null; }

/**
 * The fix for one file, or null when it is fine. Pure.
 * @param {string} name  the variable that named the file
 * @param {{path: string, mode?: number, uid?: number|null}} rec
 * @param {number|null} uid  Worca's own uid
 */
export function secretFileProblem(name, rec, uid) {
  if (!rec || rec.error || typeof rec.mode !== 'number') return null;   // an unreadable file fails in its own reader
  const owner = uid !== null && uid !== undefined && rec.uid !== null && rec.uid !== undefined ? rec.uid : null;
  const open = (rec.mode & 0o077) !== 0;
  const foreign = owner !== null && owner !== uid;
  if (!open && !foreign) return null;
  const how = (rec.mode & 0o044) ? 'readable' : 'writable';
  const what = [open ? `is ${how} by its group or by others (mode 0${rec.mode.toString(8).padStart(3, '0')})` : null,
    foreign ? `is owned by uid ${owner}, not by the user Worca runs as (uid ${uid})` : null].filter(Boolean).join(' and ');
  return `${name} ${what}: ${rec.path}. Agents run under their own users and could read it. `
    + `Make it mode 0600, owned by Worca's user: chown ${uid ?? 1000}:${uid ?? 1000} ${rec.path} && chmod 600 ${rec.path} `
    + '(on the host, for a compose secret file). See docs/credential-broker.md.';
}

/** The value that carries each secret without a file (read once and sealed out of the environment, like the file). */
const ENV_INSTEAD = Object.freeze({ WORCA_BROKER_SECRET_FILE: 'WORCA_BROKER_SECRET', WORCA_EGRESS_SECRET_FILE: 'WORCA_EGRESS_SECRET',
  WORCA_GH_APP_KEY_FILE: 'WORCA_GH_APP_KEY_B64' });

/**
 * The default access probe: a reader that opens a file as `user` (`sudo -n -u <user> -- cat`), or null when this
 * process cannot start commands as that user (no sudo rule, not in a container). Its reader returns true when the
 * read worked.
 */
export function sudoAccessProbe(user, { spawn = spawnSync } = {}) {
  const run = (args) => { try { return spawn('sudo', ['-n', '-u', user, '--', ...args], { stdio: 'ignore', timeout: 5000 }); } catch { return { status: 1, error: true }; } };
  const t = run(['true']);
  if (t.error || t.status !== 0) return null;
  return (path) => { const r = run(['cat', '--', path]); return !r.error && r.status === 0; };
}

/** The file system type of the mount that holds `path`, from /proc/mounts (the longest mount point that contains
 *  it), or null when unknown (no /proc, as on macOS). */
export function mountFsType(path, { readMounts = () => readFileSync('/proc/mounts', 'utf8') } = {}) {
  let text = '';
  try { text = String(readMounts()); } catch { return null; }
  const unescape = (s) => s.replace(/\\([0-7]{3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)));
  let best = null;
  for (const line of text.split('\n')) {
    const [, at, type] = line.split(' ');
    if (!at || !type) continue;
    const mp = unescape(at);
    const inside = mp === '/' || path === mp || path.startsWith(mp.endsWith('/') ? mp : `${mp}/`);
    if (inside && (!best || mp.length >= best.mp.length)) best = { mp, type };
  }
  return best ? best.type : null;
}

/** The refusal for a file the agent user could read (or, unprobed, one on a mount that ignores ownership). Pure. */
export function unenforcedProblem(name, path, { user = 'worca-agent', read = true, fsType = null } = {}) {
  const fs = fsType === 'fakeowner' ? 'it is on Docker Desktop\'s fakeowner file system, where every user sees itself as the owner'
    : 'Docker Desktop on macOS and Windows does this';
  const seen = read ? `the agent user ${user} could read ${path}, although its mode and owner say it cannot`
    : `${path} is on a fakeowner mount, and Worca could not check it as an agent user`;
  return `${name}: ${seen}. This mount does not enforce file ownership (${fs}). `
    + `Run the shared profile on a Linux Docker host, or supply the secret as the ${ENV_INSTEAD[name] || 'matching'} value instead of a file. `
    + 'See docs/shared-instance.md.';
}

let probeLogged = false;

/**
 * The refusals for the recorded secret files, while agent users are on; [] otherwise (no one to keep out).
 * Mode and owner first; then a real read as the agent user (`probe`), or, when none can be made, the mount type.
 * @param {{env?: object, uid?: number|null, names?: string[], probe?: (user: string) => ((path: string) => boolean)|null,
 *   fsType?: (path: string) => string|null, log?: (line: string) => void}} o
 */
export function secretFileRefusals({ env = process.env, uid = typeof process.getuid === 'function' ? process.getuid() : null, names = BOX_SECRET_FILES,
  probe = sudoAccessProbe, fsType = mountFsType, log = (l) => console.warn(l) } = {}) {
  const id = agentIdentity(env);
  if (!id) return [];
  const out = [];
  let reader;   // undefined: not tried yet; null: cannot impersonate
  for (const n of names) {
    const rec = records.get(n);
    const p = secretFileProblem(n, rec, uid);
    if (p) { out.push(p); continue; }
    if (!rec || rec.error || typeof rec.mode !== 'number') continue;
    if (reader === undefined) { try { reader = probe(id.user) || null; } catch { reader = null; } }
    const type = fsType(rec.path);
    if (reader) { if (reader(rec.path)) out.push(unenforcedProblem(n, rec.path, { user: id.user, read: true, fsType: type })); continue; }
    if (!probeLogged) { probeLogged = true; log(`[worca-ui] secrets: cannot start a command as ${id.user} to check the secret files, so only their mode and owner were checked`); }
    if (type === 'fakeowner') out.push(unenforcedProblem(n, rec.path, { user: id.user, read: false, fsType: type }));
  }
  return out;
}
