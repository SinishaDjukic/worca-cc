// src/core/engines/goose.mjs
// The Goose CLI adapter (github.com/aaif-goose/goose): `goose run --output-format stream-json` argv, the stream
// normalized into worca's event vocabulary, the cost and tokens goose reports, error classes, the run-start preflight,
// MCP servers as `--with-extension` wrappers, and the spawn path on the shared supervisor (src/core/spawn.mjs). worca
// writes nothing into the run checkout.
//
// Facts this module builds on, checked against goose 1.54.0 (test/fixtures/goose/README.md has the captures):
// - `goose run -q --output-format stream-json` prints one JSON object per line: `message` (message.role assistant or
//   user, message.id, message.content[] of `text`, `thinking`, `toolRequest` {id, toolCall {status, value {name,
//   arguments}}} and, on a user message, `toolResponse` {id, toolResult {status, value {content[], isError,
//   structuredContent}} or {status: error, error}}), and one final `complete` (input_tokens, output_tokens,
//   cache_read_input_tokens, cache_write_input_tokens, total_tokens, and cost_usd when goose can price the model).
//   An assistant text streams as several `message` lines with one message.id, each carrying the next chunk.
// - goose exits 0 when the provider fails: the failure is an assistant text "Ran into this error: …" and a `complete`
//   with zero tokens and no cost_usd. Its max-turns stop is an assistant text "I've reached the maximum number of
//   actions …" and a healthy `complete`. A {"type":"error"} line is handled too (its fields are a lead, not a capture).
// - The stream names no session: worca names one per spawn (`--name worca-…`) and resumes it with
//   `--resume --name <name>`; an unknown name fails with "No session found with name '…'" on stderr, exit 1.
// - `-i -` reads the prompt from stdin (no argv limit); `--system <text>` adds system instructions.
// - `--provider <p> --model <m>` pick the model (worca's id is provider/model, split at the first `/`); with neither,
//   goose runs the provider and model of its own config (`goose configure`). Provider keys come from goose's config
//   or keyring, or the provider's env var (GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY …).
// - GOOSE_MODE=auto runs every tool call (approve and smart_approve wait for a TTY). GOOSE_MODE=chat skips every tool
//   call, MCP tools included. GOOSE_THINKING_EFFORT (low|medium|high|max) reaches goose's model config; whether the
//   provider does anything with it is the provider's business (Gemini 2.5 Flash's thinking budget did not move).
// - `--no-profile` loads none of the user's configured extensions; `--with-builtin developer` adds the shell, write,
//   edit, tree and read_image tools (`shell` runs bash in the process cwd; a non-zero exit is not a tool error).
// - `--with-extension "<command line>"` attaches a stdio MCP server, inheriting goose's env. goose names the extension
//   after the command's path (a bare path: its basename, `.` -> `_`), and its tools `<extension>__<tool>`; worca runs
//   each server through a wrapper script named after the server, so the names are the server's own. goose 1.54
//   opens with `server/discover` (MCP 2026-07-28) and falls back to `initialize` on "method not found".
// - goose keeps its sessions in one SQLite database (Paths::data_dir()/sessions/sessions.db: GOOSE_PATH_ROOT/data, else
//   the XDG data dir, ~/.local/share/goose on macOS too). `sessions.name` is the `--name` worca gives; each model reply
//   adds a `usage_ledger` row (its tokens, and `cost` when goose can price it, else NULL) before the stream shows it,
//   and goose's own `delete_session` removes the session's `messages`, `usage_ledger` and `sessions` rows (read in the
//   goose 1.54.0 source, crates/goose/src/session/session_manager.rs; `goose session remove` asks on a terminal).
// - Assumed absent (capability false): a per-spawn tool allowlist, permission rules worca can set per spawn (goose's
//   permission.yaml is per tool name and user-wide), sub-agents (the summon extension is not loaded), skills, hooks,
//   a turn or spend cap worca can count on. A read-only spawn refuses (no verified read-only mode).
//
// Chat (Ask Worca) on Goose, verified on goose 1.56.0 (conda-forge goose-cli) against a local model endpoint
// (plans/ask-on-qwen-gemini-spike.md):
// - `--no-profile` with no `--with-builtin` leaves the model worca's extension and goose's `load_skill` only: the
//   developer tools, the extension manager (which could turn developer back on), todo, chat recall, summon / delegate
//   and apps are not offered, and a call to one is "Tool '…' is not available". Without `--no-profile`, goose's default
//   platform extensions (delegate, apps, extension manager, analyze, …) are added.
// - But goose still reads the user's home under `--no-profile`: plugins in ~/.agents/plugins (a plugin's hooks.json
//   command RAN on session start), and the skills `load_skill` serves (~/.config/goose/skills, ~/.claude/skills,
//   ~/.agents/skills, plugin skills). So a chat runs goose with HOME and the XDG folders in a home of its own under
//   worca's home (the same every turn, so its sessions resume); `load_skill` then knows only goose's built-in skills
//   (goose-doc-guide, web-search: text), refuses a path outside a skill's folder, and is kept as a named meta tool.
//   worca's MCP child gets the real HOME back. Provider keys then come from the env or the keyring, not ~/.config/goose.
// - A provider that is itself an agent CLI (claude-acp, codex-acp, cursor-agent, gemini-cli, …) runs that CLI's own
//   tools, out of goose's reach: a chat never runs on one.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { currentOwner } from '../billing.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { superviseSpawn, childEnv, execCheck, runCapture, argValue, cleanRunEnv, safeEmit } from '../spawn.mjs';
import { ENGINES } from '../../shared/engine-switch.mjs';
import { resolveModelRoute } from '../exec-env/relay-route.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';
import { scopeLauncherEnv } from '../mcp/launch.mjs';
import { expandMcpRefs } from './codex.mjs';
import { ARGV_INLINE_LIMIT } from './claude.mjs';
import { homedir } from 'node:os';
import { makeChatDescriptor, providerListRates } from './chat-descriptor.mjs';
import { chatSelfTest } from './chat-selftest.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const gooseDefaultBin = () => process.env.WORCA_GOOSE_BIN || 'goose';
export const GOOSE_SESSION_PREFIX = 'goose:';
const SESSION_NAME_RE = /^worca-[A-Za-z0-9-]+$/;

