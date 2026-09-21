// src/shared/forms/form-def.mjs
// Gate 1 (spec §5): is a declared form well-formed? Run by the agent registry (skip +
// report), the plugin validator, the agent store (422) and the Agents view (live hints).
// The last two checks are executable: the form's own `example` must pass its data
// schema, and the auto answer built from it must pass gate 3 — a declaration proves itself.
import { ASK_LIMITS, COMMON_ITEM_KEYS, LAYOUT_ITEM_KEYS, isKnownWidget, widgetClass, widgetAcceptsType } from './catalog.mjs';
import { isValidPath, schemaAtPath } from './paths.mjs';
import { checkDialect, validate, resolveAnswerSchema } from './schema.mjs';
import { walkLayout } from './layout.mjs';
import { autoAnswer, collectAnswer } from './answer.mjs';

export const FORM_ID_RE = /^[a-z][a-z0-9-]{0,47}$/;
export const FORM_SURFACES = Object.freeze(['any', 'web']);
const MAX_TITLE = 120;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const err = (path, code, message) => ({ path, code, message });

/** Layout keys that hold a data path, per widget. */
const BINDS = Object.freeze({ compare: ['before', 'after'] });
const bindKeys = (item) => BINDS[item.widget] || (item.bind !== undefined ? ['bind'] : []);
/** Widgets that cannot render without a data path. */
const NEEDS_BIND = new Set(['markdown', 'image', 'gallery', 'pdf', 'code', 'diff', 'table', 'json', 'file-list', 'media',
  'rank', 'table-select', 'review-list']);
/** Widgets that draw ROWS: their `bind` lands on a list of objects. (`table` is not here: spec
 *  §6.2 lets the text display widgets bind a `file` instead.) */
const ROW_WIDGETS = new Set(['rank', 'table-select', 'review-list', 'gallery', 'file-list']);
/** Widgets that show ONE file. Only a `file` value is snapshotted at ask time (spec §7), so a
 *  path that lands on anything else leaves them nothing to show. */
const FILE_WIDGETS = new Set(['image', 'pdf', 'media', 'compare']);

/** What a layout key may HOLD. catalog.mjs says which keys exist; this says what is in them, so
 *  neither the renderer nor the text projection ever meets a shape it cannot read. */
const TEXT_KEYS = new Set(['label', 'help', 'placeholder', 'unit', 'minLabel', 'maxLabel', 'titleKey', 'bodyKey', 'metaKey',
  'captionKey', 'fileKey', 'noteKey', 'notePlaceholder', 'text', 'title', 'tone', 'caption', 'beforeLabel', 'afterLabel',
  'name', 'lang', 'style']);
const MAP_KEYS = new Set(['labels', 'descriptions', 'tones']);
const OPTION_KEYS = Object.freeze(['from', 'value', 'label', 'description']);
const STYLES = Object.freeze({ select: ['cards', 'segmented', 'dropdown'], multiselect: ['rows', 'chips'] });
const isText = (v) => typeof v === 'string';
const optText = (v) => v === undefined || isText(v);

