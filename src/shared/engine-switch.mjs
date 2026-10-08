// src/shared/engine-switch.mjs
// Continuing a paused run on another engine: which engines there are, what they are called, which ones a pause offers,
// and which report a cost. ONE source for the harness, the CLI, the chat notifier, the scheduler feed and the browser.
// Import-free: served to the browser as-is under /src/shared.

/** The run engines (src/core/engines/index.mjs without the mock; src/core/model-env.mjs RUN_ENGINES — kept equal by a test). */
export const ENGINE_NAMES = Object.freeze(['claude', 'codex', 'copilot', 'cursor', 'gemini', 'qwen']);
/** The engines that own catalog models (src/core/model-env.mjs MODEL_ENGINES, kept equal by a test). Copilot owns none. */
export const MODEL_ENGINE_NAMES = Object.freeze(['claude', 'codex', 'cursor', 'gemini', 'qwen']);
/** The engines a run can switch between: the model engines (a switch falls back to the target's catalog default). */
export const SWITCH_ENGINES = MODEL_ENGINE_NAMES;

const LABELS = Object.freeze({ claude: 'Claude', codex: 'Codex', copilot: 'Copilot', cursor: 'Cursor', gemini: 'Gemini CLI', qwen: 'Qwen Code' });

/** The engines whose models connect through the CLI's own sign-in: a model takes no env, no endpoint and no effort, and
 *  the run's helper jobs run on Claude (src/core/model-env.mjs SIGN_IN_ENGINES, kept equal by a test). */
export const SIGN_IN_ENGINE_NAMES = Object.freeze(['cursor', 'gemini', 'qwen']);

/** The engines still in beta: every engine picker marks them. */
export const BETA_ENGINES = Object.freeze(['codex', 'copilot', 'cursor', 'gemini', 'qwen']);

/** Is `engine` in beta? A missing engine is Claude. */
export function isBetaEngine(engine) {
  return BETA_ENGINES.includes(engine || 'claude');
}

/** An engine's name where only text fits (a select option, an optgroup): 'Codex (beta)'. */
export function engineChoiceLabel(engine) {
  return isBetaEngine(engine) ? `${engineLabel(engine)} (beta)` : engineLabel(engine);
}

/** The display name of an engine ('codex' -> 'Codex'); a missing engine is Claude. */
export function engineLabel(engine) {
  const e = engine || 'claude';
  return LABELS[e] || String(e);
}

const NO_COST_ENGINES = Object.freeze(['copilot', 'cursor', 'gemini', 'qwen']);
/** Whether runs on `engine` report a cost (capability `cost`; a test keeps this equal to the registry). Where not,
 *  a cost shows as unknown, never $0.00. */
export function engineReportsCost(engine) { return !NO_COST_ENGINES.includes(engine || 'claude'); }

/** A run's cost as text for the CLI and chat: `fmt(costUsd)`, or "cost unknown" on an engine that reports none. A
 *  total above 0 on such a run is worca's own calls alone (helper jobs on Claude), named as that. */
export function runCostLabel(engine, costUsd, fmt) {
  const n = Number(costUsd) || 0;
  if (engineReportsCost(engine)) return fmt(n);
  return n > 0 ? `cost unknown (worca's own calls: ${fmt(n)})` : 'cost unknown';
}

/** Every engine a run on `engine` can switch to, in list order, limited to `ready` (default: all). [] for an unknown engine. */
export function otherEngines(engine, ready = SWITCH_ENGINES) {
  const e = engine || 'claude';
  if (!SWITCH_ENGINES.includes(e)) return [];
  const ok = Array.isArray(ready) ? ready : SWITCH_ENGINES;
  return SWITCH_ENGINES.filter((x) => x !== e && ok.includes(x));
}

/**
 * The engines a pause offers to continue on now. Only a session/usage limit an engine itself hit (`limitEngine`)
 * offers any: each other engine has its own allowance. Any other pause, and a limit that was not the engine's (a
 * spent OpenRouter free allowance, say), offers none. `ready`: the engines whose preflight passes
 * (engines/ready-cache.mjs); null or omitted, every other engine is offered and the resume's own gate decides.
 * @param {{reason?: string|null, limitEngine?: string|null}} pause
 * @param {string[]|null} [ready]
 * @returns {string[]}
 */
export function usageLimitSwitches({ reason = null, limitEngine = null } = {}, ready = null) {
  return reason === 'usage_limit' && limitEngine ? otherEngines(limitEngine, ready ?? SWITCH_ENGINES) : [];
}

/** What switching a paused run to `engine` does, in one line. */
export function engineSwitchNote(engine) {
  return `Starts the paused step fresh; the model falls back to ${engineLabel(engine)}'s default.`;
}

/** "Codex or Cursor" / "Claude, Codex or Cursor"; `label` maps each name (default engineLabel). */
export function engineList(engines, label = engineLabel) {
  const l = engines.map(label);
  return l.length < 2 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} or ${l.at(-1)}`;
}
