// ui/public/stillhet/live/workflow-draft.mjs — a Workflows draft back into dev's template on Save (Stillhet slice 7 D6).
// Pure. Pages and the canvas edit the prototype's tuples ([name, key, model, effort, minutes, $, …]); in the live kind each
// tuple also carries its node id at DRAFT_NODE (a step added by hand has none). Save turns them into dev's template and
// checks it with dev's own validator before anything is sent; dev's server checks it again (validateForSave).
import { serializeTemplate, newNode, newWire, removeNode, canWire } from '../../../../src/shared/graph/template.mjs';
import { validateGraph } from '../../../../src/shared/graph/validate.mjs';
import { classifyLoops } from '../../../../src/shared/graph/loops.mjs';
import { portsFnFor, portsOf } from '../../../../src/shared/graph/ports.mjs';
import { labelOf, modelIdOf, DEFAULT_MODEL, DEFAULT_EFFORT } from './workflow-map.mjs';

export const DRAFT_NODE = 9;   // the tuple slot holding a step's node id (0–8 are the prototype's)
export const BRANCHES = 'its steps branch; change it in a chat';   // D7

/** A fresh draft of a live workflow record: the prototype's blank(), each step carrying its node id. */
export function draftOf(x) {
  return { title: x.title, steps: x.steps.map((s, i) => { const t = structuredClone(s); t[DRAFT_NODE] = x.nodeIds[i]; return t; }), loops: structuredClone(x.loops), changes: 0 };
}

/** A node id for a step added by hand: free in the template the draft started from, the current one and the draft itself,
 *  so a step added after a save and a reload never takes a saved step's id. */
export function newStepId(x, steps = []) {
  const taken = new Set([...(x?.tpl?.nodes || []), ...(x?.draft?.base?.nodes || [])].map((n) => n.id));
  for (const s of steps) if (s?.[DRAFT_NODE]) taken.add(s[DRAFT_NODE]);
  let n = 1; while (taken.has(`n_new${n}`)) n += 1;
  return `n_new${n}`;
}

const nonLoop = (tpl, loopIds, pred) => tpl.wires.filter((w) => !loopIds.has(w.id) && w.from.node !== w.to.node && pred(w));
const firstFit = (tpl, portsFn, from, node, dir) => {
  const ports = portsOf(portsFn, node)[dir === 'in' ? 'inputs' : 'outputs'].filter((p) => p.id !== 'await' && !p.loop && (dir === 'in' || p.when !== 'blocking'));
  const t = { ...tpl, nodes: [...tpl.nodes.filter((n) => n.id !== node.id), node] };
  return ports.find((p) => canWire({ tpl: t, portsFn, from: dir === 'in' ? from : { node: node.id, port: p.id }, to: dir === 'in' ? { node: node.id, port: p.id } : from }).ok) || ports[0];
};

/**
 * @param {object} base   the live record the draft started from (workflow-map.mjs workflowOf)
 * @param {{title:string, steps:any[][], loops:any[][]}} draft
 * @param {{portsFn?: Function}} [o]
 * @returns {{ok:true, tpl:object} | {ok:false, reason:string}}
 */
