// src/core/redact.mjs
// Broker spawn tokens in agent output (plans/credential-broker-design.html §6.10).
// A token only works on the broker's private port and only while its spawn lives,
// but an agent can still print its own env into a transcript every teammate sees.
// The `wbt_` prefix makes it recognisable; this removes it wherever worca stores or
// shows agent output. Pure, cheap on text without the prefix.

export const BROKER_TOKEN_RE = /\bwbt_[A-Za-z0-9_-]{20,}/g;
export const REDACTED_TOKEN = 'wbt_[redacted]';

/** `text` with every broker token replaced. Non-strings come back unchanged. */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text.includes('wbt_')) return text;
  return text.replace(BROKER_TOKEN_RE, REDACTED_TOKEN);
}

/** Deep copy of a JSON-like value with every string redacted (events, tool results). */
export function redactDeep(value, depth = 0) {
  if (typeof value === 'string') return redactSecrets(value);
  if (depth > 32 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, depth + 1);
  return out;
}
