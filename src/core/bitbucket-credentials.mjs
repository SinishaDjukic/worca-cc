// src/core/bitbucket-credentials.mjs
// Bitbucket Cloud credentials for worca's OWN calls (git push/fetch/clone, PR REST), the twin of
// azure-credentials.mjs. Two kinds from the deployment's env, scoped per call; never reaches an agent:
//   an Atlassian API token: WORCA_BB_EMAIL + the token. REST: Basic email:token; git user x-bitbucket-api-token-auth.
//   a repository / project / workspace access token (no email). REST: Bearer; git user x-token-auth.
import { stripGithubCredentials } from './github-credentials.mjs';
import { stripAzureCredentials } from './azure-credentials.mjs';

/** Every variable worca reads (or sets for one git call) as its own Bitbucket credential. Never reaches an agent. */
export const BITBUCKET_CREDENTIAL_KEYS = Object.freeze([
  'WORCA_BB_TOKEN', 'WORCA_BB_READ_TOKEN', 'WORCA_BB_WRITE_TOKEN', 'WORCA_BB_EMAIL', 'WORCA_BB_GIT_TOKEN', 'WORCA_BB_GIT_USER',
]);

const val = (v) => (typeof v === 'string' ? v.trim() : '');

export function stripBitbucketCredentials(env) {
  const out = { ...env };
  for (const k of BITBUCKET_CREDENTIAL_KEYS) delete out[k];
  return out;
}

/**
 * { mode: 'none'|'single'|'split', read, write, email, kind } — the same role rules as readAzureCredentials.
 * kind: 'api-token' when WORCA_BB_EMAIL is set (every token is then an Atlassian API token), 'access-token' otherwise,
 * null without a token.
 */
export function readBitbucketCredentials(env = process.env) {
  const single = val(env.WORCA_BB_TOKEN) || null;
  const r = val(env.WORCA_BB_READ_TOKEN) || null;
  const w = val(env.WORCA_BB_WRITE_TOKEN) || null;
  const mode = r || w ? 'split' : single ? 'single' : 'none';
  const email = val(env.WORCA_BB_EMAIL) || null;
  return { mode, read: r || single, write: w || single, email, kind: mode === 'none' ? null : email ? 'api-token' : 'access-token' };
}

/** The git user name Bitbucket expects beside each kind of token. */
export const BB_GIT_USER = Object.freeze({ 'api-token': 'x-bitbucket-api-token-auth', 'access-token': 'x-token-auth' });
// git asks this helper for https://bitbucket.org only (credential.<url>.helper is matched per host by git's urlmatch).
export const BB_GIT_CREDENTIAL_HELPER =
  '!f() { test "$1" = get || exit 0; echo "username=$WORCA_BB_GIT_USER"; echo "password=$WORCA_BB_GIT_TOKEN"; }; f';
export const BB_HELPER_KEY = 'credential.https://bitbucket.org.helper';

/** `base` minus every Bitbucket credential, plus the helper for `token` (layered after existing GIT_CONFIG_* entries;
 *  an empty value first clears the machine's own helpers for bitbucket.org). No token → just stripped. */
export function withBitbucketToken(base, token, kind = 'access-token') {
  const env = stripBitbucketCredentials(base);
  if (!token) return env;
  const n = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  let i = Number.isInteger(n) && n > 0 ? n : 0;
  env[`GIT_CONFIG_KEY_${i}`] = BB_HELPER_KEY; env[`GIT_CONFIG_VALUE_${i}`] = ''; i++;
  env[`GIT_CONFIG_KEY_${i}`] = BB_HELPER_KEY; env[`GIT_CONFIG_VALUE_${i}`] = BB_GIT_CREDENTIAL_HELPER; i++;
  env.GIT_CONFIG_COUNT = String(i);
  env.WORCA_BB_GIT_TOKEN = token;
  env.WORCA_BB_GIT_USER = BB_GIT_USER[kind] || BB_GIT_USER['access-token'];
  return env;
}

/** The env for one git call that needs `role` on bitbucket.org: every host credential stripped, the role's token as helper. */
export function bitbucketEnv(role, base = process.env) {
  const c = readBitbucketCredentials(base);
  return withBitbucketToken(stripAzureCredentials(stripGithubCredentials(base)), role === 'write' ? c.write : c.read, c.kind || undefined);
}

/** Headers for one REST call to api.bitbucket.org: Basic email:token (API token) or Bearer (access token). null without one. */
export function bitbucketAuthHeader(role, env = process.env) {
  const c = readBitbucketCredentials(env);
  const t = role === 'write' ? c.write : c.read;
  if (!t) return null;
  return c.email ? { authorization: `Basic ${Buffer.from(`${c.email}:${t}`).toString('base64')}` } : { authorization: `Bearer ${t}` };
}
