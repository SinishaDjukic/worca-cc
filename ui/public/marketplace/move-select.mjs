// ui/public/marketplace/move-select.mjs — Ticket updates' move select (plans/ticket-updates-design.md §8 board 4, §10 C/D, §11).
// A button with role="combobox" opening a listbox placed by placeFlyout (side-flyout.mjs). Focus stays on the button while the
// list is open and aria-activedescendant names the active option (group-picker.mjs's openGroupPicker, topnav-search.mjs);
// group labels and sub-lines as cost-dimension-picker.mjs. A project's statuses load on first open through `loadStatuses` (the
// section caches them); a failed load is asked again on the next open or by Try again. Pure DOM; `doc` is injected.
import { icon } from '../icons.mjs';
import { placeFlyout } from '../side-flyout.mjs';

export const FALLBACK_ERROR = 'Worca could not finish that. Try again.';
/** Letters typed within this long make one type-ahead word. */
export const TYPE_AHEAD_MS = 700;
/** The status groups in §9's order, each with its label. */
export const CATEGORY_GROUPS = Object.freeze([
  ['done', (key) => `Done · ${key}'s workflow`], ['in_progress', () => 'In progress'], ['todo', () => 'To do'], ['cancelled', () => 'Cancelled'],
]);
let seq = 0;

/** The words a target shows as. */
export function targetText(target) {
  const t = target || { kind: 'none' };
  if (t.kind === 'category') return 'Any Done status';
  if (t.kind === 'status') return String(t.label || t.value);
  if (t.kind === 'typed') return `${t.value} (as typed)`;
  return "Don't move";
}

/** Two targets are the same choice (a status by its id). */
export function sameTarget(a, b) {
  const ka = (a && a.kind) || 'none';
  const kb = (b && b.kind) || 'none';
  if (ka !== kb) return false;
  return ka === 'status' || ka === 'typed' ? String(a.value) === String(b.value) : true;
}

const keyOf = (t) => `${t.kind}:${t.value ?? ''}`;
/** The dot class of a target: a status by its category, Any Done status green, a typed value grey, Don't move an empty dot. */
const dotOf = (t) => `mk-tu-dot mk-tu-dot-${t.kind === 'status' ? (t.category || 'todo') : t.kind}`;

/**
 * @param {{doc:Document, project?:string, value?:object|null, general?:boolean, label?:string|null,
 *   loadStatuses?:()=>Array|Promise<Array>, onChange?:(t:object)=>void, host?:Element|null, now?:()=>number}} o
 */
