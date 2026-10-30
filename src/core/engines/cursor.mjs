// src/core/engines/cursor.mjs
// The Cursor CLI adapter: `cursor-agent -p --output-format stream-json` argv, the stream normalized into worca's
// event vocabulary (no cost: Cursor bills by subscription and reports none), error classes, the run-start preflight,
// the guardrail rule plan written to `<cwd>/.cursor/cli.json`, MCP servers written to `<cwd>/.cursor/mcp.json`, and
// the spawn path on the shared supervisor (src/core/spawn.mjs).
//
// Facts this module builds on. NONE IS VERIFIED: the Cursor CLI was not installed where this adapter was written and
// no capture exists (test/fixtures/cursor is hand-written). Each line is a lead from Cursor's CLI docs. Check it
// against a real cursor-agent, then replace "unverified" with the version it held on.
// - unverified: the binary is `cursor-agent` (newer builds may also install it as `agent`). WORCA_CURSOR_BIN overrides.
//   `/usr/local/bin/cursor` is the EDITOR launcher, never this binary.
// - unverified: headless mode is `-p`/`--print` with `--output-format stream-json`, one JSON object per line.
// - unverified: `--model <id>` picks the model; with none, Cursor runs its account default.
// - unverified: `--resume <chatId>` continues a chat; the chat id is the stream's `session_id`.
// - unverified: `--force` lets commands run without approval unless a deny rule matches; `--approve-mcps` approves
//   MCP servers without a prompt — possibly also the user's own ~/.cursor/mcp.json servers, which worca never saw.
// - unverified: `cursor-agent status` reports the sign-in; `cursor-agent login` signs in; CURSOR_API_KEY in the
//   environment authenticates instead.
// - unverified: the stream is `system`/`init` (with `session_id`, `model`), `user`, `assistant` (message.content text
//   blocks, one per message between tool calls), `tool_call` `started`/`completed` pairs keyed by `call_id` whose
//   `tool_call` holds one `<kind>ToolCall` key (or `function`), and one final `result` (`is_error`, `result` text).
// - unverified: no usage cost is reported (`cost` is false: cost shows as unknown, never $0.00); a `usage` object on
//   `result` is passed on as tokens when present.
// - unverified: permissions come from `<cwd>/.cursor/cli.json` `permissions.{allow,deny}` with `Shell(cmd)` (matched
//   on the command's first word), `Read(glob)` and `Write(glob)` tokens, deny winning, merged with the user's
//   ~/.cursor/cli-config.json; MCP servers from `<cwd>/.cursor/mcp.json` (`mcpServers`, `${env:NAME}` expanded from
//   the process env). No flag is known that makes Cursor ignore the user-level files (codex has --ignore-user-config),
//   nor one that reads the project rules from outside the cwd, so the agent can edit them: each spawn puts worca's copy
//   back when it ends (restoreCursorProjectFiles, G14). With --force, approval is deny-list only.
// - unverified: the prompt is the last positional argument (no stdin mode is relied on); the agent can read a file
//   outside its cwd when told to (the long-prompt staging relies on it).
// - assumed absent (capability false): a system-prompt flag, an effort flag, a per-spawn tool allowlist, sub-agents,
//   hooks, a skills folder, a turn or spend cap, and any switch that turns the shell or file tools off — so an Ask
//   chat (CURSOR_ASK_LOCKDOWN) and a read-only spawn refuse.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { removeSessionEntries } from './sessions.mjs';
import { superviseSpawn, childEnv, execCheck, argValue, cleanRunEnv, safeEmit, abandonRoute } from '../spawn.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';
import { ARGV_INLINE_LIMIT } from './claude.mjs';
import { ENGINE_PROJECT_FILES, projectFileOwned, writeProjectFiles, restoreProjectFiles } from './project-files.mjs';
import { makeChatDescriptor } from './chat-descriptor.mjs';
export { excludeLine } from './project-files.mjs';
import { sandboxMcpConfig } from '../exec-env/policy.mjs';
import { CURSOR_CLI_CONFIG, CLI_POINTING, POINTING_NAMES } from '../exec-env/relay-route.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { brokerLease } from '../broker-lease.mjs';
import { currentOwner, normalizeBillTo } from '../billing.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { resolveModelRoute, localServerEnv } from '../exec-env/credentials.mjs';
import { engineEntry } from '../../shared/engine-switch.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const cursorDefaultBin = () => process.env.WORCA_CURSOR_BIN || 'cursor-agent';
export const CURSOR_SESSION_PREFIX = 'cursor:';

