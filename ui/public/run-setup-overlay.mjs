// ui/public/run-setup-overlay.mjs — the run setup overlay of the Requirements page (FEAT-9): before a feature starts a run
// on a saved workflow, the person applies a saved run preset and changes each agent's model and effort and each loop's
// cycle budget — for this run only. The result is the run's per-run `overlay` (POST /api/run); nothing here writes the
// project's config or a preset. New Run's own rows live in app.js; this module presents the same controls over the same
// pure helpers (node-tunables, loop-rows, run-presets-picker), and each agent's model is the columns picker's trigger
// (models/model-columns.mjs: harness › provider › model), so a step can run on another harness than the run's.
// Names are set with textContent only.
import { buildNodeConfigRows } from './node-tunables.mjs';
import { buildFeedbackRows } from './loop-rows.mjs';
import { configWithPreset, presetMenuGroups } from './run-presets-picker.mjs';
import { modelTrigger, columnsValue } from './models/model-columns.mjs';
import { effortsOn, pickEffortsOn } from '../../src/shared/connections.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { indexByKey } from '../../src/shared/graph/agent-meta.mjs';

export const LOAD_FAILED_TEXT = "Could not load this workflow's settings.";
export const PRESETS_UNAVAILABLE_TEXT = 'Saved presets are unavailable.';
export const PRESET_NOTE_TEXT = "Applies the preset's agent and loop settings only.";
export const V1_LOOPS_TEXT = 'Loop budgets of this workflow cannot be set per run.';
export const OTHER_WORKFLOW_TEXT = 'To use another workflow, cancel and change it on the card.';
export const NOTE_LABEL = 'Note for this run (optional)';
export const CHECKING_TEXT = 'Checking your note…';
export const CONFLICT_TITLE = 'Your note may conflict with the spec';
export const RUN_IN_PROGRESS_TEXT = 'This feature already has a run in progress.';
export const NOTE_MAX_LENGTH = 2000;   // NOTE_MAX (src/core/requirements/note-check.mjs)
export const AUTO_WORKFLOW_ID = 'wf_auto';
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
 * The run's overlay from what the overlay shows: every agent row with a model sends `{ model, effort }`, plus `engine` when the
 * row's pick names a harness (exact whatever the
 * project config holds when the run starts), carrying its toggles and role picks from the applied preset's overlay verbatim;
 * every editable loop row sends `{ maxCycles }`. Nothing to send → null. Pure.
 * @param {Array<{nodeId:string, model?:string, effort?:string, engine?:string}>} shownRows
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
    const engine = model ? String(r.engine || '') : '';
    const entry = { ...(model ? { model, effort: String(r.effort || ''), ...(engine ? { engine } : {}) } : {}), ...extras };
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
 * Options: `note` adds an empty, never-stored note box; `checkNote(note, signal)` → `{ conflicts:[{quote,why}] }` (or `{ skipped }`,
 * or a throw: both start the run) is asked before Start when the note is not blank, and a conflict offers Edit note / Start anyway
 * (`onConfirm(overlay, { note, noteOverrides })`); `copy` overrides `{ title, otherWorkflowText }`. `workflowId === 'wf_auto'` shows the
 * note and Start only, and confirms with a null overlay. `engines` is the model picker's readiness getter (app.js's
 * readyEngineRows: (onLoad) => rows | null). @returns {{ close():void }}
 */
