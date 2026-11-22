// src/core/bridge/registry.mjs
// Which catalog entries are bridged, and with what (model-bridge-design.md
// §4.2/§6). Import contract: settings.mjs, plugin-models.mjs, the policy
// cache, the zero-import model-env.mjs leaf and the pure secrets/refs.mjs only — config.mjs imports the
// bridge (for resolveModelEnv), so nothing under src/core/bridge/ may import
// config.mjs.

import { listGlobalModels, openRouterConfig, providerConfig, providerSecretSet, resolveProviderSecret } from '../settings.mjs';
import { listPluginModels } from '../plugin-models.mjs';
import { policyCatalogModels } from '../policy/cache.mjs';
import { isLocalBaseUrl, isOpenRouterBaseUrl, OWN_SIGNIN_ENGINES } from '../model-env.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { routeBridgedUpstream } from '../broker-routing.mjs';
import { VAULT_MESSAGES, isVaultRef } from '../secrets/refs.mjs';

/** An OpenAI-compatible endpoint on this machine / a private network needs no key. */
export function keyOptional(provider, baseUrl) {
  return provider === 'openai' && isLocalBaseUrl(baseUrl);
}

/** The scheme, host and port of a URL, lower-cased; '' for anything unparsable. */
function originOf(u) {
  try { return new URL(String(u || '').trim()).origin.toLowerCase(); } catch { return ''; }
}

/**
 * The provider's own key, when it may go with this entry: the entry has no base URL of its own, or that base URL is
 * on the provider's origin. A key set for one host (OpenRouter on the OpenAI-compatible card) is never sent to another
 * (a Gemini or Qwen entry with its own base URL): that entry needs its own key.
 */
export function providerKeyFor(upstream, cfg) {
  if (upstream && upstream.baseUrl && originOf(upstream.baseUrl) !== originOf(cfg && cfg.baseUrl)) return '';
  return resolveProviderSecret(cfg && cfg.apiKey, process.env, providerKeyField(upstream));
}

/** The settings field of the provider key `upstream` takes (an entry with no provider is the OpenAI-compatible one's). */
const providerKeyField = (upstream) => `providers.${upstream && upstream.provider === 'anthropic' ? 'anthropic' : 'openai'}.apiKey`;
/** A vault reference that does not resolve here (the key store is locked, or this process holds no key). */
const lockedRef = (v, field) => isVaultRef(v) && !resolveProviderSecret(v, process.env, field);
const lockedMessage = (p) => `provider ${p}: ${VAULT_MESSAGES['store-locked']}`;

// ── OpenRouter (providers.openrouter) ─────────────────────────────────────────
// Catalog entries keep `upstream.provider: 'openai'`; an entry is OpenRouter's when its effective base URL (its own,
// else the OpenAI-compatible row's) is on openrouter.ai. Such an entry takes its key, its concurrency cap and its
// routing defaults from the OpenRouter row. `cfg` = { openrouter, openai }; a missing field reads as its default.

const openRouterCfg = () => ({ openrouter: openRouterConfig(), openai: providerConfig('openai') });
const hasText = (v) => typeof v === 'string' && v.trim() !== '';
/** A key text that resolves to nothing: a whole-value ${VAR} whose variable is not set (a vault reference is lockedRef's). */
const unsetRef = (v, field) => hasText(v) && !isVaultRef(v) && !resolveProviderSecret(v, process.env, field);
const isHttps = (u) => { try { return new URL(String(u || '').trim()).protocol === 'https:'; } catch { return false; } };
const cfgParts = (cfg) => ({ r: (cfg && cfg.openrouter) || {}, oa: (cfg && cfg.openai) || {} });
const nonEmptyList = (v) => Array.isArray(v) && v.length > 0;

/** The base URL a request for `upstream` goes to, before any default: its own, else the OpenAI-compatible row's. */
const effectiveBase = (upstream, oa) => (upstream && upstream.baseUrl) || oa.baseUrl;

/** Whether `upstream` is OpenRouter's: provider openai and an effective base URL on openrouter.ai. */
export function isOpenRouterEntry(upstream, oa) {
  return !!upstream && upstream.provider === 'openai' && isOpenRouterBaseUrl(effectiveBase(upstream, oa));
}

/**
 * The key a request for `upstream` carries, and which link of the chain decided it. The first link that applies wins:
 * the entry's own key; nothing for an entry that is not OpenRouter's; the OpenRouter row's key, only over https (an
 * unset ${VAR} there gives '' and stops the chain: the user chose that key); the OpenAI-compatible row's key while that
 * row itself points at openrouter.ai and providerKeyFor's origin rule allows it (exactly today's answer); else none.
 * @returns {{ value: string, source: 'entry'|'openrouter'|'openai-legacy'|'' }}
 */
