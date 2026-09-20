// src/core/bridge/providers/copilot.mjs
// GitHub Copilot as a bridge provider (model-bridge-design.md §7): the device
// flow sign-in, the GitHub-token → short-lived Copilot-token exchange (cached
// in memory, never on disk), the request headers Copilot's gateway expects,
// the models list and the quota snapshot.
//
// The client id, the token-exchange endpoint and the editor headers are the
// values every community bridge sends (ericc-ch/copilot-api, MIT — see
// THIRD_PARTY_NOTICES.md). Worca identifies itself the same way because the
// gateway serves no other client; the user acknowledges that once (§8.2).
//
// Every network call takes an injectable `fetch` so the whole module is
// testable against a stub without touching github.com.

export const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
export const GITHUB_SCOPES = 'read:user';
export const GITHUB_BASE = 'https://github.com';
export const GITHUB_API = 'https://api.github.com';
export const COPILOT_API_VERSION = '2025-04-01';
const EDITOR_VERSION = 'vscode/1.104.0';
const PLUGIN_VERSION = 'copilot-chat/0.31.0';
const USER_AGENT = 'GitHubCopilotChat/0.31.0';

/** The API host for an account type when the token exchange names none. */
export function copilotApiHost(accountType) {
  if (accountType === 'business') return 'https://api.business.githubcopilot.com';
  if (accountType === 'enterprise') return 'https://api.enterprise.githubcopilot.com';
  return 'https://api.githubcopilot.com';
}

/** Headers for github.com / api.github.com calls (device flow, exchange, user). */
export function githubHeaders(githubToken) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(githubToken ? { authorization: `token ${githubToken}` } : {}),
    'editor-version': EDITOR_VERSION,
    'editor-plugin-version': PLUGIN_VERSION,
    'user-agent': USER_AGENT,
    'x-github-api-version': COPILOT_API_VERSION,
  };
}

/**
 * Headers for a Copilot gateway call (§7.1).
 * @param {string} copilotToken
 * @param {{vision?:boolean, initiator?:'user'|'agent', requestId?:string}} [opts]
 */
export function copilotHeaders(copilotToken, { vision = false, initiator = 'user', requestId } = {}) {
  return {
    authorization: `Bearer ${copilotToken}`,
    'content-type': 'application/json',
    'copilot-integration-id': 'vscode-chat',
    'editor-version': EDITOR_VERSION,
    'editor-plugin-version': PLUGIN_VERSION,
    'user-agent': USER_AGENT,
    'openai-intent': 'conversation-panel',
    'x-github-api-version': COPILOT_API_VERSION,
    'x-request-id': requestId || cryptoRandomId(),
    'x-initiator': initiator === 'agent' ? 'agent' : 'user',
    ...(vision ? { 'copilot-vision-request': 'true' } : {}),
  };
}

function cryptoRandomId() {
  // UUID v4 without importing crypto at module load (keeps the leaf cheap).
  const h = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}

/** Whether a Messages request carries an image (→ copilot-vision-request). */
export function bodyHasImage(body) {
  const msgs = body && Array.isArray(body.messages) ? body.messages : [];
  for (const m of msgs) {
    if (!Array.isArray(m?.content)) continue;
    for (const b of m.content) {
      if (b?.type === 'image') return true;
      if (b?.type === 'tool_result' && Array.isArray(b.content) && b.content.some((x) => x?.type === 'image')) return true;
    }
  }
  return false;
}

/** 'agent' when the last message continues a tool loop, else 'user' (§7.1). */
export function requestInitiator(body) {
  const msgs = body && Array.isArray(body.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  if (!last) return 'user';
  if (last.role === 'assistant') return 'agent';
  if (Array.isArray(last.content) && last.content.some((b) => b?.type === 'tool_result')) return 'agent';
  return 'user';
}

// ── device flow ──────────────────────────────────────────────────────────────

/**
 * Start the GitHub device flow. Returns the code the user types at
 * github.com/login/device plus the poll interval.
 * @param {{fetch?:typeof fetch}} [deps]
 */
export async function startDeviceFlow({ fetch: f = globalThis.fetch } = {}) {
  const r = await f(`${GITHUB_BASE}/login/device/code`, {
    method: 'POST', headers: githubHeaders(),
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPES }),
  });
  if (!r.ok) throw new Error(`GitHub device flow could not start (${r.status})`);
  const j = await r.json();
  if (!j.device_code || !j.user_code) throw new Error('GitHub device flow: malformed response');
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri || `${GITHUB_BASE}/login/device`,
    interval: Number(j.interval) || 5,
    expiresIn: Number(j.expires_in) || 900,
  };
}

