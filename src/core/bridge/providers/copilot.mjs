// src/core/bridge/providers/copilot.mjs
// GitHub Copilot as a bridge provider (model-bridge-design.md §7): the device
// flow sign-in, the GitHub-token → short-lived Copilot-token exchange (cached
// in memory, never on disk), the request headers Copilot's gateway expects,
// the models list and the quota snapshot.
//
// The client id, the token-exchange endpoint and the editor headers are the
// values every community bridge sends (ericc-ch/copilot-api, MIT — see
// THIRD_PARTY_NOTICES.md). Worca identifies itself the same way because the
// gateway serves no other client.
//
// Every network call takes an injectable `fetch` so the whole module is
// testable against a stub without touching github.com.
//
// Every helper takes an optional `enterpriseHost` (a GHE.com tenant, like
// acme.ghe.com; null = github.com, the unchanged default). All URLs derive from
// it through ghe-host.mjs's gheUrls().

import { EFFORTS, REASONING_EFFORT_LEVELS } from '../../model-env.mjs';
import { GHE_COM_ACCOUNT_TYPE, normalizeGheHost, gheUrls, gheGatewayFallback, isTenantOrigin, isGithubClientId } from '../../ghe-host.mjs';

export const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
export const GITHUB_SCOPES = 'read:user';
export const GITHUB_BASE = 'https://github.com';
export const GITHUB_API = 'https://api.github.com';
export const COPILOT_API_VERSION = '2025-04-01';
const EDITOR_VERSION = 'vscode/1.104.0';
const PLUGIN_VERSION = 'copilot-chat/0.31.0';
const USER_AGENT = 'GitHubCopilotChat/0.31.0';

function noHostError() {
  return Object.assign(new Error('GitHub Copilot is set to a GHE.com tenant but has no valid host — set it on the Providers page (worca models set copilot enterpriseHost=<tenant>.ghe.com)'), { code: 'NO_HOST' });
}

/**
 * The GitHub host of a stored copilot config: null for github.com, the tenant for
 * accountType ghe-com. A ghe-com config without a valid host throws NO_HOST — a
 * tenant token must never be sent to github.com by accident.
 */
export function copilotAccountHost({ accountType, enterpriseHost } = {}) {
  if (accountType !== GHE_COM_ACCOUNT_TYPE) return null;
  const h = normalizeGheHost(enterpriseHost);
  if (!h) throw noHostError();
  return h;
}

/** A Copilot gateway origin GitHub operates (*.githubcopilot.com), over https. */
export function isGithubCopilotOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && (u.hostname === 'githubcopilot.com' || u.hostname.endsWith('.githubcopilot.com'));
  } catch { return false; }
}

/** The API host for an account type when the token exchange names none. */
export function copilotApiHost(accountType, enterpriseHost = null) {
  if (accountType === GHE_COM_ACCOUNT_TYPE) {
    const h = normalizeGheHost(enterpriseHost);
    if (!h) throw noHostError();
    return gheGatewayFallback(h);
  }
  if (accountType === 'business') return 'https://api.business.githubcopilot.com';
  if (accountType === 'enterprise') return 'https://api.enterprise.githubcopilot.com';
  return 'https://api.githubcopilot.com';
}

/**
 * The gateway a request goes to. Without a tenant: the exchange's `endpoints.api`, else the
 * account type's host (today's rule). On a tenant `endpoints.api` is used only when GitHub
 * operates it for that tenant (https, no port or credentials, *.<tenant> or *.githubcopilot.com);
 * anything else falls back to copilot-api.<tenant>.
 */
export function copilotGateway({ apiHost, accountType, enterpriseHost } = {}) {
  if (!enterpriseHost) return apiHost || copilotApiHost(accountType);
  const h = normalizeGheHost(enterpriseHost);
  if (!h) throw noHostError();
  return apiHost && (isTenantOrigin(apiHost, h) || isGithubCopilotOrigin(apiHost)) ? apiHost : gheGatewayFallback(h);
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
  // The CLI appends its mid-conversation system reminders AFTER the turn they
  // ride on (…, user[tool_result], system): the turn is the last message before them.
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i] && msgs[i].role === 'system') i -= 1;
  const last = msgs[i];
  if (!last) return 'user';
  if (last.role === 'assistant') return 'agent';
  if (Array.isArray(last.content) && last.content.some((b) => b?.type === 'tool_result')) return 'agent';
  return 'user';
}

