// src/core/plugin-config.mjs
// Per-plugin settings/secrets/state under <pluginDir>/data (spec §5, §7.6).
//
// PROFILES: every file is keyed by profile id, so one plugin can hold several
// complete, independent setups — two Jira servers, two GitHub orgs — instead of
// one that gets overwritten each time you switch. A source that does not declare
// multiProfile simply never uses more than the DEFAULT_PROFILE bucket, which is
// created implicitly, so single-profile plugins need no special handling here.
//
//   config.json  { "$format": "profiles/1", "profiles": { "<id>": { key: value } } }
//   secrets.json { "$format": "profiles/1", "profiles": { "<id>": { … } } }   mode 0600
//   state.json   { "$format": "profiles/1", "profiles": { "<id>": { … } } }
//   ticket-updates.json { "$format": "profiles/1", "profiles": { "<id>": { "<sourceId>": { … } } } }   Worca's own
//
// Secrets: mode 0600, atomic temp+rename (settings.mjs:89-92 idiom),
// {"$env":"VAR"} indirection resolved at READ time only — stored verbatim so the
// value never touches disk. Explicitly NOT in worca-cc.db.
// With the secretVault flag on, a typed secret is stored as a Worca vault reference (owner `NAME/PROFILE/KEY`),
// resolved at READ time too; writePluginConfig and deleteProfile are async for that (they seal before, and release
// the entries they dropped after, their sync read-modify-write). Every other function is sync.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_NAME_RE, pluginDataDir, pluginsRoot } from './plugins-lock.mjs';
import { writeJsonAtomic } from './json-atomic.mjs';
import { isVaultRef, ownerField } from './secrets/refs.mjs';
import { noteUnresolved, resolveVaultRefSync } from './secrets/settings-resolver.mjs';

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

/** In-band format marker for the profile envelope. No shape heuristic can be
 *  exact here: config keys come from configSchema, but STATE keys are whatever
 *  a connector passed to ctx.state.set(), so a legacy flat file may legally be
 *  { "profiles": { <id>: {...} } } byte-for-byte — data, not envelope. Only the
 *  marker distinguishes the two, and only writeBucket/deleteProfile emit it. */
const ENVELOPE_FORMAT = 'profiles/1';

const isBag = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The marked { $format, profiles: {...} } envelope, tolerant of a
 *  missing/garbage file. A file WITHOUT the marker is a pre-profiles flat bag
 *  ({ key: value } at the top level) — read it, whole and unjudged, as the
 *  implicit DEFAULT_PROFILE bucket so an upgrade never orphans stored
 *  config/secrets/state; the next writeBucket persists the marked envelope. */
function readBuckets(file) {
  const raw = readJson(file);
  if (raw.$format === ENVELOPE_FORMAT && isBag(raw.profiles)) {
    return Object.fromEntries(
      Object.entries(raw.profiles).filter(([id, bag]) => isValidProfileId(id) && isBag(bag)),
    );
  }
  return Object.keys(raw).length ? { [DEFAULT_PROFILE]: raw } : {};
}

/** One profile's bag from a file. */
function readBucket(file, profile) {
  const b = readBuckets(file)[profile];
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

/** Replace one profile's bag inside a file, leaving every other profile alone. */
function writeBucket(file, profile, bucket, opts) {
  const all = readBuckets(file);
  all[profile] = bucket;
  writeJsonAtomic(file, { $format: ENVELOPE_FORMAT, profiles: all }, opts);
}

// The store-vault module while the vault is in use (flag on, or a vault file a migration left), else null (nothing but
// flag.mjs loads). `sealing` is the flag itself: with it off a vault left in use still releases, but new values stay plain.
async function storeVault() {
  const { secretVaultEnabled, vaultInUse } = await import('./secrets/flag.mjs');
  if (!vaultInUse()) return null;
  const m = await import('./secrets/store-vault.mjs');
  return { ...m, sealing: secretVaultEnabled() };
}

/** The vault owner field of a plugin secret: `NAME/PROFILE/KEY` (hashed when longer than the owner limit). */
const secretField = (name, profile, key) => ownerField([name, profile, key]);

/** The vault references one profile's raw secrets bag holds, with their owner fields, profile and key. */
const bucketRefs = (name, profile, bag) => Object.entries(bag)
  .filter(([, v]) => isVaultRef(v)).map(([k, v]) => ({ ref: v, field: secretField(name, profile, k), profile, key: k }));

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
    // Ticket updates (plans/ticket-updates-design.md §4): Worca's own record per profile and task source, never a connector's.
    ticketUpdates: join(dir, 'ticket-updates.json'),
  };
}

