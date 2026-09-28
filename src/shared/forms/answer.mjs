// src/shared/forms/answer.mjs
// Turning raw input into the answer an agent resumes with (spec §5 gate 3, D10), and
// finding the files an ask references (§7). The browser calls collectAnswer for live
// feedback; the server calls the SAME function and its verdict is the one that counts.
import { validate, resolveAnswerSchema } from './schema.mjs';
import { resolvePath } from './paths.mjs';
import { walkLayout, visibleFields } from './layout.mjs';
import { widgetClass } from './catalog.mjs';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const isMissing = (v) => v === undefined || v === null || v === '';
/** Star-slash-star, spelled without the literal: that sequence would close a block comment. */
const ANY_MIME = ['*', '*'].join('/');
const rowsOf = (item, data) => {
  const rows = typeof item.bind === 'string' ? resolvePath(item.bind, { data }) : [];
  return Array.isArray(rows) ? rows.filter(isObject) : [];
};
/** The ids a row widget can answer with. Gate 1 makes `id` a required text where it can see the
 *  row schema; opaque rows (C3) arrive unchecked, and a row with no text id is nobody's item. */
const idsOf = (item, data) => rowsOf(item, data).map((r) => (Object.hasOwn(r, 'id') ? r.id : undefined))
  .filter((id) => typeof id === 'string' && id !== '');

/** Input items by field, effective (post-fallback) form. */
function inputItems(layout) {
  const out = new Map();
  walkLayout(layout, (raw, eff) => {
    if (eff && widgetClass(eff.widget, eff) === 'input' && typeof eff.field === 'string' && !out.has(eff.field)) out.set(eff.field, eff);
  });
  return out;
}

/** Visibility depends on values and hidden values are dropped, so settle to a fixpoint. It always
 *  ends: a round either drops nothing (done) or leaves strictly fewer values. A fixed cap (it was
 *  6) let the tail of a longer `when` chain reach the agent although it was hidden. */
function settle(layout, values) {
  let cur = values;
  for (;;) {
    const vis = new Set(visibleFields(layout, cur));
    const next = Object.fromEntries(Object.entries(cur).filter(([k]) => vis.has(k)));
    if (Object.keys(next).length === Object.keys(cur).length) return { values: next, visible: vis };
    cur = next;
  }
}

function candidate(item, schema, data, required) {
  if (schema.default !== undefined) return clone(schema.default);
  const need = required || (schema.minItems || 0) > 0;
  if (item.widget === 'rank') return idsOf(item, data);
  if (item.widget === 'review-list') {
    const verdict = schema.items.properties.verdict;
    const first = verdict.default !== undefined ? verdict.default : verdict.enum[0];
    return idsOf(item, data).map((id) => ({ id, verdict: first }));
  }
  if (!need) return undefined;
  if (schema.type === 'array') {
    const pool = (schema.items && schema.items.enum) || idsOf(item, data);
    return pool.slice(0, Math.max(1, schema.minItems || 0));
  }
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(item.suggest) && item.suggest.length) return item.suggest[0];
  if (item.widget === 'table-select' || item.widget === 'gallery') return idsOf(item, data)[0];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum !== undefined ? schema.minimum : 0;
  return undefined;   // free text with no default: the form author must supply one (gate 1 `bad-auto`)
}

/** D10: the answer auto mode (`--yes`) gives. Per field: `default`, else `defaultFrom`,
 *  else the first choice, else the widget's natural value. Hidden fields are dropped. */
export function autoAnswer(def, data) {
  const schema = resolveAnswerSchema(def.answer, data);
  const required = new Set(schema.required || []);
  const values = {};
  for (const [field, item] of inputItems(def.layout)) {
    const s = isObject(schema.properties) && Object.hasOwn(schema.properties, field) ? schema.properties[field] : null;
    if (!s) continue;
    const v = candidate(item, s, data, required.has(field));
    if (!isMissing(v)) values[field] = v;
  }
  return settle(def.layout, values).values;
}

function stripItem(schema, v) {
  if (schema.type === 'array' && Array.isArray(v) && schema.items) return v.map((x) => stripItem(schema.items, x));
  if (schema.type === 'object' && isObject(v) && isObject(schema.properties)) {
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => Object.hasOwn(schema.properties, k) && !isMissing(x)).map(([k, x]) => [k, stripItem(schema.properties[k], x)]));
  }
  return v;
}

/** Gate 3 core. Drops unknown keys, empty values and `when`-hidden fields, makes
 *  `required` apply only to visible fields, then validates. `resolvedSchema` is
 *  `resolveAnswerSchema(def.answer, data)`. → { values, errors } */
