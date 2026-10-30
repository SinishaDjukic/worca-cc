// src/shared/graph/sessions.mjs
// The ONE session derivation (spec §4, 05 §1.8): which agent cards share a session, the closure (members plus the
// AND/OR/Combine cards that ride inside it), and the wires that enter, leave or stay inside it. The validator, every
// canvas host and the runtime read THIS; nothing keeps a second copy. Pure (browser + Node) and crash-free: a bad
// template is the validator's to report, so this filters and never throws.
import { classifyLoops } from './loops.mjs';
import { portsOf } from './ports.mjs';
import { SESSION_ID_RE, SESSION_MODES, MAX_SESSION_MEMBERS, SESSION_MIN_MEMBERS } from './constants.mjs';
import { mintId, normalizeSessions } from './template.mjs';
import { LABEL_H } from './geometry.mjs';
import { ENGINES, engineLabel, sessionSupport, SESSION_SUBAGENTS_VERIFIED } from '../engine-switch.mjs';

export const SESSION_DEFAULT_LABEL = 'One session';
/** "One conversation" (mode `shared`) is offered but not selectable until its runtime exists (Task 65). Task 66 flips
 *  this one switch, which the toolbar's How menu and the inspector's segment both read. */
export const SESSION_SHARED_SELECTABLE = false;
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

// ── Legality (04 §2.1, 05 §3.2): the toolbar menu, ⌘G, the inspector and chat ops all ask THESE ──

/** "Consecutive", connectivity FIRST (a gap a deleted middle member leaves reads "not wired together", never "runs
 *  between"), then convexity: no path leaves the closure and comes back through an outside card. */