/** Changes whenever a plugin's profiles, configuration or secrets are saved (each write is a new file: modified time and size). For a
 *  caller that keeps an answer made through those settings and must drop it when they change; reads nothing, never throws. */
export function configStamp(name) {
  const f = files(name);
  return [f.profiles, f.config, f.secrets].map((p) => { try { const s = statSync(p); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; } }).join('|');
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
 * Delete a profile and everything stored under it (config, secrets, state, ticket updates), then (secretVault on)
 * the vault entries its secrets held. Callers are responsible for the bindings that named it — see
 * source-bindings.mjs#clearBindingsForProfile.
 */
export async function deleteProfile(name, id) {
  const pid = profileId(id);
  // Same reservation as createProfile — and a backstop for a roster that
  // enrolled "default" before the reservation existed: deleting it would strip
  // the shared bucket (chat-channel config, model secrets, migrated legacy
  // data) out of all three files.
  if (pid === DEFAULT_PROFILE) throw new Error(`profile id "${DEFAULT_PROFILE}" is reserved — its bucket backs every profile-less read`);
  const vault = await storeVault();
  const f = files(name);
  // From here to the last write: one sync section (no await between read and write).
  const dropped = vault ? bucketRefs(name, pid, readBucket(f.secrets, pid)) : [];
  writeJsonAtomic(f.profiles, { profiles: listProfiles(name).filter((p) => p.id !== pid) });
  for (const [file, opts] of [[f.config, undefined], [f.secrets, { mode: 0o600 }], [f.state, undefined], [f.ticketUpdates, undefined]]) {
    const all = readBuckets(file);
    if (!(pid in all)) continue;
    delete all[pid];
    writeJsonAtomic(file, { $format: ENVELOPE_FORMAT, profiles: all }, opts);
  }
  if (dropped.length) {
    await vault.releaseStoreRefs('plugin', dropped, { stillReferenced: (ref) => heldRef(name, ref), graceMs: vault.LOCKLESS_GRACE_MS,
      scope: (field) => field.startsWith(`${name}/`) });
  }
  return { ok: true };
}

/** Every vault reference a plugin's secrets.json holds (every profile, raw), with its owner field. */
export function pluginSecretRefs(name) {
  return Object.entries(readBuckets(files(name).secrets)).flatMap(([pid, bag]) => bucketRefs(name, pid, bag));
}

/** The secret keys of one profile whose raw stored value is a vault reference (saved, whether or not it reads now). */
export function storedSecretKeys(name, profile) {
  const bag = readBucket(files(name).secrets, profileId(profile));
  return Object.keys(bag).filter((k) => isVaultRef(bag[k]));
}

/**
 * The file-stored secrets a plugin's secrets.json holds, every profile: each non-empty string leaf that is not a vault
 * reference (`{ $env }` and references stay), as `[{ profile, key, field, value }]` with the vault owner field.
 */
export function pluginSecretLiterals(name) {
  return Object.entries(readBuckets(files(name).secrets)).flatMap(([profile, bag]) => Object.entries(bag)
    .filter(([, v]) => typeof v === 'string' && v && !isVaultRef(v))
    .map(([key, value]) => ({ profile, key, field: secretField(name, profile, key), value })));
}

/**
 * Swap moved literals for their references in ONE synchronous re-read and atomic write of the plugin's secrets.json
 * (0600, every profile kept): `swaps` = `[{ profile, key, value, ref }]`, each swapped only while its raw value is still
 * `value`. `beforeWrite()` runs right before the write, only when one matched; nothing matched writes nothing. A file
 * changed since the read is left as it is (D20): `{ adopted: [] }`, and the next start retries.
 * @returns {{ adopted: object[] }}
 */
export function swapPluginSecretLiterals(name, swaps, { beforeWrite = () => {} } = {}) {
  const file = files(name).secrets;
  const raw = rawText(file);
  const all = readBuckets(file);
  const adopted = [];
  for (const sw of swaps) {
    const bag = Object.hasOwn(all, sw.profile) ? all[sw.profile] : null;
    if (!bag || !Object.hasOwn(bag, sw.key) || bag[sw.key] !== sw.value) continue;
    bag[sw.key] = sw.ref;
    adopted.push(sw);
  }
  if (!adopted.length) return { adopted };
  beforeWrite();
  return writeUnlessStale(file, all, raw) ? { adopted } : { adopted: [] };
}

/**
 * Export's restore (secrets/export.mjs): put literals back where references are, in ONE synchronous re-read and atomic
 * write of the plugin's secrets.json (0600, every profile kept). `swaps` = `[{ profile, key, ref, value }]`, each
 * restored only while its raw value is still `ref`. Releases nothing. A file changed since the read is left as it is
 * (D20): `{ restored: 0 }`.
 * @returns {{ restored: number }}
 */
export function restorePluginSecretRefs(name, swaps) {
  const file = files(name).secrets;
  const raw = rawText(file);
  const all = readBuckets(file);
  let restored = 0;
  for (const sw of swaps) {
    const bag = Object.hasOwn(all, sw.profile) ? all[sw.profile] : null;
    if (!bag || !Object.hasOwn(bag, sw.key) || bag[sw.key] !== sw.ref) continue;
    bag[sw.key] = sw.value;
    restored++;
  }
  if (!restored) return { restored: 0 };
  return { restored: writeUnlessStale(file, all, raw) ? restored : 0 };
}

const STALE = Symbol('stale plugin secrets');
const rawText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };

