// ui/public/chat/home-flip.mjs — the composer's glide between the Chat home's hero slot and the thread dock (worca
// Chat P6, mockup "Hero→dock FLIP"). P1 only re-parents the composer when chat-page[data-view] flips; this module
// records the composer box's rect BEFORE the switch — arm(): the home calls it from the intent add-on's transformSend
// (every send), and a capture-phase click on New chat arms the way back — then, when the view flips, plays a 460 ms
// spring from the old rect to the new one (translate + width/height), fades the thread in (hero → dock) or rises the
// hero parts in, staggered (dock → hero). prefers-reduced-motion: nothing is armed, nothing moves.
export const FLIP_MS = 460;
export const FLIP_EASE = 'cubic-bezier(.22,1,.36,1)';
/** An arm older than this belongs to a send that never switched the view (refused, failed, or the chat already had
 *  messages); a later, unrelated change must not use it. P1 flips the view only once the message POST answered (after
 *  it created the chat): a slower send (a big attachment) skips the glide — never a wrong one. Any other click in the
 *  page drops an arm sooner (onClick below). */
export const ARM_TTL_MS = 2000;
/** The hero parts' rise-in delays on the way back (title, quick actions, tabs, promos). */
export const PART_DELAYS = Object.freeze([30, 150, 210, 260]);

export function prefersReducedMotion(win) {
  try {
    return !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return false; }
}

/**
 * @param {{ doc: Document, win?: Window, page: HTMLElement|null, parts?: () => HTMLElement[], now?: () => number }} o
 * @returns {{ arm(): boolean, disarm(): void, armed(): object|null, destroy(): void }}
 */
export function createHeroFlip({ doc, win = doc.defaultView || globalThis, page, parts = () => [], now = () => Date.now() }) {
  let armed = null;
  let last = page ? (page.dataset.view || '') : '';
  let dead = false;
  const box = () => (page ? (page.querySelector('.ask-composer-box') || page.querySelector('.ask-composer')) : null);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

  function arm() {
    // Ask worca beside the page: the side column docks the composer for good; there is no hero to glide from or to.
    if (dead || !page || page.dataset.host === 'dock' || prefersReducedMotion(win)) { armed = null; return false; }
    const el = box();
    if (!el) return false;
    armed = { from: page.dataset.view || '', rect: rectOf(el), at: now() };
    return true;
  }

  function play(from, to) {
    const el = box();
    if (!el || typeof el.animate !== 'function') return;
    const r = rectOf(el);
    if (!(r.width > 0) || !(from.width > 0)) return;
    el.animate([
      { transform: `translate(${Math.round(from.left - r.left)}px, ${Math.round(from.top - r.top)}px)`, width: `${from.width}px`, height: `${from.height}px` },
      { transform: 'translate(0px, 0px)', width: `${r.width}px`, height: `${r.height}px` },
    ], { duration: FLIP_MS, easing: FLIP_EASE });
    if (to === 'thread') {
      const tr = page.querySelector('.ask-transcript');
      if (tr && typeof tr.animate === 'function') tr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 90, easing: 'ease-out', fill: 'backwards' });
      return;
    }
    const list = [...(parts() || [])].filter(Boolean);
    list.forEach((p, i) => {
      if (typeof p.animate !== 'function') return;
      p.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0px)' }],
        { duration: 320, delay: PART_DELAYS[Math.min(i, PART_DELAYS.length - 1)], easing: FLIP_EASE, fill: 'backwards' });
    });
  }

  // Capture phase: runs before P1's own New chat handler swaps the view and re-parents the composer. Any OTHER click in
  // the page drops a waiting arm: a send that never switched the view (refused, failed) must not glide what the user
  // opens next (a Recent chat, a History row). A retry's Send click re-arms afterwards, through transformSend.
  const onClick = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('[data-ask-new-btn]') && page.dataset.view === 'thread') { arm(); return; }
    armed = null;
  };
  if (page) page.addEventListener('click', onClick, true);
  const mo = page && typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => {
    const view = page.dataset.view || '';
    if (view === last) return;
    const prev = last;
    last = view;
    const a = armed;
    armed = null;
    if (dead || !a || a.from !== prev || now() - a.at > ARM_TTL_MS || prefersReducedMotion(win)) return;
    play(a.rect, view);
  }) : null;
  if (mo) mo.observe(page, { attributes: true, attributeFilter: ['data-view'] });

  return {
    arm,
    /** Drop a recorded arm (a send that did not go out). */
    disarm() { armed = null; },
    armed: () => armed,
    destroy() {
      dead = true;
      armed = null;
      if (mo) mo.disconnect();
      if (page) page.removeEventListener('click', onClick, true);
    },
  };
}
