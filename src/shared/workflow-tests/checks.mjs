// src/shared/workflow-tests/checks.mjs
// Workflow tests (plans/workflow-tests-part2-plan.md D18): what a good result needs. Pure and browser-safe: the Basics,
// the built-in automatic checks (counted exactly, without AI) and the verdict of one try. A Library script check is
// only validated and labelled here; src/core/workflow-tests/result.mjs runs it on the script bench.

export const CHECK_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'file', 'script', 'command', 'under', 'unchanged', 'max-files']);
/** The kinds that read the main result's text (D25). */
export const TEXT_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions']);
/** 3b (Q10, D73): the pure project checks; they read the try's change list. */
export const SCOPE_KINDS = Object.freeze(['under', 'unchanged', 'max-files']);
export const PROJECT_KINDS = Object.freeze(['command', ...SCOPE_KINDS]);   // 3a D57, 3b D73: only on an example with a project
export const CHECK_KIND_LABELS = Object.freeze({
  words: 'Length in words',
  sections: 'Has these sections',
  mentions: 'Must mention a text',
  'not-mentions': 'Must not mention a text',
  file: 'A file with this name is in the result',
  script: 'A Library script',
  command: 'The command passes',
  under: 'Changes only files under …',
  unchanged: 'Leaves these files unchanged',
  'max-files': 'Changes at most N files',
});
/** Board 33: the file check's name in an example with a project (D59: added, changed or renamed, never removed). */
export const PROJECT_FILE_KIND_LABEL = 'A file with this name is added or changed';
/** D57: "Stop the command after" (board 33), in minutes. */
export const COMMAND_TIMEOUTS = Object.freeze([1, 5, 10, 30]);
const CMD_MAX = 500;
const PATHS_MAX = 20;
export const MAX_FILES_LIMIT = 10_000;
const VALUE_PATH_MAX = 100;
/** A comma-separated text or an array, as trimmed non-empty strings. */
const listOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x ?? '').trim()).filter(Boolean);
/** A path a person typed, inside the project: forward slashes, no `./`, no repeated `/`; null when it leaves the project. */
function insidePath(raw) {
  const p = String(raw).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '');
  if (!p || p === '.' || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..') || p.length > TEXT_MAX) return null;
  return p;
}
/** G11: no cost limit until the person sets one. */
export const DEFAULT_BASICS = Object.freeze({ noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null });

const WORDS_MAX = 1_000_000;
const SECTIONS_MAX = 20;
const TEXT_MAX = 200;
const SCRIPT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHECK_ID_RE = /^c_[a-z0-9]{1,24}$/;

export const fmtUsd = (n) => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;

/**
 * Dollars a person typed: "$15", "15,50" or "15.50" (a decimal comma or point), "1.234,50" or "1,234.50" (thousands
 * either way). Empty → null. A negative, an exponent, letters or an ambiguous "1,000" (one dollar or a thousand?) → NaN.
 */
export function parseUsd(raw) {
  let t = String(raw ?? '').trim();
  if (t === '') return null;
  t = t.replace(/^\$\s*/, '').replace(/\s*\$$/, '');
  if (!/^[0-9.,]*[0-9][0-9.,]*$/.test(t)) return Number.NaN;
  const dots = t.split('.').length - 1;
  const commas = t.split(',').length - 1;
  const grouped = (s, sep) => new RegExp(`^[0-9]{1,3}(\\${sep}[0-9]{3})+$`).test(s);
  let whole = t;
  let frac = '';
  if (dots && commas) {
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const sep = dec === '.' ? ',' : '.';
    if ((dec === '.' ? dots : commas) !== 1) return Number.NaN;
    [whole, frac] = t.split(dec);
    if (!grouped(whole, sep)) return Number.NaN;
    whole = whole.split(sep).join('');
  } else if (dots > 1 || commas > 1) {
    const sep = dots ? '.' : ',';
    if (!grouped(t, sep)) return Number.NaN;
    whole = t.split(sep).join('');
  } else if (dots || commas) {
    [whole, frac] = t.split(dots ? '.' : ',');
    if (commas && /^[1-9][0-9]{0,2}$/.test(whole) && frac.length === 3) return Number.NaN;   // "1,000"
  }
  if (!/^[0-9]*$/.test(whole) || !/^[0-9]*$/.test(frac) || (whole === '' && frac === '')) return Number.NaN;
  return Number(`${whole || '0'}.${frac || '0'}`);
}

