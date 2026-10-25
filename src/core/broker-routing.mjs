// src/core/broker-routing.mjs
// Which credential-broker slot a model spends from (plans/credential-broker-design.html
// §5.3). The broker's slots each pin one provider origin; a model reaches a slot by:
//   - Copilot            -> the broker's Copilot slot (auth 'copilot')
//   - a bridged provider -> the slot whose pinned origin equals the base URL's origin
//                           (api.openai.com -> openai, openrouter.ai -> openrouter, a
//                           gateway named in the broker's slots file -> that slot)
//   - a keyless local endpoint (llama.cpp, Ollama, LM Studio on this machine or network)
//                        -> no slot: it holds no key, the bridge reaches it directly
//   - a plugin model whose key is a plugin secret -> that plugin's own slot
//                           (plugin-broker-slots.mjs; bridged ones match by origin above)
//   - anything else      -> the anthropic slot, or the slot its ANTHROPIC_BASE_URL names
// Synchronous: reads the broker info cached at boot and on every spawn (broker-client.mjs).
import { brokerEnabled, cachedBrokerInfo, slotOfBaseUrl } from './broker-client.mjs';
import { isLocalBaseUrl } from './model-env.mjs';
import { findBridgedEntry } from './bridge/registry.mjs';
import { providerConfig, listGlobalModels } from './settings.mjs';
import { listPluginModels } from './plugin-models.mjs';
import { pluginModelRoute } from './plugin-broker-slots.mjs';
import { engineEntry } from '../shared/engine-switch.mjs';
import { engineOnlyAuth } from '../broker/slots.mjs';

// Which engine runs a catalog model (config.mjs engineOfModel). config.mjs registers it: importing config.mjs here would
// close an import cycle (config.mjs → bridge/registry.mjs → this module) that breaks module evaluation.
let engineOfModel = () => null;
/** config.mjs hands in its engineOfModel (the model catalog's owner) once it has loaded. */
export function setModelEngineReader(fn) { engineOfModel = typeof fn === 'function' ? fn : () => null; }

