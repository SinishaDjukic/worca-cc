// src/shared/forms/schema.mjs
// The ask-forms schema dialect (spec §3.1): a closed JSON Schema subset plus `file`,
// `enumFrom` and `defaultFrom`. One validator for all three gates, server and browser.
// Closed on purpose: it is what keeps the text projection and the form-def checks decidable.
import { isValidPath, resolvePath } from './paths.mjs';

export const SCHEMA_TYPES = Object.freeze(['string', 'number', 'integer', 'boolean', 'array', 'object', 'file']);
export const SCHEMA_FORMATS = Object.freeze(['date', 'date-time', 'email', 'uri']);
const KEYS = new Set(['type', 'enum', 'enumFrom', 'default', 'defaultFrom', 'required', 'minimum', 'maximum',
  'multipleOf', 'minLength', 'maxLength', 'pattern', 'patternHint', 'format', 'items', 'minItems', 'maxItems',
  'uniqueItems', 'properties', 'title', 'description', 'accept']);
const TYPES = new Set(SCHEMA_TYPES);
/** The types a keyword can act on. One that sits elsewhere (`minItems` on the items node, a
 *  `minimum` on a string) would be ignored by validate() — so it is refused here, by name. */
const SCALARS = Object.freeze(['string', 'number', 'integer', 'boolean']);
const APPLIES = Object.freeze({
  minLength: ['string'], maxLength: ['string'], pattern: ['string'], patternHint: ['string'], format: ['string'],
  minimum: ['number', 'integer'], maximum: ['number', 'integer'], multipleOf: ['number', 'integer'],
  items: ['array'], minItems: ['array'], maxItems: ['array'], uniqueItems: ['array'],
  properties: ['object'], required: ['object'],
  enum: SCALARS, enumFrom: SCALARS,
});
const FORMATS = new Set(SCHEMA_FORMATS);
/** Is this JSON value of that scalar type? */
const FITS = Object.freeze({
  string: (v) => typeof v === 'string', number: (v) => typeof v === 'number', integer: (v) => Number.isInteger(v), boolean: (v) => typeof v === 'boolean',
});
const MAX_DEPTH = 3;   // object → array → object, then scalars

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const err = (path, code, message) => ({ path, code, message });
/** A shape alone lets 2026-13-45 through, and the agent would resume with it: the day must exist. */
function realDate(y, m, d) {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);   // not Date.UTC(): that maps the years 0–99 onto 1900–1999
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FORMAT_OK = Object.freeze({
  date: (v) => { const m = DATE_RE.exec(v); return m !== null && realDate(Number(m[1]), Number(m[2]), Number(m[3])); },
  'date-time': (v) => {
    const m = DATE_TIME_RE.exec(v);
    return m !== null && realDate(Number(m[1]), Number(m[2]), Number(m[3]))
      && Number(m[4]) < 24 && Number(m[5]) < 60 && (m[6] === undefined || Number(m[6]) < 60);
  },
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  uri: (v) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(v),
});

function compiles(pattern) {
  try { return Boolean(new RegExp(pattern)); } catch { return false; }
}

/** Is `schema` inside the dialect? `side` is 'data' (may use `file`, may hold opaque
 *  objects) or 'answer' (may use `enumFrom` / `defaultFrom`). → [{ path, code, message }] */
