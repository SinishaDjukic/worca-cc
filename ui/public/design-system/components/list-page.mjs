// A list page's behaviour (docs/rail/lists.md), one for every list that has selecting: it draws the list from what a page
// names, and owns what a click, a long-press or a key means there: the sentence's menus, selecting, a row's ⋯, Show N more,
// a group's ⌄, the strip, a Dialog and the list's editor. A page names its rows and what an action does.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';
import { confirmStrip } from './confirm-strip.mjs';
import { dismissOnOutside } from './dismiss.mjs';
import { dialog } from './dialog.mjs';
import { field } from './field.mjs';
import { icon } from './icons.mjs';
import { list, listRow, moreMenu } from './list.mjs';
import { groupRow, listSentence, listState, roundRows } from './list-parts.mjs';
import { land } from './motion.mjs';
import { selectionAction, selectApply, selectClear, selectPrune, selectStart, selectStep, selectAllState, keepFocus } from './selection.mjs';
import { bindLongPress, selectAllBox, selectionBar } from './selection-bar.mjs';
import { keyFacts, listMove, openShortcutsSheet, shortcutAction } from './shortcuts.mjs';
import { listEditor } from './tag-group.mjs';

/** How many rows a long section shows before Show N more; a section may name its own (Older shows 3). */
export const LIST_SHOWN = 8;
const ROUNDS_SHOWN = 5;
const q = (v) => String(v).replace(/["\\]/g, '\\$&');   // a value inside an attribute selector

/** Keeps a menu inside the window, 16px from its edges. */
export function fitMenu(m, vw) {
  const r = m.getBoundingClientRect();
  if (r.right > vw - 16) m.style.left = `${Math.min(0, vw - 16 - r.right)}px`;
  const r2 = m.getBoundingClientRect();
  if (r2.left < 16) m.style.left = `${parseFloat(m.style.left || 0) + 16 - r2.left}px`;
}

/**
 * @param {object} o
 * @param {Element} o.root
 * @param {object} o.spec
 * @param {string} o.spec.noun           "runs": its words in Loading and Could not load
 * @param {string} o.spec.label          the selection bar's name
 * @param {() => object} o.spec.view     { parts, tools, sections: [{id,title,chip,limit,rows}], state, empty, retry }
 * @param {() => string[]} o.spec.can    the list's actions, for its keys and its sheet
 * @param {string[]} [o.spec.scopes]     more of the keys' table (Chat's)
 * @param {(rows) => object[]} o.spec.bulk   the selection bar's actions
 * @param {(id, rows) => void} o.spec.act    what an action does, from a row's ⋯, a key or the bar
 * @param {(row) => void} o.spec.open    what opening a row does
 * @param {(part, value) => void} o.spec.word  a choice in the sentence
 * @param {(value) => void} [o.spec.tool]      a choice in the list's ⋯
 * @param {(act) => void} [o.spec.key]   a key of `scopes`
 * @param {(text, undo) => void} o.spec.say    the Toast
 * @param {() => boolean} o.spec.active  this list takes keys now
 * @param {() => void} [o.spec.retry]
 * @param {() => void} [o.spec.emptyAct]
 * A row: { key, title, meta, mark, lead, end, endMark, tree (what hangs under it, always open), tip, unread, current, holds, menu, members, open (a group's first state), noun, count, rounds }.
 */
export function listController({ root, spec }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const s = { pick: selectClear(), menu: '', more: new Set(), groups: new Map(), rounds: new Set(), roundsAll: new Set(), confirm: null, pop: null, dialog: null, focus: '', flash: '', order: [], rows: new Map() };
  const dots = () => icon('more', 16);
  const groupOpen = (r) => (s.groups.has(r.key) ? s.groups.get(r.key) : !!r.open);

  function rowHtml(r) {
    const selecting = s.pick.on;
    const base = { title: r.title, meta: r.meta, mark: r.mark, lead: r.lead, unread: r.unread, current: r.current, holds: r.holds, flash: s.flash === r.key,
      open: { 'data-open': r.key, title: r.tip || r.title }, attrs: { 'data-row': r.key },
      menu: r.menu ? { id: `row:${r.key}`, label: `More for ${r.title}`, icon: dots(), items: r.menu, open: s.menu === `row:${r.key}` } : null,
      check: selecting ? s.pick.ids.includes(r.key) : undefined, boxAttrs: { 'data-sel': r.key } };
    if (r.tree) base.after = `<div class="lr-members lr-tree" role="list"><div class="list-rows">${r.tree.map(rowHtml).join('')}</div></div>`;
    if (r.endMark) base.end = r.endMark;
    if (r.members) return groupRow({ ...base, count: r.count, noun: r.noun, shown: groupOpen(r), toggle: { 'data-fold': r.key }, rows: r.members.map(rowHtml).join('') });
    let after = '';
    if (r.rounds) {
      const k = r.key, open = s.rounds.has(k), all = s.roundsAll.has(k) || r.rounds.list.length <= ROUNDS_SHOWN;
      after = roundRows({ line: r.rounds.line, n: r.rounds.list.length, open, toggle: { 'data-rounds': k },
        rounds: (all ? r.rounds.list : r.rounds.list.slice(0, ROUNDS_SHOWN)).map((x) => ({ n: x.n, words: x.words, time: x.time, attrs: { 'data-open-round': `${k}|${x.n}`, title: `Opens round ${x.n}` } })),
        more: all ? null : { n: r.rounds.list.length - ROUNDS_SHOWN, attrs: { 'data-rounds-all': k } } });
    }
    return listRow({ ...base, endText: r.end, after: base.after || after });
  }

  function html(v) {
    s.rows = new Map(); s.order = [];
    const note = (r) => { s.rows.set(r.key, r); (r.members || []).forEach(note); (r.tree || []).forEach(note); };
    v.sections.forEach((x) => x.rows.forEach(note));
    const ready = !v.state || v.state === 'ready';
    const groups = ready ? v.sections.map((x) => {
      const limit = x.limit || LIST_SHOWN, all = s.more.has(x.id) || x.rows.length <= limit, rows = all ? x.rows : x.rows.slice(0, limit);
      const walk = (r) => { s.order.push(r.key); (r.tree || []).forEach(walk); if (r.members && groupOpen(r)) r.members.forEach(walk); }; rows.forEach(walk);
      return { title: x.title, count: x.rows.length, chip: x.chip, rows: rows.map(rowHtml), more: all ? null : { n: x.rows.length - limit, attrs: { 'data-more': x.id } } };
    }) : [];
    s.pick = selectPrune(s.pick, [...s.rows.keys()]);
    const shown = s.order;
    const tools = [s.pick.on && shown.length ? selectAllBox({ state: selectAllState(s.pick, shown) }) : '',
      v.tools ? moreMenu({ id: 'tools', label: 'More for this list', icon: dots(), items: v.tools, open: s.menu === 'tools' }) : ''].join('');
    const picked = picks();
    const foot = s.pick.on ? `<div class="list-foot">${selectionBar({ label: spec.label, count: picked.length, actions: spec.bulk(picked) })}</div>` : '';
    const empty = ready ? listState({ state: 'empty', noun: spec.noun, text: v.empty?.text, action: v.empty?.action ? button({ label: v.empty.action, kind: 'quiet', attrs: { 'data-empty': '' } }) : '' })
      : v.state === 'waiting' ? '' : listState({ state: v.state, noun: spec.noun, retry: { 'data-retry': '' } });
    const strip = s.confirm ? confirmStrip({ text: s.confirm.text, yes: s.confirm.yes, danger: s.confirm.danger, id: `${spec.noun}-strip-t` }) : '';
    return strip + list({ sentence: listSentence({ parts: v.parts, open: s.menu }), tools, groups, empty, foot }) + popHtml() + dialogHtml();
  }
  const picks = () => s.pick.ids.map((k) => s.rows.get(k)).filter(Boolean);
  function popHtml() {
    if (!s.pop) return '';
    return `<div class="list-pop">${listEditor({ label: s.pop.label, inputId: 'list-pop-q', placeholder: s.pop.placeholder, sections: s.pop.sections(s.pop.q || ''), hint: s.pop.hint })}</div>`;
  }
  function dialogHtml() {
    const d = s.dialog; if (!d) return '';
    const body = (d.text ? `<p class="list-dlg-t">${esc(d.text)}</p>` : '') + field({ id: 'list-dlg-name', label: d.label, value: d.value, hint: d.hint || '', error: d.error || '', attrs: { 'data-dlg-name': '' } });
    return dialog({ title: d.title, body, yes: d.yes, close: icon('x', 14), id: `${spec.noun}-dlg-t` });
  }

  function placePop() {
    const el = root.querySelector('.list-pop'); if (!el || !s.pop) return;
    const a = root.querySelector(s.pop.anchor) || doc.querySelector(s.pop.anchor);
    const r = a?.getBoundingClientRect() || { left: 16, bottom: 80, top: 80 };
    const w = el.offsetWidth, h = el.offsetHeight, vw = doc.documentElement.clientWidth, vh = win.innerHeight;
    el.style.left = `${Math.max(16, Math.min(vw - w - 16, r.left))}px`;
    el.style.top = `${r.bottom + 4 + h > vh - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  }

  function paint({ focus = '' } = {}) {
    stale = false;
    const a = doc.activeElement, inside = root.contains(a);
    const scroller = root.closest('.main, .rl-side-body'), y = scroller?.scrollTop || 0;
    const before = s.order, fromRow = a?.closest?.('[data-row]')?.dataset.row || s.focus;
    const picked = (a?.dataset?.menuPick || a?.dataset?.pick || '').split('|')[0];
    const keep = focus || (picked ? `[data-menu="${q(picked)}"]` : ['data-menu', 'data-bulk', 'data-selall', 'data-fold', 'data-rounds'].filter((k) => a?.hasAttribute?.(k)).map((k) => `[${k}${a.getAttribute(k) && a.getAttribute(k) !== 'true' ? `="${q(a.getAttribute(k))}"` : ''}]`)[0]);
    const typed = root.querySelector('#list-pop-q')?.value, name = root.querySelector('[data-dlg-name]')?.value;
    root.innerHTML = html(spec.view());
    for (const b of root.querySelectorAll('[data-mixed]')) b.indeterminate = true;
    for (const m of root.querySelectorAll('.pz-menu, .rc-pop > .menu')) fitMenu(m, doc.documentElement.clientWidth);
    placePop();
    if (scroller) scroller.scrollTop = y;
    // one Tab stop in the list: the row last on, else the first
    const stop = s.order.includes(s.focus) ? s.focus : s.order[0];
    for (const b of root.querySelectorAll('[data-open]')) b.tabIndex = b.dataset.open === stop ? 0 : -1;
    const pop = root.querySelector('#list-pop-q'), dlg = root.querySelector('[data-dlg-name]');
    if (pop) { if (typed !== undefined) pop.value = typed; pop.focus(); return; }
    if (dlg) { if (name !== undefined && !s.dialog.reset) dlg.value = name; s.dialog.reset = false; dlg.focus(); return; }
    if (focus && root.querySelector(focus)) { root.querySelector(focus).focus(); return; }
    if (!inside && !focus) return;
    (keep && root.querySelector(keep) || rowEl(keepFocus(before, s.order, fromRow)))?.focus();
  }
  const rowEl = (k) => (k ? root.querySelector(`[data-open="${q(k)}"]`) : null);
  const applyPick = (act, id) => { s.pick = selectApply(s.pick, act, { id, shown: s.order }); paint(); };

  // what a row's ⋯ or a key does: on a ticked row, it means every ticked row
  function run(id, row, { viaKey = false } = {}) {
    const item = row?.menu?.find((x) => x.id === id);
    if (viaKey && !item) return;   // a key does what its ⋯ item does, and nothing where there is none
    if (item?.off) { spec.say(item.help); return; }
    if (id === 'toggle') { s.pick = selectStart(s.pick); applyPick('toggle', row.key); return; }
    spec.act(id, s.pick.ids.includes(row.key) && s.pick.ids.length > 1 ? picks() : [row], { viaKey });
  }

  root.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    let el;
    if ((el = t('[aria-disabled="true"]'))) { spec.say(el.title); return; }
    if ((el = t('[data-pick]'))) { const i = el.dataset.pick.indexOf('|'), id = el.dataset.pick.slice(0, i), v = el.dataset.pick.slice(i + 1); const stays = spec.word(id, v); if (!stays) s.menu = ''; s.pick = selectPrune(s.pick, []); paint(); return; }
    if ((el = t('[data-menu-pick]'))) {
      const p = el.dataset.menuPick, i = p.lastIndexOf('|'), id = p.slice(0, i), v = p.slice(i + 1);
      s.menu = '';
      if (id === 'tools') {
        if (v === 'select') { s.pick = selectStart(s.pick); paint(); }
        else if (v === 'keys') { paint(); openSheet(); }
        else { spec.tool?.(v); paint(); }
      } else run(v, s.rows.get(id.slice(4)));
      return;
    }
    if ((el = t('[data-menu]'))) { s.menu = s.menu === el.dataset.menu ? '' : el.dataset.menu; s.pop = null; paint(); return; }
    if ((el = t('[data-selall]'))) { s.pick = el.checked ? selectApply(s.pick, 'all', { shown: s.order }) : selectPrune(s.pick, []); s.menu = ''; paint(); return; }
    if ((el = t('[data-sel]'))) { s.menu = ''; applyPick(selectionAction({ click: true, onBox: true, shiftKey: e.shiftKey }), el.dataset.sel); return; }
    if (t('.lr-check, .runs-all-wrap')) return;   // its label: the click that follows reaches the box
    if ((el = t('[data-bulk]'))) {
      const a = el.dataset.bulk;
      if (a === 'cancel') { s.pick = selectClear(); paint(); return; }
      spec.act(a, picks(), { bulk: true });
      return;
    }
    if ((el = t('[data-confirm]'))) { const c = s.confirm; s.confirm = null; if (el.dataset.confirm === 'yes') c.run(); paint({ focus: c.back || '' }); return; }
    if ((el = t('[data-dialog]'))) { dialogStep(el.dataset.dialog); return; }
    if ((el = t('[data-listtoggle]'))) { const v = el.dataset.listtoggle, i = v.indexOf('|'); s.pop.pick(v.slice(0, i), v.slice(i + 1)); return; }
    if (t('.list-pop')) return;
    if ((el = t('[data-fold]'))) { const r = s.rows.get(el.dataset.fold); s.groups.set(r.key, !groupOpen(r)); s.menu = ''; paint(); return; }
    if ((el = t('[data-rounds]'))) { const k = el.dataset.rounds; if (s.rounds.has(k)) s.rounds.delete(k); else s.rounds.add(k); s.menu = ''; paint(); return; }
    if ((el = t('[data-rounds-all]'))) { s.roundsAll.add(el.dataset.roundsAll); paint(); return; }
    if ((el = t('[data-open-round]'))) { const [k, n] = el.dataset.openRound.split('|'); spec.openRound?.(s.rows.get(k), +n); return; }
    if ((el = t('[data-more]'))) { s.more.add(el.dataset.more); paint(); return; }
    if ((el = t('[data-retry]'))) { spec.retry?.(); paint(); return; }
    if ((el = t('[data-empty]'))) { spec.emptyAct?.(); return; }
    if ((el = t('[data-open]'))) {
      const act = selectionAction({ click: true, button: e.button, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }, { selecting: s.pick.on });
      if (act) { e.preventDefault(); applyPick(act, el.dataset.open); return; }
      s.focus = el.dataset.open;
      spec.open(s.rows.get(el.dataset.open));
      return;
    }
  });
  let stale = false;   // something closed from outside: draw again, unless a handler already did
  const repaint = () => { if (stale) paint(); };
  dismissOnOutside(doc, { rank: 3, open: () => !!s.menu, inside: (t) => !!t.closest('.menu') || t.closest?.('[data-menu]')?.dataset.menu === s.menu, back: () => root.querySelector(`[data-menu="${q(s.menu)}"]`), close: () => { s.menu = ''; stale = true; }, paint: repaint });
  dismissOnOutside(doc, { rank: 3, open: () => !!s.pop, inside: '.list-pop', back: () => (s.pop ? root.querySelector(s.pop.anchor) : null), close: () => { s.pop = null; stale = true; }, paint: repaint });
  dismissOnOutside(doc, { dialog: true, open: () => !!s.dialog, inside: (t) => root.contains(t) && !!t.closest('.viewer-modal .card'), back: () => (s.dialog?.back ? root.querySelector(s.dialog.back) : null), close: () => { s.dialog = null; stale = true; }, paint: repaint });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'list-pop-q') { s.pop.q = e.target.value; paint(); }
    else if (e.target.hasAttribute('data-dlg-name') && s.dialog) { s.dialog.value = e.target.value; s.dialog.typed = true; }
  });
  root.addEventListener('focusin', (e) => { const r = e.target.closest('[data-row]'); if (r) s.focus = r.dataset.row; });
  bindLongPress({ root, selector: '[data-row]', onPress: (r) => { s.pick = selectStart(s.pick); applyPick(selectionAction({ press: true }), r.dataset.row); }, win });

  function openSheet() {
    openShortcutsSheet({ doc, scopes: ['anywhere', 'list', 'selecting', ...(spec.scopes || [])], can: spec.can(), fallback: () => rowEl(s.focus) || root.querySelector('[data-open]') });
  }
  function dialogStep(step) {
    const d = s.dialog;
    if (step !== 'yes') { s.dialog = null; paint({ focus: d.back || '' }); return; }
    const v = (root.querySelector('[data-dlg-name]')?.value || '').replace(/\s+/g, ' ').trim();
    if (!v) { d.error = `${d.label} is empty`; paint(); return; }
    s.dialog = null; d.run(v);
  }
  function moveMenu(e) {
    const items = [...root.querySelectorAll('.menu .menu-item')];
    if (!items.length) return;
    const i = items.indexOf(doc.activeElement), n = items.length;
    items[e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n]?.focus();
  }

  doc.addEventListener('keydown', (e) => {
    if (!spec.active()) return;
    if (s.dialog) {
      if (e.key === 'Enter' && e.target.matches?.('[data-dlg-name]')) { e.preventDefault(); dialogStep('yes'); }
      return;
    }
    if (s.pop) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const items = [...root.querySelectorAll('.list-pop .menu-item')], i = items.indexOf(doc.activeElement); if (items.length) items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length]?.focus(); return; }
      if (e.key === 'Enter' && e.target.id === 'list-pop-q') { e.preventDefault(); root.querySelector('.list-pop .menu-item')?.click(); }
      return;
    }
    if (s.menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveMenu(e); }
      return;
    }
    if (s.confirm && e.key === 'Escape') { e.preventDefault(); s.confirm = null; paint(); return; }
    const scopes = ['selecting', 'list', ...(spec.scopes || []), 'anywhere'];
    const act = shortcutAction(keyFacts(e, '[data-open]'), { scopes, selecting: s.pick.on, can: spec.can() });
    if (!act || act === 'search' || act === 'close') return;
    if (e.target.closest?.('.ask-side:not(.chats-side), #app')) return;
    e.preventDefault();
    const from = e.target.closest?.('[data-row]')?.dataset.row || s.focus, row = s.rows.get(from);
    if (act === 'help') { openSheet(); return; }
    if (act === 'down' || act === 'up') { rowEl(listMove(s.order, from, act === 'down' ? 1 : -1))?.focus(); return; }
    if (act === 'open') { e.target.closest('[data-open]').click(); return; }
    if (act === 'clear') { s.pick = selectClear(); paint(); return; }
    if (act === 'toggle' || act === 'all' || act === 'extend-down' || act === 'extend-up') {
      const r = selectStep(act === 'all' || act === 'toggle' ? selectStart(s.pick) : s.pick, act, { from, shown: s.order });
      s.pick = r.pick; paint({ focus: r.to ? `[data-open="${q(r.to)}"]` : '' }); return;
    }
    if (act === 'menu') { if (row?.menu) { s.menu = `row:${row.key}`; paint(); root.querySelector('.rc-pop > .menu .menu-item')?.focus(); } return; }
    if (act === 'fold' || act === 'unfold') { if (row?.members) { s.groups.set(row.key, act === 'unfold'); paint(); } return; }
    if ((spec.scopes || []).length && spec.key?.(act) !== false && !['stop', 'archive', 'rename', 'pin', 'add-to-group', 'leave-group', 'delete'].includes(act)) return;
    if (s.pick.ids.length && ['stop', 'archive', 'add-to-group', 'delete'].includes(act)) { spec.act(act, picks(), { bulk: true, viaKey: true }); return; }
    if (row) run(act, row, { viaKey: true });
  });

  return {
    state: s, paint,
    /** Ends selecting. */
    clear() { s.pick = selectClear(); },
    /** Puts a selection back (Undo). */
    restore(pick) { s.pick = pick; },
    /** A yes or no, in the strip above the list. */
    confirm(c) { s.confirm = c; s.pop = null; paint({ focus: '[data-confirm="yes"]' }); },
    /** A step with one field. */
    dialog(d) { s.dialog = { ...d, reset: true }; s.pop = null; paint(); },
    closeDialog() { s.dialog = null; },
    /** The list's editor: one pick from a long list, or a new one (ListEditor). */
    picker(p) { s.pop = { q: '', ...p }; s.menu = ''; paint(); },
    closePicker() { s.pop = null; },
    /** Lands on a row: it opens its group, comes into view, takes the focus. */
    landOn(key) {
      for (const r of s.rows.values()) if (r.members?.some((m) => m.key === key)) s.groups.set(r.key, true);
      for (const x of spec.view().sections) if (x.rows.some((r) => r.key === key || r.members?.some((m) => m.key === key))) s.more.add(x.id);
      paint({ focus: `[data-open="${q(key)}"]` });
      const el = root.querySelector(`[data-row="${q(key)}"]`); if (el) land(el);
    },
    openGroup(key) { s.groups.set(key, true); },
    toggleGroup(key) { const r = s.rows.get(key); s.groups.set(key, !groupOpen(r)); paint({ focus: `[data-open="${q(key)}"]` }); },
    focusList() { (rowEl(s.focus) || root.querySelector('[data-open]'))?.focus(); },
    /** Coming back: the scroll and the focus as they were. */
    focusRow() { rowEl(s.focus)?.focus({ preventScroll: true }); },
  };
}
