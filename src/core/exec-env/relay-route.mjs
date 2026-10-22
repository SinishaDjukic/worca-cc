// src/core/exec-env/relay-route.mjs
// Where one remote spawn's model calls go and which auth headers worca adds on its own side
// (plans/model-relay-design.md §4): Claude's (remoteModelRoute) and Codex's, Copilot's and Cursor's
// (engineModelRoute). The relay (model-relay.mjs) applies the result; the sandbox never holds the credential.
// Refuses (errorClass 'config') what a relay cannot carry.
import { createHash } from 'node:crypto';
import { modelCredential, engineCredential, ENGINE_SANDBOX } from './policy.mjs';
import { OAUTH_BETA, mergeBetas } from '../../broker/service.mjs';
import { isCopilotHost } from '../../broker/copilot.mjs';
import { pinnedEngineClis } from './backends/e2b-template.mjs';

const ANTHROPIC = 'https://api.anthropic.com';
const SIGNING_FLAGS = ['BEDROCK', 'VERTEX', 'FOUNDRY'];
const SECRET_NAME = /_(TOKEN|SECRET|KEY)$/i;
const ENTRY_KEYS = new Set(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']);
const FORBIDDEN_HEADER = /^(authorization|x-api-key|host|proxy-.*)$/i;

const refuse = (message) => Object.assign(new Error(message), { errorClass: 'config' });
let copilotVersion = null;
/** The pinned copilot version (docker/e2b/engine-clis.json), which copilot puts in editor-version. */
const copilotCliVersion = () => (copilotVersion ??= (() => { try { return pinnedEngineClis().copilot; } catch { return '1.0.100'; } })());
const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** Truthy for CLAUDE_CODE_USE_*: a non-empty value other than '0'/'false' (case-insensitive, trimmed). */
const truthy = (v) => { const s = str(v).toLowerCase(); return s !== '' && s !== '0' && s !== 'false'; };

function parseCustomHeaders(raw) {
  const out = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim(); const value = line.slice(i + 1).trim();
    if (!name) continue;
    if (FORBIDDEN_HEADER.test(name)) throw refuse(`This model's ANTHROPIC_CUSTOM_HEADERS sets ${name}, which worca controls on a relayed call. Pick Local for this model.`);
    out[name] = value;
  }
  return out;
}

/**
 * @param {{spawnEnv?:object, modelEnv?:object|null, serverEnv?:object, label:string}} o
 * @returns {{upstream:string, origin:string, firstParty:boolean, signed:boolean, authHeaders:(incoming:object)=>object, extraHeaders:Record<string,string>, secrets:string[]}}
 * `signed` false: worca adds no credential (a keyless gateway); the env logs the origin so a gateway 401 is explainable.
 * `firstParty`: the calls go to Anthropic's own API, which the CLI cannot tell behind the relay URL (remote-env envFor).
 */