/** The client id the device flow uses: a ghe-com block's own `clientId`, else Copilot's app. Never throws. */
export function copilotClientId(cfg) {
  return cfg && cfg.accountType === GHE_COM_ACCOUNT_TYPE && isGithubClientId(cfg.clientId) ? cfg.clientId : GITHUB_CLIENT_ID;
}

// ── GitHub's refusal of the token exchange ───────────────────────────────────

const REFUSAL_BODY_CAP = 8 * 1024;
const REFUSAL_MESSAGE_CAP = 300;

const httpsUrl = (v) => {
  if (typeof v !== 'string') return null;
  try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; }
};

/**
 * What GitHub said when it refused the Copilot token exchange: the reason
 * (`error_details.message` / `message`), its link, the notification id and the
 * `X-GitHub-SSO` header. Reads the body once (8 KB cap) and never throws, so it
 * can never replace a 401/403 with a parsing error.
 * @returns {Promise<{message:string|null, url:string|null, sso:{required:boolean,url:string|null}|null, notificationId:string|null}>}
 */
export async function readGithubRefusal(res) {
  const out = { message: null, url: null, sso: null, notificationId: null };
  try {
    const raw = typeof res?.text === 'function' ? String(await res.text()).slice(0, REFUSAL_BODY_CAP) : '';
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (body && typeof body === 'object') {
      const d = body.error_details && typeof body.error_details === 'object' ? body.error_details : {};
      const msg = [d.message, body.message].find((m) => typeof m === 'string' && m.trim());
      if (msg) {
        const clean = msg.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
        out.message = clean.length > REFUSAL_MESSAGE_CAP ? `${clean.slice(0, REFUSAL_MESSAGE_CAP)}…` : clean || null;
      }
      out.url = httpsUrl(d.url);
      if (typeof d.notification_id === 'string' && d.notification_id && d.notification_id.length <= 100) out.notificationId = d.notification_id;
    }
  } catch { /* an unreadable body is "no reason" */ }
  try {
    const v = res?.headers?.get?.('x-github-sso');
    if (typeof v === 'string' && v) {
      const m = /\burl=(\S+?)(?:[;,\s]|$)/.exec(v);
      out.sso = { required: /\brequired\b/.test(v), url: m ? httpsUrl(m[1]) : null };
    }
  } catch { /* no header */ }
  return out;
}

/** GitHub's reason as one sentence fragment; '' when it gave none. */
export function githubReasonText(g) {
  if (!g) return '';
  let text = '';
  if (g.message) text = `GitHub says: "${g.message}"${g.url ? ` (${g.url})` : ''}`;
  else if (g.url) text = `GitHub gave a link: ${g.url}`;
  if (g.sso && g.sso.required) {
    const sso = `single sign-on authorization is required${g.sso.url ? ` — ${g.sso.url}` : ''}`;
    text = text ? `${text}; ${sso}` : sso;
  }
  return text;
}

/**
 * The text for a Copilot refusal of a credential that is NOT stored (the
 * sign-in poll, a pasted token): never "stored token" / "sign in again".
 * @param {{host:string, status:number, login?:string, github?:object|null, via?:'sign-in'|'token', clientIdHint?:boolean}} p
 */
export function copilotRefusalText({ host, status, login = '', github = null, via = 'sign-in', clientIdHint = false }) {
  const lead = via === 'token'
    ? `GitHub refused Copilot access for this token on ${host} (${status})`
    : `the sign-in on ${host} worked${login ? ` (as ${login})` : ''}, but GitHub refused Copilot access (${status})`;
  const reason = githubReasonText(github);
  const step = host === 'github.com'
    ? 'Check that this GitHub account has a Copilot subscription or seat.'
    : `Ask your enterprise admin to check your Copilot seat and that the Copilot policy allows this editor${clientIdHint ? ', or set a client id your enterprise allows (Providers → GitHub Copilot → Client id)' : ''}.`;
  return `${lead}${reason ? `: ${reason}` : ' and gave no reason'}. ${step}`;
}

// ── device flow ──────────────────────────────────────────────────────────────

