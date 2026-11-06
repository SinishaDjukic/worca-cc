// Scrollbars (docs/rail/look.md): thin, there as the mouse moves and while something scrolls, gone when still. The library
// draws them: an operating system's overlay bars show only when it says so and take no styling, so no CSS can do this. The
// browser's own bar is hidden (rail-look.css); wheel, keys and touch scroll as ever, and a bar can be dragged.

export const SCROLL_SHOW_MS = 800;
const MIN_THUMB = 24;
const NO_BAR = '.tabs, .rc-tabs';   // a strip that scrolls sideways under its own controls

/** Where a bar's thumb sits: { offset, length } along the scroller, or null when nothing overflows. */
export function thumbBox(position, scrollSize, clientSize) {
  if (scrollSize <= clientSize + 1) return null;
  const length = Math.max(MIN_THUMB, (clientSize * clientSize) / scrollSize);
  return { offset: (position / (scrollSize - clientSize)) * (clientSize - length), length };
}

const watched = new WeakSet();

/** Draws the bars of what the mouse is over, and of what scrolls. Once per document. */
export function watchScrollbars(doc, { wait = setTimeout, clear = clearTimeout } = {}) {
  if (watched.has(doc)) return;
  watched.add(doc);
  const win = doc.defaultView; const root = doc.documentElement;
  const shown = new Map();   // scroller → { v, h, timer }
  let dragging = null;
  const scrolls = (el) => {
    if (el === root) return root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1;
    if (el.matches(NO_BAR)) return false;
    const c = win.getComputedStyle(el);
    return (/auto|scroll/.test(c.overflowY) && el.scrollHeight > el.clientHeight + 1) || (/auto|scroll/.test(c.overflowX) && el.scrollWidth > el.clientWidth + 1);
  };
  const thumb = (el, axis) => {
    const t = doc.createElement('div');
    // A scroller in a panel, menu or dialog has its bar on top of it; any other bar stays under whatever opens over the page.
    t.className = `rail-thumb is-${axis}${el.closest?.('[role="dialog"], [role="menu"], .menu') ? ' is-over' : ''}`;
    t.setAttribute('aria-hidden', 'true');
    t.addEventListener('pointerdown', (e) => {
      e.preventDefault(); t.setPointerCapture?.(e.pointerId);
      dragging = { el, axis, from: axis === 'v' ? e.clientY : e.clientX, start: axis === 'v' ? el.scrollTop : el.scrollLeft };
    });
    t.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.el !== el) return;
      const size = axis === 'v' ? [el.scrollHeight, el.clientHeight] : [el.scrollWidth, el.clientWidth];
      const box = thumbBox(0, size[0], size[1]); if (!box) return;
      const moved = (axis === 'v' ? e.clientY : e.clientX) - dragging.from;
      const to = dragging.start + (moved * (size[0] - size[1])) / (size[1] - box.length);
      if (axis === 'v') el.scrollTop = to; else el.scrollLeft = to;
    });
    t.addEventListener('pointerup', () => { dragging = null; });
    doc.body.appendChild(t);
    return t;
  };
  const place = (el, s) => {
    const r = el === root ? { top: 0, left: 0, width: root.clientWidth, height: root.clientHeight } : el.getBoundingClientRect();
    const v = thumbBox(el.scrollTop, el.scrollHeight, el.clientHeight);
    const h = thumbBox(el.scrollLeft, el.scrollWidth, el.clientWidth);
    if (v && el !== root && !/auto|scroll/.test(win.getComputedStyle(el).overflowY)) s.noV = true;
    if (v && !s.noV) { s.v ||= thumb(el, 'v'); Object.assign(s.v.style, { top: `${r.top + v.offset}px`, left: `${r.left + r.width - 8}px`, height: `${v.length}px` }); s.v.classList.add('is-on'); }
    if (h && (el === root || /auto|scroll/.test(win.getComputedStyle(el).overflowX))) { s.h ||= thumb(el, 'h'); Object.assign(s.h.style, { left: `${r.left + h.offset}px`, top: `${r.top + r.height - 8}px`, width: `${h.length}px` }); s.h.classList.add('is-on'); }
  };
  const show = (el) => {
    const s = shown.get(el) || {}; shown.set(el, s);
    place(el, s);
    clear(s.timer);
    s.timer = wait(function hide() {
      if (dragging?.el === el || s.v?.matches?.(':hover') || s.h?.matches?.(':hover')) { s.timer = wait(hide, SCROLL_SHOW_MS); return; }
      s.v?.classList.remove('is-on'); s.h?.classList.remove('is-on');
      wait(() => { if (s.v?.classList.contains('is-on') || s.h?.classList.contains('is-on')) return; s.v?.remove(); s.h?.remove(); shown.delete(el); }, 200);
    }, SCROLL_SHOW_MS);
  };
  doc.addEventListener('scroll', (e) => { const el = e.target === doc ? root : e.target; if (el?.matches && scrolls(el)) show(el); }, { capture: true, passive: true });
  doc.addEventListener('mousemove', (e) => {
    if (e.target?.classList?.contains('rail-thumb')) return;
    for (let el = e.target; el?.matches; el = el.parentElement) if (scrolls(el)) show(el);
  }, { passive: true });
}
