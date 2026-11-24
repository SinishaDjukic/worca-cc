// The "How it works" button and its "New" mark: a small .btn with a question icon, the words and
// a trailing hidden "New" dot. The controller (how-it-works.mjs) places it.
// The dot carries no text: a visually hidden "New" inside the button would count as a fourth word of its
// label and as text on the dot's slate. The accessible name says it instead ("How it works, new").

const LABEL = 'How it works';
const TIP = 'How this area works';
const QUESTION_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.8 9a3.2 3.2 0 1 1 5 2.7c-1.2.8-1.8 1.4-1.8 2.8"></path>'
  + '<path d="M12 18.5h.01"></path></svg>';
const MARK = '<span class="howto-new" aria-hidden="true" hidden></span>';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The button's HTML: question icon, the words (none when `icon`) and a trailing hidden "New" mark.
 *  `icon` makes it a quiet icon button, for a bar of icon buttons (the Workflows editor bar). */
export function howtoButtonHtml({ id, cls, icon = false }) {
  const classes = ['btn', icon ? 'btn-quiet btn-icon' : 'btn-sm', cls].filter(Boolean).join(' ');
  const words = icon ? '' : `<span class="howto-label">${LABEL}</span>`;
  return `<button type="button" class="${esc(classes)}" title="${TIP}" id="${esc(id)}" data-min-level="simple" `
    + `data-howto-label="${LABEL}" aria-label="${LABEL}">${QUESTION_ICON}${words}${MARK}</button>`;
}

/** The button as an element, for a page that builds elements. */
export function howtoButtonElement(doc, opts) {
  const t = doc.createElement('template');
  t.innerHTML = howtoButtonHtml(opts);
  return t.content.firstElementChild;
}

/** Show or hide the "New" mark on a button, and say it in the accessible name; a missing button is a no-op. */
export function paintHowtoMark(btn, isNew) {
  if (!btn) return;
  btn.dataset.new = isNew ? 'true' : 'false';
  const mark = btn.querySelector('.howto-new');
  if (mark) mark.hidden = !isNew;
  const label = btn.dataset.howtoLabel;
  if (label) btn.setAttribute('aria-label', isNew ? `${label}, new` : label);
}
