// The Ask Worca sandbox recipe (ask-worca-design.md §6.3 — read that section
// before touching this file). Pure: the caller computes scratchDir
// (join(worcaHome(), 'tmp', 'ask')), the model routing env and the mcp json path.
//
// Probed on claude 2.1.239 (2026-08-22):
//  - a cwd-relative deny rule (`Read(**/x)`) protects NOTHING outside the scratch
//    dir; every path rule here is `//` (filesystem root) or `~/` anchored, and
//    worcaHome() is never interpolated (its characters would be read as glob).
//  - Task sub-agents run in the BACKGROUND by default (async tool_result, two
//    `result` frames); CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 restores the
//    foreground shape. It rides modelEnv: merged last over the scrubbed env,
//    CLAUDE_-prefixed (survives scrub), not a reserved key.
//  - `--tools Task` removes every built-in (no Bash/Read/Write/Edit exist);
//    MCP tools survive; `--allowedTools Task,mcp__worca` under dontAsk runs them.
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the worca MCP server script — the `serverPath` of buildMcpConfig (P2 never guesses it). */
export const ASK_MCP_SERVER_PATH = fileURLToPath(new URL('./mcp-stdio.mjs', import.meta.url));
export const ASK_PERMISSION_MODE = 'dontAsk';
export const ASK_BUILTIN_TOOLS = Object.freeze(['Task']);
export const ASK_MCP_GRANTS = Object.freeze(['mcp__worca']);
export const ASK_DENY_RULES = Object.freeze([
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
  'Read(//**/.worca-cc/**)',          // every worca home: DB, store/, runs/**/repos, plugins/*/data/secrets.json
  'Read(//**/worca-cc.db*)',
  'Read(//**/secrets.json)',
  'Read(//**/.env*)',
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
]);
export const ASK_SPAWN_ENV = Object.freeze({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });
export const SANDBOX_NOTE =
  "You are a sub-agent of Worca's assistant and run in the same sandbox: the only tools available are Task and " +
  'the worca MCP tools (mcp__worca__*). You cannot read files, run commands or use the network — do not try. ' +
  'Answer from tool results only; never invent run data; return a short report.';

/** System-prompt-only mock markers (the runner parses the ask role from the SYSTEM prompt, Task 16). */
export function buildMockMarkers(card) {
  return `\n\nMOCK_ROLE: ask\nMOCK_ASK_CARD: ${JSON.stringify(card ?? {})}\n`;
}

/**
 * @param {object} o
 * @param {{id?:string, sessionId?:string|null}} o.thread
 * @param {{prompt:string, systemPrompt:string, model?:string, effort?:string, modelEnv?:object, signal?:AbortSignal, onEvent?:Function, mock?:{card:object}|null}} o.turn
 * @param {{maxTurns:number, maxBudgetUsd:number|null}} o.limits   from askLimits()
 * @param {string} o.mcpConfigPath   the per-turn mcp-<assistantMessageId>.json
 * @param {string} o.scratchDir      join(worcaHome(), 'tmp', 'ask') — ONE empty dir for all threads, never the home
 * @returns {object} runClaude options
 */
export function buildAskSpawnOptions({ thread = {}, turn = {}, limits = {}, mcpConfigPath, scratchDir } = {}) {
  if (!scratchDir) throw new Error('buildAskSpawnOptions: scratchDir is required');
  if (!mcpConfigPath) throw new Error('buildAskSpawnOptions: mcpConfigPath is required');
  const systemPrompt = String(turn.systemPrompt ?? '') + (turn.mock ? buildMockMarkers(turn.mock.card) : '');
  return {
    cwd: scratchDir,
    prompt: String(turn.prompt ?? ''),
    systemPrompt,
    model: turn.model,
    effort: turn.effort,
    modelEnv: { ...(turn.modelEnv || {}), ...ASK_SPAWN_ENV },
    permissionMode: ASK_PERMISSION_MODE,
    allowedTools: [...ASK_BUILTIN_TOOLS],
    mcpServerGrants: [...ASK_MCP_GRANTS],
    mcpConfigPath,
    permissionRules: { deny: [...ASK_DENY_RULES] },
    envScrub: true,
    envAllowlist: [],
    resumeSessionId: thread.sessionId || undefined,
    tools: [...ASK_BUILTIN_TOOLS],
    strictMcpConfig: true,
    settingSources: ['project'],
    disableSlashCommands: true,
    includePartialMessages: true,
    maxTurns: limits.maxTurns,
    maxBudgetUsd: limits.maxBudgetUsd ?? null,
    appendSubagentSystemPrompt: SANDBOX_NOTE,
    signal: turn.signal,
    onEvent: turn.onEvent,
  };
}

/**
 * The per-turn --mcp-config document (spec §6.4). `homeBase` is the RAW base
 * (path.resolve(process.env.WORCA_HOME) or dirname(worcaHome())) — never
 * worcaHome() itself. The argv twins make the child independent of env forwarding.
 */
export function buildMcpConfig({ homeBase, threadId, execPath = process.execPath, serverPath }) {
  if (!serverPath) throw new Error('buildMcpConfig: serverPath is required');
  if (typeof homeBase !== 'string' || !homeBase.trim()) throw new Error('buildMcpConfig: homeBase is required');
  const base = resolvePath(homeBase);
  const thread = String(threadId ?? '');
  return {
    mcpServers: {
      worca: {
        type: 'stdio',
        command: execPath,
        args: ['--disable-warning=ExperimentalWarning', serverPath, '--home', base, '--thread', thread],
        env: { WORCA_HOME: base, WORCA_ASK_THREAD_ID: thread },
      },
    },
  };
}
