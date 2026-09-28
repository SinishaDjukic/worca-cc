// src/shared/graph/script-infer.mjs
// The interface a script DECLARES BY READING IT (script-wizard plan S3–S7): the
// port and param ids a program mentions, a proposed type for each, a default
// where the code spells one, and whether it returns a verdict. Pure — the page
// runs it on every keystroke, the tests feed it strings. The sidecar on disk
// stays the source of truth: mergeInterface layers the saved sidecar and the
// user's chip overrides OVER the proposal, and interfaceToMeta turns the rows
// back into the sidecar shape script-meta.mjs validates.
import { PORT_ID_RE } from './constants.mjs';

export const PORT_TYPES = Object.freeze(['md', 'json', 'void']);
export const WHEN_CYCLE = Object.freeze(['always', 'clean', 'blocking']);
export const WHEN_LABEL = Object.freeze({ always: 'always', clean: 'on pass', blocking: 'on fail' });
export const INPUT_MODES = Object.freeze(['optional', 'required', 'loop']);
/** The param types a chip may cycle through. `enum` and `code` need the sidecar (options, language). */
export const CHIP_PARAM_TYPES = Object.freeze(['string', 'number', 'boolean', 'command']);
export const FIXED_PARAM_TYPES = Object.freeze(['enum', 'code']);
/** Characters read after a token for its type and default. */
export const INFER_WINDOW = 240;

const KEY_MAX = 64;

/** 'Run tests' -> 'runTests'. Lower camel, a letter first, SCRIPT_KEY_RE-sized. */
export function keyFromName(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  let out = words.map((w, i) => { const l = w.toLowerCase(); return i === 0 ? l : l[0].toUpperCase() + l.slice(1); }).join('');
  if (!/^[A-Za-z]/.test(out)) out = `s${out}`;
  return out.slice(0, KEY_MAX);
}

/** The runner's env naming (script-runner.mjs): `planMd` <-> `PLAN_MD`. A digit after an
 *  underscore joins bare (`OUT_2` -> `out2`): PORT_ID_RE admits no underscore. */
