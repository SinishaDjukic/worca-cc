// src/core/engines/session-demux.mjs — one host turn's frames, each with exactly one home (session groups, Task 32).
// A `claude -p --resume <host>` turn interleaves the main agent's frames (no parent), the member's (parent = the bound
// Agent call) and its investigators' (parent = their own Agent call). The member's frames are re-rooted onto its row
// (consult R1); the main agent's become turn facts, host log lines or watchdog verdicts. One demux per dispatch; no I/O.
import { createClaudeNormalizer } from './claude-events.mjs';
import { extractResultCost, isHookEvent } from './claude.mjs';
import { CHILD_PROMPT } from './session-dispatch.mjs';   // v3: row 7a (session-dispatch.mjs imports nothing)

/** The per-session sub-agent cap's refusal (S6, Task 6). Never the concurrency limit ("Concurrent subagent limit
 *  reached…"), which clears by itself and must not rotate the host. Task 53 pins the measured fragment. */
export const SUBAGENT_CAP_RE = /(?<!concurrent (?:sub-?)?)\b(?:sub-?agent|agent)s? (?:per session )?(?:limit|cap) (?:reached|exceeded)/i;
/** The CLI refusing the host's own Agent call before any child ran, e.g. a missing `description` (verify major 2).
 *  S1's `missingDescriptionText` pins the real fragment (Task 2). */
export const INVALID_INPUT_RE = /InputValidationError|Invalid tool parameters|required parameter/i;

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const DISPATCH_KEYS = new Set(['subagent_type', 'prompt', 'description']);   // any other input key is an override (C11)
const MEMBER_DISPATCH_PREFIX = 'worca-x-';                                    // isMemberDispatch (shared/graph/sessions.mjs)
const BUFFER_MAX = 500;
const SAID_MAX = 20;
const SAID_CHARS = 500;
const noop = () => {};
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('') : '');
const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const tokensOf = (u) => ({ in: count(u.input_tokens), out: count(u.output_tokens), cr: count(u.cache_read_input_tokens), cw: count(u.cache_creation_input_tokens) });
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
const pidOf = (raw) => raw.parent_tool_use_id ?? raw.message?.parent_tool_use_id ?? null;
const isAck = (meta) => !!meta && (meta.isAsync === true || meta.status === 'async_launched');

