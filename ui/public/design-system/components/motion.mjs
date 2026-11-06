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

