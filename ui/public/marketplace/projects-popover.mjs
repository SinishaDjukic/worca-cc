// ui/public/marketplace/projects-popover.mjs — "Projects you work on" (plans/ticket-updates-design.md §8 board 3, §10 C/D, §11).
// label-picker.mjs's openLabelPicker pattern: a search box over a multi-select listbox of checkbox rows that stays open across
// toggles. Toggles apply at once (onToggle); Done, Esc or a press outside closes it and focuses the anchor (Add projects…).
// The focus stays in the search box (§11 listbox model): ↑ ↓ Home End move the active row (aria-activedescendant), Enter or a
// click toggles it; Space stays a typed character. Each row is the option (aria-selected); its tick is decorative. Pure DOM.
import { placeFlyout } from '../side-flyout.mjs';

export const FALLBACK_ERROR = 'Worca could not finish that. Try again.';
let seq = 0;
const nameOf = (p) => String(p.name || p.label || p.value);

/**
 * @param {{doc:Document, anchor:HTMLElement, host?:Element|null, profileLabel:string, tracker:string, isPicked:(v:string)=>boolean,
 *   pickedCount:()=>number, loadProjects:()=>Promise<Array<{value:string,label:string,name?:string}>>, onToggle:(p:object, on:boolean)=>void,
 *   onClose?:()=>void}} o
 * @returns {{el:HTMLElement, close:()=>void}}
 */
