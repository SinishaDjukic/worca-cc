// src/core/broker-boot.mjs
// The server's boot check for the credential broker (plans/credential-broker-design.html
// §6.7): configuration, the credential guard (K1), then the broker itself. Returns the
// problems instead of exiting, so ui/server.mjs prints them and exits 78 in one place.
import { brokerConfig, connectBroker } from './broker-client.mjs';
import { findLocalCredentials, credentialFiles, guardMessage } from './broker-guard.mjs';
import { listGlobalModels, readSettings } from './settings.mjs';
import { listPluginModels } from './plugin-models.mjs';

/**
 * @param {{env?:object, shared?:boolean, log?:Function, waitMs?:number}} o
 *   shared: several people sign in (Cloudflare Access or a trusted identity header)
 * @returns {Promise<{on:boolean, fatal:string[], warnings:string[], info?:object}>}
 */
export async function checkBrokerAtBoot({ env = process.env, shared = false, log = console.log, waitMs = 60_000 } = {}) {
  const c = brokerConfig(env);
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

  // The broker first: its slots say which remote endpoints are reachable through it.
  let info;
  try {
    info = await connectBroker({ waitMs, log });
  } catch (err) {
    return { on: true, fatal: [`${err.message}. Is the broker running at ${c.url}, and does WORCA_BROKER_SECRET match on both sides?`], warnings: [] };
  }

  let models = [];
  let providers = {};
  try { models = [...listGlobalModels(), ...listPluginModels()]; } catch { /* unreadable settings: nothing to check */ }
  try { providers = readSettings().providers || {}; } catch { /* same */ }
  const findings = findLocalCredentials({
    env,
    files: credentialFiles([env.HOME, env.WORCA_AGENT_HOME]),
    models,
    providers,
    brokerUrl: c.url,
    slotOrigins: (info.slots || []).filter((s) => s.auth !== 'copilot' && s.auth !== 'github-user').map((s) => s.upstream),
  });
  if (findings.length) return { on: true, fatal: [guardMessage(findings, info.publicUrl)], warnings: [] };
  const warnings = [];
  const asPerson = String(env.WORCA_GH_AS_PERSON || '').trim().toLowerCase();
  if (asPerson && !['prefer', 'required', 'off', '0'].includes(asPerson)) warnings.push(`WORCA_GH_AS_PERSON must be prefer or required (got ${JSON.stringify(asPerson)}); pushes use worca's own GitHub credential`);
  if ((asPerson === 'prefer' || asPerson === 'required') && !(info.slots || []).some((s) => s.auth === 'github-user')) {
    warnings.push(`WORCA_GH_AS_PERSON=${asPerson}, but the broker has no GitHub slot (set WORCA_BROKER_GITHUB_CLIENT_ID on it)${asPerson === 'required' ? ': every push will fail' : ''}`);
  }
  return { on: true, fatal: [], warnings, info };
}
