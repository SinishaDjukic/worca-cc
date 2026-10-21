// ui/public/input-mode.mjs — which input the person used last, as html[data-input] (docs/design-system.md › Focus).
// style.css hides the ring on script-focused controls while it reads `pointer`. Only a key that moves or acts on focus
// means keyboard use: typing a message (Enter included), a modifier alone or a shortcut leaves it as it is.
const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Enter', ' ', 'Escape', 'F6']);
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** 'keyboard' for a keydown that is keyboard navigation; null for one that leaves the mode unchanged. */
export function keyInputMode(e) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey || !NAV_KEYS.has(e.key)) return null;
  const t = e.target;
  const inField = !!(t && typeof t.closest === 'function' && t.closest(FIELD));
  // In a field Enter sends, Space types and the arrows move the caret: still typing. Tab and Escape leave the field.
  if (inField && e.key !== 'Tab' && e.key !== 'Escape') return null;
  return 'keyboard';
}

export function installInputMode(doc) {
  const root = doc.documentElement;
  root.dataset.input = 'pointer';
  doc.addEventListener('keydown', (e) => { const m = keyInputMode(e); if (m) root.dataset.input = m; }, true);
  doc.addEventListener('pointerdown', () => { root.dataset.input = 'pointer'; }, true);
}
