// src/core/claude-runner.mjs
// Spawn Claude Code headless and stream its events, with a fully offline MOCK
// mode that performs the same role-appropriate side effects so the whole
// pipeline can run end-to-end without spawning claude or spending tokens.
//
// ── MOCK MARKER PROTOCOL (shared with phases.mjs) ────────────────────────────
// In mock mode the runner does not call any model. Instead it reads simple
// markers embedded (one per line) in the `prompt` (and, as a fallback, the
// `systemPrompt`). The phases layer is responsible for emitting these markers.
//
//   MOCK_ROLE: <role>      one of:
//                            clarify | planner-plan |
//                            refiner | implementer | reviewer
//   MOCK_OUT: <path>       primary output artifact path (absolute)
//                          - clarify : clarify.json path
//                          - planner-plan    : plan .md path
//                          - refiner         : output -vN plan .md path
//                          - reviewer        : review .md path
//   MOCK_JSON: <path>      review json path (refiner + reviewer)
//   MOCK_CYCLE: <n>        loop cycle number (refiner + reviewer)
//   MOCK_IN: <path>        input plan path (refiner; optional, used to seed -vN)
//   MOCK_BASE: <name>      base slug (optional, used for nicer mock content)
//   MOCK_ASK: <path>       ask-then-resume questions file (per-step user
//                          questions). When present the mock writes ONE canned
//                          question there and STOPS (no role side effects); the
//                          resumed prompt carries no MOCK_ASK, so the role arm
//                          runs then.
//   MOCK_ASK_FORM: <json>  a ONE-LINE {"form","data"} payload. When present it is
//                          written verbatim instead of the canned {questions}
//                          body — to MOCK_ASK for a producer, to MOCK_OUT for the
//                          clarify role. Lets an offline mock agent exercise the
//                          ask-form protocol end to end.
//
// Markers are matched leniently: "KEY: value" anywhere at the start of a line,
// case-sensitive keys, value trimmed. Missing markers degrade gracefully.
// The mock is deterministic: blocking-issue counts decrease with cycle so the
// orchestrator's refine/review loops always terminate.
// ─────────────────────────────────────────────────────────────────────────────

import { envFlag } from './model-env.mjs';
import { DEFAULT_BIN } from './engines/claude.mjs';
import { getEngine } from './engines/index.mjs';
import { recordMockSpawn as recordMockSpawnImpl } from './engines/mock.mjs';
export {
  buildClaudeArgs, buildEffortArgs, buildSettingsPayload, buildSettingsArgs, buildHookSettings, buildHookArgs,
  subagentHooksEnabled, debugSpawnEnabled, ARGV_INLINE_LIMIT, argvLength, redactArgvForLog,
  planClaudeInvocation, stageClaudeInvocation, extractResultCost, BENIGN_STDERR_PATTERNS, isBenignStderrLine, brokerRouteFor, isHookEvent,
} from './engines/claude.mjs';
export { DEFAULT_SIGKILL_GRACE_MS, sigkillGraceMs, buildSpawnEnv, cleanRunEnv, SPAWN_ENV_BASE } from './engines/spawn.mjs';
export { MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER, MOCK_ROLE_MEMORY_DEFRAG, memoryDirsFromPrompt, mockSpawnLog, recordMockSpawn } from './engines/mock.mjs';

/**
 * Whether mock mode is active. Driven by WORCA_MOCK or an explicit opts.mock
 * passed through by the orchestrator (handled by caller mapping mock->env or
 * by passing systemPrompt/prompt markers; we also honor a `mock` field).
 */
export function mockEnabled(opts) {
  if (opts && opts.mock) return true;
  return envFlag('WORCA_MOCK', 'ORCH_MOCK');
}

