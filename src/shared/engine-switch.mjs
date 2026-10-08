// src/shared/engine-switch.mjs
// Continuing a paused run on the other engine: which engine that is, what it is called, and
// when a pause offers it. ONE source for the harness, the CLI, the chat notifier, the
// scheduler feed and the browser. Import-free: served to the browser as-is under /src/shared.

/** The engines a run can switch between (src/core/model-env.mjs MODEL_ENGINES, kept equal by a test). */
export const SWITCH_ENGINES = Object.freeze(['claude', 'codex']);

const LABELS = Object.freeze({ claude: 'Claude', codex: 'Codex' });

/** The display name of an engine ('codex' -> 'Codex'); a missing engine is Claude. */
export function engineLabel(engine) {
  const e = engine || 'claude';
  return LABELS[e] || String(e);
}

/** The one engine a run on `engine` can switch to, or null (an unknown engine). */
export function otherEngine(engine) {
  const e = engine || 'claude';
  if (!SWITCH_ENGINES.includes(e)) return null;
  const rest = SWITCH_ENGINES.filter((x) => x !== e);
  return rest.length === 1 ? rest[0] : null;
}

/**
 * The engine a pause offers to continue on now, or null. Only a session/usage limit an
 * engine itself hit (`limitEngine`, recorded by the harness) offers one: the other engine
 * has its own allowance. Any other pause, and a limit that was not the engine's (a spent
 * OpenRouter free allowance, say), offers none.
 * @param {{reason?: string|null, limitEngine?: string|null}} pause
 * @returns {string|null}
 */
export function usageLimitSwitch({ reason = null, limitEngine = null } = {}) {
  return reason === 'usage_limit' && limitEngine ? otherEngine(limitEngine) : null;
}

/** What switching a paused run to `engine` does, in one line. */
export function engineSwitchNote(engine) {
  return `Starts the paused step fresh; the model falls back to ${engineLabel(engine)}'s default.`;
}