export const upperSnake = (id) => String(id).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
export const lowerCamel = (env) => String(env).toLowerCase().replace(/_+([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Comments are not reads. Crude on purpose (no string parser): a `//` after a colon is a
 *  URL, a `#` after a quote, a `$` or a `{` is text or `${#V}`. */
export function stripComments(source, runtime) {
  const s = String(source || '');
  if (runtime === 'node') return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  return s.replace(/(^|[^'"\\${])#[^\n]*/g, '$1');
}

// `inputs.x` · `inputs?.x` · `inputs['x']` · `inputs["x"]` · `inputs.get('x')` — and the same
// three shapes behind `api.` (the `\b` before the word admits the dot). The destructuring
// header `{ inputs, outputs, params }` has no accessor after the word, so it is not a read.
const idRe = (word) => new RegExp(`\\b${word}\\.get\\(\\s*(?<q1>['"])(?<a>[A-Za-z_]\\w*)\\k<q1>|\\b${word}(?:\\?\\.|\\.)(?<b>[A-Za-z_]\\w*)|\\b${word}\\s*\\[\\s*(?<q2>['"])(?<c>[A-Za-z_]\\w*)\\k<q2>\\s*\\]`, 'g');
// `$WORCA_IN_X` · `${WORCA_IN_X}` · `${WORCA_PARAM_X:-default}` · `%WORCA_IN_X%` (cmd.exe).
const envRe = (prefix) => new RegExp(`(?:\\$\\{?|%)WORCA_${prefix}_(?<a>[A-Z][A-Z0-9_]*)`, 'g');

function scan(text, re, map = (x) => x) {
  const out = [];
  for (const m of text.matchAll(re)) {
    const id = map(m.groups.a ?? m.groups.b ?? m.groups.c ?? '');
    if (PORT_ID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The FIRST read of `<word>.<id>` (any of the three accessor shapes, behind `api.` or not;
 * the env var for shell): 24 characters before it — with a trailing `api.` cut off, so
 * `int(api.params.limit` still ends in `int(` — and the rest of its STATEMENT after it
 * (to the next `;` or blank line for node, the end of the line otherwise, at most
 * INFER_WINDOW characters). The window stops at the statement so the JSON write on
 * the NEXT line can never colour this port json.
 */
function readSite(text, word, id, runtime) {
  const re = runtime === 'shell'
    ? new RegExp(`(?:\\$\\{?|%)WORCA_${word}_${upperSnake(id)}\\b`)
    : new RegExp(`\\b${word}(?:(?:\\?\\.|\\.)${id}\\b|\\s*\\[\\s*['"]${id}['"]\\s*\\]|\\.get\\(\\s*['"]${id}['"]\\s*\\))`);
  const m = re.exec(text);
  if (!m) return { before: '', after: '' };
  const end = m.index + m[0].length;
  const slice = text.slice(end, end + INFER_WINDOW);
  const stop = runtime === 'node' ? slice.search(/;|\n\s*\n/) : slice.indexOf('\n');
  return {
    before: text.slice(Math.max(0, m.index - 24), m.index).replace(/\b\w+\.$/, ''),
    after: stop < 0 ? slice : slice.slice(0, stop),
  };
}

/** `json` when the write in the token's statement is JSON, else `md`. A chip overrides it. */
function outputType(text, id, runtime) {
  const { after } = readSite(text, runtime === 'shell' ? 'OUT' : 'outputs', id, runtime);
  return /JSON\.stringify|json\.dumps?\s*\(|\bjq\b|\.json\b/.test(after) ? 'json' : 'md';
}

/** Type from the read site, default from the fallback spelled beside it (S7). */
function paramInfo(text, id, runtime) {
  const { before, after } = readSite(text, runtime === 'shell' ? 'PARAM' : 'params', id, runtime);
  let type = 'string';
  let dflt;
  if (runtime === 'shell') {
    const m = after.match(/^:-([^}]*)\}/);
    if (m) dflt = m[1];
  } else {
    const m = after.match(/^\s*(?:\?\?|\|\||\bor\b)\s*(?:(['"`])((?:(?!\1).)*)\1|(-?\d+(?:\.\d+)?)|(true|false|True|False))/);
    if (m) {
      if (m[2] != null) dflt = m[2];
      else if (m[3] != null) { dflt = Number(m[3]); type = 'number'; }
      else { dflt = /^t/i.test(m[4]); type = 'boolean'; }
    }
    if (/(Number|parseInt|parseFloat|int|float)\(\s*$/.test(before)) type = 'number';
    if (/(Boolean|bool)\(\s*$/.test(before) || /^\s*(===?|!==?|is(?: not)?)\s*(true|false|True|False)\b/.test(after)) type = 'boolean';
  }
  const out = { id, type };
  const typed = typedDefault(type, dflt);
  if (typed !== undefined) out.default = typed;
  return out;
}

/** The proposal (S3): ids in code order, a type and a default each, the verdict. */
export function inferInterface(source, runtime) {
  const text = stripComments(source, runtime);
  let ins; let outs; let prm; let verdict;
  if (runtime === 'shell') {
    ins = scan(text, envRe('IN'), lowerCamel);
    outs = scan(text, envRe('OUT'), lowerCamel);
    prm = scan(text, envRe('PARAM'), lowerCamel);
    verdict = /WORCA_VERDICT\b/.test(text);
  } else {
    ins = scan(text, idRe('inputs'));
    outs = scan(text, idRe('outputs'));
    prm = scan(text, idRe('params'));
    // `verdict:` in a return / a dict, `verdictPath`, `verdict =`, or the SHORTHAND `return { summary, verdict }`
    // (`{ ...base, verdict }`): a verdict a helper built is still returned.
    verdict = /(['"]?)\bverdict\1\s*:|\bverdictPath\b|\bverdict\s*=[^=]|\breturn\s*\{[^;]{0,240}?\bverdict\s*[,}]/.test(text);
  }
  return {
    inputs: ins.map((id) => ({ id, type: 'md' })),
    outputs: outs.map((id) => ({ id, type: outputType(text, id, runtime) })),
    params: prm.map((id) => paramInfo(text, id, runtime)),
    verdict,
  };
}

const paramRows = (meta) => ((meta && Array.isArray(meta.params)) ? meta.params : []).map((p) => {
  const row = { id: p.id, type: p.type, fixed: FIXED_PARAM_TYPES.includes(p.type) };
  if (p.default !== undefined) row.default = p.default;
  if (p.required !== undefined) row.required = !!p.required;
  if (p.label) row.label = p.label;
  if (p.description) row.description = p.description;
  if (Array.isArray(p.options)) row.options = [...p.options];
  if (p.language) row.language = p.language;
  return row;
});

/** The sidecar as rows. A `ports: "config"` script has no port rows here (S8). */
export function savedRows(meta) {
  if (!meta || meta.ports === 'config') return { inputs: [], outputs: [], params: paramRows(meta) };
  return {
    inputs: (meta.inputs || []).filter((p) => p && p.id && !p.synthetic && p.id !== 'await')
      .map((p) => ({ id: p.id, type: p.type || 'md', mode: p.loop ? 'loop' : (p.required === false ? 'optional' : 'required') })),
    outputs: (meta.outputs || []).filter((p) => p && p.id)
      .map((p) => ({ id: p.id, type: p.type || 'md', when: p.when || 'always', filename: p.filename || '' })),
    params: paramRows(meta),
  };
}

/** An untouched attribute follows the code: `auto` remembers what inference last said. */
function follow(prev, inf, fields) {
  const next = { ...prev };
  for (const f of fields) if (prev.auto && Object.is(prev[f], prev.auto[f])) next[f] = inf[f];
  next.auto = { ...inf };
  return next;
}

/**
 * The rows the panel shows (S3): code ids first, in code order, then the saved
 * ids the code no longer mentions (`inCode: false`) unless removed. Attributes:
 * the previous row (the user's chips) ⊕ the saved sidecar ⊕ inference.
 */
export function mergeInterface({ inferred, saved = null, rows = null, removed = new Set() } = {}) {
  const inf = inferred || { inputs: [], outputs: [], params: [] };
  const prev = rows || { inputs: [], outputs: [], params: [] };
  const sv = savedRows(saved);
  const merge = (side, fromCode, fresh, followed) => {
    const out = [];
    const prevBy = new Map((prev[side] || []).map((r) => [r.id, r]));
    const savedBy = new Map(sv[side].map((r) => [r.id, r]));
    for (const p of fromCode) {
      const was = prevBy.get(p.id);
      const auto = { ...p };
      delete auto.id;
      let row;
      if (was) row = follow(was, auto, followed);
      else if (savedBy.has(p.id)) row = { ...savedBy.get(p.id), auto };
      else row = { ...fresh(p), auto };
      out.push({ ...row, id: p.id, inCode: true });
    }
    for (const s of sv[side]) {
      if (out.some((r) => r.id === s.id) || removed.has(`${side}:${s.id}`)) continue;
      out.push({ ...(prevBy.get(s.id) || s), id: s.id, inCode: false });
    }
    return out;
  };
  return {
    inputs: merge('inputs', inf.inputs, (p) => ({ type: p.type || 'md', mode: 'optional' }), ['type']),
    outputs: merge('outputs', inf.outputs, (p) => ({ type: p.type || 'md', when: 'always', filename: '' }), ['type']),
    params: merge('params', inf.params, (p) => ({ type: p.type || 'string', ...(p.default !== undefined ? { default: p.default } : {}), fixed: false }), ['type', 'default']),
  };
}

export function cycleValue(list, current) {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

/** A default in its declared type — readParams refuses `"40"` on a number param. */
export function typedDefault(type, raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number' && type === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'boolean' && type === 'boolean') return raw;
  const s = String(raw);
  if (s.trim() === '') return undefined;
  if (type === 'number') { const n = Number(s); return Number.isFinite(n) ? n : undefined; }
  if (type === 'boolean') return s === 'true' ? true : (s === 'false' ? false : undefined);
  return s;
}

/**
 * Rows -> the sidecar's port and param objects (S4, S5, S6, S7). `verdict` is
 * what the code declares (node/python) or `$WORCA_VERDICT`; `routing` is the
 * shell toggle. Filenames are minted from the key unless the row carries one.
 */
export function interfaceToMeta(rows, { key = '', runtime = 'node', verdict = false, routing = false, verdictFilename = '' } = {}) {
  const k = key || 'script';
  const r = rows || { inputs: [], outputs: [], params: [] };
  const hasVerdict = runtime === 'shell' ? (routing || verdict) : verdict;
  const inputs = (r.inputs || []).map((row) => {
    const p = { id: row.id, type: row.type || 'md', required: row.mode === 'required' };
    if (row.mode === 'loop') p.loop = true;
    return p;
  });
  const outputs = (r.outputs || []).map((row) => {
    const type = row.type || 'md';
    const p = { id: row.id, type, when: hasVerdict && WHEN_CYCLE.includes(row.when) ? row.when : 'always' };
    if (type !== 'void') p.filename = row.filename || `${k}-${row.id}-cycle{cycle}.${type === 'json' ? 'json' : 'md'}`;
    return p;
  });
  if (runtime === 'shell' && routing) {
    if (!outputs.some((p) => p.id === 'pass')) outputs.push({ id: 'pass', type: 'void', when: 'clean' });
    if (!outputs.some((p) => p.id === 'fail')) outputs.push({ id: 'fail', type: 'md', when: 'blocking', filename: `${k}-fail-cycle{cycle}.md` });
  }
  const params = (r.params || []).map((row) => {
    const p = { id: row.id, type: row.type || 'string' };
    const dflt = typedDefault(p.type, row.default);
    if (dflt !== undefined) p.default = dflt;
    p.required = row.required !== undefined ? !!row.required : dflt === undefined;
    if (row.label) p.label = row.label;
    if (row.description) p.description = row.description;
    if (p.type === 'enum' && Array.isArray(row.options)) p.options = [...row.options];
    if (p.type === 'code') p.language = row.language || 'js';
    return p;
  });
  return { inputs, outputs, params, verdict: hasVerdict ? { filename: verdictFilename || `${k}-cycle{cycle}.json` } : null };
}
