// src/core/bridge/openrouter.mjs
// OpenRouter's dialect of chat completions (docs/models.md › OpenRouter). The
// wire protocol is OpenAI's, so an OpenRouter model is an ordinary `openai`
// provider entry; what differs is decided by the base URL alone:
//   - `usage: {include: true}` — the reply's usage then carries the call's USD
//     `cost`, which the bridge books under the run's tag (the CLI prices a
//     bridged id at $0);
//   - `reasoning: {effort}` — OpenRouter's one reasoning knob for every model,
//     where OpenAI's `reasoning_effort` is honoured only by some;
//   - `max_tokens` — OpenRouter's name for the output cap on every model;
//   - the entry's `upstream.openrouter` routing: `provider` preferences and the
//     `models` fallback list, tried when the first model is rate-limited or down;
//   - attribution headers, so worca's traffic is named on the OpenRouter dashboard.
// Pure; zero imports beyond the model-env leaf.

import { isOpenRouterBaseUrl } from '../model-env.mjs';

/** Whether a base URL is OpenRouter's (openrouter.ai or a subdomain). */
export const isOpenRouter = isOpenRouterBaseUrl;

/**
 * OpenRouter app attribution (openrouter.ai/docs/app-attribution): every install
 * reports as the one Worca app. HTTP-Referer is what creates the app page; the
 * title rides both spellings (X-Title is the older one); categories come from
 * OpenRouter's fixed list, at most two per request (unknown ones are dropped).
 * Only ever Worca's own identity — never another listed app's referer. No
 * X-OpenRouter-App-Visibility: Worca is listed publicly (OpenRouter's default),
 * and that header only counts on the request that creates the app anyway.
 */
export const OPENROUTER_HEADERS = Object.freeze({
  'HTTP-Referer': 'https://worca.dev',
  'X-Title': 'Worca',
  'X-OpenRouter-Title': 'Worca',
  'X-OpenRouter-Categories': 'cloud-agent,cli-agent',
});

/**
 * A translated chat/completions body, adapted for OpenRouter. Never mutates
 * `body`.
 * @param {object} body  toChatRequest's output
 * @param {{openrouter?: {models?:string[], provider?:object}}} upstream  the entry's upstream settings
 * @returns {object}
 */
export function adaptOpenRouterChatBody(body, upstream = {}) {
  const out = { ...body };
  if (out.reasoning_effort) {
    out.reasoning = { effort: out.reasoning_effort };
    delete out.reasoning_effort;
  }
  if (out.max_completion_tokens !== undefined) {
    out.max_tokens = out.max_completion_tokens;
    delete out.max_completion_tokens;
  }
  out.usage = { include: true };
  const or = upstream && upstream.openrouter;
  if (or && Array.isArray(or.models) && or.models.length) out.models = [...or.models];
  if (or && or.provider && typeof or.provider === 'object') out.provider = { ...or.provider };
  return out;
}
