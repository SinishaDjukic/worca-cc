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

const CONTEXT_RE = /context.?length|too long|maximum context|token limit|exceeds? .*tokens|too many tokens|request too large|payload too large/i;

/** Envelope for a status/type/message triple. */
export function anthropicError(status, type, message) {
  return { status, body: { type: 'error', error: { type, message: String(message || type) } } };
}

/** Pull a human message out of an upstream error body (JSON or text). */
export function upstreamMessage(text) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const e = j && (j.error || j);
    if (e && typeof e === 'object') return e.message || e.msg || e.code || JSON.stringify(e);
    if (typeof e === 'string') return e;
  } catch { /* not JSON */ }
  return String(text).slice(0, 500);
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
  if (status === 401 || status === 403) {
    return anthropicError(401, 'authentication_error', `${who}: authentication failed (${status})${msg ? ` — ${msg}` : ''}`);
  }
  if (status === 429) {
    const e = anthropicError(429, 'rate_limit_error', `${who}: rate limited (429)${msg ? ` — ${msg}` : ''}`);
    if (retryAfter) e.headers = { 'retry-after': String(retryAfter) };
    return e;
  }
  if (status === 413 || (status === 400 && CONTEXT_RE.test(msg))) {
    return anthropicError(400, 'invalid_request_error', PROMPT_TOO_LONG);
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
