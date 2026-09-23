// src/core/bridge/translate/request.mjs
// Anthropic Messages API request -> OpenAI chat/completions request
// (model-bridge-design.md §5.1–§5.3). Pure: no I/O, no globals. Every field
// the CLI sends that has no equivalent is DROPPED and named in `warnings`;
// anything that cannot be expressed at all (a server tool, tools on a model
// without tool calls) is a hard `error` — the bridge answers 400 with it, so a
// run fails with the fix instruction instead of silently running degraded.
//
// Scope is what Claude Code actually sends. Reference implementations for the
// edge cases: ericc-ch/copilot-api, voidsteed/copilot-proxy-api (both MIT).
// Helpers shared with the Responses translator live in common.mjs.

import {
  SERVER_TOOL_RE, budgetToReasoningEffort, textOf, imageUrl, flattenToolResult,
  referencedToolNames, requestedEffort, mapEffort,
} from './common.mjs';

export { SERVER_TOOL_RE, budgetToReasoningEffort };

/** An Anthropic image block -> chat/completions image_url part (data URI), or null. */
function imagePart(block) {
  const url = imageUrl(block);
  return url ? { type: 'image_url', image_url: { url } } : null;
}

/**
 * Build chat/completions content from Anthropic user-side blocks. Returns
 * `{ parts, warnings }` where parts is a string when it is text-only.
 */
function userParts(blocks, caps, warn) {
  const parts = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text') {
      if (typeof b.text === 'string' && b.text) parts.push({ type: 'text', text: b.text });
    } else if (b.type === 'image') {
      if (caps.vision === false) {
        warn('image');
        parts.push({ type: 'text', text: '[image omitted: model has no vision]' });
      } else {
        const p = imagePart(b);
        if (p) parts.push(p); else warn('image');
      }
    } else if (b.type === 'document') {
      warn('document');
      parts.push({ type: 'text', text: '[document omitted: not supported by this model]' });
    } else {
      warn(b.type);
    }
  }
  return parts;
}

/** Collapse a parts array to a string when it is text-only (most compatible). */
function compact(parts) {
  if (!parts.length) return '';
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('\n\n');
  return parts;
}

/**
 * Translate one Messages API request body.
 * @param {object} body  the Anthropic request as the CLI sent it
 * @param {{upstreamModel:string, capabilities?:{toolCalls?:boolean, vision?:boolean, reasoning?:boolean, maxOutputTokens?:number, reasoningEfforts?:string[]}}} opts
 * @returns {{body?:object, warnings:string[], error?:{type:string,message:string}}}
 */
