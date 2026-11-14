// Motion (docs/rail/motion.md): a page that draws itself again after every change updates the
// DOM in place with morph(), so what stays is the same element and what changed can ease in. A component says how it
// moves with data-motion; a page never animates by hand.
//   data-motion="in"      fades in over --motion-quick when it appears (a menu, a popover, a dialog)
//   data-motion="open"    fades in and its space opens over --motion-quick; what is below moves with it (ConfirmStrip, a row's detail)
//   data-motion="change"  when what it shows changes, the new fades in over --motion-change (the state word, the dot)
//   data-motion="swap"    when its text changes, the new fades in over --motion-quick (Merge → Merging…)
// Closing is at once. Under prefers-reduced-motion nothing moves. A colour that changes on an element that stays eases
// by its CSS transition, which runs because the element stays.

const keyOf = (e) => e.id || e.getAttribute('data-key') || '';
const firstClass = (e) => (e.getAttribute('class') || '').trim().split(/\s+/)[0];

// The same node in the new markup: same tag and key; without a key, the same first class.
function same(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  if (a.tagName !== b.tagName || keyOf(a) !== keyOf(b)) return false;
  return keyOf(a) ? true : firstClass(a) === firstClass(b);
}

function patchAttrs(a, b) {
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
}

function patch(a, b, out) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  const mode = b.getAttribute('data-motion');
  const before = mode === 'change' || mode === 'swap' ? a.innerHTML : null;
  patchAttrs(a, b);
  const text = a.tagName === 'TEXTAREA' ? b.value : null;   // read first: its text node may move across below
  patchChildren(a, b, out);
  // what the user sees, as a fresh innerHTML would set it
  if (a.tagName === 'INPUT') { if (a.value !== b.value) a.value = b.value; if (a.checked !== b.checked) a.checked = b.checked; }
  else if (a.tagName === 'TEXTAREA') { if (a.value !== text) a.value = text; }
  else if (a.tagName === 'SELECT') { if (a.selectedIndex !== b.selectedIndex) a.selectedIndex = b.selectedIndex; }
  if (before !== null && a.innerHTML !== before) out.changed.push(a);
}

function patchChildren(from, to, out) {
  const olds = [...from.childNodes];
  let oi = 0;
  for (const nc of [...to.childNodes]) {
    let j = oi;
    if (nc.nodeType === 1) while (j < olds.length && !same(olds[j], nc)) j++;   // an element may have moved up past what left
    else if (j < olds.length && !same(olds[j], nc)) j = olds.length;
    if (j < olds.length) {
      for (let k = oi; k < j; k++) olds[k].remove();
      patch(olds[j], nc, out); oi = j + 1;
    } else {
      from.insertBefore(nc, olds[oi] || null);
      if (nc.nodeType === 1) out.entered.push(nc);
    }
  }
  for (let k = oi; k < olds.length; k++) olds[k].remove();
}

function ms(css, name, fallback) {
  const v = css.getPropertyValue(name).trim();
  if (!v) return fallback;
  return v.endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : fallback;
}

/**
 * Draws `html` into `target`, keeping every element that is still there.
 * @param {Element} target
 * @param {string} html
 * @param {object} [o]
 * @param {boolean} [o.motion]  false for a jump (another page, another run): everything is drawn at once
 * @returns {{entered: Element[], changed: Element[]}}
 */
