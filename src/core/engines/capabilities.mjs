// src/core/engines/capabilities.mjs
// The capability keys an engine adapter declares (plans/harness-bridge-design.md §6).
// Declared, never probed at spawn. A missing key means capable; only a literal
// `false` degrades (the first false arrives with a non-Claude adapter).
export const CAPABILITY_KEYS = Object.freeze([
  'resume', 'systemPromptFlag', 'allowedTools', 'effort', 'cost', 'subagents',
  'hookTelemetry', 'streamEvents', 'skills',
  'mcpTools', 'permissionRules', 'subagentSystemPrompt', 'turnBudget',
]);

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
