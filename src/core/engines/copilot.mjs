// src/core/engines/copilot.mjs
// The GitHub Copilot CLI adapter: `copilot --output-format json` argv, the JSONL session-event
// stream normalized into worca's event vocabulary (src/core/engines/events.mjs), token usage from
// the CLI's cumulative per-session usage file, error classification, and the spawn path on the
// shared supervisor (engines/spawn.mjs).
//
// Facts this module encodes (checked against @github/copilot 1.0.92, its shipped
// schemas/session-events.schema.json, and a stand-in OpenAI Responses endpoint in BYOK mode):
// - With no -p, the prompt is read from stdin (no argv limit). `--allow-all-tools` is required
//   for a non-interactive run; a tool call that would still prompt (a path outside the cwd and
//   the --add-dir folders) is denied, never asked.
// - There is no system-prompt flag. A custom agent (`--agent <name>`) carries one: its markdown
//   body reaches the model as `<agent_instructions>`. Agents load from `<dir>/.github/agents`
//   of every `--add-dir`, so worca writes a scratch folder per spawn and adds it.
// - `--session-id <uuid>` names a new session up front; `--resume=<uuid>` continues it. An
//   unknown id fails with "No session, task, or name matched".
// - `--usage-output-file` gets the session's CUMULATIVE token totals (a resumed session's file
//   counts its earlier turns too); the stream carries no per-call usage in -p mode.
// - Deny rules (`--deny-tool`) beat --allow-all-tools. `shell(cmd)` / `shell(cmd sub)` match the
//   command (and git/gh sub-command) wherever it sits in a line — in a chain, behind a redirect,
//   a substitution or `VAR=x` — but not inside `bash -c "…"`, and a flag is not part of the
//   match (`shell(rm -rf)` lets `rm -rf x` run). `write` covers the file tools, not the shell.
//   `<server>(tool)` / `<server>` deny MCP tools.
// - `--available-tools a,b` keeps only those tools (an MCP server's name keeps all of its tools);
//   an EMPTY list keeps everything, so "no tools" is a list naming nothing that exists.
// - MCP servers come from `--additional-mcp-config @file` ({mcpServers:{name:{type:'local'|'http'|
//   'sse', …, tools:['*']}}}); `${VAR}` in an env value expands from the copilot process env.
//   `--disable-builtin-mcps` drops the built-in GitHub MCP server (it would act with the
//   signed-in GitHub identity, which worca otherwise keeps from its agents).
// - A failed session ends with `session.error` {errorType, message, statusCode} and exit 1.
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { superviseSpawn, composeSpawnEnv, cleanRunEnv, safeEmit, writableRootsInWorcaHome } from './spawn.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';
import { mcpResultText } from './codex.mjs';

export const COPILOT_DEFAULT_BIN = process.env.WORCA_COPILOT_BIN || 'copilot';

/** Stored session ids are engine-qualified so a resume never hands a Copilot session to
 *  another engine (or another engine's session to Copilot). */
export const COPILOT_SESSION_PREFIX = 'copilot:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Copilot session in a stored session id, or null when the id is not Copilot's. */
export function copilotSessionOf(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.startsWith(COPILOT_SESSION_PREFIX)) return null;
  const id = sessionId.slice(COPILOT_SESSION_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

/** What the adapter can do for worca. Only a literal false degrades:
 *  - cost: Copilot bills AI credits, not list-priced tokens, so worca reports the tokens and
 *    leaves the dollar cost unknown (a catalog price override still applies on top).
 *  - hookTelemetry: no hook stream reaches -p output.
 *  - turnBudget: no native turn cap (the adapter counts tool calls against maxTurns itself;
 *    `--max-ai-credits` is a credit cap, not worca's dollar cap). */
const COPILOT_FALSE = new Set(['cost', 'hookTelemetry', 'turnBudget']);
export const copilotCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !COPILOT_FALSE.has(k)])));

/** Copilot's reasoning-effort values (`--reasoning-effort`). */
export const COPILOT_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** The custom agent every spawn runs as (its body is the system prompt), and the investigator
 *  a fan-out node dispatches through the `task` tool. */
export const COPILOT_NODE_AGENT = 'worca-node';
export const COPILOT_INVESTIGATOR_AGENT = 'worca-investigator';
const DEFAULT_INVESTIGATOR_PROMPT = 'You are a read-only investigator dispatched by a worca pipeline agent. Investigate exactly what you were asked, in the directories you were given. Never edit, write, commit, branch or spawn sub-agents. Report concrete findings with file paths, then stop.';
const DEFAULT_NODE_PROMPT = 'You are an agent of a worca pipeline. Follow the task you are given.';

/** A tool list naming nothing that exists: `--available-tools` with it leaves the model no tools. */
export const COPILOT_NO_TOOLS = 'worca_no_tools';

// ── permission rules ─────────────────────────────────────────────────────────

