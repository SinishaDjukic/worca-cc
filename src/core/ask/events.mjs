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
// The four write tools whose success must reach the browser. The reducer runs in
// the PARENT process, so this is the only place a child-process write becomes a
// broadcast (the MCP server cannot call broadcast()).
const COMMENT_WRITE_TOOLS = new Set([
  'mcp__worca__add_diff_comment', 'mcp__worca__reply_to_diff_comment',
  'mcp__worca__resolve_diff_comment', 'mcp__worca__delete_diff_comment',
]);
// The worktree-mutating tools (P4): the MCP child opens/removes checkouts and
// moves HEAD (checkout/switch/fetch → tools.mjs noteNav) — invisible to this
// process, so a successful result becomes the same `ask-worktrees` broadcast
// the REST DELETE route emits (ui/server.mjs emitAskWorktrees). `git` counts
// only when its subcommand is one noteNav acts on; a `log`/`status` never pokes.
const WORKTREE_TOOLS = new Set(['mcp__worca__open_worktree', 'mcp__worca__remove_worktree', 'mcp__worca__git']);
const GIT_NAV_SUBCOMMANDS = new Set(['checkout', 'switch', 'fetch']);
// The memory writers (agent-memory-design.md §9.1): a successful remember/forget in the CHILD
// becomes the same `memory-changed` broadcast the REST routes emit (ui/server.mjs emitMemoryChanged).
// The scope key rides the tool RESULT (`scopeKey`), like pokeCommentWrite reads `comment.runId`.
const MEMORY_WRITE_TOOLS = new Set(['mcp__worca__remember', 'mcp__worca__forget']);
// …and the script writer (scripts-workbench-design.md §3.3, §9.1): save_script writes a file
// under ~/.worca-cc/scripts in the CHILD, so the parent turns a successful call into the same
// `scripts-changed` broadcast the REST routes emit — a script the chat saved shows up in an
// open Scripts tab. There is no delete tool, and test_script writes nothing outside the bench.
const SCRIPT_WRITE_TOOLS = new Set(['mcp__worca__save_script']);
// The direct schedule writes (docs/scheduled-runs.md "Ask Worca"): reversible, never a run start.
const SCHEDULE_WRITE_TOOLS = new Set(['mcp__worca__pause_schedule', 'mcp__worca__resume_schedule',
  'mcp__worca__skip_next_run', 'mcp__worca__mark_schedule_activity_read']);
/** True when a SUCCESSFUL call of `name` with `input` changed this thread's worktree rows. */
export function worktreeMutatingCall(name, input) {
  if (!WORKTREE_TOOLS.has(name)) return false;
  if (name !== 'mcp__worca__git') return true;
  const args = input && Array.isArray(input.args) ? input.args : null;
  return !!args && GIT_NAV_SUBCOMMANDS.has(String(args[0] ?? '').trim());
}

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
    case 'propose_workflow': return 'Building a workflow';
    case 'propose_metrics_change': return 'Proposing a metrics change';
    case 'get_team_metrics': return 'Reading team metrics';
    case 'list_team_metrics_runs': return 'Listing team runs';
    case 'push_team_metrics': return 'Pushing team metrics';
    case 'get_team_policy': return 'Reading team policy';
    case 'propose_policy_change': return 'Proposing a policy change';
    case 'track_run': return 'Tracking a run';
    case 'read_attachment': return `Reading ${(attachmentNames && attachmentNames[id]) || 'attachment'}`;
    case 'list_diff_comments': return id ? `Reading comments on ${id.slice(0, 12)}` : 'Reading diff comments';
    case 'add_diff_comment': return 'Writing a diff comment';
    case 'reply_to_diff_comment': return 'Replying to a diff comment';
    case 'resolve_diff_comment': return 'Updating a diff comment';
    case 'delete_diff_comment': return 'Deleting a diff comment';
    case 'list_memory': return 'Reading memory';
    case 'read_memory': return input?.name ? `Reading memory: ${input.name}` : 'Reading memory';
    case 'remember': return input?.name ? `Saving memory: ${input.name}` : 'Saving memory';
    case 'forget': return input?.name ? `Removing memory: ${input.name}` : 'Removing memory';
    case 'list_scripts': return 'Looking at scripts';
    case 'get_script': return input?.key ? `Reading script: ${input.key}` : 'Reading a script';
    case 'save_script': return input?.key ? `Saving script: ${input.key}` : 'Saving a script';
    case 'test_script': return input?.key ? `Testing script: ${input.key}` : 'Testing a script';
    case 'list_schedules': return 'Looking at schedules';
    case 'get_schedule': return 'Reading a schedule';
    case 'list_schedule_activity': return 'Reading schedule activity';
    case 'preview_schedule': return 'Working out the dates';
    case 'propose_schedule_change': return 'Proposing a schedule change';
    case 'pause_schedule': return 'Pausing a schedule';
    case 'resume_schedule': return 'Resuming a schedule';
    case 'skip_next_run': return 'Skipping the next run';
    case 'mark_schedule_activity_read': return 'Marking activity read';
    case 'list_task_sources': return 'Looking at task sources';
    case 'find_tasks': return input?.search ? `Searching tasks: ${String(input.search).slice(0, 40)}` : 'Searching tasks';
    case 'get_task': return input?.id ? `Reading task ${String(input.id).slice(0, 40)}` : 'Reading a task';
    case 'list_models': return 'Looking at models';
    case 'get_providers': return 'Looking at providers';
    case 'test_provider': return input?.provider ? `Testing ${String(input.provider).slice(0, 20)}` : 'Testing a provider';
    case 'list_copilot_models': return 'Listing Copilot models';
    case 'propose_model_change': return 'Proposing a model change';
    default: return `Using ${n}`;
  }
}

