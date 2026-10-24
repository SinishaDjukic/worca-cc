// src/core/engines/gemini.mjs
// The Gemini CLI adapter: `gemini --output-format stream-json` argv, its stream normalized into worca's event
// vocabulary (no cost: Gemini reports tokens only), error classes, the run-start preflight, the guardrail rules
// written to an `--admin-policy` TOML file, and MCP servers written to the checkout's `.gemini/settings.json`. The
// spawn path is the family runner (engines/gemini-family.mjs), shared with Qwen Code.
//
// Facts this module builds on, verified on @google/gemini-cli 0.63.0 (test/fixtures/gemini/README.md):
// - `gemini --output-format stream-json` with the prompt on stdin runs headless. The stream is `init` (session_id,
//   model), `message` (role user/assistant; assistant text arrives as `delta` chunks), `tool_use` (tool_name, tool_id,
//   parameters), `tool_result` (tool_id, status success|error, output, error.{type,message}), `error` (non-fatal) and
//   one final `result` (status, stats with tokens per model, no cost; on failure `error.message`).
// - `--session-id <uuid>` names a new session (an id in use is refused); `--resume <uuid>` continues one and answers an
//   unknown id with exit 42 and "Invalid session identifier" on stderr. Sessions live per project under ~/.gemini/tmp.
// - A headless run needs a trusted folder: without `GEMINI_CLI_TRUST_WORKSPACE=true` it exits 55. (`--skip-trust`
//   also starts it, but the checkout's MCP servers then stay off.) Trust also lets the checkout's own `.gemini/`
//   settings apply, as Claude Code applies the checkout's `.claude/settings.json`.
// - `--approval-mode yolo` runs every tool without asking. `--admin-policy <toml>` loads deny rules at the admin tier,
//   above yolo's allow-all; a TOML file Gemini cannot parse is reported on stderr ("Policy file error") and IGNORED, so
//   the adapter stops the run on that line. Admin policies passed by flag are skipped when the system policy folder
//   already holds a .toml file (GEMINI_SYSTEM_POLICY_DIRS), so the adapter refuses then.
// - Deny rules hold for whole tools (run_shell_command, web_fetch, google_web_search, an MCP server or tool). A
//   `commandPrefix` rule matches the command's start, so `env git log` and `VAR=x git log` get past a `git log` rule;
//   a path rule (argsPattern on the file tools' arguments) does not stop the shell.
// - MCP servers come from settings files; `GEMINI_CLI_SYSTEM_SETTINGS_PATH` is refused unless root owns its folder, so
//   worca writes the checkout's `.gemini/settings.json`. `${VAR}` in it is filled from gemini's env.
//   `--allowed-mcp-server-names` keeps every other server (the user's ~/.gemini ones, the checkout's) off.
// - File tools only reach the workspace (the cwd and `--include-directories`); the shell reaches everything.
// - Sign-in: GEMINI_API_KEY (also from ~/.gemini/.env or ~/.env), Vertex env, or a sign-in chosen in
//   ~/.gemini/settings.json (`security.auth.selectedType`). No status command exists.
// - Not used (capability false): GEMINI_SYSTEM_MD replaces the whole built-in system prompt, so worca folds its system
//   prompt into the prompt; sub-agents, hooks, skills, a per-spawn tool list and a turn cap are not wired. Effort is
//   the model's thinking, set in the settings file (geminiEffortSettings).
//
// Chat (Ask Worca) on Gemini CLI, verified on 0.65.0 against a local model endpoint (plans/ask-on-qwen-gemini-spike.md):
// - An admin-tier rule (`--admin-policy`) that denies `toolName = "*"` takes every tool out of the offered list, the
//   user's own policies (user tier, even an allow-all) and yolo included; a higher-priority allow for worca's MCP server
//   keeps its tools. A denied or unknown call is answered "Tool … not found".
// - But a statically denied built-in also hides an MCP tool of the same bare name (worca's read_file, glob, web_fetch):
//   Gemini matches excluded names against an MCP tool's unprefixed name too. `tools.core` (an allowlist of the built-ins
//   to REGISTER) naming none of them registers none, so nothing of that name is excluded and worca's tools stay offered.
// - The checkout's (here: the chat folder's) `.gemini/settings.json` wins over ~/.gemini/settings.json: it switches the
//   user's hooks, tool discovery and call commands off. `--extensions none` loads no extension (their MCP servers and
//   context files). `--allowed-mcp-server-names` keeps every other MCP server off.
// - Context files (~/.gemini/GEMINI.md, skill descriptions) still reach the prompt as text; they add no tool.
// - Sessions live per folder (~/.gemini/tmp/<hash of the cwd>), so a chat runs in a folder of its own, the same every turn.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { assertOwnFolders } from '../agent-user.mjs';
import { worcaHome } from '../projects.mjs';
import { homedir } from 'node:os';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { writeProjectFiles } from './project-files.mjs';
import { argValue } from '../spawn.mjs';
import { ENGINES } from '../../shared/engine-switch.mjs';
import {
  claudeToolName, commandRuleBody, mcpRuleParts, familyMcpServers, classifyFamilyError, familyPreflight, runFamilyProcess,
  homeOf, readDotenv, settingsAuthType, foldSystemPrompt, NO_MCP_SERVER, absolutePaths, familyAskSupport, mergeSettings,
} from './gemini-family.mjs';
import { makeChatDescriptor } from './chat-descriptor.mjs';
import { chatSelfTest, SELF_TEST_MODEL } from './chat-selftest.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const geminiDefaultBin = () => process.env.WORCA_GEMINI_BIN || 'gemini';
export const GEMINI_SESSION_PREFIX = 'gemini:';

