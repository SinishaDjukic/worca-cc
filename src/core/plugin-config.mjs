// src/core/plugin-config.mjs
// Per-plugin settings/secrets/state under <pluginDir>/data (spec §5, §7.6).
//
// PROFILES: every file is keyed by profile id, so one plugin can hold several
// complete, independent setups — two Jira servers, two GitHub orgs — instead of
// one that gets overwritten each time you switch. A source that does not declare
// multiProfile simply never uses more than the DEFAULT_PROFILE bucket, which is
// created implicitly, so single-profile plugins need no special handling here.
//
//   config.json  { "profiles": { "<id>": { key: value } } }
//   secrets.json { "profiles": { "<id>": { key: value } } }   mode 0600
//   state.json   { "profiles": { "<id>": { key: value } } }
//
// Secrets: mode 0600, atomic temp+rename (settings.mjs:89-92 idiom),
// {"$env":"VAR"} indirection resolved at READ time only — stored verbatim so the
// value never touches disk. Explicitly NOT in worca-cc.db.
// All functions are sync (contract; callers are the shim + server routes).

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pluginDataDir } from './plugins-lock.mjs';

/** The bucket every source gets for free; the only one a single-profile source uses. */
export const DEFAULT_PROFILE = 'default';

/** Profile ids are directory-safe and URL-safe: they become path segments in a
 *  connector's own storage (jira-source hangs a $JTR_CONFIG_DIR off one) and
 *  route params on /api/plugins/:name/profiles/:id. */
export const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidProfileId(id) {
  return PROFILE_ID_RE.test(String(id ?? ''));
}

function profileId(id) {
  const p = id == null || id === '' ? DEFAULT_PROFILE : String(id);
  if (!isValidProfileId(p)) throw new Error(`invalid profile id "${p}" (lowercase letters, digits and dashes)`);
  return p;
}

function readJson(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The { profiles: {...} } envelope, tolerant of a missing/garbage file.
 *  Pre-profiles files were one flat bag ({ key: value } at the top level); read
 *  those as the implicit DEFAULT_PROFILE bucket so an upgrade never orphans
 *  stored config/secrets/state — the next writeBucket persists the envelope.
 *  The envelope is recognised STRICTLY — exactly one top-level key ("profiles")
 *  whose entries are all <valid id> -> plain object — because a legacy flat file
 *  may legally carry a schema field KEYED "profiles" (KEY_RE allows the name,
 *  and a {"$env":…} ref stores an object): misreading that as the envelope
 *  would silently drop every other stored key, permanently after the next
 *  write. Only writeBucket/deleteProfile ever produce the envelope, and they
 *  produce exactly this shape. */
function readBuckets(file) {
  const raw = readJson(file);
  const p = raw.profiles;
  const isBag = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isBag(p) && Object.keys(raw).length === 1
      && Object.entries(p).every(([id, bag]) => isValidProfileId(id) && isBag(bag))) {
    return p;
  }
  return Object.keys(raw).length ? { [DEFAULT_PROFILE]: raw } : {};
}