export function collectAnswer(def, resolvedSchema, rawValues) {
  const props = isObject(resolvedSchema) && isObject(resolvedSchema.properties) ? resolvedSchema.properties : {};
  // Own declared keys only, and built with fromEntries: `known[k] = v` would turn a posted
  // "__proto__" into the object's prototype, and `when` would then read values nobody sent.
  const known = Object.fromEntries(Object.entries(isObject(rawValues) ? rawValues : {})
    .filter(([k, v]) => Object.hasOwn(props, k) && !isMissing(v))
    .map(([k, v]) => [k, stripItem(props[k], clone(v))]));
  const { values, visible } = settle(def.layout, known);
  const required = isObject(resolvedSchema) && Array.isArray(resolvedSchema.required) ? resolvedSchema.required : [];
  const errors = validate({ ...resolvedSchema, required: required.filter((f) => visible.has(f)) }, values).errors;
  // A reorder and a per-item review name each item once. That is the widget's rule, and no
  // schema keyword can state it for rows: `uniqueItems` compares whole objects, so two verdicts
  // for one id would reach the agent. Reported once, also where `uniqueItems` already said so.
  for (const [field, item] of inputItems(def.layout)) {
    const v = Object.hasOwn(values, field) ? values[field] : undefined;
    if ((item.widget !== 'rank' && item.widget !== 'review-list') || !Array.isArray(v)) continue;
    const ids = v.map((x) => (isObject(x) ? x.id : x));
    if (new Set(ids).size !== ids.length && !errors.some((e) => e.path === field && e.code === 'unique')) {
      errors.push({ path: field, code: 'unique', message: 'Each item may appear only once.' });
    }
  }
  return { values, errors };
}

/** Gate 2 core (spec §5): is this run-time `data` askable? It must pass the data schema, and
 *  the auto answer built from it must pass gate 3 — so D10 holds for the data an agent really
 *  wrote, not only for the form's `example`. An empty `enumFrom` on a required choice fails
 *  here, and so does a required field whose `defaultFrom` source the agent left out. → { ok, errors } */
export function checkAskData(def, data) {
  const shape = validate(def.data, data);
  if (!shape.ok) return { ok: false, errors: shape.errors.map((e) => ({ ...e, path: e.path ? `data.${e.path}` : 'data' })) };
  const auto = collectAnswer(def, resolveAnswerSchema(def.answer, data), autoAnswer(def, data));
  const errors = auto.errors.map((e) => ({ path: `answer.${e.path}`, code: 'bad-auto',
    message: `unattended runs could not answer "${e.path}" with this data: ${e.message}` }));
  return { ok: errors.length === 0, errors };
}

/** Every `type: 'file'` value in an agent's data → [{ path, rel, accept }]. `path` is
 *  a concrete location ('data.images[0].file', the path a gate-2 error names); `rel` is the
 *  run-relative path the agent wrote. Document order: depth-first, array index ascending —
 *  P2 uses the position as the served file index. */
export function fileRefs(dataSchema, data) {
  const out = [];
  (function walk(schema, v, path) {
    if (!isObject(schema) || v === undefined || v === null) return;
    if (schema.type === 'file') { if (typeof v === 'string') out.push({ path, rel: v, accept: Array.isArray(schema.accept) ? schema.accept : [] }); return; }
    if (schema.type === 'array' && Array.isArray(v)) v.forEach((x, i) => walk(schema.items, x, `${path}[${i}]`));
    if (schema.type === 'object' && isObject(v) && isObject(schema.properties)) {
      for (const [k, s] of Object.entries(schema.properties)) if (Object.hasOwn(v, k)) walk(s, v[k], `${path}.${k}`);
    }
  })(dataSchema, data, 'data');
  return out;
}

/** The mime patterns a form may display, from its data SCHEMA alone (no instance data): what
 *  the plugin consent screen lists before anything is installed or run. Deduped and sorted; a
 *  `file` with no `accept` contributes the any-type pattern. */
export function fileAccepts(dataSchema) {
  const out = new Set();
  (function walk(schema) {
    if (!isObject(schema)) return;
    if (schema.type === 'file') {
      const accept = Array.isArray(schema.accept) && schema.accept.length ? schema.accept : [ANY_MIME];
      for (const a of accept) out.add(a);
      return;
    }
    if (schema.items) walk(schema.items);
    if (isObject(schema.properties)) for (const s of Object.values(schema.properties)) walk(s);
  })(dataSchema);
  return [...out].sort();
}