export function templateOfDraft(base, draft, { portsFn } = {}) {
  const pf = portsFn || portsFnFor(base.agentsByKey || {}, base.scriptsByKey || {});
  const loopIds = classifyLoops(base.tpl, pf).loopWireIds;
  const ids = draft.steps.map((s, i) => s[DRAFT_NODE] ?? (draft.steps.length === base.steps.length ? base.nodeIds[i] : undefined));
  const known = new Set(base.nodeIds);   // a tuple naming a node the base lacks is a step added by hand (the canvas names it, so it draws stably)
  const removed = base.nodeIds.filter((id) => !ids.includes(id)), added = ids.some((id) => !id || !known.has(id));
  if ((removed.length || added) && !base.chain) return { ok: false, reason: BRANCHES };
  let tpl = serializeTemplate(base.tpl);
  tpl.name = draft.title;
  // removed steps: what came into the step now goes where it went (a chain has one way in and one way out)
  for (const id of removed) {
    const into = nonLoop(tpl, loopIds, (w) => w.to.node === id), out = nonLoop(tpl, loopIds, (w) => w.from.node === id);
    const ins = new Map(into.map((w) => [w.from.node, w]));
    tpl = removeNode(tpl, id);
    for (const o of out) {
      const from = [...ins.values()].find((w) => !tpl.wires.some((x) => x.from.node === w.from.node && x.to.node === o.to.node)) || into[0];
      if (!from || tpl.wires.some((x) => x.to.node === o.to.node && x.to.port === o.to.port)) continue;
      tpl.wires.push(newWire(from.from, o.to, null, tpl.wires.map((w) => w.id)));
    }
  }
  // added steps, after the step before them in the draft (the task node for the first)
  draft.steps.forEach((s, i) => {
    if (ids[i] && known.has(ids[i])) return;
    const prevId = ids.slice(0, i).reverse().find(Boolean) || tpl.nodes.find((n) => n.kind === 'task')?.id;
    const prev = tpl.nodes.find((n) => n.id === prevId), kind = base.scriptsByKey?.[s[1]] ? 'script' : 'agent';
    const node = newNode(kind, s[1], (prev?.x || 0) + 140, (prev?.y || 0) + 140, tpl.nodes.map((n) => n.id));
    if (ids[i] && !tpl.nodes.some((n) => n.id === ids[i])) node.id = ids[i];
    const next = nonLoop(tpl, loopIds, (w) => w.from.node === prevId);
    tpl.wires = tpl.wires.filter((w) => !next.includes(w));
    tpl.nodes.push(node);
    const fromPort = next[0]?.from || { node: prevId, port: portsOf(pf, prev).outputs[0]?.id };
    const inP = firstFit(tpl, pf, fromPort, node, 'in');
    if (inP) tpl.wires.push(newWire(fromPort, { node: node.id, port: inP.id }, null, tpl.wires.map((w) => w.id)));
    const outP = portsOf(pf, node).outputs.find((p) => p.when !== 'blocking');
    for (const w of next) if (outP) tpl.wires.push(newWire({ node: node.id, port: outP.id }, w.to, null, tpl.wires.map((x) => x.id)));
    ids[i] = node.id;
  });
  // what each step says: its name, model and effort
  draft.steps.forEach((s, i) => {
    const n = tpl.nodes.find((x) => x.id === ids[i]); if (!n) return;
    const cfg = { ...(n.config || {}) };
    delete cfg.label;
    if (s[0] && s[0] !== labelOf({ ...n, config: cfg }, base.agentsByKey || {}, base.scriptsByKey || {})) cfg.label = s[0];
    if (n.kind === 'agent') {
      if (!s[2] || s[2] === DEFAULT_MODEL) delete cfg.model; else cfg.model = modelIdOf(s[2]);
      if (!s[3] || s[3] === DEFAULT_EFFORT) delete cfg.effort; else cfg.effort = s[3];
    }
    n.config = cfg;
  });
  // loop rounds: the base's loop wires, in the order workflowOf lists them
  const loopWires = base.tpl.wires.filter((w) => loopIds.has(w.id)).map((w) => w.id);
  draft.loops.forEach((l, i) => {
    const w = tpl.wires.find((x) => x.id === loopWires[base.loops.findIndex((b) => b[0] === l[0] && b[1] === l[1])] || x.id === loopWires[i]);
    if (w) w.config = { ...(w.config || {}), maxCycles: Number(l[2]) };
  });
  const v = validateGraph(tpl, pf);
  if (v.errors.length) return { ok: false, reason: v.errors[0].message };
  return { ok: true, tpl };
}

const topo = (t) => JSON.stringify([t?.name ?? '', (t?.nodes || []).map((n) => [n.id, n.kind, n.key ?? null, n.config || {}]), (t?.wires || []).map((w) => [w.id, w.from, w.to, w.config || {}])]);
/** Whether two templates have the same name, nodes and wires (positions and stamps aside): a draft's base is current (D9). */
export function sameBase(a, b) { return topo(a) === topo(b); }

/** The agent .md with `model:` and `effort:` set in its frontmatter; every other byte kept (D15). */
export function withFrontmatter(markdown, { model, effort } = {}) {
  const set = Object.entries({ model, effort }).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!set.length) return markdown;
  const nl = markdown.includes('\r\n') ? '\r\n' : '\n';
  const m = new RegExp(`^---${nl}([\\s\\S]*?)${nl}---(${nl}|$)`).exec(markdown);
  if (!m) return `---${nl}${set.map(([k, v]) => `${k}: ${v}`).join(nl)}${nl}---${nl}${markdown}`;
  const lines = m[1].split(nl);
  for (const [k, v] of set) {
    const i = lines.findIndex((l) => new RegExp(`^${k}\\s*:`).test(l));
    if (i >= 0) lines[i] = `${k}: ${v}`; else lines.push(`${k}: ${v}`);
  }
  return `---${nl}${lines.join(nl)}${nl}---${m[2]}${markdown.slice(m[0].length)}`;
}
