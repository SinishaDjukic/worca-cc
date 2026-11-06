// Scrollbars (docs/rail/look.md): thin, and only there when wanted: as the mouse moves, on what is under it and the page, and
// while something scrolls. The look is rail-look.css's; this marks what should show, then lets it go.

export const SCROLL_SHOW_MS = 800;
const watched = new WeakSet();

/** Marks what scrolls, and on a mouse move what could scroll under the pointer, with .is-scrolling for a moment. Once per document. */
export function watchScrollbars(doc, { wait = setTimeout, clear = clearTimeout } = {}) {
  if (watched.has(doc)) return;
  watched.add(doc);
  const timers = new WeakMap();
  const show = (el) => {
    el.classList.add('is-scrolling');
    clear(timers.get(el));
    timers.set(el, wait(() => el.classList.remove('is-scrolling'), SCROLL_SHOW_MS));
  };
  doc.addEventListener('scroll', (e) => {
    const el = e.target === doc ? doc.documentElement : e.target;
    if (el?.classList) show(el);
  }, { capture: true, passive: true });
  doc.addEventListener('mousemove', (e) => {
    show(doc.documentElement);
    for (let el = e.target; el?.classList && el !== doc.documentElement; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) show(el);
    }
  }, { passive: true });
}
