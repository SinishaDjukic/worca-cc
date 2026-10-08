// src/core/engines/gemini-family.mjs
// What the Gemini CLI adapter (engines/gemini.mjs) and the Qwen Code adapter (engines/qwen.mjs) share. Qwen Code is a
// fork of Gemini CLI: both name their tools alike (run_shell_command, read_file, write_file, …), take the prompt on
// stdin, name a session up front (`--session-id`) and resume it (`--resume`), add workspace folders
// (`--include-directories`), filter MCP servers by name (`--allowed-mcp-server-names`), read MCP servers in the same
// settings shape (filling `${VAR}` from their own env) and report tokens but no cost. Their stream formats, rule
// files and sign-ins differ; those stay in the per-engine files.
//
// Verified on gemini 0.63.0 and qwen 0.25.0 (test/fixtures/gemini/README.md, test/fixtures/qwen/README.md).
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { superviseSpawn, composeSpawnEnv, cleanRunEnv, safeEmit, writableRootsInWorcaHome } from './spawn.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';

const str = (v) => (typeof v === 'string' ? v : '');

// ── sessions ─────────────────────────────────────────────────────────────────

/** The engine's own session in a stored session id (`gemini:<uuid>`), or null when the id is another engine's. */
export function familySessionOf(prefix, sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(prefix) && sessionId.length > prefix.length
    ? sessionId.slice(prefix.length) : null;
}

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
 * (`--version`); `signedIn(env)` says whether a sign-in is configured (neither CLI has a status command, so this reads
 * its env and settings files, never its credentials).
 */
export function familyPreflight({ bin, env = process.env, timeoutMs = 10000, label, binEnv, signedIn, signInHint }) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: timeoutMs, env: { ...process.env, ...env } }, (err) => {
      if (err && typeof err.code !== 'number') {
        resolve(/^(ENOENT|EACCES|EINVAL)$/.test(String(err.code))
          ? { refusal: `cannot run ${bin} (${err.code}) — install ${label}, or point ${binEnv} at it` }
          : { warning: `could not run ${bin} --version (${err.message})` });
        return;
      }
      if (err) { resolve({ warning: `${bin} --version exited with code ${err.code}` }); return; }
      resolve(signedIn(env) ? {} : { refusal: `${bin} is not signed in — ${signInHint}` });
    });
  });
}

// ── spawn ────────────────────────────────────────────────────────────────────

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
 * - A read-only spawn and an Ask chat refuse: worca does not lock these CLIs down (their helper jobs run on Claude).
 * - `maxTurns` caps the main agent's tool calls, counted as codex counts them.
 * - spec.prepare writes the engine's config (a scratch folder under Worca's home, or the checkout) and returns
 *   {argsFor(session, resume), stdin, env}; spec.fatalStderrRe stops the child on a stderr line that means its rules
 *   did not load.
 * @param {object} spec {name, label, prefix, envPrefixes, classify, resumeNotFoundRe, fatalStderrRe?, fatalMessage?,
 *   createNormalizer({model, mcpNames}), prepare(ctx)}
 */
export async function runFamilyProcess(spec, {
  cwd = process.cwd(), systemPrompt = '', prompt = '', model, onEvent = () => {}, signal, bin, resumeSessionId,
  addDirs, writableDirs, sandbox, askLockdown, envScrub, envAllowlist, asAgent, mcpConfigPath, spawnEnv: runSpawnEnv,
  redactValues, maxTurns, permissionRules,
} = {}) {
  const { name, label, prefix } = spec;
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  if (askLockdown) throw new Error(`${bin}: worca does not lock ${label} down for a chat — Ask on ${label} is unavailable`);
  if (sandbox === 'read-only') throw new Error(`${bin}: worca has no read-only mode for ${label} — a read-only job runs on Claude instead`);
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

  const includeDirs = [...new Set([...(addDirs || []), ...(writableDirs || [])].filter((d) => typeof d === 'string' && d))];
  const inHome = writableRootsInWorcaHome({ cwd, roots: includeDirs });
  if (inHome.length) throw new Error(`${bin}: refusing to start ${label} — it would be able to write ${inHome.join(', ')}, inside Worca's home (${worcaHome()}), where Worca keeps its database, settings and plugins; ${label} cannot hold the rules that protect them`);

  const servers = readMcpServers(mcpConfigPath, bin);
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

  try {
    const prepared = spec.prepare({ cwd, bin, sys, prompt: String(prompt ?? ''), model, servers, permissionRules, includeDirs, scratchDir });
    // The engine's own env names survive scrub; the run env carries the MCP servers' ${VAR} values.
    const { env } = composeSpawnEnv({ envScrub, envAllowlist, prefixes: spec.envPrefixes, runEnv: cleanRunEnv(runSpawnEnv) ?? undefined,
      overlay: prepared.env, hostPid: guardOn ? process.pid : null });
    const mcpNames = Object.keys(servers || {});
    const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
    const turnCap = () => Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true });

    const attempt = async (id, resume) => {
      const normalizer = spec.createNormalizer({ model, mcpNames });
      const ctrl = new AbortController();
      let toolCalls = 0; let capped = false; let fatal = null; let sawOutput = false;
      const spawnSignal = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
      safeEmit(onEvent, { type: 'session', sessionId: prefix + id });
      const res = await superviseSpawn({
        file: bin, args: prepared.argsFor(id, resume), displayBin: bin, cwd, env, stdin: prepared.stdin, signal: spawnSignal, asAgent,
        stagedDir: asAgent ? scratch : null, onEvent, cleanup: () => {},
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
      if (!session || err?.sawOutput || err?.name === 'AbortError' || !spec.resumeNotFoundRe.test(String(err?.message || ''))) throw err;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] ${name}: session ${session.slice(0, 12)}… is gone — starting a fresh one` });
      session = null;
      out = await attempt(randomUUID(), false);
    }
    return { text: redactor ? redactor.text(out.text) : out.text, exitCode: out.exitCode };
  } catch (err) {
    throw redacted(err);
  } finally {
    removeScratch();
  }
}
