// src/shared/secret-names.mjs
// Names that look like they hold a credential, one source for the server and the page.

// Credential-looking env keys default to "Require at install". Word-ish
// boundaries keep limits like MAX_OUTPUT_TOKENS or MAX_THINKING_TOKENS (a
// count, not a credential) out of the net.
export const SECRETISH_RE = /auth|secret|password|credential|api_?key|(?:^|_)key(?:_|$)|(?:^|_)token(?:_|$)/i;

// An HTTP header that carries a credential. Header names use hyphens, which
// SECRETISH_RE's `_` boundaries miss (X-Api-Key, X-Token, Cookie). The bridge's
// header test; src/core/broker-guard.mjs and src/core/ask/model-proposal.mjs
// keep their own copies.
export const SECRET_HEADER_RE = /authorization|api[-_]?key|token|secret|cookie|password/i;

/** Whether an HTTP header name looks like it carries a credential. SECRET_HEADER_RE (Cookie, a loose token) or,
 *  spelled with underscores, SECRETISH_RE: `auth`, `credential` and a whole `key` word catch the names
 *  SECRET_HEADER_RE misses (X-Auth-Key, X-Access-Key, X-Credential, Ocp-Apim-Subscription-Key). A `key` inside
 *  a word (X-Keyboard-Layout) is not one. */
export function isSecretHeaderName(name) {
  const h = String(name);
  return SECRET_HEADER_RE.test(h) || SECRETISH_RE.test(h.replace(/-/g, '_'));
}
