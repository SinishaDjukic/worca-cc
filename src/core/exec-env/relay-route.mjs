// src/core/exec-env/relay-route.mjs
// Where one remote spawn's model calls go and which auth headers worca adds on its own side
// (plans/model-relay-design.md §4): Claude's (remoteModelRoute), Codex's, Copilot's and Cursor's (engineModelRoute),
// and, per sign-in mode, Gemini CLI's, Qwen Code's, Goose's and OpenCode's (MODE_ROUTES). The relay (model-relay.mjs)
// applies the result; the sandbox never holds the credential.
// Refuses (errorClass 'config') what a relay cannot carry.
import { createHash } from 'node:crypto';
import { isResolved, engineCredential, modelCredential, modeCredential } from './credentials.mjs';
import { engineEntry } from '../../shared/engine-switch.mjs';
import { OAUTH_BETA, mergeBetas } from '../../broker/service.mjs';
import { isCopilotHost } from '../../broker/copilot.mjs';
import { pinnedEngineClis } from './backends/e2b-template.mjs';
import { cursorAccessToken, invalidateCursorToken, CURSOR_PATHS, CURSOR_FORWARD } from '../../broker/cursor.mjs';
import { COPILOT_CLI_API_VERSION } from '../../broker/copilot-token.mjs';
export { resolveModelRoute, isResolved, localServerEnv } from './credentials.mjs';

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
const HOST_LOOKUP_MS = 15_000;
// Cursor's key exchange and its Connect call shapes (CURSOR_PATHS, CURSOR_FORWARD) live in src/broker/cursor.mjs: the
// broker's cursor slot does the same exchange, one copy.

const tomlStr = (s) => JSON.stringify(String(s));
const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

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
    spawn: (baseUrl) => CLI_POINTING.openai.spawn(baseUrl, RELAY_DUMMY),
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

/** How a CLI is pointed at a relay route or a broker slot, per catalog relay.upstream: the env (and codex's args) with
 *  `credential` (RELAY_DUMMY for the relay, the spawn's wbt_ token for the broker) in its key slot. `suffix`: what the
 *  CLI's base needs after a broker slot URL (the openai slot's paths start with /v1). Claude is pointed by its model
 *  env (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN), as runViaBroker and RemoteExecEnv do today. */
export const CLI_POINTING = Object.freeze({
  openai: { suffix: '/v1', spawn: (baseUrl, credential) => ({ env: { [CODEX_RELAY_KEY_ENV]: credential }, args: codexRelayArgs(baseUrl) }) },
  copilot: { suffix: '', spawn: (baseUrl, credential, model) => {
    const wire = copilotWire(model);
    return { env: { COPILOT_OFFLINE: 'true', COPILOT_PROVIDER_BASE_URL: baseUrl, COPILOT_PROVIDER_API_KEY: credential,
      COPILOT_PROVIDER_TYPE: wire.type, ...(wire.api ? { COPILOT_PROVIDER_WIRE_API: wire.api } : {}) }, args: [] };
  } },
  // No HTTPS_PROXY (cursor-agent ignores NO_PROXY); authless mode skips its DNS prewarm of api2.cursor.sh. The HTTP/1.1
  // agent stream is set in its cli-config.json (CURSOR_CLI_CONFIG, written by the adapter).
  cursor: { suffix: '', spawn: (baseUrl, credential) => ({ env: { CURSOR_API_ENDPOINT: baseUrl, CURSOR_AUTH_TOKEN: credential,
    CURSOR_AGENT_CLI_AUTHLESS_MODE: 'true' }, args: [] }) },
});
/** Every name CLI_POINTING may set for `upstream`, and every other provider credential source the CLI would read in
 *  their place: an adapter deletes them from the child env before it points the CLI, so an ambient value
 *  (COPILOT_PROVIDER_WIRE_API for an anthropic-type model, a COPILOT_PROVIDER_API_KEY_COMMAND, say) never survives. */
export const POINTING_NAMES = Object.freeze({
  openai: [CODEX_RELAY_KEY_ENV], copilot: ['COPILOT_OFFLINE', 'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_WIRE_API',
    'COPILOT_PROVIDER_BEARER_TOKEN', 'COPILOT_PROVIDER_API_KEY_COMMAND'],
  cursor: ['CURSOR_API_ENDPOINT', 'CURSOR_AUTH_TOKEN', 'CURSOR_AGENT_CLI_AUTHLESS_MODE'],
});
// copilot's own provider names (catalog relayOwned): a run env that sets one is refused in a sandbox.
const PROVIDER_NAMES = new Set(['COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_WIRE_API',
  'COPILOT_PROVIDER_BEARER_TOKEN', 'COPILOT_PROVIDER_API_KEY_COMMAND']);

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
  const own = Object.keys(spawnEnv || {}).find((k) => PROVIDER_NAMES.has(k));
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
    spawn: (baseUrl) => CLI_POINTING.copilot.spawn(baseUrl, RELAY_DUMMY, model),
  };
}

