/**
 * Bot Framework JWT validation, node:crypto only (chat-connectivity-design.md
 * §4.7/§4.9). The host forwards inbound Teams webhooks verbatim; THIS is the
 * security boundary that decides an Activity really came from the Bot
 * Framework service:
 *   - RS256 signature against Microsoft's JWKS (OpenID metadata -> jwks_uri,
 *     cached ~24h; unknown `kid` refetches at most once per 5 minutes)
 *   - iss === https://api.botframework.com
 *   - aud === our app id
 *   - exp / nbf with ±300s clock skew
 *   - the token's serviceUrl claim === the activity's serviceUrl (spoof guard)
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const OPENID_METADATA_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const EXPECTED_ISSUER = 'https://api.botframework.com';
const CLOCK_SKEW_SEC = 300;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
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
    const meta = await (await fetchFn(OPENID_METADATA_URL)).json();
    const jwks = await (await fetchFn(meta.jwks_uri)).json();
    keys = new Map();
    for (const jwk of jwks.keys || []) {
      if (!jwk.kid) continue;
      try { keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })); }
      catch { /* unsupported key type: skip */ }
    }
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

      let byKid = await loadKeys();
      let key = byKid.get(jwt.header.kid);
      if (!key && now() - lastMissFetch > KID_REFRESH_MIN_MS) {
        lastMissFetch = now();          // key rotation: refetch, throttled
        byKid = await loadKeys(true);
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
      if (Number.isFinite(p.exp) && nowSec > p.exp + CLOCK_SKEW_SEC) return { ok: false, reason: 'token expired' };
      if (Number.isFinite(p.nbf) && nowSec < p.nbf - CLOCK_SKEW_SEC) return { ok: false, reason: 'token not yet valid' };
      if (p.serviceurl && activityServiceUrl && p.serviceurl !== activityServiceUrl) {
        return { ok: false, reason: 'serviceUrl mismatch' };
      }
      return { ok: true, payload: p };
    },
  };
}
