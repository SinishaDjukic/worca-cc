// ui/public/model-switch.mjs
// The run's "Models" panel (run detail, both screens) for a running or paused run: one row per agent
// stage of the manifest, model + effort + sub-agent model + sub-agent effort; locked rows are stages
// that are running or finished for good.
// Pure DOM — returns a detached element; app.js mounts it and owns the fetches. Data comes from
// GET /api/pipelines/:id/models (src/core/model-switch.mjs describeModelSwitch).
import { h } from './script-forms.mjs';

export const FIELDS = Object.freeze(['model', 'effort', 'subagentModel', 'subagentEffort']);
const FIELD_NAME = { model: 'model', effort: 'effort', subagentModel: 'sub-agent model', subagentEffort: 'sub-agent effort' };
const STATE_LABEL = { completed: 'completed', paused: 'paused here', pending: 'not started',
  running: 'running now', 'may-rerun': 'ran · may run again' };

export const effortsFor = (models, modelId) => (models || []).find((m) => m.id === modelId)?.efforts || [];

/** Keep the effort when the model offers it, else '' (default) — always a valid pair. */
export function reconcileEffort(models, modelId, effort) {
  return effort && effortsFor(models, modelId).includes(effort) ? effort : '';
}

/** Only touched fields of switchable stages; `effort` always rides with `model` (the server
 *  checks the merged model/effort pair). */
export function diffChanges(stages, picks) {
  const out = {};
  for (const s of stages || []) {
    const p = picks?.[s.nodeId];
    if (!s.switchable || !p) continue;
    const ch = {};
    for (const f of FIELDS) if ((p[f] ?? '') !== (s[f] ?? '')) ch[f] = p[f] ?? '';
    if ('model' in ch && !('effort' in ch)) ch.effort = p.effort ?? '';
    if (Object.keys(ch).length) out[s.nodeId] = ch;
  }
  return out;
}

function fillSelect(doc, sel, items, value) {
  sel.replaceChildren();
  for (const it of items) {
    const o = doc.createElement('option');
    o.value = it.value; o.textContent = it.text;
    sel.appendChild(o);
  }
  sel.value = items.some((it) => it.value === value) ? value : '';
}

/** Default + `list`; a stored value the list does not hold still shows as itself (it is what the stage
 *  holds now), so rendering never changes a pick. */
function listItems(defaultText, list, current) {
  const items = [{ value: '', text: defaultText }, ...(list || []).map((v) => ({ value: v, text: v }))];
  if (current && !items.some((it) => it.value === current)) items.push({ value: current, text: `${current} (not offered on this run)` });
  return items;
}

function modelItems(payload, current) {
  const items = [{ value: '', text: payload.runDefault ? `Default (${payload.runDefault})` : 'Default' }];
  for (const m of payload.models || []) items.push({ value: m.id, text: m.label || m.id });
  // A frozen model that left the catalog still shows as itself (it is what the stage holds now).
  if (current && !items.some((it) => it.value === current)) items.push({ value: current, text: `${current} (not offered on this run)` });
  return items;
}

/** The toast after a save: what changed, what a running run skipped, and the warnings. */
export function switchNotice(out) {
  const n = out?.changed?.length || 0;
  const skipped = Array.isArray(out?.skipped) ? out.skipped : [];
  const detail = [
    ...skipped.map((s) => `${s.label} ${s.reason === 'running' ? 'had already started' : 'already completed'} — kept its model.`),
    ...(out?.warnings || []),
  ].join(' ');
  return {
    tone: !n && skipped.length ? 'warn' : 'ok',
    title: n ? `Switched ${n} ${n === 1 ? 'stage' : 'stages'}` : 'Nothing switched',
    detail,
  };
}

/**
 * @param {object} payload describeModelSwitch's shape
 * @param {{doc?:Document, onSave?:(x:{changes:object, resume:boolean})=>Promise<void>, onCancel?:()=>void}} [opts]
 * @returns {{el:HTMLElement, picks:()=>object, showError:(msg:string)=>void, setBusy:(b:boolean)=>void}}
 */
