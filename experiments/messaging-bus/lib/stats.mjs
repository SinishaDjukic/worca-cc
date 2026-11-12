// experiments/messaging-bus/lib/stats.mjs — small pure helpers for the experiment summaries.

/** Nearest-rank percentiles: percentiles([..], [50, 99]) → { p50, p99 } (null for an empty array). */
export function percentiles(arr, ps = [50, 99]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const out = {};
  for (const p of ps) {
    if (sorted.length === 0) { out[`p${p}`] = null; continue; }
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    out[`p${p}`] = sorted[Math.min(sorted.length, rank) - 1];
  }
  return out;
}

/** Wall-clock ms with sub-ms resolution, comparable across processes on one machine. */
export function hrtimeMs() {
  return performance.timeOrigin + performance.now();
}

export function round(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