const GEMINI_FALSE = new Set(['systemPromptFlag', 'allowedTools', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);

/** An effort as Gemini CLI's thinking (GEMINI_EFFORTS): a thinking level for the Gemini 3 family, a thinking budget for
 *  Gemini 2.5, set through its settings' model config overrides on the base aliases every chat model extends (the
 *  overrides apply over an alias's own thinking). A model outside those families keeps its own. */
export const GEMINI_THINKING = Object.freeze({
  low: Object.freeze({ level: 'LOW', budget: 1024 }), medium: Object.freeze({ level: 'MEDIUM', budget: 8192 }), high: Object.freeze({ level: 'HIGH', budget: 24576 }),
});
/** The settings that carry `effort`, or {} (none, or one Gemini CLI does not take). */
export function geminiEffortSettings(effort) {
  const t = Object.hasOwn(GEMINI_THINKING, effort) ? GEMINI_THINKING[effort] : null;
  if (!t) return {};
  const over = (alias, thinkingConfig) => ({ match: { model: alias }, modelConfig: { generateContentConfig: { thinkingConfig } } });
  return { modelConfigs: { customOverrides: [over('chat-base-3', { thinkingLevel: t.level }), over('chat-base-2.5', { thinkingBudget: t.budget })] } };
}
export const geminiCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !GEMINI_FALSE.has(k)])));

/** The `tools.core` value that names no built-in: none is registered (see the chat notes above). */
export const GEMINI_NO_CORE_TOOL = '__worca_no_core_tool__';
/** A chat folder's `.gemini/settings.json` beside worca's MCP servers: no built-in registered, no hook, no tool discovery
 *  or call command. */
export const GEMINI_ASK_SETTINGS = Object.freeze({
  tools: { core: [GEMINI_NO_CORE_TOOL], discoveryCommand: '', callCommand: '' },
  hooksConfig: { enabled: false },
});
/** Chat on Gemini CLI (plans/ask-on-qwen-gemini-spike.md): the admin policy (geminiAskPolicyToml), the settings above,
 *  no extension, only worca's MCP server. Proven per binary and user config by the chat self-test. */
export const GEMINI_ASK_LOCKDOWN = Object.freeze({ settings: GEMINI_ASK_SETTINGS, extensions: 'none' });
/** The flags the lockdown needs, and the oldest Gemini CLI it was verified on. */
export const GEMINI_ASK_FLAGS = ENGINES.gemini.chat.flags;
export const GEMINI_ASK_MIN_VERSION = ENGINES.gemini.chat.minVersion;

