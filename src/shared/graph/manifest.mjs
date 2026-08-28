// src/shared/graph/manifest.mjs
// The run-start snapshot persisted as pipelines.stepper. SELF-SUFFICIENT by
// design: History renders it when the registry is gone or edited, so nothing
// here may be re-resolved later. Built once per run (and by resume()), NEVER
// rewritten mid-run — fan-out lives in the execution ledger, not the manifest.
//
// It also carries DERIVED `steps` cells and `feedbacks` in the shape the v1
// buildStepperManifest used to produce. P1's handoff said P8 would delete them;
// it does NOT, and deliberately: they have LIVE v2 readers (findManifestNode,
// cycleAwareLabel, nodeLabelLookup, manifestStepsForWires, loopCounts), so they
// are a real part of the v2 manifest now, not a shim. What made them safe is
// manifestFor() returning an EMPTY manifest instead of the v1 default seven.
// UI_PHASE survives for the same reason: `:116` stamps `uiPhase` on every v2
// agent cell, and the sub_agents.ui_phase attribution column still needs it. The
// workflows.mjs copy is gone (the v1 topology helpers went with the v1 engine),
// so THIS is the only copy — shared code may not import workflows.mjs.
import { TEMPLATE_VERSION, AWAIT_PORT, DEFAULT_MAX_CYCLES } from './constants.mjs';
import { portsFnFor, portsOf, resolveOrOutType } from './ports.mjs';
import { classifyLoops } from './loops.mjs';
import { rankNodes } from './layout.mjs';

/** Agent key -> the UI stepper bucket. The only copy: the v1 original left
 *  workflows.mjs with the topology helpers. */
export const UI_PHASE = Object.freeze({
  clarify: 'clarify',
  planner: 'plan', refiner: 'refine', decomposer: 'decompose', implementer: 'implement', reviewer: 'review',
  manualTestsChecklist: 'manual-checklist', manualWebUiTesting: 'manual-web', planReviewer: 'plan-review',
  workspaceReviewer: 'review',
});

const FLOW_LABEL = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };
const ICON_MAX = 2048;
/** The icon is an ALLOWLIST, not a denylist: a sidecar can be user- or
 *  plugin-authored (exactly what v1's UI refuses to inline — `safeAgentIcon`),
 *  the markup rides the manifest into innerHTML, and the manifest is persisted,
 *  so it outlives any renderer-side fix. A denylist of `on…=` handlers misses
 *  `/`, `"` and `'` as attribute separators and every entity encoding; these
 *  three tables cover the whole shipped icon vocabulary instead. */
const ICON_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g']);
const ICON_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'transform', 'opacity', 'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-miterlimit', 'vector-effect', 'clip-rule']);
// Both alternations are UNAMBIGUOUS at every position (the bare class excludes
// the quotes), so neither can backtrack quadratically on a malformed icon.
const ICON_TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
const ICON_ATTR_RE = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*("[^"]*"|'[^']*')/g;

/** Inline SVG markup rides the manifest into innerHTML, so anything outside the
 *  allowlist is dropped WHOLE (never truncated — a half tag is worse). */
function sanitizeIcon(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > ICON_MAX) return '';
  let cursor = 0;
  ICON_TAG_RE.lastIndex = 0;
  for (let m; (m = ICON_TAG_RE.exec(s));) {
    if (s.slice(cursor, m.index).trim()) return '';           // a text node between tags
    cursor = m.index + m[0].length;
    if (!ICON_TAGS.has(m[2].toLowerCase())) return '';
    if (m[1]) { if (m[3].trim()) return ''; continue; }        // a closing tag carries nothing
    if (!iconAttrsOk(m[3])) return '';
  }
  return cursor === s.length ? s : '';                        // trailing text or an unclosed tag
}

/** Every attribute quoted, named in ICON_ATTRS, and free of `<`/`&` — an
 *  entity-encoded `javascript:` decodes only AFTER the filter would have run. */
