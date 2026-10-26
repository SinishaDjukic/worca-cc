// src/core/plugin-broker-slots.mjs
// Credential-broker slots derived from enabled plugins' models (docs/credential-broker.md
// "Plugin slots"). A shared instance runs a curated plugin set its team agreed on, so a
// plugin's model endpoint gets a per-person slot without the operator writing one:
//
//   env-style model  ANTHROPIC_BASE_URL (a literal URL) + ANTHROPIC_AUTH_TOKEN or
//                    ANTHROPIC_API_KEY = {"secret": "<key>"}
//                    -> slot p-<plugin>-<key>, pinned to the base URL's origin; each
//                       person adds that key on the key page, the plugin's own Model
//                       secrets are never read
//   bridged model    upstream.baseUrl on an origin no built-in or operator slot pins
//                    -> slot p-<plugin>-<host>; the bridge finds it by origin as usual
//
// worca registers the whole set with the broker (PUT /internal/plugin-slots) at boot,
// before a spawn when it changed, and after a plugin changes.
import { createHash } from 'node:crypto';
import { upstreamIssue, PLUGIN_SLOT_PREFIX, engineOnlyAuth } from '../broker/slots.mjs';
import { brokerEnabled, brokerInfo, putPluginSlots } from './broker-client.mjs';
import { isLocalBaseUrl } from './model-env.mjs';
import { listPluginModels, pluginModelSecretStatus } from './plugin-models.mjs';
import { listGlobalModels } from './settings.mjs';

