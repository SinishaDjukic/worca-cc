// src/broker/copilot.mjs
// GitHub Copilot inside the credential broker (plans/credential-broker-design.html §5.3).
// A person signs in on the key page with GitHub's device flow; the broker keeps their
// GitHub token sealed in the vault and, per request, exchanges it for Copilot's
// short-lived API token (cached until shortly before it expires). worca never sees
// either token. The editor headers and endpoints are the ones worca's own Copilot
// provider uses (src/core/bridge/providers/copilot.mjs), imported from there.
import { githubHeaders, GITHUB_API, GITHUB_BASE, GITHUB_CLIENT_ID, GITHUB_SCOPES } from '../core/bridge/providers/copilot.mjs';

export const DEFAULT_EXCHANGE_URL = `${GITHUB_API}/copilot_internal/v2/token`;
const REFRESH_MARGIN_MS = 60_000;

/** A Copilot API host must be GitHub's (the exchange response names it; never trust anything else). */
export function isCopilotHost(origin) {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && (u.hostname === 'githubcopilot.com' || u.hostname.endsWith('.githubcopilot.com'));
  } catch { return false; }
}

/**
 * The exchange, cached per GitHub token.
 * @param {{fetchImpl?:typeof fetch, exchangeUrl?:string, now?:()=>number, defaultHost?:string, allowHost?:(o:string)=>boolean}} o
 */
export function createCopilotExchange({ fetchImpl = globalThis.fetch, exchangeUrl = DEFAULT_EXCHANGE_URL, now = Date.now, defaultHost = 'https://api.githubcopilot.com', allowHost = isCopilotHost } = {}) {
  const cache = new Map();   // github token -> {token, host, expiresAt}
  return {
    /** {token, host} or throws with .status (401/403 = the GitHub sign-in no longer works). */
    async token(githubToken, { force = false } = {}) {
      const hit = cache.get(githubToken);
      if (!force && hit && hit.expiresAt - REFRESH_MARGIN_MS > now()) return hit;
      const res = await fetchImpl(exchangeUrl, { headers: githubHeaders(githubToken) });
      if (!res.ok) {
        cache.delete(githubToken);
        const err = new Error(res.status === 401 || res.status === 403
          ? `GitHub refused the sign-in (${res.status}): sign in to Copilot again`
          : `the Copilot token exchange failed (HTTP ${res.status})`);
        err.status = res.status;
        throw err;
      }
      const j = await res.json();
      if (!j || typeof j.token !== 'string') throw new Error('the Copilot token exchange returned no token');
      let host = defaultHost;
      const api = j.endpoints && typeof j.endpoints.api === 'string' ? j.endpoints.api.replace(/\/+$/, '') : null;
      if (api && allowHost(api)) host = new URL(api).origin;
      const expiresAt = Number.isFinite(j.expires_at) ? j.expires_at * 1000 : now() + 25 * 60_000;
      const v = { token: j.token, host, expiresAt };
      cache.set(githubToken, v);
      return v;
    },
    invalidate(githubToken) { cache.delete(githubToken); },
  };
}

/**
 * GitHub's device flow, step 1: a code for the person to enter at github.com/login/device.
 * `clientId`/`scope`: Copilot's own app by default; "push as me" passes the operator's
 * GitHub App or OAuth App (WORCA_BROKER_GITHUB_CLIENT_ID).
 */
export async function startDeviceFlow({ fetchImpl = globalThis.fetch, baseUrl = GITHUB_BASE, clientId = GITHUB_CLIENT_ID, scope = GITHUB_SCOPES } = {}) {
  const res = await fetchImpl(`${baseUrl}/login/device/code`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, ...(scope ? { scope } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub device sign-in failed (HTTP ${res.status})`);
  const j = await res.json();
  if (!j.device_code || !j.user_code) throw new Error('GitHub returned no device code');
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri || 'https://github.com/login/device', interval: Number(j.interval) || 5, expiresIn: Number(j.expires_in) || 900 };
}

/**
 * Step 2, polled: {token, refreshToken?, expiresIn?} once the person approved (a GitHub App
 * with expiring user tokens also returns a refresh token), {pending:true} before, {error}.
 */
export async function pollDeviceFlow(deviceCode, { fetchImpl = globalThis.fetch, baseUrl = GITHUB_BASE, clientId = GITHUB_CLIENT_ID } = {}) {
  const res = await fetchImpl(`${baseUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.access_token) {
    return {
      token: j.access_token,
      ...(j.refresh_token ? { refreshToken: j.refresh_token } : {}),
      ...(Number.isFinite(j.expires_in) ? { expiresIn: j.expires_in } : {}),
    };
  }
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { pending: true, slowDown: j.error === 'slow_down' };
  return { error: j.error_description || j.error || `HTTP ${res.status}` };
}

// ── "Push as me": a person's GitHub user token (credential broker, docs/credential-broker.md)

/**
 * A stored GitHub credential: a plain token (a pasted fine-grained token, an OAuth App
 * token that doesn't expire) or `{"t":…,"r":…,"e":…}` for a GitHub App user token with
 * its refresh token and expiry (ms). Pure.
 */
export function parseGithubSecret(secret) {
  const s = String(secret || '');
  if (s.startsWith('{')) {
    try { const j = JSON.parse(s); if (typeof j.t === 'string') return { token: j.t, refreshToken: j.r || null, expiresAt: Number(j.e) || null }; } catch { /* plain */ }
  }
  return { token: s, refreshToken: null, expiresAt: null };
}

export function githubSecretOf({ token, refreshToken = null, expiresIn = null }, now = Date.now()) {
  return refreshToken ? JSON.stringify({ t: token, r: refreshToken, e: expiresIn ? now + expiresIn * 1000 : null }) : token;
}

/** Refresh a GitHub App user token. Returns the new stored secret, or throws. */
export async function refreshGithubToken({ refreshToken, clientId, clientSecret, fetchImpl = globalThis.fetch, baseUrl = GITHUB_BASE, now = Date.now() }) {
  if (!clientSecret) throw new Error('the GitHub sign-in expired and the broker has no client secret to renew it: sign in again');
  const res = await fetchImpl(`${baseUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`GitHub would not renew the sign-in (${j.error || `HTTP ${res.status}`}): sign in again`);
  return githubSecretOf({ token: j.access_token, refreshToken: j.refresh_token || refreshToken, expiresIn: j.expires_in }, now);
}
