// src/core/engines/opencode.mjs
// The OpenCode CLI adapter (sst/opencode): `opencode run --format json` argv, the JSON event stream normalized into
// worca's event vocabulary, the cost and tokens OpenCode prices per step, error classes, the run-start preflight, the
// guardrail rule plan, and the spawn path on the shared supervisor (engines/spawn.mjs). Everything worca configures
// rides the OPENCODE_CONFIG_CONTENT env var: worca writes nothing into the run checkout.
//
// OpenCode 1 and OpenCode 2 share the `opencode` command and the `run --format json` stream; the major version, read
// once per binary (`opencodeVersion`), decides the few things that differ. `buildOpencodeArgs`, the preflight's
// credential check, the sub-session export command and the sub-agent lifecycle branch on it; the normalizer, the rule
// plan and the inline config take both shapes. Checked against opencode 2.3.2 (Homebrew `opencode`, npm
// `@opencode/cli`): `run` needs `--standalone` (the shared background service does not read the spawn's config env),
// `--variant` is gone (the variant rides the model as `provider/model#variant`), `--pure` and `--print-logs` are gone,
// `permission` in the V1 shape is still normalized (bash→shell, task→subagent, write→patch/edit), `providers list` is
// `auth list --standalone --format json`, `export <id>` is `session export <id>`, error events carry `error.type`
// (`provider.*`) instead of `name`/`statusCode`, tool parts carry `id` instead of `callID`, the shell tool is `shell`
// (a `bash` call is aliased to it), the sub-agent tool is `subagent` (it returns at once and the child runs in the
// background; the parent `run` waits for it before exiting), and a chat's lockdown leaves the `skill` meta tool
// offered. `-s <unknown>` creates that session instead of failing, so the "session is gone" retry never fires on 2.x.
// 2.x matches a `read`/`edit` pattern against the path relative to the session folder inside it, but against the
// ABSOLUTE path outside it (1.x: `../…` there), so an outside path rule goes in both forms. 2.x also offers `execute`
// (JavaScript "Code Mode"), whose `tools.opencode.session_move` moves the session out of the checkout and with it the
// base every relative rule matches against: worca's agents deny it.
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
//   telemetry, a spend cap. A read-only spawn refuses: no read-only mode has been verified.
//
// Chat (Ask Worca) on OpenCode, verified on opencode 1.19.4 against a local model endpoint (plans/ask-on-qwen-gemini-spike.md):
// - An agent's `permission` `{"*": "deny", "<server>_*": "allow"}` leaves the model that server's tools and nothing
//   else (bash, read, edit, write, glob, grep, list, webfetch, task, todowrite, skill, a custom tool, another MCP
//   server's tools): each is removed from the tool list, and a call to one is "unavailable tool". It is evaluated after
//   the global permission, so the user's own `"*": "allow"` or `"bash": "allow"` in ~/.config/opencode does not widen
//   it; the agent's name is new per spawn, so no user config can name it. worca's server is attached under a name new
//   per spawn too, so a user server named `worca_…` cannot match the allow pattern.
// - `--pure` keeps the user's plugins out (none ran); OPENCODE_DISABLE_PROJECT_CONFIG the checkout's config. The
//   user's own MCP servers still start (their tools are denied); their instructions files still reach the prompt.
// - OpenCode Zen's free models (`opencode/…`) refuse a request without the shell, so a chat never runs on them.
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { execCli, cliRefusal } from './exec-cli.mjs';
import { OPENCODE_CLI } from './cli-specs.mjs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { superviseSpawn, composeSpawnEnv, cleanRunEnv, safeEmit } from './spawn.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';
import { envFlag, OPENCODE_ZEN_RE } from '../model-env.mjs';
import { makeChatDescriptor, providerEnvPrefixes, providerListRates } from './chat-descriptor.mjs';
import { chatSelfTest } from './chat-selftest.mjs';
import { parseJsonc } from '../workspace-import.mjs';

/** Read at call time (not import time), so a test or a server child can point it at a fake after import. */
export const opencodeDefaultBin = () => process.env.WORCA_OPENCODE_BIN || 'opencode';

// ── version ─────────────────────────────────────────────────────────────────

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)/;
/** How long a reading is trusted: an upgrade (1.x to 2.x changes the argv) is picked up without restarting worca. */
const VERSION_MAX_AGE_MS = 60_000;
/** bin -> {at, value: Promise<{major, minor, patch, text}|null>}: the latest `--version` reading per binary. */
const versions = new Map();
/** Tests only: forget every probed version. */
export function resetOpencodeVersions() { versions.clear(); }

const parseVersion = (stdout) => {
  const m = VERSION_RE.exec(String(stdout));
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), text: String(stdout).trim() } : null;
};

/** Keep what a `--version` call somebody else made just said (the run-start check, the chat gate), so the next spawn
 *  branches on it without asking again. Output that names no version is not kept. */
function noteOpencodeVersion(bin, stdout) {
  const v = parseVersion(stdout);
  if (v) versions.set(String(bin), { at: Date.now(), value: Promise.resolve(v) });
  return v;
}

/**
 * What `opencode --version` says: `{major, minor, patch, text}`, or null when the binary cannot say (the spawn reports
 * that itself). A reading is reused for `maxAgeMs`; a failed probe is not kept, so a transient failure is retried.
 * @returns {Promise<{major:number, minor:number, patch:number, text:string}|null>}
 */
export function opencodeVersion(bin = opencodeDefaultBin(), { timeoutMs = 15000, maxAgeMs = VERSION_MAX_AGE_MS } = {}) {
  const key = String(bin);
  const hit = versions.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const entry = { at: Date.now(), value: null };
  entry.value = new Promise((resolve) => {
    execCli(OPENCODE_CLI, bin, ['--version'], { timeout: timeoutMs, env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: '1' } }, (err, stdout) => {
      resolve(err ? null : parseVersion(stdout));
    });
  }).then((v) => { if (!v && versions.get(key) === entry) versions.delete(key); return v; });
  versions.set(key, entry);
  return entry.value;
}

/** The major an adapter decision branches on: 2 for OpenCode 2, else 1 (a probe that failed runs as 1.x). */
export const opencodeMajorOf = (version) => (version && Number.isFinite(version.major) && version.major >= 2 ? 2 : 1);

// ── `opencode models` (the catalogue import's source) ───────────────────────

/** A line of `opencode models`: a provider/model id, the shape `-m <id>` takes (also on OpenCode 1.x). */
const OPENCODE_MODEL_LINE_RE = /^[^/\s]+\/\S+$/;

/** Parse `opencode models` stdout: one provider/model id per line, blanks and anything a version prints besides them
 *  dropped, order kept. Pure. */
export function parseOpencodeModels(stdout) {
  return String(stdout || '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => OPENCODE_MODEL_LINE_RE.test(l));
}

/** What the installed opencode can run, from `opencode models` — the same ids `opencode run -m` takes. Read fresh per
 *  call (a sign-in just completed may have widened the list; unlike `opencodeVersion` there is no per-process cache),
 *  with the autoupdate probe silenced like every other probe. @returns {Promise<string[]>}
 *  @throws {Error} when the binary cannot be run or the command fails (the Add-model list surfaces the message). */
export async function opencodeModelIds({ bin = opencodeDefaultBin(), timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execCli(OPENCODE_CLI, bin, ['models'], { timeout: timeoutMs, env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: '1' } },
      (err, stdout) => {
        if (err) {
          reject(new Error(cliRefusal({ bin, err, install: 'install OpenCode (opencode.ai), or point WORCA_OPENCODE_BIN at it' })));
          return;
        }
        resolve(parseOpencodeModels(String(stdout)));
      });
  });
}