/** How far a Copilot shell rule reaches (verified on @github/copilot 1.0.92). The gate and the run log say so. */
export const COPILOT_COMMAND_RULE_REACH = 'they catch the command wherever it sits in a shell line (a chain, a redirect, a substitution), but not one run through `bash -c "…"` or another interpreter';

/** A `Bash(…)` deny rule as a Copilot shell rule, or null when Copilot cannot express it: a glob or quote
 *  inside, or a flag (Copilot matches a command and its sub-command, never its flags). */
function shellRule(rule) {
  const m = /^Bash\((.+)\)$/.exec(String(rule).trim());
  if (!m) return null;
  const body = m[1].trim().replace(/(?::\*| \*)$/, '').trim();
  if (!body || /[*?"'`$\\()|;&<>]/.test(body)) return null;
  const words = body.split(/\s+/);
  if (words.some((w) => w.startsWith('-'))) return null;
  return words.length === 1 ? `shell(${words[0]}:*)` : `shell(${words.join(' ')})`;
}

/** An `mcp__server__tool` / `mcp__server` deny rule as Copilot's `server(tool)` / `server`, or null. */
function mcpRule(rule) {
  const m = /^mcp__([A-Za-z0-9_-]+?)(?:__([A-Za-z0-9_.-]+))?$/.exec(String(rule).trim());
  if (!m) return null;
  return m[2] && m[2] !== '*' ? `${m[1]}(${m[2]})` : m[1];
}

/** An `Edit(path)` / `Write(path)` / `MultiEdit(path)` deny rule as Copilot's `write(path)`, or null for a glob. */
function writeRule(rule) {
  const m = /^(?:Edit|Write|MultiEdit|NotebookEdit)(?:\((.*)\))?$/.exec(String(rule).trim());
  if (!m) return null;
  const path = (m[1] ?? '').trim();
  if (!path) return 'write';
  if (/[*?[\]{}]/.test(path)) return null;
  return `write(${path.replace(/^\.\//, '')})`;
}

/**
 * What Copilot can hold of a run's permission rules. Only DENY rules are worca policy (allow / ask are never
 * lifted, and copilot -p never asks). Each rule lands in one bucket:
 * - enforced: a bare `Bash` (the shell is denied outright), `WebSearch` (the tool is removed), an MCP rule
 *   (`server(tool)`). `WebFetch` removes the fetch tool, but copilot can still fetch a page through its shell
 *   (`curl`) or its web search: it is held only when the same rules deny both, else it is `unenforced`.
 * - partial: a `Bash(cmd…)` prefix (COPILOT_COMMAND_RULE_REACH) and an `Edit(path)` / `Write(path)` rule
 *   (Copilot's `write` covers its file tools, never a shell redirect). The run gate treats them like the
 *   rules it cannot hold (they need --allow-unguarded-engine); the spawn still applies them.
 * - unenforced: `Read(…)`, globs, a flag inside a command rule, anything else.
 * @returns {{deny:string[], excluded:string[], enforced:string[], partial:string[], unenforced:string[]}}
 */
export function copilotRulePlan(permissionRules) {
  const out = { deny: [], excluded: [], enforced: [], partial: [], unenforced: [] };
  const deny = Array.isArray(permissionRules?.deny) ? permissionRules.deny : [];
  const add = (list, v) => { if (!list.includes(v)) list.push(v); };
  const denied = new Set(deny.map((r) => String(r).trim()));
  const noFetch = denied.has('Bash') && denied.has('WebSearch');
  for (const raw of deny) {
    const rule = String(raw).trim();
    if (!rule) continue;
    if (rule === 'Bash') { add(out.deny, 'shell'); out.enforced.push(rule); continue; }
    if (rule === 'WebSearch') { add(out.excluded, 'web_search'); out.enforced.push(rule); continue; }
    if (rule === 'WebFetch') { add(out.excluded, 'web_fetch'); (noFetch ? out.enforced : out.unenforced).push(rule); continue; }
    const mcp = mcpRule(rule);
    if (mcp) { add(out.deny, mcp); out.enforced.push(rule); continue; }
    const shell = shellRule(rule);
    if (shell) { add(out.deny, shell); out.partial.push(rule); continue; }
    const write = writeRule(rule);
    if (write) { add(out.deny, write); out.partial.push(rule); continue; }
    out.unenforced.push(rule);
  }
  return out;
}

/** The deny rules Copilot cannot hold (the run gate's question). */
export function unenforcedRules(permissionRules) { return copilotRulePlan(permissionRules).unenforced; }

/** The deny rules Copilot holds only in part (COPILOT_COMMAND_RULE_REACH; write rules skip the shell). */
export function partialRules(permissionRules) { return copilotRulePlan(permissionRules).partial; }

/** Claude Code's tool names a spawn's allowedTools may hold, and the Copilot tools each one stands for. */
const SHELL_TOOLS = Object.freeze(['bash', 'read_bash', 'write_bash', 'stop_bash', 'list_bash']);

/**
 * The `--excluded-tools` / `--deny-tool` a Claude-style allowedTools list maps to. Copilot's file tools are
 * named per model (apply_patch, edit, create…), so what a list withholds rides permission kinds where it can:
 * no Bash ⇒ deny `shell`; no Edit/Write ⇒ deny `write`; no Task/Agent ⇒ no `task` tool; no WebFetch /
 * WebSearch ⇒ no web tools. undefined (no list) withholds nothing.
 */
export function copilotToolPlan(allowedTools) {
  const out = { deny: [], excluded: [] };
  if (!Array.isArray(allowedTools)) return out;
  const has = (...names) => allowedTools.some((t) => names.includes(String(t).replace(/\(.*$/, '')));
  if (!has('Bash')) { out.deny.push('shell'); out.excluded.push(...SHELL_TOOLS); }
  if (!has('Edit', 'Write', 'MultiEdit', 'NotebookEdit')) out.deny.push('write');
  if (!has('Task', 'Agent')) out.excluded.push('task');
  if (!has('WebFetch')) out.excluded.push('web_fetch');
  if (!has('WebSearch')) out.excluded.push('web_search');
  return out;
}

// ── MCP ──────────────────────────────────────────────────────────────────────

const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The servers of an --mcp-config document Copilot cannot attach: a bad name, or no command and no url. */
export function copilotUnattachableMcp(servers) {
  return Object.entries(servers && typeof servers === 'object' ? servers : {})
    .filter(([name, srv]) => !MCP_NAME_RE.test(name) || !srv || (typeof srv.command !== 'string' && typeof srv.url !== 'string'))
    .map(([name]) => name);
}

/**
 * Claude Code --mcp-config servers in Copilot's shape: stdio servers become `type: 'local'`, remote ones
 * keep `http` / `sse`, and every tool of an attached server is on (`tools: ['*']`, as on Claude). `${VAR}`
 * references stay as they are: Copilot fills them from its own env, where the adapter puts their values.
 */
export function copilotMcpServers(servers) {
  const out = {};
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (!MCP_NAME_RE.test(name) || !srv || typeof srv !== 'object') continue;
    if (typeof srv.command === 'string') {
      out[name] = { type: 'local', command: srv.command, args: Array.isArray(srv.args) ? srv.args.map(String) : [],
        ...(srv.env && typeof srv.env === 'object' ? { env: srv.env } : {}), ...(typeof srv.cwd === 'string' ? { cwd: srv.cwd } : {}), tools: ['*'] };
    } else if (typeof srv.url === 'string') {
      out[name] = { type: srv.type === 'sse' ? 'sse' : 'http', url: srv.url,
        ...(srv.headers && typeof srv.headers === 'object' ? { headers: srv.headers } : {}), tools: ['*'] };
    }
  }
  return out;
}

/** The env names every `${VAR}` reference in `servers` names (their values must reach the copilot env). */
export function mcpEnvRefNames(servers) {
  const names = new Set();
  const scan = (v) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(m[1]);
    else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') Object.values(v).forEach(scan);
  };
  scan(servers);
  return [...names];
}

/** The names of the user's own Copilot MCP servers (~/.copilot/mcp-config.json), which a spawn turns off:
 *  worca's guardrails never saw them. Never throws. */
export function userCopilotMcpNames(env = process.env) {
  const home = (env.COPILOT_HOME && env.COPILOT_HOME.trim()) || join(homedir(), '.copilot');
  try {
    const doc = JSON.parse(readFileSync(join(home, 'mcp-config.json'), 'utf8'));
    return Object.keys(doc?.mcpServers && typeof doc.mcpServers === 'object' ? doc.mcpServers : {}).filter((n) => MCP_NAME_RE.test(n));
  } catch { return []; }
}

// ── agents (system prompt + investigator) ───────────────────────────────────

/** A custom agent file: YAML frontmatter (JSON strings are valid YAML scalars) and the prompt as its body. */
export function copilotAgentFile({ name, description, prompt, tools, model }) {
  const lines = ['---', `name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`];
  if (Array.isArray(tools)) lines.push(`tools: ${JSON.stringify(tools)}`);
  if (typeof model === 'string' && model) lines.push(`model: ${JSON.stringify(model)}`);
  lines.push('---', '', String(prompt ?? '').trim() || DEFAULT_NODE_PROMPT, '');
  return lines.join('\n');
}

/**
 * The investigator a fan-out spawn's sub-agents run as: the `--agents` definition worca would hand Claude
 * (its prompt), plus the memory block, which Claude's sub-agents get through --append-subagent-system-prompt.
 * It runs on the node's model (a Claude definition's model id means nothing to Copilot) with read-only tools.
 */
export function copilotInvestigatorAgent({ agents, subagentSystemPrompt } = {}) {
  const def = agents && typeof agents === 'object' ? Object.values(agents)[0] : null;
  const prompt = [typeof def?.prompt === 'string' && def.prompt.trim() ? def.prompt.trim() : DEFAULT_INVESTIGATOR_PROMPT,
    typeof subagentSystemPrompt === 'string' ? subagentSystemPrompt.trim() : ''].filter(Boolean).join('\n\n');
  return copilotAgentFile({ name: COPILOT_INVESTIGATOR_AGENT,
    description: typeof def?.description === 'string' && def.description ? def.description : 'Read-only investigator for one area; reports its findings to the agent that dispatched it.',
    prompt, tools: ['view', 'rg', 'glob', ...SHELL_TOOLS] });
}

// ── argv ─────────────────────────────────────────────────────────────────────

/**
 * `copilot` argv. The prompt always travels on stdin.
 *   copilot --output-format json --allow-all-tools --no-ask-user --no-auto-update --no-color --disable-builtin-mcps
 *     [--disallow-temp-dir] (--session-id U | --resume=U) [--model M] [--reasoning-effort E] [--agent A]
 *     [--add-dir D]… [--additional-mcp-config @F] [--disable-mcp-server N]… [--available-tools=…]
 *     [--excluded-tools=…] [--deny-tool=R]… [--usage-output-file F]
 * @param {{sessionId:string, resume?:boolean, model?:string, effort?:string, agent?:string, addDirs?:string[],
 *   mcpConfigFile?:string, disableMcp?:string[], availableTools?:string[], excludedTools?:string[], deny?:string[],
 *   usageFile?:string, readOnly?:boolean}} o
 */
export function buildCopilotArgs({ sessionId, resume = false, model, effort, agent, addDirs, mcpConfigFile, disableMcp, availableTools, excludedTools, deny, usageFile, readOnly = false } = {}) {
  const args = ['--output-format', 'json', '--allow-all-tools', '--no-ask-user', '--no-auto-update', '--no-color', '--disable-builtin-mcps'];
  if (readOnly) args.push('--disallow-temp-dir');
  if (sessionId) args.push(resume ? `--resume=${sessionId}` : `--session-id=${sessionId}`);
  if (model) args.push('--model', String(model));
  if (effort && COPILOT_EFFORTS.includes(effort)) args.push('--reasoning-effort', effort);
  if (agent) args.push('--agent', agent);
  for (const d of [...new Set((Array.isArray(addDirs) ? addDirs : []).filter((x) => typeof x === 'string' && x))]) args.push('--add-dir', d);
  if (mcpConfigFile) args.push('--additional-mcp-config', `@${mcpConfigFile}`);
  for (const n of Array.isArray(disableMcp) ? disableMcp : []) args.push('--disable-mcp-server', n);
  if (Array.isArray(availableTools)) args.push(`--available-tools=${availableTools.length ? availableTools.join(',') : COPILOT_NO_TOOLS}`);
  if (Array.isArray(excludedTools) && excludedTools.length) args.push(`--excluded-tools=${[...new Set(excludedTools)].join(',')}`);
  for (const r of [...new Set(Array.isArray(deny) ? deny : [])]) args.push(`--deny-tool=${r}`);
  if (usageFile) args.push('--usage-output-file', usageFile);
  return args;
}

// ── usage ────────────────────────────────────────────────────────────────────

const ZERO_USAGE = Object.freeze({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });

/** The session's cumulative totals from a `--usage-output-file` document (summed over its models), or null. */
export function readCopilotUsage(doc) {
  const metrics = doc && typeof doc === 'object' && doc.modelMetrics && typeof doc.modelMetrics === 'object' ? Object.values(doc.modelMetrics) : null;
  if (!metrics) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const out = { ...ZERO_USAGE };
  for (const m of metrics) {
    const u = m?.usage || {};
    out.input += n(u.inputTokens); out.cached += n(u.cacheReadTokens); out.cacheWrite += n(u.cacheWriteTokens);
    out.output += n(u.outputTokens); out.reasoning += n(u.reasoningTokens);
  }
  return out;
}

function diffUsage(now, prior) {
  const out = {};
  for (const k of Object.keys(ZERO_USAGE)) out[k] = Math.max(0, (now[k] || 0) - (prior?.[k] || 0));
  return out;
}

/** A usage delta in the Claude-style keys worca's cost overrides read. Copilot's input count includes cached reads. */
function claudeStyleUsage(d) {
  return {
    input_tokens: Math.max(0, d.input - d.cached), cache_read_input_tokens: d.cached,
    cache_creation_input_tokens: d.cacheWrite, output_tokens: d.output,
  };
}

// ── stream ───────────────────────────────────────────────────────────────────

const text = (v) => (typeof v === 'string' ? v : '');

/** Copilot's built-in tools under the names worca's consumers know (Claude Code's). */
const TOOL_NAMES = Object.freeze({
  bash: 'Bash', read_bash: 'Bash', write_bash: 'Bash', stop_bash: 'Bash', list_bash: 'Bash',
  view: 'Read', rg: 'Grep', grep: 'Grep', glob: 'Glob',
  apply_patch: 'Edit', edit: 'Edit', str_replace: 'Edit', str_replace_editor: 'Edit', create: 'Write', write: 'Write',
  web_fetch: 'WebFetch', web_search: 'WebSearch',
});

function toolCall(d) {
  const name = text(d.toolName);
  const input = d.arguments && typeof d.arguments === 'object' ? d.arguments : {};
  if (d.mcpServerName && d.mcpToolName) return { name: `mcp__${d.mcpServerName}__${d.mcpToolName}`, input, toolUseId: d.toolCallId };
  const mapped = TOOL_NAMES[name];
  if (mapped === 'Read' && typeof input.path === 'string') return { name: mapped, input: { ...input, file_path: input.path }, toolUseId: d.toolCallId };
  if ((mapped === 'Edit' || mapped === 'Write') && typeof input.path === 'string') return { name: mapped, input: { ...input, file_path: input.path }, toolUseId: d.toolCallId };
  return { name: mapped || name, input, toolUseId: d.toolCallId };
}

function resultText(d) {
  if (d.success === false) return text(d.error?.message) || 'tool failed';
  const r = d.result;
  if (typeof r === 'string') return r;
  if (r && typeof r.content === 'string') return r.content;
  if (r && Array.isArray(r.contents)) return mcpResultText({ content: r.contents });
  return r == null ? '' : JSON.stringify(r);
}

/**
 * `copilot --output-format json` lines in, normalized events out (src/core/engines/events.mjs).
 * push(line|object) returns the events for that line; finish() returns { text, error, errorType,
 * sessionId, exitCode } for the whole run. `error` is set by a `session.error`, or by a final
 * `result` with a non-zero exitCode.
 * @param {{model?:string|null}} [o]
 */
export function createCopilotNormalizer({ model = null, sessionId: qualifiedId = null } = {}) {
  const texts = [];
  let initSent = false;
  const agentParent = new Map();   // sub-agent id -> the main-stream `task` call that spawned it
  const subagentCalls = new Set(); // `task` call ids: shown as sub-agent rows, not tool rows
  let error = null;
  let errorType = null;
  let sessionId = null;
  let exitCode = null;

  const parentOf = (evt) => {
    const d = evt.data || {};
    if (typeof d.parentToolCallId === 'string') return d.parentToolCallId;
    return typeof evt.agentId === 'string' && agentParent.has(evt.agentId) ? agentParent.get(evt.agentId) : null;
  };

  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object') return [];
    const d = evt.data && typeof evt.data === 'object' ? evt.data : {};
    switch (evt.type) {
      case 'session.tools_updated':
        // The first frame that names the model the session runs (worca's or copilot's own default): the init line.
        if (initSent || !qualifiedId) return [];
        initSent = true;
        return [{ type: 'session', sessionId: qualifiedId, model: text(d.model) || model || null, init: true }];
      case 'assistant.message': {
        const t = text(d.content);
        if (!t) return [];
        const parentId = parentOf(evt);
        if (parentId === null) texts.push(t);
        return [{ type: 'text', text: t, parentId, from: 'assistant', blocks: [t], ...(typeof d.messageId === 'string' ? { messageId: d.messageId } : {}) }];
      }
      case 'tool.execution_start': {
        if (typeof d.toolCallId !== 'string') return [];
        if (d.toolName === 'task') { subagentCalls.add(d.toolCallId); return []; }
        return [{ type: 'tool', parentId: parentOf(evt), calls: [toolCall(d)] }];
      }
      case 'tool.execution_complete': {
        if (typeof d.toolCallId !== 'string' || subagentCalls.has(d.toolCallId)) return [];
        const exit = d.shellExecution && Number.isFinite(d.shellExecution.exitCode) ? d.shellExecution.exitCode : 0;
        const out = resultText(d);
        return [{ type: 'toolResult', parentId: parentOf(evt), meta: null,
          results: [{ toolUseId: d.toolCallId, isError: d.success === false || exit !== 0, text: out, content: out }] }];
      }
      case 'subagent.started': {
        if (typeof d.toolCallId !== 'string') return [];
        if (typeof evt.agentId === 'string') agentParent.set(evt.agentId, d.toolCallId);
        subagentCalls.add(d.toolCallId);
        const label = text(d.agentDescription) || text(d.agentDisplayName) || 'Copilot sub-agent';
        return [{ type: 'subagent', event: 'spawn', toolUseId: d.toolCallId, label, description: label,
          ...(text(d.agentName) ? { subagentType: d.agentName } : {}), ...(text(d.model) ? { model: d.model } : {}) }];
      }
      case 'subagent.completed':
        return typeof d.toolCallId === 'string' ? [{ type: 'subagent', event: 'finish', toolUseId: d.toolCallId,
          ...(Number.isFinite(d.durationMs) ? { durationMs: d.durationMs } : {}), ...(Number.isFinite(d.totalTokens) ? { tokens: d.totalTokens } : {}),
          ...(text(d.model) ? { resolvedModel: d.model } : {}) }] : [];
      case 'subagent.failed':
        return typeof d.toolCallId === 'string' ? [{ type: 'subagent', event: 'error', toolUseId: d.toolCallId,
          ...(text(d.error) ? { errorText: d.error } : {}), ...(Number.isFinite(d.durationMs) ? { durationMs: d.durationMs } : {}) }] : [];
      case 'model.call_failure':
        // One failed model call that copilot retries itself (its session.error follows when it gives up).
        return [{ type: 'retry', parentId: parentOf(evt), httpStatus: Number.isFinite(d.statusCode) ? d.statusCode : null,
          reason: text(d.failureKind) || 'unknown' }];
      case 'assistant.turn_retry':
        return [{ type: 'retry', parentId: parentOf(evt), httpStatus: null, reason: text(d.reason) || 'unknown' }];
      case 'session.warning':
        return text(d.message) ? [{ type: 'stderr', stream: 'err', text: `copilot: ${d.message}` }] : [];
      case 'session.error':
        error = text(d.message) || 'copilot reported an error';
        errorType = text(d.errorType) || null;
        return [{ type: 'stderr', stream: 'err', text: `copilot: ${error}` }];
      case 'result':
        if (typeof evt.sessionId === 'string') sessionId = evt.sessionId;
        if (Number.isFinite(evt.exitCode)) exitCode = evt.exitCode;
        return [];
      default:
        return []; // deltas, turn bookkeeping, background-task ticks, skills/tools lists: nothing worca reads
    }
  }

  const finalError = () => error || (exitCode != null && exitCode !== 0 ? `copilot exited with code ${exitCode}` : null);
  return { push, finish: () => ({ text: texts.join('\n'), error: finalError(), errorType, sessionId, exitCode, model }) };
}

