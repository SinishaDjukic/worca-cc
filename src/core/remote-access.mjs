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
//   WORCA_IDENTITY_ISSUER           or instead: every request must carry a JWT from this
//                                   issuer in X-Worca-Identity (a gate such as the hosted
//                                   platform's). WORCA_IDENTITY_JWKS_URL (default
//                                   <issuer>/.well-known/jwks.json) and
//                                   WORCA_IDENTITY_AUDIENCE (default: the allowed hosts).
//                                   Exact hosts only: no ".example.com" entries
//   WORCA_INSECURE_NO_IDENTITY_CHECK=1  run with an allowlist but no token check
//                                   (the proxy alone is trusted); never the default
//
// Fail closed: an allowlist without an identity check is a startup error unless
// the insecure flag says so explicitly. With none of these set, local mode: a
// loopback Host from a loopback TCP peer (createPeerGuard), whatever the bind.
import fs from 'node:fs';
import os from 'node:os';
import { createAccessVerifier, normalizeTeamDomain } from './cf-access.mjs';
import { createIssuerVerifier, normalizeIssuer } from './issuer-jwt.mjs';

export const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
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

/** The header a gate with its own issuer hands worca the identity token in. */
export const ISSUER_TOKEN_HEADER = 'x-worca-identity';

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/** The remote-access settings from the environment. Pure: reads only `env`. */
export function readRemoteAccessConfig(env = process.env) {
  const { hosts, invalid } = parseAllowedHosts(env.WORCA_ALLOWED_HOSTS);
  const teamDomain = normalizeTeamDomain(env.WORCA_CF_ACCESS_TEAM_DOMAIN);
  const aud = String(env.WORCA_CF_ACCESS_AUD || '').trim();
  const access = teamDomain || aud ? { provider: 'cloudflare-access', teamDomain, aud } : null;
  const issuer = normalizeIssuer(env.WORCA_IDENTITY_ISSUER);
  let issuerCfg = null;
  if (issuer) {
    const audience = parseAllowedHosts(env.WORCA_IDENTITY_AUDIENCE).hosts;
    issuerCfg = {
      provider: 'issuer',
      issuer,
      jwksUrl: String(env.WORCA_IDENTITY_JWKS_URL || '').trim() || `${issuer}/.well-known/jwks.json`,
      audience: audience.length ? audience : hosts.filter((h) => !h.startsWith('.') && !LOCAL_HOSTNAMES.has(h)),
    };
  }
  return {
    allowedHosts: hosts,
    invalidHosts: invalid,
    // Both configured is a startup error (checkRemoteAccessConfig); Access is kept here so the
    // message can name both.
    identity: access || issuerCfg,
    conflictingIdentity: !!(access && issuerCfg),
    insecureNoIdentity: truthy(env.WORCA_INSECURE_NO_IDENTITY_CHECK),
  };
}

/** A URL worca may fetch keys from or trust as an issuer: https, or http on loopback only. */
function secureUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTNAMES.has(u.hostname));
  } catch {
    return false;
  }
}

/** True when the server answers to any non-loopback hostname. */
export function isRemoteMode(cfg) {
  return cfg.allowedHosts.some((h) => !LOCAL_HOSTNAMES.has(h));
}

/**
 * Validate a config against the bind address. Errors stop the server from
 * starting; warnings are logged. Both are one-line, actionable messages.
 */