export const OPENCODE_SESSION_PREFIX = 'opencode:';
/** The checkout's instruction files a run gives OpenCode: worca names both as `instructions` (instructionFiles below), so
 *  both load, not only OpenCode's own AGENTS.md-else-CLAUDE.md pick (docs.opencode.ai/docs/rules/). */
export const OPENCODE_INSTRUCTION_FILES = Object.freeze(['AGENTS.md', 'CLAUDE.md']);
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
 *  lacks fails the spawn on OpenCode 2.3.1+ (Zen's `opencode/…` models take none at all), so buildOpencodeArgs
 *  attaches one only for a model that can take it. */
export { OPENCODE_EFFORTS } from '../model-env.mjs';

/** Chat on OpenCode (see the chat notes above): a chat agent of its own whose permission denies every tool and allows
 *  worca's MCP server, no built-in sub-agent, no plugin, no project config. Proven per binary and user config by the
 *  chat self-test. `allow(servers)`: the agent's permission. */
export const OPENCODE_ASK_LOCKDOWN = Object.freeze({
  allow: (servers) => Object.freeze({ '*': 'deny', ...Object.fromEntries(servers.map((s) => [`${s}_*`, 'allow'])) }),
});

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
    const relative = at === -1 ? rel(abs) : `${rel(parts.slice(0, at).join('/') || '/')}/${parts.slice(at).join('/')}`;
    // Outside the cwd, OpenCode 1 matches the `../…` form and OpenCode 2 only the absolute one: both, so one rule set
    // holds on either major (checked on 1.18.23 and 2.3.2).
    return relative === '..' || relative.startsWith('../') ? [relative, abs.split('\\').join('/')] : [relative];
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
 *  `UnknownError` event hides.
 *  OpenCode 2 (`major >= 2`): `--standalone` (a private server reads this spawn's OPENCODE_CONFIG_CONTENT; the shared
 *  one does not), no `--pure` (2.x has no switch for the user's plugins), no `--print-logs` (its error event carries
 *  the message), and the variant rides the model as `provider/model#variant`: an effort replaces a variant the id
 *  already names, and has nothing to ride on without a model (runOpencodeProcess says so). A variant is attached
 *  only when the model can take one: OpenCode Zen's free models (`opencode/…`) take none — OpenCode 2.3.1+ refuses
 *  a `#variant` outright (`Variant unavailable for opencode/big-pickle: low`) where 1.x ignored it, so a Zen model
 *  always spawns without a variant. Beyond the known Zen set, a variant a model does not offer is caught at spawn
 *  (`runOpencodeProcess`) and retried without one, so a phantom variant never hard-fails. */
/** `provider/model` without the `#variant` OpenCode 2 reads off the id. */
const bareModel = (model) => String(model).split('#')[0];
export function buildOpencodeArgs({ agent, model, effort, sessionId, major = 1 } = {}) {
  // A Zen free model accepts no variant; the effort it carries ('' or a pick) would fail the spawn on OpenCode 2.
  const zen = Boolean(model) && OPENCODE_ZEN_RE.test(model);
  const variant = zen ? undefined : effort;
  if (major >= 2) {
    const args = ['run', '--format', 'json', '--auto', '--standalone'];
    if (agent) args.push('--agent', String(agent));
    // A Zen id spawns bare even when it names a `#variant` itself.
    if (model) args.push('-m', variant || zen ? `${bareModel(model)}${variant ? `#${variant}` : ''}` : String(model));
    if (sessionId) args.push('-s', String(sessionId));
    return args;
  }
  const args = ['run', '--format', 'json', '--auto', '--pure', '--print-logs', '--log-level', 'ERROR'];
  if (agent) args.push('--agent', String(agent));
  if (model) args.push('-m', String(model));
  if (variant) args.push('--variant', String(variant));
  if (sessionId) args.push('-s', String(sessionId));
  return args;
}

// ── stream ───────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const TOOL_NAMES = Object.freeze({ bash: 'Bash', shell: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', patch: 'Edit', glob: 'Glob', grep: 'Grep', list: 'LS',
  webfetch: 'WebFetch', websearch: 'WebSearch', todowrite: 'TodoWrite', todoread: 'TodoRead', skill: 'Skill' });
/** A tool part's call id: 1.x `callID`, 2.x `id`. */
const callIdOf = (part) => str(part.callID) || str(part.id);
/** A tool part's name: 1.x `tool`, 2.x `name` (2.x also reports `bash` for a call it aliases to `shell`). */
const toolNameOf = (part) => str(part.tool) || str(part.name);
/** The tool's own metadata: 1.x `state.metadata`, 2.x `state.metadata.metadata` (2.x wraps it beside `content`). */
const toolMetaOf = (st) => (st?.metadata && typeof st.metadata === 'object'
  ? (st.metadata.metadata && typeof st.metadata.metadata === 'object' ? st.metadata.metadata : st.metadata) : {});
/** A 2.x tool result's text lives in `state.content` (`{type:'text', text}` parts); 1.x keeps `state.output`. */
const toolOutputOf = (st) => (typeof st?.output === 'string' ? st.output
  : Array.isArray(st?.content) ? st.content.map((c) => str(c?.text)).join('') : '');
/** The sub-agent tool: 1.x `task`, 2.x `subagent`. */
const isSubagentTool = (name) => name === 'task' || name === 'subagent';

/** OpenCode's step tokens as Claude-style usage (`input` excludes the cache; reasoning is output). */
export function claudeStyleUsage(t) {
  const tk = t && typeof t === 'object' ? t : {};
  return { input_tokens: num(tk.input), output_tokens: num(tk.output) + num(tk.reasoning),
    cache_read_input_tokens: num(tk.cache?.read), cache_creation_input_tokens: num(tk.cache?.write) };
}
const addUsage = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] || 0)]));
const ZERO_USAGE = Object.freeze(claudeStyleUsage({}));

/** A tool call in Claude's vocabulary: `filePath` becomes `file_path`, an attached MCP server's `<server>_<tool>`
 *  becomes `mcp__server__tool` (the longest server name wins; a server worca did not attach keeps OpenCode's name).
 *  `serverNames`: a chat's per-spawn alias -> the server's own. A failed call to an OLDER alias of a resumed session
 *  is relabelled to its server's own too (staleAliasOwn), which keeps a chat's allow-list (`mcp__worca__…`) from
 *  tripping on a name OpenCode itself refused. */
function toolCall(part, mcpServers, serverNames = {}) {
  const raw = toolNameOf(part) || 'tool';
  const input = part.state?.input && typeof part.state.input === 'object' ? { ...part.state.input } : {};
  if ('filePath' in input) { input.file_path = input.filePath; delete input.filePath; }
  const server = TOOL_NAMES[raw] ? null : mcpServers.filter((s) => raw.startsWith(`${s}_`)).sort((a, b) => b.length - a.length)[0];
  // A chat attaches worca's server under a name new per spawn (serverNames: that name -> the server's own).
  const name = TOOL_NAMES[raw] || (server ? `mcp__${serverNames[server] || server}__${raw.slice(server.length + 1)}`
    : (() => { const own = staleAliasOwn(part, raw, serverNames); return own ? `mcp__${own}__${raw.slice(raw.indexOf('_') + 1)}` : raw; })());
  const toolUseId = callIdOf(part);
  if (raw === 'bash' || raw === 'shell') return { name, input: { command: str(input.command) }, toolUseId };
  if (raw === 'write') return { name, input: { file_path: input.file_path, content: input.content }, toolUseId };
  return { name, input, toolUseId };
}

