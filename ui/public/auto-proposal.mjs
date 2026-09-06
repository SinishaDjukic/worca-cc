// ui/public/auto-proposal.mjs
// The ONE renderer of an Auto proposal body (spec §7.4 + the 2026-09-05 mockup, section D "one body, two hosts").
// Hosts: the run page's question panel (Part A) and the chat card (Part B). Pure DOM: `doc` injected, no fetch,
// no listeners except the name editor's own; the host owns buttons and I/O. Reads NO agent key (D23) — every
// label, colour and icon comes from the manifest.
import { mountStaticGraph } from './graph/view.mjs';
import { manifestPortsFn, manifestTemplate, manifestAgents } from './graph/run-decor.mjs';
import { FLOW_SCALE } from './graph/model.mjs';

export const AUTO_PROPOSAL_ORDER_CARD = Object.freeze(['name', 'reason', 'signals', 'fp', 'graph', 'loops', 'match', 'warnings', 'meta']);
export const AUTO_PROPOSAL_ORDER_QPANEL = Object.freeze(['reason', 'signals', 'fp', 'name', 'graph', 'loops', 'match', 'warnings', 'meta']);

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICO = {
  pencil: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
};
function h(doc, tag, cls, text) { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function icon(doc, inner, cls) { const s = doc.createElementNS(SVG_NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); s.innerHTML = inner; return s; }
const fmtUsd = (v) => `$${(Number(v) || 0).toFixed(2)}`;

/** Loop lines from the manifest: every loop wire with a budget, ONE hop through an `or` valve (A20). */
export function proposalLoops(manifest) {
  const nodes = manifest?.graph?.nodes || []; const wires = manifest?.graph?.wires || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const label = (id) => byId.get(id)?.label || id;
  const through = (id) => {
    const n = byId.get(id);
    if (!n || n.kind !== 'or') return id;
    const out = wires.find((w) => w.from.node === id);
    return out ? out.to.node : id;
  };
  return wires.filter((w) => w.loop && Number.isInteger(w.maxCycles)).map((w) => ({
    wireId: w.id, from: w.from.node, to: through(w.to.node), fromLabel: label(w.from.node), toLabel: label(through(w.to.node)), maxCycles: w.maxCycles, self: w.from.node === w.to.node,
  }));
}

/** Band data per agent node for view.mjs's `band` option (A7, A22). */
export function proposalBands(proposal, nodesState = null) {
  const models = new Map((proposal.models || []).map((m) => [m.id, m.label || m.id]));
  const loops = proposalLoops(proposal.manifest);
  const out = {};
  for (const [id, base] of Object.entries(proposal.nodes || {})) {
    const cur = { ...base, ...((nodesState && nodesState[id]) || {}) };
    const flags = [];
    if (cur.askQuestions) flags.push({ text: 'asks', cls: 'q', title: 'may ask you questions' });
    for (const l of loops.filter((x) => x.from === id)) flags.push({ text: `${l.self ? '⟳' : '↩'} ${l.maxCycles}`, title: `${l.self ? 'refines itself' : `loops to ${l.toLabel}`} · max ${l.maxCycles} cycles` });
    out[id] = { model: cur.model ? (models.get(cur.model) || cur.model) : '', effort: cur.effort || '', flags };
  }
  return out;
}

/** The mono line under the chips (A8): a `fingerprint:` signal wins, else the fingerprint's `hints:` line, else its first line. */
export function fingerprintLine(proposal) {
  const sig = (proposal.signals || []).find((s) => /^fingerprint:/i.test(s));
  if (sig) return sig.replace(/^fingerprint:\s*/i, '');
  const lines = String(proposal.fingerprint || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const hints = lines.find((l) => /^hints:/i.test(l));
  return hints ? hints.replace(/^hints:\s*/i, '') : (lines[0] || '');
}

/** The dispatch order for the flow layout: the proposal's agent order; the graph's flow cards are placed by the layout rule. */
const agentOrderOf = (proposal) => (Array.isArray(proposal.order) && proposal.order.length ? [...proposal.order] : null);

/**
 * @param {object} proposal  the `workflow` question payload (buildProposal)
 * @param {{doc?:Document, width?:number, order?:readonly string[], editableName?:boolean, costUsd?:number, rounds?:number,
 *          scale?:number, onName?:(name:string)=>void}} [opts]
 * @returns {{el:HTMLElement, parts:Record<string,HTMLElement|null>, graph:object|null, getName():string, setName(v:string):void,
 *            setNodeTunables(id:string, sel:object):void, relayout(width?:number):void, destroy():void}}
 */
export function renderAutoProposal(proposal, {
  doc = globalThis.document, width = 0, order = AUTO_PROPOSAL_ORDER_CARD, editableName = true,
  costUsd = null, rounds = null, scale = FLOW_SCALE, onName = null,
} = {}) {
  const p = proposal || {};
  const state = { name: String(p.name || ''), nodes: {} };     // nodes: host-applied tunable edits, keyed by node id
  const el = h(doc, 'div', 'ask-wfcard-body');
  const parts = {};

  // ---- name: static row + pencil → input variant (A18)
  const nameRow = h(doc, 'div', 'ask-wfcard-namerow');
  const nameEl = h(doc, 'div', 'ask-wfcard-name', state.name); nameEl.title = state.name;
  nameRow.appendChild(nameEl);
  const edit = h(doc, 'div', 'ask-wfcard-nameedit'); edit.hidden = true;
  const field = h(doc, 'input', 'ask-wfcard-field'); field.type = 'text'; field.setAttribute('aria-label', 'Workflow name'); field.spellcheck = false; field.maxLength = 60;
  edit.appendChild(field); edit.appendChild(h(doc, 'div', 'ask-wfcard-fieldhint', 'Enter saves · Esc reverts'));
  const commit = (v) => { const t = String(v || '').trim(); if (t) state.name = t; nameEl.textContent = state.name; nameEl.title = state.name; paintMatch(); if (onName) onName(state.name); };
  if (editableName) {
    const pencil = h(doc, 'button', 'ask-wfcard-edit'); pencil.type = 'button'; pencil.appendChild(icon(doc, ICO.pencil)); pencil.appendChild(doc.createTextNode('Edit'));
    pencil.title = 'Edit the name · Enter or blur saves, Esc reverts';   // the mockup's "Edit · saves on blur" copy, as a tooltip
    const open = () => { field.value = state.name; nameRow.hidden = true; edit.hidden = false; field.focus(); field.select?.(); };
    const close = () => { edit.hidden = true; nameRow.hidden = false; };
    pencil.addEventListener('click', open);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(field.value); close(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } });
    field.addEventListener('blur', () => { if (!edit.hidden) { commit(field.value); close(); } });
    nameRow.appendChild(pencil);
  }
  const nameWrap = h(doc, 'div', 'ask-wfcard-namewrap'); nameWrap.append(nameRow, edit); parts.name = nameWrap;

  // ---- reasoning, chips, fingerprint
  parts.reason = p.reasoning ? h(doc, 'p', 'ask-wfcard-reason', p.reasoning) : null;
  const sig = h(doc, 'div', 'ask-wfcard-signals');
  if (p.taskKind) sig.appendChild(h(doc, 'span', 'ask-wfcard-sig kind', p.taskKind));
  if (p.size) sig.appendChild(h(doc, 'span', 'ask-wfcard-sig size', p.size));
  for (const s of p.signals || []) if (!/^fingerprint:/i.test(s)) sig.appendChild(h(doc, 'span', 'ask-wfcard-sig', s));
  parts.signals = sig.childElementCount ? sig : null;
  const fpText = fingerprintLine(p);
  if (fpText) { const fp = h(doc, 'div', 'ask-wfcard-fp'); fp.title = `fingerprint ${fpText}`; fp.appendChild(h(doc, 'span', 'k', 'fingerprint')); fp.appendChild(doc.createTextNode(fpText)); parts.fp = fp; } else parts.fp = null;

  // ---- graph: the shared renderer, flow layout, chat scale, chip bands (Tasks 1-3)
  const loops = proposalLoops(p.manifest);
  const m = p.manifest || { graph: { nodes: [], wires: [] } };
  const graphHost = h(doc, 'div', 'ask-wfcard-graph');
  graphHost.setAttribute('role', 'img');
  const labelOf = (id) => (m.graph?.nodes || []).find((n) => n.id === id)?.label || id;
  let bands = proposalBands(p, state.nodes);
  let graph = null;
  if ((m.graph?.nodes || []).length) {
    graph = mountStaticGraph(graphHost, manifestTemplate(m), {
      doc, portsFn: manifestPortsFn(m), agents: manifestAgents(m), width, scale, layout: 'flow',
      band: (node) => bands[node.id] || null, order: agentOrderOf(p),
    });
  }
  // Accessibility (mockup F): the label names EVERY card in placement order — gates included — so it is read from
  // the layout the view actually produced; `p.order` is agents-only and would drop the OR valve.
  const placed = graph ? graph.flowLayout().order : (m.graph?.nodes || []).map((n) => n.id);
  graphHost.setAttribute('aria-label', `Workflow graph: ${placed.map(labelOf).join(' → ')}${loops.length ? `; loops: ${loops.map((l) => `${l.fromLabel} → ${l.toLabel} max ${l.maxCycles}`).join(', ')}` : ''}`);
  parts.graph = graphHost;

  // ---- loops list, match line, warnings, meta
  if (loops.length) {
    const ul = h(doc, 'ul', 'ask-wfcard-loops');
    for (const l of loops) { const li = h(doc, 'li', 'ask-wfcard-loop'); li.append(doc.createTextNode(`${l.fromLabel} → ${l.toLabel} · `), h(doc, 'b', null, `max ${l.maxCycles} cycles`)); ul.appendChild(li); }
    parts.loops = ul;
  } else parts.loops = null;
  const match = h(doc, 'div', `ask-wfcard-match${p.match ? ' is-hit' : ''}`);
  const matchText = h(doc, 'span');
  function paintMatch() {
    matchText.replaceChildren();
    if (p.match) { matchText.append(doc.createTextNode('Same as your saved workflow '), h(doc, 'b', null, `"${p.match.name}"`)); }
    else { matchText.append(doc.createTextNode('No saved workflow has this shape — will be saved as '), h(doc, 'b', null, `"${state.name}"`)); }
  }
  match.append(icon(doc, p.match ? ICO.check : ICO.search), matchText); paintMatch(); parts.match = match;
  const warnBox = h(doc, 'div', 'ask-wfcard-warnings');
  for (const w of p.warnings || []) warnBox.appendChild(h(doc, 'div', 'ask-wfcard-warn', w));
  if (p.ignoredProjectOverrides) warnBox.appendChild(h(doc, 'div', 'ask-wfcard-warn', "This project's saved settings for that workflow are not applied to Auto runs."));
  parts.warnings = warnBox.childElementCount ? warnBox : null;
  const agents = Object.keys(p.nodes || {}).length;
  const cost = costUsd == null ? p.costUsd : costUsd;
  const r = rounds == null ? p.round : rounds;
  parts.meta = h(doc, 'div', 'ask-wfcard-meta', `classifier ≈ ${fmtUsd(cost)} · ${agents} agent${agents === 1 ? '' : 's'} · ${loops.length} loop${loops.length === 1 ? '' : 's'}${r > 1 ? ` · ${r} rounds` : ''}`);

  for (const key of order) if (parts[key]) el.appendChild(parts[key]);

  return {
    el, parts, graph,
    getName: () => state.name,
    setName: (v) => commit(v),
    /** A tunable edit from the host's table: repaint that node's band (no geometry change). */
    setNodeTunables(id, sel) {
      state.nodes[id] = { ...(state.nodes[id] || {}), ...(sel || {}) };
      bands = proposalBands(p, state.nodes);
      if (graph) graph.setBands(bands);
    },
    /** Re-measure after the host attached `el` (a detached host has clientWidth 0 ⇒ the 702 default was used).
     *  A host built with an explicit `width` keeps it as the last fallback, so a bare
     *  relayout() on a still-unattached host cannot snap back to that default. */
    relayout(w = 0) { if (graph) { const lay = graph.relayout(w || graphHost.clientWidth || width || 0); graphHost.style.height = `${lay.height}px`; } },
    destroy() { if (graph) { graph.destroy(); graph = null; } },
  };
}
