/**
 * Bot Framework JWT validation, node:crypto only (chat-connectivity-design.md
 * §4.7/§4.9). The host forwards inbound Teams webhooks verbatim; THIS is the
 * security boundary that decides an Activity really came from the Bot
 * Framework service:
 *   - RS256 signature against Microsoft's JWKS (OpenID metadata -> jwks_uri,
 *     cached ~24h; unknown `kid` refetches at most once per 5 minutes). A JWKS
 *     outage falls back to the cache for up to 7 days, then rejects (401) —
 *     it never throws out of validate().
 *   - iss === https://api.botframework.com
 *   - aud === our app id
 *   - a numeric exp is MANDATORY; exp / nbf with ±300s clock skew
 *   - the token's serviceUrl claim === the activity's serviceUrl (spoof guard)
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const OPENID_METADATA_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const EXPECTED_ISSUER = 'https://api.botframework.com';
const CLOCK_SKEW_SEC = 300;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const JWKS_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const KID_REFRESH_MIN_MS = 5 * 60 * 1000;

const b64urlToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64urlToBuf(parts[0]).toString('utf8')),
      payload: JSON.parse(b64urlToBuf(parts[1]).toString('utf8')),
      signed: `${parts[0]}.${parts[1]}`,
      signature: b64urlToBuf(parts[2]),
    };
  } catch {
    return null;
  }
}

/** JWKS cache + validator factory. fetchFn/now injectable for tests. */
export function createJwtValidator({ appId, fetchFn = globalThis.fetch, now = Date.now }) {
  let keys = null;         // kid -> KeyObject
  let fetchedAt = 0;
  let lastMissFetch = 0;

  async function loadKeys(force = false) {
    if (!force && keys && now() - fetchedAt < JWKS_TTL_MS) return keys;
    const metaRes = await fetchFn(OPENID_METADATA_URL);
    if (!metaRes.ok) throw new Error(`openid metadata fetch failed: HTTP ${metaRes.status}`);
    const meta = await metaRes.json();
    const jwksRes = await fetchFn(meta.jwks_uri);
    if (!jwksRes.ok) throw new Error(`jwks fetch failed: HTTP ${jwksRes.status}`);
    const jwks = await jwksRes.json();
    // Build into a local and swap only on success: a malformed or empty JWKS
    // response must never poison a good cache.
    const next = new Map();
    for (const jwk of jwks.keys || []) {
      if (!jwk.kid) continue;
      try { next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })); }
      catch { /* unsupported key type: skip */ }
    }
    if (!next.size) throw new Error('jwks contained no usable keys');
    keys = next;
    fetchedAt = now();
    return keys;
  }

  return {
    /**
     * @param {string} authHeader "Bearer <jwt>"
     * @param {string} activityServiceUrl the Activity's serviceUrl field
     * @returns {Promise<{ok:true, payload:object}|{ok:false, reason:string}>}
     */
    async validate(authHeader, activityServiceUrl) {
      const m = /^Bearer\s+(.+)$/i.exec(String(authHeader || ''));
      if (!m) return { ok: false, reason: 'missing bearer token' };
      const jwt = decodeJwt(m[1]);
      if (!jwt) return { ok: false, reason: 'malformed token' };
      if (jwt.header.alg !== 'RS256') return { ok: false, reason: `unexpected alg ${jwt.header.alg}` };

      let byKid;
      try { byKid = await loadKeys(); } catch (err) {
        // Outage: a stale cache (bounded) beats rejecting all valid traffic;
        // no cache (or too stale) -> clean 401, never an escaped throw.
        if (!keys || now() - fetchedAt > JWKS_STALE_MAX_MS) {
          return { ok: false, reason: `jwks unavailable: ${err.message}` };
        }
        byKid = keys;
      }
      let key = byKid.get(jwt.header.kid);
      if (!key && now() - lastMissFetch > KID_REFRESH_MIN_MS) {
        lastMissFetch = now();          // key rotation: refetch, throttled
        try { byKid = await loadKeys(true); } catch { /* keep the cache */ }
        key = byKid.get(jwt.header.kid);
      }
      if (!key) return { ok: false, reason: 'unknown signing key' };
      if (!cryptoVerify('RSA-SHA256', Buffer.from(jwt.signed), key, jwt.signature)) {
        return { ok: false, reason: 'bad signature' };
      }

      const p = jwt.payload;
      const nowSec = Math.floor(now() / 1000);
      if (p.iss !== EXPECTED_ISSUER) return { ok: false, reason: 'bad issuer' };
      if (p.aud !== appId) return { ok: false, reason: 'bad audience' };
      // exp is MANDATORY: a signed token without a numeric exp must not become
      // a non-expiring credential on the public webhook.
      if (!Number.isFinite(p.exp)) return { ok: false, reason: 'missing or non-numeric exp' };
      if (nowSec > p.exp + CLOCK_SKEW_SEC) return { ok: false, reason: 'token expired' };
      if (p.nbf !== undefined && (!Number.isFinite(p.nbf) || nowSec < p.nbf - CLOCK_SKEW_SEC)) {
        return { ok: false, reason: 'token not yet valid' };
      }
      if (p.serviceurl && activityServiceUrl && p.serviceurl !== activityServiceUrl) {
        return { ok: false, reason: 'serviceUrl mismatch' };
      }
      return { ok: true, payload: p };
    },
  };
}
