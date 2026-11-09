// ClickGuard (docs/rail/components.md › comp.click-guard): a double click on a button that swaps or moves must not fire what
// lands under the pointer. A page draws its buttons as it always did; one watcher guards them all.
const CONTROL = 'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"]';
export const CLICK_GUARD_MS = 400;
const NEAR = 6;
const seen = new WeakSet();

/**
 * Whether a click is the second of a double click landing on something else.
 * @param {{t:number, x:number, y:number, el:object, sign:string}|null} first  the last control clicked
 * @param {{t:number, x:number, y:number, el:object|null, sign:string}} now    this click
 */
export function secondClickIgnored(first, now) {
  if (!first || now.t - first.t >= CLICK_GUARD_MS) return false;
  if (Math.abs(now.x - first.x) > NEAR || Math.abs(now.y - first.y) > NEAR) return false;
  return now.el !== first.el && now.sign !== first.sign;   // the same button, even redrawn, may be pressed twice
}

// a control's identity across a redraw: its own attributes and its words
const signOf = (el) => (el ? `${el.cloneNode(false).outerHTML}${el.textContent.trim()}` : '');

/** Guards every click in a document; a keyboard's click (no pointer, so nothing moved under it) passes. */
export function watchClickGuard(doc) {
  if (seen.has(doc)) return;
  seen.add(doc);
  let first = null;
  doc.defaultView.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    const el = e.target.closest?.(CONTROL) || null, now = { t: e.timeStamp, x: e.clientX, y: e.clientY, el, sign: signOf(el) };
    if (secondClickIgnored(first, now)) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    first = el ? now : null;
  }, true);
}
