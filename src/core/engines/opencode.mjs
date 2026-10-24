// src/core/engines/opencode.mjs
// The OpenCode CLI adapter (sst/opencode): `opencode run --format json` argv, the JSON event stream normalized into
// worca's event vocabulary, the cost and tokens OpenCode prices per step, error classes, the run-start preflight, the
// guardrail rule plan, and the spawn path on the shared supervisor (engines/spawn.mjs). Everything worca configures
// rides the OPENCODE_CONFIG_CONTENT env var: worca writes nothing into the run checkout.
//
// Facts this module builds on, checked against opencode 1.18.23 (test/fixtures/opencode/README.md has the captures):
// - `opencode run --format json` prints one JSON event per line: `step_start`, `text` (part.text, one per text part),
//   `tool_use` (part.tool, part.callID, part.state {status: completed|error, input, output|error, metadata}),
//   `step_finish` (part.tokens {input, output, reasoning, cache {read, write}}, part.cost in USD, priced by OpenCode
//   from its models.dev table) and `error` (error.name, error.data.message, statusCode for an APIError). Every event
//   carries `sessionID`. A tool call is printed once, when it ends.
// - With stdin open and not a TTY, `run` waits for stdin (a script that leaves it open hangs): the prompt is written
//   to stdin and closed, so no argv limit applies.
// - `-s <ses_…>` continues a session; an unknown id fails with "Error: Session not found" on stderr, exit 1.
// - `-m provider/model` picks the model; `--variant <name>` the provider's reasoning variant. A variant the model does
//   not have is ignored silently. `--agent <name>` runs a config-defined agent: its `prompt` is the system prompt
//   (`{file:/abs}` reads a file), its tools stay.
// - `--auto` approves what no rule denies. Permission rules (`permission.<tool>` = action, or {pattern: action}, last
//   match wins, `*` matches any characters including `/`): `bash` patterns match each command OpenCode parses out of a
//   shell line (a `;` chain is split), a trailing ` *` is optional; `read` and `edit` patterns match the path RELATIVE
//   to the cwd (`../x` outside it); a tool denied outright (`bash: "deny"`, `<server>_<tool>: "deny"`) is removed from
//   the model's tool list. A literal path in a shell command is checked too, but `$(…)`, variables and `bash -c` are not.
// - OpenCode Zen's free models refuse a request whose tool list lacks the shell ("OpenCode's free tier can only be
//   used from within OpenCode", 403): a set that denies the whole shell cannot run them.
// - OPENCODE_CONFIG_CONTENT is inline config, merged over the user's ~/.config/opencode config; `{env:NAME}` in it
//   expands from the process env. OPENCODE_DISABLE_PROJECT_CONFIG=1 ignores the checkout's opencode.json, its
//   `.opencode/` folder (plugin(s)/*.js included: none load, and nothing is written there) and its AGENTS.md /
//   CLAUDE.md (worca names those again as absolute `instructions`).
// - Plugins from the user's ~/.config/opencode (plugin/*.js, npm plugins its config names) still load; `--pure` turns
//   them off. OpenCode's built-in default plugins (provider sign-in) are a separate switch and stay on.
// - An agent's `steps` caps its loop: at step `steps` OpenCode takes the tools away and asks for a text reply, so
//   `steps: N + 1` gives N tool steps. Each step prints one `step_start`.
// - The checkout's `.agents/skills` and `.claude/skills` are listed to the model as skills.
// - MCP tools are named `<server>_<tool>`. A `task` call runs a sub-agent in a session of its own
//   (part.state.metadata.sessionId); its steps are NOT in the stream: `opencode export <id>` prints them, cost included.
// - Every agent has the `task` tool, and the built-in `general` and `explore` sub-agents are always there (with no step
//   cap, `general` with `task` again). An agent's own `permission` lands after the global one (last match wins), so it
//   can only narrow it here; `task` patterns match the sub-agent's name; `disable: true` removes a built-in agent.
// - OpenCode's project folder is $PWD, not its process cwd (an inherited PWD sends the agent to another folder).
// - `opencode providers list` counts stored credentials and provider env vars. Zen's free models need neither.
// - With no `-m`, OpenCode picks its own default model, which can be a free OpenCode Zen model: the checkout's code
//   then goes to opencode.ai. worca refuses that unless WORCA_OPENCODE_ALLOW_DEFAULT_MODEL=1.
// - OpenCode writes only its own folders (~/.local/share/opencode, ~/.config/opencode, ~/.cache/opencode): its
//   snapshots are git objects there, never in the checkout, and nothing under Worca's home.
// - No Worca state protection beyond the rules: OpenCode has no sandbox, so the Normal and Secure sets' rules for
//   ~/.worca-cc are `read`/`edit` rules held only in part, as on Cursor.
// - Assumed absent (capability false): a per-spawn tool allowlist (removing tools breaks the free models), hook
//   telemetry, a spend cap. Ask and read-only spawns refuse: no lockdown has been verified.
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { superviseSpawn, composeSpawnEnv, cleanRunEnv, safeEmit } from './spawn.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';
import { envFlag } from '../model-env.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const opencodeDefaultBin = () => process.env.WORCA_OPENCODE_BIN || 'opencode';
export const OPENCODE_SESSION_PREFIX = 'opencode:';
/** The only env names besides the base set that survive scrub on OpenCode: provider keys need the allowlist. */
const OPENCODE_ENV_PREFIXES = ['OPENCODE_'];
/** The opt-in that lets a spawn without a model run on OpenCode's own default (possibly a free OpenCode Zen model). */
export const OPENCODE_DEFAULT_MODEL_OPT_IN = 'WORCA_OPENCODE_ALLOW_DEFAULT_MODEL';
const defaultModelAllowed = () => envFlag(OPENCODE_DEFAULT_MODEL_OPT_IN);
const DEFAULT_MODEL_RISK = `OpenCode would pick its own default model, which can be a free OpenCode Zen model that sends the code to opencode.ai — set a model, or set ${OPENCODE_DEFAULT_MODEL_OPT_IN}=1 in worca's environment to allow it`;

