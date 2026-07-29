// src/core/plugin-config.mjs
// Per-plugin settings/secrets/state under <pluginDir>/data (spec §5, §7.6).
// Secrets: data/secrets.json, mode 0600, atomic temp+rename (settings.mjs:89-92
// idiom), {"$env":"VAR"} indirection resolved at READ time only — stored
// verbatim so the value never touches disk. Explicitly NOT in worca-cc.db.
// All functions are sync (contract; callers are the shim + server routes).

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pluginDataDir } from './plugins-lock.mjs';

function readJson(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(file, obj, { mode } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', mode !== undefined ? { mode } : { encoding: 'utf8' });
  if (mode !== undefined) chmodSync(tmp, mode); // umask-proof: mode is exact
  renameSync(tmp, file);
}

const isEnvRef = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.$env === 'string';
/** The exact redaction marker redactedConfig emits — must never be persisted. */
const isSetMarker = (v) => !!v && typeof v === 'object' && v.set === true && Object.keys(v).length === 1;

function files(name) {
  const dir = pluginDataDir(name);
  return { config: join(dir, 'config.json'), secrets: join(dir, 'secrets.json'), state: join(dir, 'state.json') };
}

/** Merged config.json + secrets.json (secrets win), schema defaults applied,
 *  {"$env":"VAR"} resolved (unset env -> null). */
export function readPluginConfig(name, configSchema = []) {
  const f = files(name);
  const raw = { ...readJson(f.config), ...readJson(f.secrets) };
  const out = {};
  for (const field of configSchema) {
    let v = raw[field.key];
    if (v === undefined || v === null || v === '') v = field.default ?? null;
    if (isEnvRef(v)) v = process.env[v.$env] ?? null;
    out[field.key] = v;
  }
  return out;
}

/** Route values by schema: secret:true -> secrets.json (0600), else config.json.
 *  undefined / redaction-marker values keep the prior stored value; null clears.
 *  $env refs are stored verbatim. Both writes are temp+rename atomic. */
export function writePluginConfig(name, configSchema = [], values = {}) {
  const f = files(name);
  const config = readJson(f.config);
  const secrets = readJson(f.secrets);
  const secretKeys = new Set(configSchema.filter((x) => x && x.secret).map((x) => x.key));
  for (const [k, v] of Object.entries(values && typeof values === 'object' ? values : {})) {
    if (v === undefined || isSetMarker(v)) continue; // absent / echoed marker -> keep prior
    const bucket = secretKeys.has(k) ? secrets : config;
    const other = secretKeys.has(k) ? config : secrets;
    delete other[k]; // field migrated buckets across schema versions
    if (v === null) delete bucket[k];
    else bucket[k] = v;
  }
  writeJsonAtomic(f.config, config);
  writeJsonAtomic(f.secrets, secrets, { mode: 0o600 });
  return { ok: true };
}

/** UI echo shape: secrets -> { set: true|false } markers, non-secrets verbatim
 *  (with defaults). Secret VALUES never reach the browser after save (§7.6). */
export function redactedConfig(name, configSchema = []) {
  const f = files(name);
  const config = readJson(f.config);
  const secrets = readJson(f.secrets);
  const out = {};
  for (const field of configSchema) {
    if (field.secret) out[field.key] = { set: secrets[field.key] !== undefined };
    else out[field.key] = config[field.key] ?? field.default ?? null;
  }
  return out;
}

/** Connector KV (cursors, etags) — host-persisted ctx.state backing (§7.1). */
export function readPluginState(name) {
  return readJson(files(name).state);
}

/** Shallow-merge patch into state.json, atomic write. Returns the new state. */
export function writePluginState(name, patch = {}) {
  const f = files(name);
  const next = { ...readJson(f.state), ...(patch && typeof patch === 'object' ? patch : {}) };
  writeJsonAtomic(f.state, next);
  return next;
}