/** The Cursor chat in a stored session id, or null when the id is not Cursor's. */
export function cursorChatOf(sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(CURSOR_SESSION_PREFIX) && sessionId.length > CURSOR_SESSION_PREFIX.length
    ? sessionId.slice(CURSOR_SESSION_PREFIX.length) : null;
}

/**
 * Archive (catalog `sessions: 'user-store'`): cursor-agent keeps a chat as `<CURSOR_CONFIG_DIR or ~/.cursor>/chats/
 * <workspace>/<chatId>/`. Removes exactly those of `sessionIds` (`cursor:<chatId>`), never the sign-in.
 * @returns {Promise<{removed: string[], failed: {path: string, error: string}[]}>}
 */
export function removeCursorSessions({ sessionIds = [], env = process.env } = {}) {
  const ids = new Set(sessionIds.map((id) => cursorChatOf(id)).filter(Boolean));
  if (!ids.size) return Promise.resolve({ removed: [], failed: [] });
  const home = (env.CURSOR_CONFIG_DIR && env.CURSOR_CONFIG_DIR.trim()) || join(env.HOME || homedir(), '.cursor');
  return removeSessionEntries(join(home, 'chats'), (n) => ids.has(n), { depth: 1 });
}

const CURSOR_FALSE = new Set(['systemPromptFlag', 'allowedTools', 'effort', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
export const cursorCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !CURSOR_FALSE.has(k)])));

/** Ask Worca on Cursor: the flags that would leave Cursor no shell and no disk tools. null = no such flags are known,
 *  and Ask stays off Cursor (model-env.mjs ASK_ENGINES; ask/models.mjs, ask/turn.mjs). The chat descriptor below is
 *  wired so that verifying one is the only step left (plans/ask-on-qwen-gemini-spike.md › Cursor). */
export const CURSOR_ASK_LOCKDOWN = null;

/** What the gate and the run log say about the rules Cursor holds (all of them only in part). */
export const CURSOR_RULE_TERMS = Object.freeze({
  kind: 'permission-file rules',
  reach: 'worca writes them to .cursor/cli.json, but has not verified how the Cursor CLI matches them, and the agent\'s shell can still reach what a Read or Write rule names',
});

/** The project files Cursor reads from its cwd, relative to it. */
export const CURSOR_PROJECT_FILES = ENGINE_PROJECT_FILES.cursor;

// ── permission rules ─────────────────────────────────────────────────────────

/** `Bash(curl)`, `Bash(curl:*)`, `Bash(curl *)` -> 'curl'; null for anything Cursor's first-word Shell token cannot say. */
function shellWord(rule) {
  const m = /^Bash\((.+)\)$/.exec(rule);
  if (!m) return null;
  const body = m[1].trim().replace(/(?::\*| \*)$/, '').trim();
  return /^[A-Za-z0-9._/-]+$/.test(body) ? body : null;
}
/** A Claude path rule body as Cursor's glob. Claude: `//abs` is absolute, `/rel` is relative to the project root
 *  (the run checkout is Cursor's cwd), `~/…`, `./…` and bare patterns as written. */
const cursorPath = (body) => (body.startsWith('//') ? body.slice(1) : body.startsWith('/') ? `.${body}` : body);

/**
 * What Cursor can be told of a run's DENY rules (allow / ask are never lifted). Every rule it is told is `partial`
 * (CURSOR_RULE_TERMS): the gate refuses those unless --allow-unguarded-engine, and the spawn still writes them.
 * @returns {{deny:string[], partial:string[], unenforced:string[]}}
 */
export function cursorRulePlan(permissionRules) {
  const out = { deny: [], partial: [], unenforced: [] };
  const add = (token, rule) => { if (!out.deny.includes(token)) out.deny.push(token); out.partial.push(rule); };
  for (const raw of Array.isArray(permissionRules?.deny) ? permissionRules.deny : []) {
    const rule = String(raw).trim();
    if (!rule) continue;
    if (rule === 'Bash') { add('Shell(*)', rule); continue; }
    const word = shellWord(rule);
    if (word) { add(`Shell(${word})`, rule); continue; }
    const path = /^(Read|Edit|Write)\((.+)\)$/.exec(rule);
    if (path && path[2].trim()) { add(`${path[1] === 'Read' ? 'Read' : 'Write'}(${cursorPath(path[2].trim())})`, rule); continue; }
    out.unenforced.push(rule);
  }
  return out;
}
export function unenforcedRules(permissionRules) { return cursorRulePlan(permissionRules).unenforced; }
export function partialRules(permissionRules) { return cursorRulePlan(permissionRules).partial; }

// ── MCP ──────────────────────────────────────────────────────────────────────