/** The OpenCode session in a stored session id, or null when the id is not OpenCode's. */
export function opencodeSessionOf(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.startsWith(OPENCODE_SESSION_PREFIX)) return null;
  const id = sessionId.slice(OPENCODE_SESSION_PREFIX.length);
  return /^ses_[A-Za-z0-9]+$/.test(id) ? id : null;
}

const OPENCODE_FALSE = new Set(['allowedTools', 'hookTelemetry']);
export const opencodeCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !OPENCODE_FALSE.has(k)])));

/** The `--variant` values worca offers (model-env.mjs, the zero-import leaf settings validate against): the union of
 *  the providers' reasoning variants (OpenAI minimal…high, Anthropic high/max, Google low/high). A variant the model
 *  lacks is ignored by OpenCode. */
export { OPENCODE_EFFORTS } from '../model-env.mjs';

/** Ask Worca on OpenCode: a verified lockdown. null = none (a read-only permission set is unverified), so Ask stays off. */
export const OPENCODE_ASK_LOCKDOWN = null;

/** The config agents every spawn runs as (its prompt is the system prompt), and the investigator a fan-out node
 *  dispatches through the `task` tool. */
export const OPENCODE_NODE_AGENT = 'worca-node';
export const OPENCODE_INVESTIGATOR_AGENT = 'worca-investigator';
const INVESTIGATOR_PROMPT = 'You are a read-only investigator dispatched by a worca pipeline agent. Investigate exactly what you were asked, in the directories you were given. Never edit, write, commit, branch or spawn sub-agents. Report concrete findings with file paths, then stop.';

/** What the gate and the run log say about the rules OpenCode holds only in part. */
export const OPENCODE_RULE_TERMS = Object.freeze({
  kind: 'permission rules',
  reach: 'command rules match each command OpenCode reads out of a shell line, but not one inside a substitution, a variable or `bash -c "…"`, and the agent\'s shell can still read or write a path a Read or Edit rule names',
});

// ── permission rules ─────────────────────────────────────────────────────────

/** `Bash(git push:*)` -> 'git push *'; `Bash(curl)` -> 'curl'; null when not a command rule. */
function bashPattern(rule) {
  const m = /^Bash\((.+)\)$/.exec(rule);
  if (!m) return null;
  const body = m[1].trim();
  return body.endsWith(':*') ? `${body.slice(0, -2).trim()} *` : body;
}