/** Lower case, NFKC, straight quotes, single spaces: how "must mention" texts and section names compare. */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Words = whitespace-separated tokens holding a letter or a digit (markdown marks such as # - | do not count). */
export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Drops trailing spaces, colons, dots and dashes in one pass (the regex [\s:.\-–—]+$ is quadratic on long runs). */
function trimEndMarks(s) {
  let end = s.length;
  while (end > 0 && (/\s/.test(s[end - 1]) || ':.-–—'.includes(s[end - 1]))) end--;
  return s.slice(0, end);
}
const sectionKey = (s) => trimEndMarks(normText(s).replace(/^\d+[.)]\s*/, '')).trim();

// The heading readers below walk each line once. They give exactly what /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/ and
// /^\s*\*\*(.+?)\*\*\s*:?\s*$/ gave, but those regexes backtracked cubically on a long run of spaces, and a try's
// own output could freeze the server with one such line (final review I1).
const isWs = (ch) => /\s/.test(ch);
/** What `.` does not match (a line split on \r?\n can still hold these). */
const isTerm = (ch) => ch === '\r' || ch === '\n' || ch === ' ' || ch === ' ';
const hasTerm = (s, from, to) => {
  for (let i = from; i < to; i++) if (isTerm(s[i])) return true;
  return false;
};

/** `# Title ##` → "Title"; null when the line is not an ATX heading. */
function atxTitle(line) {
  const n = line.length;
  let i = 0;
  while (i < 3 && i < n && isWs(line[i])) i++;
  let hashes = 0;
  while (i < n && line[i] === '#') { i++; hashes++; }
  if (hashes < 1 || hashes > 6 || i >= n || !isWs(line[i])) return null;
  const wsStart = i;
  while (i < n && isWs(line[i])) i++;
  if (i === n) {
    // Only spaces after the marks: the title is one of them (never the first), and it reads as an empty key.
    for (let k = n - 1; k > wsStart; k--) if (!isTerm(line[k])) return line[k];
    return null;
  }
  // The trailing "  ##  " that is not part of the title: spaces, then closing marks, then spaces, read from the end.
  let end = n;
  while (end > i && isWs(line[end - 1])) end--;
  while (end > i && line[end - 1] === '#') end--;
  while (end > i && isWs(line[end - 1])) end--;
  if (end === i) end = i + 1;
  return hasTerm(line, i, end) ? null : line.slice(i, end);
}

/** `**Title**:` → "Title"; null when the line is not only bold. */
function boldTitle(line) {
  const n = line.length;
  let i = 0;
  while (i < n && isWs(line[i])) i++;
  if (line[i] !== '*' || line[i + 1] !== '*') return null;
  const start = i + 2;
  // The closing ** may be followed only by spaces, one optional colon and spaces.
  let tail = n;
  while (tail > start && isWs(line[tail - 1])) tail--;
  if (tail > start && line[tail - 1] === ':') tail--;
  while (tail > start && isWs(line[tail - 1])) tail--;
  for (let p = Math.max(start + 1, tail - 2); p + 2 <= n; p++) {
    if (line[p] === '*' && line[p + 1] === '*') return hasTerm(line, start, p) ? null : line.slice(start, p);
  }
  return null;
}

/** The section keys of a markdown text: ATX headings (# …) and lines that are only bold (**…**). */
export function headingsOf(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = atxTitle(line) ?? boldTitle(line);
    if (t) out.push(sectionKey(t));
  }
  return out;
}

