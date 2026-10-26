// src/core/engines/qwen.mjs
// The Qwen Code adapter: `qwen --output-format stream-json` argv, its Claude-shaped stream read through the Claude
// normalizer (engines/claude-events.mjs; no cost: Qwen reports tokens only), error classes, the run-start preflight,
// and the guardrail rules and MCP servers written to a system settings file outside the checkout. The spawn path is
// the family runner (engines/gemini-family.mjs), shared with Gemini CLI, of which Qwen Code is a fork.
//
// Facts this module builds on, verified on @qwen-code/qwen-code 0.25.0 (test/fixtures/qwen/README.md):
// - `qwen --output-format stream-json` with the prompt on stdin runs headless. The stream is Claude Code's shape:
//   `system`/`init` (session_id, model, mcp_servers), `assistant` (text, thinking and tool_use blocks, per-message
//   usage), `user` (tool_result blocks), one final `result` (is_error, result, usage, permission_denials; no cost; on
//   failure `error.message`), plus `stream_event` frames worca ignores. MCP tools are named `mcp__<server>__<tool>`
//   and are often called through the `tool_call` meta tool (input {name, arguments}); the normalizer unwraps it.
// - `--session-id <uuid>` names a new session; `--resume <uuid>` continues one and answers an unknown id with exit 1 and
//   "No saved session found with ID" on stderr.
// - `--approval-mode yolo` runs every tool without asking (headless runs cannot ask). Deny rules hold in Claude's own
//   syntax (`Bash(git push:*)`, `Read(./.env)`, `WebFetch`, `mcp__server__tool`) from `permissions.deny` in any
//   settings file; a Read rule also stops the shell from reading that file, but an Edit or Write rule stops only the
//   file tools: the shell still writes that file (`echo > f`, `sed -i`). A command rule matches the command's start,
//   so `env git log` gets past `Bash(git log:*)`.
// - `QWEN_CODE_SYSTEM_SETTINGS_PATH` names the system settings file for any owner, and it fills `${VAR}` from qwen's env,
//   so worca's servers and rules need nothing in the checkout. (`--mcp-config` does NOT fill `${VAR}`.) The machine's
//   own system settings file is merged into worca's copy, so setting the path never drops it.
// - `--allowed-mcp-server-names` keeps every other server (the user's ~/.qwen ones, the checkout's) off.
// - `--append-system-prompt` reaches the model. `--max-session-turns` does not cap tool calls (worca counts them).
// - Sign-in: `security.auth.selectedType` in the user settings (~/.qwen, or QWEN_HOME), or env naming a whole provider
//   (getAuthTypeFromEnv below), also from ~/.qwen/.env. A key alone is "No auth type is selected".
// - Not used (capability false): sub-agents, hooks, skills, a per-spawn tool list, a turn cap. Effort is the system
//   settings' `model.reasoningEffort`.
//
// Chat (Ask Worca) on Qwen Code, verified on 0.26.1 against a local model endpoint (plans/ask-on-qwen-gemini-spike.md):
// - `--core-tools` is an allowlist of the CORE built-ins only (read_file, write_file, edit, run_shell_command, web_fetch,
//   …): a name that is none of them leaves none. The other built-ins (agent, skill, send_message, the worktree, goal,
//   cron, team and workflow tools, tool_search / tool_call) ignore it, and `--exclude-tools` removes them: the call is
//   refused ("Matching deny rule") and the tool is not offered. MCP tools are offered as `mcp__<server>__<tool>`.
// - With `tools.toolSearch.enabled` on (the default) MCP and other tools are deferred behind tool_search / tool_call and
//   NOT in the offered list; off, every registered tool is offered, so the list the model sees is the whole set.
// - System settings (QWEN_CODE_SYSTEM_SETTINGS_PATH) are merged last and win over the user's and the workspace's.
// - `--bare` ignores `--core-tools` (its own small set includes the shell) and `--safe-mode` ignores it too, so neither
//   is used. Hooks, the tool discovery / call commands, the MCP server command and the background memory agents (which
//   keep read_file / write_file / edit of their own whatever the flags say) are switched off in worca's system settings.
// - ~/.qwen/.env (and ~/.env) set any env name that is unset or empty, overriding settings: QWEN_CODE_MEMORY_TEAM=1
//   there starts a memory agent with file tools, QWEN_CODE_SAFE_MODE=1 drops the core allowlist. The chat's env sets
//   every such switch (QWEN_ASK_ENV) to a non-empty value, and the self-test runs with the user's real files.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { createClaudeNormalizer } from './claude-events.mjs';
import {
  claudeToolName, commandRuleBody, familyMcpServers, classifyFamilyError, familyPreflight, runFamilyProcess,
  homeOf, readDotenv, settingsAuthType, foldSystemPrompt, NO_MCP_SERVER, FAMILY_ARGV_LIMIT, absolutePaths,
  familyAskSupport, mergeSettings,
} from './gemini-family.mjs';
import { makeChatDescriptor } from './chat-descriptor.mjs';
import { QWEN_EFFORTS } from '../model-env.mjs';
import { chatSelfTest, SELF_TEST_MODEL } from './chat-selftest.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const qwenDefaultBin = () => process.env.WORCA_QWEN_BIN || 'qwen';
export const QWEN_SESSION_PREFIX = 'qwen:';

