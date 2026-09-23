// Cloudflare Access token verification (docs/remote-access.md). Access signs a
// short-lived RS256 JWT and sends it as `Cf-Access-Jwt-Assertion` on every
// request it lets through, WebSocket upgrades included. The team's public keys
// come from https://<team>/cdn-cgi/access/certs: cached 10 min, refetched on an
// unknown `kid` (key rotation) at most once per 30 s. node:crypto only.
import { createPublicKey, verify } from 'node:crypto';

const KEYS_TTL_MS = 600_000;
const REFETCH_MIN_MS = 30_000;
const CLOCK_SKEW_S = 30;

/** "acme.cloudflareaccess.com" (a scheme or trailing slash is tolerated) -> "acme.cloudflareaccess.com". */
export function normalizeTeamDomain(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * @returns {(token: string) => Promise<{ email: string|null, sub: string|null } | null>}
 *   resolves to the identity for a valid token, null for any invalid one; rejects
 *   only when the keys cannot be loaded (the caller answers 503, not 401).
 */
export function createAccessVerifier({ teamDomain, aud, fetchImpl = fetch, now = () => Date.now() }) {
  const domain = normalizeTeamDomain(teamDomain);
  if (!domain) throw new Error('createAccessVerifier: teamDomain is required');
  if (!aud) throw new Error('createAccessVerifier: aud is required');
  const issuer = `https://${domain}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  let keys = new Map();
  let fetchedAt = 0;
  let inflight = null;

  async function fetchKeys() {
    const res = await fetchImpl(certsUrl);
    if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
    const body = await res.json();
    const next = new Map();
    for (const k of Array.isArray(body?.keys) ? body.keys : []) {
      if (typeof k?.kid !== 'string' || k.kty !== 'RSA') continue;
      try { next.set(k.kid, createPublicKey({ key: k, format: 'jwk' })); } catch { /* skip a malformed key */ }
    }
    if (!next.size) throw new Error('Access certs: no usable RSA keys');
    keys = next;
    fetchedAt = now();
  }

  async function loadKeys(force) {
    const age = now() - fetchedAt;
    if (keys.size && age < (force ? REFETCH_MIN_MS : KEYS_TTL_MS)) return;
    // One fetch at a time: a burst of requests after expiry shares it.
    inflight ||= fetchKeys().finally(() => { inflight = null; });
    try {
      await inflight;
    } catch (err) {
      // Stale keys beat none: keep serving with them if the refresh fails.
      if (!keys.size) throw err;
    }
  }

  const decode = (seg) => JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));

  return async function verifyAccessJwt(token) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3 || parts.some((p) => !p)) return null;
    let header, payload;
    try { header = decode(parts[0]); payload = decode(parts[1]); } catch { return null; }
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    if (!payload || typeof payload !== 'object') return null;

    await loadKeys(false);
    if (!keys.has(header.kid)) await loadKeys(true);
    const key = keys.get(header.kid);
    if (!key) return null;

    let ok = false;
    try {
      ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    } catch { ok = false; }
    if (!ok) return null;

    const t = Math.floor(now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== issuer || !auds.includes(aud)) return null;
    if (typeof payload.exp !== 'number' || payload.exp < t - CLOCK_SKEW_S) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > t + CLOCK_SKEW_S) return null;
    return {
      email: typeof payload.email === 'string' ? payload.email : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    };
  };
}
