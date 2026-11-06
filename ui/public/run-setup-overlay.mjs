// ui/public/run-setup-overlay.mjs — the run setup overlay of the Requirements page (FEAT-9): before a feature starts a run
// on a saved workflow, the person applies a saved run preset and changes each agent's model and effort and each loop's
// cycle budget — for this run only. The result is the run's per-run `overlay` (POST /api/run); nothing here writes the
// project's config or a preset. New Run's own rows live in app.js; this module presents the same controls over the same
// pure helpers (node-tunables, loop-rows, run-presets-picker, model-options). Names are set with textContent only.
import { buildNodeConfigRows } from './node-tunables.mjs';
import { buildFeedbackRows } from './loop-rows.mjs';
import { configWithPreset, presetMenuGroups } from './run-presets-picker.mjs';
import { appendModelGroups } from './model-options.mjs';
import { effortsOn } from '../../src/shared/connections.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { indexByKey } from '../../src/shared/graph/agent-meta.mjs';

export const LOAD_FAILED_TEXT = "Could not load this workflow's settings.";
export const PRESETS_UNAVAILABLE_TEXT = 'Saved presets are unavailable.';
export const PRESET_NOTE_TEXT = "Applies the preset's agent and loop settings only.";
export const V1_LOOPS_TEXT = 'Loop budgets of this workflow cannot be set per run.';
export const OTHER_WORKFLOW_TEXT = 'To use another workflow, cancel and change it on the card.';
export const MIN_CYCLES = 1;
export const MAX_CYCLES = 100;   // OVERLAY_MAX_CYCLES (src/core/run-overlay.mjs)
const PRESET_TOGGLES = ['fanOut', 'askQuestions', 'subagentModel', 'roles'];

/** The presets the overlay lists: those saved for `workflowId`, and visible to the scope (any project, or this one). */
export function presetsFor(presets, workflowId, scopeRef) {
  return (Array.isArray(presets) ? presets : []).filter((p) => {
    if (!p || !p.setup || p.setup.workflowId !== workflowId) return false;
    const scope = p.scope || {};
    return scope.kind === 'global' || (!!scopeRef && scope.kind === scopeRef.kind && scope.ref === scopeRef.ref);
  });
}

/**
 * The run's overlay from what the overlay shows: every agent row with a model sends `{ model, effort }` (exact whatever the
 * project config holds when the run starts), carrying its toggles and role picks from the applied preset's overlay verbatim;
 * every editable loop row sends `{ maxCycles }`. Nothing to send → null. Pure.
 * @param {Array<{nodeId:string, model?:string, effort?:string}>} shownRows
 * @param {Array<{fbId:string, maxCycles:number, editable?:boolean}>} shownLoops
 * @param {{nodes?:object}|null} presetOverlay
 */
export function computeOverlay(shownRows, shownLoops, presetOverlay = null) {
  const nodes = {};
  for (const r of Array.isArray(shownRows) ? shownRows : []) {
    const model = String(r.model || '').trim();
    const picked = presetOverlay && presetOverlay.nodes && Object.hasOwn(presetOverlay.nodes, r.nodeId) ? presetOverlay.nodes[r.nodeId] : null;
    const extras = {};
    for (const k of PRESET_TOGGLES) if (picked && picked[k] !== undefined) extras[k] = structuredClone(picked[k]);
    const entry = { ...(model ? { model, effort: String(r.effort || '') } : {}), ...extras };
    if (Object.keys(entry).length) nodes[r.nodeId] = entry;
  }
  const wires = {};
  for (const l of Array.isArray(shownLoops) ? shownLoops : []) {
    if (l.editable !== false) wires[l.fbId] = { maxCycles: l.maxCycles };
  }
  const overlay = { ...(Object.keys(nodes).length ? { nodes } : {}), ...(Object.keys(wires).length ? { wires } : {}) };
  return Object.keys(overlay).length ? overlay : null;
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { status: res.status });
  return data;
}
const withDir = (path, projectDir) => (projectDir ? `${path}?projectDir=${encodeURIComponent(projectDir)}` : path);

/** The overlay's loads over `fetch`; tests inject their own. */
export function defaultFetchers(fetchFn = (...a) => globalThis.fetch(...a)) {
  return {
    workflow: async (id) => { const d = await getJson(fetchFn, `/api/workflows/${encodeURIComponent(id)}`); return (d && d.workflow) || d; },
    agents: async () => { const d = await getJson(fetchFn, '/api/agents?all=1'); return Array.isArray(d) ? d : (d && d.agents) || []; },
    scripts: async () => { const d = await getJson(fetchFn, '/api/scripts'); return (d && d.scripts) || []; },
    config: (projectDir) => getJson(fetchFn, withDir('/api/config', projectDir)),
    runDefaults: (projectDir) => getJson(fetchFn, withDir('/api/run-defaults', projectDir)),
    presets: async () => { const d = await getJson(fetchFn, '/api/presets'); return (d && d.presets) || []; },
  };
}

