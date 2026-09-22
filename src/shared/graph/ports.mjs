// src/shared/graph/ports.mjs
// Port resolution for the v2 graph model — the ONE place that answers "what
// ports does this node have?" for the engine, the validator, the composer and
// the run monitor. Pure: no IO, no state, and NOTHING here throws on a
// malformed template — an unknown agent key (V4), a dangling endpoint (V5) or
// an unknown kind (V3) is an error for the validator to COLLECT, so every
// lookup guards instead of crashing.
import { AWAIT_PORT, PARAMS_PORT, FLOW_KINDS, gatePorts, TASK_PORTS, END_PORTS } from './constants.mjs';
import { hasBlocking } from './verdict.mjs';
import { readConfigPorts, hasParamsPort } from './script-meta.mjs';

/** Engine flow-card ports. `undefined` for an unknown kind — V3's error. */
export function flowPorts(node) {
  const kind = node?.kind;
  if (!FLOW_KINDS.includes(kind)) return undefined; // FLOW_KINDS is a frozen ARRAY (P1)
  if (kind === 'task') return { known: true, ported: true, inputs: [], outputs: [...TASK_PORTS.outputs] };
  if (kind === 'end') return { known: true, ported: true, inputs: [...END_PORTS.inputs], outputs: [] };
  if (kind === 'and' || kind === 'or' || kind === 'combine') {
    const arity = Number.isInteger(node?.config?.arity) ? node.config.arity : 2;
    const { inputs, outputs } = gatePorts(kind, Math.max(2, arity));
    return { known: true, ported: true, inputs, outputs };
  }
  return undefined;
}

const toIndex = (v) => (v instanceof Map ? v : new Map(Object.entries(v && typeof v === 'object' ? v : {})));

/**
 * Build the ports function over the merged AGENT registry and the merged SCRIPT
 * registry (objects or Maps keyed by key — the two namespaces never overlap, D16).
 * Keyed nodes get their sidecar's typed ports PLUS the engine-synthesized `await`
 * gate appended LAST; flow cards get flowPorts. Outcomes V4 tells apart:
 *   unknown key                       -> undefined            (known:false)
 *   agent key without v2 ports        -> {known:true, ported:false}
 *   config-ported script, no config   -> {known:true, ported:false, configPortsMissing:true}
 *   config-ported script, bad config  -> {known:true, ported:false, configPortsInvalid:true, configPortsErrors}
 *   ported                            -> {known:true, ported:true, inputs:[...ports, params?, await], outputs}
 */
export function portsFnFor(agentsByKey, scriptsByKey = {}) {
  const agents = toIndex(agentsByKey);
  const scripts = toIndex(scriptsByKey);
  return (node) => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.kind === 'agent') return sidecarPorts(agents.get(node.key));
    if (node.kind === 'script') return scriptPorts(scripts.get(node.key), node);
    return flowPorts(node);
  };
}

function sidecarPorts(meta) {
  if (!meta) return undefined;
  if (!Array.isArray(meta.inputs) || !Array.isArray(meta.outputs)) {
    return { ...meta, known: true, ported: false, inputs: [], outputs: [] };
  }
  return { ...meta, known: true, ported: true, inputs: [...meta.inputs, AWAIT_PORT], outputs: [...meta.outputs] };
}

/** A script card's engine inputs, after its own: the opt-in `params` port, then `await` LAST. */
const engineInputs = (meta, node) => (hasParamsPort(meta, node?.config) ? [PARAMS_PORT, AWAIT_PORT] : [AWAIT_PORT]);

/** Script ports: the sidecar's, or — for `ports: "config"` (D14) — the placed
 *  node's `config.ports` through the shared readers. */
function scriptPorts(meta, node) {
  if (!meta) return undefined;
  if (meta.ports !== 'config') {
    const p = sidecarPorts(meta);
    return p.ported ? { ...p, inputs: [...meta.inputs, ...engineInputs(meta, node)] } : p;
  }
  const cfg = node?.config?.ports;
  if (cfg === undefined) return { ...meta, known: true, ported: false, configPortsMissing: true, inputs: [], outputs: [] };
  const { ports, errors } = readConfigPorts(cfg, { hasVerdict: !!meta.verdict });
  if (!ports) return { ...meta, known: true, ported: false, configPortsInvalid: true, configPortsErrors: errors, inputs: [], outputs: [] };
  return { ...meta, known: true, ported: true, inputs: [...ports.inputs, ...engineInputs(meta, node)], outputs: [...ports.outputs] };
}