const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** Every string inside `v` with `${VAR}` rewritten to Cursor's `${env:VAR}` (arrays and plain objects walked). */
const envRefs = (v) => (typeof v === 'string' ? v.replace(ENV_REF_RE, (_, n) => `\${env:${n}}`)
  : Array.isArray(v) ? v.map(envRefs)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, envRefs(x)]))
  : v);
/** An --mcp-config `mcpServers` map as Cursor's `.cursor/mcp.json`: `${VAR}` references become `${env:VAR}` in every
 *  string (the registry puts secret refs into stdio args and env, and into a remote server's url and headers:
 *  mcp/registry.mjs), so no secret value is ever written to disk (the values ride the cursor-agent process env). The
 *  registry refuses literal `${` text that is not a ref ('unsafe-text'), so the rewrite touches only refs. Each server
 *  keeps its own `env` block, so two registry copies of one server do not clash (codex needs scopeLauncherEnv; Cursor not). */
export function cursorMcpDocument(servers) {
  const mcpServers = {};
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (srv && typeof srv === 'object') mcpServers[name] = envRefs(srv);
  }
  return { mcpServers };
}

// ── the run checkout's .cursor files (engines/project-files.mjs) ─────────────

/** True when `abs` is absent (nothing to protect) or holds exactly what worca last wrote there. */
export const cursorOwns = (abs) => projectFileOwned('cursor', abs);
/** Make `cwd`'s Cursor project files match `files` (engines/project-files.mjs writeProjectFiles). */
export const writeCursorProjectFiles = (cwd, files, opts) => writeProjectFiles('cursor', cwd, files, opts);

/**
 * After a spawn: put back each of `files` that no longer holds worca's text (G14). Cursor reads its deny rules from
 * `<cwd>/.cursor/cli.json`, inside the checkout the agent writes, and no flag is known that points Cursor elsewhere, so
 * an agent can loosen them. What it changed must not reach the next spawn or a resume (engines/project-files.mjs
 * restoreProjectFiles). Mid-spawn the agent's edit may still bind (when Cursor rereads the file is unverified): the
 * rules are deny-list only.
 */
export const restoreCursorProjectFiles = (cwd, files, opts) => restoreProjectFiles('cursor', cwd, files, opts);

// ── argv ─────────────────────────────────────────────────────────────────────

/** `cursor-agent -p --output-format stream-json --force [--approve-mcps] [--model M] [--resume C] <prompt>`. */
export function buildCursorArgs({ prompt = '', model, resumeChatId, approveMcps = false } = {}) {
  const args = ['-p', '--output-format', 'stream-json', '--force'];
  if (approveMcps) args.push('--approve-mcps');
  if (model) args.push('--model', argValue(String(model), 'model'));
  if (resumeChatId) args.push('--resume', String(resumeChatId));
  args.push(String(prompt));
  return args;
}

/** One argv string's limit: Linux caps a single argument at 128 KiB (MAX_ARG_STRLEN); Windows a whole command line at 32 K. */
export const CURSOR_ARGV_LIMIT = process.platform === 'win32' ? ARGV_INLINE_LIMIT : 100_000;

