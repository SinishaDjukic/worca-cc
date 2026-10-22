// test/helpers/conformance.mjs
// The engine conformance suite's row helper (plans/core-protection-layer-design.md §5): one test per catalog entry
// and row, named `<engine>: <row> — <title>`, so a new engine passes or fails each row by its catalog entry alone.
import { test } from 'node:test';
import { ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';

/**
 * Register row `name` (C-ENV-EXACT, C-GROUPKILL, …) for every catalog entry.
 * @param {string} name
 * @param {string} title
 * @param {(engine: string, t: import('node:test').TestContext) => any} fn
 * @param {{skip?: string|false}} [opts]
 */
export function conformanceRow(name, title, fn, opts = {}) {
  for (const engine of ENGINE_NAMES) test(`${engine}: ${name} — ${title}`, opts, (t) => fn(engine, t));
}
