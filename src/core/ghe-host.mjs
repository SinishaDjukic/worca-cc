// src/core/ghe-host.mjs
// GitHub Enterprise Cloud with data residency lives at <tenant>.ghe.com. This leaf
// holds every rule about that host in one place: input normalisation, the URLs
// derived from it, which origins a tenant owns and which hosts an egress policy must
// let through. Zero imports, so settings, the Copilot helpers, the credential broker
// and the egress policy can all use it without a cycle.
//
// Self-hosted GitHub Enterprise Server (/api/v3) is NOT covered; a GHES variant would
// be one more branch in gheUrls().

export const GHE_COM_ACCOUNT_TYPE = 'ghe-com';

// <tenant>.ghe.com: the tenant is ONE DNS label — letters, digits and inner hyphens.
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ghe\.com$/;

/**
 * The bare lower-case tenant host for user input, or null when it is not one.
 * Accepts surrounding spaces, an `https://` prefix and one trailing `/`; refuses
 * everything else (path, port, credentials, query, http, the apex, nested hosts).
 */
export function normalizeGheHost(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith('https://')) s = s.slice('https://'.length);
  if (s.endsWith('/')) s = s.slice(0, -1);
  return HOST_RE.test(s) ? s : null;
}

/** The web and REST origins of a GitHub host (null → github.com). */
export function gheUrls(host) {
  if (!host) return { host: 'github.com', web: 'https://github.com', api: 'https://api.github.com' };
  return { host, web: `https://${host}`, api: `https://api.${host}` };
}

/** The Copilot gateway a tenant uses when the token exchange names none. */
export function gheGatewayFallback(host) {
  return `https://copilot-api.${host}`;
}

/**
 * Whether `origin` is a subdomain of tenant `host` served over plain https: no port,
 * no credentials. Look-alikes (acme.ghe.com.evil.example, evilacme.ghe.com) fail.
 */
export function isTenantOrigin(origin, host) {
  const h = normalizeGheHost(host);
  if (!h) return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && u.hostname.endsWith(`.${h}`);
  } catch { return false; }
}

/**
 * The tenant host a GitHub URL names: https://acme.ghe.com or https://api.acme.ghe.com
 * → acme.ghe.com; anything else (github.com, http, other hosts) → null.
 */
export function gheTenantOfUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const direct = normalizeGheHost(u.hostname);
    if (direct) return direct;
    return u.hostname.startsWith('api.') ? normalizeGheHost(u.hostname.slice(4)) : null;
  } catch { return null; }
}

/** The egress allow entries GitHub documents for Copilot on a tenant: the apex and its subdomains. */
export function gheEgressAllow(host) {
  const h = normalizeGheHost(host);
  return h ? [h, `.${h}`] : [];
}
