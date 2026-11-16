// The sweeps' units (a theme and a width, a page) side by side, each in its own page of one browser. Each unit records what it
// finds in its own list, and the lists are merged in the units' order, so the report is the one a single walk prints.
// From disk the units run at once (the CPU count less one, at most 8); against the app (STILLHET_TARGET) one at a time, as
// before, since the app's state is shared. `--workers N` sets the count either way.
import { availableParallelism } from 'node:os';
import { parseWorkers } from '../../../../tools/stillhet-compare.mjs';

/** How many units run at once, from argv. Throws on an invalid --workers. */
export function workerCount(argv = process.argv.slice(2), cpus = availableParallelism()) {
  if (argv.some((a) => a === '--workers' || a.startsWith('--workers='))) return parseWorkers(argv, cpus);
  return process.env.STILLHET_TARGET ? 1 : Math.min(8, Math.max(1, cpus - 1));
}

/**
 * Runs each unit with its own `add(key, where)`, `workers` at a time, and replays what each recorded into `add` in the
 * units' order. Returns the units' results, in order.
 * @template T
 * @param {Array<(add: (k: string, where: string) => void) => Promise<T>>} units
 * @param {(k: string, where: string) => void} add
 * @param {number} workers
 * @returns {Promise<T[]>}
 */
export async function runUnits(units, add, workers) {
  const found = units.map(() => []), results = new Array(units.length);
  let next = 0;
  const lane = async () => { while (next < units.length) { const i = next++; results[i] = await units[i]((k, w) => found[i].push([k, w])); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, units.length)) }, lane));
  for (const list of found) for (const [k, w] of list) add(k, w);
  return results;
}
