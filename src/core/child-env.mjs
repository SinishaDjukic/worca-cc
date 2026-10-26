// src/core/child-env.mjs
// The one env builder for a child process (plans/core-protection-layer-design.md §4.1), part of the child-process
// owner: src/core/spawn.mjs `childEnv` is composeChildEnv plus the no-git PATH stub on a local child. Kept free of
// process and store imports so exec-env/policy.mjs, which every remote backend loads, builds a sandbox env with it.
import { dirname, resolve, delimiter } from 'node:path';
import { stripHostCredentials, isBackendSecret } from './host-credentials.mjs';
import { ENGINES, engineEntry } from '../shared/engine-switch.mjs';
import { withoutProxyLogin } from './env-proxy.mjs';
import { credentialNamesOf, modeCredential } from './exec-env/credentials.mjs';
import { MODEL_CREDENTIAL_ENV_KEYS, SECRET_ENV_RE } from './broker-guard.mjs';

// Grace between the abort SIGTERM and the SIGKILL escalation. Claude Code shuts
// down synchronously (fsync'd ~/.claude.json saves); a SIGKILL that lands inside
// such a write strands ~/.claude.json.tmp.<pid>.<hex> (2026-08-30: 2099 files,
// 4.4 GB, all from test runs under IO load). 5 s is generous on an idle disk
// (SIGTERM exits in ~0.5 s) and only delays a stop when the child is wedged.
export const DEFAULT_SIGKILL_GRACE_MS = 5000;
export function sigkillGraceMs() {
  const n = Number(process.env.WORCA_SIGKILL_GRACE_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SIGKILL_GRACE_MS;
}
// Grace between a step's final `result` and the kill of what it left running (superviseSpawn's leftover kill, R15). An
// engine exits within a second of its result (Claude Code saves its session first); a step still running after this
// is held up by a background child (a dev server, an async tool shell), which no turn is waiting for any more.
export const DEFAULT_LEFTOVER_GRACE_MS = 5000;
export function leftoverGraceMs() {
  const n = Number(process.env.WORCA_LEFTOVER_GRACE_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LEFTOVER_GRACE_MS;
}

// Base env every child needs to function at all; everything else is withheld unless a catalog entry, a sign-in mode,
// the project allowlist or the caller names it (exact names: an engine's own config and auth are its catalog
// entry, src/shared/engine-switch.mjs). The proxy / CA vars are CONNECTIVITY config, not secrets: without them a
// scrubbed run behind a TLS-intercepting corporate proxy fails TLS on every
// spawn (the 2.1.220 binary reads all of them). Cloud-provider creds
// (AWS_*/GOOGLE_APPLICATION_CREDENTIALS/AZURE_*) are intentionally NOT here —
// a Bedrock/Vertex/Foundry deployment allowlists them per-project (documented).
export const SPAWN_ENV_BASE = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER', 'LOGNAME', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  // Worca's corporate-proxy marker (proxy-credentials.mjs CORPORATE_PROXY_VAR; a test pins the value).
  'WORCA_CORPORATE_PROXY_URL',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // The single-bundle CA names git, curl and Python Requests read (the container entrypoint sets them).
  'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE',
];

// ── the child env (plans/core-protection-layer-design.md §4.1) ─────────────────

// The locale and terminal knobs every engine reads, exact names. No OTEL_*: worca sets none, the exporter endpoint and
// headers carry collector credentials and name the host's network, and without them no CLI exports anything.
const COMMON_NAMES = Object.freeze(['LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_COLLATE', 'LC_NUMERIC',
  'LC_TIME', 'LC_MONETARY', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI', 'COLORTERM']);
// The only WORCA_* a step reads in a sandbox: the script contract worca sets per step (graph/script-runner.mjs
// envForShell: the run context and WORCA_ENVELOPE, exact names). Its per-port and per-param vars (WORCA_IN_<PORT>, …) are
// exact names too: the script runner declares the step's own (scriptContractNames), never a prefix family. Agents read
// none there (no host guard, no broker). Every other WORCA_* is host config or a host secret (WORCA_HEARTBEAT_TOKEN, …).
const SCRIPT_CONTRACT = /^WORCA_(ENVELOPE|VERDICT|CWD|PIPELINE_DIR|PROJECT_DIR|CHECKPOINT_REF|CYCLE|RUN_ID|PLATFORM|EXEC_ENV|MOCK|BENCH)$/;
// What a local child needs to find its config and temp dirs, and what a Windows child needs to start at all.
const LOCAL_PLATFORM_NAMES = Object.freeze(['TMP', 'TEMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR', 'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'COMSPEC', 'ComSpec', 'PATHEXT', 'WINDIR', 'USERPROFILE', 'APPDATA',
  'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'Path']);
const SECRET_NAME = /_(TOKEN|SECRET|KEY)$/i;
// Never in a sandbox, not even as a declared key: GitHub vars, every registered backend's own keys (its secretEnv:
// E2B_*, WORCA_E2B_*), names that point at this machine and the broker's.
const NEVER_REMOTE = /^(GH_|GITHUB_)/;
const HOST_ONLY = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'OLDPWD', 'PORT',
  'CLAUDE_CONFIG_DIR', 'WORCA_HOST_PID', 'WORCA_HOME', 'WORCA_RUN_ROOT', 'WORCA_PROJECTS_ROOT']);
const BROKER_NAME = /^WORCA_BROKER/;

// ── plugin children (spec §7.2): PATH, HOME, the proxy and CA names, the Windows start-up baseline; nothing else ──
/** Non-secret Windows system vars a child needs to run at all (spec §7.2 note). */
export const WIN32_ENV_BASELINE = Object.freeze([
  'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
]);
const PROXY_URL_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
const NO_PROXY_NAMES = ['NO_PROXY', 'no_proxy'];
/** The CA names SPAWN_ENV_BASE passes too: node reads the first, the tools a connector may run (gh, curl, git) the
 *  other two. */
const CA_NAMES = ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE'];
/** URL credentials always need an '@' (user:password@, token@, the scheme-less user:password@host form) and a host
 *  never has one, so any '@' counts, even in a value that is not a valid URL. */
export function proxyHasCredentials(env = process.env) {
  return PROXY_URL_NAMES.some((k) => String(env[k] || '').includes('@'));
}
/** The names a plugin child gets. The proxy and CA variables are connectivity config (a proxy-only network, a proxy that
 *  re-signs TLS), but a proxy URL with credentials is a secret: then NO proxy URL passes (one alone would half-route the
 *  child), only NO_PROXY and the CA paths. */
function pluginNames(base, platform) {
  const proxy = proxyHasCredentials(base) ? NO_PROXY_NAMES : [...PROXY_URL_NAMES, ...NO_PROXY_NAMES];
  return new Set(['PATH', 'HOME', ...proxy, ...CA_NAMES, ...(platform === 'win32' ? WIN32_ENV_BASELINE : [])]);
}

// git's location variables beat its cwd: a worca started from a git hook (GIT_DIR set) would otherwise run every git
// call against the hook's repository.
const GIT_LOCATION_NAMES = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX']);

/** Each kind's starting point: 'allowlist' (exact names), 'inherit' (worca's whole env, then the common strips: the
 *  person's own terminal, and git, which reads the user's config, signing and ssh agent), or 'plugin' (spec §7.2). A
 *  script inherits only when the run's envScrub is off (`inherit: true`). */
const KIND_BASE = Object.freeze({ engine: 'allowlist', preflight: 'allowlist', script: 'allowlist', terminal: 'inherit', git: 'inherit', plugin: 'plugin' });
const MAY_INHERIT = new Set(['script']);

// The inherit kinds run code worca did not write, with worca's env: a repository's commit hook on the end-of-run commit
// or Apply to branch, the project's own scripts an action starts, whatever the person types into an agent-written
// worktree (audit 3.4). What they need is the person's machine (PATH, HOME, the locale, the proxy, git's and ssh's own
// names: SSH_AUTH_SOCK, GIT_ASKPASS, GNUPGHOME, …), never worca's config or a secret: so no WORCA_* name but the proxy
// marker, no secret-shaped name (*_TOKEN, *_KEY, *_SECRET, *_PASSWORD, *_CREDENTIALS, and with a suffix:
// AWS_ACCESS_KEY_ID), no model credential and no engine's credential. A name the overlay sets, or the caller `keep`s
// (the person's own pane keeps the backend keys), still comes through.
const INHERIT_WORCA_KEEP = new Set(['WORCA_CORPORATE_PROXY_URL']);
let engineCredentialSet = null;
const anyEngineCredential = (k) => (engineCredentialSet ??= new Set([...MODEL_CREDENTIAL_ENV_KEYS,
  ...Object.keys(ENGINES).flatMap((e) => credentialNames(e))])).has(k);
/** Whether an inherit kind withholds `k` from worca's env (Windows names are case-insensitive: compared upper-cased). */
export function inheritWithheld(k) {
  const u = k.toUpperCase();
  return (u.startsWith('WORCA_') && !INHERIT_WORCA_KEEP.has(u)) || SECRET_ENV_RE.test(k) || anyEngineCredential(u);
}

const names = (list) => (Array.isArray(list) ? list : []);
/** Every credential name an engine declares (credentials.mjs credentialNamesOf: the one secret-named name of each
 *  non-own mode, and its secret-named relay-owned names — COPILOT_PROVIDER_API_KEY, CURSOR_AUTH_TOKEN). */
const credentialNames = (engine) => credentialNamesOf(engine);
/** The names the sign-in mode `id` needs (null: every mode's, the default until the route resolver names one; a mode
 *  the engine does not declare, such as 'relayed': none). */
function signInNames(entry, id) {
  if (id == null) return entry.signIn.modes.flatMap((m) => m.env);
  return entry.signIn.modes.find((m) => m.id === id)?.env ?? [];
}
/** Any catalog entry's relay-owned names: where model calls go and how they are signed. None enters a sandbox. */
let relayOwnedSet = null;
const relayOwnedAny = (k) => (relayOwnedSet ??= new Set(Object.keys(ENGINES).flatMap((e) => engineEntry(e)?.env.relayOwned ?? []))).has(k);

/** `dirname(root)` as the git ceiling, merged with an existing value. */
function ceilingFor(root, existing) {
  const own = dirname(resolve(root));
  const rest = typeof existing === 'string' && existing ? existing.split(delimiter).filter((x) => x && x !== own) : [];
  return [own, ...rest].join(delimiter);
}

/**
 * The one env builder for a child, local or in a sandbox (`remote`). `kind` is 'engine' or 'preflight' (an engine and its
 * run-start check), 'script' (a graph script), 'terminal' (a run's terminal and its actions), 'git' (a git worca runs
 * for itself) or 'plugin' (a plugin connector or channel worker); KIND_BASE says where each starts.
 *
 * Local: an allowlist of exact names (never a prefix family, always on: envScrub no longer gates it) — SPAWN_ENV_BASE,
 * the engine's catalog `env.names` and the endpoint names it reads (`env.relayOwned` minus its credentials), the names
 * of the sign-in mode `signInMode` (null: every mode's), the run's `allowlist` (envAllowlist) and `declared` keys.
 * Then, in the order the spawn env always took: the run env (`runEnv`, cleanRunEnv) and the adapter's `overlay` (the model env) over
 * it, WORCA_HOST_PID (`hostPid`), no GitHub / Azure DevOps / backend credential in any tier, never the broker's own
 * secret (spawn.mjs childEnv adds the no-git PATH stub).
 *
 * Remote: what may enter a sandbox — the common locale names, the engine's `env.names` (never a secret-named one), the
 * script contract and the `declared` keys; never a host path or this engine's `hostOnly` name, a backend or GitHub var,
 * the broker's, nor ANY engine's relay-owned name (the relay signs: the spawn gets its URL and a dummy credential).
 *
 * We deliberately do NOT set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. On CLI 2.1.220 (live-verified 2026-08-01) a truthy
 * value forces the permission mode to "default", overriding `--permission-mode acceptEdits` (and, per static
 * analysis, forces a strict sandbox). Do not reinstate it without re-verifying against the installed CLI.
 *
 * Inherit (terminal, git, a script with `inherit`): worca's env minus the caller's `strip` names (and, for git, git's
 * location variables); the terminal and git never get worca's own config or a secret-shaped name (inheritWithheld). Plugin: PATH, HOME, the proxy and CA names, and the Windows baseline on `platform` 'win32'.
 * Every local kind then loses the host credentials and the broker's secret; `keep` names come back from `base` after
 * that strip, and `strip` names stay out even when the overlay set them.
 *
 * Both set PWD to `cwd`, and with `root` (the run's work root: the worktree, or work/ of a run without a project) set
 * GIT_CEILING_DIRECTORIES to dirname(root), merged with any value the env already has.
 * @returns {{env: Record<string,string>, dropped: string[]}} `dropped`: the names withheld, sorted (the run log
 *   names them once, formatDropped)
 */
export function composeChildEnv({ kind = 'engine', engine = null, signInMode = null, cwd = null, root = null, runEnv = null, overlay = null,
  declared = [], allowlist = [], remote = false, hostPid = null, base = process.env, inherit = false, strip = [], keep = [],
  platform = process.platform } = {}) {
  const entry = engine ? engineEntry(engine) : null;
  if (engine && !entry) throw new Error(`unknown engine "${engine}"`);
  if (!Object.hasOwn(KIND_BASE, kind)) throw new Error(`childEnv: unknown kind "${kind}"`);
  if (inherit && !MAY_INHERIT.has(kind)) throw new Error(`childEnv: a ${kind} child cannot inherit worca's env`);
  const start = inherit ? 'inherit' : KIND_BASE[kind];
  const declaredSet = new Set([...names(declared), ...Object.keys(runEnv || {}), ...Object.keys(overlay || {})]);
  const pass = new Set();
  let allowed;
  if (remote && start !== 'allowlist') throw new Error(`childEnv: a ${kind} child has no sandbox env`);
  if (start === 'inherit') {
    const out = new Set(kind === 'git' ? GIT_LOCATION_NAMES : []);
    // A script inherits only when the run turned envScrub off: then it gets worca's env as it asked.
    const own = KIND_BASE[kind] === 'inherit';
    allowed = (k) => !out.has(k) && !(own && inheritWithheld(k));
  } else if (start === 'plugin') {
    const list = pluginNames(base || {}, platform);
    allowed = (k) => list.has(k);
  } else if (remote) {
    const own = new Set(entry ? entry.env.names : []);
    const hostOnly = new Set(entry ? entry.env.hostOnly : []);
    const blocked = (k) => HOST_ONLY.has(k) || hostOnly.has(k) || BROKER_NAME.test(k) || NEVER_REMOTE.test(k) || isBackendSecret(k) || relayOwnedAny(k);
    allowed = (k) => !blocked(k) && (declaredSet.has(k) || SCRIPT_CONTRACT.test(k) || ((COMMON_NAMES.includes(k) || own.has(k)) && !SECRET_NAME.test(k)));
  } else {
    for (const k of SPAWN_ENV_BASE) pass.add(k);
    for (const k of COMMON_NAMES) pass.add(k);
    for (const k of LOCAL_PLATFORM_NAMES) pass.add(k);
    if (entry) {
      const creds = new Set(credentialNames(engine));
      for (const k of entry.env.names) pass.add(k);
      // Its session and config dirs (CLAUDE_CONFIG_DIR, CODEX_HOME, COPILOT_HOME, CURSOR_CONFIG_DIR): kept in every
      // sign-in mode, or a key mode would move resume, rollouts and archives to ~ (they are not credentials).
      for (const k of entry.env.hostOnly) pass.add(k);
      for (const k of entry.env.relayOwned) if (!creds.has(k)) pass.add(k);
      for (const k of signInNames(entry, signInMode)) pass.add(k);
    }
    for (const k of names(allowlist)) pass.add(k);
    allowed = (k) => pass.has(k) || declaredSet.has(k);
  }
  let env = {};
  const dropped = [];
  for (const [k, v] of Object.entries(base || {})) {
    if (typeof v !== 'string') continue;
    if (allowed(k)) env[k] = v; else dropped.push(k);
  }
  if (runEnv) Object.assign(env, runEnv);
  if (overlay) Object.assign(env, overlay);
  // A named sign-in mode (the route resolver's decision): the child holds exactly one credential of this engine — the
  // mode's own — whichever tier carried the others (worca's env, the project allowlist, the run env); the overlay (a
  // broker token, a model entry's own key) is the only exception. An undeclared mode (relayed, brokered, model,
  // endpoint) keeps none; `brokered` keeps no model credential of any engine or provider either (D10, what claude.mjs
  // did for Claude: the spawn's broker token is the only one it holds). A name removed here, whatever tier carried it,
  // is reported in `dropped`.
  if (entry && !remote && signInMode != null) {
    const mode = entry.signIn.modes.find((m) => m.id === signInMode) || null;
    const own = mode ? modeCredential(mode) : null;
    const credStrip = new Set(credentialNames(engine));
    if (signInMode === 'brokered') {
      for (const e of Object.keys(ENGINES)) for (const k of credentialNames(e)) credStrip.add(k);
      for (const k of MODEL_CREDENTIAL_ENV_KEYS) credStrip.add(k);
    }
    for (const k of credStrip) {
      if (k === own || (overlay && Object.hasOwn(overlay, k)) || !(k in env)) continue;
      if (!dropped.includes(k)) dropped.push(k);
      delete env[k];
    }
  }
  if (hostPid != null && !remote) env.WORCA_HOST_PID = String(hostPid);
  // No proxy URL that carries a login (env-proxy.mjs withoutProxyLogin): the corporate proxy is off then, so the
  // child goes direct rather than get the password.
  env = stripHostCredentials(withoutProxyLogin(env));
  delete env.WORCA_BROKER_SECRET;
  delete env.WORCA_BROKER_SECRET_FILE;
  for (const k of names(strip)) delete env[k];
  // Names the caller re-admits after the credential strip, from worca's env (the person's own terminal keeps the
  // backend keys: they type `worca run --exec-env e2b` there).
  for (const k of names(keep)) if (typeof base?.[k] === 'string') env[k] = base[k];
  if (remote) { for (const k of Object.keys(env)) if (!allowed(k)) delete env[k]; }
  if (typeof cwd === 'string' && cwd && !remote) env.PWD = cwd;
  if (typeof root === 'string' && root && !remote) env.GIT_CEILING_DIRECTORIES = ceilingFor(root, env.GIT_CEILING_DIRECTORIES);
  return { env, dropped: dropped.filter((k) => !(k in env)).sort() };
}

/** The run-log line for the variables childEnv withheld from `engine`'s child, by name only (never a value), or null. */
export function formatDropped(engine, dropped) {
  const list = [...new Set(names(dropped))];
  if (!list.length) return null;
  return `env: ${list.length} variable${list.length === 1 ? '' : 's'} not passed to ${engine} (allowlist): ${list.join(', ')}`;
}

