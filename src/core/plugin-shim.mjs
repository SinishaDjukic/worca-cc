// src/core/plugin-shim.mjs
// Ephemeral child-process shim for task-source connector operations (spec §7.2).
// One spawn per op: the child (plugin-shim-child.mjs) imports the connector
// through <plugin>/current/, runs ONE op, writes ONE JSON frame to stdout, exits.
//   stdin  : { apiVersion, module, op, config, state, args }
//   stdout : { ok:true, result, stateDelta, logs }
//          | { ok:false, error:{ kind, message }, logs }
// Config+secrets+state travel via STDIN — never argv (visible in `ps`), never env
// (inherited by grandchildren). The child env is scrubbed to {PATH, HOME} only, so
// plugin X can never read plugin Y's secrets or the host environment. stateDelta
// is applied HOST-side via writePluginState (the child has no WORCA_HOME and
// never touches the store). WORCA_MOCK=1 short-circuits the spawn with canned
// per-op responses so smoke/tests run offline with zero plugins installed.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFlag } from './model-env.mjs';
import { WORCA_PLUGIN_API } from './plugin-api.mjs';
import { normalizeManifest, negotiatedApi } from './plugin-manifest.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs';
import { readPluginConfig, readPluginState, writePluginState, listProfileIds, DEFAULT_PROFILE } from './plugin-config.mjs';

const CHILD_PATH = fileURLToPath(new URL('./plugin-shim-child.mjs', import.meta.url));

/** Error kinds an op can surface (spec §11) plus the host-synthesized
 *  'unimplemented' (the connector lacks the op — distinct from an implemented
 *  op that CRASHED, because callers like the capabilities probe must default
 *  differently for the two); anything else normalizes to 'plugin'. */
const KINDS = new Set(['auth', 'rate-limit', 'network', 'plugin', 'timeout', 'protocol', 'unimplemented']);

