// Scrollbars (docs/rail/look.md): thin, and only there when wanted: over a scroller under the pointer, or while it scrolls.
// The look is rail-look.css's; this marks what is scrolling, so a page scrolled from the keyboard shows its bar too.

export const SCROLL_SHOW_MS = 800;
const watched = new WeakSet();

/** Marks whatever scrolls in `doc` with .is-scrolling for a moment. Once per document. */
export function watchScrollbars(doc, { wait = setTimeout, clear = clearTimeout } = {}) {
  if (watched.has(doc)) return;
  watched.add(doc);
  const timers = new WeakMap();
  doc.addEventListener('scroll', (e) => {
    const el = e.target === doc ? doc.documentElement : e.target;
    if (!el?.classList) return;
    el.classList.add('is-scrolling');
    clear(timers.get(el));
    timers.set(el, wait(() => el.classList.remove('is-scrolling'), SCROLL_SHOW_MS));
  }, { capture: true, passive: true });
}