export function renderModelSwitchPanel(payload, { doc = globalThis.document, onSave, onCancel } = {}) {
  const picks = {};
  const selects = {};   // nodeId -> { model, effort, locked }
  const live = payload.status === 'running';
  const root = h(doc, 'section', 'msw');
  root.dataset.mode = live ? 'running' : 'paused';
  root.setAttribute('aria-label', 'Switch models');
  const head = h(doc, 'div', 'msw-head');
  head.appendChild(h(doc, 'b', 'msw-title', live
    ? 'Switch models for the stages that have not started'
    : 'Switch models for the remaining stages'));
  head.appendChild(h(doc, 'small', 'msw-sub', live
    ? 'This run only. Each stage uses its new model when it starts; a stage that is running keeps its model.'
    : 'This run only. A stage whose model changes starts a fresh session when the run resumes.'));
  root.appendChild(head);
  if (payload.pauseDetail) root.appendChild(h(doc, 'p', 'msw-why', payload.pauseDetail));
  const allLocked = !!payload.modelForAll;   // run-harness _nodeModelPair ignores per-stage model/effort
  // Named after the Resume menu item that set it (index.html .resume-with-model), not this panel.
  if (allLocked) root.appendChild(h(doc, 'p', 'msw-note', `This run was resumed with ${payload.modelForAll} for every remaining stage (Resume › Switch model…) — per-stage models and efforts do not apply.`));

  // Fill-only (render): shows the stored effort even if its model does not offer it; never touches picks.
  const fillEffort = (nodeId) => {
    const s = selects[nodeId];
    const p = picks[nodeId];
    const offered = effortsFor(payload.models, p.model);
    fillSelect(doc, s.effort, listItems('Default', offered, p.effort), p.effort);
    s.effort.disabled = s.locked || !p.model || allLocked || offered.length === 0;
  };
  // A user model change (or "Set all to…"): keep the effort only if the new model offers it.
  const syncEffort = (nodeId) => {
    const p = picks[nodeId];
    p.effort = reconcileEffort(payload.models, p.model, p.effort);
    fillEffort(nodeId);
  };

  const table = h(doc, 'table', 'msw-table');
  const thead = h(doc, 'tr', 'msw-hrow');
  for (const t of ['Stage', 'Model', 'Effort', 'Sub-agents', 'Sub-agent effort']) thead.appendChild(h(doc, 'th', '', t));
  table.appendChild(thead);

  // "All remaining stages": one model for every switchable row (the usage-limit case).
  const switchable = (payload.stages || []).filter((s) => s.switchable);
  if (switchable.length > 1) {
    const tr = h(doc, 'tr', 'msw-all-row');
    tr.appendChild(h(doc, 'td', 'msw-stage', 'All remaining stages'));
    const td = h(doc, 'td');
    const all = h(doc, 'select', 'msw-all ins-select');
    all.setAttribute('aria-label', 'Set every remaining stage to a model');
    fillSelect(doc, all, [{ value: '__keep', text: 'Set all to…' }, ...modelItems(payload, '')], '__keep');
    all.disabled = allLocked;
    all.addEventListener('change', () => {
      if (all.value === '__keep') return;
      for (const s of switchable) {
        picks[s.nodeId].model = all.value;
        selects[s.nodeId].model.value = all.value;
        syncEffort(s.nodeId);
      }
      all.value = '__keep';   // an action, not a state: the rows now hold the pick
    });
    td.appendChild(all);
    tr.appendChild(td);
    tr.appendChild(h(doc, 'td')); tr.appendChild(h(doc, 'td')); tr.appendChild(h(doc, 'td'));
    table.appendChild(tr);
  }

  for (const s of payload.stages || []) {
    picks[s.nodeId] = { model: s.model || '', effort: s.effort || '', subagentModel: s.subagentModel || '', subagentEffort: s.subagentEffort || '' };
    const locked = !s.switchable;
    const tr = h(doc, 'tr', `msw-row${locked ? ' is-locked' : ''}`);
    tr.dataset.node = s.nodeId;
    const stage = h(doc, 'td', 'msw-stage');
    stage.appendChild(h(doc, 'span', 'msw-label', s.label));
    stage.appendChild(h(doc, 'small', `msw-state st-${s.state}`, STATE_LABEL[s.state] || s.state));
    tr.appendChild(stage);

    const mk = (field, items, value) => {
      const sel = h(doc, 'select', 'ins-select');
      sel.dataset.field = field;
      sel.setAttribute('aria-label', `${s.label} ${FIELD_NAME[field]}`);
      fillSelect(doc, sel, items, value);
      sel.disabled = locked || (allLocked && (field === 'model' || field === 'effort'));
      sel.addEventListener('change', () => {
        picks[s.nodeId][field] = sel.value;
        if (field === 'model') syncEffort(s.nodeId);
      });
      const td = h(doc, 'td');
      td.appendChild(sel);
      tr.appendChild(td);
      return sel;
    };
    selects[s.nodeId] = { locked };
    selects[s.nodeId].model = mk('model', modelItems(payload, s.model), s.model || '');
    selects[s.nodeId].effort = mk('effort', [{ value: '', text: 'Default' }], '');
    fillEffort(s.nodeId);
    // Sub-agent cells: only the values this run's engine applies (describeModelSwitch subagentModels /
    // subagentEfforts); a field it takes none of reads '—', like a stage without fan-out.
    const fan = s.fanOut && payload.subagents !== false;
    const subField = (field, defaultText, list) => {
      if (fan && list?.length) mk(field, listItems(defaultText, list, s[field] || ''), s[field] || '');
      else tr.appendChild(h(doc, 'td', 'msw-na', '—'));
    };
    subField('subagentModel', 'Default (agent picks)', payload.subagentModels);
    subField('subagentEffort', 'Default', payload.subagentEfforts);
    table.appendChild(tr);
  }
  root.appendChild(table);

  const err = h(doc, 'div', 'msw-error');
  err.hidden = true;
  root.appendChild(err);
  const actions = h(doc, 'div', 'msw-actions');
  const cancel = h(doc, 'button', 'msw-cancel btn', 'Cancel');
  const save = h(doc, 'button', live ? 'msw-save btn btn-primary' : 'msw-save btn', 'Save');
  // A running run has nothing to resume: Save is the primary action.
  const saveResume = live ? null : h(doc, 'button', 'msw-save-resume btn btn-primary', 'Save & resume');
  const buttons = [cancel, save, ...(saveResume ? [saveResume] : [])];
  for (const b of buttons) { b.type = 'button'; actions.appendChild(b); }
  root.appendChild(actions);

  const api = {
    el: root,
    picks: () => JSON.parse(JSON.stringify(picks)),
    showError: (msg) => { err.textContent = msg || ''; err.hidden = !msg; },
    setBusy: (busy) => { for (const b of buttons) b.disabled = !!busy; },
  };
  const submit = async (resume) => {
    api.showError('');
    api.setBusy(true);
    try { await onSave?.({ changes: diffChanges(payload.stages, picks), resume }); }
    catch (e) { api.showError(e?.message || String(e)); }
    finally { api.setBusy(false); }
  };
  save.addEventListener('click', () => { void submit(false); });
  saveResume?.addEventListener('click', () => { void submit(true); });
  cancel.addEventListener('click', () => onCancel?.());
  return api;
}