export function consecutiveIssue(tpl, portsFn, members, { loops = null } = {}) {
  const g = sessionGraph(tpl, portsFn, loops);
  const spec = specFor(g, null, Array.isArray(members) ? members : [], null);
  if (spec.members.length < SESSION_MIN_MEMBERS) return null;
  const inC = new Set(spec.closure);
  const reached = new Set([spec.members[0]]);
  const todo = [spec.members[0]];
  while (todo.length) {
    const id = todo.pop();
    for (const o of [...g.next.get(id), ...g.prev.get(id)]) if (inC.has(o) && !reached.has(o)) { reached.add(o); todo.push(o); }
  }
  const apart = spec.members.find((m) => !reached.has(m));
  if (apart) return { kind: 'disconnected', a: spec.members[0], b: apart };
  // Outside cards reached from `starts`, walking only outside cards; `hits` collects the closure cards run into.
  const walk = (starts, step, hits = null) => {
    const seen = new Set();
    const stack = [...starts];
    while (stack.length) {
      for (const o of step.get(stack.pop()) || []) {
        if (inC.has(o)) { if (hits) hits.add(o); continue; }
        if (!seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    return seen;
  };
  const out = walk(spec.closure, g.next);
  const back = walk(spec.closure, g.prev);
  const via = [...out].filter((id) => back.has(id)).sort(g.byRank)[0];
  if (via === undefined) return null;
  const entered = new Set();
  walk([via], g.next, entered);
  return { kind: 'between', via, a: spec.closure.find((c) => walk([c], g.next).has(via)), b: spec.closure.find((c) => entered.has(c)) };
}

/** May `ids` form a session? `ids` is the whole prospective set; it may extend one existing session, never two. */
export function sessionLegal(tpl, portsFn, ids, { labelOf = (id) => id, loops = null } = {}) {
  const byId = new Map((Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter((n) => isObj(n) && typeof n.id === 'string').map((n) => [n.id, n]));
  const want = [...new Set(Array.isArray(ids) ? ids : [])];
  for (const id of want) {
    const n = byId.get(id);
    if (!n) return { ok: false, code: 'V25', reason: 'not on the canvas' };
    if (n.kind === 'script') return { ok: false, code: 'V25', reason: 'a script runs on its own' };
    if (n.kind !== 'agent') return { ok: false, code: 'V25', reason: 'flow cards ride along, they are never steps' };
  }
  // Membership (05 §3.2 rule 2): the ids may extend ONE existing session; a card in a different one never moves.
  const sids = new Set(want.map((id) => sessionIdOf(byId.get(id))).filter((sid) => sid !== null && SESSION_ID_RE.test(sid)));
  if (sids.size > 1) return { ok: false, code: 'V25', reason: 'in another session' };
  if (want.length > MAX_SESSION_MEMBERS) return { ok: false, code: 'V26', reason: `${MAX_SESSION_MEMBERS} steps max` };
  if (want.length < SESSION_MIN_MEMBERS) return { ok: false, code: 'V26', reason: `a session needs ${SESSION_MIN_MEMBERS} steps` };
  const issue = consecutiveIssue(tpl, portsFn, want, { loops });
  if (!issue) return { ok: true };
  return { ok: false, code: 'V27', reason: issue.kind === 'disconnected'
    ? `${labelOf(issue.a)} and ${labelOf(issue.b)} aren't wired together`
    : `${labelOf(issue.via)} runs between ${labelOf(issue.a)} and ${labelOf(issue.b)}` };
}

/** The agents that may join session `sid` (or pair with card `nodeId`; a member asks for its own session). */
export function sessionCandidates(tpl, portsFn, { sid = null, nodeId = null, labelOf = (id) => id } = {}) {
  const loops = classifyLoops(tpl, portsFn);
  const g = sessionGraph(tpl, portsFn, loops);
  const sidOf = (id) => { const s = sessionIdOf(g.byId.get(id)); return s !== null && SESSION_ID_RE.test(s) ? s : null; };
  const isAgent = (id) => g.byId.get(id)?.kind === 'agent';
  const own = sid || (isAgent(nodeId) ? sidOf(nodeId) : null);
  const base = own ? [...g.byId.keys()].filter((id) => isAgent(id) && sidOf(id) === own) : (isAgent(nodeId) ? [nodeId] : []);
  if (!base.length) return [];
  const reach = (step) => {                      // agents joined over non-loop wires, through and/or/combine cards only
    const found = new Set();
    const seen = new Set(base);
    const todo = [...base];
    while (todo.length) {
      for (const o of step.get(todo.pop()) || []) {
        if (seen.has(o)) continue;
        seen.add(o);
        if (isAgent(o)) found.add(o);
        else if (FLOW_IN_CLOSURE.has(g.byId.get(o)?.kind)) todo.push(o);
      }
    }
    return found;
  };
  const skip = (id) => base.includes(id) || (own !== null && sidOf(id) === own);
  const nexts = [...reach(g.next)].filter((id) => !skip(id)).sort(g.byRank);
  const prevs = [...reach(g.prev)].filter((id) => !skip(id) && !nexts.includes(id)).sort(g.byRank);
  const entry = (id, side) => {
    const other = sidOf(id);
    if (other !== null && other !== own) return { nodeId: id, side, ok: false, reason: 'in another session' };
    if (base.length + 1 > MAX_SESSION_MEMBERS) return { nodeId: id, side, ok: false, reason: `${MAX_SESSION_MEMBERS} steps max` };
    const legal = sessionLegal(tpl, portsFn, [...base, id], { labelOf, loops });
    return legal.ok ? { nodeId: id, side, ok: true } : { nodeId: id, side, ok: false, reason: legal.reason };
  };
  return [...nexts.map((id) => entry(id, 'next')), ...prevs.map((id) => entry(id, 'previous'))];
}

/** Drop lone memberships and orphan settings (05 §1.7). Pure: a new template; contiguity is never repaired (V27). */
export function pruneSessions(tpl) {
  const t = isObj(tpl) ? { ...tpl } : {};
  const nodes = Array.isArray(t.nodes) ? t.nodes : [];
  const agentSid = (n) => (isObj(n) && n.kind === 'agent' ? sessionIdOf(n) : null);
  const count = new Map();
  for (const n of nodes) { const s = agentSid(n); if (s !== null) count.set(s, (count.get(s) || 0) + 1); }
  t.nodes = nodes.map((n) => {
    const s = agentSid(n);
    if (s === null || count.get(s) > 1) return n;
    const config = { ...n.config };
    delete config.session;
    return { ...n, config };
  });
  if (Object.hasOwn(t, 'sessions')) {
    const kept = normalizeSessions(t.sessions, t.nodes);
    if (kept) t.sessions = kept; else delete t.sessions;
  }
  return t;
}

/** Paste, duplicate and build_workflow: every distinct session id gets ONE fresh minted id, kept by all its cards, so
 *  a copy never silently joins the session it came from. */
export function remintSessions(nodes, taken) {
  const used = new Set(taken instanceof Set ? taken : Array.isArray(taken) ? taken : []);
  const fresh = new Map();
  return (Array.isArray(nodes) ? nodes : []).map((n) => {
    const s = sessionIdOf(n);
    if (s === null) return n;
    if (!fresh.has(s)) { const id = mintId('s_', used); used.add(id); fresh.set(s, id); }
    return { ...n, config: { ...n.config, session: fresh.get(s) } };
  });
}

/** The inspector's notes (05 §2.2): what the pure validator cannot know — the engine, the gate, the catalog. Honest
 *  by construction: nothing about the main agent unless the steps really run as its sub-agents. */
export function sessionNotes(spec, { engine = 'claude', verified = SESSION_SUBAGENTS_VERIFIED, members = [], labelOf = (id) => id } = {}) {
  const notes = [];
  const e = engine || 'claude';
  const name = engineLabel(e);
  const s = isObj(spec?.settings) ? spec.settings : {};
  const mode = s.mode === 'shared' ? 'shared' : 'subagents';
  const live = mode === 'subagents' && sessionSupport(e, { verified }).subagents;
  const info = new Map((Array.isArray(members) ? members : []).filter(isObj).map((m) => [m.nodeId, m]));
  const steps = (Array.isArray(spec?.members) ? spec.members : []).map((id) => {
    const m = info.get(id) || {};
    return { ...m, label: m.label || labelOf(id) };
  });
  const add = (level, code, text) => notes.push({ level, code, text });
  if (mode === 'subagents' && Object.hasOwn(ENGINES, e) && ENGINES[e].subagents === false) {
    add('info', 'engine-none', `${name} has no sub-agents: these steps run as separate sessions there.`);
  } else if (mode === 'subagents' && !live) {
    add('info', 'gate-off', `Sub-agents are not available on ${name} yet: these steps run as separate sessions.`);
  }
  if (live && steps.some((m) => m.fanOut)) add('info', 'fanout-nested', `Research fan-out runs as nested sub-agents. ${name} may refuse past its nesting limit.`);
  for (const m of steps) {
    if (live && m.routed) add('warn', 'routed-model', `${m.label}'s model runs on a custom endpoint. When the steps use different endpoints, they run as separate sessions.`);
    if ((live || mode === 'shared') && m.asks) add('info', 'asks', `${m.label} asks you questions: the session waits for your answers.`);
    if (live && s.hostModel && !m.model) add('info', 'inherits-host-model', `${m.label} has no model of its own, so it runs on the main agent's model (${s.hostModel}).`);
    if (live && s.hostEffort && !m.effort) add('info', 'inherits-host-model', `${m.label} has no effort of its own, so it runs at the main agent's effort (${s.hostEffort}).`);
  }
  if (mode === 'shared' && (s.hostModel || s.hostEffort)) add('warn', 'shared-ignores', 'One conversation has no main agent: the main-agent model and effort are not used.');
  return notes;
}

/** The run-start sheet's notices (Task 62; 05 §6.6): one line per session of `tpl`, saying how its steps will run on
 *  `engine`, by the rules chooseSessionMode (src/core/session-mode.mjs) decides with, as far as the page knows them: the
 *  Labs flag (`flagOn`, read by the caller), whether One conversation runs yet (`sharedReady`; Task 66 flips
 *  SESSION_SHARED_SELECTABLE when Task 65 builds its runtime), the engine and its sub-agents gate (`verified`; a mock run
 *  counts as verified, C13). The CLI version, the model endpoints and the kill switch are the server's to know: the run
 *  log and the tray say those. Information, never a warning. */
export function sessionStartNotices(tpl, portsFn, { engine = 'claude', verified = SESSION_SUBAGENTS_VERIFIED, labelOf = (id) => id, flagOn = true,
  sharedReady = SESSION_SHARED_SELECTABLE } = {}) {
  const e = engine || 'claude';
  const name = engineLabel(e);
  const out = [];
  for (const spec of sessionsOf(tpl, portsFn)) {
    if (spec.members.length < SESSION_MIN_MEMBERS) continue;            // V26's to report; it runs as its one step
    const names = spec.members.map((id) => labelOf(id) || id);
    const both = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const separate = (why) => out.push(`${why}: ${both} run as separate sessions.`);
    const outside = outsideNote(tpl, portsFn, spec.members, labelOf);   // only after a line that shares the session
    if (!flagOn) separate('One session is off in Settings › Labs');
    else if (spec.settings.mode === 'shared') {
      if (sharedReady) out.push(`${both} share one conversation.${outside}`);
      else separate('One conversation is not available yet');
    } else if (Object.hasOwn(ENGINES, e) && ENGINES[e].subagents === false) separate(`${name} has no sub-agents`);
    else if (!sessionSupport(e, { verified }).subagents) separate(`Sub-agents are not available on ${name} yet`);
    else out.push(`${names.length} steps share one session (${names.join(' + ')}).${outside}`);
  }
  return out;
}

/** The members whose work leaves the host (D2; V29's test): a wired ×N input runs its tasks one session each, a role
 *  review its reviews. `' Implementation's ×N tasks run outside the session.'` per such member, '' for none. */
function outsideNote(tpl, portsFn, members, labelOf) {
  const byId = new Map();
  for (const n of Array.isArray(tpl?.nodes) ? tpl.nodes : []) if (isObj(n) && typeof n.id === 'string' && !byId.has(n.id)) byId.set(n.id, n);
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : []).filter((w) => isObj(w) && byId.has(w.from?.node));
  const wired = (id, port) => wires.some((w) => w.to?.node === id && w.to?.port === port);
  let note = '';
  for (const id of members) {
    const n = byId.get(id);
    const name = labelOf(id) || id;
    if (n && isObj(n.config) && n.config.roleReview === true) note += ` ${name}'s role reviews run outside the session.`;
    else if (n && portsOf(portsFn, n).inputs.some((p) => p?.expands === true && wired(id, p.id))) note += ` ${name}'s ×N tasks run outside the session.`;
  }
  return note;
}

/** A sub-agent record that is a session MEMBER's own dispatch, not a research investigator: its type carries the
 *  `worca-x-` prefix agentTypeFor mints (Task 31), or it says memberOf. Sub-agent cost totals skip these (C8). */
export function isMemberDispatch(rec) {
  return rec?.memberOf != null || /^worca-x-/.test(String(rec?.subagentType || ''));
}

// ── Tray geometry (05 §4.2): from the model's x/y and the host's sizeOf alone; nothing is measured ──

export const SESS_PAD_X = 12;      // tray side padding past the outermost box
export const SESS_PAD_B = 12;      // tray padding below the lowest box
export const SESS_HEAD_H = 24;     // the header strip
export const SESS_HEAD_GAP = 4;    // between the strip and the label rows below it
export const SESS_GUTTER = 8;      // the least gap between two trays side by side
export const SESS_PAD_MIN = 4;     // a clamped side never comes closer to its boxes than this

const sc = (scale) => (Number(scale) > 0 ? Number(scale) : 1);
const membersOn = (spec, nodesById) => (Array.isArray(spec?.members) ? spec.members : []).map((id) => nodesById.get(id)).filter(Boolean);

/** The header strip of every session, model x/y only (step 1): the router's obstacles. A session none of whose
 *  members is on the canvas has none. */
export function sessionHeads(specs, nodesById, sizeOf, { scale = 1 } = {}) {
  const s = sc(scale);
  const out = [];
  for (const spec of Array.isArray(specs) ? specs : []) {
    const ms = membersOn(spec, nodesById);
    if (!ms.length) continue;
    const x = Math.min(...ms.map((n) => Number(n.x) || 0)) - SESS_PAD_X * s;
    const r = Math.max(...ms.map((n) => (Number(n.x) || 0) + sizeOf(n).w)) + SESS_PAD_X * s;
    const b = Math.min(...ms.map((n) => (Number(n.y) || 0) - LABEL_H * s)) - SESS_HEAD_GAP * s;
    out.push({ id: spec.sid, x, y: b - SESS_HEAD_H * s, w: r - x, h: SESS_HEAD_H * s });
  }
  return out;
}

/** Tray rectangles (steps 2-4). `routes` is the router's Map<wireId, {pts, mid}>; only each session's internal
 *  wires are read. `head` is the painted strip: the head's y, the tray's x and width (null with `header: false`). */
export function sessionRects(specs, nodesById, sizeOf, routes, { scale = 1, header = true } = {}) {
  const s = sc(scale);
  const heads = header ? new Map(sessionHeads(specs, nodesById, sizeOf, { scale: s }).map((h) => [h.id, h])) : new Map();
  const trays = [];
  for (const spec of Array.isArray(specs) ? specs : []) {
    const ms = membersOn(spec, nodesById);
    if (!ms.length) continue;
    const boxes = [...ms, ...(Array.isArray(spec.flows) ? spec.flows : []).map((id) => nodesById.get(id)).filter(Boolean)];
    const c = { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity };
    const take = (x, y, r = x, b = y) => { c.x = Math.min(c.x, x); c.y = Math.min(c.y, y); c.r = Math.max(c.r, r); c.b = Math.max(c.b, b); };
    for (const n of boxes) {
      const { w, h } = sizeOf(n);
      const x = Number(n.x) || 0; const y = Number(n.y) || 0;
      take(x, y - LABEL_H * s, x + w, y + h);
    }
    for (const wid of Array.isArray(spec.internalWires) ? spec.internalWires : []) {
      const rt = routes instanceof Map ? routes.get(wid) : null;
      if (!rt) continue;
      for (const p of Array.isArray(rt.pts) ? rt.pts : []) take(p.x, p.y);
      if (rt.mid) take(rt.mid.x, rt.mid.y, rt.mid.x, rt.mid.y + 12 * s);
    }
    const head = heads.get(spec.sid) || null;
    const y = head ? Math.min(head.y, c.y - 8 * s) : c.y - 8 * s;
    trays.push({ sid: spec.sid, x: c.x - SESS_PAD_X * s, r: c.r + SESS_PAD_X * s, y, b: c.b + SESS_PAD_B * s, head, content: c });
  }
  // Step 4: side-by-side trays share the gap between their boxes, GUTTER apart; a side keeps PAD_MIN to its boxes.
  const order = [...trays].sort((p, q) => p.content.x - q.content.x || (p.sid < q.sid ? -1 : p.sid > q.sid ? 1 : 0));
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      const A = order[i]; const B = order[j];
      // Only trays whose boxes sit side by side: stacked rows (contents overlapping in x) keep their pads.
      if (!(A.y < B.b && B.y < A.b) || B.content.x < A.content.r || !(A.r + SESS_GUTTER * s > B.x)) continue;
      const m = (A.content.r + B.content.x) / 2;
      A.r = Math.max(m - (SESS_GUTTER * s) / 2, A.content.r + SESS_PAD_MIN * s);
      B.x = Math.min(m + (SESS_GUTTER * s) / 2, B.content.x - SESS_PAD_MIN * s);
    }
  }
  const out = new Map();
  for (const t of trays) {
    out.set(t.sid, { x: t.x, y: t.y, w: t.r - t.x, h: t.b - t.y,
      head: t.head ? { x: t.x, y: t.head.y, w: t.r - t.x, h: t.head.h } : null, content: t.content });
  }
  return out;
}

/** Flow hosts (chat proposals and builds): one headerless tray segment per (session, flow row), from flowLayout's
 *  `{ pos, rows, cardW, scale }`. `open` names the side where the session continues on another row. */
export function sessionRowSegments(specs, lay) {
  const s = sc(lay?.scale);
  const pos = isObj(lay?.pos) ? lay.pos : {};
  const rows = Array.isArray(lay?.rows) ? lay.rows : [];
  const cardW = Number(lay?.cardW) || 0;
  const out = [];
  for (const spec of Array.isArray(specs) ? specs : []) {
    const ids = [...(Array.isArray(spec?.members) ? spec.members : []), ...(Array.isArray(spec?.flows) ? spec.flows : [])]
      .filter((id) => Object.hasOwn(pos, id));
    const byRow = new Map();
    for (const id of ids) { const r = pos[id].r; if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(pos[id]); }
    const order = [...byRow.keys()].filter((r) => rows[r]).sort((a, b) => a - b);
    order.forEach((r, i) => {
      const ps = byRow.get(r);
      const x = Math.min(...ps.map((p) => p.x)) - SESS_PAD_X * s;
      const w = Math.max(...ps.map((p) => p.x)) + cardW + SESS_PAD_X * s - x;
      const more = i < order.length - 1; const was = i > 0;
      out.push({ sid: spec.sid, row: r, x, y: rows[r].top - LABEL_H * s - 8 * s, w,
        h: rows[r].h + LABEL_H * s + 8 * s + SESS_PAD_B * s, open: more && was ? 'both' : more ? 'right' : was ? 'left' : null });
    });
  }
  return out;
}
