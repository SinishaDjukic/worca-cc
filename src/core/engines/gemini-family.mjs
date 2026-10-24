// src/core/engines/gemini-family.mjs
// What the Gemini CLI adapter (engines/gemini.mjs) and the Qwen Code adapter (engines/qwen.mjs) share. Qwen Code is a
// fork of Gemini CLI: both name their tools alike (run_shell_command, read_file, write_file, …), take the prompt on
// stdin, name a session up front (`--session-id`) and resume it (`--resume`), add workspace folders
// (`--include-directories`), filter MCP servers by name (`--allowed-mcp-server-names`), read MCP servers in the same
// settings shape (filling `${VAR}` from their own env) and report tokens but no cost. Their stream formats, rule
// files and sign-ins differ; those stay in the per-engine files.
//
// Verified on gemini 0.63.0 and qwen 0.25.0 (test/fixtures/gemini/README.md, test/fixtures/qwen/README.md).
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { superviseSpawn, childEnv, execCheck, runCapture, cleanRunEnv, safeEmit, writableRootsInWorcaHome } from '../spawn.mjs';
import { resolveModelRoute, localServerEnv } from '../exec-env/relay-route.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { removeSessionEntries } from './sessions.mjs';
import { ruleKind } from '../../shared/engine-switch.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';

const str = (v) => (typeof v === 'string' ? v : '');

// ── sessions ─────────────────────────────────────────────────────────────────

// worca names every session with a uuid (`--session-id`, randomUUID): a stored id of any other shape is not one of
// them, and never reaches argv (`--resume -oX`) or a session path.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The engine's own session in a stored session id (`gemini:<uuid>`), or null when the id is another engine's or not a
 *  uuid worca named. */
export function familySessionOf(prefix, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.startsWith(prefix)) return null;
  const id = sessionId.slice(prefix.length);
  return SESSION_ID_RE.test(id) ? id : null;
}

/**
 * Archive (catalog `sessions: 'user-store'`): remove the sessions named by a run's session ids (`<prefix><uuid>`) from
 * the CLI's own store, `roots` (each walked `depth` folders down, links never followed). An entry is the run's when its
 * name holds the uuid, or when it is a session file (.json / .jsonl) whose name holds the uuid's first block and whose
 * text names the whole uuid (Gemini CLI names its chat files by a timestamp and that block). Never a sign-in file: none
 * holds a session id.
 * @returns {Promise<{removed: string[], failed: {path: string, error: string}[]}>}
 */
export async function removeFamilySessions({ sessionIds = [], prefix, roots = [], depth = 2 }) {
  const ids = [...new Set(sessionIds.map((s) => familySessionOf(prefix, s)).filter(Boolean))];
  const out = { removed: [], failed: [] };
  if (!ids.length) return out;
  const names = (text) => ids.some((id) => text.includes(id));
  const match = (name, path) => {
    if (names(name)) return true;
    if (!/\.jsonl?$/.test(name) || !ids.some((id) => name.includes(id.slice(0, 8)))) return false;
    try { return statSync(path).size <= SESSION_FILE_MAX && names(readFileSync(path, 'utf8')); } catch { return false; }
  };
  for (const root of roots) {
    const r = await removeSessionEntries(root, match, { depth });
    out.removed.push(...r.removed); out.failed.push(...r.failed);
  }
  return out;
}
// The largest session file read to find its id (a long chat is a few MB).
const SESSION_FILE_MAX = 64 * 1024 * 1024;

// ── tools ────────────────────────────────────────────────────────────────────

/** The family's built-in tools in Claude's names (the run log, the UI and the cost rows read Claude's names). */
const TOOL_NAMES = Object.freeze({
  run_shell_command: 'Bash', read_file: 'Read', read_many_files: 'Read', write_file: 'Write', replace: 'Edit', edit: 'Edit',
  grep_search: 'Grep', search_file_content: 'Grep', glob: 'Glob', list_directory: 'LS', web_fetch: 'WebFetch',
  google_web_search: 'WebSearch', web_search: 'WebSearch', write_todos: 'TodoWrite', todo_write: 'TodoWrite',
});

