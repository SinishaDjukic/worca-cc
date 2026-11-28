// ui/public/run-links.mjs — Shaper small runs s8 (R-ux-2): link marks on pointing. Pointing at a run row (hover or
// focus) marks the rows it directly builds on (data-link="on", the solid bar) and the rows that directly build on it
// (data-link="by", the dashed bar). Click, Enter or Space keeps the marks; Esc lets go, wherever focus is. The one
// home of this logic: the Chat card and the feature page bind it on their rows' host. Marks are DOM attributes set
// after each build, never part of the built HTML, so group-page.mjs keepUnchanged's signature is not disturbed.
// R-ux-6: `onShow(run)` hears the run the marks are shown for after every paint, so the run order map can follow.

/** The marks for pointing at `run`: 'on' for the rows it builds on, 'by' for the rows that list it. 'on' wins. */
export function linkMarksOf(rows, run) {
  const out = new Map();
  const me = run == null ? null : rows.find((r) => r.run === run);
  if (!me) return out;
  for (const r of rows) {
    if (r.run === run) continue;
    if (me.buildsOn.includes(r.run)) out.set(r.run, 'on');
    else if (r.buildsOn.includes(run)) out.set(r.run, 'by');
  }
  return out;
}

const ROW = 'li[data-run]';
const ATTRS = ['data-link', 'data-link-kept', 'aria-current'];

/** Binds pointing, keeping and letting go on `host` (its rows carry no listeners). `repaint(scope, build)` wraps every
 *  rebuild of the rows: the marks, the kept row and a focused row survive it, and another `scope` drops the kept run.
 *  `onShow(run|null)` is called at the end of every paint with the pointed run, else the kept one; a throw from it is
 *  caught, so the row marks never depend on it. `shown()` answers the same run. */
export function bindRunLinks(host, { onShow } = {}) {
  if (!host) return { repaint: (scope, build) => build(), detach() {}, shown: () => null };
  const doc = host.ownerDocument;
  let pointed = null;
  let hovered = null;   // the row under the pointer: focus leaving the list falls back to it
  let kept = null;
  let scope;
  let docBound = false;

  const rowsOf = () => [...host.querySelectorAll(ROW)];
  const rowAt = (n) => (n && n.closest ? n.closest(ROW) : null);
  const ownRow = (n) => { const li = rowAt(n); return li && host.contains(li) ? li : null; };
  const runOf = (li) => Number(li.dataset.run);
  const focusedRun = () => { const li = ownRow(doc.activeElement); return li && li.matches(ROW) ? runOf(li) : null; };
  const shownMarks = () => {
    const rows = rowsOf().map((li) => ({ run: runOf(li), buildsOn: (li.dataset.buildsOn || '').split(' ').filter(Boolean).map(Number) }));
    return linkMarksOf(rows, pointed ?? kept);
  };

  function paint() {
    for (const li of host.querySelectorAll('[data-link], [data-link-kept], .run-member[aria-current]')) for (const a of ATTRS) li.removeAttribute(a);
    const marks = shownMarks();
    for (const li of rowsOf()) {
      const run = runOf(li);
      if (marks.has(run)) li.setAttribute('data-link', marks.get(run));
      if (run === kept) { li.setAttribute('data-link-kept', ''); li.setAttribute('aria-current', 'true'); }
    }
    if (kept != null && !docBound) { doc.addEventListener('keydown', onDocKey); docBound = true; }
    if (kept == null && docBound) { doc.removeEventListener('keydown', onDocKey); docBound = false; }
    if (typeof onShow === 'function') {
      try { onShow(pointed ?? kept); } catch { /* the map is optional; the row marks above stand */ }
    }
  }

  /** Esc: lets go of everything; true when there was something to clear. */
  function letGo() {
    const had = kept != null || shownMarks().size > 0;
    pointed = null;
    kept = null;
    paint();
    return had;
  }
  const toggle = (li) => { kept = kept === runOf(li) ? null : runOf(li); paint(); };

  const onOver = (e) => {
    if (e.defaultPrevented) return;
    const li = ownRow(e.target);
    if (!li) return;
    pointed = runOf(li);
    if (e.type === 'pointerover') hovered = pointed;
    paint();
  };
  const onOut = (e) => {
    if (e.defaultPrevented) return;
    if (ownRow(e.relatedTarget)) return;   // still on a row of this list: its own over/focusin follows
    if (e.type === 'pointerout') hovered = null;
    // The pointer left: the focused row (if any) still points; focus left: the hovered row (if any) still points.
    const next = e.type === 'pointerout' ? focusedRun() : hovered;
    if (next === pointed) return;
    pointed = next;
    paint();
  };
  const onClick = (e) => {
    if (e.defaultPrevented) return;
    const li = ownRow(e.target);
    if (!li || e.target.closest('a, button, .plan-checks')) return;
    toggle(li);
  };
  const onKey = (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') { if (letGo()) e.preventDefault(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches(ROW) && host.contains(e.target)) {
      e.preventDefault();
      toggle(e.target);
    }
  };
  function onDocKey(e) {
    if (e.defaultPrevented || e.key !== 'Escape') return;
    if (!host.isConnected || host.closest('.hidden, [hidden]')) return;   // a hidden page's keep takes no Escape
    const t = e.target;
    if (t && t.closest && (host.contains(t) || t.closest('dialog[open], input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
    if (letGo()) e.preventDefault();
  }

  const on = [['pointerover', onOver], ['focusin', onOver], ['pointerout', onOut], ['focusout', onOut], ['click', onClick], ['keydown', onKey]];
  for (const [t, f] of on) host.addEventListener(t, f);

  return {
    shown: () => pointed ?? kept,
    repaint(next, build) {
      if (next !== scope) { scope = next; kept = null; pointed = null; hovered = null; }
      const a = doc.activeElement;
      const focused = a && a.matches && a.matches(ROW) && host.contains(a) ? a.dataset.run : null;
      const was = pointed;
      const wasHovered = hovered;
      const out = build();
      if (focused != null && !(doc.activeElement && doc.activeElement.matches && doc.activeElement.matches(ROW) && host.contains(doc.activeElement))) {
        // A live rebuild must neither scroll the page nor let the restore's focusin override what the pointer points at.
        rowsOf().find((li) => li.dataset.run === focused)?.focus({ preventScroll: true });
        pointed = was;
        hovered = wasHovered;
      }
      paint();
      return out;
    },
    detach() {
      for (const [t, f] of on) host.removeEventListener(t, f);
      if (docBound) { doc.removeEventListener('keydown', onDocKey); docBound = false; }
    },
  };
}
