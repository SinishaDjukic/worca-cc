// The shape DSL (auto-workflow spec §4.1) and the deterministic assembler that
// turns a shape into a VALID v2 template (§4.2). Pure and browser-safe: the
// only inputs are the shape, an agent registry slice (key -> meta) and a
// portsFn. No agent key is special here — every decision reads port META
// (type / when / loop / required / expands) or `runnerType`.
import { TEMPLATE_VERSION, DEFAULT_MAX_CYCLES } from './constants.mjs';
import { portsFnFor, portsOf } from './ports.mjs';
import { autoLayout } from './layout.mjs';
import { validateGraph } from './validate.mjs';

export class ShapeError extends Error {
  constructor(issues) {
    const list = Array.isArray(issues) && issues.length ? issues : [{ code: 'SHAPE_INVALID', message: 'invalid shape' }];
    super(`invalid workflow shape: ${list.map((i) => i.message).join('; ')}`);
    this.name = 'ShapeError';
    this.code = 'SHAPE_INVALID';
    this.issues = list;
  }
}

export const TASK_KINDS = Object.freeze(['prompt', 'plan-partial', 'plan-complete-detailed', 'plan-complete-small']);
export const STAGE_TUNABLES = Object.freeze(['model', 'effort', 'fanOut', 'askQuestions']);
export const SHAPE_LIMITS = Object.freeze({ maxStages: 24, maxGroupMembers: 8, maxNameLen: 60, maxReasoningLen: 500, maxCycles: 20 });

const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// Model output and plugin-authored text are UNTRUSTED and end up in a terminal
// (the CLI proposal), a system prompt (agent cards) and a workflow row name:
// ANSI CSI sequences (ESC [ … m), C0/C1 controls and Unicode format characters
// (bidi overrides, zero-width joiners, the BOM) are stripped; line breaks and runs
// of whitespace collapse to one space.
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;

/** Printable, single-line, whitespace-collapsed, capped at `max` characters. */
export function cleanText(v, max) {
  const s = String(v ?? '').replace(ANSI_RE, '').replace(/\s+/g, ' ').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
  return Number.isFinite(max) ? s.slice(0, max) : s;
}

function cycles(v, issues, where) {
  if (v === undefined || v === null || v === true) return DEFAULT_MAX_CYCLES;
  const n = isObject(v) ? v.maxCycles : v;
  if (n === undefined || n === null) return DEFAULT_MAX_CYCLES;
  const int = Math.floor(Number(n));
  if (!Number.isFinite(int) || int < 1 || int > SHAPE_LIMITS.maxCycles) {
    issues.push({ code: 'BAD_CYCLES', message: `${where}: maxCycles must be an integer 1..${SHAPE_LIMITS.maxCycles}` });
    return DEFAULT_MAX_CYCLES;
  }
  return int;
}

/** The per-stage tunables. A RAW stage carries them at the top level; an
 *  already-normalized stage carries them under `tunables` — read both, so
 *  normalizeShape(normalizeShape(x)) === normalizeShape(x) (the classifier returns
 *  a normalized shape and assembleShape normalizes again). */
function tunablesOf(raw) {
  const src = { ...(isObject(raw.tunables) ? raw.tunables : {}), ...raw };
  const out = {};
  // Model/effort ids are model-authored too: cleaned + capped (they land in messages).
  if (typeof src.model === 'string' && cleanText(src.model, 80)) out.model = cleanText(src.model, 80);
  if (typeof src.effort === 'string' && cleanText(src.effort, 20)) out.effort = cleanText(src.effort, 20);
  if (typeof src.fanOut === 'boolean') out.fanOut = src.fanOut;
  if (typeof src.askQuestions === 'boolean') out.askQuestions = src.askQuestions;
  return out;
}

/**
 * Canonicalize a raw shape. Throws ShapeError with EVERY issue found (not just
 * the first) so a classifier retry can fix them all in one round. Idempotent.
 * @returns {{name:string, taskKind:string, reasoning:string, stages:Array, loops:Array}}
 */