export function checkRemoteAccessConfig(cfg, { bindHost = '127.0.0.1', gateways = [] } = {}) {
  const errors = [];
  const warnings = [];
  if (cfg.invalidHosts.length) {
    errors.push(`WORCA_ALLOWED_HOSTS has invalid entries: ${cfg.invalidHosts.join(', ')} (use hostnames like worca-01.example.com or .example.com, no scheme or port)`);
  }
  if (cfg.conflictingIdentity) {
    errors.push('both WORCA_CF_ACCESS_* and WORCA_IDENTITY_ISSUER are set: configure one identity check, not two');
  }
  if (cfg.identity?.provider === 'issuer') {
    const id = cfg.identity;
    if (!secureUrl(id.issuer)) errors.push('WORCA_IDENTITY_ISSUER must be an https URL (http only for localhost)');
    if (!secureUrl(id.jwksUrl)) errors.push('WORCA_IDENTITY_JWKS_URL must be an https URL (http only for localhost)');
    if (!id.audience.length) errors.push('WORCA_IDENTITY_ISSUER is set but there is no audience: set WORCA_IDENTITY_AUDIENCE or an exact host in WORCA_ALLOWED_HOSTS');
    // W2: with a shared issuer, a suffix entry would accept the Origin of every other instance
    // under the same domain. The issuer's audience check stops their tokens, not their pages.
    const suffixes = cfg.allowedHosts.filter((h) => h.startsWith('.'));
    if (suffixes.length) errors.push(`WORCA_ALLOWED_HOSTS: with WORCA_IDENTITY_ISSUER, list exact hosts only (remove ${suffixes.join(', ')})`);
  } else if (cfg.identity) {
    if (!cfg.identity.teamDomain) errors.push('WORCA_CF_ACCESS_AUD is set but WORCA_CF_ACCESS_TEAM_DOMAIN is not');
    if (!cfg.identity.aud) errors.push('WORCA_CF_ACCESS_TEAM_DOMAIN is set but WORCA_CF_ACCESS_AUD is not');
  }
  const remote = isRemoteMode(cfg);
  if (remote && !cfg.identity && !cfg.insecureNoIdentity) {
    errors.push('WORCA_ALLOWED_HOSTS is set but no identity check is configured: set WORCA_CF_ACCESS_TEAM_DOMAIN and WORCA_CF_ACCESS_AUD (or WORCA_IDENTITY_ISSUER), or set WORCA_INSECURE_NO_IDENTITY_CHECK=1 if a proxy you trust is the only way in');
  }
  if (remote && !cfg.identity && cfg.insecureNoIdentity) {
    warnings.push('WORCA_INSECURE_NO_IDENTITY_CHECK=1: worca checks no identity; anyone who reaches it controls this machine');
  }
  if (cfg.identity && cfg.insecureNoIdentity) {
    warnings.push(`WORCA_INSECURE_NO_IDENTITY_CHECK is ignored: ${identityLabel(cfg.identity)} is configured and enforced`);
  }
  if (cfg.identity && !remote) {
    const vars = cfg.identity.provider === 'issuer' ? 'WORCA_IDENTITY_ISSUER' : 'WORCA_CF_ACCESS_*';
    warnings.push(`${vars} is set but WORCA_ALLOWED_HOSTS is empty: only localhost requests are accepted`);
  }
  if (!LOOPBACK_BINDS.has(String(bindHost).toLowerCase()) && !remote) {
    const via = gateways.length ? ` or through Docker's gateway (${gateways.join(', ')})` : '';
    warnings.push(`listening on ${bindHost} but WORCA_ALLOWED_HOSTS is empty: only connections from this machine${via} are answered, every other caller gets a 403`);
  }
  return { errors, warnings };
}

/** "a Cloudflare Access check" | "an identity issuer check": for log lines and messages. */
export function identityLabel(identity) {
  if (!identity) return 'no identity check';
  return identity.provider === 'issuer' ? 'an identity issuer check' : 'a Cloudflare Access check';
}

/** (req) => true when Host is loopback or allowlisted and a browser Origin, if present, is this server.
 *  Header text only: in local mode createPeerGuard decides who may send them.
 *  G10: the Origin must name the Host exactly, port included (or an allowlisted public name, for a proxy
 *  that rewrites Host). A hostname match let a page on any other localhost port — a dev server, an Action
 *  an agent wrote — open /ws and read every run, and send body-less POSTs. No Origin = not a browser page. */
export function createHostGuard(allowedHosts = []) {
  const listed = (h) => allowedHosts.some((a) => (a.startsWith('.') ? h.endsWith(a) : h === a));
  const allowed = (name) => {
    if (!name) return false;
    const h = name.toLowerCase();
    return LOCAL_HOSTNAMES.has(h) || listed(h);
  };
  const originOk = (origin, host) => {
    let u;
    try { u = new URL(origin); } catch { return false; }   // 'null' (sandboxed or opaque pages) too
    if (u.host.toLowerCase() === String(host || '').toLowerCase()) return true;
    return listed(u.hostname.toLowerCase());
  };
  return function isAllowedRequest(req) {
    if (!allowed(hostnameOf(req.headers.host))) return false;
    const origin = req.headers.origin;
    if (origin && !originOk(origin, req.headers.host)) return false;
    return true;
  };
}

/**
 * A connection from inside this machine/container (`worca ui stop`, the CLI,
 * curl in a shell): a peer on this box (isThisBox) AND loopback Host. A proxy on another
 * host (cloudflared as its own service) never matches, so it is always checked.
 */
