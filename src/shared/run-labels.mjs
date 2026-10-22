// src/shared/run-labels.mjs — run labels: free words that organise runs and never touch cost, policy or reports.
// Browser-safe, no imports: the server, the store and the web UI all read this module.
export const MAX_LABELS = 50;
export const MAX_LABEL_LEN = 32;
/** The label palette: the flat hue tokens in ui/public/style.css. Red, amber, green and peach mean status, so they are left out. */
export const LABEL_HUES = Object.freeze(['blue', 'violet', 'teal', 'pink', 'indigo', 'lime', 'cocoa', 'slate']);
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const squash = (s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** One raw label → { label } | { error }. */
export function normaliseLabel(raw) {
  if (typeof raw !== 'string') return { error: 'a label must be a string' };
  const label = squash(raw);
  if (!label) return { error: 'a label needs a word' };
  if (CONTROL_RE.test(label)) return { error: 'a label cannot hold control characters' };
  if (label.length > MAX_LABEL_LEN) return { error: `"${label.slice(0, 12)}…": a label is at most ${MAX_LABEL_LEN} characters` };
  return { label };
}

/** A list → { labels (deduped, first spelling's order kept), errors }. null/undefined = none. Any error: the caller refuses the whole list. */
export function normaliseLabels(list) {
  if (list == null) return { labels: [], errors: [] };
  if (!Array.isArray(list)) return { labels: [], errors: ['labels must be a list of strings'] };
  const seen = new Set();
  const errors = [];
  for (const raw of list) {
    const r = normaliseLabel(raw);
    if (r.error) errors.push(r.error);
    else seen.add(r.label);
  }
  if (seen.size > MAX_LABELS) errors.push(`at most ${MAX_LABELS} labels per run`);
  return { labels: [...seen], errors };
}

/** The word's hue: FNV-1a 32 over the normalised word's UTF-8 bytes, into LABEL_HUES. The same word gets the same hue everywhere. */
export function labelHue(word) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(squash(word ?? ''))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return LABEL_HUES[h % LABEL_HUES.length];
}

/** Several runs' labels → Map(label → 'all' | 'some'). A label no run has is absent (= 'none'). */
export function labelStates(sets) {
  const n = sets.length;
  const counts = new Map();
  for (const s of sets) for (const l of new Set(s)) counts.set(l, (counts.get(l) || 0) + 1);
  return new Map([...counts].map(([l, c]) => [l, n > 0 && c === n ? 'all' : 'some']));
}

/**
 * The picker's rows. used: [{ label, count }] most used first. states: Map from labelStates.
 * Labels already on the target come first (all, then some), then the rest by use. A query keeps labels containing it
 * (a prefix match ranks first). create: the normalised query when it is valid and not an exact label, else null.
 */
export function pickerRows({ query = '', used = [], states = new Map(), allowCreate = true } = {}) {
  const q = squash(query);
  const byLabel = new Map(used.map((u) => [u.label, u.count]));
  for (const l of states.keys()) if (!byLabel.has(l)) byLabel.set(l, 0);
  const rank = { all: 0, some: 1 };
  const rows = [...byLabel]
    .filter(([l]) => !q || l.includes(q))
    .map(([label, count]) => ({ label, count, state: states.get(label) || 'none' }))
    .sort((a, b) => (rank[a.state] ?? 2) - (rank[b.state] ?? 2)
      || (q ? Number(!a.label.startsWith(q)) - Number(!b.label.startsWith(q)) : 0)
      || b.count - a.count || (a.label < b.label ? -1 : 1));
  const valid = q && !normaliseLabel(q).error;
  return { rows, create: allowCreate && valid && !byLabel.has(q) ? q : null };
}

/** The Runs filter: a run matches when it has ANY chosen label. No chosen labels = every run. */
export const matchesLabels = (labels, chosen) => !chosen.length || (labels || []).some((l) => chosen.includes(l));

/** labels plus add minus remove, order kept, new ones appended. */
export function applyLabelChange(labels, { add = [], remove = [] } = {}) {
  const gone = new Set(remove);
  const out = (labels || []).filter((l) => !gone.has(l));
  for (const l of add) if (!out.includes(l) && !gone.has(l)) out.push(l);
  return out;
}

/** A row's chips: the first `max`, and how many more. */
export const splitShown = (labels, max = 2) => ({ shown: (labels || []).slice(0, max), more: Math.max(0, (labels || []).length - max) });
