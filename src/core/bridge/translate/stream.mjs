// src/core/bridge/translate/stream.mjs
// OpenAI chat/completions stream chunks -> Anthropic Messages SSE events
// (model-bridge-design.md §5.4/§5.5/§5.8). Pure state machine: feed parsed
// chunk objects to `push`, call `finish` at end of stream; both return the
// events to write, as `{event, data}` pairs. `serializeSse` renders them.
//
// Text streams live, one content block per contiguous run. Tool calls are
// BUFFERED per tool_calls index and emitted as a complete block when the next
// tool call (or text) begins, and at finish: Anthropic blocks are strictly
// sequential and cannot be reopened, while upstreams may (rarely) interleave
// argument deltas across indexes — buffering makes that case correct at the
// cost of a tool block appearing a moment later than its first delta.

import { randomBytes } from 'node:crypto';
import { CHAT_REASONING_SIGNATURE, chatReasoningText } from './common.mjs';

/** finish_reason -> stop_reason (§5.5). */
export function mapStopReason(finish, { emitted = false } = {}) {
  switch (finish) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    case 'content_filter': return 'end_turn';
    default: return emitted ? 'end_turn' : null;
  }
}

/** The overloaded_error a turn with no visible output becomes (ChatStreamTranslator#finish). */
export const EMPTY_TURN_MESSAGE = 'upstream returned no output (no text or tool call) — an upstream glitch; retrying';

