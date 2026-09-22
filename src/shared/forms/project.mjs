// src/shared/forms/project.mjs
// The text projection of a form ask (spec §8): what the CLI prints, what a chat channel
// posts, what History and Ask Worca quote — and the reverse, turning a typed line back
// into values. Derived from the same declaration the web renderer draws, so a surface
// without pixels can still answer.
import { resolvePath } from './paths.mjs';
import { walkLayout } from './layout.mjs';
import { widgetClass } from './catalog.mjs';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const MAX_TABLE_ROWS = 10;
const REPLY_HINT_FIELDS = 3;
const ROW_WIDGETS = new Set(['rank', 'table-select', 'gallery', 'review-list']);
const TRUE_WORDS = new Set(['y', 'yes', 'true', 'on', '1']);
const FALSE_WORDS = new Set(['n', 'no', 'false', 'off', '0']);

const rowsOf = (path, data) => {
  const rows = typeof path === 'string' ? resolvePath(path, { data }) : [];
  return Array.isArray(rows) ? rows.filter(isObject) : [];
};
const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
/** A row's property, OWN keys only (C20): the row is agent data and the key is the form author's
 *  text (`titleKey`, a column's `key`, `options.value`) — every row inherits `constructor`. */
const own = (r, k) => (isObject(r) && typeof k === 'string' && Object.hasOwn(r, k) ? r[k] : undefined);
/** A scalar as text. Anything else — absent, null, an object — is no text at all, so the words
 *  "undefined", "null" and "[object Object]" never reach a chat channel. */
const text = (v) => (isScalar(v) ? String(v) : '');
/** A bound value as prose: text, or an object / a list as its JSON; '' for nothing. */
const prose = (v) => text(v) || (v !== null && typeof v === 'object' ? JSON.stringify(v) : '');
/** ` — <text>` when a row carries that property, else nothing. */
const tail = (r, k) => (text(own(r, k)) === '' ? '' : ` — ${text(own(r, k))}`);
/** The id a row can be answered with — a text one (gate 1, C22); null for a row that has none. */
const idOf = (r) => { const id = own(r, 'id'); return typeof id === 'string' && id !== '' ? id : null; };
const rowLabel = (item, r) => [own(r, item.titleKey || 'title'), own(r, item.captionKey || 'caption'), own(r, 'name'), own(r, 'label'), own(r, 'id')]
  .map(text).find((s) => s !== '') || '';
/** `- <id>: <label>`; a row with no text id is shown by its label alone. */
const rowLine = (item, r) => (idOf(r) === null ? `- ${rowLabel(item, r)}` : `- ${idOf(r)}: ${rowLabel(item, r)}`);
/** The rows of a row widget that can be CHOSEN: the ones with a text id. */
const choices = (item, data) => rowsOf(item.bind, data).filter((r) => idOf(r) !== null);
/** The text display widgets, which spec §6.2 lets bind a `file` instead of a value. */
const TEXT_WIDGETS = new Set(['markdown', 'code', 'diff', 'table', 'json']);
const BODY_CHARS = 160;
const oneLine = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > BODY_CHARS ? `${t.slice(0, BODY_CHARS - 1)}…` : t; };
/** An author's label for a choice. Text only — which is also what keeps the inherited
 *  `labels.constructor` (a function) from ever being one. */
