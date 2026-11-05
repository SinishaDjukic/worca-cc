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

/** `text` with code tokens removed: backticked spans, scope tokens (`project:read`, `project:read/write`; `10:30`,
 *  `localhost:4317` and `https://` stay),
 *  snake_case and `name()` tokens; spaces squeezed. */
export function plainWords(text) {
  return String(text ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/(?<![\w/])[A-Za-z][\w-]*:[A-Za-z][\w-]*(?:\/[A-Za-z][\w-]*)*(?![\w/])/g, ' ')
    .replace(/\b\w+(?:_\w+)+\b/g, ' ')
    .replace(/\b[\w.]+\(\)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The words of `entry[field]` for a reader leading as `lead`. No lead, or a technical one: the entry's own words.
 * A plain-register lead, or no lead with `register: 'plain'` (a given lead always decides): the entry's `plain` twin
 * when it has one; else, with `strip`, the words with code tokens removed, and when fewer than 2 words remain
 * `Option n` (an option, `n` given) or `This decision` (a question).
 * @param {object} entry @param {string} field @param {string|null} lead
 * @param {{strip?:boolean, n?:number, register?:'plain'}} [opts]
 */
export function wordsFor(entry, field, lead, { strip = false, n, register } = {}) {
  const own = entry?.[field];
  if (lead ? !isPlainLead(lead) : register !== 'plain') return own;
  const plain = typeof entry?.plain === 'string' && entry.plain.trim() ? entry.plain : null;
  if (!strip) return plain ?? own;
  const stripped = plain ? plainWords(plain) : plainWords(own);
  if (words(stripped).length >= 2) return stripped;
  return Number.isInteger(n) ? `Option ${n}` : 'This decision';
}
