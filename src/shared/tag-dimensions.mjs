// src/shared/tag-dimensions.mjs — tag dimensions: optional, configured keys ({ key, label,
// values?, required? }) from team policy (runs.tagDimensions) or user Settings. Browser-safe: the
// server, the harness, the policy registry and the web UI all read this module. Required is a
// warning only; nothing here blocks a run.
import { parseTag, TAG_KEY_RE } from './run-tags.mjs';

export const MAX_DIMENSIONS = 10;
export const MAX_DIMENSION_VALUES = 50;
export const LABEL_MAX = 40;

// eslint-disable-next-line no-control-regex
const clean = (s) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** One raw entry → { dim } or { error }. */
export function normaliseDimension(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'a tag dimension is { key, label, values?, required? }' };
  const key = clean(raw.key).toLowerCase().replace(/ /g, '-');
  if (!TAG_KEY_RE.test(key)) return { error: `"${key}": a tag name is letters, digits, ".", "_" or "-" (up to 32)` };
  const label = clean(raw.label);
  if (!label || label.length > LABEL_MAX) return { error: `${key}: a label is 1 to ${LABEL_MAX} characters` };
  if (raw.values != null && !Array.isArray(raw.values)) return { error: `${key}: values must be a list` };
  const values = [];
  for (const v of raw.values || []) {
    // parseTag('cc:') is an error ("needs a value after the colon"), so skip blanks before parsing.
    if (typeof v !== 'string' || !v.trim()) continue;
    const r = parseTag(`${key}:${v}`);
    if (r.error) return { error: `${key}: ${r.error}` };
    if (!values.includes(r.tag.value)) values.push(r.tag.value);
  }
  if (values.length > MAX_DIMENSION_VALUES) return { error: `${key}: at most ${MAX_DIMENSION_VALUES} values` };
  if (raw.required != null && typeof raw.required !== 'boolean') return { error: `${key}: required must be true or false` };
  return { dim: { key, label, values, required: raw.required === true } };
}

/** A list → { dims, errors }: bad entries are dropped one error each; the first entry of a key wins. */
export function normaliseDimensions(list) {
  if (list == null) return { dims: [], errors: [] };
  if (!Array.isArray(list)) return { dims: [], errors: ['tag dimensions must be a list'] };
  const dims = []; const errors = [];
  for (const raw of list) {
    const { dim, error } = normaliseDimension(raw);
    if (error) { errors.push(error); continue; }
    if (dims.some((d) => d.key === dim.key)) { errors.push(`${dim.key}: listed twice`); continue; }
    if (dims.length >= MAX_DIMENSIONS) { errors.push(`at most ${MAX_DIMENSIONS} tag dimensions`); break; }
    dims.push(dim);
  }
  return { dims, errors };
}

const tagOf = (t) => { const r = parseTag(t); return r.error ? null : r.tag; };

/** Required dimensions with no tag of their key in `tags`. */
export function missingRequired(dims, tags) {
  const have = new Set((tags || []).map(tagOf).filter(Boolean).map((t) => t.key));
  return (dims || []).filter((d) => d.required && !have.has(d.key));
}

/** Tags → { slots: { key: value }, rest: string[] } — the New run form's two inputs. */
export function splitByDimensions(tags, dims) {
  const keys = new Set((dims || []).map((d) => d.key));
  const slots = {}; const rest = [];
  for (const t of tags || []) {
    const tag = tagOf(t);
    if (tag && tag.value && keys.has(tag.key)) slots[tag.key] = tag.value; else rest.push(t);
  }
  return { slots, rest };
}

/** Several lists → one, the first list's entry winning a shared key (policy before Settings). */
export function mergeDimensions(lists) {
  const out = [];
  for (const list of lists || []) for (const d of list || []) if (!out.some((x) => x.key === d.key)) out.push(d);
  return out;
}

export const dimensionLabel = (dims, key) => (dims || []).find((d) => d.key === key)?.label ?? null;

/** Statistics Group by tag options: configured dimensions by label first, then other keys in use. */
export function tagGroupOptions(dims, keysInUse) {
  const configured = (dims || []).map((d) => ({ value: `tag:${d.key}`, text: `Group by ${d.label}` }));
  const known = new Set((dims || []).map((d) => d.key));
  return configured.concat((keysInUse || []).filter((k) => !known.has(k)).map((k) => ({ value: `tag:${k}`, text: `Group by tag: ${k}` })));
}
