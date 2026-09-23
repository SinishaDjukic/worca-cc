// src/core/bridge/registry.mjs
// Which catalog entries are bridged, and with what (model-bridge-design.md
// §4.2/§6). Import contract: settings.mjs, plugin-models.mjs, the policy
// cache and the zero-import model-env.mjs leaf only — config.mjs imports the
// bridge (for resolveModelEnv), so nothing under src/core/bridge/ may import
// config.mjs.

import { listGlobalModels, providerConfig, providerSecretSet, resolveProviderSecret, copilotTermsAcknowledged } from '../settings.mjs';
import { listPluginModels } from '../plugin-models.mjs';
import { policyCatalogModels } from '../policy/cache.mjs';
import { isLocalBaseUrl } from '../model-env.mjs';

/** An OpenAI-compatible endpoint on this machine / a private network needs no key. */
export function keyOptional(provider, baseUrl) {
  return provider === 'openai' && isLocalBaseUrl(baseUrl);
}

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
  if (g) return g.upstream ? { id: g.id, label: g.label, upstream: g.upstream, cost: g.cost, source: 'global' } : null;
  const p = listPluginModels().find((m) => m.id.toLowerCase() === key);
  if (p) return p.upstream ? { id: p.id, label: p.label, upstream: p.upstream, cost: p.cost, source: 'plugin', plugin: p.plugin } : null;
  let t = null;
  try { t = policyCatalogModels().find((m) => m.id.toLowerCase() === key); } catch { t = null; }
  if (t && t.upstream) return { id: t.id, label: t.label, upstream: t.upstream, source: 'policy' };
  return null;
}

/**
 * Whether the provider behind `upstream` can be used right now, and if not,
 * why — the "needs sign-in" state the UI and the spawn fail-fast share (§8.5).
 * @returns {{ok:true}|{ok:false, reason:'not_signed_in'|'terms'|'no_key', message:string}}
 */
export function providerReadiness(upstream) {
  if (!upstream) return { ok: true };
  const p = upstream.provider;
  if (p === 'copilot') {
    if (!copilotTermsAcknowledged()) {
      return { ok: false, reason: 'terms', message: 'provider copilot: terms not acknowledged — open Settings › Providers' };
    }
    const cfg = providerConfig('copilot');
    if (!resolveProviderSecret(cfg.githubToken)) {
      return { ok: false, reason: 'not_signed_in', message: 'provider copilot: not signed in — run `worca models login copilot` or open Settings › Providers' };
    }
    return { ok: true };
  }
  // openai / anthropic: a per-entry key wins, else the provider's key.
  const cfg = providerConfig(p);
  const key = resolveProviderSecret(upstream.apiKey) || resolveProviderSecret(cfg.apiKey);
  const has = providerSecretSet(p) || !!upstream.apiKey;
  // No key configured anywhere + a local endpoint = keyless. A configured key
  // whose ${VAR} is unset still blocks: the user meant to send one.
  if (!key && (has || !keyOptional(p, upstream.baseUrl || cfg.baseUrl))) {
    return {
      ok: false, reason: 'no_key',
      message: has
        ? `provider ${p}: the API key's \${VAR} is not set in worca's environment`
        : `provider ${p}: no API key — open Settings › Providers`,
    };
  }
  return { ok: true };
}

/** Effective upstream settings for a request: base URL, key, headers, concurrency. */
export function upstreamSettings(upstream) {
  const cfg = providerConfig(upstream.provider);
  const p = upstream.provider;
  return {
    provider: p,
    api: upstream.api,
    model: upstream.model,
    baseUrl: upstream.baseUrl || cfg.baseUrl || null,
    apiKey: p === 'copilot' ? null : (resolveProviderSecret(upstream.apiKey) || resolveProviderSecret(cfg.apiKey) || ''),
    githubToken: p === 'copilot' ? resolveProviderSecret(cfg.githubToken) : null,
    accountType: p === 'copilot' ? cfg.accountType : null,
    headers: upstream.headers || {},
    capabilities: upstream.capabilities || {},
    maxConcurrent: cfg.maxConcurrent,
  };
}