export function remoteModelRoute({ spawnEnv = {}, modelEnv = null, serverEnv = {}, label }) {
  let url;
  try { url = new URL(str(spawnEnv?.ANTHROPIC_BASE_URL) || ANTHROPIC); } catch { throw refuse("This model's ANTHROPIC_BASE_URL is not a valid URL."); }
  if (url.username || url.password) throw refuse(`This model's ANTHROPIC_BASE_URL carries a user name or password, which never enters an ${label}. Pick Local for this model.`);
  // The relay appends the call's path (and its query) to the base: a query or fragment there cannot be extended.
  // The raw text too: `https://h/?` parses to an empty search.
  if (url.search || url.hash || /[?#]/.test(str(spawnEnv?.ANTHROPIC_BASE_URL))) {
    throw refuse("This model's ANTHROPIC_BASE_URL has a query or fragment, which the relay cannot extend. Pick Local for this model.");
  }
  // One parse decides both the first-party check and the host contacted.
  const origin = url.origin;
  const base = url.pathname === '/' ? origin : url.href;

  for (const x of SIGNING_FLAGS) {
    if (truthy(spawnEnv?.[`CLAUDE_CODE_USE_${x}`])) throw refuse(`This model signs its own requests (CLAUDE_CODE_USE_${x}), which an ${label} cannot relay. Pick Local for this model.`);
  }
  for (const k of Object.keys(modelEnv || {})) {
    if (SECRET_NAME.test(k) && !ENTRY_KEYS.has(k)) throw refuse(`This model's setting ${k} holds a secret, which never enters an ${label}. Pick Local for this model.`);
  }
  const extraHeaders = parseCustomHeaders(spawnEnv?.ANTHROPIC_CUSTOM_HEADERS);

  const authToken = str(modelEnv?.ANTHROPIC_AUTH_TOKEN);
  const apiKey = str(modelEnv?.ANTHROPIC_API_KEY);
  let authHeaders; let credential = null;
  if (authToken) { credential = authToken; authHeaders = () => ({ authorization: `Bearer ${authToken}` }); }
  else if (apiKey) { credential = apiKey; authHeaders = () => ({ 'x-api-key': apiKey }); }
  else if (origin === ANTHROPIC) {
    const server = modelCredential(serverEnv);
    if (!server) throw refuse("This model has no credential: there is no model credential in the worca server's environment.");
    if (server.CLAUDE_CODE_OAUTH_TOKEN) {
      credential = server.CLAUDE_CODE_OAUTH_TOKEN.trim();
      authHeaders = (incoming = {}) => ({ authorization: `Bearer ${credential}`, 'anthropic-beta': mergeBetas(incoming['anthropic-beta'], OAUTH_BETA) });
    } else { credential = server.ANTHROPIC_API_KEY.trim(); authHeaders = () => ({ 'x-api-key': credential }); }
  } else if (!str(modelEnv?.ANTHROPIC_BASE_URL) && str(serverEnv?.ANTHROPIC_BASE_URL) && str(spawnEnv?.ANTHROPIC_BASE_URL) === str(serverEnv.ANTHROPIC_BASE_URL)) {
    // The worca server's own env names this gateway (a local spawn inherits it with the server's key): sign it with
    // the server's gateway key. Never CLAUDE_CODE_OAUTH_TOKEN: that is a claude.ai login, not a third party's key.
    const token = str(serverEnv.ANTHROPIC_AUTH_TOKEN); const key = str(serverEnv.ANTHROPIC_API_KEY);
    if (token) { credential = token; authHeaders = () => ({ authorization: `Bearer ${token}` }); }
    else if (key) { credential = key; authHeaders = () => ({ 'x-api-key': key }); }
    else throw refuse(`The worca server's ANTHROPIC_BASE_URL points at ${origin}, but the server has no ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY for it. Set one, or pick Local for this model.`);
  } else authHeaders = () => ({});   // a third-party gateway without its own key: never the server credential

  const secrets = [...(credential ? [credential] : []), ...Object.values(extraHeaders).filter(Boolean)];
  return { upstream: base, origin, firstParty: origin === ANTHROPIC, signed: !!credential, authHeaders, extraHeaders, secrets };
}

// ── Codex, Copilot and Cursor (relay-other-engines spike, 2026-10-22) ──
// Each engine's CLI is pointed at the relay with a dummy credential in one plain header; worca signs every call here with
// the server's credential and forwards to the engine's one upstream. No engine credential, refresh token or derived
// token ever enters a sandbox.

/** The vendors' own APIs. RemoteExecEnv's `relayUpstreams` replaces them in tests only (a loopback fake). */
export const ENGINE_UPSTREAMS = Object.freeze({
  openai: 'https://api.openai.com/v1', github: 'https://api.github.com', copilotApi: null, cursor: 'https://api2.cursor.sh',
});
/** What a sandboxed CLI holds where its credential would be: never a secret, any CLI accepts it. */
export const RELAY_DUMMY = 'worca-relay-no-credential';
/** The env var codex's relay provider reads its (dummy) key from. */
export const CODEX_RELAY_KEY_ENV = 'WORCA_RELAY_KEY';
const COPILOT_CLI_API_VERSION = '2026-08-01';   // what copilot 1.0.100 sends (x-github-api-version)
const CURSOR_TOKEN_MARGIN_MS = 5 * 60_000;      // a Cursor access token is exchanged again this long before it expires
const CURSOR_TOKEN_FALLBACK_MS = 30 * 60_000;   // …or after this long when it names no expiry
const HOST_LOOKUP_MS = 15_000;
// The Connect calls one headless cursor-agent turn makes over HTTP/1.1 (useHttp1ForAgent), exact: each is signed with
// the person's access token and only RunSSE is metered, so no other method of these services passes. Not /auth/* (the
// key exchange is worca's), not AgentService/Run (HTTP/2 bidi, which the relay cannot carry).
const CURSOR_PATHS = Object.freeze([['POST', '/agent.v1.AgentService/RunSSE'], ['POST', '/aiserver.v1.AiService/GetUsableModels'],
  ['POST', '/aiserver.v1.BidiService/BidiAppend'], ['POST', '/aiserver.v1.DashboardService/GetMe']]);
// Not x-ghost-mode: privacy mode is the person's own Cursor setting, never the sandbox's to pick.
const CURSOR_FORWARD = Object.freeze(['connect-protocol-version', 'connect-timeout-ms', 'connect-content-encoding', 'content-encoding',
  'x-cursor-client-type', 'x-cursor-client-version', 'x-request-id', 'traceparent']);

const tomlStr = (s) => JSON.stringify(String(s));
const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const addAll = (list, values) => { for (const v of values || []) if (!list.includes(v)) list.push(v); };

/** A base URL a relay can extend: http(s), no user name or password, no query or fragment. */
function checkBase(raw, what) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw refuse(`${what} is not a valid URL.`); }
  if (!/^https?:$/.test(url.protocol)) throw refuse(`${what} is not an http(s) URL.`);
  if (url.username || url.password) throw refuse(`${what} carries a user name or password. Pick Local for this model.`);
  if (url.search || url.hash || /[?#]/.test(String(raw))) throw refuse(`${what} has a query or fragment, which the relay cannot extend. Pick Local for this model.`);
  return url.pathname === '/' ? url.origin : url.href.replace(/\/+$/, '');
}

/** `-c` overrides that make codex call the relay as a custom Responses provider with a dummy key and no WebSocket
 *  (OPENAI_BASE_URL is ignored by codex 0.163), plus the switches that stop its side traffic (curated plugins, apps,
 *  remote plugins, the updater, analytics): with them codex makes no call but the model's. */
export function codexRelayArgs(baseUrl) {
  const at = 'model_providers.worca_relay';
  return ['-c', 'model_provider="worca_relay"', '-c', `${at}.name="worca relay"`, '-c', `${at}.base_url=${tomlStr(baseUrl)}`,
    '-c', `${at}.wire_api="responses"`, '-c', `${at}.env_key=${tomlStr(CODEX_RELAY_KEY_ENV)}`, '-c', `${at}.supports_websockets=false`,
    '--disable', 'plugins', '--disable', 'apps', '--disable', 'remote_plugin', '--disable', 'in_app_updates', '-c', 'analytics.enabled=false'];
}

function codexRoute({ serverEnv, endpoint, upstreams, label }) {
  let upstream; let key; let headers = {};
  if (endpoint) {
    // A catalog model on its own OpenAI-compatible endpoint (codex-endpoint.mjs): worca calls it from here, so a
    // loopback endpoint works too, and its key and headers stay here.
    upstream = checkBase(endpoint.baseUrl, `This model's endpoint (${String(endpoint.baseUrl || '').slice(0, 100)})`);
    key = String(endpoint.apiKey || '');
    for (const [k, v] of Object.entries(endpoint.headers || {})) {
      if (FORBIDDEN_HEADER.test(k)) throw refuse(`This model's endpoint sets the ${k} header, which worca controls on a relayed call. Pick Local for this model.`);
      headers[k] = String(v);
    }
  } else {
    const cred = engineCredential('codex', serverEnv);
    if (cred.problem) throw refuse(cred.problem);
    key = cred.value;
    upstream = upstreams?.openai || ENGINE_UPSTREAMS.openai;
  }
  return {
    engine: 'codex', upstream, origin: new URL(upstream).origin, protocol: 'openai', call: `an OpenAI Responses call from codex in an ${label}`,
    allow: [['POST', '/responses'], ['GET', '/models']],
    authHeaders: () => (key ? { authorization: `Bearer ${key}` } : {}),
    extraHeaders: headers, forwardHeaders: [], secrets: [key, ...Object.values(headers)].filter(Boolean),
    spawn: (baseUrl) => ({ env: { [CODEX_RELAY_KEY_ENV]: RELAY_DUMMY }, args: codexRelayArgs(baseUrl) }),
  };
}

/** How copilot's offline (bring-your-own-key) mode talks to the relay for `model` (copilot's own id): Anthropic
 *  Messages for Claude models, the Responses API for the GPT-5 / o-series family, Chat Completions for the rest. */
export function copilotWire(model) {
  const m = String(model || '').toLowerCase();
  if (/^claude/.test(m)) return { type: 'anthropic', api: null, path: '/v1/messages' };
  if (/^(gpt-5|o\d|codex)/.test(m)) return { type: 'openai', api: 'responses', path: '/responses' };
  return { type: 'openai', api: 'completions', path: '/chat/completions' };
}

/** The Copilot API host for a fine-grained PAT, as the CLI finds it: `endpoints.api` of GET copilot_internal/user,
 *  GitHub's own host only (isCopilotHost). Cached per token in `cache`; a failed lookup is not cached. */
function copilotHost({ pat, upstreams, fetchImpl, cache }) {
  if (upstreams?.copilotApi) return Promise.resolve(upstreams.copilotApi);
  const key = `copilot-host:${sha(pat)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const r = await fetchImpl(`${(upstreams?.github || ENGINE_UPSTREAMS.github).replace(/\/+$/, '')}/copilot_internal/user`, {
      headers: { authorization: `Bearer ${pat}`, accept: 'application/json', 'x-github-api-version': COPILOT_CLI_API_VERSION },
      redirect: 'manual', signal: AbortSignal.timeout(HOST_LOOKUP_MS) });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} to the Copilot account lookup${r.status === 401 || r.status === 403 ? ': check that COPILOT_GITHUB_TOKEN has the Copilot Requests permission' : ''}`);
    const api = String((await r.json())?.endpoints?.api || '').replace(/\/+$/, '');
    if (!isCopilotHost(api)) throw new Error('GitHub named no Copilot API host for this account');
    return new URL(api).origin;
  })();
  cache.set(key, p);
  p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
  return p;
}

