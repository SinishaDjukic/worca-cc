// src/core/ask/chat-price.mjs
// What a token costs on a locked-down chat's model: the one pricing rule (src/core/pricing.mjs modelRatesOn), for the
// chat's engine. A per-turn cost cap runs on a model with a price and refuses one without (turn.mjs _engineGate); the
// turn's spend is priced from its token usage with the same rates (turn.mjs _priced), so an engine that reports no cost
// (Copilot, Gemini CLI, Qwen Code) is booked and capped like one that does, and as a run on it is.
import { modelRatesOn } from '../pricing.mjs';

/** worca's per-million-token rates for `model` on the chat engine of descriptor `d`, or null (no price known). */
export function chatModelRates(d, model, opts) {
  return d ? modelRatesOn(d.engine, model, opts) : null;
}