/**
 * Start the GitHub device flow. Returns the code the user types at
 * <host>/login/device plus the poll interval and the `host` it was issued on.
 * @param {{fetch?:typeof fetch, enterpriseHost?:string|null, clientId?:string}} [deps]
 */
export async function startDeviceFlow({ fetch: f = globalThis.fetch, enterpriseHost = null, clientId = GITHUB_CLIENT_ID } = {}) {
  const { host, web } = gheUrls(enterpriseHost);
  const r = await f(`${web}/login/device/code`, {
    method: 'POST', headers: githubHeaders(),
    body: JSON.stringify({ client_id: clientId, scope: GITHUB_SCOPES }),
  });
  if (!r.ok) {
    throw new Error(enterpriseHost
      ? `GitHub device flow could not start on ${host} (${r.status}) — check the host, and that your enterprise allows ${clientId === GITHUB_CLIENT_ID ? 'the GitHub Copilot app' : `the app with client id ${clientId}`}`
      : `GitHub device flow could not start (${r.status})`);
  }
  const j = await r.json();
  if (!j.device_code || !j.user_code) throw new Error('GitHub device flow: malformed response');
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri || `${web}/login/device`,
    interval: Number(j.interval) || 5,
    expiresIn: Number(j.expires_in) || 900,
    host,
  };
}

/**
 * One poll of the device flow. `{pending:true}` while the user has not
 * approved yet (also for slow_down, with `interval` raised), `{ok:true, token}`
 * once approved, `{error}` when the code expired or was denied.
 * @param {string} deviceCode
 * @param {{fetch?:typeof fetch, enterpriseHost?:string|null, clientId?:string}} [deps]
 */
