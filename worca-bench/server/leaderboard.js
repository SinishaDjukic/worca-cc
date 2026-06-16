// server/leaderboard.js
//
// Public cross-agent leaderboard rows for a given benchmark.
//
// TODO(W-075 phase 2): fetch live standings instead of this static fixture.
// The SWE-bench Verified leaderboard is published at https://www.swebench.com
// (JSON at https://github.com/SWE-bench/experiments) and the Commit-0 analysis
// lives at https://commit-0.github.io/analysis/. A later phase will fetch + cache
// those (respecting rate limits) and merge the local profiles in. For now we
// return a small, deliberately-static fixture and make NO network calls so the
// dashboard renders offline and the unit tests stay hermetic.

const FIXTURES = {
  'swe-bench-verified': [
    { agent: 'worca (local)', resolved_rate: null, source: 'local' },
    { agent: 'TRAE', resolved_rate: 0.7026, source: 'swebench.com' },
    { agent: 'Augment Agent', resolved_rate: 0.654, source: 'swebench.com' },
    {
      agent: 'OpenHands + CodeAct',
      resolved_rate: 0.606,
      source: 'swebench.com',
    },
    { agent: 'SWE-agent', resolved_rate: 0.335, source: 'swebench.com' },
  ],
  'commit-0': [
    { agent: 'worca (local)', resolved_rate: null, source: 'local' },
    { agent: 'reference', resolved_rate: 0.58, source: 'commit-0.github.io' },
  ],
};

/**
 * Return the leaderboard rows for a benchmark. Unknown benchmarks yield an
 * empty array (the dashboard renders an explanatory empty state).
 *
 * @param {string} benchmark
 * @returns {Array<{agent: string, resolved_rate: number|null, source: string}>}
 */
export function getLeaderboard(benchmark) {
  return FIXTURES[benchmark] ? [...FIXTURES[benchmark]] : [];
}

/**
 * List the benchmarks that have a static leaderboard fixture available.
 * @returns {string[]}
 */
export function leaderboardBenchmarks() {
  return Object.keys(FIXTURES);
}
