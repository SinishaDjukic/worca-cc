// src/core/secrets/settings-resolver.mjs — the synchronous resolver for vault references stored in settings.json.
// settings.mjs imports it statically, so it imports only node:fs and refs.mjs: never vault.mjs or os-store.mjs (no
// cycle, no keyring load). It holds the process's decrypted settings entries through a reader closure that
// settings-vault.mjs installs once its async prime has the master key; it decrypts again only when the vault file's
// signature (inode, size, mtime in ns) changes, so another process's atomic write is seen on the next read. It never
// calls the OS store. With no reader installed a reference resolves to '' with code `locked`, and a changed vault
// file calls the registered stale hook once per signature (settings-vault.mjs re-primes off the sync path).
// Resolution does not check the flag: a primed process keeps resolving if the flag is turned off while it runs.
import { statSync } from 'node:fs';
import { isVaultRef, refId } from './refs.mjs';

/** The settings fields whose secrets go into the vault, bound per field kind (never per model id). */
const PROVIDER_FIELDS = new Set([
  'providers.openai.apiKey', 'providers.anthropic.apiKey', 'providers.copilot.githubToken', 'providers.openrouter.apiKey',
  'providers.speech.stt.apiKey', 'providers.speech.tts.apiKey', 'providers.images.apiKey', 'providers.sound.apiKey',
]);
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The owner field of a settings secret: `('providers', 'openai', 'apiKey')`, `('providers', 'speech', 'stt',
 * 'apiKey')`, `('models', 'upstream', 'apiKey')` or `('models', 'env', KEY)`. Anything else throws.
 */
export function settingsSecretField(kind, ...parts) {
  const field = [kind, ...parts].join('.');
  if (kind === 'providers' && PROVIDER_FIELDS.has(field)) return field;
  if (kind === 'models' && parts.length === 2) {
    if (parts[0] === 'upstream' && parts[1] === 'apiKey') return field;
    if (parts[0] === 'env' && ENV_KEY_RE.test(parts[1])) return field;
  }
  throw new Error(`unknown settings secret field ${JSON.stringify(field)}`);
}

let reader = null;      // { file, read } while this process holds the key
let watched = null;     // the vault file whose changes wake the stale hook while no reader is installed
let seen;               // the signature last seen while no reader is installed
let cache = null;       // { sig, entries } of the last good read
let staleHook = null;
let decrypts = 0;

function signature(file) {
  try {
    const s = statSync(file, { bigint: true });
    return `${s.ino}:${s.size}:${s.mtimeNs}`;
  } catch {
    return 'none';
  }
}

/** Install the reader: `read()` → `{ keyId, entries } | null`, throwing a VaultError on a bad file. */
export function installSettingsVaultReader({ file, read }) {
  reader = { file, read };
  watched = file;
  cache = null;
}

/** Drop the reader (references resolve `locked` again). `file` is the vault file to watch for the stale hook. */
export function clearSettingsVaultReader({ file } = {}) {
  reader = null;
  cache = null;
  if (file) watched = file;
  seen = watched ? signature(watched) : undefined;
}

/** Register the hook called (once per vault file signature) when a reference is read with no reader installed. */
export function onSettingsVaultStale(fn) {
  staleHook = fn;
}

/**
 * `{ value }` or `{ code }` for reference `ref` read by owner `{ store, field }` (any vault store). Codes: locked,
 * bad-ref, unknown-ref, cross-owner, or the read's VaultError code. The one synchronous read of a decrypted entry:
 * never throws and never touches the store; a failed read is not cached as good.
 */
