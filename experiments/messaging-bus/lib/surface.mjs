// experiments/messaging-bus/lib/surface.mjs — what counts as a shared interface (plan §3.3, §4.2).
// Pure. A surface is a plain JSON object (so the hook can store it): a flat map name → normalised
// signature per kind. Every scanner is linear in its input: comments, strings and regex literals are
// masked in one pass, brackets are matched once with a stack, no regex has a nested quantifier, and
// no statement is walked twice.
import { createHash } from 'node:crypto';
import { redactSecretValues } from './redact.mjs';

const JS_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;
const MEMBER_MAX = 400;
const WALK_MAX = 4000;

const base = (p) => String(p).split('/').pop();
const isTestPath = (p) => /\.test\./.test(base(p)) || String(p).split('/').slice(0, -1).includes('test');

function topLevelHasSchema(text) {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, '$schema');
  } catch {
    return false;
  }
}

/** 'js' | 'sql' | 'json-schema' | 'config' | 'none'. JSON needs its text to look for a top-level `$schema`. */
export function classify(path, text) {
  const p = String(path ?? '');
  if (!p || isTestPath(p)) return 'none';
  if (JS_EXT.test(p)) return 'js';
  if (/\.sql$/i.test(p)) return 'sql';
  if (!/\.json$/i.test(p)) return 'none';
  const name = base(p);
  if (/\.schema\.json$/i.test(name)) return 'json-schema';
  if (typeof text === 'string' && topLevelHasSchema(text)) return 'json-schema';
  if (name === 'package.json' || /^tsconfig.*\.json$/.test(name) || /\.config\.json$/.test(name)) return 'config';
  const dirs = p.split('/').slice(0, -1);
  if (dirs.includes('config') || dirs.includes('schemas')) return 'config';
  return 'none';
}

// ---------------------------------------------------------------------------------------------
// JS/TS

// A `/` starts a regex literal after one of these characters (or at the start of the text) or one of
// these words; anywhere else it divides. `<` is left out: in JSX `</div>` is far more common.
const REGEX_AFTER_CHAR = new Set('(,=:[!&|?{};+-*%>~^');
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);

// A regex literal is short: scanning at most this far keeps `/[` runs on one long line linear.
const REGEX_MAX = 512;

/** Index of the `/` that closes the regex literal opened at `j`, or −1 (a regex never spans a line nor passes REGEX_MAX). */
function regexEnd(text, j) {
  const stop = Math.min(text.length, j + 1 + REGEX_MAX);
  let inClass = false;
  for (let k = j + 1; k < stop; k++) {
    const c = text[k];
    if (c === '\n') return -1;
    if (c === '\\') k++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return k;
  }
  return -1;
}

/** Whether a `/` at `k` may open a regex, from the last token before it (the same rule as the top level). */
function regexAllowedAt(text, k, floor) {
  let e = k - 1;
  while (e >= floor && /\s/.test(text[e])) e--;
  if (e < floor) return true;
  const word = /[\w$]+$/.exec(text.slice(Math.max(floor, e - 11), e + 1));
  return word ? REGEX_AFTER_WORD.has(word[0]) : REGEX_AFTER_CHAR.has(text[e]);
}