/**
 * One poll of the device flow. `{pending:true}` while the user has not
 * approved yet (also for slow_down, with `interval` raised), `{ok:true, token}`
 * once approved, `{error}` when the code expired or was denied.
 * @param {string} deviceCode
 * @param {{fetch?:typeof fetch}} [deps]
 */
export async function pollDeviceFlow(deviceCode, { fetch: f = globalThis.fetch } = {}) {
  const r = await f(`${GITHUB_BASE}/login/oauth/access_token`, {
    method: 'POST', headers: githubHeaders(),
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.access_token) return { ok: true, token: j.access_token };
  if (j.error === 'authorization_pending') return { pending: true };
  if (j.error === 'slow_down') return { pending: true, interval: Number(j.interval) || 10 };
  if (j.error === 'expired_token') return { error: 'the device code expired — start the sign-in again' };
  if (j.error === 'access_denied') return { error: 'the sign-in was denied on github.com' };
  return { error: j.error_description || j.error || `GitHub answered ${r.status}` };
}

/** The GitHub login of the token's user (display only). */
export async function githubLogin(githubToken, { fetch: f = globalThis.fetch } = {}) {
  const r = await f(`${GITHUB_API}/user`, { headers: githubHeaders(githubToken) });
  if (!r.ok) throw new Error(`GitHub /user answered ${r.status}`);
  const j = await r.json();
  return typeof j.login === 'string' ? j.login : '';
}

// ── token exchange (memory cache) ────────────────────────────────────────────

const REFRESH_MARGIN_S = 60;
const cache = new Map();   // githubToken -> { token, expiresAt (ms), apiHost }

/**
 * A live Copilot token for `githubToken`, exchanged on first use and refreshed
 * before expiry. Returns `{token, apiHost}`; `apiHost` is the gateway the
 * exchange named (`endpoints.api`) or null.
 * @param {string} githubToken
 * @param {{fetch?:typeof fetch, now?:() => number, force?:boolean}} [deps]
 */
export async function copilotToken(githubToken, { fetch: f = globalThis.fetch, now = Date.now, force = false } = {}) {
  if (!githubToken) throw Object.assign(new Error('not signed in to GitHub Copilot'), { code: 'NOT_SIGNED_IN' });
  const hit = cache.get(githubToken);
  if (!force && hit && hit.expiresAt - now() > REFRESH_MARGIN_S * 1000) return { token: hit.token, apiHost: hit.apiHost };
  const r = await f(`${GITHUB_API}/copilot_internal/v2/token`, { headers: githubHeaders(githubToken) });
  if (r.status === 401 || r.status === 403) {
    cache.delete(githubToken);
    throw Object.assign(new Error(`GitHub rejected the stored token (${r.status}) — sign in again`), { code: 'AUTH', status: r.status });
  }
  if (!r.ok) throw Object.assign(new Error(`Copilot token exchange answered ${r.status}`), { code: 'EXCHANGE', status: r.status });
  const j = await r.json();
  if (!j.token) throw Object.assign(new Error('Copilot token exchange: no token in the response (is Copilot enabled for this account?)'), { code: 'EXCHANGE' });
  const expiresAt = Number(j.expires_at) > 0 ? Number(j.expires_at) * 1000 : now() + 25 * 60 * 1000;
  const apiHost = j.endpoints && typeof j.endpoints.api === 'string' ? j.endpoints.api.replace(/\/+$/, '') : null;
  cache.set(githubToken, { token: j.token, expiresAt, apiHost });
  return { token: j.token, apiHost };
}

/** Drop a cached Copilot token (after a 401 from the gateway). */
export function invalidateCopilotToken(githubToken) { cache.delete(githubToken); }
/** Test hook. */
export function _resetCopilotCache() { cache.clear(); }

// ── models + quota ───────────────────────────────────────────────────────────

const REASONING_ID_RE = /^(o\d|gpt-5|codex|.*-thinking|.*reasoning)/i;

/** Normalize one entry of Copilot's /models list to worca's shape (§8.4). */
export function normalizeCopilotModel(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
  const caps = m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : {};
  const supports = caps.supports && typeof caps.supports === 'object' ? caps.supports : {};
  const limits = caps.limits && typeof caps.limits === 'object' ? caps.limits : {};
  const vendor = typeof m.vendor === 'string' ? m.vendor : '';
  const reasoning = supports.reasoning_effort === true || supports.thinking === true || REASONING_ID_RE.test(m.id);
  return {
    id: m.id,
    name: typeof m.name === 'string' && m.name ? m.name : m.id,
    vendor,
    family: typeof caps.family === 'string' ? caps.family : '',
    type: typeof caps.type === 'string' ? caps.type : '',
    preview: m.preview === true,
    pickerEnabled: m.model_picker_enabled !== false,
    policyState: m.policy && typeof m.policy === 'object' && typeof m.policy.state === 'string' ? m.policy.state : 'enabled',
    toolCalls: supports.tool_calls !== false,
    vision: supports.vision === true,
    reasoning,
    maxPromptTokens: Number(limits.max_prompt_tokens) || null,
    maxOutputTokens: Number(limits.max_output_tokens) || null,
    contextWindow: Number(limits.max_context_window_tokens) || null,
  };
}

/** Whether a normalized Copilot model is an Anthropic (Claude) one → native passthrough. */
export function isAnthropicVendor(m) {
  return /anthropic/i.test(m.vendor || '') || /^claude/i.test(m.id || '');
}

/** The catalog entry an import creates for a Copilot model (§8.4). */
export function catalogEntryForCopilotModel(m) {
  const anthropic = isAnthropicVendor(m);
  const capabilities = {
    toolCalls: m.toolCalls, vision: m.vision, reasoning: m.reasoning,
    ...(m.maxPromptTokens ? { maxPromptTokens: m.maxPromptTokens } : {}),
    ...(m.maxOutputTokens ? { maxOutputTokens: m.maxOutputTokens } : {}),
  };
  return {
    id: `copilot-${m.id}`,
    label: `${m.name} (Copilot)`,
    efforts: anthropic || m.reasoning ? undefined : ['medium'],
    upstream: { provider: 'copilot', api: anthropic ? 'anthropic' : 'openai-chat', model: m.id, capabilities },
    cost: { free: true },
  };
}

/**
 * The Copilot models list, normalized. Chat models only.
 * @param {string} githubToken
 * @param {{accountType?:string, fetch?:typeof fetch}} [deps]
 */
export async function listCopilotModels(githubToken, { accountType = 'individual', fetch: f = globalThis.fetch } = {}) {
  const { token, apiHost } = await copilotToken(githubToken, { fetch: f });
  const host = apiHost || copilotApiHost(accountType);
  const r = await f(`${host}/models`, { headers: copilotHeaders(token) });
  if (!r.ok) throw Object.assign(new Error(`Copilot /models answered ${r.status}`), { status: r.status });
  const j = await r.json();
  const data = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
  return data.map(normalizeCopilotModel).filter((m) => m && (!m.type || m.type === 'chat'));
}

/**
 * The premium-request quota snapshot, or null when the account exposes none.
 * @returns {Promise<{used:number|null, entitlement:number|null, remaining:number|null, percentRemaining:number|null, unlimited:boolean, resetDate:string|null}|null>}
 */
export async function copilotUsage(githubToken, { fetch: f = globalThis.fetch } = {}) {
  const r = await f(`${GITHUB_API}/copilot_internal/user`, { headers: githubHeaders(githubToken) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const q = j && j.quota_snapshots && j.quota_snapshots.premium_interactions;
  if (!q || typeof q !== 'object') return null;
  const entitlement = Number.isFinite(Number(q.entitlement)) ? Number(q.entitlement) : null;
  const remaining = Number.isFinite(Number(q.remaining)) ? Number(q.remaining) : null;
  return {
    used: entitlement != null && remaining != null ? Math.max(0, entitlement - remaining) : null,
    entitlement,
    remaining,
    percentRemaining: Number.isFinite(Number(q.percent_remaining)) ? Number(q.percent_remaining) : null,
    unlimited: q.unlimited === true,
    resetDate: typeof j.quota_reset_date === 'string' ? j.quota_reset_date : null,
  };
}
