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
/** A text's unified-diff hunks read three more ways: the new file (context and added lines), the old file (context and
 *  removed lines) and the diff as it reads, each line without its +, - or space mark; everything outside a hunk is kept as it
 *  is. [] when the text holds no hunk. Pre-merge paid check: a checking model quotes code as it reads in the file, so a quote
 *  of two added lines was never found in the diff, and every verdict on a project's code was "Not checked". */
export function diffSides(text) {
  const s = String(text ?? '');
  if (!/^@@ /m.test(s)) return [];
  const nu = []; const old = []; const both = [];
  let hunk = false;
  for (const l of s.split(/\r?\n/)) {
    if (l.startsWith('@@ ')) hunk = true;
    else if (l.startsWith('diff --git ')) hunk = false;
    if (!hunk || l.startsWith('@@ ')) { nu.push(l); old.push(l); both.push(l); continue; }
    if (l.startsWith('\\')) continue;   // "\ No newline at end of file" is in neither file
    const line = l.slice(1);
    if (l.startsWith('+')) nu.push(line);
    else if (l.startsWith('-')) old.push(line);
    else { nu.push(line); old.push(line); }
    both.push(line);
  }
  return [nu.join('\n'), old.join('\n'), both.join('\n')];
}

const partsIn = (hay, parts) => {
  let from = 0;
  for (const x of parts) {
    const i = hay.indexOf(x, from);
    if (i < 0) return false;
    from = i + x.length;
  }
  return true;
};

/** D89: whether the proof is in the text (normLoose on both; each part between "…" at least 3 characters and the parts in order; 8 characters at least).
 *  A text with a diff is also searched as its two files (diffSides). */
