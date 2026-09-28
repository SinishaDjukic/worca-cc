// YAML (and JSON — JSON is YAML 1.2 flow syntax) loading for the detectors, with
// line numbers. Wraps the `yaml` package's AST instead of doc.toJS(): toJS prints
// a process warning on collection keys and cannot tell us where a value was
// written. Merge keys (`<<: *anchor`) are expanded, aliases resolved through a
// per-document anchor index (the package's Alias.resolve() re-walks the whole
// document per call — quadratic on an alias-heavy file), and every walk is bounded
// (MAX_NODES): the walks of a file share ONE budget (fileBudget), so a multi-document alias
// bomb costs MAX_NODES visits in all (the file's length when larger), and the cut is reported.
// Never throws: a malformed file yields whatever documents parsed plus errors[].
import { parseAllDocuments, LineCounter, isMap, isSeq, isScalar, isAlias, visit } from 'yaml';

const MAX_NODES = 200000;
const MAX_DEPTH = 64;
/** Plain YAML (compose, k8s, Spring, Helm values) larger than this is not parsed: real files
 *  are far smaller, and the yaml package's worst-case throughput is ~2 s per adversarial MiB.
 *  Spec detectors (OpenAPI / AsyncAPI) pass maxBytes = LIMITS.MAX_FILE_BYTES. */
export const YAML_MAX_BYTES = 262144;
/** ONE node budget for every walk of a file (pass it to entries / nodeAt / keyLine): MAX_NODES, or the file's length
 *  when larger. A node of alias-free YAML takes 2 bytes or more, so it never cuts one; only aliases fan out past it. */
export const fileBudget = (src) => ({ n: Math.max(MAX_NODES, String(src ?? '').length) });

function jsonDepthOk(v) {
  const stack = [[v, 0]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (d > MAX_DEPTH) return false;
    if (x && typeof x === 'object') for (const c of Object.values(x)) if (c && typeof c === 'object') stack.push([c, d + 1]);
  }
  return true;
}
const firstLine = (s) => String(s ?? '').split(/\r?\n/)[0];
const isMergeKey = (k) => isScalar(k) && (k.value === '<<' || (typeof k.value === 'symbol' && k.value.description === '<<'));

/** → { docs: [{ doc, root, js }], errors: string[], cut: boolean, lineOf(node) → 1-based line | 0 }
 *  json: true → the text must be JSON (comments already blanked by the caller; trailing commas
 *  tolerated) with nesting ≤ MAX_DEPTH, checked with JSON.parse BEFORE the slower YAML parse,
 *  so adversarial input fails fast. Plain YAML over maxBytes is refused ('yaml too large').
 *  cut: the file's node budget left a `js` short (never an entry of errors: callers report
 *  errors[0] as is; yamlProblem() gives what to report). */
export function loadYaml(text, { json = false, maxBytes = YAML_MAX_BYTES } = {}) {
  const lc = new LineCounter();
  const out = { docs: [], errors: [], cut: false, lineOf: (node) => (node && node.range ? lc.linePos(node.range[0]).line : 0) };
  const src = String(text ?? '').replace(/^\uFEFF/, ''); // editors on Windows write a BOM; JSON.parse rejects it
  if (json) {
    let v;
    try { v = JSON.parse(src); } catch {
      try { v = JSON.parse(src.replace(/,(\s*[}\]])/g, '$1')); } catch { out.errors.push('invalid JSON'); return out; }
    }
    if (!jsonDepthOk(v)) { out.errors.push('JSON too deep'); return out; }
  } else if (src.length > maxBytes) {
    out.errors.push('yaml too large');
    return out;
  }
  let parsed = [];
  try {
    parsed = parseAllDocuments(src, { lineCounter: lc, merge: true, uniqueKeys: false, prettyErrors: false });
  } catch (e) {
    out.errors.push(firstLine(e?.message || e));
    return out;
  }
  const budget = fileBudget(src); // ONE budget for every document of the file
  for (const doc of Array.from(parsed || [])) {
    for (const e of doc.errors || []) out.errors.push(firstLine(e.message));
    const root = doc.contents ?? null;
    let js = null;
    try { js = plain(doc, root, budget, 0); } catch (e) { out.errors.push(firstLine(e?.message || e)); }
    out.docs.push({ doc, root, js });
  }
  out.cut = budget.n < 0;
  return out;
}

/** What to report for a loaded file, the way a parse error is reported: its first error, else 'yaml too large'
 *  when the node budget cut it (loadYaml's `cut`) or cut one of the detector's own walks; null when it read whole. */
export function yamlProblem(y, ...walks) {
  return y?.errors?.[0] ?? (y?.cut || walks.some((b) => b && b.n < 0) ? 'yaml too large' : null);
}

const ANCHORS = new WeakMap();
/** anchor name → anchored nodes in document order (one visit per document). */
function anchorIndex(doc) {
  let idx = ANCHORS.get(doc);
  if (idx) return idx;
  idx = new Map();
  try {
    visit(doc, (_key, node) => {
      if (node && node.anchor && !isAlias(node)) {
        if (!idx.has(node.anchor)) idx.set(node.anchor, []);
        idx.get(node.anchor).push(node);
      }
    });
  } catch { /* a pathologically deep document: aliases stay unresolved */ }
  ANCHORS.set(doc, idx);
  return idx;
}