function h(doc, tag, attrs = {}, ...kids) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

const validCycles = (n) => Number.isInteger(n) && n >= MIN_CYCLES && n <= MAX_CYCLES;
const catalogEntry = (models, id) => (id ? (models || []).find((m) => m && String(m.id).toLowerCase() === String(id).toLowerCase()) || null : null);

/**
 * Open the overlay on `modal` (an adapter over the page's own modal: open(card, { trigger, first, canClose, onClose }),
 * close(restore); `onClose` runs however the modal closes). `onConfirm(overlay)` resolves `{ error? }`: an error stays in the
 * overlay, anything else ends it (the caller navigates). Cancel and Escape call `onCancel()` and send nothing.
 * @returns {{ close():void }}
 */
export function openRunSetupOverlay({ modal, workflowId, workflowName, projectDir = null, scopeRef, fetchers = null, trigger = null,
  onConfirm, onCancel, document: docArg = null }) {
  const doc = docArg || globalThis.document;
  const load = fetchers || defaultFetchers();
  let gen = 0;
  let closed = false;
  let busy = false;
  let data = null;         // { workflow, registry, scripts, portsFn, config, models, engine, slotDefaults, presets|null }
  let presetId = '';
  let shown = [];          // [{ nodeId, label, model, effort }] — the rows as edited
  let loops = [];          // [{ fbId, label, maxCycles (null while the input holds no valid number), editable }]

  const title = h(doc, 'h2', { id: 'req-runsetup-title', text: 'Set up this run' });
  const body = h(doc, 'div', { class: 'req-runsetup-body' }, h(doc, 'p', { class: 'hint', role: 'status', text: 'Loading…' }));
  const msg = h(doc, 'p', { class: 'form-msg err req-runsetup-msg', role: 'alert' });
  const cancel = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'runsetup-cancel', text: 'Cancel' });
  const go = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'runsetup-go', text: 'Start run', disabled: true });
  const card = h(doc, 'section', { class: 'card req-dialog req-runsetup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-runsetup-title' },
    title,
    h(doc, 'div', { class: 'req-runsetup-wf' }, h(doc, 'span', { class: 'req-runsetup-label', text: 'Workflow' }),
      h(doc, 'b', { 'data-ui': 'runsetup-workflow', text: workflowName || workflowId })),
    h(doc, 'p', { class: 'hint req-runsetup-other', text: OTHER_WORKFLOW_TEXT }),
    body, msg,
    h(doc, 'div', { class: 'req-dlg-btns' }, cancel, go));

  const appliedPreset = () => (data && data.presets ? data.presets.find((p) => p.id === presetId) || null : null);
  const ready = () => !!data && !busy && loops.every((l) => !l.editable || l.maxCycles != null);
  const sync = () => { go.disabled = !ready(); cancel.disabled = false; };

  function dispose() {
    if (closed) return false;
    closed = true; gen += 1;
    return true;
  }
  const handle = { close() { if (dispose()) modal.close(false); } };

  /** The rows and loops for the applied preset (or none), derived from the project's config as New Run does. */
  function derive() {
    const preset = appliedPreset();
    const cfg = preset ? configWithPreset(data.config, workflowId, preset.setup) : (data.config || {});
    const wfCfg = (cfg.workflows && cfg.workflows[workflowId]) || { nodes: {}, feedbacks: {} };
    const rows = buildNodeConfigRows(data.workflow, data.registry, wfCfg, {
      models: data.models, engine: data.engine, slotDefaults: data.slotDefaults, portsFn: data.portsFn,
      ...(workflowId === 'wf_default' ? { legacySteps: cfg.steps || {} } : {}),
    });
    // A preset's model without an effort means that model's default effort, not the project's saved effort for the node.
    const presetNodes = (preset && preset.setup && preset.setup.overlay && preset.setup.overlay.nodes) || {};
    const defaultEffort = (nodeId) => Object.hasOwn(presetNodes, nodeId) && presetNodes[nodeId].model && !presetNodes[nodeId].effort;
    shown = rows.map((r) => ({ nodeId: r.nodeId, label: r.label, model: r.model || '', effort: defaultEffort(r.nodeId) ? '' : r.effort || '' }));
    const v2 = data.workflow.version === 2;
    loops = buildFeedbackRows(data.workflow, data.registry, wfCfg, data.scripts, data.portsFn)
      .map((l) => ({ fbId: l.fbId, label: l.label, shownValue: String(l.maxCycles), maxCycles: validCycles(l.maxCycles) ? l.maxCycles : null, editable: v2 }));
  }

  function effortSelect(row) {
    const entry = catalogEntry(data.models, row.model);
    const sel = h(doc, 'select', { class: 'req-runsetup-effort', 'data-ui': `effort-${row.nodeId}`, 'aria-label': `${row.label} effort`, disabled: !row.model });
    sel.append(h(doc, 'option', { value: '', text: 'Default effort' }));
    const efforts = effortsOn(entry, data.engine);
    if (row.effort && !efforts.includes(row.effort)) efforts.push(row.effort);
    for (const e of efforts) sel.append(h(doc, 'option', { value: e, text: e }));
    sel.value = row.effort || '';
    return sel;
  }

  function agentRow(row) {
    const model = h(doc, 'select', { class: 'req-runsetup-model', 'data-ui': `model-${row.nodeId}`, 'aria-label': `${row.label} model` });
    model.append(h(doc, 'option', { value: '', text: 'Default model' }));
    appendModelGroups(model, data.models, { engine: data.engine });
    const unknown = !!row.model && !catalogEntry(data.models, row.model);
    if (unknown) { model.append(h(doc, 'option', { value: row.model, text: `${row.model} (not in the model list)` })); model.setAttribute('aria-invalid', 'true'); }
    model.value = row.model || '';
    let effortWrap = h(doc, 'div', { class: 'select-wrap' }, effortSelect(row));
    const setRow = (patch) => { shown = shown.map((r) => (r.nodeId === row.nodeId ? { ...r, ...patch } : r)); return shown.find((r) => r.nodeId === row.nodeId); };
    model.addEventListener('change', () => {
      model.removeAttribute('aria-invalid');
      const entry = catalogEntry(data.models, model.value);
      const keep = entry && effortsOn(entry, data.engine).includes(shown.find((r) => r.nodeId === row.nodeId).effort);
      const next = setRow({ model: model.value, effort: keep ? shown.find((r) => r.nodeId === row.nodeId).effort : '' });
      const fresh = h(doc, 'div', { class: 'select-wrap' }, effortSelect(next));
      effortWrap.replaceWith(fresh); effortWrap = fresh;
      bindEffort(fresh.firstChild, row.nodeId);
    });
    const bindEffort = (sel, nodeId) => sel.addEventListener('change', () => { shown = shown.map((r) => (r.nodeId === nodeId ? { ...r, effort: sel.value } : r)); });
    bindEffort(effortWrap.firstChild, row.nodeId);
    return h(doc, 'div', { class: 'req-runsetup-row', 'data-node-id': row.nodeId },
      h(doc, 'span', { class: 'req-runsetup-name', text: row.label }), h(doc, 'div', { class: 'select-wrap' }, model), effortWrap);
  }

  function loopRow(loop) {
    if (!loop.editable) {
      return h(doc, 'div', { class: 'req-runsetup-loop readonly', 'data-fb-id': loop.fbId },
        h(doc, 'span', { class: 'req-runsetup-name', text: loop.label }), h(doc, 'span', { class: 'hint', text: `${loop.shownValue} cycles` }));
    }
    // a derived value the run would refuse (over the cap) is shown as it is, flagged, and holds Confirm until it is edited
    const input = h(doc, 'input', { type: 'number', min: String(MIN_CYCLES), max: String(MAX_CYCLES), step: '1', value: loop.shownValue,
      class: 'req-runsetup-cycles', 'data-fb-id': loop.fbId, 'aria-label': `Cycles for ${loop.label}`, 'aria-invalid': loop.maxCycles == null ? 'true' : null });
    input.addEventListener('input', () => {
      const n = Number(input.value);
      const valid = input.value.trim() !== '' && Number.isInteger(n) && n >= MIN_CYCLES && n <= MAX_CYCLES;
      input.setAttribute('aria-invalid', valid ? 'false' : 'true');
      loops = loops.map((l) => (l.fbId === loop.fbId ? { ...l, shownValue: input.value, maxCycles: valid ? n : null } : l));
      sync();
    });
    return h(doc, 'div', { class: 'req-runsetup-loop', 'data-fb-id': loop.fbId }, h(doc, 'span', { class: 'req-runsetup-name', text: loop.label }), input);
  }

  function presetPicker() {
    if (!data.presets) return h(doc, 'p', { class: 'hint req-runsetup-presets-off', role: 'status', text: PRESETS_UNAVAILABLE_TEXT });
    const list = presetsFor(data.presets, workflowId, scopeRef);
    if (!list.length) return null;
    const sel = h(doc, 'select', { id: 'req-runsetup-preset', 'data-ui': 'runsetup-preset', 'aria-label': 'Preset' });
    sel.append(h(doc, 'option', { value: '', text: 'No preset' }));
    const names = scopeRef && scopeRef.name ? { [`${scopeRef.kind}:${scopeRef.ref}`]: scopeRef.name } : {};
    for (const g of presetMenuGroups(list, names)) {
      const og = h(doc, 'optgroup', { label: g.label });
      for (const p of g.items) og.append(h(doc, 'option', { value: p.id, text: p.name }));
      sel.append(og);
    }
    sel.value = presetId;
    sel.addEventListener('change', () => { presetId = sel.value; derive(); paint(); });
    return h(doc, 'div', { class: 'req-runsetup-presets' },
      h(doc, 'label', { for: 'req-runsetup-preset', class: 'req-runsetup-label', text: 'Preset' }), h(doc, 'div', { class: 'select-wrap' }, sel),
      h(doc, 'p', { class: 'hint req-runsetup-preset-note', text: PRESET_NOTE_TEXT }));
  }

  function paint() {
    const agents = h(doc, 'div', { class: 'req-runsetup-agents', role: 'group', 'aria-label': 'Agents' },
      ...(shown.length ? shown.map(agentRow) : [h(doc, 'p', { class: 'hint', text: 'This workflow has no agents to set.' })]));
    const editable = loops.some((l) => l.editable);
    const loopBox = loops.length ? h(doc, 'div', { class: 'req-runsetup-loops', role: 'group', 'aria-label': 'Loops' },
      h(doc, 'h3', { text: 'Loops' }), editable ? null : h(doc, 'p', { class: 'hint', text: V1_LOOPS_TEXT }), ...loops.map(loopRow)) : null;
    body.replaceChildren(...[presetPicker(), agents, loopBox].filter(Boolean));
    sync();
  }

  function showLoadFailure() {
    body.replaceChildren(h(doc, 'p', { class: 'form-msg err', role: 'alert', text: LOAD_FAILED_TEXT }));
    go.hidden = true;
  }

  async function loadAll() {
    const mine = gen;
    const presetsP = load.presets().then((p) => (Array.isArray(p) ? p : null), () => null);
    try {
      const [workflow, agents, scripts, cfg, defaults] = await Promise.all([
        load.workflow(workflowId), load.agents(), load.scripts(), load.config(projectDir), load.runDefaults(projectDir)]);
      const presets = await presetsP;
      if (mine !== gen) return;
      if (!workflow || !(Array.isArray(workflow.nodes) || Array.isArray(workflow.steps))) throw new Error('workflow');
      const registry = indexByKey(agents);
      const scriptIndex = indexByKey(scripts);
      const engine = (defaults && defaults.engine && defaults.engine.value) || 'claude';
      data = { workflow, registry, scripts: scriptIndex, portsFn: portsFnFor(registry, scriptIndex),
        config: (cfg && cfg.config) || {}, models: (cfg && Array.isArray(cfg.models) ? cfg.models : []), engine,
        slotDefaults: (defaults && defaults.steps && defaults.steps[engine]) || null, presets };
      derive();
      paint();
    } catch {
      if (mine !== gen) return;
      showLoadFailure();
    }
  }

  cancel.addEventListener('click', () => {
    if (busy) return;
    if (dispose()) { modal.close(true); onCancel(); }
  });
  go.addEventListener('click', async () => {
    if (!ready()) return;
    busy = true; msg.textContent = ''; sync();
    const overlay = computeOverlay(shown, loops, appliedPreset() ? appliedPreset().setup.overlay || null : null);   // once, at confirm
    let result;
    try { result = await onConfirm(overlay); } catch (err) { result = { error: (err && err.message) || 'Worca could not start the run. Try again.' }; }
    if (closed) return;
    busy = false;
    if (result && result.error) { msg.textContent = result.error; sync(); return; }
    if (dispose()) modal.close(false);
  });

  modal.open(card, { trigger, first: cancel, canClose: () => !busy, onClose: () => { if (dispose()) onCancel(); } });
  void loadAll();
  return handle;
}
