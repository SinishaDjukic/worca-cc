// src/core/bridge/gemini.mjs
// Google's OpenAI-compatible Gemini endpoint (docs/models.md › Gemini and Qwen models). The wire protocol is
// OpenAI's chat completions, so a Gemini model is an ordinary `openai` provider entry; what differs is the thought
// signature. Gemini 3 puts one on its tool calls (`tool_calls[].extra_content.google.thought_signature`) and refuses
// the next request (400) when the assistant turn comes back without it. Claude Code has nowhere to keep it, so the
// bridge keeps every tool call's `extra_content` here, by tool call id, and puts it back on the request. A call the
// store no longer holds (worca restarted, the store rolled over, a turn from another model) gets Google's documented
// stand-in signature, which skips the check for that call rather than failing the turn.

import { isGeminiBaseUrl } from '../model-env.mjs';

export const isGemini = isGeminiBaseUrl;

/** Google's documented stand-in for a function call whose signature is unknown (it skips the validation). */
export const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

/** How many tool calls' `extra_content` the store keeps (a long chat makes a few hundred; one entry is a few KB). */
const MAX_ENTRIES = 5000;

/** A bounded store of tool call id -> the upstream's `extra_content` for that call, oldest dropped first. */
export class ExtraContentStore {
  constructor(max = MAX_ENTRIES) { this.max = max; this.map = new Map(); }
  set(id, extra) {
    if (!id || !extra || typeof extra !== 'object') return;
    this.map.delete(id);
    this.map.set(id, extra);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get(id) { return this.map.get(id); }
  get size() { return this.map.size; }
}

/** The process-wide store the bridge uses. */
export const extraContentStore = new ExtraContentStore();

const hasSignature = (tc) => !!(tc && tc.extra_content && tc.extra_content.google && tc.extra_content.google.thought_signature);

/**
 * A translated chat/completions body, adapted for Gemini: an assistant turn whose tool calls carry no thought
 * signature gets the stand-in on its first call (Gemini checks the first call of each step). Never mutates `body`.
 * @param {object} body  toChatRequest's output
 */
export function adaptGeminiChatBody(body) {
  if (!body || !Array.isArray(body.messages)) return body;
  let changed = false;
  const messages = body.messages.map((m) => {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length || m.tool_calls.some(hasSignature)) return m;
    changed = true;
    const [first, ...rest] = m.tool_calls;
    const google = { ...(first.extra_content && first.extra_content.google), thought_signature: GEMINI_SKIP_SIGNATURE };
    return { ...m, tool_calls: [{ ...first, extra_content: { ...first.extra_content, google } }, ...rest] };
  });
  return changed ? { ...body, messages } : body;
}
