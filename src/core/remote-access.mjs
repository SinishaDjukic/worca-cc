// Remote access behind an identity proxy (docs/remote-access.md).
//
// Worca is a single-user localhost tool (ui/server.mjs, S1): it accepts only
// requests whose Host (and browser Origin) is a loopback name. Behind a proxy
// the browser sends the public hostname, so a hosted deployment opts in with:
//
//   WORCA_ALLOWED_HOSTS             hostnames accepted besides loopback, comma-
//                                   separated; ".example.com" matches subdomains
//   WORCA_CF_ACCESS_TEAM_DOMAIN     + WORCA_CF_ACCESS_AUD: every request must carry
//                                   a valid Cloudflare Access token for that app
//   WORCA_INSECURE_NO_IDENTITY_CHECK=1  run with an allowlist but no token check
//                                   (the proxy alone is trusted); never the default
//
// Fail closed: an allowlist without an identity check is a startup error unless
// the insecure flag says so explicitly. With none of these set, nothing changes.
import { createAccessVerifier, normalizeTeamDomain } from './cf-access.mjs';

export const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const HOST_ENTRY_RE = /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Hostname (no port) from a Host header value or full Origin URL, or null. */
export function hostnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/** "a.example.com, .example.org" -> { hosts: [...], invalid: [...] } (lowercased, deduped). */
export function parseAllowedHosts(value) {
  const hosts = [];
  const invalid = [];
  for (const raw of String(value || '').split(',')) {
    const h = raw.trim().toLowerCase();
    if (!h) continue;
    if (!HOST_ENTRY_RE.test(h) || h === '.') invalid.push(raw.trim());
    else if (!hosts.includes(h)) hosts.push(h);
  }
  return { hosts, invalid };
}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/** The remote-access settings from the environment. Pure: reads only `env`. */
export function readRemoteAccessConfig(env = process.env) {
  const { hosts, invalid } = parseAllowedHosts(env.WORCA_ALLOWED_HOSTS);
  const teamDomain = normalizeTeamDomain(env.WORCA_CF_ACCESS_TEAM_DOMAIN);
  const aud = String(env.WORCA_CF_ACCESS_AUD || '').trim();
  return {
    allowedHosts: hosts,
    invalidHosts: invalid,
    identity: teamDomain || aud ? { provider: 'cloudflare-access', teamDomain, aud } : null,
    insecureNoIdentity: truthy(env.WORCA_INSECURE_NO_IDENTITY_CHECK),
  };
}

/** True when the server answers to any non-loopback hostname. */
export function isRemoteMode(cfg) {
  return cfg.allowedHosts.some((h) => !LOCAL_HOSTNAMES.has(h));
}

/**
 * Validate a config against the bind address. Errors stop the server from
 * starting; warnings are logged. Both are one-line, actionable messages.
 */
export function checkRemoteAccessConfig(cfg, { bindHost = '127.0.0.1' } = {}) {
  const errors = [];
  const warnings = [];
  if (cfg.invalidHosts.length) {
    errors.push(`WORCA_ALLOWED_HOSTS has invalid entries: ${cfg.invalidHosts.join(', ')} (use hostnames like worca-01.example.com or .example.com, no scheme or port)`);
  }
  if (cfg.identity) {
    if (!cfg.identity.teamDomain) errors.push('WORCA_CF_ACCESS_AUD is set but WORCA_CF_ACCESS_TEAM_DOMAIN is not');
    if (!cfg.identity.aud) errors.push('WORCA_CF_ACCESS_TEAM_DOMAIN is set but WORCA_CF_ACCESS_AUD is not');
  }
  const remote = isRemoteMode(cfg);
  if (remote && !cfg.identity && !cfg.insecureNoIdentity) {
    errors.push('WORCA_ALLOWED_HOSTS is set but no identity check is configured: set WORCA_CF_ACCESS_TEAM_DOMAIN and WORCA_CF_ACCESS_AUD, or set WORCA_INSECURE_NO_IDENTITY_CHECK=1 if a proxy you trust is the only way in');
  }
  if (remote && !cfg.identity && cfg.insecureNoIdentity) {
    warnings.push('WORCA_INSECURE_NO_IDENTITY_CHECK=1: worca checks no identity; anyone who reaches it controls this machine');
  }
  if (cfg.identity && cfg.insecureNoIdentity) {
    warnings.push('WORCA_INSECURE_NO_IDENTITY_CHECK is ignored: a Cloudflare Access check is configured and enforced');
  }
  if (cfg.identity && !remote) {
    warnings.push('WORCA_CF_ACCESS_* is set but WORCA_ALLOWED_HOSTS is empty: only localhost requests are accepted');
  }
  if (!LOOPBACK_BINDS.has(String(bindHost).toLowerCase()) && !remote) {
    warnings.push(`listening on ${bindHost} but WORCA_ALLOWED_HOSTS is empty: every request not addressed to localhost gets a 403`);
  }
  return { errors, warnings };
}

/** (req) => true when Host and (if present) Origin are loopback or allowlisted. */
export function createHostGuard(allowedHosts = []) {
  const allowed = (name) => {
    if (!name) return false;
    const h = name.toLowerCase();
    if (LOCAL_HOSTNAMES.has(h)) return true;
    return allowedHosts.some((a) => (a.startsWith('.') ? h.endsWith(a) : h === a));
  };
  return function isAllowedRequest(req) {
    if (!allowed(hostnameOf(req.headers.host))) return false;
    const origin = req.headers.origin;
    if (origin && !allowed(hostnameOf(origin))) return false;
    return true;
  };
}

/**
 * A connection from inside this machine/container (`worca ui stop`, the CLI,
 * curl in a shell): loopback TCP peer AND loopback Host. A proxy on another
 * host (cloudflared as its own service) never matches, so it is always checked.
 */
export function isInContainer(req) {
  return LOOPBACK_ADDRS.has(req.socket?.remoteAddress)
    && LOCAL_HOSTNAMES.has(hostnameOf(req.headers.host));
}

/**
 * The identity check for this config, or null when none applies (local mode,
 * or the explicit insecure flag). Provider-agnostic: returns
 * `(req) => Promise<{ email, sub } | null>`; rejects only when the provider
 * cannot be reached (the caller answers 503).
 */
export function createIdentityCheck(cfg, { fetchImpl, now } = {}) {
  if (!cfg.identity) return null;
  if (cfg.identity.provider === 'cloudflare-access') {
    const verify = createAccessVerifier({ teamDomain: cfg.identity.teamDomain, aud: cfg.identity.aud, fetchImpl, now });
    return (req) => verify(req.headers['cf-access-jwt-assertion']);
  }
  throw new Error(`unknown identity provider: ${cfg.identity.provider}`);
}
