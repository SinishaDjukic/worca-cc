// src/core/ask/chat-price.mjs
// What a token costs on a locked-down chat's model, in worca's own prices, for every engine alike: the model's price on
// the Models page (a global or plugin catalog entry's `cost`, imported and bridged models included), else the list
// price the engine's provider bills it at (its chat descriptor's `listRates`: Codex's OpenAI models; an `anthropic/…` or
// `openai/…` model on Goose or OpenCode). A per-turn cost cap runs on a model with a price and refuses one without
// (turn.mjs _engineGate); the turn's spend is priced from its token usage with the same rates (turn.mjs _priced), so an
// engine that reports no cost (Copilot, Gemini CLI, Qwen Code) is booked and capped like one that does.
import { modelCostConfig } from '../config.mjs';

const FREE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** worca's per-million-token rates for `model` on the chat engine of descriptor `d`, or null (no price known). */
export function chatModelRates(d, model, { costOf = modelCostConfig } = {}) {
  let cfg = null;
  try { cfg = typeof model === 'string' && model ? costOf(model) : null; } catch { cfg = null; }
  if (cfg && cfg.free === true) return FREE;
  if (cfg && cfg.perMtok && typeof cfg.perMtok === 'object') return cfg.perMtok;
  try { return (d && d.listRates(model)) || null; } catch { return null; }
}