/** The env keys the Claude CLI authenticates with, and how the broker sends each. */
const AUTH_VARS = Object.freeze([['ANTHROPIC_AUTH_TOKEN', 'bearer'], ['ANTHROPIC_API_KEY', 'x-api-key']]);
const DEFAULT_BASE = Object.freeze({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' });
const SLOT_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

const isSecretRef = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.secret === 'string';
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A stable slot id for one plugin credential: p-<plugin>-<name>, hashed down when too long. Pure. */
export function pluginSlotId(plugin, name) {
  const id = `${PLUGIN_SLOT_PREFIX}${slug(plugin)}-${slug(name)}`.replace(/-+/g, '-').replace(/-$/, '');
  if (SLOT_ID_RE.test(id)) return id;
  const h = createHash('sha256').update(`${plugin}\n${name}`).digest('hex').slice(0, 6);
  return `${id.slice(0, 25).replace(/-+$/, '')}-${h}`;
}

const anthropicPaths = (root) => [['POST', `${root}/messages`], ['POST', `${root}/messages/count_tokens`], ['GET', `${root}/models`]];
const openaiPaths = (root) => [['POST', `${root}/chat/completions`], ['POST', `${root}/responses`], ['GET', `${root}/models`]];

function parseBase(base) {
  const issue = upstreamIssue(originOf(base));
  if (issue) return { error: issue.replace(/^upstream/, 'the base URL') };
  const u = new URL(base);
  if (u.search || u.hash || u.username || u.password) return { error: 'the base URL must have no query, fragment or credentials' };
  return { origin: u.origin, host: u.host, prefix: u.pathname.replace(/\/+$/, '') };
}
function originOf(v) { try { return new URL(String(v).trim()).origin; } catch { return String(v || ''); } }

/**
 * The plugin slots a set of plugin models needs. Pure.
 * @param {object[]} models  listPluginModels() entries ({plugin, id, env?, upstream?})
 * @param {{takenOrigins?:string[], secretLabel?:(plugin:string, key:string)=>string|null}} [o]
 *   takenOrigins: origins a built-in or operator slot already pins (a bridged model there keeps it)
 * @returns {{slots:object[], routes:Map<string,{slot:string,prefix:string}|{error:string}>, problems:string[]}}
 *   routes: lower-cased model id -> the slot an env-style model spends from, or why it can't
 */
export function derivePluginSlots(models, { takenOrigins = [], secretLabel = () => null } = {}) {
  const slots = new Map();
  const routes = new Map();
  const problems = [];
  const taken = new Set(takenOrigins);
  const refuse = (m, why) => {
    const msg = `plugin "${m.plugin}" model ${JSON.stringify(m.id)}: ${why}`;
    problems.push(msg);
    routes.set(m.id.toLowerCase(), { error: msg });
  };
  /** Add a slot, or widen the one already there (same id, same origin). False on a clash. */
  const add = (spec) => {
    const have = slots.get(spec.id);
    if (!have) { slots.set(spec.id, spec); return true; }
    if (have.upstream !== spec.upstream || have.auth !== spec.auth || have.protocol !== spec.protocol) return false;
    for (const p of spec.paths) if (!have.paths.some(([m, q]) => m === p[0] && q === p[1])) have.paths.push(p);
    return true;
  };

  for (const m of models || []) {
    if (!m || typeof m.id !== 'string' || !m.plugin) continue;
    if (m.upstream) {
      const up = m.upstream;
      if (up.provider === 'copilot') continue;
      const base = up.baseUrl || DEFAULT_BASE[up.provider];
      // A local or plain-http endpoint is keyless and reached directly (as the boot guard sees it).
      if (!base || isLocalBaseUrl(base) || /^http:/i.test(base)) continue;
      const b = parseBase(base);
      if (b.error) { refuse(m, b.error); continue; }
      if (taken.has(b.origin)) continue;                    // a built-in or operator slot covers it
      const protocol = up.api === 'anthropic' ? 'anthropic' : 'openai';
      const root = protocol === 'anthropic' ? (/\/v1$/.test(b.prefix) ? b.prefix : `${b.prefix}/v1`) : b.prefix;
      const spec = {
        id: pluginSlotId(m.plugin, b.host), label: `${b.host} key (${m.plugin})`, plugin: m.plugin,
        protocol, upstream: b.origin, auth: protocol === 'anthropic' ? 'x-api-key' : 'bearer',
        paths: protocol === 'anthropic' ? anthropicPaths(root) : openaiPaths(root), verify: { path: `${root}/models` },
      };
      if (!add(spec)) refuse(m, `${b.host} is reached two different ways`);
      continue;
    }
    const env = m.env || {};
    const creds = AUTH_VARS.filter(([k]) => isSecretRef(env[k]));
    const others = Object.keys(env).filter((k) => isSecretRef(env[k]) && !AUTH_VARS.some(([a]) => a === k));
    if (!creds.length && !others.length) continue;          // no plugin secret: nothing to broker
    if (others.length) { refuse(m, `the credential broker can only add a key as ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY, not ${others.join(', ')}`); continue; }
    if (creds.length > 1) { refuse(m, 'sets both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY'); continue; }
    const base = env.ANTHROPIC_BASE_URL;
    if (typeof base !== 'string' || !base.trim() || /\$\{/.test(base)) { refuse(m, 'its ANTHROPIC_BASE_URL must be a literal URL for the credential broker to pin'); continue; }
    const b = parseBase(base.trim());
    if (b.error) { refuse(m, b.error); continue; }
    const [, auth] = creds[0];
    const key = env[creds[0][0]].secret;
    const label = secretLabel(m.plugin, key) || key;
    const spec = {
      id: pluginSlotId(m.plugin, key), label: `${label} (${m.plugin})`, plugin: m.plugin,
      protocol: 'anthropic', upstream: b.origin, auth,
      paths: anthropicPaths(`${b.prefix}/v1`), verify: { path: `${b.prefix}/v1/models` },
    };
    if (!add(spec)) { refuse(m, `its secret "${key}" is used for more than one host`); continue; }
    routes.set(m.id.toLowerCase(), { slot: spec.id, prefix: b.prefix });
  }
  return { slots: [...slots.values()], routes, problems };
}

/** Origins the broker's own (built-in and operator) slots pin, from its info. */
function takenOrigins(info) {
  return (info?.slots || []).filter((s) => !s.plugin && !engineOnlyAuth(s)).map((s) => s.upstream);
}

function secretLabel(plugin, key) {
  return pluginModelSecretStatus(plugin).find((f) => f.key === key)?.label || null;
}

/** The plugin slots for the enabled plugins now, against the broker's info. Never throws. */
export function currentPluginSlots(info) {
  try { return derivePluginSlots(listPluginModels(), { takenOrigins: takenOrigins(info), secretLabel }); }
  catch (err) { return { slots: [], routes: new Map(), problems: [`plugin models: ${err.message}`] }; }
}

let _pushed = null;
/** Test seam. */
export function resetPluginSlotSync() { _pushed = null; }

/**
 * Register the enabled plugins' slots with the broker when they changed (or `force`).
 * Resolves with the derivation; null with the broker off. Throws when the broker is
 * unreachable or refuses the set.
 */
export async function syncPluginSlots({ force = false } = {}) {
  if (!brokerEnabled()) return null;
  const info = await brokerInfo();
  const d = currentPluginSlots(info);
  const fingerprint = JSON.stringify(d.slots);
  const have = (info.slots || []).filter((s) => s.plugin).map((s) => s.id).sort().join(',');
  const want = d.slots.map((s) => s.id).sort().join(',');
  if (!force && fingerprint === _pushed && have === want) return d;
  // Nothing to register and nothing registered: no call (a broker older than this worca
  // has no plugin slots endpoint, and needs none).
  if (!want && !have) { _pushed = fingerprint; return d; }
  try { await putPluginSlots(d.slots); }
  catch (err) {
    if (err.status === 404) throw new Error('the broker is older than this worca and has no plugin slots: upgrade it');
    throw err;
  }
  _pushed = fingerprint;
  await brokerInfo({ force: true });
  return d;
}

/**
 * The slot an env-style plugin model spends from: {slot, prefix}, {error}, or null when the
 * id isn't such a model (unknown, bridged, the user's own catalog entry wins, broker off).
 */
export function pluginModelRoute(modelId) {
  if (!brokerEnabled()) return null;
  const lc = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (!lc) return null;
  try {
    if (listGlobalModels().some((m) => m.id.toLowerCase() === lc)) return null;
    const pm = listPluginModels().find((m) => m.id.toLowerCase() === lc);
    if (!pm || pm.upstream) return null;
    return derivePluginSlots([pm]).routes.get(lc) || null;
  } catch { return null; }
}