const GLOB_RE = /[*?[{]/;
/**
 * A Claude path rule body as OpenCode `read`/`edit` patterns, which match the path relative to `cwd`.
 * A body starting `//` is absolute (`//` plus `**` and a slash: any depth), `/rel` is relative to the project root (the
 * cwd), `~/…` is the home, `./x` is relative; a bare pattern without a slash matches at any depth (gitignore-like), so
 * it also gets a twin under `*` and a slash.
 */
function pathPatterns(body, { cwd, home }) {
  const rel = (abs) => relative(cwd, abs).split('\\').join('/') || '.';
  const anyDepth = (p) => (p.includes('/') ? [p] : [p, `*/${p}`]);
  if (body.startsWith('//**/')) { const rest = body.slice(5); return [rest, `*/${rest}`]; }
  let abs = null;
  if (body.startsWith('//')) abs = body.slice(1);
  else if (body === '~' || body.startsWith('~/')) abs = join(home, body.slice(2));
  if (abs !== null) {
    const parts = abs.split('/');
    const at = parts.findIndex((s) => GLOB_RE.test(s));
    if (at === -1) return [rel(abs)];
    const head = parts.slice(0, at).join('/') || '/';
    return [`${rel(head)}/${parts.slice(at).join('/')}`];
  }
  if (body.startsWith('/')) return [body.slice(1)];
  if (body.startsWith('./')) return [body.slice(2)];
  return anyDepth(body);
}

/**
 * What OpenCode can hold of a run's DENY rules (allow / ask are never lifted), as its `permission` config:
 * - enforced: a bare `Bash` (the shell is removed), `WebSearch`, an MCP rule (`<server>_<tool>` removed), and
 *   `WebFetch` only when the same rules deny the shell and web search too (else the shell can still fetch).
 * - partial (OPENCODE_RULE_TERMS): command rules, `Read(…)` / `Edit(…)` / `Write(…)` path rules, a bare `Read` or
 *   `Edit` (the shell still reads and writes). The gate refuses them unless --allow-unguarded-engine; the spawn
 *   applies them.
 * - unenforced: everything else (`Agent`, `NotebookEdit`, …) and a `WebFetch` the shell can route around (still applied).
 * @param {{deny?: string[]}|null} permissionRules
 * @param {{cwd: string, home?: string}} where  the spawn's cwd (realpath: OpenCode relativizes against it)
 * @returns {{permission: object, enforced: string[], partial: string[], unenforced: string[]}}
 */
export function opencodeRulePlan(permissionRules, { cwd, home = homedir() } = {}) {
  const out = { permission: {}, enforced: [], partial: [], unenforced: [] };
  const deny = (Array.isArray(permissionRules?.deny) ? permissionRules.deny : []).map((r) => String(r).trim()).filter(Boolean);
  const perm = out.permission;
  const addPattern = (tool, pattern) => {
    if (perm[tool] === 'deny') return;
    perm[tool] = { ...(perm[tool] && typeof perm[tool] === 'object' ? perm[tool] : {}), [pattern]: 'deny' };
  };
  const bare = new Set(deny);
  for (const rule of deny) {
    if (rule === 'Bash') { perm.bash = 'deny'; out.enforced.push(rule); continue; }
    if (rule === 'WebSearch') { perm.websearch = 'deny'; out.enforced.push(rule); continue; }
    if (rule === 'WebFetch') {
      perm.webfetch = 'deny';
      (bare.has('Bash') && bare.has('WebSearch') ? out.enforced : out.unenforced).push(rule);
      continue;
    }
    if (rule === 'Read' || rule === 'Edit' || rule === 'Write') { perm[rule === 'Read' ? 'read' : 'edit'] = 'deny'; out.partial.push(rule); continue; }
    const cmd = bashPattern(rule);
    if (cmd) { if (perm.bash !== 'deny') addPattern('bash', cmd); out.partial.push(rule); continue; }
    const path = /^(Read|Edit|Write|MultiEdit)\((.+)\)$/.exec(rule);
    if (path && path[2].trim()) {
      for (const p of pathPatterns(path[2].trim(), { cwd, home })) addPattern(path[1] === 'Read' ? 'read' : 'edit', p);
      out.partial.push(rule);
      continue;
    }
    const mcp = /^mcp__([A-Za-z0-9_-]+?)(?:__([A-Za-z0-9_.*-]+))?$/.exec(rule);
    if (mcp) { perm[mcp[2] && mcp[2] !== '*' ? `${mcp[1]}_${mcp[2]}` : `${mcp[1]}_*`] = 'deny'; out.enforced.push(rule); continue; }
    out.unenforced.push(rule);
  }
  return out;
}
export function unenforcedRules(permissionRules) { return opencodeRulePlan(permissionRules, { cwd: process.cwd() }).unenforced; }
export function partialRules(permissionRules) { return opencodeRulePlan(permissionRules, { cwd: process.cwd() }).partial; }

// ── MCP ──────────────────────────────────────────────────────────────────────

const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** Every string inside `v` with `${VAR}` rewritten to OpenCode's `{env:VAR}` (arrays and plain objects walked). */
const envRefs = (v) => (typeof v === 'string' ? v.replace(ENV_REF_RE, (_, n) => `{env:${n}}`)
  : Array.isArray(v) ? v.map(envRefs)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, envRefs(x)]))
  : v);

/** An --mcp-config `mcpServers` map in OpenCode's `mcp` shape: stdio as `local` (command + args in one array,
 *  `environment`), http/sse as `remote`. Secret refs stay refs (`{env:NAME}`); their values ride the process env. */
export function opencodeMcpServers(servers) {
  const out = {};
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (!srv || typeof srv !== 'object') continue;
    if (typeof srv.url === 'string' && (srv.type === 'http' || srv.type === 'sse' || !srv.command)) {
      out[name] = envRefs({ type: 'remote', url: srv.url, ...(srv.headers && Object.keys(srv.headers).length ? { headers: srv.headers } : {}), enabled: true });
    } else if (typeof srv.command === 'string') {
      out[name] = envRefs({ type: 'local', command: [srv.command, ...(Array.isArray(srv.args) ? srv.args.map(String) : [])],
        ...(srv.env && Object.keys(srv.env).length ? { environment: srv.env } : {}), enabled: true });
    }
  }
  return out;
}