/**
 * A family tool name in Claude's vocabulary. MCP tools become `mcp__<server>__<tool>`: Qwen already names them so;
 * Gemini names them `mcp_<server>_<tool>`, where a server name may itself hold an underscore, so the longest server
 * name worca attached wins, else the name splits at the first underscore (as Gemini's own policy parser does).
 * @param {string} name
 * @param {string[]} [mcpNames] the servers worca attached
 */
export function claudeToolName(name, mcpNames = []) {
  const n = str(name);
  if (n.startsWith('mcp__')) return n;
  if (n.startsWith('mcp_')) {
    const rest = n.slice(4);
    const server = [...mcpNames].sort((a, b) => b.length - a.length).find((s) => rest.startsWith(`${s}_`) && rest.length > s.length + 1);
    if (server) return `mcp__${server}__${rest.slice(server.length + 1)}`;
    const cut = rest.indexOf('_');
    if (cut > 0 && cut < rest.length - 1) return `mcp__${rest.slice(0, cut)}__${rest.slice(cut + 1)}`;
    return n;
  }
  return TOOL_NAMES[n] || n;
}

/** The path arguments of the family's file tools. */
const PATH_KEYS = Object.freeze(['file_path', 'dir_path', 'path', 'absolute_path']);
/** A tool input with its relative path arguments made absolute against `cwd`: both CLIs may pass cwd-relative paths,
 *  and worca reads a tool row's path as absolute (Claude Code always passes one). No cwd: the input as given. */
export function absolutePaths(input, cwd) {
  if (!cwd || !input || typeof input !== 'object' || Array.isArray(input)) return input;
  let out = input;
  for (const k of PATH_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v && !isAbsolute(v) && !v.startsWith('~')) out = { ...out, [k]: resolve(cwd, v) };
  }
  return out;
}

// ── rules ────────────────────────────────────────────────────────────────────

/**
 * A Claude command rule's command: `Bash(git push:*)` / `Bash(git push *)` / `Bash(curl)` -> 'git push' / 'curl';
 * '' for a rule over every command (`Bash(*)`); null for anything that is not a command rule or holds a wildcard
 * mid-command (no prefix can say it).
 */
export function commandRuleBody(rule) {
  const m = /^Bash\((.*)\)$/.exec(String(rule).trim());
  if (!m) return null;
  const body = m[1].trim().replace(/(?::\*| \*)$/, '').trim();
  if (!body || body === '*') return '';
  return /[*?]/.test(body) ? null : body;
}

/** `mcp__server__tool` -> {server, tool}; `mcp__server` and `mcp__server__*` -> {server, tool: null}; else null. */
export function mcpRuleParts(rule) {
  const m = /^mcp__(.+?)(?:__(.+))?$/.exec(String(rule).trim());
  if (!m || !m[1]) return null;
  return { server: m[1], tool: m[2] && m[2] !== '*' ? m[2] : null };
}

// ── MCP ──────────────────────────────────────────────────────────────────────

/** The `--allowed-mcp-server-names` value that names no server: worca attached none, so neither the user's own
 *  servers (whose tools worca's guardrails never saw) nor the checkout's attach. */
export const NO_MCP_SERVER = '__worca_no_mcp_server__';

/** The --mcp-config servers of a spawn, or null when it names none. Throws when the file cannot be read. */
export function readMcpServers(mcpConfigPath, bin) {
  if (!mcpConfigPath) return null;
  let doc;
  try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
  const servers = doc && typeof doc.mcpServers === 'object' && doc.mcpServers ? doc.mcpServers : {};
  return Object.keys(servers).length ? servers : null;
}