/** One profile's bag from a file. */
function readBucket(file, profile) {
  const b = readBuckets(file)[profile];
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

function writeJsonAtomic(file, obj, { mode } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', mode !== undefined ? { mode } : { encoding: 'utf8' });
  if (mode !== undefined) chmodSync(tmp, mode); // umask-proof: mode is exact
  renameSync(tmp, file);
}

/** Replace one profile's bag inside a file, leaving every other profile alone. */
function writeBucket(file, profile, bucket, opts) {
  const all = readBuckets(file);
  all[profile] = bucket;
  writeJsonAtomic(file, { profiles: all }, opts);
}

const isEnvRef = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.$env === 'string';
/** The exact redaction marker redactedConfig emits — must never be persisted. */
const isSetMarker = (v) => !!v && typeof v === 'object' && v.set === true && Object.keys(v).length === 1;

function files(name) {
  const dir = pluginDataDir(name);
  return {
    config: join(dir, 'config.json'),
    secrets: join(dir, 'secrets.json'),
    state: join(dir, 'state.json'),
    profiles: join(dir, 'profiles.json'),
  };
}

// ── profiles ──────────────────────────────────────────────────────────────────
// The roster lives in its own file rather than being inferred from config.json's
// keys: a profile is real the moment it is created, BEFORE anything is saved into
// it, and it keeps a human label the id cannot carry.

/**
 * Every profile of a plugin, in creation order.
 * @returns {Array<{id:string, label:string}>}
 */
export function listProfiles(name) {
  const raw = readJson(files(name).profiles);
  const list = Array.isArray(raw.profiles) ? raw.profiles : [];
  return list
    .filter((p) => p && isValidProfileId(p.id))
    .map((p) => ({ id: String(p.id), label: String(p.label || p.id) }));
}

/** Just the ids — the shape resolveProfile()/the UI gate want. */
export function listProfileIds(name) {
  return listProfiles(name).map((p) => p.id);
}

/**
 * Create a profile. Idempotent on the id (a repeat call updates the label only),
 * so a caller that ensures DEFAULT_PROFILE on every save cannot duplicate it.
 * @returns {{id:string, label:string}}
 */
export function createProfile(name, id, label) {
  const pid = profileId(id);
  // The default bucket is shared plumbing, not a profile: chat channels, model
  // secrets and migrated pre-profiles config all live in it via profile-less
  // reads. Enrolling "default" in the roster would make that shared bucket
  // deletable like any member — one Remove click away from wiping them all.
  if (pid === DEFAULT_PROFILE) throw new Error(`profile id "${DEFAULT_PROFILE}" is reserved`);
  const list = listProfiles(name);
  const at = list.findIndex((p) => p.id === pid);
  const entry = { id: pid, label: String(label || (at >= 0 ? list[at].label : pid)) };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  writeJsonAtomic(files(name).profiles, { profiles: list });
  return entry;
}

/**
 * Delete a profile and everything stored under it (config, secrets, state).
 * Callers are responsible for the bindings that named it — see
 * source-bindings.mjs#clearBindingsForProfile.
 */
export function deleteProfile(name, id) {
  const pid = profileId(id);
  // Same reservation as createProfile — and a backstop for a roster that
  // enrolled "default" before the reservation existed: deleting it would strip
  // the shared bucket (chat-channel config, model secrets, migrated legacy
  // data) out of all three files.
  if (pid === DEFAULT_PROFILE) throw new Error(`profile id "${DEFAULT_PROFILE}" is reserved — its bucket backs every profile-less read`);
  const f = files(name);
  writeJsonAtomic(f.profiles, { profiles: listProfiles(name).filter((p) => p.id !== pid) });
  for (const [file, opts] of [[f.config, undefined], [f.secrets, { mode: 0o600 }], [f.state, undefined]]) {
    const all = readBuckets(file);
    if (!(pid in all)) continue;
    delete all[pid];
    writeJsonAtomic(file, { profiles: all }, opts);
  }
  return { ok: true };
}

// ── config ────────────────────────────────────────────────────────────────────

/** Merged config.json + secrets.json for ONE profile (secrets win), schema
 *  defaults applied, {"$env":"VAR"} resolved (unset env -> null). */
export function readPluginConfig(name, configSchema = [], profile) {
  const pid = profileId(profile);
  const f = files(name);
  const raw = { ...readBucket(f.config, pid), ...readBucket(f.secrets, pid) };
  const out = {};
  for (const field of configSchema) {
    let v = raw[field.key];
    if (v === undefined || v === null || v === '') v = field.default ?? null;
    if (isEnvRef(v)) v = process.env[v.$env] ?? null;
    out[field.key] = v;
  }
  return out;
}

/** Route values by schema: secret:true -> secrets.json (0600), else config.json,
 *  both inside `profile`'s bucket. undefined / redaction-marker values keep the
 *  prior stored value; null clears. $env refs are stored verbatim. Both writes
 *  are temp+rename atomic. */
export function writePluginConfig(name, configSchema = [], values = {}, profile) {
  const pid = profileId(profile);
  const f = files(name);
  const config = readBucket(f.config, pid);
  const secrets = readBucket(f.secrets, pid);
  const secretKeys = new Set(configSchema.filter((x) => x && x.secret).map((x) => x.key));
  for (const [k, v] of Object.entries(values && typeof values === 'object' ? values : {})) {
    if (v === undefined || isSetMarker(v)) continue; // absent / echoed marker -> keep prior
    const bucket = secretKeys.has(k) ? secrets : config;
    const other = secretKeys.has(k) ? config : secrets;
    delete other[k]; // field migrated buckets across schema versions
    if (v === null) delete bucket[k];
    else bucket[k] = v;
  }
  writeBucket(f.config, pid, config);
  writeBucket(f.secrets, pid, secrets, { mode: 0o600 });
  return { ok: true };
}

/** UI echo shape for ONE profile: secrets -> { set: true|false } markers,
 *  non-secrets verbatim (with defaults). Secret VALUES never reach the browser
 *  after save (§7.6). */
export function redactedConfig(name, configSchema = [], profile) {
  const pid = profileId(profile);
  const f = files(name);
  const config = readBucket(f.config, pid);
  const secrets = readBucket(f.secrets, pid);
  const out = {};
  for (const field of configSchema) {
    if (field.secret) out[field.key] = { set: secrets[field.key] !== undefined };
    else out[field.key] = config[field.key] ?? field.default ?? null;
  }
  return out;
}

// ── connector state ───────────────────────────────────────────────────────────

/** Connector KV for ONE profile (cursors, etags) — host-persisted ctx.state
 *  backing (§7.1). Per-profile so two instances of the same source cannot read
 *  back each other's cached cursors. */
export function readPluginState(name, profile) {
  return readBucket(files(name).state, profileId(profile));
}

/** Shallow-merge patch into one profile's state, atomic write. Returns the new
 *  bag for that profile. */
export function writePluginState(name, patch = {}, profile) {
  const pid = profileId(profile);
  const f = files(name);
  const next = { ...readBucket(f.state, pid), ...(patch && typeof patch === 'object' ? patch : {}) };
  writeBucket(f.state, pid, next);
  return next;
}
