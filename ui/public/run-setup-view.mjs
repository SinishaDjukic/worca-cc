// ui/public/run-setup-view.mjs — the Task tab's "Run setup": the choices a run started with, which the New run form
// and its card no longer show once the run is going. Read from the setup the run kept at start
// (GET /api/pipelines/:id/setup, pipelines.run_setup) and its state (the workflow graph it ran, the engine, the code
// graph tool). Pure: the caller fetches and passes both; facts the card already shows (pull request, tags, labels)
// stay there.
import { presetEngineName } from './run-presets-names.mjs';

const cap = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** A graph node's name on screen: its own label, else its key made readable. */
function nodeName(node) {
  return (node && (String(node.label || '').trim() || cap(node.key || node.id))) || 'Agent';
}

/**
 * The run's setup as rows: [{ label, value }] for the run, `agents` [{ name, value }] for the agents whose model,
 * effort, sub-agents or questions were set, `loops` [{ name, value }] for each loop's round budget. `setup` null (a run
 * from before runs kept their setup) leaves what the state alone says.
 */
export function runSetupModel(setup, state) {
  const s = setup && typeof setup === 'object' ? setup : {};
  const st = state && typeof state === 'object' ? state : {};
  const rows = [];
  const add = (label, value) => { if (value) rows.push({ label, value }); };
  const tpl = st.stepper && st.stepper.template;
  add('Workflow', (tpl && String(tpl.name || '').trim()) || (s.workflowId === 'wf_auto' ? 'Auto workflow' : ''));
  add('Engine', presetEngineName(s.engine || st.runEngine));
  add('Guardrails', cap(s.guardrailsId || st.guardrailsId));
  if (typeof s.humanInLoop === 'boolean') add('Human in the loop', s.humanInLoop ? 'On: agents may ask you' : 'Off: runs without asking');
  if (s.nightMode === true) add('Away mode', 'On: Worca may answer for you');
  const source = s.sourceBranch || (st.branch && typeof st.branch === 'object' ? st.branch.source : '') || '';
  const byKey = s.sourceBranchByKey && typeof s.sourceBranchByKey === 'object' ? Object.entries(s.sourceBranchByKey) : [];
  const branch = byKey.length ? byKey.map(([k, b]) => `${k}: ${b}`).join(' · ') : source;
  add('Source branch', branch && [branch, s.sameAsSource === true ? 'worked on directly' : '', s.syncBeforeStart === true ? 'synced before start' : ''].filter(Boolean).join(' · '));
  if (Array.isArray(s.mcpOptOut) && s.mcpOptOut.length) add('MCP servers off', s.mcpOptOut.join(', '));
  const tool = st.tools && typeof st.tools === 'object' && st.tools.tool;
  if (tool) add('Code graph', String(tool));
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
    if (o.model) parts.push(String(o.model));
    if (o.effort) parts.push(`${o.effort} effort`);
    if (o.fanOut === true) parts.push(o.subagentModel ? `parallel sub-agents on ${o.subagentModel}` : 'parallel sub-agents');
    else if (o.subagentModel) parts.push(`sub-agents on ${o.subagentModel}`);
    if (o.askQuestions === true) parts.push('asks questions');
    if (parts.length) agents.push({ name: nodeName(n), value: parts.join(' · ') });
  }
  const overWires = over.wires && typeof over.wires === 'object' ? over.wires : {};
  const loops = [];
  for (const w of graph && Array.isArray(graph.wires) ? graph.wires : []) {
    if (!w || !w.loop) continue;
    const max = (overWires[w.id] && overWires[w.id].maxCycles) || w.maxCycles;
    if (!max) continue;
    loops.push({ name: `${nodeName(byId.get(w.from && w.from.node))} → ${nodeName(byId.get(w.to && w.to.node))}`,
      value: `up to ${max} round${max === 1 ? '' : 's'}` });
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
      card.appendChild(t);
    }
    const dl = doc.createElement('dl');
    dl.className = 'run-setup-list';
    for (const it of items) {
      const dt = doc.createElement('dt');
      dt.textContent = it[key];
      const dd = doc.createElement('dd');
      dd.textContent = it.value;
      dl.append(dt, dd);
    }
    card.appendChild(dl);
  };
  group('', model.rows, 'label');
  group('Agents', model.agents, 'name');
  group('Loops', model.loops, 'name');
  return card;
}
