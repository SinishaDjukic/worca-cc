// src/core/engines/ready-cache.mjs
// The last engine-readiness answer in THIS process (engines/readiness.mjs writes it). Import-free, so the text
// surfaces (harness audit, CLI, chat notifier, scheduler) can read it without loading the engine registry. UI-started
// runs share the UI server's process, so their pause text sees what GET /api/engines last saw; a CLI process never
// checked, so it reads null and every other engine is offered (the resume gate still refuses an engine that is not ready).
export const READINESS_TTL_MS = 60_000;
let cache = null;   // { at, list: [{name, ready, …}] }

export function storeReadiness(list, at = Date.now()) { cache = { at, list }; }
export function cachedReadiness(now = Date.now()) { return cache && now - cache.at < READINESS_TTL_MS ? cache.list : null; }
/** The ready engine names, or null when nothing fresh is known. */
export function readyEnginesCached(now = Date.now()) {
  const list = cachedReadiness(now);
  return list ? list.filter((e) => e.ready).map((e) => e.name) : null;
}
export function resetEngineReadiness() { cache = null; }