function iconAttrsOk(rawAttrs) {
  const attrs = rawAttrs.replace(/\/\s*$/, '');               // the self-closing slash
  let cursor = 0;
  ICON_ATTR_RE.lastIndex = 0;
  for (let m; (m = ICON_ATTR_RE.exec(attrs));) {
    if (attrs.slice(cursor, m.index).trim()) return false;    // a bare or unquoted attribute
    cursor = m.index + m[0].length;
    if (!ICON_ATTRS.has(m[1].toLowerCase())) return false;
    if (/[<&]/.test(m[2])) return false;
  }
  return !attrs.slice(cursor).trim();
}

const isNode = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string';
const isWire = (w) => Boolean(w) && typeof w === 'object' && !Array.isArray(w)
  && typeof w?.from?.node === 'string' && typeof w?.to?.node === 'string';

/**
 * @param {object} tpl resolved v2 template
 * @param {Record<string,object>} agentsByKey merged registry metas
 * @param {{overlays?:{nodes?:object, wires?:object}}} [opts] effective per-node config + per-wire budgets
 */
export function buildGraphManifest(tpl, agentsByKey, opts = {}) {
  const overlays = opts.overlays || {};
  const nodeOverlays = overlays.nodes || {};
  const wireOverlays = overlays.wires || {};
  const portsFn = portsFnFor(agentsByKey);
  // Objects with real endpoints only. `filter(Boolean)` kept a truthy non-object
  // node and an endpoint-less wire, and `w.from.node` threw one map later — the
  // manifest is built from an ALREADY validated template, but it is also built
  // by resume() from a persisted one, so it degrades instead of crashing.
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : []).filter(isWire);
  const loops = classifyLoops(tpl, portsFn);
  const ranks = rankNodes(tpl, loops);
  const launchIndex = new Map(loops.launchOrder.map((id, i) => [id, i]));
  const isWired = new Set(wires.map((w) => `${w?.to?.node}.${w?.to?.port}`));

  const manifestNodes = nodes.map((node) => {
    const resolved = portsOf(portsFn, node);
    const meta = node.kind === 'agent' ? (agentsByKey?.[node.key] || null) : null;
    const over = nodeOverlays[node.id] || {};
    const cfg = node.config || {};
    const outType = (port) => (node.kind === 'or' && (!port.type || port.type === 'any')
      ? (resolveOrOutType(tpl, portsFn, node.id) || 'any') : port.type);
    const cell = {
      id: node.id,
      kind: node.kind,
      key: node.kind === 'agent' ? node.key : null,
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      label: node.kind === 'agent' ? (meta?.displayName || node.key) : (FLOW_LABEL[node.kind] || node.kind),
      // The v1 stepper bucket. UI_PHASE knows the 11 builtins; a custom agent
      // buckets under its own key (the sidecar's `uiPhase` died with the v1
      // vocabulary). The whole field goes with the phase shim in Task 16.
      uiPhase: node.kind === 'agent' ? (UI_PHASE[node.key] || node.key) : node.kind,
      // The AUTHORED config, verbatim and complete (unknown keys included —
      // V17's "preserved and ignored" promise). The manifest is the ONLY
      // persisted copy of the topology: P4 rebuilds the template from it on a
      // resume and never re-reads the workflow row, so anything dropped here
      // (`planStoreSeed`, a future tunable) is lost for the rest of the run.
      config: { ...(node.config || {}) },
      ports: {
        inputs: resolved.inputs.filter((p) => !p.synthetic).map((p) => ({
          id: p.id, type: p.type, required: p.required !== false, loop: !!p.loop, expands: !!p.expands })),
        outputs: resolved.outputs.map((p) => ({ id: p.id, type: outType(p), when: p.when || 'always' })),
        await: resolved.inputs.some((p) => p.synthetic),
      },
    };
    if (node.kind === 'agent') {
      cell.color = meta?.color || '';
      cell.icon = sanitizeIcon(meta?.icon);
      cell.model = over.model ?? cfg.model ?? '';
      cell.effort = over.effort ?? cfg.effort ?? '';
      cell.askQuestions = !!(over.askQuestions ?? cfg.askQuestions ?? meta?.questionsDefault ?? false);
      cell.awaitAll = !!(over.awaitAll ?? cfg.awaitAll ?? false);
      cell.fanOut = !!(over.fanOut ?? cfg.fanOut ?? meta?.fanOut ?? false);
    }
    if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
      cell.arity = Number.isInteger(cfg.arity) ? cfg.arity : 2;
    }
    return cell;
  });

  const manifestWires = wires.map((w) => {
    const loop = loops.loopWireIds.has(w.id);
    const cell = { id: w.id, from: { node: w.from.node, port: w.from.port },
      to: { node: w.to.node, port: w.to.port }, loop };
    // maxCycles rides LOOP wires only: overlay > authored > default.
    if (loop) cell.maxCycles = coerceCycles(wireOverlays[w.id]?.maxCycles ?? w.config?.maxCycles);
    return cell;
  });

  // ── the v1 shim (P4-P7; deleted in P8) ─────────────────────────────────────
  const byRank = new Map();
  for (const node of manifestNodes) {
    const r = ranks[node.id] ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(node);
  }
  const agentCells = [...byRank.keys()].sort((a, b) => a - b).map((r) => ({
    kind: 'agents',
    nodes: byRank.get(r)
      .sort((a, b) => (launchIndex.get(a.id) ?? 0) - (launchIndex.get(b.id) ?? 0))
      .map((n) => ({
        id: n.id,
        key: n.key,
        uiPhase: n.uiPhase,
        label: n.label,
        color: n.color || '',
        sub: (n.key && agentsByKey?.[n.key]?.description) || '',
        cycles: n.ports.inputs.some((p) => p.loop && isWired.has(`${n.id}.${p.id}`)),
        model: n.model || '',
        effort: n.effort || '',
      })),
  }));

  return {
    version: 2,
    template: { id: tpl?.id ?? '', name: tpl?.name ?? '' },
    graph: { nodes: manifestNodes, wires: manifestWires },
    bookends: { preflight: true, done: true },
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      ...agentCells,
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: manifestWires.filter((w) => w.loop)
      .map((w) => ({ id: w.id, from: w.from.node, to: w.to.node, maxCycles: w.maxCycles })),
  };
}

