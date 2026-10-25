// ui/public/keys-sheet.mjs — the one Keyboard shortcuts sheet (issue #948, mock 10): ? on a list page, or View ›
// Keyboard shortcuts. One sheet for every list page; this slice lists the Runs list's keys (the Chats keys join it in
// slice 2). Built on the shared dialog anatomy (dialog-layout.mjs), in folder-changes.mjs's openApplyDialog pattern.
import { layoutDialog } from './dialog-layout.mjs';
import { isMac, keyGlyph } from './list-keys.mjs';

/** Browser-owned combos (Chrome, Firefox, Safari): no shortcut here may use one. 'mod' is ⌘ on a Mac, Ctrl elsewhere. */
export const RESERVED = Object.freeze(['mod+t', 'mod+w', 'mod+n', 'mod+shift+n', 'mod+shift+t', 'mod+l', 'mod+shift+o',
  'mod+d', 'mod+shift+b', 'mod+h', 'mod+q', 'mod+r', 'mod+p', 'mod+s', 'mod+f']);

/** [{ title, col, rows: [{ label, keys: [[token…], …] }] }]: each inner list is one chord, alternatives read "or". */
export function sheetSections({ advanced = true } = {}) {
  const adv = (row) => (advanced ? [row] : []);
  return [
    { title: 'Anywhere', col: 1, rows: [
      { label: 'Search or ask', keys: [['mod', 'K']] },
      { label: 'This sheet', keys: [['?']] },
    ] },
    { title: 'Runs list', col: 2, rows: [
      { label: 'Move', keys: [['ArrowUp', 'ArrowDown'], ['J', 'K']] },
      { label: 'Open', keys: [['Enter']] },
      { label: 'Unfold / fold a group', keys: [['ArrowRight', 'ArrowLeft']] },
      { label: 'Row menu', keys: [['.']] },
      { label: 'Stop a run', keys: [['S']] },
      { label: 'Archive / restore', keys: [['E']] },
      ...adv({ label: 'Add to group…', keys: [['G']] }),
      ...adv({ label: 'Remove from group', keys: [['shift', 'G']] }),
      ...adv({ label: 'Delete', keys: [['Backspace']] }),
    ] },
    { title: 'Selection', col: 2, rows: [
      { label: 'Select or unselect the row', keys: [['Space']] },
      { label: 'Extend the selection', keys: [['shift', 'ArrowUp'], ['shift', 'ArrowDown']] },
      { label: 'Select all', keys: [['mod', 'A']] },
      { label: 'Stop the selected runs', keys: [['S']] },
      { label: 'Archive the selected runs', keys: [['E']] },
      { label: 'Clear the selection', keys: [['Escape']] },
    ] },
  ];
}

const el = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Open the sheet (one at a time). Esc, Close or a backdrop click close it; the focus goes back to `opener`, or to
 *  `fallback()` when a repaint replaced the opener while the sheet was open. */
export function openKeysSheet({ doc, opener = null, fallback = null, advanced = true }) {
  const open = doc.querySelector('.keys-modal');
  if (open) return open;
  const win = doc.defaultView;
  const mac = isMac(win);
  const modal = el(doc, 'div', 'viewer-modal keys-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'keys-sheet-title');
  const card = el(doc, 'div', 'card keys-dlg');
  const title = el(doc, 'h2', 'keys-title', 'Keyboard shortcuts');
  title.id = 'keys-sheet-title';
  const cols = el(doc, 'div', 'keys-cols');
  const secs = sheetSections({ advanced });
  for (const c of [1, 2]) {
    const col = el(doc, 'div', 'keys-col');
    for (const s of secs.filter((x) => x.col === c)) {
      const sec = el(doc, 'section', 'keys-sec');
      sec.append(el(doc, 'h3', 'keys-h', s.title));
      for (const r of s.rows) {
        const row = el(doc, 'div', 'keys-row');
        const combo = el(doc, 'span', 'keys-combo');
        r.keys.forEach((chord, i) => {
          if (i) combo.append(el(doc, 'span', 'keys-or', 'or'));
          for (const t of chord) combo.append(el(doc, 'kbd', 'kbd', keyGlyph(t, mac)));
        });
        row.append(el(doc, 'span', 'keys-label', r.label), combo);
        sec.append(row);
      }
      col.append(sec);
    }
    cols.append(col);
  }
  const note = el(doc, 'p', 'keys-note', `Letter keys act on the focused row or the selection, never while you type.${mac ? ' On Windows and Linux, ⌘ is Ctrl and ⌥ is Alt.' : ''}`);
  const foot = el(doc, 'div', 'keys-foot');
  const close = el(doc, 'button', 'btn keys-close', 'Close');
  close.type = 'button';
  foot.append(close);
  card.append(title, cols, note, foot);
  layoutDialog(card, { head: [title], foot: [note, foot] });
  modal.append(card);
  doc.body.append(modal);

  const done = () => {
    win.removeEventListener('keydown', onKey, true);
    modal.remove();
    const back = opener && opener.isConnected ? opener : (typeof fallback === 'function' ? fallback() : null);
    if (back && typeof back.focus === 'function') back.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(); return; }
    if (e.key === 'Tab') { e.preventDefault(); close.focus(); }   // one control: the focus stays on Close
  };
  win.addEventListener('keydown', onKey, true);
  modal.addEventListener('click', (e) => { if (e.target === modal) done(); });
  close.addEventListener('click', done);
  close.focus();
  return modal;
}
