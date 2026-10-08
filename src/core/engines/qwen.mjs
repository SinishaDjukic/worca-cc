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
//   settings file; a Read rule also stops the shell from reading that file. A command rule matches the command's start,
//   so `env git log` gets past `Bash(git log:*)`.
// - `QWEN_CODE_SYSTEM_SETTINGS_PATH` names the system settings file for any owner, and it fills `${VAR}` from qwen's env,
//   so worca's servers and rules need nothing in the checkout. (`--mcp-config` does NOT fill `${VAR}`.) The machine's
//   own system settings file is merged into worca's copy, so setting the path never drops it.
// - `--allowed-mcp-server-names` keeps every other server (the user's ~/.qwen ones, the checkout's) off.
// - `--append-system-prompt` reaches the model. `--max-session-turns` does not cap tool calls (worca counts them).
// - Sign-in: `security.auth.selectedType` in the user settings (~/.qwen, or QWEN_HOME), or env naming a whole provider
//   (getAuthTypeFromEnv below), also from ~/.qwen/.env. A key alone is "No auth type is selected".
// - Not used (capability false): sub-agents, hooks, skills, effort, a per-spawn tool list, a turn cap.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { createClaudeNormalizer } from './claude-events.mjs';
import {
  claudeToolName, commandRuleBody, familyMcpServers, classifyFamilyError, familyPreflight, runFamilyProcess,
  homeOf, readDotenv, settingsAuthType, foldSystemPrompt, NO_MCP_SERVER, FAMILY_ARGV_LIMIT,
} from './gemini-family.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const qwenDefaultBin = () => process.env.WORCA_QWEN_BIN || 'qwen';
export const QWEN_SESSION_PREFIX = 'qwen:';

const QWEN_FALSE = new Set(['allowedTools', 'effort', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
export const qwenCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !QWEN_FALSE.has(k)])));

/** Ask Worca on Qwen Code: null = worca does not lock it down for a chat (model-env.mjs ASK_ENGINES). */
export const QWEN_ASK_LOCKDOWN = null;

/** What the gate and the run log say about the rules Qwen Code holds only in part. */
export const QWEN_RULE_TERMS = Object.freeze({
  kind: 'command rules',
  reach: 'Qwen Code matches a command rule against the start of the command, so a wrapper (env, a VAR= prefix) or another program gets past it',
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
 * syntax. Command rules (other than one over every command) are partial (QWEN_RULE_TERMS); a rule on a tool Qwen
 * does not know is unenforced.
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
export function buildQwenArgs({ sessionId, resume = false, model, systemPrompt, includeDirs = [], mcpNames = [] } = {}) {
  const args = ['--output-format', 'stream-json', '--approval-mode', 'yolo', resume ? '--resume' : '--session-id', String(sessionId)];
  if (model) args.push('--model', String(model));
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  for (const d of includeDirs) args.push('--include-directories', d);
  for (const n of mcpNames.length ? mcpNames : [NO_MCP_SERVER]) args.push('--allowed-mcp-server-names', n);
  return args;
}

// ── stream ───────────────────────────────────────────────────────────────────

/** One Qwen tool_use block in Claude's names; a `tool_call` meta call becomes the call it makes. */
function claudeBlock(b, mcpNames) {
  if (b?.type !== 'tool_use') return b;
  if (b.name === 'tool_call' && typeof b.input?.name === 'string') {
    const args = b.input.arguments && typeof b.input.arguments === 'object' ? b.input.arguments : {};
    return { ...b, name: claudeToolName(b.input.name, mcpNames), input: args };
  }
  return { ...b, name: claudeToolName(b.name, mcpNames) };
}

/**
 * stream-json lines in, normalized events out, through the Claude normalizer: each frame is rewritten first (the
 * session id engine-qualified, tool names in Claude's vocabulary). push(line|object) returns the events for that
 * line; finish() returns { text, error }. A failed result emits no result event (the runner rejects instead).
 */
export function createQwenNormalizer({ mcpNames = [] } = {}) {
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
    if (raw.type === 'assistant' && Array.isArray(raw.message?.content)) raw.message = { ...raw.message, content: raw.message.content.map((b) => claudeBlock(b, mcpNames)) };
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

/** Whether Qwen Code has a sign-in to use: one chosen in its user settings, or env (also from its .env files) naming
 *  a whole provider. Credentials themselves are never read. */
export function qwenSignedIn(given = process.env) {
  const dir = (typeof given.QWEN_HOME === 'string' && given.QWEN_HOME.trim()) || join(homeOf(given), '.qwen');
  if (settingsAuthType(join(dir, 'settings.json'))) return true;
  return !!authTypeFromEnv({ ...readDotenv([join(dir, '.env'), join(homeOf(given), '.env')]), ...given });
}

/** The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. */
export function qwenPreflight({ bin = qwenDefaultBin(), timeoutMs = 10000, env = process.env } = {}) {
  return familyPreflight({ bin, env, timeoutMs, label: 'Qwen Code (npm i -g @qwen-code/qwen-code)', binEnv: 'WORCA_QWEN_BIN',
    signedIn: qwenSignedIn, signInHint: QWEN_SIGNED_OUT_HINT });
}

// ── spawn ────────────────────────────────────────────────────────────────────

const QWEN_SPEC = Object.freeze({
  name: 'qwen', label: 'Qwen Code', prefix: QWEN_SESSION_PREFIX,
  // Qwen signs in through whichever provider it is set to: those providers' env names survive scrub too.
  envPrefixes: ['QWEN_', 'OPENAI_', 'DASHSCOPE_', 'GEMINI_', 'GOOGLE_', 'ANTHROPIC_'],
  classify: classifyQwenError, resumeNotFoundRe: QWEN_RESUME_NOT_FOUND_RE,
  createNormalizer: createQwenNormalizer,
  prepare({ bin, sys, prompt, model, servers, permissionRules, includeDirs, scratchDir }) {
    const plan = qwenRulePlan(permissionRules);
    const mcpServers = servers ? familyMcpServers(servers) : {};
    const env = { QWEN_CODE_SUPPRESS_YOLO_WARNING: '1' };
    if (plan.deny.length || Object.keys(mcpServers).length) {
      const file = join(scratchDir(), 'system-settings.json');
      writeFileSync(file, `${JSON.stringify(qwenSystemSettings({ base: machineSystemSettings(bin), mcpServers, deny: plan.deny }), null, 2)}\n`, { mode: 0o644 });
      env.QWEN_CODE_SYSTEM_SETTINGS_PATH = file;
    }
    // The system prompt rides --append-system-prompt; one too long for a command line is folded into stdin instead.
    const byFlag = !!sys && Buffer.byteLength(sys, 'utf8') <= FAMILY_ARGV_LIMIT;
    const mcpNames = Object.keys(mcpServers);
    return {
      stdin: byFlag ? prompt : foldSystemPrompt(sys, prompt),
      env,
      argsFor: (sessionId, resume) => buildQwenArgs({ sessionId, resume, model, systemPrompt: byFlag ? sys : '', includeDirs, mcpNames }),
    };
  },
});

/** Run one Qwen Code turn (engines/gemini-family.mjs runFamilyProcess). */
export function runQwenProcess(opts = {}) {
  return runFamilyProcess(QWEN_SPEC, { ...opts, bin: opts.bin || qwenDefaultBin() });
}