export function checkDialect(schema, { side }) {
  const errors = [];
  const bad = (path, message) => errors.push(err(path, 'dialect', message));
  (function walk(node, path, depth) {
    if (!isObject(node)) { bad(path, 'schema must be an object'); return; }
    // lists nest too: object → array → object → a list of scalars is the deepest shape there is
    if (depth > MAX_DEPTH + 1) { bad(path, 'nesting is limited to object → array → object'); return; }
    const before = errors.length;
    for (const k of Object.keys(node)) if (!KEYS.has(k)) bad(path, `unsupported keyword "${k}"`);
    if (!TYPES.has(node.type)) { bad(path, `unknown type ${JSON.stringify(node.type)}`); return; }
    for (const k of Object.keys(node)) if (Object.hasOwn(APPLIES, k) && !APPLIES[k].includes(node.type)) bad(path, `"${k}" does not apply to ${node.type}`);
    if (node.type === 'file' && side !== 'data') bad(path, '"file" is a data-side type');
    if (node.accept !== undefined && (node.type !== 'file' || !Array.isArray(node.accept) || !node.accept.every((a) => typeof a === 'string'))) bad(path, '"accept" is a list of mime patterns on a file');
    for (const k of ['enumFrom', 'defaultFrom']) {
      if (node[k] === undefined) continue;
      if (side !== 'answer') bad(path, `"${k}" is an answer-side keyword`);
      else if (!isValidPath(node[k])) bad(path, `"${k}" is not a valid path`);
    }
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0 || !node.enum.every(isScalar))) bad(path, '"enum" is a non-empty list of scalars');
    // a value of another type can never be answered: `{ type: 'integer', enum: ['a'] }` is a field nobody can fill
    else if (node.enum !== undefined && Object.hasOwn(FITS, node.type) && !node.enum.every(FITS[node.type])) bad(path, `"enum" values must be of type ${node.type}`);
    if (node.enum !== undefined && node.enumFrom !== undefined) bad(path, 'use "enum" or "enumFrom", not both');
    if (node.pattern !== undefined && (typeof node.pattern !== 'string' || !compiles(node.pattern))) bad(path, '"pattern" does not compile');
    if (node.format !== undefined && !FORMATS.has(node.format)) bad(path, `unknown format "${node.format}"`);
    for (const k of ['minimum', 'maximum', 'multipleOf']) {
      if (node[k] !== undefined && !Number.isFinite(node[k])) bad(path, `"${k}" must be a number`);
    }
    if (Number.isFinite(node.multipleOf) && node.multipleOf <= 0) bad(path, '"multipleOf" must be greater than 0');
    for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (node[k] !== undefined && !(Number.isInteger(node[k]) && node[k] >= 0)) bad(path, `"${k}" must be a whole number, 0 or more`);
    }
    for (const k of ['title', 'description', 'patternHint']) if (node[k] !== undefined && typeof node[k] !== 'string') bad(path, `"${k}" must be text`);
    if (node.uniqueItems !== undefined && typeof node.uniqueItems !== 'boolean') bad(path, '"uniqueItems" must be true or false');
    if (node.type === 'array') {
      if (node.items === undefined) bad(path, 'an array needs "items"');
      else walk(node.items, `${path}[]`, depth + 1);
    }
    if (node.type === 'object') {
      if (depth >= MAX_DEPTH) bad(path, 'nesting is limited to object → array → object');
      if (node.properties === undefined) {
        if (side !== 'data' || depth === 0) bad(path, 'an object needs "properties"');
      } else if (!isObject(node.properties)) bad(path, '"properties" must be an object');
      else for (const [k, v] of Object.entries(node.properties)) {
        // the one name an assignment cannot hold: `out[k] = v` would set a prototype instead
        if (k === '__proto__') bad(path, '"__proto__" cannot be a property name');
        else walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
      if (node.required !== undefined) {
        if (!Array.isArray(node.required) || !node.required.every((r) => typeof r === 'string')) bad(path, '"required" is a list of property names');
        else for (const r of node.required) if (!isObject(node.properties) || !Object.hasOwn(node.properties, r)) bad(path, `"required" names unknown property "${r}"`);
      }
    }
    // A `default` prefills the web form even where auto mode never looks (a `when`-hidden field),
    // so it is held to its own node here. Only a node that is otherwise sound is run: check()
    // assumes the shape this walk has just verified. `enumFrom` is unknown until ask time.
    if (node.default !== undefined && errors.length === before) {
      const own = [];
      check(node, node.default, path, own);
      if (own.length) bad(path, `"default" does not fit its own schema: ${own[0].message}`);
    }
  })(schema, '', 0);
  return errors;
}

const isMissing = (v) => v === undefined || v === null || v === '';

