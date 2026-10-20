// ui/public/run-presets-picker.mjs — New run's Preset picker (docs/run-presets.md). app.js owns state and
// fetches; this module renders and computes. Names are set with textContent only (a name is user input).
import { PRESET_LIMITS, checkPresetName } from '../../src/shared/run-presets.mjs';
import { presetEngineName, UNKNOWN_ENGINE_LABEL } from './run-presets-names.mjs';

export const BROKEN_SCOPE_HINT = 'Edit the preset\'s scope in Settings › Presets';
// Below Advanced the Presets tab is hidden (docs/ui-levels.md): point at New run's ⋯ menu instead.
export const BROKEN_SCOPE_HINT_SIMPLE = 'Delete the preset from the Preset menu, or switch to Advanced to edit its scope';

/** Group presets for the menu: "Any project" first, then one group per pinned target (label from `names`). */
export function presetMenuGroups(presets, names = {}) {
  const groups = new Map([['global', { label: 'Any project', items: [] }]]);
  for (const p of presets) {
    const key = p.scope.kind === 'global' ? 'global' : `${p.scope.kind}:${p.scope.ref}`;
    if (!groups.has(key)) groups.set(key, { label: names[key] || p.scope.ref, items: [] });
    groups.get(key).items.push(p);
  }
  return [...groups.values()].filter((g) => g.items.length);
}

/**
 * One Agents-row edit as a preset pick: pruneNodeSelection's "inherit" values ('' model, null toggle) become the row's
 * default, since the overlay takes only real values (a null toggle is refused) and a preset holds full picks.
 */
export function presetNodePick(patch, def = {}) {
  const pick = {};
  const model = patch.model || def.model || '';
  if (model) { pick.model = model; pick.effort = patch.model ? (patch.effort || '') : (def.effort || ''); }
  for (const k of ['fanOut', 'askQuestions']) {
    if (typeof patch[k] === 'boolean') pick[k] = patch[k];
    else if (patch[k] === null) pick[k] = !!def[k];
  }
  const sub = patch.subagentModel || def.subagentModel || '';
  if (sub) pick.subagentModel = sub;
  return pick;
}

/** The Simple-mode note items a preset adds (#712: settings a preset applies but Simple mode hides). */
export function presetHiddenItems(setup) {
  const items = [];
  // A stored setup names every agent node (full picks), some with only their toggles: an agent pick is a model pick.
  const n = Object.values(setup?.overlay?.nodes || {}).filter((p) => p && typeof p.model === 'string' && p.model).length;
  if (n) items.push(n === 1 ? '1 agent pick' : `${n} agent picks`);
  const w = Object.keys(setup?.overlay?.wires || {}).length;
  if (w) items.push(w === 1 ? '1 loop budget' : `${w} loop budgets`);
  if (setup?.nightMode) items.push('Away mark');
  const o = (setup?.mcpOptOut || []).length;
  if (o) items.push(o === 1 ? '1 Sets opt-out' : `${o} Sets opt-outs`);
  // An engine outside the catalog is "Unknown engine", not "Unknown engine engine".
  if (setup?.engine && setup.engine !== 'claude') {
    const label = presetEngineName(setup.engine);
    items.push(label === UNKNOWN_ENGINE_LABEL ? label : `${label} engine`);
  }
  if (setup?.mock) items.push('Mock mode');
  return items;
}

/** The broken card: one row per item with the server's exact message; Reset only where the item allows it. */
export function renderBrokenCard(doc, broken, { onReset, canEditScope = true } = {}) {
  const card = doc.createElement('div');
  card.className = 'card card-warn preset-broken';
  card.hidden = !broken.length;
  const h = doc.createElement('strong');
  h.textContent = 'This preset needs attention';
  card.append(h);
  for (const b of broken) {
    const row = doc.createElement('div');
    row.className = 'preset-broken-row';
    row.dataset.item = b.item;
    const msg = doc.createElement('span');
    msg.textContent = b.message;
    row.append(msg);
    if (b.reset) {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-sm'; btn.textContent = 'Reset to default';
      btn.addEventListener('click', () => onReset && onReset(b));
      row.append(btn);
    } else {
      const hint = doc.createElement('span');
      hint.className = 'muted';
      hint.textContent = canEditScope ? BROKEN_SCOPE_HINT : BROKEN_SCOPE_HINT_SIMPLE;
      row.append(hint);
    }
    card.append(row);
  }
  return card;
}

/** Apply a Reset to a setup (returns a new setup): drop the pick so the project default applies. */
export function resetItem(setup, item, { projectWorkflowId = 'wf_default', defaultEngine = 'claude' } = {}) {
  const next = structuredClone(setup);
  if (item.item === 'guardrails') delete next.guardrailsId;
  else if (item.item === 'engine') next.engine = defaultEngine;
  else if (item.item === 'workflow') { next.workflowId = projectWorkflowId; delete next.overlay; }
  else if ((item.item === 'model' || item.item === 'node') && next.overlay?.nodes) delete next.overlay.nodes[item.ref];
  else if (item.item === 'loop' && next.overlay?.wires) delete next.overlay.wires[item.ref];
  return next;
}

/** The run config the Agents rows render in preset mode: the project's config with the preset's picks merged over it per node and per wire. Never mutates `config`. */
export function configWithPreset(config, workflowId, setup) {
  const out = structuredClone(config || {});
  const wf = workflowId || 'wf_default';
  out.workflows = out.workflows || {};
  const cur = out.workflows[wf] || { nodes: {}, feedbacks: {} };
  const nodes = { ...(cur.nodes || {}) };
  for (const [id, pick] of Object.entries(setup?.overlay?.nodes || {})) nodes[id] = { ...(nodes[id] || {}), ...pick };
  const wires = { ...(cur.wires || {}) };
  for (const [id, w] of Object.entries(setup?.overlay?.wires || {})) wires[id] = { ...(wires[id] || {}), ...w };
  out.workflows[wf] = { ...cur, nodes, wires };
  if (typeof setup?.humanInLoop === 'boolean') out.humanInLoop = setup.humanInLoop;
  return out;
}

/** Validate the Save dialog: '' or the message to show under the Name field. */
export function saveDialogError(name, existingNames) {
  const bad = checkPresetName(name);
  if (bad) return bad;
  if (existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())) return 'A preset with this name already exists';
  return '';
}
export { PRESET_LIMITS };
