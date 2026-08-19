/**
 * Azure AD client-credentials token for Bot Framework outbound calls
 * (chat-connectivity-design.md §4.9): POST the app id/secret to the tenant's
 * v2 token endpoint with scope https://api.botframework.com/.default; cache
 * until 300s before expiry. Multi-tenant bots use the literal tenant
 * "botframework.com"; single-tenant bots use their Entra tenant GUID.
 */

export function createTokenProvider({
  appId, appPassword, tenantType = 'multi-tenant', tenantId = '',
  fetchFn = globalThis.fetch, now = Date.now,
}) {
  const tenant = tenantType === 'single-tenant' && tenantId ? tenantId : 'botframework.com';
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  let cached = null; // { token, expiresAt }

  return {
    async get() {
      if (cached && now() < cached.expiresAt) return cached.token;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: appId,
          client_secret: appPassword,
          scope: 'https://api.botframework.com/.default',
        }).toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) {
        const e = new Error(`AAD token failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
        e.kind = res.status === 400 || res.status === 401 ? 'auth' : 'network';
        throw e;
      }
      cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in || 3600) - 300) * 1000 };
      return cached.token;
    },
    /** Drop the cached token (e.g. after a 401) so the next get() re-fetches. */
    invalidate() { cached = null; },
  };
}
