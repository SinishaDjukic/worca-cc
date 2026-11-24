// One forced discovery at a time, and page-open callers reuse a recent result instead of forcing again.
// "Check now" (not a page open) always starts a run, but joins one already going.
export const PAGE_DISCOVER_MIN_MS = 60_000;

export function createDiscoverGate(run, { minMs = PAGE_DISCOVER_MIN_MS, now = Date.now } = {}) {
  let inflight = null;
  let lastOk = 0;
  return function discover({ page = false } = {}) {
    if (inflight) return inflight;
    if (page && lastOk && now() - lastOk < minMs) return Promise.resolve();
    inflight = run().then(() => { lastOk = now(); }).finally(() => { inflight = null; });
    return inflight;
  };
}
