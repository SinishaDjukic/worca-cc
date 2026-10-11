// src/shared/graph/canvas-ops.mjs
// ONE vocabulary for changing a canvas from outside the pointer pipeline (the Workflows view's chat,
// D12). The composer chat's tools SIMULATE a batch on their working copy (src/core/ask/composer-deps.mjs)
// and the browser applies the SAME RESOLVED batch to the open canvas (graph/composer.mjs applyOps).
// Pure and DOM-free (test/shared-graph-purity.test.mjs).
//
// Ops:
//   {op:'add_node', ref?:'$name', id?, kind, key?, config?, x?, y?, near?:node}
//   {op:'remove_node', node}
//   {op:'connect', id?, from:{node,port}, to:{node,port}, maxCycles?}
//   {op:'disconnect', wire} | {op:'disconnect', from:{node,port}, to:{node,port}}
//   {op:'set_node', node, config:{key: value | null}}
//   {op:'set_wire', wire, maxCycles: n | null}
//   {op:'move_node', node, x, y}
//   {op:'layout', positions?}
// A node reference is a node id (n_…) or a $ref an earlier add_node of the SAME batch named. The result's
// `applied` is the batch RESOLVED — minted ids, x/y, layout positions — so a replay is deterministic.
import { canWire, newNode, newWire, normalizeTemplate } from './template.mjs';
import { autoLayout, RANK_DX } from './layout.mjs';
import { snap, nodeSize, NODE_W, LABEL_H, SNAP } from './geometry.mjs';
import { portsOf } from './ports.mjs';
import { KINDS, KEYED_KINDS, NODE_ID_RE, WIRE_ID_RE, LIMITS } from './constants.mjs';
import { MIN_TIMEOUT_MS, MAX_TIMEOUT_MS } from './script-meta.mjs';

export const CANVAS_OPS = Object.freeze(['add_node', 'remove_node', 'connect', 'disconnect', 'set_node', 'set_wire', 'move_node', 'layout']);
export const MAX_OPS = 40;
export const MAX_BUILD_OPS = 160;
const REF_RE = /^\$[A-Za-z0-9_-]{1,32}$/;
const COL_DX = RANK_DX;      // one layout column
const GAP = 24;              // clear space kept around a placed card (the layout's ROUTE_CLEARANCE band)
const MAX_CYCLES = LIMITS.maxCycles;   // 20 — the same cap assemble.mjs and the run limits use
const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// One line, no control characters (C0, DEL, C1 incl. U+0085, U+2028/U+2029): a setting rides every later [composer
// canvas] block, so a planted line break must never reach the canvas (canvas-summary.mjs flattens it too).
const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 120 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);
const isBool = (v) => typeof v === 'boolean';
const isInt = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;

/** The settings a batch may write, per kind (FACTS-graph "config keys per kind"), with their value checks. */
export const NODE_CONFIG = Object.freeze({
  agent: { model: isStr, effort: isStr, fanOut: isBool, askQuestions: isBool, awaitAll: isBool, subagentModel: isStr, subagentEffort: isStr },
  script: { params: isObj, timeoutMs: isInt(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS), awaitAll: isBool, paramsPort: isBool, ports: isObj },
  task: { planStoreSeed: isBool },
  end: {},
  and: { arity: isInt(2, 8) },
  or: { arity: isInt(2, 8) },
  combine: { arity: isInt(2, 8) },
});

class OpError extends Error {}

/**
 * @param {object} tpl  the canvas (never mutated)
 * @param {Array<object>} ops
 * @param {{portsFn?: Function, maxOps?: number}} [o]
 * @returns {{ok:true, tpl:object, applied:object[], added:string[], removed:string[]} | {ok:false, error:string, index:number}}
 */
