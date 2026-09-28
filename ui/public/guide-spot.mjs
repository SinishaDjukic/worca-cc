// ui/public/guide-spot.mjs
// The guided click (docs/getting-started.md): scrim-dim the page, keep ONE real
// control lit and interactive above it, ring it, say why in one balloon.
// Action-driven, never narrated — the target's real click is what advances or
// ends a guide (the caller's onTargetClick); Esc and Skip dismiss (onDismiss); a
// click on the scrim only nudges (one pulse of ring + balloon), so a stray click
// never ends a guide. A hop that only explains (the canvas, a panel) or whose state is
// already there gets a Next button (onNext) so the user can move on without
// touching anything. Soft-block: nothing here can trap the user.
//
// Layering (style.css .guide-*): `spotlight` sits above the Ask dock (40) and
// below every .viewer-modal (50) — a dialog that opens on the target's click
// naturally covers it. `pointer` drops the scrim + elevation for a target inside
// an open dialog (a modal is its own stacking context, so elevation can't cross
// it, and its backdrop already dims) and rides above the modal layer instead.
//
// Pure DOM: `doc` / `win` are injectable so test/ui-guide-spot.test.mjs runs it
// in jsdom. No app state, no fetch.

const ATTACH_TRIES = 120;   // ~2 s at 60 fps: a view's list may still be fetching
const REACQUIRE_FRAMES = 60; // ~1 s: how long a vanished control may take to be repainted
const GLIDE_MS = 2500;       // how long the guide's own smooth scroll may still be emitting scroll events
const BRING_EVERY = 1200;    // ms between two re-scrolls of a control the page carried out of view

const frame = (win) => (typeof win.requestAnimationFrame === 'function'
  ? (fn) => win.requestAnimationFrame(fn)
  : (fn) => win.setTimeout(fn, 16));
const cancel = (win) => (typeof win.cancelAnimationFrame === 'function'
  ? (h) => win.cancelAnimationFrame(h)
  : (h) => win.clearTimeout(h));

/** A target that exists but is not showing (hidden attr, display:none, zero box)
 *  is treated as absent: the attach loop keeps waiting for it. */
function visible(el) {
  if (!el || el.hidden) return false;
  const b = el.getBoundingClientRect();
  return b.width > 0 || b.height > 0;
}

/**
 * @param {object} o
 * @param {string|string[]} o.target  selector of the ONE control to light up — or
 *                                 fallbacks in preference order, the first one
 *                                 showing wins (a control that only exists in
 *                                 some states, then the cell it would live in)
 * @param {string|string[]} o.text one line of why (no markup); an array pairs
 *                                 with the target array by index
 * @param {'spotlight'|'pointer'} [o.mode]
 * @param {string[]} [o.lift]      ancestors that own a stacking context the target
 *                                 cannot escape (e.g. `.ask-dock`): they are lifted
 *                                 above the scrim with it
 * @param {number} [o.tries]       attach retries before giving up (→ onDismiss)
 * @param {() => void} o.onDismiss
 * @param {() => void} o.onTargetClick
 * @param {() => void} [o.onNext]   when given, a Next button sits beside Skip and calls it
 * @param {string} [o.nextLabel]    its label (default "Next")
 * @param {Document} [o.doc]
 * @param {Window} [o.win]
 * @returns {{destroy:() => void, layer:Element}}
 */