export function toChatRequest(body, { upstreamModel, capabilities = {} } = {}) {
  const caps = capabilities || {};
  const warnings = [];
  const seen = new Set();
  const warn = (what) => { if (what && !seen.has(what)) { seen.add(what); warnings.push(what); } };
  const fail = (message) => ({ warnings, error: { type: 'invalid_request_error', message } });

  if (!body || typeof body !== 'object') return fail('request body must be an object');

  const messages = [];

  // ── system ──
  const system = textOf(body.system);
  if (system) messages.push({ role: 'system', content: system });
  if (Array.isArray(body.system) && body.system.some((b) => b && b.cache_control)) warn('cache_control');

  // ── messages ──
  const src = Array.isArray(body.messages) ? body.messages : [];
  for (const m of src) {
    if (!m || typeof m !== 'object') continue;
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (Array.isArray(m.content) ? m.content : []);
    if (blocks.some((b) => b && b.cache_control)) warn('cache_control');

    if (m.role === 'assistant') {
      const texts = [];
      const toolCalls = [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') { if (typeof b.text === 'string' && b.text) texts.push(b.text); }
        else if (b.type === 'tool_use') {
          toolCalls.push({
            id: String(b.id || ''),
            type: 'function',
            function: { name: String(b.name || ''), arguments: JSON.stringify(b.input ?? {}) },
          });
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') warn('thinking');
        else warn(b.type);
      }
      if (!texts.length && !toolCalls.length) continue; // thinking-only turn: removed (§5.2)
      const msg = { role: 'assistant', content: texts.length ? texts.join('\n\n') : null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      messages.push(msg);
      continue;
    }

    // user: tool results first (they must directly follow the assistant turn),
    // then the remaining blocks as one user message.
    const results = blocks.filter((b) => b && b.type === 'tool_result');
    const rest = blocks.filter((b) => b && b.type !== 'tool_result');
    const relocated = [];
    for (const r of results) {
      const { text, imageUrls } = flattenToolResult(r.content, caps, warn);
      messages.push({ role: 'tool', tool_call_id: String(r.tool_use_id || ''), content: text || (r.is_error ? 'error' : '') });
      relocated.push(...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })));
    }
    const parts = userParts(rest, caps, warn);
    parts.push(...relocated);
    if (parts.length) {
      const prev = messages[messages.length - 1];
      const content = compact(parts);
      if (prev && prev.role === 'user' && typeof prev.content === 'string' && typeof content === 'string') {
        prev.content = `${prev.content}\n\n${content}`; // adjacent after a dropped assistant turn
      } else {
        messages.push({ role: 'user', content });
      }
    }
  }

  // ── tools ──
  const referenced = referencedToolNames(src);
  let tools;
  if (Array.isArray(body.tools) && body.tools.length) {
    if (caps.toolCalls === false) return fail(`model ${upstreamModel} does not support tool calls`);
    tools = [];
    for (const t of body.tools) {
      if (!t || typeof t !== 'object') continue;
      // Tool search: a deferred tool is sent only once a ToolSearch result has
      // referenced it (common.mjs#referencedToolNames).
      if (t.defer_loading === true && !referenced.has(String(t.name || ''))) continue;
      if (t.type && t.type !== 'custom' && SERVER_TOOL_RE.test(String(t.type))) {
        return fail(`tool ${JSON.stringify(t.name || t.type)} is an Anthropic server tool and cannot run through ${upstreamModel} (openai-chat bridge)`);
      }
      const fn = { name: String(t.name || ''), parameters: t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} } };
      if (typeof t.description === 'string' && t.description) fn.description = t.description;
      tools.push({ type: 'function', function: fn });
    }
    if (!tools.length) tools = undefined;
  }

  // ── tool_choice ──
  let toolChoice;
  let parallel;
  const tc = body.tool_choice;
  if (tc && typeof tc === 'object') {
    if (tc.type === 'auto') toolChoice = 'auto';
    else if (tc.type === 'any') toolChoice = 'required';
    else if (tc.type === 'none') toolChoice = 'none';
    else if (tc.type === 'tool' && tc.name) toolChoice = { type: 'function', function: { name: String(tc.name) } };
    if (tc.disable_parallel_tool_use === true) parallel = false;
  }

  // ── sampling / limits ──
  const reasoning = caps.reasoning === true;
  const out = { model: upstreamModel, messages };
  if (tools) out.tools = tools;
  if (toolChoice !== undefined && tools) out.tool_choice = toolChoice;
  if (parallel === false && tools) out.parallel_tool_calls = false;

  let maxTokens = Number(body.max_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    const cap = Number(caps.maxOutputTokens);
    if (Number.isFinite(cap) && cap > 0 && maxTokens > cap) { maxTokens = cap; warn('max_tokens clamped'); }
    if (reasoning) out.max_completion_tokens = maxTokens; else out.max_tokens = maxTokens;
  }
  if (typeof body.temperature === 'number') { if (reasoning) warn('temperature'); else out.temperature = body.temperature; }
  if (typeof body.top_p === 'number') { if (reasoning) warn('top_p'); else out.top_p = body.top_p; }
  if (body.top_k !== undefined) warn('top_k');
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences.slice(0, 4);
  if (body.metadata !== undefined) warn('metadata');

  // ── reasoning ──
  const effort = requestedEffort(body);
  if (effort) { if (reasoning) out.reasoning_effort = mapEffort(effort, caps); else warn('thinking'); }

  // ── stream ──
  if (body.stream === true) { out.stream = true; out.stream_options = { include_usage: true }; }

  return { body: out, warnings };
}
