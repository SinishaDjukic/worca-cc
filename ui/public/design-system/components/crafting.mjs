// Crafting (docs/rail/motion.md › motion.crafting): what Worca shows in place of a thing it is making (a workflow, an
// image, a document) until the thing is ready. A small sketch of that kind of thing draws itself, line by line, and
// starts again; one line says what is being made. The same for every kind; only the sketch differs. With reduced motion
// the sketch stands still, drawn.
import { esc } from './html.mjs';

// each kind's sketch: lines that draw in order (pathLength 1, so the CSS draws any line the same way)
const SKETCH = {
  workflow: ['M6 30h22v14H6z', 'M28 37h14', 'M42 30h22v14H42z', 'M64 37h14', 'M78 18h22v14H78z', 'M78 44h22v14H78z', 'M64 37c6 0 8-12 14-12', 'M64 37c6 0 8 14 14 14'],
  image: ['M8 10h104v56H8z', 'M8 54l26-24 22 18 16-12 40 26', 'M88 26a7 7 0 1 0 0.1 0'],
  document: ['M14 14h70', 'M14 26h92', 'M14 38h84', 'M14 50h92', 'M14 62h52'],
};

/**
 * @param {object} o
 * @param {'workflow'|'image'|'document'} [o.kind]  what is being made: its sketch
 * @param {string} o.label     what is being made, in a few words: "Making the workflow"
 * @param {string} [o.detail]  one quiet line after it: "from what you said in this chat"
 */
export function crafting({ kind = 'document', label, detail = '' }) {
  const lines = (SKETCH[kind] || SKETCH.document).map((d, i) => `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join('');
  return `<div class="craft" role="status" aria-live="polite"><svg class="craft-art" viewBox="0 0 120 72" aria-hidden="true">${lines}</svg><p class="craft-t"><b>${esc(label)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</p></div>`;
}
