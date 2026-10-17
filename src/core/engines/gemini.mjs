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
//   prompt into the prompt; sub-agents, hooks, skills, effort, a per-spawn tool list and a turn cap are not wired.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { writeProjectFiles } from './project-files.mjs';
import {
  claudeToolName, commandRuleBody, mcpRuleParts, familyMcpServers, classifyFamilyError, familyPreflight, runFamilyProcess,
  homeOf, readDotenv, settingsAuthType, foldSystemPrompt, NO_MCP_SERVER, absolutePaths,
} from './gemini-family.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const geminiDefaultBin = () => process.env.WORCA_GEMINI_BIN || 'gemini';
export const GEMINI_SESSION_PREFIX = 'gemini:';

const GEMINI_FALSE = new Set(['systemPromptFlag', 'allowedTools', 'effort', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
export const geminiCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !GEMINI_FALSE.has(k)])));

/** Ask Worca on Gemini CLI: null = worca does not lock it down for a chat (model-env.mjs ASK_ENGINES). */
export const GEMINI_ASK_LOCKDOWN = null;

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
export function buildGeminiArgs({ sessionId, resume = false, model, policyFile, includeDirs = [], mcpNames = [] } = {}) {
  const args = ['--output-format', 'stream-json', '--approval-mode', 'yolo', resume ? '--resume' : '--session-id', String(sessionId)];
  if (model) args.push('--model', String(model));
  if (policyFile) args.push('--admin-policy', policyFile);
  for (const d of includeDirs) args.push('--include-directories', d);
  for (const n of mcpNames.length ? mcpNames : [NO_MCP_SERVER]) args.push('--allowed-mcp-server-names', n);
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
export function geminiPreflight({ bin = geminiDefaultBin(), timeoutMs = 10000, env = process.env } = {}) {
  return familyPreflight({ bin, env, timeoutMs, label: 'Gemini CLI (npm i -g @google/gemini-cli)', binEnv: 'WORCA_GEMINI_BIN',
    signedIn: geminiSignedIn, signInHint: GEMINI_SIGNED_OUT_HINT });
}

// ── spawn ────────────────────────────────────────────────────────────────────

/** Whether Gemini would skip an --admin-policy file here (the system policy folder holds a .toml file). */
function systemPolicyPresent() {
  const dir = GEMINI_SYSTEM_POLICY_DIRS[process.platform] || GEMINI_SYSTEM_POLICY_DIRS.linux;
  try { return readdirSync(dir).some((f) => f.endsWith('.toml')); } catch { return false; }
}

const GEMINI_SPEC = Object.freeze({
  name: 'gemini', label: 'Gemini CLI', prefix: GEMINI_SESSION_PREFIX, envPrefixes: ['GEMINI_', 'GOOGLE_'],
  classify: classifyGeminiError, resumeNotFoundRe: GEMINI_RESUME_NOT_FOUND_RE,
  fatalStderrRe: GEMINI_POLICY_ERROR_RE, fatalMessage: 'Gemini CLI could not load worca\'s policy file, so the guardrail rules would not hold — stopped',
  createNormalizer: createGeminiNormalizer,
  prepare({ cwd, bin, sys, prompt, model, servers, permissionRules, includeDirs, scratchDir }) {
    const plan = geminiRulePlan(permissionRules);
    let policyFile = null;
    if (plan.rules.length) {
      if (systemPolicyPresent()) throw new Error(`${bin}: the system policy folder (${GEMINI_SYSTEM_POLICY_DIRS[process.platform] || GEMINI_SYSTEM_POLICY_DIRS.linux}) holds policy files, so Gemini CLI would skip worca's guardrail rules`);
      policyFile = join(scratchDir(), 'worca-policy.toml');
      writeFileSync(policyFile, geminiPolicyToml(plan.rules), { mode: 0o644 });
    }
    // The checkout's .gemini/settings.json: worca's MCP servers, or (none) worca's earlier file removed.
    const mcpServers = servers ? familyMcpServers(servers) : {};
    writeProjectFiles('gemini', cwd, Object.keys(mcpServers).length ? { '.gemini/settings.json': `${JSON.stringify({ mcpServers }, null, 2)}\n` } : {});
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
