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
/** D89: whether the proof is in the text (normLoose on both; each part between "…" at least 3 characters and the parts in order; 8 characters at least). */
export function proofFound(proof, text) {
  // A fragment quoted as "…passage…" is ordinary: one ellipsis at each end is trimmed before the parts are counted.
  const p = normLoose(proof).replace(/^["']+|["']+$/g, '').trim().replace(/^(?:\.\.\.)\s*|\s*(?:\.\.\.)$/g, '').replace(/^["']+|["']+$/g, '').trim();
  if (p.length < 8) return false;
  const hay = normLoose(text);
  const parts = p.split(/\s*(?:\.\.\.|…)\s*/).map((x) => x.replace(/^["']+|["']+$/g, '').trim());
  if (parts.some((x) => x.length < 3)) return false;
  let from = 0;
  for (const x of parts) {
    const i = hay.indexOf(x, from);
    if (i < 0) return false;
    from = i + x.length;
  }
  return true;
}

const straight = (s) => String(s ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[“”„‟«»]/g, '"');
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const spaces = (m) => m.replace(/[^\n]/g, ' ');

/** Fix round 5 (I5): a fence whose info string says it holds prose (```markdown, ```md, ```text, ```txt) is read as prose. */
const PROSE_FENCE = /^(?:markdown|md|text|txt)$/i;
/** Fix round 4: code (fenced blocks and inline backticks) blanked, line breaks and positions kept. Fix round 5 (I5): a prose fence keeps
 *  its text (only its fence lines are blanked), and a fence never closed is prose to the end (an answer wrapped in a fence that was cut). */
function blankCode(t) {
  const lines = t.split('\n');
  let open = -1;
  let fence = '';
  let prose = false;
  for (let i = 0; i < lines.length; i += 1) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (open < 0) {
      if (f) { open = i; fence = f[1]; prose = PROSE_FENCE.test(lines[i].slice(f[0].length).trim().split(/\s+/)[0]); }
      continue;
    }
    if (!f || f[1][0] !== fence[0] || f[1].length < fence.length || lines[i].slice(f[0].length).trim()) continue;
    for (let k = open; k <= i; k += 1) if (!prose || k === open || k === i) lines[k] = spaces(lines[k]);
    open = -1;
  }
  if (open >= 0) lines[open] = spaces(lines[open]);
  return lines.join('\n').replace(/``[^`\n]+``|`[^`\n]+`/g, spaces);
}

/** A quote is checked when a person is named next to it and it has QUOTE_MIN_NAMED_WORDS words, or when it is long: QUOTE_MIN_LONG_WORDS
 *  words that contain a letter (digits alone do not count). Shorter unnamed text (a button's label, "Jan 1 to Jan 31") is not checked. */
export const QUOTE_MIN_NAMED_WORDS = 3;
export const QUOTE_MIN_LONG_WORDS = 8;
/** The verbs that name who is speaking: `Dana said: "…"`, `"…", says the finance lead`. */
export const SPEECH_VERBS = Object.freeze(['said', 'says', 'wrote', 'writes', 'asked', 'told', 'explained', 'put it']);
/** Fix round 5 (I7): words of a screen, not people. Before a colon (`Error: "…"`) or as the one speaking (`The error says "…"`) they name nobody. */
export const UI_LABELS = Object.freeze(['Error', 'Hint', 'Title', 'Note', 'Warning', 'Label', 'Button', 'Message', 'Example', 'Tip', 'Status',
  'Placeholder', 'Tooltip', 'Text', 'Page', 'Screen', 'Dialog', 'Field', 'Banner', 'Heading', 'Caption', 'Prompt', 'Alert', 'Toast', 'Menu', 'Link']);
/** Fix round 5 (I4): a person named by role, lowercase too (`A customer: "…"`, `"…" — the finance lead`). */
export const PERSON_NOUNS = Object.freeze(['customer', 'user', 'client', 'interviewee', 'participant', 'respondent', 'buyer', 'owner', 'founder',
  'lead', 'manager', 'engineer', 'developer', 'designer', 'admin', 'accountant', 'analyst', 'director', 'colleague', 'partner', 'merchant',
  'employee', 'tester', 'reviewer', 'member']);
const VERBS = SPEECH_VERBS.join('|');
const UI_WORD = new Set(UI_LABELS.map((w) => w.toLowerCase()));
const PERSON = `(?:${PERSON_NOUNS.join('|')})s?`;
const person = (w) => !!w && !UI_WORD.has(w.toLowerCase());
// "Dana said: ", "As one customer put it: ", "One customer told us: " (up to two words after the verb); the word before the verb speaks.
const SPOKEN_BEFORE = new RegExp(String.raw`([\p{L}\p{N}'-]+)[,)]?\s+(?:${VERBS})(?:\s+[\p{L}'-]+){0,2}\s*[:,]?\s*$`, 'iu');
const LABEL_BEFORE = /(\p{Lu}[\p{L}'-]*|\))\s*:\s*$/u;   // "Dana: ", "Dana (finance lead): ": a capitalised name, or a bracket, then ":"
const ROLE_BEFORE = new RegExp(String.raw`(?<!\p{L})${PERSON}\s*:\s*$`, 'iu');   // "A customer: "
// " — Dana", " — the finance lead": a capitalised word or a person's role right after the dash (" — shown below" names nobody).
const DASH_AFTER = new RegExp(String.raw`^\s*[,.]?\s*[—–-]+\s*(?:\p{Lu}|(?:[Tt]he|[Aa]n?|[Oo]ne|[Oo]ur)\s+(?:[\p{L}'-]+\s+)?${PERSON}(?!\p{L}))`, 'u');
// ", Dana said", " said Dana", ", says the finance lead"; the word before the verb speaks.
const VERB_AFTER = new RegExp(String.raw`^\s*[,.]?\s*(?:(?:${VERBS})\s+\S|(?:[\p{L}'-]+\s+){0,4}([\p{L}'-]+)\s+(?:${VERBS})(?!\p{L}))`, 'iu');
const unmark = (s) => s.replace(/[*_]/g, '');
const spokenBefore = (s) => { const m = SPOKEN_BEFORE.exec(s); return !!m && person(m[1]); };
const namedBefore = (s) => { const m = LABEL_BEFORE.exec(s); return spokenBefore(s) || ROLE_BEFORE.test(s) || (!!m && (m[1] === ')' || person(m[1]))); };
const namedAfter = (s) => { const m = VERB_AFTER.exec(s); return DASH_AFTER.test(s) || (!!m && (!m[1] || person(m[1]))); };
const letterWords = (s) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
const tableLine = (t, at) => { const start = t.lastIndexOf('\n', at - 1) + 1; return /^\s*\|/.test(t.slice(start, start + 200)); };
/** The line just before the line that starts at `start` (its last 120 characters), or '' for the first line. */
const lineBefore = (t, start) => (start > 0 ? t.slice(Math.max(t.lastIndexOf('\n', start - 2) + 1, start - 121), start - 1) : '');
const isNamed = (t, open, close) => {
  const lineStart = t.lastIndexOf('\n', open) + 1;
  const end = t.indexOf('\n', close);
  const before = unmark(t.slice(Math.max(lineStart, open - 120), open));
  const after = unmark(t.slice(close + 1, Math.min(close + 80, end < 0 ? t.length : end)));
  if (namedBefore(before) || namedAfter(after)) return true;
  // Fix round 5 (I4): the quote opens its line (after "> " or a list mark): the line just before names the speaker and ends with ":".
  if (/^[\s>*+-]*$/.test(before)) {
    const prev = unmark(lineBefore(t, lineStart)).replace(/^[\s>]+/, '');
    if (/:\s*$/.test(prev) && (spokenBefore(prev) || ROLE_BEFORE.test(prev))) return true;
  }
  // It closes its line: the line just after names the speaker with a dash ("> — Dana, finance lead").
  if (/^[\s.,;!?]*$/.test(after) && end >= 0) {
    const nl = t.indexOf('\n', end + 1);
    return DASH_AFTER.test(unmark(t.slice(end + 1, Math.min(end + 81, nl < 0 ? t.length : nl))).replace(/^[\s>]+/, ''));
  }
  return false;
};
/** Fix round 5 (M1): outside a quote, a " right after a digit is an inch or second mark. Inside one it closes the quote, unless an inch
 *  mark goes on (8.5" × 11", 1"2) or a letter follows it. */
const inchMark = (t, i, open) => /\d/.test(t[i - 1] || '')
  && (open < 0 || /^(?: ?[×x] ?\d| ?×|\d)/.test(t.slice(i + 1, i + 4)) || /^[^\s\p{P}]/u.test(t[i + 1] || ' '));

/** Quoted text in double quotation marks that the rule above says to check. A quote never spans a blank line, a table row or a cell border
 *  ("|" on a table line); a " right after a digit is an inch or second mark (8.5" × 11") unless it closes a quote; code is not prose. */
export function quotesIn(text) {
  const t = blankCode(straight(text).slice(0, MAX_SCAN));
  const out = [];
  let open = -1;
  let table = tableLine(t, 0);
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === '\n') {
      if (t[i + 1] === '\n' || table) open = -1;
      table = tableLine(t, i + 1);
      continue;
    }
    if (ch === '|' && table) { open = -1; continue; }
    if (ch !== '"' || inchMark(t, i, open)) continue;
    if (open < 0) { open = i; continue; }
    const q = t.slice(open + 1, i).trim();
    const from = open;
    open = -1;
    if (letterWords(q) >= QUOTE_MIN_LONG_WORDS || (words(q) >= QUOTE_MIN_NAMED_WORDS && isNamed(t, from, i))) out.push(q);
  }
  return out;
}

/** D93 quotes: each part of each quote (split at an ellipsis) is in the sources, in D89's normal form. */
export function quotesCheck(text, sources) {
  const quotes = quotesIn(text);
  if (!quotes.length) return { met: true, value: 'No quotes' };
  const hay = normLoose(sources);
  const bad = quotes.filter((q) => {
    const parts = normLoose(q).split(/\s*[[(]?(?:\.\.\.|…)[\])]?\s*/).map((p) => p.replace(/^[\s,.;:!?'"-]+|[\s,.;:!?'"-]+$/g, '')).filter((p) => p.length >= 3);
    return !parts.length || !parts.every((p) => hay.includes(p));
  });
  return bad.length ? { met: false, value: `Not in the files: "${clip(bad[0])}"${more(bad.length - 1)}` } : { met: true, value: 'Met' };
}

const NUM_RE = /(?<![\p{L}\p{N}_.,])(\d{1,3}(?:[,  ]\d{3})+|\d+)(?:[.,](\d+))?(\s?%)?/gu;
/** M7, M8: a date (2026-11-19, 19.11.2026, 01/02/2026), with a time after it (12:30), is neither a number of the result nor a phone number. */
const DATE_RE = /(?<![\d.\/-])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})(?:,?\s+\d{1,2}:\d{2})?(?![\d.\/-]?\d)/g;
/** Fix round 5 (I6): a date has a day and a month that can be one (30/60/90 is three numbers, not a date). */
const dateLike = (m) => { const [a, b, c] = m.match(/\d+/g).map(Number); return /^\d{4}-/.test(m) ? b <= 12 && c <= 31 : a <= 31 && b <= 31 && (a <= 12 || b <= 12); };
const blankDates = (s) => s.replace(DATE_RE, (m) => (dateLike(m) ? ' '.repeat(m.length) : m));
/** Fix round 5 (I6): an amount written with its currency code (USD5000, EUR1200) is a number, not an id: the code is blanked. */
export const CURRENCY_CODES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'INR', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
  'RSD', 'BRL', 'MXN', 'ZAR', 'SGD', 'HKD', 'KRW', 'TRY']);
const CURRENCY_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${CURRENCY_CODES.join('|')})(?=\\d)`, 'gu');
const blankCurrency = (s) => s.replace(CURRENCY_RE, spaces);
const HEAD_NUM_RE = /^(\s*#{1,6}\s+)\d+(?:\.\d+)+\.?(?=\s)/;   // "## 1.1 Scope": a section number; "## 140 tickets" stays a number
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;   // 14:00, 12:30:45
const LIST_MARK_RE = /^(\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?)\d{1,3}[.)](?=\s)/;
/** Fix round 4: the number right after a standard's name ("ISO 8601", "RFC 4180", "UTF-8") names the standard, not a quantity. */
export const STANDARD_NAMES = Object.freeze(['ISO', 'RFC', 'IEEE', 'UTF', 'SHA', 'EN', 'DIN']);
const STANDARD_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${STANDARD_NAMES.join('|')})[ \\u00a0-]?(\\d+(?:[-:.]\\d+)*)`, 'gu');
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const CHAIN_RE = /[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu;
/** A word that mixes letters and digits as an id or hash does (v2, 4ea5, 0862ea97, a 6+ character hex string); a number with its unit
 *  (10pt, 300ms, 10x) is not one, so its number stays checked. */
const idWord = (w) => /\p{L}/u.test(w) && /\d/.test(w) && (!/^\d+\p{L}+$/u.test(w) || (w.length >= 6 && /^[0-9a-f]+$/i.test(w)));
/** A file path: a backslash with letters, a start like C:\ ./ ../ ~/ /, two or more slashes with letters, or a slash and a file extension. */
const pathToken = (w) => {
  let a = 0;
  let b = w.length;   // the marks around it trimmed by hand: a regex anchored at the end could backtrack on a long token
  while (a < b && '([<"\'*_'.includes(w[a])) a += 1;
  while (b > a && ')]>"\'*_,;:!?.'.includes(w[b - 1])) b -= 1;
  const x = w.slice(a, b);
  if (!/\p{L}/u.test(x)) return false;
  const slashes = (x.match(/\//g) || []).length;
  // Fix round 5 (I6): two slashes after a number or an amount are a rate or a list of numbers ($12/user/month, 30/60/90-day), unless a file
  // extension ends it (2026/11/notes.md).
  const ext = /\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(x);
  return x.includes('\\') || /^(?:[A-Za-z]:[\\/]|~?\/|\.{1,2}\/)/.test(x) || (slashes >= 2 && (!/^[$€£¥]?\d/.test(x) || ext)) || (slashes === 1 && ext);
};
/** Fix round 4: what in a result holds digits that are not numbers of the result, blanked (positions kept): code, links, file paths,
 *  ids and hashes (a chain such as 8b6bd033-5853-4ea5 when any of its words is one), and a standard's number. */
function blankNotNumbers(t) {
  return blankCode(t).replace(URL_RE, spaces)
    .replace(/\S+/g, (w) => (pathToken(w) ? spaces(w) : w))
    .replace(CHAIN_RE, (w) => (/\d/.test(w) && w.split(/[-_.]/).some(idWord) ? spaces(w) : w))
    .replace(STANDARD_RE, (m, n) => `${m.slice(0, m.length - n.length)}${spaces(n)}`);
}

/** The numbers of a text: "1,200" → 1200, "3.50" → 3.5, "60 %" → 60. A list marker or numbered heading ("1.", "## 2)") and a
 *  single digit without a per cent sign are skipped. `shown` is the number as written. `ofResult` (fix round 4): a result's text also
 *  skips the digits of code, links, paths, ids and standards' names (blankNotNumbers); the sources keep every number they have. */
export function numbersIn(text, { cap = true, ofResult = cap } = {}) {
  const out = [];
  const all = String(text ?? '').normalize('NFKC').replace(/\r\n?/g, '\n');
  const blankTo = (m, lead) => `${lead}${' '.repeat(m.length - lead.length)}`;
  // The result side is capped (MAX_SCAN); the sources side is not, so a number past 2 MB is still found (a linear scan, no backtracking).
  const scan = blankCurrency(cap ? all.slice(0, MAX_SCAN) : all);
  for (const raw of (ofResult ? blankNotNumbers(scan) : scan).split('\n')) {
    const line = blankDates(raw.replace(HEAD_NUM_RE, blankTo).replace(TIME_RE, (m) => ' '.repeat(m.length)).replace(LIST_MARK_RE, blankTo));
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
  const have = new Set(numbersIn(sources, { cap: false, ofResult: false }).map((x) => x.n));
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
  const digits = (p) => p.replace(/\D/g, '').length;
  // Two numbers side by side ("030 1234567 030 7654321") match as one of more than 15 digits: split it before each "0" or "+".
  const phones = (t.match(PHONE_RE) || []).flatMap((p) => (digits(p) > 15 ? p.split(/ (?=[+0])/) : [p])).filter((p) => digits(p) >= 9 && digits(p) <= 15).length;
  return { emails, phones, ibans, cards };
}
export function personalCheck(text) {
  const f = personalData(text);
  const found = [f.emails && plural(f.emails, 'e-mail address', 'e-mail addresses'), f.phones && plural(f.phones, 'phone number', 'phone numbers'),
    f.ibans && plural(f.ibans, 'bank account number', 'bank account numbers'), f.cards && plural(f.cards, 'card number', 'card numbers')].filter(Boolean);
  return found.length ? { met: false, value: `Found ${found.join(', ')}` } : { met: true, value: 'Met' };
}

/** The link ends at the first ")" that closes no "(" opened inside it (markdown's, a parenthesis around it), whatever follows
 *  ("**[a](url)**", "[a](u1)[b](u2)"); "…/Mercury_(planet)" keeps its own. Then closing punctuation is dropped. */
function trimLink(u) {
  let depth = 0;
  for (let i = 0; i < u.length; i += 1) {
    if (u[i] === '(') depth += 1;
    else if (u[i] === ')') { if (depth === 0) { u = u.slice(0, i); break; } depth -= 1; }
  }
  return u.replace(/[.,;:!?]+$/, '');
}
/** The http(s) links of a text, markdown or bare, in order, once each; closing punctuation is not part of a link. */
export function linksIn(text) {
  const out = [];
  for (const m of String(text ?? '').slice(0, MAX_SCAN).matchAll(/\bhttps?:\/\/[^\s<>"'`\]]+/gi)) {
    const u = trimLink(m[0]);
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