// The atomic 0600 write of a whole secrets.json, with a rename-time check (D20, the proxy swap's stillOurs): the file is
// re-read right before the rename, and the write is dropped when its text is no longer `raw` (a writePluginConfig landed
// since the read). True when written.
function writeUnlessStale(file, all, raw) {
  try {
    writeJsonAtomic(file, { $format: ENVELOPE_FORMAT, profiles: all }, { mode: 0o600, beforeRename: () => { if (rawText(file) !== raw) throw STALE; } });
  } catch (err) {
    if (err === STALE) return false;
    throw err;
  }
  return true;
}

/** The names of the plugins with a folder under the plugins root ([] when there is none); folders that are not a plugin
 *  name (the `.cache` folder) are left out. */
export function installedPluginNames() {
  try {
    return readdirSync(pluginsRoot(), { withFileTypes: true }).filter((d) => d.isDirectory() && DIR_NAME_RE.test(d.name)).map((d) => d.name);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

const heldRef = (name, ref) => pluginSecretRefs(name).some((r) => r.ref === ref);

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
    else if (field.secret && typeof v === 'string' && isVaultRef(v.trim())) {
      // A vaulted secret resolves here, at the point of use; one that does not resolve reads as unset.
      const owner = secretField(name, pid, field.key);
      const r = resolveVaultRefSync(v.trim(), { store: 'plugin', field: owner });
      if (r.code) noteUnresolved(owner, r.code);
      v = r.code ? null : r.value;
    }
    out[field.key] = v;
  }
  return out;
}

