// src/core/exec-env/e2b-config.mjs
// Pure policy for the e2b execution environment: connection, preflight, request timeouts. No SDK
// import here (./e2b-sdk.mjs loads it lazily). The backend-neutral policy lives in ./policy.mjs;
// its names are re-exported here so existing imports keep working.
import { modelCredential, redactKey, remotePreflight } from './policy.mjs';
export { SANDBOX_TIMEOUT_MS, HEARTBEAT_MS, AGENT_COMMAND_TIMEOUT_MS, SHELL_COMMAND_TIMEOUT_MS, redactKey,
  modelCredential, MODEL_CREDENTIAL_KEYS, sandboxEnv, isLoopbackHost, sandboxMcpConfig, instanceTag } from './policy.mjs';

export const E2B_SDK_VERSION = '2.56.0';
export const E2B_DEFAULT_TEMPLATE = 'worca-agent';
export const MIN_NODE_FOR_E2B = [22, 19, 0];
export const CONTROL_REQUEST_TIMEOUT_MS = 30_000;      // create/connect/list/kill/getInfo/setTimeout
export const STATUS_REQUEST_TIMEOUT_MS = 5_000;       // the live status (GET /api/exec-envs/status): one cheap list
export const FILE_REQUEST_TIMEOUT_MS = 10 * 60_000;    // bundle/overlay uploads over the SSH tunnel
export const DEFAULT_E2B_MAX_SANDBOXES = 4;
export const DEFAULT_E2B_MAX_WAIT_MIN = 240;

/** SDK connection options from the server's env (never logged whole). No global
 *  requestTimeoutMs: it would also cap file uploads; each call passes its own. */
export function e2bConnection(env = process.env) {
  const opts = {};
  if (env.E2B_API_KEY) opts.apiKey = env.E2B_API_KEY;
  if (env.E2B_API_URL) opts.apiUrl = env.E2B_API_URL;
  if (env.E2B_SANDBOX_URL) opts.sandboxUrl = env.E2B_SANDBOX_URL;
  return { opts, template: env.WORCA_E2B_TEMPLATE || E2B_DEFAULT_TEMPLATE, keyHint: redactKey(env.E2B_API_KEY) };
}

const verAtLeast = (v, min) => {
  const p = String(v).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) { if (p[i] !== min[i]) return p[i] > min[i]; }
  return true;
};

/** Run-start checks for an e2b run. Sync (the server's 409 path calls it). */
export function e2bPreflight({ engine, isWorkspace, workMode = 'git', mock = false, env = process.env, platform = process.platform,
  nodeVersion = process.versions.node, sdkInstalled = () => true, brokerOn = false, runRootMode = 'detached' } = {}) {
  const errors = remotePreflight({ title: 'E2B', engine, isWorkspace, workMode, runRootMode, platform }); const warnings = [];
  if (!mock) {
    if (!env.E2B_API_KEY) errors.push("E2B_API_KEY is not set in the worca server's environment.");
    if (String(env.E2B_DEBUG || '').toLowerCase() === 'true') errors.push('E2B_DEBUG=true makes the e2b SDK fake every sandbox; unset it.');
    // The credential never enters the sandbox: the model relay adds it on the server. With the broker on, the broker holds the keys.
    if (!brokerOn && !modelCredential(env)) errors.push("Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set in the worca server's environment; it stays on the server and signs the sandbox's model calls.");
    if (!verAtLeast(nodeVersion, MIN_NODE_FOR_E2B)) errors.push(`The e2b SDK needs Node 22.19 or newer (this server runs ${nodeVersion}).`);
    else if (!sdkInstalled()) errors.push(`The optional "e2b" package is not installed. Run: npm install e2b@${E2B_SDK_VERSION} (in the worca install directory).`);
    // E2B Cloud is a deliberate choice: the run's code and history leave this machine for a third party (docs/e2b.md).
    if (!env.E2B_API_URL && !env.E2B_DOMAIN) {
      if (env.WORCA_E2B_CLOUD === '1') warnings.push('E2B_API_URL is not set and WORCA_E2B_CLOUD=1: runs go to E2B Cloud (api.e2b.app).');
      else errors.push("E2B_API_URL is not set, so runs would go to E2B Cloud. Set E2B_API_URL to your E2B server, or set WORCA_E2B_CLOUD=1 in the worca server's environment to use E2B Cloud.");
    }
  }
  warnings.push('The host guard is off inside the sandbox (no worca server runs there to protect).');
  return { errors, warnings };
}
