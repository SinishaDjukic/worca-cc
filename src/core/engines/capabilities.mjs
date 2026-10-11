// src/core/engines/capabilities.mjs
// The capability keys an engine adapter declares.
// Declared, never probed at spawn. A missing key means capable; only a literal
// `false` degrades (the first false arrives with a non-Claude adapter).
export const CAPABILITY_KEYS = Object.freeze([
  'resume', 'systemPromptFlag', 'allowedTools', 'effort', 'cost', 'subagents',
  'hookTelemetry', 'streamEvents', 'skills',
  'mcpTools', 'permissionRules', 'subagentSystemPrompt', 'turnBudget',
]);

/** Why an engine cannot attach an MCP server, as an adapter's `unattachableMcp` gives it (engines/index.mjs). */
export const MCP_NAME_RULE = 'only letters, digits, _ and -, at most 64 characters';
const MCP_REASON_ORDER = ['remote', 'name', 'incomplete'];
const mcpReasonText = (reason, engine) => (reason === 'remote' ? `remote, and ${engine} attaches stdio servers only`
  : reason === 'name' ? `a name ${engine} cannot use (${MCP_NAME_RULE})` : 'no command and no url');

/** `{name, reason}` entries from an adapter's `unattachableMcp`, grouped by reason in words:
 *  `remote, and codex attaches stdio servers only: web; a name codex cannot use (…): bad.name`. */
export function describeUnattachableMcp(engine, problems) {
  const by = new Map();
  for (const p of Array.isArray(problems) ? problems : []) by.set(p.reason, [...(by.get(p.reason) || []), p.name]);
  return [...by.keys()].sort((a, b) => MCP_REASON_ORDER.indexOf(a) - MCP_REASON_ORDER.indexOf(b))
    .map((r) => `${mcpReasonText(r, engine)}: ${by.get(r).join(', ')}`).join('; ');
}

/** What worca does when an engine declares a capability `false` — one line per
 *  key, written to the run log and the audit trail at run start. */
export const CAPABILITY_FALLBACKS = Object.freeze({
  resume: 'interrupted nodes re-run fresh; stored session ids are ignored',
  systemPromptFlag: 'the system prompt is folded into the user prompt behind a delimiter',
  allowedTools: 'the per-role tool restriction is dropped; the engine runs its own tool set',
  effort: 'the per-role effort hint is dropped',
  cost: 'cost cells stay blank and totals stay 0 (cost unknown, not free)',
  subagents: 'no sub-agent tool is granted; research fan-out runs serially',
  hookTelemetry: 'no per-sub-agent hook telemetry',
  streamEvents: 'no incremental output; progress shows when the node ends',
  skills: 'no Skill tool over .claude/skills; skills are not injected',
  mcpTools: 'no MCP servers are attached (a node that needs MCP tools is refused)',
  permissionRules: 'guardrail allow/deny rules and the host-guard hook cannot be enforced (the host-guard preamble still is)',
  subagentSystemPrompt: 'the memory block reaches the main agent only; sub-agents get none',
  turnBudget: "no harness-native turn or spend cap; worca's own caps still apply",
});
