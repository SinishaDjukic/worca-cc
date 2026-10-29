// src/core/engines/mock-session.mjs — the offline host session (session groups, Task 38; C3, C13).
// Plays one `claude -p --resume <host>` turn: system/init, ONE Agent call from the main agent, the member's frames (run
// through runMock and re-parented onto that call), the tool_result, "DONE" and a cumulative `result`. It emits RAW
// envelopes, as `runClaudeProcess` does, so the session demux (Task 32) sees the shapes production sees. The failure
// behaviours copy the CLI's, so every SessionHost test runs the path a real host takes.
import { runMock, emitRaw } from './mock.mjs';
import { safeEmit } from './spawn.mjs';
import { BRIEF_DIVIDER, CHILD_PROMPT } from './session-dispatch.mjs';
import { priceUsage } from '../session-cost.mjs';

/** Only a turn's FIRST host message carries usage, so the mock's host spend per turn is exactly one of these. */
export const MOCK_HOST_USAGE = Object.freeze({ input_tokens: 1000, output_tokens: 20 });
export const MOCK_MEMBER_USAGE = Object.freeze({ input_tokens: 5000, output_tokens: 700 });
const TYPE_RE = /subagent_type "([^"]+)"/;
const SIDELOAD_REFUSAL = 'Error: --plugin-dir is disabled by managed settings (disableSideloadFlags)';
const USAGE_LIMIT_TEXT = 'You\'ve hit your session limit · resets 6pm';
const MEMBER_ERRORS = { cap: 'Subagent limit reached for this session', 'member-error': 'boom', 'child-overloaded': 'API Error: 529 {"type":"overloaded_error"}' };
const WAITS = new Set(['two-dispatch', 'stray-bash', 'model-override', 'background', 'wrong-type']);

const ids = { host: 0, agent: 0, call: 0, turn: 0 };
let lost = new Map();                    // spend of cut turns the CLI never restores (restoreCutCost false)

/** Test seams. `behave`, `costFor`, `onMemberStart`, `hookUsd` and `restoreCutCost` are the test's configuration;
 *  `resetSessions()` clears the session state only: `spent`, `seen`, `spendBeforeHang`, the ids and the turn counter. */
export const _testing = {
  costFor: null,
  behave: null,
  spent: new Map(),                      // the ground truth: Map<hostSessionId, usd>, added the moment it is spent
  seen: [],
  onMemberStart: null,
  hookUsd: null,
  restoreCutCost: true,                  // S4's costRestoredAfterKill
  spendBeforeHang: null,
  resetSessions() {
    this.spent = new Map();
    this.seen = [];
    this.spendBeforeHang = null;
    lost = new Map();
    ids.host = 0; ids.agent = 0; ids.call = 0; ids.turn = 0;
  },
};

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const waitForKill = (signal) => new Promise((_, reject) => {
  if (!signal) { reject(new Error('mock-session: this behaviour waits for the kill, but the turn has no signal')); return; }
  if (signal.aborted) { reject(abortError()); return; }
  signal.addEventListener('abort', () => reject(abortError()), { once: true });
});

/** One host turn. `hostOpts` is what `hostSpawnOpts` (Task 31) builds: `agents` (with `agentsViaFile: true`; the real
 *  adapter writes them to the staging dir, the mock needs no file, C3), the dispatch line as `prompt`,
 *  `resumeSessionId`, `model`, `signal`, `onEvent`, and the member's `cwd`, `workspaceWriteTargets`, `permissionMode`. */