// ── stream ───────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : '');
const TOOL_NAMES = Object.freeze({ shell: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', delete: 'Edit', grep: 'Grep', glob: 'Glob', ls: 'LS' });

/** One `tool_call` object -> { name, input, result } in Claude's tool vocabulary where one fits. */
function toolOf(tc) {
  const [key, body] = Object.entries(tc && typeof tc === 'object' ? tc : {})[0] || [];
  if (!key) return { name: 'tool', input: {}, result: null };
  if (key === 'function') {
    let input = {};
    try { input = JSON.parse(str(body?.arguments) || '{}'); } catch { input = { arguments: str(body?.arguments) }; }
    return { name: str(body?.name) || 'tool', input, result: body?.result ?? null };
  }
  const kind = key.replace(/ToolCall$/, '');
  const a = body?.args && typeof body.args === 'object' ? body.args : {};
  if (kind === 'mcp') return { name: `mcp__${str(a.providerIdentifier) || str(a.server)}__${str(a.toolName) || str(a.name)}`, input: a.args ?? {}, result: body?.result ?? null };
  if (kind === 'shell') return { name: 'Bash', input: { command: str(a.command) }, result: body?.result ?? null };
  if (TOOL_NAMES[kind] && 'path' in a) return { name: TOOL_NAMES[kind], input: { file_path: str(a.path) }, result: body?.result ?? null };
  return { name: TOOL_NAMES[kind] || kind, input: a, result: body?.result ?? null };
}

/** A tool result's text: stdout, content, a written path, else JSON; an `error`/`rejected`/failed shell is an error. */
function resultOf(r) {
  if (!r || typeof r !== 'object') return { isError: false, text: '' };
  const ok = r.success;
  if (ok && typeof ok === 'object') {
    const content = Array.isArray(ok.content) ? ok.content.map((c) => str(c?.text)).join('') : str(ok.content);
    const text = 'stdout' in ok ? str(ok.stdout) + str(ok.stderr) : content || str(ok.path) || JSON.stringify(ok);
    return { isError: Number.isFinite(ok.exitCode) && ok.exitCode !== 0, text };
  }
  const bad = r.error || r.rejected || r.failure;
  return { isError: true, text: typeof bad === 'string' ? bad : str(bad?.message) || str(bad?.reason) || JSON.stringify(bad ?? r) };
}

/**
 * stream-json lines in, normalized events out (src/core/engines/events.mjs). push(line|object) returns the events
 * for that line; finish() returns { text, error, sessionId } for the run. `error` is set by an `is_error` result, or by
 * the last top-level `error` when no result arrived.
 */
export function createCursorNormalizer({ model } = {}) {
  const texts = [];
  const started = new Set();
  let sessionId = null; let failed = null; let lastError = null; let resulted = false;

  function toolCall(evt) {
    const id = str(evt.call_id);
    if (!id) return [];
    const { name, input, result } = toolOf(evt.tool_call);
    const call = { name, input, toolUseId: id };
    if (evt.subtype !== 'completed') {
      if (started.has(id)) return [];
      started.add(id);
      return [{ type: 'tool', parentId: null, calls: [call] }];
    }
    const r = resultOf(result);
    const res = { type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: id, isError: r.isError, text: r.text, content: r.text }] };
    return started.has(id) ? [res] : [{ type: 'tool', parentId: null, calls: [call] }, res];
  }

  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object') return [];
    switch (evt.type) {
      case 'system':
        if (evt.subtype !== 'init' || !str(evt.session_id)) return [];
        sessionId = evt.session_id;
        return [{ type: 'session', sessionId: CURSOR_SESSION_PREFIX + sessionId, model: str(evt.model) || model || null, init: true }];
      case 'assistant': {
        const blocks = Array.isArray(evt.message?.content) ? evt.message.content : [];
        const t = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('');
        if (!t) return [];
        texts.push(t);
        return [{ type: 'text', text: t, parentId: null, from: 'assistant', blocks: [t], messageId: str(evt.message?.id) || null }];
      }
      case 'tool_call':
        return toolCall(evt);
      case 'error':
        lastError = str(evt.message) || str(evt.error?.message) || 'cursor reported an error';
        return [{ type: 'stderr', stream: 'err', text: `cursor: ${lastError}` }];
      case 'result': {
        resulted = true;
        // Only the Claude-style token keys worca's cost overrides read (resolveModelCost), and only numbers: an
        // unverified Cursor usage shape must not be misread as tokens (codex converts its own: claudeStyleUsage).
        const u = evt.usage && typeof evt.usage === 'object' ? evt.usage : {};
        const usage = Object.fromEntries(['input_tokens', 'output_tokens'].filter((k) => Number.isFinite(u[k])).map((k) => [k, u[k]]));
        if (evt.is_error || evt.subtype === 'error') {
          failed = str(evt.result) || str(evt.error?.message) || lastError || 'cursor run failed';
          // A failed turn still spent its tokens: a `result` (in a sandbox the relay's measure rides it instead).
          return Object.keys(usage).length ? [{ type: 'result', text: '', isError: true, usage }] : [];
        }
        return [{ type: 'result', text: str(evt.result) || texts.join('\n'), isError: false, ...(Object.keys(usage).length ? { usage } : {}) }];
      }
      default:
        return [];   // user echo, thinking, partial deltas: nothing worca reads
    }
  }
  const error = () => failed || (resulted ? null : lastError);
  return { push, finish: () => ({ text: texts.join('\n'), error: error(), sessionId }) };
}

// ── errors and auth ──────────────────────────────────────────────────────────

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyCursorError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  const msg = String((err && err.message) || err || '');
  if (/\b40[13]\b|unauthori[sz]ed|not (?:logged|signed) in|authentication (?:required|failed)|cursor-agent login|invalid api key|CURSOR_API_KEY/i.test(msg)) return 'auth';
  if (/hit your[^.]*\blimit\b|reached your[^.]*\blimit\b|\blimit\b[^.]*\bresets?\b|usage limit/i.test(msg)) return 'usage_limit';
  if (/\b429\b|\b529\b|rate.?limit|too many requests|overloaded/i.test(msg)) return 'rate_limit';
  if (/insufficient_quota|quota|billing|payment required/i.test(msg)) return 'quota';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)/i.test(msg)) return 'network';
  return null;
}