export function createTurnDemux({ agentType, onMember = noop, onHostText = noop, onInit = noop, onBind = noop, onMemberDone = noop,
  onHookCost = noop, onViolation = noop, onWarn = noop, capRe = SUBAGENT_CAP_RE } = {}) {
  const plain = createClaudeNormalizer();          // host frames the member's row still shows (api_retry, row 6)
  let member = null;                               // createClaudeNormalizer({ rootParentId: bound }), made at the bind
  let bound = null;
  let sawInit = false;
  let hostSessionId = null;
  let hostInitModel = null;
  let agentCalls = 0;
  let done = null;
  let result = null;
  let violation = null;
  let background = false;
  let capRefused = false;
  let hookUsd = null;
  let lastHostUsage = null;
  let anonymous = 0;
  const hostUsageById = new Map();                 // the LAST usage per host message id, summed in facts()
  const afterDone = [];
  const strayTools = [];
  const wrongTypes = [];
  const memberWarnings = [];
  const investigators = [];
  const said = [];
  const buffer = [];
  const memberCalls = new Set();                   // the member's own Agent/Task calls: its investigators (C33)

  function violate(code, detail = {}) {
    // v5: after the member's tool_result, clean (C11, C12: the dispatch is kept) or an error (C41: the member's own error
    // stands, so a 529 or a usage limit recovers as ungrouped, not as a session_host failure).
    const settled = !!done;
    const v = { code, detail: { ...detail, ...(settled ? { afterDone: true } : {}) } };
    if (settled) afterDone.push(v);
    else violation ??= v;
    onViolation(v);                                // the SessionHost kills the process either way (C11)
  }

  function init(id, model) {
    sawInit = true;
    let changed = false;
    if (id && id !== hostSessionId) {
      hostSessionId = id;
      changed = true;
      onMember({ type: 'session', sessionId: id }); // the row's session id is the host's; no model (the member has its own)
    }
    if (model && model !== hostInitModel) { hostInitModel = model; changed = true; }
    if (changed) onInit({ hostSessionId, model: hostInitModel });   // C43: adopt the id at once; C35: the real host model
  }

  function hook(raw) {
    if (raw?.subtype === 'hook_response' && raw.hook_event === 'PostToolUse' && bound) {
      const out = typeof raw.stdout === 'string' && raw.stdout.trim() ? raw.stdout : raw.output;
      let payload = null;
      try { payload = JSON.parse(out); } catch { /* a hook that printed non-JSON is not telemetry */ }
      if (payload?.tool_use_id === bound) {
        const tr = obj(payload.tool_response) || {};
        const usd = Number(tr.usage?.cost_usd ?? tr.usage?.total_cost_usd ?? tr.cost_usd);   // as _recordSubAgentTelemetry
        if (Number.isFinite(usd)) { hookUsd = usd; onHookCost(usd); }
        return;                                    // the host's own Agent call, never a sub-agent of the member's row
      }
    }
    onMember({ type: 'hook', raw });
  }

  function bind(id) {
    bound = id;
    agentCalls += 1;
    member = createClaudeNormalizer({ rootParentId: id });
    onBind(id);
    for (const e of buffer.splice(0)) routeMember(e);   // child frames that raced the bind (row 8)
  }

  function hostAssistant(raw) {                    // row 3
    const msg = obj(raw.message) || {};
    for (const c of Array.isArray(msg.content) ? msg.content : []) {
      if (c?.type === 'text' && typeof c.text === 'string' && c.text) { onHostText(c.text); continue; }
      if (c?.type !== 'tool_use' || typeof c.name !== 'string') continue;
      if (!AGENT_TOOLS.has(c.name)) {
        strayTools.push(c.name);
        violate('SESSION_HOST_STRAY_TOOL', { strayTools: [c.name] });
        continue;
      }
      const input = obj(c.input) || {};
      const override = Object.keys(input).filter((k) => !DISPATCH_KEYS.has(k));
      if (override.length) violate('SESSION_HOST_NO_DISPATCH', { override });
      else if (bound) { agentCalls += 1; violate('SESSION_HOST_MULTI_DISPATCH'); }
      else if (input.subagent_type === agentType && typeof c.id === 'string') bind(c.id);
      else { wrongTypes.push(String(input.subagent_type ?? '')); violate('SESSION_HOST_NO_DISPATCH', { wrongType: input.subagent_type ?? null }); }
    }
    if (obj(msg.usage)) {
      const u = tokensOf(msg.usage);
      hostUsageById.set(typeof msg.id === 'string' ? msg.id : `#${anonymous++}`, u);
      lastHostUsage = u;
    }
  }

  function hostUser(raw) {                         // row 4
    if (!bound) return;
    const meta = obj(raw.tool_use_result);
    for (const b of Array.isArray(raw.message?.content) ? raw.message.content : []) {
      if (b?.type !== 'tool_result' || b.tool_use_id !== bound) continue;
      if (isAck(meta)) { background = true; violate('SESSION_HOST_NO_DISPATCH', { background: true }); continue; }
      const text = textOf(b.content);
      if (b.is_error && INVALID_INPUT_RE.test(text)) { violate('SESSION_HOST_NO_DISPATCH', { invalidInput: true }); continue; }
      // The block wraps the report in the CLI's hand-back frame; tool_use_result.content is the child's own text.
      const own = textOf(meta?.content);
      done = { report: b.is_error ? text : (own || text), isError: !!b.is_error, errorText: b.is_error ? text : null,
        usage: obj(meta?.usage), resolvedModel: typeof meta?.resolvedModel === 'string' ? meta.resolvedModel : null,
        durationMs: finiteOrNull(meta?.totalDurationMs), tokens: finiteOrNull(meta?.totalTokens),
        agentId: typeof meta?.agentId === 'string' ? meta.agentId : null };
      if (b.is_error && capRe.test(text)) capRefused = true;
      onMemberDone(done);
    }
  }

  function routeMember(e) {                        // row 7
    const raw = e.raw;
    if (pidOf(raw) === bound) {
      const content = Array.isArray(raw.message?.content) ? raw.message.content : [];
      // Row 7a (v3): the CLI echoes the child's user message under the bound call (test/fixtures/hooks/subagent-foreground.jsonl,
      // the user frame before the report). An ungrouped step has no such line, so it never reaches the member's row.
      if (raw.type === 'user' && !content.some((b) => b?.type === 'tool_result') && textOf(raw.message?.content).trim() === CHILD_PROMPT) return;
      if (raw.type === 'assistant') {
        for (const c of content) {
          if (c?.type !== 'tool_use' || !AGENT_TOOLS.has(c.name)) continue;
          if (typeof c.id === 'string') memberCalls.add(c.id);
          const t = c.input?.subagent_type;
          if (typeof t === 'string' && t.startsWith(MEMBER_DISPATCH_PREFIX)) onWarn({ code: 'member-self-dispatch', detail: { subagentType: t } });
        }
      } else if (raw.type === 'user') {
        const meta = obj(raw.tool_use_result);
        for (const b of content) {
          if (b?.type !== 'tool_result') continue;
          if (b.is_error && capRe.test(textOf(b.content))) {
            const w = { code: 'member-cap-refused', detail: {} };
            memberWarnings.push(w);
            onWarn(w);                             // Task 41 rotates before the next dispatch
          }
          if (memberCalls.has(b.tool_use_id) && !isAck(meta)) {
            investigators.push({ toolUseId: b.tool_use_id, usage: meta?.usage ?? null, resolvedModel: meta?.resolvedModel ?? null });
          }
        }
      }
    }
    for (const ev of member(e)) onMember(ev);
  }

  function feed(e) {
    if (!e || typeof e !== 'object') return;
    // Row 0: a plain runner line (non-JSON stdout, stderr); spawnAgent reads it too (the sideload refusal, C20).
    if ((e.type === 'log' && !obj(e.raw)) || e.type === 'stderr') {
      if (typeof e.text === 'string' && e.text && said.length < SAID_MAX) said.push(e.text.slice(0, SAID_CHARS));
      onMember(e);
      return;
    }
    const raw = obj(e.raw);
    if (e.type === 'hook-event' || (raw && isHookEvent(raw))) { hook(raw); return; }          // row 1
    if (!raw) {                                                                               // normalized events
      if (e.type === 'session') init(typeof e.sessionId === 'string' ? e.sessionId : null, null);   // row 2 (pre-event)
      else onMember(e);
      return;
    }
    const pid = pidOf(raw);
    if (pid !== null) {                                                                       // rows 7 and 8
      if (bound) routeMember(e);
      else if (buffer.length < BUFFER_MAX) buffer.push(e);
      return;
    }
    if (raw.mock === true && raw.type !== 'result') {                                         // row 9
      if (typeof e.text === 'string' && e.text) onHostText(e.text);
      return;
    }
    switch (raw.type) {
      case 'system':
        if (raw.subtype === 'init') init(typeof raw.session_id === 'string' ? raw.session_id : null, typeof raw.model === 'string' ? raw.model : null);
        else if (raw.subtype === 'api_retry') for (const ev of plain(e)) if (ev.type === 'retry') onMember(ev);   // row 6
        return;
      case 'assistant': hostAssistant(raw); return;
      case 'user': hostUser(raw); return;
      case 'result':                                                                          // row 5
        result = { cumulativeUsd: Number.isFinite(Number(e.costUsd)) && e.costUsd != null ? Number(e.costUsd) : extractResultCost(raw),
          usage: obj(raw.usage), numTurns: finiteOrNull(raw.num_turns), durationMs: finiteOrNull(raw.duration_ms),
          subtype: typeof raw.subtype === 'string' ? raw.subtype : null, isError: !!raw.is_error,
          sessionId: typeof raw.session_id === 'string' ? raw.session_id : null };
        return;
      default: return;                                                                        // row 6b
    }
  }

  function facts() {
    const hostUsage = { in: 0, out: 0, cr: 0, cw: 0 };
    for (const u of hostUsageById.values()) for (const k of Object.keys(hostUsage)) hostUsage[k] += u[k];
    return { sawInit, hostSessionId, hostInitModel, agentCalls, bound, done, hostUsage, lastHostUsage,
      investigators: investigators.slice(), result, violation, afterDone: afterDone.slice(), strayTools: strayTools.slice(),
      wrongTypes: wrongTypes.slice(), background, capRefused, memberWarnings: memberWarnings.slice(), hookUsd,
      said: said.slice(), buffered: buffer.length };
  }

  return { feed, facts };
}

/** The turn's watchdog verdict: null = accepted (or a member error, which the host classifies, C41). */
export function watchdogVerdict(facts) {
  if (!facts) return null;
  if (facts.done && !facts.done.isError) return null;          // accepted, whatever came after (C11, C12)
  if (facts.violation) return facts.violation;
  if (facts.agentCalls === 0 || !facts.done) return { code: 'SESSION_HOST_NO_DISPATCH', detail: { agentCalls: facts.agentCalls } };
  return null;
}