export function openRunSetupOverlay({ modal, workflowId, workflowName, projectDir = null, scopeRef, fetchers = null, trigger = null,
  onConfirm, onCancel, document: docArg = null, note: withNote = false, checkNote = null, copy = null, engines = () => null }) {
  const auto = workflowId === AUTO_WORKFLOW_ID;
  const showNote = auto || !!withNote;
  const doc = docArg || globalThis.document;
  const load = fetchers || defaultFetchers();
  let gen = 0;
  let closed = false;
  let busy = false;
  let sending = false;     // a confirm is in flight (the caller's POST)
  let verdict = null;      // { note, conflicts } of the last completed check
  let checking = null;     // the AbortController of a note check in flight
  let data = null;         // { workflow, registry, scripts, portsFn, config, models, engine, slotDefaults, presets|null }
  let presetId = '';
  let shown = [];          // [{ nodeId, label, model, effort, engine }] — the rows as edited
  let loops = [];          // [{ fbId, label, maxCycles (null while the input holds no valid number), editable }]

  const workflowLabel = h(doc, 'b', { 'data-ui': 'runsetup-workflow', text: workflowName || workflowId });
  const title = h(doc, 'h2', { id: 'req-runsetup-title', text: (copy && copy.title) || (auto ? 'Start this run' : 'Set up this run') });
  const body = h(doc, 'div', { class: 'req-runsetup-body' }, auto ? null : h(doc, 'p', { class: 'hint', role: 'status', text: 'Loading…' }));
  const noteInput = showNote ? h(doc, 'textarea', { id: 'req-runsetup-note', class: 'req-runsetup-note-input', 'data-ui': 'runsetup-note', maxlength: NOTE_MAX_LENGTH, rows: 3 }) : null;
  const noteBox = noteInput ? h(doc, 'div', { class: 'req-runsetup-note' },
    h(doc, 'label', { for: 'req-runsetup-note', class: 'req-runsetup-label', text: NOTE_LABEL }), noteInput) : null;
  const msg = h(doc, 'p', { class: 'form-msg err req-runsetup-msg', role: 'alert' });
  const cancel = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'runsetup-cancel', text: 'Cancel' });
  const go = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'runsetup-go', text: 'Start run', disabled: true });
  const btns = h(doc, 'div', { class: 'req-dlg-btns' }, cancel, go);
  const card = h(doc, 'section', { class: 'card req-dialog req-runsetup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-runsetup-title' },
    title,
    h(doc, 'div', { class: 'req-runsetup-wf' }, h(doc, 'span', { class: 'req-runsetup-label', text: 'Workflow' }),
      workflowLabel),
    h(doc, 'p', { class: 'hint req-runsetup-other', text: (copy && copy.otherWorkflowText) || OTHER_WORKFLOW_TEXT }),
    body, noteBox, msg, btns);

  const appliedPreset = () => (data && data.presets ? data.presets.find((p) => p.id === presetId) || null : null);
  const ready = () => (auto || !!data) && !busy && loops.every((l) => !l.editable || l.maxCycles != null);
  const sync = () => { go.disabled = !ready(); cancel.disabled = false; };
  const GO_TEXT = 'Start run';

  function dispose() {
    if (closed) return false;
    closed = true; gen += 1;
    if (checking) checking.abort();
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
    // A row's pick keeps the harness it names (`engine`, '' = the run's), changed in the picker and sent back with it.
    shown = rows.map((r) => ({ nodeId: r.nodeId, label: r.label, model: r.model || '', effort: defaultEffort(r.nodeId) ? '' : r.effort || '',
      engine: r.engine || '' }));
    const v2 = data.workflow.version === 2;
    loops = buildFeedbackRows(data.workflow, data.registry, wfCfg, data.scripts, data.portsFn)
      .map((l) => ({ fbId: l.fbId, label: l.label, shownValue: String(l.maxCycles), maxCycles: validCycles(l.maxCycles) ? l.maxCycles : null, editable: v2 }));
  }

  /** The efforts a model offers where it runs: a pick that names a harness takes that harness's (pickEffortsOn), a soft
   *  one the run's. */
  const effortsFor = (entry, engine) => (engine ? pickEffortsOn(entry, engine) : effortsOn(entry, data.engine));

  function effortSelect(row) {
    const entry = catalogEntry(data.models, row.model);
    const sel = h(doc, 'select', { class: 'req-runsetup-effort', 'data-ui': `effort-${row.nodeId}`, 'aria-label': `${row.label} effort`, disabled: !row.model });
    sel.append(h(doc, 'option', { value: '', text: 'Default effort' }));
    const efforts = effortsFor(entry, row.engine);
    if (row.effort && !efforts.includes(row.effort)) efforts.push(row.effort);
    for (const e of efforts) sel.append(h(doc, 'option', { value: e, text: e }));
    sel.value = row.effort || '';
    return sel;
  }

  function agentRow(row) {
    const model = modelTrigger({ doc, win: doc.defaultView, value: columnsValue(row), catalog: data.models, label: `Model for ${row.label}`,
      cls: 'req-runsetup-model', defaultEngine: data.engine, engines, inheritHint: 'project or workflow default', onAddModel: null });
    model.setAttribute('data-ui', `model-${row.nodeId}`);
    if (row.model && !catalogEntry(data.models, row.model)) model.setAttribute('aria-invalid', 'true');
    let effortWrap = h(doc, 'div', { class: 'select-wrap' }, effortSelect(row));
    const setRow = (patch) => { shown = shown.map((r) => (r.nodeId === row.nodeId ? { ...r, ...patch } : r)); return shown.find((r) => r.nodeId === row.nodeId); };
    // A pick sets the row's model and harness; its effort stays when the picked model offers it on that harness.
    model.addEventListener('change', () => {
      model.removeAttribute('aria-invalid');
      const engine = model.dataset.engine || '';
      const entry = catalogEntry(data.models, model.value);
      const effort = shown.find((r) => r.nodeId === row.nodeId).effort;
      const keep = entry && effortsFor(entry, engine).includes(effort);
      const next = setRow({ model: model.value, engine, effort: keep ? effort : '' });
      const fresh = h(doc, 'div', { class: 'select-wrap' }, effortSelect(next));
      effortWrap.replaceWith(fresh); effortWrap = fresh;
      bindEffort(fresh.firstChild, row.nodeId);
    });
    const bindEffort = (sel, nodeId) => sel.addEventListener('change', () => { shown = shown.map((r) => (r.nodeId === nodeId ? { ...r, effort: sel.value } : r)); });
    bindEffort(effortWrap.firstChild, row.nodeId);
    return h(doc, 'div', { class: 'req-runsetup-row', 'data-node-id': row.nodeId },
      h(doc, 'span', { class: 'req-runsetup-name', text: row.label }), h(doc, 'div', {}, model), effortWrap);
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
      if (!workflowName && typeof workflow.name === 'string' && workflow.name) workflowLabel.textContent = workflow.name;
      derive();
      paint();
    } catch {
      if (mine !== gen) return;
      showLoadFailure();
    }
  }

  /** Disable the note box and every setup control while a start is under way, so what is sent is what the person last saw. */
  function lockForm(on) {
    if (noteInput) noteInput.disabled = on;
    for (const c of body.querySelectorAll('select, input, button.mdl-pick')) {
      if (on) { if (!c.disabled) { c.disabled = true; c.setAttribute('data-form-locked', ''); } }
      else if (c.hasAttribute('data-form-locked')) { c.disabled = false; c.removeAttribute('data-form-locked'); }
    }
  }

  /** The checker's verdict on `note`: its conflicts, or none when it was skipped, threw, or was cancelled (A-7: never blocks a run).
   *  The verdict of an unchanged note is kept, so a retry does not pay for the same check twice. */
  async function conflictsFor(note) {
    if (verdict && verdict.note === note) return verdict.conflicts;
    const controller = new AbortController();
    checking = controller;
    go.textContent = CHECKING_TEXT; go.disabled = true;
    let conflicts = [];
    try {
      const res = await checkNote(note, controller.signal);
      conflicts = res && !res.skipped && Array.isArray(res.conflicts) ? res.conflicts.filter((c) => c && typeof c === 'object') : [];
    } catch { conflicts = []; } finally {
      checking = null;
      if (!closed) go.textContent = GO_TEXT;
    }
    if (!controller.signal.aborted) verdict = { note, conflicts };
    return conflicts;
  }

  function editNote() {
    if (sending) return;
    panel.remove(); btns.hidden = false; busy = false; lockForm(false); sync();
    noteInput.focus();
  }
  const panel = h(doc, 'div', { class: 'req-runsetup-conflicts', role: 'alert' });
  function showConflicts(conflicts, confirmAnyway) {
    const anyway = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'runsetup-anyway', text: 'Start anyway' });
    const edit = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'runsetup-edit-note', text: 'Edit note' });
    edit.addEventListener('click', editNote);
    anyway.addEventListener('click', confirmAnyway);
    panel.replaceChildren(h(doc, 'h3', { text: CONFLICT_TITLE }),
      h(doc, 'ul', {}, ...conflicts.map((c) => h(doc, 'li', {}, h(doc, 'q', { text: String(c.quote || '') }), ' ', h(doc, 'span', { text: String(c.why || '') })))),
      h(doc, 'div', { class: 'req-dlg-btns' }, edit, anyway));
    btns.hidden = true; busy = false;
    btns.after(panel);
    edit.focus();
  }

  /** Hand the run to the caller; an error stays in the overlay (the form back in front), anything else ends it. One at a time. */
  async function confirm(overlay, note, noteOverrides) {
    if (sending) return;
    sending = true; busy = true; msg.textContent = ''; sync();
    for (const b of panel.querySelectorAll('button')) b.disabled = true;
    let result;
    try { result = await onConfirm(overlay, { note, noteOverrides }); } catch (err) { result = { error: (err && err.message) || 'Worca could not start the run. Try again.' }; }
    sending = false;
    if (closed) return;
    busy = false;
    if (result && result.error) { msg.textContent = result.error; panel.remove(); btns.hidden = false; lockForm(false); sync(); return; }
    if (dispose()) modal.close(false);
  }

  cancel.addEventListener('click', () => {
    if (busy && !checking) return;
    if (dispose()) { modal.close(true); onCancel(); }
  });
  go.addEventListener('click', async () => {
    if (!ready()) return;
    const note = noteInput ? noteInput.value.trim() : '';
    const overlay = auto ? null : computeOverlay(shown, loops, appliedPreset() ? appliedPreset().setup.overlay || null : null);   // once, at confirm
    lockForm(true);
    if (note && typeof checkNote === 'function') {
      busy = true; msg.textContent = ''; sync();
      const conflicts = await conflictsFor(note);
      if (closed) return;
      if (conflicts.length) { showConflicts(conflicts, () => confirm(overlay, note, true)); return; }
    }
    await confirm(overlay, note, false);
  });

  modal.open(card, { trigger, first: cancel, canClose: () => !busy || !!checking, onClose: () => { if (dispose()) onCancel(); } });
  if (auto) sync(); else void loadAll();
  return handle;
}
