// src/shared/workflow-tests/checks.mjs
// Workflow tests (plans/workflow-tests-part2-plan.md D18): what a good result needs. Pure and browser-safe: the Basics,
// the built-in automatic checks (counted exactly, without AI) and the verdict of one try. A Library script check is
// only validated and labelled here; src/core/workflow-tests/result.mjs runs it on the script bench.

export const CHECK_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'file', 'script']);
/** The kinds that read the main result's text (D25). */
export const TEXT_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions']);
export const CHECK_KIND_LABELS = Object.freeze({
  words: 'Length in words',
  sections: 'Has these sections',
  mentions: 'Must mention a text',
  'not-mentions': 'Must not mention a text',
  file: 'A file with this name is in the result',
  script: 'A Library script',
});
/** G11: no cost limit until the person sets one. */
export const DEFAULT_BASICS = Object.freeze({ noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null });

const WORDS_MAX = 1_000_000;
const SECTIONS_MAX = 20;
const TEXT_MAX = 200;
const SCRIPT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHECK_ID_RE = /^c_[a-z0-9]{1,24}$/;

export const fmtUsd = (n) => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;

/** Lower case, NFKC, straight quotes, single spaces: how "must mention" texts and section names compare. */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Words = whitespace-separated tokens holding a letter or a digit (markdown marks such as # - | do not count). */
export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const sectionKey = (s) => normText(s).replace(/^\d+[.)]\s*/, '').replace(/[\s:.\-–—]+$/u, '').trim();

/** The section keys of a markdown text: ATX headings (# …) and lines that are only bold (**…**). */
export function headingsOf(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const bold = atx ? null : /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line);
    const t = atx ? atx[1] : bold ? bold[1] : null;
    if (t) out.push(sectionKey(t));
  }
  return out;
}

const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const cleanText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * One automatic check, checked and cleaned. A valid `id` (c_…) is kept; the store gives new checks one.
 * @returns {{check: object|null, error: string|null}}
 */
export function normaliseCheck(raw) {
  if (!raw || typeof raw !== 'object') return { check: null, error: 'a check must be an object' };
  const kind = raw.kind;
  if (!CHECK_KINDS.includes(kind)) return { check: null, error: `unknown check kind "${kind}"` };
  const id = typeof raw.id === 'string' && CHECK_ID_RE.test(raw.id) ? raw.id : null;
  const done = (fields) => ({ check: { ...(id ? { id } : {}), kind, ...fields }, error: null });
  if (kind === 'words') {
    const min = int(raw.min);
    const max = int(raw.max);
    for (const [k, v] of [['min', min], ['max', max]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > WORDS_MAX)) return { check: null, error: `${k} must be a whole number of words` };
    }
    if (min === null && max === null) return { check: null, error: 'give a smallest or a largest number of words' };
    if (min !== null && max !== null && min > max) return { check: null, error: 'the smallest number of words is larger than the largest' };
    return done({ min, max });
  }
  if (kind === 'sections') {
    const list = Array.isArray(raw.names) ? raw.names : typeof raw.names === 'string' ? raw.names.split(',') : [];
    const names = [...new Set(list.map(cleanText).filter(Boolean))];
    if (!names.length) return { check: null, error: 'name at least one section' };
    if (names.length > SECTIONS_MAX || names.some((n) => n.length > TEXT_MAX)) {
      return { check: null, error: `at most ${SECTIONS_MAX} sections of up to ${TEXT_MAX} characters` };
    }
    return done({ names });
  }
  if (kind === 'mentions' || kind === 'not-mentions') {
    const text = cleanText(raw.text);
    if (!text || text.length > TEXT_MAX) return { check: null, error: `the text must be 1 to ${TEXT_MAX} characters` };
    return done({ text });
  }
  if (kind === 'file') {
    const name = cleanText(raw.name).replace(/\\/g, '/');
    if (!name || name.length > TEXT_MAX || name.startsWith('/') || name.split('/').includes('..')) {
      return { check: null, error: 'give a file name inside the result, such as summary.md' };
    }
    return done({ name });
  }
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!SCRIPT_KEY_RE.test(key)) return { check: null, error: 'pick a script from the Library' };
  const params = {};
  if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
    const entries = Object.entries(raw.params);
    if (entries.length > 20) return { check: null, error: 'at most 20 script settings' };
    for (const [k, v] of entries) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) return { check: null, error: `script setting "${k}" must be text, a number or yes/no` };
      params[k] = v;
    }
  }
  return done({ key, params });
}

/** "A", "A and B", "A, B and C" (C20, D34). */
export const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The check in plain words, as the editor and the results list it (C5 for a script). */
export function checkLabel(check, { scriptName = null } = {}) {
  const c = check || {};
  if (c.kind === 'words') {
    if (c.min !== null && c.max !== null) return `Length is ${c.min} to ${c.max} words`;
    return c.min !== null ? `Length is at least ${c.min} words` : `Length is at most ${c.max} words`;
  }
  if (c.kind === 'sections') return c.names.length === 1 ? `Has the section ${c.names[0]}` : `Has the sections ${andList(c.names)}`;   // C20
  if (c.kind === 'mentions') return `Mentions "${c.text}"`;
  if (c.kind === 'not-mentions') return `Does not mention "${c.text}"`;
  if (c.kind === 'file') return `Has a file named ${c.name}`;
  if (c.kind === 'script') return `The Library script "${scriptName || c.key}" passes`;
  return 'Unknown check';
}

