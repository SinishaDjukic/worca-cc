// src/core/workspace-map/eval.mjs
// Measure a workspace map against labelled truth (spec D18). Pure: no fs, no DB, no LLM —
// tools/workspace-map-eval.mjs does the reading and writing.
//
// Labels doc: { version: 1, workspace, edges: [{ from, to, kind, key?, truth }] }
//   - with `key`: scored at KEY level — (from, to, kind, norm); `key` is a norm
//     ("http:GET /users/{}") or a raw key normKey() understands ("GET /users/:id");
//   - without `key`: scored at PAIR+KIND level — (from, to, kind);
//   - key labels also roll up to their pair+kind (true when any is true; false only when every
//     predicted edge of that pair+kind is labelled) unless the pair+kind has its own label;
//   - `truth: null` (what --init writes) = not decided yet: ignored;
//   - a key neither a norm nor readable by normKey is a label error and is not scored; a labels
//     doc that looks wrong for THIS map (another workspace, non-members, a self edge,
//     contradicting truths) is reported in labelErrors as a warning and still scored.
// Counting at each level: tp = predicted and true; fp = predicted and false; fn = true and not
// predicted; unlabelled = predicted with no label (partial labels, e.g. from overrides, never
// count against the map). precision = tp / (tp + fp), recall = tp / (tp + fn); null when the
// denominator is 0.

import { KINDS, CONFIDENCE, confidenceRank } from '../../shared/workspace-map/schema.mjs';
import { normKey } from '../../shared/workspace-map/keys.mjs';
import { effectiveEdges } from '../../shared/workspace-map/overrides.mjs';

export const LABELS_VERSION = 1;