export function morph(target, html, { motion = true } = {}) {
  const doc = target.ownerDocument;
  const tpl = doc.createElement('template'); tpl.innerHTML = html;
  const out = { entered: [], changed: [] };
  if (!motion || !target.firstChild) { target.replaceChildren(tpl.content); return out; }
  patchChildren(target, tpl.content, out);
  const view = doc.defaultView;
  if (view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return out;
  const css = view?.getComputedStyle ? view.getComputedStyle(target) : { getPropertyValue: () => '' };
  const quick = ms(css, '--motion-quick', 150), change = ms(css, '--motion-change', 200);
  const easing = css.getPropertyValue('--ease').trim() || 'cubic-bezier(.2, 0, 0, 1)';
  const fade = (el, duration) => el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration, easing });
  for (const root of out.entered) {
    for (const el of [root, ...root.querySelectorAll('[data-motion]')]) {
      const m = el.getAttribute('data-motion');
      if (m === 'in') fade(el, quick);
      else if (m === 'open' && el.animate) {
        const s = view.getComputedStyle(el);
        el.animate([
          { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0, overflow: 'hidden' },
          { height: el.offsetHeight + 'px', paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginTop: s.marginTop, marginBottom: s.marginBottom, opacity: 1, overflow: 'hidden' },
        ], { duration: quick, easing });
      }
    }
  }
  for (const el of out.changed) fade(el, el.getAttribute('data-motion') === 'swap' ? quick : change);
  return out;
}

/**
 * The stage line's advance (motion.stage-advance): when a keyed StageBar reaches a later stage, the last notch fills, the
 * notches pulse once, the line travels, the next knot pops once. Once per change, whichever way the page redraws; first
 * sight never plays; nothing under reduced motion.
 * @param {Document} doc
 * @returns {MutationObserver|null}
 */
export function watchStageAdvance(doc) {
  const view = doc.defaultView; if (!view?.MutationObserver) return null;
  const seen = new Map(), ease = 'cubic-bezier(.2, 0, 0, 1)';
  const play = (el, from, notches) => {
    const sl = el.querySelector('.sl'), to = +el.dataset.stage, n = el.querySelectorAll('.sl-knot').length; if (!sl || !sl.animate || !n) return;
    const ghosts = notches.map((html, i) => { const t = doc.createElement('template'); t.innerHTML = html; const g = t.content.firstChild; g.classList.remove('is-now'); g.classList.add('is-done', 'sl-ghost'); sl.appendChild(g);
      if (i === notches.length - 1) g.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: ease });
      g.animate([{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 1, transform: 'scaleY(1.8)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 250, delay: 200, easing: ease });
      return g; });
    const line = sl.querySelector('.sl-done');
    line?.animate([{ width: `${(from / n) * 100}%` }, { width: line.style.width }], { duration: 350, delay: 450, easing: ease, fill: 'backwards' });
    const end = ghosts.length ? ghosts[0].animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, delay: 650, fill: 'forwards' }) : null;
    ghosts.slice(1).forEach((g) => g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, delay: 650, fill: 'forwards' }));
    if (end) end.onfinish = () => ghosts.forEach((g) => g.remove());
    sl.querySelectorAll('.sl-knot')[Math.min(to, n - 1)]?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 1000, delay: 750, easing: ease });
  };
  const scan = () => {
    for (const el of doc.querySelectorAll('.stage-bar[data-advance]')) {
      const key = el.dataset.advance, stage = +el.dataset.stage, was = seen.get(key);
      const notches = [...el.querySelectorAll('.sl-step:not(.sl-ghost)')].map((x) => x.outerHTML);
      seen.set(key, { stage, notches });
      if (was && stage > was.stage && !view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play(el, was.stage, was.notches);
    }
  };
  const mo = new view.MutationObserver(scan);
  mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-stage'] });
  scan();
  return mo;
}

/**
 * Lands on a thing a link or a search pointed at: it comes into view and lights once over --motion-flash (Motion:
 * "A link lands on a fact's home"); under reduced motion it is outlined instead, and the page jumps.
 * @param {Element} el
 */
export function land(el) {
  if (!el) return;
  const view = el.ownerDocument.defaultView;
  const reduced = !!view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.setAttribute('data-landed', '');
  el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  if (!el.hasAttribute('tabindex') && !el.matches?.('a[href],button,input,select,textarea')) el.setAttribute('tabindex', '-1');
  el.focus?.({ preventScroll: true });   // the scroll above is the only movement
  const css = view?.getComputedStyle ? view.getComputedStyle(el) : { getPropertyValue: () => '' };
  view?.setTimeout?.(() => el.removeAttribute('data-landed'), ms(css, '--motion-flash', 1200) + 100);
}