const resultText = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
  return '';
};

// ── script tools on the thread row (scripts-workbench-design.md §9.3) ─────────
const SCRIPT_TOOL_NAMES = new Set(['list_scripts', 'get_script', 'save_script', 'test_script']);

/**
 * The key a script tool was called with, stamped on the block at the CALL: a save_script input
 * is a whole program, so past blockIoMaxChars the persisted input is the { _truncated, preview }
 * stub and input.key is gone. '' for a script tool with no key, null for every other tool.
 */
export function scriptToolKey(name, input = {}) {
  if (!SCRIPT_TOOL_NAMES.has(short(name))) return null;
  return typeof input?.key === 'string' ? input.key.trim().slice(0, 64) : '';
}

/**
 * What a script tool's RESULT adds to its thread row: `save script runTests → created`,
 * `test script runTests → blocking, exit 1`. Pure, tiny and enum-shaped on purpose — it is
 * merged into the persisted block.script, so nothing free-text (which would need redaction)
 * rides along. null = the row keeps its ordinary shape.
 */
export function scriptResultNote(name, text, isError = false) {
  const n = short(name);
  if (isError || (n !== 'save_script' && n !== 'test_script')) return null;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (n === 'save_script') return { saved: parsed.ok === true ? (parsed.created === true ? 'created' : 'updated') : 'not saved' };
  const r = parsed.ok === true && parsed.result && typeof parsed.result === 'object' ? parsed.result : null;
  if (!r) return { status: 'not run' };
  return {
    status: typeof r.status === 'string' ? r.status.slice(0, 16) : null,
    exitCode: Number.isInteger(r.exitCode) ? r.exitCode : null,
  };
}

/**
 * @param {object} o
 * @param {(frame:object)=>void} o.onFrame
 * @param {(s:string)=>string} [o.redact]
 * @param {()=>number} [o.now]
 * @param {Function} [o.setTimeout]  (fn, ms) => id
 * @param {Function} [o.clearTimeout]
 * @param {(p:{toolUseId:string, input:object, childOk:boolean|null})=>void} [o.onProposal]
 * @param {(p:{runId:string})=>void} [o.onCommentMutation]  a successful MCP-side comment write
 * @param {(p:{tool:string})=>void} [o.onWorktreeMutation]  a successful MCP-side worktree open/remove/navigate
 * @param {(usage:object)=>number|null} [o.estimateLiveCost]  DISPLAY-ONLY $ estimate of the running usage (null = no estimate)
 * @param {Record<string,string>} [o.attachmentNames]  id → display name (labels only)
 * @param {(cliCostUsd:number, usage:object)=>number} [o.resolveCost]  re-price the
 *   turn: given what the CLI reported and this turn's usage, return the
 *   AUTHORITATIVE cost. Injected (rather than imported) to keep this reducer free
 *   of config/DB dependencies. Default: trust the CLI. A non-finite return, or a
 *   throw, falls back to the CLI figure.
 * @param {object} [o.limits]
 */
