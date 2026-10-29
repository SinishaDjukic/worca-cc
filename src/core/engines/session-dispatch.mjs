// src/core/engines/session-dispatch.mjs — NEW. Task 27 writes only this part; Task 31 appends the rest below it.
// The session host's dispatch contract (session groups, spec §5). A main agent that did not dispatch as told raises
// SessionHostError; its stamped errorClass is what classifyError returns (recoverable-error.mjs:27: a stamp is authoritative).

/** Watchdog codes (C1, C11, C20, Task 41). Every one classifies as `session_host`. */
export const SESSION_HOST_CODES = Object.freeze(['SESSION_HOST_NO_DISPATCH', 'SESSION_HOST_MULTI_DISPATCH', 'SESSION_HOST_STRAY_TOOL',
  'SESSION_HOST_VANISHED', 'SESSION_HOST_CAP', 'SESSION_HOST_BUDGET']);

export class SessionHostError extends Error {
  /** @param {string} code one of SESSION_HOST_CODES  @param {string} message  @param {object} [detail] ids, names and counts only */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SessionHostError';
    this.code = code;
    this.detail = detail;
    this.errorClass = 'session_host';   // C1: the failure-policy row `session_host`, whatever the message says
  }
}

export const isSessionHostError = (e) => e instanceof SessionHostError;

/** Hard limit of one host turn (Global Constraints). */
export const HOST_MAX_TURNS = 4;
/** S3 / Task 11 may set 'agent-only' (the host keeps only Agent/Task). */
export const HOST_TOOLS_MODE = 'union';
/** Definition fields the CLI rejects (S2). */
export const DROP_DEFINITION_FIELDS = [];
/** Does a child inherit the host's --model / --effort when its definition names none (S2; C26)? */
export const CHILD_INHERITS_PARENT = Object.freeze({ model: true, effort: true });
/** Permission-free built-ins an ungrouped member sees (S2; C32). */
export const MEMBER_BASE_TOOLS = Object.freeze(['TodoWrite']);
/** C4: the member's system prompt and its task prompt, joined in ONE definition prompt; the child's user message. */
export const BRIEF_DIVIDER = '\n\n<!-- worca: step brief -->\n\n';
export const CHILD_PROMPT = 'Begin your step.';

/** The host's system prompt (spec §5): one foreground dispatch per user message, then DONE. */
export const HOST_CONTRACT = [
  'You are the main agent of a worca session. You never do the work yourself.',
  'Each user message names exactly one sub-agent. Call the Agent tool exactly once, in the foreground, with that subagent_type, '
    + 'a short description and the prompt "Begin your step.", and with no other parameter. Never call any other tool. '
    + 'Never run it in the background. Never summarize, check or redo its work, and never answer from earlier turns: when a '
    + 'message says to dispatch, dispatch, even if an earlier attempt exists. When the sub-agent returns, reply with the '
    + 'single word DONE and call nothing else.',
].join('\n');

const HOST_DISPATCH_TOOLS = Object.freeze(['Agent', 'Task']);
/** The member's run-level options a host spawn keeps unchanged; everything else is set below or dropped. */
const RUN_LEVEL_FIELDS = Object.freeze(['cwd', 'mcpConfigPath', 'mcpServerGrants', 'mcpjsonProjectDir', 'noGit', 'workspaceWriteTargets',
  'permissionMode', 'addDirs', 'writableDirs', 'modelEnv', 'redactValues', 'disallowedTools', 'appendSubagentSystemPrompt', 'pluginDirs',
  'memoryLoadLog', 'permissionRules', 'envScrub', 'envAllowlist', 'asAgent', 'bin', 'engine', 'mock']);
/** C32: a definition always carries these, whatever S2 asks to drop (`tools` is never omitted). */
const KEEP_DEFINITION_FIELDS = new Set(['description', 'prompt', 'tools']);
const uniq = (...lists) => [...new Set(lists.flat().filter((t) => typeof t === 'string' && t))];

