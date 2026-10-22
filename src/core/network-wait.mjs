// src/core/network-wait.mjs
// Waiting out a network outage. Two users share these rules:
//  - the run harness (_recover): a network-class step failure whose endpoint does not
//    answer waits for it (bounded polling with backoff), then retries the step;
//  - the server's network watch: a run parked or killed while it waited is resumed once
//    the endpoint answers again, inside the same window.
// The window is counted from the run's FIRST network failure (resumePoint.network.since).
// Pure apart from the injected probe / sleep / clock.
import { sleepAbortable } from './recovery-backoff.mjs';

/** The actor of everything the network wait does by itself (audit lines, the Retry answer,
 *  the watcher's resume). A system actor like night mode's — never a person. */
export const NETWORK_ACTOR = 'worca (network watch)';
export const PROBE_BASE_MS = 5_000;
export const PROBE_MAX_DELAY_MS = 60_000;

/** The wait before probe `n` (1-based): base·2^(n-1), at most a minute. WORCA_NETWORK_PROBE_MS pins the base. */
export function probeDelayMs(n, env = process.env) {
  const raw = env?.WORCA_NETWORK_PROBE_MS;
  const pinned = Number(raw);
  const base = raw != null && raw !== '' && Number.isFinite(pinned) && pinned >= 0 ? pinned : PROBE_BASE_MS;
  return Math.min(PROBE_MAX_DELAY_MS, base * Math.pow(2, Math.max(0, n - 1)));
}

/**
 * Poll `probe` with backoff until it passes or `until` (ms epoch) passes.
 * Re-checks `isEnabled()` after every sleep (the user may switch the feature off mid-wait).
 * @returns {Promise<'back'|'timeout'|'aborted'|'disabled'>}
 */
export async function waitForNetwork({ probe, until, now = Date.now, sleep = sleepAbortable, signal, isEnabled = () => true, env = process.env }) {
  for (let n = 1; ; n++) {
    const left = until - now();
    if (left <= 0) return 'timeout';
    await sleep(Math.min(probeDelayMs(n, env), left), signal);
    if (signal?.aborted) return 'aborted';
    if (!isEnabled()) return 'disabled';
    let up = false;
    try { up = await probe(signal); } catch { up = false; }
    if (signal?.aborted) return 'aborted';
    if (up) return 'back';
  }
}

/**
 * May the network watch resume this row now? Only (a) a run that paused as
 * recoverable/network while its endpoint was unreachable, or (b) a run that died
 * (interrupted) while it waited — and only inside the window. Every other pause
 * (cost caps, usage limit, auth, quota, model, error, a person's pause) never matches.
 */
export function networkResumeEligible({ status, resumePoint: rp } = {}, { now, maxWaitMs }) {
  const n = rp && rp.network && typeof rp.network === 'object' ? rp.network : null;
  const since = n && typeof n.since === 'string' ? Date.parse(n.since) : NaN;
  if (!Number.isFinite(since) || now - since >= maxWaitMs) return false;
  if (status === 'interrupted') return n.waiting === true;
  return status === 'paused' && rp.pauseReason === 'recoverable' && rp.pauseClass === 'network' && n.reachable === false;
}

/**
 * The server's watcher, deps injected. tick() runs one pass (a call while a pass runs
 * shares that pass) and resolves the pipeline ids it resumed.
 */
export function createNetworkWatch({ settings, listRuns, hasResumeTicket, probe, resume, log = () => {}, now = Date.now }) {
  const reported = new Map();   // pipelineId -> the last refusal logged for it
  let busy = null;
  async function pass() {
    const cfg = settings();
    if (!cfg.enabled) return [];
    const t = now();
    const byOrigin = new Map();
    for (const r of listRuns()) {
      if (!networkResumeEligible(r, { now: t, maxWaitMs: cfg.maxWaitMs }) || hasResumeTicket(r.id)) continue;
      const origin = r.resumePoint.network.origin;
      if (!origin) continue;
      if (!byOrigin.has(origin)) byOrigin.set(origin, []);
      byOrigin.get(origin).push(r);
    }
    const resumed = [];
    for (const [origin, rows] of byOrigin) {
      let up = false;
      try { up = await probe(origin); } catch { up = false; }
      if (!up) continue;
      for (const r of rows) {
        try {
          await resume(r);
          resumed.push(r.id);
          reported.delete(r.id);
        } catch (err) {
          const msg = (err && err.body && err.body.error) || (err && err.message) || String(err);
          if (reported.get(r.id) !== msg) { reported.set(r.id, msg); log(`could not resume ${r.id}: ${msg}`); }
        }
      }
    }
    return resumed;
  }
  return { tick() { if (!busy) busy = pass().finally(() => { busy = null; }); return busy; } };
}