export function isInContainer(req, ifaces) {
  return isThisBox(req, ifaces) && LOCAL_HOSTNAMES.has(hostnameOf(req.headers.host));
}

/**
 * The one "is this caller on this box" test (G1, G4, isInContainer): a loopback peer (all of 127.0.0.0/8 and
 * ::1, v4-mapped or not, the set createPeerGuard trusts; any local user can bind 127.0.0.2) or one of this
 * machine's own interface addresses. Header text plays no part.
 */
export function isThisBox(req, ifaces) {
  return isLoopbackPeer(req?.socket?.remoteAddress) || isPeerThisMachine(req, ifaces);
}

const unmapV4 = (a) => String(a || '').replace(/^::ffff:/i, '').toLowerCase();

/** A loopback TCP peer address: 127.0.0.0/8 or ::1, v4-mapped or not. */
export function isLoopbackPeer(address) {
  const a = unmapV4(address);
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** The IPv4 gateways in a /proc/net/route table (Linux, hex little-endian), deduped. */
export function routeGateways(table) {
  const out = [];
  for (const line of String(table || '').split('\n').slice(1)) {
    const hex = line.trim().split(/\s+/)[2];
    if (!/^[0-9a-f]{8}$/i.test(hex || '') || /^0+$/.test(hex)) continue;
    const ip = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16)).join('.');
    if (!out.includes(ip)) out.push(ip);
  }
  return out;
}

/** This machine's route gateways, or [] where there is no /proc/net/route (macOS, Windows). */
export function readRouteGateways(read = () => fs.readFileSync('/proc/net/route', 'utf8')) {
  try { return routeGateways(read()); } catch { return []; }
}

/**
 * G4: who may talk to a local-mode server at all. The Host guard reads header text, so on a
 * non-loopback bind (WORCA_HOST=0.0.0.0) a network caller could send `Host: localhost` and get the
 * whole API, terminal included. Local mode therefore also needs a loopback TCP peer, or one of
 * `gateways`: in the worca image Docker's published port arrives from the container's gateway, while
 * a sidecar on the same network keeps its own address. Remote mode is unchanged: every caller there
 * passes the identity check, and isInContainer still requires a peer on this box (isThisBox).
 */
export function createPeerGuard(cfg, { gateways = [] } = {}) {
  if (isRemoteMode(cfg)) return () => true;
  const trusted = new Set(gateways.map(unmapV4));
  return (req) => {
    const peer = req?.socket?.remoteAddress;
    return isLoopbackPeer(peer) || trusted.has(unmapV4(peer));
  };
}
/**
 * The TCP peer is one of this machine's own addresses (any interface, loopback included).
 * With agent isolation on (#529 D4) such a caller may be the agent: the host guard reads only header
 * text, so isInContainer alone misses the container's eth0 (local mode's createPeerGuard refuses it too).
 */
export function isPeerThisMachine(req, ifaces) {
  ifaces ??= os.networkInterfaces();
  const peer = unmapV4(req?.socket?.remoteAddress);
  if (!peer) return false;
  for (const list of Object.values(ifaces || {})) for (const i of list || []) if (unmapV4(i?.address) === peer) return true;
  return false;
}

/**
 * The identity check for this config, or null when none applies (local mode,
 * or the explicit insecure flag). Provider-agnostic: returns
 * `(req) => Promise<{ email, sub, ... } | null>`; an issuer identity also carries
 * name, org, inst, teams and the token's exp (W4, W7). Rejects only when the provider
 * cannot be reached (the caller answers 503).
 */
export function createIdentityCheck(cfg, { fetchImpl, now } = {}) {
  if (!cfg.identity) return null;
  if (cfg.identity.provider === 'cloudflare-access') {
    const verify = createAccessVerifier({ teamDomain: cfg.identity.teamDomain, aud: cfg.identity.aud, fetchImpl, now });
    return (req) => verify(req.headers['cf-access-jwt-assertion']);
  }
  if (cfg.identity.provider === 'issuer') {
    const { issuer, jwksUrl, audience } = cfg.identity;
    const verify = createIssuerVerifier({ issuer, jwksUrl, audience, fetchImpl, now });
    return async (req) => {
      const v = req.headers[ISSUER_TOKEN_HEADER];
      const who = await verify(Array.isArray(v) ? v[0] : v);
      return who ? { ...who, provider: 'issuer' } : null;
    };
  }
  throw new Error(`unknown identity provider: ${cfg.identity.provider}`);
}