/** Index of the backtick that closes the template opened at `j` (nested `${ … }` and templates followed), or the text's length. */
function templateEnd(text, j) {
  const n = text.length;
  const depth = []; // one brace depth per open `${`
  let inTpl = true;
  let k = j + 1;
  while (k < n) {
    const c = text[k];
    if (inTpl) {
      if (c === '\\') { k += 2; continue; }
      if (c === '`') {
        if (depth.length === 0) return k;
        inTpl = false;
      } else if (c === '$' && text[k + 1] === '{') { depth.push(0); inTpl = false; k++; }
    } else if (c === '`') inTpl = true;
    else if (c === '{') depth[depth.length - 1]++;
    else if (c === '}') {
      if (depth[depth.length - 1] === 0) { depth.pop(); inTpl = true; } else depth[depth.length - 1]--;
    } else if (c === '"' || c === "'") {
      k++;
      while (k < n && text[k] !== c && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1;
    } else if (c === '/' && text[k + 1] === '/') {
      const nl = text.indexOf('\n', k);
      if (nl < 0) return n;
      k = nl;
    } else if (c === '/' && text[k + 1] === '*') {
      const end = text.indexOf('*/', k + 2);
      if (end < 0) return n;
      k = end + 1;
    } else if (c === '/' && regexAllowedAt(text, k, j + 1)) {
      const end = regexEnd(text, k);
      if (end >= 0) k = end;
    }
    k++;
  }
  return n;
}

/**
 * One pass: `code` has comments blanked (newlines kept), `mask` also blanks string, template and regex
 * contents (quotes kept). Both keep the input's length, so indexes line up. `literals` lists the
 * `[start, end)` span of every string and template body.
 */
export function maskSource(text) {
  const n = text.length;
  const code = [];
  const mask = [];
  const literals = [];
  const SPECIAL = /[/"'`]/g;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let i = 0;
  let regexOk = true; // what the last token before `i` allows a `/` to be
  while (i < n) {
    SPECIAL.lastIndex = i;
    const hit = SPECIAL.exec(text);
    const j = hit ? hit.index : n;
    if (j > i) {
      const run = text.slice(i, j);
      code.push(run); mask.push(run);
      const tail = run.trimEnd();
      if (tail) {
        const word = /[\w$]+$/.exec(tail.slice(-12));
        regexOk = word ? REGEX_AFTER_WORD.has(word[0]) : REGEX_AFTER_CHAR.has(tail[tail.length - 1]);
      }
    }
    if (j >= n) break;
    const c = text[j];
    if (c === '/' && text[j + 1] === '/') {
      const nl = text.indexOf('\n', j);
      const stop = nl < 0 ? n : nl;
      const sp = ' '.repeat(stop - j);
      code.push(sp); mask.push(sp);
      i = stop;
    } else if (c === '/' && text[j + 1] === '*') {
      const end = text.indexOf('*/', j + 2);
      const stop = end < 0 ? n : end + 2;
      const b = blank(text.slice(j, stop));
      code.push(b); mask.push(b);
      i = stop;
    } else if (c === '/') {
      const end = regexOk ? regexEnd(text, j) : -1;
      if (end < 0) {
        code.push(c); mask.push(c);
        i = j + 1;
        regexOk = true; // after a division operator
      } else {
        code.push(text.slice(j, end + 1));
        mask.push('/', blank(text.slice(j + 1, end)), '/');
        i = end + 1;
        regexOk = false;
      }
    } else {
      let k;
      if (c === '`') k = templateEnd(text, j);
      else {
        k = j + 1;
        while (k < n && text[k] !== c) {
          if (text[k] === '\n') break; // an unclosed quote ends at the line
          k += text[k] === '\\' && k + 1 < n ? 2 : 1;
        }
      }
      const stop = Math.min(k, n);
      const inner = text.slice(j + 1, stop);
      const closed = k < n && text[k] === c;
      code.push(c, inner, closed ? c : '');
      mask.push(c, blank(inner), closed ? c : '');
      literals.push([j + 1, stop]);
      i = closed ? k + 1 : stop;
      regexOk = false;
    }
  }
  return { code: code.join(''), mask: mask.join(''), literals };
}

const OPEN = { '(': ')', '{': '}', '[': ']' };
const CLOSE_OF = { 40: 41, 123: 125, 91: 93 };

/** Index of each opener's matching closer (−1 when unmatched), computed once in O(n). */
export function matchBrackets(s) {
  const m = new Int32Array(s.length).fill(-1);
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 40 || c === 123 || c === 91) stack.push(i);
    else if (c === 41 || c === 125 || c === 93) {
      // pop to the nearest opener of the same family; stray closers are ignored
      for (let k = stack.length - 1; k >= 0 && k >= stack.length - 64; k--) {
        if (CLOSE_OF[s.charCodeAt(stack[k])] === c) { m[stack[k]] = i; stack.length = k; break; }
      }
    }
  }
  return m;
}

/** Whitespace collapsed, no space around punctuation, no trailing commas; `, ` between items for display. */
export function normSig(s) {
  return String(s)
    .replace(/\s+/g, ' ')
    .replace(/ ?([(){}[\],;:<>=|&?]) ?/g, '$1')
    .replace(/[,;]+([)}\]])/g, '$1')
    .replace(/,/g, ', ')
    .trim();
}

