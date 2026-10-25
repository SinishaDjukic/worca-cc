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
    const ca = na.config && typeof na.config === 'object' ? na.config : {};
    const cb = nb.config && typeof nb.config === 'object' ? nb.config : {};
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
    if ((prev.maxCycles ?? null) !== (w.maxCycles ?? null)) {
      const target = b.get(w.to?.node) || { key: w.to?.node };
      out.push({ kind: 'loop', text: `${label(target)} loop: at most ${shown(prev.maxCycles)} rounds → ${shown(w.maxCycles)}` });
    }
  }
  for (const id of wa.keys()) if (!wb.has(id)) rewired = true;
  if (rewired) out.push({ kind: 'wires', text: 'Connections between steps changed' });
  return out;
}