/** The goose session name in a stored session id, or null when the id is not one worca gave goose. */
export function gooseSessionOf(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.startsWith(GOOSE_SESSION_PREFIX)) return null;
  const name = sessionId.slice(GOOSE_SESSION_PREFIX.length);
  return SESSION_NAME_RE.test(name) ? name : null;
}
/** A fresh session name, unique per spawn. */
const newSessionName = () => `worca-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const GOOSE_FALSE = new Set(['allowedTools', 'subagents', 'hookTelemetry', 'skills', 'permissionRules', 'subagentSystemPrompt', 'turnBudget']);
export const gooseCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !GOOSE_FALSE.has(k)])));

/** GOOSE_THINKING_EFFORT values worca offers (model-env.mjs, the zero-import leaf settings validate against). */
export { GOOSE_EFFORTS } from '../model-env.mjs';

/** Chat on Goose (see the chat notes above): `--no-profile`, no built-in extension, a home of its own, worca's extension
 *  only; `load_skill` is its one meta tool. Proven per binary by the chat self-test. */
export const GOOSE_ASK_LOCKDOWN = Object.freeze({ builtins: Object.freeze([]), metaTools: ENGINES.goose.chat.metaTools });
/** The chat's own home (HOME and the XDG folders) under worca's home. */
export const gooseChatHome = () => join(worcaHome(), 'engines', 'goose', 'chat-home');
/** A relayed chat's home (the chat runs as the person's agent user): a worca folder in that user's own home. */
export const gooseAgentChatHome = (agentHome) => join(agentHome, '.worca', 'goose-chat-home');
/** Goose providers that are agent CLIs of their own (ACP agents, CLI wrappers): their tools are out of goose's reach. */
const AGENT_PROVIDER_RE = /(?:^|[-_])acp$|^(?:claude[-_]code|codex|cursor[-_]agent|gemini[-_]cli|copilot|amp|pi)(?:[-_]acp)?$/i;
/** Why `id` cannot run a Goose chat (its provider is an agent CLI), or null. */
export function gooseChatModelProblem(id) {
  const m = splitGooseModel(id);
  const provider = m ? m.provider : String(id || '').split('/')[0];
  return provider && AGENT_PROVIDER_RE.test(provider) ? `its provider ${provider} is an agent CLI that runs its own tools, which a chat cannot switch off` : null;
}

/** A worca model id as goose's `--provider` and `--model`: split at the first `/` (an OpenRouter model keeps its own). */
export function splitGooseModel(id) {
  const s = typeof id === 'string' ? id.trim() : '';
  const i = s.indexOf('/');
  return i > 0 && i < s.length - 1 ? { provider: s.slice(0, i), model: s.slice(i + 1) } : null;
}

// ── MCP ──────────────────────────────────────────────────────────────────────

const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether a server declares env values (a wrapper hands them to it; on Windows nothing could, but goose's own env). */
const declaresEnv = (srv) => !!srv?.env && typeof srv.env === 'object' && Object.keys(srv.env).length > 0;

/** The servers of an --mcp-config document that goose cannot attach, each with its reason (capabilities.mjs
 *  describeUnattachableMcp): `remote` (worca attaches stdio servers only: goose's streamable-http flag takes no
 *  headers), `name` (outside MCP_NAME_RE: the wrapper's file name is the server's name), `env` (on Windows, which has no
 *  wrapper script: its values could reach it only through goose's own env, which every tool call of the agent sees)
 *  or `incomplete`. */
export function gooseMcpProblems(servers, { platform = process.platform } = {}) {
  const out = [];
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    const stdio = !!srv && typeof srv.command === 'string';
    const reason = !stdio ? (srv && typeof srv.url === 'string' ? 'remote' : 'incomplete')
      : !MCP_NAME_RE.test(name) ? 'name' : platform === 'win32' && declaresEnv(srv) ? 'env' : null;
    if (reason) out.push({ name, reason });
  }
  return out;
}

/** A string as one POSIX shell word. */
export const shWord = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * Each stdio server as a wrapper script goose launches by path (so goose names the extension after the server), and
 * the env file beside it holding the server's env values. Those values never ride goose's own env (where the agent's
 * every tool call would see them), the wrapper text or argv: the wrapper sources `<name>.env` from its own folder (a
 * server name holds no `.`, so no wrapper is named so), which only worca and goose's MCP launch read.
 * @param {Record<string, {command:string, args?:string[], env?:object}>} servers  already expanded (expandMcpRefs)
 * @returns {{scripts: Record<string,string>, envFiles: Record<string,string>}} server name -> wrapper text, and -> its
 *   env file's text (only for a server that declares env)
 */
export function gooseMcpWrappers(servers) {
  const scripts = {};
  const envFiles = {};
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (!MCP_NAME_RE.test(name) || !srv || typeof srv.command !== 'string') continue;
    const lines = ['#!/bin/sh', `# worca: MCP server ${name} for goose (engines/goose.mjs)`];
    const vars = Object.entries(srv.env && typeof srv.env === 'object' ? srv.env : {}).filter(([k, v]) => ENV_NAME_RE.test(k) && typeof v === 'string');
    if (vars.length) {
      envFiles[name] = vars.map(([k, v]) => `${k}=${shWord(v)}; export ${k}\n`).join('');
      lines.push(`. "\${0%/*}/${name}.env"`);
    }
    lines.push(`exec ${[srv.command, ...(Array.isArray(srv.args) ? srv.args : [])].map(shWord).join(' ')}`);
    scripts[name] = `${lines.join('\n')}\n`;
  }
  return { scripts, envFiles };
}

