// src/shared/graph/template.mjs
// The editable v2 template: normalize/serialize, the node/wire factory and the
// drop-legality check the composer runs on the POINTER PATH (so it must stay a
// Map lookup plus a type check — never a Tarjan walk).
import { TEMPLATE_VERSION } from './constants.mjs';
import { portsOf, findPort, resolveOrOutType, inboundWires } from './ports.mjs';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const ARITY_SET = new Set(['and', 'or', 'combine']);

/** Canonicalize an authored or fetched template: numeric coordinates, a
 *  materialized `config` on every node, non-object nodes/wires dropped, `key`
 *  kept only where V3 allows it. Unknown config keys are PRESERVED (V17 warns
 *  and ignores them; it never strips them). */
export function normalizeTemplate(raw) {
  const t = isObject(raw) ? raw : {};
  const template = {
    id: String(t.id ?? ''),
    name: String(t.name ?? ''),
    version: TEMPLATE_VERSION,
    domain: String(t.domain ?? ''),
    nodes: (Array.isArray(t.nodes) ? t.nodes : []).filter(isObject).map(normalizeNode),
    wires: (Array.isArray(t.wires) ? t.wires : []).filter(isObject).map(normalizeWire),
  };
  const canvas = normalizeCanvas(t.canvas);
  if (canvas) template.canvas = canvas;     // view state, engine-ignored — but it round-trips
  return template;
}

/** The POST body: normalized, stable key order, stripped of anything JSON cannot carry. */
export function serializeTemplate(template) {
  return JSON.parse(JSON.stringify(normalizeTemplate(template)));
}

function normalizeNode(node) {
  const out = { id: String(node.id ?? ''), kind: String(node.kind ?? '') };
  if (out.kind === 'agent' && node.key !== undefined) out.key = String(node.key);
  out.x = Number(node.x);
  out.y = Number(node.y);
  out.config = isObject(node.config) ? { ...node.config } : {};
  return out;
}

function normalizeWire(wire) {
  const out = {
    id: String(wire.id ?? ''),
    from: { node: String(wire.from?.node ?? ''), port: String(wire.from?.port ?? '') },
    to: { node: String(wire.to?.node ?? ''), port: String(wire.to?.port ?? '') },
  };
  if (isObject(wire.config) && Object.keys(wire.config).length) out.config = { ...wire.config };
  return out;
}

/** All three fields or nothing — a half-written canvas is worse than none. */
function normalizeCanvas(canvas) {
  if (!isObject(canvas)) return null;
  const { x, y, zoom } = canvas;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  return { x, y, zoom };
}

/** `n_`/`w_` + 8 base36 chars, re-drawn until it misses `taken` (a Set of ids). */
export function mintId(prefix, taken) {
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let body = '';
    while (body.length < 8) body += Math.random().toString(36).slice(2);
    const id = `${prefix}${body.slice(0, 8)}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now().toString(36).slice(-8)}`;   // unreachable in practice
}

/** @param {'agent'|'task'|'end'|'and'|'or'|'combine'} kind @param {string|null} key */
export function newNode(kind, key, x = 0, y = 0, taken) {
  const node = { id: mintId('n_', taken), kind };
  if (kind === 'agent' && key) node.key = String(key);      // V3: only agent nodes carry a key
  node.x = Number(x) || 0;
  node.y = Number(y) || 0;
  node.config = ARITY_SET.has(kind) ? { arity: 2 } : {};
  return node;
}

export function newWire(from, to, config, taken) {
  const wire = {
    id: mintId('w_', taken),
    from: { node: from.node, port: from.port },
    to: { node: to.node, port: to.port },
  };
  if (isObject(config) && Object.keys(config).length) wire.config = { ...config };
  return wire;
}

/**
 * Drop legality, derived entirely from the template — which is what lets it see
 * or-homogeneity and existing wires at all. Reasons, in check order:
 *   unknown port              — the endpoint does not resolve (V5)
 *   same node                 — an output and an input of the SAME card, UNLESS
 *                               the pair is the self-loop the engine runs: a
 *                               `when:'blocking'` output into a `loop:true`
 *                               input (the seeded refiner `revise → revise`).
 *                               Any other same-card pair is refused here rather
 *                               than left to V10/V11 after the drop. Checked
 *                               after the ports resolve because it reads their
 *                               meta; `V0` is the chip's code, not a validator
 *                               rule.
 *   already connected         — UNIFORM single-wire (V7): ANY wired input rejects,
 *                               agent ports, or `inK`, `end.result` and `await`
 *                               alike. A duplicate (from,to) pair is necessarily a
 *                               second wire into a wired input, so it lands here
 *                               too. Rewiring is remove-then-drop.
 *   <out> → <in> type mismatch — per-wire legality (V8); `any` accepts everything
 *   or inputs must match: <t>  — or homogeneity (V12), mirrored from the resolved
 *                               payload type; an or accepts ANY type until one
 *                               in-wire exists.
 * @returns {{ok:true} | {ok:false, code:string, reason:string}}
 */
export function canWire({ tpl, portsFn, from, to }) {
  const nodes = Array.isArray(tpl?.nodes) ? tpl.nodes : [];
  const byId = new Map(nodes.filter(isObject).map((n) => [n.id, n]));
  const source = byId.get(from?.node);
  const target = byId.get(to?.node);
  const outPort = source ? findPort(portsOf(portsFn, source), from.port, 'out') : null;
  const inPort = target ? findPort(portsOf(portsFn, target), to.port, 'in') : null;
  if (!outPort || !inPort) return deny('V5', 'unknown port');
  const selfLoop = outPort.when === 'blocking' && inPort.loop === true;
  if (source.id === target.id && !selfLoop) return deny('V0', 'same node');
  if (inboundWires(tpl, to.node, to.port).length) return deny('V7', 'already connected');

  const sourceType = outPort.type && outPort.type !== 'any'
    ? outPort.type
    : (source.kind === 'or' ? resolveOrOutType(tpl, portsFn, source.id) : outPort.type ?? null);
  if (inPort.type !== 'any' && sourceType !== null && sourceType !== inPort.type) {
    return deny('V8', `${sourceType} → ${inPort.type} type mismatch`);
  }
  if (target.kind === 'or') {
    const resolved = resolveOrOutType(tpl, portsFn, target.id);
    if (resolved !== null && sourceType !== null && sourceType !== resolved) {
      return deny('V12', `or inputs must match: ${resolved}`);
    }
  }
  return { ok: true };
}

const deny = (code, reason) => ({ ok: false, code, reason });

/** Structural edits — always a NEW template; the input is never mutated. */
export function removeNode(tpl, nodeId) {
  const t = normalizeTemplate(tpl);
  return { ...t, nodes: t.nodes.filter((n) => n.id !== nodeId),
    wires: t.wires.filter((w) => w.from.node !== nodeId && w.to.node !== nodeId) };
}

export function removeWire(tpl, wireId) {
  const t = normalizeTemplate(tpl);
  return { ...t, wires: t.wires.filter((w) => w.id !== wireId) };
}

export function nodeById(tpl, id) {
  return (Array.isArray(tpl?.nodes) ? tpl.nodes : []).find((n) => n?.id === id) || null;
}

export function wireById(tpl, id) {
  return (Array.isArray(tpl?.wires) ? tpl.wires : []).find((w) => w?.id === id) || null;
}
