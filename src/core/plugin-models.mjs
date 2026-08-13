// src/core/plugin-models.mjs
// Model contributions from installed plugins (configurable-models-design.md §9):
// read `models` + `modelSecrets` out of every ENABLED plugin's current manifest,
// dedupe cross-plugin id collisions deterministically, and resolve {secret}
// placeholders through the existing per-plugin secrets store (plugin-config.mjs).
// Reads never throw and are hermetic under node:test for free: readPluginsLock
// resolves through worcaHome(), whose NODE_TEST_CONTEXT guard makes the lock
// read return {} unless the test sandboxes WORCA_HOME itself.
//
// Import graph: plugins-lock + plugin-manifest + plugin-config only — config.mjs
// imports THIS module (never the reverse), and plugin-store.mjs may import
// config.mjs, so nothing here may import either of them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs';
import { normalizeManifest } from './plugin-manifest.mjs';
import { readPluginConfig, redactedConfig } from './plugin-config.mjs';

/** Normalized manifest of an installed plugin's current/, or null. Never throws. */
function manifestAt(name) {
  try {
    const raw = JSON.parse(readFileSync(join(pluginCurrentDir(name), 'worca-cc-plugin.json'), 'utf8'));
    const res = normalizeManifest(raw, { dir: pluginCurrentDir(name) });
    return res.ok ? res.manifest : null;
  } catch {
    return null;
  }
}

/**
 * RAW model contributions of every enabled plugin, alphabetical by plugin name,
 * models in manifest order: [{plugin, id, label, efforts, env?, secrets:[key]}].
 * `secrets` lists the modelSecrets keys this model's env references. No
 * cross-plugin dedupe here — that is listPluginModels' job; the uninstall
 * guard needs the raw view to compute its carve-outs. Never throws.
 */
export function allPluginModels() {
  const lock = readPluginsLock();
  const out = [];
  for (const name of Object.keys(lock).sort()) {
    if (!lock[name] || lock[name].enabled === false) continue;
    const manifest = manifestAt(name);
    if (!manifest) continue;
    for (const m of manifest.models) {
      const secrets = Object.values(m.env ?? {})
        .filter((v) => v && typeof v === 'object')
        .map((v) => v.secret);
      out.push({
        plugin: name, id: m.id, label: m.label, efforts: [...m.efforts],
        ...(m.env ? { env: m.env } : {}),
        secrets: [...new Set(secrets)],
      });
    }
  }
  return out;
}

/**
 * The EFFECTIVE plugin model layer: allPluginModels with cross-plugin id
 * collisions resolved — alphabetical plugin-name order wins deterministically,
 * losers dropped with a warning (design §9.2). Never throws.
 */
export function listPluginModels() {
  const out = [];
  const seen = new Map(); // lc id -> winning plugin
  for (const m of allPluginModels()) {
    const lc = m.id.toLowerCase();
    const winner = seen.get(lc);
    if (winner) {
      console.warn(`[worca] plugin "${m.plugin}": model id ${JSON.stringify(m.id)} already provided by plugin "${winner}" — dropped`);
      continue;
    }
    seen.set(lc, m.plugin);
    out.push(m);
  }
  return out;
}

/** modelSecrets of a plugin as a plugin-config schema (all secret text fields). */
export function modelSecretsSchema(name) {
  const manifest = manifestAt(name);
  return (manifest?.modelSecrets ?? []).map((f) => ({
    key: f.key, type: 'text', label: f.label,
    secret: true, required: false, default: null, help: null, options: [],
  }));
}

/** Set-ness of a plugin's modelSecrets, values never included:
 *  [{key, label, set}]. Never throws. */
export function pluginModelSecretStatus(name) {
  const schema = modelSecretsSchema(name);
  if (!schema.length) return [];
  try {
    const red = redactedConfig(name, schema);
    return schema.map((f) => ({ key: f.key, label: f.label, set: red[f.key]?.set === true }));
  } catch {
    return schema.map((f) => ({ key: f.key, label: f.label, set: false }));
  }
}

/**
 * Flatten one plugin model's env to plain strings: literals and ${VAR} ref text
 * pass through; {secret} placeholders resolve via the plugin's secrets store
 * ({"$env":"VAR"} indirection honored there). Unresolvable secrets are dropped
 * and reported — same degradation as an unresolvable ${VAR} ref downstream.
 * @param {{plugin:string, env?:object}} model  an allPluginModels entry
 * @returns {{env: Record<string,string>, droppedSecrets: string[]}}
 */
export function flattenPluginModelEnv(model) {
  const env = {};
  const droppedSecrets = [];
  const entries = Object.entries(model?.env ?? {});
  if (!entries.length) return { env, droppedSecrets };
  let secrets = {};
  const schema = modelSecretsSchema(model.plugin);
  if (schema.length) {
    try { secrets = readPluginConfig(model.plugin, schema); } catch { secrets = {}; }
  }
  for (const [k, v] of entries) {
    if (typeof v === 'string') {
      env[k] = v;
    } else {
      const resolved = secrets[v.secret];
      if (typeof resolved === 'string' && resolved) env[k] = resolved;
      else droppedSecrets.push(`${k} (secret "${v.secret}")`);
    }
  }
  return { env, droppedSecrets };
}
