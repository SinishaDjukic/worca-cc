// src/core/engines/claude-events.mjs
// The ONE place Claude Code's stream-json frame shapes are spelled for consumers:
// a legacy runner envelope {type, raw, text?, costUsd?} in, normalized events out.
// Stateful per stream: it remembers main-stream Task/Agent ids (to turn their
// tool_results into sub-agent lifecycle) and the current message id per parent
// (to stamp stream deltas).
import { isNormalized } from './events.mjs';
import { extractResultCost, isHookEvent } from './claude.mjs';

const AGENT_TOOLS = new Set(['Task', 'Agent']);
const str = (v) => (typeof v === 'string' ? v : undefined);
const num = (v) => (Number.isFinite(v) ? v : undefined);
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('') : '');

export function createClaudeNormalizer() {
  const agents = new Set();
  const messageIds = new Map();

  function assistant(raw, parentId, e) {
    const msg = raw.message && typeof raw.message === 'object' ? raw.message : {};
    const messageId = str(msg.id);
    const content = Array.isArray(msg.content) ? msg.content : [];
    const out = [];
    const calls = [];
    for (const c of content) {
      if (c?.type !== 'tool_use' || typeof c.name !== 'string') continue;
      calls.push({ name: c.name, input: c.input, toolUseId: c.id });
      if (parentId === null && AGENT_TOOLS.has(c.name) && c.id && !agents.has(c.id)) {
        agents.add(c.id);
        const input = c.input && typeof c.input === 'object' ? c.input : {};
        out.push(defined({ type: 'subagent', event: 'spawn', toolUseId: c.id, name: c.name,
          label: str(input.description) || str(input.prompt), description: str(input.description),
          subagentType: str(input.subagent_type), model: str(input.model) }));
      }
    }
    const blocks = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text);
    const text = typeof e.text === 'string' ? e.text : blocks.join('');
    // A `<synthetic>` message is the CLI speaking for itself (the API-refusal line it
    // fabricates when a call fails), not the model: its text is `from:'cli'`, and its
    // all-zero usage is no model call, so it emits none.
    const synthetic = msg.model === '<synthetic>';
    if (text) out.push(defined({ type: 'text', text, parentId, from: synthetic ? 'cli' : 'assistant', blocks, messageId }));
    if (!synthetic && msg.usage && typeof msg.usage === 'object') out.push({ type: 'usage', messageId: messageId ?? null, parentId, usage: msg.usage, phase: 'message' });
    if (calls.length) out.push(defined({ type: 'tool', parentId, messageId, calls }));
    return out;
  }

  function user(raw, parentId, e) {
    const content = Array.isArray(raw.message?.content) ? raw.message.content : [];
    const tur = raw.tool_use_result;
    const meta = tur && typeof tur === 'object' && !Array.isArray(tur) ? tur : null;
    const isAck = !!meta && (meta.isAsync === true || meta.status === 'async_launched');
    const out = [];
    const results = [];
    for (const b of content) {
      if (b?.type !== 'tool_result') continue;
      const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : null;
      results.push({ toolUseId, isError: !!b.is_error, text: textOf(b.content), content: b.content });
      if (parentId !== null || !toolUseId || !agents.has(toolUseId)) continue;
      if (isAck) { out.push(defined({ type: 'subagent', event: 'ack', toolUseId: b.tool_use_id, resolvedModel: str(meta.resolvedModel) })); continue; }
      out.push(defined({ type: 'subagent', event: b.is_error ? 'error' : 'finish', toolUseId: b.tool_use_id,
        durationMs: num(meta?.totalDurationMs), tokens: num(meta?.totalTokens), resolvedModel: str(meta?.resolvedModel),
        agentType: str(meta?.agentType), usage: meta?.usage && typeof meta.usage === 'object' ? meta.usage : undefined,
        errorText: b.is_error ? textOf(b.content) : undefined }));
    }
    const blocks = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text);
    const text = typeof e.text === 'string' && e.text ? e.text : blocks.join('');
    if (text) out.push({ type: 'text', text, parentId, from: 'user', blocks });
    if (results.length) out.push({ type: 'toolResult', parentId, meta, results });
    return out;
  }

  function streamEvent(raw, parentId) {
    const ev = raw.event;
    if (!ev || typeof ev !== 'object') return [];
    const key = parentId ?? '(main)';
    if (ev.type === 'message_start') {
      const id = str(ev.message?.id) ?? null;
      messageIds.set(key, id);
      return [{ type: 'usage', messageId: id, parentId, usage: ev.message?.usage ?? null, phase: 'start' }];
    }
    if (ev.type === 'message_delta') return [{ type: 'usage', messageId: messageIds.get(key) ?? null, parentId, usage: ev.usage ?? null, phase: 'delta' }];
    if (parentId === null && ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
      return [defined({ type: 'text', text: ev.delta.text, parentId, from: 'assistant', delta: true, messageId: messageIds.get(key) ?? undefined })];
    }
    return [];
  }

  function result(raw, e) {
    const costUsd = e.costUsd != null ? Number(e.costUsd) : extractResultCost(raw);
    return [defined({
      type: 'result',
      text: typeof raw.result === 'string' ? raw.result : (e.text || ''),
      costUsd: costUsd != null && Number.isFinite(costUsd) ? costUsd : undefined,
      usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : undefined,
      subtype: str(raw.subtype),
      isError: !!raw.is_error,
      terminalReason: str(raw.terminal_reason),
      numTurns: num(raw.num_turns),
      durationMs: num(raw.duration_ms),
      sessionId: str(raw.session_id),
      errors: Array.isArray(raw.errors) ? raw.errors.map(String) : undefined,
      modelUsage: raw.modelUsage && typeof raw.modelUsage === 'object' ? raw.modelUsage : undefined,
    })];
  }

  return function normalize(e) {
    if (!e || typeof e !== 'object') return [];
    if (isNormalized(e)) return [e];
    if (e.type === 'hook-event') return [{ type: 'hook', raw: e.raw }];
    // A non-JSON runner line: `raw` is the line itself. Any other envelope is
    // decided by its frame, whatever `type` the envelope says.
    if (e.type === 'log' && (!e.raw || typeof e.raw !== 'object')) return e.text ? [{ type: 'log', text: e.text }] : [];
    if (e.type === 'stderr') return [{ type: 'stderr', stream: 'err', text: e.text }];
    const raw = e.raw;
    if (!raw || typeof raw !== 'object') return e.text ? [{ type: 'text', text: e.text, parentId: null, from: 'assistant' }] : [];
    if (raw.mock === true && raw.type !== 'result') return e.text ? [{ type: 'text', text: e.text, parentId: null, from: 'assistant' }] : [];
    const parentId = raw.parent_tool_use_id ?? raw.message?.parent_tool_use_id ?? null;
    if (isHookEvent(raw)) return [{ type: 'hook', raw }];
    // Text on a frame this vocabulary has no shape for is still worth a log line;
    // `from:'other'` keeps it out of an Ask Worca answer.
    const otherText = () => (e.text ? [{ type: 'text', text: e.text, parentId, from: 'other' }] : []);
    switch (raw.type) {
      case 'system':
        if (raw.subtype === 'init') {
          // model stays null when absent: the harness logs `[init] model=?` for it, as today.
          // mcpServers: the CLI's MCP server list ([{name, status}], verbatim), main stream only;
          // absent when the frame carries none (which says nothing about the servers).
          return [{ type: 'session', sessionId: str(raw.session_id) ?? null, model: str(raw.model) ?? null, init: true,
            ...(parentId === null && Array.isArray(raw.mcp_servers) ? { mcpServers: raw.mcp_servers } : {}) }];
        }
        if (raw.subtype === 'task_notification' && typeof raw.tool_use_id === 'string') {
          const u = raw.usage && typeof raw.usage === 'object' && !Array.isArray(raw.usage) ? raw.usage : {};
          return [defined({ type: 'subagent', event: raw.status === 'completed' ? 'finish' : 'error', toolUseId: raw.tool_use_id,
            durationMs: num(Number(u.duration_ms)), tokens: num(Number(u.total_tokens)), via: 'notification' })];
        }
        if (raw.subtype === 'api_retry') {
          // CLI 2.1.281: {attempt, max_retries, retry_delay_ms, error_status: number|null,
          // error: category string, no_response?: {waited_ms}}.
          return [defined({ type: 'retry', parentId, attempt: num(raw.attempt), maxRetries: num(raw.max_retries),
            delayMs: num(raw.retry_delay_ms), httpStatus: Number.isFinite(raw.error_status) ? raw.error_status : null,
            reason: str(raw.error) || 'unknown', waitedMs: num(raw.no_response?.waited_ms) })];
        }
        return otherText();
      case 'assistant': return assistant(raw, parentId, e);
      case 'user': return user(raw, parentId, e);
      case 'stream_event': return streamEvent(raw, parentId);
      case 'result': return result(raw, e);
      default: return otherText();
    }
  };
}

/** Wrap a consumer so it only ever sees normalized events (one normalizer per wrapper = per stream). */
export function normalizingOnEvent(onEvent) {
  const normalize = createClaudeNormalizer();
  return (e) => { for (const n of normalize(e)) onEvent(n); };
}
