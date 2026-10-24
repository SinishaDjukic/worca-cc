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
 *   signin    its models connect through its own sign-in (its CLI's login or its own providers): a model takes no env
 *             and no endpoint, and worca ships none of its models (efforts: src/core/model-env.mjs effortsForEngine)
 *   chat      Chat (Ask) on it: {images, pdfs, verified}; false = the adapter has no chat descriptor. Every engine but
 *             Claude runs a chat locked down, and its adapter exports the chat descriptor that does it. `verified: false`
 *             = the descriptor is wired but worca has no verified lockdown yet (its lockdown is null), so Chat stays off
 *             there. src/core/engines/chat.mjs refuses to load when this and the descriptors disagree. Kept here, not in
 *             the adapters, because the browser and src/core/model-env.mjs read it and neither may import an adapter.
 */
export const ENGINES = Object.freeze({
  claude: Object.freeze({ label: 'Claude', models: true, cost: true, helpers: true, beta: false, signin: false, chat: Object.freeze({ images: true, pdfs: true }) }),
  codex: Object.freeze({ label: 'Codex', models: true, cost: true, helpers: true, beta: true, signin: false, chat: Object.freeze({ images: true, pdfs: false }) }),
  copilot: Object.freeze({ label: 'Copilot', models: true, cost: false, helpers: true, beta: true, signin: false, chat: Object.freeze({ images: false, pdfs: false }) }),
  cursor: Object.freeze({ label: 'Cursor', models: true, cost: false, helpers: false, beta: true, signin: true, chat: Object.freeze({ images: false, pdfs: false, verified: false }) }),
  gemini: Object.freeze({ label: 'Gemini CLI', models: true, cost: false, helpers: false, beta: true, signin: true, chat: Object.freeze({ images: true, pdfs: true }) }),
  goose: Object.freeze({ label: 'Goose', models: true, cost: true, helpers: false, beta: true, signin: true, chat: Object.freeze({ images: true, pdfs: false }) }),
  opencode: Object.freeze({ label: 'OpenCode', models: true, cost: true, helpers: false, beta: true, signin: true, chat: Object.freeze({ images: true, pdfs: true }) }),
  qwen: Object.freeze({ label: 'Qwen Code', models: true, cost: false, helpers: false, beta: true, signin: true, chat: Object.freeze({ images: true, pdfs: true }) }),
});

/** The run engines. */
export const ENGINE_NAMES = Object.freeze(Object.keys(ENGINES));
/** The engines that own catalog models. */
export const MODEL_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].models));
/** The engines a run can switch between: the model engines (a switch falls back to the target's catalog default). */
export const SWITCH_ENGINES = MODEL_ENGINE_NAMES;

/** The engines whose models connect through their own sign-in (Cursor, Gemini CLI, Goose, OpenCode, Qwen Code). */
export const SIGN_IN_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].signin));

/** The engines a Chat runs on, Claude first (the `chat` flag above, without the unverified ones). */
export const CHAT_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].chat && ENGINES[e].chat.verified !== false));

/**
 * Why a chat on `engine` cannot take an attachment of this kind (`kind` text|image|binary, a PDF is `pdf: true`), said
 * before upload and again by the server; null when it can. A text attachment always can.
 */
export function chatAttachRefusal({ engine, kind, pdf = false }) {
  const c = Object.hasOwn(ENGINES, engine || 'claude') ? ENGINES[engine || 'claude'].chat : null;
  if (!c || c.verified === false || kind === 'text') return null;
  const label = engineLabel(engine);
  if (!c.images && !c.pdfs) return `a ${label} chat cannot view images or PDFs (${chatEnginesTaking('images', 'pdfs')} chats view both)`;
  if (pdf && !c.pdfs) return `a ${label} chat cannot view PDFs (${chatEnginesTaking('pdfs')} chats can)`;
  if (!pdf && kind === 'image' && !c.images) return `a ${label} chat cannot view images (${chatEnginesTaking('images')} chats can)`;
  return null;
}

/** The chat engines that take every `what` ('images', 'pdfs'), as words: 'Claude, Gemini CLI, OpenCode or Qwen Code'. */
export function chatEnginesTaking(...what) {
  const names = CHAT_ENGINE_NAMES.filter((e) => what.every((w) => ENGINES[e].chat[w] === true)).map((e) => ENGINES[e].label);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names.join('');
}

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
  if (surface === 'chat') return s.replace(/pass --allow-unguarded-engine/g, 'resume it in the Worca UI with Allow unguarded');
  return s;
}

/** "Codex or Cursor" / "Claude, Codex or Cursor"; `label` maps each name (default engineLabel). */
export function engineList(engines, label = engineLabel) {
  const l = engines.map(label);
  return l.length < 2 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} or ${l.at(-1)}`;
}