// ── errors and preflight ─────────────────────────────────────────────────────

/** Copilot's `session.error` errorType values, as worca's recovery classes. */
const ERROR_TYPES = Object.freeze({ authentication: 'auth', authorization: 'auth', quota: 'usage_limit', rate_limit: 'rate_limit' });

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyCopilotError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  if (err && typeof err === 'object' && typeof err.errorType === 'string' && ERROR_TYPES[err.errorType]) return ERROR_TYPES[err.errorType];
  const msg = String((err && err.message) || err || '');
  if (/\b40[13]\b|unauthorized|not (?:logged|signed) in|authentication failed|copilot login|no authentication|invalid (?:api key|token)|not authorized to use copilot/i.test(msg)) return 'auth';
  if (/premium request|ai credits?|monthly (?:limit|quota)|usage limit|session limits? (?:reached|exhausted)|quota exceeded/i.test(msg)) return 'usage_limit';
  if (/\b429\b|\b529\b|rate.?limit|too many requests|overloaded/i.test(msg)) return 'rate_limit';
  if (/insufficient_quota|billing/i.test(msg)) return 'quota';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)/i.test(msg)) return 'network';
  return null;
}

/** copilot's answer to `--resume=<unknown id>`. */
export const COPILOT_RESUME_NOT_FOUND_RE = /no session, task, or name matched/i;
export function copilotResumeNotFound(err) { return COPILOT_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')); }

/**
 * The engine's run-start check (engines/index.mjs `preflight`): the binary runs. Copilot has no
 * sign-in status command, so a signed-out CLI shows on the first spawn (an auth-class failure).
 * Never rejects: `{refusal}` when the binary cannot run, `{warning}` when the check itself failed, `{}` otherwise.
 */
export function copilotPreflight({ bin = COPILOT_DEFAULT_BIN, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, ['--version', '--no-auto-update'], { timeout: timeoutMs, env: { ...process.env, COPILOT_AUTO_UPDATE: 'false' } }, (err, stdout) => {
      if (err && typeof err.code !== 'number') {
        resolve(/^(ENOENT|EACCES|EINVAL)$/.test(String(err.code))
          ? { refusal: `cannot run ${bin} (${err.code}) — install the GitHub Copilot CLI (npm i -g @github/copilot), or point WORCA_COPILOT_BIN at it` }
          : { warning: `could not check ${bin} (${err.message})` });
        return;
      }
      if (err) { resolve({ warning: `${bin} --version exited with code ${err.code}` }); return; }
      resolve(/copilot/i.test(String(stdout)) ? {} : { warning: `${bin} --version did not name GitHub Copilot CLI` });
    });
  });
}