const DEFAULT_BASE = Object.freeze({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' });

/**
 * {slot, prefix} for a base URL whose origin a (non-Copilot) slot pins, else null. Pure.
 * One host can serve both APIs (a gateway): a slot of the wanted `protocol` wins.
 */
export function slotForBaseUrl(baseUrl, slots = [], protocol = null) {
  let u;
  try { u = new URL(String(baseUrl || '').trim()); } catch { return null; }
  const same = slots.filter((x) => !engineOnlyAuth(x) && x.upstream === u.origin);
  const s = (protocol && same.find((x) => x.protocol === protocol)) || same[0];
  if (!s) return null;
  return { slot: s.id, prefix: u.pathname.replace(/\/+$/, '') };
}

/**
 * How a bridged entry's upstream reaches its provider with the broker on. Pure given `slots`.
 * @param {{provider:string, baseUrl?:string}} upstream
 * @returns {{slot:string, prefix:string, copilot?:boolean}|{keyless:true}|{error:string}}
 */
export function routeUpstream(upstream, { slots = [], providerBaseUrl = null } = {}) {
  if (!upstream) return { slot: 'anthropic', prefix: '' };
  if (upstream.provider === 'copilot') {
    const s = slots.find((x) => x.auth === 'copilot');
    return s ? { slot: s.id, prefix: '', copilot: true } : { error: 'the credential broker has no GitHub Copilot slot' };
  }
  const base = upstream.baseUrl || providerBaseUrl || DEFAULT_BASE[upstream.provider] || null;
  if (!base) return { error: `provider ${upstream.provider} has no base URL` };
  // A slot that pins this origin wins, even for a local address: the operator put that
  // server behind the broker (a llama-server with --api-key, say). Otherwise a local
  // endpoint holds no key and is reached directly.
  const protocol = upstream.api === 'anthropic' || upstream.provider === 'anthropic' ? 'anthropic' : 'openai';
  const hit = slotForBaseUrl(base, slots, protocol);
  if (hit) return hit;
  if (isLocalBaseUrl(base)) return { keyless: true };
  let host = base;
  try { host = new URL(base).host; } catch { /* keep */ }
  return { error: `no credential slot for ${host}: the broker's operator adds it to WORCA_BROKER_SLOTS_FILE` };
}

/** The broker's slots from the cached info ([] before the first contact). */
export function brokerSlots() {
  return cachedBrokerInfo()?.slots || [];
}

/** routeUpstream against the live broker info, with the provider's own base URL as the fallback. */
export function routeBridgedUpstream(upstream) {
  let providerBaseUrl = null;
  try { providerBaseUrl = upstream && upstream.provider !== 'copilot' ? (providerConfig(upstream.provider).baseUrl || null) : null; } catch { /* none */ }
  return routeUpstream(upstream, { slots: brokerSlots(), providerBaseUrl });
}

/** Every non-empty `model` string anywhere in a run's manifest (v1 stepper or v2 graph). Pure. */
export function manifestModels(manifest, out = new Set(), depth = 0) {
  if (!manifest || typeof manifest !== 'object' || depth > 8) return out;
  if (Array.isArray(manifest)) { for (const x of manifest) manifestModels(x, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(manifest)) {
    // `runOverlay` (orchestrator.mjs) records what a run was ASKED to use; the cells hold what it runs (a defragment
    // pair or an engine switch can override a pick), so a model only that record names is never dispatched.
    if (depth === 0 && k === 'runOverlay') continue;
    if (k === 'model' && typeof v === 'string' && v.trim()) out.add(v.trim());
    else if (v && typeof v === 'object') manifestModels(v, out, depth + 1);
  }
  return out;
}

/**
 * Whether a run's manifest will call a model at all: an Auto run decides its graph with one, and a
 * graph with an agent card spawns one. A graph of script and flow cards only never does, so no key
 * is needed for it. An unknown shape counts as needing one. Pure.
 */
export function manifestNeedsModel(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.auto) return true;
  const nodes = manifest.graph?.nodes ?? manifest.nodes;
  if (!Array.isArray(nodes)) return true;
  return nodes.some((n) => n && n.kind === 'agent');
}

/** The same question for a workflow row before the run starts (the Auto stub has no nodes). Pure. */
export function workflowNeedsModel(row) {
  if (!row || typeof row !== 'object' || row.auto || !Array.isArray(row.nodes)) return true;
  return row.nodes.some((n) => n && n.kind === 'agent');
}

/**
 * Which credentials a set of models needs, and which of them a person lacks. Pure.
 * @param {string[]} modelIds
 * @param {(id:string)=>({slot:string}|{keyless:true}|{error:string}|null)} slotOf
 * @param {{id:string,label:string,state:string}[]} status  the person's slots (broker)
 * @returns {{missing:{slot:string,label:string,state:string,models:string[]}[], errors:string[]}}
 */
export function missingCredentials(modelIds, slotOf, status = []) {
  const need = new Map();
  const errors = [];
  for (const id of new Set(modelIds)) {
    const r = slotOf(id);
    if (!r || r.keyless) continue;
    if (r.error) { errors.push(`${id}: ${r.error}`); continue; }
    if (!need.has(r.slot)) need.set(r.slot, []);
    need.get(r.slot).push(id);
  }
  const byId = new Map(status.map((s) => [s.id, s]));
  const missing = [];
  for (const [slot, models] of need) {
    const s = byId.get(slot);
    if (s && ['set', 'keyless', 'operator'].includes(s.state)) continue;
    missing.push({ slot, label: s?.label || slot, state: s?.state || 'missing', models });
  }
  return { missing, errors };
}

/** One sentence naming what's missing, for a refusal. */
export function describeMissing({ missing, errors }, keyPage) {
  const parts = missing.map((m) => `${m.label} (${m.state === 'invalid' ? 'rejected by the provider' : 'not added'}; needed by ${m.models.join(', ')})`);
  const where = keyPage ? ` Add them on the key page (${keyPage}), then start again.` : '';
  return [
    parts.length ? `missing credentials: ${parts.join('; ')}.${where}` : '',
    errors.length ? `models that can't reach a credential: ${errors.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
}

/**
 * The slot a catalog model spends from, for badges and the start-of-run check.
 * @returns {{slot:string}|{keyless:true}|{error:string}|null} null with the broker off
 */
export function modelSlot(modelId) {
  if (!brokerEnabled()) return null;
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return null;
  const bridged = findBridgedEntry(id);
  if (bridged) {
    const r = routeBridgedUpstream(bridged.upstream);
    return r.slot ? { slot: r.slot } : r;
  }
  // An env-style plugin model with a plugin secret: its own plugin slot (plugin-broker-slots.mjs).
  const pr = pluginModelRoute(id);
  if (pr) return pr.slot ? { slot: pr.slot } : pr;
  // A model another engine runs with its own sign-in (a codex model): the broker slot of that engine's key mode, read
  // off the catalog (Codex's API key sits in the openai slot), never the anthropic slot.
  let owner = null;
  try { owner = engineEntry(engineOfModel(id)); } catch { owner = null; }
  if (owner && owner.relay?.upstream !== 'anthropic') {
    // An engine whose model id names its provider (Goose, OpenCode: `provider/model`): that provider's slot.
    const slash = owner.signIn.byModel ? id.indexOf('/') : -1;
    const modes = slash > 0 ? owner.signIn.modes.filter((m) => m.id === id.slice(0, slash)) : owner.signIn.modes;
    const slot = modes.find((m) => m.kind !== 'own' && m.brokerSlot)?.brokerSlot;
    if (slot) return { slot };
  }
  const lc = id.toLowerCase();
  let entry = null;
  try { entry = listGlobalModels().find((m) => m.id.toLowerCase() === lc) || listPluginModels().find((m) => m.id.toLowerCase() === lc) || null; } catch { entry = null; }
  const base = entry && entry.env && typeof entry.env.ANTHROPIC_BASE_URL === 'string' ? entry.env.ANTHROPIC_BASE_URL : null;
  if (!base) return { slot: 'anthropic' };
  const s = slotOfBaseUrl(base);
  return s ? { slot: s } : { error: 'this model routes around the credential broker' };
}
