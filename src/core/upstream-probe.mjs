// src/core/upstream-probe.mjs
// Is the endpoint a run step's agent really talks to reachable right now? Used by the
// network wait (run-harness _recover) and the server's network watch. The target is the
// REAL upstream behind any local hop — the bridge's provider, the broker slot's upstream —
// never the loopback URL, because a local hop that is up proves nothing about the
// internet. The probe is a header-less HEAD to the ORIGIN: no key, no path, no query
// ever leaves (or reaches a log).
import { findBridgedEntry } from './bridge/registry.mjs';
import { copilotApiHost } from './bridge/providers/copilot.mjs';
import { providerConfig } from './settings.mjs';
import { resolveModelEnv } from './config.mjs';
import { brokerEnabled, slotOfBaseUrl, cachedBrokerInfo } from './broker-client.mjs';

export const ANTHROPIC_API = 'https://api.anthropic.com';
export const PROBE_TIMEOUT_MS = 5_000;
/** A gateway or proxy answering for an upstream it cannot reach. */
const UNREACHABLE_STATUS = new Set([502, 503, 504]);
/** Cloud transports: the CLI ignores ANTHROPIC_BASE_URL and picks a regional host itself. */
const PROVIDER_MODE_KEYS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const DEFAULT_BASE = { openai: 'https://api.openai.com/v1', anthropic: ANTHROPIC_API };
const DEFAULT_DEPS = { findBridgedEntry, resolveModelEnv, providerConfig, copilotApiHost, brokerEnabled, slotOfBaseUrl, cachedBrokerInfo };

const isOn = (v) => typeof v === 'string' && v !== '' && !/^(0|false)$/i.test(v.trim());
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };
const target = (url, via) => { const origin = originOf(url); return origin && origin !== 'null' ? { origin, via } : null; };

/** The upstream origin of a broker slot (by id, else the first slot speaking `protocol`). */
function brokerUpstream(deps, { id = null, protocol = null } = {}) {
  const slots = deps.cachedBrokerInfo()?.slots || [];
  const s = (id && slots.find((x) => x.id === id)) || (protocol && slots.find((x) => x.protocol === protocol));
  return s && typeof s.upstream === 'string' ? s.upstream : null;
}

/**
 * The real upstream a step on `modelId` talks to. Synchronous, never throws, reads no secret.
 * @param {string|null} modelId the step's model (ctx.claudeOpts.model); null = the CLI default
 * @returns {{origin:string, via:'default'|'ambient'|'env'|'bridge'|'broker'}|null} null = do not probe
 */
export function probeTargetForModel(modelId, { env = process.env, deps = DEFAULT_DEPS } = {}) {
  try {
    const bridged = modelId ? deps.findBridgedEntry(modelId) : null;
    if (bridged) {
      const up = bridged.upstream || {};
      // With the broker on, a bridged slot's pinned upstream IS this base URL's origin (slotForBaseUrl).
      if (up.provider === 'copilot') return target(deps.copilotApiHost(deps.providerConfig('copilot').accountType), 'bridge');
      return target(up.baseUrl || deps.providerConfig(up.provider).baseUrl || DEFAULT_BASE[up.provider], 'bridge');
    }
    // Env-style catalog entry (never bridged here, so resolveModelEnv neither starts the bridge nor throws).
    const base = modelId ? deps.resolveModelEnv(modelId)?.ANTHROPIC_BASE_URL : null;
    if (base) {
      const slot = deps.slotOfBaseUrl(base, env);
      if (slot) return target(brokerUpstream(deps, { id: slot }) || ANTHROPIC_API, 'broker');
      return target(base, 'env');
    }
    if (deps.brokerEnabled(env)) return target(brokerUpstream(deps, { protocol: 'anthropic' }) || ANTHROPIC_API, 'broker');
    if (PROVIDER_MODE_KEYS.some((k) => isOn(env[k]))) return null;
    if (env.ANTHROPIC_BASE_URL) return target(env.ANTHROPIC_BASE_URL, 'ambient');
    return { origin: ANTHROPIC_API, via: 'default' };
  } catch {
    return null;
  }
}

/**
 * One reachability check. `true` for any HTTP answer except 502/503/504; `false` for a
 * transport error or a timeout. An abort of the CALLER's `signal` (a pause, a stop) is
 * rethrown — it is not "unreachable".
 */
export async function probeReachable(origin, { timeoutMs = PROBE_TIMEOUT_MS, signal, fetch: f = globalThis.fetch } = {}) {
  const sig = signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
  try {
    const res = await f(origin, { method: 'HEAD', redirect: 'manual', signal: sig });
    try { await res.body?.cancel?.(); } catch { /* nothing to drain */ }
    return !UNREACHABLE_STATUS.has(res.status);
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

/** "api.anthropic.com" for an origin (log/UI text); the origin itself when it does not parse. */
export function hostOf(origin) {
  try { return new URL(origin).host; } catch { return String(origin || ''); }
}