/** → string[]: one message per key of `item` that holds the wrong kind of value. */
function valueErrors(item) {
  const out = [];
  const w = item.widget;
  for (const [k, v] of Object.entries(item)) {
    if (TEXT_KEYS.has(k) && !isText(v)) out.push(`"${k}" must be text`);
    if (MAP_KEYS.has(k) && !(isObject(v) && Object.values(v).every(isText))) out.push(`"${k}" is { value: text }`);
  }
  if (isText(item.style) && Object.hasOwn(STYLES, w) && !STYLES[w].includes(item.style)) out.push(`"style" of "${w}" is one of: ${STYLES[w].join(', ')}`);
  if (item.mono !== undefined && typeof item.mono !== 'boolean') out.push('"mono" must be true or false');
  if (item.rows !== undefined && !(Number.isInteger(item.rows) && item.rows >= 1)) out.push('"rows" must be a whole number, 1 or more');
  if (item.options !== undefined) {
    if (!isObject(item.options)) out.push('"options" is { from, value, label, description }');
    else for (const k of Object.keys(item.options)) {
      if (!OPTION_KEYS.includes(k)) out.push(`"options" has no "${k}" key`);
      else if (!isText(item.options[k])) out.push(`"options.${k}" must be text`);
    }
  }
  if (item.requires !== undefined && !(isObject(item.requires) && (item.requires.askCatalog === undefined
    || (Number.isInteger(item.requires.askCatalog) && item.requires.askCatalog >= 1)))) out.push('"requires" is { askCatalog: n }');
  if (item.fallback !== undefined && !isObject(item.fallback)) out.push('"fallback" is a layout item');
  if (w === 'group' && !Array.isArray(item.children)) out.push('"group" needs "children": a list of items');
  if (w === 'columns' && !(Array.isArray(item.columns) && item.columns.length > 0 && item.columns.every(Array.isArray))) out.push('"columns" is a non-empty list of item lists');
  if (w === 'tabs' && !(Array.isArray(item.tabs) && item.tabs.length > 0
    && item.tabs.every((t) => isObject(t) && isText(t.label) && Array.isArray(t.children)))) out.push('"tabs" is a non-empty list of { label, children }');
  // a column may carry more (align, mono, format: the renderer's business) — only what P1 reads is held
  if ((w === 'table' || w === 'table-select') && item.columns !== undefined && !(Array.isArray(item.columns) && item.columns.length > 0
    && item.columns.every((c) => isObject(c) && isText(c.key) && optText(c.label) && optText(c.unit)))) out.push('"columns" is a non-empty list of { key, label }');
  return out;
}

/** Why `schema` (what a row widget's `bind` landed on) cannot feed it, or null. Below an opaque
 *  object there is no schema to hold it to, so it is let through. */
function rowBindError(widget, schema, needsId) {
  if (schema.type === undefined) return null;
  if (schema.type !== 'array' || !isObject(schema.items) || schema.items.type !== 'object') return `"${widget}" needs a list of objects`;
  const p = schema.items.properties;
  // required, not only declared: a row the agent may leave without an id cannot be ranked, picked or judged
  const required = Array.isArray(schema.items.required) ? schema.items.required : [];
  if (needsId && isObject(p) && !(Object.hasOwn(p, 'id') && p.id.type === 'string' && required.includes('id'))) return `rows of "${widget}" need a required text "id"`;
  return null;
}

/** What a scalar schema type is to a reader; two types of one kind can stand in for each other. */
const KIND = Object.freeze({ string: 'text', file: 'text', number: 'a number', integer: 'a number', boolean: 'on/off' });

/** Why the data `path` lands on cannot feed `enumFrom` / `defaultFrom` of `node`, or null.
 *  `enumFrom` wants values — one, a list of them, or a column; `defaultFrom` wants one value for
 *  a scalar field and a list for a list field. Below an opaque object (C3) nothing is held. */
function fromError(k, node, path, landed) {
  if (landed.type === undefined) return null;
  const many = path.includes('[]') || landed.type === 'array';
  if (node.type === 'array') return many ? null : `${path} is one value, and this field is a list`;
  if (k === 'defaultFrom' && many) return `${path} is a list, and this field takes one value`;
  const leaf = landed.type === 'array' ? landed.items : landed;
  if (!isObject(leaf) || leaf.type === undefined) return null;
  if (!Object.hasOwn(KIND, leaf.type)) return `${path} holds ${leaf.type === 'object' ? 'objects' : 'lists'}, not values`;
  if (Object.hasOwn(KIND, node.type) && KIND[leaf.type] !== KIND[node.type]) return `${path} is ${KIND[leaf.type]}, and this field is ${KIND[node.type]}`;
  return null;
}

/** Why a `when` on the answer property `schema` could never hold for `want`, or null. Equality is
 *  all `when` has: a list or an object never equals anything, a value of another type never
 *  matches, and one outside a closed `enum` is never chosen. (`enumFrom` is open until ask time.) */
function whenError(f, schema, want) {
  if (!Object.hasOwn(KIND, schema.type)) return `"when" cannot compare "${f}": it is ${schema.type === 'array' ? 'a list' : 'an object'}`;
  const fits = (v) => (schema.type === 'integer' ? Number.isInteger(v) : typeof v === (schema.type === 'number' ? 'number' : schema.type));
  const never = (Array.isArray(want) ? want : [want]).find((v) => !fits(v) || (Array.isArray(schema.enum) && !schema.enum.includes(v)));
  return never === undefined ? null : `"when" waits for ${f} = ${JSON.stringify(never)}, which "${f}" can never be`;
}

