// ui/public/run-setup-view.mjs — the Task tab's "Run setup": the choices a run started with, which the New run form
// and its card no longer show once the run is going. Read from the setup the run kept at start
// (GET /api/pipelines/:id/setup, pipelines.run_setup) and its state (the workflow graph it ran, the engine, the code
// graph tool). Pure: the caller fetches and passes both; facts the card already shows (pull request, tags, labels)
// stay there.
import { presetEngineName } from './run-presets-names.mjs';
import { tagLevel, keepVisible } from './ui-level.mjs';

const cap = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** A graph node's name on screen: its own label, else its key made readable. */
function nodeName(node) {
  return (node && (String(node.label || '').trim() || cap(node.key || node.id))) || 'Agent';
}

/**
 * The run's setup as rows: [{ label, value, level }] for the run, `agents` [{ name, value, level, parts }] for the agents
 * whose model, effort, sub-agents or questions were set, `loops` [{ name, value, level }] for each loop's round budget.
 * `level` is the interface mode the New run form shows that choice at (docs/ui-levels.md); an agent's `parts`
 * [{ text, level }] carry their own (model and effort Advanced, sub-agents and questions Expert). `setup` null (a run
 * from before runs kept their setup) leaves what the state alone says.
 */
export function runSetupModel(setup, state) {
  const s = setup && typeof setup === 'object' ? setup : {};
  const st = state && typeof state === 'object' ? state : {};
  const rows = [];
  const add = (label, value, level = 'simple', keep = false) => { if (value) rows.push({ label, value, level, ...(keep ? { keep } : {}) }); };
  const tpl = st.stepper && st.stepper.template;
  add('Workflow', (tpl && String(tpl.name || '').trim()) || (s.workflowId === 'wf_auto' ? 'Auto workflow' : ''));
  // The Engine row is Advanced, but a non-Claude engine stays on screen at every level (docs/ui-levels.md, rule 2).
  const engine = s.engine || st.runEngine;
  add('Engine', presetEngineName(engine), 'advanced', !!engine && engine !== 'claude');
  add('Guardrails', cap(s.guardrailsId || st.guardrailsId), 'advanced');
  if (typeof s.humanInLoop === 'boolean') add('Human in the loop', s.humanInLoop ? 'On: agents may ask you' : 'Off: runs without asking', 'advanced');
  if (s.nightMode === true) add('Away mode', 'On: Worca may answer for you');
  const source = s.sourceBranch || (st.branch && typeof st.branch === 'object' ? st.branch.source : '') || '';
  const byKey = s.sourceBranchByKey && typeof s.sourceBranchByKey === 'object' ? Object.entries(s.sourceBranchByKey) : [];
  const branch = byKey.length ? byKey.map(([k, b]) => `${k}: ${b}`).join(' · ') : source;
  add('Source branch', branch && [branch, s.sameAsSource === true ? 'worked on directly' : '', s.syncBeforeStart === true ? 'synced before start' : ''].filter(Boolean).join(' · '), 'advanced');
  if (Array.isArray(s.mcpOptOut) && s.mcpOptOut.length) add('MCP servers off', s.mcpOptOut.join(', '), 'advanced');
  const tool = st.tools && typeof st.tools === 'object' && st.tools.tool;
  if (tool) add('Code graph', String(tool), 'advanced');
  if (s.mock === true || st.mock === true) add('Mock run', 'Yes: no model calls');

  const graph = st.stepper && st.stepper.graph;
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const over = s.overlay && typeof s.overlay === 'object' ? s.overlay : {};
  const overNodes = over.nodes && typeof over.nodes === 'object' ? over.nodes : {};
  const agents = [];
  for (const n of nodes) {
    if (!n || n.kind !== 'agent') continue;
    const o = { ...(n.config && typeof n.config === 'object' ? n.config : {}), ...(overNodes[n.id] || {}) };
    const parts = [];
    if (o.model) parts.push({ text: String(o.model), level: 'advanced' });
    if (o.effort) parts.push({ text: `${o.effort} effort`, level: 'advanced' });
    if (o.fanOut === true) parts.push({ text: o.subagentModel ? `parallel sub-agents on ${o.subagentModel}` : 'parallel sub-agents', level: 'expert' });
    else if (o.subagentModel) parts.push({ text: `sub-agents on ${o.subagentModel}`, level: 'expert' });
    if (o.askQuestions === true) parts.push({ text: 'asks questions', level: 'expert' });
    // Advanced parts come first, so the row's level is its first part's.
    if (parts.length) agents.push({ name: nodeName(n), value: parts.map((p) => p.text).join(' · '), level: parts[0].level, parts });
  }
  const overWires = over.wires && typeof over.wires === 'object' ? over.wires : {};
  const loops = [];
  for (const w of graph && Array.isArray(graph.wires) ? graph.wires : []) {
    if (!w || !w.loop) continue;
    const max = (overWires[w.id] && overWires[w.id].maxCycles) || w.maxCycles;
    if (!max) continue;
    loops.push({ name: `${nodeName(byId.get(w.from && w.from.node))} → ${nodeName(byId.get(w.to && w.to.node))}`,
      value: `up to ${max} round${max === 1 ? '' : 's'}`, level: 'expert' });
  }
  return { rows, agents, loops };
}

/** The card: a definition list per group, under one heading. null when there is nothing to say. */
export function renderRunSetup(doc, model) {
  if (!model || (!model.rows.length && !model.agents.length && !model.loops.length)) return null;
  const card = doc.createElement('section');
  card.className = 'run-setup';
  card.setAttribute('aria-label', 'Run setup');
  const h = doc.createElement('h3');
  h.className = 'run-setup-h';
  h.textContent = 'Run setup';
  card.appendChild(h);
  const group = (title, items, key) => {
    if (!items.length) return;
    if (title) {
      const t = doc.createElement('h4');
      t.className = 'run-setup-sub';
      t.textContent = title;
      // The heading shows from its lowest row's level, so it never heads an empty list.
      tagLevel(t, items.some((it) => it.level === 'advanced') ? 'advanced' : items[0].level);
      card.appendChild(t);
    }
    const dl = doc.createElement('dl');
    dl.className = 'run-setup-list';
    for (const it of items) {
      // One <div> per row (allowed in a <dl>), so the row's level hides its term and value together.
      const row = doc.createElement('div');
      row.className = 'run-setup-row';
      tagLevel(row, it.level);
      if (it.keep) keepVisible(row, true);
      const dt = doc.createElement('dt');
      dt.textContent = it[key];
      const dd = doc.createElement('dd');
      if (it.parts) {
        // Each part hides at its own level; its separator rides with it, so a hidden part leaves no stray " · ".
        it.parts.forEach((p, i) => {
          const span = doc.createElement('span');
          span.textContent = (i ? ' · ' : '') + p.text;
          if (p.level !== it.level) tagLevel(span, p.level);
          dd.appendChild(span);
        });
      } else dd.textContent = it.value;
      row.append(dt, dd);
      dl.appendChild(row);
    }
    card.appendChild(dl);
  };
  group('', model.rows, 'label');
  group('Agents', model.agents, 'name');
  group('Loops', model.loops, 'name');
  return card;
}
