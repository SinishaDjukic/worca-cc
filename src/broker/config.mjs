// src/broker/config.mjs
// The credential broker's configuration (plans/credential-broker-design.html §6.2).
// Pure: reads only the `env` it is given (plus the files its *_FILE variables name),
// and returns every problem as a list instead of throwing, so the entry point can
// print them all and exit 78 once.
import { readFileSync } from 'node:fs';
import { parseAddressList } from '../core/trusted-proxies.mjs';
import { normalizeTeamDomain } from '../core/cf-access.mjs';
import { normalizeIssuer } from '../core/issuer-jwt.mjs';
import { upstreamIssue } from './slots.mjs';
import { unpricedRates } from './usage.mjs';

export const MODES = Object.freeze(['single', 'multi']);
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const DAY_MS = 86_400_000;

/**
 * A secret from `NAME_FILE` (preferred: never in the process env) or `NAME`.
 * Trailing whitespace is dropped (files usually end in a newline).
 * @returns {{value: string|null, error: string|null}}
 */
export function readSecret(env, name, readFile = readFileSync) {
  const file = String(env[`${name}_FILE`] || '').trim();
  if (file) {
    try {
      const v = String(readFile(file, 'utf8')).trim();
      return v ? { value: v, error: null } : { value: null, error: `${name}_FILE (${file}) is empty` };
    } catch (err) {
      return { value: null, error: `${name}_FILE (${file}) cannot be read: ${err.code || err.message}` };
    }
  }
  const v = typeof env[name] === 'string' ? env[name].trim() : '';
  return { value: v || null, error: null };
}

/** "48h" | "90m" | "3600s" | "3600000" (ms) -> ms, or null. */
export function parseDuration(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY_MS }[m[2] || 'ms'];
  return Math.round(n * mult);
}

function parsePort(v, fallback) {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 65536 ? n : NaN;   // 0 = an ephemeral port (tests)
}

