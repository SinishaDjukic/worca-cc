// src/core/pricing.mjs
// The one rule for what worca can price and how a cost cap refuses what it cannot, for Chat and runs alike: a model's
// price on the Models page (a global or plugin catalog entry's `cost`, imported and bridged models included), else the
// list price its engine's provider bills (Claude's list prices for an engine whose catalog relay goes to Anthropic; the
// engine's chat descriptor `listRates` otherwise: Codex's OpenAI table, an `anthropic/…` or `openai/…` model on Goose or
// OpenCode). Never the engine's own unseen price table: what a Goose or OpenCode run reports is booked when it comes,
// but a cost cap starts a run only on a model worca can price itself (R4). A spend worca cannot price is cost unknown
// (`cost_known` 0), never $0, in a run step and in a chat message alike.
import { modelCostConfig, liveCostRates, bridgedModelInfo } from './config.mjs';
import { engineEntry } from '../shared/engine-switch.mjs';
import { chatDescriptor } from './engines/chat.mjs';

const FREE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** worca's per-million-token rates for `model` on `engine` (null: the engine's default), or null when it has none. */
export function modelRatesOn(engine, model, { costOf = modelCostConfig } = {}) {
  const entry = engineEntry(engine || 'claude');
  let cfg = null;
  try { cfg = typeof model === 'string' && model ? costOf(model) : null; } catch { cfg = null; }
  if (cfg && cfg.free === true) return FREE;
  if (cfg && cfg.perMtok && typeof cfg.perMtok === 'object') return cfg.perMtok;
  try {
    if (entry?.relay?.upstream === 'anthropic') return typeof model === 'string' && model ? liveCostRates(model) : null;
    return chatDescriptor(engine || 'claude')?.listRates(model) || null;
  } catch { return null; }
}

/** Whether a cost cap can count what `engine` spends on `model` (null: the engine's default): worca has rates for it, or
 *  (an engine whose relay goes to Anthropic) its CLI prices its own default and a bridged model's upstream prices it at
 *  run time. Never on an engine that reports no cost without a Models page price. Never throws. */
export function modelPricedOn(engine, model, opts) {
  try {
    if (modelRatesOn(engine, model, opts)) return true;
    const entry = engineEntry(engine || 'claude');
    if (!entry || entry.cost === false) return false;
    return entry.relay?.upstream === 'anthropic' && (model == null || !!bridgedModelInfo(model));
  } catch { return false; }
}

/**
 * The refusal a cost cap gives a run or a chat turn on `engine` whose `models` worca cannot price, or null. `cap`:
 * 'turn' (Chat's per-turn cap), 'pipeline' or 'total'. `priced` is the rule (default modelPricedOn; a chat passes its
 * turn's own rates, the same rule).
 */
export function costCapRefusal(engine, models, cap, { priced = (m) => modelPricedOn(engine, m) } = {}) {
  const entry = engineEntry(engine || 'claude');
  const unpriced = [...new Set(models)].filter((m) => !priced(m));
  if (!unpriced.length) return null;
  if (cap === 'turn') {
    return `A per-turn cost cap is set, and worca has no price for ${unpriced.map((m) => m || `${entry?.label ?? engine}'s default model`).join(', ')}, so it cannot keep this turn under it. Set the model's price on the Models page, pick a priced model, or turn the cap off (Settings › Chat).`;
  }
  if (entry?.cost === false) return `${entry.label} reports no cost, and the ${cap} cost limit cannot count what this run spends. Remove the limit, set a price on the model, or pick another engine.`;
  return `model ${unpriced.map((m) => `"${m ?? 'default'}"`).join(', ')} has no price, and the ${cap} cost limit cannot count what this run spends. Set a price on the model, remove the limit, or pick another model.`;
}
