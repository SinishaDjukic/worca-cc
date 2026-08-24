// src/core/ask/events.mjs
// The Ask Worca stream reducer (ask-worca-design.md §6.6): claude's stream-json
// frames (as forwarded by claude-runner.mjs onEvent: {type, raw}) → bare `ask-*`
// job frames + the turn Summary. Pure: time, timers, redaction and the proposal
// hook are injected. It NEVER emits ask-start/ask-done/ask-error (turn.mjs does)
// and never throws from push().
//
// Probed shapes (claude 2.1.239, 2026-08-22) this code relies on:
//  - text deltas: stream_event/content_block_delta{delta.type:'text_delta'} on the
//    MAIN stream only (parent_tool_use_id == null); the `assistant` text block of
//    the same message.id is authoritative; messages join with '\n\n'.
//  - usage: `assistant` frames repeat the message-START usage once per content
//    block (never sum); message_delta.usage is the per-call figure; result wins.
//  - tools: tool_use{id,name,input} ↔ user.tool_result{tool_use_id,content,is_error};
//    content is a string (errors) or [{type:'text',text}] (successes).
//  - sub-agents: the block is named 'Agent' (or 'Task'); child frames carry
//    parent_tool_use_id; the finishing parent tool_result carries the agent
//    object in raw.tool_use_result ({agentId, agentType, resolvedModel,
//    totalDurationMs, totalTokens, usage}) — or {isAsync:true} when claude ran it
//    in the background (spawn.mjs sets CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 to
//    avoid that; the reducer still tolerates it). Per-agent cost is an ESTIMATE.
//  - result: subtype error_max_turns / error_max_budget_usd ⇒ stopped; the CLI
//    exits 1 on those, so turn.mjs reads snapshot().resultSubtype on rejection.
//    The LAST result wins (two arrive in background mode).
import { redactAskText } from './redact.mjs';
import { ASK_LIMITS } from './limits.mjs';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ZERO = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const add = (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreation: a.cacheCreation + b.cacheCreation });
const weight = (u) => u.input + 1.25 * u.cacheCreation + 0.1 * u.cacheRead + 5 * u.output;
const clone = (v) => JSON.parse(JSON.stringify(v));
const short = (name) => String(name ?? '').replace(/^mcp__worca__/, '');
const isAgentTool = (name) => name === 'Task' || name === 'Agent';
// The three write tools whose success must reach the browser. The reducer runs in
// the PARENT process, so this is the only place a child-process write becomes a
// broadcast (the MCP server cannot call broadcast()).
const COMMENT_WRITE_TOOLS = new Set([
  'mcp__worca__add_diff_comment', 'mcp__worca__resolve_diff_comment', 'mcp__worca__delete_diff_comment',
]);

/** claude's usage object → the persisted shape. */
export function normalizeUsage(u) {
  return {
    input: num(u?.input_tokens),
    output: num(u?.output_tokens),
    cacheRead: num(u?.cache_read_input_tokens),
    cacheCreation: num(u?.cache_creation_input_tokens),
  };
}

/** result.modelUsage key for an agent's model: exact → canonicalModel → stripped -YYYYMMDD → the single key. */
export function matchModelKey(model, modelUsage) {
  const mu = modelUsage && typeof modelUsage === 'object' ? modelUsage : {};
  const keys = Object.keys(mu);
  if (!keys.length) return null;
  const m = String(model ?? '').trim().toLowerCase();
  if (m) {
    const exact = keys.find((k) => k.toLowerCase() === m);
    if (exact) return exact;
    const canon = keys.find((k) => String(mu[k]?.canonicalModel ?? '').toLowerCase() === m);
    if (canon) return canon;
    const strip = (s) => s.replace(/-\d{8}$/, '');
    const stripped = keys.find((k) => strip(k.toLowerCase()) === strip(m) && !/-\d{8}$/.test(k))   // prefer the un-dated twin
      || keys.find((k) => strip(k.toLowerCase()) === strip(m));
    if (stripped) return stripped;
  }
  return keys.length === 1 ? keys[0] : null;
}

