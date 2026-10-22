// src/core/exec-env/relay-route.mjs
// Where one remote Claude spawn's model calls go and which auth headers worca adds on its own side
// (plans/model-relay-design.md §4). Pure: the relay (a later task) applies the result; the sandbox
// never holds the credential. Refuses (errorClass 'config') what a relay cannot carry.
import { modelCredential } from './policy.mjs';
import { OAUTH_BETA, mergeBetas } from '../../broker/service.mjs';

const ANTHROPIC = 'https://api.anthropic.com';
const SIGNING_FLAGS = ['BEDROCK', 'VERTEX', 'FOUNDRY'];
const SECRET_NAME = /_(TOKEN|SECRET|KEY)$/i;
const ENTRY_KEYS = new Set(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']);
const FORBIDDEN_HEADER = /^(authorization|x-api-key|host|proxy-.*)$/i;

const refuse = (message) => Object.assign(new Error(message), { errorClass: 'config' });
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