const QWEN_FALSE = new Set(['allowedTools', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
/** Qwen Code's reasoning-effort tiers (its settings' `model.reasoningEffort`, written into worca's system settings). A
 *  model without reasoning ignores it; Qwen clamps a tier its model lacks. */
export { QWEN_EFFORTS };
const QWEN_EFFORT_SET = new Set(QWEN_EFFORTS);
export const qwenCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !QWEN_FALSE.has(k)])));

/** Every built-in tool name of Qwen Code 0.26.1 (its ToolNames). A chat excludes them all (`--exclude-tools`); a tool a
 *  newer Qwen Code adds is caught by the chat self-test (engines/chat-selftest.mjs), which refuses the chat. */
export const QWEN_BUILTIN_TOOLS = Object.freeze([
  'exec', 'edit', 'write_file', 'read_file', 'zoom_image', 'grep_search', 'glob', 'run_shell_command', 'todo_write',
  'save_memory', 'manage_memory', 'search_memory', 'agent', 'skill', 'exit_plan_mode', 'enter_plan_mode', 'web_fetch',
  'web_search', 'image_gen', 'list_directory', 'lsp', 'ask_user_question', 'cron_create', 'cron_list', 'cron_delete',
  'loop_wakeup', 'create_sub_session', 'list_agents', 'task_stop', 'task_create', 'task_update', 'task_list',
  'team_create', 'team_delete', 'team_plan_approval', 'request_shutdown', 'send_message', 'structured_output', 'monitor',
  'notebook_edit', 'tool_call', 'tool_search', 'read_mcp_resource', 'advisor', 'enter_worktree', 'exit_worktree',
  'workflow', 'artifact', 'record_artifact', 'record_source', 'report_findings', 'get_goal', 'update_goal',
  'omni_downsample_image', 'omni_downscale_video', 'omni_downsample_audio', 'omni_extract_keyframes', 'omni_extract_audio',
  'omni_clip_video', 'omni_convert_image', 'omni_transcribe_audio', 'omni_clip_image', 'omni_clip_audio',
  'omni_caption_image', 'omni_caption_audio', 'omni_ocr_image', 'omni_understand_video_segments',
  'omni_recall_media_memory', 'propose_goal', 'display_image',
]);
/** The `--core-tools` value that names no core built-in: the allowlist is on and holds none of them. */
export const QWEN_NO_CORE_TOOL = '__worca_no_core_tool__';
/** worca's system settings for a chat, over the machine's own (qwenSystemSettings): every tool offered, none deferred;
 *  no hook, no tool discovery or call command, no MCP server command, no background memory or skill agent. */
export const QWEN_ASK_SETTINGS = Object.freeze({
  tools: { toolSearch: { enabled: false }, discoveryCommand: '', callCommand: '' },
  mcp: { serverCommand: '' },
  memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false, enableAutoSkill: false, enableTeamMemory: false, enableTeamMemorySync: false, enableStructuredRecall: false, mem0: null },
  disableAllHooks: true,
});
/** A chat's env: the switches an env file could otherwise turn on, each set (an env file only fills unset names). */
export const QWEN_ASK_ENV = Object.freeze({
  QWEN_CODE_SAFE_MODE: '0', QWEN_CODE_MEMORY_TEAM: '0', QWEN_CODE_MEMORY_TEAM_SYNC: '0', QWEN_CODE_MEMORY_STRUCTURED_RECALL: '0',
  QWEN_CODE_ENABLE_AGENT_TEAM: '0', QWEN_CODE_ENABLE_AGENT_COLLABORATION: '0', QWEN_CODE_ENABLE_WORKFLOWS: '0',
  QWEN_CODE_DISABLE_WORKFLOWS: '1', QWEN_CODE_ENABLE_ARTIFACT: '0', QWEN_CODE_DISABLE_ARTIFACT: '1', QWEN_CODE_ENABLE_OMNI: '0',
  QWEN_CODE_DISABLE_CRON: '1',
});
/** Chat on Qwen Code (plans/ask-on-qwen-gemini-spike.md): no core built-in, every other built-in excluded, only worca's
 *  MCP server, the settings and env above. Proven per binary and user config by the chat self-test. */
