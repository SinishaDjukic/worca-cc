// src/core/bridge/errors.mjs
// Upstream failures -> the Anthropic error envelope the CLI understands
// (model-bridge-design.md §5.7). The status AND the `error.type` both matter:
// the CLI's retry/backoff keys on the status, worca's classifyError keys on
// the message text (auth / rate_limit / ...), and the Test button's hints on
// both. Pure.

/** Hard payload ceiling before forwarding (Copilot's observed limit). */
export const PAYLOAD_CEILING_BYTES = 2_500_000;

/** The phrase Claude Code matches on to trigger its own compaction. */
export const PROMPT_TOO_LONG = 'prompt is too long';

const CONTEXT_RE = /context.?length|too long|maximum context|token limit|exceeds? .*tokens|too many tokens|request too large|payload too large|exceeds the context window/i;

/** Envelope for a status/type/message triple. */
export function anthropicError(status, type, message) {
  return { status, body: { type: 'error', error: { type, message: String(message || type) } } };
}

const MESSAGE_MAX = 500;

/** A provider's own error text: a JSON body's message, else the text itself. */
function rawProviderText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const j = JSON.parse(raw);
    const e = j && (j.error || j);
    if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
    if (typeof e === 'string') return e;
  } catch { /* plain text */ }
  return raw.trim();
}

/**
 * Pull a human message out of an upstream error body (JSON or text). A router
 * (OpenRouter) answers with a generic `message` ("Provider returned error") and
 * puts the provider's own explanation in `error.metadata.raw` — the line that
 * says what to do (rate-limited upstream: retry, or bring your own key) — so
 * the two are joined. Capped: a provider can return a whole HTML page.
 */
export function upstreamMessage(text) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const e = j && (j.error || j);
    if (e && typeof e === 'object') {
      const base = e.message || e.msg || e.code || '';
      const raw = rawProviderText(e.metadata && e.metadata.raw);
      const joined = raw && raw !== base ? (base ? `${base} — ${raw}` : raw) : String(base);
      return (joined || JSON.stringify(e)).slice(0, MESSAGE_MAX);
    }
    if (typeof e === 'string') return e.slice(0, MESSAGE_MAX);
  } catch { /* not JSON */ }
  return String(text).slice(0, MESSAGE_MAX);
}

/** What a router (OpenRouter) says beside an error: the provider that answered, and whose limit it hit. */
function routerMetadata(text) {
  try {
    const m = JSON.parse(text)?.error?.metadata;
    if (!m || typeof m !== 'object') return {};
    return {
      providerName: typeof m.provider_name === 'string' ? m.provider_name : '',
      limitSource: typeof m.limit_source === 'string' ? m.limit_source : '',
    };
  } catch { return {}; }
}

/** The machine-readable code in an upstream error body ('' when there is none). */
export function upstreamCode(text) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const e = j && (j.error || j);
    return e && typeof e === 'object' && typeof e.code === 'string' ? e.code : '';
  } catch { return ''; }
}

/** An upstream saying it serves this model through the other OpenAI protocol (Copilot: unsupported_api_for_model). */
const UNSUPPORTED_API_RE = /not accessible via the \/(chat\/completions|responses) endpoint|does not support (the )?Responses API/i;

/** The fix that refusal needs, per provider. */
export function unsupportedApiFix(provider) {
  return provider === 'copilot'
    ? 'this model needs a different API: re-import it (Settings › Models › Import models…) or change its API in the model editor'
    : 'this model needs a different API: change its API in the model editor';
}

/** A 403 body that is about the credential itself (bad, expired or unscoped key) — still an auth failure. */
const AUTH_403_RE = /\b(api[ _-]?key|token|credential|unauthori[sz]ed|authenticat|invalid key|expired|revoked|sign(ed)? ?in|log(ged)? ?in)/i;

/** Error codes for a prompt past the model's context window: OpenAI's, and Copilot's own limit check. */
const CONTEXT_CODES = new Set(['context_length_exceeded', 'model_max_prompt_tokens_exceeded']);

/** Whether an upstream error — by its code or its message — says the prompt overflowed the context window. */
export function isContextOverflow(code, message) {
  return CONTEXT_CODES.has(String(code || '')) || CONTEXT_RE.test(String(message || ''));
}

/** A code or wording that names another failure: a rate limit, a quota, a server error, a timeout. */
const OTHER_FAILURE_RE = /rate.?limit|quota|server_error|overloaded|unavailable|timed? ?out|timeout|per min(ute)?\b|\bTPM\b/i;

/**
 * isContextOverflow for a failure reported inside an HTTP 200 — a Responses
 * stream's response.failed / error, or a buffered body with status "failed".
 * No status narrows it to a 400 there, so a code or wording that names another
 * failure outranks CONTEXT_RE's broad phrases ("too long", "request too
 * large"): a rate limit or a timeout must never make the CLI compact.
 */
