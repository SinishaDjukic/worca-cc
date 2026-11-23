// src/shared/run-elapsed.mjs
// The run's headline time. The engine keeps a run clock (`elapsedMs` folded, `elapsedSince`
// the epoch ms it has been running since): 1 s per real second while the run works, parallel
// work counted once, parked time (a waiting question, a pause, a crash) excluded. The summed
// step time (`totalActiveMs`) is "agent time". Runs saved before the clock existed carry no
// figure and fall back to the summed time. Pure: no imports, no DOM, no clock of its own.

/** The run's elapsed ms, or null when the run carries no figure (absent, or 0 with no anchor).
 *  The running tail is added only when `live` (the caller knows the run is working now). */
export function runElapsedMs(run, { now = 0, live = false } = {}) {
  const ms = run?.elapsedMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const since = run.elapsedSince;
  if (since == null) return ms > 0 ? ms : null;
  return ms + (live ? Math.max(0, now - since) : 0);
}

/** The figure a headline shows: elapsed, else the summed step time (old runs), else null. */
export function runHeadlineMs(run, opts) {
  const elapsed = runElapsedMs(run, opts);
  if (elapsed != null) return elapsed;
  const total = run?.totalActiveMs;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

/** Agent time earns its own tile only when it is larger than the run time AND reads differently. */
export function showAgentTime(agentMs, elapsedMs, fmt) {
  if (!Number.isFinite(agentMs) || !Number.isFinite(elapsedMs)) return false;
  return agentMs > elapsedMs && fmt(agentMs) !== fmt(elapsedMs);
}
