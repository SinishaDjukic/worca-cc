// ui/public/shape/note-body.mjs — an agent's note inside a card: paragraphs, inline code and divided list rows, built
// from text nodes only, folded after about six lines and opened in place. The fold only toggles parts that are already
// drawn (it follows fold()'s aria contract), and the note stays open across the card's repaints.
import { noteBlocks, foldNote } from '../../../src/shared/shape/outline-note.mjs';

const TAIL = 16;                 // the end of a lone name that always shows
const openKeys = new Set();      // the notes a person opened, by the caller's key
let drawn = 0;                   // one id per drawn note: the same note can be on two surfaces

/** Test only: the open notes' keys. */
export function noteOpenKeys() { return openKeys; }

/** `div.note-body` for `text` and its toggle (null when the note fits); null when there is nothing to draw. */
export function buildNoteBody(doc, text, { key, dropTitle = false } = {}) {
  const blocks = noteBlocks(text, { dropTitle });
  if (!blocks.length) return null;
  const { shown, cut } = foldNote(blocks);
  const h = (tag, cls, value) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (value != null) n.textContent = value;
    return n;
  };
  const addParts = (node, parts) => {
    for (const p of parts) node.appendChild(p.code ? h('code', null, p.text) : doc.createTextNode(p.text));
    return node;
  };
  // One line that loses its middle only when the row is too narrow: the head ellipsizes, the tail stays whole.
  const middleCut = (value) => {
    const at = value.length - Math.min(TAIL, Math.floor(value.length / 2));
    const mid = h('span', 'note-mid');
    mid.title = value;
    mid.append(h('span', 'note-mid-head', value.slice(0, at)), h('span', 'note-mid-tail', value.slice(at)));
    return mid;
  };

  const el = h('div', 'note-body');
  el.id = `note-body-${++drawn}`;
  const past = [];      // hidden while folded
  const clamps = [];    // [paragraph, lines] clamped while folded
  let more = null;      // the "+N more" row, shown only while folded
  blocks.forEach((block, index) => {
    const fold = shown.find((s) => s.index === index);
    if (block.kind === 'p') {
      const p = el.appendChild(addParts(h('p', 'note-p'), block.parts));
      if (!fold) past.push(p);
      else if (fold.clamp) clamps.push([p, fold.clamp]);
      return;
    }
    const list = el.appendChild(h(block.ordered ? 'ol' : 'ul', 'note-rows'));
    if (!fold) past.push(list);
    block.items.forEach((item, i) => {
      const row = list.appendChild(h('li', 'note-row'));
      if (item.n) row.appendChild(h('span', 'note-n', item.n));
      row.appendChild(item.lone ? middleCut(item.lone) : addParts(h('span', 'note-text'), item.parts));
      if (fold && i >= fold.rows) past.push(row);
    });
    if (fold && fold.more) more = list.appendChild(h('li', 'note-row note-more', `+${fold.more} more`));
  });

  let toggle = null;
  if (cut) {
    toggle = el.appendChild(h('button', 'btn btn-sm btn-quiet note-toggle'));
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', el.id);
  }
  const paint = (open) => {
    for (const n of past) n.hidden = !open;
    if (more) more.hidden = open;
    for (const [p, lines] of clamps) {
      p.classList.toggle('is-clamped', !open);
      if (open) p.style.removeProperty('--note-clamp');
      else p.style.setProperty('--note-clamp', String(lines));
    }
    if (!toggle) return;
    toggle.textContent = open ? 'Show less' : 'Show the full note';
    toggle.setAttribute('aria-expanded', String(open));
  };
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      if (key) openKeys[open ? 'add' : 'delete'](key);
      paint(open);
    });
  }
  paint(!cut || (!!key && openKeys.has(key)));
  return { el, toggle };
}