/** `cursor-agent status` output -> true / false / null (unknown). */
export function parseCursorStatus({ code, stdout = '', stderr = '' } = {}) {
  const all = `${stdout}\n${stderr}`;
  if (/not (?:logged|signed) in|not authenticated|logged out|unauthenticated/i.test(all)) return false;
  if (/logged in|signed in|authenticated/i.test(all)) return true;
  if (code === 1) return false;
  return null;
}

export const CURSOR_SIGNED_OUT_HINT = 'run `cursor-agent login`, or set CURSOR_API_KEY in worca\'s environment';

/** The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. A CURSOR_API_KEY
 *  in worca's environment stands in for the login; the binary must still run. */
export async function cursorPreflight({ bin = cursorDefaultBin(), timeoutMs = 10000, env = process.env, envAllowlist = [], spec: given = cursorSpawnSpec({ envAllowlist }) } = {}) {
  // Its own `env` (never a hard-coded process.env) plus the run env: a key there, or the broker's cursor slot, signs in
  // instead of `cursor-agent login`.
  const d = resolveModelRoute({ engine: 'cursor', serverEnv: { ...env, ...(given.runEnv || {}) }, broker: { on: brokerEnabled() }, checkModel: false });
  const spec = { ...given, signInMode: given.signInMode ?? d.signInMode, base: env };
  const { code, stdout, stderr, error } = await execCheck(bin, ['status'], { spec, timeoutMs });
  if (error) {
    return /^(ENOENT|EACCES|EINVAL)$/.test(String(error.code))
      ? { refusal: `cannot run ${bin} (${error.code}) — install the Cursor CLI (cursor-agent), or point WORCA_CURSOR_BIN at it` }
      : { warning: `could not check the Cursor sign-in (${error.message})` };
  }
  if (d.kind !== 'own') return {};
  const signedIn = parseCursorStatus({ code, stdout, stderr });
  if (signedIn === false) return { refusal: `${bin} is not signed in — ${CURSOR_SIGNED_OUT_HINT}` };
  if (signedIn === null) return { warning: `could not tell whether ${bin} is signed in (\`${bin} status\` said nothing recognizable)` };
  return {};
}

/** The childEnv spec a cursor run spawns with (engine, the route resolver's sign-in mode, the run's allowlist and env,
 *  cwd and work root, the host pid): run and preflight build their env from it, so a CURSOR_API_KEY the run gets counts
 *  for the check too. */
export function cursorSpawnSpec({ envAllowlist = [], cwd = null, workRoot = null, hostPid = null, runEnv = null, signInMode = null } = {}) {
  return { engine: 'cursor', signInMode, allowlist: envAllowlist, cwd, root: workRoot, hostPid, runEnv };
}

/** A brokered local cursor-agent's config dir (CURSOR_CONFIG_DIR): worca's own, one per person whose work it runs
 *  (`owner`, currentOwner(): one person's chats never land beside another's), 0700, holding the HTTP/1.1 agent stream
 *  config the broker can carry (CURSOR_CLI_CONFIG). The user's ~/.cursor is never written. */
export function brokeredCursorHome(owner = currentOwner(), root = join(worcaHome(), 'engines', 'cursor', 'broker-home')) {
  const who = normalizeBillTo(owner) || 'local';
  const base = join(root, who === 'local' ? who : createHash('sha256').update(who).digest('hex').slice(0, 16));
  mkdirSync(base, { recursive: true, mode: 0o700 });
  chmodSync(base, 0o700);
  const file = join(base, 'cli-config.json');
  let current = null; try { current = readFileSync(file, 'utf8'); } catch { /* first use */ }
  if (current !== CURSOR_CLI_CONFIG) writeFileSync(file, CURSOR_CLI_CONFIG, { mode: 0o600 });
  return base;
}

// ── spawn ────────────────────────────────────────────────────────────────────

/** Cursor's answer to `--resume <unknown chat>` (unverified wording). */
export const CURSOR_RESUME_NOT_FOUND_RE = /(?:chat|conversation|session)[^.\n]*not found|no (?:chat|conversation|session) (?:found|with id)/i;

/**
 * Run one Cursor turn. Same resolved value and rejection contract as the Claude adapter: {text, exitCode}; an Error
 * with `errorClass` on failure. Options Cursor has no lever for (allowedTools, effort, agents, maxBudgetUsd,
 * writableDirs, addDirs — Cursor has no sandbox) are ignored; the run start logs each as a degradation. `maxTurns`
 * caps the main agent's tool calls, counted as codex counts them.
 */
