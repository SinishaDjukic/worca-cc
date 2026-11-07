// src/shared/answerer.mjs — the answerer profile: the perspective a person leads as, and the register a question card
// words its choices in for them. A plain-register lead (Product, UX) reads the `plain` twin of a question or option,
// and, where the caller asks for it, never a code token. Opt-in: a caller that passes no lead gets the entry's own
// words. Pure and browser-safe.

/** Lead perspective → the register its questions are worded in. */
export const ANSWERER_LEADS = Object.freeze({
  product: 'plain', architect: 'technical', ux: 'plain', qa: 'technical', security: 'technical', devops: 'technical',
});
export const ANSWERER_LEAD_KEYS = Object.freeze(Object.keys(ANSWERER_LEADS));
export const isAnswererLead = (k) => typeof k === 'string' && Object.hasOwn(ANSWERER_LEADS, k);
const isPlainLead = (lead) => ANSWERER_LEADS[lead] === 'plain';

const words = (text) => String(text).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

// A scope token: `project:read`, `project:read/write` (`10:30`, `localhost:4317` and `https://` are not one).
const SCOPE = String.raw`[A-Za-z][\w-]*:[A-Za-z][\w-]*(?:\/[A-Za-z][\w-]*)*`;
const SCOPE_TOKEN = new RegExp(String.raw`(?<![\w/])${SCOPE}(?![\w/])`, 'g');
const SCOPE_ONLY = new RegExp(`^${SCOPE}$`);
const STARTS_WITH_SCOPE = new RegExp(String.raw`^\s*(?:\x60\s*${SCOPE}\s*\x60|${SCOPE}(?![\w/]))`);

/** `project:read` → `read access`; `project:read/write` → `read and write access`; `a:b/c/d` → `b, c and d access`. */
function scopeWords(token) {
  const parts = token.slice(token.indexOf(':') + 1).split('/').map((p) => p.replace(/[_-]+/g, ' ').trim());
  const last = parts.pop();
  return `${parts.length ? `${parts.join(', ')} and ` : ''}${last} access`;
}

/** `text` in words: a scope token (bare, or alone in backticks) translated; other backticked spans, snake_case and
 *  `name()` tokens removed; `10:30`, `localhost:4317` and `https://` kept; spaces squeezed. */
export function plainWords(text) {
  return String(text ?? '')
    .replace(/`([^`]*)`/g, (_, code) => (SCOPE_ONLY.test(code.trim()) ? scopeWords(code.trim()) : ' '))
    .replace(SCOPE_TOKEN, scopeWords)
    .replace(/\b\w+(?:_\w+)+\b/g, ' ')
    .replace(/\b[\w.]+\(\)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The words of `entry[field]` for a reader leading as `lead`. No lead, or a technical one: the entry's own words.
 * A plain-register lead, or no lead with `register: 'plain'` (a given lead always decides): the entry's `plain` twin
 * when it has one; with `strip`, those words through `plainWords`, capitalised when they start with a scope token; when
 * no word is left, `Option n` (an option, `n` given) or `This decision` (a question).
 * @param {object} entry @param {string} field @param {string|null} lead
 * @param {{strip?:boolean, n?:number, register?:'plain'}} [opts]
 */
export function wordsFor(entry, field, lead, { strip = false, n, register } = {}) {
  const own = entry?.[field];
  if (lead ? !isPlainLead(lead) : register !== 'plain') return own;
  const plain = typeof entry?.plain === 'string' && entry.plain.trim() ? entry.plain : null;
  if (!strip) return plain ?? own;
  const source = plain ?? own;
  const stripped = plainWords(source);
  if (words(stripped).length) return STARTS_WITH_SCOPE.test(String(source)) ? stripped[0].toUpperCase() + stripped.slice(1) : stripped;
  return Number.isInteger(n) ? `Option ${n}` : 'This decision';
}