/** Spec §6.6: costUSD × w(agent) / w(model total), clamped; null without usage or a matching model. Always estimated:true. */
export function estimateAgentCosts(agents, result) {
  const mu = result?.modelUsage && typeof result.modelUsage === 'object' ? result.modelUsage : {};
  return agents.map((a) => {
    if (!a.usage) return { ...a, costUsd: null, estimated: true };
    let key = matchModelKey(a.model, mu);
    let entry = key ? mu[key] : null;
    const totalOf = (e) => weight({ input: num(e.inputTokens), output: num(e.outputTokens), cacheRead: num(e.cacheReadInputTokens), cacheCreation: num(e.cacheCreationInputTokens) });
    const dated = (k) => /-\d{8}$/.test(k);
    if (entry && dated(key) && weight(a.usage) > totalOf(entry)) {
      // A DATED key is the CLI's own `ai-title` side call (probe F12, ≈ 900 tokens): an agent that used more than
      // that whole entry cannot have run there — switch to the un-dated canonical twin before clamping. Never the
      // other way round (an un-dated key that is exceeded is simply clamped).
      const twin = Object.keys(mu).find((k) => k !== key && !dated(k) && mu[k] && mu[k].canonicalModel === entry.canonicalModel);
      if (twin) { key = twin; entry = mu[twin]; }
    }
    if (!entry || typeof entry.costUSD !== 'number' || !Number.isFinite(entry.costUSD)) return { ...a, costUsd: null, estimated: true };
    const total = totalOf(entry);
    if (!(total > 0)) return { ...a, costUsd: null, estimated: true };
    const share = Math.min(entry.costUSD, (entry.costUSD * weight(a.usage)) / total);
    return { ...a, costUsd: Math.round(share * 1e6) / 1e6, estimated: true };
  });
}

/** The activity label for a main-stream tool call (null for sub-agent spawns — those are counted). */
export function labelForTool(name, input = {}, attachmentNames = {}) {
  if (isAgentTool(name)) return null;
  const n = short(name);
  const id = typeof input?.id === 'string' ? input.id : '';
  switch (n) {
    case 'list_runs': return 'Finding runs';
    case 'get_run':
    case 'get_run_diff': return id ? `Reading run ${id.slice(0, 12)}` : 'Reading run';
    case 'list_workflows': return 'Looking at workflows';
    case 'list_projects': return 'Looking at projects';
    case 'propose_run': return 'Preparing a run';
    case 'read_attachment': return `Reading ${(attachmentNames && attachmentNames[id]) || 'attachment'}`;
    case 'list_diff_comments': return id ? `Reading comments on ${id.slice(0, 12)}` : 'Reading diff comments';
    case 'add_diff_comment': return 'Writing a diff comment';
    case 'resolve_diff_comment': return 'Updating a diff comment';
    case 'delete_diff_comment': return 'Deleting a diff comment';
    default: return `Using ${n}`;
  }
}

const resultText = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
  return '';
};

/**
 * @param {object} o
 * @param {(frame:object)=>void} o.onFrame
 * @param {(s:string)=>string} [o.redact]
 * @param {()=>number} [o.now]
 * @param {Function} [o.setTimeout]  (fn, ms) => id
 * @param {Function} [o.clearTimeout]
 * @param {(p:{toolUseId:string, input:object, childOk:boolean|null})=>void} [o.onProposal]
 * @param {(p:{runId:string})=>void} [o.onCommentMutation]  a successful MCP-side comment write
 * @param {Record<string,string>} [o.attachmentNames]  id → display name (labels only)
 * @param {object} [o.limits]
 */