function parseUsd(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** Peer addresses from a list of IPs and CIDRs ("172.30.0.10, 10.8.0.0/16 fd00::/8"). */
function isLoopbackHost(h) {
  const host = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

/** A 32-byte AES key from base64 (or base64url), or null. */
export function decodeVaultKey(v) {
  if (!v) return null;
  let buf;
  try { buf = Buffer.from(String(v).trim(), /[-_]/.test(v) ? 'base64url' : 'base64'); } catch { return null; }
  return buf.length === 32 ? buf : null;
}

/** Slot ids whose single-mode key is set: WORCA_BROKER_KEY_<SLOT>[_FILE]; and, from
 *  WORCA_BROKER_KEY_<SLOT>_ORIGIN, the one origin a plugin slot's key may go to. */
function singleKeys(env, readFile, errors) {
  const keys = {};
  const origins = {};
  const names = new Set();
  const slotId = (n) => n.toLowerCase().replace(/_/g, '-');
  for (const k of Object.keys(env)) {
    const m = /^WORCA_BROKER_KEY_([A-Z0-9_]+?)(_FILE|_ORIGIN)?$/.exec(k);
    if (!m) continue;
    if (m[2] !== '_ORIGIN') { names.add(m[1]); continue; }
    const v = String(env[k] || '').trim();
    if (!v) continue;
    const issue = upstreamIssue(v.replace(/\/$/, ''));
    if (issue) errors.push(`${k}: ${issue}`);
    else origins[slotId(m[1])] = new URL(v).origin;
  }
  for (const n of names) {
    const { value, error } = readSecret(env, `WORCA_BROKER_KEY_${n}`, readFile);
    if (error) errors.push(error);
    if (value) keys[slotId(n)] = value;
  }
  return { keys, origins };
}

/**
 * @param {Record<string,string|undefined>} env
 * @returns {{config: object, errors: string[]}}
 */
export function readBrokerConfig(env = process.env, { readFile = readFileSync } = {}) {
  const errors = [];
  const mode = String(env.WORCA_BROKER_MODE || '').trim().toLowerCase();
  if (!MODES.includes(mode)) errors.push(`WORCA_BROKER_MODE must be one of ${MODES.join(', ')} (got ${JSON.stringify(env.WORCA_BROKER_MODE ?? '')})`);

  const secret = readSecret(env, 'WORCA_BROKER_SECRET', readFile);
  if (secret.error) errors.push(secret.error);
  else if (!secret.value) errors.push('WORCA_BROKER_SECRET (or WORCA_BROKER_SECRET_FILE) is required: the secret worca uses to ask for spawn tokens');
  else if (secret.value.length < 32) errors.push('WORCA_BROKER_SECRET is too short: use at least 32 characters (`worca broker secrets` prints one)');

  const vk = readSecret(env, 'WORCA_BROKER_VAULT_KEY', readFile);
  if (vk.error) errors.push(vk.error);
  const vaultKey = decodeVaultKey(vk.value);
  if (vk.value && !vaultKey) errors.push('WORCA_BROKER_VAULT_KEY must be 32 bytes, base64-encoded (`worca broker secrets` prints one)');
  if (mode === 'multi' && !vk.value) errors.push('WORCA_BROKER_VAULT_KEY is required in multi mode: it encrypts people\'s keys at rest');
  const vko = readSecret(env, 'WORCA_BROKER_VAULT_KEY_OLD', readFile);
  if (vko.error) errors.push(vko.error);
  const vaultKeyOld = decodeVaultKey(vko.value);
  if (vko.value && !vaultKeyOld) errors.push('WORCA_BROKER_VAULT_KEY_OLD must be 32 bytes, base64-encoded');

  const host = String(env.WORCA_BROKER_HOST || '0.0.0.0').trim();
  const port = parsePort(env.WORCA_BROKER_PORT, 8080);
  const uiPort = parsePort(env.WORCA_BROKER_UI_PORT, 8081);
  if (Number.isNaN(port)) errors.push('WORCA_BROKER_PORT must be a port number');
  if (Number.isNaN(uiPort)) errors.push('WORCA_BROKER_UI_PORT must be a port number');
  if (port === uiPort && port !== 0) errors.push('WORCA_BROKER_PORT and WORCA_BROKER_UI_PORT must differ: the key page port is the only one a public route may point at');

  let publicUrl = null;
  const pu = String(env.WORCA_BROKER_PUBLIC_URL || '').trim();
  if (pu) {
    try {
      const u = new URL(pu);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
        errors.push('WORCA_BROKER_PUBLIC_URL must be https (http only for localhost)');
      } else if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
        errors.push('WORCA_BROKER_PUBLIC_URL must be an origin only, e.g. https://worca-01-keys.example.com');
      } else publicUrl = u.origin;
    } catch { errors.push('WORCA_BROKER_PUBLIC_URL is not a URL'); }
  }
  let returnUrl = null;
  const ru = String(env.WORCA_BROKER_RETURN_URL || '').trim();
  if (ru) {
    try { const u = new URL(ru); if (u.protocol === 'https:' || u.protocol === 'http:') returnUrl = u.href; else throw new Error(); }
    catch { errors.push('WORCA_BROKER_RETURN_URL must be an http(s) URL'); }
  }

  const teamDomain = normalizeTeamDomain(env.WORCA_CF_ACCESS_TEAM_DOMAIN);
  const aud = String(env.WORCA_CF_ACCESS_AUD || '').trim();
  const identityHeader = String(env.WORCA_IDENTITY_HEADER || '').trim();
  const issuer = normalizeIssuer(env.WORCA_IDENTITY_ISSUER);
  let identity = null;
  if ((teamDomain || aud) && issuer) {
    errors.push('both WORCA_CF_ACCESS_* and WORCA_IDENTITY_ISSUER are set: configure one identity check for the key page, not two');
  } else if (teamDomain || aud) {
    if (!teamDomain || !aud) errors.push('set both WORCA_CF_ACCESS_TEAM_DOMAIN and WORCA_CF_ACCESS_AUD (the AUD of the key page\'s own Access application)');
    else identity = { kind: 'access', teamDomain, aud };
  } else if (issuer) {
    // A gate with its own issuer (W1): a JWT in X-Worca-Identity for the key page's host.
    const jwksUrl = String(env.WORCA_IDENTITY_JWKS_URL || '').trim() || `${issuer}/.well-known/jwks.json`;
    const audience = String(env.WORCA_IDENTITY_AUDIENCE || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
    if (!audience.length && publicUrl) audience.push(new URL(publicUrl).hostname);
    const secure = (v) => { try { const u = new URL(v); return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname)); } catch { return false; } };
    if (!secure(issuer)) errors.push('WORCA_IDENTITY_ISSUER must be an https URL (http only for localhost)');
    else if (!secure(jwksUrl)) errors.push('WORCA_IDENTITY_JWKS_URL must be an https URL (http only for localhost)');
    else if (!audience.length) errors.push('WORCA_IDENTITY_ISSUER needs an audience: set WORCA_IDENTITY_AUDIENCE or WORCA_BROKER_PUBLIC_URL');
    else identity = { kind: 'issuer', issuer, jwksUrl, audience };
  } else if (identityHeader) {
    if (!HEADER_NAME_RE.test(identityHeader)) errors.push('WORCA_IDENTITY_HEADER is not a valid header name');
    else {
      // A header proves nothing by itself: anything on the broker's network (worca, its
      // agents) could send it. It is believed only from the identity proxy's own address.
      const proxies = parseAddressList(env.WORCA_IDENTITY_TRUSTED_PROXIES);
      if (proxies.bad.length) errors.push(`WORCA_IDENTITY_TRUSTED_PROXIES has entries that are not an IP address or CIDR: ${proxies.bad.join(', ')}`);
      else if (!proxies.list.length && mode === 'multi') errors.push('WORCA_IDENTITY_HEADER needs WORCA_IDENTITY_TRUSTED_PROXIES: the address (or CIDR) the identity proxy connects to the key page from; the header from any other peer is refused');
      else identity = { kind: 'header', header: identityHeader.toLowerCase(), trustedProxies: proxies.list };
    }
  }
  if (mode === 'multi') {
    if (!publicUrl) errors.push('WORCA_BROKER_PUBLIC_URL is required in multi mode: the address of the key page');
    if (!identity && !errors.some((e) => /WORCA_IDENTITY_|WORCA_CF_ACCESS_/.test(e))) errors.push('multi mode needs an identity check for the key page: WORCA_CF_ACCESS_TEAM_DOMAIN + WORCA_CF_ACCESS_AUD, WORCA_IDENTITY_ISSUER, or WORCA_IDENTITY_HEADER');
  }

  const defaultDailyUsd = parseUsd(env.WORCA_BROKER_DEFAULT_DAILY_USD);
  const defaultMonthlyUsd = parseUsd(env.WORCA_BROKER_DEFAULT_MONTHLY_USD);
  if (Number.isNaN(defaultDailyUsd)) errors.push('WORCA_BROKER_DEFAULT_DAILY_USD must be a number >= 0');
  if (Number.isNaN(defaultMonthlyUsd)) errors.push('WORCA_BROKER_DEFAULT_MONTHLY_USD must be a number >= 0');
  const unpriced = unpricedRates(env.WORCA_BROKER_UNPRICED_USD_PER_MTOK);
  if (Number.isNaN(unpriced)) errors.push('WORCA_BROKER_UNPRICED_USD_PER_MTOK must be "input,output" in USD per million tokens (e.g. "10,50"), or 0');

  let tokenMaxTtlMs = 48 * 3_600_000;
  if (env.WORCA_BROKER_TOKEN_MAX_TTL) {
    const t = parseDuration(env.WORCA_BROKER_TOKEN_MAX_TTL);
    if (!t || t < 60_000) errors.push('WORCA_BROKER_TOKEN_MAX_TTL must be a duration of at least 1m, e.g. 48h');
    else tokenMaxTtlMs = t;
  }

  // "Push as me" (optional): each person signs in with GitHub on the key page through the
  // operator's GitHub App or OAuth App; worca's pushes and PRs then go out as them.
  const githubClientId = String(env.WORCA_BROKER_GITHUB_CLIENT_ID || '').trim() || null;
  const ghSecret = readSecret(env, 'WORCA_BROKER_GITHUB_CLIENT_SECRET', readFile);
  if (ghSecret.error) errors.push(ghSecret.error);
  if (ghSecret.value && !githubClientId) errors.push('WORCA_BROKER_GITHUB_CLIENT_SECRET needs WORCA_BROKER_GITHUB_CLIENT_ID');
  if (githubClientId && !/^[A-Za-z0-9._-]{8,64}$/.test(githubClientId)) errors.push('WORCA_BROKER_GITHUB_CLIENT_ID does not look like a GitHub client ID');

  const { keys, origins: keyOrigins } = singleKeys(env, readFile, errors);
  const dataDir = String(env.WORCA_BROKER_DATA_DIR || '').trim() || null;

  const config = Object.freeze({
    mode: MODES.includes(mode) ? mode : null,
    secret: secret.value,
    vaultKey,
    vaultKeyOld,
    dataDir,
    host,
    port,
    uiPort,
    uiEnabled: mode === 'multi',
    publicUrl,
    returnUrl,
    identity,
    slotsFile: String(env.WORCA_BROKER_SLOTS_FILE || '').trim() || null,
    localUrl: String(env.WORCA_BROKER_LOCAL_URL || '').trim() || null,
    github: githubClientId ? Object.freeze({
      clientId: githubClientId,
      clientSecret: ghSecret.value || null,
      scope: String(env.WORCA_BROKER_GITHUB_SCOPES ?? 'repo').trim(),
    }) : null,
    singleKeys: Object.freeze(keys),
    singleKeyOrigins: Object.freeze(keyOrigins),
    allowTeamKeys: /^(1|true|yes|on)$/i.test(String(env.WORCA_BROKER_ALLOW_TEAM_KEYS || '')),
    defaultDailyUsd: Number.isNaN(defaultDailyUsd) ? null : defaultDailyUsd,
    defaultMonthlyUsd: Number.isNaN(defaultMonthlyUsd) ? null : defaultMonthlyUsd,
    // The rate for a model with no list price; null = the highest list rate (usage.mjs UNPRICED_RATES).
    unpricedRates: unpriced && !Number.isNaN(unpriced) ? Object.freeze(unpriced) : null,
    tokenMaxTtlMs,
  });
  return { config, errors };
}