/**
 * Windows has no `sh` for gooseMcpWrappers: each stdio server's command line goes to `--with-extension` as it is. A
 * server that declares env is not attached (gooseMcpProblems `env`): its values could reach it only through goose's own
 * env. goose names such an extension after the command's path, not the server: its tools keep goose's names.
 * UNVERIFIED on Windows (no capture): the command line is POSIX-quoted (shWord), which keeps a backslash path literal
 * if goose splits it as on macOS.
 * @param {Record<string, {command:string, args?:string[], env?:object}>} servers  already expanded (expandMcpRefs)
 * @returns {{extensions: string[]}}
 */
export function gooseMcpDirect(servers) {
  const extensions = [];
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (!MCP_NAME_RE.test(name) || !srv || typeof srv.command !== 'string' || declaresEnv(srv)) continue;
    extensions.push([srv.command, ...(Array.isArray(srv.args) ? srv.args : [])].map(shWord).join(' '));
  }
  return { extensions };
}

// ── argv ─────────────────────────────────────────────────────────────────────

/** One argv string's limit for `--system`: Linux caps a single argument at 128 KiB; Windows a whole command line at 32 K. */
export const GOOSE_ARGV_LIMIT = process.platform === 'win32' ? ARGV_INLINE_LIMIT : 100_000;

/** `goose run -q --output-format stream-json --no-profile --with-builtin developer [--provider P --model M]
 *  [--system S] [--with-extension W]… (--name N | --resume --name N) -i -`; the prompt goes on stdin. */
export function buildGooseArgs({ model, systemPrompt, sessionName, resume = false, extensions = [], ask = false } = {}) {
  // A chat (GOOSE_ASK_LOCKDOWN) adds no built-in extension: no developer tools.
  const args = ['run', '-q', '--output-format', 'stream-json', '--no-profile', ...(ask ? [] : ['--with-builtin', 'developer'])];
  // A model id that reads as a flag is refused whole, even one goose would not split (it would run its own default).
  const m = model == null || model === '' ? null : splitGooseModel(argValue(String(model), 'model'));
  if (m) args.push('--provider', argValue(m.provider, 'model provider'), '--model', argValue(m.model, 'model'));
  if (systemPrompt) args.push('--system', String(systemPrompt));
  for (const w of extensions) args.push('--with-extension', String(w));
  if (resume) args.push('--resume');
  args.push('--name', String(sessionName), '-i', '-');
  return args;
}

// ── stream ───────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const TOOL_NAMES = Object.freeze({ shell: 'Bash', write: 'Write', edit: 'Edit', tree: 'LS', read_image: 'Read' });
export const GOOSE_ERROR_PREFIX = 'Ran into this error:';
const MAX_TURNS_TEXT = "I've reached the maximum number of actions";
const NO_COMPLETE = 'goose ended without a completion event';

/** An ACP provider's own tools (claude-acp: Claude Code runs them; goose only relays them, `goose.external_dispatch`)
 *  arrive as `Terminal` and the like with no arguments; their ACP `kind` names what they did. */
const ACP_KIND_NAMES = Object.freeze({ execute: 'Bash', read: 'Read', edit: 'Edit', delete: 'Edit', move: 'Edit', search: 'Grep', fetch: 'WebFetch' });

/** A `toolRequest` in Claude's vocabulary: developer tools by Claude's names (`path` -> `file_path`), an attached MCP
 *  server's `<server>__<tool>` as `mcp__server__tool` (the longest server name wins; another keeps goose's name), an
 *  ACP provider's own tool by its kind. */
function toolCall(item, mcpServers) {
  const v = item.toolCall?.value && typeof item.toolCall.value === 'object' ? item.toolCall.value : {};
  const raw = str(v.name) || 'tool';
  const input = v.arguments && typeof v.arguments === 'object' ? { ...v.arguments } : {};
  if ('path' in input) { input.file_path = input.path; delete input.path; }
  const server = TOOL_NAMES[raw] ? null : mcpServers.filter((s) => raw.startsWith(`${s}__`)).sort((a, b) => b.length - a.length)[0];
  const acp = item._meta?.['goose.external_dispatch'] === true ? ACP_KIND_NAMES[str(item._meta['goose.acp.kind'])] : null;
  const name = TOOL_NAMES[raw] || (server ? `mcp__${server}__${raw.slice(server.length + 2)}` : acp || raw);
  return { name, input, toolUseId: str(item.id) };
}

/** A `toolResponse`'s text and whether it failed (a tool error, `isError`, or a shell exit code other than 0). */
function toolResult(item) {
  const r = item.toolResult && typeof item.toolResult === 'object' ? item.toolResult : {};
  if (r.status === 'error') return { isError: true, text: str(r.error) || str(r.error?.message) || JSON.stringify(r.error ?? r) };
  const v = r.value && typeof r.value === 'object' ? r.value : {};
  const text = Array.isArray(v.content) ? v.content.map((c) => str(c?.text)).filter(Boolean).join('\n') : '';
  const code = v.structuredContent?.exit_code;
  return { isError: v.isError === true || (Number.isFinite(code) && code !== 0), text };
}

/** goose's `complete` tokens as Claude-style usage. */
export function claudeStyleUsage(c) {
  const t = c && typeof c === 'object' ? c : {};
  return { input_tokens: num(t.input_tokens), output_tokens: num(t.output_tokens),
    cache_read_input_tokens: num(t.cache_read_input_tokens), cache_creation_input_tokens: num(t.cache_write_input_tokens) };
}

/**
 * stream-json lines in, normalized events out (src/core/engines/events.mjs). push(line|object) returns the events for
 * that line; finish() returns { text, error, turnLimit, completed, costUsd, usage }. An assistant text is held until
 * its message ends (another message, a tool call, `complete`) so each reply is one `text` event.
 * @param {{model?: string|null, sessionName: string, mcpServers?: string[]}} o  mcpServers: the server names worca attached
 */