/** YAML semantics: an alias refers to the closest PRECEDING node with that anchor. */
function resolveAlias(doc, alias) {
  const list = anchorIndex(doc).get(alias.source);
  if (!list) return null;
  const at = alias.range ? alias.range[0] : Infinity;
  let lo = 0;
  let hi = list.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid].range ? list[mid].range[0] : 0) < at) { best = list[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function deref(doc, node, depth = 0) {
  let n = node;
  while (isAlias(n) && depth < MAX_DEPTH) { n = resolveAlias(doc, n); depth += 1; }
  return isAlias(n) ? null : n;
}

/** Map entries in effective order, merge keys expanded (own keys override merged ones).
 *  → [{ key: string, keyNode, value: Node }] ; non-scalar keys are skipped. */
export function entries(doc, mapNode, budget = { n: MAX_NODES }, depth = 0) {
  const map = deref(doc, mapNode);
  const out = new Map();
  if (!isMap(map) || depth > MAX_DEPTH) return [];
  for (const p of map.items) {
    if (budget.n-- <= 0) break;
    if (isMergeKey(p.key)) {
      const src = deref(doc, p.value);
      const list = isSeq(src) ? src.items : [src];
      // each merge source costs a visit: a map merging F aliases of an empty map, referenced F times, is F² work for no entry
      for (const s of list) { if (budget.n-- <= 0) break; for (const e of entries(doc, s, budget, depth + 1)) if (!out.has(e.key)) out.set(e.key, e); }
      continue;
    }
    const k = deref(doc, p.key);
    if (!isScalar(k) || k.value == null || typeof k.value === 'symbol') continue;
    const key = String(k.value);
    out.delete(key);
    out.set(key, { key, keyNode: p.key, value: p.value });
  }
  return [...out.values()];
}

function plain(doc, node, budget, depth) {
  if (node == null || budget.n-- <= 0 || depth > MAX_DEPTH) return null;
  const n = deref(doc, node);
  if (n == null) return null;
  if (isScalar(n)) return typeof n.value === 'symbol' ? null : n.value;
  if (isSeq(n)) return n.items.map((it) => plain(doc, it, budget, depth + 1));
  if (isMap(n)) {
    const o = {};
    for (const e of entries(doc, n, budget, depth)) o[e.key] = plain(doc, e.value, budget, depth + 1);
    return o;
  }
  return null;
}

/** The node at path (string keys / number indices), aliases and merges resolved; null when absent. `budget`: the
 *  file's walk budget (fileBudget), shared with every other walk of the file; a fresh MAX_NODES when omitted. */
export function nodeAt(doc, root, path, budget) {
  let n = deref(doc, root);
  for (const seg of path) {
    if (n == null) return null;
    if (typeof seg === 'number') { n = isSeq(n) ? deref(doc, n.items[seg]) : null; continue; }
    const e = entries(doc, n, budget).find((x) => x.key === seg);
    n = e ? deref(doc, e.value) : null;
  }
  return n;
}

/** Line of the KEY that holds path's last segment (a seq index → the item's line). 0 when absent. `budget`: as nodeAt. */
export function keyLine(y, doc, root, path, budget) {
  if (!path.length) return y.lineOf(root);
  const parent = nodeAt(doc, root, path.slice(0, -1), budget);
  const last = path[path.length - 1];
  if (typeof last === 'number') return isSeq(parent) ? y.lineOf(parent.items[last]) : 0;
  const e = entries(doc, parent, budget).find((x) => x.key === last);
  return e ? y.lineOf(e.keyNode) : 0;
}

/** A flattened key (`path.join('.')`) longer than this is no configuration key: walkScalars skips it with its subtree. */
const KEY_MAX = 512;
/** Flattened keys plus scalar values walkScalars hands its callback, in all (per budget: one per file). */
const WALK_BYTES = 4 * 1024 * 1024;

/** Calls cb({ path, value, line }) for every scalar leaf under root (value line). Bounded per `budget` (pass ONE object to
 *  the walks of every document of a file): at most MAX_NODES visits; no leaf whose flattened key (`path.join('.')`) is
 *  over KEY_MAX chars — its subtree is skipped (a 400 KB JSON key over 20 000 leaves built gigabytes of keys: out of
 *  memory); and at most WALK_BYTES of flattened keys plus scalar values handed to cb (YAML aliases re-visit one scalar up
 *  to MAX_NODES times: a 6 KB file of aliased values cost config-env 10 s). → true when the byte budget cut the walk short. */
export function walkScalars(y, doc, root, cb, budget = {}) {
  budget.n ??= MAX_NODES;
  budget.bytes ??= WALK_BYTES;
  const visit = (node, path, len, depth) => {
    if (node == null || budget.n-- <= 0 || budget.bytes < 0 || depth > MAX_DEPTH) return;
    const n = deref(doc, node);
    if (n == null) return;
    if (isScalar(n)) {
      if (typeof n.value === 'symbol') return;
      budget.bytes -= len + (typeof n.value === 'string' ? n.value.length : 16);
      if (budget.bytes >= 0) cb({ path, value: n.value, line: y.lineOf(n) });
      return;
    }
    const down = (k) => len + (path.length ? 1 : 0) + String(k).length; // the flattened key's length one level down
    // down(i) never shrinks as i grows: stop at the first item over KEY_MAX (every later one is too), never iterate the rest
    if (isSeq(n)) { for (let i = 0; i < n.items.length && down(i) <= KEY_MAX; i += 1) visit(n.items[i], [...path, i], down(i), depth + 1); return; }
    if (isMap(n)) for (const e of entries(doc, n, budget, depth)) if (down(e.key) <= KEY_MAX) visit(e.value, [...path, e.key], down(e.key), depth + 1);
  };
  visit(root, [], 0, 0);
  return budget.bytes < 0;
}