export function openProjectsPopover({ doc, anchor, host = null, profileLabel, tracker, isPicked, pickedCount, loadProjects, onToggle, onClose = () => {} }) {
  const uid = `mk-tu-pp${++seq}`;
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let all = null;
  let failure = null;
  let active = null;
  let open = true;

  const el = mk('div', 'mk-tu-pop mk-tu-projpop');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Projects you work on');
  const lab = mk('label', 'sr-only', 'Find a project');
  lab.htmlFor = `${uid}-q`;
  const q = mk('input', 'input mk-tu-search');
  q.type = 'search';
  q.id = `${uid}-q`;
  q.placeholder = 'Find a project by key or name';
  q.autocomplete = 'off';
  // S12: the box the active row hangs on (aria-activedescendant) is a combobox, as group-picker.mjs's search
  q.setAttribute('role', 'combobox');
  q.setAttribute('aria-expanded', 'true');
  q.setAttribute('aria-autocomplete', 'list');
  q.setAttribute('aria-controls', `${uid}-list`);
  const listEl = mk('div', 'mk-tu-plist');
  listEl.id = `${uid}-list`;
  listEl.setAttribute('role', 'listbox');
  listEl.setAttribute('aria-multiselectable', 'true');
  listEl.setAttribute('aria-label', `${tracker} projects`);
  const live = mk('p', 'mk-tu-live');
  live.setAttribute('aria-live', 'polite');
  const retry = mk('button', 'btn btn-sm mk-tu-retry', 'Try again');
  retry.type = 'button';
  retry.hidden = true;
  const foot = mk('div', 'mk-tu-pfoot');
  const count = mk('span', 'mk-tu-pcount');
  const done = mk('button', 'btn btn-sm btn-primary mk-tu-done', 'Done');
  done.type = 'button';
  foot.append(count, done);
  el.append(lab, q, listEl, live, retry, foot);

  const rows = () => [...listEl.querySelectorAll('.mk-tu-prow')];
  function paintFoot() {
    const n = pickedCount();
    count.textContent = all ? `${n ? `${n} picked` : 'None picked'} · ${all.length} projects on ${profileLabel}` : '';
  }
  function setActive(r) {
    if (active) active.classList.remove('is-active');
    active = r || null;
    if (active) { active.classList.add('is-active'); q.setAttribute('aria-activedescendant', active.id); active.scrollIntoView?.({ block: 'nearest' }); }
    else q.removeAttribute('aria-activedescendant');
  }
  function toggle(r, p) {
    const on = r.getAttribute('aria-selected') !== 'true';
    r.setAttribute('aria-selected', String(on));
    onToggle(p, on);
    paintFoot();
  }
  let placedAt = null;
  const place = () => { placeFlyout(el, anchor, { mode: 'down', gap: 4, margin: 8, fit: true, win: doc.defaultView }); placedAt = anchor.getBoundingClientRect(); };   // never over Add projects…
  function rowFor(p, i) {
    const r = mk('div', 'mk-tu-prow');
    r.id = `${uid}-r${i}`;
    r.setAttribute('role', 'option');
    r.dataset.value = String(p.value);
    const on = isPicked(String(p.value));
    r.setAttribute('aria-selected', String(on));
    const box = mk('span', 'mk-tu-pcheck');
    box.setAttribute('aria-hidden', 'true');
    r.addEventListener('click', () => { setActive(r); toggle(r, p); });
    r.append(box, mk('span', 'mk-mono mk-tu-key', String(p.value)), mk('span', 'mk-tu-pname', nameOf(p)));
    return r;
  }
  function paint() {
    const keep = active ? active.dataset.value : null;
    const s = q.value.trim().toLowerCase();
    const shown = (all || []).filter((p) => !s || String(p.value).toLowerCase().includes(s) || nameOf(p).toLowerCase().includes(s));
    listEl.replaceChildren(...shown.map(rowFor));
    active = null;
    setActive(keep ? rows().find((r) => r.dataset.value === keep) : null);
    live.textContent = failure || (!all ? `Getting ${profileLabel}'s projects…` : (!shown.length ? 'No project matches.' : ''));
    retry.hidden = !failure;
    paintFoot();
  }
  async function load() {
    failure = null;
    paint();
    try { const r = await loadProjects(); all = Array.isArray(r) ? r : []; }
    catch (e) { failure = String((e && e.message) || FALLBACK_ERROR); }
    if (open) { paint(); place(); }   // the width changed with the rows: stay right-aligned under the anchor
  }

  /** `refocus` false: the focus already went somewhere else (Tab out), so it is left there. */
  function close(refocus = true, keepScroll = false) {
    if (!open) return;
    open = false;
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('keydown', onEsc, true);
    doc.removeEventListener('scroll', onScroll, { capture: true });
    doc.defaultView?.removeEventListener('resize', onResize);
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
    onClose();
    if (refocus && anchor && anchor.isConnected) anchor.focus(keepScroll ? { preventScroll: true } : undefined);
  }
  const onEsc = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } };
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  // Fixed popup: it closes when a scroller that holds its button scrolls the button away from where the popup was placed, or the
  // window resizes (its own list may scroll, and the focus may scroll the sheet without moving the button)
  const onScroll = (e) => {
    if (!placedAt || !e.target || typeof e.target.contains !== 'function' || !e.target.contains(anchor)) return;
    const r = anchor.getBoundingClientRect();
    if (Math.abs(r.top - placedAt.top) > 1 || Math.abs(r.left - placedAt.left) > 1) close(true, true);
  };
  const onResize = () => close();
  // Tab away from both the popover and Add projects… closes it (a repaint that drops the focused row has no relatedTarget)
  const onFocusOut = (e) => { const to = e.relatedTarget; if (to && !el.contains(to) && !anchor.contains(to)) close(false); };

  q.addEventListener('input', paint);
  q.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const list = rows();
    const i = list.indexOf(active);
    const go = (r) => { e.preventDefault(); setActive(r || null); };
    if (e.key === 'ArrowDown') go(list[Math.min(list.length - 1, i + 1)]);
    else if (e.key === 'ArrowUp') go(list[Math.max(0, i - 1)]);
    else if (e.key === 'Home' && list.length) go(list[0]);
    else if (e.key === 'End' && list.length) go(list[list.length - 1]);
    else if (e.key === 'Enter') { e.preventDefault(); active?.click(); }
  });
  // a press on a row must not pull the focus out of the search box
  listEl.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('focusout', onFocusOut);
  retry.addEventListener('click', () => { void load(); q.focus(); });
  done.addEventListener('click', () => close());

  (host || doc.body).append(el);
  anchor.setAttribute('aria-expanded', 'true');
  // Right-aligned under Add projects… (placeFlyout 'down', board 3; decided 2026-10-30)
  place();
  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('keydown', onEsc, true);
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  doc.defaultView?.addEventListener('resize', onResize);
  q.focus();
  void load();
  return { el, close };
}