export class PluginOpError extends Error {
  /**
   * @param {'auth'|'rate-limit'|'network'|'plugin'|'timeout'|'protocol'|'unimplemented'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.name = 'PluginOpError';
    this.kind = KINDS.has(kind) ? kind : 'plugin';
  }
}

// ── WORCA_MOCK=1: canned responses, never spawns ─────────────────────────────

let _mockResponses = null; // op -> value | (args) => value; null = defaults only

/** Tests: override/extend the canned per-op responses. Pass null to reset. */
export function setMockSourceResponses(map) {
  _mockResponses = map && typeof map === 'object' ? map : null;
}

const MOCK_TASKS = [
  { id: 'MOCK-1', title: 'Fix the login redirect', url: 'https://mock.test/MOCK-1', state: 'open', labels: ['bug'], updatedAt: '2026-07-12T00:00:00.000Z' },
  { id: 'MOCK-2', title: 'Add CSV export to reports', url: 'https://mock.test/MOCK-2', state: 'open', labels: ['feature'], updatedAt: '2026-07-12T00:00:00.000Z' },
];
const MOCK_DEFAULTS = {
  listTasks: () => ({ tasks: MOCK_TASKS.map((t) => ({ ...t })) }),
  getTask: (args) => ({
    ...MOCK_TASKS[0],
    id: args?.id || MOCK_TASKS[0].id,
    body: 'Mock task body.\n\n1. reproduce\n2. fix\n3. verify',
    meta: { mock: true },
  }),
  reportResult: () => ({ ok: true }),
  validateConfig: () => ({ ok: true }),
};

/** Same env-flag semantics as claude-runner.mjs#mockEnabled — one shared rule. */
function mockMode() {
  return envFlag('WORCA_MOCK', 'ORCH_MOCK');
}

async function mockCall(op, args) {
  const entry = _mockResponses && op in _mockResponses ? _mockResponses[op] : MOCK_DEFAULTS[op];
  if (entry === undefined) {
    // Mirror the real child's answer for an unimplemented op — Task 13's
    // capabilities tolerant-default keys on exactly this kind.
    throw new PluginOpError('unimplemented', `mock: no canned response for op "${op}"`);
  }
  try {
    return await (typeof entry === 'function' ? entry(args) : entry);
  } catch (err) {
    if (err instanceof PluginOpError) throw err;
    throw new PluginOpError(err?.kind || 'plugin', err?.message || String(err));
  }
}

// ── real path ──────────────────────────────────────────────────────────────────

/** Resolve lock entry + manifest task-source, mapping every failure to kind 'plugin'. */
function loadSource(plugin, sourceId) {
  const lock = readPluginsLock();
  const entry = lock[plugin];
  if (!entry) throw new PluginOpError('plugin', `plugin "${plugin}" is not installed`);
  if (entry.enabled === false) throw new PluginOpError('plugin', `plugin "${plugin}" is disabled — enable it in the Plugins view`);
  const dir = pluginCurrentDir(plugin);
  let manifest;
  try {
    const norm = normalizeManifest(JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8')), { dir });
    if (!norm.ok) throw new Error(norm.errors.join('; '));
    manifest = norm.manifest;
  } catch (err) {
    throw new PluginOpError('plugin', `plugin "${plugin}": cannot read manifest — ${err.message}`);
  }
  const source = (manifest.taskSources || []).find((s) => s.id === sourceId);
  if (!source) throw new PluginOpError('plugin', `plugin "${plugin}" has no task source "${sourceId}"`);
  // Highest host API the manifest's range allows: an API-1 connector keeps
  // receiving apiVersion 1 after a host API bump (design §4.3).
  const apiVersion = negotiatedApi(manifest.engines?.worcaApi) ?? WORCA_PLUGIN_API;
  return { dir, source, apiVersion };
}

/** Child env: PATH + HOME ONLY (spec §7.2). Notably NOT WORCA_*, tokens, npm_*.
 *  Exported for the channel-worker supervisor (chat/channel-host.mjs), which
 *  spawns persistent children under the same rule. */
export function scrubbedEnv(platform = process.platform) {
  const env = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;
  // Windows has no HOME and a child cannot even start without SYSTEMROOT (Node
  // docs); the rest are the non-secret system vars node/npm need to resolve
  // temp dirs, the shell, and the .cmd/.exe lookup. Still no WORCA_*, tokens
  // or npm_* — the §7.2 rule is unchanged, only the platform baseline differs.
  if (platform === 'win32') {
    for (const k of WIN32_ENV_BASELINE) if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

/** Non-secret Windows system vars a child needs to run at all (spec §7.2 note). */
export const WIN32_ENV_BASELINE = Object.freeze([
  'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
]);

/** The profile invariant, enforced in the shim itself so EVERY caller — the
 *  CLI's `worca plugin exec`, future workers — is safe by construction, not
 *  just the HTTP routes. Presence alone is not enough: a typo'd or deleted
 *  profile passes a presence check, silently runs against an EMPTY bucket
 *  (false "not configured" verdicts) and then persists state into a phantom
 *  bucket the DELETE route can never purge — so membership in the roster is
 *  checked here too. `allowLegacyDefault` is the ONE host-internal exception:
 *  write-back for a pipeline row that predates profiles targets the
 *  DEFAULT_PROFILE bucket, because that is where the pre-upgrade flat config
 *  migrated — i.e. the instance the task actually came from (sources.mjs). */
function assertProfileInvariant({ plugin, sourceId, source, profile, allowLegacyDefault }) {
  if (source.multiProfile === true) {
    if (!profile) {
      throw new PluginOpError('plugin',
        `task source "${plugin}/${sourceId}" has per-profile configuration — pass a profile (e.g. --profile <id>)`);
    }
    if (profile === DEFAULT_PROFILE) {
      if (!allowLegacyDefault) {
        throw new PluginOpError('plugin',
          `"${DEFAULT_PROFILE}" is the reserved shared bucket, not a profile of "${plugin}/${sourceId}" — pass a profile from the roster`);
      }
    } else if (!listProfileIds(plugin).includes(profile)) {
      throw new PluginOpError('plugin',
        `plugin "${plugin}" has no profile "${profile}" — create it in Plugins settings (or POST /api/plugins/${plugin}/profiles) first`);
    }
  } else if (profile && profile !== DEFAULT_PROFILE) {
    throw new PluginOpError('plugin', `task source "${plugin}/${sourceId}" does not use profiles`);
  }
}

/**
 * Run ONE connector op in an ephemeral child. Resolves with the op result;
 * rejects with PluginOpError. `logger(level, msg)` is optional — connector
 * ctx.log lines route there (default: console.error, since stdout is the UI's).
 * `allowLegacyDefault` (host-internal, never surfaced to CLI/routes) lets the
 * legacy write-back path name DEFAULT_PROFILE on a multiProfile source — see
 * assertProfileInvariant.
 * @returns {Promise<any>}
 */
export async function callSource({ plugin, sourceId, op, args = {}, profile, timeoutMs = 30000, logger, allowLegacyDefault = false } = {}) {
  const log = typeof logger === 'function'
    ? logger
    : (level, msg) => console.error(`[plugin:${plugin}] ${level}: ${msg}`);
  // Which configuration of the source to run against (plugin-config.mjs
  // profiles). Absent -> DEFAULT_PROFILE, which is what every single-profile
  // source uses, so this parameter is invisible unless a plugin opts in.
  const prof = profile || DEFAULT_PROFILE;

  if (mockMode()) {
    // Canned responses, no spawn, no plugin needed. The profile invariant still
    // holds whenever the plugin IS installed (behavioral parity so mock runs
    // catch missing/typo'd profiles too); an uninstalled plugin — the offline
    // smoke's whole point — skips it. reportResult additionally records its
    // args into the plugin state — mirroring the real-child stateDelta path —
    // so the offline smoke (Task 19) can assert write-back ran.
    let mockSource = null;
    try { mockSource = loadSource(plugin, sourceId).source; } catch { mockSource = null; }
    if (mockSource) assertProfileInvariant({ plugin, sourceId, source: mockSource, profile, allowLegacyDefault });
    const r = await mockCall(op, args);
    if (op === 'reportResult') writePluginState(plugin, { lastReport: JSON.stringify(args) }, prof);
    return r;
  }

  const { dir, source, apiVersion } = loadSource(plugin, sourceId);
  assertProfileInvariant({ plugin, sourceId, source, profile, allowLegacyDefault });
  const payload = JSON.stringify({
    apiVersion,
    module: resolve(dir, source.module), // './'-relative, '..'-free (normalizeManifest)
    op,
    // The connector sees ONE profile's config/state and is told which — a
    // connector that keeps its own storage (jira-source hangs a $JTR_CONFIG_DIR
    // off it) needs the id, not just the values.
    profile: prof,
    config: readPluginConfig(plugin, source.configSchema, prof),
    state: readPluginState(plugin, prof),
    args,
  });

  const frame = await new Promise((resolveFrame, rejectFrame) => {
    // WORCA_PLUGIN_INSPECT=1 attaches the debugger to the connector child
    // (`worca plugin exec --inspect` sets it; spec §7.2 debuggability).
    const child = spawn(process.execPath,
      [...(process.env.WORCA_PLUGIN_INSPECT ? ['--inspect-brk'] : []), CHILD_PATH], {
      env: scrubbedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const killTimer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(killTimer); fn(v); } };
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.on('error', (err) => settle(rejectFrame, new PluginOpError('protocol', `plugin "${plugin}": spawn failed — ${err.message}`)));
    child.on('close', (code) => {
      if (timedOut) {
        return settle(rejectFrame, new PluginOpError('timeout', `plugin "${plugin}" op "${op}" exceeded ${timeoutMs}ms (child killed)`));
      }
      if (code !== 0) {
        return settle(rejectFrame, new PluginOpError('protocol',
          `plugin "${plugin}" op "${op}": child exited ${code}${stderr ? ` — ${stderr.slice(0, 400)}` : ''}`));
      }
      try {
        settle(resolveFrame, JSON.parse(stdout));
      } catch {
        settle(rejectFrame, new PluginOpError('protocol',
          `plugin "${plugin}" op "${op}": non-JSON on stdout (stdout is protocol-reserved; use ctx.log) — got: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.end(payload); // config/secrets/state via stdin only
  });

  for (const l of Array.isArray(frame.logs) ? frame.logs : []) {
    log(l?.level || 'info', String(l?.msg ?? ''));
  }
  if (!frame.ok) {
    throw new PluginOpError(frame.error?.kind || 'plugin', frame.error?.message || `plugin "${plugin}" op "${op}" failed`);
  }
  if (frame.stateDelta && typeof frame.stateDelta === 'object' && Object.keys(frame.stateDelta).length) {
    writePluginState(plugin, frame.stateDelta, prof); // host-side persist; child never touches the store
  }
  return frame.result;
}
