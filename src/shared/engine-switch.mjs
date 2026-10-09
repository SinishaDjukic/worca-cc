// src/shared/engine-switch.mjs
// Continuing a paused run on another engine: which engines there are, what they are called, which ones a pause offers,
// and which report a cost. ONE source for the harness, the CLI, the chat notifier, the scheduler feed and the browser.
// Import-free: served to the browser as-is under /src/shared.

/**
 * Every run engine and what the rest of worca needs to know about it, in list order. The one place an engine is
 * named: the lists below, src/core/model-env.mjs and the UI's engine pickers derive from it, and a test keeps it equal
 * to the adapter registry (src/core/engines/index.mjs, which adds the mock).
 *   label     its display name
 *   models    it owns catalog models (step, helper and Ask slots; a switch falls back to its catalog default)
 *   cost      its runs report a cost (adapter capability `cost`); where not, a cost shows as unknown, never $0.00
 *   helpers   it runs a run's helper jobs itself (title, overview, PR description, Auto classifier, night decider);
 *             else they run on Claude
 *   beta      still in beta: every engine picker marks it (taking it out of beta is this one flag)
 */
export const ENGINES = Object.freeze({
  claude: Object.freeze({ label: 'Claude', models: true, cost: true, helpers: true, beta: false }),
  codex: Object.freeze({ label: 'Codex', models: true, cost: true, helpers: true, beta: true }),
  copilot: Object.freeze({ label: 'Copilot', models: false, cost: false, helpers: true, beta: true }),
  cursor: Object.freeze({ label: 'Cursor', models: true, cost: false, helpers: false, beta: true }),
});

/** The run engines. */
export const ENGINE_NAMES = Object.freeze(Object.keys(ENGINES));
/** The engines that own catalog models. Copilot owns none. */
export const MODEL_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].models));
/** The engines a run can switch between: the model engines (a switch falls back to the target's catalog default). */
export const SWITCH_ENGINES = MODEL_ENGINE_NAMES;

/** The engines still in beta: every engine picker marks them. */
export const BETA_ENGINES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].beta));

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
  return Object.hasOwn(ENGINES, e) ? ENGINES[e].label : String(e);
}

/** Whether runs on `engine` report a cost. Where not, a cost shows as unknown, never $0.00. An unknown engine does. */
export function engineReportsCost(engine) { const e = engine || 'claude'; return !Object.hasOwn(ENGINES, e) || ENGINES[e].cost; }

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
  return `Starts the paused step fresh; a model ${engineLabel(engine)} cannot run falls back to its default.`;
}

/** The engine gate's refusal worded for where it is read. The run writes it for the CLI ("pass
 *  --allow-unguarded-engine"); the UI names its checkbox, and chat sends the person to the UI (it never
 *  sends the consent). Any other text is returned as is. */
export function engineRefusalFor(text, surface) {
  const s = String(text ?? '');
  if (surface === 'ui') return s.replace(/pass --allow-unguarded-engine/g, 'tick Allow unguarded');
  if (surface === 'chat') return s.replace(/pass --allow-unguarded-engine/g, 'resume it from the worca-cc UI with Allow unguarded');
  return s;
}

/** "Codex or Cursor" / "Claude, Codex or Cursor"; `label` maps each name (default engineLabel). */
export function engineList(engines, label = engineLabel) {
  const l = engines.map(label);
  return l.length < 2 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} or ${l.at(-1)}`;
}