// ── spawn ────────────────────────────────────────────────────────────────────

const defaultUsageDir = () => join(worcaHome(), 'engines', 'copilot', 'usage');
const usageFileFor = (dir, session) => join(dir, `${session.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

function loadUsage(dir, session) {
  try { return { ...ZERO_USAGE, ...JSON.parse(readFileSync(usageFileFor(dir, session), 'utf8')) }; } catch { return null; }
}
function storeUsage(dir, session, usage) {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(usageFileFor(dir, session), JSON.stringify(usage)); } catch { /* best effort: a lost file only over-counts one resume */ }
}

/**
 * Run one Copilot turn. Same resolved value and rejection contract as the Claude adapter:
 * {text, exitCode}; an Error with `errorClass` on failure. The system prompt rides a scratch
 * custom agent; a read-only spawn (a helper job over untrusted text) gets no built-in tools —
 * only the MCP servers it was handed — and a scrubbed env. `maxTurns` caps the main agent's tool
 * calls: the call past it stops the turn with an error.
 */
export async function runCopilotProcess({
  cwd = process.cwd(), systemPrompt = '', prompt = '', model, effort, onEvent = () => {}, signal,
  bin = COPILOT_DEFAULT_BIN, resumeSessionId, addDirs, writableDirs, sandbox, envScrub, envAllowlist, asAgent, usageDir = defaultUsageDir(),
  mcpConfigPath, spawnEnv: runSpawnEnv, redactValues, maxTurns, askLockdown,
  permissionRules, allowedTools, agents, appendSubagentSystemPrompt, scratchBase = join(worcaHome(), 'tmp', 'copilot'),
} = {}) {
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  if (askLockdown) throw new Error(`${bin}: Ask Worca does not run on Copilot`);
  const secrets = Array.isArray(redactValues) ? redactValues : [];
  const redactor = secrets.length ? createRedactor(secrets) : null;
  if (redactor) { const emit = onEvent; onEvent = (e) => emit(redactor.deep(e)); }
  const redacted = (err) => {
    if (redactor && err && typeof err.message === 'string') err.message = redactor.text(err.message);
    if (redactor && err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
    return err;
  };
  let session = copilotSessionOf(resumeSessionId);
  if (resumeSessionId && !session) {
    safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] copilot: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not a Copilot session — starting a fresh one` });
  }
  const resume = !!session;
  if (!session) session = randomUUID();
  const sessionId = COPILOT_SESSION_PREFIX + session;
  const readOnly = sandbox === 'read-only';
  // Copilot writes the cwd and every --add-dir: none may reach Worca's own state, whose path rules it cannot hold.
  // A read-only spawn has no built-in tool and no added folder, so nothing is checked.
  if (!readOnly) {
    const inHome = writableRootsInWorcaHome({ cwd, roots: [...(addDirs || []), ...(writableDirs || [])] });
    if (inHome.length) throw new Error(`${bin}: refusing to start copilot — it would be able to write ${inHome.join(', ')}, inside Worca's home (${worcaHome()}), where Worca keeps its database, settings and plugins; copilot cannot hold the rules that protect them`);
  }
  const guardOn = hostGuardEnabled();
  const sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : String(systemPrompt || '');

  // MCP: the spawn's --mcp-config servers in Copilot's shape. `${VAR}` references stay references; their values
  // (the run's MCPSECRET_* names) join the copilot env, filled from this spawn's env plus the run's spawn env.
  const envOpts = { envScrub: envScrub || readOnly, envAllowlist, prefixes: ['COPILOT_'], hostPid: guardOn ? process.pid : null };
  let mcpServers = null;
  if (mcpConfigPath) {
    let doc;
    try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
    const all = doc && typeof doc.mcpServers === 'object' ? doc.mcpServers : {};
    const skipped = copilotUnattachableMcp(all);
    if (skipped.length) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] copilot cannot attach these MCP servers — not attached: ${skipped.join(', ')}` });
    mcpServers = copilotMcpServers(all);
  }
  const refEnv = {};
  if (mcpServers) {
    const from = composeSpawnEnv({ ...envOpts, runEnv: cleanRunEnv(runSpawnEnv) }).env;
    for (const n of mcpEnvRefNames(mcpServers)) if (typeof from[n] === 'string') refEnv[n] = from[n];
  }
  const { env } = composeSpawnEnv({ ...envOpts, ...(Object.keys(refEnv).length ? { runEnv: refEnv } : {}) });
  env.COPILOT_AUTO_UPDATE = 'false';

  // Scratch folder: the node agent (system prompt), the investigator, the MCP config and the usage file.
  const scratch = join(scratchBase, `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const agentsDir = join(scratch, '.github', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const cleanup = () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } };
  let mcpConfigFile = null;
  let usageFile = null;
  try {
    writeFileSync(join(agentsDir, `${COPILOT_NODE_AGENT}.agent.md`), copilotAgentFile({ name: COPILOT_NODE_AGENT, description: 'The worca pipeline agent for this call.', prompt: sys }), { mode: 0o600 });
    const fanOut = !readOnly && Array.isArray(allowedTools) && allowedTools.some((t) => t === 'Agent' || t === 'Task');
    if (fanOut) writeFileSync(join(agentsDir, `${COPILOT_INVESTIGATOR_AGENT}.agent.md`), copilotInvestigatorAgent({ agents, subagentSystemPrompt: appendSubagentSystemPrompt }), { mode: 0o600 });
    if (mcpServers && Object.keys(mcpServers).length) {
      mcpConfigFile = join(scratch, 'mcp-config.json');
      writeFileSync(mcpConfigFile, `${JSON.stringify({ mcpServers }, null, 2)}\n`, { mode: 0o600 });
    }
    usageFile = join(scratch, 'usage.json');
  } catch (err) {
    cleanup();
    throw new Error(`${bin}: cannot prepare the spawn: ${err.message}`);
  }

  // Guardrails and the tool set: deny rules worca can express, the per-role tool list, read-only.
  const rules = copilotRulePlan(permissionRules);
  const tools = readOnly ? { deny: [], excluded: [] } : copilotToolPlan(allowedTools);
  const args = buildCopilotArgs({
    sessionId: session, resume, model, effort, agent: COPILOT_NODE_AGENT,
    addDirs: [scratch, ...(readOnly ? [] : [...(addDirs || []), ...(writableDirs || [])])],
    mcpConfigFile, disableMcp: userCopilotMcpNames(env),
    // Read-only: no built-in tool at all (the shell and file tools would read the whole checkout's secrets);
    // only the MCP servers it was handed (worca's own read_file/grep/glob behind the secret-path denies).
    availableTools: readOnly ? Object.keys(mcpServers || {}) : undefined,
    excludedTools: [...rules.excluded, ...tools.excluded], deny: [...rules.deny, ...tools.deny], usageFile, readOnly,
  });
  const normalizer = createCopilotNormalizer({ model: model || null, sessionId });
  const priorUsage = resume ? loadUsage(usageDir, session) : null;
  // Pause/Resume: the session is named before copilot starts, so a step paused at any point resumes it. (The init
  // line, with the model copilot runs, follows from the stream.)
  safeEmit(onEvent, { type: 'session', sessionId });

  // maxTurns: the main agent's tool calls (sub-agent calls do not count).
  const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
  const capCtrl = new AbortController();
  let toolCalls = 0; let capped = false;
  const spawnSignal = cap ? (signal ? AbortSignal.any([signal, capCtrl.signal]) : capCtrl.signal) : signal;
  // The session's cumulative usage, read once copilot has written it: the delta is this turn's, stored for the next resume.
  const settleUsage = () => {
    let total = null;
    try { total = readCopilotUsage(JSON.parse(readFileSync(usageFile, 'utf8'))); } catch { /* no file: copilot died before writing it */ }
    if (total) storeUsage(usageDir, session, total);
    return total ? diffUsage(total, priorUsage) : null;
  };
  const res = await superviseSpawn({
    file: bin, args, displayBin: bin, cwd, env, stdin: String(prompt ?? ''), signal: spawnSignal, asAgent, stagedDir: asAgent ? scratch : null, onEvent,
    cleanup: () => {},
    redactText: redactor ? (t) => redactor.text(t) : null,
    stdoutErrorDetail: () => normalizer.finish().error || '',
    classify: (m) => classifyCopilotError(m),
    spawnError: (err, pfx) => Object.assign(new Error(`${pfx}: ${err.message}`), { errorClass: /ENOENT|EINVAL/.test(String(err.code || err.message)) ? 'network' : null }),
    onDone: (code) => ({ code }),
    onStdoutLine: (line) => {
      for (const e of normalizer.push(line)) {
        safeEmit(onEvent, e);
        if (cap && !capped && e.type === 'tool' && (e.parentId ?? null) === null && (toolCalls += Array.isArray(e.calls) ? e.calls.length : 1) > cap) {
          capped = true; capCtrl.abort();
        }
      }
    },
  }).catch((err) => {
    settleUsage();
    cleanup();
    const f = normalizer.finish();
    if (capped && !signal?.aborted) throw redacted(Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true }));
    // The session's own error (session.error on stdout) leads, and its class counts too.
    if (f.error && err?.name !== 'AbortError') {
      if (!String(err.message).includes(f.error)) err.message = `${bin}: ${f.error} — ${err.message}`;
      err.errorClass = strongestClass(err.errorClass ?? null, classifyCopilotError({ errorType: f.errorType, message: f.error }));
    }
    throw redacted(err);
  });
  const delta = settleUsage();
  cleanup();
  const final = normalizer.finish();
  if (capped && !signal?.aborted) throw redacted(Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true }));
  if (final.error) {
    const err = new Error(`${bin}: ${final.error}`);
    err.errorClass = classifyCopilotError({ errorType: final.errorType, message: final.error });
    throw redacted(err);
  }
  const out = redactor ? redactor.text(final.text) : final.text;
  safeEmit(onEvent, { type: 'result', text: out, isError: false, sessionId, ...(delta ? { usage: claudeStyleUsage(delta) } : {}) });
  return { text: out, exitCode: res.code };
}