/** A chat's admin policy: every tool denied, worca's MCP servers' tools allowed above it. */
export function geminiAskPolicyToml(mcpNames) {
  const q = (v) => JSON.stringify(v);
  return [
    '[[rule]]', 'toolName = "*"', 'decision = "deny"', 'priority = 900', `denyMessage = ${q('worca chat lockdown: only worca\'s own tools')}`, '',
    ...mcpNames.flatMap((n) => ['[[rule]]', `mcpName = ${q(n)}`, 'toolName = "*"', 'decision = "allow"', 'priority = 999', '']),
  ].join('\n');
}

/** What the gate and the run log say about the rules Gemini CLI holds only in part. */
export const GEMINI_RULE_TERMS = Object.freeze({
  kind: 'command and path rules',
  reach: 'a command rule matches the start of the command, so a wrapper (env, a VAR= prefix) or another program gets past it, and a Read, Edit or Write rule stops Gemini CLI\'s file tools, not its shell',
});

export const GEMINI_RESUME_NOT_FOUND_RE = /Invalid session identifier|Error resuming session/i;
export const GEMINI_POLICY_ERROR_RE = /Policy file error/i;
export const GEMINI_SIGNED_OUT_HINT = 'run `gemini` once in a terminal and sign in, or set GEMINI_API_KEY in worca\'s environment';

/** The system policy folders whose .toml files make Gemini skip an --admin-policy file. */
export const GEMINI_SYSTEM_POLICY_DIRS = Object.freeze({
  darwin: '/Library/Application Support/GeminiCli/policies', win32: 'C:\\ProgramData\\gemini-cli\\policies', linux: '/etc/gemini-cli/policies',
});

// ── permission rules ─────────────────────────────────────────────────────────

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A Claude path glob as a regex over one JSON string's contents: a double star and a slash match any folders, a double
 *  star anything, a star or a question mark only within one folder. */
function globRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { if (glob[i + 2] === '/') { out += '(?:[^"]*/)?'; i += 2; } else { out += '[^"]*'; i += 1; } }
    else if (c === '*') out += '[^/"]*';
    else if (c === '?') out += '[^/"]';
    else out += reEscape(c);
  }
  return out;
}
/** A Claude path rule body as an argsPattern: a JSON string value naming that path. `//abs` is absolute, `~/…` the
 *  home; `/rel`, `./rel` and bare patterns are relative to the project root (the run checkout), so any value that is
 *  the path or ends in `/<path>` matches (the agent passes relative and absolute paths alike). */
export function geminiPathPattern(body, home = homedir()) {
  if (body.startsWith('//')) return `"${globRegex(body.slice(1))}"`;
  if (body.startsWith('~/')) return `"(?:~|${reEscape(home)})${globRegex(body.slice(1))}"`;
  const rel = body.startsWith('./') ? body.slice(2) : body.startsWith('/') ? body.slice(1) : body;
  return `"(?:[^"]*/)?${globRegex(rel)}"`;
}

const READ_TOOLS = Object.freeze(['read_file', 'read_many_files']);
const WRITE_TOOLS = Object.freeze(['write_file', 'replace']);

/**
 * What Gemini CLI can be told of a run's DENY rules (allow / ask are never lifted), as policy rules.
 * held: bare Bash (the shell), bare Read/Edit/Write/Glob/Grep, WebFetch, WebSearch, MCP server and tool rules.
 * partial (GEMINI_RULE_TERMS): command rules and path rules. unenforced: everything else.
 * @returns {{rules:object[], partial:string[], unenforced:string[]}}
 */