/**
 * Claude Code --mcp-config servers in the family's settings shape: a stdio server keeps command/args/env/cwd; a remote
 * one is `httpUrl` (streamable HTTP) or `url` (SSE), with its headers. `${VAR}` references stay references: the CLI
 * fills them from its own env, where the run env puts their values, so no secret value is written to disk.
 */
export function familyMcpServers(servers) {
  const out = {};
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (!srv || typeof srv !== 'object') continue;
    if (typeof srv.command === 'string') {
      out[name] = { command: srv.command, ...(Array.isArray(srv.args) ? { args: srv.args.map(String) } : {}),
        ...(srv.env && typeof srv.env === 'object' ? { env: srv.env } : {}), ...(typeof srv.cwd === 'string' ? { cwd: srv.cwd } : {}) };
    } else if (typeof srv.url === 'string') {
      out[name] = { [srv.type === 'sse' ? 'url' : 'httpUrl']: srv.url, ...(srv.headers && typeof srv.headers === 'object' ? { headers: srv.headers } : {}) };
    }
  }
  return out;
}

// ── errors ───────────────────────────────────────────────────────────────────

/** Errors both CLIs print (Google's API errors through Gemini, and Qwen's own providers).
 *  @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyFamilyError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  const msg = String((err && err.message) || err || '');
  if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED|\b40[13]\b|unauthori[sz]ed|invalid api key|authentication (?:required|failed)|Please set an Auth method|No auth type is selected|must specify the (?:GEMINI|GOOGLE)_API_KEY/i.test(msg)) return 'auth';
  if (/per_?day|per day|daily (?:limit|quota)|usage limit|reached your[^.]*\blimit\b/i.test(msg)) return 'usage_limit';
  if (/\b429\b|\b529\b|RESOURCE_EXHAUSTED|rate.?limit|too many requests|overloaded/i.test(msg)) return 'rate_limit';
  if (/insufficient_quota|quota|billing|payment required/i.test(msg)) return 'quota';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)/i.test(msg)) return 'network';
  return null;
}

// ── preflight ────────────────────────────────────────────────────────────────

/** The user's home as the CLI sees it (`env.HOME`, else the OS's). */
export const homeOf = (env) => (str(env?.HOME).trim() || homedir());

/** The KEY=value lines of dotenv `files` (the first file that sets a key wins; quotes stripped). Never throws. Both
 *  CLIs load such files into their own env, so a sign-in may live there. */
export function readDotenv(files) {
  const out = {};
  for (const f of files) {
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/gm)) {
      const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (!(m[1] in out) && v) out[m[1]] = v;
    }
  }
  return out;
}

/** A settings file's chosen sign-in (`security.auth.selectedType`, or the older top-level `selectedAuthType`). */
export function settingsAuthType(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return str(s?.security?.auth?.selectedType) || str(s?.selectedAuthType) || null;
  } catch { return null; }
}

/**
 * The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. The binary must run
 * (`--version`) under the env the run gets (src/core/spawn.mjs execCheck: `engine`'s catalog allowlist plus the
 * run's); `signedIn(env)` says whether a sign-in is configured in that env (neither CLI has a status command, so this
 * reads its env and settings files, never its credentials).
 */
export async function familyPreflight({ bin, engine, env = process.env, envAllowlist = [], timeoutMs = 10000, label, binEnv, signedIn, signInHint, configuredMode = null }) {
  const d = resolveModelRoute({ engine, serverEnv: env, broker: { on: brokerEnabled() }, checkModel: false, configured: configuredMode ? configuredMode(env) : null });
  const spec = { engine, signInMode: d.signInMode, allowlist: envAllowlist, base: env };
  const { code, error } = await execCheck(bin, ['--version'], { spec, timeoutMs });
  if (error) {
    return /^(ENOENT|EACCES|EINVAL)$/.test(String(error.code))
      ? { refusal: `cannot run ${bin} (${error.code}) — install ${label}, or point ${binEnv} at it` }
      : { warning: `could not run ${bin} --version (${error.message})` };
  }
  if (code !== 0) return { warning: `${bin} --version exited with code ${code}` };
  return signedIn(childEnv({ kind: 'preflight', ...spec }).env) ? {} : { refusal: `${bin} is not signed in — ${signInHint}` };
}