export function isFailedResponseOverflow(code, message) {
  const c = String(code || '');
  const m = String(message || '');
  if (CONTEXT_CODES.has(c)) return true;
  return !OTHER_FAILURE_RE.test(c) && !OTHER_FAILURE_RE.test(m) && CONTEXT_RE.test(m);
}

/**
 * Map an upstream HTTP failure to the envelope.
 * @param {number} status  upstream status
 * @param {string} text  upstream body text
 * @param {{provider?:string, retryAfter?:string}} [meta]
 */
export function mapUpstreamError(status, text, { provider = 'upstream', retryAfter } = {}) {
  const msg = upstreamMessage(text);
  const who = provider;
  // A 403 whose body names something other than the credential is a POLICY
  // refusal (OpenRouter gates some :free models to listed agent apps: "only
  // available on agentic harnesses"). Calling that an auth failure sends the
  // user to re-enter a key that works; the body is the real reason, and it is
  // permanent, so nothing downstream classifies it as retryable.
  if (status === 403 && /[a-z]{3}/i.test(msg) && !AUTH_403_RE.test(msg)) {
    return anthropicError(403, 'permission_error', `${who}: refused (403) — ${msg}`);
  }
  if (status === 401 || status === 403) {
    return anthropicError(401, 'authentication_error', `${who}: authentication failed (${status})${msg ? ` — ${msg}` : ''}`);
  }
  if (status === 429) {
    // A router's 429 can come from a pool every one of its users shares
    // (OpenRouter's `:free` models), not from this install's traffic: name the
    // provider behind it and the limit's source, so the run surfaces can say
    // that lowering Max concurrent requests will not help.
    const { providerName, limitSource } = routerMetadata(text);
    const via = providerName ? ` via ${providerName}` : '';
    const source = limitSource ? ` [${limitSource}]` : '';
    const e = anthropicError(429, 'rate_limit_error', `${who}: rate limited (429)${via}${msg ? ` — ${msg}` : ''}${source}`);
    if (retryAfter) e.headers = { 'retry-after': String(retryAfter) };
    return e;
  }
  if (status === 413 || (status === 400 && isContextOverflow(upstreamCode(text), msg))) {
    return anthropicError(400, 'invalid_request_error', PROMPT_TOO_LONG);
  }
  if (status >= 400 && status < 500 && (upstreamCode(text) === 'unsupported_api_for_model' || UNSUPPORTED_API_RE.test(msg))) {
    return anthropicError(400, 'invalid_request_error', `${who}: ${msg || 'the model is not served through this API'} — ${unsupportedApiFix(who)}`);
  }
  if (status === 404) {
    return anthropicError(400, 'invalid_request_error', `${who}: model or endpoint not found (404)${msg ? ` — ${msg}` : ''}`);
  }
  if (status >= 400 && status < 500) {
    return anthropicError(400, 'invalid_request_error', `${who}: request rejected (${status})${msg ? ` — ${msg}` : ''}`);
  }
  if (status === 503 || status === 529) {
    return anthropicError(529, 'overloaded_error', `${who}: overloaded (${status})${msg ? ` — ${msg}` : ''}`);
  }
  return anthropicError(502, 'api_error', `${who}: upstream error (${status})${msg ? ` — ${msg}` : ''}`);
}

/** A network-level failure (fetch threw) -> envelope. */
export function mapNetworkError(err, { provider = 'upstream' } = {}) {
  const name = err && err.name;
  if (name === 'AbortError') return anthropicError(499, 'api_error', `${provider}: request aborted`);
  if (name === 'TimeoutError') return anthropicError(504, 'api_error', `${provider}: upstream timed out`);
  const detail = err && (err.cause && err.cause.message || err.message) || String(err);
  return anthropicError(502, 'api_error', `${provider}: endpoint unreachable — ${detail}`);
}

/** The bridge's own refusals (bad bearer, unknown model, feature gaps). */
export const bridgeErrors = {
  unauthorized: () => anthropicError(401, 'authentication_error', 'bridge: invalid bearer token'),
  unknownModel: (id) => anthropicError(404, 'not_found_error', `bridge: no bridged model ${JSON.stringify(id)} in the catalog`),
  notSignedIn: (provider, hint) => anthropicError(401, 'authentication_error', `provider ${provider}: not signed in — ${hint}`),
  termsNotAcknowledged: (provider) => anthropicError(401, 'authentication_error', `provider ${provider}: terms not acknowledged — open Settings › Providers`),
  tooLarge: () => anthropicError(400, 'invalid_request_error', PROMPT_TOO_LONG),
  badJson: () => anthropicError(400, 'invalid_request_error', 'bridge: request body is not JSON'),
  unsupported: (message) => anthropicError(400, 'invalid_request_error', message),
  notFound: () => anthropicError(404, 'not_found_error', 'bridge: unknown route'),
};