export function geminiRulePlan(permissionRules, { home } = {}) {
  const out = { rules: [], partial: [], unenforced: [] };
  const add = (r, rule, part = false) => { out.rules.push({ ...r, rule }); if (part) out.partial.push(rule); };
  for (const raw of Array.isArray(permissionRules?.deny) ? permissionRules.deny : []) {
    const rule = String(raw).trim();
    if (!rule) continue;
    const cmd = rule === 'Bash' ? '' : commandRuleBody(rule);
    if (cmd === '') { add({ toolName: 'run_shell_command' }, rule); continue; }
    if (cmd) { add({ toolName: 'run_shell_command', commandPrefix: cmd }, rule, true); continue; }
    const bare = { Read: READ_TOOLS, Edit: WRITE_TOOLS, Write: WRITE_TOOLS, MultiEdit: WRITE_TOOLS, Glob: 'glob', Grep: 'grep_search', WebFetch: 'web_fetch', WebSearch: 'google_web_search' }[rule];
    if (bare) { add({ toolName: bare }, rule); continue; }
    const path = /^(Read|Edit|Write|MultiEdit)\((.+)\)$/.exec(rule);
    if (path && path[2].trim()) { add({ toolName: path[1] === 'Read' ? READ_TOOLS : WRITE_TOOLS, argsPattern: geminiPathPattern(path[2].trim(), home) }, rule, true); continue; }
    const mcp = mcpRuleParts(rule);
    if (mcp) { add(mcp.tool ? { toolName: mcp.tool, mcpName: mcp.server } : { mcpName: mcp.server }, rule); continue; }
    out.unenforced.push(rule);
  }
  return out;
}
export function unenforcedRules(permissionRules) { return geminiRulePlan(permissionRules).unenforced; }
export function partialRules(permissionRules) { return geminiRulePlan(permissionRules).partial; }

/** Policy rules as Gemini's TOML: deny at priority 999 of the admin tier, every string a JSON (= TOML basic) string. */
export function geminiPolicyToml(rules) {
  const q = (v) => JSON.stringify(v);
  return rules.map((r) => [
    '[[rule]]',
    ...(r.toolName !== undefined ? [`toolName = ${q(r.toolName)}`] : []),
    ...(r.commandPrefix !== undefined ? [`commandPrefix = ${q(r.commandPrefix)}`] : []),
    ...(r.argsPattern !== undefined ? [`argsPattern = ${q(r.argsPattern)}`] : []),
    ...(r.mcpName !== undefined ? [`mcpName = ${q(r.mcpName)}`] : []),
    'decision = "deny"', 'priority = 999', `denyMessage = ${q(`worca guardrail: ${r.rule}`)}`, '',
  ].join('\n')).join('\n');
}

// ── argv ─────────────────────────────────────────────────────────────────────

/** `gemini --output-format stream-json --approval-mode yolo (--session-id S | --resume S) [--model M] [--admin-policy F]
 *  [--include-directories D]… --allowed-mcp-server-names N…`. The prompt travels on stdin. */
export function buildGeminiArgs({ sessionId, resume = false, model, policyFile, includeDirs = [], mcpNames = [], ask = false } = {}) {
  const args = ['--output-format', 'stream-json', '--approval-mode', 'yolo', resume ? '--resume' : '--session-id', String(sessionId)];
  if (model) args.push('--model', argValue(String(model), 'model'));
  if (policyFile) args.push('--admin-policy', policyFile);
  for (const d of includeDirs) args.push('--include-directories', d);
  for (const n of mcpNames.length ? mcpNames : [NO_MCP_SERVER]) args.push('--allowed-mcp-server-names', n);
  if (ask) args.push('--extensions', GEMINI_ASK_LOCKDOWN.extensions);
  return args;
}

// ── stream ───────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(v) ? v : undefined);

/** Gemini's run stats as Claude-style token counts (uncached input, cache reads, output); numbers only. */
function usageOf(stats) {
  const s = stats && typeof stats === 'object' ? stats : {};
  const input = num(s.input) ?? (num(s.input_tokens) !== undefined ? s.input_tokens - (num(s.cached) ?? 0) : undefined);
  const u = { input_tokens: input, cache_read_input_tokens: num(s.cached), output_tokens: num(s.output_tokens) };
  return Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined));
}

/**
 * stream-json lines in, normalized events out (src/core/engines/events.mjs). push(line|object) returns the events for
 * that line; finish() returns { text, error } for the run. Assistant deltas are joined into one text event per message
 * (a message ends at the next tool call or the result). `error` is set by a failed result, or by the last `error`
 * event when no result arrived.
 */
