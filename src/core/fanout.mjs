// src/core/fanout.mjs
// Bounded-concurrency helper for the orchestrator's OWN per-project IO (worktree
// setup, graph builds, checkpoints, staging) on a workspace run. This is NOT the
// agent Task fan-out (that is agent-initiated inside a node, gated by node.fanOut);
// it is the deterministic, capped parallelism the orchestrator uses to apply the
// existing single-project machinery N times across member projects.
//
// The determinism guarantee: results come back in INPUT order, never completion
// order, so a workspace run over a sorted-projectKey member list always recombines
// the same way regardless of which project's git finished first.

/**
 * The hard concurrency cap for orchestrator-owned per-project IO.
 * WORCA_FANOUT_CAP overrides; a non-positive / non-numeric value falls back to 4.
 * @returns {number}
 */
export function fanoutCap() {
  const n = Number(process.env.WORCA_FANOUT_CAP);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/**
 * Map `items` through async `fn` with at most `cap` running concurrently, returning
 * the results in INPUT order (results[i] === await fn(items[i], i)). A worker pool
 * pulls the next index off a shared cursor, so the cap is a true ceiling on in-flight
 * work; the first rejection rejects the whole call (Promise.all semantics).
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} cap   max concurrent invocations (coerced to >= 1)
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}  results index-aligned with `items`
 */
export async function mapWithCap(items, cap, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  if (list.length === 0) return results;
  const limit = Math.max(1, Math.min(Number(cap) || 1, list.length));
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      results[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
