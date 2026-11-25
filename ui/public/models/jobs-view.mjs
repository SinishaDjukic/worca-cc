// ui/public/models/jobs-view.mjs — the Jobs tab drawn (models-menu P6, DESIGN JOB-1…JOB-10, VIS-4) from the view
// model jobs-model.mjs buildJobs makes: the harness tiles with the harness line and "Default for new runs", the three
// role tiles, one card of divided rows per kind of job (Steps, Helper jobs, Design) with the line that says what the
// rest do, and the one save bar. Pure DOM on the document it is given: nothing is fetched and no listener is bound
// on the tab (app.js delegates its clicks on the root and reads data-setting / data-section). Also the "Override a
// step" / "Override a helper job" menu, built by hand because openMenu holds no search field: a role=dialog box
// holding the field and a role=menu list, worked as the Chat picker's menus are (model-picker.mjs).
import { renderHarnessTiles } from './harness-tiles.mjs';
import { modelMark } from './brand-marks.mjs';
import { placeFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';

const str = (v) => (typeof v === 'string' && v ? v : '');
/** /api/config rows carry `upstreamModel`, not `upstream`: what the mark's vendor lookup reads (as model-picker.mjs). */
const withUpstream = (m) => ({ ...m, upstream: m.upstream || (m.upstreamModel ? { model: m.upstreamModel } : undefined) });

function make(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function button(doc, cls, text) {
  const b = make(doc, 'button', cls, text);
  b.type = 'button';
  return b;
}

/** A block under its small heading (h2.mdl-sect). */
function block(doc, title, level) {
  const box = make(doc, 'div');
  box.dataset.minLevel = level;
  box.append(make(doc, 'h2', 'mdl-sect', title));
  return box;
}

/** The harness line: what the picked harness can do today (vm.reason, '' when it is ready with nothing to say) and
 *  the button that makes it the default for new runs, pressed while it is. */
function harnessLine(doc, vm) {
  const line = make(doc, 'div', 'mdl-jobs-line');
  line.dataset.minLevel = 'expert';
  const def = button(doc, 'btn btn-sm mdl-default-btn', 'Default for new runs');
  def.setAttribute('aria-pressed', String(!!vm.isDefault));
  def.disabled = !vm.canDefault;
  if (str(vm.defaultTitle)) def.title = vm.defaultTitle;
  line.append(make(doc, 'span', 'mdl-jobs-reason', str(vm.reason)), def);
  return line;
}

/** One role tile, the button of its own picker: the role and what it is for, the model (mark, name, chevron) and its
 *  effort ("xhigh effort", "Model default effort"; nothing while the role is unset). */
function roleTile(doc, r) {
  const tile = button(doc, 'mdl-tile');
  tile.dataset.setting = r.id;
  tile.setAttribute('aria-haspopup', 'menu');
  tile.setAttribute('aria-expanded', 'false');
  const effortText = str(r.effortText);
  const hasModel = !!(r.value && str(r.value.model));
  // An empty role reads as its tile text (#1450: "Worca default · Opus 5.5", "Let Claude Code decide", "<tool> decides …").
  const emptyText = str(r.text) === "Each job's own default" ? "each job's own default" : str(r.text);
  tile.setAttribute('aria-label', hasModel ? `${r.name}: ${r.text}, ${effortText}`
    : `${r.name}: ${emptyText}${effortText ? `, ${effortText}` : ''}`);
  const model = make(doc, 'span', 'mdl-tile-model');
  if (r.model) model.append(modelMark(doc, withUpstream(r.model), 'md'));
  model.append(make(doc, 'span', 'mdl-tile-name', str(r.text)), icon(doc, 'chevron-down', 16));
  const eff = make(doc, 'span', 'mdl-tile-eff');
  // The effort word in ink, " effort" after it in grey (kit .tile-eff b).
  const word = effortText.endsWith(' effort') ? effortText.slice(0, -' effort'.length) : '';
  if (word) eff.append(make(doc, 'b', null, word), doc.createTextNode(' effort'));
  else eff.textContent = effortText;
  tile.append(make(doc, 'span', 'mdl-tile-role', r.name), make(doc, 'span', 'mdl-tile-sub', str(r.sub)), model, eff);
  return tile;
}

/** One job row: its name and "Instead of …" on the left; on the right its picker (dashed while it follows
 *  something), then Test (an own model the server can test) and the clear button (an own value). */
function jobRow(doc, r) {
  const row = make(doc, 'div', 'drow mdl-job-row');
  row.dataset.setting = r.id;
  const txt = make(doc, 'div', 'mdl-job-txt');
  txt.append(make(doc, 'span', 'mdl-job-name', r.name), make(doc, 'span', 'mdl-job-sub', str(r.sub)));
  const control = make(doc, 'div', 'drow-control');
  const effort = str(r.effort);
  const pick = button(doc, r.inherit ? 'mdl-pick inherit' : 'mdl-pick');
  pick.setAttribute('aria-haspopup', 'menu');
  pick.setAttribute('aria-expanded', 'false');
  pick.setAttribute('aria-label', `Model for ${r.name}: ${r.text}${effort ? `, effort ${effort}` : ''}`);
  if (r.model) pick.append(modelMark(doc, withUpstream(r.model), 'sm'));
  pick.append(make(doc, 'span', 'mdl-pick-text', str(r.text)));
  if (effort) pick.append(make(doc, 'span', 'mdl-pick-eff', ` · ${effort}`));
  pick.append(icon(doc, 'chevron-down', 14));
  control.append(pick);
  if (r.canTest) {
    const t = button(doc, 'btn btn-quiet btn-sm mdl-job-test', 'Test');
    t.setAttribute('aria-label', `Test the model for ${r.name}`);
    control.append(t);
  }
  if (r.own) {
    const x = button(doc, 'btn btn-quiet btn-sm btn-icon mdl-job-clear');
    x.setAttribute('aria-label', `Remove the override for ${r.name}`);
    x.append(icon(doc, 'x', 14));
    control.append(x);
  }
  row.append(txt, control);
  return row;
}

/** One card: the head (title, count, the Override button), the note of a harness with no helper jobs, the rows, and
 *  the more-line. The more-line is drawn only when it has something to say or to fold: an empty band would add a
 *  stray hairline (Design shows every row and folds nothing). */
function jobCard(doc, s) {
  const card = make(doc, 'section', 'card drows mdl-job-card');
  card.id = `jobs-${s.key}`;
  card.dataset.section = s.key;
  card.dataset.minLevel = 'advanced';
  card.setAttribute('aria-label', s.title);
  const head = make(doc, 'div', 'card-head mdl-card-h');
  head.append(make(doc, 'h2', null, s.title), make(doc, 'span', 'badge', String(s.count)));
  if (str(s.overrideLabel)) {
    const over = button(doc, 'btn btn-sm mdl-override');
    over.setAttribute('aria-haspopup', 'dialog');
    over.setAttribute('aria-expanded', 'false');
    over.append(icon(doc, 'plus', 14), doc.createTextNode(s.overrideLabel));
    head.append(over);
  }
  card.append(head);
  if (str(s.note)) card.append(make(doc, 'p', 'mdl-job-note', s.note));
  for (const r of s.rows || []) card.append(jobRow(doc, r));
  if (str(s.moreText) || s.canFold) {
    const more = make(doc, 'div', 'mdl-more-line');
    more.append(make(doc, 'span', null, str(s.moreText)));
    if (s.canFold) {
      const all = button(doc, 'btn btn-quiet btn-sm mdl-show-all', s.showingAll ? 'Show less' : 'Show all');
      all.dataset.minLevel = 'expert';
      more.append(all);
    }
    card.append(more);
  }
  return card;
}

/** → div.mdl-jobs:
 *   div[data-min-level=expert]: h2.mdl-sect "Harness" + renderHarnessTiles(doc, { engines, locks, picked: vm.engine,
 *     defaultEngine: vm.defaultEngine, showDefault: true })
 *   div.mdl-jobs-line[data-min-level=expert]: span.mdl-jobs-reason (vm.reason), button.btn.btn-sm.mdl-default-btn
 *     "Default for new runs" (aria-pressed = isDefault; disabled unless canDefault; title = defaultTitle)
 *   div#jobs-roles[data-min-level=simple]: h2.mdl-sect "Roles" + div.mdl-tiles > button.mdl-tile[data-setting]
 *     [aria-haspopup=menu] (span.mdl-tile-role, span.mdl-tile-sub, span.mdl-tile-model with the model's mark, name and
 *     a chevron icon, span.mdl-tile-eff)
 *   section.card.drows.mdl-job-card#jobs-<key>[data-section][data-min-level=advanced] per section:
 *     div.card-head.mdl-card-h: h2, span.badge count, button.btn.btn-sm.mdl-override (plus icon + overrideLabel; only
 *       when overrideLabel)
 *     p.mdl-job-note when the section has a note
 *     div.drow.mdl-job-row[data-setting] per row: div.mdl-job-txt (span.mdl-job-name, span.mdl-job-sub) +
 *       div.drow-control (button.mdl-pick[.inherit][aria-haspopup=menu][aria-label] with mark, text, " · <effort>";
 *       button.btn.btn-quiet.btn-sm.mdl-job-test "Test" [aria-label="Test the model for <name>"] when canTest;
 *       button.btn.btn-quiet.btn-sm.btn-icon.mdl-job-clear[aria-label="Remove the override for <name>"] (icon x) when own)
 *     div.mdl-more-line: span (moreText) + button.btn.btn-quiet.btn-sm.mdl-show-all[data-min-level=expert]
 *       "Show all"|"Show less" (when canFold); drawn only when moreText is not empty or canFold
 *   div.mdl-savebar[hidden unless vm.dirty]: span.note (dirtyText), button.btn.mdl-discard "Discard",
 *     button.btn.btn-primary.mdl-save "Save" */
export function renderJobs(vm, { doc = globalThis.document, engines = null, locks = [] } = {}) {
  const root = make(doc, 'div', 'mdl-jobs');
  const harness = block(doc, 'Harness', 'expert');
  harness.append(renderHarnessTiles(doc, { engines, locks, picked: vm.engine, defaultEngine: vm.defaultEngine, showDefault: true }));
  const roles = block(doc, 'Roles', 'simple');
  roles.id = 'jobs-roles';
  const tiles = make(doc, 'div', 'mdl-tiles');
  for (const r of vm.roles || []) tiles.append(roleTile(doc, r));
  roles.append(tiles);
  root.append(harness, harnessLine(doc, vm), roles);
  for (const s of vm.sections || []) root.append(jobCard(doc, s));
  const bar = make(doc, 'div', 'mdl-savebar');
  bar.hidden = !vm.dirty;
  bar.append(make(doc, 'span', 'note', str(vm.dirtyText)), button(doc, 'btn mdl-discard', 'Discard'), button(doc, 'btn btn-primary mdl-save', 'Save'));
  root.append(bar);
  return root;
}

// ---- the override menu -----------------------------------------------------------------------------------------------
/** The groups, in the order the menu lists them (DESIGN JOB-9); a choice's group is its role, null for none. */
const GROUPS = Object.freeze([['deep', 'Follow Deep thinking'], ['quick', 'Follow Quick jobs'], ['everyday', 'Follow Everyday tasks'], [null, "Use Worca's default"]]);
/** The open override menu of each document: { anchor, close }. */
const OPEN = new WeakMap();

/** The override menu for one section (built by hand: openMenu holds no field). div.menu.mdl-over-pop[role=dialog]
 *  [aria-label=<overrideLabel>] appended to body, placed below the anchor (its right edge on the button's, as the
 *  button ends the card head; placeFlyout 'down', flipped above when there is no room): for steps an
 *  input.input.input-sm[type=search][placeholder="Find a step"][aria-label="Find a step"] (no size override), then
 *  div[role=menu] of div.menu-h headings "Follow Deep thinking", "Follow Quick jobs", "Follow Everyday tasks",
 *  "Use Worca's default" (only groups with choices, in this order, each with span.mdl-over-n count; role=presentation,
 *  as a menu holds only items) and button.menu-item[role=menuitem] per choice (a taken one disabled, aria-disabled,
 *  with span.mdl-over-hint "has its own model"); filtering hides items and empty headings and the counts follow it;
 *  nothing matches → div.menu-h "No step matches". The field takes the focus (else the first enabled item); ArrowDown
 *  from the field moves to the first enabled item; arrows (wrapping; ArrowUp from the first item goes back to the
 *  field), Home and End move among the shown enabled items. Escape (document capture listener, stopImmediatePropagation)
 *  removes it and focuses the anchor; a pointerdown outside it and the anchor, or focus moving outside both, removes it
 *  without moving focus. One per document: a second call on the same anchor closes it instead (a toggle). A pick
 *  removes it, focuses the anchor, then calls onPick(id). The anchor's aria-expanded follows. → { close() } */
export function openOverrideMenu({ doc, win, anchor, section, onPick }) {
  const prev = OPEN.get(doc);
  if (prev) {
    prev.close();
    if (prev.anchor === anchor) return { close() {} };
  }
  const view = win || doc.defaultView;
  const sec = section && typeof section === 'object' ? section : {};
  const label = str(sec.overrideLabel);
  const choices = Array.isArray(sec.choices) ? sec.choices.filter((c) => c && str(c.id)) : [];
  const root = make(doc, 'div', 'menu mdl-over-pop');
  root.setAttribute('role', 'dialog');
  if (label) root.setAttribute('aria-label', label);
  let closed = false;

  let field = null;
  if (sec.key === 'steps') {
    field = make(doc, 'input', 'input input-sm');
    field.type = 'search';
    field.placeholder = 'Find a step';
    field.setAttribute('aria-label', 'Find a step');
    field.setAttribute('autocomplete', 'off');
    root.append(field);
  }
  const list = make(doc, 'div');
  list.setAttribute('role', 'menu');
  if (label) list.setAttribute('aria-label', label);
  root.append(list);

  const groups = [];
  for (const [role, words] of GROUPS) {
    const mine = choices.filter((c) => (c.group || null) === role);
    if (!mine.length) continue;
    const head = make(doc, 'div', 'menu-h');
    head.setAttribute('role', 'presentation');
    const n = make(doc, 'span', 'mdl-over-n', String(mine.length));
    head.append(make(doc, 'span', null, words), n);
    list.append(head);
    const items = mine.map((c) => {
      const b = button(doc, 'menu-item');
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      b.dataset.setting = c.id;
      b.append(make(doc, 'span', null, str(c.name)));
      if (c.taken) {
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        b.append(make(doc, 'span', 'mdl-over-hint', 'has its own model'));
      }
      // A synthetic click reaches a disabled button too (jsdom, app code): it does nothing.
      b.addEventListener('click', () => {
        if (b.disabled) return;
        close(true);
        if (typeof onPick === 'function') onPick(c.id);
      });
      list.append(b);
      return { b, name: str(c.name).toLowerCase() };
    });
    groups.push({ head, n, items });
  }
  let none = null;
  if (field) {
    none = make(doc, 'div', 'menu-h mdl-over-none', 'No step matches');
    none.setAttribute('role', 'presentation');
    none.hidden = true;
    list.append(none);
  }

  const enabled = () => [...list.querySelectorAll('[role="menuitem"]')].filter((b) => !b.hidden && !b.disabled);
  /** The one item in the tab order: the focused one, else the first shown enabled one. */
  const rove = (b) => {
    for (const x of list.querySelectorAll('[role="menuitem"]')) x.tabIndex = -1;
    if (b) b.tabIndex = 0;
  };
  const focusItem = (b) => {
    if (!b) return;
    rove(b);
    try { b.focus(); } catch { /* detached */ }
  };
  const place = () => placeFlyout(root, anchor, { mode: 'down', fit: true, win: view });

  function filter() {
    const q = field.value.trim().toLowerCase();
    let any = false;
    for (const g of groups) {
      let shown = 0;
      for (const it of g.items) {
        const on = !q || it.name.includes(q);
        it.b.hidden = !on;
        if (on) shown += 1;
      }
      g.head.hidden = !shown;
      g.n.textContent = String(shown);
      if (shown) any = true;
    }
    none.hidden = any;
    rove(enabled()[0]);
    place();
  }

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

  if (field) {
    field.addEventListener('input', filter);
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      focusItem(enabled()[0]);
    });
  }
  list.addEventListener('keydown', (e) => {
    const items = enabled();
    if (!items.length) return;
    const at = items.indexOf(doc.activeElement);
    const go = (i) => focusItem(items[(i + items.length) % items.length]);
    if (e.key === 'ArrowDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (at === 0 && field) { try { field.focus(); } catch { /* detached */ } }
      else go(at < 0 ? -1 : at - 1);
    }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
  });

  doc.body.append(root);
  place();
  anchor.setAttribute('aria-expanded', 'true');
  const handle = { anchor, close: () => close(false) };
  OPEN.set(doc, handle);
  rove(enabled()[0]);
  if (field) { try { field.focus(); } catch { /* detached */ } }
  else focusItem(enabled()[0]);
  doc.addEventListener('keydown', onEscape, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('scroll', onScroll, true);
  if (view) view.addEventListener('resize', place);
  return { close: () => close(false) };
}