export const QWEN_ASK_LOCKDOWN = Object.freeze({ coreTools: [QWEN_NO_CORE_TOOL], excludeTools: QWEN_BUILTIN_TOOLS, settings: QWEN_ASK_SETTINGS, env: QWEN_ASK_ENV });
/** The flags the lockdown needs, and the oldest Qwen Code it was verified on. */
export const QWEN_ASK_FLAGS = Object.freeze(['--core-tools', '--exclude-tools', '--allowed-mcp-server-names']);
export const QWEN_ASK_MIN_VERSION = '0.26.1';

/** What the gate and the run log say about the rules Qwen Code holds only in part. */
export const QWEN_RULE_TERMS = Object.freeze({
  kind: 'command and file-write rules',
  reach: 'Qwen Code matches a command rule against the start of the command, so a wrapper (env, a VAR= prefix) or another program gets past it, and an Edit or Write rule stops Qwen Code\'s file tools, not its shell',
});

export const QWEN_RESUME_NOT_FOUND_RE = /No saved session found/i;
export const QWEN_SIGNED_OUT_HINT = 'run `qwen` once in a terminal and choose how to sign in, or set a whole provider in worca\'s environment (for example OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL)';

/** The machine's own system settings file Qwen reads when QWEN_CODE_SYSTEM_SETTINGS_PATH is unset. */
export const QWEN_SYSTEM_SETTINGS_PATHS = Object.freeze({
  darwin: '/Library/Application Support/QwenCode/settings.json', win32: 'C:\\ProgramData\\qwen-code\\settings.json', linux: '/etc/qwen-code/settings.json',
});

// ── permission rules ─────────────────────────────────────────────────────────

/** The rule heads Qwen Code resolves to its own tools (its TOOL_NAME_ALIASES); MultiEdit is told as Edit. */
const QWEN_RULE_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Glob', 'Grep', 'NotebookEdit', 'Agent', 'Task', 'Skill']);

/**
 * What Qwen Code can be told of a run's DENY rules (allow / ask are never lifted): the rule as written, in Claude's
 * syntax. Command rules (other than one over every command) and Edit / Write / NotebookEdit rules on a path are partial
 * (QWEN_RULE_TERMS: the shell writes what the file tools may not); a rule on a tool Qwen does not know is unenforced.
 * @returns {{deny:string[], partial:string[], unenforced:string[]}}
 */