export function createGooseNormalizer({ model = null, sessionName, mcpServers = [] } = {}) {
  const messages = [];   // finished assistant texts, in order
  let open = null;       // { id, text } the assistant text still streaming
  let sessioned = false; let completed = false; let streamError = null;
  let costUsd = null; let usage = null;

  const flush = () => {
    if (!open) return [];
    const t = open.text; const id = open.id;
    open = null;
    if (!t) return [];
    messages.push(t);
    return [{ type: 'text', text: t, parentId: null, from: 'assistant', blocks: [t], ...(id ? { messageId: id } : {}) }];
  };
  const texts = () => (open && open.text ? [...messages, open.text] : messages);

  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object') return [];
    const out = [];
    if (!sessioned) { sessioned = true; out.push({ type: 'session', sessionId: GOOSE_SESSION_PREFIX + sessionName, model: model || null, init: true }); }
    if (evt.type === 'message') {
      const msg = evt.message && typeof evt.message === 'object' ? evt.message : {};
      const id = str(msg.id);
      const content = Array.isArray(msg.content) ? msg.content : [];
      if (open && open.id !== id) out.push(...flush());
      for (const item of content) {
        if (!item || typeof item !== 'object') continue;
        if (msg.role === 'assistant' && item.type === 'text') {
          if (!open) open = { id, text: '' };
          open.text += str(item.text);
        } else if (msg.role === 'assistant' && item.type === 'toolRequest' && str(item.id)) {
          out.push(...flush());
          const call = toolCall(item, mcpServers);
          out.push({ type: 'tool', parentId: null, calls: [call] });
          if (item.toolCall?.status === 'error') {
            const t = str(item.toolCall.error) || 'goose could not read this tool call';
            out.push({ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: call.toolUseId, isError: true, text: t, content: t }] });
          }
        } else if (msg.role === 'user' && item.type === 'toolResponse' && str(item.id)) {
          const r = toolResult(item);
          out.push({ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: item.id, isError: r.isError, text: r.text, content: r.text }] });
        }
        // thinking, the user's own prompt echo: nothing worca reads
      }
      return out;
    }
    if (evt.type === 'complete') {
      out.push(...flush());
      if (completed) return out;
      completed = true;
      usage = claudeStyleUsage(evt);
      if (Number.isFinite(evt.cost_usd)) costUsd = evt.cost_usd;
      // `total`: the session's sum, not one model call (Run telemetry reads it; everyone else ignores it).
      out.push({ type: 'usage', messageId: null, parentId: null, phase: 'message', model: model || null, usage, total: true });
      return out;
    }
    if (evt.type === 'error') {
      out.push(...flush());
      const m = evt.message ?? evt.error ?? evt.detail;
      streamError = str(m) || str(m?.message) || 'goose reported an error';
      out.push({ type: 'stderr', stream: 'err', text: `goose: ${streamError}` });
    }
    return out;
  }
  /** The run so far; reads, never changes, the state (the supervisor asks for the error detail more than once). */
  function finish() {
    const all = texts();
    const last = (all.at(-1) || '').trim();
    const error = streamError || (last.startsWith(GOOSE_ERROR_PREFIX) ? last : null) || (completed ? null : NO_COMPLETE);
    return { text: all.join('\n'), error, turnLimit: !error && all.some((m) => m.includes(MAX_TURNS_TEXT)), completed, costUsd, usage };
  }
  /** The events still held at the end of the stream (an assistant text with no `complete` after it). */
  const end = () => flush();
  return { push, finish, end };
}

// ── errors and preflight ─────────────────────────────────────────────────────

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyGooseError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  const msg = String((err && typeof err === 'object' ? err.message : err) || '');
  if (/\b40[13]\b|unauthori[sz]ed|authentication (?:error|required|failed)|invalid authentication|api key not valid|invalid api key|api key is (?:missing|invalid)|not logged in|please run .*login/i.test(msg)) return 'auth';
  if (/hit your[^.]*\blimit\b|reached your[^.]*\blimit\b|\blimit\b[^.]*\bresets?\b|usage limit/i.test(msg)) return 'usage_limit';
  if (/credits? exhausted|insufficient_quota|quota|billing|payment required|credit balance/i.test(msg)) return 'quota';
  if (/\b429\b|\b529\b|rate.?limit|too many requests|overloaded/i.test(msg)) return 'rate_limit';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)|error sending request/i.test(msg)) return 'network';
  return null;
}

export const GOOSE_SIGNED_OUT_HINT = 'run `goose configure`, or set the provider\'s key (for example GOOGLE_API_KEY or OPENAI_API_KEY) in worca\'s environment';

const homeOf = (env) => (typeof env?.HOME === 'string' && env.HOME.trim()) || homedir();
const absEnv = (env, k) => (typeof env?.[k] === 'string' && isAbsolute(env[k]) ? env[k] : null);
/** goose's config dir (goose Paths::config_dir: GOOSE_PATH_ROOT/config, else the XDG config dir; Windows %APPDATA%). */
const gooseConfigDir = (env, platform) => (absEnv(env, 'GOOSE_PATH_ROOT') ? join(env.GOOSE_PATH_ROOT, 'config')
  : platform === 'win32' ? join(absEnv(env, 'APPDATA') || join(homeOf(env), 'AppData', 'Roaming'), 'Block', 'goose', 'config')
    : join(absEnv(env, 'XDG_CONFIG_HOME') || join(homeOf(env), '.config'), 'goose'));

/** The provider goose is configured with (GOOSE_PROVIDER in the env, else in its config.yaml): with no model on the
 *  step, the catalog sign-in mode it signs in with (credentials.mjs resolveModelRoute `configured`), or null. */