/** The first circle in `deps` (field → the fields its visibility waits on) as [a, b, …, a], or null. */
function whenCycle(deps) {
  const done = new Set();
  const trail = [];
  const visit = (f) => {
    const at = trail.indexOf(f);
    if (at >= 0) return [...trail.slice(at), f];
    if (done.has(f) || !deps.has(f)) return null;
    trail.push(f);
    for (const next of deps.get(f)) { const found = visit(next); if (found) return found; }
    trail.pop();
    done.add(f);
    return null;
  };
  for (const f of deps.keys()) { const found = visit(f); if (found) return found; }
  return null;
}

/** → { ok, errors: [{ path, code, message }] } */
export function validateFormDef(def, { id } = {}) {
  const errors = [];
  if (id !== undefined && !FORM_ID_RE.test(String(id))) errors.push(err('', 'bad-id', `form id "${id}" must match ${FORM_ID_RE}`));
  if (!isObject(def)) return { ok: false, errors: [...errors, err('', 'dialect', 'a form is an object')] };
  if (!Number.isInteger(def.version) || def.version < 1) errors.push(err('version', 'dialect', '"version" is a positive integer'));
  if (typeof def.title !== 'string' || def.title.trim() === '' || def.title.length > MAX_TITLE) errors.push(err('title', 'dialect', `"title" is 1–${MAX_TITLE} characters`));
  if (def.surface !== undefined && !FORM_SURFACES.includes(def.surface)) errors.push(err('surface', 'dialect', '"surface" is "any" or "web"'));

  for (const side of ['data', 'answer']) {
    if (!isObject(def[side]) || def[side].type !== 'object') { errors.push(err(side, 'dialect', `"${side}" is an object schema`)); continue; }
    for (const e of checkDialect(def[side], { side })) errors.push(err(e.path ? `${side}.${e.path}` : side, e.code, e.message));
  }
  if (!Array.isArray(def.layout) || def.layout.length === 0) errors.push(err('layout', 'dialect', '"layout" is a non-empty list'));
  if (errors.length) return { ok: false, errors };

  const props = def.answer.properties || {};
  // enumFrom / defaultFrom must point into the declared data
  (function paths(node, path) {
    if (!isObject(node)) return;
    for (const k of ['enumFrom', 'defaultFrom']) {
      if (node[k] === undefined) continue;
      const landed = schemaAtPath(node[k], def.data);
      const why = landed ? fromError(k, node, node[k], landed) : null;
      if (!landed) errors.push(err(path, 'bad-bind', `"${k}": ${node[k]} is not in the data schema`));
      else if (why) errors.push(err(path, 'bad-bind', `"${k}": ${why}`));
    }
    if (node.items) paths(node.items, `${path}[]`);
    if (isObject(node.properties)) for (const [k, v] of Object.entries(node.properties)) paths(v, `${path}.${k}`);
  })(def.answer, 'answer');

  const fields = new Set();
  const whens = [];          // [{ at, field }] every field a `when` names, the item's own or an ancestor's
  const deps = new Map();    // input field → the fields its visibility waits on
  const whereOf = new Map(); // input field → its item's address
  let n = 0;
  walkLayout(def.layout, (raw, eff, parents) => {
    const at = `layout#${n += 1}`;
    if (!isObject(raw) || typeof raw.widget !== 'string') { errors.push(err(at, 'dialect', 'a layout item is an object with a "widget"')); return; }
    if (!eff) { errors.push(err(at, 'unknown-widget', `"${raw.widget}" is not in the catalog and has no usable fallback`)); return; }
    if (!isKnownWidget(eff.widget)) return;
    for (const k of Object.keys(eff)) {
      if (!COMMON_ITEM_KEYS.includes(k) && !LAYOUT_ITEM_KEYS[eff.widget].includes(k)) errors.push(err(at, 'dialect', `"${eff.widget}" has no "${k}" key`));
    }
    for (const message of valueErrors(eff)) errors.push(err(at, 'dialect', message));
    const cls = widgetClass(eff.widget, eff);
    if (cls === 'input') {
      const s = typeof eff.field === 'string' && Object.hasOwn(props, eff.field) ? props[eff.field] : null;
      if (typeof eff.field !== 'string') errors.push(err(at, 'unknown-field', `"${eff.widget}" needs a "field"`));
      else if (!s) errors.push(err(at, 'unknown-field', `"${eff.field}" is not an answer property`));
      else if (!widgetAcceptsType(eff.widget, s)) errors.push(err(at, 'bad-pairing', `"${eff.widget}" cannot fill "${eff.field}" (${s.type})`));
      if (typeof eff.field === 'string') {
        if (fields.has(eff.field)) errors.push(err(at, 'dup-field', `"${eff.field}" is bound by more than one item`));
        else {
          fields.add(eff.field);
          whereOf.set(eff.field, at);
          // an ancestor's `when` hides this field too
          deps.set(eff.field, new Set([eff, ...parents].flatMap((p) => (isObject(p) && isObject(p.when) ? Object.keys(p.when) : []))));
        }
      }
    } else if (eff.field !== undefined) errors.push(err(at, 'unknown-field', `"${eff.widget}" does not collect a value`));
    if (NEEDS_BIND.has(eff.widget) && eff.bind === undefined) errors.push(err(at, 'bad-bind', `"${eff.widget}" needs "bind"`));
    for (const k of bindKeys(eff)) {
      const landed = isValidPath(eff[k]) ? schemaAtPath(eff[k], def.data) : null;
      if (!landed) { errors.push(err(at, 'bad-bind', `"${k}": ${JSON.stringify(eff[k])} is not in the data schema`)); continue; }
      const why = k === 'bind' && ROW_WIDGETS.has(eff.widget) ? rowBindError(eff.widget, landed, cls === 'input') : null;
      if (why) errors.push(err(at, 'bad-bind', `"bind": ${why}`));
      // a column resolves to a LIST whatever it holds, and these widgets show one file
      if (FILE_WIDGETS.has(eff.widget) && eff[k].includes('[]')) {
        errors.push(err(at, 'bad-bind', `"${k}": "${eff.widget}" shows one file, and ${eff[k]} is a column of them`));
      // `landed.type` is undefined below an opaque object (C3): nothing to hold it to
      } else if (FILE_WIDGETS.has(eff.widget) && landed.type !== undefined && landed.type !== 'file') {
        errors.push(err(at, 'bad-bind', `"${k}": "${eff.widget}" shows a file, and ${eff[k]} is ${landed.type === 'string' ? 'a string' : `of type ${landed.type}`}`));
      }
    }
    if (eff.widget === 'compare') for (const k of ['before', 'after']) if (eff[k] === undefined) errors.push(err(at, 'bad-bind', `"compare" needs "${k}"`));
    if (isObject(eff.options)) {
      const landed = isValidPath(eff.options.from) ? schemaAtPath(eff.options.from, def.data) : null;
      const why = landed ? rowBindError(eff.widget, landed, false) : null;
      if (!landed) errors.push(err(at, 'bad-bind', '"options.from" is not in the data schema'));
      else if (why) errors.push(err(at, 'bad-bind', `"options.from": ${why}`));
    }
    if (eff.suggest !== undefined && (!Array.isArray(eff.suggest) || !eff.suggest.every((x) => typeof x === 'string'))) errors.push(err(at, 'dialect', '"suggest" is a list of strings'));
    if (eff.when !== undefined) {
      if (!isObject(eff.when) || Object.keys(eff.when).length === 0) errors.push(err(at, 'dialect', '"when" is { field: value }'));
      else for (const [f, want] of Object.entries(eff.when)) {
        const shaped = isScalar(want) || (Array.isArray(want) && want.length > 0 && want.every(isScalar));
        if (!Object.hasOwn(props, f)) errors.push(err(at, 'unknown-field', `"when" names "${f}", which is not an answer property`));
        else {
          whens.push({ at, field: f });
          // a condition nobody can meet hides its item for good
          const never = shaped ? whenError(f, props[f], want) : null;
          if (never) errors.push(err(at, 'dialect', never));
        }
        if (f === eff.field) errors.push(err(at, 'dialect', 'an item cannot depend on its own field'));
        if (!shaped) errors.push(err(at, 'dialect', '"when" compares against a scalar or a list of scalars'));
      }
    }
  });
  // A `when` must be answerable. A field no input collects never gets a value, so the item could
  // never be shown; and fields that wait on each other are all hidden from a human — whose EMPTY
  // answer would then pass gate 3, while auto mode (which starts from every default) answers them.
  // Held only on a layout that is otherwise sound: an item whose `field` is wrong already says why
  // the field it meant is not collected, and must not be echoed by every `when` that names it.
  if (errors.length === 0) {
    for (const w of whens) if (!fields.has(w.field)) errors.push(err(w.at, 'unknown-field', `"when" names "${w.field}", which no item collects`));
    const circle = whenCycle(deps);
    if (circle) errors.push(err(whereOf.get(circle[0]), 'dialect', `"when" is circular: ${circle.join(' → ')}`));
  }
  for (const f of def.answer.required || []) if (!fields.has(f)) errors.push(err(`answer.${f}`, 'unreachable', `required field "${f}" has no input in the layout`));
  if (errors.length) return { ok: false, errors };

  if (!isObject(def.example)) return { ok: false, errors: [err('example', 'bad-example', 'a form ships an "example" of its data')] };
  const ex = validate(def.data, def.example);
  if (!ex.ok) return { ok: false, errors: ex.errors.map((e) => err(`example.${e.path}`, 'bad-example', e.message)) };
  const auto = collectAnswer(def, resolveAnswerSchema(def.answer, def.example), autoAnswer(def, def.example));
  for (const e of auto.errors) errors.push(err(`answer.${e.path}`, 'bad-auto', `unattended runs cannot answer "${e.path}": ${e.message} Give it a "default" or "defaultFrom".`));
  return { ok: errors.length === 0, errors };
}