export function proofFound(proof, text) {
  // A fragment quoted as "…passage…" is ordinary: one ellipsis at each end is trimmed before the parts are counted.
  const p = normLoose(proof).replace(/^["']+|["']+$/g, '').trim().replace(/^(?:\.\.\.)\s*|\s*(?:\.\.\.)$/g, '').replace(/^["']+|["']+$/g, '').trim();
  if (p.length < 8) return false;
  const parts = p.split(/\s*(?:\.\.\.|…)\s*/).map((x) => x.replace(/^["']+|["']+$/g, '').trim());
  if (parts.some((x) => x.length < 3)) return false;
  return [text, ...diffSides(text)].some((t) => partsIn(normLoose(t), parts));
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
  let innerFence = '';
  let inner = -1;   // fix round 6 (M3): a code block inside a prose fence (```js in ```markdown); its closing fence closes only it
  const closes = (f, i, by) => !!f && f[1][0] === by[0] && f[1].length >= by.length && !lines[i].slice(f[0].length).trim();
  for (let i = 0; i < lines.length; i += 1) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (open < 0) {
      if (f) { open = i; fence = f[1]; prose = PROSE_FENCE.test(lines[i].slice(f[0].length).trim().split(/\s+/)[0]); }
      continue;
    }
    if (inner >= 0) {
      if (closes(f, i, innerFence)) { for (let k = inner; k <= i; k += 1) lines[k] = spaces(lines[k]); inner = -1; }
      continue;
    }
    if (prose && f && lines[i].slice(f[0].length).trim()) { inner = i; innerFence = f[1]; continue; }
    if (!closes(f, i, fence)) continue;
    for (let k = open; k <= i; k += 1) if (!prose || k === open || k === i) lines[k] = spaces(lines[k]);
    open = -1;
  }
  if (inner >= 0) for (let k = inner; k < lines.length; k += 1) lines[k] = spaces(lines[k]);   // a code block cut off: code to the end
  if (open >= 0) lines[open] = spaces(lines[open]);
  return lines.join('\n').replace(/``[^`\n]+``|`[^`\n]+`/g, spaces);
}

/** User decision 2026-11-22: the quote rule is a fixed, short list (docs/workflows.md lists it with its known gaps). A quote is checked
 *  when it is long, QUOTE_MIN_LONG_WORDS words that contain a letter (digits alone do not count), however it is introduced; or when it
 *  has QUOTE_MIN_NAMED_WORDS words and is in one of QUOTE_FORMS, where the speaker is 1 to SPEAKER_MAX_WORDS words:
 *  (a) saidBefore: `<speaker> said:` (a SPEECH_VERBS verb, then a colon), then the quote; also on the next line (`Dana said:\n> "…"`).
 *      The speaker counts from its clause's start: the line's start (after "> " or a list mark) or a mark (`In March, the lead said:`).
 *  (b) saidAfter: the quote, then `, <speaker> said` (`"…," Dana said.`), the comma inside or after the closing mark.
 *  (c) dashAfter: the quote, then an em or en dash and the speaker, capitalised, then the end, a role after a comma, a full stop or a
 *      bracket (`— Dana`, `— **Dana**`, `— Product manager at Acme`, `— Dana, finance lead`); also on the next line.
 *  Markdown emphasis is ignored. A speaker that is a screen word (UI_LABELS) names nobody: after a leading the, this, that, a or an, all its
 *  words are screen words (`The button says:`, `— Button label`, `— Error`) or its last word is one in lower case (`The confirmation email
 *  says:`, `— Invoices page`). A name or role that only holds one is a speaker (`— Larry Page`, `— Field sales lead`, review M4). In (b),
 *  which, as and and are no speaker (`"…", as the brief says.`, review M5). Nothing else names a speaker: no bare colon (`Dana: "…"`), no
 *  brackets, no other verb or tense (`should say`, `to add`, `notes`), no "said Dana". */
export const QUOTE_MIN_NAMED_WORDS = 3;
export const QUOTE_MIN_LONG_WORDS = 8;
export const SPEAKER_MAX_WORDS = 4;
export const SPEECH_VERBS = Object.freeze(['said', 'says', 'wrote', 'writes', 'told us']);
/** Words of a screen, not people: a speaker that is one names nobody (see `screenWord`). */
export const UI_LABELS = Object.freeze(['Error', 'Hint', 'Title', 'Note', 'Warning', 'Label', 'Button', 'Message', 'Example', 'Tip', 'Status',
  'Placeholder', 'Tooltip', 'Text', 'Page', 'Screen', 'Dialog', 'Field', 'Banner', 'Heading', 'Caption', 'Prompt', 'Alert', 'Toast', 'Menu', 'Link',
  'State', 'Modal', 'Email', 'Subject', 'Subtitle', 'CTA', 'Tab', 'Badge', 'Card', 'Panel', 'Section', 'Notification', 'Header', 'Footer', 'Column',
  'Row', 'Option', 'Input']);
const WORD = String.raw`[\p{L}\p{N}'’&-]+`;
const VERB = SPEECH_VERBS.map((v) => v.replace(' ', String.raw`\s+`)).join('|');
const SPEAKER = String.raw`(${WORD}(?:\s+${WORD}){0,${SPEAKER_MAX_WORDS - 1}})`;
export const QUOTE_FORMS = Object.freeze({
  saidBefore: new RegExp(String.raw`(?:^|[^\p{L}\p{N}'’&\s-])\s*(?:(?:>|[*+-]|\d{1,3}[.)])\s+)*${SPEAKER}\s*,?\s+(?:${VERB})\s*:\s*$`, 'iu'),
  // No 'i' flag: the speaker classes match either case, and the verbs and "which/as/and" follow a quote in lower case. (A case-sensitive
  // group `(?-i:…)` would need RegExp modifiers, which Node 22, the oldest supported Node, cannot parse.)
  saidAfter: new RegExp(String.raw`^\s*,?\s*(?!(?:which|as|and)\s+\p{Ll})${SPEAKER}\s+(?:${VERB})(?!\p{L})`, 'u'),
  dashAfter: new RegExp(String.raw`^\s*[,.]?\s*[—–]\s*(\p{Lu}[\p{L}\p{N}'’&-]*(?:\s+${WORD}){0,${SPEAKER_MAX_WORDS - 1}})\s*(?:$|[.,;(])`, 'u'),
});
const UI_WORD = new Set(UI_LABELS.map((w) => w.toLowerCase()));
/** Review M4: whether a speaker is a screen word: after a leading article, all its words are screen words, or its last word is one in lower
 *  case. `Larry Page` and `Field sales lead` are people. */
const screenWord = (speaker) => {
  const ws = speaker.split(/\s+/).filter(Boolean);
  const lead = ws.length > 1 && /^(?:the|this|that|an?|primary|secondary|main|hero)$/i.test(ws[0]);   // round 8 M1: an article or a modifier
  if (lead) ws.shift();
  const ui = (w) => UI_WORD.has(w.toLowerCase());
  const last = ws.at(-1);
  return ws.every(ui) || (ui(last) && (lead || /^\p{Ll}/u.test(last) || (last.length > 1 && last === last.toUpperCase())));
};
/** The speaker a form found in `s`, unless it is a screen word. */
const speaks = (re, s) => { const m = re.exec(s); return !!m && !screenWord(m[1]); };
const unmark = (s) => s.replace(/[*_]/g, '');
const letterWords = (s) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
const tableLine = (t, at) => { const start = t.lastIndexOf('\n', at - 1) + 1; return /^\s*\|/.test(t.slice(start, start + 200)); };
/** The line just before the line that starts at `start` (its last 120 characters), or '' for the first line. */
const lineBefore = (t, start) => (start > 0 ? t.slice(Math.max(t.lastIndexOf('\n', start - 2) + 1, start - 121), start - 1) : '');
const isNamed = (t, open, close) => {
  const lineStart = t.lastIndexOf('\n', open) + 1;
  const end = t.indexOf('\n', close);
  const before = unmark(t.slice(Math.max(lineStart, open - 120), open));
  const after = unmark(t.slice(close + 1, Math.min(close + 80, end < 0 ? t.length : end)));
  const comma = /,\s*$/.test(unmark(t.slice(open + 1, close))) || /^\s*,/.test(after);
  if (speaks(QUOTE_FORMS.saidBefore, before) || (comma && speaks(QUOTE_FORMS.saidAfter, after)) || speaks(QUOTE_FORMS.dashAfter, after)) return true;
  // (a) on the line before: the quote opens its line (after "> ", a list mark or a list number).
  if (/^[\s>]*(?:[*+-]|\d{1,3}[.)])?\s*$/.test(before) && speaks(QUOTE_FORMS.saidBefore, unmark(lineBefore(t, lineStart)).replace(/^[\s>]+/, ''))) return true;
  // (c) on the line after: the quote closes its line, and the next line starts with the dash ("> — Dana, finance lead").
  if (/^[\s.,;!?]*$/.test(after) && end >= 0) {
    const nl = t.indexOf('\n', end + 1);
    return speaks(QUOTE_FORMS.dashAfter, unmark(t.slice(end + 1, Math.min(end + 81, nl < 0 ? t.length : nl))).replace(/^[\s>]+/, ''));
  }
  return false;
};
/** Fix round 5 (M1): outside a quote, a " right after a digit is an inch or second mark. Inside one it closes the quote, unless an inch
 *  mark goes on (8.5" × 11", 1"2) or a letter follows it. */
const inchMark = (t, i, open) => /\d/.test(t[i - 1] || '')
  && (open < 0 || /^(?: ?[×x] ?\d| ?×|\d)/.test(t.slice(i + 1, i + 4)) || /^[^\s\p{P}]/u.test(t[i + 1] || ' ') || closesLater(t, i));
/** Fix round 6 (M2): inside a quote, `8.5" paper` is an inch mark when a word follows it and the next " of the paragraph is a closing one
 *  (followed by a space, a mark or the end): `"We print on 8.5" paper and file it by hand." Then Lee said: "…"`. */
function closesLater(t, i) {
  if (!/^\s+\p{L}/u.test(t.slice(i + 1, i + 3))) return false;
  const para = t.indexOf('\n\n', i);
  const next = t.indexOf('"', i + 1);
  return next > 0 && (para < 0 || next < para) && /^(?:$|[\s\p{P}])/u.test(t.slice(next + 1, next + 2));
}

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
// Fix round 6 (M4): only before an amount; EUR2024-INV-0042 (digits, then "-" and a letter) is an id and keeps its code. Fix round 7
// (review M1): a "-" before another coded amount is a range (USD750-EUR800): both codes go.
const CODES = CURRENCY_CODES.join('|');
const CURRENCY_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${CODES})(?=\\d[\\d.,]*(?![\\d.,\\p{L}]|-(?!(?:${CODES})\\d)\\p{L}))`, 'gu');
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
  // Fix round 5 (I6): two slashes in a rate or a list of numbers ($12/user/month, 30/60/90-day) are no path, unless a file extension ends it
  // (2026/11/notes.md). Fix round 6 (M4): only in those shapes (an amount, then words; numbers, then "-word"): 2026/11/drafts is a path,
  // since its second part is a number. Fix round 7 (review M1): the amount's sign is optional (12/user/month).
  const ext = /\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(x);
  // Review M6 (round 7): without a sign, a year first is a folder (2026/reports/final), not an amount.
  const rate = /^(?:[$€£¥]|(?!(?:19|20)\d\d\/(?!(?:user|seat|month|year|mo|yr|unit|license|member|person|project|team|hour|hr|day|week)\b)))\d[\d.,]*(?:\/\p{L}+)+$/u.test(x) || /^\d+(?:\/\d+)+-\p{L}+$/u.test(x);
  return x.includes('\\') || /^(?:[A-Za-z]:[\\/]|~?\/|\.{1,2}\/)/.test(x) || (slashes >= 2 && (!rate || ext)) || (slashes === 1 && ext);
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