export function normalizeShape(raw) {
  const issues = [];
  const r = isObject(raw) ? raw : {};
  const name = cleanText(r.name, SHAPE_LIMITS.maxNameLen) || 'Auto workflow';
  const taskKind = TASK_KINDS.includes(r.taskKind) ? r.taskKind : 'prompt';
  const reasoning = cleanText(r.reasoning, SHAPE_LIMITS.maxReasoningLen);
  const rawStages = Array.isArray(r.stages) ? r.stages : [];
  if (!rawStages.length) issues.push({ code: 'NO_STAGES', message: 'stages must be a non-empty array' });
  if (rawStages.length > SHAPE_LIMITS.maxStages) issues.push({ code: 'TOO_MANY_STAGES', message: `at most ${SHAPE_LIMITS.maxStages} stages` });

  const ids = new Set();
  const idOf = (given, fallback, where) => {
    // Stage ids are model-authored: clean them (they land in ShapeError messages that
    // the terminal and the pause card print) and cap them.
    const cleaned = typeof given === 'string' ? cleanText(given, 40) : '';
    let id = cleaned || fallback;
    if (ids.has(id)) { issues.push({ code: 'DUP_STAGE_ID', message: `${where}: duplicate stage id "${id}"` }); id = `${fallback}_dup`; }
    ids.add(id);
    return id;
  };
  const stageOf = (entry, fallbackId, where) => {
    if (!isObject(entry)) { issues.push({ code: 'BAD_STAGE', message: `${where}: a stage must be an object` }); return null; }
    if (Array.isArray(entry.parallel)) { issues.push({ code: 'NESTED_GROUP', message: `${where}: parallel groups cannot nest` }); return null; }
    const agent = typeof entry.agent === 'string' ? entry.agent.trim() : '';
    if (!AGENT_KEY_RE.test(agent)) { issues.push({ code: 'BAD_AGENT', message: `${where}: "agent" must be an agent key`, stageId: fallbackId }); return null; }
    const id = idOf(entry.id, fallbackId, where);
    const stage = { id, agent, tunables: tunablesOf(entry), selfLoop: null, loop: entry.loop !== false };
    if (entry.selfLoop !== undefined && entry.selfLoop !== null && entry.selfLoop !== false) {
      stage.selfLoop = { maxCycles: cycles(entry.selfLoop, issues, `${where}.selfLoop`) };
    }
    return stage;
  };

  const stages = [];
  rawStages.forEach((entry, i) => {
    const n = i + 1;
    if (isObject(entry) && Array.isArray(entry.parallel)) {
      const members = [];
      entry.parallel.forEach((m, j) => {
        const s = stageOf(m, `s${n}${String.fromCharCode(97 + j)}`, `stages[${i}].parallel[${j}]`);
        if (s) members.push(s);
      });
      if (entry.parallel.length > SHAPE_LIMITS.maxGroupMembers) issues.push({ code: 'GROUP_TOO_LARGE', message: `stages[${i}]: at most ${SHAPE_LIMITS.maxGroupMembers} parallel members` });
      if (members.length < 2) issues.push({ code: 'GROUP_TOO_SMALL', message: `stages[${i}]: a parallel group needs at least 2 members` });
      stages.push({ id: idOf(entry.id, `s${n}`, `stages[${i}]`), parallel: members });
      return;
    }
    const s = stageOf(entry, `s${n}`, `stages[${i}]`);
    if (s) stages.push(s);
  });

  // Loop endpoints: a stage id, or an agent key that occurs exactly once.
  const flat = stages.flatMap((u) => (u.parallel ? u.parallel : [u]));
  const resolveRef = (ref, where) => {
    const v = typeof ref === 'string' ? cleanText(ref, 60) : '';
    if (!v) { issues.push({ code: 'LOOP_ENDPOINT', message: `${where}: missing stage reference` }); return null; }
    if (flat.some((s) => s.id === v)) return v;
    const byKey = flat.filter((s) => s.agent === v);
    if (byKey.length === 1) return byKey[0].id;
    issues.push({ code: 'LOOP_ENDPOINT', message: byKey.length > 1 ? `${where}: "${v}" names ${byKey.length} stages — use a stage id` : `${where}: unknown stage "${v}"` });
    return null;
  };
  const loops = [];
  (Array.isArray(r.loops) ? r.loops : []).forEach((l, i) => {
    if (!isObject(l)) { issues.push({ code: 'BAD_LOOP', message: `loops[${i}]: must be an object` }); return; }
    const from = resolveRef(l.from, `loops[${i}].from`);
    const to = resolveRef(l.to, `loops[${i}].to`);
    if (from && to) loops.push({ from, to, maxCycles: cycles(l.maxCycles, issues, `loops[${i}]`) });
  });

  if (issues.length) throw new ShapeError(issues);
  return { name, taskKind, reasoning, stages, loops };
}

