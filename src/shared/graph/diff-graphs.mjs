// src/shared/graph/diff-graphs.mjs
// What changed between two workflow graphs, in plain words for the Versions page, the Save version dialog and the
// version comparison (plans/workflow-tests-plan.md D10). Pure and browser-safe: no node: imports (shared-graph-purity).
// Layout (x, y, canvas) never counts as a change.

/** Deterministic JSON: object keys sorted at every depth; undefined → null. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** A config as both sides compare it: keys holding null/undefined dropped; nothing left (or not an object) → null.
 *  So `config: {}`, a missing config and `{ model: null }` are the same (graphShape and diffGraphs agree). */
export function cleanConfig(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const kept = Object.entries(c).filter(([, v]) => v !== undefined && v !== null);
  return kept.length ? Object.fromEntries(kept) : null;
}
/** A wire's settings. The stored graph keeps them in `wire.config` (maxCycles, onExhausted: composer.mjs, canvas-ops.mjs);
 *  a manifest-shaped wire carries `maxCycles` at the top level. config wins; the top level is the fallback. */
export function wireConfig(w) {
  const top = w && w.maxCycles !== undefined && w.maxCycles !== null ? { maxCycles: w.maxCycles } : {};
  return cleanConfig({ ...top, ...(cleanConfig(w && w.config) || {}) });
}

const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);
const byId = (a) => new Map(list(a).map((x) => [x.id, x]));
const plainLabel = (n) => (n && (n.key || n.kind)) || 'step';
const ends = (w) => canon({ from: w.from ?? null, to: w.to ?? null });
const shown = (v) => (v === undefined || v === null || v === '' ? 'default' : String(v));

/**
 * @param {{name?: string, nodes?: Array, wires?: Array}} before
 * @param {{name?: string, nodes?: Array, wires?: Array}} after
 * @param {{labelOf?: (node: object) => string}} [opts]
 * @returns {Array<{kind: string, nodeId?: string, text: string}>}
 */
export function diffGraphs(before, after, { labelOf = plainLabel } = {}) {
  const out = [];
  const label = (n) => labelOf(n) || plainLabel(n);
  if ((before?.name ?? '') !== (after?.name ?? '') && before?.name && after?.name) {
    out.push({ kind: 'name', text: `Renamed from "${before.name}" to "${after.name}"` });
  }
  const a = byId(before?.nodes);
  const b = byId(after?.nodes);
  for (const [id, n] of a) if (!b.has(id)) out.push({ kind: 'removed', nodeId: id, text: `Removed step ${label(n)}` });
  for (const [id, n] of b) if (!a.has(id)) out.push({ kind: 'added', nodeId: id, text: `New step ${label(n)}` });
  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na) continue;
    if ((na.key ?? null) !== (nb.key ?? null) || na.kind !== nb.kind) {
      out.push({ kind: 'replaced', nodeId: id, text: `${label(nb)} replaces ${label(na)}` });
    }
    const ca = cleanConfig(na.config) || {};
    const cb = cleanConfig(nb.config) || {};
    if ((ca.model ?? null) !== (cb.model ?? null)) out.push({ kind: 'model', nodeId: id, text: `${label(nb)}: AI model ${shown(ca.model)} → ${shown(cb.model)}` });
    if ((ca.effort ?? null) !== (cb.effort ?? null)) out.push({ kind: 'effort', nodeId: id, text: `${label(nb)}: effort ${shown(ca.effort)} → ${shown(cb.effort)}` });
    const rest = (c) => canon(Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'model' && k !== 'effort')));
    if (rest(ca) !== rest(cb)) out.push({ kind: 'config', nodeId: id, text: `${label(nb)}: settings changed` });
  }
  const wa = byId(before?.wires);
  const wb = byId(after?.wires);
  let rewired = wa.size !== wb.size;
  for (const [id, w] of wb) {
    const prev = wa.get(id);
    if (!prev || ends(prev) !== ends(w)) { rewired = true; continue; }
    const pa = wireConfig(prev) || {};
    const pb = wireConfig(w) || {};
    // A loop is named after the step that redoes the work; into a join node (or, …) it is named after the sender.
    const isStep = (n) => n && (n.kind === 'agent' || n.kind === 'script');
    const to = b.get(w.to?.node);
    const from = b.get(w.from?.node);
    const target = isStep(to) || !isStep(from) ? to || { key: w.to?.node } : from;
    if ((pa.maxCycles ?? null) !== (pb.maxCycles ?? null)) {
      out.push({ kind: 'loop', text: `${label(target)} loop: at most ${shown(pa.maxCycles)} rounds → ${shown(pb.maxCycles)}` });
    }
    const others = (c) => canon(Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'maxCycles')));
    if (others(pa) !== others(pb)) out.push({ kind: 'wire-config', text: `${label(target)} loop: settings changed` });
  }
  for (const id of wa.keys()) if (!wb.has(id)) rewired = true;
  if (rewired) out.push({ kind: 'wires', text: 'Connections between steps changed' });
  return out;
}
