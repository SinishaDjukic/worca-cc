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

/** The priced test model per engine (null: the engine's own default, priced for codex): what a ledger harness's step runs. */
export const LEDGER_MODELS = Object.freeze({ claude: 'claude-sonnet-5', codex: 'gpt-6.1-sol', copilot: 'copilot/gpt-4.1', cursor: 'composer-1' });

/**
 * A run harness of `engine` with one agent step row, built as _execStep builds it (its _stepFacts: provider, and an
 * unknown cost on an engine that reports none), for replaying an adapter's events through the usage ledger
 * (test/exec-env-relay-cost.test.mjs unitHarness, per engine). Not a mock run: the facts a real step gets.
 * `booked()` counts _recordCost calls.
 */
export async function ledgerHarness(engine, model = LEDGER_MODELS[engine], stepKey = 'x:n_impl:1') {
  const { createOrchestrator } = await import('../../src/core/orchestrator.mjs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'worca-ledger-harness'), claude: { engine, bin: `/nonexistent/worca-test/${engine}` } });
  orch._persist = async () => {};
  orch.state.steps.push({ key: stepKey, executionId: stepKey, nodeId: stepKey.split(':')[1], costUsd: 0, ...orch._stepFacts(model) });
  let booked = 0;
  const rec = orch._recordCost.bind(orch);
  orch._recordCost = (...a) => { booked += 1; return rec(...a); };
  return { orch, step: orch.state.steps[0], attr: { stepKey, executionId: stepKey, model }, booked: () => booked };
}