/** The `{env:NAME}` names an `mcp` map reads. */
const envRefNames = (mcp) => [...new Set([...JSON.stringify(mcp).matchAll(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))];

// ── argv ─────────────────────────────────────────────────────────────────────

/** `opencode run --format json --auto --pure --print-logs --log-level ERROR [--agent A] [-m M] [--variant E] [-s S]`;
 *  the prompt goes on stdin. `--pure`: no user-level or npm plugins. Error logs on stderr carry the cause an
 *  `UnknownError` event hides. */
export function buildOpencodeArgs({ agent, model, effort, sessionId } = {}) {
  const args = ['run', '--format', 'json', '--auto', '--pure', '--print-logs', '--log-level', 'ERROR'];
  if (agent) args.push('--agent', String(agent));
  if (model) args.push('-m', String(model));
  if (effort) args.push('--variant', String(effort));
  if (sessionId) args.push('-s', String(sessionId));
  return args;
}

// ── stream ───────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const TOOL_NAMES = Object.freeze({ bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', glob: 'Glob', grep: 'Grep', list: 'LS',
  webfetch: 'WebFetch', websearch: 'WebSearch', todowrite: 'TodoWrite', todoread: 'TodoRead', skill: 'Skill' });

/** OpenCode's step tokens as Claude-style usage (`input` excludes the cache; reasoning is output). */
export function claudeStyleUsage(t) {
  const tk = t && typeof t === 'object' ? t : {};
  return { input_tokens: num(tk.input), output_tokens: num(tk.output) + num(tk.reasoning),
    cache_read_input_tokens: num(tk.cache?.read), cache_creation_input_tokens: num(tk.cache?.write) };
}
const addUsage = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] || 0)]));
const ZERO_USAGE = Object.freeze(claudeStyleUsage({}));

/** A tool call in Claude's vocabulary: `filePath` becomes `file_path`, an attached MCP server's `<server>_<tool>`
 *  becomes `mcp__server__tool` (the longest server name wins; a server worca did not attach keeps OpenCode's name). */
function toolCall(part, mcpServers) {
  const raw = str(part.tool) || 'tool';
  const input = part.state?.input && typeof part.state.input === 'object' ? { ...part.state.input } : {};
  if ('filePath' in input) { input.file_path = input.filePath; delete input.filePath; }
  const server = TOOL_NAMES[raw] ? null : mcpServers.filter((s) => raw.startsWith(`${s}_`)).sort((a, b) => b.length - a.length)[0];
  const name = TOOL_NAMES[raw] || (server ? `mcp__${server}__${raw.slice(server.length + 1)}` : raw);
  if (raw === 'bash') return { name, input: { command: str(input.command) }, toolUseId: str(part.callID) };
  if (raw === 'write') return { name, input: { file_path: input.file_path, content: input.content }, toolUseId: str(part.callID) };
  return { name, input, toolUseId: str(part.callID) };
}

/**
 * `--format json` lines in, normalized events out (src/core/engines/events.mjs). push(line|object) returns the
 * events for that line; finish() returns { text, error, errorName, statusCode, sessionId, costUsd, usage, subSessions,
 * steps } (subSessions: [{sessionId, toolUseId}]; steps: the main agent's `step_start` count).
 * @param {{model?: string|null, mcpServers?: string[]}} [o]  mcpServers: the server names worca attached
 */
export function createOpencodeNormalizer({ model = null, mcpServers = [] } = {}) {
  const texts = [];
  const seen = new Set();
  const subSessions = [];   // {sessionId, toolUseId}: a sub-agent's session and the `task` call that ran it
  let sessionId = null; let error = null; let errorName = null; let statusCode = null;
  let costUsd = 0; let priced = false; let usage = { ...ZERO_USAGE }; let steps = 0;

  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object') return [];
    const out = [];
    if (!sessionId && str(evt.sessionID)) {
      sessionId = evt.sessionID;
      out.push({ type: 'session', sessionId: OPENCODE_SESSION_PREFIX + sessionId, model: model || null, init: true });
    }
    const part = evt.part && typeof evt.part === 'object' ? evt.part : {};
    switch (evt.type) {
      case 'step_start':
        steps++;
        break;
      case 'text': {
        const t = str(part.text);
        if (!t) break;
        texts.push(t);
        out.push({ type: 'text', text: t, parentId: null, from: 'assistant', blocks: [t], ...(str(part.messageID) ? { messageId: part.messageID } : {}) });
        break;
      }
      case 'tool_use': {
        const id = str(part.callID);
        if (!id) break;
        const st = part.state && typeof part.state === 'object' ? part.state : {};
        const done = st.status === 'completed' || st.status === 'error';
        if (part.tool === 'task') {
          const input = st.input && typeof st.input === 'object' ? st.input : {};
          if (!seen.has(id)) {
            seen.add(id);
            const label = str(input.description) || 'OpenCode sub-agent';
            out.push({ type: 'subagent', event: 'spawn', toolUseId: id, label, description: label,
              ...(str(input.subagent_type) ? { subagentType: input.subagent_type } : {}),
              ...(str(st.metadata?.model?.modelID) ? { model: st.metadata.model.modelID } : {}) });
          }
          const sub = str(st.metadata?.sessionId);
          if (sub && !subSessions.some((x) => x.sessionId === sub)) subSessions.push({ sessionId: sub, toolUseId: id });
          if (done) out.push({ type: 'subagent', event: st.status === 'error' ? 'error' : 'finish', toolUseId: id, ...(st.status === 'error' ? { errorText: str(st.error) } : {}) });
          break;
        }
        if (!seen.has(id)) { seen.add(id); out.push({ type: 'tool', parentId: null, calls: [toolCall(part, mcpServers)] }); }
        if (done) {
          const t = st.status === 'error' ? str(st.error) : str(st.output);
          out.push({ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: id, isError: st.status === 'error', text: t, content: t }] });
        }
        break;
      }
      case 'step_finish': {
        const u = claudeStyleUsage(part.tokens);
        usage = addUsage(usage, u);
        if (Number.isFinite(part.cost)) { costUsd += part.cost; priced = true; }
        out.push({ type: 'usage', messageId: str(part.messageID) || null, parentId: null, phase: 'message', model: model || null, usage: u });
        break;
      }
      case 'error': {
        const e = evt.error && typeof evt.error === 'object' ? evt.error : {};
        error = str(e.data?.message) || str(e.message) || str(e.name) || 'opencode reported an error';
        errorName = str(e.name) || null;
        statusCode = Number.isFinite(e.data?.statusCode) ? e.data.statusCode : null;
        out.push({ type: 'stderr', stream: 'err', text: `opencode: ${error}` });
        break;
      }
      default:
        break;   // reasoning: nothing worca reads
    }
    return out;
  }
  return { push, finish: () => ({ text: texts.join(''), error, errorName, statusCode, sessionId, costUsd: priced ? costUsd : null, usage, subSessions: [...subSessions], steps }) };
}