/** The suffix a chat's server alias adds to the server's own (sanitized) name: 8 hex digits seeded by the thread, or
 *  6 base-36 characters when no thread seeds it. */
const ALIAS_SUFFIX_RE = /^(?:[0-9a-f]{8}|[0-9a-z]{6})$/;
const aliasBase = (name) => String(name).replace(/[^A-Za-z0-9]/g, '') || 'mcp';

/** This install's own secret for a chat's server alias (`<worca home>/opencode-alias.key`, the user's eyes only), made
 *  on first use. Null when it can be neither read nor made: the alias then stays random per spawn. */
function aliasSecret() {
  let file;
  try { file = join(worcaHome(), 'opencode-alias.key'); } catch { return null; }
  const read = () => { try { const t = readFileSync(file, 'utf8').trim(); return /^[0-9a-f]{64}$/.test(t) ? t : null; } catch { return null; } };
  const kept = read();
  if (kept) return kept;
  try {
    mkdirSync(worcaHome(), { recursive: true });
    // `wx`: a second process that got here first wins, and both read its key.
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  } catch { /* it exists by now, or the folder cannot be written: the read below says which */ }
  return read();
}

/** A chat's alias suffix for `seed` (the thread id): the same on every spawn of the thread, and not derivable from
 *  the thread id without this install's secret. Null without a seed or a secret. */
function threadAliasSuffix(seed) {
  if (typeof seed !== 'string' || !seed) return null;
  const secret = aliasSecret();
  return secret ? createHmac('sha256', secret).update(seed).digest('hex').slice(0, 8) : null;
}

/** The chat server a stale `<alias>_<tool>` call belongs to, or null. A stale alias is one this spawn does not hold: an
 *  older spawn's of a resumed session. OpenCode never exposes it, so such a call cannot run — and only a call that did
 *  not run (`status: error`) is read as one: a call that ran, or still runs, was made to a server that exists, which is
 *  not worca's. The prefix must be the server's own name plus an alias suffix, nothing looser. Only a chat passes
 *  serverNames, so a run's (unmapped) foreign tool keeps OpenCode's name. */
const staleAliasOwn = (part, raw, serverNames) => {
  const i = raw.indexOf('_');
  if (i <= 1 || part.state?.status !== 'error') return null;
  const prefix = raw.slice(0, i);
  return [...new Set(Object.values(serverNames))].find((o) => {
    if (typeof o !== 'string' || !o) return false;
    const base = aliasBase(o);
    return prefix.startsWith(base) && ALIAS_SUFFIX_RE.test(prefix.slice(base.length));
  }) ?? null;
};

/**
 * `--format json` lines in, normalized events out (src/core/engines/events.mjs). push(line|object) returns the
 * events for that line; finish() returns { text, error, errorName, errorType, statusCode, sessionId, costUsd, usage,
 * subSessions, openSubagents, steps } (subSessions: [{sessionId, toolUseId}]; openSubagents: the sub-agent rows the
 * stream spawned and did not close, `[{toolUseId, isError, errorText?}]` with the call's own last status; steps: the
 * main agent's `step_start` count).
 * Takes 1.x and 2.x lines: the call id (`callID`/`id`), the tool name (`tool`/`name`), a tool's metadata
 * (`state.metadata`/`state.metadata.metadata`), a result's text (`output`/`content`) and the sub-agent tool
 * (`task`/`subagent`) are read in either shape.
 * @param {{model?: string|null, mcpServers?: string[], serverNames?: Record<string,string>, backgroundSubagents?: boolean}} [o]
 *   mcpServers: the server names worca attached; serverNames: an attached name -> the server's own (a chat's
 *   per-spawn names); backgroundSubagents: OpenCode 2 returns from `subagent` while the child still runs, so its
 *   `finish`/`error` row is left to the export (runOpencodeProcess' subSpend), not read off the tool call.
 */
export function createOpencodeNormalizer({ model = null, mcpServers = [], serverNames = {}, backgroundSubagents = false } = {}) {
  const texts = [];   // {messageId, text}: a reply's parts, in order
  const seen = new Set();
  const subSessions = [];   // {sessionId, toolUseId}: a sub-agent's session and the `task` call that ran it
  const openSubagents = new Map();   // toolUseId -> {isError, errorText}: rows spawned here and not closed in-stream
  let sessionId = null; let error = null; let errorName = null; let errorType = null; let statusCode = null;
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
        texts.push({ messageId: str(part.messageID), text: t });
        out.push({ type: 'text', text: t, parentId: null, from: 'assistant', blocks: [t], ...(str(part.messageID) ? { messageId: part.messageID } : {}) });
        break;
      }
      case 'tool_use': {
        const id = callIdOf(part);
        if (!id) break;
        const st = part.state && typeof part.state === 'object' ? part.state : {};
        const done = st.status === 'completed' || st.status === 'error';
        if (isSubagentTool(toolNameOf(part))) {
          const input = st.input && typeof st.input === 'object' ? st.input : {};
          if (!seen.has(id)) {
            seen.add(id);
            const label = str(input.description) || 'OpenCode sub-agent';
            // 1.x names the sub-agent `subagent_type`; 2.x `agent`.
            const subagentType = str(input.subagent_type) || str(input.agent);
            const subModel = toolMetaOf(st).model?.modelID || toolMetaOf(st).model?.id;
            out.push({ type: 'subagent', event: 'spawn', toolUseId: id, label, description: label,
              ...(subagentType ? { subagentType } : {}),
              ...(str(subModel) ? { model: subModel } : {}) });
            openSubagents.set(id, { isError: false });
          }
          // 1.x `metadata.sessionId`; 2.x `metadata.metadata.sessionID`.
          const md = toolMetaOf(st);
          const sub = str(md.sessionId) || str(md.sessionID);
          if (sub && !subSessions.some((x) => x.sessionId === sub)) subSessions.push({ sessionId: sub, toolUseId: id });
          if (done && !backgroundSubagents) {
            openSubagents.delete(id);
            out.push({ type: 'subagent', event: st.status === 'error' ? 'error' : 'finish', toolUseId: id, ...(st.status === 'error' ? { errorText: str(st.error) } : {}) });
          } else if (done && openSubagents.has(id)) {
            // Background (2.x): the call returned, the child may still run. Kept for whoever closes the row.
            openSubagents.set(id, st.status === 'error' ? { isError: true, errorText: str(st.error) } : { isError: false });
          }
          break;
        }
        if (!seen.has(id)) { seen.add(id); out.push({ type: 'tool', parentId: null, calls: [toolCall(part, mcpServers, serverNames)] }); }
        if (done) {
          const t = st.status === 'error' ? str(st.error) : toolOutputOf(st);
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
        error = str(e.data?.message) || str(e.message) || str(e.name) || str(e.type) || 'opencode reported an error';
        errorName = str(e.name) || null;
        // 2.x names the class in `type` (`provider.auth`, `provider.rate-limit`, …).
        errorType = str(e.type) || null;
        statusCode = Number.isFinite(e.data?.statusCode) ? e.data.statusCode : null;
        out.push({ type: 'stderr', stream: 'err', text: `opencode: ${error}` });
        break;
      }
      default:
        break;   // reasoning: nothing worca reads
    }
    return out;
  }
  // Parts of one message join as they are; separate messages (OpenCode 2 answers again when a background child goes
  // idle) are kept apart by a blank line.
  const joined = () => texts.map((p, i) => (i && p.messageId && texts[i - 1].messageId && p.messageId !== texts[i - 1].messageId ? '\n\n' : '') + p.text).join('');
  return { push, finish: () => ({ text: joined(), error, errorName, errorType, statusCode, sessionId, costUsd: priced ? costUsd : null, usage, subSessions: [...subSessions],
    openSubagents: [...openSubagents].map(([toolUseId, o]) => ({ toolUseId, ...o })), steps }) };
}