export function qwenRulePlan(permissionRules) {
  const out = { deny: [], partial: [], unenforced: [] };
  for (const raw of Array.isArray(permissionRules?.deny) ? permissionRules.deny : []) {
    let rule = String(raw).trim();
    if (!rule) continue;
    if (/^MultiEdit(?:\(|$)/.test(rule)) rule = `Edit${rule.slice('MultiEdit'.length)}`;
    const head = /^([A-Za-z_]+)(?:\(.*\))?$/s.exec(rule)?.[1];
    if (!rule.startsWith('mcp__') && !QWEN_RULE_TOOLS.has(head)) { out.unenforced.push(String(raw).trim()); continue; }
    if (!out.deny.includes(rule)) out.deny.push(rule);
    if (head === 'Bash' && rule !== 'Bash' && commandRuleBody(rule) !== '') out.partial.push(String(raw).trim());
    else if (/^(?:Edit|Write|NotebookEdit)\(.*\S.*\)$/s.test(rule)) out.partial.push(String(raw).trim());
  }
  return out;
}
export function unenforcedRules(permissionRules) { return qwenRulePlan(permissionRules).unenforced; }
export function partialRules(permissionRules) { return qwenRulePlan(permissionRules).partial; }

/** worca's servers and deny rules over the machine's own system settings (`base`, or null): servers added (worca's win
 *  a name clash), deny rules unioned, everything else kept. */
export function qwenSystemSettings({ base, mcpServers = {}, deny = [] }) {
  const b = base && typeof base === 'object' ? base : {};
  const out = { ...b };
  if (Object.keys(mcpServers).length) out.mcpServers = { ...(b.mcpServers && typeof b.mcpServers === 'object' ? b.mcpServers : {}), ...mcpServers };
  if (deny.length) {
    const p = b.permissions && typeof b.permissions === 'object' ? b.permissions : {};
    out.permissions = { ...p, deny: [...new Set([...(Array.isArray(p.deny) ? p.deny : []), ...deny])] };
  }
  return out;
}

/** The machine's own system settings (null when there is none). Throws when one exists that worca cannot read:
 *  pointing Qwen at worca's copy would drop it. */
function machineSystemSettings(bin) {
  const path = (typeof process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH === 'string' && process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH.trim())
    || QWEN_SYSTEM_SETTINGS_PATHS[process.platform] || QWEN_SYSTEM_SETTINGS_PATHS.linux;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw new Error(`${bin}: cannot read Qwen Code's system settings ${path} (${err.code || err.message}) — worca will not run Qwen Code without them`);
  }
  try { return JSON.parse(text); } catch {
    throw new Error(`${bin}: Qwen Code's system settings ${path} are not plain JSON — worca cannot add its guardrail rules and MCP servers without dropping them`);
  }
}

// ── argv ─────────────────────────────────────────────────────────────────────

/** `qwen --output-format stream-json --approval-mode yolo (--session-id S | --resume S) [--model M]
 *  [--append-system-prompt P] [--include-directories D]… --allowed-mcp-server-names N…`. The prompt travels on stdin. */
export function buildQwenArgs({ sessionId, resume = false, model, systemPrompt, includeDirs = [], mcpNames = [], ask = false } = {}) {
  const args = ['--output-format', 'stream-json', '--approval-mode', 'yolo', resume ? '--resume' : '--session-id', String(sessionId)];
  if (model) args.push('--model', String(model));
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  for (const d of includeDirs) args.push('--include-directories', d);
  for (const n of mcpNames.length ? mcpNames : [NO_MCP_SERVER]) args.push('--allowed-mcp-server-names', n);
  // A chat (QWEN_ASK_LOCKDOWN): no core built-in, every other one excluded (one comma-separated value).
  if (ask) args.push('--core-tools', QWEN_ASK_LOCKDOWN.coreTools.join(','), '--exclude-tools', QWEN_ASK_LOCKDOWN.excludeTools.join(','));
  return args;
}

// ── stream ───────────────────────────────────────────────────────────────────

/** One Qwen tool_use block in Claude's names; a `tool_call` meta call becomes the call it makes. */
function claudeBlock(b, mcpNames, cwd) {
  if (b?.type !== 'tool_use') return b;
  if (b.name === 'tool_call' && typeof b.input?.name === 'string') {
    const args = b.input.arguments && typeof b.input.arguments === 'object' ? b.input.arguments : {};
    return { ...b, name: claudeToolName(b.input.name, mcpNames), input: absolutePaths(args, cwd) };
  }
  return { ...b, name: claudeToolName(b.name, mcpNames), input: absolutePaths(b.input, cwd) };
}

/**
 * stream-json lines in, normalized events out, through the Claude normalizer: each frame is rewritten first (the
 * session id engine-qualified, tool names in Claude's vocabulary). push(line|object) returns the events for that
 * line; finish() returns { text, error }. A failed result emits no result event (the runner rejects instead).
 */
export function createQwenNormalizer({ mcpNames = [], cwd = null } = {}) {
  const claude = createClaudeNormalizer();
  const texts = [];
  let failed = null; let resultText = null;
  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') return [];
    const raw = { ...evt };
    if (typeof raw.session_id === 'string' && raw.session_id) raw.session_id = QWEN_SESSION_PREFIX + raw.session_id;
    if (raw.type === 'assistant' && Array.isArray(raw.message?.content)) raw.message = { ...raw.message, content: raw.message.content.map((b) => claudeBlock(b, mcpNames, cwd)) };
    const out = claude({ type: raw.type, raw });
    for (const e of out) if (e.type === 'text' && e.from === 'assistant' && e.parentId === null) texts.push(e.text);
    if (raw.type !== 'result') return out;
    if (raw.is_error) {
      failed = (typeof raw.error?.message === 'string' && raw.error.message) || (typeof raw.result === 'string' && raw.result) || 'qwen run failed';
      return out.filter((e) => e.type !== 'result');
    }
    resultText = typeof raw.result === 'string' ? raw.result : null;
    return out;
  }
  return { push, finish: () => ({ text: resultText ?? texts.join('\n'), error: failed }) };
}