export function gooseConfiguredMode(env = process.env, platform = process.platform) {
  const given = typeof env.GOOSE_PROVIDER === 'string' ? env.GOOSE_PROVIDER.trim() : '';
  if (given) return given;
  let text = '';
  try { text = readFileSync(join(gooseConfigDir(env, platform), 'config.yaml'), 'utf8'); } catch { return null; }
  const m = /^GOOSE_PROVIDER:[ \t]*["']?([A-Za-z0-9_.-]+)["']?[ \t]*$/m.exec(text);
  return m ? m[1] : null;
}

/**
 * The one sign-in mode a goose spawn keeps (credentials.mjs resolveModelRoute): the step model's provider (catalog
 * signIn.byModel), else the provider goose is configured with, else the catalog order. Throws (errorClass 'config')
 * on a refusal: the credential broker holds no Goose key.
 */
export function gooseSignInMode(model = null, env = process.env) {
  const d = resolveModelRoute({ engine: 'goose', serverEnv: env, model: model || null, broker: { on: brokerEnabled() }, checkModel: false,
    configured: model ? null : gooseConfiguredMode(env) });
  if (d.refusal) throw Object.assign(new Error(`Goose: ${d.refusal}`), { errorClass: 'config' });
  return d.signInMode;
}

/** The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. Only the binary is
 *  checked, under the env a model-less step spawns with (src/core/spawn.mjs execCheck): goose keeps provider keys in its
 *  config, its keyring or the env, and none of them is readable cheaply. */
export async function goosePreflight({ bin = gooseDefaultBin(), timeoutMs = 10000, envAllowlist = [], spec = null } = {}) {
  let given = spec;
  if (!given) {
    try { given = gooseSpawnSpec({ envAllowlist, signInMode: gooseSignInMode(null) }); } catch (err) { return { refusal: err.message }; }
  }
  const { code, error } = await execCheck(bin, ['--version'], { spec: given, timeoutMs });
  if (!error && code === 0) return {};
  return error && !/^(ENOENT|EACCES|EINVAL)$/.test(String(error.code))
    ? { warning: `could not check ${bin} (${error.message})` }
    : { refusal: `cannot run ${bin} (${error ? error.code : code}) — install the Goose CLI (brew install block-goose-cli), or point WORCA_GOOSE_BIN at it` };
}

/** The childEnv spec a goose run spawns with (engine, its one sign-in mode, the run's allowlist, cwd and work root, the
 *  host pid): run and preflight build their env from it, so the check sees the run's env. */
export function gooseSpawnSpec({ envAllowlist = [], signInMode = null, cwd = null, workRoot = null, hostPid = null } = {}) {
  return { engine: 'goose', signInMode, allowlist: envAllowlist, cwd, root: workRoot, hostPid };
}

// ── sessions ─────────────────────────────────────────────────────────────────

let DatabaseSync = null;
/** node:sqlite, loaded on first use (as db.mjs does). */
const sqlite = () => (DatabaseSync ??= createRequire(import.meta.url)('node:sqlite').DatabaseSync);

/** goose's session database (goose Paths::data_dir()/sessions/sessions.db: GOOSE_PATH_ROOT/data, else the XDG data
 *  dir, ~/.local/share/goose on macOS too; Windows %APPDATA%\Block\goose\data, unverified). */
export function gooseSessionsDb(env = process.env, platform = process.platform) {
  const data = absEnv(env, 'GOOSE_PATH_ROOT') ? join(env.GOOSE_PATH_ROOT, 'data')
    : platform === 'win32' ? join(absEnv(env, 'APPDATA') || join(homeOf(env), 'AppData', 'Roaming'), 'Block', 'goose', 'data')
      : join(absEnv(env, 'XDG_DATA_HOME') || join(homeOf(env), '.local', 'share'), 'goose');
  return join(data, 'sessions', 'sessions.db');
}

/** `fn(db)` over goose's database, or null when it is absent or unreadable (another goose version's schema included). */
function withGooseDb(env, fn, { readOnly = true } = {}) {
  const file = gooseSessionsDb(env);
  if (!existsSync(file)) return null;
  let db = null;
  try {
    db = new (sqlite())(file, { readOnly });
    db.exec('PRAGMA busy_timeout = 2000');
    return fn(db, file);
  } catch { return null; } finally { try { db?.close(); } catch { /* closed */ } }
}

/**
 * What goose recorded for session `name` past its usage-ledger row `after` (one row per model reply): {last, usage,
 * costUsd} — `costUsd` null when a reply had no price — or null (no database, no such session).
 */
export function gooseSessionSpend(name, env = process.env, after = 0) {
  return withGooseDb(env, (db) => {
    const s = db.prepare('SELECT id FROM sessions WHERE name = ?').get(String(name));
    if (!s) return null;
    const r = db.prepare(`SELECT MAX(id) AS last, COUNT(*) AS n, COUNT(cost) AS priced, SUM(input_tokens) AS i, SUM(output_tokens) AS o,
      SUM(cache_read_tokens) AS cr, SUM(cache_write_tokens) AS cw, SUM(cost) AS c FROM usage_ledger WHERE session_id = ? AND id > ?`).get(s.id, after);
    const n = Number(r?.n) || 0;
    return { last: n ? Number(r.last) : after, usage: { input_tokens: Number(r?.i) || 0, output_tokens: Number(r?.o) || 0,
      cache_read_input_tokens: Number(r?.cr) || 0, cache_creation_input_tokens: Number(r?.cw) || 0 },
    costUsd: n && Number(r.priced) === n ? Number(r.c) : null, replies: n };
  });
}

/**
 * Archive (catalog `sessions: 'user-store'`): remove the goose sessions named by `sessionIds` (`goose:worca-…`) from
 * goose's database, as goose's own delete_session does (their messages, usage-ledger rows and session rows), never its
 * config or keyring. A busy or unreadable database is a failure, not a throw.
 * @returns {Promise<{removed: string[], failed: {path: string, error: string}[]}>} removed: `<db>#<session id>`
 */
export async function removeGooseSessions({ sessionIds = [], env = process.env } = {}) {
  const names = [...new Set(sessionIds.map(gooseSessionOf).filter(Boolean))];
  const out = { removed: [], failed: [] };
  if (!names.length || !existsSync(gooseSessionsDb(env))) return out;
  const file = gooseSessionsDb(env);
  let db = null;
  try {
    db = new (sqlite())(file);
    db.exec('PRAGMA busy_timeout = 2000');
    for (const name of names) {
      for (const { id } of db.prepare('SELECT id FROM sessions WHERE name = ?').all(name)) {
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const sql of ['DELETE FROM messages WHERE session_id = ?', 'DELETE FROM usage_ledger WHERE session_id = ?', 'DELETE FROM sessions WHERE id = ?']) db.prepare(sql).run(id);
          db.exec('COMMIT');
          out.removed.push(`${file}#${id}`);
        } catch (err) { db.exec('ROLLBACK'); throw err; }
      }
    }
  } catch (err) { out.failed.push({ path: file, error: err?.code || err?.message || String(err) }); } finally { try { db?.close(); } catch { /* closed */ } }
  return out;
}

