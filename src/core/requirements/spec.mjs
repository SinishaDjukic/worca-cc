// src/core/requirements/spec.mjs
// The shape of a feature spec and the rules every writer shares (plans/requirements-design.md §3, D3).
// Pure: no I/O, no imports — the store, the round validator, the edits and the Markdown renderer use it.

export class RequirementsError extends Error {
  /** @param {'BAD_REQUEST'|'NOT_FOUND'|'BUSY'|'CONFLICT'|'BUDGET'|'NOT_READY'} code
   *  @param {object} [data] extra detail for the caller (e.g. { failing: [keys] }), kept on err.data */
  constructor(code, message, data) {
    super(message); this.name = 'RequirementsError'; this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export const SCOPE_TYPES = Object.freeze(['project', 'workspace']);
export const STATUSES = Object.freeze(['looking', 'thinking', 'your_turn', 'done', 'archived']);
export const LIST_SECTIONS = Object.freeze(['actors', 'flow', 'edgeCases', 'rules', 'outOfScope', 'openQuestions']);
export const SECTIONS = Object.freeze(['goal', ...LIST_SECTIONS]);
export const TURN_KINDS = Object.freeze(['orientation', 'round', 'answers', 'edit', 'assumption', 'finish', 'error', 'followup', 'start']);
export const ASSUMPTION_STATUSES = Object.freeze(['open', 'confirmed', 'rejected']);
export const LIMITS = Object.freeze({ title: 200, description: 20000, item: 500, items: 30, context: 10000 });
export const MAX_ROUNDS = 6;      // D5
export const MAX_QUESTIONS = 3;   // D5

export function emptySpec() {
  return { goal: { text: '', measure: '' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [],
    criteria: [], assumptions: [], openQuestions: [], edited: {} };
}

export const featureId = (seq) => `FEAT-${seq}`;

/** 'FEAT-7' or '7' → 7; anything else → null. */
export function parseFeatureSeq(v) {
  const m = /^(?:FEAT-)?([1-9]\d{0,9})$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

/** A trimmed string of at most `max` characters ('' for anything that is not text). */
export function clip(v, max = LIMITS.item) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** One section's value, normalized: goal → {text, measure}; a list section → unique non-empty strings
 *  (an array, or one item per line), at most LIMITS.items of LIMITS.item characters. */
export function normalizeSection(section, value) {
  if (section === 'goal') {
    if (typeof value === 'string') return { text: clip(value), measure: '' };
    return { text: clip(value && value.text), measure: clip(value && value.measure) };
  }
  if (!LIST_SECTIONS.includes(section)) throw new RequirementsError('BAD_REQUEST', `unknown section "${String(section).slice(0, 40)}"`);
  const raw = typeof value === 'string' ? value.split(/\r?\n/) : (Array.isArray(value) ? value : []);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const s = clip(item);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= LIMITS.items) break;
  }
  return out;
}

/** The number for the next `${prefix}N` id: one above both the stored counter and the highest N among `items`
 *  (objects with an id, or id strings), so an id is never reused even when the counter lags. */
export function nextIdNumber(counter, items, prefix) {
  let max = Number.isFinite(counter) ? counter : 0;
  for (const it of items || []) {
    const id = typeof it === 'string' ? it : it && it.id;
    if (typeof id !== 'string' || !id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return max + 1;
}