/**
 * A sub-session from `opencode export <id>` (1.x) or `opencode session export <id>` (2.x) output, or null: its cost and
 * tokens, and its tool calls and results as worca events under `parentId` (the sub-agent call), so the audit sees what
 * the sub-agent did. `settled` is false for a 2.x session that is still running (no `time.idle`, no terminal outcome);
 * `failed` is true for a 2.x session whose `outcome` is failed, cancelled or error (1.x reports that in the stream),
 * and `errorText` is the cause the session names, or ''.
 */
export function readSubsession(text, { parentId = null, mcpServers = [] } = {}) {
  let doc;
  try { const t = String(text); doc = JSON.parse(t.slice(t.indexOf('{'))); } catch { return null; }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.messages)) return null;
  // 2.x: { info: {cost, tokens, outcome, time:{idle}}, messages: [{ type:'assistant', content:[{type:'tool', id, name,
  // state:{status, input, content, error}}], cost, tokens }] }. 1.x: { messages: [{ info:{role, cost, tokens},
  // parts:[{type:'tool', callID, tool, state:{status, input, output|error}}] }] }. A v2 message has `type`, never
  // `info`; a v1 message always has `info` (an export with no assistant messages is still v2 when none carry `info`).
  if (!doc.messages.some((m) => m && Object.hasOwn(m, 'info'))) return readSubsessionV2(doc, { parentId, mcpServers });
  let costUsd = 0; let usage = { ...ZERO_USAGE }; const events = [];
  for (const m of doc.messages) {
    if (m?.info?.role !== 'assistant') continue;
    if (Number.isFinite(m.info.cost)) costUsd += m.info.cost;
    usage = addUsage(usage, claudeStyleUsage(m.info.tokens));
    for (const part of Array.isArray(m.parts) ? m.parts : []) {
      if (part?.type !== 'tool' || !callIdOf(part)) continue;
      const st = part.state && typeof part.state === 'object' ? part.state : {};
      events.push({ type: 'tool', parentId, calls: [toolCall(part, mcpServers)] });
      if (st.status === 'completed' || st.status === 'error') {
        const t = st.status === 'error' ? str(st.error) : toolOutputOf(st);
        events.push({ type: 'toolResult', parentId, meta: null, results: [{ toolUseId: callIdOf(part), isError: st.status === 'error', text: t, content: t }] });
      }
    }
  }
  return { costUsd, usage, events, settled: true, failed: false, outcome: '', errorText: '' };
}

/** A 2.x session `outcome` that is not a success. */
const V2_FAILED_OUTCOMES = Object.freeze(['failed', 'cancelled', 'error']);

/** The 2.x export (see readSubsession). The session's `info` carries its own totals; messages are summed only when it
 *  does not. A `subagent` call inside a sub-session names a grandchild, whose spend is not in this document. */
function readSubsessionV2(doc, { parentId, mcpServers }) {
  const info = doc.info && typeof doc.info === 'object' ? doc.info : {};
  let costUsd = 0; let usage = { ...ZERO_USAGE }; const events = [];
  const totals = Number.isFinite(info.cost) || (info.tokens && typeof info.tokens === 'object');
  if (Number.isFinite(info.cost)) costUsd = info.cost;
  if (info.tokens && typeof info.tokens === 'object') usage = claudeStyleUsage(info.tokens);
  for (const m of doc.messages) {
    if (m?.type !== 'assistant') continue;
    if (!totals) {
      if (Number.isFinite(m.cost)) costUsd += m.cost;
      usage = addUsage(usage, claudeStyleUsage(m.tokens));
    }
    for (const part of Array.isArray(m.content) ? m.content : []) {
      if (part?.type !== 'tool' || !callIdOf(part)) continue;
      const st = part.state && typeof part.state === 'object' ? part.state : {};
      events.push({ type: 'tool', parentId, calls: [toolCall(part, mcpServers)] });
      if (st.status === 'completed' || st.status === 'error') {
        const t = st.status === 'error' ? str(st.error) : toolOutputOf(st);
        events.push({ type: 'toolResult', parentId, meta: null, results: [{ toolUseId: callIdOf(part), isError: st.status === 'error', text: t, content: t }] });
      }
    }
  }
  const outcome = str(info.outcome);
  const failed = V2_FAILED_OUTCOMES.includes(outcome);
  const settled = Boolean(info.time?.idle) || failed || outcome === 'succeeded';
  // 2.3.2 names a failed child's cause on its `idle` message (and on the assistant message that failed).
  const errorOf = (m) => (m && m.error && typeof m.error === 'object' ? str(m.error.message) : '');
  const errorText = failed ? (errorOf(info) || errorOf([...doc.messages].reverse().find((m) => errorOf(m))) || '') : '';
  return { costUsd, usage, events, settled, failed, outcome, errorText };
}

// ── errors and preflight ─────────────────────────────────────────────────────

/** OpenCode 2's error `type`s that are worca error classes; the rest (no-route, invalid-request, internal, …) are
 *  not a credential, limit or network problem. */
const V2_ERROR_CLASSES = Object.freeze({
  'provider.auth': 'auth',
  'provider.rate-limit': 'rate_limit',
  'provider.quota': 'quota',
  'provider.budget-limit': 'quota',
  'provider.model-budget-limit': 'quota',
  'provider.free-limit': 'usage_limit',
  'provider.chatgpt-limit': 'usage_limit',
  'provider.go-limit': 'usage_limit',
  'provider.transport': 'network',
  'provider.timeout': 'network',
});

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyOpencodeError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  const name = err && typeof err === 'object' ? str(err.name) : '';
  // 2.x: the class is `type` (`provider.auth`), with no `name` and no statusCode.
  const type = err && typeof err === 'object' ? str(err.type) || str(err.errorType) : '';
  if (type && Object.hasOwn(V2_ERROR_CLASSES, type)) return V2_ERROR_CLASSES[type];
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

/**
 * `opencode auth list --standalone --format json` (2.x) -> {credentials, env} counts, or null when it is not that
 * document. A connection of type `env` is a provider key in the environment; any other kind (a saved sign-in) is a
 * credential. `[]` is a real answer: neither.
 */
export function parseOpencodeAuth(text) {
  let doc;
  try { doc = JSON.parse(String(text || '')); } catch { return null; }
  if (!Array.isArray(doc)) return null;
  let credentials = 0; let env = 0;
  for (const provider of doc) {
    for (const connection of Array.isArray(provider?.connections) ? provider.connections : []) {
      if (connection?.type === 'env') env++; else credentials++;
    }
  }
  return { credentials, env };
}

export const OPENCODE_SIGNED_OUT_HINT = 'run `opencode auth login`, or set a provider key (for example ANTHROPIC_API_KEY) in worca\'s environment and, when the guardrail set scrubs the env, its allowlist';