// ── errors and auth ──────────────────────────────────────────────────────────

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export const classifyQwenError = classifyFamilyError;

/** Qwen Code's getAuthTypeFromEnv: the env alone signs in only when it names a whole provider. */
function authTypeFromEnv(env) {
  const has = (k) => typeof env[k] === 'string' && env[k].trim() !== '';
  if (has('QWEN_OAUTH')) return 'qwen-oauth';
  if (has('OPENAI_API_KEY') && (has('OPENAI_MODEL') || has('QWEN_MODEL')) && has('OPENAI_BASE_URL')) return 'openai';
  if (has('GEMINI_API_KEY') && has('GEMINI_MODEL')) return 'gemini';
  if ((has('GOOGLE_API_KEY') || has('GOOGLE_CLOUD_PROJECT')) && has('GOOGLE_MODEL')) return 'vertex-ai';
  if (has('ANTHROPIC_API_KEY') && has('ANTHROPIC_MODEL') && has('ANTHROPIC_BASE_URL')) return 'anthropic';
  return null;
}

/** The sign-in Qwen Code will use: the one chosen in its user settings, else env (also from its .env files) naming
 *  a whole provider; null when neither. Credentials themselves are never read. */
function qwenAuthType(given) {
  const dir = (typeof given.QWEN_HOME === 'string' && given.QWEN_HOME.trim()) || join(homeOf(given), '.qwen');
  return settingsAuthType(join(dir, 'settings.json'))
    || authTypeFromEnv({ ...readDotenv([join(dir, '.env'), join(homeOf(given), '.env')]), ...given });
}

/** Whether Qwen Code has a sign-in to use. */
export function qwenSignedIn(given = process.env) {
  return !!qwenAuthType(given);
}

// The env names each Qwen Code sign-in reads, beyond its own QWEN_ ones.
const QWEN_AUTH_PREFIXES = Object.freeze({
  openai: ['OPENAI_', 'DASHSCOPE_'], gemini: ['GEMINI_'], 'vertex-ai': ['GOOGLE_'], anthropic: ['ANTHROPIC_'],
});

/** The env prefixes that survive scrub for Qwen: its own, plus only the provider it is set to. Qwen runs in YOLO mode
 *  with a free shell, so another provider's key (worca's own Anthropic or OpenAI key) must never reach it. */
export function qwenEnvPrefixes(given = process.env) {
  return ['QWEN_', ...(QWEN_AUTH_PREFIXES[qwenAuthType(given)] || [])];
}

/** The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. */
export function qwenPreflight({ bin = qwenDefaultBin(), timeoutMs = 10000, env = process.env } = {}) {
  return familyPreflight({ bin, env, timeoutMs, label: 'Qwen Code (npm i -g @qwen-code/qwen-code)', binEnv: 'WORCA_QWEN_BIN',
    signedIn: qwenSignedIn, signInHint: QWEN_SIGNED_OUT_HINT });
}

// ── spawn ────────────────────────────────────────────────────────────────────

