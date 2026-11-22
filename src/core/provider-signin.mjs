// src/core/provider-signin.mjs
// "Signed in to a model provider" for the Getting-started `claude` step: ANY provider counts, not only Claude
// Code — a Copilot-only install reaches Runner. Reads state only (stored settings, the last engine-readiness
// answer, the mock flag); never spawns a CLI and never imports ui/server.mjs.

const lazy = (load, pick) => async (...args) => (await load())[pick](...args);
const providersState = lazy(() => import('./bridge/provider-ops.mjs'), 'providersState');
const readyEnginesCached = lazy(() => import('./engines/ready-cache.mjs'), 'readyEnginesCached');
const mockEnabled = lazy(() => import('./claude-runner.mjs'), 'mockEnabled');

// Engines that say nothing about a provider: Claude has its own source, and mock is the demo engine.
const IGNORED_ENGINES = new Set(['claude', 'mock']);

/** A source that throws is a source that says no. */
async function guarded(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

/**
 * @param {{claudeConnected?:boolean, providers?:Function, engines?:Function, mock?:Function}} [opts]  the last three are test seams
 * @returns {Promise<{signedIn:boolean, via:string[]}>}
 */
export async function anyProviderSignedIn({ claudeConnected = false, providers = providersState, engines = readyEnginesCached, mock = mockEnabled } = {}) {
  const via = [];
  if (claudeConnected) via.push('claude');
  const state = await guarded(() => providers(), null);
  if (state?.copilot?.connected) via.push('copilot');
  if (state?.openai?.configured) via.push('openai');
  if (state?.anthropic?.configured) via.push('anthropic');
  if (state?.openrouter?.keySet) via.push('openrouter');
  const ready = await guarded(() => engines(), null);
  if (Array.isArray(ready)) {
    for (const name of ready) if (!IGNORED_ENGINES.has(name) && !via.includes(name)) via.push(name);
  }
  if (await guarded(() => mock(), false)) via.push('mock');
  return { signedIn: via.length > 0, via };
}