/**
 * The run-start check (engines/index.mjs `preflight`). Never rejects: {refusal} | {warning} | {}. The binary must run.
 * `defaultModel`: whether some spawn of the run names no model (true), every one names one (false), or unknown
 * (undefined: the readiness check). A spawn without a model refuses without the opt-in. The credential check runs with
 * the env the agent gets (`envScrub`, `envAllowlist`): a key only worca has does not count. With no credential, only
 * OpenCode Zen's free models run: a refusal unless every spawn names its model or the user opted in. On OpenCode 2 the
 * credentials come from `auth list --standalone --format json` (the shared service is not needed); 1.x reads
 * `providers list`.
 */
export function opencodePreflight({ bin = opencodeDefaultBin(), timeoutMs = 15000, envScrub, envAllowlist, defaultModel } = {}) {
  const allowed = defaultModelAllowed();
  const { env } = composeSpawnEnv({ envScrub, envAllowlist, prefixes: OPENCODE_ENV_PREFIXES });
  const run = (args) => new Promise((resolve) => {
    execCli(OPENCODE_CLI, bin, args, { timeout: timeoutMs, env: { ...env, OPENCODE_DISABLE_AUTOUPDATE: '1' } }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
  return (async () => {
    const v = await run(['--version']);
    if (v.err) {
      return /^(ENOENT|EACCES|EINVAL)$/.test(String(v.err.code)) || typeof v.err.code === 'number'
        ? { refusal: cliRefusal({ bin, err: v.err, install: 'install OpenCode (opencode.ai), or point WORCA_OPENCODE_BIN at it' }) }
        : { warning: `could not check ${bin} (${v.err.message})` };
    }
    if (defaultModel === true && !allowed) return { refusal: `a step of this run names no model: ${DEFAULT_MODEL_RISK}` };
    if (opencodeMajorOf(noteOpencodeVersion(bin, v.stdout)) >= 2) {
      // 2.x needs `--standalone`: without it `auth list` attaches to the shared service, which may be busy elsewhere.
      const p = await run(['auth', 'list', '--standalone', '--format', 'json']);
      const counts = p.err ? null : parseOpencodeAuth(p.stdout);
      if (!counts) return { warning: `could not tell whether ${bin} has provider credentials (\`${bin} auth list\` said nothing recognizable)` };
      if (!counts.credentials && !counts.env) {
        const why = `no provider credentials in the agent's environment — only OpenCode Zen's free models (opencode.ai) will run; ${OPENCODE_SIGNED_OUT_HINT}`;
        return allowed || defaultModel === false ? { warning: why } : { refusal: `${why}, or set ${OPENCODE_DEFAULT_MODEL_OPT_IN}=1 to allow it` };
      }
      return {};
    }
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
/** OpenCode 2.3.1+'s refusal of a variant a model does not offer (`provider.no-route: Variant unavailable for
 *  <model>: <variant>`), where 1.x ignored it. The catalog can advertise variants a model does not take — a free
 *  model like `openrouter/…/ernie-5.5-flash-preview:free` takes only some (its `high` works, its `low`/`medium`
 *  fail), OpenCode Zen's `opencode/*` none at all — so a spawn that hits it retries without the variant. */
const OPENCODE_VARIANT_UNAVAILABLE_RE = /Variant unavailable/i;
/** `provider/model#variant` pairs OpenCode refused in this process. A refused turn's prompt stays in its session, so a
 *  retry on a resumed session sends it twice (checked on 2.3.2): remembering the refusal keeps every later spawn of
 *  that pair from being refused at all, and only the first refused turn of a resumed session can repeat its prompt. */
const refusedVariants = new Set();
/** The error log line (`--print-logs --log-level ERROR`) that names what an `UnknownError` event hides. */
const LOG_CAUSE_RE = /\bmessage=failed\b.*?\berror="([^"]+)"/;
/** Log chatter that repeats a failure already reported: streamed, never the error detail. */
const isBenignStderr = (line) => /message="share subscriber failed"/.test(line);
const FREE_TIER_NOTE = 'OpenCode Zen\'s free models refuse a run without the shell tool — the guardrail set denies the whole shell (a bare Bash rule); pick a model of another provider, or a set without it';

/** The checkout's own instruction files, by absolute path (OPENCODE_DISABLE_PROJECT_CONFIG turns their discovery off). */
const instructionFiles = (cwd) => OPENCODE_INSTRUCTION_FILES.map((f) => join(cwd, f)).filter((p) => existsSync(p));

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
  scratchBase = null, probe = null, tryGuard = null, serverAliasSeed = null,
} = {}) {
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  // A chat (askLockdown): OPENCODE_ASK_LOCKDOWN, on a model it names (never OpenCode's default, never OpenCode Zen).
  const ask = !!askLockdown;
  if (sandbox === 'read-only' && !ask) throw new Error(`${bin}: OpenCode has no verified read-only mode — a read-only job runs on Claude instead`);
  if (ask && !(typeof model === 'string' && model.trim())) throw new Error(`${bin}: a chat on OpenCode needs a model`);
  if (ask && OPENCODE_ZEN_RE.test(model)) throw new Error(`${bin}: OpenCode Zen's free models refuse a chat (it has no shell) — pick a model of another provider`);
  if (!(typeof model === 'string' && model.trim()) && !defaultModelAllowed()) throw new Error(`${bin}: refusing to start OpenCode without a model: ${DEFAULT_MODEL_RISK}`);
  // The major decides the argv (--standalone, no --variant/--pure), the normalizer's sub-agent lifecycle and the
  // sub-session export command; a recent reading is reused (opencodeVersion).
  const version = await opencodeVersion(bin);
  const major = opencodeMajorOf(version);
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

  if (major >= 2 && effort && !(typeof model === 'string' && model.trim())) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: effort ${effort} is not applied — OpenCode 2 takes it on the model id, and this spawn names no model` });

  let session = opencodeSessionOf(resumeSessionId);
  if (resumeSessionId && !session) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not an OpenCode session — starting a fresh one` });

  let realCwd = cwd;
  try { realCwd = realpathSync(cwd); } catch { /* not there: the spawn says so */ }
  const rules = opencodeRulePlan(ask ? null : permissionRules, { cwd: realCwd });
  const rand = () => Math.random().toString(36).slice(2, 8);
  // A chat's server alias is STABLE per thread (`serverAliasSeed`: the thread id), not random per spawn. OpenCode names
  // MCP tools `<alias>_<tool>`, and a resumed session keeps calling the aliases it learned; a fresh random alias on
  // every spawn made those calls stale ("No tool named <oldalias>_<tool>"). The suffix is keyed by this install's own
  // secret (threadAliasSuffix), so knowing the thread id does not give the name: a user server still cannot take it.
  // Absent a seed (the self-test, a run) or a secret, it stays random.
  const stableSuffix = ask ? threadAliasSuffix(serverAliasSeed) : null;
  let mcp = null;
  const serverNames = {};   // a chat's per-spawn server name -> the server's own
  if (mcpConfigPath) {
    let doc;
    try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
    let servers = doc && typeof doc.mcpServers === 'object' && doc.mcpServers ? doc.mcpServers : {};
    if (ask) {
      // The chat's MCP child gets the spawn env (the command bridge token, SSH_AUTH_SOCK, the web search key) by
      // reference; the names no user server can take: a stable one per thread (the self-test's is fixed).
      const refNames = [...new Set([...Object.keys(cleanRunEnv(runSpawnEnv) || {}), ...(envAllowlist || []).filter((k) => typeof process.env[k] === 'string' && process.env[k] !== '')])];
      servers = Object.fromEntries(Object.entries(servers).map(([n, srv]) => {
        const alias = (probe && probe.serverAlias && probe.serverAlias(n)) || `${aliasBase(n)}${stableSuffix || rand()}`;
        serverNames[alias] = n;
        const withRefs = srv && typeof srv.command === 'string' && refNames.length
          ? { ...srv, env: { ...Object.fromEntries(refNames.map((k) => [k, `\${${k}}`])), ...(srv.env && typeof srv.env === 'object' ? srv.env : {}) } } : srv;
        return [alias, withRefs];
      }));
    }
    mcp = opencodeMcpServers(servers);
    if (!Object.keys(mcp).length) mcp = null;
  }

  const guardOn = hostGuardEnabled();
  const sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : String(systemPrompt || '');
  const fanOut = !ask && Array.isArray(allowedTools) && allowedTools.some((t) => t === 'Agent' || t === 'Task');
  // A chat's agent has a name no user config can know (its permission would merge into one it did know).
  const nodeAgent = ask ? `worca-chat-${rand()}${rand()}` : OPENCODE_NODE_AGENT;

  // Scratch folder: the agents' prompt files (read by OpenCode through `{file:…}`), removed after the spawn.
  const scratch = join(scratchBase || join(worcaHome(), 'tmp', 'opencode'), `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const cleanup = () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } };
  const agent = { [nodeAgent]: { mode: 'primary', description: ask ? 'worca chat' : 'The worca pipeline agent for this call.', prompt: `{file:${join(scratch, 'node.md')}}` } };
  try {
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, 'node.md'), sys || 'You are an agent of a worca pipeline. Follow the task you are given.', { mode: 0o600 });
    if (fanOut) {
      writeFileSync(join(scratch, 'investigator.md'), [INVESTIGATOR_PROMPT, appendSubagentSystemPrompt].filter(Boolean).join('\n\n'), { mode: 0o600 });
      // Read-only for real (no sandbox here): every tool denied but reading and searching, so a tool a newer OpenCode
      // adds stays off too. Its permission lands after the global one (last match wins), so `read` allows `*` first and
      // then repeats the run's own read rules; a bare `Read` deny keeps reading off. `external_directory` stays open (as
      // --auto leaves it for the node): a workspace's other repos, the memory mount and the scratch folder are outside
      // the cwd, and the read rules still apply there.
      const runRead = rules.permission.read;
      const read = runRead === 'deny' ? 'deny' : { '*': 'allow', ...(runRead && typeof runRead === 'object' ? runRead : {}) };
      agent[OPENCODE_INVESTIGATOR_AGENT] = { mode: 'subagent', description: 'Read-only investigator for a worca pipeline agent: give it an area, a question and the directories to look in.', prompt: `{file:${join(scratch, 'investigator.md')}}`,
        permission: { '*': 'deny', read, glob: 'allow', grep: 'allow', list: 'allow', external_directory: 'allow' } };
    }
  } catch (err) {
    cleanup();
    throw new Error(`${bin}: cannot prepare the spawn: ${err.message}`);
  }
  const cap = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
  if (cap) agent[nodeAgent].steps = cap + 1;   // cap tool steps, then the text-only step OpenCode forces
  if (cap && agent[OPENCODE_INVESTIGATOR_AGENT]) agent[OPENCODE_INVESTIGATOR_AGENT].steps = cap + 1;
  // The node reaches worca's investigator on a fan-out node and no sub-agent otherwise: OpenCode's built-in ones (no step
  // cap, sub-agents of their own) are removed, and `task` reaches no agent of the user's config either.
  agent.general = { disable: true };
  agent.explore = { disable: true };
  // OpenCode 2's `execute` (Code Mode) reaches `tools.opencode.session_move` and the worktree tools: a session moved
  // out of the checkout leaves every cwd-relative read/edit rule behind (checked on 2.3.2), so worca's agents never get
  // it. A chat's lockdown already denies every tool but worca's server.
  agent[nodeAgent].permission = ask ? OPENCODE_ASK_LOCKDOWN.allow(Object.keys(mcp || {}))
    : { task: fanOut ? { '*': 'deny', [OPENCODE_INVESTIGATOR_AGENT]: 'allow' } : 'deny', execute: 'deny' };
  const instructions = ask ? [] : instructionFiles(realCwd);
  // The chat self-test's model endpoint, as an OpenAI-compatible provider of its own (engines/chat-selftest.mjs).
  const provider = probe && probe.url ? { [model.split('/')[0]]: { npm: '@ai-sdk/openai-compatible', name: 'worca self-test',
    options: { baseURL: `${probe.url}/v1`, apiKey: 'worca-self-test' }, models: { [model.split('/').slice(1).join('/')]: { name: 'worca self-test', tool_call: true, attachment: true, modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } } } } } : null;
  const config = { agent, ...(Object.keys(rules.permission).length ? { permission: rules.permission } : {}), ...(mcp ? { mcp } : {}),
    ...(instructions.length ? { instructions } : {}), ...(provider ? { provider } : {}) };

  // OPENCODE_ vars and the provider keys in worca's env survive no scrub but their own prefix; the MCP servers'
  // {env:…} values join from the run env.
  // A chat keeps its model's provider env too (its key in worca's environment): it has no shell to read it.
  const envOpts = { envScrub, envAllowlist, prefixes: [...OPENCODE_ENV_PREFIXES, ...(ask ? providerEnvPrefixes(model) : [])], hostPid: guardOn ? process.pid : null };
  const refEnv = {};
  if (mcp) {
    const from = { ...composeSpawnEnv({ ...envOpts, runEnv: cleanRunEnv(runSpawnEnv) }).env, ...(ask ? Object.fromEntries((envAllowlist || []).filter((k) => typeof process.env[k] === 'string').map((k) => [k, process.env[k]])) : {}) };
    for (const n of envRefNames(mcp)) if (typeof from[n] === 'string') refEnv[n] = from[n];
  }
  // Workflow tests 3a (D56): a try's outward guard (stand-ins first on PATH, git with no sign-in); absent ⇒ unchanged.
  const { env } = composeSpawnEnv({ ...envOpts, ...(Object.keys(refEnv).length ? { runEnv: refEnv } : {}), ...(tryGuard ? { tryGuard } : {}) });
  if (typeof runSpawnEnv?.TMPDIR === 'string') env.TMPDIR = runSpawnEnv.TMPDIR;   // the run's scratch folder, no secret
  // OpenCode takes its project folder from PWD, not from its process cwd: an inherited PWD (worca's own) would put the
  // agent in the wrong folder.
  Object.assign(env, { PWD: cwd, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1' },
    probe ? probe.env : {});

  const turnCap = () => Object.assign(new Error(`${bin}: stopped after ${cap} turns (the turn cap)`), { turnCap: true });
  // The variant actually sent: `effort`, unless a "Variant unavailable" refusal (OpenCode 2.3.1+) drops it for the
  // retry — the model runs at its own default then. A chat's turn calls this once, so the retry needs no turn-level
  // cooperation.
  let variant = effort;
  // The model id as spawned: the retry also drops a `#variant` the id names itself.
  let spawnModel = model;
  const idVariantOf = (m) => (m && String(m).includes('#') ? String(m).split('#')[1] : '');
  if (major >= 2 && model) {
    const known = [variant, idVariantOf(spawnModel)].find((v) => v && refusedVariants.has(`${bareModel(model)}#${v}`));
    if (known) {
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: ${bareModel(model)} takes no "${known}" variant — running without it` });
      variant = null;
      spawnModel = bareModel(model);
    }
  }
  const attempt = async (sessionId) => {
    const normalizer = createOpencodeNormalizer({ model: model || null, mcpServers: Object.keys(mcp || {}), serverNames, backgroundSubagents: major >= 2 });
    const capCtrl = new AbortController();
    let toolCalls = 0; let capped = false; let sawSession = false;
    const spawnSignal = cap ? (signal ? AbortSignal.any([signal, capCtrl.signal]) : capCtrl.signal) : signal;
    const args = buildOpencodeArgs({ agent: nodeAgent, model: spawnModel, effort: variant, sessionId, major });
    // A failed attempt reads no export: the rows still open close here, as errors.
    const abandon = () => {
      for (const o of normalizer.finish().openSubagents) safeEmit(onEvent, { type: 'subagent', event: 'error', toolUseId: o.toolUseId, errorText: o.errorText || 'the run ended before this sub-agent reported back' });
    };
    const res = await superviseSpawn({
      cli: OPENCODE_CLI,
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
      abandon();
      if (capped && !signal?.aborted) throw turnCap();
      const f = normalizer.finish();
      if (err?.name !== 'AbortError') {
        const lead = f.error && /Unexpected server error/i.test(f.error) && sniffed.cause ? sniffed.cause : f.error;
        if (lead && !String(err.message).includes(lead)) err.message = `${bin}: ${lead} — ${err.message}`;
        if (f.error) err.errorClass = strongestClass(err.errorClass ?? null, classifyOpencodeError({ name: f.errorName, type: f.errorType, statusCode: f.statusCode, message: f.error }));
        if (/free tier can only be used/i.test(String(f.error)) && rules.permission.bash === 'deny') err.message += ` (${FREE_TIER_NOTE})`;
      }
      err.sawSession = sawSession;
      throw err;
    });
    const final = normalizer.finish();
    // Past `cap` steps the last one was OpenCode's forced text reply: the agent was stopped, not finished.
    if (((capped || (cap && final.steps > cap)) && !signal?.aborted) || final.error) abandon();
    if ((capped || (cap && final.steps > cap)) && !signal?.aborted) throw turnCap();
    if (final.error) throw Object.assign(new Error(`${bin}: ${final.error}`), { errorClass: classifyOpencodeError({ name: final.errorName, type: final.errorType, statusCode: final.statusCode, message: final.error }), sawSession });
    return { final, exitCode: res.code };
  };

  // A sub-agent's steps are not in the stream: its session's export carries its tool calls (emitted under the sub-agent
  // call, for the audit), cost and tokens. 2.x returns from `subagent` while the child still runs, so its export also
  // closes the sub-agent row the normalizer left open, and is retried until the child settles (the parent `run` waits
  // for it, so this is a backstop). The sessions are read side by side; their events go out in call order.
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const readSub = async ({ sessionId: id, toolUseId }) => {
    const args = major >= 2 ? ['session', 'export', id] : ['export', id];
    let parsed = null;
    for (let n = 0; n < (major >= 2 ? 6 : 1); n++) {
      const text = await new Promise((resolve) => {
        execCli(OPENCODE_CLI, bin, args, { cwd, env, timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
      });
      if (text == null) break;
      parsed = readSubsession(text, { parentId: toolUseId, mcpServers: Object.keys(mcp || {}) });
      if (!parsed || parsed.settled) break;   // not a session document: asking again will not make it one
      if (n < 5) await delay(1000);
    }
    return parsed;
  };
  /** Reads every sub-session; on 2.x closes each row whose export could be read. @returns the spend and the rows closed. */
  const subSpend = async (subs) => {
    let costUsd = 0; let usage = { ...ZERO_USAGE }; const missed = []; const closed = new Set();
    const read = await Promise.all(subs.map(readSub));
    subs.forEach(({ sessionId: id, toolUseId }, i) => {
      const parsed = read[i];
      if (!parsed) { missed.push(id); return; }
      for (const e of parsed.events) safeEmit(onEvent, e);
      costUsd += parsed.costUsd; usage = addUsage(usage, parsed.usage);
      if (major < 2) return;
      // 2.x returned from `subagent` at once, so the stream left the sub-agent row open; close it on the export.
      const errorText = parsed.failed ? `the sub-agent's session ended as ${parsed.outcome}${parsed.errorText ? `: ${parsed.errorText}` : ''}`
        : !parsed.settled ? 'the sub-agent was still running when the run ended' : null;
      safeEmit(onEvent, { type: 'subagent', event: errorText ? 'error' : 'finish', toolUseId,
        ...(errorText ? { errorText } : {}), ...(parsed.costUsd ? { costUsd: parsed.costUsd } : {}) });
      closed.add(toolUseId);
    });
    if (missed.length) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: could not read sub-agent session(s) ${missed.join(', ')} — their tool calls and cost are not counted` });
    return { costUsd, usage, closed };
  };

  try {
    let out;
    try {
      out = await attempt(session);
    } catch (err) {
      // OpenCode 2.3.1+ refuses a variant a model does not offer (provider.no-route "Variant unavailable for
      // <model>: <variant>") where 1.x ignored it; the catalog can advertise variants the model does not take.
      // Retry once without the variant — the model runs at its own default. `variant` is falsy on a second failure,
      // so this can never loop, and a second "Variant unavailable" is a real error.
      const idVariant = idVariantOf(spawnModel);
      if ((variant || idVariant) && major >= 2 && OPENCODE_VARIANT_UNAVAILABLE_RE.test(String(err?.message || ''))) {
        if (spawnModel) refusedVariants.add(`${bareModel(spawnModel)}#${variant || idVariant}`);
        safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: ${bareModel(spawnModel) || 'the model'} takes no "${variant || idVariant}" variant — retrying without it` });
        variant = null;
        if (idVariant) spawnModel = bareModel(spawnModel);
        out = await attempt(session);
      } else if (ask || !session || err?.sawSession || err?.name === 'AbortError' || !OPENCODE_RESUME_NOT_FOUND_RE.test(String(err?.message || ''))) {
        throw err;
      } else {
        // A resumed session OpenCode no longer knows (before any event): one fresh attempt, said out loud.
        safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] opencode: session ${session.slice(0, 16)}… is gone — starting a fresh one` });
        session = null;
        out = await attempt(null);
      }
    }
    const { final } = out;
    const sub = final.subSessions.length ? await subSpend(final.subSessions) : null;
    // A row no export closed (unreadable, or the call named no session) closes on the call's own status: the run is over.
    for (const o of final.openSubagents) {
      if (sub?.closed.has(o.toolUseId)) continue;
      safeEmit(onEvent, { type: 'subagent', event: o.isError ? 'error' : 'finish', toolUseId: o.toolUseId, ...(o.isError ? { errorText: o.errorText || '' } : {}) });
    }
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

