// src/shared/flags/resolve.mjs — pure flag resolution (docs/feature-flags.md, D3). Browser-safe.
// Order: WORCA_FLAGS (locks) > settings.json `flags` > the registry default. A retiring flag is
// forced to its default. A flag is ON only when everything it `requires` is on (fail closed).
import { FLAG_KEY_RE } from './registry.mjs';

/** WORCA_FLAGS="a,-b" → Map { a → true, b → false }. Blank tokens are skipped, a malformed token is
 *  reported through `warn(token, 'WORCA_FLAGS')`, and the last mention of a key wins. */
export function parseEnvFlags(str, { warn = () => {} } = {}) {
  const out = new Map();
  for (const raw of String(str || '').split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const off = t.startsWith('-');
    const key = off ? t.slice(1) : t;
    if (!FLAG_KEY_RE.test(key)) { warn(t, 'WORCA_FLAGS'); continue; }
    out.delete(key);
    out.set(key, !off);
  }
  return out;
}

/**
 * @param {{registry:ReadonlyArray<object>, env?:string, stored?:object, warn?:(key:string, where:string)=>void}} o
 * @returns {Record<string,{on:boolean, self:boolean, source:'env'|'settings'|'default', locked:boolean}>}
 */
export function resolveFlags({ registry, env = '', stored = {}, warn = () => {} }) {
  const byKey = new Map(registry.map((f) => [f.key, f]));
  const envMap = parseEnvFlags(env, { warn });
  for (const k of envMap.keys()) if (!byKey.has(k)) warn(k, 'WORCA_FLAGS');
  const st = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  for (const k of Object.keys(st)) if (!byKey.has(k)) warn(k, 'settings.json');
  const out = {};
  for (const f of registry) {
    if (f.stage === 'retiring') out[f.key] = { self: f.default, source: 'default', locked: true };
    else if (envMap.has(f.key)) out[f.key] = { self: envMap.get(f.key), source: 'env', locked: true };
    else if (typeof st[f.key] === 'boolean') out[f.key] = { self: st[f.key], source: 'settings', locked: false };
    else out[f.key] = { self: f.default, source: 'default', locked: false };
  }
  const memo = new Map();
  const effective = (k, path) => {
    if (memo.has(k)) return memo.get(k);
    if (path.has(k)) return false;   // a cycle (the registry test forbids them): fail closed
    path.add(k);
    const v = out[k].self && (byKey.get(k).requires || []).every((r) => byKey.has(r) && effective(r, path));
    path.delete(k);
    memo.set(k, v);
    return v;
  };
  for (const f of registry) out[f.key].on = effective(f.key, new Set());
  return out;
}

/** The <html data-flags> value: the keys that are on, in registry order. `state` is { key: bool }. */
export function flagsAttr(registry, state) {
  return registry.filter((f) => state[f.key] === true).map((f) => f.key).join(' ');
}

/** The #flag-gates sheet (D5): one rule per registry flag that is off. Keys match FLAG_KEY_RE, so no escaping. */
export function flagGateCss(registry, state) {
  return registry.filter((f) => state[f.key] !== true).map((f) => `[data-flag~="${f.key}"]{display:none!important}`).join('\n');
}