function cursorRoute({ serverEnv, upstreams, fetchImpl, now, cache, label }) {
  const cred = engineCredential('cursor', serverEnv);
  if (cred.problem) throw refuse(cred.problem);
  const origin = String(upstreams?.cursor || ENGINE_UPSTREAMS.cursor).replace(/\/+$/, '');
  const secrets = [cred.value];
  return {
    engine: 'cursor', upstream: origin, origin, protocol: 'connect', call: `a Connect call cursor-agent makes over HTTP/1.1 in an ${label}`,
    allow: CURSOR_PATHS,
    authHeaders: async () => ({ authorization: `Bearer ${await cursorAccessToken({ apiKey: cred.value, origin, fetchImpl, now, cache, secrets })}` }),
    extraHeaders: {}, forwardHeaders: CURSOR_FORWARD, responseHeaders: ['connect-content-encoding'], secrets,
    // A rejected access token: exchange the key again on the next call.
    onStatus: (status) => { if (status === 401) invalidateCursorToken(cache, cred.value); },
    spawn: (baseUrl) => CLI_POINTING.cursor.spawn(baseUrl, RELAY_DUMMY),
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
  const upstream = engineEntry(engine)?.relay?.upstream;
  if (upstream === 'openai') return codexRoute({ serverEnv, endpoint, upstreams, label });
  if (upstream === 'copilot') return copilotRoute({ serverEnv, spawnEnv, model, upstreams, fetchImpl, cache, label });
  if (upstream === 'cursor') return cursorRoute({ serverEnv, upstreams, fetchImpl, now, cache, label });
  throw refuse(`the ${engine} engine has no model route`);
}

/**
 * The relay route for a resolved decision (resolveModelRoute, kind 'relayed'): Claude's (remoteModelRoute, from the
 * composed spawn env and model env, as today) or an engine route. With a broker `lease`, the route's upstream is the
 * broker slot and worca signs with the spawn token: the broker adds the person's key (and does Cursor's exchange).
 * `route.models` carries the decision's models plus the catalog's auxModels (Task 9 checks them).
 */
export function buildRelayRoute(decision, { spawnEnv = {}, modelEnv = null, serverEnv = {}, endpoint = null, lease = null,
  label, upstreams = null, fetchImpl = globalThis.fetch, now = Date.now, cache = new Map() } = {}) {
  if (!isResolved(decision)) throw refuse('a model route opens only from resolveModelRoute\'s decision');
  if (decision.refusal) throw refuse(decision.refusal);
  if (decision.kind !== 'relayed') throw refuse(`a ${decision.kind} spawn has no relay route`);
  const entry = engineEntry(decision.engine);
  // The model the CLI puts in its request body: the adapter passes it as `model` (copilot: copilotWireModel(id)); a
  // codex endpoint model sends its upstream id instead of the catalog id.
  const models = [...new Set([...(endpoint?.model ? [endpoint.model] : decision.models), ...(entry.relay.auxModels || [])])];
  let route;
  if (entry.relay.upstream === 'anthropic') route = remoteModelRoute({ spawnEnv, modelEnv, serverEnv, label });
  else if (entry.relay.perMode) route = modeRoute(decision, { serverEnv, lease, upstreams, label });
  else if (lease) route = slotRoute(entry, decision, { lease, label });
  else route = engineModelRoute({ engine: decision.engine, serverEnv, spawnEnv, model: decision.models[0] ?? null, endpoint, label, upstreams, fetchImpl, now, cache });
  // A per-mode route names what its sign-in mode pins (modeRoute); every other route takes the catalog's check.
  // `stepModel`: the name a call on the step's own model gives (its usage is booked as the step's model).
  return { ...route, models: route.models ?? models, modelCheck: route.modelCheck ?? entry.relay.modelCheck,
    stepModel: route.stepModel ?? (endpoint?.model || decision.models[0] || null) };
}

// ── Gemini CLI, Qwen Code, Goose and OpenCode: one route per sign-in mode (relay spike 2026-10-22) ──
// Each CLI sends plain HTTP/1.1 with SSE replies and its key in one header, so a mode whose credential is a plain key
// relays as it is: the CLI gets the relay's URL (or a broker slot's) where it takes its endpoint, a dummy key, and the
// switches that turn its side traffic off. A mode that needs a token minted or refreshed on this machine (Google's
// login, Vertex with ADC, Qwen OAuth), each request signed (Bedrock SigV4) or a host the CLI does not let worca move has
// no route (catalog: no `relay` on the mode) and is refused there.

/** One path segment a route admits where the path names a model, a deployment or an endpoint: never an empty, dot or
 *  encoded one (the relay also refuses those first, as the broker does: slots.mjs pathIssue). */
const SEG = '(?!\\.{1,2}(?:[/:]|$))[A-Za-z0-9._-]+';
/** The Gemini API's generate calls under `prefix` (the model is in the path: /models/{m}:method). */
const geminiCalls = (prefix) => new RegExp(`^${prefix.replace(/[/.]/g, '\\$&')}/models/${SEG}:(streamGenerateContent|generateContent|countTokens)$`);
/** Where a Gemini call names its model: /models/{m}:method. */
const GEMINI_MODEL_AT = /\/models\/([^/:]+):/;
/** The vendors' APIs these routes reach, as origins (a route's `allow` holds the full path, as the broker's slots do).
 *  RemoteExecEnv's `relayUpstreams.modes` replaces one by its route id in tests only. */
const VENDOR = Object.freeze({ 'gemini-api': 'https://generativelanguage.googleapis.com', 'vertex-express': 'https://aiplatform.googleapis.com',
  openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com', openrouter: 'https://openrouter.ai', 'opencode-zen': 'https://opencode.ai' });
const bearer = (key) => () => ({ authorization: `Bearer ${key}` });
const header = (name, key) => () => ({ [name]: key });
const serverBase = (serverEnv, name) => {
  if (!str(serverEnv?.[name])) throw refuse(`The worca server's ${name} is not set; the relay sends this sign-in's calls there.`);
  return checkBase(serverEnv[name], `The worca server's ${name}`);
};

/**
 * Per catalog `relay` on a sign-in mode: where its calls go (`upstream(serverEnv)`), the protocol of its replies (the
 * meter and the refusal shape), the calls it takes, how worca signs them (`sign(key)` → the auth headers), the request
 * headers it forwards, and `slotSuffix`, what the CLI's base needs after a broker slot's URL (a slot's paths start at the
 * vendor's root) where the relay's upstream already holds it.
 * `pin`: where a call names its model, which the relay holds to the step's (an engine whose catalog relay.modelCheck is
 * 'mode'): `{ body: true }` the request body's `model`; `{ path }` the first group of `path` in the call's path (Gemini's
 * /models/{m}:, Azure's deployment, Databricks' serving endpoint), with `name(serverEnv)` when the server's env names it
 * rather than the step's model (Azure's deployment; `missing`: the refusal when it does not).
 */
export const MODE_ROUTES = Object.freeze({
  'gemini-api': { upstream: () => VENDOR['gemini-api'], protocol: 'gemini', call: 'a Gemini API call',
    allow: [['POST', geminiCalls('/v1beta')]], sign: (k) => header('x-goog-api-key', k), forward: ['x-goog-api-client'], slotSuffix: '',
    pin: { path: GEMINI_MODEL_AT } },
  'vertex-express': { upstream: () => VENDOR['vertex-express'], protocol: 'gemini', call: 'a Vertex AI express call',
    allow: [['POST', geminiCalls('/v1beta1/publishers/google')]], sign: (k) => header('x-goog-api-key', k), forward: ['x-goog-api-client'], slotSuffix: '',
    pin: { path: GEMINI_MODEL_AT } },
  openai: { upstream: () => VENDOR.openai, protocol: 'openai', call: 'an OpenAI API call',
    allow: [['POST', '/v1/chat/completions'], ['POST', '/v1/responses'], ['GET', '/v1/models']], sign: bearer, slotSuffix: '', pin: { body: true } },
  anthropic: { upstream: () => VENDOR.anthropic, protocol: 'anthropic', call: 'a Messages API call',
    allow: [['POST', '/v1/messages'], ['POST', '/v1/messages/count_tokens']], sign: (k) => header('x-api-key', k), slotSuffix: '', pin: { body: true } },
  openrouter: { upstream: () => VENDOR.openrouter, protocol: 'openai', call: 'an OpenRouter call',
    allow: [['POST', '/api/v1/chat/completions'], ['GET', '/api/v1/models']], sign: bearer, forward: ['http-referer', 'x-title'], slotSuffix: '', pin: { body: true } },
  // OpenCode Zen answers Responses (GPT models), Messages (Claude) or Chat Completions per model, each SDK with its own
  // header: worca signs in the header the CLI used.
  'opencode-zen': { upstream: () => VENDOR['opencode-zen'], protocol: 'openai', call: 'an OpenCode Zen call',
    allow: [['POST', '/zen/v1/responses'], ['POST', '/zen/v1/messages'], ['POST', '/zen/v1/chat/completions']],
    sign: (k) => (incoming = {}) => (incoming['x-api-key'] !== undefined ? { 'x-api-key': k } : { authorization: `Bearer ${k}` }),
    forward: ['x-opencode-client', 'x-opencode-project', 'x-opencode-request', 'x-opencode-session'], slotSuffix: '', pin: { body: true } },
  // The deployment is the model on Azure, and goose takes it from AZURE_OPENAI_DEPLOYMENT_NAME: the one the route admits.
  'azure-openai': { upstream: (env) => new URL(serverBase(env, 'AZURE_OPENAI_ENDPOINT')).origin, protocol: 'openai', call: 'an Azure OpenAI call',
    allow: [['POST', new RegExp(`^/openai/deployments/${SEG}/chat/completions$`)]], sign: (k) => header('api-key', k), slotSuffix: '',
    pin: { path: /^\/openai\/deployments\/([^/]+)\//, name: (env) => str(env?.AZURE_OPENAI_DEPLOYMENT_NAME),
      missing: "The worca server's AZURE_OPENAI_DEPLOYMENT_NAME is not set; the relay admits calls to that one deployment only." } },
  // The serving endpoint is the model (goose names it as the step's model): its own config and its invocations only.
  databricks: { upstream: (env) => new URL(serverBase(env, 'DATABRICKS_HOST')).origin, protocol: 'openai', call: 'a Databricks serving call',
    allow: [['GET', new RegExp(`^/api/2\\.0/serving-endpoints/${SEG}$`)], ['POST', new RegExp(`^/serving-endpoints/${SEG}/invocations$`)]], sign: bearer, slotSuffix: '',
    pin: { path: /^\/(?:api\/2\.0\/)?serving-endpoints\/([^/]+)/ } },
  // Qwen Code's OpenAI- and Anthropic-compatible modes: the base worca's env names (DashScope, a gateway, the vendor).
  // Under the broker they reach the openai or anthropic slot, whose paths start at /v1.
  'openai-compatible': { upstream: (env) => serverBase(env, 'OPENAI_BASE_URL'), protocol: 'openai', call: 'an OpenAI-compatible call',
    allow: [['POST', '/chat/completions']], sign: bearer, slotSuffix: '/v1', pin: { body: true } },
  'anthropic-compatible': { upstream: (env) => serverBase(env, 'ANTHROPIC_BASE_URL'), protocol: 'anthropic', call: 'a Messages API call',
    allow: [['POST', '/v1/messages']], sign: (k) => header('x-api-key', k), slotSuffix: '', pin: { body: true } },
});

/** Qwen Code's side traffic off in every mode: the models.dev catalog and its usage telemetry. */
const QWEN_QUIET = Object.freeze({ QWEN_CODE_MODELS_DEV: 'off', QWEN_USAGE_STATISTICS_ENABLED: 'false' });
/** Gemini CLI's user settings worca writes where it points the CLI (its home in a sandbox): usage statistics off, which
 *  stops the Clearcut telemetry (sent straight to play.googleapis.com, past any relay) and the install id on model
 *  calls. No env switch exists. */
export const GEMINI_RELAY_SETTINGS = `${JSON.stringify({ privacy: { usageStatisticsEnabled: false } }, null, 2)}\n`;
const join2 = (base, suffix) => `${String(base).replace(/\/+$/, '')}${suffix}`;

/**
 * How each per-mode CLI is pointed at `base` (the relay route's URL, or a broker slot's URL plus the route's
 * slotSuffix) for the mode's route `relay`, with `credential` (RELAY_DUMMY, or the spawn's broker token) where its key
 * goes: `{ env, config? }`. OpenCode reads no base URL from its env for these providers: its provider block rides its
 * inline config (`config`, merged into OPENCODE_CONFIG_CONTENT by the adapter). `model`: the step's model id as the
 * engine names it (Goose and OpenCode: provider/model). An adapter deletes the engine's catalog relayOwned names
 * before it applies the env, so no ambient endpoint or key survives.
 */
export const MODE_POINTING = Object.freeze({
  gemini: (relay, base, credential) => ({ env: relay === 'vertex-express'
    ? { GOOGLE_API_KEY: credential, GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_VERTEX_BASE_URL: base }
    // Without the auth override a base URL alone makes 0.63 pick its "gateway" sign-in, which it then refuses.
    : { GEMINI_API_KEY: credential, GEMINI_CLI_AUTH_OVERRIDE: 'gemini-api-key', GOOGLE_GEMINI_BASE_URL: base } }),
  // Qwen Code signs in only with the model named for its provider (a key alone is "No auth type is selected").
  qwen: (relay, base, credential, model) => ({ env: {
    ...(relay === 'openai-compatible' ? { OPENAI_API_KEY: credential, OPENAI_BASE_URL: base, OPENAI_MODEL: String(model || '') }
      : relay === 'anthropic-compatible' ? { ANTHROPIC_API_KEY: credential, ANTHROPIC_BASE_URL: base, ANTHROPIC_MODEL: String(model || '') }
        : { GEMINI_API_KEY: credential, GEMINI_MODEL: String(model || ''), GOOGLE_GEMINI_BASE_URL: base }),
    ...QWEN_QUIET } }),
  // Each goose provider takes its host in its own variable; OpenAI's is an origin plus OPENAI_BASE_PATH. No keyring.
  goose: (relay, base, credential, model, serverEnv = {}) => {
    const u = new URL(base);
    const per = {
      openai: { OPENAI_HOST: u.origin, OPENAI_BASE_PATH: `${u.pathname.replace(/^\/+|\/+$/g, '')}${u.pathname.length > 1 ? '/' : ''}v1/chat/completions`, OPENAI_API_KEY: credential },
      anthropic: { ANTHROPIC_HOST: base, ANTHROPIC_API_KEY: credential },
      'gemini-api': { GOOGLE_HOST: base, GOOGLE_API_KEY: credential },
      openrouter: { OPENROUTER_HOST: base, OPENROUTER_API_KEY: credential },
      // The deployment and API version are settings, not secrets: they ride along when worca's env names them.
      'azure-openai': { AZURE_OPENAI_ENDPOINT: base, AZURE_OPENAI_API_KEY: credential,
        ...Object.fromEntries(['AZURE_OPENAI_DEPLOYMENT_NAME', 'AZURE_OPENAI_API_VERSION'].filter((k) => str(serverEnv[k])).map((k) => [k, str(serverEnv[k])])) },
      databricks: { DATABRICKS_HOST: base, DATABRICKS_TOKEN: credential },
    }[relay];
    return { env: { ...per, GOOSE_DISABLE_KEYRING: '1', GOOSE_TELEMETRY_OFF: '1' } };
  },
  // The provider block points its SDK at the relay; small_model pins the session-title call to the step's model; the
  // catalog fetch, updates, sharing, default plugins and LSP downloads stay off.
  opencode: (relay, base, credential, model) => {
    const provider = String(model || '').split('/')[0];
    const suffix = { openai: '/v1', anthropic: '/v1', 'gemini-api': '/v1beta', openrouter: '/api/v1', 'opencode-zen': '/zen/v1' }[relay] ?? '';
    return {
      env: { OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
        OPENCODE_DISABLE_LSP_DOWNLOAD: '1' },
      config: { provider: { [provider]: { options: { baseURL: join2(base, suffix), apiKey: credential } } }, ...(model ? { small_model: String(model) } : {}),
        autoupdate: false, share: 'disabled' },
    };
  },
});

/** Where a per-mode engine's CLI is pointed and with what: its decision's mode (resolveModelRoute relayMode) and route. */
export function modeRelayOf(decision) {
  const entry = engineEntry(decision?.engine);
  const mode = entry?.relay?.perMode ? entry.signIn.modes.find((m) => m.id === decision.relayMode) ?? null : null;
  if (!mode || !mode.relay || !MODE_ROUTES[mode.relay] || !MODE_POINTING[decision.engine]) throw refuse(`the ${decision?.engine} engine has no relay route for this sign-in`);
  return { mode, route: MODE_ROUTES[mode.relay] };
}

/** A per-mode CLI pointed at broker slot `lease` (a local brokered spawn): `{ env, config? }` with the spawn token. */
export function pointAtSlot(decision, lease, model = decision.models[0] ?? null) {
  const { mode, route } = modeRelayOf(decision);
  return MODE_POINTING[decision.engine](mode.relay, join2(lease.baseUrl, route.slotSuffix), lease.token, model);
}

function modeRoute(decision, { serverEnv, lease, upstreams, label }) {
  const { mode, route: r } = modeRelayOf(decision);
  const model = decision.models[0] ?? null;
  const cred = lease ? null : modeCredential(mode);
  const key = lease ? lease.token : str(serverEnv?.[cred]);
  if (!key) throw refuse(`${cred} is not set in the worca server's environment; worca signs this sign-in's calls with it.`);
  // Under the broker the relay forwards to the slot (which adds the person's key); else to the vendor, signed here.
  const upstream = lease ? join2(lease.baseUrl, r.slotSuffix) : String(upstreams?.modes?.[mode.relay] || r.upstream(serverEnv)).replace(/\/+$/, '');
  return {
    engine: decision.engine, upstream, origin: new URL(upstream).origin, protocol: r.protocol,
    call: `${r.call} from ${decision.engine} in an ${label}${lease ? ' through the credential broker' : ''}`,
    allow: r.allow, authHeaders: lease ? bearer(key) : r.sign(key), extraHeaders: {}, forwardHeaders: r.forward || [], secrets: [key],
    ...modePin(decision, r, model, serverEnv),
    spawn: (baseUrl) => MODE_POINTING[decision.engine](mode.relay, baseUrl, RELAY_DUMMY, model, serverEnv),
  };
}

/** What a per-mode route holds each call's model to (MODE_ROUTES `pin`), as model-relay.mjs checks it: `modelCheck`
 *  'body' or 'path', `models` the one name a call may give (the step's model as the CLI sends it: without the provider
 *  its id names, on an engine whose ids do; or the server's Azure deployment), `pathModel` where a path names it. An
 *  engine whose catalog check is not 'mode' (Gemini CLI: its own side calls use other models) is checked as the
 *  catalog says. `stepModel`: that name, which the meter books as the step's model. */
function modePin(decision, r, model, serverEnv) {
  const entry = engineEntry(decision.engine);
  if (entry.relay.modelCheck !== 'mode' || !r.pin) return {};
  const slash = entry.signIn.byModel && model ? String(model).indexOf('/') : -1;
  const wire = model ? (slash > 0 ? String(model).slice(slash + 1) : String(model)) : '';
  const name = r.pin.name ? r.pin.name(serverEnv) : wire;
  if (!name) {
    throw refuse(r.pin.missing || `${entry.label} in a sandbox needs a model; pick one for this step.`);
  }
  const models = [...new Set([name, ...(entry.relay.auxModels || [])])];
  return r.pin.body ? { modelCheck: 'body', models, stepModel: name } : { modelCheck: 'path', pathModel: r.pin.path, models, stepModel: name };
}

/** An engine route whose upstream is a broker slot (`lease`): the spawn token signs, nothing else is added. */
function slotRoute(entry, decision, { lease, label }) {
  const base = String(lease.baseUrl).replace(/\/+$/, '') + (CLI_POINTING[entry.relay.upstream]?.suffix || '');
  const model = decision.models[0] ?? null;
  const per = {
    openai: { protocol: 'openai', allow: [['POST', '/responses'], ['GET', '/models']], forwardHeaders: [] },
    copilot: { protocol: copilotWire(model).type === 'anthropic' ? 'anthropic' : 'openai', allow: [['POST', copilotWire(model).path]], forwardHeaders: ['x-initiator', 'x-interaction-type'] },
    cursor: { protocol: 'connect', allow: CURSOR_PATHS, forwardHeaders: CURSOR_FORWARD, responseHeaders: ['connect-content-encoding'] },
  }[entry.relay.upstream];
  if (!per) throw refuse(`the ${decision.engine} engine has no broker route`);
  return { engine: decision.engine, upstream: base, origin: new URL(base).origin, call: `a ${per.protocol} call from ${decision.engine} through the credential broker in an ${label}`,
    ...per, authHeaders: () => ({ authorization: `Bearer ${lease.token}` }), extraHeaders: {}, secrets: [...lease.secrets],
    spawn: (baseUrl) => CLI_POINTING[entry.relay.upstream].spawn(baseUrl, RELAY_DUMMY, model) };
}