/** One line, no trailing period: it is interpolated into `BAD_ASK_FORM: <agent>/<form>: <reason>`. */
const reasonOf = (errors) => errors.slice(0, 3)
  .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message).replace(/\s+/g, ' ').replace(/\.$/, '')).join('; ');

/** A byte limit does not bound the stack: 64 KB holds 30 000 levels of `[`, and Node 22 overflows
 *  near 5 000 of them inside JSON.stringify, which is the size check itself. So depth is counted
 *  first, and a block past this is refused by name. No written form comes near: the fixtures are 10. */
const MAX_JSON_DEPTH = 256;

/** Is `v` nested deeper than `max`? A work list, never recursion: this is what guards the stack. */
function nestsDeeperThan(v, max) {
  const todo = [[v, 1]];
  while (todo.length) {
    const [cur, depth] = todo.pop();
    if (cur === null || typeof cur !== 'object') continue;
    if (depth > max) return true;
    for (const child of Object.values(cur)) todo.push([child, depth + 1]);
  }
  return false;
}

/** The sidecar's `ask` block → the forms that passed gate 1 plus the ones that did not.
 *  Never throws: a broken block costs the agent its forms, never the agent. */
export function normalizeAskBlock(raw) {
  if (raw === undefined || raw === null) return { forms: {}, dropped: [] };
  if (!isObject(raw) || !isObject(raw.forms)) return { forms: {}, dropped: [{ id: '*', reason: '"ask" is { forms: { <id>: <form> } }' }] };
  if (nestsDeeperThan(raw, MAX_JSON_DEPTH)) return { forms: {}, dropped: [{ id: '*', reason: `"ask" is nested deeper than ${MAX_JSON_DEPTH} levels` }] };
  // bytes, not UTF-16 units: a block of non-Latin text is up to three times its `.length`
  if (new TextEncoder().encode(JSON.stringify(raw)).length > ASK_LIMITS.askBlockBytes) return { forms: {}, dropped: [{ id: '*', reason: `"ask" is larger than ${ASK_LIMITS.askBlockBytes} bytes` }] };
  const forms = {};
  const dropped = [];
  for (const [id, def] of Object.entries(raw.forms)) {
    if (Object.keys(forms).length >= ASK_LIMITS.formsPerAgent) { dropped.push({ id, reason: `more than ${ASK_LIMITS.formsPerAgent} forms` }); continue; }
    const { ok, errors } = validateFormDef(def, { id });
    if (ok) forms[id] = def; else dropped.push({ id, reason: reasonOf(errors) });
  }
  return { forms, dropped };
}