const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const cleanText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const cleanPath = (v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()).replace(/\\/g, '/');
/** D58: a text check's optional file. {file: null} when none; {error} for a path outside the project. */
function fileOf(raw) {
  if (raw.file == null || String(raw.file).trim() === '') return { file: null };
  const p = cleanPath(raw.file);
  if (p.length > TEXT_MAX || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) {
    return { error: 'give a file inside the project, such as CHANGELOG.md' };
  }
  return { file: p };
}

/**
 * One automatic check, checked and cleaned. A valid `id` (c_…) is kept; the store gives new checks one.
 * @returns {{check: object|null, error: string|null}}
 */
export function normaliseCheck(raw) {
  if (!raw || typeof raw !== 'object') return { check: null, error: 'a check must be an object' };
  const kind = raw.kind;
  if (!CHECK_KINDS.includes(kind)) return { check: null, error: `unknown check kind "${kind}"` };
  const id = typeof raw.id === 'string' && CHECK_ID_RE.test(raw.id) ? raw.id : null;
  const done = (fields, file = null) => ({ check: { ...(id ? { id } : {}), kind, ...fields, ...(file ? { file } : {}) }, error: null });
  const f = TEXT_KINDS.includes(kind) ? fileOf(raw) : { file: null };
  if (f.error) return { check: null, error: f.error };
  if (kind === 'words') {
    const min = int(raw.min);
    const max = int(raw.max);
    for (const [k, v] of [['min', min], ['max', max]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > WORDS_MAX)) return { check: null, error: `${k} must be a whole number of words` };
    }
    if (min === null && max === null) return { check: null, error: 'give a smallest or a largest number of words' };
    if (min !== null && max !== null && min > max) return { check: null, error: 'the smallest number of words is larger than the largest' };
    return done({ min, max }, f.file);
  }
  if (kind === 'sections') {
    const list = Array.isArray(raw.names) ? raw.names : typeof raw.names === 'string' ? raw.names.split(',') : [];
    const names = [...new Set(list.map(cleanText).filter(Boolean))];
    if (!names.length) return { check: null, error: 'name at least one section' };
    if (names.length > SECTIONS_MAX || names.some((n) => n.length > TEXT_MAX)) {
      return { check: null, error: `at most ${SECTIONS_MAX} sections of up to ${TEXT_MAX} characters` };
    }
    return done({ names }, f.file);
  }
  if (kind === 'mentions' || kind === 'not-mentions') {
    const text = cleanText(raw.text);
    if (!text || text.length > TEXT_MAX) return { check: null, error: `the text must be 1 to ${TEXT_MAX} characters` };
    return done({ text }, f.file);
  }
  if (kind === 'file') {
    const name = cleanText(raw.name).replace(/\\/g, '/');
    if (!name || name.length > TEXT_MAX || name.startsWith('/') || name.split('/').includes('..')) {
      return { check: null, error: 'give a file name inside the result, such as summary.md' };
    }
    return done({ name });
  }
  if (kind === 'command') {
    const cmd = typeof raw.cmd === 'string' ? raw.cmd.trim() : '';
    if (!cmd) return { check: null, error: 'write the command, such as npm test' };
    if (cmd.length > CMD_MAX || /[\r\n]/.test(cmd)) return { check: null, error: `the command must fit on one line of up to ${CMD_MAX} characters` };
    const t = raw.timeoutMin === undefined || raw.timeoutMin === null || raw.timeoutMin === '' ? 10 : Number(raw.timeoutMin);
    if (!COMMAND_TIMEOUTS.includes(t)) return { check: null, error: 'the time limit must be 1, 5, 10 or 30 minutes' };
    return done({ cmd, timeoutMin: t });
  }
  if (kind === 'under') {
    const dirs = [];
    for (const raw1 of listOf(raw.dirs)) {
      const p = insidePath(raw1);
      if (!p || /[*?[\]]/.test(p)) return { check: null, error: 'give folders inside the project, such as src/' };
      const d = `${p.replace(/\/+$/, '')}/`;
      if (d === '/') return { check: null, error: 'give folders inside the project, such as src/' };
      if (!dirs.includes(d)) dirs.push(d);
    }
    if (!dirs.length) return { check: null, error: 'name at least one folder' };
    if (dirs.length > PATHS_MAX) return { check: null, error: `at most ${PATHS_MAX} folders` };
    return done({ dirs });
  }
  if (kind === 'unchanged') {
    const patterns = [];
    for (const raw1 of listOf(raw.patterns)) {
      const p = insidePath(raw1);
      if (!p) return { check: null, error: 'give files or patterns inside the project, such as test/**' };
      if (!patterns.includes(p)) patterns.push(p);
    }
    if (!patterns.length) return { check: null, error: 'name at least one file or pattern' };
    if (patterns.length > PATHS_MAX) return { check: null, error: `at most ${PATHS_MAX} files or patterns` };
    return done({ patterns });
  }
  if (kind === 'max-files') {
    const n = raw.max === '' || raw.max == null || (typeof raw.max === 'string' && !/^\s*\d+\s*$/.test(raw.max)) ? Number.NaN : Number(raw.max);
    if (!Number.isInteger(n) || n < 0 || n > MAX_FILES_LIMIT) return { check: null, error: `the most files must be a whole number from 0 to ${MAX_FILES_LIMIT}` };
    return done({ max: n });
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
  const inFile = (s) => (c.file ? `${s} in ${c.file}` : s);
  if (c.kind === 'words') {
    if (c.min !== null && c.max !== null) return inFile(`Length is ${c.min} to ${c.max} words`);
    return inFile(c.min !== null ? `Length is at least ${c.min} words` : `Length is at most ${c.max} words`);
  }
  if (c.kind === 'sections') return inFile(c.names.length === 1 ? `Has the section ${c.names[0]}` : `Has the sections ${andList(c.names)}`);   // C20
  if (c.kind === 'mentions') return inFile(`Mentions "${c.text}"`);
  if (c.kind === 'not-mentions') return inFile(`Does not mention "${c.text}"`);
  if (c.kind === 'file') return `Has a file named ${c.name}`;
  if (c.kind === 'script') return `The Library script "${scriptName || c.key}" passes`;
  if (c.kind === 'command') return `The command ${c.cmd} passes`;
  if (c.kind === 'under') return `Changes only files under ${andList(c.dirs)}`;
  if (c.kind === 'unchanged') return `Leaves these files unchanged: ${c.patterns.join(', ')}`;
  if (c.kind === 'max-files') return `Changes at most ${c.max} ${c.max === 1 ? 'file' : 'files'}`;
  return 'Unknown check';
}