export function openRouterKeyFor(upstream, cfg = openRouterCfg()) {
  const own = resolveProviderSecret(upstream && upstream.apiKey, process.env, 'models.upstream.apiKey');
  if (own) return { value: own, source: 'entry' };
  const { r, oa } = cfgParts(cfg);
  if (!isOpenRouterEntry(upstream, oa)) return { value: '', source: '' };
  if (hasText(r.apiKey)) {
    return isHttps(effectiveBase(upstream, oa)) ? { value: resolveProviderSecret(r.apiKey, process.env, 'providers.openrouter.apiKey'), source: 'openrouter' } : { value: '', source: '' };
  }
  const sameOrigin = !upstream.baseUrl || originOf(upstream.baseUrl) === originOf(oa.baseUrl);
  if (isOpenRouterBaseUrl(oa.baseUrl) && hasText(oa.apiKey) && sameOrigin) {
    return { value: providerKeyFor(upstream, oa), source: 'openai-legacy' };
  }
  return { value: '', source: '' };
}

/**
 * The `openrouter` routing a request for `upstream` sends (the adapter copies it), field by field: the entry's value
 * wins, the OpenRouter row's default fills what is missing. undefined when there is nothing to send.
 * @returns {{ models?: string[], provider?: { order?: string[], sort?: string, allow_fallbacks?: boolean } } | undefined}
 */
export function openRouterRouting(upstream, cfg = openRouterCfg()) {
  const o = (upstream && upstream.openrouter) || {};
  const op = o.provider && typeof o.provider === 'object' ? o.provider : {};
  const { r } = cfgParts(cfg);
  const provider = {};
  if (nonEmptyList(op.order)) provider.order = [...op.order];
  else if (nonEmptyList(r.order)) provider.order = [...r.order];
  const sort = op.sort || r.sort;
  if (sort) provider.sort = sort;
  if (typeof op.allow_fallbacks === 'boolean') provider.allow_fallbacks = op.allow_fallbacks;
  else if (r.allowFallbacks === false) provider.allow_fallbacks = false;
  const out = {};
  if (nonEmptyList(o.models)) out.models = [...o.models];
  if (Object.keys(provider).length) out.provider = provider;
  return Object.keys(out).length ? out : undefined;
}

/** Every entry with an upstream is bridged when Claude Code runs it (src/shared/connections.mjs: Claude Code
 *  reaches every provider through the bridge). Codex connects to an OpenAI Responses endpoint itself
 *  (engines/codex-endpoint.mjs), so the same entry is bridged on a Claude run and direct on a Codex run. */
const bridgedUpstream = (m) => (m.upstream && ![...OWN_SIGNIN_ENGINES, 'copilot'].includes(m.engine || 'claude') ? m.upstream : null);

/**
 * The bridged catalog entry for `id` (user global → plugin → team policy), or
 * null when the id is unknown or not bridged. Shape:
 * `{id, label, upstream, cost?, source: 'global'|'plugin'|'policy', plugin?}`.
 * Synchronous; never throws.
 */
export function findBridgedEntry(id) {
  const key = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!key) return null;
  const g = listGlobalModels().find((m) => m.id.toLowerCase() === key);
  if (g) return bridgedUpstream(g) ? { id: g.id, label: g.label, upstream: g.upstream, cost: g.cost, source: 'global' } : null;
  const p = listPluginModels().find((m) => m.id.toLowerCase() === key);
  if (p) return bridgedUpstream(p) ? { id: p.id, label: p.label, upstream: p.upstream, cost: p.cost, source: 'plugin', plugin: p.plugin } : null;
  let t = null;
  try { t = policyCatalogModels().find((m) => m.id.toLowerCase() === key); } catch { t = null; }
  if (t && bridgedUpstream(t)) return { id: t.id, label: t.label, upstream: t.upstream, source: 'policy' };
  return null;
}

/**
 * Whether the provider behind `upstream` can be used right now, and if not,
 * why — the "needs sign-in" state the UI and the spawn fail-fast share (§8.5).
 * @returns {{ok:true}|{ok:false, reason:'not_signed_in'|'no_key', message:string}}
 */
