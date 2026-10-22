// src/core/exec-env/policy.mjs
// Backend-neutral sandbox policy (plans/e2b-execution-design.md §11): what env and MCP config may
// enter ANY remote sandbox, the model credential, the run-level timeouts and the instance tag.
// Moved from e2b-config.mjs, which re-exports every name.
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripHostCredentials, isBackendSecret } from '../host-credentials.mjs';
import { mcpSecretFindings } from '../mcp-secrets.mjs';
import { remoteEngineRefusal } from '../../shared/exec-env.mjs';

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
/** Where a model call goes and how it is signed: worca's model relay owns them (plans/model-relay-design.md §4).
 *  None enters a sandbox, not even as a declared key; a spawn gets the relay's URL and route id instead. */
export const RELAY_OWNED_KEYS = Object.freeze([...MODEL_CREDENTIAL_KEYS, 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']);
// Claude Code's own configuration and the locale. No OTEL_*: worca sets none, the exporter endpoint
// and headers carry collector credentials and name the host's network, and without them Claude Code exports nothing.
const ALLOW = /^(ANTHROPIC_|CLAUDE_|MCP_|DISABLE_)|^LC_|^(LANG|LANGUAGE|TZ|NO_COLOR|FORCE_COLOR|CI|API_TIMEOUT_MS|API_FORCE_IDLE_TIMEOUT)$/;
// The only WORCA_* a step reads in the sandbox: the script contract worca sets per step (graph/script-runner.mjs
// envForShell: one var per input, output and param, the run context, WORCA_ENVELOPE). Agents read none there (no
// host guard, no broker). Every other WORCA_* is host config or a host secret (WORCA_HEARTBEAT_TOKEN, WORCA_MCP_SECRETS, …).
const SCRIPT_CONTRACT = /^WORCA_((IN|OUT|PARAM)_[A-Z0-9_]+|ENVELOPE|VERDICT|CWD|PIPELINE_DIR|PROJECT_DIR|CHECKPOINT_REF|CYCLE|RUN_ID|PLATFORM|EXEC_ENV|MOCK|BENCH)$/;
const SECRET_NAME = /_(TOKEN|SECRET|KEY)$/i;
// Not even as a declared key: GitHub vars, and every registered backend's own keys (its secretEnv: E2B_*, WORCA_E2B_*).
const NEVER = /^(GH_|GITHUB_)/;
const never = (k) => NEVER.test(k) || isBackendSecret(k);
const HOST_ONLY = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'OLDPWD', 'PORT',
  'CLAUDE_CONFIG_DIR', 'WORCA_HOST_PID', 'WORCA_HOME', 'WORCA_RUN_ROOT', 'WORCA_PROJECTS_ROOT']);
const HOST_ONLY_RE = /^WORCA_BROKER/;

/** The env a sandbox command gets: the allowlist (no secret-named var), the script contract and `keep` (the run's
 *  own declared keys: model env, kept MCP secrets, script secrets); never host paths, a backend or a GitHub var, nor
 *  the model credential, base URL or custom headers (RELAY_OWNED_KEYS), then the credential strip composeSpawnEnv applies. */
export function sandboxEnv(env, { keep = [] } = {}) {
  const keepSet = new Set(keep);
  const allowed = (k) => keepSet.has(k) || SCRIPT_CONTRACT.test(k) || (ALLOW.test(k) && !SECRET_NAME.test(k));
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v !== 'string' || HOST_ONLY.has(k) || HOST_ONLY_RE.test(k) || never(k) || RELAY_OWNED_KEYS.includes(k)) continue;
    if (allowed(k)) out[k] = v;
  }
  return stripHostCredentials(out);
}

const LOOPBACK = /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal)$/i;
export const isLoopbackHost = (h) => LOOPBACK.test(String(h || ''));
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
