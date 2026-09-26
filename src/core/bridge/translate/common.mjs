// src/core/bridge/translate/common.mjs
// Helpers the two translated wire protocols share — openai-chat
// (request.mjs) and openai-responses (responses-request.mjs /
// responses-stream.mjs): text, image and tool_result flattening, the
// tool-search references, the effort a request asks for and how it maps to
// the model's own levels, and the reasoning marker the Responses translator
// round-trips through the thinking blocks the CLI echoes back
// (2026-09-23-bridge-openai-responses-design.md §7–§8). Pure.

import { Buffer } from 'node:buffer';
import { REASONING_EFFORT_LEVELS } from '../../model-env.mjs';

/** Anthropic server-side tool types — no OpenAI equivalent (§5.3). */
export const SERVER_TOOL_RE = /^(web_search|web_fetch|computer|text_editor|bash|code_execution|memory)(_\d{8})?$/;

/** Text of a block list (text blocks only), joined with blank lines. */
export function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n');
}

/** An Anthropic image block's URL: a data URI for a base64 source, the URL for a url source, else null. */
export function imageUrl(block) {
  const src = (block && block.source) || {};
  if (src.type === 'base64' && src.media_type && src.data) return `data:${src.media_type};base64,${src.data}`;
  if (src.type === 'url' && typeof src.url === 'string') return src.url;
  return null;
}

/**
 * Flatten a tool_result's content to text; image URLs come back separately
 * (neither OpenAI protocol takes an image inside a tool output — the
 * translators relocate them to a following user message, §5.2).
 * @returns {{text:string, imageUrls:string[]}}
 */
export function flattenToolResult(content, caps, warn) {
  if (typeof content === 'string') return { text: content, imageUrls: [] };
  if (!Array.isArray(content)) return { text: content == null ? '' : String(content), imageUrls: [] };
  const texts = [];
  const imageUrls = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    // ToolSearch's result: the named tool is now in `tools` on this request.
    else if (b.type === 'tool_reference') texts.push(`Tool loaded: ${b.tool_name || b.name || 'unknown'}`);
    else if (b.type === 'image') {
      if (caps.vision === false) { warn('image'); texts.push('[image omitted: model has no vision]'); }
      else { const u = imageUrl(b); if (u) imageUrls.push(u); else warn('image'); }
    } else warn(b.type);
  }
  return { text: texts.join('\n\n'), imageUrls };
}

/**
 * The deferred tools a ToolSearch result has loaded: the names in
 * tool_reference blocks. The Anthropic API expands them against the request's
 * `defer_loading` tools server-side; the OpenAI protocols have no such step, so
 * the translators send a deferred tool only once it is referenced.
 */
export function referencedToolNames(messages) {
  const referenced = new Set();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || b.type !== 'tool_result' || !Array.isArray(b.content)) continue;
      for (const r of b.content) if (r && r.type === 'tool_reference' && r.tool_name) referenced.add(String(r.tool_name));
    }
  }
  return referenced;
}

/** Thinking budget bands -> effort (§5.1). */
export function budgetToReasoningEffort(budget) {
  const n = Number(budget);
  if (!Number.isFinite(n) || n <= 0) return 'medium';
  if (n < 4000) return 'low';
  if (n < 16000) return 'medium';
  return 'high';
}

const REQUESTABLE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * The effort a Messages request asks for: `output_config.effort` (the CLI's
 * --effort) wins over an enabled thinking budget's band; `thinking:
 * {type:'adaptive'}` alone asks for nothing. null when neither is present.
 */
export function requestedEffort(body) {
  if (!body || typeof body !== 'object') return null;
  let effort = null;
  if (body.thinking && typeof body.thinking === 'object' && body.thinking.type === 'enabled') {
    effort = budgetToReasoningEffort(body.thinking.budget_tokens);
  }
  const oc = body.output_config;
  if (oc && typeof oc === 'object' && typeof oc.effort === 'string' && REQUESTABLE_EFFORTS.has(oc.effort)) effort = oc.effort;
  return effort;
}

/** Requested effort -> upstream effort when the model lists no levels (the chat bridge's original table). */
const DEFAULT_EFFORT_MAP = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

/**
 * Map a requested effort onto the upstream's reasoning effort (spec §7.4).
 * With `capabilities.reasoningEfforts`: the highest listed level at or below
 * the request, else the lowest listed level above it (`none` is never
 * chosen). Without a list: DEFAULT_EFFORT_MAP.
 * @returns {string|null}
 */
export function mapEffort(requested, capabilities = {}) {
  if (!requested) return null;
  const listed = capabilities && Array.isArray(capabilities.reasoningEfforts) ? capabilities.reasoningEfforts : [];
  const levels = REASONING_EFFORT_LEVELS.filter((e) => e !== 'none' && listed.includes(e));
  if (!levels.length) return DEFAULT_EFFORT_MAP[requested] || 'medium';
  const want = REASONING_EFFORT_LEVELS.indexOf(requested);
  const atOrBelow = levels.filter((e) => REASONING_EFFORT_LEVELS.indexOf(e) <= want);
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : levels[0];
}

/**
 * The signature on a thinking block the CHAT translator emits. Chat
 * completions returns reasoning as plain text with nothing to replay, but a
 * thinking block needs a signature the CLI can carry back; this one tells the
 * request side the block is ours and is dropped quietly on the next turn.
 */
export const CHAT_REASONING_SIGNATURE = 'worca.rsn.chat.v1';

/**
 * The reasoning text in a chat/completions delta or message: OpenRouter's
 * `reasoning` (with `reasoning_details` beside it — the same text, so it is
 * read only when `reasoning` is absent), vLLM / DeepSeek's
 * `reasoning_content`. Encrypted details carry no text and are skipped.
 * @returns {string}
 */
export function chatReasoningText(m) {
  if (!m || typeof m !== 'object') return '';
  if (typeof m.reasoning === 'string' && m.reasoning) return m.reasoning;
  if (typeof m.reasoning_content === 'string' && m.reasoning_content) return m.reasoning_content;
  if (Array.isArray(m.reasoning_details)) {
    let s = '';
    for (const d of m.reasoning_details) {
      if (!d || typeof d !== 'object') continue;
      if (d.type === 'reasoning.text' && typeof d.text === 'string') s += d.text;
      else if (d.type === 'reasoning.summary' && typeof d.summary === 'string') s += d.summary;
    }
    return s;
  }
  return '';
}

const MARKER_PREFIX = 'worca.rsn.v1.';

/**
 * The reasoning marker: what the Responses translator puts in a thinking
 * block's `signature` (or a redacted_thinking block's `data`) so the CLI
 * carries the model's encrypted reasoning to the next request (spec §8).
 * `<prefix><base64url(upstream model)>.<encrypted_content>`.
 */
export function encodeReasoningMarker(upstreamModel, encrypted) {
  return `${MARKER_PREFIX}${Buffer.from(String(upstreamModel || ''), 'utf8').toString('base64url')}.${encrypted}`;
}

/** Parse a reasoning marker; null for anything else (a real Claude signature, a truncated value). */
export function decodeReasoningMarker(s) {
  if (typeof s !== 'string' || !s.startsWith(MARKER_PREFIX)) return null;
  const rest = s.slice(MARKER_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return null;
  const model = Buffer.from(rest.slice(0, dot), 'base64url').toString('utf8');
  if (!model) return null;
  return { model, encrypted: rest.slice(dot + 1) };
}