function copilotRoute({ serverEnv, spawnEnv, model, upstreams, fetchImpl, cache, label }) {
  const own = Object.keys(spawnEnv || {}).find((k) => /^COPILOT_PROVIDER_/.test(k));
  if (own) throw refuse(`This run's environment sets ${own}. In an ${label} worca points copilot at its model relay itself and takes no provider of your own. Remove ${own}, or pick Local.`);
  const cred = engineCredential('copilot', serverEnv);
  if (cred.problem) throw refuse(cred.problem);
  const pat = cred.value;
  const wire = copilotWire(model);
  return {
    engine: 'copilot', upstream: () => copilotHost({ pat, upstreams, fetchImpl, cache }), protocol: wire.type === 'anthropic' ? 'anthropic' : 'openai',
    call: `the ${wire.path} call copilot makes for ${model} in an ${label}`,
    allow: [['POST', wire.path]],
    // What copilot itself sends in online mode: the PAT as Bearer to the Copilot API, with the CLI's integration id.
    authHeaders: () => ({ authorization: `Bearer ${pat}` }),
    extraHeaders: { 'copilot-integration-id': 'copilot-developer-cli', 'editor-version': `copilot/${copilotCliVersion()}`,
      'x-github-api-version': COPILOT_CLI_API_VERSION, 'openai-intent': 'conversation-agent' },
    // Copilot's premium-request accounting reads these; the CLI still sends them in offline mode.
    forwardHeaders: ['x-initiator', 'x-interaction-type'],
    secrets: [pat],
    onStatus: (status) => { if (status === 401 || status === 404) cache.delete(`copilot-host:${sha(pat)}`); },
    spawn: (baseUrl) => ({ env: { COPILOT_OFFLINE: 'true', COPILOT_PROVIDER_BASE_URL: baseUrl, COPILOT_PROVIDER_API_KEY: RELAY_DUMMY,
      COPILOT_PROVIDER_TYPE: wire.type, ...(wire.api ? { COPILOT_PROVIDER_WIRE_API: wire.api } : {}) } }),
  };
}

