// src/core/gitea-family-credentials.mjs
// Credentials for worca's OWN calls to the Gitea family (Gitea, Forgejo, Codeberg): one shape, bound per forge by
// gitea-credentials.mjs, forgejo-credentials.mjs and codeberg-credentials.mjs. A host-list forge reads
// WORCA_<PREFIX>_HOSTS plus per-host tokens WORCA_<PREFIX>_TOKEN_<HOST> (and the READ_/WRITE_ split), host uppercased
// with [^A-Z0-9] → _. There is no host-less token. REST: `Authorization: token <t>`. git: the family resolves the
// identity from the token and takes any user name beside it; worca answers `worca`. Never reaches an agent.
import { parseGiteaHosts } from '../shared/gitea-remote.mjs';
import { familyForgeOfHost } from './forge.mjs';
import { stripGithubCredentials } from './github-credentials.mjs';
import { stripAzureCredentials } from './azure-credentials.mjs';
import { stripBitbucketCredentials } from './bitbucket-credentials.mjs';

const PREFIXES = Object.freeze(['GITEA', 'FORGEJO', 'CODEBERG']);
const val = (v) => (typeof v === 'string' ? v.trim() : '');

/** Every WORCA_<PREFIX>_* variable of the family except the host lists is a credential. */
export const isFamilyCredentialKey = (k) => PREFIXES.some((p) => String(k).startsWith(`WORCA_${p}_`) && k !== `WORCA_${p}_HOSTS`);

export function stripFamilyCredentials(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (isFamilyCredentialKey(k)) delete out[k];
  return out;
}

/** The env of one git call minus every forge credential worca knows. */
export const stripAllForgeCredentials = (env) => stripFamilyCredentials(stripBitbucketCredentials(stripAzureCredentials(stripGithubCredentials(env))));

/** The variable suffix of a host: pgit.example.org → PGIT_EXAMPLE_ORG. */
export const hostSuffix = (host) => String(host).toUpperCase().replace(/[^A-Z0-9]/g, '_');

export const FAMILY_GIT_USER = 'worca';
export const helperKey = (host) => `credential.https://${host}.helper`;
// git asks this helper for the one host of the call (credential.<url>.helper is matched per host by git's urlmatch).
const helperFor = (tokenKey) =>
  `!f() { test "$1" = get || exit 0; echo "username=${FAMILY_GIT_USER}"; echo "password=$${tokenKey}"; }; f`;

/** `base` plus the helper for `token` on `host`, read from `tokenKey` (layered after existing GIT_CONFIG_* entries;
 *  an empty value first clears the machine's own helpers for that host). Callers strip credentials first. */
export function withFamilyToken(base, host, token, tokenKey) {
  const env = { ...base };
  if (!token) return env;
  const n = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  let i = Number.isInteger(n) && n > 0 ? n : 0;
  env[`GIT_CONFIG_KEY_${i}`] = helperKey(host); env[`GIT_CONFIG_VALUE_${i}`] = ''; i++;
  env[`GIT_CONFIG_KEY_${i}`] = helperKey(host); env[`GIT_CONFIG_VALUE_${i}`] = helperFor(tokenKey); i++;
  env.GIT_CONFIG_COUNT = String(i);
  env[tokenKey] = token;
  return env;
}

/** The role rules shared by every forge: { mode: 'none'|'single'|'split', read, write }. */
export function roles(single, r, w) {
  const mode = r || w ? 'split' : single ? 'single' : 'none';
  return { mode, read: r || single, write: w || single };
}