/** chat/completions usage -> Anthropic usage (§5.8). */
export function mapUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const prompt = Number(u.prompt_tokens) || 0;
  const cached = Number(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: Number(u.completion_tokens) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

/** Whether a tool call's accumulated arguments are complete JSON ('' = no args). */
export function parsesAsJson(s) {
  if (typeof s !== 'string' || !s.trim()) return true;
  try { JSON.parse(s); return true; } catch { return false; }
}

/** The text that replaces a tool call cut off by finish_reason `length`. */
export function truncatedToolNote(name) {
  return `[bridge: the ${name} call was cut off by the model's output or context limit before its arguments were complete, so it was not run. Split the work into smaller steps — e.g. write a large file in several shorter parts.]`;
}

export function newMessageId() { return `msg_bridge_${randomBytes(12).toString('hex')}`; }
export function newToolUseId() { return `toolu_bridge_${randomBytes(12).toString('hex')}`; }

export class ChatStreamTranslator {
  /** @param {{model:string}} opts  the model name the CLI expects back (catalog id) */
  constructor({ model } = {}) {
    this.model = model || 'bridge';
    this.id = newMessageId();
    this.started = false;
    this.nextIndex = 0;
    this.textIndex = null;          // open text block index, or null
    this.thinkIndex = null;         // open thinking block index, or null
    this.tools = new Map();         // tool_calls index -> {id, name, args, order}
    this.toolOrder = [];
    this.flushedTools = 0;          // how many of toolOrder have been emitted
    this.finishReason = null;
    this.usage = null;
    this.costUsd = null;            // the upstream's own USD cost (OpenRouter usage.cost), when reported
    this.emittedAny = false;
    this.sawText = false;           // any visible text (thinking is not visible output)
    this.contentFilter = false;
  }

  _start() {
    if (this.started) return [];
    this.started = true;
    return [{
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: this.id, type: 'message', role: 'assistant', model: this.model, content: [],
          stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      },
    }];
  }

  _closeText() {
    if (this.textIndex === null) return [];
    const i = this.textIndex;
    this.textIndex = null;
    return [{ event: 'content_block_stop', data: { type: 'content_block_stop', index: i } }];
  }

  /** Close the open thinking block, signing it as ours (common.mjs#CHAT_REASONING_SIGNATURE). */
  _closeThinking() {
    if (this.thinkIndex === null) return [];
    const index = this.thinkIndex;
    this.thinkIndex = null;
    return [
      { event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: CHAT_REASONING_SIGNATURE } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    ];
  }

  /** Emit every buffered tool call not yet emitted (in first-seen order). */
  _flushTools(upTo = this.toolOrder.length) {
    const out = [];
    while (this.flushedTools < upTo) {
      const key = this.toolOrder[this.flushedTools++];
      const t = this.tools.get(key);
      const index = this.nextIndex++;
      out.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } } });
      out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: t.args || '{}' } } });
      out.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
      this.emittedAny = true;
    }
    return out;
  }

  /**
   * Feed one parsed chunk object. Returns the SSE events to write.
   * @param {object} chunk
   */
  push(chunk) {
    const out = this._start();
    if (!chunk || typeof chunk !== 'object') return out;
    if (chunk.error) {
      const msg = typeof chunk.error === 'string' ? chunk.error : (chunk.error.message || JSON.stringify(chunk.error));
      out.push({ event: 'error', data: { type: 'error', error: { type: 'api_error', message: `upstream stream error: ${msg}` } } });
      return out;
    }
    if (chunk.usage && typeof chunk.usage === 'object') {
      this.usage = chunk.usage;
      const cost = Number(chunk.usage.cost);
      if (chunk.usage.cost != null && Number.isFinite(cost) && cost >= 0) this.costUsd = cost;
    }
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    if (!choice) return out;
    const delta = choice.delta || {};

    // Reasoning streams first on a reasoning model; one live thinking block per
    // contiguous run, closed before any text or tool block starts.
    const reasoning = chatReasoningText(delta);
    if (reasoning) {
      if (this.thinkIndex === null) {
        out.push(...this._closeText());
        if (this.toolOrder.length > this.flushedTools) out.push(...this._flushTools());
        this.thinkIndex = this.nextIndex++;
        out.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.thinkIndex, content_block: { type: 'thinking', thinking: '', signature: '' } } });
      }
      out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.thinkIndex, delta: { type: 'thinking_delta', thinking: reasoning } } });
      this.emittedAny = true;
    }

    if (typeof delta.content === 'string' && delta.content.length) {
      out.push(...this._closeThinking());
      // Text after tool calls: the tools are complete — flush them first.
      if (this.toolOrder.length > this.flushedTools) { out.push(...this._closeText(), ...this._flushTools()); }
      if (this.textIndex === null) {
        this.textIndex = this.nextIndex++;
        out.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.textIndex, content_block: { type: 'text', text: '' } } });
      }
      out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.textIndex, delta: { type: 'text_delta', text: delta.content } } });
      this.emittedAny = true;
      this.sawText = true;
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (!tc || typeof tc !== 'object') continue;
        const key = Number.isInteger(tc.index) ? tc.index : (tc.id || this.toolOrder.length);
        let t = this.tools.get(key);
        if (!t) {
          // A new tool call: text before it is complete; earlier tool calls are complete.
          out.push(...this._closeThinking(), ...this._closeText());
          out.push(...this._flushTools());
          t = { id: tc.id || newToolUseId(), name: '', args: '' };
          this.tools.set(key, t);
          this.toolOrder.push(key);
        } else if (tc.id && !t.id) t.id = tc.id;
        const fn = tc.function || {};
        if (typeof fn.name === 'string' && fn.name) t.name = t.name ? t.name : fn.name;
        if (typeof fn.arguments === 'string') t.args += fn.arguments;
      }
    }

    if (choice.finish_reason) {
      this.finishReason = choice.finish_reason;
      if (choice.finish_reason === 'content_filter') this.contentFilter = true;
    }
    return out;
  }

  /** End of stream: close blocks, emit message_delta + message_stop. */
  finish() {
    const out = this._start();
    out.push(...this._closeThinking());
    // Cut off mid tool call (finish_reason `length` — the output cap, or on a
    // small local model the context window filling up): the last call's
    // arguments are unterminated JSON. Forwarded, the CLI rejects it as an
    // InputValidationError and the model retries the same oversized call; so
    // drop it and say why, and the CLI's max_tokens recovery asks for smaller
    // steps. Earlier calls were complete when the next one began.
    let truncated = null;
    if (this.finishReason === 'length' && this.toolOrder.length > this.flushedTools) {
      const key = this.toolOrder[this.toolOrder.length - 1];
      const t = this.tools.get(key);
      if (!parsesAsJson(t.args)) {
        this.toolOrder.pop();
        this.tools.delete(key);
        truncated = t.name || 'tool';
      }
    }
    out.push(...this._flushTools());
    if (truncated) {
      if (this.textIndex === null) {
        this.textIndex = this.nextIndex++;
        out.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.textIndex, content_block: { type: 'text', text: '' } } });
      }
      out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.textIndex, delta: { type: 'text_delta', text: truncatedToolNote(truncated) } } });
      this.emittedAny = true;
    }
    out.push(...this._closeText());
    const hadTools = this.toolOrder.length > 0;
    let stop = mapStopReason(this.finishReason, { emitted: this.emittedAny });
    // No text and no tool call — nothing at all, or reasoning only — on a turn
    // that ended normally or not at all: an upstream glitch (OpenRouter's free
    // Nvidia endpoint does it intermittently). Forwarded as an empty turn the CLI
    // nudges "no visible output" and exits with no cause; as overloaded_error it
    // retries with backoff, and a run that still fails names the reason. A length
    // cut and a content filter keep their stop reasons: those are the model's.
    const visible = hadTools || this.sawText;
    if (stop === null || (!visible && (this.finishReason === 'stop' || this.finishReason == null))) {
      out.push({ event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: EMPTY_TURN_MESSAGE } } });
      return out;
    }
    if (hadTools && stop === 'end_turn') stop = 'tool_use';
    out.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: mapUsage(this.usage) } });
    out.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return out;
  }
}

/** Render `{event, data}` pairs as SSE text. */
export function serializeSse(events) {
  let s = '';
  for (const e of events) s += `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
  return s;
}

/**
 * Incremental SSE `data:` parser for an upstream chat stream. Feed text
 * chunks; get back the parsed JSON objects (the `[DONE]` sentinel ends the
 * stream and sets `done`). Non-JSON data lines are skipped.
 */
export class SseDataParser {
  constructor() { this.buf = ''; this.done = false; }
  /** @param {string} text  @returns {object[]} */
  feed(text) {
    if (this.done) return [];
    this.buf += text;
    const out = [];
    let idx;
    while ((idx = this.buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') { this.done = true; break; }
      try { out.push(JSON.parse(data)); } catch { /* skip non-JSON */ }
    }
    return out;
  }
  /** Drain a trailing event with no terminating blank line. */
  end() {
    if (this.done || !this.buf.trim()) return [];
    const rest = this.buf; this.buf = '';
    return this.feed(`${rest}\n\n`);
  }
}
