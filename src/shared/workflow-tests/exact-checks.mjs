// src/shared/workflow-tests/exact-checks.mjs — Part 4 exact checks (plans/workflow-tests-part4-plan.md D93, D94): what can be
// counted in a result without AI. Pure and browser-safe. Every scan is bounded (MAX_SCAN) and its regexes cannot backtrack
// badly on a try's own text (3a's final review I1).
const MAX_SCAN = 2 * 1024 * 1024;
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const more = (n) => (n > 0 ? ` and ${n} more` : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** D89's normal form (quotes, proofs): NFKC, straight quotes and dashes, no markdown marks, single spaces, lower case. */
export function normLoose(s) {
  return String(s ?? '').normalize('NFKC').replace(/[‘’‚‛`´]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐‑‒–—―]/g, '-')
    .replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
const straight = (s) => String(s ?? '').normalize('NFKC').replace(/[“”„‟«»]/g, '"');
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Text in double quotation marks of at least four words (shorter ones are names and terms). A quote never spans a blank line. */
export function quotesIn(text, { minWords = 4 } = {}) {
  const t = straight(text).slice(0, MAX_SCAN);
  const out = [];
  let open = -1;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === '\n' && t[i + 1] === '\n') { open = -1; continue; }
    if (t[i] !== '"') continue;
    if (open < 0) { open = i; continue; }
    const q = t.slice(open + 1, i).trim();
    open = -1;
    if (words(q) >= minWords) out.push(q);
  }
  return out;
}

/** D93 quotes: each part of each quote (split at an ellipsis) is in the sources, in D89's normal form. */
export function quotesCheck(text, sources) {
  const quotes = quotesIn(text);
  if (!quotes.length) return { met: true, value: 'No quotes' };
  const hay = normLoose(sources);
  const bad = quotes.filter((q) => {
    const parts = normLoose(q).split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.replace(/^[\s,.;:!?'"-]+|[\s,.;:!?'"-]+$/g, '')).filter((p) => p.length >= 3);
    return !parts.length || !parts.every((p) => hay.includes(p));
  });
  return bad.length ? { met: false, value: `Not in the files: "${clip(bad[0])}"${more(bad.length - 1)}` } : { met: true, value: 'Met' };
}

const NUM_RE = /(?<![\p{L}\p{N}_.,])(\d{1,3}(?:[,  ]\d{3})+|\d+)(?:[.,](\d+))?(\s?%)?/gu;
/** M7, M8: a date (2026-11-19, 19.11.2026, 01/02/2026), with a time after it (12:30), is neither a number of the result nor a phone number. */
const DATE_RE = /(?<![\d.\/-])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})(?:,?\s+\d{1,2}:\d{2})?(?![\d.\/-]?\d)/g;
const blankDates = (s) => s.replace(DATE_RE, (m) => ' '.repeat(m.length));
const LIST_MARK_RE = /^(\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?)\d{1,3}[.)](?=\s)/;
/** The numbers of a text: "1,200" → 1200, "3.50" → 3.5, "60 %" → 60. A list marker or numbered heading ("1.", "## 2)") and a
 *  single digit without a per cent sign are skipped. `shown` is the number as written. */
export function numbersIn(text) {
  const out = [];
  for (const raw of String(text ?? '').normalize('NFKC').slice(0, MAX_SCAN).split(/\r?\n/)) {
    const line = blankDates(raw.replace(LIST_MARK_RE, (m, lead) => `${lead}${' '.repeat(m.length - lead.length)}`));
    for (const m of line.matchAll(NUM_RE)) {
      const whole = m[1].replace(/[,  ]/g, '');
      if (!m[2] && !m[3] && whole.length === 1) continue;
      out.push({ shown: m[0].trim(), n: String(Number(m[2] ? `${whole}.${m[2]}` : whole)) });
    }
  }
  return out;
}

/** D93 numbers: every number of the result is a number of the sources. */
export function numbersCheck(text, sources) {
  const nums = numbersIn(text);
  if (!nums.length) return { met: true, value: 'No numbers' };
  const have = new Set(numbersIn(sources).map((x) => x.n));
  const bad = [...new Set(nums.filter((x) => !have.has(x.n)).map((x) => x.shown))];
  return bad.length ? { met: false, value: `Not in the files: ${bad.slice(0, 3).join(', ')}${more(bad.length - 3)}` } : { met: true, value: 'Met' };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
const PHONE_RE = /(?<![\w+])(?:\+|0)[\d ()./-]{8,22}\d(?!\w)/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
/** An IBAN passes its mod-97 check. */
export function ibanValid(s) {
  const t = String(s).replace(/ /g, '');
  if (t.length < 15 || t.length > 34) return false;
  let m = 0;
  for (const ch of t.slice(4) + t.slice(0, 4)) {
    for (const d of /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch) m = (m * 10 + Number(d)) % 97;
  }
  return m === 1;
}
/** A card number (13–19 digits) passes the Luhn check. */
export function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}
/** D93 no-personal: how many of each kind a text holds. A phone number starts with "+" or 0 and has 9 to 15 digits. Bank account
 *  and card numbers are found first and blanked, so their digit groups are never counted again as a phone number. */
export function personalData(text) {
  let t = String(text ?? '').normalize('NFKC').slice(0, MAX_SCAN);
  const blank = (hits) => { for (const h of hits) t = t.split(h).join(' '); return hits.length; };
  const ibans = blank((t.match(IBAN_RE) || []).filter(ibanValid));
  const cards = blank((t.match(CARD_RE) || []).filter((c) => luhnValid(c.replace(/\D/g, ''))));
  const emails = blank(t.match(EMAIL_RE) || []);
  t = blankDates(t);   // M7
  const phones = (t.match(PHONE_RE) || []).filter((p) => { const n = p.replace(/\D/g, '').length; return n >= 9 && n <= 15; }).length;
  return { emails, phones, ibans, cards };
}
export function personalCheck(text) {
  const f = personalData(text);
  const found = [f.emails && plural(f.emails, 'e-mail address', 'e-mail addresses'), f.phones && plural(f.phones, 'phone number', 'phone numbers'),
    f.ibans && plural(f.ibans, 'bank account number', 'bank account numbers'), f.cards && plural(f.cards, 'card number', 'card numbers')].filter(Boolean);
  return found.length ? { met: false, value: `Found ${found.join(', ')}` } : { met: true, value: 'Met' };
}

/** The http(s) links of a text, markdown or bare, in order, once each; closing punctuation is not part of a link. */
export function linksIn(text) {
  const out = [];
  for (const m of String(text ?? '').slice(0, MAX_SCAN).matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** D94: an exact check that can stand in for a criterion's words, or null. */
export function exactAlternative(criterion) {
  const t = String(criterion ?? '');
  const low = t.toLowerCase();
  if (/\bquot(?:e|es|ed|ing|ation|ations)\b/.test(low)) return { kind: 'quotes' };
  if (/\bnumbers?\b/.test(low) && (/\b(?:from|in) the (?:files?|data|notes|interviews?|attachments?)\b/.test(low) || /\bmakes? up no numbers?\b/.test(low))) {
    return { kind: 'numbers' };
  }
  if (/personal data|e-?mail address|phone numbers?/.test(low)) return { kind: 'no-personal' };
  if (/\blinks?\b/.test(low)) return { kind: 'links' };
  const n = /\b(?:mentions?|says?|states?|names?|gives?)\b/.test(low) ? /(?<![\d.,])\d{2,}(?:[.,]\d+)?%?/.exec(t) : null;
  return n ? { kind: 'mentions', text: n[0] } : null;
}