/**
 * Resolve one node's ports defensively. NEVER throws — a portsFn that throws,
 * a missing key and an unknown kind all collapse to `known:false`, and a
 * registry entry with no v2 ports reports `known:true, ported:false` so V4 can
 * say "port its sidecar" instead of "unknown agent".
 * @returns {{known:boolean, ported:boolean, inputs:Array, outputs:Array, meta:object|null}}
 */
export function portsOf(portsFn, node) {
  let resolved = null;
  try { resolved = typeof portsFn === 'function' ? portsFn(node) : null; } catch { resolved = null; }
  if (!resolved || typeof resolved !== 'object') {
    return { known: false, ported: false, inputs: [], outputs: [], meta: null };
  }
  const ported = resolved.ported !== false && Array.isArray(resolved.inputs);
  return {
    known: resolved.known !== false,
    ported,
    inputs: ported && Array.isArray(resolved.inputs) ? resolved.inputs : [],
    outputs: ported && Array.isArray(resolved.outputs) ? resolved.outputs : [],
    meta: resolved,
  };
}

/** One port of a RESOLVED ports object (`portsFn(node)` or `portsOf(...)`). */
export function findPort(ports, portId, dir) {
  const list = dir === 'out' ? ports?.outputs : ports?.inputs;
  return (Array.isArray(list) ? list : []).find((p) => p?.id === portId) || null;
}

/** Wire legality by type: `any` inputs accept everything, otherwise equality.
 *  A null/undefined source type is UNRESOLVABLE (an or with no inbound source)
 *  and compatible by construction — the caller skips it. */
export function typeCompatible(outType, inType) {
  if (outType === null || outType === undefined) return true;
  return inType === 'any' || outType === inType;
}

/**
 * The or card's payload type, resolved from its inbound wires' source outputs:
 * the first resolvable one, walking inbound wires by `inK` index and then by
 * wire id so the answer never depends on insertion order. Chained ors resolve
 * THROUGH (seen-set guarded, so a cyclic or->or chain returns null instead of
 * hanging). `null` = unresolvable (an unwired `inK` is already V12's error).
 */
export function resolveOrOutType(tpl, portsFn, orId, seen = new Set()) {
  if (!orId || seen.has(orId)) return null;
  seen.add(orId);
  const nodes = Array.isArray(tpl?.nodes) ? tpl.nodes : [];
  const byId = new Map(nodes.filter((n) => n && typeof n === 'object').map((n) => [n.id, n]));
  const inbound = inboundWires(tpl, orId)
    .sort((a, b) => portIndex(a.to.port) - portIndex(b.to.port) || compareIds(a.id, b.id));
  for (const w of inbound) {
    const src = byId.get(w?.from?.node);
    if (!src) continue;                                   // dangling endpoint — V5's error
    const out = findPort(portsOf(portsFn, src), w.from.port, 'out');
    if (!out) continue;
    if (out.type && out.type !== 'any') return out.type;
    if (src.kind === 'or') {
      const through = resolveOrOutType(tpl, portsFn, src.id, seen);
      if (through) return through;
    }
  }
  return null;
}

/** Live-or-not, every wire whose `to` (resp. `from`) matches, in template order. */
export function inboundWires(tpl, nodeId, portId) {
  return (Array.isArray(tpl?.wires) ? tpl.wires : []).filter((w) => w?.to?.node === nodeId
    && (portId === undefined || w?.to?.port === portId));
}

export function outboundWires(tpl, nodeId, portId) {
  return (Array.isArray(tpl?.wires) ? tpl.wires : []).filter((w) => w?.from?.node === nodeId
    && (portId === undefined || w?.from?.port === portId));
}

/**
 * Conditional routing (base spec §2): every `when: 'always'` output plus
 * EXACTLY one conditional side — `blocking` iff the verdict carries a critical
 * or major issue, `clean` otherwise. Declared order is preserved and the PORT
 * OBJECTS come back, because the executor needs filename/store/artifactKind.
 * Accepts an outputs array or a resolved ports object.
 */
export function firedOutputs(ports, verdict) {
  const declared = Array.isArray(ports) ? ports : (Array.isArray(ports?.outputs) ? ports.outputs : []);
  const side = hasBlocking(verdict) ? 'blocking' : 'clean';
  return declared.filter((o) => {
    const when = o?.when || 'always';
    return when === 'always' || when === side;
  });
}

/** `in3` -> 3; anything else sorts last (deterministic, never NaN). */
function portIndex(port) {
  const m = /^in(\d+)$/.exec(String(port ?? ''));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** Total order on wire ids (undefined ids sort last, never NaN-compare). */
function compareIds(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}
