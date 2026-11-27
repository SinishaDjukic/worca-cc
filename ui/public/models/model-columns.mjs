// ui/public/models/model-columns.mjs — the cascading-columns model picker (spec 2026-11-26 "The picker"): one step's
// model, picked as harness › provider › model in three columns, with inherit on top. A value is { model, engine } or
// null (inherit); a pick always names the harness of the column it was picked in, and effort stays with each surface.
// The data half (harnessTree, initialColumns, selectColumn, stepColumns, columnsValue, columnsLabel, pickHarness,
// pickEfforts, nodeModelPatch, columnHeight) is pure and loads under node; only openModelColumns touches a document,
// the one it is given. The button that opens it is the caller's. Readiness comes in as rows (GET /api/engines, through
// a getter the host serves) and is never fetched here.
import { runsOn, harnessesOf, modelGroups, effortsOn, HARNESS_EFFORTS, SIGNIN_LABELS } from '../../../src/shared/connections.mjs';
import { MODEL_ENGINE_NAMES, engineLabel } from '../../../src/shared/engine-switch.mjs';
import { modelName } from './model-picker.mjs';
import { markTile } from './brand-marks.mjs';
import { openPicker } from './open-picker.mjs';
import { placeFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';

/** @typedef {{ id: string, name: string, note: string, blocked: boolean, title: string }} ColumnModel */
/** @typedef {{ key: string, name: string, status: { word: string, tone: 'ok'|'need'|'off', title: string } | null, models: ColumnModel[] }} ColumnProvider */
/** @typedef {{ engine: string, name: string, isDefault: boolean, locked: string, providers: ColumnProvider[] }} ColumnHarness */
/** @typedef {{ col: 'inherit'|'harness'|'provider'|'model', harness: string, provider: string, model: string, tick: { engine: string, model: string } | null }} ColumnsState */

const str = (v) => (typeof v === 'string' && v ? v : '');
const rowsOf = (catalog) => (Array.isArray(catalog) ? catalog : []).filter((m) => m && typeof m.id === 'string' && m.id);
const modelOf = (value) => (value && typeof value === 'object' ? str(value.model) : '');
const missingText = (id) => `${id} (not in the catalog)`;
const NO_SETUP = 'Its provider is not set up yet. Set it up on the Providers tab.';

/** The status word of one provider of `engine` (the table in the plan, in order). */
function providerStatus(engine, name, models, rawRows, engines) {
  if (name === SIGNIN_LABELS[engine]) {
    if (!models.length) return { word: 'No models yet', tone: 'off', title: '' };
    const row = Array.isArray(engines) ? engines.find((e) => e && e.name === engine) : null;
    if (!row) return null;
    return row.ready ? { word: 'Ready', tone: 'ok', title: '' } : { word: 'Not ready', tone: 'off', title: str(row.reason) };
  }
  if (rawRows.length && rawRows.every((m) => m.needsSignIn)) return { word: models[0].note, tone: 'need', title: '' };
  return { word: 'Ready', tone: 'ok', title: '' };
}

/** One entry per model harness (MODEL_ENGINE_NAMES order): its providers (modelGroups of the rows it runs, its own
 *  sign-in first when no group is), each provider's models and status word. → ColumnHarness[] */
export function harnessTree(catalog, { defaultEngine = 'claude', engines = null, current = null } = {}) {
  const rows = rowsOf(catalog);
  const curModel = modelOf(current);
  const lost = curModel && !rows.some((m) => m.id === curModel) ? curModel : '';
  const lostOn = (current && str(current.engine)) || defaultEngine;
  return MODEL_ENGINE_NAMES.map((engine) => {
    const rowOf = Array.isArray(engines) ? engines.find((e) => e && e.name === engine) : null;
    const locked = rowOf && rowOf.broker ? str(rowOf.reason) : '';
    const runs = rows.filter((m) => runsOn(m, engine) && (!m.hidden || m.id === curModel));
    const groups = modelGroups(runs, { engine }).map((g) => ({ name: g.label, rows: g.models }));
    if (!groups.some((g) => g.name === SIGNIN_LABELS[engine])) groups.unshift({ name: SIGNIN_LABELS[engine], rows: [] });
    const toModel = (m) => {
      const others = harnessesOf(m).filter((h) => h !== engine);
      const note = m.needsSignIn ? (m.signInReason === 'no_key' ? 'Needs key' : 'Needs sign-in')
        : harnessesOf(m).length > 1 && others.length ? `also on ${others.map(engineLabel).join(', ')}` : '';
      const title = locked || (m.needsSignIn ? str(m.signInMessage) || NO_SETUP : '');
      return { id: m.id, name: modelName(m), note, blocked: !!m.needsSignIn || !!locked, title };
    };
    const providers = groups.map((g, i) => {
      const models = g.rows.map(toModel);
      if (lost && engine === lostOn && i === 0) models.unshift({ id: lost, name: missingText(lost), note: '', blocked: false, title: '' });
      return { key: g.name, name: g.name, status: providerStatus(engine, g.name, models, g.rows, engines), models };
    });
    return { engine, name: engineLabel(engine), isDefault: engine === defaultEngine, locked, providers };
  });
}

/** The harness a value runs on: its own engine when pinned; a soft one on the default harness when its row runs there,
 *  else the row's first harness; no value or no row: the default harness. */
export function pickHarness(value, { catalog, defaultEngine = 'claude' } = {}) {
  if (value && typeof value === 'object' && str(value.engine)) return value.engine;
  const model = modelOf(value);
  const row = model ? rowsOf(catalog).find((m) => m.id === model) : null;
  if (!row) return defaultEngine;
  return runsOn(row, defaultEngine) ? defaultEngine : (harnessesOf(row)[0] || defaultEngine);
}

const harnessOf = (tree, engine) => tree.find((h) => h.engine === engine) || null;
const providerOf = (h, key) => (h ? h.providers.find((p) => p.key === key) || null : null);

/** A provider's stop: the ticked model when the tick is on this harness and the row is there and open, else its first
 *  open model, else ''. */
function stopOf(h, p, tick) {
  if (!h || !p) return '';
  if (tick && tick.engine === h.engine && p.models.some((m) => m.id === tick.model && !m.blocked)) return tick.model;
  return (p.models.find((m) => !m.blocked) || { id: '' }).id;
}

/** The provider a shown harness opens on: the one listing the tick (on this harness), else the first with a model,
 *  else the first. */
function openProvider(h, tick) {
  if (!h || !h.providers.length) return null;
  return (tick && tick.engine === h.engine && h.providers.find((p) => p.models.some((m) => m.id === tick.model)))
    || h.providers.find((p) => p.models.length) || h.providers[0];
}

/** The columns as a value opens them. → ColumnsState */
export function initialColumns(tree, value, { catalog, defaultEngine = 'claude' } = {}) {
  const model = modelOf(value);
  const tick = model ? { engine: pickHarness(value, { catalog, defaultEngine }), model } : null;
  const harness = tick ? tick.engine : defaultEngine;
  const h = harnessOf(tree, harness);
  const p = openProvider(h, tick);
  const stop = stopOf(h, p, tick);
  return { col: tick && stop === tick.model ? 'model' : 'inherit', harness, provider: p ? p.key : '', model: stop, tick };
}

/** Shows a harness or a provider, or moves the model stop; `col` becomes the given one. → ColumnsState */
export function selectColumn(tree, state, col, key) {
  if (col === 'harness') {
    const h = harnessOf(tree, key);
    const p = openProvider(h, state.tick);
    return { ...state, col, harness: key, provider: p ? p.key : '', model: stopOf(h, p, state.tick) };
  }
  if (col === 'provider') {
    const h = harnessOf(tree, state.harness);
    return { ...state, col, provider: key, model: stopOf(h, providerOf(h, key), state.tick) };
  }
  if (col === 'model') return { ...state, col, model: key };
  return { ...state, col };
}

/** The index a key moves to in a list of `n`, from `at` (clamped, never wraps); -1 when the key does not move. */
function moveIndex(key, at, n) {
  if (!n) return -1;
  if (key === 'ArrowDown') return Math.min(at < 0 ? 0 : at + 1, n - 1);
  if (key === 'ArrowUp') return Math.max(at < 0 ? 0 : at - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return -1;
}
const MOVES = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** The two-axis focus reducer (clamped; unlocked harnesses and unblocked models only).
 *  → { state, picked, value? } */
export function stepColumns(tree, state, key) {
  const same = { state, picked: false };
  const h = harnessOf(tree, state.harness);
  if (state.col === 'inherit') {
    if (key === 'ArrowDown') {
      if (h && h.locked) {
        const first = tree.find((x) => !x.locked);
        return { state: first ? selectColumn(tree, state, 'harness', first.engine) : { ...state, col: 'harness' }, picked: false };
      }
      return { state: { ...state, col: 'harness' }, picked: false };
    }
    if (key === 'Enter' || key === ' ') return { state, picked: true, value: null };
    return same;
  }
  if (state.col === 'harness') {
    if (MOVES.has(key)) {
      const list = tree.filter((x) => !x.locked);
      const i = moveIndex(key, list.findIndex((x) => x.engine === state.harness), list.length);
      return i < 0 ? same : { state: selectColumn(tree, state, 'harness', list[i].engine), picked: false };
    }
    if ((key === 'ArrowRight' || key === 'Enter') && h && !h.locked) return { state: { ...state, col: 'provider' }, picked: false };
    return same;
  }
  if (state.col === 'provider') {
    if (MOVES.has(key)) {
      const list = h ? h.providers : [];
      const i = moveIndex(key, list.findIndex((p) => p.key === state.provider), list.length);
      return i < 0 ? same : { state: selectColumn(tree, state, 'provider', list[i].key), picked: false };
    }
    if ((key === 'ArrowRight' || key === 'Enter') && state.model) return { state: { ...state, col: 'model' }, picked: false };
    if (key === 'ArrowLeft') return { state: { ...state, col: 'harness' }, picked: false };
    return same;
  }
  if (state.col === 'model') {
    if (MOVES.has(key)) {
      const p = providerOf(h, state.provider);
      const list = p ? p.models.filter((m) => !m.blocked) : [];
      const i = moveIndex(key, list.findIndex((m) => m.id === state.model), list.length);
      return i < 0 ? same : { state: { ...state, model: list[i].id }, picked: false };
    }
    if ((key === 'Enter' || key === ' ') && state.model) return { state, picked: true, value: { model: state.model, engine: state.harness } };
    if (key === 'ArrowLeft') return { state: { ...state, col: 'provider' }, picked: false };
    return same;
  }
  return same;
}

/** A stored pick ({ model, effort?, engine? }) as the picker's value: { model, engine? }, or null with no model. */
export function columnsValue(sel) {
  const model = modelOf(sel);
  if (!model) return null;
  const engine = str(sel.engine);
  return engine ? { model, engine } : { model };
}

/** A trigger's content: { text, engine, inherit, missing }. Only a pinned value has an engine (draws a mark). */
export function columnsLabel(value, catalog) {
  const model = modelOf(value);
  if (!model) return { text: 'inherit', engine: '', inherit: true, missing: false };
  const engine = str(value.engine);
  const row = rowsOf(catalog).find((m) => m.id === model);
  return row ? { text: modelName(row), engine, inherit: false, missing: false } : { text: missingText(model), engine, inherit: false, missing: true };
}

/** The efforts a value takes where it runs: effortsOf(row, its harness) for a catalog row, else the harness's list. */
export function pickEfforts(value, { catalog, defaultEngine = 'claude', effortsOf = effortsOn } = {}) {
  const engine = pickHarness(value, { catalog, defaultEngine });
  const model = modelOf(value);
  const row = model ? rowsOf(catalog).find((m) => m.id === model) : null;
  return row ? effortsOf(row, engine) : [...(HARNESS_EFFORTS[engine] || [])];
}

/** A node config patch for a pick: model and engine always (null = delete the key), and effort: null when the
 *  picked model on its harness lacks the stored effort. */
export function nodeModelPatch(value, { catalog, effort = '', defaultEngine = 'claude', effortsOf = effortsOn } = {}) {
  const model = modelOf(value);
  if (!model) return { model: null, engine: null };
  const out = { model, engine: str(value.engine) || null };
  const row = rowsOf(catalog).find((m) => m.id === model);
  if (effort && row && !pickEfforts(value, { catalog, defaultEngine, effortsOf }).includes(effort)) out.effort = null;
  return out;
}

/** The columns' height: min(420px, the larger room below or above the trigger, less the panel's own chrome); no floor.
 *  14 = placeFlyout's 6px gap and 8px margin. */
export function columnHeight({ viewportHeight, anchorTop, anchorBottom, chrome = 0 }) {
  return Math.max(0, Math.min(420, Math.max(viewportHeight - anchorBottom - 14, anchorTop - 14) - chrome));
}

// ---- the open panel --------------------------------------------------------------------------------------------------
const COLS = ['harness', 'provider', 'model'];
const HEADS = { harness: 'Harness', provider: 'Provider', model: 'Model' };
const PICK_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ']);

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

/** An option row of one column. */
function optionRow(doc, cls, key, { selected, stop, disabled = false, title = '' }) {
  const b = make(doc, 'button', `menu-item mdl-cols-row${cls ? ` ${cls}` : ''}`);
  b.type = 'button';
  b.setAttribute('role', 'option');
  b.dataset.key = key;
  b.setAttribute('aria-selected', selected ? 'true' : 'false');
  b.tabIndex = stop ? 0 : -1;
  if (disabled) {
    b.disabled = true;
    b.setAttribute('aria-disabled', 'true');
  }
  if (title) b.title = title;
  return b;
}

/** Opens the columns panel under `anchor` (open-picker.mjs: one open picker per document, a second open on the same
 *  trigger closes it). engines: a readiness getter in app.js's readyEngines style, (onLoad) => rows | null: called once
 *  on open with an onLoad that repaints when fresh rows land; the picker never fetches. defaultEngine: the harness
 *  this row's inherit and soft picks run on (a run card role row passes its node's harness). onAddModel: (engine) =>
 *  void, or null for no button. onPick(value) runs after the trigger has the focus. → { close() } */
export function openModelColumns({ doc, win, anchor, catalog, value, defaultEngine = 'claude', engines = () => null, inheritHint = '',
  label = 'Model', onPick, onAddModel = null, refocus = () => null }) {
  const view = win || doc.defaultView;
  const current = columnsValue(value);
  const build = (rows) => harnessTree(catalog, { defaultEngine, engines: rows, current });
  let shell = null;
  const root = make(doc, 'div', 'menu mdl-cols-pop');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', label);

  const inherit = make(doc, 'button', 'menu-item mdl-cols-inherit');
  inherit.type = 'button';
  inherit.append(make(doc, 'span', 'mdl-cols-inherit-t', 'inherit'), make(doc, 'span', 'mdl-cols-hint', inheritHint));
  if (!current) inherit.append(checkMark(doc));
  const sep = make(doc, 'div', 'menu-sep');
  sep.setAttribute('role', 'separator');
  const cols = make(doc, 'div', 'mdl-cols');
  const parts = {};
  for (const c of COLS) {
    const col = make(doc, 'div', 'mdl-col');
    col.dataset.col = c;
    const head = make(doc, 'div', 'mdl-col-h', HEADS[c]);
    head.id = `mdl-cols-h-${c}`;
    const list = make(doc, 'div', 'mdl-col-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', head.id);
    col.append(head, list);
    cols.append(col);
    parts[c] = { col, head, list, extra: [] };
  }
  root.append(inherit, sep, cols);

  let tree = build(engines(onRows));
  let state = initialColumns(tree, current, { catalog, defaultEngine });

  function onRows() {
    if (!root.isConnected) return;
    tree = build(engines());
    draw();
  }

  const pick = (report) => shell.pick(report);
  const shownHarness = () => tree.find((h) => h.engine === state.harness) || null;
  const shownProvider = () => (shownHarness()?.providers || []).find((p) => p.key === state.provider) || null;

  function draw() {
    const h = shownHarness();
    const p = shownProvider();
    parts.harness.list.replaceChildren(...tree.map((x) => {
      const b = optionRow(doc, '', x.engine, { selected: x.engine === state.harness, stop: x.engine === state.harness, disabled: !!x.locked, title: x.locked });
      b.append(markTile(doc, { kind: 'harness', key: x.engine, size: 'sm', label: x.name }), make(doc, 'span', 'mdl-cols-name', x.name));
      if (x.isDefault) b.append(make(doc, 'span', 'badge', 'Default'));
      b.append(icon(doc, 'chevron', 12));
      b.addEventListener('click', () => {
        if (b.disabled) return;
        state = selectColumn(tree, state, 'harness', x.engine);
        draw();
      });
      return b;
    }));
    parts.provider.list.replaceChildren(...(h ? h.providers : []).map((x) => {
      const b = optionRow(doc, 'mdl-cols-prov', x.key, { selected: x.key === state.provider, stop: x.key === state.provider });
      const two = make(doc, 'span', 'mdl-cols-two');
      two.append(make(doc, 'span', 'mdl-cols-name', x.name));
      if (x.status) {
        const st = make(doc, 'span', `mdl-st ${x.status.tone}`, x.status.word);
        if (x.status.title) st.title = x.status.title;
        two.append(st);
      }
      b.append(two, icon(doc, 'chevron', 12));
      b.addEventListener('click', () => {
        state = selectColumn(tree, state, 'provider', x.key);
        draw();
      });
      return b;
    }));
    const models = p ? p.models : [];
    const tick = state.tick && state.tick.engine === state.harness ? state.tick.model : '';
    parts.model.head.textContent = models.length ? `Model · ${models.length}` : 'Model';
    parts.model.list.replaceChildren(...models.map((m) => {
      const b = optionRow(doc, '', m.id, { selected: m.id === tick, stop: m.id === state.model, disabled: m.blocked, title: m.title });
      b.append(make(doc, 'span', 'mdl-cols-name', m.name));
      if (m.note) b.append(make(doc, 'span', 'mdl-cols-note', m.note));
      if (m.id === tick) b.append(checkMark(doc));
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const engine = state.harness;
        pick(() => { if (typeof onPick === 'function') onPick({ model: m.id, engine }); });
      });
      return b;
    }));
    for (const x of parts.model.extra) x.remove();
    parts.model.extra = [];
    if (!models.length) {
      const empty = make(doc, 'p', 'empty-line mdl-cols-empty', 'No models yet.');
      parts.model.extra.push(empty);
      if (typeof onAddModel === 'function') {
        const add = make(doc, 'button', 'btn btn-sm btn-quiet mdl-cols-add', 'Add model');
        add.type = 'button';
        const engine = state.harness;
        add.addEventListener('click', () => pick(() => onAddModel(engine)));
        parts.model.extra.push(add);
      }
      parts.model.col.append(...parts.model.extra);
    }
    focusStop();
  }

  const rowIn = (c, key) => [...parts[c].list.querySelectorAll('[role="option"]')].find((b) => b.dataset.key === key) || null;
  function focusStop() {
    const target = state.col === 'inherit' ? inherit
      : state.col === 'model' ? rowIn('model', state.model) || rowIn('provider', state.provider)
        : rowIn(state.col, state.col === 'harness' ? state.harness : state.provider);
    if (target) { try { target.focus(); } catch { /* detached */ } }
  }
  const colOf = (t) => {
    if (!t || t.nodeType !== 1) return '';
    if (t.closest('.mdl-cols-inherit')) return 'inherit';
    if (!t.closest('[role="option"]')) return '';
    return t.closest('.mdl-col')?.dataset.col || '';
  };

  inherit.addEventListener('click', () => pick(() => { if (typeof onPick === 'function') onPick(null); }));
  root.addEventListener('focusin', (e) => {
    const col = colOf(e.target);
    if (col) state = { ...state, col };
  });
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const col = colOf(e.target);
    if (!col) return;
    if (PICK_KEYS.has(e.key)) e.preventDefault();
    const out = stepColumns(tree, { ...state, col }, e.key);
    if (out.picked) {
      const next = out.value;
      pick(() => { if (typeof onPick === 'function') onPick(next); });
      return;
    }
    state = out.state;
    draw();
  });

  function place() {
    const t = anchor.getBoundingClientRect();
    const chrome = root.offsetHeight - cols.offsetHeight;
    cols.style.height = `${columnHeight({ viewportHeight: view.innerHeight, anchorTop: t.top, anchorBottom: t.bottom, chrome })}px`;
    placeFlyout(root, anchor, { mode: 'below', win: view });
  }

  shell = openPicker({ doc, win: view, anchor, root, place, refocus });
  if (!shell) return { close() {} };
  draw();
  return { close: () => shell.close(false) };
}