/** Unique per attempt (C31); starts `worca-x-` because every executionId starts `x:` (isMemberDispatch, sessions.mjs). */
export const agentTypeFor = (executionId, attempt) => `worca-${String(executionId).replace(/[^A-Za-z0-9_-]+/g, '-')}-a${attempt}`;
export const dispatchIdFor = (executionId, attempt) => `d:${executionId}:a${attempt}`;
export const turnIdFor = (sid, n) => `t:${sid}:${n}`;
/** The host's user message for one dispatch (verify major 2: it asks for the description the Agent tool requires). */
export const dispatchMessage = ({ agentType, label }) =>
  `Dispatch sub-agent ${agentType} (${label}) now: call the Agent tool once, in the foreground, with subagent_type "${agentType}", `
  + `a short description, the prompt "${CHILD_PROMPT}" and no other parameter. Dispatch again even if an earlier attempt exists. Then reply DONE.`;

/** The member as ONE sub-agent definition (C4, C32), plus its own investigator definitions unchanged. */
export function memberDefinition(opts, { executionId, attempt, label }, { dropFields = DROP_DEFINITION_FIELDS, baseTools = MEMBER_BASE_TOOLS } = {}) {
  const o = opts || {};
  const agentType = agentTypeFor(executionId, attempt);
  const def = {
    description: `${label} (worca step)`,
    prompt: `${o.systemPrompt || ''}${BRIEF_DIVIDER}${o.prompt || ''}`,
    tools: uniq(o.allowedTools || [], o.mcpServerGrants || [], baseTools || []),
    ...(o.model ? { model: o.model } : {}),
    ...(o.effort ? { effort: o.effort } : {}),
  };
  for (const f of dropFields || []) if (!KEEP_DEFINITION_FIELDS.has(f)) delete def[f];
  return { agentType, definitions: { ...(o.agents || {}), [agentType]: def } };
}

/** The host's --model / --effort for one dispatch (C26). `undefined` = omit the flag. */
export function hostFlagsFor({ settings, firstMemberModel, member, inherits = CHILD_INHERITS_PARENT } = {}) {
  const s = settings || {};
  const m = member || {};
  const model = s.hostModel ? s.hostModel : (!m.model && inherits.model ? undefined : (firstMemberModel || undefined));
  const effort = s.hostEffort ? s.hostEffort : (!m.effort && inherits.effort ? undefined : 'low');
  return { model, effort };
}

/** runClaude options for one host turn, built from the member's own runOpts (Task 31). */
export function hostSpawnOpts(memberOpts, { hostSessionId, hostModel, hostEffort, definitions, maxBudgetUsd, hostToolsMode = HOST_TOOLS_MODE,
  mainThreadGuard = null, dispatchText } = {}) {
  const m = memberOpts || {};
  const out = {};
  for (const k of RUN_LEVEL_FIELDS) if (m[k] !== undefined) out[k] = m[k];
  const agentOnly = hostToolsMode === 'agent-only';
  // v3 — agent-only: the host's --allowedTools is exactly Agent,Task. buildClaudeArgs unions mcpServerGrants into that
  // list (claude.mjs:372-378), so the grants go; the MCP config stays (the children reach their servers through the host).
  if (agentOnly) delete out.mcpServerGrants;
  return Object.assign(out, {
    systemPrompt: HOST_CONTRACT,
    prompt: dispatchText,
    resumeSessionId: hostSessionId || undefined,
    model: hostModel || undefined,
    effort: hostEffort || undefined,
    allowedTools: agentOnly ? [...HOST_DISPATCH_TOOLS] : uniq(HOST_DISPATCH_TOOLS, m.allowedTools || []),
    ...(agentOnly ? { tools: [...HOST_DISPATCH_TOOLS] } : {}),
    spawnEnv: { ...(m.spawnEnv || {}), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
    agents: definitions,
    agentsViaFile: true,
    forwardSubagentText: true,
    maxTurns: HOST_MAX_TURNS,
    ...(typeof maxBudgetUsd === 'number' && Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0 ? { maxBudgetUsd } : {}),
    ...(mainThreadGuard ? { mainThreadGuard } : {}),
  });
}