export function applyCanvasOps(tpl, ops, { portsFn = null, maxOps = MAX_OPS } = {}) {
  if (!Array.isArray(ops) || !ops.length) return { ok: false, error: 'ops must be a non-empty array', index: -1 };
  if (ops.length > maxOps) return { ok: false, error: `at most ${maxOps} ops in one call`, index: -1 };
  const t = normalizeTemplate(clone(tpl));
  const refs = new Map();
  const applied = [];
  const added = [];
  const removed = [];
  const taken = () => new Set([...t.nodes.map((n) => n.id), ...t.wires.map((w) => w.id)]);
  const nodeOf = (ref, what = 'node') => {
    const id = typeof ref === 'string' && ref.startsWith('$') ? refs.get(ref) : ref;
    const n = typeof id === 'string' ? t.nodes.find((x) => x.id === id) : null;
    if (!n) throw new OpError(`${what} '${ref}' is not on the canvas`);
    return n;
  };
  const endOf = (e, what) => {
    if (!isObj(e) || typeof e.port !== 'string' || !e.port) throw new OpError(`${what} needs {node, port}`);
    return { node: nodeOf(e.node, `${what} node`).id, port: e.port };
  };
  const metaOf = (n) => (typeof portsFn === 'function' ? portsOf(portsFn, n).meta : null) || null;
  function setConfig(n, patch) {
    if (!isObj(patch)) throw new OpError('config must be an object');
    const allowed = NODE_CONFIG[n.kind] || {};
    const meta = metaOf(n);
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.prototype.hasOwnProperty.call(allowed, k)) throw new OpError(`'${k}' is not ${n.kind === 'agent' ? 'an' : 'a'} ${n.kind} setting`);
      if (n.kind === 'agent' && k === 'fanOut' && v !== null && meta && !meta.fanOut) throw new OpError('this agent has no research fan-out');
      if (n.kind === 'agent' && k === 'askQuestions' && v !== null) {
        if (meta && !meta.asksQuestions) throw new OpError('this agent does not ask questions');
        if (meta && meta.questionsLocked) throw new OpError(`Ask questions is locked ${meta.questionsDefault ? 'on' : 'off'} for this agent`);
      }
      if (v === null) { delete n.config[k]; continue; }
      if (!allowed[k](v)) throw new OpError(`bad value for ${k}`);
      n.config[k] = clone(v);
    }
  }
  /** The height a card takes on the open canvas (an edit host: the description footer billed, as layout does). Its
   *  label row (LABEL_H) sits ABOVE n.y and is not in it. */
  const heightOf = (n) => nodeSize(n, portsOf(portsFn, n), { describe: true }).h;
  /** add_node with no x/y: one column right of `near` (or of the right-most card), then straight down past every
   *  card its box would touch — label row included, GAP kept clear — so four adds near one card form a column. */
  function placeFor(o, node) {
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: snap(o.x), y: snap(o.y) };
    let x; let y;
    if (o.near != null) { const n = nodeOf(o.near, 'near'); x = n.x + COL_DX; y = n.y; }
    else if (t.nodes.length) { x = Math.max(...t.nodes.map((n) => Number(n.x) || 0)) + COL_DX; y = 200; }
    else { x = 60; y = 200; }
    x = snap(x); y = snap(y);
    const h = heightOf(node);
    const hits = (n) => x < n.x + NODE_W + GAP && n.x < x + NODE_W + GAP
      && y - LABEL_H < n.y + heightOf(n) + GAP && n.y - LABEL_H < y + h + GAP;
    for (let k = 0; k < 40; k += 1) {
      const hit = t.nodes.find(hits);
      if (!hit) break;
      y = Math.ceil((hit.y + heightOf(hit) + GAP + LABEL_H) / SNAP) * SNAP;   // on the grid, never back up into the gap
    }
    return { x, y };
  }
  let i = 0;
  try {
    for (i = 0; i < ops.length; i += 1) {
      const o = ops[i];
      if (!isObj(o) || !CANVAS_OPS.includes(o.op)) throw new OpError(`unknown op '${isObj(o) ? o.op : o}'`);
      if (o.op === 'add_node') {
        const kind = String(o.kind || '');
        if (!KINDS.includes(kind)) throw new OpError(`kind must be one of ${KINDS.join(', ')}`);
        const keyed = KEYED_KINDS.includes(kind);
        if (keyed && !(typeof o.key === 'string' && o.key)) throw new OpError(`${kind} needs a key`);
        if ((kind === 'task' || kind === 'end') && t.nodes.some((n) => n.kind === kind)) throw new OpError(`the canvas already has its ${kind} node`);
        if (o.ref != null && (typeof o.ref !== 'string' || !REF_RE.test(o.ref) || refs.has(o.ref))) throw new OpError('ref must be a new $name');
        const node = newNode(kind, keyed ? o.key : null, 0, 0, taken());
        if (o.id != null) {
          if (typeof o.id !== 'string' || !NODE_ID_RE.test(o.id) || taken().has(o.id)) throw new OpError(`node id '${o.id}' is taken or invalid`);
          node.id = o.id;
        }
        if (keyed && typeof portsFn === 'function' && !portsOf(portsFn, node).known) throw new OpError(`no ${kind} '${o.key}' in the library`);
        // As the browser's spawn does (graph/composer.mjs): a config-ported script starts from the sidecar's
        // defaultPorts, deep-copied — without them the card has no ports at all, not even `await`. config.ports wins.
        const sm = kind === 'script' && typeof portsFn === 'function' ? portsOf(portsFn, node).meta : null;
        if (sm && sm.ports === 'config' && isObj(sm.defaultPorts)) node.config.ports = clone(sm.defaultPorts);
        if (o.config != null) setConfig(node, o.config);
        const at = placeFor(o, node);
        node.x = at.x; node.y = at.y;
        t.nodes.push(node);
        if (o.ref) refs.set(o.ref, node.id);
        added.push(node.id);
        applied.push({ op: 'add_node', ...(o.ref ? { ref: o.ref } : {}), id: node.id, kind, ...(keyed ? { key: node.key } : {}),
          x: node.x, y: node.y, ...(Object.keys(node.config).length ? { config: clone(node.config) } : {}) });
      } else if (o.op === 'remove_node') {
        const n = nodeOf(o.node);
        t.nodes = t.nodes.filter((x) => x.id !== n.id);
        t.wires = t.wires.filter((w) => w.from.node !== n.id && w.to.node !== n.id);
        removed.push(n.id);
        applied.push({ op: 'remove_node', node: n.id });
      } else if (o.op === 'connect') {
        const from = endOf(o.from, 'from');
        const to = endOf(o.to, 'to');
        const v = canWire({ tpl: t, portsFn, from, to });
        if (!v.ok) throw new OpError(v.reason || v.code || 'cannot connect');
        if (o.maxCycles != null && !isInt(1, MAX_CYCLES)(o.maxCycles)) throw new OpError(`maxCycles must be 1–${MAX_CYCLES}`);
        const wire = newWire(from, to, o.maxCycles != null ? { maxCycles: o.maxCycles } : undefined, taken());
        if (o.id != null) {
          if (typeof o.id !== 'string' || !WIRE_ID_RE.test(o.id) || taken().has(o.id)) throw new OpError(`wire id '${o.id}' is taken or invalid`);
          wire.id = o.id;
        }
        t.wires.push(wire);
        applied.push({ op: 'connect', id: wire.id, from, to, ...(o.maxCycles != null ? { maxCycles: o.maxCycles } : {}) });
      } else if (o.op === 'disconnect') {
        let w = null;
        if (typeof o.wire === 'string') w = t.wires.find((x) => x.id === o.wire) || null;
        else if (isObj(o.from) && isObj(o.to)) {
          const from = endOf(o.from, 'from');
          const to = endOf(o.to, 'to');
          w = t.wires.find((x) => x.from.node === from.node && x.from.port === from.port && x.to.node === to.node && x.to.port === to.port) || null;
        }
        if (!w) throw new OpError('no such wire');
        t.wires = t.wires.filter((x) => x.id !== w.id);
        applied.push({ op: 'disconnect', wire: w.id });
      } else if (o.op === 'set_node') {
        const n = nodeOf(o.node);
        n.config = { ...(n.config || {}) };
        setConfig(n, o.config);
        applied.push({ op: 'set_node', node: n.id, config: clone(o.config) });
      } else if (o.op === 'set_wire') {
        const w = t.wires.find((x) => x.id === o.wire);
        if (!w) throw new OpError(`wire '${o.wire}' is not on the canvas`);
        if (o.maxCycles === null) { if (w.config) { delete w.config.maxCycles; if (!Object.keys(w.config).length) delete w.config; } }
        else if (!isInt(1, MAX_CYCLES)(o.maxCycles)) throw new OpError(`maxCycles must be 1–${MAX_CYCLES}`);
        else w.config = { ...(w.config || {}), maxCycles: o.maxCycles };
        applied.push({ op: 'set_wire', wire: w.id, maxCycles: o.maxCycles === null ? null : o.maxCycles });
      } else if (o.op === 'move_node') {
        const n = nodeOf(o.node);
        if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) throw new OpError('x and y must be numbers');
        n.x = snap(o.x); n.y = snap(o.y);
        applied.push({ op: 'move_node', node: n.id, x: n.x, y: n.y });
      } else {                                            // layout
        // The open canvas is an edit host: lay out with the description footer billed (A3 item 4).
        const pos = isObj(o.positions) ? o.positions : autoLayout(t, portsFn, { describe: true });
        for (const n of t.nodes) { const p = pos[n.id]; if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { n.x = p.x; n.y = p.y; } }
        applied.push({ op: 'layout', positions: clone(Object.fromEntries(t.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))) });
      }
    }
  } catch (err) {
    if (err instanceof OpError) return { ok: false, error: `op ${i + 1} (${isObj(ops[i]) ? ops[i].op : '?'}): ${err.message}`, index: i };
    throw err;
  }
  return { ok: true, tpl: t, applied, added, removed };
}