export async function runCursorProcess({
  cwd = process.cwd(), systemPrompt = '', prompt = '', model, onEvent = () => {}, signal,
  bin = cursorDefaultBin(), resumeSessionId, sandbox, askLockdown, envScrub, envAllowlist, asAgent,
  mcpConfigPath, spawnEnv: runSpawnEnv, redactValues, maxTurns, permissionRules, noGit = false, execEnv, workRoot = null,
  billTo, spawnKind, runId, threadId, maxBudgetUsd, permissionMode,
} = {}) {
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  if (askLockdown) throw new Error(`${bin}: Cursor cannot be locked down for a chat (no switch for its shell or file tools) — Chat on Cursor is unavailable`);
  if (sandbox === 'read-only') throw new Error(`${bin}: Cursor has no read-only mode — a read-only job runs on Claude instead`);
  const secrets = Array.isArray(redactValues) ? redactValues : [];
  // A broker token, once taken, is redacted too (the redactor is rebuilt then).
  let redactor = secrets.length ? createRedactor(secrets) : null;
  { const emit = onEvent; onEvent = (e) => emit(redactor ? redactor.deep(e) : e); }
  const redacted = (err) => {
    if (redactor && err && typeof err.message === 'string') err.message = redactor.text(err.message);
    if (redactor && err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
    return err;
  };

  let chat = cursorChatOf(resumeSessionId);
  if (resumeSessionId && !chat) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] cursor: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not a Cursor chat — starting a fresh one` });

  // A remote run (exec-env, e2b): the template's cursor-agent, its calls through worca's model relay, which signs them
  // with an access token worca exchanges for the server's CURSOR_API_KEY (neither enters the sandbox); no host guard;
  // the run's url MCP servers only; the .cursor files written here as always (every ownership check holds), then
  // mirrored into the sandbox checkout (the harness keeps them out of the sync tree, syncEngineFiles out of its git).
  const remote = execEnv?.remote ? execEnv : null;
  // How this spawn's model calls are signed (credentials.mjs resolveModelRoute), before anything is staged (the .cursor
  // files included).
  const decision = resolveModelRoute({ engine: 'cursor', remote: !!remote, serverEnv: remote ? remote.env : localServerEnv(cleanRunEnv(runSpawnEnv)),
    model: model || null, broker: { on: brokerEnabled() } });
  if (decision.refusal) throw Object.assign(new Error(decision.refusal), { errorClass: 'config' });
  // A brokered local cursor-agent keeps its config and chats in worca's own dir (brokeredCursorHome), which an agent
  // user (another uid, agent-user.mjs) can neither read nor write.
  if (decision.kind === 'brokered' && !remote && asAgent && agentIdentityFor(currentOwner())) {
    throw Object.assign(new Error(`${bin}: Cursor under the credential broker cannot run as an agent user yet (its config dir is worca's own) — run Cursor in a sandbox`), { errorClass: 'config' });
  }
  const upstream = engineEntry('cursor').relay.upstream;
  // The checkout's .cursor files: deny rules and MCP servers (D3). Written before the spawn; a tracked file throws.
  const plan = cursorRulePlan(permissionRules);
  const files = {};
  if (plan.deny.length) files['.cursor/cli.json'] = `${JSON.stringify({ permissions: { deny: plan.deny } }, null, 2)}\n`;
  let servers = null;
  if (mcpConfigPath) {
    let doc;
    try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
    if (remote) doc = sandboxMcpConfig(doc).config;
    servers = doc && typeof doc.mcpServers === 'object' && doc.mcpServers && Object.keys(doc.mcpServers).length ? doc.mcpServers : null;
    if (servers) files['.cursor/mcp.json'] = `${JSON.stringify(cursorMcpDocument(servers), null, 2)}\n`;
  }
  writeCursorProjectFiles(cwd, files, { git: !noGit, root: workRoot });

  if (remote && bin !== 'cursor-agent') safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] cursor: ${bin} (this machine's binary) is ignored; the ${remote.label} runs its own pinned cursor-agent` });
  const exe = remote ? 'cursor-agent' : bin;
  const guardOn = hostGuardEnabled() && !remote;
  // The catalog allowlist (childEnv: CURSOR_API_KEY, its config dir); the run env carries the MCP servers' ${env:…} values.
  const { env } = childEnv(cursorSpawnSpec({ envAllowlist, cwd, workRoot, hostPid: guardOn ? process.pid : null, runEnv: cleanRunEnv(runSpawnEnv), signInMode: decision.signInMode }));
  // In a sandbox only the kept MCP servers' ${env:…} values ride along (the run env holds every registry secret).
  // The relay route and the template's cursor-agent come first, then its config dir (CURSOR_CONFIG_DIR: the HTTP/1.1
  // agent stream the relay can carry) and the .cursor files: a refusal leaves nothing in the sandbox.
  // The broker token is taken here, late (a refusal above leaves none behind), and released in the outer finally: a
  // resumed chat Cursor no longer knows is retried under the same token. Local brokered: cursor-agent calls the broker's
  // cursor slot with it, from worca's own config dir.
  // A route per attempt (a retry is a second spawn, and each spawn's end closes its own route): the first is opened
  // here, with the sandbox's engine home kept apart so the retry's env is the same but for its route.
  let relayRoute = null; let lease = null; let homeEnv = {};
  try {
    lease = decision.slot && (decision.kind === 'brokered' || remote)
      ? await brokerLease({ billTo, spawnKind, permissionMode, askLockdown, runId, threadId, maxBudgetUsd, asAgent, execEnv }, decision.slot)
      : null;
    if (lease) redactor = createRedactor([...secrets, ...lease.secrets]);
    if (remote) {
      relayRoute = remote.openRoute(decision, { spawnEnv: env, lease });
      await remote.ensureCli(exe);
      homeEnv = await remote.engineHome('cursor', { files: [{ rel: 'cli-config.json', data: CURSOR_CLI_CONFIG }] });
      await remote.syncEngineFiles(Object.keys(files).map((rel) => join(cwd, rel)));
    } else if (lease) {
      const pointed = CLI_POINTING[upstream].spawn(lease.baseUrl + CLI_POINTING[upstream].suffix, lease.token, model);
      for (const k of POINTING_NAMES[upstream]) delete env[k];
      Object.assign(env, pointed.env, { CURSOR_CONFIG_DIR: brokeredCursorHome() });
    }
  } catch (err) { await abandonRoute(remote, relayRoute, onEvent); lease?.release(); throw redacted(err); }
  const spawnEnv = env;
  const sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : systemPrompt;
  // No system-prompt flag (capability false): the system prompt is folded into the prompt behind a delimiter.
  const full = sys ? `=== SYSTEM ===\n${sys}\n=== END SYSTEM ===\n\n${String(prompt ?? '')}` : String(prompt ?? '');
  let stagedDir = null;
  let positional = full;
  if (Buffer.byteLength(full, 'utf8') > CURSOR_ARGV_LIMIT) {
    try {
      // One fresh dir per spawn: superviseSpawn shares it with the agent user (stagedDir) when the spawn runs as one.
      const base = join(worcaHome(), 'tmp', 'cursor-prompts');
      mkdirSync(base, { recursive: true });
      stagedDir = mkdtempSync(join(base, `prompt-${process.pid}-`));
      const staged = join(stagedDir, 'prompt.md');
      writeFileSync(staged, full, { mode: 0o600 });
      positional = `Your complete instructions are too long for the command line: read the whole file ${staged} first, then follow it exactly as if it were this message.`;
    } catch (err) {
      if (stagedDir) rmSync(stagedDir, { recursive: true, force: true });
      await abandonRoute(remote, relayRoute, onEvent);
      lease?.release();
      throw redacted(err);
    }
  }

  // G14: what the agent changed in worca's .cursor files during a spawn is put back before the next one (or a retry).
  // A remote spawn changed the sandbox's mirror, not this checkout: worca's copy is mirrored there again.
  const restore = async () => {
    let changed;
    try { changed = restoreCursorProjectFiles(cwd, files, { git: !noGit, root: workRoot }); } catch (err) {
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] cursor: could not restore worca's .cursor files: ${err.message}` });
      return;
    }
    if (remote) {
      try { await remote.syncEngineFiles(Object.keys(files).map((rel) => join(cwd, rel))); } catch (err) {
        safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] cursor: could not restore worca's .cursor files in the ${remote.label}: ${redacted(err).message}` });
      }
    }
    if (changed.length) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] cursor: the agent changed ${changed.join(' and ')} during the spawn — worca put its own copy back` });
  };

  const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
  const turnCap = () => Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true });
  /** One spawn of cursor-agent. `route`: this attempt's own relay route (remote; null locally): metered, and closed by
   *  the spawn's end, booking what the relay measured that no result covered. */
  const attempt = async (resumeChatId, route) => {
    const normalizer = createCursorNormalizer({ model });
    const capCtrl = new AbortController();
    let toolCalls = 0; let capped = false; let sawSession = false;
    let turnDone = false;   // the closing `result`: what the step leaves running after it is killed (R15)
    const spawnSignal = cap ? (signal ? AbortSignal.any([signal, capCtrl.signal]) : capCtrl.signal) : signal;
    const ev = route ? remote.meteredEvents(route.id, onEvent) : onEvent;
    let args; let env2 = spawnEnv;
    try {
      args = buildCursorArgs({ prompt: positional, model, resumeChatId, approveMcps: !!servers });
      if (route) env2 = { ...remote.envFor(env, { engine: 'cursor', keep: remote.mcpEnvRefs, route }), ...homeEnv };
    } catch (err) { await abandonRoute(remote, route, onEvent); throw err; }
    let res;
    try {
      res = await superviseSpawn({
        file: exe, args, displayBin: bin, cwd, env: env2, stdin: null, signal: spawnSignal, asAgent: remote ? false : asAgent, stagedDir, onEvent: ev,
        execEnv: remote, route,
        cleanup: () => {},
        stdoutErrorDetail: () => normalizer.finish().error || '',
        classify: (m) => classifyCursorError(m),
        redactText: redactor ? (t) => redactor.text(t) : null,
        spawnError: (err, pfx) => Object.assign(new Error(`${pfx}: ${err.message}`), { errorClass: /ENOENT|EINVAL/.test(String(err.code || err.message)) ? 'network' : null }),
        onDone: (code) => ({ code }),
        turnOver: () => turnDone,
        onStdoutLine: (line) => {
          for (const e of normalizer.push(line)) {
            safeEmit(ev, e);
            if (e.type === 'result') turnDone = true;
            if (cap && !capped && e.type === 'tool' && (e.parentId ?? null) === null && (toolCalls += e.calls.length) > cap) { capped = true; capCtrl.abort(); }
            // Pause/Resume: the runner's own session event (no `init`) is the one the harness stamps on the step.
            if (e.type === 'session') { sawSession = true; safeEmit(ev, { type: 'session', sessionId: e.sessionId }); }
          }
        },
      }).catch((err) => {
        if (capped && !signal?.aborted) throw turnCap();
        const f = normalizer.finish();
        if (f.error && err?.name !== 'AbortError' && err?.stream === 'err') {
          err.message = `${bin}: ${f.error} — ${err.message}`;
          err.errorClass = strongestClass(err.errorClass ?? null, classifyCursorError(f.error));
        }
        err.sawSession = sawSession;
        throw err;
      });
    } finally {
      await restore();
    }
    const final = normalizer.finish();
    if (capped && !signal?.aborted) throw turnCap();
    if (final.error) throw Object.assign(new Error(`${bin}: ${final.error}`), { errorClass: classifyCursorError(final.error), sawSession });
    return { text: final.text, exitCode: res.code };
  };

  try {
    let out;
    try {
      out = await attempt(chat, relayRoute);
    } catch (err) {
      // A resumed chat Cursor no longer knows (before any session started): one fresh attempt, said out loud.
      if (!chat || err?.sawSession || err?.name === 'AbortError' || !CURSOR_RESUME_NOT_FOUND_RE.test(String(err?.message || ''))) throw err;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] cursor: chat ${chat.slice(0, 12)}… is gone — starting a fresh one` });
      chat = null;
      out = await attempt(null, remote ? remote.openRoute(decision, { spawnEnv: env, lease }) : null);
    }
    return { text: redactor ? redactor.text(out.text) : out.text, exitCode: out.exitCode };
  } catch (err) {
    throw redacted(err);
  } finally {
    if (stagedDir) rmSync(stagedDir, { recursive: true, force: true });
    lease?.release();
  }
}

// ── chat ─────────────────────────────────────────────────────────────────────

/** Why the chat self-test cannot run on cursor-agent: it has no option worca knows that points it at another model
 *  endpoint, and its sign-in is Cursor's own. */
export const CURSOR_NO_SELF_TEST = 'cursor-agent has no setting worca knows that points it at a local model endpoint, so worca cannot prove a lockdown on it';

/** Cursor's chat descriptor (engines/chat-descriptor.mjs): wired, off. Chat on Cursor needs a lockdown verified on the
 *  real binary (CURSOR_ASK_LOCKDOWN) and a self-test that can run; neither exists yet, so engine-switch.mjs marks its
 *  chat `verified: false` and engines/chat.mjs leaves it out of the chat engines. */
export const cursorChat = makeChatDescriptor({
  engine: 'cursor',
  lockdown: () => CURSOR_ASK_LOCKDOWN,
  selfTest: async () => ({ refusal: CURSOR_NO_SELF_TEST }),
  preflight: (_ctx, impl = cursorPreflight) => impl(),
  resumeNotFound: (err) => CURSOR_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')),
});
