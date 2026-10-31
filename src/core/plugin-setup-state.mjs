// src/core/plugin-setup-state.mjs — "Needs setup" for an installed plugin (Marketplace redesign, CONTRACT §1.1 `setup`):
// the required config fields still empty, per task source (and profile), chat channel and model secrets. Keys only.
import { readPluginConfig, listProfileIds } from './plugin-config.mjs';
import { brokerEnabled } from './broker-client.mjs';

const empty = (v) => v === undefined || v === null || v === '';
/** The required keys of `schema` whose value (secrets merged, $env resolved, defaults applied) is still empty —
 *  channel-host.mjs discoverChannels' rule, so a chat channel reads "needs setup" exactly when its worker is unconfigured. */
function missingKeys(name, schema, profile) {
  const values = readPluginConfig(name, schema, profile);
  return schema.filter((f) => f.required && empty(values[f.key])).map((f) => f.key);
}

export function pluginSetupState(name, manifest, { broker = brokerEnabled() } = {}) {
  const missing = [];
  const noProfiles = [];
  for (const s of manifest?.taskSources || []) {
    const schema = s.configSchema || [];
    if (!s.multiProfile) {
      const keys = missingKeys(name, schema);
      if (keys.length) missing.push({ kind: 'taskSource', id: s.id, keys });
      continue;
    }
    const profiles = listProfileIds(name);
    if (!profiles.length) { noProfiles.push(s.id); continue; }
    for (const profile of profiles) {
      const keys = missingKeys(name, schema, profile);
      if (keys.length) missing.push({ kind: 'taskSource', id: s.id, profile, keys });
    }
  }
  for (const c of manifest?.chatChannels || []) {
    const keys = missingKeys(name, c.configSchema || []);
    if (keys.length) missing.push({ kind: 'chatChannel', id: c.id, keys });
  }
  // With the credential broker on, each person adds model keys on the key page: nothing to set up here.
  if (!broker && (manifest?.modelSecrets || []).length) {
    const keys = missingKeys(name, manifest.modelSecrets.map((f) => ({ key: f.key, secret: true, required: true })));
    if (keys.length) missing.push({ kind: 'modelSecrets', id: 'modelSecrets', keys });
  }
  return { ok: !missing.length && !noProfiles.length, missing, noProfiles };
}

/** Does the manage sheet show a Settings section for this plugin? setup-fields.mjs setupSections' rule, on the manifest:
 *  a task source or chat channel with config fields, or model secrets unless the credential broker holds them. */
export function pluginHasSettings(manifest, { broker = brokerEnabled() } = {}) {
  const fields = (x) => Array.isArray(x?.configSchema) && x.configSchema.length > 0;
  if ((manifest?.taskSources || []).some(fields)) return true;
  if ((manifest?.chatChannels || []).some(fields)) return true;
  return !broker && (manifest?.modelSecrets || []).length > 0;
}