// Folds (motion.fold): every toggle that opens something in place moves the same way, whether its page morphs or draws
// itself whole. Opening, the new part fades in as its space opens; closing, a copy of what was there fades as its space
// closes; the chevron turns. Pages do nothing: a toggle is a button with aria-expanded, and what it opens is the part its
// kind of row holds (or what its data-folds selector names).
const FOLD_PARTS = [['.cmd-row', '.cmd-detail'], ['.cmd-group', '.cmd-rows'], ['.list-row', '.lr-after'], ['.stage-line', '.td-body'], ['.turn-row', '.tr-body'], ['.task-card', '.tc-stream']];
const FOLD_TOGGLE = '[aria-expanded]:not([aria-haspopup]):not([data-menu]):not([data-fold-section])';

/** What finds a toggle again after its page has drawn itself: its data attributes. */
export function foldKey(toggle) {
  const data = [...toggle.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}="${a.value.replace(/["\\]/g, '\\$&')}"]`).join('');
  return `${data}[aria-expanded]`;
}
function foldPart(root, toggle) {
  if (toggle.dataset.folds) return { part: root.querySelector(toggle.dataset.folds), named: true };
  for (const [scope, part] of FOLD_PARTS) { const s = toggle.closest(scope); if (s) return { scope: s, part: s.querySelector(part) }; }
  return {};
}

/** Watches root for toggles and moves what they open and close (motion.fold). */
export function watchFolds(root, { win = globalThis } = {}) {
  let was = null;
  const timing = () => ({ duration: 200, easing: 'cubic-bezier(.2,0,0,1)' });
  const still = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const move = (el, h, open, done) => {
    const prior = el.style.overflow; el.style.overflow = 'hidden';
    const a = el.animate([{ height: `${open ? 0 : h}px`, opacity: open ? 0 : 1 }, { height: `${open ? h : 0}px`, opacity: open ? 1 : 0 }], timing());
    a.onfinish = () => { el.style.overflow = prior; done?.(); };
  };
  root.addEventListener('click', (e) => {
    was = null;
    const t = e.target.closest?.(FOLD_TOGGLE); if (!t || t.disabled || still()) return;
    const sel = foldKey(t); if (sel === '[aria-expanded]') return;
    const { part } = foldPart(root, t);
    was = { sel, at: [...root.querySelectorAll(sel)].indexOf(t), open: t.getAttribute('aria-expanded') === 'true', part, h: part ? part.getBoundingClientRect().height : 0, copy: part ? part.cloneNode(true) : null };
  }, true);
  root.addEventListener('click', () => {   // after the page's own handlers have drawn it
    const w = was; was = null; if (!w) return;
    const t = root.querySelectorAll(w.sel)[w.at]; if (!t) return;
    const open = t.getAttribute('aria-expanded') === 'true'; if (open === w.open) return;
    const { scope, part, named } = foldPart(root, t);
    if (open && part && part !== w.part && part.animate && !part.hasAttribute('data-motion')) move(part, part.getBoundingClientRect().height, true);
    if (!open && w.copy && !part && w.h && w.copy.animate) {
      const g = w.copy; g.setAttribute('aria-hidden', 'true'); g.setAttribute('inert', ''); g.style.pointerEvents = 'none';
      if (named) t.parentElement.before(g); else scope?.append(g);
      if (g.isConnected) move(g, w.h, false, () => g.remove());
    }
    const icon = t.matches('.lr-mark-fold, .stage-part-b') ? null : t.querySelector('svg');
    icon?.animate?.([{ transform: `rotate(${open ? -90 : 90}deg)` }, { transform: 'none' }], timing());
  });
}