function check(schema, v, path, errors) {
  const push = (code, message) => errors.push(err(path, code, message));
  switch (schema.type) {
    case 'object': {
      if (!isObject(v)) { push('type', 'Must be an object.'); return; }
      if (!schema.properties) return;
      // own keys only: `constructor` and `toString` are inherited by every object, and are neither
      // a declared property nor a supplied value
      for (const k of schema.required || []) if (!Object.hasOwn(v, k) || isMissing(v[k])) errors.push(err(path ? `${path}.${k}` : k, 'required', 'Required.'));
      for (const k of Object.keys(v)) {
        if (!Object.hasOwn(schema.properties, k)) { errors.push(err(path ? `${path}.${k}` : k, 'unknown-key', 'Not a declared property.')); continue; }
        if (!isMissing(v[k])) check(schema.properties[k], v[k], path ? `${path}.${k}` : k, errors);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(v)) { push('type', 'Must be a list.'); return; }
      if (schema.minItems !== undefined && v.length < schema.minItems) push('minItems', `Pick at least ${schema.minItems}.`);
      if (schema.maxItems !== undefined && v.length > schema.maxItems) push('maxItems', `Pick at most ${schema.maxItems}.`);
      if (schema.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) push('unique', 'Entries must be different.');
      v.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
      return;
    }
    case 'string': case 'file': {
      if (typeof v !== 'string') { push('type', 'Must be text.'); return; }
      if (schema.type === 'file' && (v.includes('\0') || v.trim() === '')) push('type', 'Must be a file path.');
      if (schema.minLength !== undefined && v.length < schema.minLength) push('minLength', `At least ${schema.minLength} characters.`);
      if (schema.maxLength !== undefined && v.length > schema.maxLength) push('maxLength', `At most ${schema.maxLength} characters.`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(v)) push('pattern', schema.patternHint || 'Does not match the expected format.');
      if (schema.format !== undefined && Object.hasOwn(FORMAT_OK, schema.format) && !FORMAT_OK[schema.format](v)) push('format', `Must be a valid ${schema.format}.`);
      break;
    }
    case 'number': case 'integer': {
      if (typeof v !== 'number' || !Number.isFinite(v)) { push('type', 'Must be a number.'); return; }
      if (schema.type === 'integer' && !Number.isInteger(v)) push('type', 'Must be a whole number.');
      if (schema.minimum !== undefined && v < schema.minimum) push('min', `Minimum is ${schema.minimum}.`);
      if (schema.maximum !== undefined && v > schema.maximum) push('max', `Maximum is ${schema.maximum}.`);
      if (schema.multipleOf !== undefined && Math.abs(v / schema.multipleOf - Math.round(v / schema.multipleOf)) > 1e-9) push('multiple', `Must be a multiple of ${schema.multipleOf}.`);
      break;
    }
    case 'boolean':
      if (typeof v !== 'boolean') { push('type', 'Must be on or off.'); return; }
      break;
    default:
      push('dialect', `unknown type ${JSON.stringify(schema.type)}`);
      return;
  }
  if (schema.enum !== undefined && !schema.enum.includes(v)) push('enum', 'Not one of the allowed choices.');
}

/** → { ok, errors: [{ path, code, message }] }. An empty string counts as missing. */
export function validate(schema, value) {
  const errors = [];
  check(schema, value, '', errors);
  return { ok: errors.length === 0, errors };
}

/** Materialize `enumFrom` → `enum` and `defaultFrom` → `default` against the agent's
 *  data. Done once at ask time and stored with the ask, so gate 3 sees a closed set. */
export function resolveAnswerSchema(answerSchema, data) {
  const out = clone(answerSchema);
  (function walk(node) {
    if (!isObject(node)) return;
    if (node.enumFrom !== undefined) {
      const found = resolvePath(node.enumFrom, { data });
      node.enum = (Array.isArray(found) ? found : [found]).filter(isScalar);
      delete node.enumFrom;
    }
    if (node.defaultFrom !== undefined) {
      const found = resolvePath(node.defaultFrom, { data });
      // A list field takes a list and any other field one value. `null` and an empty list suggest
      // nothing: the field then has no default, and auto mode falls back to its first choice.
      const usable = found !== undefined && found !== null && Array.isArray(found) === (node.type === 'array') && !(Array.isArray(found) && found.length === 0);
      if (usable) node.default = clone(found);
      delete node.defaultFrom;
    }
    if (node.items) walk(node.items);
    if (isObject(node.properties)) for (const v of Object.values(node.properties)) walk(v);
  })(out);
  return out;
}