/**
 * Run Claude headless (or the mock). Streams events via onEvent and resolves
 * with the accumulated assistant/result text and the process exit code.
 *
 * @param {object} o
 * @param {string} o.cwd                 working directory for claude
 * @param {string} [o.systemPrompt]      appended system prompt
 * @param {string} o.prompt              the user prompt (-p)
 * @param {string[]} [o.allowedTools]    e.g. ["Read","Write","Edit","Bash"]
 * @param {string} [o.permissionMode]    e.g. "acceptEdits"
 * @param {string} [o.model]             optional model id
 * @param {string} [o.effort]            optional reasoning effort
 * @param {(e:{type:string})=>void} [o.onEvent]  receives the normalized event vocabulary
 *   (src/core/engines/events.mjs), never raw stream-json envelopes
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.resumeSessionId]   resume a previous claude session (--resume)
 * @param {string} [o.bin]               claude binary (default "claude")
 * @param {boolean} [o.mock]             force mock mode
 * @param {string} [o.mcpConfigPath]     §5.5 generated <runRoot>/mcp.json (--mcp-config)
 * @param {string[]} [o.mcpServerGrants] §5.3 `mcp__<server>` grants unioned into --allowedTools
 * @param {{deny?:string[],allow?:string[],ask?:string[]}} [o.permissionRules] guardrail permission
 *   rules merged into the single `--settings` payload (absent => argv unchanged)
 * @param {boolean} [o.envScrub]         guardrail: spawn with a minimal env instead of
 *   inheriting process.env (absent/false => spawn inherits, today's behavior)
 * @param {string[]} [o.envAllowlist]    guardrail: extra env var names to keep under scrub
 * @param {Record<string,string>} [o.modelEnv] per-model routing env (design §4.4), merged
 *   LAST over the spawn env (it survives scrub and wins collisions — explicit operator
 *   config outranks ambient-env hygiene); reserved keys are re-dropped here defensively.
 *   An ANTHROPIC_MODEL key is the WIRE id (#374): it replaces `model` in the spawned
 *   `--model` flag, while `model` (the catalog id) stays worca's handle everywhere else
 * @param {string[]} [o.workspaceWriteTargets] §8.10 MOCK-ONLY member checkouts the mock
 *   implementer writes into instead of `cwd` (empty/absent => today's cwd behavior).
 *   Never reaches argv: `runClaudeProcess` ignores it by construction.
 * @param {string[]} [o.tools]              --tools <list>: the built-in tool allowlist ([] ⇒ `--tools ""`,
 *   no built-ins at all; MCP tools are unaffected). Absent ⇒ flag omitted (claude defaults).
 * @param {boolean} [o.strictMcpConfig]     --strict-mcp-config: only --mcp-config servers load
 * @param {string[]} [o.settingSources]     --setting-sources <list> (e.g. ['project'] drops user hooks/plugins/skills)
 * @param {boolean} [o.disableSlashCommands] --disable-slash-commands
 * @param {boolean} [o.includePartialMessages] --include-partial-messages (stream_event text deltas)
 * @param {number} [o.maxTurns]             --max-turns <n> (positive safe integer; else omitted)
 * @param {number|null} [o.maxBudgetUsd]    --max-budget-usd <n> (finite > 0; null/else omitted)
 * @param {string} [o.appendSubagentSystemPrompt] --append-subagent-system-prompt <text> (Task children only)
 * @param {string[]} [o.addDirs]            --add-dir <dir> per entry (Ask Worca's memory mount and every pipeline spawn's writable memory copy; the CLI loads <dir>/.claude/rules only with CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 in the env — memory-deps.mjs / spawn.mjs set it)
 *   All nine are Ask Worca sandbox options (ask-worca-design.md §6.3) and default-off.
 * @param {number} [o.argvInlineLimit]     override ARGV_INLINE_LIMIT (GH #380; tests force the staged path)
 * @param {string[]} [o.disallowedTools]   --disallowedTools <list>: built-ins withheld from this spawn
 *   (model bridge §5.3: WebSearch/WebFetch for a translated model). Absent/empty ⇒ flag omitted.
 * @param {Record<string, object>} [o.agents]  run-scoped sub-agent definitions (--agents; phases.mjs investigatorAgents)
 * @param {string[]} [o.pluginDirs]  --plugin-dir <dir> per entry (skills registry §4.1: one generated plugin per set,
 *   materializeSkillMount). Absent/empty/non-strings ⇒ nothing emitted.
 * @param {object} [o.extraSettings]  merged into the one --settings payload (skills registry §4.1: Ask's
 *   `disableSkillShellExecution`); never replaces `permissions` / `hooks`. Absent ⇒ unchanged.
 * @param {Record<string,string>} [o.spawnEnv]  run-level spawn env (wsmap D9: runOpts sets
 *   CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY on every fan-out node, and CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
 *   on the scan's two). Merged OVER the guardrail env and UNDER modelEnv (a catalog entry that sets the
 *   same key wins); string values only, reserved keys (isReservedModelEnvKey) dropped (cleanRunEnv).
 *   Absent ⇒ the spawn env is byte-identical.
 * @param {string[]} [o.redactValues]  secret values to redact (MCP registry §5.5.3: the spawn's registry secrets):
 *   every event, the result text and error messages, on the direct and the broker path. Absent ⇒ unchanged.
 * @returns {Promise<{text:string, exitCode:number}>}
 */
