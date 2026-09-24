// src/core/bridge/translate/responses-request.mjs
// Anthropic Messages API request -> OpenAI Responses API request
// (2026-09-23-bridge-openai-responses-design.md §7). Pure, same contract as
// toChatRequest: `{body, warnings}` or `{error}`. Stateless by design —
// `store: false` and the full history as `input` items every turn; the
// model's encrypted reasoning comes back inside the thinking blocks the CLI
// echoes (the reasoning marker, common.mjs) and is replayed as `reasoning`
// items for the SAME upstream model only.

import {
  SERVER_TOOL_RE, textOf, imageUrl, flattenToolResult, referencedToolNames,
  requestedEffort, mapEffort, decodeReasoningMarker,
} from './common.mjs';

/** OpenAI (and Copilot) reject max_output_tokens below this. */
const MIN_OUTPUT_TOKENS = 16;

/**
 * Translate one Messages API request body.
 * @param {object} body  the Anthropic request as the CLI sent it
 * @param {{upstreamModel:string, capabilities?:{toolCalls?:boolean, vision?:boolean, reasoning?:boolean, maxOutputTokens?:number, reasoningEfforts?:string[]}}} opts
 * @returns {{body?:object, warnings:string[], error?:{type:string,message:string}}}
 */
export function toResponsesRequest(body, { upstreamModel, capabilities = {} } = {}) {
  const caps = capabilities || {};
  const warnings = [];
  const seen = new Set();
  const warn = (what) => { if (what && !seen.has(what)) { seen.add(what); warnings.push(what); } };
  const fail = (message) => ({ warnings, error: { type: 'invalid_request_error', message } });

  if (!body || typeof body !== 'object') return fail('request body must be an object');

  const input = [];
  // Append a content part to the trailing message item of `role`, or open a new one.
  const pushPart = (role, part) => {
    const last = input[input.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(part);
    else input.push({ role, content: [part] });
  };

  // ── system ──
  const instructions = textOf(body.system);
  if (Array.isArray(body.system) && body.system.some((b) => b && b.cache_control)) warn('cache_control');

  // ── messages → input items ──
  const src = Array.isArray(body.messages) ? body.messages : [];
  for (const m of src) {
    if (!m || typeof m !== 'object') continue;
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (Array.isArray(m.content) ? m.content : []);
    if (blocks.some((b) => b && b.cache_control)) warn('cache_control');

    if (m.role === 'system') {
      // The CLI's mid-conversation system message (beta mid-conversation-system).
      const text = textOf(blocks);
      if (text) input.push({ role: 'system', content: [{ type: 'input_text', text }] });
      continue;
    }

    if (m.role === 'assistant') {
      const turnStart = input.length;
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') {
          if (typeof b.text === 'string' && b.text) pushPart('assistant', { type: 'output_text', text: b.text });
        } else if (b.type === 'tool_use') {
          input.push({ type: 'function_call', call_id: String(b.id || ''), name: String(b.name || ''), arguments: JSON.stringify(b.input ?? {}) });
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          const mk = decodeReasoningMarker(b.type === 'thinking' ? b.signature : b.data);
          if (mk && mk.model === upstreamModel) {
            const text = b.type === 'thinking' && typeof b.thinking === 'string' ? b.thinking : '';
            input.push({ type: 'reasoning', summary: text ? [{ type: 'summary_text', text }] : [], encrypted_content: mk.encrypted });
          } else warn('thinking');   // another model's reasoning, or a real Claude signature
        } else warn(b.type);
      }
      // A reasoning item must be followed by the message / call it was produced
      // with — the upstream rejects one left dangling (a reasoning-only turn:
      // output spent on reasoning, or cut by a filter). Drop it; the model
      // re-reasons, as on the chat path, which drops thinking-only turns.
      while (input.length > turnStart && input[input.length - 1].type === 'reasoning') { input.pop(); warn('thinking'); }
      continue;
    }

    // user: tool outputs first (they answer the calls just made), then the
    // rest of the message, then images relocated out of the tool results.
    const results = blocks.filter((b) => b && b.type === 'tool_result');
    const rest = blocks.filter((b) => b && b.type !== 'tool_result');
    const relocated = [];
    for (const r of results) {
      const { text, imageUrls } = flattenToolResult(r.content, caps, warn);
      input.push({ type: 'function_call_output', call_id: String(r.tool_use_id || ''), output: text || (r.is_error ? 'error' : '') });
      relocated.push(...imageUrls);
    }
    for (const b of rest) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text') {
        if (typeof b.text === 'string' && b.text) pushPart('user', { type: 'input_text', text: b.text });
      } else if (b.type === 'image') {
        if (caps.vision === false) {
          warn('image');
          pushPart('user', { type: 'input_text', text: '[image omitted: model has no vision]' });
        } else {
          const u = imageUrl(b);
          if (u) pushPart('user', { type: 'input_image', image_url: u }); else warn('image');
        }
      } else if (b.type === 'document') {
        warn('document');
        pushPart('user', { type: 'input_text', text: '[document omitted: not supported by this model]' });
      } else warn(b.type);
    }
    for (const u of relocated) pushPart('user', { type: 'input_image', image_url: u });
  }

  // ── tools ──
  const referenced = referencedToolNames(src);
  let tools;
  if (Array.isArray(body.tools) && body.tools.length) {
    if (caps.toolCalls === false) return fail(`model ${upstreamModel} does not support tool calls`);
    tools = [];
    for (const t of body.tools) {
      if (!t || typeof t !== 'object') continue;
      if (t.defer_loading === true && !referenced.has(String(t.name || ''))) continue;
      if (t.type && t.type !== 'custom' && SERVER_TOOL_RE.test(String(t.type))) {
        return fail(`tool ${JSON.stringify(t.name || t.type)} is an Anthropic server tool and cannot run through ${upstreamModel} (openai-responses bridge)`);
      }
      const tool = {
        type: 'function',
        name: String(t.name || ''),
        parameters: t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} },
        strict: false,
      };
      if (typeof t.description === 'string' && t.description) tool.description = t.description;
      tools.push(tool);
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
    else if (tc.type === 'tool' && tc.name) toolChoice = { type: 'function', name: String(tc.name) };
    if (tc.disable_parallel_tool_use === true) parallel = false;
  }

  // ── assemble ──
  const reasoning = caps.reasoning === true;
  const out = { model: upstreamModel };
  if (instructions) out.instructions = instructions;
  out.input = input;
  if (tools) out.tools = tools;
  if (toolChoice !== undefined && tools) out.tool_choice = toolChoice;
  if (parallel === false && tools) out.parallel_tool_calls = false;
  out.store = false;

  let maxTokens = Number(body.max_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    const cap = Number(caps.maxOutputTokens);
    if (Number.isFinite(cap) && cap > 0 && maxTokens > cap) { maxTokens = cap; warn('max_tokens clamped'); }
    out.max_output_tokens = Math.max(MIN_OUTPUT_TOKENS, Math.floor(maxTokens));
  }
  if (typeof body.temperature === 'number') { if (reasoning) warn('temperature'); else out.temperature = body.temperature; }
  if (typeof body.top_p === 'number') { if (reasoning) warn('top_p'); else out.top_p = body.top_p; }
  if (body.top_k !== undefined) warn('top_k');
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) warn('stop_sequences');   // Responses has no `stop`
  if (body.metadata !== undefined) warn('metadata');
  // context_management (the CLI's thinking-clearing edits) is dropped silently:
  // it rides every turn and has no upstream equivalent.

  // ── reasoning: always ask for the summary and the encrypted reasoning, so
  // every reasoning item can be replayed next turn (§8) ──
  const effort = requestedEffort(body);
  if (reasoning) {
    out.reasoning = { summary: 'auto' };
    if (effort) out.reasoning.effort = mapEffort(effort, caps);
    out.include = ['reasoning.encrypted_content'];
  } else if (effort) warn('thinking');

  if (body.stream === true) out.stream = true;

  return { body: out, warnings };
}