const fileMatches = (want, rel) => {
  const w = String(want).toLowerCase();
  const r = String(rel || '').replace(/\\/g, '/').replace(/^work\//, '').toLowerCase();
  return r === w || r.split('/').pop() === w;
};

/** One name against one pattern segment: `*` any characters, `?` one. Greedy with one backtrack point, no regex (a try's
 *  paths and a person's patterns must never be able to stall the server: final review I1's lesson). */
function nameMatches(p, s) {
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && (p[i] === '?' || p[i] === s[j])) { i += 1; j += 1; }
    else if (i < p.length && p[i] === '*') { star = i; i += 1; mark = j; }
    else if (star !== -1) { i = star + 1; mark += 1; j = mark; }
    else return false;
  }
  while (i < p.length && p[i] === '*') i += 1;
  return i === p.length;
}

/**
 * D73: does a changed `path` (relative, forward slashes) match a person's `pattern`? `**` = any folders (also none), `*` and
 * `?` inside one name, a trailing `/` = everything under that folder, `dir/**` = everything inside `dir` (not a file named
 * `dir`), a pattern with no `/` = that name at any depth (as the file check and .gitignore). Case-sensitive, as git is.
 * Segment by segment over a set of positions: linear in the path for a fixed pattern.
 */
export function pathMatches(pattern, path) {
  let pat = String(pattern || '');
  if (pat.endsWith('/')) pat = `${pat}**`;
  if (!pat.includes('/')) pat = `**/${pat}`;
  const ps = pat.split('/');
  const xs = String(path || '').split('/');
  const n = ps.length;
  if (n > 1 && ps[n - 1] === '**' && ps[n - 2] !== '**' && xs.length < n) return false;   // `dir/**` needs something inside dir
  const closure = (set) => {
    const out = new Set();
    const stack = [...set];
    while (stack.length) {
      const i = stack.pop();
      if (out.has(i)) continue;
      out.add(i);
      if (i < n && ps[i] === '**') stack.push(i + 1);
    }
    return out;
  };
  let cur = closure([0]);
  for (const x of xs) {
    const next = new Set();
    for (const i of cur) {
      if (i >= n) continue;
      if (ps[i] === '**') next.add(i);
      else if (nameMatches(ps[i], x)) next.add(i + 1);
    }
    cur = closure(next);
    if (!cur.size) return false;
  }
  return cur.has(n);
}

