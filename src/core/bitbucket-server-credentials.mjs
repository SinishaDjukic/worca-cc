// src/core/bitbucket-server-credentials.mjs
// Credentials + host config for a SELF-HOSTED Bitbucket Server / Data Center remote, the sibling of
// bitbucket-credentials.mjs (Cloud). Two differences from Cloud:
//   - the server is reached by a HOST ALLOWLIST (WORCA_BB_SERVER_HOSTS, comma-separated), not a fixed API origin;
//   - its "HTTP access tokens" are Bearer-only — basic `user:token` is rejected with 401 — so git uses
//     http.<url>.extraHeader = Authorization: Bearer <token> (injected per call) and REST uses the same header.
// One token family (WORCA_BB_SERVER_TOKEN / _READ_TOKEN / _WRITE_TOKEN) serves git and the PR REST API alike and
// never reaches an agent.
import { stripGithubCredentials } from './github-credentials.mjs';
import { stripAzureCredentials } from './azure-credentials.mjs';
import { stripBitbucketCredentials } from './bitbucket-credentials.mjs';

/** Every variable worca reads (or sets for one git call) as its own Bitbucket Server credential. Never reaches an agent. */
export const BITBUCKET_SERVER_CREDENTIAL_KEYS = Object.freeze([
  'WORCA_BB_SERVER_TOKEN', 'WORCA_BB_SERVER_READ_TOKEN', 'WORCA_BB_SERVER_WRITE_TOKEN',
]);
export const BITBUCKET_SERVER_HOSTS_KEY = 'WORCA_BB_SERVER_HOSTS';

const val = (v) => (typeof v === 'string' ? v.trim() : '');

export function stripBitbucketServerCredentials(env) {
  const out = { ...env };
  for (const k of BITBUCKET_SERVER_CREDENTIAL_KEYS) delete out[k];
  return out;
}

/** The hosts worca automates as Bitbucket Server (WORCA_BB_SERVER_HOSTS; comma, semicolon or whitespace separated). Never throws. */
export function bitbucketServerHosts(env = process.env) {
  const raw = val(env && env[BITBUCKET_SERVER_HOSTS_KEY]);
  return new Set(String(raw).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** True when `host` is in the Bitbucket Server allowlist. Never throws. */
export function isBitbucketServerHost(host, env = process.env) {
  return typeof host === 'string' && bitbucketServerHosts(env).has(host.toLowerCase());
}

/**
 * { mode: 'none'|'single'|'split', read, write } — the same role rules as readBitbucketCredentials:
 * a single WORCA_BB_SERVER_TOKEN covers both roles; _READ_TOKEN / _WRITE_TOKEN split them.
 */
export function readBitbucketServerCredentials(env = process.env) {
  const single = val(env.WORCA_BB_SERVER_TOKEN) || null;
  const r = val(env.WORCA_BB_SERVER_READ_TOKEN) || null;
  const w = val(env.WORCA_BB_SERVER_WRITE_TOKEN) || null;
  const mode = r || w ? 'split' : single ? 'single' : 'none';
  return { mode, read: r || single, write: w || single };
}

const tokenOf = (c, role) => (role === 'write' ? c.write : c.read);

/** `host` must be the allow-listed host being called: the URL-match key must scope to exactly it. */
export function withBitbucketServerToken(base, token, host) {
  const env = stripBitbucketServerCredentials(base);
  if (!token || !host) return env;
  const n = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  let i = Number.isInteger(n) && n > 0 ? n : 0;
  env[`GIT_CONFIG_KEY_${i}`] = `http.https://${host}/.extraHeader`; env[`GIT_CONFIG_VALUE_${i}`] = `Authorization: Bearer ${token}`; i++;
  env.GIT_CONFIG_COUNT = String(i);
  return env;
}

/** The env for one git call that needs `role` on the Bitbucket Server `host`: every host credential stripped (so no
 *  Cloud/ADO/GitHub token could leak to this host), the role's token as a per-call http.extraHeader. */
export function bitbucketServerEnv(role, host, base = process.env) {
  const c = readBitbucketServerCredentials(base);
  const env = stripAzureCredentials(stripGithubCredentials(stripBitbucketCredentials(base)));
  return withBitbucketServerToken(env, tokenOf(c, role), host);
}

/** Headers for one REST call to a Bitbucket Server host: Bearer. null without a token. */
export function bitbucketServerAuthHeader(role, env = process.env) {
  const t = tokenOf(readBitbucketServerCredentials(env), role);
  return t ? { authorization: `Bearer ${t}` } : null;
}
