// src/shared/graph/sessions.mjs
// The ONE session derivation (spec §4, 05 §1.8): which agent cards share a session, the closure (members plus the
// AND/OR/Combine cards that ride inside it), and the wires that enter, leave or stay inside it. The validator, every
// canvas host and the runtime read THIS; nothing keeps a second copy. Pure (browser + Node) and crash-free: a bad
// template is the validator's to report, so this filters and never throws.
import { classifyLoops } from './loops.mjs';
import { SESSION_ID_RE, SESSION_MODES } from './constants.mjs';

export const SESSION_DEFAULT_LABEL = 'One session';
const FLOW_IN_CLOSURE = new Set(['and', 'or', 'combine']);   // task and end never ride inside a session
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** A card's session id: its `config.session` string, on any kind (V25 judges the kind and the shape); else null. */
export function sessionIdOf(node) {
  return isObj(node) && isObj(node.config) && typeof node.config.session === 'string' ? node.config.session : null;
}

/** Step order: the launch order (loops.mjs) with the loop wires set aside. Inside one loop component launchOrder is
 *  alphabetical by node id — a review loop joins Implementation and Review into one component — so members would
 *  read in id order, and composer ids are random. Kahn over the non-loop wires; ties, and any card left on a cycle
 *  (V10's error), go by launch order. */
function stepOrder(ids, next, launchOrder) {
  const launch = new Map(launchOrder.map((id, i) => [id, i]));
  const at = (id) => (launch.has(id) ? launch.get(id) : launch.size);
  const before = (a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0);
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const tos of next.values()) for (const b of tos) indegree.set(b, indegree.get(b) + 1);
  const rank = new Map();
  const left = new Set(ids);
  for (;;) {
    let pick = null;
    for (const id of left) if (indegree.get(id) === 0 && (pick === null || before(id, pick) < 0)) pick = id;
    if (pick === null) break;
    left.delete(pick);
    rank.set(pick, rank.size);
    for (const b of next.get(pick)) indegree.set(b, indegree.get(b) - 1);
  }
  for (const id of [...left].sort(before)) rank.set(id, rank.size);
  return rank;
}

/** Everything the derivation walks, built once per call. `loops` is a classifyLoops result a caller already has. */
function sessionGraph(tpl, portsFn, loops = null) {
  const byId = new Map();
  for (const n of Array.isArray(tpl?.nodes) ? tpl.nodes : []) {
    if (isObj(n) && typeof n.id === 'string' && !byId.has(n.id)) byId.set(n.id, n);
  }
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : [])
    .filter((w) => isObj(w) && byId.has(w.from?.node) && byId.has(w.to?.node));
  const cl = loops || classifyLoops(tpl, portsFn);
  // L (04 §2.1): the blocking-source loop wires plus every wire into a `loop:true` input. The scheduler treats both as
  // loop inputs, so neither may hold a session together, split it, or order its steps.
  const loopSet = new Set(cl.loopWireIds);
  for (const w of wires) if (cl.loopInputs.has(`${w.to.node}.${w.to.port}`)) loopSet.add(w.id);
  const ids = [...byId.keys()];
  const touching = new Map(ids.map((id) => [id, []]));
  const next = new Map(ids.map((id) => [id, new Set()]));   // non-loop successors
  const prev = new Map(ids.map((id) => [id, new Set()]));   // non-loop predecessors
  for (const w of wires) {
    touching.get(w.from.node).push(w);
    if (w.to.node !== w.from.node) touching.get(w.to.node).push(w);
    if (!loopSet.has(w.id) && w.from.node !== w.to.node) { next.get(w.from.node).add(w.to.node); prev.get(w.to.node).add(w.from.node); }
  }
  const rank = stepOrder(ids, next, cl.launchOrder);
  return { byId, wires, loopSet, touching, next, prev, rank, byRank: (a, b) => rank.get(a) - rank.get(b) };
}