export function resolveVaultRefSync(ref, { store, field } = {}) {
  if (!isVaultRef(ref)) return { code: 'bad-ref' };
  if (!reader) {
    if (watched && staleHook) {
      const sig = signature(watched);
      if (sig !== seen) {
        seen = sig;
        try { staleHook(); } catch { /* the hook schedules async work; a throw must not break a read */ }
      }
    }
    return { code: 'locked' };
  }
  const sig = signature(reader.file);
  if (!cache || cache.sig !== sig) {
    cache = null;
    let r;
    try { r = reader.read(); } catch (err) { return { code: err?.code ?? 'tampered' }; }
    if (r) decrypts++;
    cache = { sig, entries: r ? r.entries : {} };
  }
  const id = refId(ref);
  const e = Object.hasOwn(cache.entries, id) ? cache.entries[id] : null;
  if (!e) return { code: 'unknown-ref' };
  if (e.store !== store || e.field !== field) return { code: 'cross-owner' };
  return { value: e.value };
}

/** `resolveVaultRefSync` for a settings.json field. */
export function resolveSettingsRef(ref, field) {
  return resolveVaultRefSync(ref, { store: 'settings', field });
}

/** A non-reference passes through; a reference resolves to its value, or '' when it does not resolve. */
export function resolveSettingsSecretSync(value, field) {
  if (!isVaultRef(value)) return value;
  const r = resolveSettingsRef(value, field);
  return r.value ?? '';
}

/** `{ loaded, generation }`: whether a reader is installed, and the vault file signature (a readiness cache key). */
export function settingsVaultState() {
  const file = reader?.file ?? watched;
  return { loaded: !!reader, generation: file ? signature(file) : 'none' };
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * Every secret slot of a settings object, whatever it holds: each provider secret, each model's `upstream.apiKey` and
 * each model `env` value under a valid key name. `{ value, field, path, modelId? }`: the raw value, its owner field,
 * its path in the object and, for a model slot, the model's `id`. Pure; the one walk over settings secret fields.
 * @returns {{ value: any, field: string, path: (string|number)[], modelId?: any }[]}
 */
export function settingsSecretSlots(settings) {
  const out = [];
  const p = obj(settings?.providers);
  const provider = (path, value) => out.push({ value, field: path.join('.'), path });
  for (const name of ['openai', 'anthropic', 'openrouter', 'images', 'sound']) provider(['providers', name, 'apiKey'], obj(p[name]).apiKey);
  provider(['providers', 'copilot', 'githubToken'], obj(p.copilot).githubToken);
  provider(['providers', 'speech', 'stt', 'apiKey'], obj(obj(p.speech).stt).apiKey);
  provider(['providers', 'speech', 'tts', 'apiKey'], obj(obj(p.speech).tts).apiKey);
  (Array.isArray(settings?.models) ? settings.models : []).forEach((m, i) => {
    const modelId = obj(m).id;
    out.push({ value: obj(obj(m).upstream).apiKey, field: 'models.upstream.apiKey', path: ['models', i, 'upstream', 'apiKey'], modelId });
    for (const [k, v] of Object.entries(obj(obj(m).env))) {
      if (ENV_KEY_RE.test(k)) out.push({ value: v, field: `models.env.${k}`, path: ['models', i, 'env', k], modelId });
    }
  });
  return out;
}

/**
 * Every vault reference a settings object holds, with its owner field (settingsSecretSlots holding a reference).
 * Pure; the one list of settings secret fields that hold references.
 * @returns {{ ref: string, field: string }[]}
 */
export function settingsSecretRefs(settings) {
  return settingsSecretSlots(settings).filter((s) => isVaultRef(s.value)).map((s) => ({ ref: s.value, field: s.field }));
}

/** The references of `before` that `after` no longer holds (compared by reference). Pure. */
export function refsDropped(before, after) {
  const kept = new Set(after.map((r) => r.ref));
  return before.filter((r) => !kept.has(r.ref));
}

const noted = new Set();

/**
 * Log once per owner field and code per process that a stored vault reference could not be read. The line names the
 * owner field and the code only: never the value, the reference or a path.
 */
export function noteUnresolved(field, code, log = (line) => console.warn(line)) {
  const key = `${field}\n${code}`;
  if (noted.has(key)) return;
  noted.add(key);
  log(`[worca] vault: the saved secret ${field} cannot be read (${code})`);
}

/** `{ decrypts }`, for tests. */
export function settingsResolverStats() {
  return { decrypts };
}