const labelOf = (item, v) => (isObject(item.labels) && typeof item.labels[v] === 'string' ? item.labels[v] : String(v));
const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`);

function optionsOf(item, schema, data) {
  if (Array.isArray(item.suggest)) return item.suggest.map((s) => ({ value: s, label: s }));
  if (isObject(item.options)) {
    return rowsOf(item.options.from, data).map((r) => ({ value: own(r, item.options.value || 'id'), label: text(own(r, item.options.label || 'label')) }))
      .filter((o) => isScalar(o.value) && o.value !== '').map((o) => ({ value: o.value, label: o.label || String(o.value) }));
  }
  if (ROW_WIDGETS.has(item.widget)) return choices(item, data).map((r) => ({ value: idOf(r), label: rowLabel(item, r) }));
  const en = schema.enum || (schema.items && schema.items.enum) || [];
  return en.map((v) => ({ value: v, label: labelOf(item, v) }));
}

/** A review-list's per-item sub-prompts: its verdict, then its optional note. */
function itemFieldsOf(item, schema) {
  const p = schema.items.properties;
  const verdict = { field: 'verdict', label: 'Verdict', widget: 'select', type: 'string', schema: p.verdict,
    options: p.verdict.enum.map((v) => ({ value: v, label: labelOf(item, v) })),
    default: p.verdict.default !== undefined ? p.verdict.default : p.verdict.enum[0], required: true };
  if (!p.note) return [verdict];
  return [verdict, { field: 'note', label: 'Note', widget: 'text', type: 'string', schema: p.note, options: [], default: undefined, required: false }];
}

/** The input fields of an ask, in layout order. `ask` = { data, layout, answerSchema }.
 *  → [{ field, label, widget, type, schema, options: [{ value, label }], items, itemFields,
 *       verdicts, free, default, required, when }]
 *  `items` is [{ id, label }] for the row widgets (rank, table-select, gallery, review-list),
 *  else null; `itemFields` is set for review-list only. */
export function promptFields(ask) {
  const props = (ask.answerSchema && ask.answerSchema.properties) || {};
  const required = new Set((ask.answerSchema && ask.answerSchema.required) || []);
  const out = [];
  walkLayout(ask.layout, (raw, eff) => {
    if (!eff || widgetClass(eff.widget, eff) !== 'input' || typeof eff.field !== 'string' || !Object.hasOwn(props, eff.field) || out.some((f) => f.field === eff.field)) return;
    const s = props[eff.field];
    const review = eff.widget === 'review-list';
    out.push({
      field: eff.field, label: String(eff.label || s.title || eff.field), widget: eff.widget, type: s.type, schema: s,
      options: optionsOf(eff, s, ask.data),
      items: ROW_WIDGETS.has(eff.widget) ? choices(eff, ask.data).map((r) => ({ id: idOf(r), label: rowLabel(eff, r) })) : null,
      itemFields: review ? itemFieldsOf(eff, s) : null,
      verdicts: review ? s.items.properties.verdict.enum.slice() : [],
      free: Array.isArray(eff.suggest),
      default: s.default, required: required.has(eff.field), when: eff.when || null,
    });
  });
  return out;
}

function describe(f) {
  const bits = [];
  if (f.widget === 'rank') bits.push(`order of: ${f.options.map((o) => o.value).join(', ')}`);
  else if (f.widget === 'review-list') bits.push(`per item ${f.verdicts.join('/')} for: ${f.options.map((o) => o.value).join(', ')}`);
  else if (f.options.length) bits.push(`${f.type === 'array' ? 'any of' : 'one of'}${f.free ? ' (or your own text)' : ''}: ${f.options.map((o, i) => `${i + 1}) ${o.label}`).join('  ')}`);
  else {
    const s = f.schema;
    const range = s.minimum !== undefined && s.maximum !== undefined ? ` ${s.minimum}–${s.maximum}` : s.minimum !== undefined ? ` ≥ ${s.minimum}` : '';
    bits.push(`${f.type === 'boolean' ? 'yes/no' : f.type}${range}${s.format ? ` (${s.format})` : ''}${s.pattern ? ` /${s.pattern}/` : ''}`);
  }
  if (f.default !== undefined) bits.push(`default ${JSON.stringify(f.default)}`);
  if (!f.required) bits.push('optional');
  if (f.when) bits.push(`only when ${Object.entries(f.when).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`).join(', ')}`);
  return bits.join(' · ');
}

/** `ask` = the P2 envelope ({ title, agent, data, layout, answerSchema, files }). → string
 *  `ref`: a non-empty string appends ONE reply line naming the first fields. `maxChars`:
 *  0 / omitted = no cap; otherwise DISPLAY text is dropped from the end until it fits and
 *  the cut is marked by a lone `…` line — the title, the prompts and the reply line never are. */