/** The `exp` of a JWT, in ms, or null. */
function jwtExpiry(token) {
  try { const exp = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))?.exp; return Number.isFinite(exp) ? exp * 1000 : null; }
  catch { return null; }
}

/** Cursor's API key exchanged for an access token (POST /auth/exchange_user_api_key, as cursor-agent does with
 *  CURSOR_API_KEY), cached per key in `cache` until CURSOR_TOKEN_MARGIN_MS before its `exp`. Both tokens it returns go
 *  into `secrets`, so no reply can carry them into the sandbox. One exchange at a time per key. */
function cursorToken({ apiKey, origin, fetchImpl, now, cache, secrets }) {
  const key = `cursor-token:${sha(apiKey)}`;
  const hit = cache.get(key);
  if (hit?.token && hit.renewAt > now()) { addAll(secrets, hit.secrets); return Promise.resolve(hit.token); }
  if (hit?.pending) return hit.pending.then((t) => { addAll(secrets, cache.get(key)?.secrets); return t; });
  const pending = (async () => {
    const r = await fetchImpl(`${origin}/auth/exchange_user_api_key`, {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: '{}', redirect: 'manual', signal: AbortSignal.timeout(HOST_LOOKUP_MS) });
    if (!r.ok) throw new Error(`Cursor answered ${r.status} to the API key exchange${r.status === 401 || r.status === 403 ? ': check CURSOR_API_KEY' : ''}`);
    const j = await r.json();
    if (typeof j?.accessToken !== 'string' || !j.accessToken) throw new Error('Cursor returned no access token for the API key');
    const exp = jwtExpiry(j.accessToken);
    const got = [j.accessToken, ...(typeof j.refreshToken === 'string' ? [j.refreshToken] : [])];
    cache.set(key, { token: j.accessToken, secrets: got, renewAt: exp ? exp - CURSOR_TOKEN_MARGIN_MS : now() + CURSOR_TOKEN_FALLBACK_MS });
    return j.accessToken;
  })();
  cache.set(key, { pending });
  const out = pending.then((t) => { addAll(secrets, cache.get(key)?.secrets); return t; });
  out.catch(() => { if (cache.get(key)?.pending === pending) cache.delete(key); });
  return out;
}

