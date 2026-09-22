// src/core/bridge/translate/response.mjs
// Non-streaming chat/completions response -> Anthropic message object, and the
// local count_tokens estimate (model-bridge-design.md §5.4 buffered path, §5.9).

import { mapStopReason, mapUsage, newMessageId, newToolUseId, parsesAsJson, truncatedToolNote } from './stream.mjs';

/**
 * @param {object} completion  the upstream JSON body
 * @param {{model:string}} opts  catalog id the CLI expects back
 */
export function toMessagesResponse(completion, { model } = {}) {
  const choice = completion && Array.isArray(completion.choices) ? completion.choices[0] : null;
  const msg = (choice && choice.message) || {};
  const content = [];
  if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content });
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const finish = choice ? choice.finish_reason : null;
  let toolUses = 0;
  for (const tc of calls) {
    if (!tc || typeof tc !== 'object') continue;
    const fn = tc.function || {};
    // Cut off by `length` mid-arguments: not runnable — say so instead (see stream.mjs).
    if (finish === 'length' && !parsesAsJson(fn.arguments)) {
      content.push({ type: 'text', text: truncatedToolNote(String(fn.name || 'tool')) });
      continue;
    }
    let input = {};
    if (typeof fn.arguments === 'string' && fn.arguments.trim()) {
      try { input = JSON.parse(fn.arguments); } catch { input = { _raw: fn.arguments }; }
    }
    content.push({ type: 'tool_use', id: tc.id || newToolUseId(), name: String(fn.name || ''), input });
    toolUses += 1;
  }
  let stop = mapStopReason(finish, { emitted: content.length > 0 }) || 'end_turn';
  if (toolUses && stop === 'end_turn') stop = 'tool_use';
  return {
    id: newMessageId(),
    type: 'message',
    role: 'assistant',
    model: model || 'bridge',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: mapUsage(completion && completion.usage),
  };
}

const IMAGE_TOKENS = 1200;
const TOOL_OVERHEAD = 20;

/**
 * Local input-token estimate for /v1/messages/count_tokens: ~4 chars per
 * token over system + messages + serialized tools, plus per-image and
 * per-tool constants. ±15 % is enough for the CLI's context heuristics.
 * @param {object} body
 * @returns {number}
 */
export function estimateInputTokens(body) {
  if (!body || typeof body !== 'object') return 0;
  let chars = 0;
  let images = 0;
  const walk = (content) => {
    if (typeof content === 'string') { chars += content.length; return; }
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'image') images += 1;
      else if (b.type === 'tool_result') walk(b.content);
      else if (b.type === 'tool_use') chars += JSON.stringify(b.input ?? {}).length + (b.name || '').length;
      else if (typeof b.text === 'string') chars += b.text.length;
      else if (typeof b.thinking === 'string') chars += b.thinking.length;
    }
  };
  walk(body.system);
  for (const m of Array.isArray(body.messages) ? body.messages : []) if (m) walk(m.content);
  let tools = 0;
  if (Array.isArray(body.tools)) {
    tools = body.tools.length;
    chars += JSON.stringify(body.tools).length;
  }
  return Math.ceil(chars / 4) + images * IMAGE_TOKENS + tools * TOOL_OVERHEAD;
}