export function createGeminiNormalizer({ model, mcpNames = [], cwd = null } = {}) {
  const texts = [];
  let buf = [];
  let failed = null; let lastError = null; let resulted = false;
  const flush = () => {
    const t = buf.join('');
    buf = [];
    if (!t) return [];
    texts.push(t);
    return [{ type: 'text', text: t, parentId: null, from: 'assistant', blocks: [t] }];
  };
  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object') return [];
    switch (evt.type) {
      case 'init':
        return str(evt.session_id) ? [{ type: 'session', sessionId: GEMINI_SESSION_PREFIX + evt.session_id, model: str(evt.model) || model || null, init: true }] : [];
      case 'message':
        if (evt.role === 'assistant' && str(evt.content)) buf.push(evt.content);
        return [];
      case 'tool_use': {
        const id = str(evt.tool_id);
        if (!id) return flush();
        const input = absolutePaths(evt.parameters && typeof evt.parameters === 'object' ? evt.parameters : {}, cwd);
        return [...flush(), { type: 'tool', parentId: null, calls: [{ name: claudeToolName(evt.tool_name, mcpNames), input, toolUseId: id }] }];
      }
      case 'tool_result': {
        const id = str(evt.tool_id);
        if (!id) return flush();
        const isError = evt.status !== 'success';
        const text = str(evt.output) || (isError ? str(evt.error?.message) : '');
        return [...flush(), { type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: id, isError, text, content: text }] }];
      }
      case 'error':
        lastError = str(evt.message) || str(evt.error?.message) || 'gemini reported an error';
        return [...flush(), { type: 'stderr', stream: 'err', text: `gemini: ${lastError}` }];
      case 'result': {
        resulted = true;
        const done = flush();
        if (evt.status !== 'success') { failed = str(evt.error?.message) || lastError || 'gemini run failed'; return done; }
        const usage = usageOf(evt.stats);
        return [...done, { type: 'result', text: texts.join('\n'), isError: false, ...(Object.keys(usage).length ? { usage } : {}) }];
      }
      default:
        return [];   // the user echo and anything newer: nothing worca reads
    }
  }
  const error = () => failed || (resulted ? null : lastError);
  return { push, finish: () => ({ text: [...texts, ...(buf.length ? [buf.join('')] : [])].join('\n'), error: error() }) };
}

// ── errors and auth ──────────────────────────────────────────────────────────

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export const classifyGeminiError = classifyFamilyError;

/** Whether Gemini CLI has a sign-in to use: an API key or Vertex env (also from its .env files), or a sign-in chosen
 *  in its user settings (`gemini` signs in once interactively). Credentials themselves are never read. */
export function geminiSignedIn(given = process.env) {
  const base = (typeof given.GEMINI_CLI_HOME === 'string' && given.GEMINI_CLI_HOME.trim()) || homeOf(given);
  const env = { ...readDotenv([join(base, '.gemini', '.env'), join(homeOf(given), '.env')]), ...given };
  const has = (k) => typeof env[k] === 'string' && env[k].trim() !== '';
  if (['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA'].some(has)) return true;
  if (has('GOOGLE_CLOUD_PROJECT') && has('GOOGLE_CLOUD_LOCATION')) return true;
  return !!settingsAuthType(join(base, '.gemini', 'settings.json'));
}

/** The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. */
export function geminiPreflight({ bin = geminiDefaultBin(), timeoutMs = 10000, env = process.env, envAllowlist = [] } = {}) {
  return familyPreflight({ bin, engine: 'gemini', env, envAllowlist, timeoutMs, label: 'Gemini CLI (npm i -g @google/gemini-cli)', binEnv: 'WORCA_GEMINI_BIN',
    signedIn: geminiSignedIn, signInHint: GEMINI_SIGNED_OUT_HINT });
}

// ── spawn ────────────────────────────────────────────────────────────────────

/** Whether Gemini would skip an --admin-policy file here (the system policy folder holds a .toml file). */
function systemPolicyPresent() {
  const dir = GEMINI_SYSTEM_POLICY_DIRS[process.platform] || GEMINI_SYSTEM_POLICY_DIRS.linux;
  try { return readdirSync(dir).some((f) => f.endsWith('.toml')); } catch { return false; }
}

const systemPolicyDir = () => GEMINI_SYSTEM_POLICY_DIRS[process.platform] || GEMINI_SYSTEM_POLICY_DIRS.linux;

