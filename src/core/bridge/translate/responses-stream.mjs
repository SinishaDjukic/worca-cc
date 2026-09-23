// src/core/bridge/translate/responses-stream.mjs
// OpenAI Responses API -> Anthropic Messages (2026-09-23-bridge-openai-
// responses-design.md §9): the SSE stream state machine and the buffered
// (non-streaming) response. Pure; the same push()/finish() contract as
// ChatStreamTranslator, fed by the same SseDataParser (a Responses stream has
// no [DONE] sentinel — it ends when the connection closes).
//
// Events are correlated by `output_index`, never `item_id`: Copilot rotates
// item_id on every event. Anthropic content blocks are strictly sequential:
// reasoning summary text and output text stream live; a function call is
// emitted whole when its item is done (the done item carries the complete
// arguments). A reasoning item becomes a `thinking` block whose signature is
// the reasoning marker (common.mjs) — or a `redacted_thinking` block when the
// model produced no summary text — so the CLI echoes it back next turn and
// responses-request.mjs replays it as a `reasoning` input item.

import { newMessageId, newToolUseId, parsesAsJson, truncatedToolNote } from './stream.mjs';
import { encodeReasoningMarker } from './common.mjs';
import { isFailedResponseOverflow, PROMPT_TOO_LONG } from '../errors.mjs';