export function createGuideSpot({
  target, text, mode = 'spotlight', lift = [], tries = ATTACH_TRIES,
  onDismiss, onTargetClick, onNext = null, nextLabel = 'Next', doc = globalThis.document, win = globalThis.window,
}) {
  const targets = Array.isArray(target) ? target : [target];
  const texts = Array.isArray(text) ? text : [text];
  const raf = frame(win);
  const caf = cancel(win);
  let alive = true;
  let handle = 0;
  let cleanup = () => {};

  const layer = doc.createElement('div');
  layer.className = `guide-layer ${mode}`;
  layer.dataset.target = targets.join(', ');
  let scrim = null;
  if (mode === 'spotlight') {
    scrim = doc.createElement('div');
    scrim.className = 'guide-scrim';
    // A click beside the lit control is swallowed, never an exit: a stray click used to end
    // the guide silently, which reads as a bug. The ring and balloon pulse once to say
    // "here" instead. Skip and Esc remain the exits.
    scrim.addEventListener('click', () => nudge());
    layer.appendChild(scrim);
  }
  const ring = doc.createElement('div');
  ring.className = 'guide-ring';
  ring.hidden = true;
  const balloon = doc.createElement('div');
  balloon.className = 'guide-balloon';
  balloon.setAttribute('role', 'status');
  balloon.hidden = true;
  const line = doc.createElement('span');
  line.className = 'guide-text';
  line.textContent = texts[0] || '';
  const skip = doc.createElement('button');
  skip.type = 'button';
  skip.className = 'guide-skip';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => dismiss());
  const actions = doc.createElement('div');
  actions.className = 'guide-actions';
  if (typeof onNext === 'function') {
    const next = doc.createElement('button');
    next.type = 'button';
    next.className = 'guide-next';
    next.textContent = nextLabel || 'Next';
    // The caller re-derives the hop and replaces this layer; nothing is dismissed here.
    next.addEventListener('click', () => { if (alive) onNext(); });
    actions.appendChild(next);
  }
  actions.appendChild(skip);
  balloon.append(line, actions);
  layer.append(ring, balloon);
  doc.body.appendChild(layer);

  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } };
  doc.addEventListener('keydown', onKey);
  // The user's own scrolling (wheel, touch, paging keys, a scrollbar drag — any scroll that is not
  // the tail of the guide's own glide) — after it, the guide never re-scrolls.
  let userScrolled = false;
  let lastBring = 0;
  const onUserScroll = (e) => {
    if (e.type === 'keydown' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) return;
    if (e.type === 'scroll' && Date.now() - lastBring < GLIDE_MS) return;
    userScrolled = true;
  };
  for (const t of ['wheel', 'touchmove', 'keydown', 'scroll']) doc.addEventListener(t, onUserScroll, { passive: true, capture: true });

  function destroy() {
    if (!alive) return;
    alive = false;
    caf(handle);
    cleanup();
    doc.removeEventListener('keydown', onKey);
    for (const t of ['wheel', 'touchmove', 'keydown', 'scroll']) doc.removeEventListener(t, onUserScroll, { capture: true });
    layer.remove();
  }
  function dismiss() {
    if (!alive) return;
    destroy();
    if (onDismiss) onDismiss();
  }
  /** Draw the eye to the lit control: one pulse of the ring and the balloon (restarted on repeat). */
  function nudge() {
    if (!alive) return;
    for (const el of [ring, balloon]) {
      el.classList.remove('nudge');
      void el.offsetWidth;   // restart the animation when clicked again mid-pulse
      el.classList.add('nudge');
    }
  }
  const onNudgeEnd = (e) => { e.currentTarget.classList.remove('nudge'); };
  ring.addEventListener('animationend', onNudgeEnd);
  balloon.addEventListener('animationend', onNudgeEnd);

  /** Centre the balloon under its target, clamped to the viewport, arrow aimed
   *  at the target's centre WITHIN the balloon; above the target when there is
   *  no room below. Measured after layout: the balloon's width depends on its text. */
  function place(rect) {
    const vw = win.innerWidth || doc.documentElement.clientWidth || 0;
    const vh = win.innerHeight || doc.documentElement.clientHeight || 0;
    const pad = 6;
    ring.style.left = `${rect.left - pad}px`;
    ring.style.top = `${rect.top - pad}px`;
    ring.style.width = `${rect.width + pad * 2}px`;
    ring.style.height = `${rect.height + pad * 2}px`;
    ring.hidden = false;
    balloon.hidden = false;
    const box = balloon.getBoundingClientRect();
    const centre = rect.left + rect.width / 2;
    const left = Math.max(8, Math.min(centre - box.width / 2, Math.max(8, vw - box.width - 8)));
    const gap = 14;
    // "Fits" means inside the viewport, not merely on that side of the control: a control
    // scrolled out of view has no room on either side.
    const fitsBelow = vh > 0 && rect.bottom + gap >= 8 && rect.bottom + gap + box.height <= vh - 8;
    const fitsAbove = rect.top - gap - box.height >= 8 && rect.top - gap <= vh - 8;
    // Neither edge has room (a run card taller than the window): the balloon is PINNED inside
    // the viewport, over the target, arrow off — never parked off-screen where "the guide is
    // stuck" is all the user can see.
    const pinned = vh > 0 && !fitsBelow && !fitsAbove;
    const above = !pinned && !fitsBelow && fitsAbove;
    balloon.classList.toggle('above', above);
    balloon.classList.toggle('pinned', pinned);
    balloon.style.left = `${left}px`;
    if (pinned) {
      const top = Math.max(16, Math.min(rect.top + gap, vh - box.height - 16));
      balloon.style.top = `${top}px`;
    } else {
      balloon.style.top = above ? `${rect.top - box.height - gap}px` : `${rect.bottom + gap}px`;
    }
    balloon.style.setProperty('--arrow-x', `${Math.max(16, Math.min(centre - left, box.width - 16))}px`);
  }

  let attempts = 0;
  function attach() {
    if (!alive) return;
    let el = null; let which = 0;
    for (let i = 0; i < targets.length && !el; i++) {
      const cand = doc.querySelector(targets[i]);
      if (visible(cand)) { el = cand; which = i; }
    }
    if (!el) {
      // The target may mount a tick after us (a list still fetching, a dialog
      // opening) — retry, then give up quietly rather than spotlighting nothing.
      if (++attempts < tries) { handle = raf(attach); return; }
      dismiss();
      return;
    }
    el.classList.add('guide-target');
    // The elevation needs a positioned box. A static control gets position:relative;
    // one that is already positioned (the Composer's floating rail is absolute) keeps
    // its own position — forcing relative would pull it out of place.
    try {
      const pos = win.getComputedStyle(el).position;
      if (!pos || pos === 'static') el.classList.add('guide-target-static');
    } catch { el.classList.add('guide-target-static'); }
    line.textContent = texts[which] ?? texts[0] ?? '';
    layer.dataset.target = targets[which];
    // The ring follows the control's own corner radius (a pill stays a pill).
    try {
      const r = win.getComputedStyle(el).borderTopLeftRadius;
      if (r && r !== '0px') ring.style.borderRadius = `calc(${r} + 6px)`;
    } catch { /* jsdom: keep the stylesheet's radius */ }
    const lifted = [];
    for (const sel of lift) {
      const a = el.closest(sel);
      if (!a) continue;
      a.classList.add('guide-lift');
      // z-index needs a positioned box; a static ancestor gets position:relative
      // (never a fixed/absolute one — that would move it).
      try { if (win.getComputedStyle(a).position === 'static') a.classList.add('guide-lift-static'); } catch { /* jsdom */ }
      lifted.push(a);
    }
    // Glide to the control (the ring follows it per frame, so the eye is led
    // down the page); reduced motion jumps.
    let bring = () => {};
    if (typeof el.scrollIntoView === 'function') {
      let reduced = false;
      try { reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { /* jsdom */ }
      // A control taller than most of the window is brought to its top, not its middle (which
      // would leave its head — and the balloon — above the fold).
      let block = 'center';
      try { const vh = win.innerHeight || 0; if (vh && el.getBoundingClientRect().height > vh * 0.6) block = 'start'; } catch { /* jsdom */ }
      bring = () => { lastBring = Date.now(); try { el.scrollIntoView({ block, inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch { /* jsdom */ } };
      userScrolled = false;
      bring();
    }
    const onClick = () => {
      if (!alive) return;
      // Let the control's own handlers run first (they are registered before
      // ours), then hand over: the caller re-reads real UI state on a tick.
      if (onTargetClick) onTargetClick();
    };
    el.addEventListener('click', onClick);
    // Follow the target every frame rather than on resize/scroll: the main
    // column scrolls, details open, a sheet slides under a transform — none
    // of which fires a resize. One rect read per frame, only while a guide is
    // up, and a re-place only when the geometry actually changed.
    let last = '';
    const track = () => {
      if (!alive) return;
      if (!doc.contains(el) || !visible(el)) {
        // The control went away — usually a list repainting its rows (the same
        // selector matches the replacement a frame later). Detach and re-acquire
        // for a short grace period; only a control that stays gone ends the guide.
        cleanup();
        cleanup = () => {};
        attempts = Math.max(0, tries - REACQUIRE_FRAMES);
        handle = raf(attach);
        return;
      }
      const b = el.getBoundingClientRect();
      // A view that keeps settling (a run list re-sorting its cards, a log growing) can carry
      // the control ENTIRELY out of view after the glide: bring it back — throttled, so a glide
      // in flight is not restarted every frame — but never over the user's own scrolling.
      const vh = win.innerHeight || 0;
      if (!userScrolled && vh && (b.bottom < 0 || b.top > vh) && Date.now() - lastBring > BRING_EVERY) bring();
      const key = `${b.top}|${b.left}|${b.width}|${b.height}`;
      if (key !== last) { last = key; place(b); }
      handle = raf(track);
    };
    cleanup = () => {
      el.classList.remove('guide-target', 'guide-target-static');
      for (const a of lifted) a.classList.remove('guide-lift', 'guide-lift-static');
      el.removeEventListener('click', onClick);
    };
    track();
  }
  attach();

  return { destroy, layer };
}
