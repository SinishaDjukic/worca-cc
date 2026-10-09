import { runsOn, effortsOn } from '../../src/shared/connections.mjs';
export const INHERIT_HEAD = Object.freeze({ user: 'Same as my settings', team: 'Team default', default: 'Worca default' });
// The value comes first, where it comes from second — "Claude (default)", "Opus 5.5 · high (team default)" (night-mode-form's SOURCE_TAG).
export const INHERIT_TAIL = Object.freeze({ user: 'your setting', team: 'team default', default: 'default' });
export function inheritText(source, shown) { const head = INHERIT_HEAD[source] || INHERIT_HEAD.user; return shown == null || shown === '' ? head : `${shown} (${INHERIT_TAIL[source] || INHERIT_TAIL.user})`; }
/** The empty option already reads "Claude (default)": drop the explicit option for that same value, so it is not listed twice —
 *  unless it is the one saved here (a pinned value must still show). `value`: the inherited value as an option value. */
export function dropInheritedTwin(select, value) {
  if (value == null || value === '' || select.value === String(value)) return;
  for (const o of [...select.options]) if (o.value !== '' && o.value === String(value)) o.remove();
}
export function inheritedOf(layers, { level = 'project' } = {}) {
  const value = layers || {}; if (level === 'project' && value.user !== undefined) return { value: value.user, source: 'user' };
  if (value.team !== undefined) return { value: value.team, source: 'team' }; return { value: value.default, source: 'default' };
}
export function formatPair(value, catalog = [], fallback = null) {
  if (!value || (!value.model && !value.effort)) return fallback;
  const hit = value.model ? catalog.find((model) => model?.id === value.model) : null;
  const name = value.model ? hit?.label || value.model : 'model default'; return value.effort ? `${name} · ${value.effort}` : name;
}
const STATE = new WeakMap();
const node = (doc, tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const option = (doc, value, label) => { const el = node(doc, 'option', null, label); el.value = value; return el; };
function efforts(doc, select, spec, modelId, keep) {
  const hit = modelId ? (spec.catalog || []).find((model) => model?.id === modelId) : null;
  const own = hit ? effortsOn(hit, spec.engine || 'claude') : []; const list = own.length ? own : (spec.efforts || []); const inh = spec.inherited || {}; const inhEffort = !modelId && inh.value && inh.value.effort;
  select.replaceChildren(option(doc, '', inhEffort ? inheritText(inh.source, inh.value.effort) : 'Model default'));
  for (const effort of list) select.append(option(doc, effort, effort)); select.value = keep && list.includes(keep) ? keep : '';
}
export function renderInheritField(doc, spec) {
  const wrap = node(doc, 'div', 'field inherit-field'); wrap.dataset.setting = spec.id; wrap.dataset.kind = spec.kind;
  const row = node(doc, 'div', 'label-row'); const label = node(doc, 'label', null, spec.label); const badge = node(doc, 'span', 'inherit-badge', 'Project');
  const clear = node(doc, 'button', 'btn btn-ghost btn-mini inherit-clear', spec.level === 'project' ? 'Clear' : 'Use default'); clear.type = 'button'; row.append(label, badge, clear); wrap.append(row);
  if (spec.hint) wrap.append(node(doc, 'small', 'hint', spec.hint));
  const inherited = spec.inherited || { value: undefined, source: 'default' }; const format = spec.format || ((value) => value == null ? null : String(value));
  const shown = spec.kind === 'model' ? formatPair(inherited.value, spec.catalog, spec.defaultLabel || null) : format(inherited.value); let controls;
  if (spec.kind === 'number') { const input = node(doc, 'input', 'input input-mini inherit-input'); input.type = 'number'; if (spec.min != null) input.min = String(spec.min); if (spec.step != null) input.step = String(spec.step); input.value = spec.own == null ? '' : String(spec.own); input.placeholder = inheritText(inherited.source, shown); controls = [input]; }
  else if (spec.kind === 'select') { const select = node(doc, 'select', 'select inherit-input'); select.append(option(doc, '', inheritText(inherited.source, shown))); for (const item of spec.options || []) select.append(option(doc, item.value, item.label)); select.value = spec.own == null ? '' : (spec.fromValue || String)(spec.own); if (inherited.value != null) dropInheritedTwin(select, (spec.fromValue || String)(inherited.value)); controls = [select]; }
  else { const model = node(doc, 'select', 'select inherit-model'); model.setAttribute('aria-label', `${spec.label} model`); model.append(option(doc, '', inheritText(inherited.source, shown))); const catalog = (spec.catalog || []).filter((item) => runsOn(item, spec.engine || 'claude')); for (const item of catalog) model.append(option(doc, item.id, item.label || item.id)); const ownModel = spec.own?.model || ''; if (ownModel && !catalog.some((item) => item.id === ownModel)) model.append(option(doc, ownModel, `${ownModel} — not in the catalog`)); model.value = ownModel; const effort = node(doc, 'select', 'select inherit-effort'); effort.setAttribute('aria-label', `${spec.label} effort`); efforts(doc, effort, spec, ownModel, spec.own?.effort); model.addEventListener('change', () => efforts(doc, effort, spec, model.value, effort.value)); controls = [model, effort]; }
  const line = node(doc, 'div', 'away-input-row inherit-row');
  if (spec.kind === 'model') {   // one row, Model wider than Effort, each named by a caption (the Ask run card's pattern)
    line.classList.add('inherit-pair');
    const cap = (text, control) => { const box = node(doc, 'label', 'inherit-sub'); box.append(node(doc, 'span', 'inherit-sub-cap', text), control); return box; };
    line.append(cap('Model', controls[0]), cap('Effort', controls[1]));
  } else line.append(...controls);
  wrap.append(line); STATE.set(wrap, { spec });
  const paint = () => { const set = readInheritField(wrap) !== null; badge.hidden = !(set && spec.level === 'project'); clear.hidden = !set; };
  const touched = () => { wrap.dataset.dirty = '1'; paint(); }; for (const control of controls) { control.addEventListener('input', touched); control.addEventListener('change', touched); }
  clear.addEventListener('click', () => { for (const control of controls) control.value = ''; if (spec.kind === 'model') efforts(doc, controls[1], spec, '', ''); touched(); }); paint(); return wrap;
}
export function readInheritField(wrap) {
  const spec = STATE.get(wrap)?.spec; if (!spec) return null;
  if (spec.kind === 'number') { const value = wrap.querySelector('.inherit-input').value.trim(); return value === '' ? null : Number(value); }
  if (spec.kind === 'select') { const value = wrap.querySelector('.inherit-input').value; return value === '' ? null : spec.toValue ? spec.toValue(value) : value; }
  const model = wrap.querySelector('.inherit-model').value; const effort = wrap.querySelector('.inherit-effort').value; return !model && !effort ? null : { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
export function readDirtyFields(root) { const out = {}; for (const field of root.querySelectorAll('.inherit-field[data-dirty="1"]')) out[field.dataset.setting] = readInheritField(field); return out; }