// ── chat ─────────────────────────────────────────────────────────────────────

/** `a` is at least `b` (dotted numbers; a pre-release tag ignored). */
export function versionAtLeast(a, b) {
  const n = (v) => String(v).replace(/^[^0-9]*/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
}

/**
 * Can this CLI be locked down for a chat? Its `--help` names every flag the lockdown needs and its `--version` is at
 * least the one the lockdown was verified on. Never rejects: {refusal} or {}.
 */
export function familyAskSupport({ bin, timeoutMs = 15000, flags, minVersion, label, install, binEnv, extra = null }) {
  // The owner's runner with the base env only (no engine names, no credential): --version and --help need none.
  const run = async (args) => {
    const r = await runCapture(bin, args, { spec: {}, timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { err: r.error || (r.code !== 0 ? { code: r.code } : null), out: r.stdout };
  };
  return (async () => {
    const v = await run(['--version']);
    if (v.err && typeof v.err.code !== 'number') {
      return { refusal: /^(ENOENT|EACCES|EINVAL)$/.test(String(v.err.code)) ? `cannot run ${bin} (${v.err.code}) — install ${label} (${install}), or point ${binEnv} at it` : `could not ask ${bin} its version (${v.err.message})` };
    }
    const version = v.out.trim().split('\n')[0];
    if (!versionAtLeast(version, minVersion)) return { refusal: `this ${bin} is ${version || 'of an unknown version'}; a chat needs ${label} ${minVersion} or newer — update it (${install})` };
    const h = await run(['--help']);
    const missing = flags.filter((f) => !new RegExp(`(^|\\s)${f.replace(/-/g, '\\-')}(\\s|=|$)`, 'm').test(h.out));
    if (missing.length) return { refusal: `this ${bin} has no ${missing.join(', ')} to lock a chat down — update ${label} to ${minVersion} or newer` };
    const more = extra ? extra() : null;
    return more ? { refusal: more } : {};
  })();
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Settings objects merged left to right: objects deeply, anything else (arrays, null, scalars) replaced. */
export function mergeSettings(...docs) {
  const out = {};
  for (const d of docs) {
    if (!isPlain(d)) continue;
    for (const [k, v] of Object.entries(d)) out[k] = isPlain(v) && isPlain(out[k]) ? mergeSettings(out[k], v) : isPlain(v) ? mergeSettings(v) : v;
  }
  return out;
}

/** A chat's MCP servers with `${NAME}` references to the env names their child must get from the CLI's env (the
 *  command bridge token, SSH_AUTH_SOCK, the web search key): either CLI may hand its MCP children a filtered env, but
 *  both fill a reference from their own. */
export function withEnvRefs(servers, names) {
  if (!servers || !names.length) return servers;
  const out = {};
  for (const [n, srv] of Object.entries(servers)) {
    out[n] = srv && typeof srv === 'object' && typeof srv.command === 'string'
      ? { ...srv, env: { ...Object.fromEntries(names.map((k) => [k, `\${${k}}`])), ...(isPlain(srv.env) ? srv.env : {}) } }
      : srv;
  }
  return out;
}

// ── spawn ────────────────────────────────────────────────────────────────────

/** The env names an MCP server config references (`$VAR`, `${VAR}`, `${VAR:-default}`), sorted. */
export function envRefNames(servers) {
  if (!servers) return [];
  return [...new Set([...JSON.stringify(servers).matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort();
}
const pickEnv = (env, names) => Object.fromEntries(names.filter((k) => typeof env[k] === 'string').map((k) => [k, env[k]]));

/** The sign-in mode a spawn of `spec`'s engine keeps (credentials.mjs resolveModelRoute over worca's env and the run's):
 *  the one the CLI's own settings choose (spec.configuredMode), else the catalog order. */
function familySignInMode(spec, runEnv, model) {
  const serverEnv = localServerEnv(runEnv);
  const d = resolveModelRoute({ engine: spec.name, serverEnv, model: model || null, broker: { on: brokerEnabled() }, checkModel: false,
    configured: spec.configuredMode ? spec.configuredMode(serverEnv) : null });
  if (d.refusal) throw Object.assign(new Error(`${spec.label}: ${d.refusal}`), { errorClass: 'config' });
  return d.signInMode;
}

/** The sign-in mode a chat on `spec`'s engine signs in with for `model` (chat descriptor `signInMode`): the one its spawn
 *  keeps (familySignInMode over worca's env); '' (no names) when the route is refused, as the spawn itself is. */
export function familyChatSignInMode(spec, model) {
  try { return familySignInMode(spec, {}, model); } catch { return ''; }
}

/** The store project folders (`<worca home>/store/<project>`) that hold any of `dirs`. */
export function storeProjectDirs(dirs, home = worcaHome()) {
  const store = resolve(home, 'store');
  const out = [];
  for (const d of dirs) {
    const rel = relative(store, resolve(d));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    const p = join(store, rel.split(sep)[0]);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** One argv string's limit: Linux caps a single argument at 128 KiB (MAX_ARG_STRLEN); Windows a whole command line at 32 K. */
export const FAMILY_ARGV_LIMIT = process.platform === 'win32' ? 8000 : 100_000;

/** The system prompt folded into the prompt behind a delimiter (no flag, or one too long for argv). */
export const foldSystemPrompt = (sys, prompt) => (sys ? `=== SYSTEM ===\n${sys}\n=== END SYSTEM ===\n\n${String(prompt ?? '')}` : String(prompt ?? ''));

/**
 * Run one turn of a family CLI. Same resolved value and rejection contract as the Claude adapter: {text, exitCode};
 * an Error with `errorClass` on failure.
 * - The session is named before the spawn (`--session-id`) and emitted at once, so a step paused at any point resumes
 *   it. A stored session of this engine is resumed; one the CLI no longer knows (spec.resumeNotFoundRe, before any
 *   output) gets one fresh attempt, said out loud.
 * - The folders worca hands the agent (addDirs, writableDirs) become workspace folders; none may sit in Worca's own
 *   home outside the run store (writableRootsInWorcaHome), whose path rules these CLIs hold only in part.
 * - A read-only spawn refuses: these CLIs have no read-only mode (their helper jobs run on Claude). An Ask chat
 *   (askLockdown) runs only with the engine's spec.askLockdown: spec.prepare gets `ask: true` and builds the lockdown
 *   (engines/qwen.mjs, engines/gemini.mjs); such a spawn has no file tool of its own, so its cwd may sit in Worca's
 *   home, and a session the CLI no longer knows is the turn's to handle (ask/turn.mjs resumeNotFound), not retried here.
 *   `probe` ({env}): the chat self-test's endpoint (engines/chat-selftest.mjs).
 * - `maxTurns` caps the main agent's tool calls, counted as codex counts them.
 * - spec.prepare writes the engine's config (a scratch folder under Worca's home, or the checkout) and returns
 *   {argsFor(session, resume), stdin, env}; spec.fatalStderrRe stops the child on a stderr line that means its rules
 *   did not load.
 * - The child's env is the catalog allowlist (src/core/spawn.mjs childEnv) with the one sign-in the route resolver picks
 *   (credentials.mjs resolveModelRoute; the one the CLI's own settings choose wins, spec.configuredMode), and of the run
 *   env only what its MCP servers reference and the git ceiling: never the run's other registry secrets.
 * @param {object} spec {name, label, prefix, configuredMode? (a function of worca's env: the catalog sign-in mode id the
 *   CLI's own settings choose, or null), classify,
 *   resumeNotFoundRe, fatalStderrRe?, fatalMessage?, askLockdown?, createNormalizer({model, mcpNames, cwd, ruleKinds}), prepare(ctx)};
 *   prepare's result may carry cleanup(), run when the spawn is over
 */
export async function runFamilyProcess(spec, {
  cwd = process.cwd(), systemPrompt = '', prompt = '', model, effort, onEvent = () => {}, signal, bin, resumeSessionId,
  addDirs, writableDirs, sandbox, askLockdown, envAllowlist, asAgent, mcpConfigPath, spawnEnv: runSpawnEnv,
  redactValues, maxTurns, permissionRules, noGit = false, probe = null, workRoot = null, subagentsOff = false,
} = {}) {
  const { name, label, prefix } = spec;
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  const ask = !!askLockdown;
  if (ask && !spec.askLockdown) throw new Error(`${bin}: worca does not lock ${label} down for a chat — Chat on ${label} is unavailable`);
  if (sandbox === 'read-only' && !ask) throw new Error(`${bin}: worca has no read-only mode for ${label} — a read-only job runs on Claude instead`);
  const secrets = Array.isArray(redactValues) ? redactValues : [];
  const redactor = secrets.length ? createRedactor(secrets) : null;
  if (redactor) { const emit = onEvent; onEvent = (e) => emit(redactor.deep(e)); }
  const redacted = (err) => {
    if (redactor && err && typeof err.message === 'string') err.message = redactor.text(err.message);
    if (redactor && err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
    return err;
  };

  let session = familySessionOf(prefix, resumeSessionId);
  if (resumeSessionId && !session) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] ${name}: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not a ${label} session — starting a fresh one` });

  // A chat adds no folder: it reads only through worca's MCP tools.
  const includeDirs = ask ? [] : [...new Set([...(addDirs || []), ...(writableDirs || [])].filter((d) => typeof d === 'string' && d))];
  const inHome = ask ? [] : writableRootsInWorcaHome({ cwd, roots: includeDirs });
  if (inHome.length) throw new Error(`${bin}: refusing to start ${label} — it would be able to write ${inHome.join(', ')}, inside Worca's home (${worcaHome()}), where Worca keeps its database, settings and plugins; ${label} cannot hold the rules that protect them`);

  // The agent's prompt names files in its project's store folder (plans, earlier steps' outputs) that Claude reads
  // wherever they are; these CLIs' file tools read only the workspace, so a folder in the store brings its project's.
  for (const p of storeProjectDirs(includeDirs)) if (!includeDirs.includes(p)) includeDirs.push(p);

  const runEnv = cleanRunEnv(runSpawnEnv) ?? undefined;
  // A chat's MCP child gets what it needs from the CLI's env by reference (withEnvRefs).
  const refNames = ask ? [...new Set([...Object.keys(runEnv || {}), ...(envAllowlist || []).filter((k) => typeof process.env[k] === 'string' && process.env[k] !== '')])] : [];
  const servers = ask ? withEnvRefs(readMcpServers(mcpConfigPath, bin), refNames) : readMcpServers(mcpConfigPath, bin);
  const guardOn = hostGuardEnabled();
  const sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : String(systemPrompt || '');

  let scratch = null;
  const scratchDir = () => {
    if (!scratch) {
      scratch = join(worcaHome(), 'tmp', name, `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      mkdirSync(scratch, { recursive: true, mode: 0o700 });
    }
    return scratch;
  };
  const removeScratch = () => { if (scratch) rmSync(scratch, { recursive: true, force: true }); };

  let prepared = null;
  try {
    prepared = spec.prepare({ cwd, bin, sys, prompt: String(prompt ?? ''), model, effort, servers, permissionRules, includeDirs, scratchDir, noGit, ask, probe, workRoot, subagentsOff });
    // The catalog allowlist with the one sign-in the resolver picks; of the run env, the values the attached servers
    // reference (both CLIs fill `$VAR` / `${VAR}` from their own env) and the git ceiling of a run without a project.
    const runEnv = cleanRunEnv(runSpawnEnv) || {};
    const { env } = childEnv({ engine: name, signInMode: familySignInMode(spec, runEnv, model), allowlist: envAllowlist, cwd, root: workRoot,
      runEnv: pickEnv(runEnv, [...envRefNames(servers), 'GIT_CEILING_DIRECTORIES']), overlay: prepared.env, hostPid: guardOn ? process.pid : null });
    const mcpNames = Object.keys(servers || {});
    const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
    const turnCap = () => Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true });

    const attempt = async (id, resume) => {
      const normalizer = spec.createNormalizer({ model, mcpNames, cwd, ruleKinds: (permissionRules?.deny || []).map((r) => ruleKind(String(r))) });
      const ctrl = new AbortController();
      let toolCalls = 0; let capped = false; let fatal = null; let sawOutput = false;
      const spawnSignal = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
      safeEmit(onEvent, { type: 'session', sessionId: prefix + id });
      const res = await superviseSpawn({
        file: bin, args: prepared.argsFor(id, resume), displayBin: bin, cwd, env, stdin: prepared.stdin, signal: spawnSignal, asAgent,
        stagedDir: asAgent ? [scratch, ...(prepared.agentDirs || [])] : null, onEvent, cleanup: () => {},
        stdoutErrorDetail: () => normalizer.finish().error || '',
        classify: (m) => spec.classify(m),
        redactText: redactor ? (t) => redactor.text(t) : null,
        spawnError: (err, pfx) => Object.assign(new Error(`${pfx}: ${err.message}`), { errorClass: /ENOENT|EINVAL/.test(String(err.code || err.message)) ? 'network' : null }),
        onDone: (code) => ({ code }),
        onStderrLine: spec.fatalStderrRe ? (line) => { if (!fatal && spec.fatalStderrRe.test(line)) { fatal = line.trim(); ctrl.abort(); } } : null,
        onStdoutLine: (line) => {
          sawOutput = true;
          for (const e of normalizer.push(line)) {
            safeEmit(onEvent, e);
            if (cap && !capped && e.type === 'tool' && (e.parentId ?? null) === null && (toolCalls += e.calls.length) > cap) { capped = true; ctrl.abort(); }
          }
        },
      }).catch((err) => {
        if (fatal && !signal?.aborted) throw Object.assign(new Error(`${bin}: ${spec.fatalMessage} (${fatal})`), { errorClass: null });
        if (capped && !signal?.aborted) throw turnCap();
        const f = normalizer.finish();
        if (f.error && err?.name !== 'AbortError' && !String(err.message).includes(f.error)) {
          err.message = `${bin}: ${f.error} — ${err.message}`;
          err.errorClass = strongestClass(err.errorClass ?? null, spec.classify(f.error));
        }
        err.sawOutput = sawOutput;
        throw err;
      });
      const final = normalizer.finish();
      if (capped && !signal?.aborted) throw turnCap();
      if (final.error) throw Object.assign(new Error(`${bin}: ${final.error}`), { errorClass: spec.classify(final.error), sawOutput: true });
      return { text: final.text, exitCode: res.code };
    };

    let out;
    try {
      out = await attempt(session || randomUUID(), !!session);
    } catch (err) {
      // A resumed session the CLI no longer knows (it answered before any stream line): one fresh attempt, said out loud.
      if (ask || !session || err?.sawOutput || err?.name === 'AbortError' || !spec.resumeNotFoundRe.test(String(err?.message || ''))) throw err;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] ${name}: session ${session.slice(0, 12)}… is gone — starting a fresh one` });
      session = null;
      out = await attempt(randomUUID(), false);
    }
    return { text: redactor ? redactor.text(out.text) : out.text, exitCode: out.exitCode };
  } catch (err) {
    throw redacted(err);
  } finally {
    try { prepared?.cleanup?.(); } catch { /* best effort */ }
    removeScratch();
  }
}