export function projectForm(ask, { ref, maxChars = 0 } = {}) {
  const data = ask.data;
  const fileLine = (rel) => {
    const f = (ask.files || []).find((x) => x.rel === rel);
    return f ? `${rel} (${f.mime}, ${size(f.bytes)})` : String(rel);
  };
  const fields = promptFields(ask);
  const blocks = [{ keep: true, lines: [`${ask.title}${ask.agent ? ` — ${ask.agent}` : ''}`, ''] }];
  const show = (...lines) => blocks.push({ keep: false, lines });
  walkLayout(ask.layout, (raw, eff) => {
    if (!eff) return;
    const w = eff.widget;
    const v = typeof eff.bind === 'string' ? resolvePath(eff.bind, { data }) : undefined;
    // An absent optional value prints NOTHING: this text is posted to a chat channel, and the
    // word "undefined" in it is a bug the reader sees. A missing file in a row is a dash.
    const fileOr = (rel) => (text(rel) === '' ? '—' : fileLine(text(rel)));
    const isFile = typeof eff.bind === 'string' && Array.isArray(ask.fileRefs) && ask.fileRefs.some((r) => isObject(r) && r.path === eff.bind);
    if (TEXT_WIDGETS.has(w) && isFile) {
      if (text(v) !== '') show(`[${w}] ${fileLine(text(v))}`);
    } else if (w === 'markdown') {
      if (prose(v) !== '') show(prose(v), '');
    } else if (w === 'callout') {
      const said = [text(eff.title), text(v) || text(eff.text)].filter((s) => s !== '').join(' ');
      if (said !== '') show(said, '');
    } else if (w === 'image' || w === 'pdf' || w === 'media') {
      if (text(v) !== '') show(`[${w}] ${fileLine(text(v))}`);
    } else if (w === 'compare') {
      const before = resolvePath(eff.before, { data });
      const after = resolvePath(eff.after, { data });
      if (text(before) !== '' || text(after) !== '') show(`[compare] ${fileOr(before)}  ->  ${fileOr(after)}`);
    } else if (w === 'gallery') {
      show(...rowsOf(eff.bind, data).map((r) => `[image] ${idOf(r) === null ? '' : `${idOf(r)}: `}${fileOr(own(r, eff.fileKey || 'file'))}${tail(r, eff.captionKey || 'caption')}`));
    } else if (w === 'file-list') {
      show(...rowsOf(eff.bind, data).map((r) => `[file] ${fileOr(own(r, eff.fileKey || 'file'))}${tail(r, eff.noteKey || 'note')}`));
    } else if (w === 'code' || w === 'diff') {
      if (prose(v) !== '') show(`[${w}] ${text(eff.name)}`.trim(), prose(v), '');
    } else if (w === 'json') {
      if (v !== undefined && v !== null) show(`[json] ${JSON.stringify(v)}`);
    } else if (w === 'table' || w === 'table-select') {
      // gate 1 holds `columns` to [{ key, label }], but a persisted ask outlives the gate that admitted it
      const cols = (Array.isArray(eff.columns) ? eff.columns : []).filter((c) => isObject(c) && typeof c.key === 'string');
      const rows = rowsOf(eff.bind, data);
      if (cols.length) {
        show(cols.map((c) => c.label || c.key).join(' | '),
          ...rows.slice(0, MAX_TABLE_ROWS).map((r) => cols.map((c) => `${prose(own(r, c.key)) || '—'}${text(own(r, c.key)) === '' ? '' : text(c.unit)}`).join(' | ')),
          ...(rows.length > MAX_TABLE_ROWS ? [`… ${rows.length - MAX_TABLE_ROWS} more rows`] : []));
      }
    } else if (w === 'review-list') {
      // a reviewer on a text surface must see WHAT is being judged, not only its title
      show(...rowsOf(eff.bind, data).map((r) => `${rowLine(eff, r)}${text(own(r, eff.bodyKey || 'body')) ? ` — ${oneLine(text(own(r, eff.bodyKey || 'body')))}` : ''}`));
    } else if (w === 'rank') {
      show(...rowsOf(eff.bind, data).map((r) => rowLine(eff, r)));
    }
    const at = fields.findIndex((f) => f.field === eff.field);
    if (at >= 0 && widgetClass(w, eff) === 'input') blocks.push({ keep: true, lines: [`${at + 1}. ${fields[at].label} {${fields[at].field}}`, `   ${describe(fields[at])}`] });
  });
  if (typeof ref === 'string' && ref !== '') {
    const hint = fields.filter((f) => !f.when).slice(0, REPLY_HINT_FIELDS).map((f) => `${f.field}=${f.type === 'array' ? '<a,b>' : '<value>'}`);
    blocks.push({ keep: true, lines: ['', `Reply: /answer ${ref} ${hint.join(' | ')}`.trimEnd()] });
  }
  const render = (bs) => bs.flatMap((b) => b.lines).join('\n').replace(/\n{3,}/g, '\n\n');
  if (!(maxChars > 0) || render(blocks).length <= maxChars) return render(blocks);
  const kept = blocks.slice();
  let marker = -1;   // the one `…` line; it always sits after the next block to go
  while (render(kept).length > maxChars) {
    const last = kept.findLastIndex((b) => !b.keep);
    if (last < 0) break;
    if (marker >= 0) kept.splice(marker, 1);
    kept[last] = { keep: true, lines: ['…'] };
    marker = last;
  }
  return render(kept);
}

