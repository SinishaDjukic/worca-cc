// ui/public/group-picker.mjs — Add to group… (runs redesign §3.3), shared by the Runs list and the Chats column: a
// popover anchored to its opener, placed and clamped with placeFlyout. A combobox over one listbox (topnav-search.mjs's
// pattern): the focus stays in "Find or create a group" and aria-activedescendant names the highlighted option. Order:
// New group…, Recent (group-add.mjs), All groups; while typing, the matches, then Create "…" unless the text is an
// existing name (case-insensitive). Nothing is highlighted on open, so Enter on an empty search does nothing. Each
// group: the one status dot (status-dot.mjs) and its "2/3". groups: [{ id, title, model }]. `anchor` may be a function
// (the opener is rebuilt by a repaint): Esc focuses whatever it answers then.
import { renderStatusDot } from './status-dot.mjs';
import { placeFlyout } from './side-flyout.mjs';
import { icon } from './icons.mjs';
import { RECENT_SHOWN } from './group-add.mjs';
import { GROUP_NAME_MAX } from './group-dialog.mjs';

let seq = 0;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function openGroupPicker({ doc, anchor, groups, recent = [], onPick, onCreate, onNew, onClose = () => {} }) {
  const anchorEl = () => (typeof anchor === 'function' ? anchor() : anchor);
  const uid = `gp${++seq}`;
  let n = 0;
  const mk = (tag, cls, text) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const acts = new Map();
  const el = mk('div', 'group-picker');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Add to group');
  const q = mk('input', 'input gp-search');
  q.type = 'search';
  q.autocomplete = 'off';
  q.maxLength = GROUP_NAME_MAX;
  q.placeholder = 'Find or create a group';
  q.setAttribute('aria-label', 'Find or create a group');
  q.setAttribute('role', 'combobox');
  q.setAttribute('aria-expanded', 'true');
  q.setAttribute('aria-autocomplete', 'list');
  const list = mk('div', 'gp-list');
  list.id = `${uid}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Groups');
  q.setAttribute('aria-controls', list.id);

  const option = (cls, run) => {
    const o = mk('div', cls ? `gp-row ${cls}` : 'gp-row');
    o.id = `${uid}-o${n++}`;
    o.setAttribute('role', 'option');
    o.setAttribute('aria-selected', 'false');
    acts.set(o, run);
    return o;
  };
  const plusRow = (cls, text, run) => { const o = option(cls, run); o.append(icon(doc, 'plus', 14), mk('span', 'gp-title', text)); return o; };
  const sep = () => { const s = mk('div', 'menu-sep'); s.setAttribute('aria-hidden', 'true'); return s; };
  const groupRow = (g) => {
    const o = option('', () => { close(); onPick(g); });
    o.dataset.groupId = g.id;
    o.append(renderStatusDot(doc, g.model), mk('span', 'gp-title', g.title), mk('span', 'runs-count', g.model.count ? g.model.count.text : ''));
    return o;
  };
  const section = (label, items) => {
    if (!items.length) return null;
    const s = mk('div', 'gp-sec');
    s.setAttribute('role', 'group');
    const h = mk('div', 'menu-h gp-head', label);
    h.id = `${uid}-h${n++}`;
    s.setAttribute('aria-labelledby', h.id);
    s.append(h, ...items.map(groupRow));
    return s;
  };

  const neu = plusRow('gp-new', 'New group…', () => { close(); onNew(); });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const recentGroups = [...new Set(recent)].map((id) => byId.get(id)).filter(Boolean).slice(0, RECENT_SHOWN);
  const rest = groups.filter((g) => !recentGroups.includes(g));
  const neuSep = sep();
  list.append(neu, neuSep);
  if (recentGroups.length) list.append(...[section('Recent', recentGroups), section('All groups', rest)].filter(Boolean));
  else list.append(...rest.map(groupRow));
  neuSep.hidden = !groups.length;
  const createSep = sep();
  const create = plusRow('gp-create', '', () => { const name = norm(q.value); close(); onCreate(name); });
  createSep.hidden = true;
  create.hidden = true;
  list.append(createSep, create);

  const foot = mk('p', 'gp-foot');
  foot.setAttribute('aria-hidden', 'true');   // the roles already say it; the hint is for sighted keyboard users
  const hint = (keys, text) => { const s = mk('span', 'gp-hint'); s.append(...keys.map((k) => mk('kbd', 'kbd', k)), ` ${text}`); return s; };

  const shown = () => [...list.querySelectorAll('[role="option"]')].filter((o) => !o.hidden);
  let active = null;
  function paintFoot() {
    if (!active) { foot.replaceChildren(hint(['↑', '↓'], 'move'), hint(['Enter'], 'add'), hint(['Esc'], 'close')); return; }
    const what = active === create ? 'create and add' : active === neu ? 'new group' : `add to ${active.querySelector('.gp-title').textContent}`;
    foot.replaceChildren(hint(['Enter'], what));
  }
  function setActive(o) {
    if (active) { active.classList.remove('is-active'); active.setAttribute('aria-selected', 'false'); }
    active = o || null;
    if (active) {
      active.classList.add('is-active');
      active.setAttribute('aria-selected', 'true');
      q.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else q.removeAttribute('aria-activedescendant');
    paintFoot();
  }
  function filter() {
    const text = norm(q.value);
    const s = text.toLowerCase();
    neu.hidden = !!s;
    neuSep.hidden = !!s || !groups.length;
    for (const h of list.querySelectorAll('.gp-head')) h.hidden = !!s;
    let matches = 0;
    for (const o of list.querySelectorAll('.gp-row[data-group-id]')) {
      o.hidden = !!s && !o.querySelector('.gp-title').textContent.toLowerCase().includes(s);
      if (!o.hidden) matches += 1;
    }
    create.hidden = !s || groups.some((g) => norm(g.title).toLowerCase() === s);
    createSep.hidden = create.hidden || !matches;
    create.querySelector('.gp-title').textContent = `Create “${text}”`;
    setActive(s ? shown().filter((o) => o !== neu)[0] || null : null);
  }
  function focusBack() { const a = anchorEl(); if (a && a.isConnected) a.focus(); }

  q.addEventListener('input', filter);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); focusBack(); return; }
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const opts = shown();
      if (!opts.length) return;
      const i = opts.indexOf(active);
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(opts[i < 0 ? (d > 0 ? 0 : opts.length - 1) : (i + d + opts.length) % opts.length]);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); if (active) acts.get(active)(); }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());   // a click keeps the focus in the search
  list.addEventListener('click', (e) => { const o = e.target.closest?.('[role="option"]'); if (o && acts.has(o)) acts.get(o)(); });
  const onDown = (e) => { if (!el.contains(e.target) && e.target !== anchorEl()) close(); };
  paintFoot();
  el.append(q, list, foot);
  doc.body.append(el);
  placeFlyout(el, anchorEl(), { mode: 'down', gap: 4, margin: 8, win: doc.defaultView });   // its default win is globalThis.window, unset under a test's JSDOM
  doc.addEventListener('pointerdown', onDown, true);
  q.focus();
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    doc.removeEventListener('pointerdown', onDown, true);
    el.remove();
    onClose();
  }
  return { el, close };
}