const pairId = (from, to, kind) => `${from}|${to}|${kind}`;
const keyId = (from, to, kind, norm) => `${from}|${to}|${kind}|${norm}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byEdge = (a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind) || cmp(a.key || '', b.key || '');
const isEdge = (e) => !!e && typeof e === 'object' && typeof e.from === 'string' && !!e.from
  && typeof e.to === 'string' && !!e.to && KINDS.includes(e.kind);
/** A scanned edge's id; the only keys labelsFromOverrides reads from overrides.edges. */
const AUTO_EDGE_ID_RE = /^x_[0-9a-f]{12}$/;
/** A label key as a norm: a norm ("topic:orders") is re-read through its body so it maps to
 *  itself, a raw key ("GET /users/:id") goes through normKey; null when neither reads it. db
 *  norms carry their own "db:" / "table:" prefix, which normKey reads directly. A kind-prefixed
 *  key normKey cannot re-read (a map from another worca version) is kept as written. */
function labelNorm(kind, key) {
  const prefixed = kind === 'db' ? /^(db|table):/i.test(key) : key.startsWith(`${kind}:`);
  return (prefixed && kind !== 'db' && normKey(kind, key.slice(kind.length + 1)))
    || normKey(kind, key) || (prefixed ? key : null);
}

/** checkLabels, keeping each entry's index in doc.edges (`i`) for the warnings. */
function readLabels(doc) {
  const list = doc && typeof doc === 'object' && Array.isArray(doc.edges) ? doc.edges : null;
  if (!list) return { edges: [], errors: ['edges: must be an array'] };
  const edges = [];
  const errors = [];
  list.forEach((l, i) => {
    const at = `edges[${i}]`;
    if (!l || typeof l !== 'object') { errors.push(`${at}: not an object`); return; }
    if (typeof l.from !== 'string' || !l.from || typeof l.to !== 'string' || !l.to) { errors.push(`${at}: from and to are required`); return; }
    if (!KINDS.includes(l.kind)) { errors.push(`${at}: kind must be one of ${KINDS.join(', ')}`); return; }
    if (l.truth === null || l.truth === undefined) return;
    if (typeof l.truth !== 'boolean') { errors.push(`${at}: truth must be true, false or null`); return; }
    if (l.key !== undefined && l.key !== null) {
      if (typeof l.key !== 'string' || !l.key.trim()) { errors.push(`${at}: key must be a non-empty string`); return; }
      if (!labelNorm(l.kind, l.key.trim())) { errors.push(`${at}: key is not a ${l.kind} key: ${l.key.trim().slice(0, 80)}`); return; }
      edges.push({ from: l.from, to: l.to, kind: l.kind, key: l.key.trim(), truth: l.truth, i });
      return;
    }
    edges.push({ from: l.from, to: l.to, kind: l.kind, truth: l.truth, i });
  });
  return { edges, errors };
}

/**
 * Normalise a labels doc. Invalid entries are dropped and described; undecided (truth null)
 * entries are dropped silently.
 * @param {unknown} doc
 * @returns {{edges: Array<{from:string,to:string,kind:string,key?:string,truth:boolean}>, errors: string[]}}
 */
export function checkLabels(doc) {
  const { edges, errors } = readLabels(doc);
  return { edges: edges.map(({ i, ...l }) => l), errors };
}

/** Warnings, never drops: what makes a labels doc look wrong for THIS map. Only when the map
 *  names its members (a null or member-less map warns about nothing). */
function labelWarnings(map, labels, read) {
  const members = new Set((map && Array.isArray(map.members) ? map.members : [])
    .map((m) => (m && typeof m.key === 'string' ? m.key : null)).filter(Boolean));
  if (!members.size) return [];
  const out = [];
  const name = map.workspace && typeof map.workspace.name === 'string' ? map.workspace.name : null;
  const ws = labels && typeof labels.workspace === 'string' ? labels.workspace : null;
  if (ws && name && ws !== name) out.push(`workspace: the labels are for "${ws}", the map is "${name}"`);
  const seen = new Map();
  for (const l of read) {
    const at = `edges[${l.i}]`;
    if (l.from === l.to) out.push(`${at}: from and to are the same member`);
    else {
      if (!members.has(l.from)) out.push(`${at}: from is not a member of this map: ${l.from}`);
      if (!members.has(l.to)) out.push(`${at}: to is not a member of this map: ${l.to}`);
    }
    const id = l.key ? keyId(l.from, l.to, l.kind, labelNorm(l.kind, l.key)) : pairId(l.from, l.to, l.kind);
    const prev = seen.get(id);
    if (!prev) seen.set(id, l);
    else if (prev.truth !== l.truth) out.push(`${at}: contradicts edges[${prev.i}] (same ${l.key ? 'key' : 'pair and kind'}, other truth)`);
  }
  return out;
}

/** The edges the map predicts: its own, or — with overrides — the reviewed map (rejected, missing
 *  and stale edges dropped, manual edges added). */
function predictedEdges(map, overrides) {
  const edges = overrides
    ? effectiveEdges(map, overrides).filter((e) => e.state !== 'rejected' && e.state !== 'missing' && e.state !== 'stale')
      .map((e) => (e.state === 'manual' ? { ...e, confidence: 'manual' } : e))   // a person's edge, not the scan's
    : (map && Array.isArray(map.edges) ? map.edges : []);
  return edges.filter(isEdge);
}

const tally = () => ({ tp: 0, fp: 0, fn: 0, unlabelled: 0 });
const ratio = (n, d) => (d > 0 ? n / d : null);
const finish = (t, recallDen = t.tp + t.fn) => ({ ...t, precision: ratio(t.tp, t.tp + t.fp), recall: ratio(t.tp, recallDen) });
function bump(bucket, name, field) {
  if (!bucket.has(name)) bucket.set(name, tally());
  bucket.get(name)[field] += 1;
}
function ordered(bucket, order) {
  const names = [...bucket.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || cmp(a, b);
  });
  return names;
}

/**
 * Precision / recall of `map` against `labels`, at pair+kind and key level, per kind and per
 * confidence. With `overrides`, the reviewed map is scored instead of the raw one.
 * Never throws: a null map predicts nothing, garbage labels label nothing (see labelErrors).
 * @param {object|null} map  workspace-map.json (spec §5.7)
 * @param {object} labels    labels doc (see the header)
 * @param {{overrides?: object|null}} [opts]
 * @returns {{pairs:object, keys:object, byKind:object, byConfidence:object,
 *   missed:object[], spurious:object[], labelErrors:string[],
 *   counts:{edges:number, pairs:number, labels:number}}}
 *   pairs / keys / byKind[kind]: {tp, fp, fn, unlabelled, precision, recall};
 *   byConfidence[c]: pair+kind level, a pair counted at its strongest edge's confidence;
 *   fn is always 0 there and recall is the share of the whole truth that confidence found.
 */
export function evaluate(map, labels, { overrides = null } = {}) {
  const predicted = predictedEdges(map, overrides);
  const { edges: labelled, errors } = readLabels(labels);
  const missed = [];
  const spurious = [];

  // ── key level ──
  const predKeys = new Map();
  for (const e of predicted) if (typeof e.norm === 'string' && e.norm) predKeys.set(keyId(e.from, e.to, e.kind, e.norm), e);
  const keyTruth = new Map();
  for (const l of labelled) {
    if (!l.key) continue;
    const norm = labelNorm(l.kind, l.key);   // readLabels dropped every key it cannot read
    const id = keyId(l.from, l.to, l.kind, norm);
    const prev = keyTruth.get(id);
    keyTruth.set(id, { ...l, key: norm, truth: (prev ? prev.truth : false) || l.truth });
  }
  const keys = tally();
  for (const [id, l] of keyTruth) {
    const e = predKeys.get(id);
    if (l.truth && e) keys.tp += 1;
    else if (l.truth) { keys.fn += 1; missed.push({ level: 'key', from: l.from, to: l.to, kind: l.kind, key: l.key }); }
    else if (e) {
      keys.fp += 1;
      spurious.push({ level: 'key', from: e.from, to: e.to, kind: e.kind, key: e.norm, id: e.id ?? null, confidence: e.confidence ?? null });
    }
  }
  for (const id of predKeys.keys()) if (!keyTruth.has(id)) keys.unlabelled += 1;

  // ── pair+kind level ──
  const predPairs = new Map();   // pair -> strongest confidence
  for (const e of predicted) {
    const id = pairId(e.from, e.to, e.kind);
    const c = typeof e.confidence === 'string' ? e.confidence : 'unknown';
    if (!predPairs.has(id) || confidenceRank(c) < confidenceRank(predPairs.get(id))) predPairs.set(id, c);
  }
  const pairTruth = new Map();   // pair -> { from, to, kind, truth, explicit }
  for (const l of labelled) {
    if (l.key) continue;
    const id = pairId(l.from, l.to, l.kind);
    const prev = pairTruth.get(id);
    pairTruth.set(id, { from: l.from, to: l.to, kind: l.kind, truth: (prev ? prev.truth : false) || l.truth, explicit: true });
  }
  for (const l of labelled) {
    if (!l.key) continue;
    const id = pairId(l.from, l.to, l.kind);
    const prev = pairTruth.get(id);
    if (prev && prev.explicit) continue;
    pairTruth.set(id, { from: l.from, to: l.to, kind: l.kind, truth: (prev ? prev.truth : false) || l.truth, explicit: false });
  }
  // A pair+kind known only through FALSE key labels is false only when every predicted edge of
  // it is labelled: an unlabelled predicted sibling may be the true one (partial labels, e.g.
  // --overrides), so such a pair stays unlabelled.
  const partlyLabelled = new Set(predicted
    .filter((e) => !(typeof e.norm === 'string' && e.norm && keyTruth.has(keyId(e.from, e.to, e.kind, e.norm))))
    .map((e) => pairId(e.from, e.to, e.kind)));
  for (const [id, t] of pairTruth) if (!t.explicit && !t.truth && partlyLabelled.has(id)) pairTruth.delete(id);
  const pairs = tally();
  const byKind = new Map();
  const byConf = new Map();
  for (const [id, t] of pairTruth) {
    const conf = predPairs.get(id);
    if (t.truth && conf !== undefined) { pairs.tp += 1; bump(byKind, t.kind, 'tp'); bump(byConf, conf, 'tp'); }
    else if (t.truth) { pairs.fn += 1; bump(byKind, t.kind, 'fn'); missed.push({ level: 'pair', from: t.from, to: t.to, kind: t.kind }); }
    else if (conf !== undefined) {
      pairs.fp += 1; bump(byKind, t.kind, 'fp'); bump(byConf, conf, 'fp');
      spurious.push({ level: 'pair', from: t.from, to: t.to, kind: t.kind, confidence: conf });
    }
  }
  for (const [id, conf] of predPairs) {
    if (pairTruth.has(id)) continue;
    pairs.unlabelled += 1;
    bump(byKind, id.split('|')[2], 'unlabelled');
    bump(byConf, conf, 'unlabelled');
  }

  const truthTotal = pairs.tp + pairs.fn;
  return {
    pairs: finish(pairs),
    keys: finish(keys),
    byKind: Object.fromEntries(ordered(byKind, KINDS).map((k) => [k, finish(byKind.get(k))])),
    byConfidence: Object.fromEntries(ordered(byConf, CONFIDENCE).map((c) => [c, finish(byConf.get(c), truthTotal)])),
    missed: missed.sort((a, b) => cmp(a.level, b.level) || byEdge(a, b)),
    spurious: spurious.sort((a, b) => cmp(a.level, b.level) || byEdge(a, b)),
    labelErrors: [...errors, ...labelWarnings(map, labels, labelled)],
    counts: { edges: predicted.length, pairs: predPairs.size, labels: labelled.length },
  };
}

/**
 * A labels template for `map` (--init): one KEY-level entry per edge with `truth: null` — set
 * each to true or false, add the relations the map missed (truth: true, key optional). The
 * extra display / confidence / id fields are for the reader; evaluate ignores them.
 * @param {object|null} map
 */
export function labelsFromMap(map) {
  const edges = (map && Array.isArray(map.edges) ? map.edges : []).filter(isEdge).map((e) => {
    const out = { from: e.from, to: e.to, kind: e.kind };
    if (typeof e.norm === 'string' && e.norm) out.key = e.norm;
    return { ...out, truth: null, display: e.display ?? null, confidence: e.confidence ?? null, id: e.id ?? null };
  }).sort(byEdge);
  return { version: LABELS_VERSION, workspace: (map && map.workspace && map.workspace.name) || null, edges };
}

/**
 * Labels from a workspace's review (--overrides): a confirmed edge -> true, a rejected edge ->
 * false (key level when the edge is on `map`); a confirmed edge `map` does not have -> a
 * pair+kind true (a relation the map missed); a manual edge -> a pair+kind true (missed).
 * A rejected edge `map` does not have says nothing about `map`: skipped. Only scanned-edge ids
 * (`x_` + 12 hex) are read from `overrides.edges`; manual edges come from `overrides.manual`.
 * @param {object|null} map
 * @param {object|null} overrides  map_overrides_json (spec §5.9 as amended by the index)
 */
export function labelsFromOverrides(map, overrides) {
  const onMap = new Map((map && Array.isArray(map.edges) ? map.edges : []).filter(isEdge).map((e) => [e.id, e]));
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const edges = [];
  for (const [id, o] of Object.entries(ov.edges && typeof ov.edges === 'object' ? ov.edges : {})) {
    if (!AUTO_EDGE_ID_RE.test(id) || !o || (o.state !== 'confirmed' && o.state !== 'rejected')) continue;
    const e = onMap.get(id);
    if (e && typeof e.norm === 'string' && e.norm) {
      edges.push({ from: e.from, to: e.to, kind: e.kind, key: e.norm, truth: o.state === 'confirmed' });
    } else if (e) {
      edges.push({ from: e.from, to: e.to, kind: e.kind, truth: o.state === 'confirmed' });
    } else if (o.state === 'confirmed' && isEdge(o)) {
      edges.push({ from: o.from, to: o.to, kind: o.kind, truth: true });
    }
  }
  for (const m of Array.isArray(ov.manual) ? ov.manual : []) {
    if (isEdge(m)) edges.push({ from: m.from, to: m.to, kind: m.kind, truth: true });
  }
  return { version: LABELS_VERSION, workspace: (map && map.workspace && map.workspace.name) || null, edges: edges.sort(byEdge) };
}

/** Map and label strings come from repositories and agents: no control character (an ESC
 *  sequence, a newline) reaches the terminal. */
const safe = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
const pct = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
function row(name, t) {
  return `${safe(name).padEnd(12)}${String(t.tp).padStart(5)}${String(t.fp).padStart(5)}${String(t.fn).padStart(5)}`
    + `${String(t.unlabelled).padStart(7)}${pct(t.precision).padStart(11)}${pct(t.recall).padStart(8)}`;
}
const HEAD = `${''.padEnd(12)}${'tp'.padStart(5)}${'fp'.padStart(5)}${'fn'.padStart(5)}${'unlab'.padStart(7)}${'precision'.padStart(11)}${'recall'.padStart(8)}`;
const edgeLine = (x) => `  [${x.level}] ${safe(x.from)} -> ${safe(x.to)}  ${safe(x.kind)}`
  + `${x.key ? `  ${safe(x.key)}` : ''}${x.confidence ? `  (${safe(x.confidence)})` : ''}`;

/**
 * The human-readable report of evaluate()'s result.
 * @param {ReturnType<typeof evaluate>} r
 * @param {{workspace?: string|null}} [opts]
 * @returns {string}
 */
export function formatReport(r, { workspace = null } = {}) {
  const out = [
    `worca workspace map eval${workspace ? ` — ${safe(workspace)}` : ''}: ${r.counts.edges} edges, ${r.counts.pairs} pairs, ${r.counts.labels} labels`,
    '',
    HEAD, row('pair+kind', r.pairs), row('key', r.keys),
    '',
    'by kind (pair+kind)', HEAD,
    ...Object.entries(r.byKind).map(([k, t]) => row(k, t)),
    '',
    'by confidence (pair+kind; recall = share of the truth found)', HEAD,
    ...Object.entries(r.byConfidence).map(([c, t]) => row(c, t)),
    '',
    `missed (${r.missed.length})`, ...r.missed.map(edgeLine),
    `spurious (${r.spurious.length})`, ...r.spurious.map(edgeLine),
  ];
  if (r.labelErrors.length) out.push(`label errors (${r.labelErrors.length})`, ...r.labelErrors.map((e) => `  ${safe(e)}`));
  return `${out.join('\n')}\n`;
}