/** Split on an unescaped separator. A backslash pair is kept as-is for unescapeToken(). */
function splitOn(text, sep) {
  const parts = [''];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && i + 1 < text.length) { parts[parts.length - 1] += text[i] + text[i + 1]; i += 1; } else if (text[i] === sep) parts.push('');
    else parts[parts.length - 1] += text[i];
  }
  return parts;
}
/** Only `\|` `\,` `\=` `\:` and `\\` unescape. Any other `\x` stays two characters, so a
 *  Windows path typed into chat (C:\Users\dev) survives byte for byte. */
const unescapeToken = (s) => s.replace(/\\([|,=:\\])/g, '$1').trim();
const hasUnescaped = (text, ch) => splitOn(text, ch).length > 1;

/** `t` is one UNESCAPED token. A number enum keeps C10: in [1,2,4,8] "4" is the value 4. For text
 *  values (row ids, mostly) what the prompt SHOWS decides: an exact label first. Then, when a
 *  number is both an option's position and a DIFFERENT option's id — rows 3,1,2, or the subset
 *  2,5 — neither reading is safe: the prompt numbers the options and the agent named the ids, and
 *  guessing sends the agent a row the human did not choose. It is refused, and a label settles it.
 *  After that: the exact value, the 1-based ordinal, value or label ignoring case, free text. */
function pick(f, t) {
  const low = t.toLowerCase();
  const exact = f.options.find((o) => String(o.value) === t);
  if (exact && typeof exact.value !== 'string') return { ok: true, value: exact.value };
  const shown = f.options.find((o) => o.label === t);
  if (shown) return { ok: true, value: shown.value };
  const nth = /^\d+$/.test(t) ? f.options[Number(t) - 1] : undefined;
  if (exact && nth && nth !== exact) {
    return { ok: false, code: 'enum', message: `"${t}" is both option ${t} ("${nth.label}") and the id of "${exact.label}": type the label of the one you mean` };
  }
  if (exact) return { ok: true, value: exact.value };
  if (nth) return { ok: true, value: nth.value };
  const loose = f.options.find((o) => String(o.value).toLowerCase() === low || o.label.toLowerCase() === low);
  if (loose) return { ok: true, value: loose.value };
  if (f.free && t !== '') return { ok: true, value: t };
  return { ok: false, code: 'enum', message: `"${t}" is not one of: ${f.options.map((o) => o.value).join(', ')}` };
}

/** One typed entry → a value of the field's type. `f` is a promptFields() entry (or one of
 *  its `itemFields`). → { ok: true, value } | { ok: false, code, message }. An empty entry
 *  is `{ ok: true, value: undefined }` ("use the default"). A trailing `\r` is not data. */