/** Responses usage -> Anthropic usage. */
export function mapResponsesUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const input = Number(u.input_tokens) || 0;
  const cached = Number(u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
  return {
    input_tokens: Math.max(0, input - cached),
    output_tokens: Number(u.output_tokens) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

const errorEvent = (message) => ({ event: 'error', data: { type: 'error', error: { type: 'api_error', message } } });

export class ResponsesStreamTranslator {
  /**
   * @param {{model:string, upstreamModel:string}} opts  the catalog id the CLI
   *   expects back, and the upstream id the reasoning marker names
   */
  constructor({ model, upstreamModel } = {}) {
    this.model = model || 'bridge';
    this.upstreamModel = upstreamModel || '';
    this.id = newMessageId();
    this.started = false;
    this.nextIndex = 0;
    this.open = null;          // the open live block: { outputIndex, kind: 'text'|'thinking', index }
    this.slots = new Map();    // output_index -> { type, callId, name, args, done, thinking, newPart }
    this.toolsEmitted = 0;
    this.emittedAny = false;
    this.terminal = null;      // 'completed' | 'incomplete' | 'failed'
    this.incompleteReason = null;
    this.usage = null;
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

  _slot(i) {
    let s = this.slots.get(i);
    if (!s) {
      s = { type: null, callId: '', name: '', args: '', done: false, thinking: false, newPart: false };
      this.slots.set(i, s);
    }
    return s;
  }

  _close() {
    if (!this.open) return [];
    const { index } = this.open;
    this.open = null;
    return [{ event: 'content_block_stop', data: { type: 'content_block_stop', index } }];
  }

  _isOpen(outputIndex, kind) {
    return !!this.open && this.open.outputIndex === outputIndex && this.open.kind === kind;
  }

  /** Open a live (streamed) block for `outputIndex`, closing whatever is open. */
  _openLive(outputIndex, kind, contentBlock) {
    const out = this._close();
    const index = this.nextIndex++;
    this.open = { outputIndex, kind, index };
    out.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: contentBlock } });
    this.emittedAny = true;
    return out;
  }

  _delta(delta) {
    return { event: 'content_block_delta', data: { type: 'content_block_delta', index: this.open.index, delta } };
  }

  /** A complete block emitted at once: a tool call, a redacted reasoning item, a note. */
  _whole(contentBlock, deltas = []) {
    const out = this._close();
    const index = this.nextIndex++;
    out.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: contentBlock } });
    for (const d of deltas) out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: d } });
    out.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
    this.emittedAny = true;
    return out;
  }

  /**
   * A finished function call: the tool_use block — or, when it was cut off
   * mid-arguments, a note saying so (forwarded, the CLI would reject the
   * unterminated JSON and the model would retry the same oversized call).
   */
  _finishCall(s, { callId, name, args, incomplete }) {
    s.done = true;
    if (incomplete || !parsesAsJson(args)) {
      return this._whole({ type: 'text', text: '' }, [{ type: 'text_delta', text: truncatedToolNote(name || 'tool') }]);
    }
    this.toolsEmitted += 1;
    return this._whole(
      { type: 'tool_use', id: callId || newToolUseId(), name, input: {} },
      [{ type: 'input_json_delta', partial_json: args || '{}' }],
    );
  }

  /**
   * Feed one parsed stream event. Returns the SSE events to write.
   * @param {object} ev
   */
  push(ev) {
    const out = this._start();
    if (!ev || typeof ev !== 'object') return out;
    if (this.terminal === 'failed') return out;   // the error event is the stream's last word
    const i = Number.isInteger(ev.output_index) ? ev.output_index : null;
    // A data line with no type but an `error` (the chat-style mid-stream error) is a failure too.
    const type = ev.type || (ev.error ? 'error' : undefined);
    switch (type) {
      case 'response.output_item.added': {
        if (i === null || !ev.item) break;
        const s = this._slot(i);
        s.type = ev.item.type;
        if (s.type === 'function_call') {
          s.callId = typeof ev.item.call_id === 'string' ? ev.item.call_id : '';
          s.name = typeof ev.item.name === 'string' ? ev.item.name : '';
          if (typeof ev.item.arguments === 'string') s.args = ev.item.arguments;
        }
        break;
      }
      case 'response.reasoning_summary_part.added': {
        if (i !== null && this._slot(i).thinking) this._slot(i).newPart = true;
        break;
      }
      case 'response.reasoning_summary_text.delta': {
        if (i === null || typeof ev.delta !== 'string' || !ev.delta) break;
        const s = this._slot(i);
        if (!this._isOpen(i, 'thinking')) {
          out.push(...this._openLive(i, 'thinking', { type: 'thinking', thinking: '', signature: '' }));
          s.thinking = true;
          s.newPart = false;
        }
        if (s.newPart) {
          out.push(this._delta({ type: 'thinking_delta', thinking: '\n\n' }));
          s.newPart = false;
        }
        out.push(this._delta({ type: 'thinking_delta', thinking: ev.delta }));
        break;
      }
      case 'response.output_text.delta':
      case 'response.refusal.delta': {
        if (i === null || typeof ev.delta !== 'string' || !ev.delta) break;
        if (!this._isOpen(i, 'text')) out.push(...this._openLive(i, 'text', { type: 'text', text: '' }));
        out.push(this._delta({ type: 'text_delta', text: ev.delta }));
        break;
      }
      case 'response.function_call_arguments.delta': {
        if (i !== null && typeof ev.delta === 'string') this._slot(i).args += ev.delta;
        break;
      }
      case 'response.output_item.done': {
        if (i === null || !ev.item) break;
        const s = this._slot(i);
        const item = ev.item;
        if (item.type === 'reasoning') {
          s.done = true;
          const enc = typeof item.encrypted_content === 'string' ? item.encrypted_content : '';
          const marker = enc ? encodeReasoningMarker(this.upstreamModel, enc) : '';
          if (this._isOpen(i, 'thinking')) {
            if (marker) out.push(this._delta({ type: 'signature_delta', signature: marker }));
            out.push(...this._close());
          } else if (marker) {
            // No summary text — or its thinking block was already closed by an
            // interleaved item: a redacted block carries the reasoning on.
            out.push(...this._whole({ type: 'redacted_thinking', data: marker }));
          }
        } else if (item.type === 'message') {
          s.done = true;
          if (this.open && this.open.outputIndex === i) out.push(...this._close());
        } else if (item.type === 'function_call') {
          out.push(...this._finishCall(s, {
            callId: typeof item.call_id === 'string' && item.call_id ? item.call_id : s.callId,
            name: typeof item.name === 'string' && item.name ? item.name : s.name,
            // The done item's arguments are authoritative — unless it came back empty
            // after arguments streamed in (then the streamed ones are the call).
            args: typeof item.arguments === 'string' && item.arguments.trim() ? item.arguments : s.args,
            incomplete: item.status === 'incomplete',
          }));
        }
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        this.terminal = ev.type === 'response.completed' ? 'completed' : 'incomplete';
        const r = ev.response && typeof ev.response === 'object' ? ev.response : {};
        if (r.usage) this.usage = r.usage;
        if (r.incomplete_details && typeof r.incomplete_details.reason === 'string') this.incompleteReason = r.incomplete_details.reason;
        break;
      }
      case 'response.failed':
      case 'error': {
        this.terminal = 'failed';
        const e = type === 'error'
          ? (ev.error && typeof ev.error === 'object' ? ev.error : typeof ev.error === 'string' ? { message: ev.error } : ev)
          : ((ev.response && ev.response.error) || {});
        const msg = (e && (e.message || e.code)) || 'the upstream reported a failure';
        // A context overflow is said in the words the CLI compacts on, as for an HTTP 400 — and
        // only an overflow: a rate limit or a timeout keeps its own words (errors.mjs).
        out.push(...this._close(), isFailedResponseOverflow(e && e.code, e && e.message)
          ? { event: 'error', data: { type: 'error', error: { type: 'invalid_request_error', message: PROMPT_TOO_LONG } } }
          : errorEvent(`upstream stream error: ${msg}`));
        break;
      }
      default:
        break;   // created, in_progress, content_part.*, *.done text events, copilot_usage lines …
    }
    return out;
  }

  /** End of stream: close blocks, settle unfinished calls, emit message_delta + message_stop. */
  finish() {
    const out = this._start();
    if (this.terminal === 'failed') return out;   // the error event is already out
    out.push(...this._close());
    // Function calls whose item never finished (a cut stream, an incomplete response).
    for (const [, s] of [...this.slots.entries()].sort((a, b) => a[0] - b[0])) {
      if (s.type !== 'function_call' || s.done) continue;
      out.push(...this._finishCall(s, { callId: s.callId, name: s.name, args: s.args, incomplete: !s.args.trim() }));
    }
    let stop;
    if (this.terminal === 'incomplete') stop = this.incompleteReason === 'max_output_tokens' ? 'max_tokens' : 'end_turn';
    else if (this.terminal === 'completed') stop = 'end_turn';
    else stop = this.emittedAny ? 'end_turn' : null;
    if (stop === null) {
      out.push(errorEvent('upstream stream ended without content or a terminal event'));
      return out;
    }
    if (this.toolsEmitted && stop === 'end_turn') stop = 'tool_use';
    out.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: mapResponsesUsage(this.usage) } });
    out.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return out;
  }
}