/**
 * A sub-session from `opencode export <id>` output, or null: its assistant messages' cost and tokens, and its tool
 * calls and results as worca events under `parentId` (the `task` call), so the audit sees what the sub-agent did.
 */
export function readSubsession(text, { parentId = null, mcpServers = [] } = {}) {
  let doc;
  try { const t = String(text); doc = JSON.parse(t.slice(t.indexOf('{'))); } catch { return null; }
  if (!doc || !Array.isArray(doc.messages)) return null;
  let costUsd = 0; let usage = { ...ZERO_USAGE }; const events = [];
  for (const m of doc.messages) {
    if (m?.info?.role !== 'assistant') continue;
    if (Number.isFinite(m.info.cost)) costUsd += m.info.cost;
    usage = addUsage(usage, claudeStyleUsage(m.info.tokens));
    for (const part of Array.isArray(m.parts) ? m.parts : []) {
      if (part?.type !== 'tool' || !str(part.callID)) continue;
      const st = part.state && typeof part.state === 'object' ? part.state : {};
      events.push({ type: 'tool', parentId, calls: [toolCall(part, mcpServers)] });
      if (st.status === 'completed' || st.status === 'error') {
        const t = st.status === 'error' ? str(st.error) : str(st.output);
        events.push({ type: 'toolResult', parentId, meta: null, results: [{ toolUseId: part.callID, isError: st.status === 'error', text: t, content: t }] });
      }
    }
  }
  return { costUsd, usage, events };
}

// ── errors and preflight ─────────────────────────────────────────────────────

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyOpencodeError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  const name = err && typeof err === 'object' ? str(err.name) : '';
  const status = err && typeof err === 'object' && Number.isFinite(err.statusCode) ? err.statusCode : null;
  const msg = String((err && typeof err === 'object' ? err.message : err) || '');
  if (/free tier can only be used/i.test(msg)) return null;   // a request OpenCode Zen refuses (no shell tool), not a sign-in
  if (name === 'ProviderAuthError' || status === 401 || status === 403) return 'auth';
  if (status === 429) return /quota|billing/i.test(msg) ? 'quota' : 'rate_limit';
  if (/\b401\b|unauthori[sz]ed|api key is (?:missing|invalid)|invalid api key|authentication (?:required|failed)/i.test(msg)) return 'auth';
  if (/hit your[^.]*\blimit\b|reached your[^.]*\blimit\b|\blimit\b[^.]*\bresets?\b|usage limit/i.test(msg)) return 'usage_limit';
  if (/insufficient_quota|quota|billing|payment required/i.test(msg)) return 'quota';
  if (/\b429\b|\b529\b|rate.?limit|too many requests|overloaded/i.test(msg)) return 'rate_limit';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection (refused|reset|closed|error)/i.test(msg)) return 'network';
  return null;
}

/** `opencode providers list` output -> {credentials, env} counts, or null when it says neither. */
export function parseOpencodeProviders(text) {
  // eslint-disable-next-line no-control-regex
  const t = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  const cred = /(\d+)\s+credentials?\b/i.exec(t);
  const env = /(\d+)\s+environment variables?\b/i.exec(t);
  if (!cred && !env) return null;
  return { credentials: cred ? Number(cred[1]) : 0, env: env ? Number(env[1]) : 0 };
}

export const OPENCODE_SIGNED_OUT_HINT = 'run `opencode auth login`, or set a provider key (for example ANTHROPIC_API_KEY) in worca\'s environment and, when the guardrail set scrubs the env, its allowlist';