export function createMoveSelect({ doc, project = '', value = null, general = false, label = null, loadStatuses = () => [],
  onChange = () => {}, host = null, now = () => Date.now() }) {
  const uid = `mk-tu-ms${++seq}`;
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const name = label || (general ? 'All projects: move to' : `${project}: move to`);
  let current = value || { kind: 'none' };
  let loaded = null;
  let loading = false;
  let failure = null;
  let pop = null;
  let listEl = null;
  let liveEl = null;
  let retry = null;
  let active = null;
  const targets = new Map();   // option element → its target
  let moved = false;   // the person moved the active option since the list opened (keys, type-ahead)
  let typed = '';
  let typedAt = -Infinity;

  const wrap = mk('div', 'mk-tu-movewrap');
  const lab = mk('span', 'sr-only', name);
  lab.id = `${uid}-label`;
  const btn = mk('button', 'mk-tu-move');
  btn.type = 'button';
  btn.id = uid;
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-labelledby', lab.id);   // aria-controls only while the list exists (set in open, removed in close)
  // board 1: the closed select shows the chosen target's dot before its name, as the options do
  const dotEl = mk('span', dotOf(current));
  dotEl.setAttribute('aria-hidden', 'true');
  const txt = mk('span', 'mk-tu-move-t', targetText(current));
  btn.append(dotEl, txt, icon(doc, 'chevron', 14, 'ic mk-tu-move-ic'));
  const paintButton = () => { dotEl.className = dotOf(current); txt.textContent = targetText(current); };
  wrap.append(lab, btn);

  const options = () => (listEl ? [...listEl.querySelectorAll('[role="option"]')] : []);
  const titleOf = (o) => (o.querySelector('.mk-tu-opt-t')?.textContent || '').toLowerCase();

  function optionEl(o, i) {
    const n = mk('div', 'mk-tu-opt');
    n.id = `${uid}-o${i}`;
    n.setAttribute('role', 'option');
    const t = o.kind === 'status' ? { kind: 'status', value: o.value, label: o.label, category: o.category }
      : o.kind === 'category' ? { kind: 'category', value: 'done' }
        : o.kind === 'typed' ? { kind: 'typed', value: o.value } : { kind: 'none' };
    targets.set(n, t);
    const selected = sameTarget(t, current);
    n.setAttribute('aria-selected', String(selected));
    const dot = mk('span', dotOf(t));
    dot.setAttribute('aria-hidden', 'true');
    const body = mk('span', 'mk-tu-opt-b');
    body.append(mk('span', 'mk-tu-opt-t', o.label));
    if (o.sub) body.append(mk('span', 'mk-tu-opt-s', o.sub));
    n.append(dot, body);
    if (selected) n.append(icon(doc, 'check', 14, 'ic mk-tu-opt-check'));
    return n;
  }

  function setActive(o) {
    if (active) active.classList.remove('is-active');
    active = o || null;
    if (active) {
      active.classList.add('is-active');
      btn.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else btn.removeAttribute('aria-activedescendant');
  }

  function paintList() {
    // Keep the active option across a repaint only once the person moved it; else open on the selected option (the first
    // paint runs before the statuses load, so an unconditional keep would leave every status rule on Don't move).
    const keep = moved && active && targets.has(active) ? keyOf(targets.get(active)) : null;
    targets.clear();
    let i = 0;
    const general2 = [{ kind: 'none', label: "Don't move" }, { kind: 'category', value: 'done', label: 'Any Done status', sub: 'One this ticket can reach' }];
    if (current.kind === 'typed') general2.push({ kind: 'typed', value: String(current.value), label: targetText(current) });
    const nodes = general2.map((o) => optionEl(o, i++));
    if (!general) {
      const groups = [];
      for (const [cat, title] of CATEGORY_GROUPS) {
        const items = (loaded || []).filter((s) => s && s.category === cat);
        if (!items.length) continue;
        // §11: the group says the category to a screen reader (aria-label, as group-picker.mjs); its visible label is not read twice
        const grp = mk('div', 'mk-tu-optgroup');
        grp.setAttribute('role', 'group');
        grp.setAttribute('aria-label', title(project));
        const g = mk('div', 'mk-tu-group', title(project));
        g.setAttribute('role', 'presentation');
        g.setAttribute('aria-hidden', 'true');
        grp.append(g, ...items.map((s) => optionEl({ kind: 'status', value: String(s.value), label: String(s.label ?? s.value), category: cat }, i++)));
        groups.push(grp);
      }
      if (groups.length) {   // no separator with nothing under it (loading, a failure, an empty workflow)
        const sep = mk('div', 'mk-tu-sep');
        sep.setAttribute('role', 'presentation');
        nodes.push(sep, ...groups);
      }
    }
    listEl.replaceChildren(...nodes);
    const opts = options();
    setActive((keep && opts.find((o) => keyOf(targets.get(o)) === keep))
      || opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0] || null);
  }

  function paintState() {
    if (!liveEl) return;
    liveEl.textContent = general ? '' : (failure || (loading ? `Getting ${project}'s statuses…` : ''));
    retry.hidden = general || !failure;
  }

  async function load() {
    loading = true;
    failure = null;
    paintState();
    try {
      const r = await loadStatuses();
      loaded = Array.isArray(r) ? r : [];
    } catch (e) {
      failure = String((e && e.message) || FALLBACK_ERROR);
    }
    loading = false;
    if (pop) { paintList(); paintState(); place(); }   // the list grew with the statuses: fit it again
  }

  /** Under the select, or above it when only above has room; never over it (placeFlyout fit). The active option stays in view. */
  function place() {
    pop.style.minWidth = `${btn.offsetWidth}px`;
    placeFlyout(pop, btn, { mode: 'down', gap: 4, margin: 8, fit: true, win: doc.defaultView });
    active?.scrollIntoView?.({ block: 'nearest' });
  }

  const onDown = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };

  function open() {
    if (pop) return;
    pop = mk('div', 'mk-tu-pop mk-tu-movepop');
    listEl = mk('div', 'mk-tu-list');
    listEl.id = `${uid}-list`;
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', general ? name : `${project} statuses`);
    liveEl = mk('p', 'mk-tu-live');
    liveEl.setAttribute('aria-live', 'polite');
    retry = mk('button', 'btn btn-sm mk-tu-retry', 'Try again');
    retry.type = 'button';
    retry.hidden = true;
    retry.addEventListener('click', () => { void load(); btn.focus(); });
    pop.append(listEl, liveEl, retry);
    pop.addEventListener('mousedown', (e) => e.preventDefault());   // a press keeps the focus on the select
    pop.addEventListener('click', (e) => { const o = e.target.closest?.('[role="option"]'); if (o && targets.has(o)) pick(o); });
    (host || doc.body).append(pop);
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', listEl.id);
    paintList();
    paintState();
    place();
    doc.addEventListener('pointerdown', onDown, true);
    if (!general && !loaded && !loading) void load();
  }

  function close() {
    if (!pop) return;
    doc.removeEventListener('pointerdown', onDown, true);
    pop.remove();
    pop = null; listEl = null; liveEl = null; retry = null; active = null; moved = false;
    targets.clear();
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-controls');
    btn.removeAttribute('aria-activedescendant');
  }

  function pick(o) {
    const t = targets.get(o);
    close();
    btn.focus();
    if (t && !sameTarget(t, current)) {
      current = t;
      paintButton();
      onChange(current);
    }
  }

  function typeAhead(ch) {
    const t = now();
    typed = t - typedAt > TYPE_AHEAD_MS ? ch.toLowerCase() : typed + ch.toLowerCase();
    typedAt = t;
    const opts = options();
    if (typed.length > 1 && active && titleOf(active).startsWith(typed)) return;   // a longer word stays while it still matches
    const i = opts.indexOf(active);
    const hit = [...opts.slice(i + 1), ...opts.slice(0, i + 1)].find((o) => titleOf(o).startsWith(typed));
    if (hit) { moved = true; setActive(hit); }
  }

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });   // Space never clicks the button too
  btn.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (!pop) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    const opts = options();
    const i = opts.indexOf(active);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moved = true; setActive(opts[Math.min(opts.length - 1, i + 1)] || opts[0]); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moved = true; setActive(opts[Math.max(0, i - 1)] || opts[0]); return; }
    if (e.key === 'Home') { e.preventDefault(); moved = true; setActive(opts[0]); return; }
    if (e.key === 'End') { e.preventDefault(); moved = true; setActive(opts[opts.length - 1]); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active) pick(active); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeAhead(e.key); }
  });

  return {
    el: wrap,
    button: btn,
    get: () => current,
    set(t) { current = t || { kind: 'none' }; paintButton(); if (pop) { paintList(); place(); } },
    describe(id) { if (id) btn.setAttribute('aria-describedby', id); else btn.removeAttribute('aria-describedby'); },
    open,
    close,
    isOpen: () => !!pop,
    destroy: close,
  };
}