export function providerReadiness(upstream) {
  if (!upstream) return { ok: true };
  const p = upstream.provider;
  // Credential broker: worca holds no provider key or GitHub sign-in. Ready when the model
  // maps to a broker slot (or is a keyless local endpoint); whether the PERSON has a key
  // is the broker's question, answered per spawn.
  if (brokerEnabled()) {
    const r = routeBridgedUpstream(upstream);
    return r.error ? { ok: false, reason: 'no_key', message: `provider ${p}: ${r.error}` } : { ok: true };
  }
  if (p === 'copilot') {
    const cfg = providerConfig('copilot');
    if (!resolveProviderSecret(cfg.githubToken, process.env, 'providers.copilot.githubToken')) {
      if (isVaultRef(cfg.githubToken)) return { ok: false, reason: 'not_signed_in', message: lockedMessage(p) };
      return { ok: false, reason: 'not_signed_in', message: 'provider copilot: not signed in — run `worca models login copilot` or open Models › Providers' };
    }
    return { ok: true };
  }
  // openai / anthropic: a per-entry key wins, else the provider's key when it is meant for this host (providerKeyFor).
  const cfg = providerConfig(p);
  if (p === 'openai' && isOpenRouterEntry(upstream, cfg)) return openRouterReadiness(upstream, { openrouter: openRouterConfig(), openai: cfg });
  const key = resolveProviderSecret(upstream.apiKey, process.env, 'models.upstream.apiKey') || providerKeyFor(upstream, cfg);
  const providerKeyHere = !upstream.baseUrl || originOf(upstream.baseUrl) === originOf(cfg.baseUrl);
  if (!key && (lockedRef(upstream.apiKey, 'models.upstream.apiKey') || (providerKeyHere && lockedRef(cfg.apiKey, providerKeyField(upstream))))) {
    return { ok: false, reason: 'no_key', message: lockedMessage(p) };
  }
  const has = (providerKeyHere && providerSecretSet(p)) || !!upstream.apiKey;
  // No key configured anywhere + a local endpoint = keyless. A configured key
  // whose ${VAR} is unset still blocks: the user meant to send one.
  if (!key && (has || !keyOptional(p, upstream.baseUrl || cfg.baseUrl))) {
    return {
      ok: false, reason: 'no_key',
      message: has
        ? `provider ${p}: the API key's \${VAR} is not set in worca's environment`
        : providerKeyHere
          ? `provider ${p}: no API key — open Models › Providers`
          : `provider ${p}: no API key for ${originOf(upstream.baseUrl)} — the provider's key is for ${originOf(cfg.baseUrl)}, so give the model its own key (its Connection › Advanced)`,
    };
  }
  return { ok: true };
}

/**
 * providerReadiness for an OpenRouter entry (`cfg` = { openrouter, openai }). No message holds more than one '— ': the
 * CLI is shown the part after it (upstream.mjs). The ${VAR} message is today's, with none.
 */
function openRouterReadiness(upstream, cfg) {
  const k = openRouterKeyFor(upstream, cfg);
  if (k.value) return { ok: true };
  const deciding = k.source === 'openrouter' ? cfg.openrouter.apiKey : k.source === 'openai-legacy' ? cfg.openai.apiKey : '';
  const no = (message) => ({ ok: false, reason: 'no_key', message });
  const decidingField = k.source === 'openrouter' ? 'providers.openrouter.apiKey' : 'providers.openai.apiKey';
  if (lockedRef(upstream.apiKey, 'models.upstream.apiKey') || lockedRef(deciding, decidingField)) return no(lockedMessage('openai'));
  if (unsetRef(upstream.apiKey, 'models.upstream.apiKey') || unsetRef(deciding, decidingField)) return no('provider openai: the API key\'s ${VAR} is not set in worca\'s environment');
  if (hasText(cfg.openrouter.apiKey) && !isHttps(effectiveBase(upstream, cfg.openai))) {
    return no('provider openai: the OpenRouter key goes only over https — use https://openrouter.ai/api/v1 as the model\'s base URL');
  }
  return no('provider openai: no API key — set the OpenRouter key under Models › Providers');
}

/**
 * Effective upstream settings for a request: base URL, key, headers, concurrency, and the semaphore `queue` it waits
 * on. An OpenRouter entry takes key, cap and routing defaults from the OpenRouter row and queues as 'openrouter';
 * `provider` stays 'openai' for errors and telemetry.
 */
export function upstreamSettings(upstream) {
  const cfg = providerConfig(upstream.provider);
  const p = upstream.provider;
  const common = {
    provider: p,
    api: upstream.api,
    model: upstream.model,
    baseUrl: upstream.baseUrl || cfg.baseUrl || null,
    headers: upstream.headers || {},
    capabilities: upstream.capabilities || {},
  };
  if (p === 'openai' && isOpenRouterEntry(upstream, cfg)) {
    const orCfg = { openrouter: openRouterConfig(), openai: cfg };
    const routing = openRouterRouting(upstream, orCfg);
    return {
      ...common,
      apiKey: openRouterKeyFor(upstream, orCfg).value,
      githubToken: null,
      accountType: null,
      ...(routing ? { openrouter: routing } : {}),
      maxConcurrent: orCfg.openrouter.maxConcurrent,
      queue: 'openrouter',
    };
  }
  return {
    ...common,
    apiKey: p === 'copilot' ? null : (resolveProviderSecret(upstream.apiKey, process.env, 'models.upstream.apiKey') || providerKeyFor(upstream, cfg) || ''),
    githubToken: p === 'copilot' ? resolveProviderSecret(cfg.githubToken, process.env, 'providers.copilot.githubToken') : null,
    accountType: p === 'copilot' ? cfg.accountType : null,
    enterpriseHost: p === 'copilot' ? (cfg.enterpriseHost || null) : null,
    ...(upstream.openrouter ? { openrouter: upstream.openrouter } : {}),
    maxConcurrent: cfg.maxConcurrent,
    queue: p,
  };
}