/** A chat's spawn: the admin policy and the chat folder's settings (removed when the spawn is over). */
function prepareAsk({ cwd, bin, sys, prompt, model, effort, servers, scratchDir, probe }) {
  if (systemPolicyPresent()) throw new Error(`${bin}: the system policy folder (${systemPolicyDir()}) holds policy files, so Gemini CLI would skip worca's chat lockdown`);
  const mcpServers = servers ? familyMcpServers(servers) : {};
  const mcpNames = Object.keys(mcpServers);
  const policyFile = join(scratchDir(), 'worca-chat-policy.toml');
  writeFileSync(policyFile, geminiAskPolicyToml(mcpNames), { mode: 0o644 });
  // V10: the chat folder sits under tmp/ask, which every agent may write into: refuse one another user made first. The
  // walk starts at tmp/ask itself; a chat cwd elsewhere (no shared folder above it) has only its .gemini checked.
  const askRoot = join(worcaHome(), 'tmp', 'ask');
  const rel = relative(askRoot, cwd);
  assertOwnFolders(join(cwd, '.gemini'), rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? askRoot : cwd);
  mkdirSync(join(cwd, '.gemini'), { recursive: true, mode: 0o700 });
  const settingsFile = join(cwd, '.gemini', 'settings.json');
  const doc = mergeSettings({ mcpServers }, GEMINI_ASK_SETTINGS, geminiEffortSettings(effort), probe ? { security: { auth: { selectedType: 'gemini-api-key' } } } : {});
  writeFileSync(settingsFile, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  return {
    stdin: foldSystemPrompt(sys, prompt),
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true', ...(probe ? probe.env : {}) },
    argsFor: (sessionId, resume) => buildGeminiArgs({ sessionId, resume, model, policyFile, mcpNames, ask: true }),
    cleanup: () => rmSync(settingsFile, { force: true }),
    // A relayed chat runs Gemini as the person's agent user: the chat folder's settings must be readable by it.
    agentDirs: [join(cwd, '.gemini')],
  };
}

const GEMINI_SPEC = Object.freeze({
  name: 'gemini', label: 'Gemini CLI', prefix: GEMINI_SESSION_PREFIX,
  classify: classifyGeminiError, resumeNotFoundRe: GEMINI_RESUME_NOT_FOUND_RE,
  fatalStderrRe: GEMINI_POLICY_ERROR_RE, fatalMessage: 'Gemini CLI could not load worca\'s policy file, so the guardrail rules would not hold — stopped',
  createNormalizer: createGeminiNormalizer,
  askLockdown: GEMINI_ASK_LOCKDOWN,
  prepare({ cwd, bin, sys, prompt, model, effort, servers, permissionRules, includeDirs, scratchDir, noGit, ask, probe }) {
    if (ask) return prepareAsk({ cwd, bin, sys, prompt, model, effort, servers, scratchDir, probe });
    const plan = geminiRulePlan(permissionRules);
    let policyFile = null;
    if (plan.rules.length) {
      if (systemPolicyPresent()) throw new Error(`${bin}: the system policy folder (${GEMINI_SYSTEM_POLICY_DIRS[process.platform] || GEMINI_SYSTEM_POLICY_DIRS.linux}) holds policy files, so Gemini CLI would skip worca's guardrail rules`);
      policyFile = join(scratchDir(), 'worca-policy.toml');
      writeFileSync(policyFile, geminiPolicyToml(plan.rules), { mode: 0o644 });
    }
    // The checkout's .gemini/settings.json: worca's MCP servers and the spawn's thinking, or (neither) worca's earlier
    // file removed.
    const mcpServers = servers ? familyMcpServers(servers) : {};
    const thinking = geminiEffortSettings(effort);
    const project = { ...(Object.keys(mcpServers).length ? { mcpServers } : {}), ...thinking };
    writeProjectFiles('gemini', cwd, Object.keys(project).length ? { '.gemini/settings.json': `${JSON.stringify(project, null, 2)}\n` } : {}, { git: !noGit });
    const mcpNames = Object.keys(mcpServers);
    return {
      stdin: foldSystemPrompt(sys, prompt),
      env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      argsFor: (sessionId, resume) => buildGeminiArgs({ sessionId, resume, model, policyFile, includeDirs, mcpNames }),
    };
  },
});

/** Run one Gemini CLI turn (engines/gemini-family.mjs runFamilyProcess). */
export function runGeminiProcess(opts = {}) {
  return runFamilyProcess(GEMINI_SPEC, { ...opts, bin: opts.bin || geminiDefaultBin() });
}

// ── chat ─────────────────────────────────────────────────────────────────────

/** Can this gemini be locked down for a chat? Every flag in GEMINI_ASK_FLAGS, the version the lockdown was verified on,
 *  and no system policy file (which would make Gemini skip worca's admin policy). Never rejects: {refusal} or {}. */
export function geminiAskSupport({ bin = geminiDefaultBin(), timeoutMs = 15000 } = {}) {
  return familyAskSupport({ bin, timeoutMs, flags: GEMINI_ASK_FLAGS, minVersion: GEMINI_ASK_MIN_VERSION, label: 'Gemini CLI', install: 'npm i -g @google/gemini-cli', binEnv: 'WORCA_GEMINI_BIN',
    extra: () => (systemPolicyPresent() ? `the system policy folder (${systemPolicyDir()}) holds policy files, so Gemini CLI would skip worca's chat lockdown` : null) });
}

/** The machine's own system settings file, which outranks the chat folder's settings. */
export const GEMINI_SYSTEM_SETTINGS_PATHS = Object.freeze({
  darwin: '/Library/Application Support/GeminiCli/settings.json', win32: 'C:\\ProgramData\\gemini-cli\\settings.json', linux: '/etc/gemini-cli/settings.json',
});

/** The config a Gemini CLI chat reads (a change re-runs the self-test): the user's and the machine's. */
export function geminiConfigFiles(env = process.env) {
  const base = (typeof env.GEMINI_CLI_HOME === 'string' && env.GEMINI_CLI_HOME.trim()) || homeOf(env);
  const g = join(base, '.gemini');
  return [join(g, 'settings.json'), join(g, '.env'), join(homeOf(env), '.env'), join(g, 'policies'), join(g, 'extensions'),
    join(g, 'GEMINI.md'), systemPolicyDir(),
    (typeof env.GEMINI_CLI_SYSTEM_SETTINGS_PATH === 'string' && env.GEMINI_CLI_SYSTEM_SETTINGS_PATH.trim()) || GEMINI_SYSTEM_SETTINGS_PATHS[process.platform] || GEMINI_SYSTEM_SETTINGS_PATHS.linux];
}

/** The chat self-test on this gemini (engines/chat-selftest.mjs): the Gemini API from a local endpoint. */
export function geminiChatSelfTest({ bin = geminiDefaultBin(), ...o } = {}) {
  return chatSelfTest({
    engine: 'gemini', label: 'Gemini CLI', bin, run: runGeminiProcess, protocol: 'gemini',
    probeEnv: (url) => ({ GEMINI_API_KEY: 'worca-self-test', GOOGLE_GEMINI_BASE_URL: url, GOOGLE_GENAI_USE_VERTEXAI: 'false', GOOGLE_GENAI_USE_GCA: 'false', GEMINI_MODEL: SELF_TEST_MODEL }),
    wireName: (server, tool) => `mcp_${server}_${tool}`, configFiles: geminiConfigFiles(), ...o,
  });
}

/** Gemini CLI's chat descriptor (engines/chat-descriptor.mjs). A chat runs in a folder of its own (`ownFolder`): Gemini
 *  keeps sessions per folder and reads the chat's settings from it. Each `impl` is the function a test hands the turn. */
export const geminiChat = makeChatDescriptor({
  engine: 'gemini',
  lockdown: () => GEMINI_ASK_LOCKDOWN,
  askSupport: (o, impl = geminiAskSupport) => impl(o),
  selfTest: (o, impl = geminiChatSelfTest) => impl(o),
  preflight: (_ctx, impl = geminiPreflight) => impl(),
  resumeNotFound: (err) => GEMINI_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')),
  signInMode: () => null,
});