export async function runMockSession(hostOpts = {}) {
  const { cwd, agents, prompt, resumeSessionId, model, signal, onEvent, workspaceWriteTargets, permissionMode, pluginDirs } = hostOpts;
  const live = () => !signal?.aborted;   // nothing reaches the stream after the kill
  const emit = (e) => { if (live()) safeEmit(onEvent, e); };
  const raw = (r) => { if (live()) emitRaw(onEvent, r); };
  const check = () => { if (signal?.aborted) throw abortError(); };

  const agentType = TYPE_RE.exec(String(prompt ?? ''))?.[1] ?? null;
  const definition = (agents && agentType && agents[agentType]) || {};
  const full = typeof definition.prompt === 'string' ? definition.prompt : '';
  const at = full.indexOf(BRIEF_DIVIDER);
  const systemPrompt = at < 0 ? full : full.slice(0, at);
  const briefPrompt = at < 0 ? '' : full.slice(at + BRIEF_DIVIDER.length);
  const turn = ++ids.turn;               // ONE counter across every host session (a retry on a fresh host is the next turn)
  const resume = !!resumeSessionId;
  const behaviour = _testing.behave?.({ agentType, turn, resume, hostOpts }) ?? null;
  const seen = { agentType, resumeSessionId: resumeSessionId ?? null, hostSessionId: resumeSessionId ?? null, briefPrompt,
    prompt: prompt ?? null, model: model ?? null, effort: hostOpts.effort ?? null, maxBudgetUsd: hostOpts.maxBudgetUsd ?? null,
    pluginDirs: pluginDirs ?? null };
  _testing.seen.push(seen);
  check();                               // a turn stopped before it started shows and spends nothing (v5)

  if (behaviour === 'vanished' && resume) throw new Error(`No conversation found with session ID: ${resumeSessionId}`);
  if (behaviour === 'sideload-refused' && pluginDirs?.length) {
    emit({ type: 'log', text: SIDELOAD_REFUSAL });
    throw new Error('claude exited with code 1');
  }

  const hostSessionId = resumeSessionId || `mock-host-${++ids.host}`;
  seen.hostSessionId = hostSessionId;
  let turnSpend = 0;
  let resulted = false;
  const spend = (usd) => {
    const n = Number.isFinite(usd) ? usd : 0;
    _testing.spent.set(hostSessionId, (_testing.spent.get(hostSessionId) || 0) + n);
    turnSpend += n;
  };
  const cumulative = () => (_testing.spent.get(hostSessionId) || 0) - (lost.get(hostSessionId) || 0);
  const result = (fields) => { check(); resulted = true; raw({ type: 'result', session_id: hostSessionId, parent_tool_use_id: null, ...fields }); };
  const hostMessage = (content, withUsage) => raw({ type: 'assistant', parent_tool_use_id: null, session_id: hostSessionId,
    message: { id: `mock_h${++ids.call}`, role: 'assistant', model: model || 'mock-default', content, ...(withUsage ? { usage: { ...MOCK_HOST_USAGE } } : {}) } });
  const firstHostMessage = (content) => { check(); hostMessage(content, true); spend(priceUsage(model, MOCK_HOST_USAGE) || 0); };
  const callId = `mock_t${++ids.call}`;
  const agentCall = (input = {}) => ({ type: 'tool_use', id: callId, name: 'Agent', input: { subagent_type: agentType, prompt: CHILD_PROMPT, ...input } });
  const toolResult = (content, isError, meta) => raw({ type: 'user', parent_tool_use_id: null, session_id: hostSessionId,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: content }], ...(isError ? { is_error: true } : {}) }] },
    ...(meta ? { tool_use_result: meta } : {}) });
  const done = () => { hostMessage([{ type: 'text', text: 'DONE' }], false); };

  try {
    raw({ type: 'system', subtype: 'init', session_id: hostSessionId, model: model || 'mock-default', parent_tool_use_id: null });
    if (behaviour === 'budget' || behaviour === 'max-turns') {          // the CLI exits 1 after such a result (ask/events.mjs)
      result({ subtype: behaviour === 'budget' ? 'error_max_budget_usd' : 'error_max_turns', is_error: true, total_cost_usd: cumulative() });
      throw new Error('claude exited with code 1');
    }
    if (behaviour === 'no-dispatch') {
      firstHostMessage([{ type: 'text', text: 'already done' }]);
      result({ subtype: 'success', is_error: false, total_cost_usd: cumulative() });
      return { text: 'already done', exitCode: 0 };
    }
    if (WAITS.has(behaviour)) {                                          // an immediate kill (C11): the SessionHost aborts
      if (behaviour === 'stray-bash') firstHostMessage([{ type: 'tool_use', id: callId, name: 'Bash', input: { command: 'ls' } }]);
      else if (behaviour === 'model-override') firstHostMessage([agentCall({ model: 'opus' })]);
      else if (behaviour === 'wrong-type') firstHostMessage([agentCall({ subagent_type: 'general-purpose' })]);
      else firstHostMessage([agentCall()]);
      if (behaviour === 'two-dispatch') hostMessage([{ type: 'tool_use', id: `mock_t${++ids.call}`, name: 'Agent', input: { subagent_type: agentType, prompt: CHILD_PROMPT } }], false);
      if (behaviour === 'background') toolResult('Async agent launched successfully.', false, { isAsync: true, status: 'async_launched', agentId: `mock-agent-${++ids.agent}` });
      return await waitForKill(signal);
    }

    firstHostMessage([agentCall()]);
    check();
    const resolvedModel = definition.model || model || 'mock-default';
    const memberUsd = () => _testing.costFor?.({ agentType, turn }) ?? (priceUsage(resolvedModel, MOCK_MEMBER_USAGE) || 0);
    if (Object.hasOwn(MEMBER_ERRORS, behaviour)) {                      // the child never ran (or failed at once): no spend
      toolResult(MEMBER_ERRORS[behaviour], true, null);
      done();
      result({ subtype: 'success', is_error: false, total_cost_usd: cumulative() });
      return { text: 'DONE', exitCode: 0 };
    }
    if (behaviour === 'usage-limit') {
      spend(memberUsd());
      toolResult(USAGE_LIMIT_TEXT, true, null);
      throw Object.assign(new Error(USAGE_LIMIT_TEXT), { errorClass: 'usage_limit' });   // what the adapter stamps from stderr
    }
    _testing.onMemberStart?.({ agentType, turn });
    if (behaviour === 'hang') {
      raw({ type: 'assistant', parent_tool_use_id: callId, session_id: hostSessionId,
        message: { id: `mock_m${++ids.call}`, role: 'assistant', content: [{ type: 'text', text: '[mock] working' }] } });
      if (Number.isFinite(_testing.spendBeforeHang)) spend(_testing.spendBeforeHang);
      return await waitForKill(signal);
    }
    // The member's own frames: a frame without a parent is the member's, so it gets the bound call's id; a frame that
    // already has one (an investigator's, emitMockSubAgents) keeps it. The member's session and result never reach the host stream.
    const wrap = (e) => {
      if (!e || typeof e !== 'object' || e.type === 'session' || e.type === 'result') return;
      if (e.raw && typeof e.raw === 'object') emit({ ...e, raw: { ...e.raw, parent_tool_use_id: e.raw.parent_tool_use_id ?? callId } });
      else emit(e);
    };
    const out = await runMock({ cwd, systemPrompt, prompt: briefPrompt, signal, workspaceWriteTargets, permissionMode, onEvent: wrap });
    check();
    spend(memberUsd());
    toolResult(String(out?.text ?? ''), false, { usage: { ...MOCK_MEMBER_USAGE }, resolvedModel, totalDurationMs: 1, totalTokens: 5700,
      agentType, agentId: `mock-agent-${++ids.agent}` });
    if (behaviour === 'hooks') {
      const h = _testing.hookUsd || {};
      const hook = (toolUseId, usd) => emit({ type: 'hook-event', raw: { type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse',
        stdout: JSON.stringify({ tool_use_id: toolUseId, tool_response: { usage: { cost_usd: usd } } }) } });
      if (Number.isFinite(h.member)) hook(callId, h.member);
      if (Number.isFinite(h.investigator)) hook(`mock_i${++ids.call}`, h.investigator);
    }
    if (behaviour === 'stray-after-done') {
      hostMessage([{ type: 'tool_use', id: `mock_t${++ids.call}`, name: 'TodoWrite', input: { todos: [] } }], false);
      return await waitForKill(signal);
    }
    if (behaviour === 'host-error-after-member') throw new Error('claude exited with code 1');
    done();
    check();
    result(behaviour === 'no-cost' ? { subtype: 'success', is_error: false } : { subtype: 'success', is_error: false, total_cost_usd: cumulative() });
    return { text: 'DONE', exitCode: 0 };
  } finally {
    // A turn that ended without a result: its spend reaches a later cumulative only when the CLI restores it (S4).
    if (!resulted && turnSpend && !_testing.restoreCutCost) lost.set(hostSessionId, (lost.get(hostSessionId) || 0) + turnSpend);
  }
}