/** A whole workflow from {nodes:[{ref, kind, key?, config?}], wires:[{from:{node:ref, port}, to:{node:ref, port}, maxCycles?}]}
 *  (refs may omit the leading `$`), laid out. Validation is the caller's. */
export function buildGraph(spec, { portsFn = null } = {}) {
  const nodes = Array.isArray(spec && spec.nodes) ? spec.nodes : [];
  const wires = Array.isArray(spec && spec.wires) ? spec.wires : [];
  if (!nodes.length) return { ok: false, error: 'nodes is required' };
  const ref = (r) => (typeof r === 'string' && r ? (r.startsWith('$') ? r : `$${r}`) : r);
  const end = (e) => (isObj(e) ? { node: ref(e.node), port: e.port } : e);
  const ops = [
    ...nodes.map((n) => ({ op: 'add_node', ref: ref(n && n.ref), kind: n && n.kind, key: n && n.key, ...(n && n.config ? { config: n.config } : {}), x: 0, y: 0 })),
    ...wires.map((w) => ({ op: 'connect', from: end(w && w.from), to: end(w && w.to), ...(w && w.maxCycles != null ? { maxCycles: w.maxCycles } : {}) })),
    { op: 'layout' },
  ];
  const r = applyCanvasOps({ id: '', name: '', version: 2, domain: '', nodes: [], wires: [] }, ops, { portsFn, maxOps: MAX_BUILD_OPS });
  return r.ok ? { ok: true, tpl: r.tpl } : { ok: false, error: r.error };
}

