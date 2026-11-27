// ui/public/models/open-picker.mjs — the open/close lifecycle every model picker shares (the Jobs tab's menu,
// model-picker.mjs, and the cascading columns, model-columns.mjs): one open picker per document, appended to <body>,
// placed again on a page scroll and a window resize, closed by Escape (taken on the window, before any document
// listener the page added at load, so a run page's Escape never also steps the route back), by a press or focus outside
// it and its anchor, and by its anchor leaving the document (a redraw under it). The caller builds the root and places
// it; nothing here fetches or runs when the module loads.

/** The open picker of each document: { anchor, close }. */
const OPEN = new WeakMap();

/** Opens `root` (built by the caller) as the one open picker of `doc`: appended to <body>, `place()` called now, again
 *  on a page scroll (not a scroll inside root) and on a window resize; `anchor` gets aria-expanded="true". A second call
 *  on the same anchor only closes the open one and returns null (a toggle); another anchor's picker closes first.
 *  Escape: a keydown listener on `win` in the capture phase (before any document listener the page added at load):
 *  preventDefault, stopImmediatePropagation, close(true). A pointerdown, or focus, outside root and anchor: close(false).
 *  The anchor leaving the document (a MutationObserver on doc.body, childList + subtree): close(false), then, when the
 *  focus was inside root, refocus()?.focus().
 *  → { close(refocus = false), pick(report) } | null. close removes root, every listener and the observer, sets
 *  aria-expanded="false" and focuses the anchor when asked (a no-op once closed); pick is close(true), then report(). */
export function openPicker({ doc, win, anchor, root, place, refocus = () => null }) {
  const prev = OPEN.get(doc);
  if (prev) {
    prev.close();
    if (prev.anchor === anchor) return null;
  }
  const view = win || doc.defaultView;
  let closed = false;
  let observer = null;

  function close(focusAnchor = false) {
    if (closed) return;
    closed = true;
    if (view) {
      view.removeEventListener('keydown', onEscape, true);
      view.removeEventListener('resize', place);
    }
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('scroll', onScroll, true);
    if (observer) observer.disconnect();
    root.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (OPEN.get(doc)?.anchor === anchor) OPEN.delete(doc);
    if (focusAnchor) { try { anchor.focus(); } catch { /* detached */ } }
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
  function onMutation() {
    if (closed || anchor.isConnected) return;
    const hadFocus = root.contains(doc.activeElement);
    close(false);
    if (hadFocus) {
      const next = refocus();
      if (next) { try { next.focus(); } catch { /* detached */ } }
    }
  }

  doc.body.append(root);
  place();
  anchor.setAttribute('aria-expanded', 'true');
  OPEN.set(doc, { anchor, close: () => close(false) });
  if (view) {
    view.addEventListener('keydown', onEscape, true);
    view.addEventListener('resize', place);
  }
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('scroll', onScroll, true);
  if (view && typeof view.MutationObserver === 'function') {
    observer = new view.MutationObserver(onMutation);
    observer.observe(doc.body, { childList: true, subtree: true });
  }
  return {
    close,
    pick(report) {
      if (closed) return;   // a removed picker reports nothing
      close(true);
      if (typeof report === 'function') report();
    },
  };
}

/** The open picker of `doc`: { anchor, close() } (close = close(false)), or null. */
export function openPickerOf(doc) {
  return OPEN.get(doc) || null;
}