/** The credential functions of one host-list forge (WORCA_<prefix>_*). */
export function makeHostListCredentials(prefix) {
  const K = (name) => `WORCA_${prefix}_${name}`;
  const hosts = (env = process.env) => parseGiteaHosts(env[K('HOSTS')]);
  const read = (host, env = process.env) => {
    const pick = (name) => val(env[`${K(name)}_${hostSuffix(host)}`]) || null;
    return roles(pick('TOKEN'), pick('READ_TOKEN'), pick('WRITE_TOKEN'));
  };
  const gitEnv = (role, host, base = process.env) => {
    const c = read(host, base);
    return withFamilyToken(stripAllForgeCredentials(base), host, role === 'write' ? c.write : c.read, `${K('GIT_TOKEN')}_${hostSuffix(host)}`);
  };
  const authHeader = (role, host, env = process.env) => {
    const c = read(host, env);
    const t = role === 'write' ? c.write : c.read;
    return t ? { authorization: `token ${t}` } : null;
  };
  /** True when at least one listed host has a token. */
  const configured = (env = process.env) => hosts(env).some((h) => read(h, env).mode !== 'none');
  /** Startup log lines: a host-less token (there is none) or a per-host token whose host is not listed. Names only. */
  const warnings = (env = process.env) => {
    const known = new Set(hosts(env).map(hostSuffix));
    const re = new RegExp(`^${K('(?:READ_|WRITE_)?TOKEN')}(?:_(.+))?$`);
    const out = [];
    const bySuffix = new Map();
    for (const h of hosts(env)) bySuffix.set(hostSuffix(h), [...(bySuffix.get(hostSuffix(h)) || []), h]);
    for (const [suffix, hs] of bySuffix) if (hs.length > 1) out.push(`${K('HOSTS')}: ${hs.join(' and ')} share the suffix ${suffix}, so one ${K('TOKEN')}_${suffix} would serve both`);
    for (const k of Object.keys(env)) {
      const m = re.exec(k);
      if (!m) continue;
      if (!m[1]) out.push(`${k} is not read: tokens are per host (${k}_<HOST>)`);
      else if (!known.has(m[1])) out.push(`${k} names a host that is not in ${K('HOSTS')}`);
    }
    return out;
  };
  return { hostsKey: K('HOSTS'), hosts, read, gitEnv, authHeader, configured, warnings };
}

/** The credential state of one family host: { forge, mode, tokenName } | null when the host is not a family host. */
export function familyCredentialsOf(host, env = process.env) {
  const forge = familyForgeOfHost(host);
  if (!forge) return null;
  if (forge === 'codeberg') {
    const c = roles(val(env.WORCA_CODEBERG_TOKEN) || null, val(env.WORCA_CODEBERG_READ_TOKEN) || null, val(env.WORCA_CODEBERG_WRITE_TOKEN) || null);
    return { forge, mode: c.mode, tokenName: 'WORCA_CODEBERG_TOKEN' };
  }
  const prefix = forge.toUpperCase();
  return { forge, mode: makeHostListCredentials(prefix).read(host, env).mode, tokenName: `WORCA_${prefix}_TOKEN_${hostSuffix(host)}` };
}

/** True when any family forge has a token with a value, on a listed host: the hostLookupNeeded signal. A key that is
 *  present but empty (compose passes every variable through as `${VAR:-}`) configures nothing. */
export const familyConfigured = (env = process.env) =>
  makeHostListCredentials('GITEA').configured(env) || makeHostListCredentials('FORGEJO').configured(env)
  || roles(val(env.WORCA_CODEBERG_TOKEN) || null, val(env.WORCA_CODEBERG_READ_TOKEN) || null, val(env.WORCA_CODEBERG_WRITE_TOKEN) || null).mode !== 'none';

/** `base` plus read helpers for every configured family host with a token, read from `source` (plugin repo git
 *  calls may read any host; `base` is usually already stripped). */
export function withFamilyReadTokens(base, source = process.env) {
  let env = stripFamilyCredentials(base);
  for (const prefix of ['GITEA', 'FORGEJO']) {
    const c = makeHostListCredentials(prefix);
    for (const h of c.hosts(source)) {
      const t = c.read(h, source).read;
      if (t) env = withFamilyToken(env, h, t, `WORCA_${prefix}_GIT_TOKEN_${hostSuffix(h)}`);
    }
  }
  const cb = val(source.WORCA_CODEBERG_READ_TOKEN) || val(source.WORCA_CODEBERG_TOKEN);
  return cb ? withFamilyToken(env, 'codeberg.org', cb, 'WORCA_CODEBERG_GIT_TOKEN') : env;
}