export function coerceInput(f, text) {
  const raw = String(text === undefined || text === null ? '' : text).replace(/\r$/, '');
  if (raw.trim() === '') return { ok: true, value: undefined };
  if (f.widget === 'review-list') {
    const value = [];
    for (const part of splitOn(raw, ',')) {
      if (part.trim() === '') continue;   // a trailing comma is not an item
      const [id, verdict = '', ...note] = splitOn(part, ':').map(unescapeToken);
      if (!f.options.some((o) => o.value === id)) return { ok: false, code: 'enum', message: `"${id}" is not an item` };
      const v = pick(f.itemFields[0], verdict);   // value, number or label — exactly what the per-item prompt takes
      if (!v.ok) return v;
      value.push(note.join(':') ? { id, verdict: v.value, note: note.join(':') } : { id, verdict: v.value });
    }
    const given = new Set(value.map((x) => x.id));
    for (const o of f.options) if (!given.has(o.value)) value.push({ id: o.value, verdict: f.itemFields[0].default });
    return { ok: true, value };
  }
  if (f.type === 'array') {
    const value = [];
    for (const part of splitOn(raw, ',')) {
      if (part.trim() === '') continue;
      const p = f.options.length ? pick(f, unescapeToken(part)) : { ok: true, value: unescapeToken(part) };
      if (!p.ok) return p;
      value.push(p.value);
    }
    // C18: a rank is a full reorder. The items named come first, the rest keep their data order —
    // the same courtesy a review-list gives its unlisted items. A repeat is gate 3's to refuse.
    if (f.widget === 'rank') for (const o of f.options) if (!value.includes(o.value)) value.push(o.value);
    return { ok: true, value };
  }
  if (f.type === 'boolean') {
    const t = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(t)) return { ok: true, value: true };
    if (FALSE_WORDS.has(t)) return { ok: true, value: false };
    return { ok: false, code: 'type', message: 'answer yes or no' };
  }
  if (f.options.length) return pick(f, unescapeToken(raw));
  if (f.type === 'number' || f.type === 'integer') {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, code: 'type', message: `"${raw.trim()}" is not a number` };
  }
  return { ok: true, value: unescapeToken(raw) };
}

/** `field=value | field2=a,b` → { values, errors: [{ path, code, message }] }.
 *  - split on unescaped `|`; inside a pair only the FIRST unescaped `=` splits;
 *  - a name that is not an input field is `unknown-field`; a field given twice is `duplicate-field`;
 *  - text with no unescaped `=` is the value of `bareField`, or of the only field of a one-field form;
 *  - commas split only when the field's type is `array`.
 *  Values are coerced, NOT validated — feed them to collectAnswer. */
export function parseAnswerLine(text, ask, { bareField } = {}) {
  const fields = promptFields(ask);
  const values = {};
  const errors = [];
  const line = String(text || '').trim();
  if (line === '') return { values, errors };
  const bare = fields.find((f) => f.field === bareField) || (fields.length === 1 ? fields[0] : null);
  const put = (f, rawValue) => {
    if (Object.prototype.hasOwnProperty.call(values, f.field)) { errors.push({ path: f.field, code: 'duplicate-field', message: `"${f.field}" is given twice` }); return; }
    const r = coerceInput(f, rawValue);
    if (!r.ok) errors.push({ path: f.field, code: r.code, message: r.message });
    else if (r.value !== undefined) values[f.field] = r.value;
  };
  if (!hasUnescaped(line, '=')) {
    if (bare) put(bare, line); else errors.push({ path: '', code: 'parse', message: 'write the answer as field=value | field2=value' });
    return { values, errors };
  }
  for (const part of splitOn(line, '|')) {
    if (part.trim() === '') continue;
    const eq = splitOn(part, '=');
    if (eq.length < 2) { errors.push({ path: '', code: 'parse', message: `write "${part.trim()}" as field=value` }); continue; }
    const name = unescapeToken(eq[0]);
    const f = fields.find((x) => x.field === name);
    // where a bare answer is possible, the likeliest cause is free text that holds a "=" (C9)
    if (!f) { errors.push({ path: name, code: 'unknown-field', message: `"${name}" is not a field of this form${bare ? ' (a literal = in an answer is written \\=)' : ''}` }); continue; }
    put(f, eq.slice(1).join('='));
  }
  return { values, errors };
}