export function createTurnReducer({
  onFrame,
  redact = redactAskText,
  now = Date.now,
  setTimeout: setT = globalThis.setTimeout,
  clearTimeout: clearT = globalThis.clearTimeout,
  onProposal = null,
  onWorkflowStart = null,
  onWorkflowResult = null,
  onMetricsProposal = null,      // propose_metrics_change RESULT (team metrics card; the parent re-validates the input)
  onPolicyProposal = null,       // propose_policy_change RESULT (team policy card; same split)
  onScheduleProposal = null,     // propose_schedule_change RESULT (schedule card; the parent re-validates the input)
  onModelProposal = null,        // propose_model_change RESULT (model card; same split)
  onScheduleMutation = null,     // a direct schedule write succeeded in the MCP child
  onTrackRun = null,
  onCommentMutation = null,
  onWorktreeMutation = null,
  onMemoryMutation = null,
  onScriptMutation = null,        // save_script RESULT { ok: true, key, created } → { key, action }
  estimateLiveCost = null,
  attachmentNames = {},
  resolveCost = null,
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
  const childTools = new Map();    // child tool id → { agentId, t0, name, input }
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
  /** What the CLI itself reported for this turn — null until the `result` frame lands. */
  const cliCost = () => (lastResult && typeof lastResult.total_cost_usd === 'number' && Number.isFinite(lastResult.total_cost_usd) ? lastResult.total_cost_usd : null);
  // The AUTHORITATIVE turn cost: cliCost() re-priced by the injected override, if
  // any. Memoized on lastResult — resolveCost reads the model catalog off disk, and
  // this is read by every ask-usage frame as well as finish()/snapshot(). null
  // (no `result` frame seen) is NOT a price and is never re-priced: ask spec §6.2.8
  // makes null mean "no cost observed", which the ledger writer no-ops on.
  let costMemo = null;
  const currentCost = () => {
    const raw = cliCost();
    if (raw === null || !resolveCost) return raw;
    if (!costMemo || costMemo.src !== lastResult) {
      let v = raw;
      try { const r = resolveCost(raw, currentUsage()); if (Number.isFinite(r)) v = r; }
      catch { /* a pricing override must never break a turn */ }
      costMemo = { src: lastResult, value: v };
    }
    return costMemo.value;
  };
  /** authoritative ÷ CLI — the factor the per-agent cost split must ride (1 when no override applies). */
  const costScale = () => {
    const raw = cliCost();
    if (raw === null || !(raw > 0)) return 1;
    const resolved = currentCost();
    return resolved === null ? 1 : resolved / raw;
  };
  // DISPLAY ONLY: the injected estimator prices the running usage sum while no
  // `result` has landed; once cliCost() is a number the authoritative figure is
  // in costUsd and the estimate retires (null). Read by the ask-usage frame
  // alone — never by snapshot()/finish(), so no sink can ever book it.
  const liveEstimate = () => {
    if (typeof estimateLiveCost !== 'function' || cliCost() !== null) return null;
    try { const v = estimateLiveCost(currentUsage()); return Number.isFinite(v) ? v : null; }
    catch { return null; }
  };
  const emitUsage = () => emit('ask-usage', { usage: currentUsage(), costUsd: currentCost(), estimatedCostUsd: liveEstimate() });
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
          const scriptKey = scriptToolKey(c.name, input);
          upsertBlock({ kind: 'tool', id: c.id, name: c.name, input: clipJson(input, limits.blockIoMaxChars), status: 'running', durationMs: null,
            ...(scriptKey === null ? {} : { script: { key: scriptKey } }) });          // §9.3: the row's key, whatever the clip does
          // P3: the workflow card exists from the tool_use on (state 'building' — the four-step trace), so the
          // START is a hook too. Sync: the block must precede any frame the tool result produces.
          if (c.name === 'mcp__worca__propose_workflow' && typeof onWorkflowStart === 'function') {
            try { onWorkflowStart({ toolUseId: c.id, input }); } catch { reducerErrors += 1; }
          }
        }
      } else {
        const agent = byId.get(ptu);
        if (!agent || agent.kind !== 'agent') continue;
        childTools.set(c.id, { agentId: ptu, t0: now(), name: c.name, input });
        appendLog(agent, isAgentTool(c.name) ? `→ Task ${clipStr(input.description || '', 60)}` : `→ ${short(c.name)} ${clipStr(safeJson(input), 120)}`);
      }
    }
  }

  // A comment write happened in the MCP CHILD process, so nothing in this
  // process saw the row change. The tool result names the run it touched
  // (shapeComment.runId / delete's comment.runId), so the parent can turn a
  // successful call into the same diff-comments-changed poke the REST routes
  // broadcast. Error results are skipped: nothing changed.
  // SUB-AGENTS write too — they hold the same mcp__worca grant (spawn.mjs
  // ASK_MCP_GRANTS) — so their results poke as well. No double-fire: the main
  // transcript only ever sees the Task's AGGREGATE result, whose name is never a
  // comment tool, and childTools.delete() makes a re-delivered child result a
  // no-op.
  function pokeCommentWrite(name, text, isError) {
    if (isError || !COMMENT_WRITE_TOOLS.has(name) || typeof onCommentMutation !== 'function') return;
    try {
      const parsed = JSON.parse(text);
      const runId = typeof parsed?.comment?.runId === 'string' ? parsed.comment.runId : null;
      if (runId) onCommentMutation({ runId });
    } catch { /* unparseable result — no poke; the next open refetches anyway */ }
  }

  // Same idea for worktrees: open_worktree / remove_worktree / a navigating git
  // call succeeded in the CHILD, so the parent re-reads the rows and broadcasts
  // them. Error results changed nothing. Both paths — main transcript and
  // sub-agent — carry the call's input (fullInputs / childTools.input), so the
  // git subcommand filter is the same on both.
  function pokeWorktreeMutation(name, input, isError) {
    if (isError || typeof onWorktreeMutation !== 'function' || !worktreeMutatingCall(name, input)) return;
    try { onWorktreeMutation({ tool: short(name) }); } catch { /* a broken sink never breaks the stream */ }
  }

  // And for memory: a remember/forget succeeded in the CHILD, so the parent broadcasts the same
  // `memory-changed` frame the REST writes emit. Note the asymmetry with the worktree poke — that
  // one reads the call INPUT, this one the result TEXT, because the scope key rides the result.
  function pokeMemoryWrite(name, text, isError) {
    if (isError || !MEMORY_WRITE_TOOLS.has(name) || typeof onMemoryMutation !== 'function') return;
    try {
      const parsed = JSON.parse(text);
      const scope = typeof parsed?.scopeKey === 'string' ? parsed.scopeKey : null;
      if (scope) onMemoryMutation({ scope, tool: short(name) });
    } catch { /* unparseable result — no poke; the next open refetches anyway */ }
  }

  // And for scripts: save_script REFUSES by returning { ok: false, errors } with no is_error
  // flag (that is what lets the model correct itself), so the result body — not the flag — is
  // what decides whether anything was written.
  function pokeScriptWrite(name, text, isError) {
    if (isError || !SCRIPT_WRITE_TOOLS.has(name) || typeof onScriptMutation !== 'function') return;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.ok !== true || typeof parsed.key !== 'string' || !parsed.key) return;
      onScriptMutation({ key: parsed.key, action: parsed.created === true ? 'created' : 'updated' });
    } catch { /* unparseable result — no poke; the next open refetches anyway */ }
  }

  // And for schedules: pause / resume / skip / mark-read succeeded in the CHILD, so the parent
  // broadcasts the same schedules-changed / notifications-changed frames the REST routes emit.
  function pokeScheduleWrite(name, isError) {
    if (isError || !SCHEDULE_WRITE_TOOLS.has(name) || typeof onScheduleMutation !== 'function') return;
    try { onScheduleMutation({ tool: short(name) }); } catch { /* a broken sink never breaks the stream */ }
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
        pokeCommentWrite(ct.name, text, c.is_error);
        pokeWorktreeMutation(ct.name, ct.input, c.is_error);
        pokeMemoryWrite(ct.name, text, c.is_error);
        pokeScriptWrite(ct.name, text, c.is_error);
        pokeScheduleWrite(ct.name, c.is_error);
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
      const note = scriptResultNote(b.name, text, c.is_error);
      if (note) b.script = { ...(b.script || {}), ...note };                       // §9.3: the row shows what came back
      upsertBlock(b);
      if (b.name === 'mcp__worca__propose_run' && typeof onProposal === 'function') {
        let childOk = null;
        try { const parsed = JSON.parse(text); childOk = typeof parsed?.ok === 'boolean' ? parsed.ok : null; } catch { childOk = null; }
        try {
          const ret = onProposal({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, childOk });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      if (b.name === 'mcp__worca__propose_workflow' && typeof onWorkflowResult === 'function') {
        // The RAW result text: the parent re-validates from the returned shape (spec §8.2, PD1); an isError result
        // carries "error: <message>" and flips the card to failed.
        try {
          const ret = onWorkflowResult({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, text, isError: !!c.is_error });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      if (b.name === 'mcp__worca__propose_metrics_change' && typeof onMetricsProposal === 'function') {
        // The parent re-validates from the tool INPUT (metrics-proposal.mjs is pure over the real readers);
        // the raw result text only says whether the child accepted it.
        try {
          const ret = onMetricsProposal({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, text, isError: !!c.is_error });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      if (b.name === 'mcp__worca__propose_policy_change' && typeof onPolicyProposal === 'function') {
        // Same split as the metrics card: the parent re-validates from the INPUT (policy-proposal.mjs).
        try {
          const ret = onPolicyProposal({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, text, isError: !!c.is_error });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      if (b.name === 'mcp__worca__propose_schedule_change' && typeof onScheduleProposal === 'function') {
        // Same split as the metrics card: the parent re-validates the INPUT against the live rows.
        try {
          const ret = onScheduleProposal({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, text, isError: !!c.is_error });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      if (b.name === 'mcp__worca__propose_model_change' && typeof onModelProposal === 'function') {
        // Same split as the metrics card: the parent re-validates the INPUT over the real catalog (model-proposal.mjs).
        try {
          const ret = onModelProposal({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, text, isError: !!c.is_error });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      if (b.name === 'mcp__worca__track_run' && typeof onTrackRun === 'function') {
        // The parent owns the runs Map, the link rows and the followers: it re-resolves the id itself (D4).
        try {
          const ret = onTrackRun({ toolUseId: b.id, input: fullInputs.get(b.id) ?? {}, text, isError: !!c.is_error });
          if (ret && typeof ret.then === 'function') pendingHooks.push(ret.then(() => {}, () => { reducerErrors += 1; }));
        } catch { reducerErrors += 1; }
      }
      pokeCommentWrite(b.name, text, c.is_error);
      pokeWorktreeMutation(b.name, fullInputs.get(b.id), c.is_error);
      pokeMemoryWrite(b.name, text, c.is_error);
      pokeScriptWrite(b.name, text, c.is_error);
      pokeScheduleWrite(b.name, c.is_error);
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
        // §6.6 splits the CLI's OWN modelUsage costUSD across agents. When an
        // override re-prices the turn, the shares must ride the same scale or the
        // agent rows out-total the turn they belong to (a free endpoint would show
        // $0.00 overall next to agents billing real dollars).
        const scale = costScale();
        agents.forEach((a, i) => {
          a.costUsd = est[i].costUsd == null ? null : Math.round(est[i].costUsd * scale * 1e6) / 1e6;
        });
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
