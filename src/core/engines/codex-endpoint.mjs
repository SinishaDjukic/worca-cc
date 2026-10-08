// src/core/engines/codex-endpoint.mjs
// Codex models on their own OpenAI-compatible endpoint (docs/models.md "Custom endpoints for Codex
// models"). A Codex catalog entry may carry an `upstream` with provider `openai` and the Responses API
// (model-env.mjs codexUpstreamProblem). codex speaks that API natively, so it connects to the endpoint
// itself: worca's bridge, which serves the Anthropic API to the claude CLI, is never in the path.
// Each spawn names the endpoint as a codex model provider through `-c model_providers.<id>.*`
// overrides (they apply under --ignore-user-config). The API key and the header values travel in the
// codex process env (`env_key`, `env_http_headers`), never on argv. Like codex's own OPENAI_API_KEY, they
// stay readable by the commands the agent runs: codex-cli 0.146's exec mode ignores a
// `shell_environment_policy` override (checked with `inherit = "none"` and `exclude`).
import { listGlobalModels } from '../settings.mjs';
import { listPluginModels } from '../plugin-models.mjs';
import { policyCatalogModels } from '../policy/cache.mjs';
import { providerReadiness, upstreamSettings } from '../bridge/registry.mjs';

/** The codex env var that carries the endpoint's API key (the provider's `env_key`). */
export const CODEX_PROVIDER_KEY_ENV = 'WORCA_CODEX_PROVIDER_KEY';
const HEADER_ENV_PREFIX = 'WORCA_CODEX_PROVIDER_HEADER_';

const tomlStr = (s) => JSON.stringify(String(s));   // a TOML basic string: JSON's escapes are a subset

/**
 * The Codex entry with an endpoint for `id` (user global → plugin → team policy, the first layer
 * that has the id decides), or null. Shape: `{id, upstream, cost?, source}`. Synchronous; never throws.
 */
export function findCodexEndpointEntry(id) {
  const key = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!key) return null;
  const hit = (m) => m && typeof m.id === 'string' && m.id.toLowerCase() === key;
  const shape = (m, source) => (m.engine === 'codex' && m.upstream ? { id: m.id, upstream: m.upstream, ...(m.cost ? { cost: m.cost } : {}), source } : null);
  try {
    const g = listGlobalModels().find(hit);
    if (g) return shape(g, 'global');
    const p = listPluginModels().find(hit);
    if (p) return shape(p, 'plugin');
    const t = policyCatalogModels().find(hit);
    return t ? shape(t, 'policy') : null;
  } catch {
    return null;
  }
}

/** True when `id` is a Codex model on its own endpoint. */
export const hasCodexEndpoint = (id) => !!findCodexEndpointEntry(id);

/**
 * What one codex spawn needs to run catalog model `id` on its endpoint, or null when the model has none:
 * `{model, args, env, secrets}` — `model` the upstream id for `-m`, `args` the `-c` overrides, `env` the
 * key and header values for the codex process, `secrets` the values a redactor must hide.
 * Throws an `auth`-class error (with `bridgeReason`, like resolveModelEnv) when the endpoint has no
 * usable key, so the spawn fails fast instead of with an opaque 401.
 */
export function codexEndpointSpawn(id) {
  const entry = findCodexEndpointEntry(id);
  if (!entry) return null;
  const ready = providerReadiness(entry.upstream);
  if (!ready.ok) {
    throw Object.assign(new Error(`model "${entry.id}": ${ready.message}`), { errorClass: 'auth', bridgeReason: ready.reason, bridgeProvider: entry.upstream.provider });
  }
  const us = upstreamSettings(entry.upstream);
  const pid = `worca_${entry.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
  const at = `model_providers.${pid}`;
  const args = ['-c', `model_provider=${tomlStr(pid)}`,
    '-c', `${at}.name=${tomlStr(`${entry.id} (worca)`)}`,
    '-c', `${at}.base_url=${tomlStr(us.baseUrl)}`,
    '-c', `${at}.wire_api="responses"`];
  const env = {};
  if (us.apiKey) {
    env[CODEX_PROVIDER_KEY_ENV] = us.apiKey;
    args.push('-c', `${at}.env_key=${tomlStr(CODEX_PROVIDER_KEY_ENV)}`);
  }
  const headers = Object.entries(us.headers || {});
  if (headers.length) {
    headers.forEach(([, v], i) => { env[`${HEADER_ENV_PREFIX}${i}`] = v; });
    args.push('-c', `${at}.env_http_headers={${headers.map(([k], i) => `${tomlStr(k)}=${tomlStr(`${HEADER_ENV_PREFIX}${i}`)}`).join(',')}}`);
  }
  return { model: us.model, args, env, secrets: Object.values(env) };
}