// ── the assembler ─────────────────────────────────────────────────────────────

const nonBlocking = (o) => (o?.when || 'always') !== 'blocking';
const typeOk = (outType, inType) => inType === 'any' || outType === inType;
const flatStages = (units) => units.flatMap((u) => (u.parallel ? u.parallel : [u]));
const sameGroup = (units, a, b) => units.some((u) => u.parallel && u.parallel.some((s) => s.id === a) && u.parallel.some((s) => s.id === b));

/**
 * Shape -> validated v2 template. Deterministic: same shape + registry in, same
 * template out (ids, wire order, layout). Accepts a raw OR an already-normalized shape.
 * @param {object} rawShape the shape (normalized here — normalizeShape is idempotent)
 * @param {{registry?:object|Map, portsFn?:Function, humanInLoop?:boolean}} [o]
 * @returns {{template:object, warnings:Array, stageToNode:Map<string,string>, tunables:Record<string,object>, shape:object}}
 * @throws {ShapeError}
 */
export function assembleShape(rawShape, { registry = {}, portsFn = null, humanInLoop = true } = {}) {
  const shape = normalizeShape(rawShape);
  const index = registry instanceof Map ? Object.fromEntries(registry) : (isObject(registry) ? registry : {});
  const ports = typeof portsFn === 'function' ? portsFn : portsFnFor(index);
  const issues = [];
  const warnings = [];
  const metaOf = (agent) => index[agent];

  // 1) every agent exists, is ported and placeable (domain is NOT a graph rule — Task 11's cards filter it)
  for (const st of flatStages(shape.stages)) {
    const meta = metaOf(st.agent);
    if (!meta) issues.push({ code: 'UNKNOWN_AGENT', message: `unknown agent "${st.agent}"`, stageId: st.id });
    else if (!Array.isArray(meta.inputs) || !Array.isArray(meta.outputs)) issues.push({ code: 'UNPORTED_AGENT', message: `agent "${st.agent}" has no v2 ports`, stageId: st.id });
    else if (meta.placeable === false) issues.push({ code: 'UNPLACEABLE_AGENT', message: `agent "${st.agent}" cannot be a graph node`, stageId: st.id });
    // The classifier's vocabulary filters scope, but a hand-authored shape (the chat's
    // `shape` mode, P3) reaches the assembler directly — and resolveGraph has no scope check.
    else if (meta.scope === 'workspace-only') issues.push({ code: 'WORKSPACE_ONLY_AGENT', message: `agent "${st.agent}" runs on workspace targets only`, stageId: st.id });
  }
  if (issues.length) throw new ShapeError(issues);

  // 2) human out of the loop: drop clarifier stages — by META, never by key
  let units = shape.stages;
  let loops = shape.loops;
  if (!humanInLoop) {
    const dropped = new Set();
    const isClarifier = (s) => metaOf(s.agent)?.runnerType === 'clarifier';
    units = units.map((u) => {
      if (u.parallel) {
        const kept = u.parallel.filter((s) => !isClarifier(s));
        u.parallel.filter(isClarifier).forEach((s) => dropped.add(s.id));
        if (kept.length === u.parallel.length) return u;
        if (kept.length === 0) return null;
        return kept.length === 1 ? kept[0] : { ...u, parallel: kept };
      }
      if (isClarifier(u)) { dropped.add(u.id); return null; }
      return u;
    }).filter(Boolean);
    loops = loops.filter((l) => !dropped.has(l.from) && !dropped.has(l.to));
  }
  if (!units.length) throw new ShapeError([{ code: 'EMPTY', message: 'no stages left to run' }]);

  // 3) nodes. Ids must match NODE_ID_RE (/^n_[a-z0-9]{1,32}$/): lower-cased key, digits on repeats.
  const nodes = [];
  const wires = [];
  const taken = new Set();
  const mintNode = (base) => {
    const stem = `n_${String(base).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 28) || 'agent'}`;
    let id = stem;
    for (let n = 2; taken.has(id); n += 1) id = `${stem}${n}`;
    taken.add(id);
    return id;
  };
  const addNode = (node) => { nodes.push(node); return node; };
  let wireSeq = 0;
  const addWire = (from, to, config) => {
    const w = { id: `w${++wireSeq}`, from: { node: from.node, port: from.port }, to: { node: to.node, port: to.port } };
    if (config && Object.keys(config).length) w.config = { ...config };
    wires.push(w);
    return w;
  };
  const inbound = (nodeId) => wires.filter((w) => w.to.node === nodeId);

  const taskNode = addNode({ id: mintNode('task'), kind: 'task', x: 0, y: 0, config: {} });
  if (shape.taskKind.startsWith('plan-complete')) taskNode.config.planStoreSeed = true;   // A2: the task document IS the plan

  const stageToNode = new Map();
  const tunables = {};
  const nodeOf = new Map();          // stageId -> node
  const resolvedPorts = new Map();   // stageId -> portsOf(...)
  for (const st of flatStages(units)) {
    const node = addNode({ id: mintNode(st.agent), kind: 'agent', key: st.agent, x: 0, y: 0, config: { ...st.tunables } });
    stageToNode.set(st.id, node.id);
    nodeOf.set(st.id, node);
    resolvedPorts.set(st.id, portsOf(ports, node));
    if (Object.keys(st.tunables).length) tunables[node.id] = { ...st.tunables };
  }
  const endNode = addNode({ id: mintNode('end'), kind: 'end', x: 0, y: 0, config: {} });

  const outsOf = (st) => resolvedPorts.get(st.id).outputs.filter(nonBlocking)
    .map((o) => ({ node: nodeOf.get(st.id).id, port: o.id, type: o.type }));
  const completionOf = (st) => {
    const outs = resolvedPorts.get(st.id).outputs;
    const pick = outs.find((o) => o.when === 'clean' && o.type === 'void')
      || outs.find((o) => nonBlocking(o) && o.type === 'void')
      || outs.find((o) => nonBlocking(o) && o.type === 'md')
      || outs.find(nonBlocking);
    return pick ? { node: nodeOf.get(st.id).id, port: pick.id, type: pick.type } : null;
  };

  // A UNIT is a stage or a parallel group (with lazily minted gates).
  const TASK_UNIT = {
    task: true,
    outputs: () => [{ node: taskNode.id, port: 'task', type: 'md' }],
    completion: () => ({ node: taskNode.id, port: 'task', type: 'md' }),
    nodeIds: () => new Set([taskNode.id]),
  };
  const gateSeq = { and: 0, combine: 0, or: 0 };
  const unitView = (u) => {
    if (!u.parallel) {
      return { stages: [u], group: false, outputs: () => outsOf(u), completion: () => completionOf(u), nodeIds: () => new Set([nodeOf.get(u.id).id]) };
    }
    const view = { stages: u.parallel, group: true, andId: null, combineId: null };
    /** Every member's FIRST non-blocking md output — the inputs of the group's md join. */
    view.mds = () => u.parallel.flatMap((s) => outsOf(s).filter((o) => o.type === 'md').slice(0, 1));
    /** The joined md deliverable (rule 2b, D22): ONE Combine over view.mds(), minted on
     *  the FIRST bind so an unused join never lands in the graph; a single md producer
     *  IS the deliverable; no md producer => null (the successor binds member outputs). */
    view.deliverable = () => {
      const mds = view.mds();
      if (mds.length < 2) return mds[0] || null;
      if (!view.combineId) {
        const c = addNode({ id: mintNode(`combine${++gateSeq.combine}`), kind: 'combine', x: 0, y: 0, config: { arity: mds.length } });
        mds.forEach((o, i) => addWire(o, { node: c.id, port: `in${i + 1}` }));
        view.combineId = c.id;
      }
      return { node: view.combineId, port: 'out', type: 'md' };
    };
    /** Completion: an AND over every member's completion output (minted once the members are wired). */
    view.mintGates = () => {
      const comps = u.parallel.map(completionOf).filter(Boolean);
      const a = addNode({ id: mintNode(`and${++gateSeq.and}`), kind: 'and', x: 0, y: 0, config: { arity: Math.max(2, comps.length) } });
      comps.forEach((o, i) => addWire(o, { node: a.id, port: `in${i + 1}` }));
      view.andId = a.id;
    };
    view.outputs = () => [
      ...(view.andId ? [{ node: view.andId, port: 'out', type: 'void' }] : []),
      ...u.parallel.flatMap(outsOf),
    ];
    view.completion = () => (view.andId ? { node: view.andId, port: 'out', type: 'void' } : null);
    view.nodeIds = () => new Set([...u.parallel.map((s) => nodeOf.get(s.id).id), view.andId, view.combineId].filter(Boolean));
    return view;
  };
  const views = units.map(unitView);

  // 4) data wiring + sequencing, unit by unit (a group's members see the group's predecessors)
  const predUnit = new Map();   // stageId -> the immediate predecessor unit (for rule 3b)
  const wireStage = (st, preds) => {
    const node = nodeOf.get(st.id);
    predUnit.set(st.id, preds[0] || null);
    for (const p of resolvedPorts.get(st.id).inputs) {
      if (p.loop || p.synthetic || p.id === 'await') continue;
      const required = p.required !== false;
      const candidates = required ? preds : preds.slice(0, 1);   // optional inputs bind only from the immediate predecessor
      let pick = null;
      for (const u of candidates) {
        // Rule 2b: a parallel group speaks through its GATES first — its joined md
        // deliverable (minted on this first bind) outranks any single member's
        // output, even one whose port id matches. Other types bind member outputs.
        const joined = u.group && (p.type === 'md' || p.type === 'any') ? u.deliverable() : null;
        const outs = u.outputs().filter((o) => typeOk(o.type, p.type));
        pick = joined || outs.find((o) => o.port === p.id) || outs[0] || null;
        if (pick) break;
      }
      if (pick) addWire(pick, { node: node.id, port: p.id });
      else if (required) issues.push({ code: 'NO_PRODUCER', message: `stage "${st.id}" (${st.agent}): no upstream output of type ${p.type} for its required input "${p.id}"`, stageId: st.id });
    }
    const prev = preds[0];
    if (!prev || prev.task) return;
    if (prev.group) {
      if (!inbound(node.id).some((w) => w.from.node === prev.andId)) addWire({ node: prev.andId, port: 'out' }, { node: node.id, port: 'await' });
      return;
    }
    const prevIds = prev.nodeIds();
    if (!inbound(node.id).some((w) => prevIds.has(w.from.node))) {
      const c = prev.completion();
      if (c) addWire(c, { node: node.id, port: 'await' });
    }
  };
  views.forEach((v, i) => {
    const preds = [...views.slice(0, i).reverse(), TASK_UNIT];
    for (const st of v.stages) wireStage(st, preds);
    if (v.group) v.mintGates();
  });

  // 5) loops: explicit first, then self-by-default, then the nearest preceding loop input
  const flat = flatStages(units);
  const blockingOut = (st) => resolvedPorts.get(st.id).outputs.find((o) => o.when === 'blocking') || null;
  const loopInputs = (st) => resolvedPorts.get(st.id).inputs.filter((p) => p.loop);
  // Rule 4b: a loop into a MEMBER of a parallel group is legal only when the loop's
  // source binds one of that member's outputs. The group's AND gate re-fires only
  // when EVERY member re-runs, so a verifier whose only tie to the group is
  // `and.out → await` never re-fires after a fix cycle that re-ran one member —
  // the run finishes at quiescence with End unreached (measured on
  // planner → [implementer ∥ manualTestsChecklist] → manualWebUiTesting).
  const groupOf = (stageId) => units.find((u) => u.parallel && u.parallel.some((s) => s.id === stageId)) || null;
  const bindsOutputOf = (srcStage, dstStage) => inbound(nodeOf.get(srcStage.id).id).some((w) => w.from.node === nodeOf.get(dstStage.id).id);
  const loopTargetOk = (fromSt, toSt) => !groupOf(toSt.id) || bindsOutputOf(fromSt, toSt);
  const loopWires = [];   // { from:{node,port}, to:{node,port}, maxCycles }
  const handled = new Set();
  for (const st of flat) {
    if (!st.selfLoop) continue;
    const b = blockingOut(st);
    const i = b ? loopInputs(st).find((p) => typeOk(b.type, p.type)) : null;
    if (!b || !i) { issues.push({ code: 'BAD_SELF_LOOP', message: `stage "${st.id}" (${st.agent}) cannot loop on itself`, stageId: st.id }); continue; }
    loopWires.push({ from: { node: nodeOf.get(st.id).id, port: b.id }, to: { node: nodeOf.get(st.id).id, port: i.id }, maxCycles: st.selfLoop.maxCycles });
    handled.add(st.id);
  }
  for (const l of loops) {
    const from = flat.find((s) => s.id === l.from);
    const to = flat.find((s) => s.id === l.to);
    const b = from ? blockingOut(from) : null;
    if (!b) { issues.push({ code: 'LOOP_SOURCE', message: `loop from "${l.from}": that stage has no blocking output` }); continue; }
    const i = to ? loopInputs(to).find((p) => typeOk(b.type, p.type)) : null;
    if (!i) { issues.push({ code: 'LOOP_TARGET', message: `loop to "${l.to}": no loop input of type ${b.type}` }); continue; }
    if (!loopTargetOk(from, to)) {
      issues.push({ code: 'LOOP_INTO_GROUP', message: `loop to "${l.to}": ${to.agent} runs inside a parallel group and "${l.from}" (${from.agent}) reads none of its outputs — the group's AND gate would never re-fire; place ${to.agent} before the group, or loop into a stage outside it`, stageId: to.id });
      continue;
    }
    loopWires.push({ from: { node: nodeOf.get(from.id).id, port: b.id }, to: { node: nodeOf.get(to.id).id, port: i.id }, maxCycles: l.maxCycles });
    handled.add(from.id);
  }
  flat.forEach((st, idx) => {
    if (handled.has(st.id) || st.loop === false) return;
    const b = blockingOut(st);
    if (!b) return;
    const own = loopInputs(st).find((p) => typeOk(b.type, p.type));
    if (own) {
      loopWires.push({ from: { node: nodeOf.get(st.id).id, port: b.id }, to: { node: nodeOf.get(st.id).id, port: own.id }, maxCycles: DEFAULT_MAX_CYCLES });
      return;
    }
    for (let j = idx - 1; j >= 0; j -= 1) {
      const prev = flat[j];
      if (sameGroup(units, st.id, prev.id) || !loopTargetOk(st, prev)) continue;   // never a sibling; never a member the source does not read
      const i = loopInputs(prev).find((p) => typeOk(b.type, p.type));
      if (i) {
        loopWires.push({ from: { node: nodeOf.get(st.id).id, port: b.id }, to: { node: nodeOf.get(prev.id).id, port: i.id }, maxCycles: DEFAULT_MAX_CYCLES });
        return;
      }
    }
    warnings.push({ code: 'LOOP_UNWIRED', message: `stage "${st.id}" (${st.agent}): its blocking output "${b.id}" has nowhere to loop back to`, stageId: st.id });
  });

  // 5b) rule 3b — awaitAll for whole-unit successors. Loop wires are not in the
  // graph yet, so inbound() holds data + await wires only. A self-loop resolves
  // inside the group's own wave, so only loops from OUTSIDE a group into one of its
  // members veto awaitAll on that group's successor (that member re-runs alone; the
  // AND never re-fires; the successor must stay any-fresh — rule 4b makes sure it
  // reads that member's output).
  const externalLoopTargets = new Set(loopWires.filter((lw) => lw.from.node !== lw.to.node).map((lw) => lw.to.node));
  for (const st of flat) {
    const node = nodeOf.get(st.id);
    const prev = predUnit.get(st.id);
    if (!prev || prev.task) continue;
    const prevIds = prev.nodeIds();
    const all = inbound(node.id);
    const fromPrev = all.filter((w) => prevIds.has(w.from.node));
    if (fromPrev.length < 2 || fromPrev.length !== all.length) continue;
    if (prev.group && [...prevIds].some((id) => externalLoopTargets.has(id))) continue;
    node.config.awaitAll = true;
  }

  const byTarget = new Map();
  for (const lw of loopWires) {
    const k = `${lw.to.node}.${lw.to.port}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k).push(lw);
  }
  // or.in<k> order = the SOURCE stage's position in the shape (the seeds' convention:
  // reviewer on in1, web-ui review on in2), never the order the loops were declared in.
  const stageIndexOfNode = new Map(flat.map((st, i) => [nodeOf.get(st.id).id, i]));
  for (const list of byTarget.values()) {
    list.sort((a, b) => (stageIndexOfNode.get(a.from.node) ?? 0) - (stageIndexOfNode.get(b.from.node) ?? 0));
    if (list.length === 1) { addWire(list[0].from, list[0].to, { maxCycles: list[0].maxCycles }); continue; }
    const or = addNode({ id: mintNode(`or${++gateSeq.or}`), kind: 'or', x: 0, y: 0, config: { arity: list.length } });
    list.forEach((lw, i) => addWire(lw.from, { node: or.id, port: `in${i + 1}` }, { maxCycles: lw.maxCycles }));
    addWire({ node: or.id, port: 'out' }, list[0].to);            // always-sourced: no budget (V13)
  }

  // 6) End
  const done = views[views.length - 1].completion();
  if (done) addWire(done, { node: endNode.id, port: 'result' });
  else issues.push({ code: 'NO_COMPLETION', message: 'the last stage has no output to end the run on' });
  if (issues.length) throw new ShapeError(issues);

  // 7) layout + validate
  const template = { id: '', name: shape.name, version: TEMPLATE_VERSION, domain: 'coding', nodes, wires };
  const pos = autoLayout(template, ports);
  for (const n of nodes) if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; }
  const report = validateGraph(template, ports);
  if (!report.ok) throw new ShapeError(report.errors.map((e) => ({ code: `GRAPH_${e.code}`, message: e.message, nodeId: e.nodeId, wireId: e.wireId })));
  warnings.push(...report.warnings.map((w) => ({ code: `GRAPH_${w.code}`, message: w.message, nodeId: w.nodeId, wireId: w.wireId })));
  return { template, warnings, stageToNode, tunables, shape };
}