/** The closure's flow cards (pinned): start from every and/or/combine card; drop, until stable, any card with a wire
 *  to or from a card outside members ∪ F; then keep only the cards reachable from a member over wires whose both
 *  ends stay in members ∪ F (either direction). */
function closureFlows(g, members) {
  const F = new Set([...g.byId.values()].filter((n) => FLOW_IN_CLOSURE.has(n.kind)).map((n) => n.id));
  const other = (w, id) => (w.from.node === id ? w.to.node : w.from.node);
  for (let changed = true; changed;) {
    changed = false;
    for (const f of F) {
      if (g.touching.get(f).some((w) => { const o = other(w, f); return !members.has(o) && !F.has(o); })) { F.delete(f); changed = true; }
    }
  }
  const seen = new Set(members);
  const todo = [...members];
  while (todo.length) {
    const id = todo.pop();
    for (const w of g.touching.get(id) || []) {
      const o = other(w, id);
      if ((members.has(o) || F.has(o)) && !seen.has(o)) { seen.add(o); todo.push(o); }
    }
  }
  return [...F].filter((f) => seen.has(f)).sort(g.byRank);
}

function settingsOf(raw) {
  const s = isObj(raw) ? raw : {};
  return {
    label: text(s.label) || SESSION_DEFAULT_LABEL,
    mode: SESSION_MODES.includes(s.mode) ? s.mode : 'subagents',
    hostModel: text(s.hostModel),
    hostEffort: text(s.hostEffort),
  };
}

/** One SessionSpec for `memberIds` (cards not on the canvas are ignored). Also the prospective spec consecutiveIssue
 *  judges (sid null). */
function specFor(g, sid, memberIds, raw) {
  const members = [...new Set(memberIds)].filter((id) => g.byId.has(id)).sort(g.byRank);
  const flows = closureFlows(g, new Set(members));
  const inC = new Set([...members, ...flows]);
  const spec = { sid, members, closure: [...inC].sort(g.byRank), flows,
    internalWires: [], entryWires: [], exitWires: [], crossingLoops: [], settings: settingsOf(raw) };
  for (const w of g.wires) {
    const a = inC.has(w.from.node);
    const b = inC.has(w.to.node);
    if (a && b) spec.internalWires.push(w.id);
    else if (b) spec.entryWires.push(w.id);
    else if (a) spec.exitWires.push(w.id);
    if (a !== b && g.loopSet.has(w.id)) spec.crossingLoops.push(w.id);
  }
  return spec;
}

/** L: the loop wires a session reads (04 §2.1). */
export function loopWireSet(tpl, portsFn, { loops = null } = {}) {
  return sessionGraph(tpl, portsFn, loops).loopSet;
}

/** Every session, ordered by its first member in step order. A session exists for every well-formed sid at least one
 *  AGENT card names; a malformed id, or one only non-agents carry, is V25's to report and forms none. */
export function sessionsOf(tpl, portsFn, { loops = null } = {}) {
  const bySid = new Map();
  for (const n of Array.isArray(tpl?.nodes) ? tpl.nodes : []) {
    const sid = isObj(n) && n.kind === 'agent' && typeof n.id === 'string' ? sessionIdOf(n) : null;
    if (sid === null || !SESSION_ID_RE.test(sid)) continue;
    if (!bySid.has(sid)) bySid.set(sid, []);
    bySid.get(sid).push(n.id);
  }
  if (!bySid.size) return [];                          // the ungrouped path: no loop walk, nothing allocated
  const g = sessionGraph(tpl, portsFn, loops);
  const settings = isObj(tpl?.sessions) ? tpl.sessions : {};
  return [...bySid].map(([sid, ids]) => specFor(g, sid, ids, Object.hasOwn(settings, sid) ? settings[sid] : null))
    .filter((s) => s.members.length)
    .sort((a, b) => g.byRank(a.members[0], b.members[0]));
}

/** The runtime's name for it (Task 44 resolves sessions once, in _sessionGate). */
export const resolveSessions = sessionsOf;