/** Member bodies (interface / enum / type literal): a newline separates members like `;` does. */
function normMembers(s) {
  const t = normSig(String(s).replace(/\n/g, ';'));
  return t.replace(/;+/g, ';').replace(/\{;/g, '{').replace(/;\}/g, '}').replace(/^;|;$/g, '');
}

const NEXT_EXPORT = /^(?:export\b|module\.exports\b|exports\.)/;

/** End of a statement that starts at `i`: `;`, or a newline at depth 0 that does not continue it or that a new export follows. */
function statementEnd(mask, match, i) {
  const limit = Math.min(mask.length, i + WALK_MAX);
  let j = i;
  while (j < limit) {
    const c = mask[j];
    if (OPEN[c]) {
      const k = match[j];
      if (k < 0) return limit;
      j = k + 1;
      continue;
    }
    if (c === ';') return j;
    if (c === '\n') {
      const before = mask.slice(Math.max(i, j - 3), j).trimEnd();
      const after = mask.slice(j + 1, j + 40).trimStart();
      if (NEXT_EXPORT.test(after) || (!/[=|&,(]$/.test(before) && !/^[|&.?:]/.test(after))) return j;
    }
    j++;
  }
  return limit;
}

/** `(params)` text from the opener at `open`, or null when it does not close nearby. */
function paramsAt(code, match, open) {
  const close = match[open];
  if (close < 0 || close - open > WALK_MAX) return null;
  return code.slice(open, close + 1);
}

const IDENT = '[A-Za-z_$][\\w$]*';
const FN_HEAD = new RegExp(`^export\\s+(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})\\s*(<[^(\\n]*>)?\\s*\\(`);
const CLASS_HEAD = new RegExp(`^export\\s+(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${IDENT})([^{\\n]*)\\{?`);
const VAR_HEAD = new RegExp(`^export\\s+(?:declare\\s+)?(?:const|let|var)\\s+(${IDENT})\\s*(?::[^=\\n]*)?(=?)`);
const DECL_HEAD = new RegExp(`^export\\s+(?:declare\\s+)?(?:const\\s+)?(interface|type|enum)\\s+(${IDENT})`);
const DEFAULT_HEAD = /^export\s+default\s+/;
const LIST_HEAD = /^export\s+(?:type\s+)?\{/;
const STAR_HEAD = new RegExp(`^export\\s+\\*\\s*(?:as\\s+(${IDENT})\\s*)?from\\s*(['"][^'"\\n]*['"])`);
const CJS_ALL = /^module\.exports\s*=\s*/;
const CJS_ONE = new RegExp(`^(?:module\\.)?exports\\.(${IDENT})\\s*=\\s*`);
const FN_VALUE = /^(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*\(|\(|[\w$]+\s*=>)/;

/** The arity form of a value (`(params) =>`, `function (params)`, `x =>`) or null. */
function callableSig(name, code, mask, match, at) {
  const rest = mask.slice(at, at + 200);
  const m = FN_VALUE.exec(rest);
  if (!m) return null;
  const single = /^(?:async\s+)?([\w$]+)\s*=>/.exec(rest);
  if (single) return `${name}(${single[1]})`;
  const open = at + rest.indexOf('(', m.index);
  const params = paramsAt(code, match, open);
  if (params === null) return null;
  if (!/^(?:async\s+)?function/.test(rest)) {
    // an arrow: only when `=>` follows the closing paren (and an optional return type)
    const after = mask.slice(match[open] + 1, match[open] + 200);
    if (!/^\s*(?::[^=]*)?=>/.test(after)) return null;
  }
  return normSig(`${name}${params}`);
}

/** The export surface of a JS/TS text: `{ exports: {name → signature}, sql: <sqlSurface of its strings> }`. */
export function jsSurface(text) {
  const { code, mask, literals } = maskSource(String(text));
  const match = matchBrackets(mask);
  const exports = {};
  // secret-shaped values go before the cut: a token cut short would no longer match its pattern
  const put = (name, sig) => { exports[name] = redactSecretValues(sig).slice(0, MEMBER_MAX); };
  // a statement that was walked to its end is never walked again (keeps the scan linear)
  const skipTo = (end) => { if (end > START.lastIndex) START.lastIndex = end; };
  const START = /^[ \t]*(?=export\b|module\.exports\b|exports\.)/gm;
  let m;
  while ((m = START.exec(mask)) !== null) {
    const i = m.index + m[0].length;
    if (m[0].length === 0 && START.lastIndex === m.index) START.lastIndex++;
    const head = mask.slice(i, i + 300);
    let h;
    if ((h = FN_HEAD.exec(head))) {
      const open = i + h[0].length - 1;
      const params = paramsAt(code, match, open);
      put(h[1], normSig(`${h[1]}${h[2] ?? ''}${params ?? '('}`));
    } else if ((h = CLASS_HEAD.exec(head))) {
      put(h[1], normSig(`class ${h[1]} ${h[2]}`));
    } else if ((h = DECL_HEAD.exec(head))) {
      const from = i + h[0].length;
      const end = statementEnd(mask, match, from);
      const at = mask.slice(from, end + 1).indexOf('{');
      const brace = at < 0 ? -1 : from + at;
      let body;
      if (h[1] !== 'type' && brace >= 0 && match[brace] > 0) body = code.slice(brace, Math.min(match[brace] + 1, brace + WALK_MAX));
      else body = code.slice(from, end);
      put(h[2], `${h[1]} ${h[2]} ${normMembers(body)}`.trim());
      skipTo(end);
    } else if ((h = STAR_HEAD.exec(head))) {
      const from = code.slice(i, i + 300).slice(h[0].length - h[2].length, h[0].length);
      if (h[1]) put(h[1], `* as ${h[1]} from ${from}`);
      else put(`* from ${from}`, `* from ${from}`);
    } else if ((h = LIST_HEAD.exec(head))) {
      const open = i + h[0].length - 1;
      const close = match[open];
      if (close < 0 || close - open > WALK_MAX) continue;
      const tail = code.slice(close + 1, close + 200);
      const from = /^\s*from\s*(['"][^'"\n]*['"])/.exec(tail);
      for (const part of code.slice(open + 1, close).split(',')) {
        const p = part.replace(/\s+/g, ' ').trim().replace(/^type /, '');
        if (!p) continue;
        const asM = /^(\S+) as (\S+)$/.exec(p);
        const local = asM ? asM[1] : p;
        const name = asM ? asM[2] : p;
        put(name, `${name}${asM ? ` (= ${local})` : ''}${from ? ` from ${from[1]}` : ''}`);
      }
    } else if (DEFAULT_HEAD.test(head)) {
      const at = i + DEFAULT_HEAD.exec(head)[0].length;
      const rest = mask.slice(at, at + 300);
      const fn = /^(?:async\s+)?function\s*\*?\s*([\w$]*)\s*\(/.exec(rest);
      if (fn) {
        const open = at + fn[0].length - 1;
        put('default', normSig(`default function ${fn[1]}${paramsAt(code, match, open) ?? '('}`));
      } else {
        const end = statementEnd(mask, match, at);
        put('default', normSig(`default ${code.slice(at, end)}`));
        skipTo(end);
      }
    } else if ((h = VAR_HEAD.exec(head))) {
      const at = i + h[0].length;
      const value = h[2] ? callableSig(h[1], code, mask, match, at + (mask.slice(at, at + 50).length - mask.slice(at, at + 50).trimStart().length)) : null;
      put(h[1], value ?? `const ${h[1]}`);
    } else if ((h = CJS_ALL.exec(head))) {
      const at = i + h[0].length;
      const end = mask[at] === '{' && match[at] > 0 ? match[at] + 1 : statementEnd(mask, match, at);
      put('module.exports', normSig(code.slice(at, Math.min(end, at + WALK_MAX))));
      skipTo(Math.min(end, at + WALK_MAX));
    } else if ((h = CJS_ONE.exec(head))) {
      const at = i + h[0].length;
      put(h[1], callableSig(h[1], code, mask, match, at) ?? h[1]);
    }
  }
  // SQL lives in string and template bodies; its comments are blanked per literal, so a glob such as
  // 'src/**/*.mjs' cannot open a block comment that runs into the next string
  const parts = [];
  let last = 0;
  for (const [a, b] of literals) {
    parts.push(code.slice(last, a), blankSqlComments(code.slice(a, b)));
    last = b;
  }
  parts.push(code.slice(last));
  return { exports, sql: scanSql(parts.join('')) };
}

// ---------------------------------------------------------------------------------------------
// SQL

const SQL_STMT = /\b(CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE|ALTER\s+TABLE|DROP\s+TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([`"[]?[\w.]+[`"\]]?)/gi;
const unq = (s) => String(s).replace(/[`"[\]]/g, '').toLowerCase();
const CONSTRAINT = /^(?:PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;

function columnOf(def) {
  const d = def.replace(/\s+/g, ' ').trim();
  if (!d || CONSTRAINT.test(d)) return null;
  const m = /^([`"[]?[\w]+[`"\]]?)\s*(.*)$/.exec(d);
  if (!m) return null;
  const rest = m[2];
  const type = (/^([A-Za-z]+(?:\s*\([^)]*\))?)/.exec(rest)?.[1] ?? '').toUpperCase().replace(/\s+/g, '');
  const nn = /\bNOT NULL\b/i.test(rest) || /\bPRIMARY KEY\b/i.test(rest);
  const def0 = /\bDEFAULT\b/i.test(rest) || /\bPRIMARY KEY\b/i.test(rest);
  return { name: unq(m[1]), sig: `${type}${nn ? '|nn' : ''}${def0 ? '|def' : ''}` };
}

/** Split on commas at depth 0 of the given text (one bracket match pass). */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(last, i)); last = i + 1; }
  }
  out.push(s.slice(last));
  return out;
}

/** Line (`--`) and block comments blanked (length and newlines kept); a quoted `'…'` string is left alone. One pass. */
export function blankSqlComments(text) {
  const s = String(text);
  const n = s.length;
  const out = [];
  const HIT = /--|\/\*|'/g;
  let i = 0;
  while (i < n) {
    HIT.lastIndex = i;
    const m = HIT.exec(s);
    if (!m) break;
    const j = m.index;
    let stop;
    if (m[0] === "'") {
      const q = s.indexOf("'", j + 1);
      stop = q < 0 ? n : q + 1;
      out.push(s.slice(i, stop));
    } else {
      if (m[0] === '--') { const nl = s.indexOf('\n', j); stop = nl < 0 ? n : nl; }
      else { const e = s.indexOf('*/', j + 2); stop = e < 0 ? n : e + 2; }
      out.push(s.slice(i, j), s.slice(j, stop).replace(/[^\n]/g, ' '));
    }
    i = stop;
  }
  out.push(s.slice(i));
  return out.join('');
}

/** Tables and columns in statement order: `{ "<table>": "§table", "<table>.<col>": "TYPE|nn|def" }`. */
export function sqlSurface(text) {
  return scanSql(blankSqlComments(text));
}

/** The statement scan over a text whose SQL comments are already blanked. */
function scanSql(s) {
  const surface = {};
  const cols = new Map(); // table → Set of its column names (so a drop never walks the other tables)
  let match = null;
  const setCol = (t, c, sig) => {
    surface[`${t}.${c}`] = sig;
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t).add(c);
  };
  const dropCol = (t, c) => { delete surface[`${t}.${c}`]; cols.get(t)?.delete(c); };
  const dropTable = (t) => {
    delete surface[t];
    for (const c of cols.get(t) ?? []) delete surface[`${t}.${c}`];
    cols.delete(t);
  };
  let m;
  SQL_STMT.lastIndex = 0;
  while ((m = SQL_STMT.exec(s)) !== null) {
    const verb = m[1].toUpperCase().replace(/\s+/g, ' ');
    const table = unq(m[2]);
    const after = SQL_STMT.lastIndex;
    if (verb.startsWith('CREATE')) {
      const at = s.slice(after, after + 21).indexOf('(');
      if (at < 0) continue;
      const open = after + at;
      match ??= matchBrackets(s);
      const close = match[open];
      if (close < 0) continue;
      dropTable(table);
      surface[table] = '§table';
      for (const def of splitTop(s.slice(open + 1, close))) {
        const c = columnOf(def);
        if (c) setCol(table, c.name, c.sig);
      }
      SQL_STMT.lastIndex = close + 1;
    } else if (verb === 'DROP TABLE') {
      dropTable(table);
    } else {
      const rest = s.slice(after, after + 300);
      let a;
      if ((a = /^\s+ADD\s+(?:COLUMN\s+)?([^;\n`]*)/i.exec(rest))) {
        const c = columnOf(a[1]);
        if (c) setCol(table, c.name, c.sig);
      } else if ((a = /^\s+DROP\s+(?:COLUMN\s+)?([`"[]?\w+[`"\]]?)/i.exec(rest))) {
        dropCol(table, unq(a[1]));
      } else if ((a = /^\s+RENAME\s+(?:COLUMN\s+)?([`"[]?\w+[`"\]]?)\s+TO\s+([`"[]?\w+[`"\]]?)/i.exec(rest)) && unq(a[1]) !== 'to') {
        const from = `${table}.${unq(a[1])}`;
        if (Object.hasOwn(surface, from)) { const sig = surface[from]; dropCol(table, unq(a[1])); setCol(table, unq(a[2]), sig); }
      } else if ((a = /^\s+RENAME\s+TO\s+([`"[]?[\w.]+[`"\]]?)/i.exec(rest))) {
        const to = unq(a[1]);
        const moved = [...(cols.get(table) ?? [])].map((c) => [c, surface[`${table}.${c}`]]);
        const had = Object.hasOwn(surface, table);
        dropTable(table);
        if (had) surface[to] = '§table';
        for (const [c, sig] of moved) setCol(to, c, sig);
      }
    }
  }
  return surface;
}