// ── chat ─────────────────────────────────────────────────────────────────────

/** The oldest 1.x the chat lockdown was verified on, and the oldest 2.x (both verified against a local model endpoint). */
export const OPENCODE_ASK_MIN_VERSION = '1.19.4';
export const OPENCODE_ASK_MIN_V2 = '2.3.2';

/** Can this opencode be locked down for a chat? OpenCode 1.x at least OPENCODE_ASK_MIN_VERSION, or 2.x at least
 *  OPENCODE_ASK_MIN_V2. Never rejects. */
export function opencodeAskSupport({ bin = opencodeDefaultBin(), timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execCli(OPENCODE_CLI, bin, ['--version'], { timeout: timeoutMs, env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: '1' } }, (err, stdout) => {
      if (err) { resolve({ refusal: /^(ENOENT|EACCES|EINVAL)$/.test(String(err.code)) ? cliRefusal({ bin, err, install: 'install OpenCode (opencode.ai), or point WORCA_OPENCODE_BIN at it' }) : `could not ask ${bin} its version (${err.message})` }); return; }
      noteOpencodeVersion(bin, stdout);
      const v = VERSION_RE.exec(String(stdout));
      const n = v ? v.slice(1).map(Number) : null;
      if (!n) return resolve({ refusal: `could not tell what ${bin} is (${String(stdout).trim() || '(no version)'}) — a chat needs OpenCode ${OPENCODE_ASK_MIN_VERSION} or newer (1.x) or ${OPENCODE_ASK_MIN_V2} or newer (2.x)` });
      const is2 = n[0] >= 2;
      const min = (is2 ? OPENCODE_ASK_MIN_V2 : OPENCODE_ASK_MIN_VERSION).split('.').map(Number);
      const older = n[0] < min[0] || (n[0] === min[0] && (n[1] < min[1] || (n[1] === min[1] && n[2] < min[2])));
      resolve(older ? { refusal: `this ${bin} is ${v[0]}; a chat needs OpenCode ${min.join('.')} or newer (${is2 ? '2.x' : '1.x'}) — update it (npm i -g ${is2 ? '@opencode/cli@latest' : 'opencode-ai@1'})` } : {});
    });
  });
}

