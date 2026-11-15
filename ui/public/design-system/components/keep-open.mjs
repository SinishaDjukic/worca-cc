// An open control across a redraw (docs/rail/components.md `comp.keep-open`): a menu, inline field or dialog whose control
// is marked data-keep="KEY" keeps its value, caret, selection and focus when a draw rewrites its markup. Once per
// document: it remembers each marked control the user focused or typed into, and when a draw removes that element it moves
// what the user had onto the new element with the same key, in the observer's microtask, before the browser paints.
// A route change carries nothing; a key that no longer exists after a draw is forgotten, so a reopen starts empty.
const watched = new WeakSet();

export function watchKeepOpen(doc) {
  if (!doc || watched.has(doc)) return;
  watched.add(doc);
  const win = doc.defaultView;
  const kept = new Map();   // KEY -> { el, hash }
  let focused = null;       // the KEY that held the focus last, until a control without one takes it
  const hash = () => win.location.hash;
  const remember = (e) => {
    const el = e.target?.closest?.('[data-keep]');
    if (!el) { if (e.type === 'focusin') focused = null; return; }
    const key = el.getAttribute('data-keep'), was = kept.get(key);
    if (was && was.el !== el && !was.el.isConnected) carryOne(key, was);   // the page refocused the new one first: carry before re-pointing
    kept.set(key, { el, hash: hash() });
    if (e.type === 'focusin') focused = key;
  };
  doc.addEventListener('focusin', remember, true);
  doc.addEventListener('input', remember, true);
  doc.addEventListener('focusout', (e) => {   // a real blur, not a removal: some browsers blur a removed node, some do not
    const el = e.target?.closest?.('[data-keep]');
    if (el?.isConnected && focused === el.getAttribute('data-keep')) focused = null;
  }, true);
  const find = (key) => {
    const q = win.CSS?.escape ? win.CSS.escape(key) : key.replace(/["\\]/g, '\\$&');
    return doc.querySelector(`[data-keep="${q}"]`);
  };
  // moves what the user had in the removed control onto the one drawn in its place, or forgets the key
  function carryOne(key, k) {
    const next = find(key);
    if (!next || hash() !== k.hash) { kept.delete(key); if (focused === key) focused = null; return; }
    const old = k.el; k.el = next;
    if ('value' in next && 'value' in old) {
      next.value = old.value;
      try {
        const end = next.value.length, at = (n) => Math.min(n ?? end, end);
        next.setSelectionRange(at(old.selectionStart), at(old.selectionEnd), old.selectionDirection || 'none');
      } catch { /* a control without a text selection */ }
    }
    if (focused === key && doc.activeElement !== next) next.focus({ preventScroll: true });
  }
  const carry = () => { for (const [key, k] of kept) if (!k.el.isConnected) carryOne(key, k); };
  new win.MutationObserver(() => { if (kept.size) carry(); }).observe(doc.documentElement, { childList: true, subtree: true });
}