/** Route values by schema: secret:true -> secrets.json (0600), else config.json,
 *  both inside `profile`'s bucket. undefined / redaction-marker values keep the
 *  prior stored value; null clears. $env refs are stored verbatim. Both writes
 *  are temp+rename atomic. With the secretVault flag on, typed secrets are sealed
 *  into fresh vault entries first, and the entries this profile no longer holds
 *  are released after the write. @throws {SettingsVaultError} a refused secret */
export async function writePluginConfig(name, configSchema = [], values = {}, profile) {
  const pid = profileId(profile);
  const f = files(name);
  const secretKeys = new Set(configSchema.filter((x) => x && x.secret).map((x) => x.key));
  const input = Object.entries(values && typeof values === 'object' ? values : {});
  const vault = await storeVault();
  const sealed = new Map();
  let recheck = () => {};
  if (vault?.sealing) {
    const typed = input.filter(([k, v]) => secretKeys.has(k) && typeof v === 'string' && v);
    const current = readBucket(f.secrets, pid);
    const r = await vault.sealStoreSecrets('plugin', typed.map(([k, v]) => ({ field: secretField(name, pid, k), value: v, current: current[k] })),
      { nothingVaulted: () => pluginSecretRefs(name).length === 0, subject: 'The secret' });
    typed.forEach(([k], i) => sealed.set(k, r.values[i]));
    recheck = r.recheck;
  }
  // From here to the last write: one sync section (no await between read and write).
  recheck();
  const config = readBucket(f.config, pid);
  const secrets = readBucket(f.secrets, pid);
  const before = vault ? bucketRefs(name, pid, secrets) : [];
  for (const [k, v] of input) {
    if (v === undefined || isSetMarker(v)) continue; // absent / echoed marker -> keep prior
    const bucket = secretKeys.has(k) ? secrets : config;
    const other = secretKeys.has(k) ? config : secrets;
    delete other[k]; // field migrated buckets across schema versions
    if (v === null) delete bucket[k];
    else bucket[k] = sealed.has(k) ? sealed.get(k) : v;
  }
  writeBucket(f.config, pid, config);
  writeBucket(f.secrets, pid, secrets, { mode: 0o600 });
  if (vault) {
    const dropped = vault.refsDropped(before, bucketRefs(name, pid, secrets));
    if (dropped.length) {
      await vault.releaseStoreRefs('plugin', dropped, { stillReferenced: (ref) => heldRef(name, ref), graceMs: vault.LOCKLESS_GRACE_MS,
      scope: (field) => field.startsWith(`${name}/`) });
    }
  }
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

// ── ticket updates ────────────────────────────────────────────────────────────
// plans/ticket-updates-design.md D3, §4: the projects you work on and the rules for a finished run, per profile and task
// source, in the same envelope as the files above: { "$format": "profiles/1", "profiles": { <profile>: { <sourceId>: record } } }.
// Not in config.json (PUT /api/plugins/:name/config writes any key it is given) and not in state.json (connectors write it).
// No secrets. deleteProfile drops a profile's bucket here too; uninstall keeps data/, purge removes it.

/** One profile's record for one task source, or null when nothing is saved (the plugin's old setting applies, D4). */
export function readTicketUpdates(name, profile, sourceId) {
  const bucket = readBucket(files(name).ticketUpdates, profileId(profile));
  const sid = String(sourceId ?? '');
  // Own keys only: a source id such as "__proto__" must not read Object.prototype.
  const rec = Object.hasOwn(bucket, sid) ? bucket[sid] : null;
  return isBag(rec) ? rec : null;
}

/** Replace one profile's record for one task source; every other profile and source is left alone. Atomic. */
export function writeTicketUpdates(name, profile, sourceId, record) {
  const pid = profileId(profile);
  const sid = String(sourceId ?? '');
  if (!sid) throw new Error('a task source id is required');
  if (!isBag(record)) throw new Error('a ticket updates record must be an object');
  const file = files(name).ticketUpdates;
  writeBucket(file, pid, { ...readBucket(file, pid), [sid]: record });
  return { ok: true };
}