// ── spawn ────────────────────────────────────────────────────────────────────

/** goose's answer to `--resume --name <unknown>`. */
export const GOOSE_RESUME_NOT_FOUND_RE = /No session found with name/i;

/**
 * Run one goose turn. Same resolved value and rejection contract as the Claude adapter: {text, exitCode}; an Error
 * with `errorClass` on failure. Options goose has no lever for (allowedTools, agents, maxBudgetUsd, writableDirs,
 * addDirs — goose has no sandbox) are ignored; the run start logs each as a degradation. `maxTurns` caps the main
 * agent's tool calls, counted as codex counts them.
 */
export async function runGooseProcess({
  cwd = process.cwd(), systemPrompt = '', prompt = '', model, effort, onEvent = () => {}, signal,
  bin = gooseDefaultBin(), resumeSessionId, sandbox, askLockdown, envAllowlist, asAgent,
  mcpConfigPath, spawnEnv: runSpawnEnv, redactValues, maxTurns, scratchBase = null, platform = process.platform, probe = null,
  chatHome = null, workRoot = null,
} = {}) {
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  const ask = !!askLockdown;
  if (sandbox === 'read-only' && !ask) throw new Error(`${bin}: Goose has no verified read-only mode — a read-only job runs on Claude instead`);
  if (ask && platform === 'win32') throw new Error(`${bin}: a chat on Goose is not verified on Windows`);
  if (ask && gooseChatModelProblem(model)) throw new Error(`${bin}: ${model} cannot run a chat on Goose: ${gooseChatModelProblem(model)}`);
  const secrets = Array.isArray(redactValues) ? redactValues : [];
  const redactor = secrets.length ? createRedactor(secrets) : null;
  if (redactor) { const emit = onEvent; onEvent = (e) => emit(redactor.deep(e)); }
  const redacted = (err) => {
    if (redactor && err && typeof err.message === 'string') err.message = redactor.text(err.message);
    if (redactor && err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
    return err;
  };

  let session = gooseSessionOf(resumeSessionId);
  if (resumeSessionId && !session) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] goose: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not a Goose session — starting a fresh one` });

  // A relayed chat runs goose as the person's agent user (agent-user.mjs), which cannot write worca's home: its chat home
  // is a worca folder in that user's own home (as a relayed chat on another engine reads that user's own config), which
  // goose creates itself. Otherwise it is worca's (gooseChatHome).
  const agentId = ask && asAgent ? agentIdentityFor(currentOwner()) : null;
  const home = chatHome || (agentId ? gooseAgentChatHome(agentId.home) : gooseChatHome());
  const realHome = agentId ? agentId.home : (process.env.HOME || homedir());

  const guardOn = hostGuardEnabled();
  // The one provider key the step's model (else goose's configured provider) signs in with: never worca's others. A chat
  // keeps the same one: it has no shell to read it.
  const spec = gooseSpawnSpec({ envAllowlist, signInMode: gooseSignInMode(model), cwd, workRoot, hostPid: guardOn ? process.pid : null });

  // MCP: each stdio server becomes a wrapper script (on Windows: its command line as it is, gooseMcpDirect). goose stores
  // a session's extensions and starts them again on resume, so the wrappers live in a folder named after the session
  // (written again on resume), removed after the spawn. The run gate refuses a run whose servers goose cannot attach; a
  // helper job's are skipped and said so.
  const base = scratchBase || join(worcaHome(), 'tmp', 'goose');
  const made = [];
  const cleanup = () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } };
  let scripts = {};
  let envFiles = {};
  let direct = [];
  if (mcpConfigPath) {
    let doc;
    try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
    const all = doc && typeof doc.mcpServers === 'object' && doc.mcpServers ? doc.mcpServers : {};
    const problems = gooseMcpProblems(all, { platform });
    const skip = new Set(problems.map((p) => p.name));
    if (skip.size) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] MCP servers not attached on goose — ${problems.map((p) => `${p.name} (${p.reason})`).join(', ')}` });
    // A chat: the child of each server gets the real HOME back (the chat runs goose in a home of its own) and the spawn
    // env (the command bridge token, SSH_AUTH_SOCK, the web search key) by reference.
    const refNames = ask ? [...new Set([...Object.keys(cleanRunEnv(runSpawnEnv) || {}), ...(envAllowlist || []).filter((k) => typeof process.env[k] === 'string' && process.env[k] !== '')])] : [];
    const forAsk = (srv) => (ask && srv && typeof srv.command === 'string'
      ? { ...srv, env: { ...Object.fromEntries(refNames.map((k) => [k, `\${${k}}`])), HOME: realHome, ...(srv.env && typeof srv.env === 'object' ? srv.env : {}) } } : srv);
    const kept = Object.fromEntries(Object.entries(all).filter(([n]) => !skip.has(n)).map(([n, srv]) => [n, scopeLauncherEnv(forAsk(srv))]));
    if (Object.keys(kept).length) {
      // `${VAR}` references expand from this spawn's env plus the run's spawn env, as Claude Code would expand them.
      const from = childEnv({ ...spec, runEnv: cleanRunEnv(runSpawnEnv) }).env;
      const expanded = expandMcpRefs(kept, from);
      if (platform === 'win32') ({ extensions: direct } = gooseMcpDirect(expanded));
      else ({ scripts, envFiles } = gooseMcpWrappers(expanded));
    }
  }
  const mcpNames = Object.keys(scripts);
  /** The session's wrapper folder, written; its `--with-extension` values. */
  const writeWrappers = (sessionName) => {
    if (!mcpNames.length) return { dir: null, extensions: direct };
    const dir = join(base, sessionName);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      made.push(dir);
      for (const [name, text] of Object.entries(envFiles)) writeFileSync(join(dir, `${name}.env`), text, { mode: 0o600 });
      return { dir, extensions: mcpNames.map((name) => { const file = join(dir, name); writeFileSync(file, scripts[name], { mode: 0o700 }); return shWord(file); }) };
    } catch (err) {
      throw new Error(`${bin}: cannot prepare the MCP wrappers: ${err.message}`);
    }
  };

  let sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : String(systemPrompt || '');
  let stdin = String(prompt ?? '');
  // A system prompt too large for one argv value is folded into stdin behind a delimiter.
  if (sys && Buffer.byteLength(sys, 'utf8') > GOOSE_ARGV_LIMIT) { stdin = `=== SYSTEM ===\n${sys}\n=== END SYSTEM ===\n\n${stdin}`; sys = ''; }

  // The catalog allowlist (src/core/spawn.mjs childEnv: goose's own names, the one provider key it signs in with). The MCP
  // servers' env values reach them through their wrappers' env files, never this env. P3-D20: the run env itself stays
  // out of this child's env, but the git ceiling of a run without a project is no secret and must reach its git
  // (childEnv merges its own `root` over it).
  const ceiling = typeof runSpawnEnv?.GIT_CEILING_DIRECTORIES === 'string' ? { GIT_CEILING_DIRECTORIES: runSpawnEnv.GIT_CEILING_DIRECTORIES } : {};
  // The chat's own home: none of the user's plugins, hooks, skills or hints (see the chat notes above).
  if (ask && !agentId) for (const d of ['.config', '.local/share', '.local/state', '.cache']) mkdirSync(join(home, d), { recursive: true, mode: 0o700 });
  const chatHomeEnv = ask ? { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'), XDG_CACHE_HOME: join(home, '.cache') } : {};
  // Headless: approve / smart_approve would wait for a TTY.
  const { env } = childEnv({ ...spec, runEnv: ceiling,
    overlay: { GOOSE_MODE: 'auto', ...(effort ? { GOOSE_THINKING_EFFORT: String(effort) } : {}), ...chatHomeEnv, ...(probe ? probe.env : {}) } });
  // Amazon Bedrock with a Bedrock API key: no goose turn on it has been seen, and no usage meter of worca's reads it. A
  // step with no provider in its model runs goose's GOOSE_PROVIDER, so that one counts too.
  if ((splitGooseModel(model)?.provider ?? env.GOOSE_PROVIDER) === 'aws_bedrock' && typeof env.AWS_BEARER_TOKEN_BEDROCK === 'string' && env.AWS_BEARER_TOKEN_BEDROCK) {
    throw Object.assign(new Error(`${bin}: Goose on Amazon Bedrock with a Bedrock API key (AWS_BEARER_TOKEN_BEDROCK) is not supported yet — sign goose in to Bedrock with an AWS profile (goose configure), or pick another provider`), { errorClass: 'config' });
  }

  const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
  const turnCap = () => Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true });
  // A spawn that ends without its result (an error, the turn cap, goose's own turn limit, a stop) still spent what goose
  // recorded: its `complete`'s figure, else the session's usage-ledger rows since `before`. Booked as the engine's own
  // figure; no cost figure (an unpriced model) leaves the step's cost unknown, never $0.
  const spendOnExit = (final, sessionName, before) => {
    const from = final.completed ? { usage: final.usage, costUsd: final.costUsd } : gooseSessionSpend(sessionName, env, before);
    if (!from?.usage || !Object.values(from.usage).some((n) => n > 0)) return;
    safeEmit(onEvent, { type: 'spend', source: 'engine', ...(from.costUsd != null ? { costUsd: from.costUsd } : {}), usage: from.usage });
  };
  const attempt = async (resumeName) => {
    const sessionName = resumeName || newSessionName();
    // goose's usage ledger before this spawn: a resumed session's earlier replies were booked by their own spawns.
    const before = resumeName ? gooseSessionSpend(sessionName, env)?.last ?? 0 : 0;
    const { dir, extensions } = writeWrappers(sessionName);
    const normalizer = createGooseNormalizer({ model: model || null, sessionName, mcpServers: mcpNames });
    const capCtrl = new AbortController();
    let toolCalls = 0; let capped = false; let sawSession = false;
    const spawnSignal = cap ? (signal ? AbortSignal.any([signal, capCtrl.signal]) : capCtrl.signal) : signal;
    const emit = (e) => {
      safeEmit(onEvent, e);
      if (cap && !capped && e.type === 'tool' && (toolCalls += e.calls.length) > cap) { capped = true; capCtrl.abort(); }
      // Pause/Resume: the runner's own session event (no `init`) is the one the harness stamps on the step.
      if (e.type === 'session') { sawSession = true; safeEmit(onEvent, { type: 'session', sessionId: e.sessionId }); }
    };
    const args = buildGooseArgs({ model, systemPrompt: sys, sessionName, resume: !!resumeName, extensions, ask });
    const res = await superviseSpawn({
      file: bin, args, displayBin: bin, cwd, env, stdin, signal: spawnSignal, asAgent, stagedDir: asAgent ? dir : null, onEvent,
      ...(ask && agentId ? { agentHome: () => home } : {}),
      cleanup: () => {},
      stdoutErrorDetail: () => { const e = normalizer.finish().error; return e && e !== NO_COMPLETE ? e : ''; },
      classify: (m) => classifyGooseError(m),
      redactText: redactor ? (t) => redactor.text(t) : null,
      spawnError: (err, pfx) => Object.assign(new Error(`${pfx}: ${err.message}`), { errorClass: /ENOENT|EINVAL/.test(String(err.code || err.message)) ? 'network' : null }),
      onDone: (code) => ({ code }),
      onStdoutLine: (line) => { for (const e of normalizer.push(line)) emit(e); },
    }).catch((err) => {
      spendOnExit(normalizer.finish(), sessionName, before);
      if (capped && !signal?.aborted) throw turnCap();
      const f = normalizer.finish();
      if (f.error && f.error !== NO_COMPLETE && err?.name !== 'AbortError') {
        err.message = `${bin}: ${f.error} — ${err.message}`;
        err.errorClass = strongestClass(err.errorClass ?? null, classifyGooseError(f.error));
      }
      err.sawSession = sawSession;
      throw err;
    });
    for (const e of normalizer.end()) emit(e);
    const final = normalizer.finish();
    if ((capped && !signal?.aborted) || final.error || final.turnLimit) spendOnExit(final, sessionName, before);
    if (capped && !signal?.aborted) throw turnCap();
    if (final.error) throw Object.assign(new Error(`${bin}: ${final.error}`), { errorClass: classifyGooseError(final.error), sawSession });
    if (final.turnLimit) throw Object.assign(new Error(`${bin}: goose stopped at its own turn limit before finishing (GOOSE_MAX_TURNS) — raise it, or split the task`), { sawSession });
    return { final, sessionName, exitCode: res.code };
  };

  try {
    let out;
    try {
      out = await attempt(session);
    } catch (err) {
      // A resumed session goose no longer knows (before any event): one fresh attempt, said out loud.
      // A chat's is the turn's to handle (ask/turn.mjs resumeNotFound: it retries from history).
      if (ask || !session || err?.sawSession || err?.name === 'AbortError' || !GOOSE_RESUME_NOT_FOUND_RE.test(String(err?.message || ''))) throw err;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] goose: session ${session.slice(0, 24)}… is gone — starting a fresh one` });
      session = null;
      out = await attempt(null);
    }
    const { final } = out;
    const text = redactor ? redactor.text(final.text) : final.text;
    // `inputIncludesCache`: goose's input_tokens already holds the cache read and write (checked on Gemini and on
    // claude-code, goose 1.55), so input + cache would count it twice. Run telemetry reads it; nothing else does.
    safeEmit(onEvent, { type: 'result', text, isError: false, sessionId: GOOSE_SESSION_PREFIX + out.sessionName,
      ...(final.usage ? { usage: final.usage, inputIncludesCache: true } : {}), ...(final.costUsd != null ? { costUsd: final.costUsd } : {}) });
    return { text, exitCode: out.exitCode };
  } catch (err) {
    throw redacted(err);
  } finally {
    cleanup();
  }
}

// ── chat ─────────────────────────────────────────────────────────────────────

/** The oldest goose the chat lockdown was verified on. */
export const GOOSE_ASK_MIN_VERSION = ENGINES.goose.chat.minVersion;

/** Can this goose be locked down for a chat? At least GOOSE_ASK_MIN_VERSION, with `--no-profile`. Never rejects. */
export function gooseAskSupport({ bin = gooseDefaultBin(), timeoutMs = 15000 } = {}) {
  // The owner's runner with the base env only (no engine names, no credential): --version and --help need none.
  const run = async (args) => {
    const r = await runCapture(bin, args, { spec: {}, timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { err: r.error || (r.code !== 0 ? Object.assign(new Error(`${bin} ${args.join(' ')} exited ${r.code}`), { code: r.code }) : null), out: r.stdout };
  };
  return (async () => {
    const v = await run(['--version']);
    if (v.err) return { refusal: /^(ENOENT|EACCES|EINVAL)$/.test(String(v.err.code)) ? `cannot run ${bin} (${v.err.code}) — install the Goose CLI, or point WORCA_GOOSE_BIN at it` : `could not ask ${bin} its version (${v.err.message})` };
    const n = (/(\d+)\.(\d+)\.(\d+)/.exec(v.out) || []).slice(1).map(Number);
    const min = GOOSE_ASK_MIN_VERSION.split('.').map(Number);
    const older = n.length !== 3 || n[0] < min[0] || (n[0] === min[0] && (n[1] < min[1] || (n[1] === min[1] && n[2] < min[2])));
    if (older) return { refusal: `this ${bin} is ${v.out.trim() || 'of an unknown version'}; a chat needs goose ${GOOSE_ASK_MIN_VERSION} or newer — update it` };
    const h = await run(['run', '--help']);
    const missing = ENGINES.goose.chat.flags.filter((f) => !h.out.includes(f));
    return !missing.length ? {} : { refusal: `this ${bin} has no ${missing.join(', ')} to lock a chat down — update goose to ${GOOSE_ASK_MIN_VERSION} or newer` };
  })();
}

/** The chat self-test on this goose (engines/chat-selftest.mjs): its OpenAI provider at a local endpoint. The chat runs
 *  in a home of its own, so no user config file is in its key. */
export function gooseChatSelfTest({ bin = gooseDefaultBin(), ...o } = {}) {
  return chatSelfTest({
    engine: 'goose', label: 'Goose', bin, protocol: 'openai', model: 'openai/worca-self-test', run: runGooseProcess,
    probeEnv: (url) => ({ OPENAI_HOST: url, OPENAI_BASE_PATH: 'v1/chat/completions', OPENAI_API_KEY: 'worca-self-test' }),
    wireName: (server, tool) => `${server}__${tool}`, shellTool: 'shell', metaTools: GOOSE_ASK_LOCKDOWN.metaTools, ...o,
  });
}

/** Goose's chat descriptor (engines/chat-descriptor.mjs). A chat's spend is priced with worca's prices (the Models page,
 *  else the list price of an anthropic/… or openai/… model), as on every engine. Each `impl` is the function a test hands
 *  the turn. */
export const gooseChat = makeChatDescriptor({
  engine: 'goose',
  lockdown: () => GOOSE_ASK_LOCKDOWN,
  askSupport: (o, impl = gooseAskSupport) => impl(o),
  selfTest: (o, impl = gooseChatSelfTest) => impl(o),
  preflight: (_ctx, impl = goosePreflight) => impl(),
  resumeNotFound: (err) => GOOSE_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')),
  modelProblem: gooseChatModelProblem,
  // The one its spawn keeps (gooseSignInMode); none when the route is refused, as the spawn itself is.
  signInMode: (model) => { try { return gooseSignInMode(model); } catch { return ''; } },
  listRates: providerListRates,
});