/**
 * A buffered (non-streaming) Responses API body -> Anthropic message object.
 * @param {object} resp  the upstream JSON body
 * @param {{model:string, upstreamModel:string}} opts
 */
export function toMessagesResponseFromResponses(resp, { model, upstreamModel } = {}) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const content = [];
  let tools = 0;
  for (const item of Array.isArray(r.output) ? r.output : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'reasoning') {
      const text = (Array.isArray(item.summary) ? item.summary : [])
        .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n\n');
      const marker = typeof item.encrypted_content === 'string' && item.encrypted_content
        ? encodeReasoningMarker(upstreamModel || '', item.encrypted_content) : '';
      if (text) content.push({ type: 'thinking', thinking: text, signature: marker });
      else if (marker) content.push({ type: 'redacted_thinking', data: marker });
    } else if (item.type === 'message') {
      const text = (Array.isArray(item.content) ? item.content : [])
        .map((c) => {
          if (!c || typeof c !== 'object') return '';
          if (c.type === 'output_text' && typeof c.text === 'string') return c.text;
          if (c.type === 'refusal' && typeof c.refusal === 'string') return c.refusal;
          return '';
        })
        .join('');
      if (text) content.push({ type: 'text', text });
    } else if (item.type === 'function_call') {
      const name = String(item.name || '');
      const args = typeof item.arguments === 'string' ? item.arguments : '';
      if (item.status === 'incomplete' || !parsesAsJson(args)) {
        content.push({ type: 'text', text: truncatedToolNote(name || 'tool') });
        continue;
      }
      let input = {};
      if (args.trim()) { try { input = JSON.parse(args); } catch { input = { _raw: args }; } }
      content.push({ type: 'tool_use', id: item.call_id || newToolUseId(), name, input });
      tools += 1;
    }
  }
  let stop = r.status === 'incomplete' && r.incomplete_details && r.incomplete_details.reason === 'max_output_tokens'
    ? 'max_tokens' : 'end_turn';
  if (tools && stop === 'end_turn') stop = 'tool_use';
  return {
    id: newMessageId(),
    type: 'message',
    role: 'assistant',
    model: model || 'bridge',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: mapResponsesUsage(r.usage),
  };
}
