// test/helpers/load-budget.mjs — a wall-clock budget that stretches with machine load, locally only.
// A loaded developer machine (two suites, other agents: load 49 on 12 cores in run 6c9cf587) made six
// timing-budget tests fail for nothing and sent an agent into 25 minutes of reruns. CI runners are quiet
// and keep the strict budget, so a real slowdown still fails there.
import { availableParallelism, loadavg } from 'node:os';

/** max(1, 1-minute load / cores) on a developer machine; 1 on CI. Read when called, i.e. when the test runs. */
export function loadFactor(env = process.env) {
  if (env.CI) return 1;
  return Math.max(1, loadavg()[0] / availableParallelism());
}

/** `ms` scaled by loadFactor(). */
export const loadBudget = (ms, env = process.env) => Math.round(ms * loadFactor(env));