/** The user config an OpenCode chat reads (a change re-runs the self-test): ~/.config/opencode (or OPENCODE_CONFIG),
 *  its file-based definitions (agent(s), command(s), skills, tool(s), plugin(s)) and the 2.x terminal `cli.json`. */
export function opencodeConfigFiles(env = process.env) {
  const home = (typeof env.HOME === 'string' && env.HOME.trim()) || homedir();
  const dir = join((typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()) || join(home, '.config'), 'opencode');
  return [join(dir, 'opencode.json'), join(dir, 'opencode.jsonc'), join(dir, 'config.json'), join(dir, 'cli.json'),
    join(dir, 'AGENTS.md'), join(dir, 'CLAUDE.md'), join(dir, 'tool'), join(dir, 'tools'), join(dir, 'agent'), join(dir, 'agents'),
    join(dir, 'command'), join(dir, 'commands'), join(dir, 'skill'), join(dir, 'skills'), join(dir, 'plugin'), join(dir, 'plugins'),
    ...(typeof env.OPENCODE_CONFIG === 'string' && env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : [])];
}

/** The provider blocks of the user's opencode config — the top-level `provider` map (OpenCode 1.x) and `providers`
 *  (2.x), one map: ~/.config/opencode opencode.json / opencode.jsonc / config.json, else OPENCODE_CONFIG. Read fresh —
 *  the chat self-test already watches these files, and a key the model's provider now reads must ride the next turn.
 *  Null when none exists or none parses; a chat then signs in on env prefixes alone. */