const clipPath = (p) => (p.length > VALUE_PATH_MAX ? `${p.slice(0, VALUE_PATH_MAX - 1)}…` : p);
const changedValue = (bad) => `Changed ${clipPath(bad[0])}${bad.length > 1 ? ` and ${bad.length - 1} more` : ''}`;
const filesValue = (n) => (n === 0 ? 'No files' : n === 1 ? '1 file' : `${n} files`);

/**
 * A built-in check on one try's result (D25). `changes` (3b D73): the try's change list, `{ touched, total }`, null without a project. `text`: the main result (null when the try left none); `files`: the
 * result folder's paths (`work/…`). A script check is not run here: result.mjs runs it on the bench.
 * @returns {{met: boolean, value: string}}
 */
export function runCheck(check, { text = null, files = [], changes = null } = {}) {
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
  if (SCOPE_KINDS.includes(check.kind)) {
    if (!changes || !Array.isArray(changes.touched)) return { met: false, value: 'Not run: the example has no project' };
    if (check.kind === 'max-files') {
      const n = Number(changes.total || 0);
      return { met: n <= check.max, value: filesValue(n) };
    }
    const bad = check.kind === 'under'
      ? changes.touched.filter((p) => !check.dirs.some((d) => p.startsWith(d)))
      : changes.touched.filter((p) => check.patterns.some((pat) => pathMatches(pat, p)));
    return bad.length ? { met: false, value: changedValue(bad) } : { met: true, value: 'Met' };
  }
  throw new Error(`runCheck: "${check.kind}" is not a built-in check`);   // script and command: result.mjs runs them
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

/**
 * D57: the value of a command check (board 36: "213 passed", "212 passed, 1 failed"). node:test's and TAP's counts become
 * that sentence; otherwise the last line that counts passed or failed tests; otherwise the last line. Colours removed.
 */
export function commandSummary(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  const last = (re) => { for (let i = lines.length - 1; i >= 0; i -= 1) { const m = re.exec(lines[i]); if (m) return Number(m[1]); } return null; };
  const pass = last(/^(?:ℹ|#)\s*pass\s+(\d+)$/);
  const fail = last(/^(?:ℹ|#)\s*fail\s+(\d+)$/);
  if (pass !== null && fail !== null) return fail ? `${pass} passed, ${fail} failed` : `${pass} passed`;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/\b\d+\s+(?:passed|passing|failed|failing)\b/i.test(lines[i])) return lines[i].slice(0, 120);
  }
  return lines.length ? lines[lines.length - 1].slice(0, 120) : '';
}
