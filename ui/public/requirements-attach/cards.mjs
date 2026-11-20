// Attached-feature cards under the composer. Pure DOM: one .ask-chip per feature, replaced on every call.
import { icon } from '../icons.mjs';

const UNAVAILABLE = 'Requirements unavailable';
const REMOVE_SUFFIX = ' — remove to send/run';
const STATUS_LINES = Object.freeze({
  archived: `Archived${REMOVE_SUFFIX}`,
  missing: `Deleted${REMOVE_SUFFIX}`,
  wrong_scope: `Not in this project${REMOVE_SUFFIX}`,
  not_ready: 'Not Ready yet',
});

/** The composer button label: the call to action, or how many features are attached. */
export const pullLabel = (n) => (n === 0 ? 'Pull from Requirements' : `${n} feature${n === 1 ? '' : 's'}`);

const statusLine = (item, flagOn) => (flagOn() ? STATUS_LINES[item.status] ?? '' : UNAVAILABLE);

function make(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildCard(doc, item, { onRemove, flagOn }) {
  const id = item.id ?? `FEAT-${item.seq}`;
  const chip = make(doc, 'span', 'ask-chip ask-chip-feature');
  chip.dataset.seq = String(item.seq);
  chip.append(make(doc, 'span', 'ask-chip-name', item.title ?? id), make(doc, 'span', 'ask-chip-id', id));
  if (Number.isInteger(item.criteriaCount)) {
    const n = item.criteriaCount;
    chip.append(make(doc, 'span', 'ask-chip-count', `${n} ${n === 1 ? 'criterion' : 'criteria'}`));
  }
  const line = statusLine(item, flagOn);
  if (line) chip.append(make(doc, 'span', 'ask-chip-status', line));
  const x = make(doc, 'button', 'ask-chip-x');
  x.type = 'button';
  x.setAttribute('aria-label', `Remove ${id}`);
  x.append(icon(doc, 'x', 12));
  x.addEventListener('click', () => onRemove(item.seq));
  chip.append(x);
  return chip;
}

/** Render `items` into `container`, replacing its children. `items` is never mutated. */
export function renderAttachedCards(container, items, { onRemove, flagOn }) {
  const doc = container.ownerDocument;
  container.replaceChildren(...(items ?? []).map((it) => buildCard(doc, it, { onRemove, flagOn })));
}
