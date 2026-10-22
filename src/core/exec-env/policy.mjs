// src/core/exec-env/policy.mjs
// Backend-neutral sandbox policy (plans/e2b-execution-design.md §11): what env and MCP config may
// enter ANY remote sandbox, each engine's sign-in, the run-level timeouts and the instance tag.
// Moved from e2b-config.mjs, which re-exports every name.
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpSecretFindings } from '../mcp-secrets.mjs';
import { REMOTE_ENGINES, remoteEnginesText, remoteEngineRefusal } from '../../shared/exec-env.mjs';
import { ENGINES } from '../../shared/engine-switch.mjs';
import { composeChildEnv } from '../child-env.mjs';

export const SANDBOX_TIMEOUT_MS = 30 * 60_000;       // refreshed by the heartbeat while a run is live
export const HEARTBEAT_MS = 5 * 60_000;
export const AGENT_COMMAND_TIMEOUT_MS = 24 * 3600_000; // commands.run defaults to 60 s; never let it cut an agent
export const SHELL_COMMAND_TIMEOUT_MS = 10 * 60_000;   // worca's own git/tar/snapshot commands

export function redactKey(key) {
  const s = String(key || '');
  return s.length <= 8 ? '…' : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** The model credential the sandbox signs Claude Code in with — only from the server's env
 *  (clarify: model-credential-source). OAuth wins (the user's chosen method). */
export function modelCredential(env = process.env) {
  if (typeof env.CLAUDE_CODE_OAUTH_TOKEN === 'string' && env.CLAUDE_CODE_OAUTH_TOKEN.trim()) return { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN };
  if (typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim()) return { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  return null;
}

/** The keys that sign Claude Code in. */
export const MODEL_CREDENTIAL_KEYS = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']);
/** Where a Claude model call goes and how it is signed: worca's model relay owns them (plans/model-relay-design.md §4).
 *  None enters a sandbox, not even as a declared key; a spawn gets the relay's URL and route id instead. */
export const RELAY_OWNED_KEYS = ENGINES.claude.env.relayOwned;
/** How worca's model relay signs each sandbox engine's calls: the upstream it reaches, the server env vars it signs
 *  with in order, and the problem when none is set (engineCredential, relay-route.mjs engineModelRoute read it: no
 *  engine-name branch). `pat`: only a fine-grained token signs its calls; `needsModel`: the engine has no default
 *  model of its own behind the relay (copilot's offline mode). */
const ENGINE_RELAY = Object.freeze({
  claude: Object.freeze({ upstream: 'anthropic', order: Object.freeze(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']),
    problem: "Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set in the worca server's environment; it stays on the server and signs the sandbox's model calls." }),
  // A ChatGPT sign-in (codex login, ~/.codex/auth.json) holds a refresh token and calls ChatGPT's own hosts: worca
  // neither copies it into a sandbox nor relays it.
  codex: Object.freeze({ upstream: 'openai', order: Object.freeze(['CODEX_API_KEY', 'OPENAI_API_KEY']),
    problem: "Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY in the worca server's environment: worca signs its calls on the server. A ChatGPT sign-in (codex login) cannot be used in a sandbox." }),
  copilot: Object.freeze({ upstream: 'copilot', order: Object.freeze(['COPILOT_GITHUB_TOKEN']), pat: true, needsModel: true,
    problem: "COPILOT_GITHUB_TOKEN is not set in the worca server's environment; worca signs a sandbox's Copilot calls with it on the server (copilot login stays in this machine's keychain). Use a fine-grained personal access token (github_pat_…) with only the Copilot Requests permission." }),
  cursor: Object.freeze({ upstream: 'cursor', order: Object.freeze(['CURSOR_API_KEY']),
    problem: "CURSOR_API_KEY is not set in the worca server's environment; worca signs a sandbox's Cursor calls with it on the server (cursor-agent login stays in this machine's keychain)." }),
});
/** Per engine (REMOTE_ENGINES), built from its catalog `env` (src/shared/engine-switch.mjs), exact names only:
 *  `allow(k)` its own non-secret config vars; `relayOwned(k)` the vars that say where its model calls go and how they
 *  are signed, which the model relay owns (none enters a sandbox, not even as a declared key, for any engine);
 *  `hostOnly` vars naming a path on this machine (the sandbox sets its own); `home` the engine's own dir in the
 *  sandbox HOME, where worca puts its rules and config (RemoteExecEnv.engineHome); `relay` its ENGINE_RELAY row. */
export const ENGINE_SANDBOX = Object.freeze(Object.fromEntries(REMOTE_ENGINES.map((e) => {
  const { names, relayOwned, hostOnly, home } = ENGINES[e].env;
  return [e, Object.freeze({ allow: (k) => names.includes(k), relayOwned: (k) => relayOwned.includes(k), hostOnly, home, relay: ENGINE_RELAY[e] ?? null })];
})));

/** The sandbox rules of `engine` (default claude); throws for an engine no sandbox runs. */
export function engineSandbox(engine) {
  const name = engine || 'claude';
  if (!Object.hasOwn(ENGINE_SANDBOX, name)) throw new Error(`the ${name} engine cannot run in a remote sandbox (it runs the ${remoteEnginesText()} engines only)`);
  return ENGINE_SANDBOX[name];
}

/** The env a sandbox command of `engine` gets (child-env.mjs composeChildEnv, remote): the common and the engine's own
 *  names (no secret-named var), the script contract and `keep` (the run's own declared keys: model env, kept MCP
 *  secrets, script secrets); never host paths, a backend or a GitHub var, nor any engine's relay-owned key (credential,
 *  endpoint), then the credential strip. */
export function sandboxEnv(env, { keep = [], engine = 'claude' } = {}) {
  engineSandbox(engine);
  return composeChildEnv({ engine: engine || 'claude', remote: true, declared: keep, base: env || {} }).env;
}

/** A fine-grained personal access token: the only GitHub token worca relays Copilot's calls with (clarify:
 *  copilot-github-token). It never enters a sandbox. */
export const FINE_GRAINED_PAT_RE = /^github_pat_[A-Za-z0-9_]{20,}$/;
const filled = (v) => typeof v === 'string' && !!v.trim();
const tokenKind = (t) => (/^ghp_/.test(t) ? 'a classic token (ghp_)' : /^gho_/.test(t) ? 'an OAuth token (gho_)'
  : /^gh[usr]_/.test(t) ? `a ${t.slice(0, 4)} token` : 'not a fine-grained token');

/**
 * The credential worca's model relay signs `engine`'s calls with, from the SERVER's env only (never a spawn's inherited
 * env, never a file): `{ value, source }` (source: the env var it came from), or `{ problem }`, a message that never
 * contains a credential value. The value stays in worca: the sandbox gets the relay URL and a dummy. Sync (the server's
 * 409 path calls it through e2bPreflight).
 */
export function engineCredential(engine, env = process.env) {
  const r = Object.hasOwn(ENGINE_SANDBOX, engine || 'claude') ? ENGINE_SANDBOX[engine || 'claude'].relay : null;
  if (!r) return { problem: `the ${engine} engine cannot run in a remote sandbox` };
  const source = r.order.find((k) => filled(env[k]));
  if (!source) return { problem: r.problem };
  const value = env[source].trim();
  if (r.pat && !FINE_GRAINED_PAT_RE.test(value)) return { problem: `${source} is ${tokenKind(value)}: worca signs a sandbox's Copilot calls only with a fine-grained personal access token (github_pat_…), never a classic or OAuth token, which reaches every repository your account can. Create a fine-grained token with only the Copilot Requests permission.` };
  return { value, source };
}

const LOOPBACK = /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal)$/i;
export const isLoopbackHost = (h) => LOOPBACK.test(String(h || ''));
/** True when `url` parses and its host is loopback. */
export const isLoopbackUrl = (url) => { try { return isLoopbackHost(new URL(String(url)).hostname); } catch { return false; } };
const GITHUB_TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/;
const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;   // the registry writes `${NAME}` (mcp/registry.mjs:92)

/** The --mcp-config a sandbox gets: remote url servers only (stdio commands and loopback
 *  urls point at the host), and none with a literal secret (a GitHub token, or any value the
 *  WORCA_MCP_SECRETS screen finds: the sandbox can read the config). `envRefs` are the env vars
 *  the KEPT servers interpolate — the only MCP secrets the sandbox gets; `exposed` names them
 *  per server, for the run log. */
export function sandboxMcpConfig(config) {
  const servers = config?.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  const kept = {}; const dropped = [];
  for (const [name, s] of Object.entries(servers)) {
    if (typeof s?.url !== 'string') { dropped.push({ name, reason: 'runs a command on the worca host' }); continue; }
    let host; try { host = new URL(s.url).hostname; } catch { dropped.push({ name, reason: 'has an invalid url' }); continue; }
    if (isLoopbackHost(host)) { dropped.push({ name, reason: `points at ${host}, which inside the sandbox is the sandbox itself` }); continue; }
    if (GITHUB_TOKEN_RE.test(JSON.stringify(s))) { dropped.push({ name, reason: 'carries a GitHub token' }); continue; }
    const found = mcpSecretFindings(s);
    if (found.length) { dropped.push({ name, reason: `carries a secret (${found.join(', ')})` }); continue; }
    kept[name] = s;
  }
  const refsOf = (v) => [...new Set([...JSON.stringify(v).matchAll(ENV_REF_RE)].map((m) => m[1]))].sort();
  const exposed = Object.entries(kept).map(([name, s]) => ({ name, envRefs: refsOf(s) })).filter((e) => e.envRefs.length);
  return { config: { ...(config || {}), mcpServers: kept }, dropped, envRefs: refsOf(kept), exposed };
}

/** Tags this worca instance's sandboxes so a sweep never kills another instance's. Stored in `<worca home>/instance-id`
 *  so it survives a hostname change (a container restart); the first call seeds it with the value worca used before
 *  (a hash of the home path and the hostname), so sandboxes already running keep matching. Unwritable home: that hash. */
export function instanceTag(worcaHomeDir) {
  const file = join(worcaHomeDir, INSTANCE_ID_FILE);
  try { const id = readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{12}$/.test(id)) return id; } catch { /* first use */ }
  let home = worcaHomeDir; try { home = realpathSync(worcaHomeDir); } catch { /* not created yet */ }
  const id = createHash('sha1').update(`${home}\0${hostname()}`).digest('hex').slice(0, 12);
  try {
    mkdirSync(worcaHomeDir, { recursive: true });
    writeFileSync(file, `${id}\n`, { flag: 'wx' });
  } catch (err) {
    if (err?.code === 'EEXIST') { try { const won = readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{12}$/.test(won)) return won; } catch { /* keep ours */ } }
  }
  return id;
}
export const INSTANCE_ID_FILE = 'instance-id';

/** Run-start checks every remote backend needs (the generic layer mirrors ONE worktree, runs the catalog's sandbox
 *  engines only (REMOTE_ENGINES), and mirrors POSIX paths from the detached run root). `title` words them ('E2B' → today's text). Sync. */
export function remotePreflight({ title, engine, isWorkspace, workMode = 'git', runRootMode = 'detached', platform = process.platform }) {
  const errors = [];
  // The code goes in as a git bundle of the run's branch: a Folder project (no git) and a run without a project have none.
  if (workMode === 'folder') errors.push(`${title} execution needs a git project; this is a Folder project. Pick Local.`);
  if (workMode === 'none') errors.push(`${title} execution needs a project; this run has none. Pick Local.`);
  const engineRefusal = engine ? remoteEngineRefusal(title, engine) : null;
  if (engineRefusal) errors.push(engineRefusal);
  if (isWorkspace) errors.push(`${title} execution runs single-project runs only; this is a workspace run. Pick Local for workspace runs.`);
  // Legacy puts the worktree inside the user's real checkout (worktree.mjs:30), with no run root, run-root
  // CLAUDE.md or mcp.json: none of the mirroring was designed or tested for it. It is the §10 rollback.
  if (runRootMode === 'legacy') errors.push(`${title} execution needs the detached run-root mode, but WORCA_RUN_ROOT (or the runRootMode setting) is "legacy". Unset it, or pick Local.`);
  if (platform === 'win32') errors.push(`${title} execution needs a macOS or Linux worca host (it mirrors POSIX paths into the sandbox).`);
  return errors;
}
/** Why a SAVED (not explicit) remote default does not apply to a run, for every backend; null when it does.
 *  The New run dialog applies the same rule (src/shared/exec-env.mjs). */
export { remoteRefusesDefault } from '../../shared/exec-env.mjs';