/**
 * The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. The binary must run.
 * `defaultModel`: whether some spawn of the run names no model (true), every one names one (false), or unknown
 * (undefined: the readiness check). A spawn without a model refuses without the opt-in. The credential check runs with
 * the env the agent gets (`envScrub`, `envAllowlist`): a key only worca has does not count. With no credential, only
 * OpenCode Zen's free models run: a refusal unless every spawn names its model or the user opted in.
 */
export function opencodePreflight({ bin = opencodeDefaultBin(), timeoutMs = 15000, envScrub, envAllowlist, defaultModel } = {}) {
  const allowed = defaultModelAllowed();
  const { env } = composeSpawnEnv({ envScrub, envAllowlist, prefixes: OPENCODE_ENV_PREFIXES });
  const run = (args) => new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, env: { ...env, OPENCODE_DISABLE_AUTOUPDATE: '1' } }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
  return (async () => {
    const v = await run(['--version']);
    if (v.err) {
      return /^(ENOENT|EACCES|EINVAL)$/.test(String(v.err.code)) || typeof v.err.code === 'number'
        ? { refusal: `cannot run ${bin} (${v.err.code}) — install OpenCode (opencode.ai), or point WORCA_OPENCODE_BIN at it` }
        : { warning: `could not check ${bin} (${v.err.message})` };
    }
    // OpenCode 2 (npm @opencode/cli, Homebrew's opencode) breaks this adapter: `run` attaches to a shared background
    // service that does not read the spawn's config env, `--variant` is gone, and its events and permissions changed.
    const major = Number(/(\d+)\.\d+\.\d+/.exec(String(v.stdout))?.[1]);
    if (major >= 2) return { refusal: `OpenCode 2 is not supported yet (${bin} is ${String(v.stdout).trim()}) — install OpenCode 1.x (npm opencode-ai), or point WORCA_OPENCODE_BIN at one` };
    if (defaultModel === true && !allowed) return { refusal: `a step of this run names no model: ${DEFAULT_MODEL_RISK}` };
    const p = await run(['providers', 'list']);
    const counts = p.err ? null : parseOpencodeProviders(`${p.stdout}\n${p.stderr}`);
    if (!counts) return { warning: `could not tell whether ${bin} has provider credentials (\`${bin} providers list\` said nothing recognizable)` };
    if (!counts.credentials && !counts.env) {
      const why = `no provider credentials in the agent's environment — only OpenCode Zen's free models (opencode.ai) will run; ${OPENCODE_SIGNED_OUT_HINT}`;
      return allowed || defaultModel === false ? { warning: why } : { refusal: `${why}, or set ${OPENCODE_DEFAULT_MODEL_OPT_IN}=1 to allow it` };
    }
    return {};
  })();
}

// ── spawn ────────────────────────────────────────────────────────────────────

/** OpenCode's answer to `-s <unknown session>`. */
export const OPENCODE_RESUME_NOT_FOUND_RE = /Session not found/i;
/** The error log line (`--print-logs --log-level ERROR`) that names what an `UnknownError` event hides. */
const LOG_CAUSE_RE = /\bmessage=failed\b.*?\berror="([^"]+)"/;
/** Log chatter that repeats a failure already reported: streamed, never the error detail. */
const isBenignStderr = (line) => /message="share subscriber failed"/.test(line);
const FREE_TIER_NOTE = 'OpenCode Zen\'s free models refuse a run without the shell tool — the guardrail set denies the whole shell (a bare Bash rule); pick a model of another provider, or a set without it';

/** The checkout's own instruction files, by absolute path (OPENCODE_DISABLE_PROJECT_CONFIG turns their discovery off). */
const instructionFiles = (cwd) => ['AGENTS.md', 'CLAUDE.md'].map((f) => join(cwd, f)).filter((p) => existsSync(p));

/**
 * Run one OpenCode turn. Same resolved value and rejection contract as the Claude adapter: {text, exitCode}; an
 * Error with `errorClass` on failure. Options OpenCode has no lever for (allowedTools, maxBudgetUsd, writableDirs,
 * addDirs — OpenCode has no sandbox) are ignored; the run start logs each as a degradation. `maxTurns` caps the main
 * agent's tool steps with the agent's `steps` (OpenCode's own cap), and its tool calls, counted as codex counts them.
 */