export async function runClaude(o = {}) {
  // NOTE: this destructure + the engine.run call below are the GATE, not a
  // pass-through. Every field must be named in BOTH places or it is silently
  // dropped before runClaudeProcess sees it — a field added only to buildClaudeArgs would
  // never reach argv while a builder-only test still passed
  // (test/spawn-args.test.mjs asserts the forwarding end to end).
  const {
    cwd = process.cwd(),
    systemPrompt = '',
    prompt = '',
    allowedTools,
    permissionMode = 'acceptEdits',
    model,
    effort,
    onEvent = () => {},
    signal,
    mcpConfigPath,
    mcpServerGrants,
    permissionRules,
    envScrub,
    envAllowlist,
    modelEnv,
    spawnEnv,
    redactValues,
    disallowedTools,
    workspaceWriteTargets,
    resumeSessionId,
    // Ask Worca sandbox hardening (ask-worca-design.md §6.3/§6.8). All default-off:
    // undefined here ⇒ nothing emitted ⇒ every legacy argv stays byte-identical.
    tools,
    strictMcpConfig,
    settingSources,
    disableSlashCommands,
    includePartialMessages,
    maxTurns,
    maxBudgetUsd,
    appendSubagentSystemPrompt,
    addDirs,
    // Directories a node writes outside its cwd (phases.mjs#runOpts). The Claude adapter
    // ignores it; codex adds each one as a writable sandbox root.
    writableDirs,
    sandbox,
    // Ask Worca on Codex (cascading-settings-design.md §4.6): the lockdown + worca MCP server, and this turn's
    // image attachments (-i). The Claude adapter ignores both; undefined everywhere else.
    askLockdown,
    images,
    agents,
    pluginDirs,
    extraSettings,
    argvInlineLimit,
    // A pipeline agent (phases.mjs): runs as WORCA_AGENT_USER when the container set one
    // up (agent-user.mjs). Server-side helpers and Ask Worca leave it unset.
    asAgent,
    // Which engine adapter runs this spawn (engines/index.mjs). Default claude.
    engine: engineName,
    // Credential broker (broker-client.mjs): who pays for this spawn, what kind it is (sets
    // its token's lifetime), and the run/thread it belongs to. All optional: the person
    // otherwise comes from the async context (billing.mjs). Ignored with the broker off.
    billTo,
    spawnKind,
    runId,
    threadId,
    bin = DEFAULT_BIN,
  } = o;

  if (signal?.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }

  const engine = getEngine(engineName || 'claude', { mock: mockEnabled(o) });
  if (engine.name === 'mock') {
    recordMockSpawnImpl({ engine: engineName || 'claude', sandbox, model });
    // runMock spawns nothing, so the MCP fields are meaningless to it —
    // workspaceWriteTargets is the one option that is mock-ONLY (§8.10) and it must be
    // named HERE too, or the mock implementer never sees it (this call is a gate, not
    // a pass-through; test/spawn-args.test.mjs asserts the forwarding end to end).
    return engine.run({ cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets, permissionMode });
  }

  return engine.run({
    cwd,
    systemPrompt,
    prompt,
    allowedTools,
    permissionMode,
    model,
    effort,
    onEvent,
    signal,
    // A non-Claude engine has its own default binary: only a caller's explicit
    // `bin` reaches it (the Claude default must not).
    bin: engine.name === 'claude' || o.bin ? bin : undefined,
    resumeSessionId,
    mcpConfigPath,
    mcpServerGrants,
    permissionRules,
    envScrub,
    envAllowlist,
    modelEnv,
    spawnEnv,
    redactValues,
    disallowedTools,
    tools,
    strictMcpConfig,
    settingSources,
    disableSlashCommands,
    includePartialMessages,
    maxTurns,
    maxBudgetUsd,
    appendSubagentSystemPrompt,
    addDirs,
    writableDirs,
    sandbox,
    askLockdown,
    images,
    agents,
    pluginDirs,
    extraSettings,
    argvInlineLimit,
    asAgent,
    billTo,
    spawnKind,
    runId,
    threadId,
  });
}