function cursorRoute({ serverEnv, upstreams, fetchImpl, now, cache, label }) {
  const cred = engineCredential('cursor', serverEnv);
  if (cred.problem) throw refuse(cred.problem);
  const origin = String(upstreams?.cursor || ENGINE_UPSTREAMS.cursor).replace(/\/+$/, '');
  const secrets = [cred.value];
  return {
    engine: 'cursor', upstream: origin, origin, protocol: 'connect', call: `a Connect call cursor-agent makes over HTTP/1.1 in an ${label}`,
    allow: CURSOR_PATHS,
    authHeaders: async () => ({ authorization: `Bearer ${await cursorToken({ apiKey: cred.value, origin, fetchImpl, now, cache, secrets })}` }),
    extraHeaders: {}, forwardHeaders: CURSOR_FORWARD, responseHeaders: ['connect-content-encoding'], secrets,
    // A rejected access token: exchange the key again on the next call.
    onStatus: (status) => { if (status === 401) cache.delete(`cursor-token:${sha(cred.value)}`); },
    // No HTTPS_PROXY (cursor-agent ignores NO_PROXY); authless mode skips its DNS prewarm of api2.cursor.sh. The
    // HTTP/1.1 agent stream is set in its cli-config.json (CURSOR_CLI_CONFIG, written by the adapter).
    spawn: (baseUrl) => ({ env: { CURSOR_API_ENDPOINT: baseUrl, CURSOR_AUTH_TOKEN: RELAY_DUMMY, CURSOR_AGENT_CLI_AUTHLESS_MODE: 'true' } }),
  };
}

/** cursor-agent's config in the sandbox: its agent stream over HTTP/1.1 (RunSSE + BidiAppend), which the relay carries,
 *  instead of an HTTP/2 bidi stream, which it cannot. */
export const CURSOR_CLI_CONFIG = `${JSON.stringify({ network: { useHttp1ForAgent: true } }, null, 2)}\n`;

/**
 * Where one remote spawn of `engine` (codex, copilot, cursor) sends its model calls and how worca signs them: the
 * relay route (model-relay.mjs) plus `spawn(baseUrl)` → `{ env, args? }`, what the CLI is given to call the relay
 * with a dummy credential. Refuses (errorClass 'config') what a relay cannot carry or the server cannot sign.
 * `endpoint` (codex): codexEndpointSpawn's endpoint for the model; `cache`: the env's token and host cache.
 */
export function engineModelRoute({ engine, serverEnv = {}, spawnEnv = {}, model = null, endpoint = null, label, upstreams = null,
  fetchImpl = globalThis.fetch, now = Date.now, cache = new Map() }) {
  // By the upstream its sandbox row names (policy.mjs ENGINE_SANDBOX relay), never by engine name.
  const upstream = Object.hasOwn(ENGINE_SANDBOX, engine) ? ENGINE_SANDBOX[engine].relay?.upstream : null;
  if (upstream === 'openai') return codexRoute({ serverEnv, endpoint, upstreams, label });
  if (upstream === 'copilot') return copilotRoute({ serverEnv, spawnEnv, model, upstreams, fetchImpl, cache, label });
  if (upstream === 'cursor') return cursorRoute({ serverEnv, upstreams, fetchImpl, now, cache, label });
  throw refuse(`the ${engine} engine has no model route`);
}