export function opencodeProvidersConfig(env = process.env) {
  const home = (typeof env.HOME === 'string' && env.HOME.trim()) || homedir();
  const dir = join((typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()) || join(home, '.config'), 'opencode');
  const files = [join(dir, 'opencode.json'), join(dir, 'opencode.jsonc'), join(dir, 'config.json')];
  if (typeof env.OPENCODE_CONFIG === 'string' && env.OPENCODE_CONFIG.trim()) files.push(env.OPENCODE_CONFIG.trim());
  const blocks = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  for (const f of files) {
    let doc = null;
    try { doc = existsSync(f) ? parseJsonc(readFileSync(f, 'utf8')) : null; } catch { doc = null; }
    const v1 = blocks(doc && typeof doc === 'object' ? doc.provider : null);
    const v2 = blocks(doc && typeof doc === 'object' ? doc.providers : null);
    if (v1 || v2) return { ...v1, ...v2 };
  }
  return null;
}

/** The exact env var names a chat on `model`'s provider reads from the user's opencode config: every `{env:NAME}` in any
 *  string of that provider's block (apiKey, accessToken, options/env settings, …). A 2.x chat spawn runs `--standalone`,
 *  so the child resolves the provider's `{env:…}` from its OWN process env — an exact name no prefix covers (here a
 *  `aifarm-msp/…` provider reading ANTHROPIC_AUTH_TOKEN) must survive the chat scrub or the key never reaches the gateway.
 *  Only the model's own provider block is read, so no other provider's key can ride along. None when the config or the
 *  provider is missing, or it declares no env ref. */
export function opencodeProviderSignInEnv(model, env = process.env) {
  const provider = String(model || '').split('/')[0].trim();
  if (!provider) return [];
  const providers = opencodeProvidersConfig(env);
  if (!providers || typeof providers[provider] !== 'object' || !providers[provider]) return [];
  const names = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      // {env:NAME} — OpenCode expands these from the process env (the header comment above).
      const re = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
      let m = null;
      while ((m = re.exec(v))) names.add(m[1]);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(providers[provider]);
  return [...names].sort();
}

/** The chat self-test on this opencode (engines/chat-selftest.mjs): an OpenAI-compatible provider at a local endpoint.
 *  `skill` is a meta tool 2.x always offers (its permission is evaluated as a kind of its own), so it is allowed. */
export function opencodeChatSelfTest({ bin = opencodeDefaultBin(), ...o } = {}) {
  return chatSelfTest({
    engine: 'opencode', label: 'OpenCode', bin, protocol: 'openai', model: 'worcaselftest/worca-self-test',
    run: (opts) => runOpencodeProcess({ ...opts, probe: { ...opts.probe, serverAlias: (n) => `${n}selftest` } }),
    probeEnv: () => ({}), wireName: (server, tool) => `${server}selftest_${tool}`, shellTool: 'bash',
    metaTools: ['skill'], configFiles: opencodeConfigFiles(), ...o,
  });
}

/** OpenCode's chat descriptor (engines/chat-descriptor.mjs). Each `impl` is the function a test hands the turn. */
export const opencodeChat = makeChatDescriptor({
  engine: 'opencode',
  lockdown: () => OPENCODE_ASK_LOCKDOWN,
  askSupport: (o, impl = opencodeAskSupport) => impl(o),
  selfTest: (o, impl = opencodeChatSelfTest) => impl(o),
  // A chat always names its model: OpenCode's default is never in play.
  preflight: (_ctx, impl = opencodePreflight) => impl({ defaultModel: false, envScrub: true, envAllowlist: [] }),
  resumeNotFound: (err) => OPENCODE_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')),
  modelProblem: (id) => (OPENCODE_ZEN_RE.test(String(id || '')) ? "OpenCode Zen's free models refuse a request without the shell, and a chat has none" : null),
  signIn: (model, env) => ['OPENCODE_', ...providerEnvPrefixes(model), ...opencodeProviderSignInEnv(model, env)],
  listRates: providerListRates,
  threadServerAlias: true,
  prompt: { cli: "OpenCode with OpenCode's own providers" },
});