// ---------------------------------------------------------------------------------------------
// JSON schema and config

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** `{ "p:<path>": type, "r:<path>": "required" }`, properties to depth 4. */
export function jsonSchemaSurface(text) {
  const root = JSON.parse(text);
  const out = {};
  const walk = (node, prefix, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    const props = node.properties && typeof node.properties === 'object' ? node.properties : {};
    for (const [k, v] of Object.entries(props)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const t = v && typeof v === 'object' ? (v.type !== undefined ? JSON.stringify(v.type).replace(/"/g, '') : v.$ref ? `ref:${v.$ref}` : 'any') : 'any';
      out[`p:${p}`] = t;
      walk(v, p, depth + 1);
      if (v && typeof v === 'object' && v.items && typeof v.items === 'object') walk(v.items, `${p}[]`, depth + 1);
    }
    if (Array.isArray(node.required)) for (const r of node.required) out[`r:${prefix ? `${prefix}.` : ''}${r}`] = 'required';
  };
  walk(root, '', 1);
  return out;
}

const PKG_FIELDS = ['exports', 'main', 'bin', 'type', 'engines'];
const TS_FIELDS = ['compilerOptions.paths', 'compilerOptions.module', 'compilerOptions.moduleResolution'];

function valueSig(v) {
  const j = JSON.stringify(v);
  return j.length <= 200 ? `=${j}` : `=#${createHash('sha1').update(j).digest('hex').slice(0, 12)}`;
}
const getPath = (o, path) => path.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);

/** Config shape: package.json / tsconfig named fields by value, other config JSON as key paths (depth 2) → type. */
export function configSurface(path, text) {
  const v = JSON.parse(text);
  const out = {};
  const name = base(path);
  if (name === 'package.json') {
    for (const f of PKG_FIELDS) if (v?.[f] !== undefined) out[f] = valueSig(v[f]);
    for (const d of Object.keys(v?.dependencies ?? {})) out[`dependencies.${d}`] = 'dep';
    return out;
  }
  if (/^tsconfig.*\.json$/.test(name)) {
    for (const f of TS_FIELDS) { const x = getPath(v, f); if (x !== undefined) out[f] = valueSig(x); }
    return out;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { '': typeOf(v) };
  for (const [k, x] of Object.entries(v)) {
    out[k] = typeOf(x);
    if (x && typeof x === 'object' && !Array.isArray(x)) for (const [k2, y] of Object.entries(x)) out[`${k}.${k2}`] = typeOf(y);
  }
  return out;
}

/** `{ ok:true, surface }`, or `{ ok:false }` when the text cannot be parsed for its kind. */
export function surfaceOf(kind, path, text) {
  try {
    if (kind === 'js') return { ok: true, surface: jsSurface(text) };
    if (kind === 'sql') return { ok: true, surface: sqlSurface(text) };
    if (kind === 'json-schema') return { ok: true, surface: jsonSchemaSurface(text) };
    if (kind === 'config') return { ok: true, surface: configSurface(path, text) };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Diff

/** Removed + added in one diff pair up, in order, as renames. */
function pairRenames(removed, added) {
  const out = [];
  const n = Math.min(removed.length, added.length);
  // the new name rides in `after` when the signature does not already carry it (SQL / config / schema types)
  const named = ([name, sig]) => (String(sig).includes(name) ? sig : `${name} ${sig}`);
  for (let i = 0; i < n; i++) out.push({ name: removed[i][0], change: 'renamed', before: removed[i][1], after: named(added[i]), breaking: true });
  for (const [name, sig] of removed.slice(n)) out.push({ name, change: 'removed', before: sig, breaking: true });
  return { renames: out, leftAdded: added.slice(n) };
}

function diffFlat(before, after, { addedChange } = {}) {
  const b = before ?? {};
  const a = after ?? {};
  const removed = [];
  const added = [];
  const out = [];
  for (const [k, v] of Object.entries(b)) {
    if (!Object.hasOwn(a, k)) removed.push([k, v]);
    else if (a[k] !== v) out.push({ name: k, change: 'signature', before: v, after: a[k], breaking: true });
  }
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(b, k)) added.push([k, v]);
  const { renames, leftAdded } = before ? pairRenames(removed, added) : { renames: [], leftAdded: added };
  for (const [k, v] of leftAdded) out.push(addedChange ? addedChange(k, v) : { name: k, change: 'added', after: v, breaking: false });
  return [...out, ...renames];
}

function diffSql(before, after) {
  const b = before ?? {};
  const a = after ?? {};
  const out = [];
  const removed = new Map(); // table → [[key, sig]]
  const added = new Map();
  const push = (m, t, e) => { if (!m.has(t)) m.set(t, []); m.get(t).push(e); };
  const tableOf = (k) => k.split('.')[0];
  for (const [k, v] of Object.entries(b)) {
    if (!Object.hasOwn(a, k)) push(removed, k.includes('.') ? tableOf(k) : '§tables', [k, v]);
    else if (v !== a[k] && v.split('|')[0] !== a[k].split('|')[0]) out.push({ name: k, change: 'type', before: v, after: a[k], breaking: true });
  }
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(b, k)) push(added, k.includes('.') ? tableOf(k) : '§tables', [k, v]);
  // a dropped table's columns go with it: one entry for the table
  const goneTables = new Set((removed.get('§tables') ?? []).map(([k]) => k));
  for (const [group, list] of removed) {
    if (goneTables.has(group)) continue;
    const { renames, leftAdded } = pairRenames(list, added.get(group) ?? []);
    out.push(...renames);
    added.set(group, leftAdded);
  }
  for (const [group, list] of added) {
    for (const [k, v] of list) {
      const required = before && k.includes('.') && Object.hasOwn(b, tableOf(k)) && v.includes('|nn') && !v.includes('|def');
      out.push(required ? { name: k, change: 'required', after: v, breaking: true } : { name: k, change: 'added', after: v, breaking: false });
    }
    void group;
  }
  return out;
}

function diffSchema(before, after) {
  const b = before ?? {};
  const a = after ?? {};
  const out = [];
  for (const [k, v] of Object.entries(b)) {
    if (!k.startsWith('p:')) continue;
    if (!Object.hasOwn(a, k)) out.push({ name: k.slice(2), change: 'removed', before: v, breaking: true });
    else if (a[k] !== v) out.push({ name: k.slice(2), change: 'type', before: v, after: a[k], breaking: true });
  }
  for (const [k, v] of Object.entries(a)) {
    if (Object.hasOwn(b, k)) continue;
    if (k.startsWith('p:')) out.push({ name: k.slice(2), change: 'added', after: v, breaking: false });
    else if (before) out.push({ name: k.slice(2), change: 'required', after: 'required', breaking: true });
  }
  return out;
}

function diffConfig(before, after) {
  return diffFlat(before, after).map((c) => {
    if (c.change !== 'signature') return c;
    // a generic key changing its type is 'type'; a named field changing its value is 'signature'
    return String(c.before).startsWith('=') ? c : { ...c, change: 'type' };
  });
}

/** `Change[]` = `{ name, change, before?, after?, breaking }`; `added` entries are never breaking. */
export function diffSurface(kind, before, after) {
  if (kind === 'js') {
    return [...diffFlat(before?.exports, after?.exports), ...diffSql(before?.sql, after?.sql)];
  }
  if (kind === 'sql') return diffSql(before, after);
  if (kind === 'json-schema') return diffSchema(before, after);
  if (kind === 'config') return diffConfig(before, after);
  return [];
}