export async function pollDeviceFlow(deviceCode, { fetch: f = globalThis.fetch, enterpriseHost = null, clientId = GITHUB_CLIENT_ID } = {}) {
  const { host, web } = gheUrls(enterpriseHost);
  const r = await f(`${web}/login/oauth/access_token`, {
    method: 'POST', headers: githubHeaders(),
    body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.access_token) return { ok: true, token: j.access_token };
  if (j.error === 'authorization_pending') return { pending: true };
  if (j.error === 'slow_down') return { pending: true, interval: Number(j.interval) || 10 };
  if (j.error === 'expired_token') return { error: 'the device code expired — start the sign-in again' };
  if (j.error === 'access_denied') return { error: `the sign-in was denied on ${host}` };
  return { error: j.error_description || j.error || `GitHub answered ${r.status}` };
}

/** The GitHub login of the token's user (display only). */
export async function githubLogin(githubToken, { fetch: f = globalThis.fetch, enterpriseHost = null } = {}) {
  const r = await f(`${gheUrls(enterpriseHost).api}/user`, { headers: githubHeaders(githubToken) });
  if (!r.ok) throw new Error(`GitHub /user answered ${r.status}`);
  const j = await r.json();
  return typeof j.login === 'string' ? j.login : '';
}

// ── token exchange (memory cache) ────────────────────────────────────────────

const REFRESH_MARGIN_S = 60;
const cache = new Map();   // `${host}\n${githubToken}` -> { token, expiresAt (ms), apiHost }
const refusalLogged = new Map();   // `${host}|${status}|${message}` -> last logged at (ms)
const REFUSAL_LOG_EVERY_MS = 10 * 60 * 1000;
const defaultLog = (line) => console.warn(line);
const cacheKey = (githubToken, enterpriseHost) => `${enterpriseHost || 'github.com'}\n${githubToken}`;

/** One server-log line per distinct refusal per 10 minutes; the GitHub token never appears in it. */
function logRefusal({ log, now, githubToken, url, host, status, github }) {
  const dedupeKey = `${host}|${status}|${github.message || ''}`;
  const at = now();
  const last = refusalLogged.get(dedupeKey);
  if (last !== undefined && at - last < REFUSAL_LOG_EVERY_MS) return;
  if (refusalLogged.size >= 100) {
    for (const [k, v] of refusalLogged) if (at - v >= REFUSAL_LOG_EVERY_MS) refusalLogged.delete(k);
  }
  refusalLogged.set(dedupeKey, at);
  const line = `[worca] copilot: token exchange ${url} answered ${status}${github.message ? `: ${github.message}` : ' with no reason'}`
    + `${github.url ? ` (${github.url})` : ''}${github.notificationId ? ` [notification ${github.notificationId}]` : ''}`
    + `${github.sso ? ` [sso${github.sso.required ? ' required' : ''}]` : ''}`;
  try { log(line.split(githubToken).join('[redacted]')); } catch { /* logging must not mask the refusal */ }
}

/**
 * A live Copilot token for `githubToken`, exchanged on first use and refreshed
 * before expiry. Returns `{token, apiHost}`; `apiHost` is the gateway the
 * exchange named (`endpoints.api`) or null.
 * @param {string} githubToken
 * A 401/403 throws `code: 'AUTH'` with the status, the `host` and GitHub's own
 * reason (`github`, see readGithubRefusal); the message is the STORED-token
 * wording, which the sign-in poll re-words from those fields.
 * @param {{fetch?:typeof fetch, now?:() => number, force?:boolean, enterpriseHost?:string|null, log?:(line:string)=>void}} [deps]
 */
export async function copilotToken(githubToken, { fetch: f = globalThis.fetch, now = Date.now, force = false, enterpriseHost = null, log = defaultLog } = {}) {
  if (!githubToken) throw Object.assign(new Error('not signed in to GitHub Copilot'), { code: 'NOT_SIGNED_IN' });
  const key = cacheKey(githubToken, enterpriseHost);
  const hit = cache.get(key);
  if (!force && hit && hit.expiresAt - now() > REFRESH_MARGIN_S * 1000) return { token: hit.token, apiHost: hit.apiHost };
  const url = `${gheUrls(enterpriseHost).api}/copilot_internal/v2/token`;
  const r = await f(url, { headers: githubHeaders(githubToken) });
  if (r.status === 401 || r.status === 403) {
    cache.delete(key);
    const github = await readGithubRefusal(r);
    const host = enterpriseHost || 'github.com';
    logRefusal({ log, now, githubToken, url, host, status: r.status, github });
    const reason = githubReasonText(github);
    throw Object.assign(
      new Error(`GitHub rejected the stored token (${r.status}) — sign in again${reason ? ` (${reason})` : ''}`),
      { code: 'AUTH', status: r.status, host, github },
    );
  }
  if (!r.ok) throw Object.assign(new Error(`Copilot token exchange answered ${r.status}`), { code: 'EXCHANGE', status: r.status });
  const j = await r.json();
  if (!j.token) throw Object.assign(new Error('Copilot token exchange: no token in the response (is Copilot enabled for this account?)'), { code: 'EXCHANGE' });
  const expiresAt = Number(j.expires_at) > 0 ? Number(j.expires_at) * 1000 : now() + 25 * 60 * 1000;
  const apiHost = j.endpoints && typeof j.endpoints.api === 'string' ? j.endpoints.api.replace(/\/+$/, '') : null;
  cache.set(key, { token: j.token, expiresAt, apiHost });
  return { token: j.token, apiHost };
}

/** Drop a cached Copilot token (after a 401 from the gateway). */
export function invalidateCopilotToken(githubToken, { enterpriseHost = null } = {}) { cache.delete(cacheKey(githubToken, enterpriseHost)); }
/** Test hook. */
export function _resetCopilotCache() { cache.clear(); refusalLogged.clear(); }

// ── models + quota ───────────────────────────────────────────────────────────

const REASONING_ID_RE = /^(o\d|gpt-5|codex|.*-thinking|.*reasoning)/i;

/** Normalize one entry of Copilot's /models list to worca's shape (§8.4). */
export function normalizeCopilotModel(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
  const caps = m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : {};
  const supports = caps.supports && typeof caps.supports === 'object' ? caps.supports : {};
  const limits = caps.limits && typeof caps.limits === 'object' ? caps.limits : {};
  const vendor = typeof m.vendor === 'string' ? m.vendor : '';
  // Copilot lists a model's reasoning-effort levels (an array); older payloads sent `true`.
  const efforts = Array.isArray(supports.reasoning_effort)
    ? REASONING_EFFORT_LEVELS.filter((e) => supports.reasoning_effort.includes(e))
    : null;
  const reasoning = (efforts !== null && efforts.some((e) => e !== 'none'))
    || supports.reasoning_effort === true || supports.thinking === true || REASONING_ID_RE.test(m.id);
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
    reasoningEfforts: efforts && efforts.length ? efforts : null,
    endpoints: Array.isArray(m.supported_endpoints) ? m.supported_endpoints.filter((e) => typeof e === 'string') : null,
    maxPromptTokens: Number(limits.max_prompt_tokens) || null,
    maxOutputTokens: Number(limits.max_output_tokens) || null,
    contextWindow: Number(limits.max_context_window_tokens) || null,
  };
}