export async function runOpencodeProcess({
  cwd = process.cwd(), systemPrompt = '', prompt = '', model, effort, onEvent = () => {}, signal,
  bin = opencodeDefaultBin(), resumeSessionId, sandbox, askLockdown, envScrub, envAllowlist, asAgent,
  mcpConfigPath, spawnEnv: runSpawnEnv, redactValues, maxTurns, permissionRules, allowedTools, appendSubagentSystemPrompt,
  scratchBase = null,
} = {}) {
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  if (askLockdown) throw new Error(`${bin}: OpenCode has no verified lockdown for a chat — Chat on OpenCode is unavailable`);
  if (sandbox === 'read-only') throw new Error(`${bin}: OpenCode has no verified read-only mode — a read-only job runs on Claude instead`);
  if (!(typeof model === 'string' && model.trim()) && !defaultModelAllowed()) throw new Error(`${bin}: refusing to start OpenCode without a model: ${DEFAULT_MODEL_RISK}`);
  const secrets = Array.isArray(redactValues) ? redactValues : [];
  const redactor = secrets.length ? createRedactor(secrets) : null;
  const sniffed = { cause: null };
  { const emit = onEvent; onEvent = (e) => {
    if (e?.type === 'stderr' && typeof e.text === 'string') { const m = LOG_CAUSE_RE.exec(e.text); if (m) sniffed.cause = m[1]; }
    emit(redactor ? redactor.deep(e) : e);
  }; }
  const redacted = (err) => {
    if (redactor && err && typeof err.message === 'string') err.message = redactor.text(err.message);
    if (redactor && err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
    return err;
  };

  let session = opencodeSessionOf(resumeSessionId);
  if (resumeSessionId && !session) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not an OpenCode session — starting a fresh one` });

  let realCwd = cwd;
  try { realCwd = realpathSync(cwd); } catch { /* not there: the spawn says so */ }
  const rules = opencodeRulePlan(permissionRules, { cwd: realCwd });
  let mcp = null;
  if (mcpConfigPath) {
    let doc;
    try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
    mcp = opencodeMcpServers(doc && typeof doc.mcpServers === 'object' ? doc.mcpServers : {});
    if (!Object.keys(mcp).length) mcp = null;
  }

  const guardOn = hostGuardEnabled();
  const sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : String(systemPrompt || '');
  const fanOut = Array.isArray(allowedTools) && allowedTools.some((t) => t === 'Agent' || t === 'Task');

  // Scratch folder: the agents' prompt files (read by OpenCode through `{file:…}`), removed after the spawn.
  const scratch = join(scratchBase || join(worcaHome(), 'tmp', 'opencode'), `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const cleanup = () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } };
  const agent = { [OPENCODE_NODE_AGENT]: { mode: 'primary', description: 'The worca pipeline agent for this call.', prompt: `{file:${join(scratch, 'node.md')}}` } };
  try {
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, 'node.md'), sys || 'You are an agent of a worca pipeline. Follow the task you are given.', { mode: 0o600 });
    if (fanOut) {
      writeFileSync(join(scratch, 'investigator.md'), [INVESTIGATOR_PROMPT, appendSubagentSystemPrompt].filter(Boolean).join('\n\n'), { mode: 0o600 });
      // Read-only for real (no sandbox here): no file edits, no shell, no sub-agents of its own.
      agent[OPENCODE_INVESTIGATOR_AGENT] = { mode: 'subagent', description: 'Read-only investigator for a worca pipeline agent: give it an area, a question and the directories to look in.', prompt: `{file:${join(scratch, 'investigator.md')}}`,
        permission: { edit: 'deny', bash: 'deny', task: 'deny' } };
    }
  } catch (err) {
    cleanup();
    throw new Error(`${bin}: cannot prepare the spawn: ${err.message}`);
  }
  const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
  if (cap) agent[OPENCODE_NODE_AGENT].steps = cap + 1;   // cap tool steps, then the text-only step OpenCode forces
  if (cap && agent[OPENCODE_INVESTIGATOR_AGENT]) agent[OPENCODE_INVESTIGATOR_AGENT].steps = cap + 1;
  // The node reaches worca's investigator on a fan-out node and no sub-agent otherwise: OpenCode's built-in ones (no step
  // cap, sub-agents of their own) are removed, and `task` reaches no agent of the user's config either.
  agent.general = { disable: true };
  agent.explore = { disable: true };
  agent[OPENCODE_NODE_AGENT].permission = { task: fanOut ? { '*': 'deny', [OPENCODE_INVESTIGATOR_AGENT]: 'allow' } : 'deny' };
  const instructions = instructionFiles(realCwd);
  const config = { agent, ...(Object.keys(rules.permission).length ? { permission: rules.permission } : {}), ...(mcp ? { mcp } : {}),
    ...(instructions.length ? { instructions } : {}) };

  // OPENCODE_ vars and the provider keys in worca's env survive no scrub but their own prefix; the MCP servers'
  // {env:…} values join from the run env.
  const envOpts = { envScrub, envAllowlist, prefixes: OPENCODE_ENV_PREFIXES, hostPid: guardOn ? process.pid : null };
  const refEnv = {};
  if (mcp) {
    const from = composeSpawnEnv({ ...envOpts, runEnv: cleanRunEnv(runSpawnEnv) }).env;
    for (const n of envRefNames(mcp)) if (typeof from[n] === 'string') refEnv[n] = from[n];
  }
  const { env } = composeSpawnEnv({ ...envOpts, ...(Object.keys(refEnv).length ? { runEnv: refEnv } : {}) });
  // OpenCode takes its project folder from PWD, not from its process cwd: an inherited PWD (worca's own) would put the
  // agent in the wrong folder.
  Object.assign(env, { PWD: cwd, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1' });

  const turnCap = () => Object.assign(new Error(`${bin}: stopped after ${cap} turns (the turn cap)`), { turnCap: true });
  const attempt = async (sessionId) => {
    const normalizer = createOpencodeNormalizer({ model: model || null, mcpServers: Object.keys(mcp || {}) });
    const capCtrl = new AbortController();
    let toolCalls = 0; let capped = false; let sawSession = false;
    const spawnSignal = cap ? (signal ? AbortSignal.any([signal, capCtrl.signal]) : capCtrl.signal) : signal;
    const args = buildOpencodeArgs({ agent: OPENCODE_NODE_AGENT, model, effort, sessionId });
    const res = await superviseSpawn({
      file: bin, args, displayBin: bin, cwd, env, stdin: String(prompt ?? ''), signal: spawnSignal, asAgent, stagedDir: asAgent ? scratch : null, onEvent,
      cleanup: () => {},
      isBenignStderr,
      stdoutErrorDetail: () => normalizer.finish().error || '',
      classify: (m) => classifyOpencodeError(m),
      redactText: redactor ? (t) => redactor.text(t) : null,
      spawnError: (err, pfx) => Object.assign(new Error(`${pfx}: ${err.message}`), { errorClass: /ENOENT|EINVAL/.test(String(err.code || err.message)) ? 'network' : null }),
      onDone: (code) => ({ code }),
      onStdoutLine: (line) => {
        for (const e of normalizer.push(line)) {
          safeEmit(onEvent, e);
          if (cap && !capped && e.type === 'tool' && (toolCalls += e.calls.length) > cap) { capped = true; capCtrl.abort(); }
          // Pause/Resume: the runner's own session event (no `init`) is the one the harness stamps on the step.
          if (e.type === 'session') { sawSession = true; safeEmit(onEvent, { type: 'session', sessionId: e.sessionId }); }
        }
      },
    }).catch((err) => {
      if (capped && !signal?.aborted) throw turnCap();
      const f = normalizer.finish();
      if (err?.name !== 'AbortError') {
        const lead = f.error && /Unexpected server error/i.test(f.error) && sniffed.cause ? sniffed.cause : f.error;
        if (lead && !String(err.message).includes(lead)) err.message = `${bin}: ${lead} — ${err.message}`;
        if (f.error) err.errorClass = strongestClass(err.errorClass ?? null, classifyOpencodeError({ name: f.errorName, statusCode: f.statusCode, message: f.error }));
        if (/free tier can only be used/i.test(String(f.error)) && rules.permission.bash === 'deny') err.message += ` (${FREE_TIER_NOTE})`;
      }
      err.sawSession = sawSession;
      throw err;
    });
    const final = normalizer.finish();
    // Past `cap` steps the last one was OpenCode's forced text reply: the agent was stopped, not finished.
    if ((capped || (cap && final.steps > cap)) && !signal?.aborted) throw turnCap();
    if (final.error) throw Object.assign(new Error(`${bin}: ${final.error}`), { errorClass: classifyOpencodeError({ name: final.errorName, statusCode: final.statusCode, message: final.error }), sawSession });
    return { final, exitCode: res.code };
  };

  // A sub-agent's steps are not in the stream: its session's export carries its tool calls (emitted under the `task`
  // call, for the audit), cost and tokens.
  const subSpend = async (subs) => {
    let costUsd = 0; let usage = { ...ZERO_USAGE }; const missed = [];
    for (const { sessionId: id, toolUseId } of subs) {
      const text = await new Promise((resolve) => {
        execFile(bin, ['export', id], { cwd, env, timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
      });
      const s = text == null ? null : readSubsession(text, { parentId: toolUseId, mcpServers: Object.keys(mcp || {}) });
      if (!s) { missed.push(id); continue; }
      for (const e of s.events) safeEmit(onEvent, e);
      costUsd += s.costUsd; usage = addUsage(usage, s.usage);
    }
    if (missed.length) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: could not read sub-agent session(s) ${missed.join(', ')} — their tool calls and cost are not counted` });
    return { costUsd, usage };
  };

  try {
    let out;
    try {
      out = await attempt(session);
    } catch (err) {
      // A resumed session OpenCode no longer knows (before any event): one fresh attempt, said out loud.
      if (!session || err?.sawSession || err?.name === 'AbortError' || !OPENCODE_RESUME_NOT_FOUND_RE.test(String(err?.message || ''))) throw err;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: session ${session.slice(0, 16)}… is gone — starting a fresh one` });
      session = null;
      out = await attempt(null);
    }
    const { final } = out;
    const sub = final.subSessions.length ? await subSpend(final.subSessions) : null;
    const costUsd = final.costUsd == null && !sub ? undefined : (final.costUsd || 0) + (sub ? sub.costUsd : 0);
    const usage = sub ? addUsage(final.usage, sub.usage) : final.usage;
    const text = redactor ? redactor.text(final.text) : final.text;
    safeEmit(onEvent, { type: 'result', text, isError: false, ...(final.sessionId ? { sessionId: OPENCODE_SESSION_PREFIX + final.sessionId } : {}),
      usage, ...(costUsd !== undefined ? { costUsd } : {}) });
    return { text, exitCode: out.exitCode };
  } catch (err) {
    throw redacted(err);
  } finally {
    cleanup();
  }
}

