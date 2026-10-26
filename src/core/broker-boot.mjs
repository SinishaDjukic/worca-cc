// src/core/broker-boot.mjs
// The server's boot check for the credential broker (plans/credential-broker-design.html
// §6.7): configuration, the credential guard (K1), then the broker itself. Returns the
// problems instead of exiting, so ui/server.mjs prints them and exits 78 in one place.
import { brokerConfig, currentBrokerConfig, connectBroker, cachedBrokerInfo, sealedSecretFileMode } from './broker-client.mjs';
import { agentIdentity } from './agent-user.mjs';
import { findLocalCredentials, credentialFiles, guardMessage } from './broker-guard.mjs';
import { listGlobalModels, readSettings } from './settings.mjs';
import { listPluginModels, pluginModelSecretStatus } from './plugin-models.mjs';
import { syncPluginSlots, currentPluginSlots } from './plugin-broker-slots.mjs';
import { engineOnlyAuth } from '../broker/slots.mjs';

/**
 * @param {{env?:object, shared?:boolean, log?:Function, waitMs?:number}} o
 *   shared: several people sign in (Cloudflare Access or a trusted identity header)
 * @returns {Promise<{on:boolean, fatal:string[], warnings:string[], info?:object}>}
 */
export async function checkBrokerAtBoot({ env = process.env, shared = false, log = console.log, waitMs = 60_000 } = {}) {
  // The server's own env no longer holds the secret (sealBrokerSecret): the sealed config has it.
  const c = env === process.env ? currentBrokerConfig() : brokerConfig(env);
  if (!c) {
    const warnings = [];
    const fatal = [];
    if (shared) {
      const msg = 'several people sign in to this worca, but the credential broker is off: everyone shares the model key in worca\'s environment, and agents can read it. See docs/credential-broker.md.';
      if (/^(1|true|yes|on)$/i.test(String(env.WORCA_BROKER_REQUIRED || ''))) fatal.push(`${msg} (WORCA_BROKER_REQUIRED is set)`);
      else warnings.push(msg);
    }
    return { on: false, fatal, warnings };
  }
  if (c.error) return { on: true, fatal: [c.error], warnings: [] };
  // X2: under agent isolation an agent user reads a secret file its group or others may read; the secret lets it
  // mint tokens charged to anyone. The sealed file's mode decides (sealBrokerSecret read it once).
  const fileMode = env === process.env ? sealedSecretFileMode() : null;
  if (fileMode !== null && (fileMode & 0o044) && agentIdentity(env)) {
    return { on: true, fatal: [`WORCA_BROKER_SECRET_FILE is readable by its group or by others (mode 0${fileMode.toString(8)}), and agents run under their own users: they could read the broker secret. Make it 0600, owned by the user worca runs as. See docs/credential-broker.md.`], warnings: [] };
  }

  // The broker first: its slots say which remote endpoints are reachable through it.
  let info;
  try {
    info = await connectBroker({ waitMs, log });
  } catch (err) {
    return { on: true, fatal: [`${err.message}. Is the broker running at ${c.url}, and does WORCA_BROKER_SECRET match on both sides?`], warnings: [] };
  }

  // Several people's keys and GitHub tokens sit behind the broker secret, and an agent running as
  // worca can read it from worca's process (/proc/<pid>/environ): agents need their own users.
  const isolationWarnings = [];
  if (info.mode === 'multi' && !agentIdentity(env)) {
    const msg = 'the credential broker is in multi mode, but agents run as worca itself: they can read worca\'s broker secret from its process, then mint tokens charged to anyone or fetch a person\'s GitHub token. Run agents under their own users (docker/compose.isolation.yml; single-volume hosts such as Railway do already). See docs/credential-broker.md.';
    if (String(env.WORCA_AGENT_ISOLATION || '').trim() !== '0') return { on: true, fatal: [msg], warnings: [] };
    isolationWarnings.push(`${msg} (WORCA_AGENT_ISOLATION=0 accepts it)`);
  }

  // Then the enabled plugins' own slots, so their endpoints count as reachable through it.
  // Not fatal when that fails: the plugin models are then refused at spawn (the broker
  // doesn't know their slot), and no key is any closer to an agent.
  let plugin;
  let syncError = null;
  try { plugin = await syncPluginSlots({ force: true }); }
  catch (err) { syncError = `cannot register the plugins' credential slots with the broker: ${err.message}; their models can't be used until it works`; }
  if (plugin) info = cachedBrokerInfo() || info;
  else plugin = currentPluginSlots(info);

  let models = [];
  let providers = {};
  let pluginSecrets = [];
  try { models = [...listGlobalModels(), ...listPluginModels()]; } catch { /* unreadable settings: nothing to check */ }
  try { providers = readSettings().providers || {}; } catch { /* same */ }
  for (const name of new Set(models.map((m) => m.plugin).filter(Boolean))) {
    pluginSecrets.push(...pluginModelSecretStatus(name).filter((f) => f.set).map((f) => ({ plugin: name, key: f.key })));
  }
  const findings = findLocalCredentials({
    env,
    files: credentialFiles([env.HOME, env.WORCA_AGENT_HOME]),
    models,
    providers,
    brokerUrl: c.url,
    slotOrigins: (info.slots || []).filter((s) => !engineOnlyAuth(s)).map((s) => s.upstream),
    brokeredModels: [...plugin.routes].filter(([, r]) => r.slot).map(([id]) => id),
    pluginSecrets,
  });
  if (findings.length) return { on: true, fatal: [guardMessage(findings, info.publicUrl)], warnings: [] };
  // A plugin model the broker can't serve is refused when picked, not at boot.
  const warnings = [...isolationWarnings, ...plugin.problems.map((p) => `${p}; it can't be used while the credential broker is on`)];
  if (syncError) warnings.push(syncError);
  const asPerson = String(env.WORCA_GH_AS_PERSON || '').trim().toLowerCase();
  if (asPerson && !['prefer', 'required', 'off', '0'].includes(asPerson)) warnings.push(`WORCA_GH_AS_PERSON must be prefer or required (got ${JSON.stringify(asPerson)}); pushes use worca's own GitHub credential`);
  if ((asPerson === 'prefer' || asPerson === 'required') && !(info.slots || []).some((s) => s.auth === 'github-user')) {
    warnings.push(`WORCA_GH_AS_PERSON=${asPerson}, but the broker has no GitHub slot (set WORCA_BROKER_GITHUB_CLIENT_ID on it)${asPerson === 'required' ? ': every push will fail' : ''}`);
  }
  return { on: true, fatal: [], warnings, info };
}