// V10 and V11 name every member of a cycle, and V20 / V21 count the task / End cards: a batch that only SHRINKS a broken
// cycle (removes one of its cards or wires) or removes one of three task cards changes that message and adds nothing.
const CYCLE_MEMBERS = { V10: /^cycle without a blocking-source edge: (.+) \(wires /, V11: /^deadlock: no node in cycle (.+) can start /};
const membersOf = (e) => { const m = CYCLE_MEMBERS[e.code] && CYCLE_MEMBERS[e.code].exec(String(e.message || '')); return m ? m[1].split(', ') : null; };
const COUNT_RE = /^a template must declare exactly one (task|end) node \(found \d+\)$/;

/** The errors `after` has that `before` had not, "to wire" (incomplete) items excluded: what a batch BROKE. A broken
 *  cycle inside one the canvas already had, or a task/End count that was already wrong, is not new. */
export function newRealErrors(before, after) {
  const key = (e) => `${e.code}|${e.message}`;
  const old = (before && before.errors) || [];
  const had = new Set(old.map(key));
  return ((after && after.errors) || []).filter((e) => {
    if (e.incomplete || had.has(key(e))) return false;
    if (COUNT_RE.test(e.message)) return !old.some((o) => o.code === e.code && COUNT_RE.test(o.message));
    const m = membersOf(e);
    return !(m && old.some((o) => o.code === e.code && (membersOf(o) || []).length && m.every((id) => membersOf(o).includes(id))));
  });
}
