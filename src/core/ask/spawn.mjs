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
//  - `--tools <list>` keeps ONLY the named built-ins (Task,Read,Grep,Glob — no
//    Bash/Write/Edit exist); MCP tools survive; `--allowedTools <list>,mcp__worca`
//    under dontAsk runs them without prompting; a deny rule wins over everything.
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the worca MCP server script — the `serverPath` of buildMcpConfig (P2 never guesses it). */
export const ASK_MCP_SERVER_PATH = fileURLToPath(new URL('./mcp-stdio.mjs', import.meta.url));
export const ASK_PERMISSION_MODE = 'dontAsk';
// 2026-08-30 (user decision): the chat holds the native READ-ONLY file tools —
// Read, Grep, Glob — instead of a worca-side reader. Known, ACCEPTED limits of
// the permission engine (gate E1, probed on claude 2.1.241, see
// askWorktreeAllowRules): a path in neither list is readable (`unmatched ⇒
// allow`), so the grant is effectively disk-wide minus ASK_DENY_RULES, and Grep
// was seen to ignore path denies (re-probed on 2.1.251: `unmatched ⇒ allow`
// persists; Grep DID honour a Read path deny that time). Never Bash/Write/Edit:
// a read cannot mutate.
export const ASK_BUILTIN_TOOLS = Object.freeze(['Task', 'Read', 'Grep', 'Glob']);
export const ASK_MCP_GRANTS = Object.freeze(['mcp__worca']);
// Deny beats allow, and the chat's worktrees live INSIDE the home
// (<home>/ask/<thread>/wt/…), so the home cannot be denied as a whole: worca's
// own state is enumerated instead — everything under the home except ask/.
// Path rules are `//` (filesystem root) or `~/` anchored; worcaHome() is never
// interpolated (its characters would be read as glob). `.worca-cc` is the home's
// conventional basename (a differently named WORCA_HOME simply does not match
// the home-relative denies — exactly as the old blanket deny did not).
export const ASK_DENY_RULES = Object.freeze([
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
  'Read(//**/worca-cc.db*)',           // the DB (+ -wal/-shm/backups), wherever the home is
  'Read(//**/worca.db*)',              // the pre-rename DB file, still present on older homes
  'Read(//**/secrets.json)',           // plugins/*/data/secrets.json and any other
  'Read(//**/.env*)',
  'Read(//**/.worca-cc/settings.json)',
  'Read(//**/.worca-cc/store/**)',     // run store: transcripts, logs, artifacts
  'Read(//**/.worca-cc/runs/**)',      // pipeline checkouts + per-run logs (run diffs come through get_run_diff, filtered)
  'Read(//**/.worca-cc/plugins/**)',
  'Read(//**/.worca-cc/tmp/**)',       // the chat's own scratch cwd (per-turn mcp-*.json)
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.gnupg/**)',
  'Read(~/.kube/**)',
  'Read(~/.docker/**)',
  'Read(~/.claude/**)',                // Claude Code's own credentials + session transcripts
  'Read(~/.netrc)',
  'Read(~/.npmrc)',
  'Read(~/.config/gh/**)',
]);
export const ASK_SPAWN_ENV = Object.freeze({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });

/**
 * The per-thread Read allow rule of the chat's worktrees (P4 §6). Explicit
 * intent more than enforcement: under the engine's measured `unmatched ⇒ allow`
 * (gate E1, claude 2.1.241 — a path in neither list is read, verified OUTSIDE
 * the process cwd; and Grep ignored both `Read(<path>)` and `Grep(<path>)`
 * denies) the rule changes nothing today, and a deny always wins over it. It
 * exists so that if the engine ever gains `unmatched ⇒ deny`, the chat keeps
 * reading its own worktrees without another change here. The thread id is
 * shape-checked so an unminted id can never reach a permission rule un-checked;
 * the resolved home is never interpolated.
 */
export function askWorktreeAllowRules(threadId) {
  if (typeof threadId !== 'string' || !/^ask_[0-9a-f]{8}$/.test(threadId)) return [];
  return [`Read(//**/.worca-cc/ask/${threadId}/wt/**)`];
}

export const SANDBOX_NOTE =
  "You are a sub-agent of Worca's assistant and run in the same sandbox: the only tools available are Task, Read, Grep, Glob and " +
  'the worca MCP tools (mcp__worca__*). You cannot run commands, edit files or use the network — do not try. ' +
  "The only view into a repository is this chat's read-only detached worktrees: list_worktrees/open_worktree give the path; Read, Grep and Glob work under that path (never elsewhere on disk), and the worca `git` tool serves history and diffs. " +
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
    permissionRules: { allow: askWorktreeAllowRules(thread.id), deny: [...ASK_DENY_RULES] },
    envScrub: true,
    // P4 §12 E3 (locked D12): ssh-remote `git fetch` needs the agent socket. The
    // spec said "the MCP child only"; granting it on the whole claude process is
    // acceptable because there is no Bash/sub-shell to leak it to.
    envAllowlist: ['SSH_AUTH_SOCK'],
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