const fileMatches = (want, rel) => {
  const w = String(want).toLowerCase();
  const r = String(rel || '').replace(/\\/g, '/').replace(/^work\//, '').toLowerCase();
  return r === w || r.split('/').pop() === w;
};

/**
 * A built-in check on one try's result (D25). `text`: the main result (null when the try left none); `files`: the
 * result folder's paths (`work/…`). A script check is not run here: result.mjs runs it on the bench.
 * @returns {{met: boolean, value: string}}
 */
export function runCheck(check, { text = null, files = [] } = {}) {
  if (TEXT_KINDS.includes(check.kind) && (typeof text !== 'string' || !text.trim())) return { met: false, value: 'No result' };
  if (check.kind === 'words') {
    const n = wordCount(text);
    const met = (check.min === null || n >= check.min) && (check.max === null || n <= check.max);
    return { met, value: `${n} words` };
  }
  if (check.kind === 'sections') {
    const have = new Set(headingsOf(text));
    const missing = check.names.filter((n) => !have.has(sectionKey(n)));
    return missing.length ? { met: false, value: `Missing ${andList(missing)}` } : { met: true, value: 'Met' };
  }
  if (check.kind === 'mentions' || check.kind === 'not-mentions') {
    const found = normText(text).includes(normText(check.text));
    const met = check.kind === 'mentions' ? found : !found;
    return { met, value: met ? 'Met' : 'Not met' };
  }
  if (check.kind === 'file') {
    const met = (Array.isArray(files) ? files : []).some((f) => fileMatches(check.name, f));
    return { met, value: met ? 'Met' : 'Not met' };
  }
  throw new Error(`runCheck: "${check.kind}" is not a built-in check`);
}

/** @returns {{basics: object|null, error: string|null}} */
export function normaliseBasics(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const out = {
    noError: b.noError === undefined ? DEFAULT_BASICS.noError : b.noError === true,
    noHelp: b.noHelp === undefined ? DEFAULT_BASICS.noHelp : b.noHelp === true,
    maxCostUsd: num(b.maxCostUsd),
    maxSentBack: num(b.maxSentBack),
  };
  if (out.maxCostUsd !== null && !(Number.isFinite(out.maxCostUsd) && out.maxCostUsd > 0 && out.maxCostUsd <= 10000)) {
    return { basics: null, error: 'the cost limit must be more than $0 and at most $10,000' };
  }
  if (out.maxSentBack !== null && !(Number.isInteger(out.maxSentBack) && out.maxSentBack >= 0 && out.maxSentBack <= 50)) {
    return { basics: null, error: 'the fix limit must be a whole number from 0 to 50' };
  }
  return { basics: out, error: null };
}

const sentBackLabel = (n) => (n === 0 ? 'Never sent back for fixes' : `Sent back for fixes at most ${n === 1 ? 'once' : `${n} times`}`);

/** The Basics an example checks, in board order (only those switched on). */
export function basicsList(basics) {
  const b = basics || DEFAULT_BASICS;
  const out = [];
  if (b.noError) out.push({ key: 'noError', label: 'Finishes without an error' });
  if (b.noHelp) out.push({ key: 'noHelp', label: 'Finishes without needing help from someone' });
  if (b.maxCostUsd !== null && b.maxCostUsd !== undefined) out.push({ key: 'maxCostUsd', label: `Costs at most ${fmtUsd(b.maxCostUsd)}` });
  if (b.maxSentBack !== null && b.maxSentBack !== undefined) out.push({ key: 'maxSentBack', label: sentBackLabel(b.maxSentBack) });
  return out;
}

/**
 * The verdict of one try (D18): it passes only when every Basic switched on and every automatic check is met.
 * @param {{basics: object}} example
 * @param {{status: string, costUsd: number, durationMs: number|null, sentBack: number, help: Array<{kind:string, question:string}>, failReason: string|null}} facts
 * @param {Array<{id:string, label:string, met:boolean, value:string, error?:string}>} [checkResults]
 * @param {{name?: string|null, source?: string|null, words?: number|null}} [result]
 */
export function judgeTry(example, facts, checkResults = [], result = {}) {
  const f = facts || {};
  const b = (example && example.basics) || DEFAULT_BASICS;
  const finished = f.status === 'done' && !f.failReason;
  const help = Array.isArray(f.help) ? f.help : [];
  const basics = basicsList(b).map(({ key, label }) => {
    if (key === 'noError') {
      return { key, label, met: finished, value: finished ? 'Met' : 'Not met',
        ...(finished ? {} : { detail: f.failReason || `The try ended as ${f.status || 'unknown'}` }) };
    }
    if (key === 'noHelp') {
      return { key, label, met: help.length === 0, value: help.length === 0 ? 'Met' : 'Not met',
        ...(help.length ? { detail: `Worca asked: "${help[0].question}"` } : {}) };
    }
    if (key === 'maxCostUsd') return { key, label, met: Number(f.costUsd || 0) <= b.maxCostUsd, value: fmtUsd(f.costUsd) };
    const n = Number(f.sentBack || 0);
    return { key, label, met: n <= b.maxSentBack, value: n === 1 ? '1 time' : `${n} times` };
  });
  const checks = (Array.isArray(checkResults) ? checkResults : []).map((c) => ({ ...c }));
  return {
    passed: basics.every((x) => x.met) && checks.every((c) => c.met),
    basics,
    checks,
    facts: { status: f.status || null, costUsd: Number(f.costUsd || 0), durationMs: f.durationMs ?? null,
      sentBack: Number(f.sentBack || 0), help, failReason: f.failReason || null },
    result: { name: result.name ?? null, source: result.source ?? null, words: result.words ?? null },
  };
}