function coerceCycles(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_CYCLES;
}

/** A portsFn over a MANIFEST — the run monitor never touches the live registry.
 *  The await port is re-synthesized from the boolean so geometry, validation and
 *  hit-testing behave exactly as they do in the composer. */
export function manifestPortsFn(manifest) {
  const byId = new Map((manifest?.graph?.nodes || []).map((n) => [n.id, n]));
  return (node) => {
    const cell = byId.get(node?.id);
    if (!cell) return undefined;
    return {
      known: true,
      ported: true,
      inputs: cell.ports.await ? [...cell.ports.inputs, AWAIT_PORT] : [...cell.ports.inputs],
      outputs: [...cell.ports.outputs],
      displayName: cell.label,
      color: cell.color,
      icon: cell.icon,
      // A verdict-bearing node is one with a conditional output — enough for V13
      // and firedOutputs; the filename itself never leaves the engine.
      verdict: cell.ports.outputs.some((p) => p.when && p.when !== 'always') ? { filename: '' } : undefined,
    };
  };
}

/** The renderable template inside a manifest (id/kind/x/y/config + wires). */
export function manifestTemplate(manifest) {
  return {
    id: manifest?.template?.id ?? '',
    name: manifest?.template?.name ?? '',
    version: TEMPLATE_VERSION,
    domain: '',
    nodes: (manifest?.graph?.nodes || []).map((n) => {
      // `config` is restored VERBATIM from the cell — no per-key rebuild. The
      // old `{arity, awaitAll}` reconstruction silently dropped everything else
      // (`planStoreSeed` on the Task card of `wf_provided-plan`, for one).
      const node = { id: n.id, kind: n.kind, x: n.x, y: n.y, config: { ...(n.config || {}) } };
      if (n.kind === 'agent') node.key = n.key;
      return node;
    }),
    wires: (manifest?.graph?.wires || []).map((w) => {
      const wire = { id: w.id, from: { ...w.from }, to: { ...w.to } };
      if (w.loop && w.maxCycles !== undefined) wire.config = { maxCycles: w.maxCycles };
      return wire;
    }),
  };
}
