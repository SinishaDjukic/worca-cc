// ui/public/models/model-picker.mjs — the one model and effort picker every pick on the Jobs tab uses (models-menu P6,
// DESIGN JOB-3…JOB-5, CAT-8), drawn and worked as the Chat composer's picker (ask-panel.mjs openPopover / menuItem,
// design/model-pills.mjs): the clear item, the harness's short list (one per family, your own, the picked one), Effort ›
// and More models ›, each sub-pane redrawn in place with a back row. A value is { model?, effort? } or null (nothing
// stored). The data half (splitForPicker, pickerItems, applyPick, pickLabel, modelName) is pure and loads under node;
// only openModelPicker touches a document, the one it is given. The button that opens it is the caller's: it wears
// .mdl-pick (span.mdl-pick-text, span.mdl-pick-eff, a chevron icon; .inherit when the row follows something) and gets
// aria-expanded from here while its menu is open.
import { runsOn, modelGroups, effortsOn, HARNESS_EFFORTS } from '../../../src/shared/connections.mjs';
import { CLI_DECIDES, isCliDecides } from '../../../src/shared/model-roles.mjs';
import { displayName } from './catalogue-model.mjs';
import { modelMark } from './brand-marks.mjs';
import { placeFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';

const str = (v) => (typeof v === 'string' && v ? v : '');
const modelOf = (value) => (value && typeof value === 'object' ? str(value.model) : '');
const effortOf = (value) => (value && typeof value === 'object' ? str(value.effort) : '');
const rowsOf = (catalog) => (Array.isArray(catalog) ? catalog : []).filter((m) => m && typeof m.id === 'string' && m.id);
const harnessEfforts = (engine) => [...(HARNESS_EFFORTS[engine || 'claude'] || [])];
/** A value with only the keys it holds; neither → null. */
const shape = (model, effort) => (model || effort ? { ...(model ? { model } : {}), ...(effort ? { effort } : {}) } : null);
/** /api/config rows carry `upstreamModel`, not `upstream`: what displayName and the mark's vendor lookup read. */
const withUpstream = (m) => ({ ...m, upstream: m.upstream || (m.upstreamModel ? { model: m.upstreamModel } : undefined) });
const missingText = (id) => `${id} (not in the catalog)`;

/** The family a built-in belongs to, so only the newest of each is up front (ask-panel.mjs familyKey, model-pills). */
function familyKey(m) {
  if ((m.engine || 'claude') === 'copilot' && m.id.startsWith('copilot/')) {
    return `copilot:${(m.id.slice('copilot/'.length).match(/^[a-z]+(?:-[a-z]+)*/) || ['other'])[0]}`;
  }
  const fam = (m.id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1];
  if (fam) return `claude:${fam}`;
  if (m.custom === 'plugin' && m.plugin) return `plugin:${m.plugin}`;
  return 'other';
}

/** The /api/config row's name: displayName with upstream filled from upstreamModel. */
export function modelName(m) {
  if (!m || typeof m !== 'object') return '';
  return displayName(withUpstream(m));
}

/** The short list and the rest, for one harness (runsOn). Order of checks: the current id → primary (even hidden or
 *  blocked, even from another harness) and its family counts as seen; not on the harness → dropped; hidden → dropped;
 *  needsSignIn → rest, { blocked: true, hint } where hint = signInReason 'no_key' ? "Needs key" : "Needs sign-in";
 *  custom === 'global' → primary; first of its family → primary; else rest. Families are met in catalogue order, as
 *  the Chat picker's: one met before the current id keeps its place. Entries are { ...row, blocked?, hint? } copies in
 *  catalogue order. */
export function splitForPicker(catalog, engine, current = '') {
  const primary = [];
  const rest = [];
  const seen = new Set();
  for (const m of rowsOf(catalog)) {
    if (current && m.id === current) { primary.push({ ...m }); seen.add(familyKey(m)); continue; }
    if (!runsOn(m, engine)) continue;
    if (m.hidden) continue;
    if (m.needsSignIn) { rest.push({ ...m, blocked: true, hint: m.signInReason === 'no_key' ? 'Needs key' : 'Needs sign-in' }); continue; }
    if (m.custom === 'global') { primary.push({ ...m }); continue; }
    const fam = familyKey(m);
    if (seen.has(fam)) rest.push({ ...m });
    else { seen.add(fam); primary.push({ ...m }); }
  }
  return { primary, rest };
}

/** One pane's rows. pane: 'main' | 'effort' | 'more'.
 *  Item = { kind: 'item'|'head'|'sep', label, hint?, tick: boolean, disabled: boolean, next?, back?, model?, act? }
 *  (tick and disabled always present, false when not set); act: { type: 'clear' } | { type: 'model', id } |
 *  { type: 'effort', effort } | { type: 'pane', pane }.
 *  main: the clear item (label = clearLabel, ticked when value has no model and no effort), the "Let <tool> decide"
 *    item when decideLabel is given (act cli, ticked when the value isCliDecides), a separator, the primary
 *    models (under a 'head' per connection when modelGroups gives more than one group), a separator, "Effort" (next;
 *    hint = the effort or "Model default"; disabled when there is no model and !allowEffortOnly; disabled with hint
 *    "not supported" when modelOnly or when the effort list below is empty), and "More models" (next) when rest is
 *    not empty.
 *  effort: back row "Effort", a separator, "Model default" (ticked when no effort), then the model's efforts
 *    (effortsOn), or HARNESS_EFFORTS[engine] when no model is picked or the id is not in the catalogue.
 *  more: back row "Models", a separator, the rest (grouped the same way; blocked ones disabled with their hint).
 *  A current id the catalogue does not have is listed first among the primary as "<id> (not in the catalog)". */
export function pickerItems({ catalog, engine, value = null, clearLabel, decideLabel = '', modelOnly = false, allowEffortOnly = false, pane = 'main' }) {
  const rows = rowsOf(catalog);
  const model = modelOf(value);
  const effort = effortOf(value);
  const entry = model ? rows.find((m) => m.id === model) || null : null;
  const efforts = entry ? effortsOn(entry, engine) : harnessEfforts(engine);
  const item = (label, extra = {}) => ({ kind: 'item', label, tick: false, disabled: false, ...extra });
  const sep = () => ({ kind: 'sep', label: '', tick: false, disabled: false });
  const back = (label) => item(label, { back: true, act: { type: 'pane', pane: 'main' } });
  const byConnection = (models) => {
    const groups = modelGroups(models, { engine: engine || 'claude' });
    const out = [];
    for (const g of groups) {
      if (groups.length > 1) out.push({ kind: 'head', label: g.label, tick: false, disabled: false });
      for (const m of g.models) {
        out.push(item(modelName(m), { tick: m.id === model, disabled: !!m.blocked, ...(m.blocked ? { hint: m.hint } : {}), model: m, act: { type: 'model', id: m.id } }));
      }
    }
    return out;
  };
  if (pane === 'effort') {
    return [
      back('Effort'), sep(),
      item('Model default', { tick: !effort, act: { type: 'effort', effort: '' } }),
      ...efforts.map((e) => item(e, { tick: e === effort, act: { type: 'effort', effort: e } })),
    ];
  }
  const split = splitForPicker(rows, engine, model);
  if (pane === 'more') return [back('Models'), sep(), ...byConnection(split.rest)];
  const decides = isCliDecides(value);
  const out = [item(str(clearLabel), { tick: !decides && !model && !effort, act: { type: 'clear' } })];
  // #1450 "Let Claude Code decide": a role tile on Claude Code or Codex only (the caller passes decideLabel).
  if (str(decideLabel)) out.push(item(str(decideLabel), { tick: decides, act: { type: 'cli' } }));
  out.push(sep());
  if (model && !entry) out.push(item(missingText(model), { tick: true, act: { type: 'model', id: model } }));
  out.push(...byConnection(split.primary), sep());
  const unsupported = modelOnly || !efforts.length;
  out.push(item('Effort', {
    next: true,
    hint: unsupported ? 'not supported' : effort || 'Model default',
    disabled: unsupported || (!model && !allowEffortOnly),
    act: { type: 'pane', pane: 'effort' },
  }));
  if (split.rest.length) out.push(item('More models', { next: true, act: { type: 'pane', pane: 'more' } }));
  return out;
}

/** What a pick turns the value into. model: keeps the effort when the new model has it (effortsOn), else drops it;
 *  when modelOnly, never an effort; the stored id the catalogue lost, picked again, keeps its effort. effort: sets it
 *  ('' = model default, the key is dropped); with no model, only when allowEffortOnly (else the value is unchanged; a
 *  modelOnly value never takes one either). clear: null. A pane act leaves the value as it is. A result with neither
 *  key is null. */
export function applyPick(value, act, { catalog, engine, modelOnly = false, allowEffortOnly = false } = {}) {
  const model = modelOf(value);
  const effort = effortOf(value);
  const type = act && typeof act === 'object' ? act.type : '';
  if (type === 'clear') return null;
  if (type === 'cli') return { ...CLI_DECIDES };
  if (type === 'model' && str(act.id)) {
    if (modelOnly || !effort) return shape(act.id, '');
    const entry = rowsOf(catalog).find((m) => m.id === act.id);
    // The ticked "<id> (not in the catalog)" row picked again: nothing to check the effort against, so it stays.
    if (!entry && act.id === model) return shape(model, effort);
    return shape(act.id, entry && effortsOn(entry, engine).includes(effort) ? effort : '');
  }
  if (type === 'effort') {
    if (modelOnly || (!model && !allowEffortOnly)) return value;
    return shape(model, str(act.effort));
  }
  return value;
}

/** The button's content for a value: { model: Entry|null, text, effort, missing } where text is modelName of the
 *  model, or "<id> (not in the catalog)" (missing: true); null value → { model: null, text: '', effort: '', missing: false }.
 *  An effort-only value has no model and no text, only its effort. */
export function pickLabel(value, catalog) {
  const model = modelOf(value);
  const effort = effortOf(value);
  if (!model) return { model: null, text: '', effort, missing: false };
  const entry = rowsOf(catalog).find((m) => m.id === model);
  return entry ? { model: entry, text: modelName(entry), effort, missing: false } : { model: null, text: missingText(model), effort, missing: true };
}

// ---- the open menu ---------------------------------------------------------------------------------------------------
/** The open picker of each document: { anchor, close }. */
const OPEN = new WeakMap();

function make(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** span.ask-model-check: the Chat picker's tick. */
function checkMark(doc) {
  const c = make(doc, 'span', 'ask-model-check');
  c.append(icon(doc, 'check', 12));
  return c;
}

/** Why a disabled item is off, for its title. */
function offTitle(item, { model, modelOnly }) {
  if (item.model) return str(item.model.signInMessage) || 'Its provider is not set up yet. Set it up on the Providers tab.';
  if (item.hint === 'not supported') {
    if (modelOnly) return 'This job takes a model only, with no effort.';
    return model ? 'This model takes no reasoning effort.' : 'This harness takes no reasoning effort.';
  }
  return 'Pick a model to change the effort.';
}

/** One pickerItems row as the Chat grammar draws it. */
function itemNode(doc, item, ctx, onAct) {
  if (item.kind === 'sep') {
    const d = make(doc, 'div', 'ask-pop-divider');
    d.setAttribute('role', 'separator');
    return d;
  }
  if (item.kind === 'head') return make(doc, 'div', 'ask-pop-subgroup', item.label);
  const act = item.act || {};
  const cls = item.back ? 'ask-pane-back'
    : item.next ? (act.pane === 'effort' ? 'ask-effort-row' : 'ask-more-models')
      : act.type === 'effort' ? 'ask-effort-item' : 'ask-model-item';
  const b = make(doc, 'button', `menu-item ask-pop-item ${cls}`);
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.tabIndex = -1;
  if (item.back) b.append(make(doc, 'span', null, `‹ ${item.label}`));
  else if (item.next) {
    b.append(make(doc, 'span', null, item.label));
    if (item.hint) b.append(make(doc, 'span', 'ask-pop-row-value', item.hint));
    if (!item.disabled) b.append(make(doc, 'span', 'ask-pop-row-chev', '›'));
  } else {
    if (item.model) b.append(modelMark(doc, withUpstream(item.model), 'sm'));
    b.append(make(doc, 'span', 'ask-model-name', item.label));
    if (item.hint) b.append(make(doc, 'span', 'ask-pop-row-value', item.hint));
    if (item.tick) b.append(checkMark(doc));
  }
  if (item.tick) b.dataset.ticked = '';
  if (item.disabled) {
    b.disabled = true;
    b.title = offTitle(item, ctx);
  }
  // A synthetic click reaches a disabled button too (jsdom, app code): it does nothing.
  b.addEventListener('click', () => { if (!b.disabled) onAct(act); });
  return b;
}

/** Opens the menu at `anchor` (one open picker per document; a second call on the same anchor closes it instead —
 *  a toggle, as ask-panel's openPopover does — and another anchor's menu closes first). Appended to body, placed below
 *  the anchor with placeFlyout (again when the page scrolls or the window resizes), focus on the ticked item, else the
 *  first enabled one. Arrow keys (wrapping), Home, End move among enabled items; Enter/Space pick. A model, an effort
 *  or the clear item removes the menu, focuses the anchor, THEN calls onPick(newValue) (as openMenu does: a repaint
 *  inside onPick can then restore focus by data-setting); pane rows re-draw in place and focus the new pane's first
 *  enabled item. Escape (document capture listener, stopImmediatePropagation) removes it and focuses the anchor; a
 *  pointerdown outside it and the anchor, or focus moving outside both, removes it without moving focus. The anchor's
 *  aria-expanded follows. → { close() } (a no-op once closed) */
export function openModelPicker({ doc, win, anchor, catalog, engine, value, clearLabel, decideLabel = '', modelOnly = false, allowEffortOnly = false, onPick }) {
  const prev = OPEN.get(doc);
  if (prev) {
    prev.close();
    if (prev.anchor === anchor) return { close() {} };
  }
  const view = win || doc.defaultView;
  const opts = { catalog, engine, value: value ?? null, clearLabel, decideLabel, modelOnly: !!modelOnly, allowEffortOnly: !!allowEffortOnly };
  const ctx = { model: modelOf(value), modelOnly: !!modelOnly };
  const root = make(doc, 'div', 'menu ask-pop ask-pop-model mdl-pick-pop');
  root.setAttribute('role', 'menu');
  let closed = false;

  const enabled = () => [...root.querySelectorAll('[role="menuitem"]:not([disabled])')];
  const focusItem = (b) => {
    if (!b) return;
    for (const x of root.querySelectorAll('[role="menuitem"]')) x.tabIndex = -1;
    b.tabIndex = 0;
    try { b.focus(); } catch { /* detached */ }
  };
  const place = () => placeFlyout(root, anchor, { mode: 'below', win: view });

  function close(refocus) {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onEscape, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('scroll', onScroll, true);
    if (view) view.removeEventListener('resize', place);
    root.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (OPEN.get(doc)?.anchor === anchor) OPEN.delete(doc);
    if (refocus) { try { anchor.focus(); } catch { /* detached */ } }
  }

  function onAct(act) {
    if (act.type === 'pane') {
      draw(act.pane);
      focusItem(enabled()[0]);
      return;
    }
    const next = applyPick(opts.value, act, opts);
    close(true);
    if (typeof onPick === 'function') onPick(next);
  }

  function draw(pane) {
    root.replaceChildren(...pickerItems({ ...opts, pane }).map((item) => itemNode(doc, item, ctx, onAct)));
    place();
  }

  function onEscape(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close(true);
  }
  const outside = (t) => !!t && t.nodeType === 1 && !root.contains(t) && !anchor.contains(t);
  function onPointerDown(e) { if (outside(e.target)) close(false); }
  function onFocusIn(e) { if (outside(e.target)) close(false); }
  function onScroll(e) { if (!(e.target && e.target.nodeType === 1 && root.contains(e.target))) place(); }

  root.addEventListener('keydown', (e) => {
    const list = enabled();
    if (!list.length) return;
    const at = list.indexOf(doc.activeElement);
    const go = (i) => focusItem(list[(i + list.length) % list.length]);
    if (e.key === 'ArrowDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(at < 0 ? -1 : at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(list.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) { e.preventDefault(); list[at].click(); }
  });

  doc.body.append(root);
  draw('main');
  anchor.setAttribute('aria-expanded', 'true');
  const handle = { anchor, close: () => close(false) };
  OPEN.set(doc, handle);
  focusItem(enabled().find((b) => 'ticked' in b.dataset) || enabled()[0]);
  doc.addEventListener('keydown', onEscape, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('scroll', onScroll, true);
  if (view) view.addEventListener('resize', place);
  return { close: () => close(false) };
}