export function createTurnReducer({
  onFrame,
  redact = redactAskText,
  now = Date.now,
  setTimeout: setT = globalThis.setTimeout,
  clearTimeout: clearT = globalThis.clearTimeout,
  onProposal = null,
  onCommentMutation = null,
  attachmentNames = {},
  limits = ASK_LIMITS,
} = {}) {
  const startedAt = now();
  const emit = (type, payload) => { try { onFrame({ type, ...payload }); } catch { /* a UI/WS failure never breaks the stream */ } };

  // ── state ──
  const messages = new Map();      // main-stream message id → { deltas, blocks } (insertion order)
  const streams = new Map();       // stream key ('main' | parent tool id) → { messageId }
  let currentMainMsg = null;
  const usageByMsg = new Map();    // message id → { usage, final }
  let lastMainUsageMsg = null;     // the LAST main message with usage — its per-call total is the context fill
  let pending = '';
  let timer = null;
  const blocks = [];               // persisted blocks in insertion order
  const byId = new Map();          // block id → block (tool / agent / card)
  const startAt = new Map();       // tool or agent id → spawn time
  const fullInputs = new Map();    // tool id → unclipped input (the proposal hook needs it)
  const childTools = new Map();    // child tool id → { agentId, t0 }
  const labels = [];
  let lastLabel = null;
  let anyToolRan = false;
  let runningAgents = 0;
  let sawInit = false;
  let sawAssistant = false;
  let sawResult = false;
  let sessionId = null;
  let lastResult = null;
  let reducerErrors = 0;
  let summary = null;
  const pendingHooks = [];         // promises returned by onProposal — settle() awaits them

  // ── helpers ──
  const label = (l) => { if (!l || l === lastLabel) return; lastLabel = l; labels.push(l); emit('ask-label', { label: l }); };
  const agentsLabel = () => (runningAgents > 0 ? `Running ${runningAgents} sub-agent${runningAgents === 1 ? '' : 's'}` : 'Thinking');
  const clipStr = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const safeJson = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
  const clipJson = (v, max) => { const s = safeJson(v); return s.length <= max ? v : { _truncated: true, preview: s.slice(0, max) }; };
  const msgEntry = (id) => { let e = messages.get(id); if (!e) { e = { deltas: '', blocks: [] }; messages.set(id, e); } return e; };
  const messageText = (e) => (e.blocks.length ? e.blocks.join('') : e.deltas);
  const mainText = () => [...messages.values()].map(messageText).filter(Boolean).join('\n\n');
  const usageSum = () => [...usageByMsg.values()].reduce((acc, { usage }) => add(acc, usage), ZERO());
  // A message that never receives a message_delta (killed mid-call) is counted at its message-START usage — an under-count, accepted.
  const noteUsage = (messageId, raw, final, main = false) => {
    if (!messageId || !raw || typeof raw !== 'object') return;
    const cur = usageByMsg.get(messageId);
    if (cur && cur.final && !final) return;
    usageByMsg.set(messageId, { usage: normalizeUsage(raw), final: !!final });
    if (main) lastMainUsageMsg = messageId;
  };
  const ctxOf = (u) => u.input + u.output + u.cacheRead + u.cacheCreation;
  // Context fill = the last MAIN call's per-call total. The cumulative result
  // usage never feeds it — a result would report the whole turn, not one call.
  const ctxNow = () => { const e = lastMainUsageMsg ? usageByMsg.get(lastMainUsageMsg) : null; return e ? ctxOf(e.usage) : null; };
  const currentUsage = () => ({ ...(lastResult && lastResult.usage ? normalizeUsage(lastResult.usage) : usageSum()), ctx: ctxNow() });
  const currentCost = () => (lastResult && typeof lastResult.total_cost_usd === 'number' && Number.isFinite(lastResult.total_cost_usd) ? lastResult.total_cost_usd : null);
  const emitUsage = () => emit('ask-usage', { usage: currentUsage(), costUsd: currentCost() });
  const flushDeltas = () => {
    if (timer !== null) { clearT(timer); timer = null; }
    if (!pending) return;
    const text = redact(pending);
    pending = '';
    if (text) emit('ask-delta', { text });
  };
  const queueDelta = (t) => {
    pending += t;
    if (pending.length >= limits.deltaBatchChars) { flushDeltas(); return; }
    if (timer !== null) return;
    const id = setT(flushDeltas, limits.deltaBatchMs);
    if (pending) timer = id;                                              // a synchronous timer stub already flushed: keep no stale id
    else clearT(id);
  };
  const upsertBlock = (block) => {
    if (block.id !== undefined && block.id !== null) byId.set(block.id, block);
    if (!blocks.includes(block)) blocks.push(block);
    emit(block.kind === 'card' ? 'ask-card' : 'ask-block', { block: clone(block) });
  };
  const appendLog = (agent, text) => {
    const max = limits.agentLogMaxLines;
    if (agent.log.length >= max) return;
    const t = Math.max(0, now() - (startAt.get(agent.id) ?? startedAt));
    agent.log.push(agent.log.length === max - 1 ? { t, text: '… more lines omitted' } : { t, text: redact(text) });
    upsertBlock(agent);
  };
  const elapsed = (id) => { const t0 = startAt.get(id); return t0 === undefined ? null : Math.max(0, now() - t0); };

  // ── handlers ──
  function onStreamEvent(raw, ptu, isMain) {
    const e = raw.event;
    if (!e || typeof e !== 'object') return;
    const key = ptu ?? 'main';
    if (e.type === 'message_start') {
      const id = e.message && typeof e.message.id === 'string' ? e.message.id : null;
      streams.set(key, { messageId: id });
      if (isMain) { sawAssistant = true; currentMainMsg = id; if (id) msgEntry(id); noteUsage(id, e.message?.usage, false, true); }
      return;
    }
    if (e.type === 'message_delta') {
      noteUsage(streams.get(key)?.messageId, e.usage, true, isMain);
      if (isMain) { emitUsage(); return; }
      const agent = byId.get(ptu);
      if (agent && agent.kind === 'agent' && e.usage && typeof e.usage === 'object') {
        agent.ctx = ctxOf(normalizeUsage(e.usage));                       // the child's per-call total; last call wins
        upsertBlock(agent);
      }
      return;
    }
    if (!isMain) return;                                                  // child deltas never become the answer
    if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && typeof e.delta.text === 'string') {
      const id = currentMainMsg ?? '__main__';
      const entry = msgEntry(id);
      const first = !entry.deltas && !entry.blocks.length;
      if (first && [...messages.values()].some((x) => x !== entry && messageText(x))) queueDelta('\n\n');
      entry.deltas += e.delta.text;
      if (anyToolRan) label('Writing');
      queueDelta(e.delta.text);
    }
  }

  function onAssistant(raw, ptu, isMain) {
    const msg = raw.message && typeof raw.message === 'object' ? raw.message : {};
    const id = typeof msg.id === 'string' ? msg.id : null;
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (isMain) {
      sawAssistant = true;
      if (id) {
        if (messages.has('__main__') && !messages.has(id)) {              // deltas arrived before any message_start: adopt them
          messages.set(id, messages.get('__main__'));
          messages.delete('__main__');
          currentMainMsg = id;
        }
        const entry = msgEntry(id);
        noteUsage(id, msg.usage, false, true);
        for (const c of content) if (c && c.type === 'text' && typeof c.text === 'string') entry.blocks.push(c.text);
      }
    }
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || typeof c.id !== 'string') continue;
      const input = c.input && typeof c.input === 'object' ? c.input : {};
      if (isMain) {
        anyToolRan = true;
        startAt.set(c.id, now());
        if (isAgentTool(c.name)) {
          runningAgents += 1;
          label(agentsLabel());                                           // label first, then the block (the client shows both)
          upsertBlock({ kind: 'agent', id: c.id, label: clipStr(input.description || input.subagent_type || c.name, 80), type: typeof input.subagent_type === 'string' ? input.subagent_type : null,
            model: typeof input.model === 'string' ? input.model : null, tokens: null, ctx: null, usage: null, costUsd: null, estimated: true, status: 'running', durationMs: null, log: [] });
        } else {
          fullInputs.set(c.id, input);
          label(labelForTool(c.name, input, attachmentNames));
          upsertBlock({ kind: 'tool', id: c.id, name: c.name, input: clipJson(input, limits.blockIoMaxChars), status: 'running', durationMs: null });
        }
      } else {
        const agent = byId.get(ptu);
        if (!agent || agent.kind !== 'agent') continue;
        childTools.set(c.id, { agentId: ptu, t0: now() });
        appendLog(agent, isAgentTool(c.name) ? `→ Task ${clipStr(input.description || '', 60)}` : `→ ${short(c.name)} ${clipStr(safeJson(input), 120)}`);
      }
    }
  }

  function onUser(raw, ptu, isMain) {
    const content = Array.isArray(raw.message?.content) ? raw.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_result' || typeof c.tool_use_id !== 'string') continue;
      const text = resultText(c.content);
      if (!isMain) {
        const ct = childTools.get(c.tool_use_id);
        if (!ct) continue;
        childTools.delete(c.tool_use_id);
        const agent = byId.get(ct.agentId);
        if (agent) appendLog(agent, c.is_error ? `← error: ${clipStr(text, 120)}` : `← ok ${((now() - ct.t0) / 1000).toFixed(1)}s`);
        continue;
      }
      const b = byId.get(c.tool_use_id);
      if (!b || (b.kind !== 'tool' && b.kind !== 'agent')) continue;
      if (b.kind === 'agent') {
        const tur = raw.tool_use_result;
        const obj = tur && typeof tur === 'object' && !Array.isArray(tur) ? tur : null;
        if (obj && (obj.isAsync === true || obj.status === 'async_launched')) { upsertBlock(b); continue; }   // background mode: finish() closes it
        runningAgents = Math.max(0, runningAgents - 1);
        if (obj) {
          if (typeof obj.resolvedModel === 'string') b.model = obj.resolvedModel;
          if (obj.usage && typeof obj.usage === 'object') b.usage = normalizeUsage(obj.usage);
          b.tokens = Number.isFinite(obj.totalTokens) ? obj.totalTokens : (b.usage ? b.usage.input + b.usage.output + b.usage.cacheRead + b.usage.cacheCreation : null);
          if (!b.type && typeof obj.agentType === 'string') b.type = obj.agentType;
          if (Number.isFinite(obj.totalDurationMs)) b.durationMs = obj.totalDurationMs;
        }
        if (b.durationMs === null) b.durationMs = elapsed(b.id);
        b.status = c.is_error ? 'error' : 'done';
        if (c.is_error) b.error = redact(clipStr(text, limits.blockIoMaxChars));
        label(agentsLabel());                                             // label first, then the block — same order as the spawn path
        upsertBlock(b);
        continue;
      }
      b.status = c.is_error ? 'error' : 'done';
      b.durationMs = elapsed(b.id);
      if (c.is_error) b.error = redact(clipStr(text, limits.blockIoMaxChars));
      upsertBlock(b);
      if (b.name === 'mcp__worca__propose_run' && typeof onProposal === 'function') {
        let childOk = null;
        try { const parsed = JSON.parse(text); childOk = typeof parsed?.ok === 'boolean' ? parsed.ok : null; } catch { childOk = null; }
        try {
          const ret = onProposal({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, childOk });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      // A comment write happened in the MCP CHILD process, so nothing in this
      // process saw the row change. The tool result names the run it touched
      // (shapeComment.runId / delete's comment.runId), so the parent can turn a
      // successful call into the same diff-comments-changed poke the REST routes
      // broadcast. Error results are skipped: nothing changed.
      if (COMMENT_WRITE_TOOLS.has(b.name) && typeof onCommentMutation === 'function' && !c.is_error) {
        try {
          const parsed = JSON.parse(text);
          const runId = typeof parsed?.comment?.runId === 'string' ? parsed.comment.runId : null;
          if (runId) onCommentMutation({ runId });
        } catch { /* unparseable result — no poke; the next open refetches anyway */ }
      }
    }
  }

  function onResult(raw) {
    sawResult = true;
    lastResult = raw;                                                     // the LAST result wins; never sum
    if (typeof raw.session_id === 'string') sessionId = raw.session_id;
    emitUsage();
  }

  function handle(evt) {
    if (!evt || typeof evt !== 'object') return;
    if (!labels.length) label('Thinking');
    if (evt.type === 'session' && typeof evt.sessionId === 'string') { sessionId = evt.sessionId; return; }
    const raw = evt.raw;
    if (!raw || typeof raw !== 'object') return;                          // stderr / log / hook envelopes
    const ptu = raw.parent_tool_use_id ?? null;
    const isMain = ptu === null;
    switch (raw.type) {
      case 'system':
        if (raw.subtype === 'init') { sawInit = true; if (typeof raw.session_id === 'string') sessionId = raw.session_id; }
        return;                                                           // status, thinking_tokens, task_*, background_tasks_changed, hook_*
      case 'stream_event': return onStreamEvent(raw, ptu, isMain);
      case 'assistant': return onAssistant(raw, ptu, isMain);
      case 'user': return onUser(raw, ptu, isMain);
      case 'result': return onResult(raw);
      default: return;                                                    // rate_limit_event, unknown
    }
  }

  const terminal = () => {
    const subtype = lastResult && typeof lastResult.subtype === 'string' ? lastResult.subtype : null;
    const reason = /max_turns/.test(subtype ?? '') ? 'max_turns' : /max_budget/.test(subtype ?? '') ? 'max_budget' : null;
    return {
      status: reason ? 'stopped' : 'done',
      reason,
      resultSubtype: subtype,
      isError: !!(lastResult && lastResult.is_error),
      errors: Array.isArray(lastResult?.errors) ? lastResult.errors.map(String) : [],
      numTurns: Number.isFinite(lastResult?.num_turns) ? lastResult.num_turns : null,
      durationMs: Number.isFinite(lastResult?.duration_ms) ? lastResult.duration_ms : Math.max(0, now() - startedAt),
    };
  };

  return {
    push(event) {
      if (summary) return;
      try { handle(event); } catch { reducerErrors += 1; }
    },
    flush: flushDeltas,
    /** Await P2's async proposal hooks (validateProposal → addBlock). turn.mjs calls this BEFORE finish(). */
    async settle() {
      while (pendingHooks.length) await pendingHooks.splice(0).reduce((p, h) => p.then(() => h), Promise.resolve());
    },
    addBlock(block) {
      if (summary) { reducerErrors += 1; return null; }                   // after finish(): the message is persisted — too late
      upsertBlock(block);
      return block;
    },
    updateBlock(id, patch) {
      if (summary) { reducerErrors += 1; return null; }
      const b = byId.get(id);
      if (!b) return null;
      Object.assign(b, patch && typeof patch === 'object' ? patch : {});
      upsertBlock(b);
      return clone(b);
    },
    snapshot() {
      return {
        text: mainText(), blocks: blocks.map(clone), usage: currentUsage(), costUsd: currentCost(), sessionId,
        ...terminal(), sawInit, sawAssistant, sawResult, agents: blocks.filter((b) => b.kind === 'agent').length,
        runningAgents, labels: [...labels], reducerErrors,
      };
    },
    finish() {
      if (summary) return summary;
      flushDeltas();
      for (const b of blocks) {
        if ((b.kind === 'tool' || b.kind === 'agent') && b.status === 'running') {
          b.status = 'error';
          b.error = 'interrupted';
          b.durationMs = elapsed(b.id) ?? Math.max(0, now() - startedAt);
          upsertBlock(b);
        }
      }
      const agents = blocks.filter((b) => b.kind === 'agent');
      if (agents.length && lastResult) {
        const est = estimateAgentCosts(agents, lastResult);
        agents.forEach((a, i) => { a.costUsd = est[i].costUsd; });
      }
      const text = mainText() || (lastResult && typeof lastResult.result === 'string' ? lastResult.result : '');
      summary = {
        text: redact(text), blocks: blocks.map(clone), usage: currentUsage(), costUsd: currentCost(), sessionId,
        ...terminal(), sawInit, sawAssistant, sawResult, agents: agents.length, labels: [...labels], reducerErrors,
      };
      return summary;
    },
  };
}
