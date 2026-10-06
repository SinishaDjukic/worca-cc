// src/core/azure-credentials.mjs
// Azure DevOps credentials for worca's OWN calls (git push/fetch/clone, PR REST), the twin of
// github-credentials.mjs. A PAT from the deployment's env, scoped per call; never reaches an agent.
import { stripGithubCredentials } from './github-credentials.mjs';

/** Every variable worca reads as its own Azure DevOps credential. Never reaches an agent. */
export const AZURE_DEVOPS_CREDENTIAL_KEYS = Object.freeze([
  'WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'WORCA_ADO_GIT_TOKEN',
]);

/**
 * Azure DevOps credentials worca never uses itself but must never hand to a child either. Strip-only:
 * readAzureCredentials ignores them. WORCA_ADO_BOARDS_TOKEN is the documented {"$env":…} target of the Boards
 * plugin's token field (plugin-config.mjs resolves it in the host at read time, so stripping children is safe).
 */
export const AZURE_DEVOPS_STRIP_ONLY_KEYS = Object.freeze(['WORCA_ADO_BOARDS_TOKEN']);

const val = (v) => (typeof v === 'string' ? v.trim() : '');

export function stripAzureCredentials(env) {
  const out = { ...env };
  for (const k of [...AZURE_DEVOPS_CREDENTIAL_KEYS, ...AZURE_DEVOPS_STRIP_ONLY_KEYS]) delete out[k];
  return out;
}

/** { mode: 'none'|'single'|'split', read, write } — same rules as readGithubCredentials. */
export function readAzureCredentials(env = process.env) {
  const single = val(env.WORCA_ADO_TOKEN) || val(env.AZURE_DEVOPS_EXT_PAT) || null;
  const r = val(env.WORCA_ADO_READ_TOKEN) || null;
  const w = val(env.WORCA_ADO_WRITE_TOKEN) || null;
  const mode = r || w ? 'split' : single ? 'single' : 'none';
  return { mode, read: r || single, write: w || single };
}

// git answers Azure's basic-auth challenge with any user name and the PAT as password.
export const ADO_GIT_CREDENTIAL_HELPER =
  '!f() { test "$1" = get || exit 0; echo username=pat; echo "password=$WORCA_ADO_GIT_TOKEN"; }; f';
export const ADO_HELPER_KEYS = Object.freeze(['credential.https://dev.azure.com.helper', 'credential.https://*.visualstudio.com.helper']);

/** `base` minus every Azure credential, plus the helper for `token` (layered after existing GIT_CONFIG_* entries;
 *  an empty value first clears the machine's own helpers, e.g. GCM, for these hosts). No token → just stripped. */
export function withAzureToken(base, token) {
  const env = stripAzureCredentials(base);
  if (!token) return env;
  const n = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  let i = Number.isInteger(n) && n > 0 ? n : 0;
  for (const key of ADO_HELPER_KEYS) {
    env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = ''; i++;
    env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = ADO_GIT_CREDENTIAL_HELPER; i++;
  }
  env.GIT_CONFIG_COUNT = String(i);
  env.WORCA_ADO_GIT_TOKEN = token;
  return env;
}

/** The env for one git call that needs `role` on an Azure host: every host credential stripped, the role's PAT as helper. */
export function azureEnv(role, base = process.env) {
  const creds = readAzureCredentials(base);
  return withAzureToken(stripGithubCredentials(base), role === 'write' ? creds.write : creds.read);
}

/** Headers for one REST call: Basic base64(":" + PAT). null when there is no credential for `role`. */
export function azureAuthHeader(role, env = process.env) {
  const c = readAzureCredentials(env);
  const t = role === 'write' ? c.write : c.read;
  return t ? { authorization: `Basic ${Buffer.from(`:${t}`).toString('base64')}` } : null;
}