/** Whether a normalized Copilot model is an Anthropic (Claude) one → native passthrough. */
export function isAnthropicVendor(m) {
  return /anthropic/i.test(m.vendor || '') || /^claude/i.test(m.id || '');
}

/**
 * The wire protocol an imported Copilot model is driven through
 * (2026-09-23-bridge-openai-responses-design.md §11): Anthropic models pass
 * through; an OpenAI model uses the Responses API whenever Copilot serves it
 * there (its reasoning then carries across tool turns); any other model uses
 * it only when Copilot serves it nowhere else; no endpoint list (legacy
 * models) → chat completions.
 */
export function copilotApiFor(m) {
  if (isAnthropicVendor(m)) return 'anthropic';
  const eps = Array.isArray(m.endpoints) ? m.endpoints : null;
  if (eps && eps.includes('/responses') && (/openai/i.test(m.vendor || '') || !eps.includes('/chat/completions'))) return 'openai-responses';
  return 'openai-chat';
}

/**
 * Worca efforts for an imported Copilot model: every effort (undefined) for an
 * Anthropic model; the Worca efforts among the model's listed levels when
 * Copilot lists them (all four → undefined; none in common → medium, which the
 * bridge maps to the nearest listed level); else every effort for a reasoning
 * model and medium otherwise.
 */
export function copilotEfforts(m) {
  if (isAnthropicVendor(m)) return undefined;
  if (Array.isArray(m.reasoningEfforts) && m.reasoningEfforts.length) {
    const eff = EFFORTS.filter((e) => m.reasoningEfforts.includes(e));
    if (!eff.length) return ['medium'];
    return eff.length === EFFORTS.length ? undefined : eff;
  }
  return m.reasoning ? undefined : ['medium'];
}

/** The catalog id a Copilot import gives model `id`. The one rule: the listing, the import and setup's
 *  pending roles all use it (provider-ops.mjs re-exports it). */
export const copilotCatalogId = (id) => `copilot-${id}`;

/** The catalog entry an import creates for a Copilot model (§8.4). */
export function catalogEntryForCopilotModel(m) {
  const api = copilotApiFor(m);
  const capabilities = {
    toolCalls: m.toolCalls, vision: m.vision, reasoning: m.reasoning,
    ...(m.maxPromptTokens ? { maxPromptTokens: m.maxPromptTokens } : {}),
    ...(m.maxOutputTokens ? { maxOutputTokens: m.maxOutputTokens } : {}),
    ...(api !== 'anthropic' && Array.isArray(m.reasoningEfforts) && m.reasoningEfforts.length ? { reasoningEfforts: m.reasoningEfforts } : {}),
  };
  return {
    id: copilotCatalogId(m.id),
    label: `${m.name} (Copilot)`,
    efforts: copilotEfforts(m),
    upstream: { provider: 'copilot', api, model: m.id, capabilities },
    cost: { free: true },
  };
}

/**
 * The Copilot models list, normalized. Chat models only.
 * @param {string} githubToken
 * @param {{accountType?:string, enterpriseHost?:string|null, fetch?:typeof fetch}} [deps]
 */
export async function listCopilotModels(githubToken, { accountType = 'individual', enterpriseHost = null, fetch: f = globalThis.fetch } = {}) {
  const { token, apiHost } = await copilotToken(githubToken, { fetch: f, enterpriseHost });
  const host = copilotGateway({ apiHost, accountType, enterpriseHost });
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
export async function copilotUsage(githubToken, { fetch: f = globalThis.fetch, enterpriseHost = null } = {}) {
  const r = await f(`${gheUrls(enterpriseHost).api}/copilot_internal/user`, { headers: githubHeaders(githubToken) });
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
