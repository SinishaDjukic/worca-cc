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
import { statSync } from 'node:fs';
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
export function _resetSecretFiles() { records.clear(); }
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

/**
 * The refusals for the recorded secret files, while agent users are on; [] otherwise (no one to keep out).
 * @param {{env?: object, uid?: number|null, names?: string[]}} o
 */
export function secretFileRefusals({ env = process.env, uid = typeof process.getuid === 'function' ? process.getuid() : null, names = BOX_SECRET_FILES } = {}) {
  if (!agentIdentity(env)) return [];
  return names.map((n) => secretFileProblem(n, records.get(n), uid)).filter(Boolean);
}