const QWEN_SPEC = Object.freeze({
  name: 'qwen', label: 'Qwen Code', prefix: QWEN_SESSION_PREFIX,
  // Qwen signs in through whichever provider it is set to: that provider's env names survive scrub too, no other's.
  envPrefixes: qwenEnvPrefixes,
  classify: classifyQwenError, resumeNotFoundRe: QWEN_RESUME_NOT_FOUND_RE,
  createNormalizer: createQwenNormalizer,
  askLockdown: QWEN_ASK_LOCKDOWN,
  prepare({ bin, sys, prompt, model, effort, servers, permissionRules, includeDirs, scratchDir, ask, probe }) {
    const plan = qwenRulePlan(permissionRules);
    const mcpServers = servers ? familyMcpServers(servers) : {};
    const env = { QWEN_CODE_SUPPRESS_YOLO_WARNING: '1', ...(ask ? QWEN_ASK_ENV : {}) };
    const tier = QWEN_EFFORT_SET.has(effort) ? effort : null;
    if (plan.deny.length || Object.keys(mcpServers).length || ask || tier) {
      const file = join(scratchDir(), 'system-settings.json');
      let doc = qwenSystemSettings({ base: machineSystemSettings(bin), mcpServers, deny: plan.deny });
      // The spawn's effort: the system settings win over the user's own model.reasoningEffort.
      if (tier) doc = mergeSettings(doc, { model: { reasoningEffort: tier } });
      // A chat: worca's lockdown settings win over the machine's; the self-test signs in to its own endpoint.
      if (ask) doc = mergeSettings(doc, QWEN_ASK_SETTINGS, probe ? { security: { auth: { selectedType: 'openai' } } } : {});
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o644 });
      env.QWEN_CODE_SYSTEM_SETTINGS_PATH = file;
    }
    if (probe) Object.assign(env, probe.env);
    // The system prompt rides --append-system-prompt; one too long for a command line is folded into stdin instead.
    const byFlag = !!sys && Buffer.byteLength(sys, 'utf8') <= FAMILY_ARGV_LIMIT;
    const mcpNames = Object.keys(mcpServers);
    return {
      stdin: byFlag ? prompt : foldSystemPrompt(sys, prompt),
      env,
      argsFor: (sessionId, resume) => buildQwenArgs({ sessionId, resume, model, systemPrompt: byFlag ? sys : '', includeDirs, mcpNames, ask }),
    };
  },
});

/** Run one Qwen Code turn (engines/gemini-family.mjs runFamilyProcess). */
export function runQwenProcess(opts = {}) {
  return runFamilyProcess(QWEN_SPEC, { ...opts, bin: opts.bin || qwenDefaultBin() });
}

// ── chat ─────────────────────────────────────────────────────────────────────

/** Can this qwen be locked down for a chat? Every flag in QWEN_ASK_FLAGS, and the version the lockdown was verified on.
 *  Never rejects: {refusal} or {}. */
export function qwenAskSupport({ bin = qwenDefaultBin(), timeoutMs = 15000 } = {}) {
  return familyAskSupport({ bin, timeoutMs, flags: QWEN_ASK_FLAGS, minVersion: QWEN_ASK_MIN_VERSION, label: 'Qwen Code', install: 'npm i -g @qwen-code/qwen-code', binEnv: 'WORCA_QWEN_BIN' });
}

/** The user config files a Qwen Code chat reads (a change re-runs the self-test). */
export function qwenConfigFiles(env = process.env) {
  const dir = (typeof env.QWEN_HOME === 'string' && env.QWEN_HOME.trim()) || join(homeOf(env), '.qwen');
  return [join(dir, 'settings.json'), join(dir, '.env'), join(homeOf(env), '.qwen', '.env'), join(homeOf(env), '.env'),
    QWEN_SYSTEM_SETTINGS_PATHS[process.platform] || QWEN_SYSTEM_SETTINGS_PATHS.linux];
}

/** The chat self-test on this qwen (engines/chat-selftest.mjs): OpenAI chat completions from a local endpoint. */
export function qwenChatSelfTest({ bin = qwenDefaultBin(), ...o } = {}) {
  return chatSelfTest({
    engine: 'qwen', label: 'Qwen Code', bin, run: runQwenProcess, protocol: 'openai',
    probeEnv: (url) => ({ OPENAI_API_KEY: 'worca-self-test', OPENAI_BASE_URL: `${url}/v1`, OPENAI_MODEL: SELF_TEST_MODEL }),
    wireName: (server, tool) => `mcp__${server}__${tool}`, configFiles: qwenConfigFiles(), ...o,
  });
}

/** Qwen Code's chat descriptor (engines/chat-descriptor.mjs). Each `impl` is the function a test hands the turn. */
export const qwenChat = makeChatDescriptor({
  engine: 'qwen',
  lockdown: () => QWEN_ASK_LOCKDOWN,
  askSupport: (o, impl = qwenAskSupport) => impl(o),
  selfTest: (o, impl = qwenChatSelfTest) => impl(o),
  preflight: (_ctx, impl = qwenPreflight) => impl(),
  resumeNotFound: (err) => QWEN_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')),
  docsAnchor: 'gemini-cli-and-qwen-code',
  signIn: (_model, env) => qwenEnvPrefixes(env),
  prompt: { cli: "Qwen Code with Qwen Code's own sign-in" },
});
