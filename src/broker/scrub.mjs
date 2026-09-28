// src/broker/scrub.mjs
// Guarantee K4 (plans/credential-broker-design.html §6.10): nothing the broker sends
// back to an agent contains a credential. Upstream error bodies sometimes echo the
// key they rejected, in full or masked (OpenAI: "Incorrect API key provided:
// sk-ab****xyz"). Pure.

export const REMOVED = '[removed by worca broker]';

export const KEY_SHAPES = Object.freeze([
  /sk-ant-[A-Za-z0-9_-]{8,}/g,                 // Anthropic keys and OAuth tokens
  /sk-[A-Za-z0-9_-]*\*{2,}[A-Za-z0-9_-]*/g,    // OpenAI's masked echo "sk-ab****xyz"
  /sk-(?:proj-|or-v1-|or-)?[A-Za-z0-9_-]{8,}/g, // OpenAI / OpenRouter keys
  /\bgh[opsu]_[A-Za-z0-9]{20,}/g,              // GitHub tokens (Copilot sign-in)
  /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,             // AWS access key ids
  /\bwbt_[A-Za-z0-9_-]{20,}/g,                 // the broker's own spawn tokens
]);

const WINDOW = 12;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove `secrets` (exact values and every 12-character window of each) and every
 * known key shape from `text`.
 * @param {string} text
 * @param {string[]} [secrets]
 */
export function scrubText(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    const s = String(secret || '');
    if (s.length < 8) continue;
    out = out.split(s).join(REMOVED);
    if (s.length > WINDOW) {
      // Any 12-char slice of the secret (a truncated echo) — one alternation, built once.
      const parts = new Set();
      for (let i = 0; i + WINDOW <= s.length; i++) parts.add(escapeRe(s.slice(i, i + WINDOW)));
      out = out.replace(new RegExp([...parts].join('|'), 'g'), REMOVED);
    }
  }
  for (const re of KEY_SHAPES) out = out.replace(re, REMOVED);
  return out;
}
